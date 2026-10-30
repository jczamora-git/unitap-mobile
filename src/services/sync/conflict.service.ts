import { getDatabase } from '@/database/database';
import { SyncStatusService } from './sync-status.service';

export interface ConflictRecord {
  id: string;
  entityType: string;
  entityId: string;
  conflictType: string;
  clientPayload: any;
  serverPayload?: any;
  resolution: 'SERVER_WINS' | 'CLIENT_WINS' | 'MANUAL_REQUIRED';
}

export class ConflictService {
  public static async recordConflict(conflict: ConflictRecord): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO sync_conflicts (
        id, entity_type, entity_id, local_payload_json,
        server_payload_json, reason, status, detected_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conflict.id,
        conflict.entityType,
        conflict.entityId,
        JSON.stringify(conflict.clientPayload),
        conflict.serverPayload ? JSON.stringify(conflict.serverPayload) : '{}',
        conflict.conflictType,
        conflict.resolution === 'MANUAL_REQUIRED' ? 'OPEN' : 'RESOLVED',
        now,
        conflict.resolution !== 'MANUAL_REQUIRED' ? now : null,
      ]
    );

    SyncStatusService.setState('CONFLICT');
    console.warn(`[ConflictService] Conflict recorded: [${conflict.conflictType}] on ${conflict.entityType}:${conflict.entityId}`);
  }

  public static async getUnresolvedConflicts(): Promise<any[]> {
    const db = await getDatabase();
    return db.query(
      `SELECT * FROM sync_conflicts WHERE resolution = 'MANUAL_REQUIRED' ORDER BY created_at DESC`
    );
  }
}
