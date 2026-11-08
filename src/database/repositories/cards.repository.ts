import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type { NfcCardRecord } from '../../types/database';
import { DataModeService } from '@/services/data-mode.service';
import { supabase } from '@/integrations/supabase/client';

export class CardsRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  public static async assignCard(card: NfcCardRecord, adapter?: DatabaseAdapter): Promise<void> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const now = new Date().toISOString();
      await supabase
        .from('nfc_cards')
        .update({ status: 'REPLACED', deactivated_at: now, note: 'Replaced by new card' })
        .eq('student_id', card.student_id)
        .eq('status', 'ACTIVE');

      const { error } = await supabase.from('nfc_cards').insert({
        id: card.id,
        student_id: card.student_id,
        uid_normalized: card.uid_normalized,
        status: card.status,
        assigned_at: card.assigned_at,
        note: card.reason || null,
      });
      if (error) throw new Error(`Failed to assign NFC card on Supabase: ${error.message}`);
      return;
    }

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
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('nfc_cards')
        .select('*')
        .eq('uid_normalized', uid)
        .eq('status', 'ACTIVE')
        .maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id,
        student_id: data.student_id,
        uid_normalized: data.uid_normalized,
        status: data.status,
        assigned_at: data.assigned_at,
        assigned_by_user_id: data.assigned_by_user_id || null,
        revoked_at: data.deactivated_at || null,
        revoked_by_user_id: null,
        reason: data.note || null,
      };
    }

    const db = await this.getDb(adapter);
    return db.queryOne<NfcCardRecord>(
      'SELECT * FROM nfc_cards WHERE uid_normalized = ? AND status = ?',
      [uid, 'ACTIVE']
    );
  }

  public static async getActiveCardByStudentId(studentId: string, adapter?: DatabaseAdapter): Promise<NfcCardRecord | null> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('nfc_cards')
        .select('*')
        .eq('student_id', studentId)
        .eq('status', 'ACTIVE')
        .maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id,
        student_id: data.student_id,
        uid_normalized: data.uid_normalized,
        status: data.status,
        assigned_at: data.assigned_at,
        assigned_by_user_id: data.assigned_by_user_id || null,
        revoked_at: data.deactivated_at || null,
        revoked_by_user_id: null,
        reason: data.note || null,
      };
    }

    const db = await this.getDb(adapter);
    return db.queryOne<NfcCardRecord>(
      'SELECT * FROM nfc_cards WHERE student_id = ? AND status = ?',
      [studentId, 'ACTIVE']
    );
  }

  public static async getCardsHistoryByStudentId(studentId: string, adapter?: DatabaseAdapter): Promise<NfcCardRecord[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('nfc_cards')
        .select('*')
        .eq('student_id', studentId)
        .order('assigned_at', { ascending: false });
      if (error) throw new Error(`Failed to query cards from Supabase: ${error.message}`);
      return (data || []).map((c: any) => ({
        id: c.id,
        student_id: c.student_id,
        uid_normalized: c.uid_normalized,
        status: c.status,
        assigned_at: c.assigned_at,
        assigned_by_user_id: c.assigned_by_user_id || null,
        revoked_at: c.deactivated_at || null,
        revoked_by_user_id: null,
        reason: c.note || null,
      }));
    }

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
    if (!adapter && DataModeService.isDirectSupabase()) {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('nfc_cards')
        .update({
          status: newStatus,
          deactivated_at: now,
          note: reason,
        })
        .eq('id', id);
      if (error) throw new Error(`Failed to revoke card on Supabase: ${error.message}`);
      return;
    }

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

