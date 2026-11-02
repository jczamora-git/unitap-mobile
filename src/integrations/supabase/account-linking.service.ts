import { sha256 } from 'hash-wasm';
import { supabase } from './client';
import { getDatabase } from '@/database/database';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { AuthRepository } from '@/database/repositories/auth.repository';
import { normalizeSchoolId } from '@/utilities/school-id-normalizer';

export interface VerifyActivationClaimResult {
  success: boolean;
  studentId?: string;
  firstName?: string;
  lastName?: string;
  error?: string;
  alreadyLinked?: boolean;
}

function isTestEnvironment(): boolean {
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITEST === 'true' || proc?.env?.NODE_ENV === 'test' || import.meta.env?.MODE === 'test';
}

export class AccountLinkingService {
  /**
   * Hashes the 8-character officer-issued code using SHA-256
   */
  public static async hashActivationCode(rawCode: string): Promise<string> {
    const clean = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return sha256(clean);
  }

  /**
   * Verifies an activation code claim online with Supabase or falls back to local verification when configured.
   * Kept for backward compatibility with existing tests and hybrid sync callers.
   */
  public static async verifyActivationClaim(
    schoolId: string,
    rawCode: string
  ): Promise<VerifyActivationClaimResult> {
    const cleanSchoolId = normalizeSchoolId(schoolId);
    const tokenHash = await this.hashActivationCode(rawCode);
    const isTestEnv = isTestEnvironment();

    if (!isTestEnv) {
      try {
        const { data, error } = await supabase.rpc('verify_and_claim_student_code', {
          p_school_id: cleanSchoolId,
          p_token_hash: tokenHash,
        });

        if (!error && data && data.success) {
          return {
            success: true,
            studentId: data.student_id,
            firstName: data.first_name,
            lastName: data.last_name,
          };
        }
      } catch (netErr) {
        console.warn('[AccountLinking] Network error during activation claim verify:', netErr);
      }
    }

    // Local fallback verification in SQLite
    const student = await StudentsRepository.getStudentBySchoolId(cleanSchoolId);
    if (!student) {
      return { success: false, error: 'Student record not found. Please contact an officer.' };
    }

    const db = await getDatabase();
    const claim = await db.queryOne<{ id: string; expires_at: string }>(
      `SELECT id, expires_at FROM activation_claims 
       WHERE student_id = ? AND token_hash = ? AND used_at IS NULL AND revoked_at IS NULL`,
      [student.id, tokenHash]
    );

    if (!claim) {
      return { success: false, error: 'Invalid or expired activation code.' };
    }

    if (new Date() > new Date(claim.expires_at)) {
      return { success: false, error: 'This activation code has expired.' };
    }

    await db.execute('UPDATE activation_claims SET used_at = ? WHERE id = ?', [
      new Date().toISOString(),
      claim.id,
    ]);

    return {
      success: true,
      studentId: student.id,
      firstName: student.first_name,
      lastName: student.last_name,
    };
  }

