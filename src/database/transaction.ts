import { getDatabase } from './database';
import type { DatabaseAdapter } from './adapters/database-adapter.interface';

export async function runInTransaction<T>(fn: (db: DatabaseAdapter) => Promise<T>): Promise<T> {
  const db = await getDatabase();
  return db.transaction(fn);
}

