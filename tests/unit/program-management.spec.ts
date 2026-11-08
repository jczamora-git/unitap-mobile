import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDatabaseForTests } from '@/database/database';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { SystemSetupService } from '@/services/system-setup.service';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { DataModeService } from '@/services/data-mode.service';
import { supabase } from '@/integrations/supabase/client';

describe('UniTap 2.0 Program Management (System Setup)', () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
    DataModeService.setMode('offline_first');

    // Mock active DevAdmin session by default for authorized mutations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (authService as any).currentRole.value = { role: 'DEVADMIN' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (authService as any).currentUser.value = {
      id: 'usr_devadmin_test',
      username: 'devadmin',
      account_status: 'ACTIVE',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (SupabaseAuthService as any).currentRole.value = 'DEVADMIN';
  });

  afterEach(() => {
    DataModeService.setMode('offline_first');
    vi.restoreAllMocks();
  });

  describe('1. CRUD & Validation', () => {
    it('creates a new degree program with uppercase code and ACTIVE status', async () => {
      const prog = await SystemSetupService.createProgram({
        code: 'bsit',
        name: 'Bachelor of Science in Information Technology',
      });

      expect(prog).toBeDefined();
      expect(prog.id).toBeDefined();
      expect(prog.code).toBe('BSIT');
      expect(prog.name).toBe('Bachelor of Science in Information Technology');
      expect(prog.status).toBe('ACTIVE');
      expect(prog.is_active).toBe(1);

      // Verify retrieval by ID and by code
      const retrievedById = await AcademicRepository.getProgramById(prog.id);
      expect(retrievedById).toBeDefined();
      expect(retrievedById?.code).toBe('BSIT');

      const retrievedByCode = await AcademicRepository.getProgramByCode('bsit');
      expect(retrievedByCode).toBeDefined();
      expect(retrievedByCode?.id).toBe(prog.id);
    });

    it('rejects creation when code or name is blank', async () => {
      await expect(
        SystemSetupService.createProgram({
          code: '   ',
          name: 'Computer Science',
        })
      ).rejects.toThrow(/code is required/i);

      await expect(
        SystemSetupService.createProgram({
          code: 'BSCS',
          name: '   ',
        })
      ).rejects.toThrow(/name is required/i);
    });

    it('prevents creating duplicate program codes (case-insensitive)', async () => {
      await SystemSetupService.createProgram({
        code: 'BSCS',
        name: 'Bachelor of Science in Computer Science',
      });

      await expect(
        SystemSetupService.createProgram({
          code: 'bscs',
          name: 'Another Computer Science Degree',
        })
      ).rejects.toThrow(/already exists/i);
    });

    it('updates program name, code, and status', async () => {
      const prog = await SystemSetupService.createProgram({
        code: 'ACT',
        name: 'Associate in Computer Tech',
      });

      const updated = await SystemSetupService.updateProgram(prog.id, {
        code: 'ACT-NW',
        name: 'Associate in Computer Technology (Network Track)',
        status: 'ACTIVE',
      });

      expect(updated.code).toBe('ACT-NW');
      expect(updated.name).toBe('Associate in Computer Technology (Network Track)');

      const fetched = await AcademicRepository.getProgramById(prog.id);
      expect(fetched?.code).toBe('ACT-NW');
      expect(fetched?.name).toBe('Associate in Computer Technology (Network Track)');
    });

    it('prevents updating code to an existing program code collision', async () => {
      await SystemSetupService.createProgram({
        code: 'BSIS',
        name: 'Bachelor of Science in Information Systems',
      });
      const prog2 = await SystemSetupService.createProgram({
        code: 'BSEMC',
        name: 'Bachelor of Science in Entertainment and Multimedia Computing',
      });

      await expect(
        SystemSetupService.updateProgram(prog2.id, {
          code: 'bsis',
        })
      ).rejects.toThrow(/already exists/i);
    });

    it('toggles program status and respects includeInactive filter', async () => {
      const prog = await SystemSetupService.createProgram({
        code: 'MIT',
        name: 'Master in Information Technology',
      });
      expect(prog.status).toBe('ACTIVE');

      // Toggle to INACTIVE
      const toggled = await SystemSetupService.toggleProgramStatus(prog.id);
      expect(toggled.status).toBe('INACTIVE');
      expect(toggled.is_active).toBe(0);

      // Default getPrograms() hides inactive
      const activeList = await AcademicRepository.getPrograms(false);
      expect(activeList.find((p) => p.id === prog.id)).toBeUndefined();

      // includeInactive = true includes it
      const allList = await AcademicRepository.getPrograms(true);
      expect(allList.find((p) => p.id === prog.id)).toBeDefined();

      // Toggle back to ACTIVE
      const reActivated = await SystemSetupService.toggleProgramStatus(prog.id);
      expect(reActivated.status).toBe('ACTIVE');
      expect(reActivated.is_active).toBe(1);

      const reActiveList = await AcademicRepository.getPrograms(false);
      expect(reActiveList.find((p) => p.id === prog.id)).toBeDefined();
    });
  });

  describe('2. Foreign Key & Dependency Protection', () => {
    it('prevents deleting a program that has assigned sections', async () => {
      const prog = await SystemSetupService.createProgram({
        code: 'BSIT',
        name: 'Bachelor of Science in Information Technology',
      });

      // Retrieve existing seeded year level
      const yls = await AcademicRepository.getYearLevels();
      const ylId = yls[0]?.id || 'yl_1';

      await SystemSetupService.createSection({
        sectionName: '1A',
        yearLevelId: ylId,
        programId: prog.id,
      });

      const sectionCount = await SystemSetupService.getProgramSectionCount(prog.id);
      expect(sectionCount).toBe(1);

      await expect(SystemSetupService.deleteProgram(prog.id)).rejects.toThrow(
        /assigned to 1 section/i
      );
    });

    it('prevents deleting a program that has student enrollments', async () => {
      const prog = await SystemSetupService.createProgram({
        code: 'BSCS',
        name: 'Bachelor of Science in Computer Science',
      });

      // Insert academic context and student enrollment
      await AcademicRepository.createYear({
        id: 'ay_prog_test',
        label: '2026-2027',
        starts_on: '2026-08-01',
        ends_on: '2027-05-31',
        status: 'ACTIVE',
      });
      await AcademicRepository.createSemester({
        id: 'sem_prog_test',
        academic_year_id: 'ay_prog_test',
        term: 'FIRST',
        starts_on: '2026-08-01',
        ends_on: '2026-12-31',
        status: 'ACTIVE',
      });

      const { getDatabase } = await import('@/database/database');
      const db = await getDatabase();
      await db.execute(
        `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
         VALUES ('stu_prog_01', '2026-0001', 'Juan', 'Dela Cruz', 'ACTIVE', '2026-10-31T00:00:00Z', '2026-10-31T00:00:00Z')`
      );

      await AcademicRepository.createEnrollment({
        id: 'enr_prog_01',
        student_id: 'stu_prog_01',
        semester_id: 'sem_prog_test',
        program_id: prog.id,
        year_level: 1,
        section: '1A',
        enrollment_status: 'ENROLLED',
        first_name_snapshot: 'Juan',
        last_name_snapshot: 'Dela Cruz',
        updated_at: '2026-10-31T00:00:00Z',
      });

      const enrollmentCount = await SystemSetupService.getProgramEnrollmentCount(prog.id);
      expect(enrollmentCount).toBe(1);

      await expect(SystemSetupService.deleteProgram(prog.id)).rejects.toThrow(
        /has 1 student enrollment/i
      );
    });

    it('successfully deletes a program when no sections or enrollments exist', async () => {
      const prog = await SystemSetupService.createProgram({
        code: 'TEMP',
        name: 'Temporary Program',
      });

      await SystemSetupService.deleteProgram(prog.id);

      const deleted = await AcademicRepository.getProgramById(prog.id);
      expect(deleted).toBeNull();
    });
  });

  describe('3. DevAdmin Authorization Enforcement', () => {
    it('blocks non-DevAdmin accounts from creating, updating, toggling, or deleting programs', async () => {
      // Switch session to OFFICER role
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (authService as any).currentRole.value = { role: 'OFFICER' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (SupabaseAuthService as any).currentRole.value = 'OFFICER';

      await expect(
        SystemSetupService.createProgram({
          code: 'UNAUTH',
          name: 'Unauthorized Degree',
        })
      ).rejects.toThrow(/Unauthorized/i);

      await expect(
        SystemSetupService.updateProgram('any_id', { name: 'Test' })
      ).rejects.toThrow(/Unauthorized/i);

      await expect(
        SystemSetupService.toggleProgramStatus('any_id')
      ).rejects.toThrow(/Unauthorized/i);

      await expect(
        SystemSetupService.deleteProgram('any_id')
      ).rejects.toThrow(/Unauthorized/i);
    });
  });

  describe('4. Direct Supabase Mode Support', () => {
    it('routes queries and mutations to Supabase when Direct Supabase Mode is enabled', async () => {
      DataModeService.setMode('supabase_direct');
      (SupabaseAuthService as any).currentUser.value = {
        id: 'devadmin-uuid',
        username: 'admin',
        account_status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      (SupabaseAuthService as any).currentRole.value = 'DEVADMIN';
      (SupabaseAuthService as any).isOfflineMode.value = false;
      (SupabaseAuthService as any).isInitialized.value = true;

      const mockPrograms = [
        { id: 'prog_sb_1', code: 'BSIT', name: 'BS Information Tech', status: 'ACTIVE', created_at: '2026-10-01T00:00:00Z' },
        { id: 'prog_sb_2', code: 'BSCS', name: 'BS Computer Science', status: 'INACTIVE', created_at: '2026-10-01T00:00:00Z' },
      ];

      // Mock supabase.from('programs')
      const selectMock = vi.fn().mockReturnValue({
        order: vi.fn().mockImplementation(() => {
          return Promise.resolve({ data: mockPrograms, error: null });
        }),
      });

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'programs') {
          return {
            select: selectMock,
          } as any;
        }
        return {} as any;
      });

      const list = await AcademicRepository.getPrograms(true);
      expect(list).toHaveLength(2);
      expect(list[0].code).toBe('BSIT');
      expect(list[0].status).toBe('ACTIVE');
      expect(list[1].code).toBe('BSCS');
      expect(list[1].status).toBe('INACTIVE');
    });
  });
});
