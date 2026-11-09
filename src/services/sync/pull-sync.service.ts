import { supabase } from '@/integrations/supabase/client';
import { getDatabase } from '@/database/database';
import type { DatabaseAdapter } from '@/database/adapters/database-adapter.interface';
import { SyncStatusService } from './sync-status.service';
import { SchemaMapperService } from './schema-mapper.service';
import { EntityCheckpointService } from './entity-checkpoint.service';
import { SyncAuditLogService } from './sync-audit-log.service';
import { PullReconciliationService, type PullPreviewPlan } from './pull-reconciliation.service';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { normalizeSchoolId } from '@/utilities/school-id-normalizer';

export const DEFAULT_SYNC_ENTITIES = [
  'academic_years',
  'semesters',
  'programs',
  'year_levels',
  'sections',
  'event_categories',
  'events',
  'event_occurrences',
  'students',
  'student_enrollments',
  'nfc_cards',
  'event_participants',
  'attendance_records',
  'attendance_audit',
  'obligation_rules',
  'student_obligations',
  'payments',
  'payment_allocations',
] as const;

export type SyncEntityName = typeof DEFAULT_SYNC_ENTITIES[number];

export interface EntityPullResult {
  recordsPulled: number;
  pagesFetched: number;
  hasMore: boolean;
  status: 'SUCCESS' | 'PARTIAL_PENDING_OUTBOX' | 'FAILED' | 'SKIPPED';
  errorMessage?: string;
}

export interface PullSyncOptions {
  pageSize?: number;
  entities?: string[];
  onProgress?: (entity: string, current: number, total: number, recordsPulled: number) => void;
}

export interface PullSyncResult {
  appliedCount: number;
  entityResults: Record<string, EntityPullResult>;
  isComplete: boolean;
  serverTime?: string;
}

