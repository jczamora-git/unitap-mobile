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

  public static async switchWorkspace(workspace: 'DEVADMIN' | 'OFFICER' | 'STUDENT'): Promise<void> {
    const { authService } = await import('@/services/auth.service');
    await authService.switchWorkspace(workspace);
    this.currentRole.value = workspace;
  }

  public static async hasRole(role: 'DEVADMIN' | 'OFFICER' | 'STUDENT'): Promise<boolean> {
    const { authService } = await import('@/services/auth.service');
    return authService.hasRole(role);
  }

  /**
   * Initializes auth state from active Supabase session or cached offline ticket.
   * Priority: Restores valid offline session immediately (0ms delay), then verifies
   * online asynchronously without freezing route transitions or app cold start.
   */
  public static async initialize(): Promise<void> {
    // 1. Fast path: check valid cached offline session first
    const cached = await AuthSessionService.getCachedOfflineSession();
    if (cached && AuthSessionService.isOfflineSessionValid(cached)) {
      await this.restoreOfflineSession(cached);

      // Asynchronously revalidate in background if online (never blocks startup)
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
      if (isOnline) {
        this.revalidateSessionOnline(cached.userId, cached.email).catch((e) => {
          console.warn('[SupabaseAuth] Background session revalidation error:', e);
        });
      }
      return;
    }

    // 2. Online verification path (First-time login or expired session)
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (isOnline) {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (!error && session && session.user) {
          await this.handleOnlineSession(session.user.id, session.user.email || '');
          this.isOfflineMode.value = false;
          return;
        }
      } catch (err) {
        console.warn('[SupabaseAuth] Online session check failed:', err);
      }
    }

    // 3. Fallback to expired or remaining cached offline session if any
    if (cached) {
      await this.restoreOfflineSession(cached);
    }
  }

  /**
   * Asynchronously verifies role validity with Supabase in the background.
   * If an administrator explicitly revoked all of user's roles on the cloud database,
   * or marked the account DISABLED, revokes local permissions and clears cached offline session.
   * Never forces logout for local accounts, unauthenticated sessions, or transient/RLS empty results.
   */
  public static async revalidateSessionOnline(userId: string, email: string): Promise<void> {
    try {
      // 1. If user ID is not a valid UUID (e.g. local SQLite 'usr_devadmin'), do not check Supabase user_roles
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
      if (!isUuid) {
        return;
      }

      // 2. Check if there is an active Supabase Auth session
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        // Not authenticated with Supabase Auth (e.g. local offline session) — preserve offline session!
        return;
      }

      // 3. Query remote account status
      const { data: remoteUser } = await supabase
        .from('users')
        .select('account_status')
        .eq('id', userId)
        .maybeSingle();

      if (remoteUser && remoteUser.account_status === 'DISABLED') {
        console.warn('[SupabaseAuth] Account has been disabled by administrator:', userId);
        await this.logout();
        return;
      }

      // 4. Check remote user roles
      const { data: remoteRoles, error } = await supabase
        .from('user_roles')
        .select('id, role, semester_id, assigned_at, revoked_at')
        .eq('user_id', userId);

      if (error) {
        console.warn('[SupabaseAuth] Role revalidation error:', error.message);
        return;
      }

      // Only force logout if the server explicitly has role records for this user AND ALL of them are revoked
      if (remoteRoles && remoteRoles.length > 0) {
        const hasActiveRole = remoteRoles.some((r: { revoked_at: string | null }) => !r.revoked_at);
        if (!hasActiveRole) {
          console.warn('[SupabaseAuth] Server indicates all active roles were revoked for user:', userId);
          const { getDatabase } = await import('@/database/database');
          const db = await getDatabase();
          const now = new Date().toISOString();
          await db.execute(
            'UPDATE user_roles SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
            [now, userId]
          );
          await this.logout();
          return;
        }
      }

      // Refresh cached offline session expiry
      if (this.currentUser.value && this.currentRole.value) {
        const effectiveRoleRecord: UserRoleRecord = {
          id: 'rol_' + userId.substring(0, 8),
          user_id: userId,
          role: this.currentRole.value,
          assigned_at: new Date().toISOString(),
        };
        await AuthSessionService.saveOfflineSession(this.currentUser.value, effectiveRoleRecord, email);
      }
    } catch (err) {
      console.warn('[SupabaseAuth] Offline or server unreachable during revalidation:', err);
    }
  }

  /**
   * Login with email or username and password via Supabase Auth
   */
  public static async login(identifier: string, password: string): Promise<LoginResult> {
    const cleanId = identifier.trim().toLowerCase();

    // Support both direct email and username / School ID aliases
    const candidates: string[] = [];
    if (cleanId.includes('@')) {
      candidates.push(cleanId);
    } else {
      // 1. Try resolving login email from School ID or username via server RPC
      try {
        const { data: resolvedEmail } = await supabase.rpc('resolve_login_email', {
          p_identifier: cleanId,
        });
        if (resolvedEmail && typeof resolvedEmail === 'string' && resolvedEmail.includes('@')) {
          candidates.push(resolvedEmail.toLowerCase());
        }
      } catch {
        // Fallback to domain aliases
      }

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

    const cleanSchoolId = schoolId.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = activationCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    try {
      // 1. Sign up user via Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            school_id: cleanSchoolId,
          },
        },
      });

      let userId = data?.user?.id;

      // Handle case where user already exists in auth (e.g. interrupted registration)
      if (error) {
        if (error.message.includes('already registered') || error.message.includes('User already registered')) {
          const signInRes = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });
          if (signInRes.data?.user) {
            userId = signInRes.data.user.id;
          } else {
            return {
              success: false,
              error: 'An account with this email already exists. Please sign in or use password recovery.',
            };
          }
        } else {
          return { success: false, error: error.message };
        }
      }

      if (!userId) {
        return { success: false, error: 'Unable to establish authenticated user session.' };
      }

      // 2. Atomically verify claim, link student profile, and assign STUDENT role on the server
      const linkRes = await AccountLinkingService.activateAndLinkStudentAccount(
        cleanSchoolId,
        cleanCode,
        userId
      );

      if (!linkRes.success) {
        return { success: false, error: linkRes.error || 'Activation failed.' };
      }

      // 3. Populate session
      await this.handleOnlineSession(userId, cleanEmail);
      return { success: true };
    } catch (err) {
      // Fallback for offline / local SQLite test environments
      try {
        const { authService } = await import('@/services/auth.service');
        await authService.activateStudentAccount(cleanSchoolId, cleanCode, password);
        return { success: true };
      } catch (fallbackErr: any) {
        return { success: false, error: fallbackErr.message || (err as Error).message };
      }
    }
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

    const { SyncManager } = await import('@/services/sync/sync-manager');
    SyncManager.stop();

    const { authService } = await import('@/services/auth.service');
    await authService.logout();

    try {
      const { SelectiveSyncService } = await import('@/services/sync/selective-sync.service');
      SelectiveSyncService.handleSessionChange(null);
    } catch {
      // Ignored
    }
  }

  private static async handleOnlineSession(userId: string, email: string): Promise<'DEVADMIN' | 'OFFICER' | 'STUDENT'> {
    const now = new Date().toISOString();

    // 1. Fetch remote user record for student linkage
    let remoteStudentId: string | null = null;
    let remoteUsername: string | null = null;
    try {
      const { data: remoteUser } = await supabase
        .from('users')
        .select('id, username, student_id, account_status')
        .eq('id', userId)
        .maybeSingle();

      if (remoteUser) {
        if (remoteUser.student_id) remoteStudentId = remoteUser.student_id;
        if (remoteUser.username) remoteUsername = remoteUser.username;
      }
    } catch (e) {
      console.warn('[SupabaseAuth] Could not query remote users profile:', e);
    }

    // 2. Determine authoritative role from Supabase PostgreSQL user_roles table
    let authoritativeRole: 'DEVADMIN' | 'OFFICER' | 'STUDENT' | null = null;
    try {
      const { data: remoteRoles, error: remoteRoleErr } = await supabase
        .from('user_roles')
        .select('id, role, semester_id, assigned_at, revoked_at')
        .eq('user_id', userId)
        .is('revoked_at', null);

      if (!remoteRoleErr && remoteRoles && remoteRoles.length > 0) {
        if (remoteRoles.some((r: { role: string }) => r.role === 'DEVADMIN')) {
          authoritativeRole = 'DEVADMIN';
        } else if (remoteRoles.some((r: { role: string }) => r.role === 'OFFICER')) {
          authoritativeRole = 'OFFICER';
        } else {
          authoritativeRole = 'STUDENT';
        }
      }
    } catch (e) {
      console.warn('[SupabaseAuth] Could not query remote user_roles:', e);
    }

    // 3. Check Supabase user app_metadata / user_metadata
    if (!authoritativeRole) {
      try {
        const { data: { user: sbUser } } = await supabase.auth.getUser();
        const metaRole = (sbUser?.app_metadata?.role || sbUser?.user_metadata?.role) as string | undefined;
        if (metaRole === 'DEVADMIN' || metaRole === 'OFFICER' || metaRole === 'STUDENT') {
          authoritativeRole = metaRole;
        }
      } catch {
        // Ignored
      }
    }

    // 4. Fallback based on student linkage
    if (!authoritativeRole && remoteStudentId) {
      authoritativeRole = 'STUDENT';
    }

    // 5. Fallback to existing local SQLite role
    if (!authoritativeRole) {
      const localRoles = await AuthRepository.getUserRoles(userId);
      if (localRoles.length > 0) {
        authoritativeRole = localRoles[0].role;
      }
    }

    // 6. Safe default: DEVADMIN if admin email, otherwise STUDENT (never default unknown to OFFICER)
    if (!authoritativeRole) {
      authoritativeRole = email.toLowerCase().includes('admin') ? 'DEVADMIN' : 'STUDENT';
    }

    let user = await AuthRepository.getUserById(userId);

    // If not found in SQLite yet, provision local stub
    if (!user) {
      const baseUsername = remoteUsername || email.split('@')[0];
      const existingUser = await AuthRepository.getUserByUsername(baseUsername);
      const safeUsername = (existingUser && existingUser.id !== userId)
        ? `${baseUsername}_${userId.substring(0, 6)}`
        : baseUsername;

      user = {
        id: userId,
        username: safeUsername,
        student_id: remoteStudentId || undefined,
        account_status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      };
      const newRole: UserRoleRecord = {
        id: 'rol_' + userId.substring(0, 8),
        user_id: userId,
        role: authoritativeRole,
        assigned_at: now,
      };
      await AuthRepository.createUserWithCredentials(
        user,
        { user_id: userId, password_hash: '', algorithm: 'ARGON2ID', provisioned_at: now },
        newRole
      );
    } else {
      // Reconcile student_id if updated on server
      if (remoteStudentId && user.student_id !== remoteStudentId) {
        user.student_id = remoteStudentId;
        const { getDatabase } = await import('@/database/database');
        const db = await getDatabase();
        await db.execute('UPDATE users SET student_id = ? WHERE id = ?', [remoteStudentId, userId]);
      }

      // Ensure local SQLite user_roles matches authoritative role
      const localRoles = await AuthRepository.getUserRoles(userId);
      const hasMatchingActiveRole = localRoles.some((r) => r.role === authoritativeRole && !r.revoked_at);
      if (!hasMatchingActiveRole) {
        const primaryRole: UserRoleRecord = {
          id: 'rol_' + userId.substring(0, 8) + '_' + Date.now().toString(36),
          user_id: userId,
          role: authoritativeRole,
          assigned_at: now,
        };
        await AuthRepository.assignUserRole(primaryRole);
      }
    }

    const effectiveRoleRecord: UserRoleRecord = {
      id: 'rol_' + userId.substring(0, 8),
      user_id: userId,
      role: authoritativeRole,
      assigned_at: now,
    };

    this.currentUser.value = user;
    this.currentRole.value = authoritativeRole;

    let studentRecord: StudentRecord | null = null;
    if (user.student_id) {
      studentRecord = await StudentsRepository.getStudentById(user.student_id);
      if (!studentRecord) {
        try {
          const { data: remoteStu } = await supabase
            .from('students')
            .select('*')
            .eq('id', user.student_id)
            .maybeSingle();
          if (remoteStu) {
            studentRecord = remoteStu as StudentRecord;
            await StudentsRepository.createStudent(remoteStu);
          }
        } catch {
          // Ignored
        }
      }
      this.currentStudent.value = studentRecord;
    }

    // Save offline session ticket for offline access
    await AuthSessionService.saveOfflineSession(user, effectiveRoleRecord, email);

    // Sync session with local authService for Vue reactivity & route guards
    const { authService } = await import('@/services/auth.service');
    const allLocalRoles = await AuthRepository.getUserRoles(userId);
    await authService.setSession(user, effectiveRoleRecord, studentRecord, allLocalRoles);

    return authoritativeRole;
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

