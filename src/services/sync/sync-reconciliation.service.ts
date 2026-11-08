import { supabase } from '@/integrations/supabase/client';
import { getDatabase } from '@/database/database';
import type { DatabaseAdapter } from '@/database/adapters/database-adapter.interface';
import { NetworkService } from '../network.service';
import { SyncAuditLogService } from './sync-audit-log.service';
import { PushSyncService } from './push-sync.service';
import { PullSyncService } from './pull-sync.service';
import { generateUuid } from '@/utilities/uuid';

export type RecordClassification =
  | 'IN_SYNC'
  | 'LOCAL_PENDING'
  | 'LOCAL_UNQUEUED'
  | 'REMOTE_ONLY'
  | 'CONFLICT'
  | 'FAILED'
  | 'BLOCKED_AUTH'
  | 'EXCLUDED_DEMO';

export interface EntityReconciliationReport {
  entity: string;
  table: string;
  localCount: number;
  remoteCount: number;
  inSyncCount: number;
  localPendingCount: number;
  localUnqueuedCount: number;
  remoteOnlyCount: number;
  conflictCount: number;
  failedCount: number;
  status: 'IN_SYNC' | 'PENDING' | 'DISCREPANCY' | 'BLOCKED_AUTH' | 'OFFLINE' | 'ERROR';
  errorMessage?: string;
  unqueuedIds: string[];
  remoteOnlyIds: string[];
  conflictIds: string[];
  failedIds: string[];
}

export interface GlobalReconciliationReport {
  id: string;
  timestamp: string;
  totalLocal: number;
  totalRemote: number;
  totalInSync: number;
  totalPending: number;
  totalUnqueued: number;
  totalRemoteOnly: number;
  totalConflicts: number;
  totalFailed: number;
  entities: EntityReconciliationReport[];
  isHealthy: boolean;
  canAutoRepair: boolean;
}

export const RECONCILIATION_TARGET_ENTITIES = [
  { entity: 'obligation_rules', table: 'obligation_rules', entityType: 'OBLIGATION_RULE' },
  { entity: 'student_obligations', table: 'student_obligations', entityType: 'OBLIGATION' },
  { entity: 'students', table: 'students', entityType: 'STUDENT' },
  { entity: 'student_enrollments', table: 'student_enrollments', entityType: 'ENROLLMENT' },
  { entity: 'attendance_records', table: 'attendance_records', entityType: 'ATTENDANCE' },
  { entity: 'payments', table: 'payments', entityType: 'PAYMENT' },
  { entity: 'academic_years', table: 'academic_years', entityType: 'ACADEMIC_YEAR' },
  { entity: 'semesters', table: 'semesters', entityType: 'SEMESTER' },
] as const;

