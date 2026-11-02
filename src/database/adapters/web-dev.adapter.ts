import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Preferences } from '@capacitor/preferences';
import type { DatabaseAdapter } from './database-adapter.interface';

const PERSISTENCE_KEY = 'unitap_sqlite_binary_v2';

export class WebDevSqliteAdapter implements DatabaseAdapter {
  private db: Database | null = null;
  private SQL: SqlJsStatic | null = null;
  private inTransaction = false;

  public isInitialized(): boolean {
    return this.db !== null;
  }

  public async initialize(): Promise<void> {
    if (this.db) return;

    if (!this.SQL) {
      const isNode = typeof (globalThis as unknown as { process?: { versions?: { node?: string } } }).process?.versions?.node !== 'undefined';
      if (isNode) {
        // Node / Vitest test environment: synchronous local resolution via Node fs
        this.SQL = await initSqlJs();
      } else {
        // Browser / WebView environment: use local Vite-bundled WASM asset
        try {
          this.SQL = await initSqlJs({
            locateFile: (file: string) => {
              if (file.endsWith('.wasm')) {
                return sqlWasmUrl || '/sql-wasm.wasm';
              }
              return file;
            },
          });
        } catch (err) {
          console.warn('[WebDevSqliteAdapter] Primary WASM resolution failed, trying fallback to /sql-wasm.wasm:', err);
          this.SQL = await initSqlJs({
            locateFile: () => '/sql-wasm.wasm',
          });
        }
      }
    }

    // Attempt to load persisted database bytes from Preferences if available
    let existingData: Uint8Array | null = null;
    try {
      const { value } = await Preferences.get({ key: PERSISTENCE_KEY });
      if (value) {
        const binaryString = atob(value);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        existingData = bytes;
      }
    } catch {
      // Preferences unavailable or empty
    }

    if (existingData && existingData.length > 0) {
      this.db = new this.SQL.Database(existingData);
    } else {
      this.db = new this.SQL.Database();
    }

    // Always enforce foreign keys
    this.db.run('PRAGMA foreign_keys = ON;');
  }

  public async persist(): Promise<void> {
    if (!this.db) return;
    const isNode = typeof (globalThis as unknown as { process?: { versions?: { node?: string } } }).process?.versions?.node !== 'undefined';
    if (isNode) return; // In tests/Node, keep purely in-memory

    try {
      const data = this.db.export();
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
      }
      const base64 = btoa(binary);
      await Preferences.set({ key: PERSISTENCE_KEY, value: base64 });
    } catch {
      // In environments without persistent storage, keep in-memory
    }
  }

  public async execute(sql: string, params?: unknown[]): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    if (params && params.length > 0) {
      this.db.run(sql, params as (number | string | null | Uint8Array)[]);
    } else {
      this.db.run(sql);
    }
    const affected = this.db.getRowsModified();
    if (!this.inTransaction) {
      await this.persist();
    }
    return affected;
  }

  public async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare(sql);
    try {
      if (params && params.length > 0) {
        stmt.bind(params as (number | string | null | Uint8Array)[]);
      }
      const results: T[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as unknown as T;
        results.push(row);
      }
      return results;
    } finally {
      stmt.free();
    }
  }

  public async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  public async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    if (!this.db) throw new Error('Database not initialized');
    if (this.inTransaction) {
      // Nested transaction: reuse current context
      return await fn(this);
    }

    this.inTransaction = true;
    this.db.run('BEGIN TRANSACTION;');
    try {
      const result = await fn(this);
      this.db.run('COMMIT;');
      this.inTransaction = false;
      await this.persist();
      return result;
    } catch (error) {
      this.db.run('ROLLBACK;');
      this.inTransaction = false;
      throw error;
    }
  }

  public async exportBinary(): Promise<Uint8Array> {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.export();
  }

  public async close(): Promise<void> {
    if (this.db) {
      await this.persist();
      this.db.close();
      this.db = null;
    }
  }
}
