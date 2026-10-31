import { ref, computed } from 'vue';
import { argon2id, sha256 } from 'hash-wasm';
import { Preferences } from '@capacitor/preferences';
import { AuthRepository } from '../database/repositories/auth.repository';
import { StudentsRepository } from '../database/repositories/students.repository';
import type { UserAccount, UserRoleRecord, StudentRecord, ActivationClaim } from '@/types/database';

const SESSION_STORAGE_KEY = 'unitap_auth_session_v2';
const LOCKOUT_KEY = 'unitap_auth_lockout_v2';

export interface AuthSession {
  user: UserAccount;
  role: UserRoleRecord;
  student?: StudentRecord | null;
  loggedInAt: string;
}

export interface LoginResult {
  success: boolean;
  user?: UserAccount;
  role?: UserRoleRecord['role'];
  student?: StudentRecord | null;
  error?: string;
  lockedUntil?: string;
}

class AuthService {
  private currentUser = ref<UserAccount | null>(null);
  private currentRole = ref<UserRoleRecord | null>(null);
  private currentStudent = ref<StudentRecord | null>(null);
  private sessionInitialized = false;

  public user = computed(() => this.currentUser.value);
  public role = computed(() => this.currentRole.value?.role || null);
  public student = computed(() => this.currentStudent.value);
  public isAuthenticated = computed(() => this.currentUser.value !== null);

  public async initSession(): Promise<void> {
    if (this.sessionInitialized) return;
    try {
      const { value } = await Preferences.get({ key: SESSION_STORAGE_KEY });
      if (value) {
        const session: AuthSession = JSON.parse(value);
        this.currentUser.value = session.user;
        this.currentRole.value = session.role;
        this.currentStudent.value = session.student || null;
      }
    } catch {
      // Session parsing error
    } finally {
      this.sessionInitialized = true;
    }
  }

  // --- PASSWORD HASHING (ARGON2ID) ---
  public async hashPassword(password: string): Promise<string> {
    const salt = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(salt);
    } else {
      for (let i = 0; i < 16; i++) salt[i] = Math.floor(Math.random() * 256);
    }

