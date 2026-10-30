import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type { AuditEventRecord, SyncOutboxRecord } from '../../types/database';

export class SyncRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  public static async queueOperation(operation: SyncOutboxRecord, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO sync_outbox (
        id, device_id, entity_type, entity_id, operation, payload_json,
        schema_version, created_at, synced_at, retry_count, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        operation.id,
        operation.device_id,
        operation.entity_type,
        operation.entity_id,
        operation.operation,
        operation.payload_json,
        operation.schema_version,
        operation.created_at,
        operation.synced_at || null,
        operation.retry_count || 0,
        operation.last_error || null,
      ]
    );
  }

  public static async getPendingOperations(deviceId: string, adapter?: DatabaseAdapter): Promise<SyncOutboxRecord[]> {
    const db = await this.getDb(adapter);
    return db.query<SyncOutboxRecord>(
      'SELECT * FROM sync_outbox WHERE device_id = ? AND synced_at IS NULL ORDER BY created_at ASC',
      [deviceId]
    );
  }

  public static async recordAuditEvent(event: AuditEventRecord, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO audit_events (
        id, actor_user_id, device_id, entity_type, entity_id, action, details_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.actor_user_id || null,
        event.device_id || null,
        event.entity_type,
        event.entity_id,
        event.action,
        event.details_json,
        event.occurred_at,
      ]
    );
  }

  public static async recordConflict(
    conflict: {
      id: string;
      entity_type: string;
      entity_id: string;
      local_payload_json: string;
      server_payload_json: string;
      reason: string;
      status: 'OPEN' | 'RESOLVED';
      detected_at: string;
    },
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO sync_conflicts (
        id, entity_type, entity_id, local_payload_json, server_payload_json, reason, status, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conflict.id,
        conflict.entity_type,
        conflict.entity_id,
        conflict.local_payload_json,
        conflict.server_payload_json,
        conflict.reason,
        conflict.status,
        conflict.detected_at,
      ]
    );
  }
}