export class SyncReconciliationService {
  /**
   * Performs an authoritative, non-destructive reconciliation scan comparing
   * local SQLite state against cloud Supabase PostgreSQL records.
   */
  public static async reconcileAll(dbOrTx?: DatabaseAdapter): Promise<GlobalReconciliationReport> {
    const startTime = Date.now();
    const db = dbOrTx || (await getDatabase());
    const isOnline = NetworkService.isOnline.value;

    const entitiesReport: EntityReconciliationReport[] = [];
    let grandTotalLocal = 0;
    let grandTotalRemote = 0;
    let grandTotalInSync = 0;
    let grandTotalPending = 0;
    let grandTotalUnqueued = 0;
    let grandTotalRemoteOnly = 0;
    let grandTotalConflicts = 0;
    let grandTotalFailed = 0;

    for (const target of RECONCILIATION_TARGET_ENTITIES) {
      try {
        const report = await this.reconcileEntity(target.entity, target.table, target.entityType, isOnline, db);
        entitiesReport.push(report);

        grandTotalLocal += report.localCount;
        grandTotalRemote += report.remoteCount;
        grandTotalInSync += report.inSyncCount;
        grandTotalPending += report.localPendingCount;
        grandTotalUnqueued += report.localUnqueuedCount;
        grandTotalRemoteOnly += report.remoteOnlyCount;
        grandTotalConflicts += report.conflictCount;
        grandTotalFailed += report.failedCount;
      } catch (err: any) {
        console.warn(`[SyncReconciliation] Error reconciling ${target.entity}:`, err);
        entitiesReport.push({
          entity: target.entity,
          table: target.table,
          localCount: 0,
          remoteCount: 0,
          inSyncCount: 0,
          localPendingCount: 0,
          localUnqueuedCount: 0,
          remoteOnlyCount: 0,
          conflictCount: 0,
          failedCount: 0,
          status: 'ERROR',
          errorMessage: err.message || 'Scan error',
          unqueuedIds: [],
          remoteOnlyIds: [],
          conflictIds: [],
          failedIds: [],
        });
      }
    }

    const durationMs = Date.now() - startTime;
    const isHealthy =
      grandTotalUnqueued === 0 && grandTotalConflicts === 0 && grandTotalFailed === 0;
    const canAutoRepair = grandTotalUnqueued > 0 || grandTotalFailed > 0;

    const report: GlobalReconciliationReport = {
      id: 'rec_' + generateUuid().substring(0, 10),
      timestamp: new Date().toISOString(),
      totalLocal: grandTotalLocal,
      totalRemote: grandTotalRemote,
      totalInSync: grandTotalInSync,
      totalPending: grandTotalPending,
      totalUnqueued: grandTotalUnqueued,
      totalRemoteOnly: grandTotalRemoteOnly,
      totalConflicts: grandTotalConflicts,
      totalFailed: grandTotalFailed,
      entities: entitiesReport,
      isHealthy,
      canAutoRepair,
    };

    // Log the reconciliation scan locally
    await SyncAuditLogService.recordLog(
      {
        direction: 'RECONCILE',
        entityType: 'ALL_ENTITIES',
        operationType: 'RECONCILE',
        status: isHealthy ? 'SUCCESS' : 'CONFLICT',
        durationMs,
        details: {
          totalLocal: grandTotalLocal,
          totalRemote: grandTotalRemote,
          totalInSync: grandTotalInSync,
          totalUnqueued: grandTotalUnqueued,
          totalConflicts: grandTotalConflicts,
          totalFailed: grandTotalFailed,
        },
      },
      db
    );

    return report;
  }

  /**
   * Scans a specific entity table and classifies each record.
   */
  public static async reconcileEntity(
    entity: string,
    tableName: string,
    entityType: string,
    isOnline: boolean,
    db: DatabaseAdapter
  ): Promise<EntityReconciliationReport> {
    // 1. Fetch local records
    const localRows = await db.query<{ id: string; status?: string; updated_at?: string }>(
      `SELECT id, status, updated_at FROM ${tableName}`
    );
    const localMap = new Map<string, { id: string; status?: string; updated_at?: string }>();
    for (const r of localRows || []) {
      if (r.id) localMap.set(String(r.id), r);
    }

    // 2. Fetch pending & failed outbox records for this entity
    const outboxRows = await db.query<{
      id: string;
      entity_id: string;
      retry_count: number;
      last_error: string | null;
    }>(
      `SELECT id, entity_id, retry_count, last_error FROM sync_outbox WHERE entity_type = ? OR entity_type = ?`,
      [entityType, entity]
    );

    const pendingOutboxMap = new Map<string, { id: string; retry_count: number; last_error: string | null }>();
    for (const o of outboxRows || []) {
      if (o.entity_id) pendingOutboxMap.set(String(o.entity_id), o);
    }

    // 3. Fetch remote records from Supabase
    let remoteRows: { id: string; status?: string; updated_at?: string }[] = [];
    let isRemoteReachable = false;
    let authBlocked = false;

    if (isOnline) {
      try {
        const { data, error } = await supabase
          .from(tableName)
          .select('id, status, updated_at')
          .limit(2000);

        if (error) {
          if (error.code === '42501' || error.message.toLowerCase().includes('jwt') || error.message.toLowerCase().includes('permission')) {
            authBlocked = true;
          }
        } else if (Array.isArray(data)) {
          remoteRows = data;
          isRemoteReachable = true;
        }
      } catch {
        isRemoteReachable = false;
      }
    }

    const remoteMap = new Map<string, { id: string; status?: string; updated_at?: string }>();
    for (const r of remoteRows) {
      if (r.id) remoteMap.set(String(r.id), r);
    }

    // 4. Classify records
    let inSyncCount = 0;
    let localPendingCount = 0;
    let localUnqueuedCount = 0;
    let remoteOnlyCount = 0;
    let conflictCount = 0;
    let failedCount = 0;

    const unqueuedIds: string[] = [];
    const remoteOnlyIds: string[] = [];
    const conflictIds: string[] = [];
    const failedIds: string[] = [];

    // Analyze local rows against remote
    for (const [id, localItem] of localMap.entries()) {
      const outbox = pendingOutboxMap.get(id);
      const remoteItem = remoteMap.get(id);

      if (outbox && (outbox.retry_count > 0 || outbox.last_error)) {
        failedCount++;
        failedIds.push(id);
        continue;
      }

      if (remoteItem) {
        // Exists in both
        if (localItem.status && remoteItem.status && localItem.status !== remoteItem.status) {
          conflictCount++;
          conflictIds.push(id);
        } else {
          inSyncCount++;
        }
      } else {
        // Exists locally, missing remotely
        if (outbox) {
          localPendingCount++;
        } else if (isRemoteReachable) {
          // If remote is reachable and confirmed not there, it's unqueued
          localUnqueuedCount++;
          unqueuedIds.push(id);
        } else {
          // Remote not reachable; count as pending local state
          localPendingCount++;
        }
      }
    }

    // Analyze remote rows missing locally
    if (isRemoteReachable) {
      for (const [id] of remoteMap.entries()) {
        if (!localMap.has(id)) {
          remoteOnlyCount++;
          remoteOnlyIds.push(id);
        }
      }
    }

    // Determine status
    let status: EntityReconciliationReport['status'] = 'IN_SYNC';
    if (!isOnline) {
      status = 'OFFLINE';
    } else if (authBlocked) {
      status = 'BLOCKED_AUTH';
    } else if (conflictCount > 0 || localUnqueuedCount > 0 || failedCount > 0) {
      status = 'DISCREPANCY';
    } else if (localPendingCount > 0 || remoteOnlyCount > 0) {
      status = 'PENDING';
    }

    return {
      entity,
      table: tableName,
      localCount: localMap.size,
      remoteCount: remoteMap.size,
      inSyncCount,
      localPendingCount,
      localUnqueuedCount,
      remoteOnlyCount,
      conflictCount,
      failedCount,
      status,
      errorMessage: authBlocked ? 'Authentication or Scope Restricted' : undefined,
      unqueuedIds,
      remoteOnlyIds,
      conflictIds,
      failedIds,
    };
  }

