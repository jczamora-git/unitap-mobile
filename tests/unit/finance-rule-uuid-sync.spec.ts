import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { FinanceService } from '@/services/finance.service';
import { FinanceRepository } from '@/database/repositories/finance.repository';
import { PushSyncService, checkDependencyBlocked, sanitizePayloadForRemote, getEntityPriority } from '@/services/sync/push-sync.service';
import { SyncStatusService } from '@/services/sync/sync-status.service';
import { supabase } from '@/integrations/supabase/client';
import type { SyncOutboxRecord, ObligationRule } from '@/types/database';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('UniTap 2.0 — Finance Rule UUID Synchronization & Repair', () => {
  const financeService = new FinanceService();

  beforeEach(async () => {
    await resetDatabaseForTests();
    const db = await getDatabase();
    await db.execute(
      `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', datetime('now'))`
    );
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

  it('1. Generates raw RFC 4122 UUIDs without prefix for all new obligation rules', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // Ensure semester exists
    await db.execute(
      `INSERT OR IGNORE INTO academic_years (id, label, starts_on, ends_on, status)
       VALUES ('ay_2026', '2026-2027', '2026-06-01', '2027-04-30', 'ACTIVE')`
    );
    await db.execute(
      `INSERT OR IGNORE INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
       VALUES ('sem_2026_1', 'ay_2026', 'FIRST', '2026-06-01', '2026-10-31', 'ACTIVE')`
    );

    const rule = await financeService.createRule({
      semesterId: 'sem_2026_1',
      name: 'General Assembly Fine',
      type: 'FINE',
      triggerType: 'ABSENCE',
      defaultAmountCentavos: 5000,
    });

    // Verify returned rule ID is a raw UUID without prefix
    expect(rule.id).not.toContain('rule_');
    expect(UUID_REGEX.test(rule.id)).toBe(true);

    // Verify stored in obligation_rules table
    const storedRule = await db.queryOne<ObligationRule>(
      'SELECT * FROM obligation_rules WHERE id = ?',
      [rule.id]
    );
    expect(storedRule).toBeDefined();
    expect(storedRule?.id).toBe(rule.id);
    expect(UUID_REGEX.test(storedRule!.id)).toBe(true);

    // Verify queued outbox operation
    const outboxOp = await db.queryOne<SyncOutboxRecord>(
      `SELECT * FROM sync_outbox WHERE entity_type = 'OBLIGATION_RULE' AND entity_id = ?`,
      [rule.id]
    );
    expect(outboxOp).toBeDefined();
    expect(outboxOp?.entity_id).toBe(rule.id);
    expect(UUID_REGEX.test(outboxOp!.entity_id)).toBe(true);

    const payload = JSON.parse(outboxOp!.payload_json);
    expect(payload.id).toBe(rule.id);
    expect(UUID_REGEX.test(payload.id)).toBe(true);
  });

  it('2. Enforces valid rule_id references in obligations linking to the raw rule UUID', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT OR IGNORE INTO academic_years (id, label, starts_on, ends_on, status)
       VALUES ('ay_2026', '2026-2027', '2026-06-01', '2027-04-30', 'ACTIVE')`
    );
    await db.execute(
      `INSERT OR IGNORE INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
       VALUES ('sem_2026_1', 'ay_2026', 'FIRST', '2026-06-01', '2026-10-31', 'ACTIVE')`
    );
    await db.execute(
      `INSERT OR IGNORE INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
       VALUES ('stu_uuid_01', '2026-1001', 'Maria', 'Santos', 'ACTIVE', ?, ?)`,
      [now, now]
    );

    const rule = await financeService.createRule({
      semesterId: 'sem_2026_1',
      name: 'Department Shirt Contribution',
      type: 'CONTRIBUTION',
      triggerType: 'MANUAL',
      defaultAmountCentavos: 15000,
    });

    const obligation = await financeService.issueManualFine({
      studentId: 'stu_uuid_01',
      semesterId: 'sem_2026_1',
      title: 'Department Shirt Contribution',
      amountCentavos: 15000,
      ruleId: rule.id,
    });

    expect(obligation.ruleId).toBe(rule.id);
    expect(UUID_REGEX.test(obligation.ruleId!)).toBe(true);

    // Verify stored student_obligation has valid foreign key reference
    const storedOb = await db.queryOne<{ rule_id: string }>(
      'SELECT rule_id FROM student_obligations WHERE id = ?',
      [obligation.id]
    );
    expect(storedOb?.rule_id).toBe(rule.id);

    // Verify queued outbox payload
    const obOutbox = await db.queryOne<SyncOutboxRecord>(
      `SELECT * FROM sync_outbox WHERE entity_type = 'OBLIGATION' AND entity_id = ?`,
      [obligation.id]
    );
    expect(obOutbox).toBeDefined();
    const payload = JSON.parse(obOutbox!.payload_json);
    expect(payload.rule_id).toBe(rule.id);
    expect(UUID_REGEX.test(payload.rule_id)).toBe(true);
  });

  it('3. Safely detects and repairs legacy rule_ prefixed IDs using the UUID suffix without collisions', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const rawUuid = 'ac57b8a3-8f54-4ebf-b520-263b2a711667';
    const legacyRuleId = `rule_${rawUuid}`;

    await db.execute(
      `INSERT OR IGNORE INTO academic_years (id, label, starts_on, ends_on, status)
       VALUES ('ay_2026', '2026-2027', '2026-06-01', '2027-04-30', 'ACTIVE')`
    );
    await db.execute(
      `INSERT OR IGNORE INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
       VALUES ('sem_2026_1', 'ay_2026', 'FIRST', '2026-06-01', '2026-10-31', 'ACTIVE')`
    );
    await db.execute(
      `INSERT OR IGNORE INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
       VALUES ('stu_legacy_01', '2026-2001', 'Juan', 'Dela Cruz', 'ACTIVE', ?, ?)`,
      [now, now]
    );

    // Seed legacy obligation_rules record
    await db.execute(
      `INSERT INTO obligation_rules (id, semester_id, name, type, trigger_type, default_amount_centavos, status, created_at)
       VALUES (?, 'sem_2026_1', 'Legacy Assembly Fine', 'FINE', 'ABSENCE', 5000, 'ACTIVE', ?)`,
      [legacyRuleId, now]
    );

    // Seed dependent student_obligations referencing legacy rule ID
    const obId = 'd1000000-0000-4000-8000-000000000001';
    await db.execute(
      `INSERT INTO student_obligations (id, student_id, semester_id, rule_id, title, type, amount_centavos, status, issued_at, updated_at)
       VALUES (?, 'stu_legacy_01', 'sem_2026_1', ?, 'Legacy Assembly Fine', 'FINE', 5000, 'ACTIVE', ?, ?)`,
      [obId, legacyRuleId, now, now]
    );

    // Seed outbox operations with legacy rule ID
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at, retry_count, last_error)
       VALUES ('op_rule_legacy_01', 'dev_default', 'OBLIGATION_RULE', ?, 'CREATE', ?, ?, 1, ?)`,
      [
        legacyRuleId,
        JSON.stringify({ id: legacyRuleId, semester_id: 'sem_2026_1', name: 'Legacy Assembly Fine' }),
        now,
        `invalid input syntax for type uuid: ${legacyRuleId}`,
      ]
    );

    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at, retry_count, last_error)
       VALUES ('op_ob_legacy_01', 'dev_default', 'OBLIGATION', ?, 'CREATE', ?, ?, 1, ?)`,
      [
        obId,
        JSON.stringify({ id: obId, student_id: 'stu_legacy_01', rule_id: legacyRuleId, title: 'Legacy Assembly Fine' }),
        now,
        `invalid input syntax for type uuid: ${legacyRuleId}`,
      ]
    );

    // Run the repair
    const repairResult = await FinanceRepository.repairLegacyObligationRuleIds(db);

    expect(repairResult.rulesRepaired).toBe(1);
    expect(repairResult.obligationsRepaired).toBe(1);
    expect(repairResult.outboxRepaired).toBe(2);

    // 1. Verify obligation_rules updated to raw UUID suffix
    const oldRule = await db.queryOne<ObligationRule>(
      'SELECT * FROM obligation_rules WHERE id = ?',
      [legacyRuleId]
    );
    expect(oldRule).toBeNull();

    const repairedRule = await db.queryOne<ObligationRule>(
      'SELECT * FROM obligation_rules WHERE id = ?',
      [rawUuid]
    );
    expect(repairedRule).toBeDefined();
    expect(repairedRule?.id).toBe(rawUuid);

    // 2. Verify student_obligations updated to raw UUID
    const repairedOb = await db.queryOne<{ rule_id: string }>(
      'SELECT rule_id FROM student_obligations WHERE id = ?',
      [obId]
    );
    expect(repairedOb?.rule_id).toBe(rawUuid);

    // 3. Verify outbox operation IDs were PRESERVED and not rewritten!
    const ruleOp = await db.queryOne<SyncOutboxRecord>(
      'SELECT * FROM sync_outbox WHERE id = ?',
      ['op_rule_legacy_01']
    );
    expect(ruleOp).toBeDefined();
    expect(ruleOp?.id).toBe('op_rule_legacy_01'); // Preserved!
    expect(ruleOp?.entity_id).toBe(rawUuid); // Updated entity_id
    const rulePayload = JSON.parse(ruleOp!.payload_json);
    expect(rulePayload.id).toBe(rawUuid); // Updated payload ID
    expect(ruleOp?.retry_count).toBe(0); // Requeued
    expect(ruleOp?.last_error).toBeNull(); // Cleared

    const obOp = await db.queryOne<SyncOutboxRecord>(
      'SELECT * FROM sync_outbox WHERE id = ?',
      ['op_ob_legacy_01']
    );
    expect(obOp).toBeDefined();
    expect(obOp?.id).toBe('op_ob_legacy_01'); // Preserved!
    const obPayload = JSON.parse(obOp!.payload_json);
    expect(obPayload.rule_id).toBe(rawUuid); // Updated payload rule_id
    expect(obOp?.retry_count).toBe(0); // Requeued
    expect(obOp?.last_error).toBeNull(); // Cleared
  });

  it('4. Requeues failed operations without duplicating already-confirmed records', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const rawUuid = 'bc57b8a3-8f54-4ebf-b520-263b2a711668';
    const legacyRuleId = `rule_${rawUuid}`;

    // Seed 3 failed un-synced operations
    for (let i = 1; i <= 3; i++) {
      await db.execute(
        `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at, retry_count, last_error)
         VALUES (?, 'dev_default', 'OBLIGATION', ?, 'CREATE', ?, ?, 2, 'invalid input syntax for type uuid: rule_xxx')`,
        [
          `op_failed_${i}`,
          `ob_failed_${i}`,
          JSON.stringify({ id: `ob_failed_${i}`, rule_id: legacyRuleId }),
          now,
        ]
      );
    }

    // Seed 1 already-confirmed operation (synced_at set)
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at, synced_at, retry_count)
       VALUES ('op_confirmed_01', 'dev_default', 'STUDENT', 'stu_conf_01', 'CREATE', '{"id":"stu_conf_01"}', ?, ?, 0)`,
      [now, now]
    );

    await FinanceRepository.repairLegacyObligationRuleIds(db);

    // Verify failed operations are requeued
    const requeuedOps = await db.query<SyncOutboxRecord>(
      `SELECT * FROM sync_outbox WHERE id LIKE 'op_failed_%'`
    );
    expect(requeuedOps.length).toBe(3);
    for (const op of requeuedOps) {
      expect(op.retry_count).toBe(0);
      expect(op.last_error).toBeNull();
      expect(op.synced_at).toBeNull();
    }

    // Verify confirmed operation was untouched
    const confirmedOp = await db.queryOne<SyncOutboxRecord>(
      'SELECT * FROM sync_outbox WHERE id = ?',
      ['op_confirmed_01']
    );
    expect(confirmedOp).toBeDefined();
    expect(confirmedOp?.synced_at).not.toBeNull();
  });

  it('5. Enforces dependency ordering: OBLIGATION_RULE pushed before OBLIGATION and blocks on failure', () => {
    // Check dependency order priority
    const rulePriority = getEntityPriority('OBLIGATION_RULE');
    const obPriority = getEntityPriority('OBLIGATION');
    expect(rulePriority).toBeLessThan(obPriority);

    // Verify checkDependencyBlocked detects failed prerequisite rule
    const failedIds = new Set<string>(['rule_failed_uuid_01']);
    const dependentOp: SyncOutboxRecord = {
      id: 'op_ob_test_01',
      device_id: 'dev_default',
      entity_type: 'OBLIGATION',
      entity_id: 'ob_test_uuid_01',
      operation: 'CREATE',
      payload_json: JSON.stringify({
        id: 'ob_test_uuid_01',
        student_id: 'stu_01',
        rule_id: 'rule_failed_uuid_01',
      }),
      schema_version: 1,
      created_at: new Date().toISOString(),
      retry_count: 0,
      synced_at: null,
      last_error: null,
    };

    const blockCheck = checkDependencyBlocked(dependentOp, failedIds);
    expect(blockCheck.blocked).toBe(true);
    expect(blockCheck.reason).toContain('Prerequisite obligation rule rule_failed_uuid_01 failed');
  });

  it('6. Defensively normalizes legacy rule_ prefixes in sanitizePayloadForRemote', () => {
    const rawUuid = 'cc57b8a3-8f54-4ebf-b520-263b2a711669';
    const legacyRuleId = `rule_${rawUuid}`;

    // 1. OBLIGATION_RULE payload
    const rulePayload = sanitizePayloadForRemote('OBLIGATION_RULE', {
      id: legacyRuleId,
      semester_id: 'sem_01',
      name: 'Defensive Rule',
      type: 'FINE',
      default_amount_centavos: 2500,
    });
    expect(rulePayload.id).toBe(rawUuid);
    expect(UUID_REGEX.test(rulePayload.id)).toBe(true);

    // 2. OBLIGATION payload
    const obPayload = sanitizePayloadForRemote('OBLIGATION', {
      id: 'd2000000-0000-4000-8000-000000000002',
      student_id: 'stu_01',
      semester_id: 'sem_01',
      rule_id: legacyRuleId,
      title: 'Defensive Obligation',
      amount_centavos: 2500,
    });
    expect(obPayload.rule_id).toBe(rawUuid);
    expect(UUID_REGEX.test(obPayload.rule_id)).toBe(true);
  });

  it('7. Successfully pushes repaired operations to Supabase with authoritative acknowledgement', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const rawUuid = 'dc57b8a3-8f54-4ebf-b520-263b2a711670';
    const legacyRuleId = `rule_${rawUuid}`;

    // Seed legacy rule and obligation into outbox
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at, retry_count, last_error)
       VALUES ('op_rule_push', 'dev_default', 'OBLIGATION_RULE', ?, 'CREATE', ?, ?, 1, 'invalid input syntax for type uuid')`,
      [legacyRuleId, JSON.stringify({ id: legacyRuleId, semester_id: 'sem_01', name: 'Push Test Rule' }), now]
    );

    const obUuid = 'e2000000-0000-4000-8000-000000000003';
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at, retry_count, last_error)
       VALUES ('op_ob_push', 'dev_default', 'OBLIGATION', ?, 'CREATE', ?, ?, 1, 'invalid input syntax for type uuid')`,
      [obUuid, JSON.stringify({ id: obUuid, student_id: 'stu_01', rule_id: legacyRuleId, title: 'Push Test Ob' }), now]
    );

    // Mock Supabase rpc to accept operations and confirm
    let pushedOperations: any[] = [];
    vi.spyOn(supabase, 'rpc').mockImplementation((rpcName: string, params: any) => {
      if (rpcName === 'sync_push_batch') {
        pushedOperations = params.p_operations;
        return Promise.resolve({
          data: {
            success: true,
            results: params.p_operations.map((op: any) => ({
              id: op.id,
              entity_type: op.entity_type,
              entity_id: op.entity_id,
              status: 'APPLIED',
              message: 'Successfully applied to cloud',
            })),
          },
          error: null,
        }) as any;
      }
      return Promise.resolve({ data: null, error: null }) as any;
    });

    const result = await PushSyncService.pushPendingOperations();

    expect(result.attemptedCount).toBe(2);
    expect(result.confirmedCount).toBe(2);
    expect(result.failedCount).toBe(0);

    // Verify operations pushed had canonical raw UUIDs!
    const ruleOp = pushedOperations.find((op) => op.entity_type === 'OBLIGATION_RULE');
    expect(ruleOp).toBeDefined();
    expect(ruleOp.entity_id).toBe(rawUuid);
    expect(UUID_REGEX.test(ruleOp.entity_id)).toBe(true);

    const obOp = pushedOperations.find((op) => op.entity_type === 'OBLIGATION');
    expect(obOp).toBeDefined();
    expect(obOp.payload.rule_id).toBe(rawUuid);
    expect(UUID_REGEX.test(obOp.payload.rule_id)).toBe(true);

    // Verify outbox was cleared for confirmed operations
    const remainingOutbox = await db.query<SyncOutboxRecord>(
      'SELECT * FROM sync_outbox WHERE synced_at IS NULL'
    );
    expect(remainingOutbox.length).toBe(0);
  });
});
