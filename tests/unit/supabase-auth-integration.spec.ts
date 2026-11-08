import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDatabaseForTests } from '@/database/database';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { authService } from '@/services/auth.service';
import { SystemSetupService } from '@/services/system-setup.service';
import { DataModeService } from '@/services/data-mode.service';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { getDatabase } from '@/database/database';
import { supabase } from '@/integrations/supabase/client';

describe('UniTap 2.0 Supabase Auth Session Integration', () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
    DataModeService.setMode('supabase_direct');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (SupabaseAuthService as any).currentUser.value = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (SupabaseAuthService as any).currentRole.value = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (SupabaseAuthService as any).currentStudent.value = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (SupabaseAuthService as any).isOfflineMode.value = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (SupabaseAuthService as any).isInitialized.value = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (SupabaseAuthService as any).initPromise = null;
  });

  afterEach(() => {
    DataModeService.setMode('offline_first');
    vi.restoreAllMocks();
  });

  describe('1. Valid Cloud DevAdmin Login', () => {
    it('successfully logs in via Supabase Auth and establishes authenticated cloud state', async () => {
      const mockUserId = '11111111-2222-3333-4444-555555555555';
      const mockSession = {
        access_token: 'mock_valid_jwt_token_header.payload.signature',
        refresh_token: 'mock_refresh_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: mockUserId,
          email: 'admin@unitap.com',
        },
      };

      // Mock resolve_login_email RPC
      vi.spyOn(supabase, 'rpc').mockImplementation(async (fn: string) => {
        if (fn === 'resolve_login_email') {
          return { data: 'admin@unitap.com', error: null } as any;
        }
        return { data: null, error: null } as any;
      });

      // Mock signInWithPassword
      vi.spyOn(supabase.auth, 'signInWithPassword').mockImplementation(async () => {
        return {
          data: {
            user: mockSession.user as any,
            session: mockSession as any,
          },
          error: null,
        };
      });

      // Mock getSession
      vi.spyOn(supabase.auth, 'getSession').mockImplementation(async () => {
        return {
          data: { session: mockSession as any },
          error: null,
        };
      });

      // Mock Supabase from('user_roles')
      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'user_roles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({
                  data: [{ id: 'rol_1', role: 'DEVADMIN', assigned_at: '2026-10-31T00:00:00Z', revoked_at: null }],
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        if (table === 'users') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: mockUserId, username: 'admin', account_status: 'ACTIVE' },
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const res = await SupabaseAuthService.login('admin', 'SecurePass123!');
      expect(res.success).toBe(true);
      expect(res.role).toBe('DEVADMIN');
      expect(res.isOffline).toBe(false);

      expect(SupabaseAuthService.isCloudAuthenticated.value).toBe(true);
      expect(SupabaseAuthService.user.value?.id).toBe(mockUserId);
      expect(SupabaseAuthService.role.value).toBe('DEVADMIN');

      const isValidSession = await SupabaseAuthService.hasValidCloudSession();
      expect(isValidSession).toBe(true);

      const token = await SupabaseAuthService.getAccessToken();
      expect(token).toBe('mock_valid_jwt_token_header.payload.signature');
    });

    it('resolves username "devadmin" to Supabase Auth email and authenticates', async () => {
      const mockUserId = '11111111-2222-3333-4444-555555555555';
      const mockSession = {
        access_token: 'mock_jwt_devadmin',
        refresh_token: 'mock_refresh_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: mockUserId, email: 'admin@unitap.com' },
      };

      vi.spyOn(supabase, 'rpc').mockImplementation(async (fn: string, params: any) => {
        if (fn === 'resolve_login_email' && params?.p_identifier === 'admin') {
          return { data: 'admin@unitap.com', error: null } as any;
        }
        return { data: null, error: null } as any;
      });

      vi.spyOn(supabase.auth, 'signInWithPassword').mockImplementation(async (creds: any) => {
        if (creds.email === 'admin@unitap.com') {
          return {
            data: { user: mockSession.user as any, session: mockSession as any },
            error: null,
          };
        }
        return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } as any };
      });

      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: mockSession as any },
        error: null,
      });

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'user_roles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({
                  data: [{ id: 'rol_1', role: 'DEVADMIN', assigned_at: '2026-10-31T00:00:00Z', revoked_at: null }],
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        if (table === 'users') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: mockUserId, username: 'admin', account_status: 'ACTIVE' },
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const res = await SupabaseAuthService.login('devadmin', 'SecurePass123!');
      expect(res.success).toBe(true);
      expect(res.role).toBe('DEVADMIN');
    });
  });

  describe('2. Invalid Credentials & Direct Mode Guarding', () => {
    it('fails when credentials are wrong and NEVER falls back to SQLite in Direct Mode', async () => {
      // Setup local SQLite devadmin account
      await authService.setupInitialDevAdmin('LocalPass123!');

      // Mock Supabase auth rejection
      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' } as any,
      });

      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const res = await SupabaseAuthService.login('devadmin', 'LocalPass123!');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Invalid login credentials|Invalid credentials/i);

      // Cloud state remains unauthenticated
      expect(SupabaseAuthService.isCloudAuthenticated.value).toBe(false);
      expect(SupabaseAuthService.user.value).toBeNull();
    });
  });

  describe('3. Missing Cloud Session & System Setup Enforcement', () => {
    it('detects missing cloud session and rejects System Setup mutations with informative error', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const hasCloud = await SupabaseAuthService.hasValidCloudSession();
      expect(hasCloud).toBe(false);

      // verifyDevAdmin in Direct Supabase Mode must throw unauthorized
      await expect(SystemSetupService.verifyDevAdmin()).rejects.toThrow(
        /Direct Supabase Mode requires an authenticated Supabase Auth DevAdmin session/i
      );
    });
  });

  describe('4. Expired Cloud Session Detection', () => {
    it('detects expired session timestamps and flags session as invalid', async () => {
      const expiredSession = {
        access_token: 'expired_jwt_token',
        refresh_token: 'mock_refresh',
        expires_at: Math.floor(Date.now() / 1000) - 300, // 5 minutes in the past
        user: { id: 'usr_expired_01', email: 'admin@unitap.com' },
      };

      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: expiredSession as any },
        error: null,
      });

      const isValid = await SupabaseAuthService.hasValidCloudSession();
      expect(isValid).toBe(false);
    });
  });

  describe('5. Application Restart & Session Restoration', () => {
    it('restores Supabase session on startup in Direct Mode when valid session exists', async () => {
      const mockUserId = '11111111-2222-3333-4444-555555555555';
      const mockSession = {
        access_token: 'restored_token_123',
        refresh_token: 'mock_refresh',
        expires_at: Math.floor(Date.now() / 1000) + 7200,
        user: { id: mockUserId, email: 'admin@unitap.com' },
      };

      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: mockSession as any },
        error: null,
      });

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'user_roles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({
                  data: [{ id: 'rol_1', role: 'DEVADMIN', assigned_at: '2026-10-31T00:00:00Z', revoked_at: null }],
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        if (table === 'users') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: mockUserId, username: 'admin', account_status: 'ACTIVE' },
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      await SupabaseAuthService.initialize();

      expect(SupabaseAuthService.isCloudAuthenticated.value).toBe(true);
      expect(SupabaseAuthService.user.value?.id).toBe(mockUserId);
      expect(SupabaseAuthService.role.value).toBe('DEVADMIN');
    });

    it('clears state on startup in Direct Mode when no live session exists', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: null },
        error: null,
      });

      await SupabaseAuthService.initialize();

      expect(SupabaseAuthService.isCloudAuthenticated.value).toBe(false);
      expect(SupabaseAuthService.user.value).toBeNull();
      expect(SupabaseAuthService.role.value).toBeNull();
    });
  });

  describe('6. Offline-First Mode Preservation', () => {
    it('preserves local SQLite authentication when in Offline-First Mode', async () => {
      DataModeService.setMode('offline_first');

      // Create local SQLite user account
      const user = await authService.setupInitialDevAdmin('OfflineSecret123!');
      expect(user.username).toBe('devadmin');

      // Supabase is unreachable/offline
      vi.spyOn(supabase.auth, 'signInWithPassword').mockRejectedValue(new Error('Failed to fetch'));
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: null }, error: null });

      const localRes = await authService.login('devadmin', 'OfflineSecret123!');
      expect(localRes.success).toBe(true);
      expect(localRes.role).toBe('DEVADMIN');
      expect(authService.role.value).toBe('DEVADMIN');
    });
  });

  describe('7. Unauthenticated Query Protection & Startup Barrier', () => {
    it('prevents protected PostgREST queries when unauthenticated in Direct Mode', async () => {
      DataModeService.setMode('supabase_direct');
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const fromSpy = vi.spyOn(supabase, 'from');

      // Attempt to query active semester while unauthenticated in Direct Mode
      const activeSem = await AcademicRepository.getActiveSemester();

      // Must return null without sending an unauthenticated request to Supabase PostgREST
      expect(activeSem).toBeNull();
      expect(fromSpy).not.toHaveBeenCalledWith('semesters');

      // Attempt to query programs while unauthenticated in Direct Mode
      const programs = await AcademicRepository.getPrograms();
      expect(programs).toEqual([]);
      expect(fromSpy).not.toHaveBeenCalledWith('programs');
    });

    it('queries local SQLite adapter when adapter is explicitly provided', async () => {
      DataModeService.setMode('supabase_direct');
      const db = await getDatabase();
      await AcademicRepository.createYear({
        id: 'ay_test_local',
        label: '2026-2027',
        starts_on: '2026-08-01',
        ends_on: '2027-05-31',
        status: 'ACTIVE',
      }, db);
      await AcademicRepository.createSemester({
        id: 'sem_test_local',
        academic_year_id: 'ay_test_local',
        term: 'FIRST',
        starts_on: '2026-08-01',
        ends_on: '2026-12-31',
        status: 'ACTIVE',
      }, db);

      const fromSpy = vi.spyOn(supabase, 'from');

      // Pass local db adapter explicitly
      const activeSem = await AcademicRepository.getActiveSemester(db);

      // Must query SQLite adapter, NOT Supabase
      expect(fromSpy).not.toHaveBeenCalledWith('semesters');
      expect(activeSem).not.toBeNull();
      expect(activeSem?.id).toBe('sem_test_local');
      expect(activeSem?.status).toBe('ACTIVE');
    });

    it('queries Supabase when authenticated cloud session is restored', async () => {
      DataModeService.setMode('supabase_direct');
      const mockSession = {
        access_token: 'valid_jwt_header.payload.signature',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'admin-uuid', email: 'admin@unitap.com' },
      };

      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: mockSession as any },
        error: null,
      });

      // Mock user_roles and users for DEVADMIN
      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'user_roles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({
                  data: [{ id: 'rol_1', role: 'DEVADMIN', assigned_at: '2026-10-31T00:00:00Z', revoked_at: null }],
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        if (table === 'users') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'admin-uuid', username: 'admin', account_status: 'ACTIVE' },
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        if (table === 'semesters') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'sem_remote_1',
                      academic_year_id: 'ay_remote_1',
                      term: 'FIRST',
                      starts_on: '2026-08-01',
                      ends_on: '2026-12-31',
                      status: 'ACTIVE',
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      await SupabaseAuthService.initialize();
      expect(SupabaseAuthService.isCloudAuthenticated.value).toBe(true);

      const activeSem = await AcademicRepository.getActiveSemester();
      expect(activeSem).not.toBeNull();
      expect(activeSem?.id).toBe('sem_remote_1');
    });
  });
});
