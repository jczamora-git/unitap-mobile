import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests } from '@/database/database';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { SystemSetupService } from '@/services/system-setup.service';
import { CsvImportService } from '@/services/csv-import.service';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';

describe('UniTap 2.0 DevAdmin-Only System Setup & Academic Structure', () => {
  beforeEach(async () => {
    await resetDatabaseForTests();

    // Mock active DevAdmin session by default for testing authorized mutations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (authService as any).currentRole.value = { role: 'DEVADMIN' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (authService as any).currentUser.value = {
      id: 'usr_devadmin_01',
      username: 'devadmin',
      account_status: 'ACTIVE',
    };
  });

  describe('1. Event Category Management', () => {
    it('creates a new event category and prevents case-insensitive duplicates', async () => {
      const cat = await SystemSetupService.createEventCategory({
        name: 'Annual Hackathon',
        description: '24-hour coding competition',
        code: 'HACKATHON',
        sortOrder: 10,
      });

      expect(cat).toBeDefined();
      expect(cat.name).toBe('Annual Hackathon');
      expect(cat.code).toBe('HACKATHON');
      expect(cat.status).toBe('ACTIVE');

      // Attempt duplicate creation with different casing
      await expect(
        SystemSetupService.createEventCategory({
          name: 'annual hackathon',
          code: 'HACKATHON_2',
        })
      ).rejects.toThrow(/already exists/i);
    });

    it('updates, activates, and deactivates event categories', async () => {
      const cat = await SystemSetupService.createEventCategory({
        name: 'Campus Esports',
        code: 'ESPORTS',
      });

      const updated = await SystemSetupService.updateEventCategory(cat.id, {
        description: 'Competitive collegiate gaming',
      });
      expect(updated.description).toBe('Competitive collegiate gaming');

      // Toggle to INACTIVE
      const toggled = await SystemSetupService.toggleCategoryStatus(cat.id);
      expect(toggled.status).toBe('INACTIVE');

      // Only active categories returned by default filter
      const activeList = await AcademicRepository.getEventCategories(false);
      expect(activeList.find((c) => c.id === cat.id)).toBeUndefined();

      // All categories returned with includeInactive = true
      const allList = await AcademicRepository.getEventCategories(true);
      expect(allList.find((c) => c.id === cat.id)).toBeDefined();
    });

    it('prevents deleting categories that are referenced by existing events', async () => {
      const cat = await SystemSetupService.createEventCategory({
        name: 'CSG Leadership Camp',
        code: 'LEAD_CAMP',
      });

      // Ensure valid parent academic year and semester exist for the event
      await AcademicRepository.createYear({
        id: 'ay_camp',
        label: '2026-2027',
        starts_on: '2026-08-01',
        ends_on: '2027-05-31',
        status: 'ACTIVE',
      });
      await AcademicRepository.createSemester({
        id: 'sem_camp',
        academic_year_id: 'ay_camp',
        term: 'FIRST',
        starts_on: '2026-08-01',
        ends_on: '2026-12-15',
        status: 'ACTIVE',
      });

      const { getDatabase } = await import('@/database/database');
      const db = await getDatabase();
      await db.execute(
        `INSERT INTO events (id, semester_id, title, event_type, category_id, audience_type, audience_json, attendance_required, status, created_at, updated_at)
         VALUES ('evt_camp_01', 'sem_camp', '2026 Leadership Camp', 'CSG Leadership Camp', ?, 'ALL', '{}', 1, 'ACTIVE', '2026-10-31T00:00:00Z', '2026-10-31T00:00:00Z')`,
        [cat.id]
      );

      const usage = await SystemSetupService.getCategoryUsageCount(cat.id);
      expect(usage).toBe(1);

      // Delete should be rejected
      await expect(SystemSetupService.deleteCategory(cat.id)).rejects.toThrow(/referenced by/i);
    });
  });

  describe('2. Year Levels & Sections (1-to-Many Relationship)', () => {
    it('verifies seeded year levels 1st to 4th year and allows creating higher tiers', async () => {
      const yearLevels = await SystemSetupService.getYearLevels();
      expect(yearLevels.length).toBeGreaterThanOrEqual(4);

      const yl1 = yearLevels.find((y) => y.level_number === 1);
      expect(yl1?.display_name).toBe('1st Year');

      // Create 5th Year level
      const yl5 = await SystemSetupService.createYearLevel({
        levelNumber: 5,
        displayName: '5th Year (Masteral / Dual-Degree)',
        sortOrder: 5,
      });
      expect(yl5.level_number).toBe(5);
      expect(yl5.display_name).toContain('5th Year');

      // Duplicate level number rejected
      await expect(
        SystemSetupService.createYearLevel({
          levelNumber: 5,
          displayName: 'Duplicate 5th Year',
        })
      ).rejects.toThrow(/already exists/i);
    });

    it('allows 1 Year Level to have many sections and scopes uniqueness', async () => {
      const yl4 = (await SystemSetupService.getYearLevels()).find((y) => y.level_number === 4);
      expect(yl4).toBeDefined();

      // Create distinct sections for 4th Year
      const sec4F10 = await SystemSetupService.createSection({
        sectionName: '4F10',
        yearLevelId: yl4!.id,
      });
      const sec4F11 = await SystemSetupService.createSection({
        sectionName: '4F11',
        yearLevelId: yl4!.id,
      });

      expect(sec4F10.section_name).toBe('4F10');
      expect(sec4F11.section_name).toBe('4F11');
      expect(sec4F10.year_level_id).toBe(yl4!.id);

      // Duplicate section name within same scope is rejected
      await expect(
        SystemSetupService.createSection({
          sectionName: '4F10',
          yearLevelId: yl4!.id,
        })
      ).rejects.toThrow(/already exists/i);

      // Filtering by yearLevelId returns only matching sections
      const sectionsInYl4 = await SystemSetupService.getSections({ yearLevelId: yl4!.id });
      expect(sectionsInYl4.some((s) => s.section_name === '4F10')).toBe(true);
      expect(sectionsInYl4.some((s) => s.section_name === '4F11')).toBe(true);
    });
  });

  describe('3. Academic Year & Semester Lifecycle Management', () => {
    it('creates academic year and enforces date span ordering', async () => {
      const ay = await SystemSetupService.createAcademicYear({
        label: '2027-2028',
        startsOn: '2027-08-01',
        endsOn: '2028-05-31',
        status: 'PLANNED',
      });

      expect(ay.label).toBe('2027-2028');

      // Reject start date >= end date
      await expect(
        SystemSetupService.createAcademicYear({
          label: '2028-2029',
          startsOn: '2028-09-01',
          endsOn: '2028-08-01',
        })
      ).rejects.toThrow(/start date must precede end date/i);

      // Reject duplicate academic year label
      await expect(
        SystemSetupService.createAcademicYear({
          label: '2027-2028',
          startsOn: '2027-08-01',
          endsOn: '2028-05-31',
        })
      ).rejects.toThrow(/already exists/i);
    });

    it('enforces single-active-semester constraint transactionally', async () => {
      const ay = await SystemSetupService.createAcademicYear({
        label: '2029-2030',
        startsOn: '2029-08-01',
        endsOn: '2030-05-31',
        status: 'PLANNED',
      });

      const sem1 = await SystemSetupService.createSemester({
        academicYearId: ay.id,
        term: 'FIRST',
        startsOn: '2029-08-01',
        endsOn: '2029-12-15',
      });

      const sem2 = await SystemSetupService.createSemester({
        academicYearId: ay.id,
        term: 'SECOND',
        startsOn: '2030-01-10',
        endsOn: '2030-05-20',
      });

      // Prevent duplicate FIRST term in same academic year
      await expect(
        SystemSetupService.createSemester({
          academicYearId: ay.id,
          term: 'FIRST',
          startsOn: '2029-08-01',
          endsOn: '2029-12-15',
        })
      ).rejects.toThrow(/already registered/i);

      // Activate sem1
      await SystemSetupService.activateSemester(sem1.id);
      let active = await SystemSetupService.getActiveSemester();
      expect(active?.id).toBe(sem1.id);
      expect(active?.status).toBe('ACTIVE');

      // Activate sem2 -> sem1 must automatically transition to CLOSED
      await SystemSetupService.activateSemester(sem2.id);
      active = await SystemSetupService.getActiveSemester();
      expect(active?.id).toBe(sem2.id);

      const sem1Reloaded = await AcademicRepository.getSemesterById(sem1.id);
      expect(sem1Reloaded?.status).toBe('CLOSED');
    });
  });

  describe('4. Authorization Guard (DevAdmin Only)', () => {
    it('rejects mutations from OFFICER and STUDENT roles', async () => {
      // Mock Officer session
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (authService as any).currentRole.value = { role: 'OFFICER' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (SupabaseAuthService as any).currentRole.value = 'OFFICER';

      await expect(
        SystemSetupService.createEventCategory({
          name: 'Officer Category',
          code: 'OFF_CAT',
        })
      ).rejects.toThrow(/DevAdmin/i);

      await expect(
        SystemSetupService.createSection({
          sectionName: '4F99',
          yearLevelId: 'e1000000-0000-4000-8000-000000000004',
        })
      ).rejects.toThrow(/DevAdmin/i);

      await expect(
        SystemSetupService.createAcademicYear({
          label: '2035-2036',
          startsOn: '2035-08-01',
          endsOn: '2036-05-31',
        })
      ).rejects.toThrow(/DevAdmin/i);
    });
  });

  describe('5. CSV Import & Section Validation Integration', () => {
    it('validates section belongs to the selected year level and rejects unconfigured sections', async () => {
      // Section 1F1 exists under Year 1. Section 4F4 exists under Year 4.
      // A CSV row with Year 1 and Section 4F4 must be rejected because 4F4 belongs to 4th Year!
      const invalidCsv = `school_id,first_name,middle_name,lastname,year,section
0026-9901,Pedro,Penduko,Santos,1,4F4
0026-9902,Ana,,Reyes,1,9Z99`;

      const result = await CsvImportService.parseAndValidate(invalidCsv, 'test.csv');

      expect(result.validRows.length).toBe(0);
      expect(result.invalidRows.length).toBe(2);

      // Row 1: Section 4F4 belongs to a different year level
      expect(result.invalidRows[0].error).toMatch(/different year level/i);

      // Row 2: Section 9Z99 is not configured anywhere
      expect(result.invalidRows[1].error).toMatch(/not configured/i);
    });
  });
});
