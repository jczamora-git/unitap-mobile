import type { DatabaseAdapter } from './adapters/database-adapter.interface';
import { INITIAL_MIGRATION_SQL } from './migrations/001_initial';
import { FINES_REDESIGN_MIGRATION_SQL } from './migrations/002_fines_contributions_redesign';
import { SYSTEM_SETUP_MIGRATION_SQL } from './migrations/003_system_setup_academic_structure';
import { STUDENT_ACTIVATION_MIGRATION_SQL } from './migrations/004_student_activation_audit';
import { OFFICER_MANAGEMENT_MIGRATION_SQL } from './migrations/005_officer_management';
import { ATTENDANCE_CONCURRENCY_MIGRATION_SQL } from './migrations/006_attendance_concurrency_audit';
import { SCHEMA_COMPATIBILITY_MIGRATION_SQL } from './migrations/007_schema_compatibility_and_sync_alignment';
import { ENTITY_CHECKPOINTS_MIGRATION_SQL } from './migrations/008_entity_sync_checkpoints';

export interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'UniTap phase 1 offline database',
    sql: INITIAL_MIGRATION_SQL,
  },
  {
    version: 2,
    description: 'UniTap 2.0 Fines & Contributions Redesign',
    sql: FINES_REDESIGN_MIGRATION_SQL,
  },
  {
    version: 3,
    description: 'UniTap 2.0 DevAdmin-Only System Setup & Academic Structure',
    sql: SYSTEM_SETUP_MIGRATION_SQL,
  },
  {
    version: 4,
    description: 'UniTap 2.0 Student Activation, Rate-Limiting & Audit',
    sql: STUDENT_ACTIVATION_MIGRATION_SQL,
  },
  {
    version: 5,
    description: 'UniTap 2.0 DevAdmin-Only Officer Management & Multi-Role Appointment Architecture',
    sql: OFFICER_MANAGEMENT_MIGRATION_SQL,
  },
  {
    version: 6,
    description: 'UniTap 2.0 Multi-Officer Attendance Concurrency, Optimistic Versioning & Revocation Audit',
    sql: ATTENDANCE_CONCURRENCY_MIGRATION_SQL,
  },
  {
    version: 7,
    description: 'UniTap 2.0 SQLite Schema Compatibility & Safe Data Ingestion',
    sql: SCHEMA_COMPATIBILITY_MIGRATION_SQL,
  },
  {
    version: 8,
    description: 'UniTap 2.0 SQLite Entity Sync Checkpoints & Lossless Pagination',
    sql: ENTITY_CHECKPOINTS_MIGRATION_SQL,
  },
];

export class MigrationRunner {
  public static async runMigrations(adapter: DatabaseAdapter): Promise<void> {
    // 1. Ensure schema_migrations table exists
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);

    // 2. Fetch applied migrations
    const applied = await adapter.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version ASC');
    const appliedVersions = new Set(applied.map((m) => m.version));

