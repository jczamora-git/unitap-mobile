import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import {
  SelectiveSyncService,
  DOMAIN_ENTITIES,
} from '@/services/sync/selective-sync.service';
import { OperationPolicyService } from '@/services/operation-policy.service';
import { supabase } from '@/integrations/supabase/client';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { StudentsRepository } from '@/database/repositories/students.repository';

describe('UniTap 2.0 — Phase 3: Smart Selective Offline Hybrid Sync', () => {
  let rpcCalls: Array<{ name: string; params: any }> = [];

  beforeEach(async () => {
    await resetDatabaseForTests();
    OperationPolicyService.setMockOfflineOverride(false);
    SelectiveSyncService.invalidateAll();
    rpcCalls = [];

    // Default Supabase RPC mock for sync_pull_entity_v2
    (supabase.rpc as any) = async (rpcName: string, params: any) => {
      rpcCalls.push({ name: rpcName, params });

      if (rpcName === 'sync_pull_entity_v2') {
        return {
          data: {
            records: [],
            pagination: {
              has_more: false,
              next_since: new Date().toISOString(),
              next_last_id: null,
            },
            server_time: new Date().toISOString(),
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };

    // Default to DEVADMIN role for unrestricted tests
    (SupabaseAuthService as any).currentRole.value = 'DEVADMIN';
  });

  // ============================================================================
  // 1. LOCAL-FIRST OFFLINE CACHED READS
  // ============================================================================

  it('preserves cached SQLite reads offline and fails soft on refresh without throwing', async () => {
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
       VALUES ('stu_off_1', '2026-0001', 'Offline', 'Student', 'ACTIVE', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    );

    // Simulate complete offline mode
    OperationPolicyService.setMockOfflineOverride(true);

    const result = await SelectiveSyncService.refreshStudents();
    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('OFFLINE');
    expect(result.cachedAvailable).toBe(true);

    // SQLite data remains intact and immediately queryable
    const students = await StudentsRepository.getStudents();
    expect(students).toHaveLength(1);
    expect(students[0].first_name).toBe('Offline');
    expect(rpcCalls).toHaveLength(0);
  });

  // ============================================================================
  // 2. SELECTIVE DOMAIN REFRESH (Pulls only requested tables, not all 19)
  // ============================================================================

  it('selectively refreshes only students domain entities rather than all 19 tables', async () => {
    const result = await SelectiveSyncService.refreshStudents(true);
    expect(result.refreshed).toBe(true);
    expect(result.reason).toBe('SUCCESS');

    // Only queries students, student_enrollments, and nfc_cards
    const queriedEntities = rpcCalls.map((c) => c.params.p_entity);
    expect(queriedEntities).toEqual(DOMAIN_ENTITIES.STUDENTS);
    expect(queriedEntities).not.toContain('events');
    expect(queriedEntities).not.toContain('payments');
    expect(queriedEntities).not.toContain('academic_years');
  });

  it('selectively refreshes only events domain entities', async () => {
    const result = await SelectiveSyncService.refreshEvents(true);
    expect(result.refreshed).toBe(true);
    expect(result.reason).toBe('SUCCESS');

    const queriedEntities = rpcCalls.map((c) => c.params.p_entity);
    expect(queriedEntities).toEqual(DOMAIN_ENTITIES.EVENTS);
    expect(queriedEntities).not.toContain('students');
  });

  // ============================================================================
  // 3. STALENESS TTL & NO REDUNDANT FETCH ON NAVIGATION
  // ============================================================================

  it('skips network fetch on repeated navigation within TTL', async () => {
    // First navigation: refreshes data
    const first = await SelectiveSyncService.refreshStudents();
    expect(first.refreshed).toBe(true);
    const initialCallCount = rpcCalls.length;
    expect(initialCallCount).toBeGreaterThan(0);

    // Second navigation immediately after (e.g. tab switch back):
    const second = await SelectiveSyncService.refreshStudents();
    expect(second.refreshed).toBe(false);
    expect(second.reason).toBe('FRESH');
    expect(second.cachedAvailable).toBe(true);

    // ZERO additional network RPC calls were made!
    expect(rpcCalls.length).toBe(initialCallCount);
  });

  it('bypasses TTL when force flag is set', async () => {
    await SelectiveSyncService.refreshStudents();
    const countAfterFirst = rpcCalls.length;

    // Forced refresh (e.g. Pull-to-refresh)
    const forced = await SelectiveSyncService.refreshStudents(true);
    expect(forced.refreshed).toBe(true);
    expect(rpcCalls.length).toBeGreaterThan(countAfterFirst);
  });

  // ============================================================================
  // 4. CONCURRENT DUPLICATE REFRESH COALESCING (Single-Flight Lock)
  // ============================================================================

  it('coalesces concurrent duplicate refreshes into a single network cycle', async () => {
    // Fire two identical refresh calls concurrently
    const [res1, res2] = await Promise.all([
      SelectiveSyncService.refreshStudents(true),
      SelectiveSyncService.refreshStudents(true),
    ]);

    expect(res1.refreshed).toBe(true);
    expect(res2.refreshed).toBe(true);

    // Exactly 3 RPC calls were made (1 per entity in STUDENTS domain), NOT 6!
    expect(rpcCalls).toHaveLength(3);
  });

  // ============================================================================
  // 5. FAIL-SOFT ERROR RECOVERY (Retains usable cached data)
  // ============================================================================

  it('retains usable SQLite data when remote refresh throws an error', async () => {
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
       VALUES ('stu_keep', '2026-9999', 'KeepMe', 'Safe', 'ACTIVE', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    );

    // Simulate server 500 error
    (supabase.rpc as any) = async () => ({
      data: null,
      error: { message: 'Cloud database connection timeout' },
    });

    const res = await SelectiveSyncService.refreshStudents(true);
    expect(res.refreshed).toBe(false);
    expect(res.cachedAvailable).toBe(true);
    expect(res.reason).toBe('ERROR');

    // Local cached student is intact and NOT wiped
    const students = await StudentsRepository.getStudents();
    expect(students).toHaveLength(1);
    expect(students[0].first_name).toBe('KeepMe');
  });

  // ============================================================================
  // 6. ROLE & SCOPE ISOLATION (STUDENT Role Restrictions)
  // ============================================================================

  it('restricts STUDENT role from synchronizing privileged tables (e.g. nfc_cards, obligation_rules)', async () => {
    (SupabaseAuthService as any).currentRole.value = 'STUDENT';

    // Attempting to refresh finance reference (which contains obligation_rules)
    const res = await SelectiveSyncService.refreshFinanceReference(true);
    // Student can only pull student_obligations, NOT obligation_rules
    const queriedEntities = rpcCalls.map((c) => c.params.p_entity);
    expect(queriedEntities).not.toContain('obligation_rules');
  });

  // ============================================================================
  // 7. SESSION & SIGN-OUT INVALIDATION
  // ============================================================================

  it('invalidates refresh timestamps and caches on sign-out / session change', async () => {
    await SelectiveSyncService.refreshStudents();
    expect(SelectiveSyncService.getDomainLastRefreshed('STUDENTS').value).not.toBeNull();

    // User signs out
    SelectiveSyncService.handleSessionChange(null);

    // Timestamps are reset
    expect(SelectiveSyncService.getDomainLastRefreshed('STUDENTS').value).toBeNull();

    // Next navigation will re-evaluate freshness
    const nextNav = await SelectiveSyncService.refreshStudents();
    expect(nextNav.refreshed).toBe(true);
  });

  // ============================================================================
  // 8. SEMESTER SWITCH INVALIDATION
  // ============================================================================

  it('invalidates semester-scoped domains on semester change', async () => {
    await SelectiveSyncService.refreshStudents();
    await SelectiveSyncService.refreshEvents();
    expect(SelectiveSyncService.getDomainLastRefreshed('STUDENTS').value).not.toBeNull();
    expect(SelectiveSyncService.getDomainLastRefreshed('EVENTS').value).not.toBeNull();

    // Active semester changes
    SelectiveSyncService.handleSemesterChange();

    expect(SelectiveSyncService.getDomainLastRefreshed('STUDENTS').value).toBeNull();
    expect(SelectiveSyncService.getDomainLastRefreshed('EVENTS').value).toBeNull();
  });

  // ============================================================================
  // 9. OUTBOX & CONFLICT PRESERVATION
  // ============================================================================

  it('preserves pending outbox operations and conflicts during selective refresh', async () => {
    const db = await getDatabase();
    await db.execute(
      `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_test', 'Test Device', 'DEV-TEST', 'ACTIVE', '2026-08-01T00:00:00Z')`
    );
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at)
       VALUES ('op_attend_preserve', 'dev_test', 'ATTENDANCE', 'att_123', 'CREATE', '{"status":"PRESENT"}', 1, '2026-08-01T00:00:00Z')`
    );
    await db.execute(
      `INSERT INTO sync_conflicts (id, entity_type, entity_id, local_payload_json, server_payload_json, reason, status, detected_at)
       VALUES ('conf_preserve', 'STUDENT', 'stu_123', '{}', '{}', 'STALE_DATA', 'OPEN', '2026-08-01T00:00:00Z')`
    );

    await SelectiveSyncService.refreshStudents(true);
    await SelectiveSyncService.refreshAttendance(true);

    // Verify outbox and conflicts were NOT deleted or altered
    const outbox = await db.query('SELECT * FROM sync_outbox WHERE id = "op_attend_preserve"');
    expect(outbox).toHaveLength(1);

    const conflicts = await db.query('SELECT * FROM sync_conflicts WHERE id = "conf_preserve"');
    expect(conflicts).toHaveLength(1);
  });
});
