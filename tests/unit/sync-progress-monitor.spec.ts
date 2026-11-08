import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { SyncStatusService } from '@/services/sync/sync-status.service';
import { PushSyncService, checkDependencyBlocked } from '@/services/sync/push-sync.service';
import { SyncManager } from '@/services/sync/sync-manager';
import { SyncAuditLogService } from '@/services/sync/sync-audit-log.service';
import { supabase } from '@/integrations/supabase/client';
import type { SyncOutboxRecord } from '@/types/database';

describe('UniTap 2.0 — Real-Time Sync Progress Monitor & Push Verification', () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
    SyncStatusService.resetPushProgress();
    SyncStatusService.resetPullProgress();
    SyncStatusService.setSyncSummary(null);
    SyncStatusService.setLastError(null);
    SyncStatusService.setState('UP_TO_DATE');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Point 1 & 5: Empty outbox displays "Nothing to upload" without misleading progress', async () => {
    const res = await PushSyncService.pushPendingOperations();
    expect(res.attemptedCount).toBe(0);
    expect(res.confirmedCount).toBe(0);
    expect(res.pushedCount).toBe(0);
    expect(res.errorCount).toBe(0);

    const progress = SyncStatusService.pushProgress.value;
    expect(progress.isActive).toBe(false);
    expect(progress.totalEligible).toBe(0);
    expect(progress.lastAck).toBe('Nothing to upload');
    expect(progress.percent).toBe(100);
  });

  it('Point 1: Distinguishes between Outbox Operations, Unique Records, and Eligible Ops', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_test', 'Terminal Test', 'DEV-TEST-01', 'ACTIVE', ?)`,
      [now]
    );

    // Insert 3 operations for 2 unique entities:
    // 2 ops for student stu_A (CREATE, UPDATE)
    // 1 op for student stu_B (CREATE)
    // 1 op with synced_at (already synced, ineligible)
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at)
       VALUES ('op_1', 'dev_test', 'STUDENT', 'stu_A', 'CREATE', '{"id":"stu_A","school_id":"2026-0001"}', ?)`,
      [now]
    );
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at)
       VALUES ('op_2', 'dev_test', 'STUDENT', 'stu_A', 'UPDATE', '{"id":"stu_A","first_name":"Updated"}', ?)`,
      [now]
    );
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at)
       VALUES ('op_3', 'dev_test', 'STUDENT', 'stu_B', 'CREATE', '{"id":"stu_B","school_id":"2026-0002"}', ?)`,
      [now]
    );
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at, synced_at)
       VALUES ('op_4', 'dev_test', 'STUDENT', 'stu_C', 'CREATE', '{"id":"stu_C","school_id":"2026-0003"}', ?, ?)`,
      [now, now]
    );

    await SyncManager.refreshCountsFromDatabase();

    // Total pending eligible outbox operations = 3 (op_4 excluded because synced_at IS NOT NULL)
    expect(SyncStatusService.pendingCount.value).toBe(3);

    // Verify unique records
    const uniqueRow = await db.queryOne<{ count: number }>(
      'SELECT count(DISTINCT entity_type || ":" || entity_id) as count FROM sync_outbox WHERE synced_at IS NULL'
    );
    expect(uniqueRow?.count).toBe(2); // Only stu_A and stu_B
  });

  it('Point 2 & 7: Handles 803 queued operations across multiple batches with live progress updates', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_test', 'Terminal Test', 'DEV-TEST-01', 'ACTIVE', ?)`,
      [now]
    );

    // Seed 803 attendance operations into SQLite sync_outbox
    const TOTAL_RECORDS = 803;
    await db.transaction(async (tx) => {
      for (let i = 1; i <= TOTAL_RECORDS; i++) {
        const id = `op_803_${i.toString().padStart(4, '0')}`;
        const studentId = `stu_${i}`;
        await tx.execute(
          `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at)
           VALUES (?, 'dev_test', 'ATTENDANCE', ?, 'CREATE', ?, ?)`,
          [
            id,
            `att_${i}`,
            JSON.stringify({
              id: `att_${i}`,
              occurrence_id: 'occ_1',
              student_id: studentId,
              status: 'PRESENT',
            }),
            now,
          ]
        );
      }
    });

    const countBefore = await db.queryOne<{ count: number }>('SELECT count(*) as count FROM sync_outbox');
    expect(countBefore?.count).toBe(803);

    // Mock supabase.rpc('sync_push_batch') to succeed authoritatively for all batches
    const rpcCalls: any[] = [];
    vi.spyOn(supabase, 'rpc').mockImplementation(async (fn: string, params: any) => {
      if (fn === 'sync_push_batch') {
        rpcCalls.push(params);
        const results = params.p_operations.map((op: any) => ({
          id: op.id,
          status: 'APPLIED',
        }));
        return { data: { results }, error: null } as any;
      }
      return { data: null, error: null } as any;
    });

    const progressSnapshots: any[] = [];
    const res = await PushSyncService.pushPendingOperations({
      batchSize: 50,
      onProgress: (p) => progressSnapshots.push({ ...p }),
    });

    // 803 / 50 = 17 batches (16 batches of 50 + 1 batch of 3)
    expect(rpcCalls.length).toBe(17);
    expect(rpcCalls[0].p_operations.length).toBe(50);
    expect(rpcCalls[16].p_operations.length).toBe(3);

    expect(res.attemptedCount).toBe(803);
    expect(res.confirmedCount).toBe(803);
    expect(res.failedCount).toBe(0);
    expect(res.blockedCount).toBe(0);

    // Live progress verified
    expect(progressSnapshots.length).toBeGreaterThanOrEqual(17);
    const lastProgress = progressSnapshots[progressSnapshots.length - 1];
    expect(lastProgress.confirmed).toBe(803);
    expect(lastProgress.remaining).toBe(0);
    expect(lastProgress.percent).toBe(100);

    // Outbox should be completely flushed
    const remainingInDb = await db.queryOne<{ count: number }>('SELECT count(*) as count FROM sync_outbox');
    expect(remainingInDb?.count).toBe(0);
  });

  it('Point 3: Partial Batch Success — Authoritative confirmation and retry preservation', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_test', 'Terminal Test', 'DEV-TEST-01', 'ACTIVE', ?)`,
      [now]
    );

    // Insert 4 operations
    const ops = ['op_p1', 'op_p2', 'op_p3', 'op_p4'];
    for (const opId of ops) {
      await db.execute(
        `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at)
         VALUES (?, 'dev_test', 'ATTENDANCE', ?, 'CREATE', '{"id":"test"}', ?)`,
        [opId, `ent_${opId}`, now]
      );
    }

    // Mock batch response with mixed results:
    // op_p1: APPLIED (Confirmed)
    // op_p2: REVIEW_REQUIRED (Conflict)
    // op_p3: REJECTED_FINAL (Permanent failure)
    // op_p4: FAILED (Transient failure - must be preserved for retry)
    vi.spyOn(supabase, 'rpc').mockImplementation(async (fn: string) => {
      if (fn === 'sync_push_batch') {
        return {
          data: {
            results: [
              { id: 'op_p1', status: 'APPLIED' },
              { id: 'op_p2', status: 'REVIEW_REQUIRED', scan_result: { note: 'Revoked offline' } },
              { id: 'op_p3', status: 'REJECTED_FINAL', error: 'Malformed entity' },
              { id: 'op_p4', status: 'REJECTED', error: 'Lock contention / timeout' },
            ],
          },
          error: null,
        } as any;
      }
      return { data: null, error: null } as any;
    });

    const res = await PushSyncService.pushPendingOperations({ batchSize: 10 });

    expect(res.confirmedCount).toBe(1);
    expect(res.conflictCount).toBe(1);
    expect(res.failedCount).toBe(2);

    // Confirmed, Review_required, and Rejected_final are removed from outbox
    const op1 = await db.query('SELECT * FROM sync_outbox WHERE id = "op_p1"');
    const op2 = await db.query('SELECT * FROM sync_outbox WHERE id = "op_p2"');
    const op3 = await db.query('SELECT * FROM sync_outbox WHERE id = "op_p3"');
    expect(op1.length).toBe(0);
    expect(op2.length).toBe(0);
    expect(op3.length).toBe(0);

    // op_p4 must be preserved in sync_outbox with updated retry_count and last_error
    const op4 = await db.query<SyncOutboxRecord>('SELECT * FROM sync_outbox WHERE id = "op_p4"');
    expect(op4.length).toBe(1);
    expect(op4[0].retry_count).toBe(1);
    expect(op4[0].last_error).toContain('Lock contention');

    // op_p2 and op_p3 recorded in sync_conflicts
    const conflicts = await db.query('SELECT * FROM sync_conflicts');
    expect(conflicts.length).toBe(2);
  });

  it('Point 3: Dependency Blocking — Upstream entity failure blocks dependent records', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_test', 'Terminal Test', 'DEV-TEST-01', 'ACTIVE', ?)`,
      [now]
    );

    // Queue student and dependent enrollment
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at)
       VALUES ('op_stu_fail', 'dev_test', 'STUDENT', 'stu_failed_1', 'CREATE', '{"id":"stu_failed_1"}', ?)`,
      [now]
    );
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at)
       VALUES ('op_enr_dep', 'dev_test', 'ENROLLMENT', 'enr_1', 'CREATE', '{"id":"enr_1","student_id":"stu_failed_1"}', ?)`,
      [now]
    );

    // Student fails on server
    vi.spyOn(supabase, 'rpc').mockImplementation(async (fn: string) => {
      if (fn === 'sync_push_batch') {
        return {
          data: {
            results: [{ id: 'op_stu_fail', status: 'FAILED', error: 'Student ID collision' }],
          },
          error: null,
        } as any;
      }
      return { data: null, error: null } as any;
    });

    const res = await PushSyncService.pushPendingOperations({ batchSize: 1 });

    expect(res.failedCount).toBe(1);
    expect(res.blockedCount).toBe(1);

    // Dependent enrollment was blocked by prerequisite student failure
    const auditLogs = await SyncAuditLogService.getLogs({ direction: 'PUSH' });
    const blockedLog = auditLogs.logs.find((l) => l.operation_id === 'op_enr_dep');
    expect(blockedLog).toBeDefined();
    expect(blockedLog?.status).toBe('SKIPPED');
    expect(blockedLog?.error_message).toContain('stu_failed_1');
  });

  it('Point 6 & 7: Authentication Failure gracefully blocks outbox without data loss', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_test', 'Terminal Test', 'DEV-TEST-01', 'ACTIVE', ?)`,
      [now]
    );

    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at)
       VALUES ('op_auth_1', 'dev_test', 'ATTENDANCE', 'att_1', 'CREATE', '{"id":"att_1"}', ?)`,
      [now]
    );
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at)
       VALUES ('op_auth_2', 'dev_test', 'ATTENDANCE', 'att_2', 'CREATE', '{"id":"att_2"}', ?)`,
      [now]
    );

    // Server returns 401 Unauthorized / JWT expired
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'JWT expired. User must re-authenticate' },
    } as any);

    const res = await PushSyncService.pushPendingOperations({ batchSize: 1 });

    expect(res.blockedCount).toBe(2);
    expect(SyncStatusService.state.value).toBe('AUTH_REQUIRED');

    // Records must remain safely in sync_outbox for retry after re-login
    const outboxAfter = await db.query('SELECT * FROM sync_outbox');
    expect(outboxAfter.length).toBe(2);
  });

  it('Point 4: Sync Audit Logs remain strictly local and record full metadata', async () => {
    const db = await getDatabase();
    const opId = 'op_audit_verify';
    const recordId = 'rec_12345';

    await SyncAuditLogService.recordLog({
      operationId: opId,
      direction: 'PUSH',
      entityType: 'ATTENDANCE',
      recordId,
      operationType: 'CREATE',
      status: 'SUCCESS',
      attemptCount: 2,
      durationMs: 45,
      serverAckRef: 'CONFIRMED_V2',
      details: { token: 'SECRET_SHOULD_BE_REDACTED', checked_in: true },
    }, db);

    const { logs } = await SyncAuditLogService.getLogs({ searchQuery: opId });
    expect(logs.length).toBe(1);

    const log = logs[0];
    expect(log.operation_id).toBe(opId);
    expect(log.record_id).toBe(recordId);
    expect(log.entity_type).toBe('ATTENDANCE');
    expect(log.direction).toBe('PUSH');
    expect(log.status).toBe('SUCCESS');
    expect(log.attempt_count).toBe(2);
    expect(log.duration_ms).toBe(45);
    expect(log.server_ack_ref).toBe('CONFIRMED_V2');

    // Redaction verified: never logs sensitive tokens
    expect(log.details_json).toContain('[REDACTED]');
    expect(log.details_json).not.toContain('SECRET_SHOULD_BE_REDACTED');

    // Never enters sync_outbox
    const outboxCheck = await db.query('SELECT * FROM sync_outbox WHERE id = ?', [log.id]);
    expect(outboxCheck.length).toBe(0);
  });

  it('Point 5 & 7: Progress accuracy and metric separation after application restart', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_test', 'Terminal Test', 'DEV-TEST-01', 'ACTIVE', ?)`,
      [now]
    );

    // Setup initial SQLite data across tables:
    // 1 pending outbox op
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at, last_error)
       VALUES ('op_failed', 'dev_test', 'ATTENDANCE', 'att_f', 'CREATE', '{"id":"att_f"}', ?, 'Connection timeout')`,
      [now]
    );
    // 1 open conflict
    await db.execute(
      `INSERT INTO sync_conflicts (id, entity_type, entity_id, local_payload_json, server_payload_json, reason, status, detected_at)
       VALUES ('conf_1', 'ATTENDANCE', 'att_f', '{}', '{}', 'Test conflict', 'OPEN', ?)`,
      [now]
    );
    // 2 successful audit logs
    await SyncAuditLogService.recordLog({
      operationId: 'op_c1',
      direction: 'PUSH',
      entityType: 'ATTENDANCE',
      operationType: 'CREATE',
      status: 'SUCCESS',
    }, db);
    await SyncAuditLogService.recordLog({
      operationId: 'op_c2',
      direction: 'PUSH',
      entityType: 'STUDENT',
      operationType: 'CREATE',
      status: 'SUCCESS',
    }, db);

    // Simulate app reboot by refreshing counts directly from SQLite
    await SyncManager.refreshCountsFromDatabase();

    expect(SyncStatusService.pendingCount.value).toBe(1);
    expect(SyncStatusService.failedOpsCount.value).toBe(1);
    expect(SyncStatusService.conflictCount.value).toBe(1);
    expect(SyncStatusService.confirmedUploadsCount.value).toBe(2);

    // Verify local record count is computed and not null
    expect(typeof SyncStatusService.totalLocalRecordsCount.value).toBe('number');
  });
});
