import type { DatabaseAdapter } from './adapters/database-adapter.interface';
import { INITIAL_MIGRATION_SQL } from './migrations/001_initial';

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
        try {
          await adapter.execute(migration.sql);
        } catch (err: unknown) {
          const error = err as Error;
          if (!error.message.includes('already exists') && !error.message.includes('UNIQUE constraint failed')) {
            throw error;
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
