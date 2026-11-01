import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type {
  UserAccount,
  UserCredential,
  UserRoleRecord,
  DeviceRecord,
  ActivationClaim,
  ActivationClaimAuditRecord,
} from '../../types/database';

export class AuthRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  public static async createUserWithCredentials(
    user: UserAccount,
    credential: UserCredential,
    role: UserRoleRecord,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    await db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO users (id, username, student_id, account_status, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           username = excluded.username,
           account_status = excluded.account_status,
           updated_at = excluded.updated_at`,
        [
          user.id,
          user.username,
          user.student_id || null,
          user.account_status,
          user.created_by_user_id || null,
          user.created_at,
          user.updated_at,
        ]
      );

      await tx.execute(
        `INSERT INTO user_credentials (user_id, password_hash, algorithm, provisioned_at, last_online_verified_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           provisioned_at = excluded.provisioned_at`,
        [
          credential.user_id,
          credential.password_hash,
          credential.algorithm,
          credential.provisioned_at,
          credential.last_online_verified_at || null,
        ]
      );

      await tx.execute(
        `INSERT INTO user_roles (id, user_id, role, semester_id, assigned_by_user_id, assigned_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           role = excluded.role,
           assigned_at = excluded.assigned_at`,
        [
          role.id,
          role.user_id,
          role.role,
          role.semester_id || null,
          role.assigned_by_user_id || null,
          role.assigned_at,
          role.revoked_at || null,
        ]
      );
    });
  }

  public static async getUserByUsername(username: string, adapter?: DatabaseAdapter): Promise<UserAccount | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<UserAccount>('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username]);
  }

  public static async getUserById(id: string, adapter?: DatabaseAdapter): Promise<UserAccount | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<UserAccount>('SELECT * FROM users WHERE id = ?', [id]);
  }

  public static async getUserByStudentId(studentId: string, adapter?: DatabaseAdapter): Promise<UserAccount | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<UserAccount>('SELECT * FROM users WHERE student_id = ?', [studentId]);
  }

  public static async getUserCredentials(userId: string, adapter?: DatabaseAdapter): Promise<UserCredential | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<UserCredential>('SELECT * FROM user_credentials WHERE user_id = ?', [userId]);
  }

  public static async getUserRoles(userId: string, adapter?: DatabaseAdapter): Promise<UserRoleRecord[]> {
    const db = await this.getDb(adapter);
    return db.query<UserRoleRecord>(
      'SELECT * FROM user_roles WHERE user_id = ? AND revoked_at IS NULL ORDER BY assigned_at DESC',
      [userId]
    );
  }

  public static async assignUserRole(role: UserRoleRecord, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO user_roles (id, user_id, role, semester_id, assigned_by_user_id, assigned_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         role = excluded.role,
         assigned_at = excluded.assigned_at,
         revoked_at = excluded.revoked_at`,
      [
        role.id,
        role.user_id,
        role.role,
        role.semester_id || null,
        role.assigned_by_user_id || null,
        role.assigned_at,
        role.revoked_at || null,
      ]
    );
  }

  public static async createActivationClaim(claim: ActivationClaim, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO activation_claims (
        id, student_id, token_hash, issued_by_user_id, expires_at, used_at, revoked_at, created_at,
        attempt_count, max_attempts, claimed_by_user_id, last_attempt_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        claim.id,
        claim.student_id,
        claim.token_hash,
        claim.issued_by_user_id,
        claim.expires_at,
        claim.used_at || null,
        claim.revoked_at || null,
        claim.created_at,
        claim.attempt_count ?? 0,
        claim.max_attempts ?? 5,
        claim.claimed_by_user_id || null,
        claim.last_attempt_at || null,
      ]
    );
  }

  public static async getActivationClaimByHash(tokenHash: string, adapter?: DatabaseAdapter): Promise<ActivationClaim | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<ActivationClaim>(
      'SELECT * FROM activation_claims WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL',
      [tokenHash]
    );
  }

  public static async getLatestActivationClaimByStudentId(studentId: string, adapter?: DatabaseAdapter): Promise<ActivationClaim | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<ActivationClaim>(
      'SELECT * FROM activation_claims WHERE student_id = ? ORDER BY created_at DESC LIMIT 1',
      [studentId]
    );
  }

  public static async markActivationClaimUsed(claimId: string, usedAt: string, claimedByUserId?: string, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      'UPDATE activation_claims SET used_at = ?, claimed_by_user_id = coalesce(?, claimed_by_user_id) WHERE id = ?',
      [usedAt, claimedByUserId || null, claimId]
    );
  }

  public static async revokeActivationClaim(claimId: string, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute('UPDATE activation_claims SET revoked_at = ? WHERE id = ?', [new Date().toISOString(), claimId]);
  }

  public static async incrementActivationAttempt(claimId: string, adapter?: DatabaseAdapter): Promise<number> {
    const db = await this.getDb(adapter);
    const now = new Date().toISOString();
    await db.execute(
      'UPDATE activation_claims SET attempt_count = attempt_count + 1, last_attempt_at = ? WHERE id = ?',
      [now, claimId]
    );
    const row = await db.queryOne<{ attempt_count: number; max_attempts: number }>(
      'SELECT attempt_count, max_attempts FROM activation_claims WHERE id = ?',
      [claimId]
    );
    if (row && row.attempt_count >= row.max_attempts) {
      await db.execute('UPDATE activation_claims SET revoked_at = ? WHERE id = ?', [now, claimId]);
    }
    return row?.attempt_count ?? 1;
  }

  public static async recordActivationAudit(audit: ActivationClaimAuditRecord, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO activation_claims_audit (id, claim_id, student_id, action, performed_by_user_id, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        audit.id,
        audit.claim_id || null,
        audit.student_id,
        audit.action,
        audit.performed_by_user_id || null,
        audit.notes || null,
        audit.created_at,
      ]
    );
  }

  public static async getActivationAuditByStudentId(studentId: string, adapter?: DatabaseAdapter): Promise<ActivationClaimAuditRecord[]> {
    const db = await this.getDb(adapter);
    return db.query<ActivationClaimAuditRecord>(
      'SELECT * FROM activation_claims_audit WHERE student_id = ? ORDER BY created_at DESC LIMIT 20',
      [studentId]
    );
  }

  public static async registerDevice(device: DeviceRecord, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO devices (id, device_name, device_code, status, provisioned_by_user_id, provisioned_at, last_sync_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET device_name=excluded.device_name, status=excluded.status`,
      [
        device.id,
        device.device_name,
        device.device_code,
        device.status,
        device.provisioned_by_user_id || null,
        device.provisioned_at,
        device.last_sync_at || null,
      ]
    );
  }

  public static async getDeviceByCode(code: string, adapter?: DatabaseAdapter): Promise<DeviceRecord | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<DeviceRecord>('SELECT * FROM devices WHERE device_code = ?', [code]);
  }
}

