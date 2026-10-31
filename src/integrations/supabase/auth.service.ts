import { ref, computed } from 'vue';
import { supabase } from './client';
import { AuthSessionService, type CachedOfflineSession } from './auth-session.service';
import { AccountLinkingService } from './account-linking.service';
import { AuthRepository } from '@/database/repositories/auth.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import type { UserAccount, UserRoleRecord, StudentRecord } from '@/types/database';

export interface LoginResult {
  success: boolean;
  role?: 'DEVADMIN' | 'OFFICER' | 'STUDENT';
  error?: string;
  isOffline?: boolean;
}

export class SupabaseAuthService {
  private static currentUser = ref<UserAccount | null>(null);
  private static currentRole = ref<'DEVADMIN' | 'OFFICER' | 'STUDENT' | null>(null);
  private static currentStudent = ref<StudentRecord | null>(null);
  private static isOfflineMode = ref(false);

  public static get user() {
    return computed(() => this.currentUser.value);
  }

  public static get role() {
    return computed(() => this.currentRole.value);
  }

  public static get student() {
    return computed(() => this.currentStudent.value);
  }

  public static get isOffline() {
    return computed(() => this.isOfflineMode.value);
  }

  public static get isAuthenticated() {
    return computed(() => this.currentUser.value !== null);
  }

  /**
   * Initializes auth state from active Supabase session or cached offline ticket
   */
  public static async initialize(): Promise<void> {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (!error && session && session.user) {
        await this.handleOnlineSession(session.user.id, session.user.email || '');
        this.isOfflineMode.value = false;
        return;
      }
    } catch (err) {
      console.warn('[SupabaseAuth] Could not connect to Supabase, checking offline session:', err);
    }

