import { supabase } from '@/integrations/supabase/client';
import { getDatabase } from '@/database/database';
import type { DatabaseAdapter } from '@/database/adapters/database-adapter.interface';
import { SyncStatusService, type PushSyncProgress } from './sync-status.service';
import { ConflictService } from './conflict.service';
import { SyncAuditLogService } from './sync-audit-log.service';
import { SyncRepository } from '@/database/repositories/sync.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { FinanceRepository } from '@/database/repositories/finance.repository';
import { normalizeSchoolId, getSchoolIdVariants } from '@/utilities/school-id-normalizer';
import type { SyncOutboxRecord } from '@/types/database';

export interface PushSyncOptions {
  batchSize?: number;
  onProgress?: (progress: PushSyncProgress) => void;
}

export interface PushSyncResult {
  pushedCount: number;
  errorCount: number;
  confirmedCount: number;
  failedCount: number;
  blockedCount: number;
  conflictCount: number;
  attemptedCount: number;
}

export function checkDependencyBlocked(
  op: SyncOutboxRecord,
  failedEntityIds: Set<string>
): { blocked: boolean; reason?: string } {
  if (failedEntityIds.has(op.entity_id)) {
    return { blocked: true, reason: `Prerequisite entity ${op.entity_id} failed` };
  }

  try {
    const payload = op.payload_json ? JSON.parse(op.payload_json) : null;
    if (payload && typeof payload === 'object') {
      if (payload.student_id && failedEntityIds.has(payload.student_id)) {
        return { blocked: true, reason: `Prerequisite student ${payload.student_id} failed` };
      }
      if (payload.rule_id && failedEntityIds.has(payload.rule_id)) {
        return { blocked: true, reason: `Prerequisite obligation rule ${payload.rule_id} failed` };
      }
      if (payload.obligation_id && failedEntityIds.has(payload.obligation_id)) {
        return { blocked: true, reason: `Prerequisite obligation ${payload.obligation_id} failed` };
      }
      if (payload.occurrence_id && failedEntityIds.has(payload.occurrence_id)) {
        return { blocked: true, reason: `Prerequisite occurrence ${payload.occurrence_id} failed` };
      }
      if (payload.event_id && failedEntityIds.has(payload.event_id)) {
        return { blocked: true, reason: `Prerequisite event ${payload.event_id} failed` };
      }
      if (payload.semester_id && failedEntityIds.has(payload.semester_id)) {
        return { blocked: true, reason: `Prerequisite semester ${payload.semester_id} failed` };
      }
      if (Array.isArray(payload.allocations)) {
        for (const alloc of payload.allocations) {
          if (alloc?.obligation_id && failedEntityIds.has(alloc.obligation_id)) {
            return { blocked: true, reason: `Prerequisite allocated obligation ${alloc.obligation_id} failed` };
          }
        }
      }
    }
  } catch {
    // Ignore JSON parse errors here
  }

  return { blocked: false };
}

export const SYNC_ENTITY_DEPENDENCY_ORDER: readonly string[] = [
  'ACADEMIC_YEAR',
  'SEMESTER',
  'PROGRAM',
  'YEAR_LEVEL',
  'SECTION',
  'STUDENT',
  'ENROLLMENT',
  'CARD',
  'EVENT_CATEGORY',
  'EVENT',
  'OCCURRENCE',
  'PARTICIPANT',
  'ATTENDANCE',
  'ATTENDANCE_VOID',
  'OBLIGATION_RULE',
  'OBLIGATION',
  'PAYMENT',
  'PAYMENT_ALLOCATION',
] as const;

export function getEntityPriority(entityType: string): number {
  const normalized = entityType.toUpperCase().trim();
  const idx = SYNC_ENTITY_DEPENDENCY_ORDER.indexOf(normalized);
  return idx === -1 ? 999 : idx;
}

