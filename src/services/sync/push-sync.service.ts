import { supabase } from '@/integrations/supabase/client';
import { getDatabase } from '@/database/database';
import { SyncStatusService } from './sync-status.service';
import { ConflictService } from './conflict.service';
import { SyncRepository } from '@/database/repositories/sync.repository';
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

    // 1. Attempt atomic batch push via PostgreSQL RPC (1 Single Request)
    try {
      const ops = pendingOps.map((op) => ({
        id: op.id,
        entity_type: op.entity_type,
        entity_id: op.entity_id,
        operation: op.operation,
        payload: JSON.parse(op.payload_json),
      }));

      const { data: batchRes, error: batchErr } = await supabase.rpc('sync_push_batch', {
        p_operations: ops,
      });

      if (batchErr) {
        console.error('[PushSync] Batch push RPC error:', batchErr);
        SyncStatusService.setLastError(batchErr.message || 'Server RPC error');
      }

      if (!batchErr && batchRes && Array.isArray(batchRes.results)) {
        for (const res of batchRes.results) {
          if (res.status === 'APPLIED') {
            await db.execute('DELETE FROM sync_outbox WHERE id = ?', [res.id]);
            pushedCount++;
          } else if (res.status === 'COLLISION_AUDITED') {
            const originalOp = pendingOps.find((o) => o.id === res.id);
            if (originalOp) {
              await ConflictService.recordConflict({
                id: 'conf_' + Math.random().toString(36).substring(2, 10),
                entityType: originalOp.entity_type,
                entityId: originalOp.entity_id,
                conflictType: 'UNIQUE_CONSTRAINT_COLLISION',
                clientPayload: JSON.parse(originalOp.payload_json),
                resolution: 'SERVER_WINS',
              });
            }
            await db.execute('DELETE FROM sync_outbox WHERE id = ?', [res.id]);
            pushedCount++;
          } else {
            errorCount++;
            const errMsg = res.error || 'Server rejected outbox operation';
            console.error(`[PushSync] Outbox operation ${res.id} rejected by server:`, errMsg);
            SyncStatusService.setLastError(errMsg);
            await db.execute(
              'UPDATE sync_outbox SET last_error = ?, retry_count = retry_count + 1 WHERE id = ?',
              [errMsg, res.id]
            );
          }
        }

        const remaining = await db.queryOne<{ count: number }>(
          'SELECT count(*) as count FROM sync_outbox'
        );
        const count = remaining?.count || 0;
        SyncStatusService.setPendingCount(count);

        if (errorCount > 0) {
          SyncStatusService.setState('SYNC_ERROR');
        } else if (count === 0) {
          SyncStatusService.setLastError(null);
          SyncStatusService.setState('SYNCED');
        }

        return { pushedCount, errorCount };
      }
    } catch {
      // Fallback to sequential table-by-table REST calls
    }

    // 2. Fallback: Sequential table-by-table REST push
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
          const errMsg = 'REST push rejected: ' + op.entity_type;
          console.error(`[PushSync] REST operation ${op.id} rejected:`, errMsg);
          SyncStatusService.setLastError(errMsg);
          await db.execute(
            'UPDATE sync_outbox SET last_error = ?, retry_count = retry_count + 1 WHERE id = ?',
            [errMsg, op.id]
          );
        }
      } catch (err: unknown) {
        console.error(`[PushSync] Failed to process operation ${op.id}:`, err);
        const errMsg = err instanceof Error ? err.message : String(err);
        SyncStatusService.setLastError(errMsg);
        await db.execute(
          'UPDATE sync_outbox SET last_error = ?, retry_count = retry_count + 1 WHERE id = ?',
          [errMsg, op.id]
        );
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
      SyncStatusService.setLastError(null);
      SyncStatusService.setState('SYNCED');
    }

    return { pushedCount, errorCount };
  }

  public static async getPendingOutbox(): Promise<SyncOutboxRecord[]> {
    return SyncRepository.getAllPendingOutbox();
  }

  public static async clearPendingOutbox(): Promise<void> {
    await SyncRepository.clearOutbox();
    SyncStatusService.setPendingCount(0);
    SyncStatusService.setLastError(null);
    SyncStatusService.setState('SYNCED');
  }

  public static async deletePendingItem(id: string): Promise<void> {
    await SyncRepository.deleteOutboxItem(id);
    const db = await getDatabase();
    const count = await db.queryOne<{ count: number }>('SELECT count(*) as count FROM sync_outbox');
    const remaining = count?.count || 0;
    SyncStatusService.setPendingCount(remaining);
    if (remaining === 0) {
      SyncStatusService.setLastError(null);
      SyncStatusService.setState('SYNCED');
    }
  }

  private static mapEntityTypeToTable(entityType: string): string {
    const map: Record<string, string> = {
      ATTENDANCE: 'attendance_records',
      ATTENDANCE_ATTEMPT: 'attendance_attempts',
      ATTENDANCE_VOID: 'attendance_audit',
      OBLIGATION: 'student_obligations',
      OBLIGATION_RULE: 'obligation_rules',
      PAYMENT: 'payments',
      PAYMENT_ALLOCATION: 'payment_allocations',
      STUDENT: 'students',
      ENROLLMENT: 'student_enrollments',
      CARD: 'nfc_cards',
      EVENT: 'events',
      EVENT_CATEGORY: 'event_categories',
      YEAR_LEVEL: 'year_levels',
      SECTION: 'sections',
      ACADEMIC_YEAR: 'academic_years',
      SEMESTER: 'semesters',
      OCCURRENCE: 'event_occurrences',
      PARTICIPANT: 'event_participants',
    };
    return map[entityType] || entityType.toLowerCase() + 's';
  }
}
