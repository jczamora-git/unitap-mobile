import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { authService } from '@/services/auth.service';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { AuthRepository } from '@/database/repositories/auth.repository';

describe('UniTap 2.0 Authentication & Authorization', () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
    await authService.logout();
  });

  it('hashes and verifies passwords using Argon2id', async () => {
    const rawPassword = 'SecurePassword2026!';
    const hash = await authService.hashPassword(rawPassword);

    expect(hash.startsWith('$argon2id$')).toBe(true);

    const isMatch = await authService.verifyPassword(rawPassword, hash);
    expect(isMatch).toBe(true);

    const isBadMatch = await authService.verifyPassword('WrongPassword!', hash);
    expect(isBadMatch).toBe(false);
  });

  it('sets up initial DEVADMIN and verifies login', async () => {
    const isConfiguredBefore = await authService.isDevAdminConfigured();
    expect(isConfiguredBefore).toBe(false);

    await authService.setupInitialDevAdmin('SuperAdmin2026!');

    const isConfiguredAfter = await authService.isDevAdminConfigured();
    expect(isConfiguredAfter).toBe(true);

    // Valid login
    const loginRes = await authService.login('devadmin', 'SuperAdmin2026!');
    expect(loginRes.success).toBe(true);
    expect(loginRes.role).toBe('DEVADMIN');
    expect(authService.role.value).toBe('DEVADMIN');

    // Incorrect password
    const failRes = await authService.login('devadmin', 'WrongPassword!');
    expect(failRes.success).toBe(false);
  });

  it('activates student account using officer-issued activation code', async () => {
    // 1. Create a student in roster
    const studentId = 'stu_test_activate';
    await StudentsRepository.createStudent({
      id: studentId,
      school_id: '2026-9999',
      first_name: 'Jose',
      middle_name: 'Protacio',
      last_name: 'Rizal',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 2. Setup Officer and issue activation claim
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO users (id, username, account_status, created_at, updated_at)
       VALUES ('officer_user', 'officer_user', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`
    );

    const { rawCode } = await authService.generateActivationClaim(studentId, 'officer_user', 24);
    expect(rawCode.length).toBe(8);

    // 3. Student activates with wrong code -> should fail
    await expect(
      authService.activateStudentAccount('2026-9999', 'WRONG123', 'NewStudentPass123!')
    ).rejects.toThrow();

    // 4. Student activates with valid code -> should succeed
    const activatedUser = await authService.activateStudentAccount(
      '2026-9999',
      rawCode,
      'NewStudentPass123!'
    );
    expect(activatedUser.username).toBe('2026-9999');

    // 5. Code cannot be reused
    await expect(
      authService.activateStudentAccount('2026-9999', rawCode, 'AnotherPass123!')
    ).rejects.toThrow();

    // 6. Student can log in with School ID and new password
    const loginRes = await authService.login('2026-9999', 'NewStudentPass123!');
    expect(loginRes.success).toBe(true);
    expect(loginRes.role).toBe('STUDENT');
    expect(authService.student.value?.school_id).toBe('2026-9999');
  });

  it('rejects access for disabled accounts', async () => {
    await authService.setupInitialDevAdmin('AdminPass2026!');
    const admin = await AuthRepository.getUserByUsername('devadmin');
    expect(admin).not.toBeNull();

    // Disable account in database
    const db = await getDatabase();
    await db.execute("UPDATE users SET account_status = 'DISABLED' WHERE username = 'devadmin'");

    const loginRes = await authService.login('devadmin', 'AdminPass2026!');
    expect(loginRes.success).toBe(false);
    expect(loginRes.error).toContain('disabled');
  });
});