  /**
   * Validates whether an 8-character activation code exists and is valid for the given student
   * without consuming or modifying the claim (safe pre-verification during onboarding).
   */
  public static async validateActivationCode(
    schoolId: string,
    rawCode: string
  ): Promise<{ valid: boolean; error?: string; studentName?: string }> {
    const cleanSchoolId = normalizeSchoolId(schoolId);
    const cleanCode = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (!cleanSchoolId) {
      return { valid: false, error: 'Please enter your School ID first.' };
    }

    if (cleanCode.length !== 8) {
      return { valid: false, error: 'Activation code must be 8 characters.' };
    }

    const tokenHash = await this.hashActivationCode(cleanCode);
    const isTestEnv = isTestEnvironment();

    // 1. Online verification check via Supabase RPC if available
    if (!isTestEnv) {
      try {
        const { data, error } = await supabase.rpc('validate_activation_code', {
          p_school_id: cleanSchoolId,
          p_token_hash: tokenHash,
        });

        if (error) {
          return {
            valid: false,
            error: error.message || 'Server error while validating activation code.',
          };
        }

        if (data) {
          if (data.success) {
            return {
              valid: true,
              studentName: data.student_name,
            };
          } else {
            return {
              valid: false,
              error: data.error || 'Activation code not found in records for this student.',
            };
          }
        }
      } catch (netErr: any) {
        return {
          valid: false,
          error: netErr?.message || 'Network error connecting to activation server. Please check your connection.',
        };
      }
    }

    // 2. Local SQLite verification check
    try {
      const student = await StudentsRepository.getStudentBySchoolId(cleanSchoolId);
      if (!student) {
        return { valid: false, error: 'Student record not found for this School ID.' };
      }

      // Check if already claimed / active
      const existingUser = await AuthRepository.getUserByStudentId(student.id);
      if (existingUser && existingUser.account_status === 'ACTIVE') {
        return { valid: false, error: 'This student record has already been activated. Please sign in.' };
      }

      const db = await getDatabase();
      const claim = await db.queryOne<{
        id: string;
        expires_at: string;
        used_at: string | null;
        revoked_at: string | null;
        attempt_count: number;
        max_attempts: number;
      }>(
        `SELECT id, expires_at, used_at, revoked_at, attempt_count, max_attempts FROM activation_claims 
         WHERE student_id = ? AND token_hash = ?`,
        [student.id, tokenHash]
      );

      if (!claim) {
        return { valid: false, error: 'Activation code not found in database for this student.' };
      }

      if (claim.used_at) {
        return { valid: false, error: 'This activation code has already been used.' };
      }

      if (claim.revoked_at) {
        return { valid: false, error: 'This activation code has been revoked.' };
      }

      if ((claim.attempt_count ?? 0) >= (claim.max_attempts ?? 5)) {
        return { valid: false, error: 'Code revoked due to excessive failed attempts.' };
      }

      if (new Date() > new Date(claim.expires_at)) {
        return { valid: false, error: 'This activation code has expired.' };
      }

      return {
        valid: true,
        studentName: `${student.first_name} ${student.last_name}`.trim(),
      };
    } catch (err: unknown) {
      return { valid: false, error: (err as Error).message || 'Failed to verify activation code.' };
    }
  }

  /**
   * Atomically verifies the activation claim, links the Supabase Auth user to the student profile,
   * assigns the STUDENT role, and records audit history.
   */
  public static async activateAndLinkStudentAccount(
    schoolId: string,
    rawCode: string,
    authUserId: string
  ): Promise<VerifyActivationClaimResult> {
    const cleanSchoolId = normalizeSchoolId(schoolId);
    const tokenHash = await this.hashActivationCode(rawCode);
    const isTestEnv = isTestEnvironment();

    if (!isTestEnv) {
      try {
        // 1. Online atomic activation via Supabase RPC
        const { data, error } = await supabase.rpc('activate_student_account', {
          p_school_id: cleanSchoolId,
          p_token_hash: tokenHash,
          p_auth_user_id: authUserId,
        });

        if (error) {
          return {
            success: false,
            error: error.message || 'Server error during account activation.',
          };
        }

        if (data && data.success) {
          // Mirror linkage in local SQLite database for offline consistency
          try {
            await this.linkStudentAccount(
              authUserId,
              data.student_id,
              cleanSchoolId,
              { firstName: data.first_name, lastName: data.last_name }
            );
          } catch (mirrorErr) {
            console.warn('[AccountLinking] Failed to mirror linkage locally, but online activation succeeded:', mirrorErr);
          }

          return {
            success: true,
            studentId: data.student_id,
            firstName: data.first_name,
            lastName: data.last_name,
            alreadyLinked: data.already_linked,
          };
        }

        if (data && !data.success) {
          return {
            success: false,
            error: data.error || 'Invalid activation code or school ID.',
          };
        }
      } catch (netErr: any) {
        return {
          success: false,
          error: netErr?.message || 'Network error during account activation. Please check your connection.',
        };
      }
    }

    // 2. Local fallback verification in SQLite
    const student = await StudentsRepository.getStudentBySchoolId(cleanSchoolId);
    if (!student) {
      return { success: false, error: 'Invalid activation code or school ID.' };
    }

    // Check if already claimed
    const existingUser = await AuthRepository.getUserByStudentId(student.id);
    if (existingUser && existingUser.account_status === 'ACTIVE') {
      if (existingUser.id === authUserId) {
        return {
          success: true,
          studentId: student.id,
          firstName: student.first_name,
          lastName: student.last_name,
          alreadyLinked: true,
        };
      }
      return { success: false, error: 'This student record has already been activated. Please sign in or contact an officer.' };
    }

    const latestClaim = await AuthRepository.getLatestActivationClaimByStudentId(student.id);
    if (!latestClaim || latestClaim.used_at || latestClaim.revoked_at) {
      return { success: false, error: 'Invalid, expired, or already used activation code.' };
    }

    if ((latestClaim.attempt_count ?? 0) >= (latestClaim.max_attempts ?? 5)) {
      return { success: false, error: 'Too many failed activation attempts. Code revoked. Please request a new one from an officer.' };
    }

    if (new Date() > new Date(latestClaim.expires_at)) {
      return { success: false, error: 'This activation code has expired. Please request a new one from an officer.' };
    }

    if (latestClaim.token_hash !== tokenHash) {
      await AuthRepository.incrementActivationAttempt(latestClaim.id);
      await AuthRepository.recordActivationAudit({
        id: 'aud_' + Math.random().toString(36).substring(2, 12),
        claim_id: latestClaim.id,
        student_id: student.id,
        action: 'ATTEMPT_FAILED',
        performed_by_user_id: authUserId,
        notes: 'Incorrect activation code submitted',
        created_at: new Date().toISOString(),
      });
      return { success: false, error: 'Invalid activation code or school ID.' };
    }

    // Mark used and link locally (Link user FIRST so claimed_by_user_id FK constraint is met)
    const now = new Date().toISOString();
    await this.linkStudentAccount(authUserId, student.id, cleanSchoolId);
    await AuthRepository.markActivationClaimUsed(latestClaim.id, now, authUserId);

    await AuthRepository.recordActivationAudit({
      id: 'aud_' + Math.random().toString(36).substring(2, 12),
      claim_id: latestClaim.id,
      student_id: student.id,
      action: 'CLAIMED',
      performed_by_user_id: authUserId,
      notes: 'Student self-registration completed',
      created_at: now,
    });

    return {
      success: true,
      studentId: student.id,
      firstName: student.first_name,
      lastName: student.last_name,
    };
  }

