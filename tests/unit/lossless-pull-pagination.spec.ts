import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { EntityCheckpointService } from '@/services/sync/entity-checkpoint.service';
import { PullSyncService } from '@/services/sync/pull-sync.service';
import { InitialSyncService } from '@/services/sync/initial-sync.service';
import { SchemaMapperService } from '@/services/sync/schema-mapper.service';
import { supabase } from '@/integrations/supabase/client';

/**
 * UniTap 2.0 Lossless Multi-Table Pull Pagination Tests (Task 3)
 *
 * NOTE ON TEST HARNESS EXECUTION:
 * 1. PostgreSQL RPC tests execute against disposable in-memory PGlite instances,
 *    verifying PL/pgSQL logic, cursor tie-breaking, UUID/TEXT casting, and role-scoping.
 * 2. SQLite tests execute against WebAssembly sql.js (`WebDevSqliteAdapter`),
 *    verifying durable checkpoints, atomic transaction commits, failure rollback,
 *    and outbox protection during multi-page pagination.
 */
describe('UniTap 2.0 Lossless Multi-Table Pull Pagination (Task 3)', { timeout: 25000 }, () => {
  let pg: PGlite;

  const DEVADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
  const STUDENT_USER_ID = '22222222-2222-4222-8222-222222222222';
  const STUDENT_RECORD_ID = '33333333-3333-4333-8333-333333333333';
  const OFFICER_USER_ID = '44444444-4444-4444-8444-444444444444';

  async function setupPgDatabase(): Promise<PGlite> {
    const db = new PGlite();

    // 1. Setup mock auth context, auth.uid() function, and Supabase roles
    await db.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated;
        END IF;
      END $$;

      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.current_user_context (
        user_id UUID
      );
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
        SELECT user_id FROM auth.current_user_context LIMIT 1;
      $$ LANGUAGE sql STABLE;
    `);

    // 2. Setup public schema baseline tables
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        student_id UUID,
        email TEXT
      );

      CREATE TABLE IF NOT EXISTS user_roles (
        id UUID PRIMARY KEY DEFAULT 'a0000000-0000-4000-8000-000000000001',
        user_id UUID NOT NULL,
        role TEXT NOT NULL,
        revoked_at TIMESTAMPTZ DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS officer_appointments (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        role TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        status TEXT NOT NULL,
        appointment_start TIMESTAMPTZ NOT NULL,
        appointment_end TIMESTAMPTZ NOT NULL,
        suspended_at TIMESTAMPTZ DEFAULT NULL,
        revoked_at TIMESTAMPTZ DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS academic_years (
        id TEXT PRIMARY KEY,
        name TEXT,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS semesters (
        id TEXT PRIMARY KEY,
        name TEXT,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS programs (
        id TEXT PRIMARY KEY,
        name TEXT
      );

      CREATE TABLE IF NOT EXISTS year_levels (
        id UUID PRIMARY KEY,
        name TEXT,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS sections (
        id UUID PRIMARY KEY,
        name TEXT,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS event_categories (
        id UUID PRIMARY KEY,
        name TEXT,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY,
        title TEXT,
        status TEXT DEFAULT 'ACTIVE',
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS event_occurrences (
        id UUID PRIMARY KEY,
        event_id UUID REFERENCES events(id),
        starts_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS students (
        id UUID PRIMARY KEY,
        user_id UUID,
        student_id_number TEXT,
        first_name TEXT,
        last_name TEXT,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS student_enrollments (
        id UUID PRIMARY KEY,
        student_id UUID REFERENCES students(id),
        program_id TEXT,
        section_id UUID,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS nfc_cards (
        id UUID PRIMARY KEY,
        student_id UUID,
        uid_normalized TEXT,
        status TEXT DEFAULT 'ACTIVE',
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS event_participants (
        id UUID PRIMARY KEY,
        occurrence_id UUID REFERENCES event_occurrences(id),
        student_id UUID,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS attendance_records (
        id UUID PRIMARY KEY,
        occurrence_id UUID REFERENCES event_occurrences(id),
        student_id UUID,
        status TEXT DEFAULT 'PRESENT',
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS attendance_audit (
        id UUID PRIMARY KEY,
        attendance_id UUID REFERENCES attendance_records(id),
        occurrence_id UUID,
        student_id UUID,
        action TEXT,
        old_status TEXT,
        new_status TEXT,
        reason TEXT,
        performed_by_user_id UUID,
        performed_at TIMESTAMPTZ DEFAULT now(),
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS obligation_rules (
        id UUID PRIMARY KEY,
        name TEXT,
        status TEXT DEFAULT 'ACTIVE',
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS student_obligations (
        id UUID PRIMARY KEY,
        student_id UUID,
        amount_centavos BIGINT,
        status TEXT DEFAULT 'UNPAID',
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY,
        student_id UUID,
        amount_centavos BIGINT,
        status TEXT DEFAULT 'COMPLETED',
        processed_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS payment_allocations (
        id UUID PRIMARY KEY,
        payment_id UUID REFERENCES payments(id),
        amount_centavos BIGINT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 3. Apply Task 3 migration SQL
    const migrationPath = join(
      process.cwd(),
      'supabase/migrations/20261102160000_lossless_pull_pagination_v2.sql'
    );
    const migrationSql = readFileSync(migrationPath, 'utf-8');
    await db.exec(migrationSql);

    // 4. Seed user accounts and roles
    await db.exec(`
      INSERT INTO users (id, student_id, email) VALUES
        ('${DEVADMIN_USER_ID}', NULL, 'devadmin@unitap.local'),
        ('${STUDENT_USER_ID}', '${STUDENT_RECORD_ID}', 'student@unitap.local'),
        ('${OFFICER_USER_ID}', NULL, 'officer@unitap.local');

      INSERT INTO user_roles (id, user_id, role) VALUES
        ('a0000000-0000-4000-8000-000000000010', '${DEVADMIN_USER_ID}', 'DEVADMIN'),
        ('a0000000-0000-4000-8000-000000000020', '${STUDENT_USER_ID}', 'STUDENT'),
        ('a0000000-0000-4000-8000-000000000030', '${OFFICER_USER_ID}', 'OFFICER');

      INSERT INTO students (id, user_id, student_id_number, first_name, last_name, updated_at) VALUES
        ('${STUDENT_RECORD_ID}', '${STUDENT_USER_ID}', '2026-0001', 'Juan', 'Dela Cruz', '2026-08-01 00:00:00+00');
    `);

    return db;
  }

  async function setAuthCaller(db: PGlite, userId: string | null) {
    await db.exec(`DELETE FROM auth.current_user_context;`);
    if (userId) {
      await db.exec(`INSERT INTO auth.current_user_context (user_id) VALUES ('${userId}');`);
    }
  }

  beforeEach(async () => {
    await resetDatabaseForTests();
  });

  // ============================================================================
  // PART A: PostgreSQL sync_pull_entity_v2 Tests via PGlite
  // ============================================================================

  it('Test 1 (PostgreSQL): Empty table returns 0 records, has_more=false, cursor preserved', async () => {
    pg = await setupPgDatabase();
    await setAuthCaller(pg, DEVADMIN_USER_ID);

    const res = await pg.query<{ sync_pull_entity_v2: any }>(
      `SELECT public.sync_pull_entity_v2('event_categories', '1970-01-01 00:00:00+00', NULL, 500);`
    );

    const result = res.rows[0].sync_pull_entity_v2;
    expect(result.entity).toBe('event_categories');
    expect(result.records).toHaveLength(0);
    expect(result.pagination.has_more).toBe(false);
    expect(result.pagination.count).toBe(0);
    expect(result.pagination.since).toBe('1970-01-01T00:00:00+00:00');
  });

  it('Test 2 (PostgreSQL): Exactly 500 records returns all 500 records with has_more=false', async () => {
    pg = await setupPgDatabase();
    await setAuthCaller(pg, DEVADMIN_USER_ID);

    // Insert exactly 500 event categories
    await pg.query(`
      INSERT INTO event_categories (id, name, updated_at)
      SELECT 
        ('e0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        'Category ' || i,
        ('2026-08-01 00:00:00+00'::timestamptz + (i || ' minutes')::interval)
      FROM generate_series(1, 500) AS i;
    `);

    const res = await pg.query<{ sync_pull_entity_v2: any }>(
      `SELECT public.sync_pull_entity_v2('event_categories', '1970-01-01 00:00:00+00', NULL, 500);`
    );

    const result = res.rows[0].sync_pull_entity_v2;
    expect(result.records).toHaveLength(500);
    expect(result.pagination.has_more).toBe(false);
    expect(result.pagination.count).toBe(500);
  });

  it('Test 3 (PostgreSQL): 501 records requires second page without skipped records', async () => {
    pg = await setupPgDatabase();
    await setAuthCaller(pg, DEVADMIN_USER_ID);

    // Insert 501 event categories
    await pg.query(`
      INSERT INTO event_categories (id, name, updated_at)
      SELECT 
        ('e0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        'Category ' || i,
        ('2026-08-01 00:00:00+00'::timestamptz + (i || ' minutes')::interval)
      FROM generate_series(1, 501) AS i;
    `);

    // Page 1
    const p1Res = await pg.query<{ sync_pull_entity_v2: any }>(
      `SELECT public.sync_pull_entity_v2('event_categories', '1970-01-01 00:00:00+00', NULL, 500);`
    );
    const p1 = p1Res.rows[0].sync_pull_entity_v2;
    expect(p1.records).toHaveLength(500);
    expect(p1.pagination.has_more).toBe(true);
    expect(p1.pagination.next_since).toBeDefined();
    expect(p1.pagination.next_last_id).toBeDefined();

    // Page 2
    const p2Res = await pg.query<{ sync_pull_entity_v2: any }>(
      `SELECT public.sync_pull_entity_v2('event_categories', $1::timestamptz, $2, 500);`,
      [p1.pagination.next_since, p1.pagination.next_last_id]
    );
    const p2 = p2Res.rows[0].sync_pull_entity_v2;
    expect(p2.records).toHaveLength(1);
    expect(p2.pagination.has_more).toBe(false);

    // Verify all 501 distinct records received
    const allIds = new Set([...p1.records.map((r: any) => r.id), ...p2.records.map((r: any) => r.id)]);
    expect(allIds.size).toBe(501);
  });

  it('Test 4 (PostgreSQL): Asymmetric entity counts (1,200 students vs 10 attendance records)', async () => {
    pg = await setupPgDatabase();
    await setAuthCaller(pg, DEVADMIN_USER_ID);

    // Insert 1,200 students
    await pg.query(`
      INSERT INTO students (id, student_id_number, first_name, last_name, updated_at)
      SELECT 
        ('b0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        'STU-' || i,
        'First' || i,
        'Last' || i,
        ('2026-08-01 00:00:00+00'::timestamptz + (i || ' minutes')::interval)
      FROM generate_series(1, 1200) AS i;
    `);

    // Insert 1 event, 1 occurrence, and 10 attendance records
    await pg.exec(`
      INSERT INTO events (id, title, updated_at) VALUES
        ('c0000000-0000-4000-8000-000000000001', 'General Assembly', '2026-08-01 00:00:00+00');
      INSERT INTO event_occurrences (id, event_id, updated_at) VALUES
        ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', '2026-08-01 00:00:00+00');

      INSERT INTO attendance_records (id, occurrence_id, student_id, updated_at)
      SELECT 
        ('f0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        'd0000000-0000-4000-8000-000000000001',
        ('b0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        ('2026-08-01 00:00:00+00'::timestamptz + (i || ' minutes')::interval)
      FROM generate_series(1, 10) AS i;
    `);

    // Pull attendance records: exactly 1 page of 10 records
    const attRes = await pg.query<{ sync_pull_entity_v2: any }>(
      `SELECT public.sync_pull_entity_v2('attendance_records', '1970-01-01 00:00:00+00', NULL, 500);`
    );
    const att = attRes.rows[0].sync_pull_entity_v2;
    expect(att.records).toHaveLength(10);
    expect(att.pagination.has_more).toBe(false);

    // Pull students independently: requires 3 pages (500 + 500 + 201 [including Juan Dela Cruz])
    let stuSince = '1970-01-01 00:00:00+00';
    let stuLastId: string | null = null;
    let totalStudentsPulled = 0;
    let pageCount = 0;
    let stuHasMore = true;

    while (stuHasMore) {
      pageCount++;
      const res = await pg.query<{ sync_pull_entity_v2: any }>(
        `SELECT public.sync_pull_entity_v2('students', $1::timestamptz, $2, 500);`,
        [stuSince, stuLastId]
      );
      const page = res.rows[0].sync_pull_entity_v2;
      totalStudentsPulled += page.records.length;
      stuHasMore = page.pagination.has_more;
      stuSince = page.pagination.next_since;
      stuLastId = page.pagination.next_last_id;
    }

    expect(pageCount).toBe(3);
    expect(totalStudentsPulled).toBe(1201); // 1200 generated + 1 seeded student
  });

  it('Test 5 (PostgreSQL): Tie-breaking on identical timestamps preserves complete determinism', async () => {
    pg = await setupPgDatabase();
    await setAuthCaller(pg, DEVADMIN_USER_ID);

    // 10 records all having the exact same updated_at
    const sameTimestamp = '2026-09-01 12:00:00+00';
    await pg.query(`
      INSERT INTO event_categories (id, name, updated_at)
      SELECT 
        ('e0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        'Category ' || i,
        '${sameTimestamp}'::timestamptz
      FROM generate_series(1, 10) AS i;
    `);

    // Paginate with limit 3: should yield pages of 3, 3, 3, 1 = 4 pages
    let since = '1970-01-01 00:00:00+00';
    let lastId: string | null = null;
    const collectedIds: string[] = [];
    let hasMore = true;

    while (hasMore) {
      const res = await pg.query<{ sync_pull_entity_v2: any }>(
        `SELECT public.sync_pull_entity_v2('event_categories', $1::timestamptz, $2, 3);`,
        [since, lastId]
      );
      const page = res.rows[0].sync_pull_entity_v2;
      for (const rec of page.records) {
        collectedIds.push(rec.id);
      }
      hasMore = page.pagination.has_more;
      since = page.pagination.next_since;
      lastId = page.pagination.next_last_id;
    }

    expect(collectedIds).toHaveLength(10);
    const uniqueIds = new Set(collectedIds);
    expect(uniqueIds.size).toBe(10);
  });

  it('Test 6 (PostgreSQL): Mixed UUID and TEXT PK cursor tie-breaking avoids SQLSTATE 42883', async () => {
    pg = await setupPgDatabase();
    await setAuthCaller(pg, DEVADMIN_USER_ID);

    await pg.query(`
      INSERT INTO academic_years (id, name, updated_at) VALUES
        ('ay_2025_2026', 'AY 2025-2026', '2026-01-01 00:00:00+00'),
        ('ay_2026_2027', 'AY 2026-2027', '2026-01-01 00:00:00+00');
    `);

    // Paginating TEXT ID entity with text cursor
    const resText = await pg.query<{ sync_pull_entity_v2: any }>(
      `SELECT public.sync_pull_entity_v2('academic_years', '2026-01-01 00:00:00+00', 'ay_2025_2026', 10);`
    );
    const ay = resText.rows[0].sync_pull_entity_v2;
    expect(ay.records).toHaveLength(1);
    expect(ay.records[0].id).toBe('ay_2026_2027');

    // Paginating UUID entity with UUID text cursor
    const resUuid = await pg.query<{ sync_pull_entity_v2: any }>(
      `SELECT public.sync_pull_entity_v2('students', '2026-08-01 00:00:00+00', '${STUDENT_RECORD_ID}', 10);`
    );
    expect(resUuid.rows[0].sync_pull_entity_v2.records).toBeDefined();
  });

  it('Test 7 (PostgreSQL): Fail-closed role scoping restricts STUDENT and unauthenticated callers', async () => {
    pg = await setupPgDatabase();

    // 1. Unauthenticated caller throws
    await setAuthCaller(pg, null);
    await expect(
      pg.query(`SELECT public.sync_pull_entity_v2('students', '1970-01-01 00:00:00+00', NULL, 500);`)
    ).rejects.toThrow('Authentication required');

    // 2. Student caller only sees their own student record
    await setAuthCaller(pg, STUDENT_USER_ID);
    await pg.query(`
      INSERT INTO students (id, student_id_number, first_name, last_name, updated_at) VALUES
        ('b0000000-0000-4000-8000-000000000099', 'STU-SECRET', 'Secret', 'Student', '2026-08-01 00:00:00+00');
    `);

    const stuRes = await pg.query<{ sync_pull_entity_v2: any }>(
      `SELECT public.sync_pull_entity_v2('students', '1970-01-01 00:00:00+00', NULL, 500);`
    );
    const stu = stuRes.rows[0].sync_pull_entity_v2;
    expect(stu.records).toHaveLength(1);
    expect(stu.records[0].id).toBe(STUDENT_RECORD_ID);

    // Student denied access to audit logs
    const auditRes = await pg.query<{ sync_pull_entity_v2: any }>(
      `SELECT public.sync_pull_entity_v2('attendance_audit', '1970-01-01 00:00:00+00', NULL, 500);`
    );
    expect(auditRes.rows[0].sync_pull_entity_v2.records).toHaveLength(0);
  });

  it('Test 8 (PostgreSQL): Unsupported entity request returns structured INVALID_ENTITY error', async () => {
    pg = await setupPgDatabase();
    await setAuthCaller(pg, DEVADMIN_USER_ID);

    const res = await pg.query<{ sync_pull_entity_v2: any }>(
      `SELECT public.sync_pull_entity_v2('unauthorized_table', '1970-01-01 00:00:00+00', NULL, 500);`
    );
    const result = res.rows[0].sync_pull_entity_v2;
    expect(result.error).toBe('INVALID_ENTITY');
  });

  // ============================================================================
  // PART B: SQLite Checkpoints & Pull Engine Tests via WebDevSqliteAdapter
  // ============================================================================

  it('Test 9 (SQLite): Migration 008 initializes durable entity_sync_checkpoints at epoch', async () => {
    const db = await getDatabase();

    const checkpoints = await EntityCheckpointService.getAllCheckpoints(db);
    expect(checkpoints).toHaveLength(18);

    const studentsCheckpoint = await EntityCheckpointService.getCheckpoint(db, 'students');
    expect(studentsCheckpoint.entity_name).toBe('students');
    expect(studentsCheckpoint.last_pulled_at).toBe('1970-01-01T00:00:00.000Z');
    expect(studentsCheckpoint.last_pulled_id).toBeNull();
    expect(studentsCheckpoint.records_pulled).toBe(0);
    expect(studentsCheckpoint.last_sync_status).toBe('IDLE');
  });

  it('Test 10 (SQLite): Atomic transaction commits page data and checkpoint together', async () => {
    const db = await getDatabase();

    // Mock RPC returning 2 pages
    const page1Records = [
      {
        id: 'b0000000-0000-4000-8000-000000000001',
        student_id_number: '2026-0001',
        first_name: 'Alice',
        last_name: 'Smith',
        updated_at: '2026-08-01T10:00:00.000Z',
      },
    ];

    let rpcCallCount = 0;
    (supabase.rpc as any) = async (rpcName: string, params: any) => {
      if (rpcName === 'sync_pull_entity_v2') {
        rpcCallCount++;
        return {
          data: {
            entity: 'students',
            records: page1Records,
            pagination: {
              since: params.p_since,
              limit: params.p_limit,
              count: 1,
              has_more: false,
              next_since: '2026-08-01T10:00:00.000Z',
              next_last_id: 'b0000000-0000-4000-8000-000000000001',
            },
          },
          error: null,
        };
      }
      return { data: null, error: { message: 'unknown RPC' } };
    };

    const res = await PullSyncService.syncEntity(db, 'students');
    expect(res.status).toBe('SUCCESS');
    expect(res.recordsPulled).toBe(1);
    expect(res.pagesFetched).toBe(1);

    // Verify record exists in SQLite
    const row = await db.queryOne<{ first_name: string }>(
      `SELECT first_name FROM students WHERE id = 'b0000000-0000-4000-8000-000000000001'`
    );
    expect(row?.first_name).toBe('Alice');

    // Verify checkpoint advanced atomically
    const cp = await EntityCheckpointService.getCheckpoint(db, 'students');
    expect(cp.last_pulled_at).toBe('2026-08-01T10:00:00.000Z');
    expect(cp.last_pulled_id).toBe('b0000000-0000-4000-8000-000000000001');
    expect(cp.records_pulled).toBe(1);
    expect(cp.last_sync_status).toBe('SUCCESS');
  });

  it('Test 11 (SQLite): Ingestion failure rolls back page records and checkpoint atomically', async () => {
    const db = await getDatabase();

    // Setup initial valid checkpoint at Page 1
    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, created_at, updated_at)
       VALUES ('b0000000-0000-4000-8000-000000000001', '2026-0001', 'Alice', 'Smith', '2026-08-01T10:00:00.000Z', '2026-08-01T10:00:00.000Z')`
    );
    await EntityCheckpointService.updateCheckpointInTransaction(db, {
      entity_name: 'students',
      last_pulled_at: '2026-08-01T10:00:00.000Z',
      last_pulled_id: 'b0000000-0000-4000-8000-000000000001',
      records_pulled: 1,
      last_sync_status: 'SUCCESS',
    });

    // Page 2 delivers an invalid record (e.g. malformed data that throws)
    (supabase.rpc as any) = async (rpcName: string) => {
      if (rpcName === 'sync_pull_entity_v2') {
        return {
          data: {
            entity: 'students',
            // Corrupt record with invalid type or missing required schema
            records: [
              {
                id: 'b0000000-0000-4000-8000-000000000002',
                student_id_number: '2026-0002',
                first_name: 'Bob',
                last_name: 'Jones',
                updated_at: '2026-08-01T11:00:00.000Z',
              },
            ],
            pagination: {
              since: '2026-08-01T10:00:00.000Z',
              limit: 500,
              count: 1,
              has_more: false,
              next_since: '2026-08-01T11:00:00.000Z',
              next_last_id: 'b0000000-0000-4000-8000-000000000002',
            },
          },
          error: null,
        };
      }
      return { data: null, error: { message: 'unknown' } };
    };

    // Simulate database error during page 2 execution
    const originalUpsert = SchemaMapperService.upsertBatchSafe;
    const originalSafeUpsert = SchemaMapperService.safeUpsertRecord;
    SchemaMapperService.upsertBatchSafe = async () => {
      throw new Error('Simulated SQLite disk write failure on page 2');
    };
    SchemaMapperService.safeUpsertRecord = async () => {
      throw new Error('Simulated SQLite disk write failure on page 2');
    };

    try {
      await expect(PullSyncService.syncEntity(db, 'students')).rejects.toThrow(
        'Simulated SQLite disk write failure on page 2'
      );
    } finally {
      // Restore mappers
      SchemaMapperService.upsertBatchSafe = originalUpsert;
      SchemaMapperService.safeUpsertRecord = originalSafeUpsert;
    }

    // Verify Bob was rolled back (does NOT exist in SQLite)
    const bob = await db.queryOne<{ first_name: string }>(
      `SELECT first_name FROM students WHERE id = 'b0000000-0000-4000-8000-000000000002'`
    );
    expect(bob).toBeNull();

    // Verify checkpoint rolled back to Page 1 and marked FAILED
    const cp = await EntityCheckpointService.getCheckpoint(db, 'students');
    expect(cp.last_pulled_at).toBe('2026-08-01T10:00:00.000Z');
    expect(cp.last_pulled_id).toBe('b0000000-0000-4000-8000-000000000001');
    expect(cp.last_sync_status).toBe('FAILED');
    expect(cp.last_error_message).toContain('Simulated SQLite disk write failure on page 2');
  });

  it('Test 12 (SQLite): Outbox protection during multi-page pagination preserves local changes', async () => {
    const db = await getDatabase();

    // Local student with pending uncommitted outbox mutation
    const conflictStudentId = 'b0000000-0000-4000-8000-000000000099';
    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, created_at, updated_at)
       VALUES ('${conflictStudentId}', '2026-0099', 'LocalFirstName', 'LocalLastName', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`
    );

    await db.execute(
      `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_default', 'Default Device', 'DEV-DEF-01', 'ACTIVE', '2026-08-01T00:00:00.000Z')`
    );

    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, synced_at)
       VALUES ('outbox_conflict_1', 'dev_default', 'STUDENT', '${conflictStudentId}', 'UPDATE', '{"first_name":"LocalFirstName"}', 1, '2026-08-01T01:00:00.000Z', NULL)`
    );

    // Remote server returns update for this student and another student
    (supabase.rpc as any) = async () => ({
      data: {
        entity: 'students',
        records: [
          {
            id: conflictStudentId,
            student_id_number: '2026-0099',
            first_name: 'RemoteOverwritingName',
            last_name: 'RemoteOverwritingLast',
            updated_at: '2026-08-01T12:00:00.000Z',
          },
          {
            id: 'b0000000-0000-4000-8000-000000000100',
            student_id_number: '2026-0100',
            first_name: 'NonConflictingStudent',
            last_name: 'Normal',
            updated_at: '2026-08-01T12:00:00.000Z',
          },
        ],
        pagination: {
          since: '1970-01-01T00:00:00.000Z',
          limit: 500,
          count: 2,
          has_more: false,
          next_since: '2026-08-01T12:00:00.000Z',
          next_last_id: 'b0000000-0000-4000-8000-000000000100',
        },
      },
      error: null,
    });

    const res = await PullSyncService.syncEntity(db, 'students');
    expect(res.status).toBe('PARTIAL_PENDING_OUTBOX');
    expect(res.recordsPulled).toBe(1); // Only non-conflicting student applied

    // Verify local student was NOT overwritten
    const local = await db.queryOne<{ first_name: string }>(
      `SELECT first_name FROM students WHERE id = '${conflictStudentId}'`
    );
    expect(local?.first_name).toBe('LocalFirstName');

    // Verify non-conflicting student was ingested
    const normal = await db.queryOne<{ first_name: string }>(
      `SELECT first_name FROM students WHERE id = 'b0000000-0000-4000-8000-000000000100'`
    );
    expect(normal?.first_name).toBe('NonConflictingStudent');

    // Verify checkpoint status indicates pending outbox and preserved safe checkpoint
    const cp = await EntityCheckpointService.getCheckpoint(db, 'students');
    expect(cp.last_sync_status).toBe('PENDING_OUTBOX');
    expect(cp.last_pulled_at).toBe('1970-01-01T00:00:00.000Z');
  });

  it('Test 13 (SQLite): Resume from previous checkpoint without duplication', async () => {
    const db = await getDatabase();

    // Ensure parent program exists for section foreign key
    await db.execute(
      `INSERT OR IGNORE INTO programs (id, code, name, is_active, status)
       VALUES ('prog_bsit', 'BSIT', 'Bachelor of Science in Information Technology', 1, 'ACTIVE')`
    );

    // Advance checkpoint as if Page 1 was previously completed
    await EntityCheckpointService.updateCheckpointInTransaction(db, {
      entity_name: 'sections',
      last_pulled_at: '2026-08-01T10:00:00.000Z',
      last_pulled_id: 's0000000-0000-4000-8000-000000000001',
      records_pulled: 500,
      last_sync_status: 'IN_PROGRESS',
    });

    let requestedSince = '';
    let requestedLastId = '';

    (supabase.rpc as any) = async (_name: string, params: any) => {
      requestedSince = params.p_since;
      requestedLastId = params.p_last_id;
      return {
        data: {
          entity: 'sections',
          records: [
            {
              id: 's0000000-0000-4000-8000-000000000002',
              program_id: 'prog_bsit',
              year_level_id: 'e1000000-0000-4000-8000-000000000001',
              name: 'BSIT-1A',
              updated_at: '2026-08-01T11:00:00.000Z',
            },
          ],
          pagination: {
            since: params.p_since,
            limit: 500,
            count: 1,
            has_more: false,
            next_since: '2026-08-01T11:00:00.000Z',
            next_last_id: 's0000000-0000-4000-8000-000000000002',
          },
        },
        error: null,
      };
    };

    const res = await PullSyncService.syncEntity(db, 'sections');
    expect(res.status).toBe('SUCCESS');
    expect(requestedSince).toBe('2026-08-01T10:00:00.000Z');
    expect(requestedLastId).toBe('s0000000-0000-4000-8000-000000000001');

    const cp = await EntityCheckpointService.getCheckpoint(db, 'sections');
    expect(cp.records_pulled).toBe(501);
    expect(cp.last_sync_status).toBe('SUCCESS');
  });

  it('Test 14 (SQLite): InitialSyncService.refreshLocalData uses lossless pagination without data loss', async () => {
    const db = await getDatabase();

    // Mock RPC returning 0 records for all entities
    (supabase.rpc as any) = async (name: string, params: any) => {
      if (name === 'sync_pull_entity_v2') {
        return {
          data: {
            entity: params.p_entity,
            records: [],
            pagination: {
              since: params.p_since,
              limit: 500,
              count: 0,
              has_more: false,
              next_since: params.p_since,
              next_last_id: params.p_last_id,
            },
          },
          error: null,
        };
      }
      return { data: null, error: { message: 'unknown' } };
    };

    const success = await InitialSyncService.refreshLocalData('DEVADMIN', DEVADMIN_USER_ID);
    expect(success).toBe(true);

    const cp = await EntityCheckpointService.getCheckpoint(db, 'academic_years');
    expect(cp.last_sync_status).toBe('SUCCESS');
  });
});
