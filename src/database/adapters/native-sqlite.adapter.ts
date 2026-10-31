import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { DatabaseAdapter } from './database-adapter.interface';

/**
 * Native SQLite adapter for UniTap on Android.
 * Leverages native device SQLite via @capacitor-community/sqlite.
 * Does not initialize or use WebAssembly.
 */
export class NativeSqliteAdapter implements DatabaseAdapter {
  private sqlite: SQLiteConnection | null = null;
  private db: SQLiteDBConnection | null = null;
  private inTransaction = false;
  private readonly dbName = 'unitap_db';

  public isInitialized(): boolean {
    return this.db !== null;
  }

  public async initialize(): Promise<void> {
    if (this.db) return;

    this.sqlite = new SQLiteConnection(CapacitorSQLite);
    const isConn = (await this.sqlite.isConnection(this.dbName, false)).result;
    if (isConn) {
      this.db = await this.sqlite.retrieveConnection(this.dbName, false);
    } else {
      this.db = await this.sqlite.createConnection(this.dbName, false, 'no-encryption', 1, false);
    }
    await this.db.open();
    await this.db.execute('PRAGMA foreign_keys = ON;', false);
  }

  public async execute(sql: string, params?: unknown[]): Promise<number> {
    if (!this.db) throw new Error('Native SQLite database not initialized');
    if (params && params.length > 0) {
      const res = await this.db.run(sql, params as unknown[], false);
      return res.changes?.changes ?? 0;
    } else {
      const res = await this.db.execute(sql, false);
      return res.changes?.changes ?? 0;
    }
  }

  public async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.db) throw new Error('Native SQLite database not initialized');
    const res = await this.db.query(sql, (params as unknown[]) || []);
    return ((res.values ?? []) as unknown) as T[];
  }

  public async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  public async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    if (!this.db) throw new Error('Native SQLite database not initialized');
    if (this.inTransaction) {
      return await fn(this);
    }

    this.inTransaction = true;
    await this.db.beginTransaction();
    try {
      const result = await fn(this);
      await this.db.commitTransaction();
      this.inTransaction = false;
      return result;
    } catch (err) {
      await this.db.rollbackTransaction();
      this.inTransaction = false;
      throw err;
    }
  }

  public async exportBinary(): Promise<Uint8Array> {
    // Native SQLite stores directly to local Android SQLite file; export not applicable.
    return new Uint8Array(0);
  }

  public async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      if (this.sqlite) {
        await this.sqlite.closeConnection(this.dbName, false);
      }
      this.db = null;
    }
  }
}