export class PullSyncService {
  /**
   * Paginates a single entity incrementally using sync_pull_entity_v2 and
   * atomically commits ingested pages and entity checkpoints to SQLite.
   */
  public static async syncEntity(
    db: DatabaseAdapter,
    entity: string,
    options?: { pageSize?: number }
  ): Promise<EntityPullResult> {
    const syncStartTime = Date.now();
    const checkpoint = await EntityCheckpointService.getCheckpoint(db, entity);
    let currentSince = checkpoint.last_pulled_at;
    let currentLastId = checkpoint.last_pulled_id;
    let totalPulledForEntity = 0;
    let pagesFetched = 0;
    let hasMore = true;
    let entitySkippedPending = false;
    const pageSize = Math.min(Math.max(options?.pageSize || 500, 1), 1000);

    while (hasMore && pagesFetched < 1000) {
      pagesFetched++;

      const { data, error } = (await supabase.rpc('sync_pull_entity_v2', {
        p_entity: entity,
        p_since: currentSince,
        p_last_id: currentLastId,
        p_limit: pageSize,
      })) as { data: any; error: any };

      if (error || !data || data.error) {
        const errMsg = error?.message || data?.message || 'RPC sync_pull_entity_v2 failed';
        await EntityCheckpointService.setCheckpointStatus(db, entity, 'FAILED', errMsg);
        await SyncAuditLogService.recordLog({
          direction: 'PULL',
          entityType: entity,
          operationType: 'PULL_BATCH',
          status: 'FAILED',
          durationMs: Date.now() - syncStartTime,
          errorMessage: errMsg,
        }, db);
        return {
          recordsPulled: totalPulledForEntity,
          pagesFetched,
          hasMore,
          status: 'FAILED',
          errorMessage: errMsg,
        };
      }

      const records = Array.isArray(data.records) ? data.records : [];
      const pagination = data.pagination || {};
      const nextSince = pagination.next_since || currentSince;
      const nextLastId = pagination.next_last_id || currentLastId;
      hasMore = Boolean(pagination.has_more);

      let pageApplied = 0;
      let pageSkippedPending = 0;

      // Ingestion and checkpoint are committed atomically in the same SQLite transaction
      try {
        await db.transaction(async (tx) => {
          if (records.length > 0) {
            if (entity === 'students') {
              const { operations } = await PullReconciliationService.analyzeStudentBatch(tx, records);
              const validTableInfo = await tx.query<{ name: string }>('PRAGMA table_info(students)');
              const validColumns = new Set<string>((validTableInfo || []).map((c: { name: string }) => c.name));

              for (const op of operations) {
                if (op.action === 'PENDING_LOCAL_CHANGE' || op.action === 'CONFLICT' || op.action === 'INVALID') {
                  pageSkippedPending++;
                  continue;
                }
                if (op.action === 'UNCHANGED') {
                  pageApplied++;
                  continue;
                }
                if (op.action === 'IDENTITY_MATCH_REVIEW') {
                  if (op.isSafeToApply && op.localId) {
                    const canonicalId = op.canonicalSchoolId || normalizeSchoolId(op.schoolId);
                    await StudentsRepository.reconcileStudentId(op.localId, op.remoteId, canonicalId, tx);
                    const mapped = SchemaMapperService.mapRecord('students', {
                      ...op.remoteRecord,
                      school_id: canonicalId,
                    });
                    await SchemaMapperService.safeUpsertRecord(tx, 'students', mapped, validColumns);
                    pageApplied++;
                  } else {
                    pageSkippedPending++;
                  }
                  continue;
                }
                if (op.action === 'INSERT' || op.action === 'UPDATE') {
                  const canonicalId = normalizeSchoolId(op.schoolId);
                  const mapped = SchemaMapperService.mapRecord('students', {
                    ...op.remoteRecord,
                    school_id: canonicalId || op.schoolId,
                  });
                  const ok = await SchemaMapperService.safeUpsertRecord(tx, 'students', mapped, validColumns);
                  if (ok) pageApplied++;
                  else pageSkippedPending++;
                  continue;
                }
              }
            } else {
              const res = await SchemaMapperService.upsertBatchSafe(tx, entity, records);
              pageApplied = res.applied;
              pageSkippedPending = res.skippedPending;
            }
          }

          if (pageSkippedPending > 0) {
            entitySkippedPending = true;
          }

          totalPulledForEntity += pageApplied;

          if (!entitySkippedPending) {
            await EntityCheckpointService.updateCheckpointInTransaction(tx, {
              entity_name: entity,
              last_pulled_at: nextSince,
              last_pulled_id: nextLastId,
              records_pulled: checkpoint.records_pulled + totalPulledForEntity,
              last_sync_status: hasMore ? 'IN_PROGRESS' : 'SUCCESS',
              last_error_message: null,
            });
          } else {
            // Outbox protection: do not advance last_pulled_at past uncommitted local changes
            await EntityCheckpointService.updateCheckpointInTransaction(tx, {
              entity_name: entity,
              last_pulled_at: currentSince,
              last_pulled_id: currentLastId,
              records_pulled: checkpoint.records_pulled + totalPulledForEntity,
              last_sync_status: 'PENDING_OUTBOX',
              last_error_message: null,
            });
          }
        });
      } catch (txErr: any) {
        // Rollback occurred automatically. Mark checkpoint FAILED outside transaction.
        await EntityCheckpointService.setCheckpointStatus(db, entity, 'FAILED', txErr.message);
        throw txErr;
      }

      currentSince = nextSince;
      currentLastId = nextLastId;

      if (records.length === 0 && !hasMore) {
        break;
      }
    }

    await SyncAuditLogService.recordLog({
      direction: 'PULL',
      entityType: entity,
      operationType: 'PULL_BATCH',
      status: entitySkippedPending ? 'SKIPPED' : 'SUCCESS',
      durationMs: Date.now() - syncStartTime,
      serverAckRef: `rows:${totalPulledForEntity}`,
      details: {
        recordsPulled: totalPulledForEntity,
        pagesFetched,
        hasMore,
        skippedPending: entitySkippedPending,
      },
    }, db);

    return {
      recordsPulled: totalPulledForEntity,
      pagesFetched,
      hasMore,
      status: entitySkippedPending ? 'PARTIAL_PENDING_OUTBOX' : 'SUCCESS',
    };
  }