  /**
   * Safely enqueues unqueued local records into SQLite sync_outbox
   * following strict foreign key dependency order:
   * obligation_rules -> student_obligations -> students -> enrollments -> etc.
   */
  public static async requeueUnqueuedRecords(
    entity: string,
    ids?: string[],
    dbOrTx?: DatabaseAdapter
  ): Promise<{ requeuedCount: number }> {
    const db = dbOrTx || (await getDatabase());
    let requeuedCount = 0;
    const now = new Date().toISOString();

    if (entity === 'obligation_rules' || entity === 'all') {
      let query = 'SELECT * FROM obligation_rules';
      const params: any[] = [];
      if (ids && ids.length > 0) {
        query += ` WHERE id IN (${ids.map(() => '?').join(', ')})`;
        params.push(...ids);
      }
      const rules = await db.query<any>(query, params);
      for (const rule of rules || []) {
        const hasOutbox = await db.queryOne<{ id: string }>(
          'SELECT id FROM sync_outbox WHERE entity_type = "OBLIGATION_RULE" AND entity_id = ?',
          [rule.id]
        );
        if (!hasOutbox) {
          const outboxId = 'op_rule_' + generateUuid().substring(0, 10);
          await db.execute(
            `INSERT INTO sync_outbox (
              id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
            ) VALUES (?, 'dev_default', 'OBLIGATION_RULE', ?, 'CREATE', ?, 1, ?, 0)`,
            [outboxId, rule.id, JSON.stringify(rule), rule.created_at || now]
          );
          requeuedCount++;
        }
      }
    }

    if (entity === 'student_obligations' || entity === 'all') {
      let query = 'SELECT * FROM student_obligations';
      const params: any[] = [];
      if (ids && ids.length > 0) {
        query += ` WHERE id IN (${ids.map(() => '?').join(', ')})`;
        params.push(...ids);
      }
      const obs = await db.query<any>(query, params);
      for (const ob of obs || []) {
        // Enforce dependency: if this obligation references a rule_id that is NOT in outbox or remote,
        // ensure rule is queued first
        if (ob.rule_id) {
          const ruleExists = await db.queryOne<any>('SELECT * FROM obligation_rules WHERE id = ?', [ob.rule_id]);
          if (ruleExists) {
            const hasRuleOutbox = await db.queryOne<{ id: string }>(
              'SELECT id FROM sync_outbox WHERE entity_type = "OBLIGATION_RULE" AND entity_id = ?',
              [ob.rule_id]
            );
            if (!hasRuleOutbox) {
              const ruleOutboxId = 'op_rule_' + generateUuid().substring(0, 10);
              await db.execute(
                `INSERT INTO sync_outbox (
                  id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
                ) VALUES (?, 'dev_default', 'OBLIGATION_RULE', ?, 'CREATE', ?, 1, ?, 0)`,
                [ruleOutboxId, ob.rule_id, JSON.stringify(ruleExists), ruleExists.created_at || now]
              );
              requeuedCount++;
            }
          }
        }

        const hasOutbox = await db.queryOne<{ id: string }>(
          'SELECT id FROM sync_outbox WHERE entity_type = "OBLIGATION" AND entity_id = ?',
          [ob.id]
        );
        if (!hasOutbox) {
          const outboxId = 'op_ob_' + generateUuid().substring(0, 10);
          await db.execute(
            `INSERT INTO sync_outbox (
              id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
            ) VALUES (?, 'dev_default', 'OBLIGATION', ?, 'CREATE', ?, 1, ?, 0)`,
            [outboxId, ob.id, JSON.stringify(ob), ob.issued_at || now]
          );
          requeuedCount++;
        }
      }
    }

    if (entity === 'students' || entity === 'all') {
      let query = 'SELECT * FROM students';
      const params: any[] = [];
      if (ids && ids.length > 0) {
        query += ` WHERE id IN (${ids.map(() => '?').join(', ')})`;
        params.push(...ids);
      }
      const students = await db.query<any>(query, params);
      for (const st of students || []) {
        const hasOutbox = await db.queryOne<{ id: string }>(
          'SELECT id FROM sync_outbox WHERE entity_type = "STUDENT" AND entity_id = ?',
          [st.id]
        );
        if (!hasOutbox) {
          const outboxId = 'op_st_' + generateUuid().substring(0, 10);
          await db.execute(
            `INSERT INTO sync_outbox (
              id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
            ) VALUES (?, 'dev_default', 'STUDENT', ?, 'CREATE', ?, 1, ?, 0)`,
            [outboxId, st.id, JSON.stringify(st), st.created_at || now]
          );
          requeuedCount++;
        }
      }
    }

    if (requeuedCount > 0) {
      await SyncAuditLogService.recordLog(
        {
          direction: 'RECONCILE',
          entityType: entity.toUpperCase(),
          operationType: 'RETRY',
          status: 'SUCCESS',
          serverAckRef: `requeued:${requeuedCount}`,
          details: { entity, requeuedCount },
        },
        db
      );

      // Trigger debounced push
      if (NetworkService.isOnline.value) {
        PushSyncService.pushPendingOperations().catch((err) => {
          console.warn('[SyncReconciliation] Push after requeue failed:', err);
        });
      }
    }

    return { requeuedCount };
  }

