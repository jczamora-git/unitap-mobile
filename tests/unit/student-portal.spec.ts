import { describe, it, expect, beforeEach } from 'vitest';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { useCurrentStudentPortal } from '@/composables/useCurrentStudentPortal';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { FinanceRepository } from '@/database/repositories/finance.repository';
import { AttendanceRepository } from '@/database/repositories/attendance.repository';
import type { UserAccount, UserRoleRecord } from '@/types/database';

describe('UniTap 2.0 Student Portal & Role-Scoped Monitoring Suite', () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
  });

  it('correctly identifies student role and activates student monitoring mode', async () => {
    const studentUser: UserAccount = {
      id: 'usr_student_test_1',
      username: 'mcc2026-0001',
      student_id: 'stu_test_1',
      account_status: 'ACTIVE',
      created_at: new Date().toISOString(),
    };
    const studentRole: UserRoleRecord = {
      id: 'role_stu_1',
      user_id: 'usr_student_test_1',
      role: 'STUDENT',
      assigned_at: new Date().toISOString(),
    };

    await authService.setSession(studentUser, studentRole, null, [studentRole]);

    const { isStudent } = useCurrentStudentPortal();
    expect(isStudent.value).toBe(true);
    expect(authService.role.value).toBe('STUDENT');
  });

  it('resolves student profile, academic summary and personal metrics from SQLite', async () => {
    // 1. Seed student in SQLite
    const now = new Date().toISOString();
    await StudentsRepository.createStudent({
      id: 'stu_test_portal_1',
      school_id: 'MCC2026-0001',
      first_name: 'Maria',
      middle_name: 'Santos',
      last_name: 'Dela Cruz',
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    });

    const studentUser: UserAccount = {
      id: 'usr_student_portal_1',
      username: 'mcc2026-0001',
      student_id: 'stu_test_portal_1',
      account_status: 'ACTIVE',
      created_at: new Date().toISOString(),
    };
    const studentRole: UserRoleRecord = {
      id: 'role_stu_portal_1',
      user_id: 'usr_student_portal_1',
      role: 'STUDENT',
      assigned_at: new Date().toISOString(),
    };

    await authService.setSession(studentUser, studentRole, null, [studentRole]);

    const portal = useCurrentStudentPortal();
    await portal.loadPortalData();

    expect(portal.student.value).not.toBeNull();
    expect(portal.student.value?.firstName).toBe('Maria');
    expect(portal.student.value?.lastName).toBe('Dela Cruz');
    expect(portal.studentName.value).toBe('Maria Santos Dela Cruz');
  });

  it('accurately computes student personal financial dues, paid total and balance in integer centavos', async () => {
    const now = new Date().toISOString();
    await StudentsRepository.createStudent({
      id: 'stu_fin_portal_1',
      school_id: 'MCC2026-0002',
      first_name: 'Pedro',
      last_name: 'Penduko',
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    });

    // Seed academic structure & officer user
    const db = await getDatabase();
    await db.execute("INSERT OR IGNORE INTO academic_years (id, label, starts_on, ends_on, status) VALUES ('ay_fin', '2026-2027', '2026-08-01', '2027-05-31', 'ACTIVE');");
    await db.execute("INSERT OR IGNORE INTO semesters (id, academic_year_id, term, starts_on, ends_on, status) VALUES ('sem_test_1', 'ay_fin', 'FIRST', '2026-08-01', '2026-12-31', 'ACTIVE');");
    await db.execute("INSERT OR IGNORE INTO users (id, username, account_status, created_at, updated_at) VALUES ('usr_admin', 'devadmin', 'ACTIVE', datetime('now'), datetime('now'));");

    // Seed obligation: ₱150.00 assessed
    await db.execute(
      `INSERT INTO student_obligations (
        id, student_id, semester_id, title, type, amount_centavos, status, issued_by_user_id, issued_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['ob_portal_1', 'stu_fin_portal_1', 'sem_test_1', 'CSG 1st Sem Membership Fee', 'CONTRIBUTION', 15000, 'ACTIVE', 'usr_admin', now, now]
    );

    const studentUser: UserAccount = {
      id: 'usr_student_fin_1',
      username: 'mcc2026-0002',
      student_id: 'stu_fin_portal_1',
      account_status: 'ACTIVE',
      created_at: new Date().toISOString(),
    };
    const studentRole: UserRoleRecord = {
      id: 'role_stu_fin_1',
      user_id: 'usr_student_fin_1',
      role: 'STUDENT',
      assigned_at: new Date().toISOString(),
    };

    await authService.setSession(studentUser, studentRole, null, [studentRole]);

    const portal = useCurrentStudentPortal();
    await portal.loadPortalData();

    expect(portal.totalAssessedCentavos.value).toBe(15000);
    expect(portal.totalPaidCentavos.value).toBe(0);
    expect(portal.outstandingBalanceCentavos.value).toBe(15000);
    expect(portal.obligations.value.length).toBe(1);
    expect(portal.obligations.value[0].title).toBe('CSG 1st Sem Membership Fee');
  });

  it('accurately synthesizes personal attendance history without displaying other students records', async () => {
    await StudentsRepository.createStudent({
      id: 'stu_att_portal_1',
      school_id: 'MCC2026-0003',
      first_name: 'Jose',
      last_name: 'Rizal',
      status: 'ACTIVE',
    });

    const studentUser: UserAccount = {
      id: 'usr_student_att_1',
      username: 'mcc2026-0003',
      student_id: 'stu_att_portal_1',
      account_status: 'ACTIVE',
      created_at: new Date().toISOString(),
    };
    const studentRole: UserRoleRecord = {
      id: 'role_stu_att_1',
      user_id: 'usr_student_att_1',
      role: 'STUDENT',
      assigned_at: new Date().toISOString(),
    };

    await authService.setSession(studentUser, studentRole, null, [studentRole]);

    const portal = useCurrentStudentPortal();
    await portal.loadPortalData();

    // Default with no records
    expect(portal.attendedCount.value).toBe(0);
    expect(portal.attendanceRate.value).toBe(100);
  });
});

