import type { DatabaseAdapter } from '@/database/adapters/database-adapter.interface';

export interface EntitySyncCheckpoint {
  entity_name: string;
  last_pulled_at: string;
  last_pulled_id: string | null;
  records_pulled: number;
  last_sync_status: 'IDLE' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'PENDING_OUTBOX';
  last_error_message: string | null;
  updated_at: string;
}

export const EPOCH_PULL_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export class EntityCheckpointService {
  /**
   * Fetches the durable sync checkpoint for a specific entity.
   * If the checkpoint row does not exist, returns safe defaults starting at epoch.
   */
  public static async getCheckpoint(
    db: DatabaseAdapter,
    entityName: string
  ): Promise<EntitySyncCheckpoint> {
    try {
      const row = await db.queryOne<EntitySyncCheckpoint>(
        `SELECT entity_name, last_pulled_at, last_pulled_id, records_pulled,
                last_sync_status, last_error_message, updated_at
         FROM entity_sync_checkpoints
         WHERE entity_name = ?
         LIMIT 1`,
        [entityName]
      );

      if (row) {
        return {
          entity_name: row.entity_name,
          last_pulled_at: row.last_pulled_at || EPOCH_PULL_TIMESTAMP,
          last_pulled_id: row.last_pulled_id || null,
          records_pulled: Number(row.records_pulled) || 0,
          last_sync_status: row.last_sync_status || 'IDLE',
          last_error_message: row.last_error_message || null,
          updated_at: row.updated_at || new Date().toISOString(),
        };
      }
    } catch {
      // Table might not exist yet during pre-migration checks
    }

    return {
      entity_name: entityName,
      last_pulled_at: EPOCH_PULL_TIMESTAMP,
      last_pulled_id: null,
      records_pulled: 0,
      last_sync_status: 'IDLE',
      last_error_message: null,
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Fetches all durable sync checkpoints from SQLite.
   */
  public static async getAllCheckpoints(db: DatabaseAdapter): Promise<EntitySyncCheckpoint[]> {
    try {
      const rows = await db.query<EntitySyncCheckpoint>(
        `SELECT entity_name, last_pulled_at, last_pulled_id, records_pulled,
                last_sync_status, last_error_message, updated_at
         FROM entity_sync_checkpoints
         ORDER BY entity_name ASC`
      );
      return rows;
    } catch {
      return [];
    }
  }

  /**
   * Updates an entity checkpoint within an active transaction.
   * Ensures atomic commit together with ingested records.
   */
  public static async updateCheckpointInTransaction(
    tx: DatabaseAdapter,
    checkpoint: {
      entity_name: string;
      last_pulled_at: string;
      last_pulled_id: string | null;
      records_pulled: number;
      last_sync_status: 'IDLE' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'PENDING_OUTBOX';
      last_error_message?: string | null;
    }
  ): Promise<void> {
    const now = new Date().toISOString();
    await tx.execute(
      `INSERT INTO entity_sync_checkpoints (
         entity_name, last_pulled_at, last_pulled_id, records_pulled,
         last_sync_status, last_error_message, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_name) DO UPDATE SET
         last_pulled_at = excluded.last_pulled_at,
         last_pulled_id = excluded.last_pulled_id,
         records_pulled = excluded.records_pulled,
         last_sync_status = excluded.last_sync_status,
         last_error_message = excluded.last_error_message,
         updated_at = excluded.updated_at`,
      [
        checkpoint.entity_name,
        checkpoint.last_pulled_at,
        checkpoint.last_pulled_id ?? null,
        checkpoint.records_pulled ?? 0,
        checkpoint.last_sync_status ?? 'IDLE',
        checkpoint.last_error_message ?? null,
        now,
      ]
    );
  }

  /**
   * Sets the status of an entity checkpoint outside a page transaction
   * (e.g. to mark FAILED when an RPC or transaction throws).
   */
  public static async setCheckpointStatus(
    db: DatabaseAdapter,
    entityName: string,
    status: 'IDLE' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'PENDING_OUTBOX',
    errorMessage?: string | null
  ): Promise<void> {
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE entity_sync_checkpoints
       SET last_sync_status = ?,
           last_error_message = ?,
           updated_at = ?
       WHERE entity_name = ?`,
      [status, errorMessage ?? null, now, entityName]
    );
  }

  /**
   * Resets checkpoints back to epoch 1970-01-01T00:00:00.000Z.
   * If entityName is omitted, resets all checkpoints.
   */
  public static async resetCheckpoint(
    db: DatabaseAdapter,
    entityName?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    if (entityName) {
      await db.execute(
        `UPDATE entity_sync_checkpoints
         SET last_pulled_at = ?,
             last_pulled_id = NULL,
             records_pulled = 0,
             last_sync_status = 'IDLE',
             last_error_message = NULL,
             updated_at = ?
         WHERE entity_name = ?`,
        [EPOCH_PULL_TIMESTAMP, now, entityName]
      );
    } else {
      await db.execute(
        `UPDATE entity_sync_checkpoints
         SET last_pulled_at = ?,
             last_pulled_id = NULL,
             records_pulled = 0,
             last_sync_status = 'IDLE',
             last_error_message = NULL,
             updated_at = ?`,
        [EPOCH_PULL_TIMESTAMP, now]
      );
    }
  }
}