    // Check cached offline session
    const cached = await AuthSessionService.getCachedOfflineSession();
    if (cached) {
      await this.restoreOfflineSession(cached);
    }
  }

  /**
   * Login with email or username and password via Supabase Auth
   */
  public static async login(identifier: string, password: string): Promise<LoginResult> {
    const cleanId = identifier.trim().toLowerCase();

    // Support both direct email and username aliases (e.g. 'devadmin' or 'admin' -> 'admin@unitap.com')
    const candidates: string[] = [];
    if (cleanId.includes('@')) {
      candidates.push(cleanId);
    } else {
      if (cleanId === 'admin' || cleanId === 'devadmin') {
        candidates.push('admin@unitap.com');
      }
      candidates.push(`${cleanId}@unitap.com`);
    }

    // 1. Attempt Online Supabase Auth
    for (const emailCandidate of candidates) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: emailCandidate,
          password,
        });

        if (!error && data.user) {
          try {
            const role = await this.handleOnlineSession(data.user.id, emailCandidate);
            this.isOfflineMode.value = false;
            return { success: true, role, isOffline: false };
          } catch (dbErr) {
            console.error('[SupabaseAuth] Error initializing local user session from online auth:', dbErr);
            return {
              success: false,
              error: `Session initialization error: ${(dbErr as Error).message || 'Database error'}`,
            };
          }
        }

        if (error && error.message.includes('Invalid login credentials') && candidates.length === 1) {
          return { success: false, error: 'Invalid email or password.' };
        }
      } catch (netErr) {
        console.warn('[SupabaseAuth] Network failure during login, attempting offline verification:', netErr);
      }
    }

    // 2. Offline Fallback for previously provisioned users
    const cached = await AuthSessionService.getCachedOfflineSession();
    if (cached && (cached.email.toLowerCase() === cleanId || cached.username.toLowerCase() === cleanId)) {
      if (AuthSessionService.isOfflineSessionValid(cached)) {
        await this.restoreOfflineSession(cached);
        this.isOfflineMode.value = true;
        return { success: true, role: cached.role, isOffline: true };
      } else {
        return { success: false, error: 'Offline session expired. Please connect to the internet to log in.' };
      }
    }

    return {
      success: false,
      error: 'Invalid credentials or connection error. Please verify your email and password.',
    };
  }

  /**
   * Student self-registration with School ID, Activation Code, Email, and Password
   */
  public static async registerStudent(
    schoolId: string,
    activationCode: string,
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    if (password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters long.' };
    }

    // 1. Verify activation code claim
    const claimRes = await AccountLinkingService.verifyActivationClaim(schoolId, activationCode);
    if (!claimRes.success || !claimRes.studentId) {
      return { success: false, error: claimRes.error || 'Failed to verify activation code.' };
    }

    // 2. Sign up user via Supabase Auth
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            school_id: schoolId.trim(),
            student_id: claimRes.studentId,
            role: 'STUDENT',
          },
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (data.user) {
        // 3. Link account to student profile
        await AccountLinkingService.linkStudentAccount(
          data.user.id,
          claimRes.studentId,
          schoolId.trim()
        );

        // Populate session
        await this.handleOnlineSession(data.user.id, email);
        return { success: true };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }

    return { success: false, error: 'Registration failed. Please try again.' };
  }

  /**
   * Logout and clear active sessions
   */
  public static async logout(): Promise<void> {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignored
    }

    await AuthSessionService.clearOfflineSession();
    this.currentUser.value = null;
    this.currentRole.value = null;
    this.currentStudent.value = null;
    this.isOfflineMode.value = false;

    const { authService } = await import('@/services/auth.service');
    await authService.logout();
  }

  private static async handleOnlineSession(userId: string, email: string): Promise<'DEVADMIN' | 'OFFICER' | 'STUDENT'> {
    let user = await AuthRepository.getUserById(userId);
    let role = (await AuthRepository.getUserRoles(userId))[0];

    // If not found in SQLite yet, provision local stub
    if (!user) {
      const now = new Date().toISOString();
      const baseUsername = email.split('@')[0];
      const existingUser = await AuthRepository.getUserByUsername(baseUsername);
      const safeUsername = (existingUser && existingUser.id !== userId)
        ? `${baseUsername}_${userId.substring(0, 6)}`
        : baseUsername;

      user = {
        id: userId,
        username: safeUsername,
        account_status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      };
      role = {
        id: 'rol_' + Math.random().toString(36).substring(2, 10),
        user_id: userId,
        role: email.toLowerCase().includes('admin') ? 'DEVADMIN' : 'OFFICER',
        assigned_at: now,
      };
      await AuthRepository.createUserWithCredentials(user, { user_id: userId, password_hash: '', algorithm: 'ARGON2ID', provisioned_at: now }, role);
    }

    this.currentUser.value = user;
    this.currentRole.value = role ? role.role : 'STUDENT';

    let studentRecord: StudentRecord | null = null;
    if (user.student_id) {
      studentRecord = await StudentsRepository.getStudentById(user.student_id);
      this.currentStudent.value = studentRecord;
    }

    // Save offline session ticket for offline access
    await AuthSessionService.saveOfflineSession(user, role, email);

    // Sync session with local authService for Vue reactivity & route guards
    const { authService } = await import('@/services/auth.service');
    await authService.setSession(user, role, studentRecord);

    return this.currentRole.value;
  }

  private static async restoreOfflineSession(cached: CachedOfflineSession): Promise<void> {
    const user: UserAccount = {
      id: cached.userId,
      username: cached.username,
      student_id: cached.studentId,
      account_status: 'ACTIVE',
      created_at: cached.cachedAt,
      updated_at: cached.cachedAt,
    };
    const role: UserRoleRecord = {
      id: 'rol_' + cached.userId.substring(0, 8),
      user_id: cached.userId,
      role: cached.role,
      assigned_at: cached.cachedAt,
    };

    this.currentUser.value = user;
    this.currentRole.value = cached.role;

    let studentRecord: StudentRecord | null = null;
    if (cached.studentId) {
      studentRecord = await StudentsRepository.getStudentById(cached.studentId);
      this.currentStudent.value = studentRecord;
    }

    this.isOfflineMode.value = true;

    // Sync with local authService
    const { authService } = await import('@/services/auth.service');
    await authService.setSession(user, role, studentRecord);
  }
}

