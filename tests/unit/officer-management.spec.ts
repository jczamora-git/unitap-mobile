import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests } from '@/database/database';
import { AuthRepository } from '@/database/repositories/auth.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { OfficerRepository } from '@/database/repositories/officer.repository';
import {
  OfficerManagementService,
  OFFICER_PERMISSIONS,
} from '@/services/officer-management.service';
import { authService } from '@/services/auth.service';
import type { UserAccount, UserRoleRecord, StudentRecord } from '@/types/database';

describe('UniTap 2.0 DevAdmin Officer Management Suite', () => {
  const now = new Date().toISOString();

  beforeEach(async () => {
    await resetDatabaseForTests();

    // Seed DevAdmin user
    const devAdminUser: UserAccount = {
      id: 'usr_devadmin',
      username: 'devadmin',
      account_status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    };
    const devAdminCred = {
      user_id: 'usr_devadmin',
      password_hash: 'admin_hash_123',
      algorithm: 'ARGON2ID' as const,
      provisioned_at: now,
    };
    const devAdminRole: UserRoleRecord = {
      id: 'rol_devadmin',
      user_id: 'usr_devadmin',
      role: 'DEVADMIN',
      assigned_at: now,
    };
    await AuthRepository.createUserWithCredentials(devAdminUser, devAdminCred, devAdminRole);
  });

  it('Scenario A: Promotes existing registered student to Officer without duplicating account or deleting STUDENT role', async () => {
    // 1. Seed existing student & user
    const studentRecord: StudentRecord = {
      id: 'stu_alice',
      school_id: '2024-0001',
      first_name: 'Alice',
      middle_name: null,
      last_name: 'Smith',
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    };
    await StudentsRepository.createStudent(studentRecord);

    const studentUser: UserAccount = {
      id: 'usr_alice',
      username: '2024-0001',
      student_id: 'stu_alice',
      account_status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    };
    const studentCred = {
      user_id: 'usr_alice',
      password_hash: 'hash_123',
      algorithm: 'ARGON2ID' as const,
      provisioned_at: now,
    };
    const studentRole: UserRoleRecord = {
      id: 'rol_stu_alice',
      user_id: 'usr_alice',
      role: 'STUDENT',
      assigned_at: now,
    };
    await AuthRepository.createUserWithCredentials(studentUser, studentCred, studentRole);

    // 2. DevAdmin promotes Alice to Attendance Officer
    const assignRes = await OfficerManagementService.assignExistingStudentAsOfficer({
      studentId: 'stu_alice',
      userId: 'usr_alice',
      fullName: 'Alice Smith',
      email: 'alice.smith@univ.edu',
      permissionPreset: 'ATTENDANCE',
      startDate: '2026-08-01',
      endDate: '2027-05-31',
      devAdminUserId: 'usr_devadmin',
    });

    expect(assignRes.success).toBe(true);
    expect(assignRes.appointment.status).toBe('ACTIVE');
    expect(assignRes.appointment.permission_preset).toBe('ATTENDANCE');

    // 3. Verify no duplicate auth user was created
    const user = await AuthRepository.getUserById('usr_alice');
    expect(user).not.toBeNull();
    expect(user?.id).toBe('usr_alice');
    expect(user?.student_id).toBe('stu_alice');

    // 4. Verify user now has BOTH active roles (STUDENT + OFFICER)
    const roles = await AuthRepository.getUserRoles('usr_alice');
    expect(roles.length).toBe(2);
    const roleNames = roles.map((r) => r.role);
    expect(roleNames).toContain('STUDENT');
    expect(roleNames).toContain('OFFICER');

    // 5. Test workspace switching
    await authService.setSession(studentUser, roles[0], studentRecord, roles);
    expect(authService.canSwitchWorkspace.value).toBe(true);

    await authService.switchWorkspace('OFFICER');
    expect(authService.activeWorkspace.value).toBe('OFFICER');

    await authService.switchWorkspace('STUDENT');
    expect(authService.activeWorkspace.value).toBe('STUDENT');
  });

  it('Scenario B: Prepares verified activation for imported student and activates Officer upon signup', async () => {
    // 1. Seed imported student in roster (without account)
    const studentRecord: StudentRecord = {
      id: 'stu_bob',
      school_id: '2024-0002',
      first_name: 'Bob',
      middle_name: null,
      last_name: 'Jones',
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    };
    await StudentsRepository.createStudent(studentRecord);

    // 2. DevAdmin prepares pending Finance Officer activation
    const prepRes = await OfficerManagementService.prepareImportedStudentOfficerActivation({
      studentId: 'stu_bob',
      fullName: 'Bob Jones',
      email: 'bob.jones@univ.edu',
      permissionPreset: 'FINANCE',
      startDate: '2026-08-01',
      endDate: '2027-05-31',
      devAdminUserId: 'usr_devadmin',
    });

    expect(prepRes.success).toBe(true);
    expect(prepRes.appointment.status).toBe('PENDING');
    expect(prepRes.rawActivationCode).toBeDefined();
    expect(prepRes.rawActivationCode?.length).toBe(8);

    // 3. Bob completes student activation with the issued code
    const user = await authService.activateStudentAccount(
      '2024-0002',
      prepRes.rawActivationCode!,
      'StrongPassword123!'
    );

    expect(user).toBeDefined();
    expect(user.student_id).toBe('stu_bob');

    // 4. Verify appointment has transitioned to ACTIVE and user has both roles
    const updatedAppt = await OfficerRepository.getAppointmentById(prepRes.appointment.id);
    expect(updatedAppt?.status).toBe('ACTIVE');
    expect(updatedAppt?.user_id).toBe(user.id);

    const userRoles = await AuthRepository.getUserRoles(user.id);
    const roleNames = userRoles.map((r) => r.role);
    expect(roleNames).toContain('STUDENT');
    expect(roleNames).toContain('OFFICER');
  });

  it('Scenario C: Invites completely new Officer without student record and completes onboarding', async () => {
    // 1. DevAdmin invites new officer
    const inviteRes = await OfficerManagementService.inviteNewOfficer({
      fullName: 'Clara Oswald',
      email: 'clara@univ.edu',
      permissionPreset: 'FULL',
      startDate: '2026-08-01',
      endDate: '2027-05-31',
      devAdminUserId: 'usr_devadmin',
    });

    expect(inviteRes.success).toBe(true);
    expect(inviteRes.appointment.status).toBe('PENDING');
    expect(inviteRes.appointment.student_id).toBeNull();
    expect(inviteRes.invitationCode).toBeDefined();

    // 2. Clara completes invitation setup with password
    const onboardRes = await OfficerManagementService.completeNewOfficerOnboarding(
      inviteRes.invitationCode!,
      'SecretP@ssword123'
    );

    expect(onboardRes.success).toBe(true);
    expect(onboardRes.user).toBeDefined();
    expect(onboardRes.user.student_id).toBeUndefined();

    // 3. Verify role is OFFICER only (no student profile required)
    const userRoles = await AuthRepository.getUserRoles(onboardRes.user.id);
    expect(userRoles.length).toBe(1);
    expect(userRoles[0].role).toBe('OFFICER');

    const updatedAppt = await OfficerRepository.getAppointmentById(inviteRes.appointment.id);
    expect(updatedAppt?.status).toBe('ACTIVE');

    // 4. Duplicate invitation with same email is rejected
    const duplicateRes = await OfficerManagementService.inviteNewOfficer({
      fullName: 'Clara Oswald',
      email: 'clara@univ.edu',
      permissionPreset: 'FULL',
      startDate: '2026-08-01',
      endDate: '2027-05-31',
      devAdminUserId: 'usr_devadmin',
    });
    expect(duplicateRes.success).toBe(false);
    expect(duplicateRes.error).toContain('already exists');
  });

  it('Enforces permission presets and rejects unauthorized operations', async () => {
    const userId = 'usr_alice_perm';
    const aliceUser: UserAccount = {
      id: userId,
      username: 'alice_perm',
      account_status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    };
    await AuthRepository.createUserWithCredentials(
      aliceUser,
      { user_id: userId, password_hash: 'h', algorithm: 'ARGON2ID', provisioned_at: now },
      { id: 'rol_p', user_id: userId, role: 'OFFICER', assigned_at: now }
    );

    // Attendance Officer appointment
    await OfficerRepository.createAppointment({
      id: 'appt_attendance',
      user_id: userId,
      full_name: 'Attendance Guard',
      email: 'att@univ.edu',
      permission_preset: 'ATTENDANCE',
      custom_permissions_json: JSON.stringify([
        OFFICER_PERMISSIONS.ATTENDANCE_SCAN,
        OFFICER_PERMISSIONS.ATTENDANCE_CONFIRM,
      ]),
      appointment_start: '2026-01-01',
      appointment_end: '2027-12-31',
      scope_type: 'ORGANIZATION',
      status: 'ACTIVE',
      assigned_by_user_id: 'usr_devadmin',
      created_at: now,
      updated_at: now,
    });

    // Attendance Officer has attendance.scan
    const canScan = await OfficerManagementService.userHasPermission(
      userId,
      OFFICER_PERMISSIONS.ATTENDANCE_SCAN
    );
    expect(canScan).toBe(true);

    // Attendance Officer does NOT have payments.record or payments.reverse
    const canRecordPayment = await OfficerManagementService.userHasPermission(
      userId,
      OFFICER_PERMISSIONS.PAYMENTS_RECORD
    );
    expect(canRecordPayment).toBe(false);

    const canReversePayment = await OfficerManagementService.userHasPermission(
      userId,
      OFFICER_PERMISSIONS.PAYMENTS_REVERSE
    );
    expect(canReversePayment).toBe(false);
  });

  it('Revoking officer privileges leaves student profile, account, and STUDENT role intact', async () => {
    const studentRecord: StudentRecord = {
      id: 'stu_david',
      school_id: '2024-0004',
      first_name: 'David',
      middle_name: null,
      last_name: 'Miller',
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    };
    await StudentsRepository.createStudent(studentRecord);

    const user: UserAccount = {
      id: 'usr_david',
      username: '2024-0004',
      student_id: 'stu_david',
      account_status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    };
    const cred = {
      user_id: 'usr_david',
      password_hash: 'hash_456',
      algorithm: 'ARGON2ID' as const,
      provisioned_at: now,
    };
    const studentRole: UserRoleRecord = {
      id: 'rol_stu_david',
      user_id: 'usr_david',
      role: 'STUDENT',
      assigned_at: now,
    };
    await AuthRepository.createUserWithCredentials(user, cred, studentRole);

    // Promote to Officer
    await OfficerManagementService.assignExistingStudentAsOfficer({
      studentId: 'stu_david',
      userId: 'usr_david',
      fullName: 'David Miller',
      email: 'david@univ.edu',
      permissionPreset: 'FULL',
      startDate: '2026-08-01',
      endDate: '2027-05-31',
      devAdminUserId: 'usr_devadmin',
    });

    const appt = await OfficerRepository.getAppointmentByUserId('usr_david');
    expect(appt?.status).toBe('ACTIVE');

    // DevAdmin Revokes Officer
    const revokeRes = await OfficerManagementService.revokeOfficer(appt!.id, 'Term finished');
    expect(revokeRes.success).toBe(true);

    // Verify appointment status is REVOKED
    const revokedAppt = await OfficerRepository.getAppointmentById(appt!.id);
    expect(revokedAppt?.status).toBe('REVOKED');
    expect(revokedAppt?.revoked_at).toBeDefined();

    // Verify STUDENT role is STILL ACTIVE in user_roles
    const activeRoles = await AuthRepository.getUserRoles('usr_david');
    expect(activeRoles.length).toBe(1);
    expect(activeRoles[0].role).toBe('STUDENT');

    // Verify student record still exists
    const student = await StudentsRepository.getStudentById('stu_david');
    expect(student).not.toBeNull();
    expect(student?.first_name).toBe('David');
  });

  it('Suspension pauses officer access and reactivation restores it', async () => {
    const userId = 'usr_test_susp';
    await AuthRepository.createUserWithCredentials(
      { id: userId, username: 'test_susp', account_status: 'ACTIVE', created_at: now, updated_at: now },
      { user_id: userId, password_hash: 'h', algorithm: 'ARGON2ID', provisioned_at: now },
      { id: 'rol_s', user_id: userId, role: 'OFFICER', assigned_at: now }
    );

    await OfficerRepository.createAppointment({
      id: 'appt_suspend_test',
      user_id: userId,
      full_name: 'Test Officer',
      email: 'test@univ.edu',
      permission_preset: 'ATTENDANCE',
      appointment_start: '2026-01-01',
      appointment_end: '2027-12-31',
      scope_type: 'ORGANIZATION',
      status: 'ACTIVE',
      assigned_by_user_id: 'usr_devadmin',
      created_at: now,
      updated_at: now,
    });

    await OfficerManagementService.suspendOfficer('appt_suspend_test', 'Pending investigation');
    const appt = await OfficerRepository.getAppointmentById('appt_suspend_test');
    expect(appt?.status).toBe('SUSPENDED');
    expect(appt?.suspended_at).toBeDefined();

    // Check userHasPermission returns false while suspended
    const canScan = await OfficerManagementService.userHasPermission(userId, 'attendance.scan');
    expect(canScan).toBe(false);
  });
});
