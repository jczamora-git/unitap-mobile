import { sha256 } from 'hash-wasm';
import { supabase } from './client';
import { getDatabase } from '@/database/database';
import { StudentsRepository } from '@/database/repositories/students.repository';

export interface VerifyActivationClaimResult {
  success: boolean;
  studentId?: string;
  firstName?: string;
  lastName?: string;
  error?: string;
}

export class AccountLinkingService {
  /**
   * Hashes the 8-character officer-issued code using SHA-256
   */
  public static async hashActivationCode(rawCode: string): Promise<string> {
    const clean = rawCode.trim().toUpperCase();
    return sha256(clean);
  }

  /**
   * Verifies an activation code claim online with Supabase or falls back to local verification when configured
   */
  public static async verifyActivationClaim(
    schoolId: string,
    rawCode: string
  ): Promise<VerifyActivationClaimResult> {
    const cleanSchoolId = schoolId.trim();
    const tokenHash = await this.hashActivationCode(rawCode);

    try {
      // 1. Online verification via Supabase RPC
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

      if (error) {
        console.warn('[AccountLinking] RPC error, checking local SQLite fallback:', error.message);
      }
    } catch (netErr) {
      console.warn('[AccountLinking] Network error during activation claim verify:', netErr);
    }

    // 2. Local fallback verification in SQLite
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

    // Mark used in local database
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
   * Links Supabase Auth user ID to the local and remote student record
   */
  public static async linkStudentAccount(
    supabaseUserId: string,
    studentId: string,
    username: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const db = await getDatabase();

    // Upsert into local users table
    await db.execute(
      `INSERT INTO users (id, username, student_id, account_status, created_at, updated_at)
       VALUES (?, ?, ?, 'ACTIVE', ?, ?)
       ON CONFLICT(id) DO UPDATE SET student_id = excluded.student_id, updated_at = excluded.updated_at`,
      [supabaseUserId, username, studentId, now, now]
    );

    // Assign STUDENT role locally
    const roleId = 'rol_' + Math.random().toString(36).substring(2, 10);
    await db.execute(
      `INSERT INTO user_roles (id, user_id, role, assigned_at)
       VALUES (?, ?, 'STUDENT', ?)
       ON CONFLICT(id) DO NOTHING`,
      [roleId, supabaseUserId, now]
    );
  }
}

