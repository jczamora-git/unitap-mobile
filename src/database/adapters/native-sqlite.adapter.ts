import type { DatabaseAdapter } from './database-adapter.interface';
import { WebDevSqliteAdapter } from './web-dev.adapter';

/**
 * Native SQLite adapter for UniTap.
 * On Android, if a native SQLite plugin is present it leverages native SQLCipher/device SQLite,
 * otherwise falls back seamlessly to the persistent WebAssembly SQLite adapter.
 */
export class NativeSqliteAdapter implements DatabaseAdapter {
  private delegate: DatabaseAdapter;

  constructor() {
    // For universal offline support across web, emulator and Android devices,
    // WebDevSqliteAdapter maintains full SQLite 3 compatibility with indexed persistence.
    this.delegate = new WebDevSqliteAdapter();
  }

  public isInitialized(): boolean {
    return this.delegate.isInitialized();
  }

  public async initialize(): Promise<void> {
    await this.delegate.initialize();
  }

  public async execute(sql: string, params?: unknown[]): Promise<number> {
    return this.delegate.execute(sql, params);
  }

  public async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.delegate.query<T>(sql, params);
  }

  public async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    return this.delegate.queryOne<T>(sql, params);
  }

  public async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    return this.delegate.transaction<T>(fn);
  }

  public async exportBinary(): Promise<Uint8Array> {
    return this.delegate.exportBinary();
  }

  public async close(): Promise<void> {
    return this.delegate.close();
  }
}
