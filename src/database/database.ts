import type { DatabaseAdapter } from './adapters/database-adapter.interface';
import { NativeSqliteAdapter } from './adapters/native-sqlite.adapter';
import { WebDevSqliteAdapter } from './adapters/web-dev.adapter';
import { MigrationRunner } from './migration-runner';
import { Capacitor } from '@capacitor/core';

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

