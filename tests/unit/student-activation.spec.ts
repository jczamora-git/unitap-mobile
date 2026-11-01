import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { StudentActivationService } from '@/services/student-activation.service';
import { AuthRepository } from '@/database/repositories/auth.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { authService } from '@/services/auth.service';
import { AccountLinkingService } from '@/integrations/supabase/account-linking.service';
import { mount } from '@vue/test-utils';
import RegisterPage from '@/views/RegisterPage.vue';

describe('UniTap 2.0 Student Self-Registration and Activation Security Suite', () => {
  const studentId = 'stu_act_test_1';
  const schoolId = '2026-9001';
  const officerUserId = 'usr_officer_test_1';

  beforeEach(async () => {
    await resetDatabaseForTests();
    const db = await getDatabase();

    // Setup active academic year and semester
    await AcademicRepository.createYear({
      id: 'ay_act_test',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });
    await AcademicRepository.createSemester({
      id: 'sem_act_test',
      academic_year_id: 'ay_act_test',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    // Setup officer user
    await db.execute(
      `INSERT INTO users (id, username, account_status, created_at, updated_at)
       VALUES (?, 'officer_csg', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`,
      [officerUserId]
    );
    await db.execute(
      `INSERT INTO user_roles (id, user_id, role, assigned_at)
       VALUES ('rol_off_1', ?, 'OFFICER', '2026-08-01T00:00:00Z')`,
      [officerUserId]
    );

    // Setup imported student (via CSV import workflow: exists in students table, no auth user)
    await StudentsRepository.createStudent({
      id: studentId,
      school_id: schoolId,
      first_name: 'Emilio',
      last_name: 'Aguinaldo',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  describe('Activation Code Generation & Non-Plaintext Security', () => {
    it('generates an 8-character human-readable code excluding ambiguous characters', () => {
      const code = StudentActivationService.generateCode();
      expect(code).toHaveLength(8);
      // Confusing chars 0, O, 1, I, L should never be generated
      expect(code).not.toMatch(/[01OIL]/);
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    });

    it('produces a consistent 64-character SHA-256 hash', async () => {
      const hash1 = await StudentActivationService.hashCode('K7P9M3X4');
      const hash2 = await StudentActivationService.hashCode('k7p9m3x4'); // Case-insensitive
      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);
    });

    it('stores only the cryptographic hash in activation_claims, never plaintext', async () => {
      const res = await StudentActivationService.issueActivationCode(studentId, officerUserId, 48);
      expect(res.success).toBe(true);
      expect(res.rawCode).toBeDefined();

      const db = await getDatabase();
      const stored = await db.queryOne<{ token_hash: string }>(
        'SELECT token_hash FROM activation_claims WHERE student_id = ?',
        [studentId]
      );
      expect(stored).toBeDefined();
      expect(stored!.token_hash).not.toBe(res.rawCode);
      expect(stored!.token_hash).toHaveLength(64);
    });
  });

  describe('Officer Management: Issuance, Reissuance & Revocation', () => {
    it('reports NOT_ACTIVATED when no activation claim has been generated', async () => {
      const status = await StudentActivationService.getStudentActivationStatus(studentId);
      expect(status.status).toBe('NOT_ACTIVATED');
      expect(status.auditHistory).toHaveLength(0);
    });

    it('reports ACTIVATION_PENDING after code issuance with audit log', async () => {
      await StudentActivationService.issueActivationCode(studentId, officerUserId, 48);
      const status = await StudentActivationService.getStudentActivationStatus(studentId);
      expect(status.status).toBe('ACTIVATION_PENDING');
      expect(status.auditHistory).toHaveLength(1);
      expect(status.auditHistory[0].action).toBe('ISSUED');
    });

    it('reissues an activation code, revoking previous active codes and logging REISSUED', async () => {
      const first = await StudentActivationService.issueActivationCode(studentId, officerUserId, 48);
      const second = await StudentActivationService.issueActivationCode(studentId, officerUserId, 48);

      expect(first.rawCode).not.toBe(second.rawCode);
      const status = await StudentActivationService.getStudentActivationStatus(studentId);
      expect(status.status).toBe('ACTIVATION_PENDING');
      expect(status.auditHistory).toHaveLength(2);
      expect(status.auditHistory[0].action).toBe('REISSUED');

      // First code should be revoked
      const firstHash = await StudentActivationService.hashCode(first.rawCode!);
      const claim = await AuthRepository.getActivationClaimByHash(firstHash);
      expect(claim).toBeNull(); // Not returned since revoked_at is not null
    });

    it('revokes an activation code and updates status to REQUIRES_ATTENTION', async () => {
      const res = await StudentActivationService.issueActivationCode(studentId, officerUserId, 48);
      await StudentActivationService.revokeActivationCode(res.claimId!, studentId, officerUserId, 'Student lost slip');

      const status = await StudentActivationService.getStudentActivationStatus(studentId);
      expect(status.status).toBe('REQUIRES_ATTENTION');
      expect(status.auditHistory[0].action).toBe('REVOKED');
    });
  });

  describe('Student Self-Registration & Atomic Account Linking', () => {
    it('successfully activates imported student, claims single-use code, and assigns STUDENT role', async () => {
      const issueRes = await StudentActivationService.issueActivationCode(studentId, officerUserId, 48);
      const user = await authService.activateStudentAccount(schoolId, issueRes.rawCode!, 'Password123!');

      expect(user).toBeDefined();
      expect(user.student_id).toBe(studentId);
      expect(user.account_status).toBe('ACTIVE');

      // Verify STUDENT role assigned
      const roles = await AuthRepository.getUserRoles(user.id);
      expect(roles).toHaveLength(1);
      expect(roles[0].role).toBe('STUDENT');

      // Verify activation claim is marked used
      const db = await getDatabase();
      const claim = await db.queryOne<{ used_at: string; claimed_by_user_id: string }>(
        'SELECT used_at, claimed_by_user_id FROM activation_claims WHERE student_id = ?',
        [studentId]
      );
      expect(claim?.used_at).not.toBeNull();
      expect(claim?.claimed_by_user_id).toBe(user.id);

      // Verify activation status is ACTIVATED
      const status = await StudentActivationService.getStudentActivationStatus(studentId);
      expect(status.status).toBe('ACTIVATED');
    });

    it('prevents duplicate claims on an already activated student', async () => {
      const issueRes = await StudentActivationService.issueActivationCode(studentId, officerUserId, 48);
      await authService.activateStudentAccount(schoolId, issueRes.rawCode!, 'Password123!');

      // Attempt second activation with a new code
      const secondIssue = await StudentActivationService.issueActivationCode(studentId, officerUserId, 48);
      await expect(
        authService.activateStudentAccount(schoolId, secondIssue.rawCode!, 'AnotherPass123!')
      ).rejects.toThrow(/already been activated/i);
    });

    it('enforces rate-limiting: revokes code after 5 failed attempts', async () => {
      const issueRes = await StudentActivationService.issueActivationCode(studentId, officerUserId, 48);

      // Attempt 4 incorrect submissions
      for (let i = 0; i < 4; i++) {
        await expect(
          authService.activateStudentAccount(schoolId, 'WRONG00' + i, 'Password123!')
        ).rejects.toThrow(/invalid activation code/i);
      }

      // Check attempt count
      let status = await StudentActivationService.getStudentActivationStatus(studentId);
      expect(status.attemptCount).toBe(4);
      expect(status.status).toBe('ACTIVATION_PENDING');

      // 5th failed attempt should lock / revoke the code
      await expect(
        authService.activateStudentAccount(schoolId, 'WRONG005', 'Password123!')
      ).rejects.toThrow(/invalid activation code/i);

      status = await StudentActivationService.getStudentActivationStatus(studentId);
      expect(status.status).toBe('REQUIRES_ATTENTION');

      // Even correct code should now be rejected because attempts exceeded
      await expect(
        authService.activateStudentAccount(schoolId, issueRes.rawCode!, 'Password123!')
      ).rejects.toThrow();
    });

    it('rejects expired activation codes', async () => {
      // Issue code expired 1 hour ago
      const rawCode = StudentActivationService.generateCode();
      const tokenHash = await StudentActivationService.hashCode(rawCode);
      const expiredAt = new Date(Date.now() - 3600 * 1000).toISOString();

      await AuthRepository.createActivationClaim({
        id: 'act_exp_1',
        student_id: studentId,
        token_hash: tokenHash,
        issued_by_user_id: officerUserId,
        expires_at: expiredAt,
        created_at: new Date(Date.now() - 7200 * 1000).toISOString(),
        attempt_count: 0,
        max_attempts: 5,
      });

      await expect(
        authService.activateStudentAccount(schoolId, rawCode, 'Password123!')
      ).rejects.toThrow(/expired/i);
    });

    it('returns generic error on non-existent school ID to prevent student enumeration', async () => {
      await expect(
        authService.activateStudentAccount('NON-EXISTENT-ID', 'A7B8C9D0', 'Password123!')
      ).rejects.toThrow('Invalid activation code or school ID.');
    });

    it('links student account via AccountLinkingService fallback atomically', async () => {
      const issueRes = await StudentActivationService.issueActivationCode(studentId, officerUserId, 48);
      const res = await AccountLinkingService.activateAndLinkStudentAccount(
        schoolId,
        issueRes.rawCode!,
        'usr_auth_linked_1'
      );

      expect(res.success).toBe(true);
      expect(res.studentId).toBe(studentId);

      const db = await getDatabase();
      const linkedUser = await db.queryOne<{ id: string; student_id: string }>(
        'SELECT id, student_id FROM users WHERE id = ?',
        ['usr_auth_linked_1']
      );
      expect(linkedUser?.student_id).toBe(studentId);
    });

    it('validates 8-character code against database without consuming the single-use claim', async () => {
      const issueRes = await StudentActivationService.issueActivationCode(studentId, officerUserId, 48);
      expect(issueRes.success).toBe(true);

      // Validate matching code
      const checkRes = await AccountLinkingService.validateActivationCode(schoolId, issueRes.rawCode!);
      expect(checkRes.valid).toBe(true);
      expect(checkRes.studentName).toBe('Emilio Aguinaldo');

      // Invariant: Claim must NOT be consumed by pre-check
      const db = await getDatabase();
      const claim = await db.queryOne<{ used_at: string | null }>(
        'SELECT used_at FROM activation_claims WHERE student_id = ?',
        [studentId]
      );
      expect(claim?.used_at).toBeNull();

      // Validate invalid 8-character code
      const wrongRes = await AccountLinkingService.validateActivationCode(schoolId, 'ZZZZZZZZ');
      expect(wrongRes.valid).toBe(false);
      expect(wrongRes.error).toContain('not found');

      // Validate non-existent school ID
      const missingSchoolRes = await AccountLinkingService.validateActivationCode('9999-9999', issueRes.rawCode!);
      expect(missingSchoolRes.valid).toBe(false);
    });
  });

  describe('Registration UI (RegisterPage.vue)', () => {
    it('renders School ID, Activation Code, Email, Password, and Confirm Password fields', () => {
      const wrapper = mount(RegisterPage, {
        global: {
          stubs: {
            'ion-page': { template: '<div><slot /></div>' },
            'ion-content': { template: '<div><slot /></div>' },
            'ion-icon': true,
            UniPageHeader: { template: '<div>{{ title }}</div>', props: ['title'] },
            UniButton: { template: '<button><slot /></button>' },
            UniCard: { template: '<div><slot /></div>' },
          },
        },
      });

      expect(wrapper.text()).toContain('Student Activation');
      expect(wrapper.text()).toContain('School ID');
      expect(wrapper.text()).toContain('Activation Code');
      expect(wrapper.text()).toContain('Email Address');
      expect(wrapper.text()).toContain('Password');
      expect(wrapper.text()).toContain('Confirm Password');
      expect(wrapper.text()).toContain('Privacy Notice');
      expect(wrapper.text()).toContain('Terms of Use');
      expect(wrapper.text()).toContain('Sign In');
    });
  });
});

