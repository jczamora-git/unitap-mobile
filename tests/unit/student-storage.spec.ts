import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests } from '@/database/database';
import { Preferences } from '@capacitor/preferences';
import { LocalStudentRepository } from '@/services/student-storage.service';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import type { Student } from '@/types/student';

describe('LocalStudentRepository (SQLite Primary & Backward Compatible)', () => {
  let repo: LocalStudentRepository;
  const semesterId = 'sem_storage_test';
  const programId = 'prog_bsit';

  beforeEach(async () => {
    await resetDatabaseForTests();
    await Preferences.clear();

    await AcademicRepository.createYear({
      id: 'ay_storage',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });

    await AcademicRepository.createSemester({
      id: semesterId,
      academic_year_id: 'ay_storage',
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

    repo = new LocalStudentRepository();
  });

  it('reads students directly from SQLite when populated via CSV import or sync', async () => {
    const now = new Date().toISOString();

    // Insert student into SQLite
    await StudentsRepository.createStudent({
      id: 'stu_001',
      school_id: 'MCC-2026-0001',
      first_name: 'Juan',
      middle_name: 'Protacio',
      last_name: 'Dela Cruz',
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    });

    // Insert enrollment
    await AcademicRepository.createEnrollment({
      id: 'enr_001',
      student_id: 'stu_001',
      semester_id: semesterId,
      program_id: programId,
      year_level: 2,
      section: '2F1',
      enrollment_status: 'ENROLLED',
      first_name_snapshot: 'Juan',
      middle_name_snapshot: 'Protacio',
      last_name_snapshot: 'Dela Cruz',
      updated_at: now,
    });

    // Query through repository
    const students = await repo.getAll();
    expect(students).toHaveLength(1);
    expect(students[0].studentNumber).toBe('MCC-2026-0001');
    expect(students[0].firstName).toBe('Juan');
    expect(students[0].middleName).toBe('Protacio');
    expect(students[0].lastName).toBe('Dela Cruz');
    expect(students[0].yearLevel).toBe(2);
    expect(students[0].section).toBe('2F1');
    expect(students[0].course).toBe('BSIT');
  });

  it('fetches by studentNumber (school_id) and id from SQLite', async () => {
    const now = new Date().toISOString();
    await StudentsRepository.createStudent({
      id: 'stu_002',
      school_id: 'MCC-2026-0099',
      first_name: 'Maria',
      last_name: 'Santos',
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    });

    const byNum = await repo.getByStudentNumber('mcc-2026-0099');
    expect(byNum).not.toBeNull();
    expect(byNum?.firstName).toBe('Maria');

    const byId = await repo.getById('stu_002');
    expect(byId).not.toBeNull();
    expect(byId?.lastName).toBe('Santos');
  });

  it('saves new students into SQLite tables and mirrors to Preferences', async () => {
    const newStudent: Student = {
      id: 'stu_new_01',
      studentNumber: 'MCC-2026-0150',
      firstName: 'Rico',
      lastName: 'Blanco',
      yearLevel: 3,
      section: '3F2',
      course: 'BSIT',
      status: 'ACTIVE',
      rfidUid: '04:12:34:AB',
      rfidUidCompact: '041234AB',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await repo.save(newStudent);

    // Verify in SQLite
    const inDb = await StudentsRepository.getStudentBySchoolId('MCC-2026-0150');
    expect(inDb).not.toBeNull();
    expect(inDb?.first_name).toBe('Rico');

    // Verify in Preferences
    const { value } = await Preferences.get({ key: 'nfc_inspector_students_v1' });
    expect(value).not.toBeNull();
    const parsed = JSON.parse(value!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].studentNumber).toBe('MCC-2026-0150');
  });
});