    // 3. Apply pending migrations sequentially
    for (const migration of MIGRATIONS) {
      if (!appliedVersions.has(migration.version)) {
        console.log(`[UniTap Database] Applying migration v${migration.version}: ${migration.description}`);
        if (migration.version === 1) {
          await adapter.execute(migration.sql);
        } else {
          // Strip comments and split by semicolon to execute statement-by-statement
          const cleanSql = migration.sql.replace(/--.*$/gm, '');
          const statements = cleanSql
            .split(';')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);

          for (const stmt of statements) {
            try {
              await adapter.execute(stmt);
            } catch (err: unknown) {
              const error = err as Error;
              const isAlterAddColumn = /^\s*ALTER\s+TABLE\s+.*ADD\s+(COLUMN\s+)?/i.test(stmt);
              const isDuplicateColumn = error.message.toLowerCase().includes('duplicate column name');

              if (isAlterAddColumn && isDuplicateColumn) {
                // Expected when column already exists from a prior execution
                continue;
              }

              // Preserve backwards tolerance only for older bootstrap migrations (v2-v6)
              if (migration.version < 7) {
                if (
                  error.message.includes('already exists') ||
                  error.message.includes('UNIQUE constraint failed') ||
                  isDuplicateColumn
                ) {
                  continue;
                }
              }

              throw error;
            }
          }
        }
        // Ensure migration version is registered
        await adapter.execute(
          `INSERT OR IGNORE INTO schema_migrations (version, description) VALUES (?, ?)`,
          [migration.version, migration.description]
        );
        console.log(`[UniTap Database] Migration v${migration.version} applied successfully.`);
      }
    }

    // 4. Safe data upgrade for any existing legacy seeded identifiers to standard RFC 4122 UUIDs
    await this.upgradeLegacySeededIds(adapter);
  }

  private static async upgradeLegacySeededIds(adapter: DatabaseAdapter): Promise<void> {
    try {
      const check = await adapter.query<{ id: string }>(
        "SELECT id FROM event_categories WHERE id = 'cat_ga' LIMIT 1"
      );
      if (check && check.length > 0) {
        console.log('[UniTap Database] Migrating legacy seeded identifiers to standard UUIDs...');
        await adapter.execute(`
          PRAGMA foreign_keys = OFF;
          UPDATE events SET category_id = 'ec000000-0000-4000-8000-000000000001' WHERE category_id = 'cat_ga';
          UPDATE events SET category_id = 'ec000000-0000-4000-8000-000000000002' WHERE category_id = 'cat_cleanup';
          UPDATE events SET category_id = 'ec000000-0000-4000-8000-000000000003' WHERE category_id = 'cat_sports';
          UPDATE events SET category_id = 'ec000000-0000-4000-8000-000000000004' WHERE category_id = 'cat_it_day';
          UPDATE events SET category_id = 'ec000000-0000-4000-8000-000000000005' WHERE category_id = 'cat_orientation';
          UPDATE events SET category_id = 'ec000000-0000-4000-8000-000000000006' WHERE category_id = 'cat_seminar';
          UPDATE events SET category_id = 'ec000000-0000-4000-8000-000000000007' WHERE category_id = 'cat_other';

          UPDATE event_categories SET id = 'ec000000-0000-4000-8000-000000000001' WHERE id = 'cat_ga';
          UPDATE event_categories SET id = 'ec000000-0000-4000-8000-000000000002' WHERE id = 'cat_cleanup';
          UPDATE event_categories SET id = 'ec000000-0000-4000-8000-000000000003' WHERE id = 'cat_sports';
          UPDATE event_categories SET id = 'ec000000-0000-4000-8000-000000000004' WHERE id = 'cat_it_day';
          UPDATE event_categories SET id = 'ec000000-0000-4000-8000-000000000005' WHERE id = 'cat_orientation';
          UPDATE event_categories SET id = 'ec000000-0000-4000-8000-000000000006' WHERE id = 'cat_seminar';
          UPDATE event_categories SET id = 'ec000000-0000-4000-8000-000000000007' WHERE id = 'cat_other';

          UPDATE sections SET year_level_id = 'e1000000-0000-4000-8000-000000000001' WHERE year_level_id = 'yl_1';
          UPDATE sections SET year_level_id = 'e1000000-0000-4000-8000-000000000002' WHERE year_level_id = 'yl_2';
          UPDATE sections SET year_level_id = 'e1000000-0000-4000-8000-000000000003' WHERE year_level_id = 'yl_3';
          UPDATE sections SET year_level_id = 'e1000000-0000-4000-8000-000000000004' WHERE year_level_id = 'yl_4';

          UPDATE student_enrollments SET year_level_id = 'e1000000-0000-4000-8000-000000000001' WHERE year_level_id = 'yl_1';
          UPDATE student_enrollments SET year_level_id = 'e1000000-0000-4000-8000-000000000002' WHERE year_level_id = 'yl_2';
          UPDATE student_enrollments SET year_level_id = 'e1000000-0000-4000-8000-000000000003' WHERE year_level_id = 'yl_3';
          UPDATE student_enrollments SET year_level_id = 'e1000000-0000-4000-8000-000000000004' WHERE year_level_id = 'yl_4';

          UPDATE year_levels SET id = 'e1000000-0000-4000-8000-000000000001' WHERE id = 'yl_1';
          UPDATE year_levels SET id = 'e1000000-0000-4000-8000-000000000002' WHERE id = 'yl_2';
          UPDATE year_levels SET id = 'e1000000-0000-4000-8000-000000000003' WHERE id = 'yl_3';
          UPDATE year_levels SET id = 'e1000000-0000-4000-8000-000000000004' WHERE id = 'yl_4';

          UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000001' WHERE section_id = 'sec_1f1';
          UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000002' WHERE section_id = 'sec_1f2';
          UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000003' WHERE section_id = 'sec_1f3';
          UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000004' WHERE section_id = 'sec_1f4';
          UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000005' WHERE section_id = 'sec_2f1';
          UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000006' WHERE section_id = 'sec_2f2';
          UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000007' WHERE section_id = 'sec_2f3';
          UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000008' WHERE section_id = 'sec_2f4';
          UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000009' WHERE section_id = 'sec_3f1';
          UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000010' WHERE section_id = 'sec_3f4';
          UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000011' WHERE section_id = 'sec_3f5';
          UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000012' WHERE section_id = 'sec_4f1';
          UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000013' WHERE section_id = 'sec_4f4';
          UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000014' WHERE section_id = 'sec_4f5';

          UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000001' WHERE id = 'sec_1f1';
          UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000002' WHERE id = 'sec_1f2';
          UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000003' WHERE id = 'sec_1f3';
          UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000004' WHERE id = 'sec_1f4';
          UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000005' WHERE id = 'sec_2f1';
          UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000006' WHERE id = 'sec_2f2';
          UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000007' WHERE id = 'sec_2f3';
          UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000008' WHERE id = 'sec_2f4';
          UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000009' WHERE id = 'sec_3f1';
          UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000010' WHERE id = 'sec_3f4';
          UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000011' WHERE id = 'sec_3f5';
          UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000012' WHERE id = 'sec_4f1';
          UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000013' WHERE id = 'sec_4f4';
          UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000014' WHERE id = 'sec_4f5';
          PRAGMA foreign_keys = ON;
        `);
      }
    } catch {
      // Non-fatal if tables do not exist yet
    }
  }

  public static async validateSchema(adapter: DatabaseAdapter): Promise<boolean> {
    const requiredTables = [
      'schema_migrations', 'academic_years', 'semesters', 'programs', 'students',
      'student_enrollments', 'profile_confirmations', 'users', 'user_credentials',
      'user_roles', 'devices', 'user_device_access', 'activation_claims',
      'nfc_cards', 'events', 'event_occurrences', 'event_participants',
      'attendance_records', 'attendance_attempts', 'attendance_audit',
      'obligation_rules', 'student_obligations', 'obligation_adjustments',
      'payments', 'payment_allocations', 'simulated_wallets', 'simulated_wallet_ledger',
      'import_batches', 'import_rows', 'report_exports', 'audit_events',
      'sync_outbox', 'sync_state', 'sync_conflicts',
      'event_categories', 'year_levels', 'sections',
      'officer_appointments',
      'entity_sync_checkpoints',
    ];

    const tables = await adapter.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'"
    );
    const existingTableNames = new Set(tables.map((t) => t.name));

    const missing = requiredTables.filter((t) => !existingTableNames.has(t));
    if (missing.length > 0) {
      console.error('[UniTap Database] Missing required schema tables:', missing);
      return false;
    }
    return true;
  }
}
