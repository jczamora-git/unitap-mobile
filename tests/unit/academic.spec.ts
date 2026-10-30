import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests } from '@/database/database';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';

describe('UniTap 2.0 Academic Year & Semester Management', () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
  });

  it('manages terms and switches active semester atomically', async () => {
    await AcademicRepository.createYear({
      id: 'ay_2026_2027',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });

    await AcademicRepository.createSemester({
      id: 'sem_1',
      academic_year_id: 'ay_2026_2027',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    await AcademicRepository.createSemester({
      id: 'sem_2',
      academic_year_id: 'ay_2026_2027',
      term: 'SECOND',
      starts_on: '2027-01-10',
      ends_on: '2027-05-31',
      status: 'PLANNED',
    });

    let activeSem = await AcademicRepository.getActiveSemester();
    expect(activeSem?.id).toBe('sem_1');

    // Switch active semester to sem_2
    await AcademicRepository.setActiveSemester('sem_2');

    activeSem = await AcademicRepository.getActiveSemester();
    expect(activeSem?.id).toBe('sem_2');

    const prevSem = await AcademicRepository.getSemesterById('sem_1');
    expect(prevSem?.status).toBe('CLOSED');
  });

  it('preserves historical multi-semester enrollments for the same student', async () => {
    const studentId = 'stu_history_test';
    await StudentsRepository.createStudent({
      id: studentId,
      school_id: '2025-0001',
      first_name: 'Apolinario',
      last_name: 'Mabini',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await AcademicRepository.createYear({
      id: 'ay_2025_2026',
      label: '2025-2026',
      starts_on: '2025-08-01',
      ends_on: '2026-05-31',
      status: 'ARCHIVED',
    });

    await AcademicRepository.createYear({
      id: 'ay_2026_2027',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });

    await AcademicRepository.createSemester({
      id: 'sem_2025_1',
      academic_year_id: 'ay_2025_2026',
      term: 'FIRST',
      starts_on: '2025-08-01',
      ends_on: '2025-12-31',
      status: 'CLOSED',
    });

    await AcademicRepository.createSemester({
      id: 'sem_2026_1',
      academic_year_id: 'ay_2026_2027',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    // 1. Enrollment in 2025: Year 1, Section 1F4
    await AcademicRepository.createEnrollment({
      id: 'enr_2025',
      student_id: studentId,
      semester_id: 'sem_2025_1',
      year_level: 1,
      section: '1F4',
      enrollment_status: 'ENROLLED',
      first_name_snapshot: 'Apolinario',
      last_name_snapshot: 'Mabini',
      updated_at: '2025-08-15T00:00:00Z',
    });

    // 2. Enrollment in 2026: Year 2, Section 2F4
    await AcademicRepository.createEnrollment({
      id: 'enr_2026',
      student_id: studentId,
      semester_id: 'sem_2026_1',
      year_level: 2,
      section: '2F4',
      enrollment_status: 'ENROLLED',
      first_name_snapshot: 'Apolinario',
      last_name_snapshot: 'Mabini',
      updated_at: '2026-08-15T00:00:00Z',
    });

    // Verify both records exist and neither overwritten
    const enrollments = await AcademicRepository.getEnrollmentsForStudent(studentId);
    expect(enrollments.length).toBe(2);

    const enr2025 = enrollments.find((e) => e.semester_id === 'sem_2025_1');
    const enr2026 = enrollments.find((e) => e.semester_id === 'sem_2026_1');

    expect(enr2025?.year_level).toBe(1);
    expect(enr2025?.section).toBe('1F4');

    expect(enr2026?.year_level).toBe(2);
    expect(enr2026?.section).toBe('2F4');
  });

  it('manages mandatory semester profile confirmations', async () => {
    const studentId = 'stu_pconf';
    await StudentsRepository.createStudent({
      id: studentId,
      school_id: '2026-0099',
      first_name: 'Gabriela',
      last_name: 'Silang',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await AcademicRepository.createYear({
      id: 'ay_pconf',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });

    await AcademicRepository.createSemester({
      id: 'sem_pconf',
      academic_year_id: 'ay_pconf',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    // Create confirmation requirement
    await StudentsRepository.createProfileConfirmation({
      id: 'conf_1',
      student_id: studentId,
      semester_id: 'sem_pconf',
      status: 'PENDING',
    });

    let conf = await StudentsRepository.getProfileConfirmation(studentId, 'sem_pconf');
    expect(conf?.status).toBe('PENDING');

    // Approve confirmation
    await StudentsRepository.updateProfileConfirmationStatus(
      'conf_1',
      'APPROVED',
      'officer_user',
      'Verified with student ID card'
    );

    conf = await StudentsRepository.getProfileConfirmation(studentId, 'sem_pconf');
    expect(conf?.status).toBe('APPROVED');
    expect(conf?.reviewed_by_user_id).toBe('officer_user');
  });
});