    return argon2id({
      password,
      salt,
      iterations: 2,
      memorySize: 64, // 64 KiB for fast offline mobile verification
      hashLength: 32,
      parallelism: 1,
      outputType: 'encoded',
    });
  }

  public async verifyPassword(password: string, encodedHash: string): Promise<boolean> {
    try {
      const parts = encodedHash.split('$');
      if (parts.length < 6) return false;
      const saltBase64 = parts[4];
      const binaryString = atob(saltBase64);
      const salt = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        salt[i] = binaryString.charCodeAt(i);
      }

      const calculated = await argon2id({
        password,
        salt,
        iterations: 2,
        memorySize: 64,
        hashLength: 32,
        parallelism: 1,
        outputType: 'encoded',
      });
      return calculated === encodedHash;
    } catch (e) {
      console.error('Password verification error:', e);
      return false;
    }
  }

  public async hashToken(token: string): Promise<string> {
    return sha256(token.trim().toUpperCase());
  }

  // --- LOGIN WITH ATTEMPT LIMITS ---
  public async login(identifier: string, password: string): Promise<LoginResult> {
    await this.initSession();

    // Check lockout
    const isLocked = await this.checkLockout(identifier);
    if (isLocked.locked) {
      return {
        success: false,
        error: `Account is temporarily locked due to multiple failed attempts. Try again at ${new Date(isLocked.until!).toLocaleTimeString()}.`,
        lockedUntil: isLocked.until,
      };
    }

    const cleanId = identifier.trim();
    let user = await AuthRepository.getUserByUsername(cleanId);
    let student: StudentRecord | null = null;

    // If not found by username, check if it is a student's school_id
    if (!user) {
      student = await StudentsRepository.getStudentBySchoolId(cleanId);
      if (student) {
        user = await AuthRepository.getUserByStudentId(student.id);
      }
    } else if (user.student_id) {
      student = await StudentsRepository.getStudentById(user.student_id);
    }

    if (!user) {
      await this.recordFailedAttempt(cleanId);
      return { success: false, error: 'Invalid username, school ID, or password.' };
    }

    if (user.account_status === 'DISABLED') {
      return { success: false, error: 'This account has been disabled. Please contact your administrator.' };
    }

    const creds = await AuthRepository.getUserCredentials(user.id);
    if (!creds) {
      return { success: false, error: 'No credentials configured for this account.' };
    }

    const isValid = await this.verifyPassword(password, creds.password_hash);
    if (!isValid) {
      await this.recordFailedAttempt(cleanId);
      return { success: false, error: 'Invalid username, school ID, or password.' };
    }

    // Fetch user role
    const roles = await AuthRepository.getUserRoles(user.id);
    if (roles.length === 0) {
      return { success: false, error: 'No active role assigned to this account.' };
    }
    const primaryRole = roles[0];

    // Reset failed attempts upon successful authentication
    await this.resetFailedAttempts(cleanId);

    // Save session
    this.currentUser.value = user;
    this.currentRole.value = primaryRole;
    this.currentStudent.value = student;

    const session: AuthSession = {
      user,
      role: primaryRole,
      student,
      loggedInAt: new Date().toISOString(),
    };
    await Preferences.set({ key: SESSION_STORAGE_KEY, value: JSON.stringify(session) });

    return {
      success: true,
      user,
      role: primaryRole.role,
      student,
    };
  }

  public async logout(): Promise<void> {
    this.currentUser.value = null;
    this.currentRole.value = null;
    this.currentStudent.value = null;
    await Preferences.remove({ key: SESSION_STORAGE_KEY });
  }

  public async setSession(user: UserAccount, role: UserRoleRecord, student?: StudentRecord | null): Promise<void> {
    this.currentUser.value = user;
    this.currentRole.value = role;
    this.currentStudent.value = student || null;
    const session: AuthSession = {
      user,
      role,
      student: student || null,
      loggedInAt: new Date().toISOString(),
    };
    await Preferences.set({ key: SESSION_STORAGE_KEY, value: JSON.stringify(session) });
  }

  // --- INITIAL DEVADMIN SETUP ---
  public async isDevAdminConfigured(): Promise<boolean> {
    const admin = await AuthRepository.getUserByUsername('devadmin');
    return admin !== null;
  }

  public async setupInitialDevAdmin(password: string): Promise<UserAccount> {
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }
    const existing = await AuthRepository.getUserByUsername('devadmin');
    if (existing) {
      throw new Error('DEVADMIN account is already configured.');
    }

    const now = new Date().toISOString();
    const userId = 'usr_admin_' + Math.random().toString(36).substring(2, 8);
    const hash = await this.hashPassword(password);

    const user: UserAccount = {
      id: userId,
      username: 'devadmin',
      account_status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    };

    const cred = {
      user_id: userId,
      password_hash: hash,
      algorithm: 'ARGON2ID' as const,
      provisioned_at: now,
    };

    const role: UserRoleRecord = {
      id: 'rol_' + Math.random().toString(36).substring(2, 8),
      user_id: userId,
      role: 'DEVADMIN',
      assigned_at: now,
    };

    await AuthRepository.createUserWithCredentials(user, cred, role);
    return user;
  }

  // --- OFFICER PROVISIONING ---
  public static async createOfficerAccount(
    username: string,
    password: string,
    assignedByUserId: string,
    semesterId?: string
  ): Promise<UserAccount> {
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }
    const cleanUsername = username.trim().toLowerCase();
    const existing = await AuthRepository.getUserByUsername(cleanUsername);
    if (existing) {
      throw new Error('Username already exists.');
    }

    const now = new Date().toISOString();
    const userId = 'usr_off_' + Math.random().toString(36).substring(2, 8);
    const hash = await (new AuthService()).hashPassword(password);

    const user: UserAccount = {
      id: userId,
      username: cleanUsername,
      account_status: 'ACTIVE',
      created_by_user_id: assignedByUserId,
      created_at: now,
      updated_at: now,
    };

    const cred = {
      user_id: userId,
      password_hash: hash,
      algorithm: 'ARGON2ID' as const,
      provisioned_at: now,
    };

    const role: UserRoleRecord = {
      id: 'rol_' + Math.random().toString(36).substring(2, 8),
      user_id: userId,
      role: 'OFFICER',
      semester_id: semesterId || null,
      assigned_by_user_id: assignedByUserId,
      assigned_at: now,
    };

    await AuthRepository.createUserWithCredentials(user, cred, role);
    return user;
  }

  // --- ACTIVATION CODES & STUDENT SELF-REGISTRATION ---
  public async generateActivationClaim(
    studentId: string,
    issuedByUserId: string,
    expiresHours = 48
  ): Promise<{ rawCode: string; claim: ActivationClaim }> {
    // Generate clean 8-character human-readable alphanumeric code
    const rawCode = Array.from({ length: 8 }, () => '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 32)]).join('');
    const tokenHash = await this.hashToken(rawCode);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresHours * 3600 * 1000).toISOString();

    const claim: ActivationClaim = {
      id: 'act_' + Math.random().toString(36).substring(2, 10),
      student_id: studentId,
      token_hash: tokenHash,
      issued_by_user_id: issuedByUserId,
      expires_at: expiresAt,
      created_at: now.toISOString(),
    };

    await AuthRepository.createActivationClaim(claim);
    return { rawCode, claim };
  }

  public async activateStudentAccount(
    schoolId: string,
    activationCode: string,
    password: string
  ): Promise<UserAccount> {
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }

    const cleanSchoolId = schoolId.trim();
    const student = await StudentsRepository.getStudentBySchoolId(cleanSchoolId);
    if (!student) {
      throw new Error('Student record not found. Please contact an officer to verify your enrollment.');
    }

    const existingUser = await AuthRepository.getUserByStudentId(student.id);
    if (existingUser && existingUser.account_status === 'ACTIVE') {
      throw new Error('This student account has already been activated. Please sign in with your credentials.');
    }

    const tokenHash = await this.hashToken(activationCode);
    const claim = await AuthRepository.getActivationClaimByHash(tokenHash);
    if (!claim) {
      throw new Error('Invalid or already used activation code.');
    }

    if (claim.student_id !== student.id) {
      throw new Error('Activation code does not match this school ID.');
    }

    if (new Date(claim.expires_at).getTime() < Date.now()) {
      throw new Error('This activation code has expired. Please request a new one from an officer.');
    }

    const now = new Date().toISOString();
    const hash = await this.hashPassword(password);
    const userId = existingUser ? existingUser.id : 'usr_stu_' + Math.random().toString(36).substring(2, 8);

    const user: UserAccount = {
      id: userId,
      username: cleanSchoolId,
      student_id: student.id,
      account_status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    };

    const cred = {
      user_id: userId,
      password_hash: hash,
      algorithm: 'ARGON2ID' as const,
      provisioned_at: now,
    };

    const role: UserRoleRecord = {
      id: 'rol_' + Math.random().toString(36).substring(2, 8),
      user_id: userId,
      role: 'STUDENT',
      assigned_at: now,
    };

    await AuthRepository.createUserWithCredentials(user, cred, role);
    await AuthRepository.markActivationClaimUsed(claim.id, now);

    return user;
  }

  // --- LOCKOUT PROTECTION ---
  private async checkLockout(identifier: string): Promise<{ locked: boolean; until?: string }> {
    try {
      const { value } = await Preferences.get({ key: LOCKOUT_KEY + '_' + identifier.toLowerCase() });
      if (value) {
        const data = JSON.parse(value);
        if (data.lockedUntil && new Date(data.lockedUntil).getTime() > Date.now()) {
          return { locked: true, until: data.lockedUntil };
        }
      }
    } catch {
      // Ignore
    }
    return { locked: false };
  }

  private async recordFailedAttempt(identifier: string): Promise<void> {
    const key = LOCKOUT_KEY + '_' + identifier.toLowerCase();
    try {
      const { value } = await Preferences.get({ key });
      let attempts = 0;
      if (value) {
        const parsed = JSON.parse(value);
        attempts = parsed.attempts || 0;
      }
      attempts += 1;
      const lockoutData: { attempts: number; lockedUntil?: string } = { attempts };
      if (attempts >= 5) {
        // Lock for 60 seconds
        lockoutData.lockedUntil = new Date(Date.now() + 60 * 1000).toISOString();
      }
      await Preferences.set({ key, value: JSON.stringify(lockoutData) });
    } catch {
      // Ignore
    }
  }

  private async resetFailedAttempts(identifier: string): Promise<void> {
    const key = LOCKOUT_KEY + '_' + identifier.toLowerCase();
    try {
      await Preferences.remove({ key });
    } catch {
      // Ignore
    }
  }
}

export const authService = new AuthService();
