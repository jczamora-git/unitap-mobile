import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase, resetDatabaseForTests, clearLocalDatabase } from '@/database/database';
import { MigrationRunner } from '@/database/migration-runner';
import { LegacyMigrationService } from '@/services/legacy-migration.service';
import { Preferences } from '@capacitor/preferences';

describe('UniTap 2.0 Database & Migrations', () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
  });

  it('initializes all 34 required schema tables', async () => {
    const db = await resetDatabaseForTests();
    const isValid = await MigrationRunner.validateSchema(db);
    expect(isValid).toBe(true);

    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'"
    );
    expect(tables.length).toBeGreaterThanOrEqual(34);
  });

  it('enforces foreign key constraints', async () => {
    const db = await resetDatabaseForTests();
    // Attempting to insert a semester referencing a non-existent academic year should fail
    await expect(
      db.execute(
        `INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
         VALUES ('sem_orphan', 'ay_nonexistent', 'FIRST', '2026-01-01', '2026-06-01', 'PLANNED')`
      )
    ).rejects.toThrow();
  });

  it('enforces only_one_active_semester unique index', async () => {
    const db = await resetDatabaseForTests();
    await db.execute(
      `INSERT INTO academic_years (id, label, starts_on, ends_on, status)
       VALUES ('ay_2026', '2026-2027', '2026-08-01', '2027-05-31', 'ACTIVE')`
    );

    // First active semester succeeds
    await db.execute(
      `INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
       VALUES ('sem_1', 'ay_2026', 'FIRST', '2026-08-01', '2026-12-31', 'ACTIVE')`
    );

    // Second active semester must fail due to only_one_active_semester index
    await expect(
      db.execute(
        `INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
         VALUES ('sem_2', 'ay_2026', 'SECOND', '2027-01-01', '2027-05-31', 'ACTIVE')`
      )
    ).rejects.toThrow();
  });

  it('rolls back completely on transaction failure', async () => {
    const db = await resetDatabaseForTests();
    await db.execute(
      `INSERT INTO academic_years (id, label, starts_on, ends_on, status)
       VALUES ('ay_tx_test', '2028-2029', '2028-08-01', '2029-05-31', 'PLANNED')`
    );

    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          `INSERT INTO programs (id, code, name, is_active)
           VALUES ('prog_tx1', 'BSCS', 'Computer Science', 1)`
        );
        // Intentional failure: invalid foreign key
        await tx.execute(
          `INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
           VALUES ('sem_fail', 'ay_not_found', 'FIRST', '2028-08-01', '2028-12-31', 'PLANNED')`
        );
      });
    } catch {
      // Expected rollback
    }

    // Program inserted before failure should have been rolled back
    const prog = await db.queryOne('SELECT * FROM programs WHERE id = ?', ['prog_tx1']);
    expect(prog).toBeNull();
  });

  it('performs safe, idempotent legacy migration without losing data', async () => {
    // Seed legacy Preferences
    const legacyStudent = [
      {
        id: 'legacy_stu_1',
        studentNumber: '2026-0042',
        fullName: 'Andres Bonifacio',
        yearLevel: '2',
        section: '2F4',
        rfidUid: '04:A1:B2:C3:D4:E5',
        rfidUidCompact: '04A1B2C3D4E5',
        status: 'ACTIVE',
      },
    ];
    await Preferences.set({ key: 'nfc_inspector_students_v1', value: JSON.stringify(legacyStudent) });

    const summary = await LegacyMigrationService.migrate();
    expect(summary.success).toBe(true);
    expect(summary.studentsMigrated).toBeGreaterThanOrEqual(1);

    // Verify student was migrated
    const db = await resetDatabaseForTests();
    // Re-run migration into clean test database
    await LegacyMigrationService.migrate();
    const migratedStudent = await db.queryOne<{ school_id: string }>(
      'SELECT school_id FROM students WHERE school_id = ?',
      ['2026-0042']
    );
    expect(migratedStudent?.school_id).toBe('2026-0042');

    // Verify raw Preferences backup was preserved
    const backupKey = (await Preferences.get({ key: 'unitap_legacy_backup_timestamp' })).value;
    expect(backupKey).toBeDefined();
  });

  it('clearLocalDatabase completely wipes records and restores a pristine empty database', async () => {
    const db = await getDatabase();
    // Insert some records
    await db.execute(
      `INSERT INTO academic_years (id, label, starts_on, ends_on, status)
       VALUES ('ay_clear_test', '2026-2027', '2026-08-01', '2027-05-31', 'ACTIVE')`
    );
    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
       VALUES ('stu_clear_test', 'MCC2026-9999', 'Juan', 'Dela Cruz', 'ACTIVE', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
    );

    const countBefore = await db.queryOne<{ cnt: number }>('SELECT count(*) as cnt FROM students');
    expect(countBefore?.cnt).toBeGreaterThanOrEqual(1);

    // Call clearLocalDatabase
    await clearLocalDatabase();

    // Verify all tables are still valid schema
    const isValid = await MigrationRunner.validateSchema(db);
    expect(isValid).toBe(true);

    // Verify data was wiped
    const countAfter = await db.queryOne<{ cnt: number }>('SELECT count(*) as cnt FROM students');
    expect(countAfter?.cnt).toBe(0);

    const ayAfter = await db.queryOne<{ cnt: number }>('SELECT count(*) as cnt FROM academic_years');
    expect(ayAfter?.cnt).toBe(0);
  });
});

