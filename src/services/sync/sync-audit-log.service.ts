import { getDatabase } from '@/database/database';
import type { DatabaseAdapter } from '@/database/adapters/database-adapter.interface';
import { generateUuid } from '@/utilities/uuid';

export type SyncAuditLogDirection = 'PUSH' | 'PULL' | 'RECONCILE';

export type SyncAuditLogOperationType =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'VOID'
  | 'UPSERT'
  | 'PULL_BATCH'
  | 'RECONCILE'
  | 'RETRY';

export type SyncAuditLogStatus = 'SUCCESS' | 'FAILED' | 'CONFLICT' | 'SKIPPED';

export interface SyncAuditLogRecord {
  id: string;
  operation_id: string | null;
  timestamp: string;
  direction: SyncAuditLogDirection;
  entity_type: string;
  record_id: string | null;
  operation_type: SyncAuditLogOperationType;
  status: SyncAuditLogStatus;
  attempt_count: number;
  duration_ms: number;
  server_ack_ref: string | null;
  error_code: string | null;
  error_message: string | null;
  details_json: string | null;
}

export interface SyncAuditLogInput {
  operationId?: string | null;
  timestamp?: string;
  direction: SyncAuditLogDirection;
  entityType: string;
  recordId?: string | null;
  operationType: SyncAuditLogOperationType;
  status: SyncAuditLogStatus;
  attemptCount?: number;
  durationMs?: number;
  serverAckRef?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  details?: Record<string, any> | null;
}

export interface SyncAuditLogFilter {
  direction?: SyncAuditLogDirection;
  status?: SyncAuditLogStatus;
  entityType?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
}

export interface SyncAuditLogStats {
  totalLogs: number;
  successCount: number;
  failureCount: number;
  conflictCount: number;
  lastLogTime: string | null;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'hash',
  'pin',
  'api_key',
  'authorization',
  'cookie',
  'credential',
]);

export class SyncAuditLogService {
  private static pruneCounter = 0;

