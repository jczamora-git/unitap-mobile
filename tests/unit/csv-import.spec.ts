import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { supabase } from '@/integrations/supabase/client';
import { CsvImportService } from '@/services/csv-import.service';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { ImportsRepository } from '@/database/repositories/imports.repository';

describe('UniTap 2.0 CSV Student Roster Import', () => {
  const semesterId = 'sem_csv_test';
  const programId = 'prog_bsit';

  beforeEach(async () => {
    const db = await resetDatabaseForTests();

    await AcademicRepository.createYear({
      id: 'ay_csv',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });

    await AcademicRepository.createSemester({
      id: semesterId,
      academic_year_id: 'ay_csv',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    await AcademicRepository.upsertProgram({
      id: programId,
      code: 'BSIT',
      name: 'Information Technology',
      is_active: 1,
    });

    await db.execute(
      `INSERT INTO users (id, username, account_status, created_at, updated_at)
       VALUES ('officer_user', 'officer1', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`
    );
  });

  it('validates and imports students from a clean 6-column CSV', async () => {
    const csvContent = `school_id,first_name,middle_name,lastname,year,section
0026-0001,Juan,Protacio,Dela Cruz,1,1F4
0026-0002,Maria,Clara,Santos,2,2F4
0026-0003,Emilio,,Aguinaldo,3,3F4`;

    const parseResult = await CsvImportService.parseAndValidate(
      csvContent,
      'students.csv',
      semesterId,
      programId
    );

    expect(parseResult.totalRows).toBe(3);
    expect(parseResult.validRows.length).toBe(3);
    expect(parseResult.invalidRows.length).toBe(0);

    const importRes = await CsvImportService.executeImport(
      parseResult,
      semesterId,
      programId,
      'officer_user'
    );

    expect(importRes.importedCount).toBe(3);
    expect(importRes.rejectedCount).toBe(0);

    // Verify leading zeros in school_id preserved as string
    const student1 = await StudentsRepository.getStudentBySchoolId('0026-0001');
    expect(student1).toBeDefined();
    expect(student1?.school_id).toBe('0026-0001');
    expect(student1?.first_name).toBe('Juan');
    expect(student1?.last_name).toBe('Dela Cruz');

    // Verify batch logged in import_batches
    const batches = await ImportsRepository.getBatchesBySemester(semesterId);
    expect(batches.length).toBe(1);
    expect(batches[0].status).toBe('COMPLETED');
  });

  it('detects duplicate school IDs in CSV file and rejects duplicates', async () => {
    const csvWithDupes = `school_id,first_name,middle_name,lastname,year,section
2026-0001,Juan,,Dela Cruz,1,1F4
2026-0001,Duplicate,,Person,1,1F4`;

    const parseResult = await CsvImportService.parseAndValidate(
      csvWithDupes,
      'dupes.csv',
      semesterId,
      programId
    );

    expect(parseResult.validRows.length).toBe(1);
    expect(parseResult.invalidRows.length).toBe(1);
    expect(parseResult.invalidRows[0].error).toContain('Duplicate school_id');
  });

  it('rejects CSV with missing required headers', async () => {
    const invalidHeaderCsv = `id,name,year
1,Juan,1`;

    await expect(
      CsvImportService.parseAndValidate(invalidHeaderCsv, 'bad_headers.csv', semesterId, programId)
    ).rejects.toThrow('Missing:');
  });

  it('sanitizes formula injection characters (=, +, -, @)', async () => {
    const formulaCsv = `school_id,first_name,middle_name,lastname,year,section
=2026-0010,+Malicious,-Inject,@Section,1,1F4`;

    const parseResult = await CsvImportService.parseAndValidate(
      formulaCsv,
      'formula.csv',
      semesterId,
      programId
    );

    expect(parseResult.validRows.length).toBe(1);
    const row = parseResult.validRows[0].data!;
    expect(row.school_id).toBe('2026-0010');
    expect(row.first_name).toBe('Malicious');
    expect(row.middle_name).toBe('Inject');
    expect(row.lastname).toBe('Section');
  });

  it('enqueues STUDENT and ENROLLMENT operations to sync_outbox when offline', async () => {
    const db = await getDatabase();
    const csvContent = `school_id,first_name,middle_name,lastname,year,section
2026-0050,Andres,,Bonifacio,1,1F4
2026-0051,Apolinario,,Mabini,2,2F4`;

    const parseResult = await CsvImportService.parseAndValidate(
      csvContent,
      'offline_roster.csv',
      semesterId,
      programId
    );

    const importRes = await CsvImportService.executeImport(
      parseResult,
      semesterId,
      programId,
      'officer_user'
    );

    expect(importRes.importedCount).toBe(2);
    expect(importRes.rejectedCount).toBe(0);
    expect(importRes.serverSynced).toBe(false);

    // Verify sync_outbox has records for offline push
    const outboxOps = await db.query<{ entity_type: string; operation: string }>(
      'SELECT entity_type, operation FROM sync_outbox ORDER BY created_at ASC'
    );
    expect(outboxOps.length).toBeGreaterThanOrEqual(4); // At least 2 STUDENT + 2 ENROLLMENT
    const entityTypes = outboxOps.map((o) => o.entity_type);
    expect(entityTypes).toContain('STUDENT');
    expect(entityTypes).toContain('ENROLLMENT');
  });

  it('invokes import_student_roster_batch RPC and mirrors results when online', async () => {
    const csvContent = `school_id,first_name,middle_name,lastname,year,section
2026-0099,Gabriela,,Silang,1,1F4`;

    const parseResult = await CsvImportService.parseAndValidate(
      csvContent,
      'online_roster.csv',
      semesterId,
      programId
    );

    const mockServerStudent = {
      id: '11111111-2222-3333-4444-555555555555',
      school_id: '2026-0099',
      first_name: 'Gabriela',
      middle_name: null,
      last_name: 'Silang',
      year: 1,
      section: '1F4',
      enrollment_id: '99999999-8888-7777-6666-555555555555',
      is_existing: false,
    };

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
      data: {
        success: true,
        batch_id: 'imp_server_123',
        imported_count: 1,
        updated_count: 0,
        rejected_count: 0,
        total_processed: 1,
        students: [mockServerStudent],
        errors: [],
      },
      error: null,
    } as any);

    // Temporarily simulate non-test environment to exercise the RPC call branch
    (globalThis as any).__FORCE_ONLINE_TEST__ = true;
    try {
      const importRes = await CsvImportService.executeImport(
        parseResult,
        semesterId,
        programId,
        'officer_user'
      );

      expect(rpcSpy).toHaveBeenCalledWith(
        'import_student_roster_batch',
        expect.objectContaining({
          p_source_filename: 'online_roster.csv',
          p_semester_id: semesterId,
          p_program_id: programId,
        })
      );

      expect(importRes.importedCount).toBe(1);
      expect(importRes.serverSynced).toBe(true);

      // Verify the student returned by the server was mirrored into local SQLite
      const mirrored = await StudentsRepository.getStudentBySchoolId('2026-0099');
      expect(mirrored).toBeDefined();
      expect(mirrored?.id).toBe(mockServerStudent.id);
      expect(mirrored?.first_name).toBe('Gabriela');
    } finally {
      delete (globalThis as any).__FORCE_ONLINE_TEST__;
      rpcSpy.mockRestore();
    }
  });
});
