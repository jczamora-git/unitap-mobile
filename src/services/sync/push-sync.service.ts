import { supabase } from '@/integrations/supabase/client';
import { getDatabase } from '@/database/database';
import { SyncStatusService } from './sync-status.service';
import { ConflictService } from './conflict.service';
import { SyncRepository } from '@/database/repositories/sync.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { normalizeSchoolId, getSchoolIdVariants } from '@/utilities/school-id-normalizer';
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
          if (res.status === 'APPLIED' || res.status === 'CONFIRMED' || res.status === 'ALREADY_RECORDED') {
            await db.execute('DELETE FROM sync_outbox WHERE id = ?', [res.id]);
            pushedCount++;
          } else if (res.status === 'REVIEW_REQUIRED') {
            const originalOp = pendingOps.find((o) => o.id === res.id);
            if (originalOp) {
              await ConflictService.recordConflict({
                id: 'conf_' + Math.random().toString(36).substring(2, 10),
                entityType: originalOp.entity_type,
                entityId: originalOp.entity_id,
                conflictType: 'REVOKED_REVIEW_REQUIRED',
                clientPayload: JSON.parse(originalOp.payload_json),
                serverPayload: res.scan_result || res.revoke_result,
                resolution: 'MANUAL_REQUIRED',
              });
            }
            await db.execute('DELETE FROM sync_outbox WHERE id = ?', [res.id]);
            errorCount++;
          } else if (res.status === 'REJECTED_FINAL') {
            const originalOp = pendingOps.find((o) => o.id === res.id);
            if (originalOp) {
              await ConflictService.recordConflict({
                id: 'conf_' + Math.random().toString(36).substring(2, 10),
                entityType: originalOp.entity_type,
                entityId: originalOp.entity_id,
                conflictType: 'REJECTED_FINAL',
                clientPayload: JSON.parse(originalOp.payload_json),
                serverPayload: res,
                resolution: 'SERVER_WINS',
              });
            }
            await db.execute('DELETE FROM sync_outbox WHERE id = ?', [res.id]);
            errorCount++;
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
        if (op.entity_type === 'ATTENDANCE') {
          if (op.operation === 'CREATE' || op.operation === 'UPDATE') {
            const { data: scanRes, error: scanErr } = await supabase.rpc('record_attendance_scan', {
              p_occurrence_id: payload.occurrence_id,
              p_student_id: payload.student_id,
              p_nfc_card_id: payload.nfc_card_id || null,
              p_uid_normalized: payload.uid_normalized || null,
              p_status_override: payload.status,
              p_device_id: 'outbox_push',
              p_idempotency_key: op.id,
              p_client_scanned_at: payload.client_scanned_at || payload.checked_in_at || null,
              p_scan_method: payload.method || 'NFC',
            });
            if (!scanErr && (scanRes?.status === 'RECORDED' || scanRes?.status === 'ALREADY_RECORDED' || scanRes?.status === 'REVOKED_REVIEW_REQUIRED')) {
              success = true;
            } else {
              console.warn(`[PushSync] RPC push attendance rejected:`, scanErr?.message || scanRes?.message);
            }
          } else if (op.operation === 'VOID' || op.operation === 'REVOKE') {
            const { data: revRes, error: revErr } = await supabase.rpc('revoke_attendance', {
              p_attendance_id: op.entity_id,
              p_reason: payload.revocation_reason || payload.void_reason || 'Offline officer revocation',
              p_expected_version: payload.version || null,
              p_idempotency_key: op.id,
            });
            if (!revErr && (revRes?.success || revRes?.status === 'ALREADY_REVOKED')) {
              success = true;
            } else {
              console.warn(`[PushSync] RPC push revoke rejected:`, revErr?.message || revRes?.error);
            }
          }
        } else if (op.entity_type === 'PAYMENT') {
          if (op.operation === 'CREATE') {
            const payRow = payload.payment || payload;
            const allocations = Array.isArray(payload.allocations) ? payload.allocations : [];
            const { error: payErr } = await supabase.from('payments').upsert(payRow);
            if (!payErr) {
              success = true;
              if (allocations.length > 0) {
                const { error: allocErr } = await supabase.from('payment_allocations').upsert(allocations);
                if (allocErr) {
                  console.warn('[PushSync] Warning: Payment allocations insert error:', allocErr.message);
                }
              }
            } else {
              console.warn('[PushSync] Error syncing payment:', payErr.message);
            }
          } else if (op.operation === 'UPDATE' || payload.status === 'REVERSED') {
            const { error: revErr } = await supabase
              .from('payments')
              .update({
                status: 'REVERSED',
                reversed_at: payload.reversed_at || new Date().toISOString(),
                reversed_by_user_id: payload.reversed_by_user_id,
                reversal_reason: payload.reversal_reason || 'Reversed by officer',
              })
              .eq('id', op.entity_id);
            if (!revErr) success = true;
            else console.warn('[PushSync] Error updating payment reversal:', revErr.message);
          }
        } else if (op.entity_type === 'OBLIGATION' && op.operation === 'VOID') {
          const { error } = await supabase
            .from('student_obligations')
            .update({ status: 'VOID', updated_at: new Date().toISOString() })
            .eq('id', op.entity_id);
          if (!error) success = true;
        } else if (op.entity_type === 'STUDENT' && op.operation === 'CREATE') {
          const canonicalId = normalizeSchoolId(payload.school_id);
          const variants = getSchoolIdVariants(payload.school_id);
          const { data: existingRemote } = await supabase
            .from('students')
            .select('id, school_id')
            .or(`id.eq.${op.entity_id},school_id.in.(${variants.join(',')})`)
            .maybeSingle();

          if (existingRemote) {
            if (existingRemote.id !== op.entity_id) {
              await StudentsRepository.reconcileStudentId(op.entity_id, existingRemote.id, canonicalId, db);
            }
            const { error: updErr } = await supabase
              .from('students')
              .update({ ...payload, id: existingRemote.id, school_id: existingRemote.school_id })
              .eq('id', existingRemote.id);
            if (!updErr) success = true;
            else console.warn('[PushSync] Error updating existing remote student:', updErr.message);
          } else {
            const { error: insErr } = await supabase.from('students').insert({
              ...payload,
              school_id: canonicalId,
            });
            if (!insErr) success = true;
            else console.warn('[PushSync] Error inserting new remote student:', insErr.message);
          }
        } else if (op.operation === 'CREATE') {
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
