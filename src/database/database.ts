import type { DatabaseAdapter } from './adapters/database-adapter.interface';
import { NativeSqliteAdapter } from './adapters/native-sqlite.adapter';
import { WebDevSqliteAdapter } from './adapters/web-dev.adapter';
import { MigrationRunner } from './migration-runner';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

let adapterInstance: DatabaseAdapter | null = null;
let initPromise: Promise<DatabaseAdapter> | null = null;

export async function getDatabase(): Promise<DatabaseAdapter> {
  if (adapterInstance && adapterInstance.isInitialized()) {
    return adapterInstance;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const adapter: DatabaseAdapter = Capacitor.isNativePlatform()
        ? new NativeSqliteAdapter()
        : new WebDevSqliteAdapter();

      await adapter.initialize();
      await MigrationRunner.runMigrations(adapter);
      const valid = await MigrationRunner.validateSchema(adapter);
      if (!valid) {
        throw new Error('Database schema validation failed: missing tables.');
      }

      adapterInstance = adapter;
      return adapter;
    } catch (err) {
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

export async function resetDatabaseForTests(): Promise<DatabaseAdapter> {
  if (adapterInstance) {
    await adapterInstance.close();
    adapterInstance = null;
    initPromise = null;
  }
  const adapter = new WebDevSqliteAdapter();
  await adapter.initialize();
  await MigrationRunner.runMigrations(adapter);
  adapterInstance = adapter;
  return adapter;
}

/**
 * Completely wipes all local SQLite database tables, outbox records,
 * sync checkpoints, and persisted storage, then re-runs all migrations
 * to restore a fresh, empty database.
 */
export async function clearLocalDatabase(): Promise<void> {
  const db = await getDatabase();

  // 1. Temporarily disable foreign keys for clean table teardown
  await db.execute('PRAGMA foreign_keys = OFF;');

  const tables = await db.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
  );

  for (const table of tables) {
    await db.execute(`DROP TABLE IF EXISTS "${table.name}";`);
  }

  await db.execute('PRAGMA foreign_keys = ON;');

  // 2. Clear persistent binary and cache keys from Capacitor Preferences
  try {
    await Preferences.remove({ key: 'unitap_sqlite_binary_v2' });
    await Preferences.remove({ key: 'nfc_inspector_students_v1' });
    await Preferences.remove({ key: 'unitap_demo_mode' });
    await Preferences.remove({ key: 'unitap_outbox_v1' });
    await Preferences.remove({ key: 'unitap_sync_state' });
  } catch (err) {
    console.warn('[UniTap Database] Preferences clean warning:', err);
  }

  // 3. Clear browser localStorage if applicable
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('unitap') || key.includes('sqlite') || key.includes('nfc_inspector'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch {
      // Non-fatal
    }
  }

  // 4. Re-run migrations from scratch to rebuild clean schema
  await MigrationRunner.runMigrations(db);

  // 5. Persist empty database state if adapter supports it (WebDevSqliteAdapter)
  const maybePersist = db as unknown as { persist?: () => Promise<void> };
  if (typeof maybePersist.persist === 'function') {
    await maybePersist.persist();
  }
}

// Expose on global window object in browser for quick developer console access
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).clearUniTapDatabase = clearLocalDatabase;
}