  /**
   * Resets retry counts and error messages on failed outbox items so they can be re-attempted.
   */
  public static async retryFailedOperations(dbOrTx?: DatabaseAdapter): Promise<{ retried: number }> {
    const db = dbOrTx || (await getDatabase());
    const failedRows = await db.query<{ id: string; entity_type: string; entity_id: string }>(
      'SELECT id, entity_type, entity_id FROM sync_outbox WHERE retry_count > 0 OR last_error IS NOT NULL'
    );

    const count = (failedRows || []).length;
    if (count > 0) {
      await db.execute(
        'UPDATE sync_outbox SET retry_count = 0, last_error = NULL WHERE retry_count > 0 OR last_error IS NOT NULL'
      );

      await SyncAuditLogService.recordLog(
        {
          direction: 'RECONCILE',
          entityType: 'SYNC_OUTBOX',
          operationType: 'RETRY',
          status: 'SUCCESS',
          serverAckRef: `retried:${count}`,
          details: { resetOperationsCount: count },
        },
        db
      );

      // Trigger push
      if (NetworkService.isOnline.value) {
        PushSyncService.pushPendingOperations().catch((err) => {
          console.warn('[SyncReconciliation] Push after retry reset failed:', err);
        });
      }
    }

    return { retried: count };
  }

  /**
   * Pulls remote-only records into local SQLite using the authoritative pagination engine.
   */
  public static async pullRemoteRecords(entity: string, dbOrTx?: DatabaseAdapter): Promise<void> {
    const db = dbOrTx || (await getDatabase());
    await PullSyncService.syncEntity(db, entity);
  }
}