export function sanitizePayloadForRemote(entityType: string, raw: Record<string, any>): Record<string, any> {
  if (!raw || typeof raw !== 'object') return raw;
  const type = entityType.toUpperCase().trim();
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (type === 'OBLIGATION_RULE') {
    let ruleId = raw.id;
    if (typeof ruleId === 'string' && ruleId.startsWith('rule_')) {
      const suffix = ruleId.substring(5);
      if (UUID_REGEX.test(suffix)) {
        ruleId = suffix.toLowerCase();
      }
    }
    return {
      id: ruleId,
      semester_id: raw.semester_id,
      name: raw.name || raw.title || 'Obligation Rule',
      type: raw.type || 'FINE',
      trigger_type: raw.trigger_type || 'MANUAL',
      default_amount_centavos: raw.default_amount_centavos ?? raw.amount_centavos ?? 0,
      status: raw.status || 'ACTIVE',
      created_at: raw.created_at || new Date().toISOString(),
      updated_at: raw.updated_at || raw.created_at || new Date().toISOString(),
    };
  }

  if (type === 'OBLIGATION' || type === 'STUDENT_OBLIGATION') {
    let ruleId = raw.rule_id;
    if (typeof ruleId === 'string' && ruleId.startsWith('rule_')) {
      const suffix = ruleId.substring(5);
      if (UUID_REGEX.test(suffix)) {
        ruleId = suffix.toLowerCase();
      }
    }
    const payload: Record<string, any> = {
      id: raw.id,
      student_id: raw.student_id,
      semester_id: raw.semester_id,
      title: raw.title || 'Student Obligation',
      type: raw.type || 'FINE',
      amount_centavos: raw.amount_centavos,
      status: raw.status || 'ACTIVE',
      issued_at: raw.issued_at || new Date().toISOString(),
      updated_at: raw.updated_at || raw.issued_at || new Date().toISOString(),
    };
    if (ruleId) payload.rule_id = ruleId;
    if (raw.due_date) payload.due_date = raw.due_date;
    if (raw.related_event_id) payload.related_event_id = raw.related_event_id;
    if (raw.related_occurrence_id) payload.related_occurrence_id = raw.related_occurrence_id;
    if (raw.voided_at) payload.voided_at = raw.voided_at;
    if (raw.void_reason) payload.void_reason = raw.void_reason;
    return payload;
  }

  if (type === 'STUDENT') {
    const { photo_local_uri, ...rest } = raw;
    return rest;
  }

  return raw;
}

