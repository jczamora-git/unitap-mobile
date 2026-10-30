import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type { NfcCardRecord } from '../../types/database';

export class CardsRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  public static async assignCard(card: NfcCardRecord, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.transaction(async (tx) => {
      const now = new Date().toISOString();
      // 1. Mark existing active card for this student as REPLACED
      await tx.execute(
        `UPDATE nfc_cards
         SET status = 'REPLACED', revoked_at = ?, revoked_by_user_id = ?, reason = 'Replaced by new card'
         WHERE student_id = ? AND status = 'ACTIVE'`,
        [now, card.assigned_by_user_id || null, card.student_id]
      );

      // 2. Insert new active card
      await tx.execute(
        `INSERT INTO nfc_cards (
          id, student_id, uid_normalized, status, assigned_at, assigned_by_user_id, revoked_at, revoked_by_user_id, reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          card.id,
          card.student_id,
          card.uid_normalized,
          card.status,
          card.assigned_at,
          card.assigned_by_user_id || null,
          card.revoked_at || null,
          card.revoked_by_user_id || null,
          card.reason || null,
        ]
      );
    });
  }

  public static async getCardByNormalizedUid(uid: string, adapter?: DatabaseAdapter): Promise<NfcCardRecord | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<NfcCardRecord>(
      'SELECT * FROM nfc_cards WHERE uid_normalized = ? AND status = ?',
      [uid, 'ACTIVE']
    );
  }

  public static async getActiveCardByStudentId(studentId: string, adapter?: DatabaseAdapter): Promise<NfcCardRecord | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<NfcCardRecord>(
      'SELECT * FROM nfc_cards WHERE student_id = ? AND status = ?',
      [studentId, 'ACTIVE']
    );
  }

  public static async getCardsHistoryByStudentId(studentId: string, adapter?: DatabaseAdapter): Promise<NfcCardRecord[]> {
    const db = await this.getDb(adapter);
    return db.query<NfcCardRecord>(
      'SELECT * FROM nfc_cards WHERE student_id = ? ORDER BY assigned_at DESC',
      [studentId]
    );
  }

  public static async revokeCard(
    id: string,
    reason: string,
    revokedByUserId?: string,
    newStatus: 'LOST' | 'REPLACED' | 'DEACTIVATED' = 'DEACTIVATED',
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE nfc_cards
       SET status = ?, revoked_at = ?, revoked_by_user_id = ?, reason = ?
       WHERE id = ?`,
      [newStatus, now, revokedByUserId || null, reason, id]
    );
  }
}

