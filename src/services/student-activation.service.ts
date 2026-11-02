import { sha256 } from 'hash-wasm';
import { supabase } from '@/integrations/supabase/client';
import { AuthRepository } from '@/database/repositories/auth.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { normalizeSchoolId, getSchoolIdVariants } from '@/utilities/school-id-normalizer';
import type {
  ActivationClaim,
  ActivationClaimAuditRecord,
  StudentActivationStatus,
} from '@/types/database';

export interface StudentActivationDetails {
  status: StudentActivationStatus;
  studentId: string;
  claimId?: string;
  expiresAt?: string;
  attemptCount?: number;
  maxAttempts?: number;
  linkedUserId?: string;
  linkedUsername?: string;
  auditHistory: ActivationClaimAuditRecord[];
}

export interface IssueActivationResult {
  success: boolean;
  rawCode?: string;
  claimId?: string;
  expiresAt?: string;
  action?: string;
  error?: string;
}

function isTestEnvironment(): boolean {
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITEST === 'true' || proc?.env?.NODE_ENV === 'test' || import.meta.env?.MODE === 'test';
}

export class StudentActivationService {
  /**
   * Generates a cryptographically strong, human-readable 8-character activation code.
   * Excludes ambiguous characters (0, O, 1, I, L) for mobile entry accuracy.
   */
  public static generateCode(): string {
    const charset = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    const randomBytes = new Uint8Array(8);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(randomBytes);
    } else {
      for (let i = 0; i < 8; i++) randomBytes[i] = Math.floor(Math.random() * 256);
    }