  /**
   * Deep sanitization to guarantee NO passwords, access tokens, or private secrets
   * are logged into SQLite storage.
   */
  public static sanitize(data: unknown): unknown {
    if (!data || typeof data !== 'object') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitize(item));
    }

    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data as Record<string, any>)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lower) || lower.includes('token') || lower.includes('secret') || lower.includes('password')) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * Records a local-only synchronization audit entry.
   * STRICTLY LOCAL TO SQLITE: Never enqueued to sync_outbox, never synced to Supabase.
   */
  public static async recordLog(input: SyncAuditLogInput, dbOrTx?: DatabaseAdapter): Promise<string> {
    try {
      const db = dbOrTx || (await getDatabase());
      const logId = 'log_' + generateUuid().substring(0, 12);
      const timestamp = input.timestamp || new Date().toISOString();
      const sanitizedDetails = input.details ? JSON.stringify(this.sanitize(input.details)) : null;

      await db.execute(
        `INSERT INTO sync_audit_logs (
          id, operation_id, timestamp, direction, entity_type, record_id,
          operation_type, status, attempt_count, duration_ms, server_ack_ref,
          error_code, error_message, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          logId,
          input.operationId || null,
          timestamp,
          input.direction,
          input.entityType.toUpperCase(),
          input.recordId || null,
          input.operationType,
          input.status,
          input.attemptCount ?? 1,
          input.durationMs ?? 0,
          input.serverAckRef || null,
          input.errorCode || null,
          input.errorMessage || null,
          sanitizedDetails,
        ]
      );

      // Trigger FIFO retention prune every 25 log entries
      this.pruneCounter++;
      if (this.pruneCounter >= 25) {
        this.pruneCounter = 0;
        this.pruneOldLogs(db).catch((err) => {
          console.warn('[SyncAuditLogService] Prune failed:', err);
        });
      }

      return logId;
    } catch (err) {
      console.warn('[SyncAuditLogService] Could not write audit log:', err);
      return '';
    }
  }

  /**
   * Retrieves audit logs filtered and paginated for UI display.
   */
  public static async getLogs(
    filter: SyncAuditLogFilter = {},
    dbOrTx?: DatabaseAdapter
  ): Promise<{ logs: SyncAuditLogRecord[]; total: number }> {
    try {
      const db = dbOrTx || (await getDatabase());
      const conditions: string[] = [];
      const params: any[] = [];

      if (filter.direction) {
        conditions.push('direction = ?');
        params.push(filter.direction);
      }

      if (filter.status) {
        conditions.push('status = ?');
        params.push(filter.status);
      }

      if (filter.entityType && filter.entityType !== 'ALL') {
        conditions.push('entity_type = ?');
        params.push(filter.entityType.toUpperCase());
      }

      if (filter.searchQuery && filter.searchQuery.trim().length > 0) {
        const term = `%${filter.searchQuery.trim()}%`;
        conditions.push(
          '(entity_type LIKE ? OR error_message LIKE ? OR record_id LIKE ? OR operation_id LIKE ? OR server_ack_ref LIKE ?)'
        );
        params.push(term, term, term, term, term);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Total count
      const countRes = await db.queryOne<{ total: number }>(
        `SELECT COUNT(*) as total FROM sync_audit_logs ${whereClause}`,
        params
      );
      const total = countRes?.total || 0;

      // Paginated rows
      const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
      const offset = Math.max(filter.offset || 0, 0);

      const logs = await db.query<SyncAuditLogRecord>(
        `SELECT * FROM sync_audit_logs
         ${whereClause}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      return { logs: logs || [], total };
    } catch (err) {
      console.warn('[SyncAuditLogService] Could not fetch logs:', err);
      return { logs: [], total: 0 };
    }
  }

  /**
   * Enforces retention policy:
   * 1. Delete entries older than 30 days.
   * 2. Retain at most latest 5,000 entries (FIFO prune).
   * STRICT GUARANTEE: Never touches sync_outbox or sync_conflicts.
   */
  public static async pruneOldLogs(dbOrTx?: DatabaseAdapter): Promise<number> {
    try {
      const db = dbOrTx || (await getDatabase());
      let deleted = 0;

      // 1. 30-day cutoff
      const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      await db.execute('DELETE FROM sync_audit_logs WHERE timestamp < ?', [thirtyDaysAgoIso]);

      // 2. FIFO limit 5,000 records
      const totalRow = await db.queryOne<{ count: number }>(
        'SELECT count(*) as count FROM sync_audit_logs'
      );
      const total = totalRow?.count || 0;
      if (total > 5000) {
        await db.execute(
          `DELETE FROM sync_audit_logs
           WHERE id NOT IN (
             SELECT id FROM sync_audit_logs ORDER BY timestamp DESC LIMIT 5000
           )`
        );
        deleted += total - 5000;
      }

      return deleted;
    } catch (err) {
      console.warn('[SyncAuditLogService] Prune error:', err);
      return 0;
    }
  }

  /**
   * Aggregates stats for the Sync Center UI.
   */
  public static async getLogStats(dbOrTx?: DatabaseAdapter): Promise<SyncAuditLogStats> {
    try {
      const db = dbOrTx || (await getDatabase());
      const stats = await db.queryOne<{
        total_logs: number;
        success_count: number;
        failure_count: number;
        conflict_count: number;
        last_log_time: string | null;
      }>(`
        SELECT
          COUNT(*) as total_logs,
          SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success_count,
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failure_count,
          SUM(CASE WHEN status = 'CONFLICT' THEN 1 ELSE 0 END) as conflict_count,
          MAX(timestamp) as last_log_time
        FROM sync_audit_logs
      `);

      return {
        totalLogs: stats?.total_logs || 0,
        successCount: stats?.success_count || 0,
        failureCount: stats?.failure_count || 0,
        conflictCount: stats?.conflict_count || 0,
        lastLogTime: stats?.last_log_time || null,
      };
    } catch (err) {
      console.warn('[SyncAuditLogService] Could not get stats:', err);
      return {
        totalLogs: 0,
        successCount: 0,
        failureCount: 0,
        conflictCount: 0,
        lastLogTime: null,
      };
    }
  }

  /**
   * Clears all local audit logs.
   */
  public static async clearAllLogs(dbOrTx?: DatabaseAdapter): Promise<void> {
    const db = dbOrTx || (await getDatabase());
    await db.execute('DELETE FROM sync_audit_logs');
  }
}

