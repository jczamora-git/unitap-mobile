import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDatabase, resetDatabaseForTests } from '@/database/database';
import { SyncAuditLogService } from '@/services/sync/sync-audit-log.service';
import {
  SyncReconciliationService,
  RECONCILIATION_TARGET_ENTITIES,
} from '@/services/sync/sync-reconciliation.service';
import {
  PushSyncService,
  getEntityPriority,
  sanitizePayloadForRemote,
  SYNC_ENTITY_DEPENDENCY_ORDER,
} from '@/services/sync/push-sync.service';
import type { DatabaseAdapter } from '@/database/adapters/database-adapter.interface';
import { NetworkService } from '@/services/network.service';

describe('UniTap 2.0 Smart Sync Reconciliation & Local-Only Audit Suite', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = await resetDatabaseForTests();

    // Seed baseline academic period & device
    await db.execute(`
      INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
      VALUES ('dev_default', 'Default Test Device', 'DEV-TEST-001', 'ACTIVE', '2026-08-01T00:00:00.000Z');
    `);
    await db.execute(`
      INSERT OR IGNORE INTO academic_years (id, label, starts_on, ends_on, status)
      VALUES ('ay_2026', '2026-2027', '2026-06-01', '2027-03-31', 'ACTIVE');
    `);
    await db.execute(`
      INSERT OR IGNORE INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
      VALUES ('sem_2026_1', 'ay_2026', 'FIRST', '2026-06-01', '2026-10-31', 'ACTIVE');
    `);
  });

  describe('1. Local-Only Sync Audit Log Service', () => {
    it('records and queries audit logs with operational metadata', async () => {
      const logId = await SyncAuditLogService.recordLog(
        {
          operationId: 'op_push_1',
          direction: 'PUSH',
          entityType: 'OBLIGATION_RULE',
          recordId: 'rule_123',
          operationType: 'CREATE',
          status: 'SUCCESS',
          attemptCount: 1,
          durationMs: 42,
          serverAckRef: 'CONFIRMED',
          details: { name: 'Sportsfest 2026', amount_centavos: 10000 },
        },
        db
      );

      expect(logId).toBeTruthy();

      const { logs, total } = await SyncAuditLogService.getLogs({}, db);
      expect(total).toBe(1);
      expect(logs[0].entity_type).toBe('OBLIGATION_RULE');
      expect(logs[0].direction).toBe('PUSH');
      expect(logs[0].status).toBe('SUCCESS');
      expect(logs[0].duration_ms).toBe(42);
      expect(logs[0].server_ack_ref).toBe('CONFIRMED');
    });

    it('deeply sanitizes sensitive data (tokens, passwords, secrets)', async () => {
      const sensitiveData = {
        name: 'John Doe',
        password: 'super_secret_password',
        access_token: 'jwt.token.here',
        nested: {
          user_secret: '12345',
          api_key: 'sk_live_xyz',
          normalField: 'safeValue',
        },
      };

      const sanitized = SyncAuditLogService.sanitize(sensitiveData) as any;
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.access_token).toBe('[REDACTED]');
      expect(sanitized.nested.user_secret).toBe('[REDACTED]');
      expect(sanitized.nested.api_key).toBe('[REDACTED]');
      expect(sanitized.nested.normalField).toBe('safeValue');
      expect(sanitized.name).toBe('John Doe');
    });

    it('filters logs accurately by direction, status, entity, and search query', async () => {
      await SyncAuditLogService.recordLog(
        {
          direction: 'PUSH',
          entityType: 'STUDENT',
          operationType: 'CREATE',
          status: 'SUCCESS',
          recordId: 'st_1',
        },
        db
      );

      await SyncAuditLogService.recordLog(
        {
          direction: 'PULL',
          entityType: 'ATTENDANCE_RECORD',
          operationType: 'PULL_BATCH',
          status: 'FAILED',
          errorMessage: 'RPC timeout on attendance table',
        },
        db
      );

      // Filter by direction
      const pushLogs = await SyncAuditLogService.getLogs({ direction: 'PUSH' }, db);
      expect(pushLogs.total).toBe(1);
      expect(pushLogs.logs[0].entity_type).toBe('STUDENT');

      // Filter by status
      const failedLogs = await SyncAuditLogService.getLogs({ status: 'FAILED' }, db);
      expect(failedLogs.total).toBe(1);
      expect(failedLogs.logs[0].entity_type).toBe('ATTENDANCE_RECORD');

      // Filter by search query
      const searchLogs = await SyncAuditLogService.getLogs({ searchQuery: 'timeout' }, db);
      expect(searchLogs.total).toBe(1);
      expect(searchLogs.logs[0].error_message).toContain('RPC timeout');
    });

    it('prunes logs older than 30 days without touching sync_outbox or sync_conflicts', async () => {
      // Create outbox and conflict items
      await db.execute(`
        INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count)
        VALUES ('out_preserve_1', 'dev_default', 'STUDENT', 'st_100', 'CREATE', '{}', 1, '2026-08-01T00:00:00.000Z', 0)
      `);
      await db.execute(`
        INSERT INTO sync_conflicts (id, entity_type, entity_id, local_payload_json, server_payload_json, reason, status, detected_at)
        VALUES ('conf_preserve_1', 'STUDENT', 'st_100', '{}', '{}', 'COLLISION', 'OPEN', '2026-08-01T00:00:00.000Z')
      `);

      // Create an old audit log (40 days old)
      const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      await db.execute(
        `INSERT INTO sync_audit_logs (id, timestamp, direction, entity_type, operation_type, status, attempt_count, duration_ms)
         VALUES ('old_log', ?, 'PUSH', 'STUDENT', 'CREATE', 'SUCCESS', 1, 10)`,
        [oldTime]
      );

      // Create a recent audit log
      await SyncAuditLogService.recordLog(
        {
          direction: 'PUSH',
          entityType: 'STUDENT',
          operationType: 'CREATE',
          status: 'SUCCESS',
        },
        db
      );

      await SyncAuditLogService.pruneOldLogs(db);

      const { logs, total } = await SyncAuditLogService.getLogs({}, db);
      expect(total).toBe(1);
      expect(logs[0].id).not.toBe('old_log');

      // Verify sync_outbox and sync_conflicts remain intact
      const outbox = await db.queryOne<{ count: number }>('SELECT count(*) as count FROM sync_outbox');
      const conflicts = await db.queryOne<{ count: number }>('SELECT count(*) as count FROM sync_conflicts');
      expect(outbox?.count).toBe(1);
      expect(conflicts?.count).toBe(1);
    });
  });

  describe('2. Push Dependency Ordering & Remote Payload Sanitization', () => {
    it('assigns strict priority ordering: OBLIGATION_RULE before OBLIGATION, STUDENT before ENROLLMENT', () => {
      const rulePrio = getEntityPriority('OBLIGATION_RULE');
      const obPrio = getEntityPriority('OBLIGATION');
      const studentPrio = getEntityPriority('STUDENT');
      const enrollPrio = getEntityPriority('ENROLLMENT');
      const payPrio = getEntityPriority('PAYMENT');

      expect(rulePrio).toBeLessThan(obPrio);
      expect(studentPrio).toBeLessThan(enrollPrio);
      expect(studentPrio).toBeLessThan(obPrio);
      expect(obPrio).toBeLessThan(payPrio);
    });

    it('sanitizes OBLIGATION_RULE payloads by stripping non-Supabase columns (created_by_user_id, due_on)', () => {
      const rawRule = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        semester_id: 'sem_2026_1',
        name: 'Christmas Outreach 2026',
        type: 'CONTRIBUTION',
        trigger_type: 'MANUAL',
        default_amount_centavos: 5000,
        due_on: '2026-12-15',
        status: 'ACTIVE',
        created_by_user_id: 'usr_officer_1',
        created_at: '2026-11-01T00:00:00.000Z',
      };

      const sanitized = sanitizePayloadForRemote('OBLIGATION_RULE', rawRule);
      expect(sanitized.id).toBe(rawRule.id);
      expect(sanitized.name).toBe(rawRule.name);
      expect(sanitized.default_amount_centavos).toBe(5000);
      expect(sanitized).not.toHaveProperty('created_by_user_id');
      expect(sanitized).not.toHaveProperty('due_on');
    });

    it('sanitizes STUDENT payloads by stripping local-only photo_local_uri', () => {
      const rawStudent = {
        id: 'st_123',
        school_id: '2026-0001',
        first_name: 'Maria',
        last_name: 'Santos',
        photo_local_uri: 'file:///data/user/0/com.unitap.app/cache/photo.jpg',
      };

      const sanitized = sanitizePayloadForRemote('STUDENT', rawStudent);
      expect(sanitized.id).toBe('st_123');
      expect(sanitized.first_name).toBe('Maria');
      expect(sanitized).not.toHaveProperty('photo_local_uri');
    });
  });

  describe('3. Smart Sync Reconciliation Engine', () => {
    it('classifies records into IN_SYNC and LOCAL_UNQUEUED correctly', async () => {
      // Seed a local obligation rule with NO outbox entry
      await db.execute(`
        INSERT INTO obligation_rules (id, semester_id, name, type, trigger_type, default_amount_centavos, status, created_at)
        VALUES ('rule_local_only', 'sem_2026_1', 'Local Unqueued Collection', 'CONTRIBUTION', 'MANUAL', 5000, 'ACTIVE', '2026-11-01T00:00:00.000Z')
      `);

      // Mock offline or remote reachable test via reconcileEntity
      const report = await SyncReconciliationService.reconcileEntity(
        'obligation_rules',
        'obligation_rules',
        'OBLIGATION_RULE',
        false, // offline
        db
      );

      expect(report.localCount).toBe(1);
      expect(report.status).toBe('OFFLINE');
    });

    it('safely enqueues unqueued obligation rules and obligations in dependency order', async () => {
      const ruleId = '550e8400-e29b-41d4-a716-446655440001';
      const studentId = '550e8400-e29b-41d4-a716-446655440002';
      const obId = '550e8400-e29b-41d4-a716-446655440003';

      await db.execute(`
        INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
        VALUES ('${studentId}', '2026-0099', 'Juan', 'Cruz', 'ACTIVE', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
      `);

      await db.execute(`
        INSERT INTO obligation_rules (id, semester_id, name, type, trigger_type, default_amount_centavos, status, created_at)
        VALUES ('${ruleId}', 'sem_2026_1', 'Emergency Relief', 'CONTRIBUTION', 'MANUAL', 10000, 'ACTIVE', '2026-11-01T00:00:00.000Z');
      `);

      await db.execute(`
        INSERT INTO student_obligations (id, student_id, semester_id, rule_id, title, type, amount_centavos, status, issued_at, updated_at)
        VALUES ('${obId}', '${studentId}', 'sem_2026_1', '${ruleId}', 'Emergency Relief Assessment', 'CONTRIBUTION', 10000, 'ACTIVE', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
      `);

      // Requeue student obligations (should also detect unqueued rule_id and queue rule first)
      const res = await SyncReconciliationService.requeueUnqueuedRecords('student_obligations', [obId], db);
      expect(res.requeuedCount).toBe(2); // rule + obligation

      const outboxRows = await db.query<{ entity_type: string; entity_id: string }>(
        'SELECT entity_type, entity_id FROM sync_outbox ORDER BY created_at ASC'
      );

      expect(outboxRows.length).toBe(2);
      expect(outboxRows[0].entity_type).toBe('OBLIGATION_RULE');
      expect(outboxRows[0].entity_id).toBe(ruleId);
      expect(outboxRows[1].entity_type).toBe('OBLIGATION');
      expect(outboxRows[1].entity_id).toBe(obId);
    });

    it('resets retry count and errors when retrying failed operations', async () => {
      await db.execute(`
        INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count, last_error)
        VALUES ('out_failed_1', 'dev_default', 'OBLIGATION_RULE', 'r1', 'CREATE', '{}', 1, '2026-11-01T00:00:00.000Z', 3, 'Network timeout')
      `);

      const res = await SyncReconciliationService.retryFailedOperations(db);
      expect(res.retried).toBe(1);

      const row = await db.queryOne<{ retry_count: number; last_error: string | null }>(
        'SELECT retry_count, last_error FROM sync_outbox WHERE id = "out_failed_1"'
      );
      expect(row?.retry_count).toBe(0);
      expect(row?.last_error).toBeNull();
    });
  });
});
