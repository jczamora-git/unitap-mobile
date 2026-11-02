import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { WebDevSqliteAdapter } from '@/database/adapters/web-dev.adapter';
import { MigrationRunner, MIGRATIONS } from '@/database/migration-runner';
import { SchemaMapperService } from '@/services/sync/schema-mapper.service';
import { InitialSyncService } from '@/services/sync/initial-sync.service';
import { PullSyncService } from '@/services/sync/pull-sync.service';
import { SyncStatusService } from '@/services/sync/sync-status.service';
import type { DatabaseAdapter } from '@/database/adapters/database-adapter.interface';

/**
 * UniTap 2.0 SQLite Schema Compatibility & Safe Data Ingestion Tests (Task 2)
 *
 * NOTE ON TEST HARNESS EXECUTION:
 * These automated unit tests execute SQLite 3 operations using the WebAssembly `sql.js`
 * engine (`WebDevSqliteAdapter`) in Node/Vitest. This exercises the exact relational SQL
 * schema, table constraints, migration runner idempotence, transactional safe upsert logic,
 * outbox conflict checks, and field normalization.
 *
 * In physical Android production environments, UniTap runs `@capacitor-community/sqlite`
 * via `NativeSqliteAdapter` against native Android SQLite.
 */
describe('UniTap 2.0 SQLite Schema Compatibility & Safe Data Ingestion (Task 2)', () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
  });

  // TEST 1: Fresh install test
  it('Test 1: Fresh install initializes all migrations 001-007 and all 18 tables with expected columns', async () => {
    const db = await getDatabase();

    // Verify all migrations up to 7 are registered
    const applied = await db.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version ASC');
    const versions = applied.map((m) => m.version);
    expect(versions).toContain(1);
    expect(versions).toContain(2);
    expect(versions).toContain(3);
    expect(versions).toContain(4);
    expect(versions).toContain(5);
    expect(versions).toContain(6);
    expect(versions).toContain(7);

    // Verify all 18 sync tables exist
    const expectedTables = [
      'academic_years',
      'semesters',
      'programs',
      'year_levels',
      'sections',
      'event_categories',
      'obligation_rules',
      'events',
      'event_occurrences',
      'event_participants',
      'students',
      'student_enrollments',
      'nfc_cards',
      'attendance_records',
      'attendance_audit',
      'student_obligations',
      'payments',
      'payment_allocations',
    ];

    for (const table of expectedTables) {
      const info = await db.query<{ name: string }>(`PRAGMA table_info(${table})`);
      expect(info.length).toBeGreaterThan(0);
      const cols = new Set(info.map((c) => c.name));

      // Specific column parity checks for Migration 007
      if (table === 'academic_years') {
        expect(cols.has('created_at')).toBe(true);
        expect(cols.has('updated_at')).toBe(true);
      }
      if (table === 'semesters') {
        expect(cols.has('created_at')).toBe(true);
        expect(cols.has('updated_at')).toBe(true);
      }
      if (table === 'programs') {
        expect(cols.has('status')).toBe(true);
        expect(cols.has('is_active')).toBe(true);
      }
      if (table === 'event_occurrences') {
        expect(cols.has('label')).toBe(true);
        expect(cols.has('title')).toBe(true);
      }
      if (table === 'event_participants') {
        expect(cols.has('added_at')).toBe(true);
        expect(cols.has('updated_at')).toBe(true);
      }
      if (table === 'students') {
        expect(cols.has('photo_storage_path')).toBe(true);
        expect(cols.has('photo_local_uri')).toBe(true);
      }
      if (table === 'student_enrollments') {
        expect(cols.has('academic_year_id')).toBe(true);
      }
      if (table === 'nfc_cards') {
        expect(cols.has('deactivated_at')).toBe(true);
        expect(cols.has('note')).toBe(true);
        expect(cols.has('updated_at')).toBe(true);
      }
      if (table === 'attendance_records') {
        expect(cols.has('notes')).toBe(true);
        expect(cols.has('version')).toBe(true);
        expect(cols.has('client_scanned_at')).toBe(true);
      }
      if (table === 'obligation_rules') {
        expect(cols.has('updated_at')).toBe(true);
      }
      if (table === 'payments') {
        expect(cols.has('updated_at')).toBe(true);
      }
      if (table === 'payment_allocations') {
        expect(cols.has('created_at')).toBe(true);
      }
    }
  });

  // TEST 2: Upgrade test from migration 006 to 007
  it('Test 2: Upgrade test from migration 006 to 007 preserves existing records intact', async () => {
    const adapter = new WebDevSqliteAdapter();
    await adapter.initialize();

    // Apply only migrations 1 through 6
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);

    for (const migration of MIGRATIONS.filter((m) => m.version <= 6)) {
      if (migration.version === 1) {
        await adapter.execute(migration.sql);
      } else {
        const cleanSql = migration.sql.replace(/--.*$/gm, '');
        const statements = cleanSql.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
        for (const stmt of statements) {
          try {
            await adapter.execute(stmt);
          } catch (err: unknown) {
            const error = err as Error;
            if (!error.message.includes('already exists') && !error.message.includes('duplicate column name')) {
              throw error;
            }
          }
        }
      }
      await adapter.execute(
        `INSERT OR IGNORE INTO schema_migrations (version, description) VALUES (?, ?)`,
        [migration.version, migration.description]
      );
    }

    // Seed data into pre-007 tables
    await adapter.execute(`
      INSERT INTO academic_years (id, label, starts_on, ends_on, status)
      VALUES ('ay_legacy', '2025-2026', '2025-08-01', '2026-05-31', 'ACTIVE');

      INSERT INTO students (id, school_id, first_name, last_name, photo_local_uri, status, created_at, updated_at)
      VALUES ('stu_legacy', '2025-0001', 'Juan', 'Cruz', 'file:///data/local/avatar.jpg', 'ACTIVE', '2025-08-01T00:00:00Z', '2025-08-01T00:00:00Z');
    `);

    // Verify academic_years does NOT have created_at yet
    const colsBefore = await adapter.query<{ name: string }>('PRAGMA table_info(academic_years)');
    expect(colsBefore.some((c) => c.name === 'created_at')).toBe(false);

    // Run MigrationRunner to upgrade to v7
    await MigrationRunner.runMigrations(adapter);

    // Verify v7 is applied
    const applied = await adapter.query<{ version: number }>('SELECT version FROM schema_migrations WHERE version = 7');
    expect(applied.length).toBe(1);

    // Verify pre-existing data was untouched
    const ay = await adapter.queryOne<{ id: string; label: string }>('SELECT * FROM academic_years WHERE id = ?', ['ay_legacy']);
    expect(ay?.label).toBe('2025-2026');

    const stu = await adapter.queryOne<{ id: string; photo_local_uri: string }>('SELECT * FROM students WHERE id = ?', ['stu_legacy']);
    expect(stu?.photo_local_uri).toBe('file:///data/local/avatar.jpg');

    await adapter.close();
  });

  // TEST 3: Ingest server academic_years with created_at and updated_at
  it('Test 3: Ingest server academic_years with created_at and updated_at without error', async () => {
    const db = await getDatabase();
    const serverPayload = [
      {
        id: 'ay_server_test',
        label: '2027-2028',
        starts_on: '2027-08-01',
        ends_on: '2028-05-31',
        status: 'PLANNED',
        created_at: '2026-11-02T10:00:00.000Z',
        updated_at: '2026-11-02T10:30:00.000Z',
      },
    ];

    await db.transaction(async (tx) => {
      const res = await SchemaMapperService.upsertBatchSafe(tx, 'academic_years', serverPayload);
      expect(res.applied).toBe(1);
    });

    const stored = await db.queryOne<{ id: string; label: string; created_at: string; updated_at: string }>(
      'SELECT * FROM academic_years WHERE id = ?',
      ['ay_server_test']
    );
    expect(stored?.label).toBe('2027-2028');
    expect(stored?.created_at).toBe('2026-11-02T10:00:00.000Z');
    expect(stored?.updated_at).toBe('2026-11-02T10:30:00.000Z');
  });

  // TEST 4: Ingest server semesters & programs with mapped status and booleans
  it('Test 4: Ingest server semesters & programs with mapped status and booleans', async () => {
    const db = await getDatabase();

    await db.transaction(async (tx) => {
      // Ingest AY first
      await SchemaMapperService.upsertBatchSafe(tx, 'academic_years', [
        {
          id: 'ay_sem_test',
          label: '2026-2027',
          starts_on: '2026-08-01',
          ends_on: '2027-05-31',
          status: 'ACTIVE',
        },
      ]);

      // Ingest semesters
      await SchemaMapperService.upsertBatchSafe(tx, 'semesters', [
        {
          id: 'sem_server_test',
          academic_year_id: 'ay_sem_test',
          term: 'FIRST',
          starts_on: '2026-08-01',
          ends_on: '2026-12-20',
          status: 'ACTIVE',
          created_at: '2026-08-01T00:00:00Z',
        },
      ]);

      // Ingest programs with server string status
      await SchemaMapperService.upsertBatchSafe(tx, 'programs', [
        {
          id: 'prog_bsit',
          code: 'BSIT',
          name: 'Bachelor of Science in Information Technology',
          status: 'ACTIVE',
        },
        {
          id: 'prog_bscs',
          code: 'BSCS',
          name: 'Bachelor of Science in Computer Science',
          status: 'INACTIVE',
        },
      ]);
    });

    const bsit = await db.queryOne<{ is_active: number; status: string }>('SELECT * FROM programs WHERE id = ?', ['prog_bsit']);
    expect(bsit?.is_active).toBe(1);
    expect(bsit?.status).toBe('ACTIVE');

    const bscs = await db.queryOne<{ is_active: number; status: string }>('SELECT * FROM programs WHERE id = ?', ['prog_bscs']);
    expect(bscs?.is_active).toBe(0);
    expect(bscs?.status).toBe('INACTIVE');
  });

  // TEST 5: Ingest server attendance_records with client_scanned_at, version, and notes
  it('Test 5: Ingest server attendance_records with client_scanned_at, version, and notes', async () => {
    const db = await getDatabase();

    // Create prerequisites
    await db.execute(`
      INSERT INTO academic_years (id, label, starts_on, ends_on, status) VALUES ('ay_att', '2026-2027', '2026-08-01', '2027-05-31', 'ACTIVE');
      INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status) VALUES ('sem_att', 'ay_att', 'FIRST', '2026-08-01', '2026-12-20', 'ACTIVE');
      INSERT INTO event_categories (id, code, name, created_at, updated_at) VALUES ('cat_att', 'GEN', 'General Event', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      INSERT INTO events (id, category_id, semester_id, title, status, created_at, updated_at) VALUES ('ev_att', 'cat_att', 'sem_att', 'Orientation', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      INSERT INTO event_occurrences (id, event_id, title, occurs_on, starts_at, ends_at, status, updated_at) VALUES ('occ_att', 'ev_att', 'Morning Session', '2026-08-10', '2026-08-10T08:00:00Z', '2026-08-10T12:00:00Z', 'CLOSED', '2026-08-01T00:00:00Z');
      INSERT INTO users (id, username, account_status, created_at, updated_at) VALUES ('usr_att', 'scanner_officer', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at) VALUES ('stu_att', '2026-1001', 'Maria', 'Santos', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    `);

    const serverAttendance = [
      {
        id: 'att_rec_1',
        occurrence_id: 'occ_att',
        student_id: 'stu_att',
        nfc_card_id: null,
        scan_method: 'NFC',
        status: 'PRESENT',
        scanned_by_user_id: 'usr_att',
        scanned_at: '2026-08-10T08:15:00.000Z',
        client_scanned_at: '2026-08-10T08:14:59.000Z',
        version: 3,
        notes: 'Verified by Gate 1 Scanner',
      },
    ];

    await db.transaction(async (tx) => {
      const res = await SchemaMapperService.upsertBatchSafe(tx, 'attendance_records', serverAttendance);
      expect(res.applied).toBe(1);
    });

    const stored = await db.queryOne<{ version: number; client_scanned_at: string; notes: string }>(
      'SELECT * FROM attendance_records WHERE id = ?',
      ['att_rec_1']
    );
    expect(stored?.version).toBe(3);
    expect(stored?.client_scanned_at).toBe('2026-08-10T08:14:59.000Z');
    expect(stored?.notes).toBe('Verified by Gate 1 Scanner');
  });

  // TEST 6: Ingest server payments & allocations with integer centavos
  it('Test 6: Ingest server payments & allocations with integer centavos precision', async () => {
    const db = await getDatabase();

    await db.execute(`
      INSERT INTO academic_years (id, label, starts_on, ends_on, status) VALUES ('ay_fin', '2026-2027', '2026-08-01', '2027-05-31', 'ACTIVE');
      INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status) VALUES ('sem_fin', 'ay_fin', 'FIRST', '2026-08-01', '2026-12-20', 'ACTIVE');
      INSERT INTO users (id, username, account_status, created_at, updated_at) VALUES ('usr_cashier', 'cashier1', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at) VALUES ('stu_fin', '2026-2001', 'Pedro', 'Penduko', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      INSERT INTO student_obligations (id, student_id, semester_id, title, type, amount_centavos, status, issued_by_user_id, issued_at, updated_at)
      VALUES ('ob_fin_1', 'stu_fin', 'sem_fin', 'Membership Fee', 'CONTRIBUTION', 15000, 'ACTIVE', 'usr_cashier', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    `);

    // Ingest payment with 15000 centavos (₱150.00)
    await db.transaction(async (tx) => {
      await SchemaMapperService.upsertBatchSafe(tx, 'payments', [
        {
          id: 'pay_fin_1',
          student_id: 'stu_fin',
          semester_id: 'sem_fin',
          reference_number: 'PAY-REF-001',
          idempotency_key: 'PAY-IK-001',
          amount_centavos: 15000,
          status: 'POSTED',
          processed_by_user_id: 'usr_cashier',
          processed_at: '2026-08-02T10:00:00Z',
          updated_at: '2026-08-02T10:00:00Z',
        },
      ]);

      await SchemaMapperService.upsertBatchSafe(tx, 'payment_allocations', [
        {
          id: 'alloc_fin_1',
          payment_id: 'pay_fin_1',
          obligation_id: 'ob_fin_1',
          amount_centavos: 15000,
          created_at: '2026-08-02T10:00:00Z',
        },
      ]);
    });

    const payment = await db.queryOne<{ amount_centavos: number }>(
      'SELECT amount_centavos FROM payments WHERE id = ?',
      ['pay_fin_1']
    );
    expect(payment?.amount_centavos).toBe(15000);
    expect(Number.isInteger(payment?.amount_centavos)).toBe(true);

    const alloc = await db.queryOne<{ amount_centavos: number }>(
      'SELECT amount_centavos FROM payment_allocations WHERE id = ?',
      ['alloc_fin_1']
    );
    expect(alloc?.amount_centavos).toBe(15000);
  });

  // TEST 7: Pull while pending local outbox operations exist
  it('Test 7: Pull while pending local outbox operations exist preserves local working state', async () => {
    const db = await getDatabase();

    await db.execute(`
      INSERT INTO academic_years (id, label, starts_on, ends_on, status) VALUES ('ay_outbox', '2026-2027', '2026-08-01', '2027-05-31', 'ACTIVE');
      INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status) VALUES ('sem_outbox', 'ay_outbox', 'FIRST', '2026-08-01', '2026-12-20', 'ACTIVE');
      INSERT INTO event_categories (id, code, name, created_at, updated_at) VALUES ('cat_outbox', 'GEN', 'General', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      INSERT INTO events (id, category_id, semester_id, title, status, created_at, updated_at) VALUES ('ev_outbox', 'cat_outbox', 'sem_outbox', 'General Assembly', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      INSERT INTO event_occurrences (id, event_id, title, occurs_on, starts_at, ends_at, status, updated_at) VALUES ('occ_outbox', 'ev_outbox', 'Session 1', '2026-08-10', '2026-08-10T08:00:00Z', '2026-08-10T12:00:00Z', 'CLOSED', '2026-08-01T00:00:00Z');
      INSERT INTO users (id, username, account_status, created_at, updated_at) VALUES ('usr_local', 'local_officer', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at) VALUES ('stu_outbox', '2026-3001', 'Juan', 'Luna', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');

      -- Local record with status PRESENT
      INSERT INTO attendance_records (id, occurrence_id, student_id, method, status, identity_verified_by_user_id, checked_in_at, version, updated_at)
      VALUES ('att_pending_1', 'occ_outbox', 'stu_outbox', 'NFC', 'PRESENT', 'usr_local', '2026-08-10T08:30:00Z', 1, '2026-08-10T08:30:00Z');

      -- Pending uncommitted outbox mutation
      INSERT INTO devices (id, device_name, device_code, status, provisioned_at) VALUES ('dev_default', 'Terminal', 'DEV-01', 'ACTIVE', '2026-08-01T00:00:00Z');
      INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at, synced_at)
      VALUES ('box_1', 'dev_default', 'ATTENDANCE', 'att_pending_1', 'CREATE', '{"status":"PRESENT"}', '2026-08-10T08:30:00Z', NULL);

      INSERT INTO sync_state (device_id, last_pull_at, last_success_at)
      VALUES ('dev_default', '2026-08-09T00:00:00Z', '2026-08-09T00:00:00Z');
    `);

    // Ingest server payload trying to overwrite local record with status REVOKED
    const serverPayload = [
      {
        id: 'att_pending_1',
        occurrence_id: 'occ_outbox',
        student_id: 'stu_outbox',
        scan_method: 'NFC',
        status: 'REVOKED',
        scanned_by_user_id: 'usr_local',
        scanned_at: '2026-08-10T09:00:00Z',
        version: 2,
      },
    ];

    let result: { applied: number; skippedPending: number } = { applied: 0, skippedPending: 0 };
    await db.transaction(async (tx) => {
      result = await SchemaMapperService.upsertBatchSafe(tx, 'attendance_records', serverPayload);
    });

    // Verify record was skipped from overwrite
    expect(result.skippedPending).toBe(1);
    expect(result.applied).toBe(0);

    const currentLocal = await db.queryOne<{ status: string; version: number }>(
      'SELECT status, version FROM attendance_records WHERE id = ?',
      ['att_pending_1']
    );
    expect(currentLocal?.status).toBe('PRESENT');
    expect(currentLocal?.version).toBe(1);

    // Verify outbox entry is intact and not deleted
    const outbox = await db.queryOne<{ synced_at: string | null }>(
      'SELECT synced_at FROM sync_outbox WHERE id = ?',
      ['box_1']
    );
    expect(outbox?.synced_at).toBeNull();
  });

  // TEST 8: Failed refresh leaves SQLite in consistent state without premature cursor advancement
  it('Test 8: Failed refresh leaves SQLite consistent and does not advance cursor', async () => {
    const db = await getDatabase();

    await db.execute(`
      INSERT INTO devices (id, device_name, device_code, status, provisioned_at) VALUES ('dev_default', 'Terminal', 'DEV-01', 'ACTIVE', '2026-08-01T00:00:00Z');
      INSERT INTO sync_state (device_id, last_pull_at, last_success_at) VALUES ('dev_default', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    `);

    // Call refreshLocalData which fails because remote tables are unreachable/mocked
    const success = await InitialSyncService.refreshLocalData('STUDENT', 'usr_test', 'stu_test');
    expect(success).toBe(false);
    expect(SyncStatusService.state.value).toBe('SYNC_ERROR');

    // Verify last_pull_at was NOT advanced
    const state = await db.queryOne<{ last_pull_at: string }>('SELECT last_pull_at FROM sync_state WHERE device_id = ?', ['dev_default']);
    expect(state?.last_pull_at).toBe('2026-08-01T00:00:00Z');
  });

  // TEST 9: Repeated import idempotence
  it('Test 9: Repeated import of identical server data produces identical state without duplicates', async () => {
    const db = await getDatabase();
    const batch = [
      { id: 'ay_idem', label: '2028-2029', starts_on: '2028-08-01', ends_on: '2029-05-31', status: 'PLANNED' },
    ];

    // Ingest 1st time
    await db.transaction(async (tx) => {
      await SchemaMapperService.upsertBatchSafe(tx, 'academic_years', batch);
    });

    const count1 = await db.queryOne<{ count: number }>('SELECT count(*) as count FROM academic_years WHERE id = ?', ['ay_idem']);
    expect(count1?.count).toBe(1);

    // Ingest 2nd time
    await db.transaction(async (tx) => {
      await SchemaMapperService.upsertBatchSafe(tx, 'academic_years', batch);
    });

    const count2 = await db.queryOne<{ count: number }>('SELECT count(*) as count FROM academic_years WHERE id = ?', ['ay_idem']);
    expect(count2?.count).toBe(1);
  });

  // TEST 10: Foreign key cascade safety & local preservation
  it('Test 10: Sync update does not trigger cascade deletes or wipe local-only columns', async () => {
    const db = await getDatabase();

    await db.execute(`
      INSERT INTO academic_years (id, label, starts_on, ends_on, status) VALUES ('ay_casc', '2026-2027', '2026-08-01', '2027-05-31', 'ACTIVE');
      INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status) VALUES ('sem_casc', 'ay_casc', 'FIRST', '2026-08-01', '2026-12-20', 'ACTIVE');
      INSERT INTO students (id, school_id, first_name, last_name, photo_local_uri, status, created_at, updated_at)
      VALUES ('stu_casc', '2026-4001', 'Emilio', 'Aguinaldo', 'file:///data/local/avatar.jpg', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');

      INSERT INTO student_enrollments (id, student_id, semester_id, year_level, section, first_name_snapshot, last_name_snapshot, updated_at)
      VALUES ('enr_casc', 'stu_casc', 'sem_casc', 1, '1-A', 'Emilio', 'Aguinaldo', '2026-08-01T00:00:00Z');
    `);

    // Ingest updated student from server with new remote storage path (no photo_local_uri)
    const serverStudent = [
      {
        id: 'stu_casc',
        school_id: '2026-4001',
        first_name: 'Emilio',
        last_name: 'Aguinaldo Updated',
        photo_storage_path: 'remote/photos/aguinaldo.jpg',
        status: 'ACTIVE',
        updated_at: '2026-08-05T00:00:00Z',
      },
    ];

    await db.transaction(async (tx) => {
      await SchemaMapperService.upsertBatchSafe(tx, 'students', serverStudent);
    });

    // Verify local photo_local_uri was PRESERVED
    const stu = await db.queryOne<{ last_name: string; photo_local_uri: string; photo_storage_path: string }>(
      'SELECT last_name, photo_local_uri, photo_storage_path FROM students WHERE id = ?',
      ['stu_casc']
    );
    expect(stu?.last_name).toBe('Aguinaldo Updated');
    expect(stu?.photo_local_uri).toBe('file:///data/local/avatar.jpg');
    expect(stu?.photo_storage_path).toBe('remote/photos/aguinaldo.jpg');

    // Verify dependent enrollment was NOT deleted by cascade
    const enr = await db.queryOne<{ id: string }>('SELECT id FROM student_enrollments WHERE id = ?', ['enr_casc']);
    expect(enr?.id).toBe('enr_casc');
  });

  // TEST 11: Unknown server columns dropped safely
  it('Test 11: Server response with unexpected extra columns does not cause SQLite errors', async () => {
    const db = await getDatabase();

    const serverDataWithUnknownCols = [
      {
        id: 'ay_unknown_test',
        label: '2029-2030',
        starts_on: '2029-08-01',
        ends_on: '2030-05-31',
        status: 'PLANNED',
        _rev: '1-xyz',
        metadata_unsupported: { sync_version: 5 },
        random_field_999: 'should_be_ignored',
      },
    ];

    await db.transaction(async (tx) => {
      const res = await SchemaMapperService.upsertBatchSafe(tx, 'academic_years', serverDataWithUnknownCols);
      expect(res.applied).toBe(1);
    });

    const row = await db.queryOne<{ id: string; label: string }>('SELECT * FROM academic_years WHERE id = ?', ['ay_unknown_test']);
    expect(row?.label).toBe('2029-2030');
  });

  // TEST 12: Capacitor SQLite adapter interface compatibility
  it('Test 12: Capacitor SQLite adapter interface compatibility verified', async () => {
    const db = await getDatabase();

    // Verify adapter interface implementation
    expect(typeof db.initialize).toBe('function');
    expect(typeof db.execute).toBe('function');
    expect(typeof db.query).toBe('function');
    expect(typeof db.queryOne).toBe('function');
    expect(typeof db.transaction).toBe('function');
    expect(typeof db.isInitialized).toBe('function');
    expect(typeof db.close).toBe('function');
    expect(typeof db.exportBinary).toBe('function');

    expect(db.isInitialized()).toBe(true);

    // Verify transactions work properly through adapter
    const count = await db.transaction(async (tx: DatabaseAdapter) => {
      await tx.execute("INSERT OR REPLACE INTO devices (id, device_name, device_code, status, provisioned_at) VALUES ('dev_compat', 'T1', 'C1', 'ACTIVE', '2026-01-01')");
      const r = await tx.queryOne<{ count: number }>("SELECT count(*) as count FROM devices WHERE id = 'dev_compat'");
      return r?.count || 0;
    });

    expect(count).toBe(1);
  });

  // TEST 13: Strict centavos parsing fails closed on floats, fractions, unsafe ints, or malformed data
  it('Test 13: Strict centavos parsing fails closed on floats, fractions, unsafe ints, or malformed data', () => {
    // Valid safe integer centavos
    expect(SchemaMapperService.toIntegerCentavos(15000)).toBe(15000);
    expect(SchemaMapperService.toIntegerCentavos(0)).toBe(0);
    expect(SchemaMapperService.toIntegerCentavos('15000')).toBe(15000);
    expect(SchemaMapperService.toIntegerCentavos('0')).toBe(0);
    expect(SchemaMapperService.toIntegerCentavos(BigInt(5000))).toBe(5000);

    // Must reject fractional / floating point values (fail closed)
    expect(() => SchemaMapperService.toIntegerCentavos(15000.4, 'amount')).toThrowError(
      /must be a safe integer centavos value, got fractional or unsafe number/
    );
    expect(() => SchemaMapperService.toIntegerCentavos(0.5, 'amount')).toThrowError(
      /must be a safe integer centavos value, got fractional or unsafe number/
    );
    expect(() => SchemaMapperService.toIntegerCentavos('15000.4', 'amount')).toThrowError(
      /contains non-integer characters or fractions/
    );

    // Must reject non-finite and unsafe values
    expect(() => SchemaMapperService.toIntegerCentavos(NaN, 'amount')).toThrowError(/is not a finite number/);
    expect(() => SchemaMapperService.toIntegerCentavos(Infinity, 'amount')).toThrowError(/is not a finite number/);
    expect(() => SchemaMapperService.toIntegerCentavos(Number.MAX_SAFE_INTEGER + 10, 'amount')).toThrowError();

    // Must reject null / undefined / empty
    expect(() => SchemaMapperService.toIntegerCentavos(null, 'amount')).toThrowError(
      /cannot be null or undefined/
    );
    expect(() => SchemaMapperService.toIntegerCentavos(undefined, 'amount')).toThrowError(
      /cannot be null or undefined/
    );
    expect(() => SchemaMapperService.toIntegerCentavos('abc', 'amount')).toThrowError(
      /contains non-integer characters or fractions/
    );
  });

  // TEST 14: Authoritative payments reject missing reference_number or idempotency_key
  it('Test 14: Authoritative payments reject missing reference_number or idempotency_key and abort transaction', async () => {
    const db = await getDatabase();

    await db.execute(`
      INSERT INTO academic_years (id, label, starts_on, ends_on, status) VALUES ('ay_pay_val', '2026-2027', '2026-08-01', '2027-05-31', 'ACTIVE');
      INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status) VALUES ('sem_pay_val', 'ay_pay_val', 'FIRST', '2026-08-01', '2026-12-20', 'ACTIVE');
      INSERT INTO users (id, username, account_status, created_at, updated_at) VALUES ('usr_pay_val', 'cashier_val', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      INSERT INTO users (id, username, account_status, created_at, updated_at) VALUES ('system', 'system', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at) VALUES ('stu_pay_val', '2026-5001', 'Andres', 'Bonifacio', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    `);

    // Missing reference_number
    expect(() =>
      SchemaMapperService.mapRecord('payments', {
        id: 'pay_bad_1',
        student_id: 'stu_pay_val',
        semester_id: 'sem_pay_val',
        processed_by_user_id: 'usr_pay_val',
        idempotency_key: 'IK-123',
        amount_centavos: 10000,
      })
    ).toThrowError(/missing required reference_number/);

    // Missing idempotency_key
    expect(() =>
      SchemaMapperService.mapRecord('payments', {
        id: 'pay_bad_2',
        student_id: 'stu_pay_val',
        semester_id: 'sem_pay_val',
        processed_by_user_id: 'usr_pay_val',
        reference_number: 'REF-123',
        amount_centavos: 10000,
      })
    ).toThrowError(/missing required idempotency_key/);

    // Batch containing missing key rolls back transaction
    const batchWithInvalid = [
      {
        id: 'pay_valid_1',
        student_id: 'stu_pay_val',
        semester_id: 'sem_pay_val',
        processed_by_user_id: 'usr_pay_val',
        reference_number: 'REF-OK-1',
        idempotency_key: 'IK-OK-1',
        amount_centavos: 5000,
      },
      {
        id: 'pay_invalid_2',
        student_id: 'stu_pay_val',
        semester_id: 'sem_pay_val',
        processed_by_user_id: 'usr_pay_val',
        // missing reference_number
        idempotency_key: 'IK-BAD-2',
        amount_centavos: 5000,
      },
    ];

    await expect(
      db.transaction(async (tx) => {
        await SchemaMapperService.upsertBatchSafe(tx, 'payments', batchWithInvalid);
      })
    ).rejects.toThrowError(/missing required reference_number/);

    // Verify first payment was rolled back and not persisted
    const checkValid = await db.queryOne('SELECT * FROM payments WHERE id = ?', ['pay_valid_1']);
    expect(checkValid).toBeNull();
  });

  // TEST 15: Attendance records client_scanned_at does not take scanned_at or checked_in_at fallback
  it('Test 15: Attendance records preserve null client_scanned_at without falling back to scanned_at', () => {
    // Record where server only provided scanned_at (e.g. pre-concurrency or manual scan)
    const mappedNoClientScan = SchemaMapperService.mapRecord('attendance_records', {
      id: 'att_no_client',
      occurrence_id: 'occ_1',
      student_id: 'stu_1',
      status: 'PRESENT',
      scanned_at: '2026-08-10T09:00:00.000Z',
      // client_scanned_at intentionally omitted
    });

    expect(mappedNoClientScan.client_scanned_at).toBeNull();
    expect(mappedNoClientScan.checked_in_at).toBe('2026-08-10T09:00:00.000Z');

    // Record with distinct client_scanned_at and checked_in_at
    const mappedWithBoth = SchemaMapperService.mapRecord('attendance_records', {
      id: 'att_with_both',
      occurrence_id: 'occ_1',
      student_id: 'stu_1',
      status: 'PRESENT',
      checked_in_at: '2026-08-10T09:00:05.000Z',
      client_scanned_at: '2026-08-10T09:00:00.000Z',
    });

    expect(mappedWithBoth.client_scanned_at).toBe('2026-08-10T09:00:00.000Z');
    expect(mappedWithBoth.checked_in_at).toBe('2026-08-10T09:00:05.000Z');

    // REVOKED mapped to VOID for SQLite CHECK constraint compatibility
    const mappedRevoked = SchemaMapperService.mapRecord('attendance_records', {
      id: 'att_rev',
      occurrence_id: 'occ_1',
      student_id: 'stu_1',
      status: 'REVOKED',
      revocation_reason: 'Proxy badge swap',
      revoked_at: '2026-08-10T09:30:00.000Z',
    });

    expect(mappedRevoked.status).toBe('VOID');
    expect(mappedRevoked.void_reason).toBe('Proxy badge swap');
    expect(mappedRevoked.voided_at).toBe('2026-08-10T09:30:00.000Z');
  });

  // TEST 16: Obligation rules live schema column parity (name, type, trigger_type, default_amount_centavos)
  it('Test 16: Obligation rules live schema column parity matches Supabase PostgreSQL metadata', async () => {
    const db = await getDatabase();

    await db.execute(`
      INSERT INTO academic_years (id, label, starts_on, ends_on, status) VALUES ('ay_ob_live', '2026-2027', '2026-08-01', '2027-05-31', 'ACTIVE');
      INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status) VALUES ('sem_ob_live', 'ay_ob_live', 'FIRST', '2026-08-01', '2026-12-20', 'ACTIVE');
    `);

    const serverRule = [
      {
        id: 'ob_rule_pg',
        semester_id: 'sem_ob_live',
        name: 'General Assembly Absence',
        type: 'FINE',
        trigger_type: 'ABSENCE',
        default_amount_centavos: 5000,
        status: 'ACTIVE',
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
      },
    ];

    await db.transaction(async (tx) => {
      const res = await SchemaMapperService.upsertBatchSafe(tx, 'obligation_rules', serverRule);
      expect(res.applied).toBe(1);
    });

    const rule = await db.queryOne<{
      name: string;
      type: string;
      trigger_type: string;
      default_amount_centavos: number;
    }>('SELECT * FROM obligation_rules WHERE id = ?', ['ob_rule_pg']);

    expect(rule?.name).toBe('General Assembly Absence');
    expect(rule?.type).toBe('FINE');
    expect(rule?.trigger_type).toBe('ABSENCE');
    expect(rule?.default_amount_centavos).toBe(5000);
  });

  // TEST 17: NFC Cards live schema column parity (uid_normalized, assigned_at, deactivated_at, note)
  it('Test 17: NFC Cards live schema column parity matches Supabase PostgreSQL metadata', async () => {
    const db = await getDatabase();

    await db.execute(`
      INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
      VALUES ('stu_card_pg', '2026-6001', 'Apolinario', 'Mabini', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    `);

    const serverCard = [
      {
        id: 'card_pg_1',
        student_id: 'stu_card_pg',
        uid_normalized: '04A1B2C3D4E5F6',
        status: 'ACTIVE',
        assigned_at: '2026-08-01T12:00:00.000Z',
        deactivated_at: null,
        note: 'Issued at enrollment gate',
        updated_at: '2026-08-01T12:00:00.000Z',
      },
    ];

    await db.transaction(async (tx) => {
      const res = await SchemaMapperService.upsertBatchSafe(tx, 'nfc_cards', serverCard);
      expect(res.applied).toBe(1);
    });

    const card = await db.queryOne<{
      uid_normalized: string;
      status: string;
      assigned_at: string;
      note: string;
    }>('SELECT * FROM nfc_cards WHERE id = ?', ['card_pg_1']);

    expect(card?.uid_normalized).toBe('04A1B2C3D4E5F6');
    expect(card?.status).toBe('ACTIVE');
    expect(card?.assigned_at).toBe('2026-08-01T12:00:00.000Z');
    expect(card?.note).toBe('Issued at enrollment gate');
  });

  // TEST 18: Event participants live schema column parity (occurrence_id, student_id, attendance_required, excused, updated_at)
  it('Test 18: Event participants live schema column parity matches Supabase PostgreSQL metadata', async () => {
    const db = await getDatabase();

    await db.execute(`
      INSERT INTO academic_years (id, label, starts_on, ends_on, status) VALUES ('ay_part_pg', '2026-2027', '2026-08-01', '2027-05-31', 'ACTIVE');
      INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status) VALUES ('sem_part_pg', 'ay_part_pg', 'FIRST', '2026-08-01', '2026-12-20', 'ACTIVE');
      INSERT INTO event_categories (id, code, name, created_at, updated_at) VALUES ('cat_part_pg', 'GEN', 'General', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      INSERT INTO events (id, category_id, semester_id, title, status, created_at, updated_at) VALUES ('ev_part_pg', 'cat_part_pg', 'sem_part_pg', 'Leadership Summit', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      INSERT INTO event_occurrences (id, event_id, title, occurs_on, starts_at, ends_at, status, updated_at) VALUES ('occ_part_pg', 'ev_part_pg', 'Summit Keynote', '2026-08-15', '2026-08-15T08:00:00Z', '2026-08-15T12:00:00Z', 'OPEN', '2026-08-01T00:00:00Z');
      INSERT INTO users (id, username, account_status, created_at, updated_at) VALUES ('usr_part_pg', 'excuse_officer', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at) VALUES ('stu_part_pg', '2026-7001', 'Marcelo', 'Del Pilar', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      INSERT INTO student_enrollments (id, student_id, semester_id, year_level, section, first_name_snapshot, last_name_snapshot, updated_at)
      VALUES ('enr_part_pg', 'stu_part_pg', 'sem_part_pg', 1, '1-A', 'Marcelo', 'Del Pilar', '2026-08-01T00:00:00Z');
    `);

    const serverParticipant = [
      {
        id: 'part_pg_1',
        occurrence_id: 'occ_part_pg',
        student_id: 'stu_part_pg',
        attendance_required: 1,
        excused: 1,
        excuse_reason: 'Official University Competition Delegate',
        excused_by_user_id: 'usr_part_pg',
        updated_at: '2026-08-12T00:00:00.000Z',
      },
    ];

    await db.transaction(async (tx) => {
      const res = await SchemaMapperService.upsertBatchSafe(tx, 'event_participants', serverParticipant);
      expect(res.applied).toBe(1);
    });

    const participant = await db.queryOne<{
      occurrence_id: string;
      student_id: string;
      attendance_required: number;
      excused: number;
      excuse_reason: string;
      updated_at: string;
      enrollment_id: string;
    }>('SELECT * FROM event_participants WHERE id = ?', ['part_pg_1']);

    expect(participant?.occurrence_id).toBe('occ_part_pg');
    expect(participant?.student_id).toBe('stu_part_pg');
    expect(participant?.attendance_required).toBe(1);
    expect(participant?.excused).toBe(1);
    expect(participant?.excuse_reason).toBe('Official University Competition Delegate');
    expect(participant?.updated_at).toBe('2026-08-12T00:00:00.000Z');
    expect(participant?.enrollment_id).toBe('enr_part_pg');
  });
});
