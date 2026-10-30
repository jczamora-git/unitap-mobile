import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type {
  UserAccount,
  UserCredential,
  UserRoleRecord,
  DeviceRecord,
  ActivationClaim,
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
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
         VALUES (?, ?, ?, ?, ?)`,
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
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
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

  public static async createActivationClaim(claim: ActivationClaim, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO activation_claims (id, student_id, token_hash, issued_by_user_id, expires_at, used_at, revoked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        claim.id,
        claim.student_id,
        claim.token_hash,
        claim.issued_by_user_id,
        claim.expires_at,
        claim.used_at || null,
        claim.revoked_at || null,
        claim.created_at,
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

  public static async markActivationClaimUsed(claimId: string, usedAt: string, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute('UPDATE activation_claims SET used_at = ? WHERE id = ?', [usedAt, claimId]);
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

