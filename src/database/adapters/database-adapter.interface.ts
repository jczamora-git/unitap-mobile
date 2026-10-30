export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowsAffected?: number;
}

export interface DatabaseAdapter {
  isInitialized(): boolean;
  initialize(): Promise<void>;
  execute(sql: string, params?: unknown[]): Promise<number>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;
  exportBinary(): Promise<Uint8Array>;
  close(): Promise<void>;
}