  /**
   * Pulls incremental remote changes from Supabase into local SQLite across
   * all registered entities using the lossless per-entity protocol.
   */
  public static async pullRemoteChanges(options?: PullSyncOptions): Promise<PullSyncResult> {
    const db = await getDatabase();
    let appliedCount = 0;
    const entityResults: Record<string, EntityPullResult> = {};
    const entities = options?.entities || [...DEFAULT_SYNC_ENTITIES];
    let allSucceeded = true;
    let anySkippedPending = false;

    try {
      SyncStatusService.setState('SYNCING');

      // Test RPC availability or run directly
      let v2Available = true;
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        try {
          const res = await this.syncEntity(db, entity, { pageSize: options?.pageSize });
          entityResults[entity] = res;
          appliedCount += res.recordsPulled;

          if (res.status === 'FAILED') {
            allSucceeded = false;
            // Only fall back to legacy if the v2 RPC is truly missing or client is completely offline
            if (
              (res.errorMessage?.includes('sync_pull_entity_v2') && res.errorMessage?.includes('does not exist')) ||
              res.errorMessage?.includes('404') ||
              res.errorMessage?.includes('Failed to fetch') ||
              res.errorMessage?.includes('NetworkError')
            ) {
              v2Available = false;
              break;
            }
          } else if (res.status === 'PARTIAL_PENDING_OUTBOX') {
            anySkippedPending = true;
          }

          if (options?.onProgress) {
            options.onProgress(entity, i + 1, entities.length, appliedCount);
          }
        } catch (err: any) {
          allSucceeded = false;
          entityResults[entity] = {
            recordsPulled: 0,
            pagesFetched: 0,
            hasMore: false,
            status: 'FAILED',
            errorMessage: err.message,
          };
          if (err.message?.includes('does not exist') || err.message?.includes('404')) {
            v2Available = false;
            break;
          }
        }
      }

      // If sync_pull_entity_v2 is available, finalize status and return
      if (v2Available) {
        const now = new Date().toISOString();
        await db.execute(
          `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
           VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', ?)`,
          [now]
        );

        if (allSucceeded && !anySkippedPending) {
          await db.execute(
            `INSERT INTO sync_state (device_id, server_cursor, last_pull_at, last_success_at)
             VALUES ('dev_default', '0', ?, ?)
             ON CONFLICT(device_id) DO UPDATE SET last_pull_at = excluded.last_pull_at, last_success_at = excluded.last_success_at`,
            [now, now]
          );
          SyncStatusService.setLastSync(now);
          SyncStatusService.setState('SYNCED');
        } else {
          // If pending outbox entries exist or some entity failed, do not advance global last_pull_at
          await db.execute(
            `INSERT INTO sync_state (device_id, server_cursor, last_pull_at, last_success_at)
             VALUES ('dev_default', '0', NULL, ?)
             ON CONFLICT(device_id) DO UPDATE SET last_success_at = excluded.last_success_at`,
            [now]
          );
          SyncStatusService.setState(allSucceeded ? 'SYNCED' : 'SYNC_ERROR');
        }

        return {
          appliedCount,
          entityResults,
          isComplete: allSucceeded && !anySkippedPending,
          serverTime: now,
        };
      }

      // Legacy fallback if v2 RPC is not deployed on remote Supabase instance
      return await this.runLegacyFallback(db);
    } catch (err) {
      console.warn('[PullSync] Incremental pull failed:', err);
      SyncStatusService.setState('SYNC_ERROR');
      return {
        appliedCount,
        entityResults,
        isComplete: false,
      };
    }
  }

  /**
   * Preflight read-only download of entity records from Supabase
   * without mutating SQLite tables or advancing entity checkpoints.
   */
  public static async fetchPullPreview(
    entity: SyncEntityName = 'students',
    options?: { limit?: number; since?: string }
  ): Promise<PullPreviewPlan> {
    const since = options?.since || '1970-01-01 00:00:00+00';
    const limit = options?.limit || 1000;

    const { data, error } = (await supabase.rpc('sync_pull_entity_v2', {
      p_entity: entity,
      p_since: since,
      p_last_id: null,
      p_limit: limit,
    })) as { data: any; error: any };

    if (error || !data || data.error) {
      throw new Error(error?.message || data?.message || `Failed to fetch preview for ${entity}`);
    }

    const records = Array.isArray(data.records) ? data.records : [];
    const pagination = data.pagination || {};

    return PullReconciliationService.generatePreviewPlan(records, {
      entity,
      nextSince: pagination.next_since,
      nextLastId: pagination.next_last_id,
      serverTime: data.server_time,
    });
  }

  /**
   * Preserves backward compatibility with legacy sync_pull_batch RPC
   */
  private static async runLegacyFallback(db: DatabaseAdapter): Promise<PullSyncResult> {
    let appliedCount = 0;
    let skippedAnyPending = false;

    const state = await db.queryOne<{ last_pull_at: string | null; server_cursor: string | null }>(
      'SELECT last_pull_at, server_cursor FROM sync_state LIMIT 1'
    );
    const lastSyncAt = state?.last_pull_at || '1970-01-01T00:00:00Z';

    const pullRes = (await supabase.rpc('sync_pull_batch', {
      p_since: lastSyncAt,
      p_limit: 500,
      p_last_id: null,
    })) as { data: any; error: any };

    const batchData = pullRes.data;
    if (batchData && typeof batchData === 'object' && !pullRes.error) {
      const now = batchData.server_time || new Date().toISOString();
      await db.transaction(async (tx) => {
        for (const table of DEFAULT_SYNC_ENTITIES) {
          const rows = batchData[table];
          if (Array.isArray(rows) && rows.length > 0) {
            const res = await SchemaMapperService.upsertBatchSafe(tx, table, rows);
            appliedCount += res.applied;
            if (res.skippedPending > 0) {
              skippedAnyPending = true;
            }
          }
        }
      });

      if (!skippedAnyPending) {
        await db.execute(
          `INSERT INTO sync_state (device_id, server_cursor, last_pull_at, last_success_at)
           VALUES ('dev_default', '0', ?, ?)
           ON CONFLICT(device_id) DO UPDATE SET last_pull_at = excluded.last_pull_at, last_success_at = excluded.last_success_at`,
          [now, now]
        );
      }
      SyncStatusService.setLastSync(now);
      SyncStatusService.setState('SYNCED');
    }

    return {
      appliedCount,
      entityResults: {},
      isComplete: !skippedAnyPending,
    };
  }
}