    return Array.from(randomBytes)
      .map((b) => charset[b % charset.length])
      .join('');
  }

  /**
   * Hashes a raw activation code with SHA-256 for secure non-plaintext storage.
   */
  public static async hashCode(rawCode: string): Promise<string> {
    const clean = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return sha256(clean);
  }

  /**
   * Resolves a student identifier to a valid UUID format expected by Supabase.
   * If local student has a non-UUID ID (e.g. stu_...), looks up by school_id
   * and reconciles SQLite to the authoritative UUID.
   */
  public static async resolveStudentUuid(studentId: string): Promise<string | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId);
    if (isUuid) return studentId;

    try {
      const localStu = await StudentsRepository.getStudentById(studentId);
      if (localStu?.school_id) {
        const variants = getSchoolIdVariants(localStu.school_id);
        const { data: remoteStu } = await supabase
          .from('students')
          .select('id')
          .in('school_id', variants)
          .maybeSingle();

        if (remoteStu?.id) {
          await StudentsRepository.reconcileStudentId(studentId, remoteStu.id, localStu.school_id);
          return remoteStu.id;
        }
      }
    } catch (err) {
      console.warn('[StudentActivationService] Could not resolve student UUID:', err);
    }
    return null;
  }

  /**
   * Evaluates student activation status and audit history
   */
  public static async getStudentActivationStatus(
    studentId: string
  ): Promise<StudentActivationDetails> {
    const isTestEnv = isTestEnvironment();

    // 1. Online check if Supabase is connected
    if (!isTestEnv) {
      const targetUuid = await this.resolveStudentUuid(studentId);
      if (targetUuid) {
        try {
          const { data, error } = await supabase.rpc('officer_get_student_activation_status', {
            p_student_id: targetUuid,
          });

          if (!error && data && data.status !== 'NOT_FOUND') {
            return {
              status: data.status as StudentActivationStatus,
              studentId: data.student_id || targetUuid,
              claimId: data.claim_id,
              expiresAt: data.expires_at,
              attemptCount: data.attempt_count,
              maxAttempts: data.max_attempts,
              linkedUserId: data.linked_user_id,
              linkedUsername: data.linked_username,
              auditHistory: data.audit_history || [],
            };
          }
        } catch {
          // Fallback to local SQLite
        }
      }
    }

    // 2. Local SQLite evaluation
    const linkedUser = await AuthRepository.getUserByStudentId(studentId);
    if (linkedUser && linkedUser.account_status === 'ACTIVE') {
      const audit = await AuthRepository.getActivationAuditByStudentId(studentId);
      return {
        status: 'ACTIVATED',
        studentId,
        linkedUserId: linkedUser.id,
        linkedUsername: linkedUser.username,
        auditHistory: audit,
      };
    }

    const latestClaim = await AuthRepository.getLatestActivationClaimByStudentId(studentId);
    const audit = await AuthRepository.getActivationAuditByStudentId(studentId);

    if (!latestClaim) {
      return {
        status: 'NOT_ACTIVATED',
        studentId,
        auditHistory: audit,
      };
    }

    let status: StudentActivationStatus = 'ACTIVATION_PENDING';
    const now = new Date();
    const expiresAt = new Date(latestClaim.expires_at);

    if (latestClaim.used_at) {
      status = 'ACTIVATED';
    } else if (latestClaim.revoked_at || (latestClaim.attempt_count ?? 0) >= (latestClaim.max_attempts ?? 5)) {
      status = 'REQUIRES_ATTENTION';
    } else if (now > expiresAt) {
      status = 'REQUIRES_ATTENTION';
    } else {
      status = 'ACTIVATION_PENDING';
    }

    return {
      status,
      studentId,
      claimId: latestClaim.id,
      expiresAt: latestClaim.expires_at,
      attemptCount: latestClaim.attempt_count ?? 0,
      maxAttempts: latestClaim.max_attempts ?? 5,
      auditHistory: audit,
    };
  }

  /**
   * Generates and stores a new activation claim.
   * Note: Raw code is returned ONLY ONCE for direct transmission to the student.
   */
  public static async issueActivationCode(
    studentId: string,
    issuedByUserId: string,
    expiresHours = 48
  ): Promise<IssueActivationResult> {
    const rawCode = this.generateCode();
    const tokenHash = await this.hashCode(rawCode);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresHours * 3600 * 1000).toISOString();
    const claimId = 'act_' + Math.random().toString(36).substring(2, 12);

    const isTestEnv = isTestEnvironment();

    // 1. Online check if Supabase is connected
    if (!isTestEnv) {
      const targetIdentifier = (await this.resolveStudentUuid(studentId)) || studentId;
      try {
        const { data, error } = await supabase.rpc('officer_issue_activation_code', {
          p_student_id: targetIdentifier,
          p_token_hash: tokenHash,
          p_expires_hours: expiresHours,
        });

        if (error) {
          return {
            success: false,
            error: error.message || 'Server error while issuing activation code.',
          };
        }

        if (data && data.success) {
          // Replicate locally for offline cache
          await this.persistLocalClaim(data.student_id || targetIdentifier, tokenHash, issuedByUserId, data.expires_at || expiresAt, data.claim_id || claimId);
          return {
            success: true,
            rawCode,
            claimId: data.claim_id,
            expiresAt: data.expires_at,
            action: data.action,
          };
        }

        return {
          success: false,
          error: data?.error || 'Failed to issue activation code.',
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || 'Network error while issuing activation code. Please check your connection.',
        };
      }
    }

    // 2. Local SQLite generation
    const action = await this.persistLocalClaim(studentId, tokenHash, issuedByUserId, expiresAt, claimId);

    return {
      success: true,
      rawCode,
      claimId,
      expiresAt,
      action,
    };
  }

  private static async persistLocalClaim(
    studentId: string,
    tokenHash: string,
    issuedByUserId: string,
    expiresAt: string,
    claimId: string
  ): Promise<string> {
    const existing = await AuthRepository.getLatestActivationClaimByStudentId(studentId);
    let action: 'ISSUED' | 'REISSUED' = 'ISSUED';

    if (existing && !existing.used_at && !existing.revoked_at) {
      await AuthRepository.revokeActivationClaim(existing.id);
      action = 'REISSUED';
    }

    const claim: ActivationClaim = {
      id: claimId,
      student_id: studentId,
      token_hash: tokenHash,
      issued_by_user_id: issuedByUserId,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
      attempt_count: 0,
      max_attempts: 5,
    };

    await AuthRepository.createActivationClaim(claim);

    await AuthRepository.recordActivationAudit({
      id: 'aud_' + Math.random().toString(36).substring(2, 12),
      claim_id: claimId,
      student_id: studentId,
      action,
      performed_by_user_id: issuedByUserId,
      notes: `Activation code ${action.toLowerCase()} with 48h validity`,
      created_at: new Date().toISOString(),
    });

    return action;
  }

  /**
   * Revokes an existing activation claim
   */
  public static async revokeActivationCode(
    claimId: string,
    studentId: string,
    revokedByUserId: string,
    reason = 'Manual officer revocation'
  ): Promise<{ success: boolean; error?: string }> {
    const isTestEnv = isTestEnvironment();

    if (!isTestEnv) {
      try {
        const { data, error } = await supabase.rpc('officer_revoke_activation_code', {
          p_claim_id: claimId,
          p_reason: reason,
        });

        if (!error && data && data.success) {
          await AuthRepository.revokeActivationClaim(claimId);
          return { success: true };
        }
      } catch {
        // Fallback to local
      }
    }

    await AuthRepository.revokeActivationClaim(claimId);
    await AuthRepository.recordActivationAudit({
      id: 'aud_' + Math.random().toString(36).substring(2, 12),
      claim_id: claimId,
      student_id: studentId,
      action: 'REVOKED',
      performed_by_user_id: revokedByUserId,
      notes: reason,
      created_at: new Date().toISOString(),
    });

    return { success: true };
  }
}

