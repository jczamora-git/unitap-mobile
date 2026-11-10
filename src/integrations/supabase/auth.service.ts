import { ref, computed } from 'vue';
import { Capacitor } from '@capacitor/core';
import { supabase } from './client';
import { AuthSessionService, type CachedOfflineSession } from './auth-session.service';
import { AccountLinkingService } from './account-linking.service';
import { AuthRepository } from '@/database/repositories/auth.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { DataModeService } from '@/services/data-mode.service';
import { NetworkService } from '@/services/network.service';
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
  private static currentRoles = ref<('DEVADMIN' | 'OFFICER' | 'STUDENT')[]>([]);
  private static currentAvailablePortals = ref<('DEVADMIN' | 'OFFICER' | 'STUDENT')[]>([]);
  private static currentActiveWorkspace = ref<'DEVADMIN' | 'OFFICER' | 'STUDENT' | null>(null);
  private static currentStudent = ref<StudentRecord | null>(null);
  private static isOfflineMode = ref(false);
  private static authListenerInitialized = false;
  private static isInitialized = ref(false);
  private static initPromise: Promise<void> | null = null;

  public static get user() {
    return computed(() => this.currentUser.value);
  }

  public static get role() {
    return computed(() => this.currentActiveWorkspace.value || this.currentRole.value);
  }

  public static get roles() {
    return computed(() => this.currentRoles.value);
  }

  public static get availablePortals() {
    return computed(() => this.currentAvailablePortals.value);
  }

  public static get activeWorkspace() {
    return computed(() => this.currentActiveWorkspace.value || this.currentRole.value);
  }

  public static get canSwitchPortal() {
    return computed(() => this.currentAvailablePortals.value.length > 1);
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

  public static get isCloudAuthenticated() {
    return computed(() => this.currentUser.value !== null && !this.isOfflineMode.value);
  }

  public static get initialized() {
    return computed(() => this.isInitialized.value);
  }

  /**
   * Reliable authentication initialization barrier.
   * Guarantees session restoration completes before protected direct queries execute.
   */
  public static async waitForInitialization(): Promise<void> {
    if (this.isInitialized.value) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    await this.initialize();
  }

  /**
   * Verifies whether an active, valid, non-expired Supabase Auth JWT session exists.
   */
  public static async hasValidCloudSession(): Promise<boolean> {
    await this.waitForInitialization();
    if (!this.currentUser.value || this.isOfflineMode.value) {
      return false;
    }
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session || !session.access_token) {
        return false;
      }
      if (session.expires_at && session.expires_at * 1000 < Date.now()) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns current session access token JWT if present.
   */
  public static async getAccessToken(): Promise<string | null> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token || null;
    } catch {
      return null;
    }
  }

  public static setActiveRole(role: 'DEVADMIN' | 'OFFICER' | 'STUDENT'): void {
    this.currentRole.value = role;
    this.currentActiveWorkspace.value = role;
  }

  public static async switchWorkspace(workspace: 'DEVADMIN' | 'OFFICER' | 'STUDENT'): Promise<void> {
    if (this.currentAvailablePortals.value.length > 0 && !this.currentAvailablePortals.value.includes(workspace)) {
      throw new Error(`Unauthorized portal: account does not have access to ${workspace} portal.`);
    }

    this.currentActiveWorkspace.value = workspace;
    this.currentRole.value = workspace;

    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key: 'unitap_active_workspace', value: workspace });
    } catch {
      // Non-fatal
    }

    const { authService } = await import('@/services/auth.service');
    if (authService.activeWorkspace.value !== workspace) {
      await authService.switchWorkspace(workspace);
    }
  }

  public static async hasRole(role: 'DEVADMIN' | 'OFFICER' | 'STUDENT'): Promise<boolean> {
    const { authService } = await import('@/services/auth.service');
    return authService.hasRole(role);
  }

  /**
   * Reactively refreshes all user roles and officer appointments from Supabase.
   * On failure/offline, safely retains previous valid roles and workspace without data loss.
   */
  public static async refreshSessionRoles(): Promise<void> {
    let userId = this.currentUser.value?.id;
    let email = this.currentUser.value?.username
      ? (this.currentUser.value.username.includes('@') ? this.currentUser.value.username : `${this.currentUser.value.username}@unitap.com`)
      : '';

    if (!userId) {
      if (DataModeService.isDirectSupabase()) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            userId = session.user.id;
            email = session.user.email || '';
          }
        } catch {}
      }
    }

    if (!userId) return;

    try {
      await this.handleOnlineSession(userId, email);
    } catch (err) {
      console.warn('[SupabaseAuth] Role refresh failed, preserving existing valid state:', err);
    }
  }

  public static setupAuthStateListener(): void {
    if (this.authListenerInitialized) return;
    this.authListenerInitialized = true;

    try {
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          if (session?.user) {
            await this.handleOnlineSession(session.user.id, session.user.email || '');
            this.isOfflineMode.value = false;
            this.isInitialized.value = true;
          }
        } else if (event === 'SIGNED_OUT') {
          this.currentUser.value = null;
          this.currentRole.value = null;
          this.currentStudent.value = null;
          this.isOfflineMode.value = false;
          this.isInitialized.value = true;
        }
      });

      // App resume listener for Android: refresh live Supabase session on resume
      NetworkService.onAppResume(async () => {
        try {
          if (DataModeService.isDirectSupabase()) {
            const { data: { session }, error } = await supabase.auth.getSession();
            if (!error && session?.user) {
              if (!this.currentUser.value || this.currentUser.value.id !== session.user.id) {
                await this.handleOnlineSession(session.user.id, session.user.email || '');
              }
            }
          }
        } catch (resumeErr) {
          console.warn('[SupabaseAuth] Resume session refresh warning:', resumeErr);
        }
      });
    } catch (err) {
      console.warn('[SupabaseAuth] Failed to attach auth listeners:', err);
    }
  }

  /**
   * Initializes auth state from active Supabase session or cached offline ticket.
   * Priority: In Direct Supabase Mode, verifies live Supabase Auth session first.
   * In Offline-First Mode, restores valid offline session immediately (0ms delay).
   */
  public static async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        this.setupAuthStateListener();

        // 1. In Direct Supabase Mode, authoritative authentication is live Supabase Auth
        if (DataModeService.isDirectSupabase()) {
          try {
            const { data: { session }, error } = await supabase.auth.getSession();
            if (!error && session && session.user) {
              await this.handleOnlineSession(session.user.id, session.user.email || '');
              this.isOfflineMode.value = false;
              return;
            }
          } catch (err) {
            console.warn('[SupabaseAuth] Live session check error in Direct Mode:', err);
          }
          // If Direct Mode has no live session, do not restore local stubs
          this.currentUser.value = null;
          this.currentRole.value = null;
          this.currentStudent.value = null;
          this.isOfflineMode.value = false;
          return;
        }

        // 2. In Offline-First Mode: Fast path check valid cached offline session first
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

        // 3. Online verification path (First-time login or expired session)
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

        // 4. Fallback to expired or remaining cached offline session if any
        if (cached) {
          await this.restoreOfflineSession(cached);
        }
      } finally {
        this.isInitialized.value = true;
        this.initPromise = null;
      }
    })();

    return this.initPromise;
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
      } catch (rpcErr) {
        console.warn('[SupabaseAuth] resolve_login_email RPC call error:', rpcErr);
      }

      // If identifier is devadmin and RPC returned nothing, try resolving 'admin'
      if (cleanId === 'devadmin' && !candidates.length) {
        try {
          const { data: adminEmail } = await supabase.rpc('resolve_login_email', {
            p_identifier: 'admin',
          });
          if (adminEmail && typeof adminEmail === 'string' && adminEmail.includes('@')) {
            candidates.push(adminEmail.toLowerCase());
          }
        } catch {
          // Ignored
        }
      }

      // Known default aliases for DevAdmin
      if (cleanId === 'admin' || cleanId === 'devadmin') {
        if (!candidates.includes('admin@unitap.com')) candidates.push('admin@unitap.com');
        if (!candidates.includes('devadmin@unitap.com')) candidates.push('devadmin@unitap.com');
      }

      const domainAlias = `${cleanId}@unitap.com`;
      if (!candidates.includes(domainAlias)) {
        candidates.push(domainAlias);
      }
    }

    // 1. Attempt Online Supabase Auth across candidates
    let authError: string | null = null;
    let successfulSession: { user: any; session: any } | null = null;
    let matchedEmail: string | null = null;

    for (const emailCandidate of candidates) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: emailCandidate,
          password,
        });

        if (!error && data.user && data.session) {
          successfulSession = data;
          matchedEmail = emailCandidate;
          break;
        }

        if (error) {
          authError = error.message;
        }
      } catch (netErr) {
        authError = (netErr as Error).message;
        console.warn('[SupabaseAuth] Network failure attempting email candidate:', emailCandidate, netErr);
      }
    }

    if (successfulSession && successfulSession.user && matchedEmail) {
      try {
        const role = await this.handleOnlineSession(successfulSession.user.id, matchedEmail);
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

    // Direct Supabase Mode: NEVER fall back to offline cache or local SQLite
    if (DataModeService.isDirectSupabase()) {
      return {
        success: false,
        error: authError || 'Invalid credentials. Please verify your Supabase Auth account and password.',
      };
    }

    // 2. Offline Fallback for previously provisioned users in Offline-First Mode
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
      error: authError || 'Invalid credentials or connection error. Please verify your email and password.',
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

    console.log('[SupabaseAuth] registerStudent attempt:', {
      platform: Capacitor.getPlatform(),
      dataMode: DataModeService.getModeLabel(),
      schoolId: cleanSchoolId,
      email: cleanEmail,
    });

    try {
      // 1. Check if caller already has an active Supabase session with the same email
      const { data: existingSessionData } = await supabase.auth.getSession();
      let userId = existingSessionData?.session?.user?.email?.toLowerCase() === cleanEmail
        ? existingSessionData.session.user.id
        : undefined;

      if (!userId) {
        // Sign up user via Supabase Auth
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              school_id: cleanSchoolId,
            },
          },
        });

        userId = data?.user?.id;

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

      console.log('[SupabaseAuth] activateAndLinkStudentAccount result:', {
        success: linkRes.success,
        studentId: linkRes.studentId,
        alreadyLinked: linkRes.alreadyLinked,
        error: linkRes.error,
      });

      if (!linkRes.success) {
        return { success: false, error: linkRes.error || 'Activation failed.' };
      }

      // 3. Populate session ONLY on verified activation success
      await this.handleOnlineSession(userId, cleanEmail);
      return { success: true };
    } catch (err) {
      if (DataModeService.isDirectSupabase()) {
        console.error('[SupabaseAuth] Registration exception in Direct Mode:', err);
        return {
          success: false,
          error: (err as Error).message || 'Student registration failed.',
        };
      }

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
    this.isInitialized.value = true;

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

    // 2. Determine authoritative role and active workspace from Supabase PostgreSQL user_roles and appointments
    let authoritativeRole: 'DEVADMIN' | 'OFFICER' | 'STUDENT' | null = null;
    let remoteRoles: any[] = [];
    try {
      const { data, error: remoteRoleErr } = await supabase
        .from('user_roles')
        .select('id, role, semester_id, assigned_at, revoked_at')
        .eq('user_id', userId)
        .is('revoked_at', null);

      if (!remoteRoleErr && data) {
        remoteRoles = data;
      }
    } catch (e) {
      console.warn('[SupabaseAuth] Could not query remote user_roles:', e);
    }

    const hasDevAdmin = remoteRoles.some((r: { role: string }) => r.role === 'DEVADMIN');
    const hasOfficerRole = remoteRoles.some((r: { role: string }) => r.role === 'OFFICER');
    const hasStudentRole = remoteRoles.some((r: { role: string }) => r.role === 'STUDENT') || Boolean(remoteStudentId);

    // Require valid, active, non-expired officer appointment before enabling Officer access
    let hasValidOfficer = false;
    if (hasOfficerRole) {
      try {
        const { OfficerManagementService } = await import('@/services/officer-management.service');
        hasValidOfficer = await OfficerManagementService.hasValidOfficerAppointment(userId, remoteStudentId);
      } catch (apptErr) {
        console.warn('[SupabaseAuth] Officer appointment validity check error:', apptErr);
      }
    }

    // Resolve verified active roles (do not display OFFICER if appointment is invalid)
    const verifiedActiveRoles: ('DEVADMIN' | 'OFFICER' | 'STUDENT')[] = [];
    if (hasDevAdmin) {
      verifiedActiveRoles.push('DEVADMIN');
    } else {
      if (hasOfficerRole && hasValidOfficer) {
        verifiedActiveRoles.push('OFFICER');
      }
      if (hasStudentRole) {
        verifiedActiveRoles.push('STUDENT');
      }
    }

    // Fallback if no roles found
    if (verifiedActiveRoles.length === 0) {
      verifiedActiveRoles.push(email.toLowerCase().includes('admin') ? 'DEVADMIN' : 'STUDENT');
    }

    // Resolve available portals independently
    const availablePortals: ('DEVADMIN' | 'OFFICER' | 'STUDENT')[] = [];
    if (verifiedActiveRoles.includes('DEVADMIN')) {
      availablePortals.push('DEVADMIN');
    }
    if (verifiedActiveRoles.includes('OFFICER')) {
      availablePortals.push('OFFICER');
    }
    if (verifiedActiveRoles.includes('STUDENT')) {
      availablePortals.push('STUDENT');
    }

    // Restore selected portal from Preferences if valid, otherwise select default
    let activeWorkspace: 'DEVADMIN' | 'OFFICER' | 'STUDENT' | null = null;
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { value: saved } = await Preferences.get({ key: 'unitap_active_workspace' });
      if (saved && availablePortals.includes(saved as any)) {
        activeWorkspace = saved as any;
      }
    } catch {}

    if (!activeWorkspace) {
      // Default to Student Portal if available and no saved workspace preference exists
      if (availablePortals.includes('STUDENT')) {
        activeWorkspace = 'STUDENT';
      } else if (availablePortals.includes('DEVADMIN')) {
        activeWorkspace = 'DEVADMIN';
      } else if (availablePortals.includes('OFFICER')) {
        activeWorkspace = 'OFFICER';
      } else {
        activeWorkspace = availablePortals[0] || 'STUDENT';
      }
    }

    authoritativeRole = activeWorkspace;

    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key: 'unitap_active_workspace', value: activeWorkspace });
    } catch {}

    // 3. Check Supabase user app_metadata / user_metadata fallback
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

    // Ensure student record exists in SQLite before referencing it to prevent foreign key violation
    if (remoteStudentId) {
      const existingStudent = await StudentsRepository.getStudentById(remoteStudentId);
      if (!existingStudent) {
        try {
          const { data: remoteStu } = await supabase
            .from('students')
            .select('*')
            .eq('id', remoteStudentId)
            .maybeSingle();
          if (remoteStu) {
            await StudentsRepository.createStudent(remoteStu as StudentRecord);
          }
        } catch (stuErr) {
          console.warn('[SupabaseAuth] Could not pre-hydrate student for FK constraint:', stuErr);
        }
      }
    }

    // If not found in SQLite yet, provision local stub
    if (!user) {
      const baseUsername = remoteUsername || email.split('@')[0];
      const existingUser = await AuthRepository.getUserByUsername(baseUsername);
      const safeUsername = (existingUser && existingUser.id !== userId)
        ? `${baseUsername}_${userId.substring(0, 6)}`
        : baseUsername;

      const studentInDb = remoteStudentId ? await StudentsRepository.getStudentById(remoteStudentId) : null;
      user = {
        id: userId,
        username: safeUsername,
        student_id: studentInDb ? remoteStudentId : undefined,
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
    }

    // Ensure all active remote roles are mirrored into local SQLite without deleting or overriding existing roles
    const localRoles = await AuthRepository.getUserRoles(userId);
    const rolesToMirror = (remoteRoles && remoteRoles.length > 0)
      ? remoteRoles
      : [{ role: authoritativeRole, user_id: userId }];

    for (const r of rolesToMirror) {
      const exists = localRoles.some((lr) => lr.role === r.role && !lr.revoked_at);
      if (!exists) {
        await AuthRepository.assignUserRole({
          id: 'rol_' + userId.substring(0, 8) + '_' + r.role.toLowerCase(),
          user_id: userId,
          role: r.role,
          assigned_at: r.assigned_at || now,
        });
      }
    }

    const effectiveRoleRecord: UserRoleRecord = {
      id: 'rol_' + userId.substring(0, 8),
      user_id: userId,
      role: authoritativeRole,
      assigned_at: now,
    };

    this.currentUser.value = user;
    this.currentRole.value = activeWorkspace;
    this.currentRoles.value = verifiedActiveRoles;
    this.currentAvailablePortals.value = availablePortals;
    this.currentActiveWorkspace.value = activeWorkspace;

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
    const localUserRoles: UserRoleRecord[] = verifiedActiveRoles.map((r) => ({
      id: 'rol_' + userId.substring(0, 8) + '_' + r.toLowerCase(),
      user_id: userId,
      role: r,
      assigned_at: now,
    }));
    await authService.setSession(user, effectiveRoleRecord, studentRecord, localUserRoles, activeWorkspace);

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

    const localRoles = await AuthRepository.getUserRoles(cached.userId);
    const dbRoles = localRoles.filter((r) => !r.revoked_at).map((r) => r.role);

    let hasValidOfficer = false;
    if (dbRoles.includes('OFFICER')) {
      try {
        const { OfficerManagementService } = await import('@/services/officer-management.service');
        hasValidOfficer = await OfficerManagementService.hasValidOfficerAppointment(cached.userId, cached.studentId);
      } catch {
        hasValidOfficer = false;
      }
    }

    const verifiedActiveRoles: ('DEVADMIN' | 'OFFICER' | 'STUDENT')[] = [];
    if (dbRoles.includes('DEVADMIN')) {
      verifiedActiveRoles.push('DEVADMIN');
    } else {
      if (dbRoles.includes('OFFICER') && hasValidOfficer) verifiedActiveRoles.push('OFFICER');
      if (dbRoles.includes('STUDENT') || Boolean(cached.studentId)) verifiedActiveRoles.push('STUDENT');
    }
    if (verifiedActiveRoles.length === 0) verifiedActiveRoles.push(cached.role);

    const availablePortals: ('DEVADMIN' | 'OFFICER' | 'STUDENT')[] = [];
    if (verifiedActiveRoles.includes('DEVADMIN')) availablePortals.push('DEVADMIN');
    if (verifiedActiveRoles.includes('OFFICER')) availablePortals.push('OFFICER');
    if (verifiedActiveRoles.includes('STUDENT')) availablePortals.push('STUDENT');
    if (availablePortals.length === 0) availablePortals.push(cached.role);

    let activeWorkspace: 'DEVADMIN' | 'OFFICER' | 'STUDENT' | null = null;
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { value: saved } = await Preferences.get({ key: 'unitap_active_workspace' });
      if (saved && availablePortals.includes(saved as any)) {
        activeWorkspace = saved as any;
      }
    } catch {
      // Ignored
    }

    if (!activeWorkspace) {
      if (availablePortals.includes('STUDENT')) {
        activeWorkspace = 'STUDENT';
      } else if (availablePortals.includes('DEVADMIN')) {
        activeWorkspace = 'DEVADMIN';
      } else if (availablePortals.includes('OFFICER')) {
        activeWorkspace = 'OFFICER';
      } else {
        activeWorkspace = availablePortals[0] || cached.role;
      }
    }

    this.currentUser.value = user;
    this.currentRole.value = activeWorkspace;
    this.currentRoles.value = verifiedActiveRoles;
    this.currentAvailablePortals.value = availablePortals;
    this.currentActiveWorkspace.value = activeWorkspace;

    let studentRecord: StudentRecord | null = null;
    if (cached.studentId) {
      studentRecord = await StudentsRepository.getStudentById(cached.studentId);
      this.currentStudent.value = studentRecord;
    }

    this.isOfflineMode.value = true;

    // Sync with local authService
    const { authService } = await import('@/services/auth.service');
    await authService.setSession(user, role, studentRecord, localRoles, activeWorkspace);
  }
}

