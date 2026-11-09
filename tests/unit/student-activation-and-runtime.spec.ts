import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { StudentActivationService } from '@/services/student-activation.service';
import { AuthRepository } from '@/database/repositories/auth.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { AccountLinkingService } from '@/integrations/supabase/account-linking.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { DataModeService } from '@/services/data-mode.service';
import { supabase } from '@/integrations/supabase/client';

describe('UniTap 2.0 Student Activation & Android Runtime Consistency Suite', () => {
  const studentId = '00000000-0000-0000-0000-000000000001';
  const schoolId = 'MCC2026-0256';
  const officerUserId = '00000000-0000-0000-0000-000000000099';

  beforeEach(async () => {
    vi.restoreAllMocks();
    DataModeService.setMode('offline_first');
    await resetDatabaseForTests();

    await AcademicRepository.createYear({
      id: 'ay_test_1',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });
    await AcademicRepository.createSemester({
      id: 'sem_test_1',
      academic_year_id: 'ay_test_1',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    await StudentsRepository.createStudent({
      id: studentId,
      school_id: schoolId,
      first_name: 'Juan',
      last_name: 'Luna',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  afterEach(() => {
    DataModeService.setMode('offline_first');
  });

  describe('Issue 1: Idempotent Student Activation & Duplicate Username (23505) Handling', () => {
    it('1. Existing correctly linked account activation is idempotent', async () => {
      DataModeService.setMode('supabase_direct');

      // Mock Supabase RPC returning idempotent already_linked success
      vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: {
          success: true,
          already_linked: true,
          student_id: studentId,
          school_id: schoolId,
          first_name: 'Juan',
          last_name: 'Luna',
        },
        error: null,
      } as any);

      const result = await AccountLinkingService.activateAndLinkStudentAccount(
        schoolId,
        'ABCDEF23',
        'auth_user_123'
      );

      expect(result.success).toBe(true);
      expect(result.alreadyLinked).toBe(true);
      expect(result.studentId).toBe(studentId);
    });

    it('2. Conflicting username belonging to another account returns clear error without crashing', async () => {
      DataModeService.setMode('supabase_direct');

      // Simulate PostgreSQL unique constraint 23505 error on users_username_key
      vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: null,
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "users_username_key"',
          details: 'Key (username)=(mcc2026-0256) already exists.',
        },
      } as any);

      const result = await AccountLinkingService.activateAndLinkStudentAccount(
        schoolId,
        'ABCDEF23',
        'auth_user_new'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
      expect(result.error).toContain('Please log in or contact an officer');
    });

    it('3. Auth account creation success does not falsely imply activation success', async () => {
      DataModeService.setMode('supabase_direct');

      // Supabase Auth signUp succeeds
      vi.spyOn(supabase.auth, 'signUp').mockResolvedValueOnce({
        data: { user: { id: 'auth_user_created', email: 'test@student.edu' } },
        error: null,
      } as any);

      // But AccountLinking RPC fails with duplicate account error
      vi.spyOn(AccountLinkingService, 'activateAndLinkStudentAccount').mockResolvedValueOnce({
        success: false,
        error: 'An account with School ID MCC2026-0256 already exists. Please sign in or contact an officer.',
      });

      const handleOnlineSessionSpy = vi.spyOn(SupabaseAuthService as any, 'handleOnlineSession');

      const result = await SupabaseAuthService.registerStudent(
        schoolId,
        'ABCDEF23',
        'test@student.edu',
        'Password123!'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
      // Must not establish local session when activation RPC fails
      expect(handleOnlineSessionSpy).not.toHaveBeenCalled();
    });

    it('4. Reusing existing active session prevents duplicate signUp calls on retry', async () => {
      DataModeService.setMode('supabase_direct');

      // Existing session matches caller email
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValueOnce({
        data: {
          session: {
            user: { id: 'existing_user_id', email: 'test@student.edu' },
          },
        },
        error: null,
      } as any);

      const signUpSpy = vi.spyOn(supabase.auth, 'signUp');
      vi.spyOn(AccountLinkingService, 'activateAndLinkStudentAccount').mockResolvedValueOnce({
        success: true,
        studentId,
      });
      vi.spyOn(SupabaseAuthService as any, 'handleOnlineSession').mockResolvedValueOnce('STUDENT');

      const result = await SupabaseAuthService.registerStudent(
        schoolId,
        'ABCDEF23',
        'test@student.edu',
        'Password123!'
      );

      expect(result.success).toBe(true);
      expect(signUpSpy).not.toHaveBeenCalled();
    });
  });

  describe('Issue 2: Android Officer Activation Code & Foreign Key Resilience', () => {
    it('5. Officer activation code issuance works in Direct Supabase Mode without local SQLite writes', async () => {
      DataModeService.setMode('supabase_direct');
      expect(DataModeService.isDirectSupabase()).toBe(true);

      const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: {
          success: true,
          claim_id: 'act_remote_123',
          expires_at: '2026-11-12T00:00:00Z',
          action: 'ISSUED',
        },
        error: null,
      } as any);

      const createClaimSpy = vi.spyOn(AuthRepository, 'createActivationClaim');

      const result = await StudentActivationService.issueActivationCode(
        studentId,
        officerUserId,
        48
      );

      expect(result.success).toBe(true);
      expect(result.claimId).toBe('act_remote_123');
      expect(rpcSpy).toHaveBeenCalled();
      // Must NOT attempt local SQLite persistLocalClaim in Direct Supabase Mode
      expect(createClaimSpy).not.toHaveBeenCalled();
    });

    it('6. Direct Supabase Mode never falls back to SQLite on server RPC failure', async () => {
      DataModeService.setMode('supabase_direct');

      vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: null,
        error: { message: 'Network timeout connecting to server' },
      } as any);

      const createClaimSpy = vi.spyOn(AuthRepository, 'createActivationClaim');

      const result = await StudentActivationService.issueActivationCode(
        studentId,
        officerUserId,
        48
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network timeout');
      expect(createClaimSpy).not.toHaveBeenCalled();
    });

    it('7. Offline-First Mode satisfies SQLite foreign keys before inserting activation_claim', async () => {
      DataModeService.setMode('offline_first');

      // The officer user does NOT yet exist in SQLite users table
      const nonExistentOfficerId = '00000000-0000-0000-0000-000000000787';

      // Calling issueActivationCode in offline-first mode
      const result = await StudentActivationService.issueActivationCode(
        studentId,
        nonExistentOfficerId,
        48
      );

      expect(result.success).toBe(true);
      expect(result.claimId).toBeDefined();

      // Verify claim was created in SQLite without foreign key violation
      const claim = await AuthRepository.getLatestActivationClaimByStudentId(studentId);
      expect(claim).not.toBeNull();
      expect(claim?.student_id).toBe(studentId);
      expect(claim?.issued_by_user_id).toBe(nonExistentOfficerId);
    });

    it('8. Officer code revocation in Direct Supabase Mode skips local SQLite operations', async () => {
      DataModeService.setMode('supabase_direct');

      vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: { success: true },
        error: null,
      } as any);

      const revokeSpy = vi.spyOn(AuthRepository, 'revokeActivationClaim');

      const result = await StudentActivationService.revokeActivationCode(
        'act_remote_123',
        studentId,
        officerUserId,
        'Officer canceled'
      );

      expect(result.success).toBe(true);
      expect(revokeSpy).not.toHaveBeenCalled();
    });
  });

  describe('Issue 3: Android Runtime Data Mode & Environment Consistency', () => {
    it('9. Direct Supabase Mode is cleanly distinguishable and respected', () => {
      DataModeService.setMode('supabase_direct');
      expect(DataModeService.isDirectSupabase()).toBe(true);
      expect(DataModeService.isOfflineFirst()).toBe(false);
      expect(DataModeService.getModeLabel()).toBe('Direct Supabase Mode');

      DataModeService.setMode('offline_first');
      expect(DataModeService.isDirectSupabase()).toBe(false);
      expect(DataModeService.isOfflineFirst()).toBe(true);
      expect(DataModeService.getModeLabel()).toBe('Offline-First SQLite Mode');
    });
  });
});