  /**
   * Links Supabase Auth user ID to the local SQLite student record and assigns STUDENT role.
   * Guarantees foreign key satisfaction by ensuring the student row exists or is reconciled in SQLite first.
   */
  public static async linkStudentAccount(
    supabaseUserId: string,
    studentId: string,
    username: string,
    studentData?: { firstName?: string; lastName?: string }
  ): Promise<void> {
    const now = new Date().toISOString();
    const db = await getDatabase();
    const cleanSchoolId = normalizeSchoolId(username);

    // 1. Ensure foreign key exists: check students table in SQLite
    try {
      const localStuBySchoolId = await StudentsRepository.getStudentBySchoolId(cleanSchoolId);
      const localStuById = await StudentsRepository.getStudentById(studentId);

      if (localStuBySchoolId && localStuBySchoolId.id !== studentId) {
        // Reconcile divergent local UUID with authoritative remote student UUID
        await StudentsRepository.reconcileStudentId(localStuBySchoolId.id, studentId, cleanSchoolId);
      } else if (!localStuById && !localStuBySchoolId) {
        // Student record not present in local SQLite yet — create it so users.student_id foreign key succeeds
        await db.execute(
          `INSERT INTO students (id, school_id, first_name, middle_name, last_name, status, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, 'ACTIVE', ?, ?)`,
          [
            studentId,
            cleanSchoolId,
            studentData?.firstName || 'Student',
            studentData?.lastName || cleanSchoolId,
            now,
            now,
          ]
        );
      }
    } catch (reconcileErr) {
      console.warn('[AccountLinking] Student pre-link check error:', reconcileErr);
    }

    // 2. Upsert into local users table
    await db.execute(
      `INSERT INTO users (id, username, student_id, account_status, created_at, updated_at)
       VALUES (?, ?, ?, 'ACTIVE', ?, ?)
       ON CONFLICT(id) DO UPDATE SET student_id = excluded.student_id, updated_at = excluded.updated_at`,
      [supabaseUserId, cleanSchoolId.toLowerCase(), studentId, now, now]
    );

    // 3. Assign STUDENT role locally
    const roleId = 'rol_' + Math.random().toString(36).substring(2, 10);
    await db.execute(
      `INSERT INTO user_roles (id, user_id, role, assigned_at)
       VALUES (?, ?, 'STUDENT', ?)
       ON CONFLICT(id) DO NOTHING`,
      [roleId, supabaseUserId, now]
    );

    // 4. Check and activate pending officer appointment if one exists for this student (Scenario B)
    try {
      const { OfficerRepository } = await import('@/database/repositories/officer.repository');
      await OfficerRepository.activatePendingAppointmentForStudent(studentId, supabaseUserId);
    } catch {
      // Non-fatal
    }
  }
}
