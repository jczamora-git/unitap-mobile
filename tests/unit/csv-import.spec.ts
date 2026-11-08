import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { supabase } from '@/integrations/supabase/client';
import { CsvImportService } from '@/services/csv-import.service';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { ImportsRepository } from '@/database/repositories/imports.repository';
import { DataModeService } from '@/services/data-mode.service';

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

  it('rejects import when target semester foreign key is invalid or non-existent', async () => {
    const csvContent = `school_id,first_name,middle_name,lastname,year,section
2026-0100,Jose,,Rizal,1,1F4`;

    // parseAndValidate with invalid semester
    await expect(
      CsvImportService.parseAndValidate(csvContent, 'invalid_sem.csv', 'sem_nonexistent', programId)
    ).rejects.toThrow(/Target semester.*does not exist/i);

    // executeImport with invalid semester
    const validParse = await CsvImportService.parseAndValidate(csvContent, 'valid_sem.csv', semesterId, programId);
    await expect(
      CsvImportService.executeImport(validParse, 'sem_nonexistent', programId, 'officer_user')
    ).rejects.toThrow(/Target semester.*does not exist/i);
  });

  it('rejects import when target program foreign key is invalid or non-existent', async () => {
    const csvContent = `school_id,first_name,middle_name,lastname,year,section
2026-0101,Marcelo,,Del Pilar,1,1F4`;

    // parseAndValidate with invalid program
    await expect(
      CsvImportService.parseAndValidate(csvContent, 'invalid_prog.csv', semesterId, 'prog_nonexistent')
    ).rejects.toThrow(/Program.*does not exist/i);

    // executeImport with invalid program
    const validParse = await CsvImportService.parseAndValidate(csvContent, 'valid_prog.csv', semesterId, programId);
    await expect(
      CsvImportService.executeImport(validParse, semesterId, 'prog_nonexistent', 'officer_user')
    ).rejects.toThrow(/Program.*does not exist/i);
  });

  it('populates valid year_level_id and section_id foreign keys on imported enrollments', async () => {
    const csvContent = `school_id,first_name,middle_name,lastname,year,section
2026-0102,Melchora,,Aquino,1,1F4`;

    const parseResult = await CsvImportService.parseAndValidate(csvContent, 'fk_test.csv', semesterId, programId);
    expect(parseResult.validRows.length).toBe(1);
    expect(parseResult.validRows[0].data?.year_level_id).toBeDefined();
    expect(parseResult.validRows[0].data?.section_id).toBeDefined();

    const importRes = await CsvImportService.executeImport(parseResult, semesterId, programId, 'officer_user');
    expect(importRes.importedCount).toBe(1);

    const student = await StudentsRepository.getStudentBySchoolId('2026-0102');
    expect(student).toBeDefined();

    const enrollment = await AcademicRepository.getStudentEnrollmentInSemester(student!.id, semesterId);
    expect(enrollment).toBeDefined();
    expect(enrollment?.semester_id).toBe(semesterId);
    expect(enrollment?.program_id).toBe(programId);
    expect(enrollment?.year_level_id).toBe(parseResult.validRows[0].data?.year_level_id);
    expect(enrollment?.section_id).toBe(parseResult.validRows[0].data?.section_id);
  });

  describe('Header Compatibility and Normalization', () => {
    it('accepts legacy CSV header using "lastname"', async () => {
      const csv = `school_id,first_name,middle_name,lastname,year,section
MCC2026-0001,Juan,Protacio,Dela Cruz,1,1F4`;

      const result = await CsvImportService.parseAndValidate(csv, 'legacy.csv', semesterId, programId);
      expect(result.validRows.length).toBe(1);
      expect(result.invalidRows.length).toBe(0);
      expect(result.validRows[0].data?.last_name).toBe('Dela Cruz');
      expect(result.validRows[0].data?.lastname).toBe('Dela Cruz');
    });

    it('accepts canonical CSV header using "last_name"', async () => {
      const csv = `school_id,first_name,middle_name,last_name,year,section
MCC2026-0002,Maria,Clara,Santos,1,1F4`;

      const result = await CsvImportService.parseAndValidate(csv, 'canonical.csv', semesterId, programId);
      expect(result.validRows.length).toBe(1);
      expect(result.invalidRows.length).toBe(0);
      expect(result.validRows[0].data?.last_name).toBe('Santos');
      expect(result.validRows[0].data?.lastname).toBe('Santos');
    });

    it('accepts mixed-case headers and trims surrounding spaces', async () => {
      const csv = `  School_ID  ,  FIRST_NAME  , Middle_Name , LAST_NAME  ,  Year ,  SECTION  
MCC2026-0003,Andres,,Bonifacio,1,1F4`;

      const result = await CsvImportService.parseAndValidate(csv, 'mixed_case.csv', semesterId, programId);
      expect(result.validRows.length).toBe(1);
      expect(result.invalidRows.length).toBe(0);
      expect(result.validRows[0].data?.school_id).toBe('MCC2026-0003');
      expect(result.validRows[0].data?.first_name).toBe('Andres');
      expect(result.validRows[0].data?.last_name).toBe('Bonifacio');
    });

    it('rejects CSV missing both "last_name" and "lastname" headers', async () => {
      const csv = `school_id,first_name,middle_name,year,section
MCC2026-0004,Jose,,1,1F4`;

      await expect(
        CsvImportService.parseAndValidate(csv, 'no_last_name.csv', semesterId, programId)
      ).rejects.toThrow(/Invalid CSV headers.*Missing:.*last_name/i);
    });

    it('rejects CSV with ambiguous duplicate last name aliases', async () => {
      const csv = `school_id,first_name,middle_name,lastname,last_name,year,section
MCC2026-0005,Emilio,,Aguinaldo,Famy,1,1F4`;

      await expect(
        CsvImportService.parseAndValidate(csv, 'duplicate_aliases.csv', semesterId, programId)
      ).rejects.toThrow(/Ambiguous CSV headers.*both "last_name" and "lastname"/i);
    });

    it('parses an existing 300-student roster CSV with high performance and zero errors', async () => {
      // Build 300 student rows
      const header = 'school_id,first_name,middle_name,last_name,year,section';
      const rows: string[] = [header];
      for (let i = 1; i <= 300; i++) {
        const idSeq = String(i).padStart(4, '0');
        rows.push(`MCC2026-${idSeq},Student${i},M,Surname${i},1,1F4`);
      }
      const largeCsv = rows.join('\n');

      const result = await CsvImportService.parseAndValidate(largeCsv, '300_students.csv', semesterId, programId);
      expect(result.totalRows).toBe(300);
      expect(result.validRows.length).toBe(300);
      expect(result.invalidRows.length).toBe(0);
      expect(result.validRows[0].data?.last_name).toBe('Surname1');
      expect(result.validRows[299].data?.last_name).toBe('Surname300');
    });
  });

  describe('Real-Time Feedback and Duplicate Submission Protection', () => {
    const csvContent = `school_id,first_name,middle_name,last_name,year,section
MCC2026-0010,Rizal,Mercado,Alonzo,1,1F4
MCC2026-0011,Marcelo,Hilario,Del Pilar,1,1F4`;

    it('prevents concurrent import calls and double-click executions via service mutex', async () => {
      const parseResult = await CsvImportService.parseAndValidate(csvContent, 'concurrent.csv', semesterId, programId);

      // Trigger first import
      const firstImportPromise = CsvImportService.executeImport(parseResult, semesterId, programId, 'officer_user');

      // Attempt second concurrent import immediately with the same or another request
      await expect(
        CsvImportService.executeImport(parseResult, semesterId, programId, 'officer_user')
      ).rejects.toThrow(/An import operation is already in progress/i);

      const firstResult = await firstImportPromise;
      expect(firstResult.importedCount).toBe(2);
      expect(CsvImportService.isImportInProgress()).toBe(false);
    });

    it('returns accurate success counts and batch metadata upon completion', async () => {
      const parseResult = await CsvImportService.parseAndValidate(csvContent, 'metrics.csv', semesterId, programId);

      const result = await CsvImportService.executeImport(parseResult, semesterId, programId, 'officer_user');

      expect(result.batchId).toMatch(/^imp_/);
      expect(result.totalRows).toBe(2);
      expect(result.importedCount).toBe(2);
      expect(result.enrolledCount).toBe(2);
      expect(result.rejectedCount).toBe(0);
      expect(result.completedAt).toBeDefined();
      expect(new Date(result.completedAt).getTime()).not.toBeNaN();
    });

    it('detects existing completed batch by sha256 to prevent duplicate submission after reload', async () => {
      const parseResult = await CsvImportService.parseAndValidate(csvContent, 'duplicate_reload.csv', semesterId, programId);

      // Initially no batch exists
      const beforeBatch = await CsvImportService.findExistingBatch(parseResult.sha256, semesterId);
      expect(beforeBatch).toBeNull();

      // Execute import
      await CsvImportService.executeImport(parseResult, semesterId, programId, 'officer_user');

      // Now persistent detection finds the completed batch
      const existingBatch = await CsvImportService.findExistingBatch(parseResult.sha256, semesterId);
      expect(existingBatch).not.toBeNull();
      expect(existingBatch?.sha256).toBe(parseResult.sha256);
      expect(existingBatch?.semester_id).toBe(semesterId);
      expect(existingBatch?.status).toBe('COMPLETED');

      // Does not block legitimate new imports for a different semester
      const otherSemBatch = await CsvImportService.findExistingBatch(parseResult.sha256, 'sem_another_term');
      expect(otherSemBatch).toBeNull();
    });

    it('releases lock and allows safe retry after a failed import', async () => {
      const parseResult = await CsvImportService.parseAndValidate(csvContent, 'retry.csv', semesterId, programId);

      // Attempt import with an invalid semester foreign key
      await expect(
        CsvImportService.executeImport(parseResult, 'invalid_nonexistent_sem', programId, 'officer_user')
      ).rejects.toThrow(/does not exist in the database/i);

      // Ensure mutex was properly released in finally block
      expect(CsvImportService.isImportInProgress()).toBe(false);

      // Safe retry with valid semester succeeds
      const retryResult = await CsvImportService.executeImport(parseResult, semesterId, programId, 'officer_user');
      expect(retryResult.importedCount).toBe(2);
      expect(CsvImportService.isImportInProgress()).toBe(false);
    });

    it('resets import lock via resetImportLock helper', () => {
      // Force set internal lock if needed
      CsvImportService.resetImportLock();
      expect(CsvImportService.isImportInProgress()).toBe(false);
    });

    it('cancels parseAndValidate immediately when abort signal is triggered', async () => {
      const controller = new AbortController();
      controller.abort(); // already aborted

      await expect(
        CsvImportService.parseAndValidate(csvContent, 'aborted.csv', semesterId, programId, controller.signal)
      ).rejects.toThrow(/cancelled by user/i);
    });

    it('cancels executeImport immediately and releases lock when abort signal is triggered', async () => {
      const parseResult = await CsvImportService.parseAndValidate(csvContent, 'abort_exec.csv', semesterId, programId);
      const controller = new AbortController();
      controller.abort(); // trigger abort

      await expect(
        CsvImportService.executeImport(parseResult, semesterId, programId, 'officer_user', controller.signal)
      ).rejects.toThrow(/cancelled by user/i);

      expect(CsvImportService.isImportInProgress()).toBe(false);
    });

    it('executes import_student_roster_batch RPC in Direct Supabase mode without SQLite FK error', async () => {
      const parseResult = await CsvImportService.parseAndValidate(csvContent, 'direct_import.csv', semesterId, programId);

      DataModeService.setMode('supabase_direct');
      const semSpy = vi.spyOn(AcademicRepository, 'getSemesterById').mockResolvedValueOnce({
        id: semesterId,
        academic_year_id: 'ay_csv',
        term: 'FIRST',
        starts_on: '2026-08-01',
        ends_on: '2026-12-31',
        status: 'ACTIVE',
      });
      const progSpy = vi.spyOn(AcademicRepository, 'getProgramById').mockResolvedValueOnce({
        id: programId,
        code: 'BSIT',
        name: 'Information Technology',
        status: 'ACTIVE',
      });
      const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: {
          success: true,
          batch_id: 'imp_direct_123',
          imported_count: 2,
          updated_count: 0,
          rejected_count: 0,
          enrolled_count: 2,
          skipped_count: 0,
          total_processed: 2,
          students: [
            { id: '11111111-1111-1111-1111-111111111111', school_id: '2026-9001', first_name: 'Juan', last_name: 'Luna' },
            { id: '22222222-2222-2222-2222-222222222222', school_id: '2026-9002', first_name: 'Apolinario', last_name: 'Mabini' },
          ],
          errors: [],
        },
        error: null,
      } as any);

      try {
        // Pass a user ID that does NOT exist in SQLite users table
        const result = await CsvImportService.executeImport(
          parseResult,
          semesterId,
          programId,
          'usr_supabase_cloud_uid'
        );

        expect(rpcSpy).toHaveBeenCalledWith(
          'import_student_roster_batch',
          expect.objectContaining({
            p_source_filename: 'direct_import.csv',
            p_semester_id: semesterId,
            p_program_id: programId,
          })
        );
        expect(result.serverSynced).toBe(true);
        expect(result.importedCount).toBe(2);
        expect(result.enrolledCount).toBe(2);
      } finally {
        DataModeService.setMode('offline_first');
        semSpy.mockRestore();
        progSpy.mockRestore();
        rpcSpy.mockRestore();
      }
    });

    it('propagates RPC error and prevents silent SQLite fallback in Direct Supabase mode', async () => {
      const parseResult = await CsvImportService.parseAndValidate(csvContent, 'unauth_import.csv', semesterId, programId);

      DataModeService.setMode('supabase_direct');
      const semSpy = vi.spyOn(AcademicRepository, 'getSemesterById').mockResolvedValueOnce({
        id: semesterId,
        academic_year_id: 'ay_csv',
        term: 'FIRST',
        starts_on: '2026-08-01',
        ends_on: '2026-12-31',
        status: 'ACTIVE',
      });
      const progSpy = vi.spyOn(AcademicRepository, 'getProgramById').mockResolvedValueOnce({
        id: programId,
        code: 'BSIT',
        name: 'Information Technology',
        status: 'ACTIVE',
      });
      const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: null,
        error: { message: 'Unauthorized: Only officers and devadmins can import student rosters.' },
      } as any);

      try {
        await expect(
          CsvImportService.executeImport(parseResult, semesterId, programId, 'unauthorized_user')
        ).rejects.toThrow(/Server import rejected: Unauthorized/i);

        // Verify SQLite outbox was NOT written to
        const db = await getDatabase();
        const outbox = await db.query('SELECT * FROM sync_outbox');
        expect(outbox.length).toBe(0);
      } finally {
        DataModeService.setMode('offline_first');
        semSpy.mockRestore();
        progSpy.mockRestore();
        rpcSpy.mockRestore();
      }
    });
  });
});