export class PushSyncService {
  /**
   * Pushes all eligible pending operations in sync_outbox to Supabase
   * using dependency ordering, transactional batching, and authoritative confirmation.
   */
  public static async pushPendingOperations(options?: PushSyncOptions): Promise<PushSyncResult> {
    const db = await getDatabase();
    try {
      await FinanceRepository.repairLegacyObligationRuleIds(db);
    } catch (repairErr) {
      console.warn('[PushSyncService] Pre-push rule ID repair skipped:', repairErr);
    }
    const allPending = await db.query<SyncOutboxRecord>(
      'SELECT * FROM sync_outbox WHERE synced_at IS NULL ORDER BY created_at ASC'
    );

    const totalEligible = allPending.length;
    SyncStatusService.setPendingCount(totalEligible);

    if (totalEligible === 0) {
      SyncStatusService.updatePushProgress({
        isActive: false,
        totalEligible: 0,
        attempted: 0,
        confirmed: 0,
        failed: 0,
        blocked: 0,
        conflicts: 0,
        remaining: 0,
        currentEntity: '',
        currentBatch: 0,
        totalBatches: 0,
        lastAck: 'Nothing to upload',
        percent: 100,
      });
      return {
        pushedCount: 0,
        errorCount: 0,
        confirmedCount: 0,
        failedCount: 0,
        blockedCount: 0,
        conflictCount: 0,
        attemptedCount: 0,
      };
    }

    // Sort operations by entity dependency order first, then created_at
    const pendingOps = [...allPending].sort((a, b) => {
      const prioA = getEntityPriority(a.entity_type);
      const prioB = getEntityPriority(b.entity_type);
      if (prioA !== prioB) return prioA - prioB;
      return a.created_at.localeCompare(b.created_at);
    });

    SyncStatusService.setState('SYNCING');

    const BATCH_SIZE = Math.max(1, options?.batchSize || 50);
    const totalBatches = Math.ceil(totalEligible / BATCH_SIZE);

    let confirmedCount = 0;
    let failedCount = 0;
    let blockedCount = 0;
    let conflictCount = 0;
    let attemptedCount = 0;
    let lastAck: string | null = null;
    const failedEntityIds = new Set<string>();

    const updateLiveProgress = (currentEntity: string, currentBatch: number) => {
      const remaining = Math.max(0, totalEligible - (confirmedCount + failedCount + blockedCount + conflictCount));
      const processed = confirmedCount + failedCount + blockedCount + conflictCount;
      const percent = totalEligible > 0 ? Math.min(100, Math.round((processed / totalEligible) * 100)) : 100;

      const progressState: PushSyncProgress = {
        isActive: true,
        totalEligible,
        attempted: attemptedCount,
        confirmed: confirmedCount,
        failed: failedCount,
        blocked: blockedCount,
        conflicts: conflictCount,
        remaining,
        currentEntity,
        currentBatch,
        totalBatches,
        lastAck,
        percent,
      };

      SyncStatusService.updatePushProgress(progressState);
      if (options?.onProgress) {
        options.onProgress(progressState);
      }
    };

    updateLiveProgress(pendingOps[0]?.entity_type || '', 1);

    for (let b = 0; b < totalBatches; b++) {
      const currentBatchNum = b + 1;
      const batchSlice = pendingOps.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
      const currentEntity = batchSlice[0]?.entity_type || '';

      // 1. Check for dependency-blocked items within this batch
      const eligibleInBatch: SyncOutboxRecord[] = [];
      for (const op of batchSlice) {
        const check = checkDependencyBlocked(op, failedEntityIds);
        if (check.blocked) {
          blockedCount++;
          failedEntityIds.add(op.entity_id);
          await SyncAuditLogService.recordLog(
            {
              operationId: op.id,
              direction: 'PUSH',
              entityType: op.entity_type,
              recordId: op.entity_id,
              operationType: op.operation as any,
              status: 'SKIPPED',
              errorMessage: check.reason,
            },
            db
          );
        } else {
          eligibleInBatch.push(op);
        }
      }

      updateLiveProgress(currentEntity, currentBatchNum);

      if (eligibleInBatch.length === 0) {
        continue;
      }

      attemptedCount += eligibleInBatch.length;

      // 2. Attempt atomic batch push via PostgreSQL RPC
      let batchSuccess = false;
      const batchStartTime = Date.now();

      try {
        const ops = eligibleInBatch.map((op) => ({
          id: op.id,
          entity_type: op.entity_type,
          entity_id: op.entity_id,
          operation: op.operation,
          payload: sanitizePayloadForRemote(op.entity_type, JSON.parse(op.payload_json)),
        }));

        const { data: batchRes, error: batchErr } = await supabase.rpc('sync_push_batch', {
          p_operations: ops,
        });

        if (batchErr) {
          console.error(`[PushSync] Batch ${currentBatchNum}/${totalBatches} RPC error:`, batchErr);
          const isAuthError =
            batchErr.code === '42501' ||
            batchErr.message?.toLowerCase().includes('jwt') ||
            batchErr.message?.toLowerCase().includes('unauthorized') ||
            batchErr.message?.toLowerCase().includes('auth') ||
            batchErr.message?.toLowerCase().includes('session');

          if (isAuthError) {
            SyncStatusService.setLastError(batchErr.message || 'Authentication required');
            SyncStatusService.setState('AUTH_REQUIRED');
            const remainingInLoop = totalEligible - (confirmedCount + failedCount + blockedCount + conflictCount);
            blockedCount += remainingInLoop;
            for (const op of eligibleInBatch) {
              await SyncAuditLogService.recordLog(
                {
                  operationId: op.id,
                  direction: 'PUSH',
                  entityType: op.entity_type,
                  recordId: op.entity_id,
                  operationType: op.operation as any,
                  status: 'FAILED',
                  errorMessage: 'Blocked: Supabase authentication session expired or missing',
                },
                db
              );
            }
            updateLiveProgress(currentEntity, currentBatchNum);
            break;
          }
        }

        if (!batchErr && batchRes && Array.isArray(batchRes.results)) {
          batchSuccess = true;
          const batchDuration = Date.now() - batchStartTime;

          for (const res of batchRes.results) {
            const originalOp = eligibleInBatch.find((o) => o.id === res.id);
            const entityType = originalOp?.entity_type || 'UNKNOWN';
            const opType = (originalOp?.operation as any) || 'CREATE';
            const entityId = originalOp?.entity_id || null;

            if (res.status === 'APPLIED' || res.status === 'CONFIRMED' || res.status === 'ALREADY_RECORDED') {
              await db.execute('DELETE FROM sync_outbox WHERE id = ?', [res.id]);
              confirmedCount++;
              lastAck = `Confirmed ${entityType} (${res.status})`;
              await SyncAuditLogService.recordLog(
                {
                  operationId: res.id,
                  direction: 'PUSH',
                  entityType,
                  recordId: entityId,
                  operationType: opType,
                  status: 'SUCCESS',
                  durationMs: batchDuration,
                  serverAckRef: res.status,
                },
                db
              );
            } else if (res.status === 'REVIEW_REQUIRED') {
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
              conflictCount++;
              await SyncAuditLogService.recordLog(
                {
                  operationId: res.id,
                  direction: 'PUSH',
                  entityType,
                  recordId: entityId,
                  operationType: opType,
                  status: 'CONFLICT',
                  durationMs: batchDuration,
                  serverAckRef: res.status,
                  errorMessage: 'Officer revocation review required',
                },
                db
              );
            } else if (res.status === 'COLLISION_AUDITED') {
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
              conflictCount++;
              await SyncAuditLogService.recordLog(
                {
                  operationId: res.id,
                  direction: 'PUSH',
                  entityType,
                  recordId: entityId,
                  operationType: opType,
                  status: 'CONFLICT',
                  durationMs: batchDuration,
                  serverAckRef: res.status,
                  errorMessage: 'Unique collision audited; server version retained',
                },
                db
              );
            } else if (res.status === 'REJECTED_FINAL') {
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
              failedCount++;
              if (entityId) failedEntityIds.add(entityId);
              await SyncAuditLogService.recordLog(
                {
                  operationId: res.id,
                  direction: 'PUSH',
                  entityType,
                  recordId: entityId,
                  operationType: opType,
                  status: 'FAILED',
                  durationMs: batchDuration,
                  serverAckRef: res.status,
                  errorMessage: res.error || 'Server rejected outbox item permanently',
                },
                db
              );
            } else {
              failedCount++;
              if (entityId) failedEntityIds.add(entityId);
              const errMsg = res.error || 'Server rejected outbox operation';
              SyncStatusService.setLastError(errMsg);
              await db.execute(
                'UPDATE sync_outbox SET last_error = ?, retry_count = retry_count + 1 WHERE id = ?',
                [errMsg, res.id]
              );
              await SyncAuditLogService.recordLog(
                {
                  operationId: res.id,
                  direction: 'PUSH',
                  entityType,
                  recordId: entityId,
                  operationType: opType,
                  status: 'FAILED',
                  durationMs: batchDuration,
                  errorMessage: errMsg,
                },
                db
              );
            }
          }
        }
      } catch (rpcErr) {
        console.warn(`[PushSync] RPC execution failed for batch ${currentBatchNum}, attempting fallback:`, rpcErr);
      }

      // 3. Sequential fallback if batch RPC was not successful
      if (!batchSuccess) {
        for (const op of eligibleInBatch) {
          const res = await this.pushSingleOperationFallback(op, db);
          if (res.success) {
            await db.execute('DELETE FROM sync_outbox WHERE id = ?', [op.id]);
            if (res.isConflict) {
              conflictCount++;
            } else {
              confirmedCount++;
              lastAck = `Confirmed ${op.entity_type} (REST)`;
            }
          } else {
            failedCount++;
            failedEntityIds.add(op.entity_id);
            const errMsg = res.error || 'REST push rejected';
            await db.execute(
              'UPDATE sync_outbox SET last_error = ?, retry_count = retry_count + 1 WHERE id = ?',
              [errMsg, op.id]
            );
          }
          updateLiveProgress(op.entity_type, currentBatchNum);
        }
      }

      updateLiveProgress(currentEntity, currentBatchNum);
    }

    // Refresh remaining pending count in SQLite
    const remainingRow = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM sync_outbox WHERE synced_at IS NULL'
    );
    const count = remainingRow?.count || 0;
    SyncStatusService.setPendingCount(count);
    SyncStatusService.setFailedOpsCount(failedCount);
    SyncStatusService.setBlockedOpsCount(blockedCount);

