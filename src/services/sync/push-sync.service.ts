import { supabase } from '@/integrations/supabase/client';
import { getDatabase } from '@/database/database';
import { SyncStatusService } from './sync-status.service';
import { ConflictService } from './conflict.service';
import type { SyncOutboxRecord } from '@/types/database';

export class PushSyncService {
  /**
   * Pushes all pending operations in the sync_outbox to Supabase
   */
  public static async pushPendingOperations(): Promise<{ pushedCount: number; errorCount: number }> {
    const db = await getDatabase();
    const pendingOps = await db.query<SyncOutboxRecord>(
      'SELECT * FROM sync_outbox ORDER BY created_at ASC LIMIT 50'
    );

    SyncStatusService.setPendingCount(pendingOps.length);
    if (pendingOps.length === 0) {
      return { pushedCount: 0, errorCount: 0 };
    }

    SyncStatusService.setState('SYNCING');
    let pushedCount = 0;
    let errorCount = 0;

    for (const op of pendingOps) {
      try {
        const payload = JSON.parse(op.payload_json);
        const targetTable = this.mapEntityTypeToTable(op.entity_type);

        let success = false;
        if (op.operation === 'CREATE') {
          const { error } = await supabase.from(targetTable).upsert(payload);
          if (!error) success = true;
          else if (error.code === '23505') {
            // Unique violation (e.g. duplicate attendance or duplicate card)
            await ConflictService.recordConflict({
              id: 'conf_' + Math.random().toString(36).substring(2, 10),
              entityType: op.entity_type,
              entityId: op.entity_id,
              conflictType: 'UNIQUE_CONSTRAINT_COLLISION',
              clientPayload: payload,
              resolution: 'SERVER_WINS',
            });
            success = true; // Resolve outbox since collision was audited
          } else {
            console.warn(`[PushSync] Error syncing ${op.entity_type}:`, error.message);
          }
        } else if (op.operation === 'UPDATE') {
          const { error } = await supabase.from(targetTable).update(payload).eq('id', op.entity_id);
          if (!error) success = true;
        } else if (op.operation === 'VOID' || op.operation === 'REVOKE') {
          const { error } = await supabase.from(targetTable).update({ status: op.operation }).eq('id', op.entity_id);
          if (!error) success = true;
        }

        if (success) {
          // Delete from outbox upon durable delivery
          await db.execute('DELETE FROM sync_outbox WHERE id = ?', [op.id]);
          pushedCount++;
        } else {
          errorCount++;
        }
      } catch (err: unknown) {
        console.error(`[PushSync] Failed to process operation ${op.id}:`, err);
        errorCount++;
      }
    }

    // Refresh pending count
    const remaining = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM sync_outbox'
    );
    const count = remaining?.count || 0;
    SyncStatusService.setPendingCount(count);

    if (errorCount > 0) {
      SyncStatusService.setState('SYNC_ERROR');
    } else if (count === 0) {
      SyncStatusService.setState('SYNCED');
    }

    return { pushedCount, errorCount };
  }

  private static mapEntityTypeToTable(entityType: string): string {
    const map: Record<string, string> = {
      ATTENDANCE: 'attendance_records',
      ATTENDANCE_ATTEMPT: 'attendance_attempts',
      ATTENDANCE_VOID: 'attendance_audit',
      OBLIGATION: 'student_obligations',
      PAYMENT: 'payments',
      PAYMENT_ALLOCATION: 'payment_allocations',
      WALLET_LEDGER: 'simulated_wallet_ledger',
      STUDENT: 'students',
      ENROLLMENT: 'student_enrollments',
      CARD: 'nfc_cards',
      EVENT: 'events',
      OCCURRENCE: 'event_occurrences',
    };
    return map[entityType] || entityType.toLowerCase() + 's';
  }
}