    const isComplete = count === 0;
    if (SyncStatusService.state.value !== 'AUTH_REQUIRED') {
      if (failedCount > 0 || blockedCount > 0) {
        SyncStatusService.setState('SYNC_ERROR');
      } else if (isComplete) {
        SyncStatusService.setLastError(null);
        SyncStatusService.setState('SYNCED');
      }
    }

    const finalPercent = totalEligible > 0 ? Math.min(100, Math.round(((confirmedCount + failedCount + blockedCount + conflictCount) / totalEligible) * 100)) : 100;
    SyncStatusService.updatePushProgress({
      isActive: false,
      totalEligible,
      attempted: attemptedCount,
      confirmed: confirmedCount,
      failed: failedCount,
      blocked: blockedCount,
      conflicts: conflictCount,
      remaining: count,
      percent: finalPercent,
      lastAck: lastAck || (isComplete ? 'All operations confirmed' : 'Completed with pending records'),
    });

    return {
      pushedCount: confirmedCount,
      errorCount: failedCount + blockedCount,
      confirmedCount,
      failedCount,
      blockedCount,
      conflictCount,
      attemptedCount,
    };
  }

  private static async pushSingleOperationFallback(
    op: SyncOutboxRecord,
    db: DatabaseAdapter
  ): Promise<{ success: boolean; isConflict?: boolean; error?: string }> {
    const opStartTime = Date.now();
    try {
      const rawPayload = JSON.parse(op.payload_json);
      const payload = sanitizePayloadForRemote(op.entity_type, rawPayload);
      const targetTable = this.mapEntityTypeToTable(op.entity_type);

      let success = false;
      let isConflict = false;

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
        const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (op.operation === 'CREATE') {
          const payRow = payload.payment || payload;
          const allocations = Array.isArray(payload.allocations) ? payload.allocations : [];

          if (!payRow.id || !UUID_REGEX.test(payRow.id) || !payRow.student_id || !UUID_REGEX.test(payRow.student_id)) {
            await ConflictService.recordConflict({
              id: 'conf_' + Math.random().toString(36).substring(2, 10),
              entityType: op.entity_type,
              entityId: op.entity_id,
              conflictType: 'LEGACY_UNSUPPORTED_PAYMENT_PAYLOAD',
              clientPayload: payload,
              serverPayload: { error: 'Payment or student identifier is not a valid RFC 4122 UUID' },
              resolution: 'SERVER_WINS',
            });
            success = true;
            isConflict = true;
          } else {
            const { data: rpcRes, error: rpcErr } = await supabase.rpc('record_student_payment', {
              p_payment_id: payRow.id,
              p_student_id: payRow.student_id,
              p_semester_id: payRow.semester_id,
              p_reference_number: payRow.reference_number,
              p_idempotency_key: payRow.idempotency_key || ('idemp_' + payRow.id),
              p_amount_centavos: payRow.amount_centavos,
              p_source: payRow.source,
              p_channel: payRow.channel || 'MANUAL',
              p_allocations: allocations.map((a: any) => ({
                id: a.id,
                obligation_id: a.obligation_id,
                amount_centavos: a.amount_centavos,
              })),
              p_notes: payRow.notes || null,
            });

            if (!rpcErr && (rpcRes?.status === 'CONFIRMED' || rpcRes?.status === 'ALREADY_RECORDED')) {
              success = true;
            } else {
              const errMsg = rpcErr?.message || rpcRes?.error || 'Atomic payment sync failed';
              if (
                errMsg.includes('exceeds remaining') ||
                errMsg.includes('not active') ||
                errMsg.includes('different student') ||
                errMsg.includes('Idempotency conflict') ||
                errMsg.includes('Unsupported payment source')
              ) {
                await ConflictService.recordConflict({
                  id: 'conf_' + Math.random().toString(36).substring(2, 10),
                  entityType: op.entity_type,
                  entityId: op.entity_id,
                  conflictType: 'PAYMENT_CONCURRENCY_CONFLICT',
                  clientPayload: payload,
                  serverPayload: rpcRes || { error: errMsg },
                  resolution: 'SERVER_WINS',
                });
                success = true;
                isConflict = true;
              }
            }
          }
        } else if (op.operation === 'UPDATE' || payload.status === 'REVERSED') {
          if (!op.entity_id || !UUID_REGEX.test(op.entity_id)) {
            await ConflictService.recordConflict({
              id: 'conf_' + Math.random().toString(36).substring(2, 10),
              entityType: op.entity_type,
              entityId: op.entity_id,
              conflictType: 'LEGACY_UNSUPPORTED_PAYMENT_PAYLOAD',
              clientPayload: payload,
              serverPayload: { error: 'Reversal payment identifier is not a valid UUID' },
              resolution: 'SERVER_WINS',
            });
            success = true;
            isConflict = true;
          } else {
            const { data: revRes, error: revErr } = await supabase.rpc('reverse_student_payment', {
              p_payment_id: op.entity_id,
              p_reversal_reason: payload.reversal_reason || 'Reversed by officer',
              p_idempotency_key: 'idemp_rev_' + op.entity_id,
            });
            if (!revErr && (revRes?.status === 'REVERSED' || revRes?.status === 'ALREADY_REVERSED')) {
              success = true;
            }
          }
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
        } else {
          const { error: insErr } = await supabase.from('students').insert({
            ...payload,
            school_id: canonicalId,
          });
          if (!insErr) success = true;
        }
      } else if (op.operation === 'CREATE') {
        const { error } = await supabase.from(targetTable).upsert(payload);
        if (!error) {
          success = true;
        } else if (error.code === '23505') {
          await ConflictService.recordConflict({
            id: 'conf_' + Math.random().toString(36).substring(2, 10),
            entityType: op.entity_type,
            entityId: op.entity_id,
            conflictType: 'UNIQUE_CONSTRAINT_COLLISION',
            clientPayload: payload,
            resolution: 'SERVER_WINS',
          });
          success = true;
          isConflict = true;
        }
      } else if (op.operation === 'UPDATE') {
        const { error } = await supabase.from(targetTable).update(payload).eq('id', op.entity_id);
        if (!error) success = true;
      } else if (op.operation === 'VOID' || op.operation === 'REVOKE') {
        const { error } = await supabase.from(targetTable).update({ status: op.operation }).eq('id', op.entity_id);
        if (!error) success = true;
      }

      const durationMs = Date.now() - opStartTime;
      if (success) {
        await SyncAuditLogService.recordLog(
          {
            operationId: op.id,
            direction: 'PUSH',
            entityType: op.entity_type,
            recordId: op.entity_id,
            operationType: op.operation as any,
            status: isConflict ? 'CONFLICT' : 'SUCCESS',
            durationMs,
            serverAckRef: isConflict ? 'COLLISION_AUDITED' : 'REST_OK',
          },
          db
        );
        return { success: true, isConflict };
      } else {
        const errMsg = 'REST push rejected: ' + op.entity_type;
        await SyncAuditLogService.recordLog(
          {
            operationId: op.id,
            direction: 'PUSH',
            entityType: op.entity_type,
            recordId: op.entity_id,
            operationType: op.operation as any,
            status: 'FAILED',
            durationMs,
            errorMessage: errMsg,
          },
          db
        );
        return { success: false, error: errMsg };
      }
    } catch (err: unknown) {
      const durationMs = Date.now() - opStartTime;
      const errMsg = err instanceof Error ? err.message : String(err);
      await SyncAuditLogService.recordLog(
        {
          operationId: op.id,
          direction: 'PUSH',
          entityType: op.entity_type,
          recordId: op.entity_id,
          operationType: op.operation as any,
          status: 'FAILED',
          durationMs,
          errorMessage: errMsg,
        },
        db
      );
      return { success: false, error: errMsg };
    }
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
