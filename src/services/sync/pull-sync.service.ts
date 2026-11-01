import { supabase } from '@/integrations/supabase/client';
import { getDatabase } from '@/database/database';
import { SyncStatusService } from './sync-status.service';

export class PullSyncService {
  /**
   * Pulls incremental remote changes from Supabase into local SQLite
   */
  public static async pullRemoteChanges(): Promise<{ appliedCount: number }> {
    const db = await getDatabase();
    let appliedCount = 0;

    // 1. Fetch current cursor from sync_state
    const state = await db.queryOne<{ last_pull_at: string | null; server_cursor: string | null }>(
      'SELECT last_pull_at, server_cursor FROM sync_state LIMIT 1'
    );
    const lastCursor = Number(state?.server_cursor) || 0;
    const lastSyncAt = state?.last_pull_at || '1970-01-01T00:00:00Z';

    try {
      SyncStatusService.setState('SYNCING');

      // 2. Attempt single-request batch pull via sync_pull_batch RPC
      try {
        const { data: batchData, error: batchErr } = await supabase.rpc('sync_pull_batch', {
          p_since: lastSyncAt,
          p_limit: 500,
        });

        if (!batchErr && batchData && typeof batchData === 'object') {
          const tableKeys = [
            'academic_years',
            'semesters',
            'programs',
            'year_levels',
            'sections',
            'event_categories',
            'obligation_rules',
            'events',
            'event_occurrences',
            'event_participants',
            'students',
            'student_enrollments',
            'nfc_cards',
            'attendance_records',
            'student_obligations',
            'payments',
            'payment_allocations',
          ];

          await db.transaction(async (tx) => {
            for (const table of tableKeys) {
              const rows = batchData[table];
              if (Array.isArray(rows) && rows.length > 0) {
                for (const row of rows) {
                  const keys = Object.keys(row);
                  const placeholders = keys.map(() => '?').join(', ');
                  const values = keys.map((k) => {
                    const val = row[k];
                    if (val === null || val === undefined) return null;
                    if (typeof val === 'boolean') return val ? 1 : 0;
                    if (typeof val === 'object') return JSON.stringify(val);
                    return val;
                  });
                  await tx.execute(
                    `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`,
                    values
                  );
                  appliedCount++;
                }
              }
            }

            const now = batchData.server_time || new Date().toISOString();
            await tx.execute(
              `INSERT INTO sync_state (device_id, server_cursor, last_pull_at, last_success_at)
               VALUES ('dev_default', '0', ?, ?)
               ON CONFLICT(device_id) DO UPDATE SET last_pull_at = excluded.last_pull_at, last_success_at = excluded.last_success_at`,
              [now, now]
            );
          });

          const syncTime = batchData.server_time || new Date().toISOString();
          SyncStatusService.setLastSync(syncTime);
          SyncStatusService.setState('SYNCED');
          return { appliedCount };
        }
      } catch {
        // Fallback to cursor-based or table-by-table REST queries
      }

      // 3. Fallback: Attempt cursor-based RPC pull if available
      const { data, error } = await supabase.rpc('sync_pull_changes', {
        p_since_cursor: lastCursor,
        p_limit: 100,
      });

      if (!error && data && data.changes && data.changes.length > 0) {
        await db.transaction(async (tx) => {
          for (const item of data.changes) {
            const tableName = item.table_name;
            const payload = item.payload;
            if (!tableName || !payload) continue;

            if (item.operation === 'DELETE') {
              await tx.execute(`DELETE FROM ${tableName} WHERE id = ?`, [item.record_id]);
            } else {
              const keys = Object.keys(payload);
              const placeholders = keys.map(() => '?').join(', ');
              const values = keys.map((k) => {
                const val = payload[k];
                if (val === null || val === undefined) return null;
                if (typeof val === 'boolean') return val ? 1 : 0;
                if (typeof val === 'object') return JSON.stringify(val);
                return val;
              });
              await tx.execute(
                `INSERT OR REPLACE INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`,
                values
              );
            }
            appliedCount++;
          }

          // Advance cursor
          const now = new Date().toISOString();
          await tx.execute(
            `UPDATE sync_state SET server_cursor = ?, last_pull_at = ?, last_success_at = ?`,
            [String(data.next_cursor), now, now]
          );
        });

        SyncStatusService.setLastSync(new Date().toISOString());
        SyncStatusService.setState('SYNCED');
        return { appliedCount };
      }

      // 3. Fallback: Incremental polling on active tables for updated records
      const { authService } = await import('@/services/auth.service');
      const studentId = authService.user.value?.student_id;
      const role = authService.role.value;

      const syncTables = ['events', 'event_occurrences', 'attendance_records', 'student_obligations', 'payments'];
      for (const t of syncTables) {
        const timeColumn = t === 'payments' ? 'processed_at' : 'updated_at';
        let q = supabase
          .from(t)
          .select('*')
          .gt(timeColumn, lastSyncAt)
          .limit(100);

        if (role === 'STUDENT' && studentId && ['attendance_records', 'student_obligations', 'payments'].includes(t)) {
          q = q.eq('student_id', studentId);
        }

        const { data: updatedRows, error: qErr } = await q;

        if (!qErr && updatedRows && updatedRows.length > 0) {
          await db.transaction(async (tx) => {
            for (const row of updatedRows) {
              const keys = Object.keys(row);
              const placeholders = keys.map(() => '?').join(', ');
              const values = keys.map((k) => {
                const val = row[k];
                if (val === null || val === undefined) return null;
                if (typeof val === 'boolean') return val ? 1 : 0;
                if (typeof val === 'object') return JSON.stringify(val);
                return val;
              });
              await tx.execute(
                `INSERT OR REPLACE INTO ${t} (${keys.join(', ')}) VALUES (${placeholders})`,
                values
              );
              appliedCount++;
            }
          });
        }
      }

      const now = new Date().toISOString();
      await db.execute(
        `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
         VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', ?)`,
        [now]
      );
      await db.execute(
        `INSERT INTO sync_state (device_id, server_cursor, last_pull_at, last_success_at)
         VALUES ('dev_default', '0', ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET last_pull_at = excluded.last_pull_at, last_success_at = excluded.last_success_at`,
        [now, now]
      );
      SyncStatusService.setLastSync(now);
      SyncStatusService.setState('SYNCED');
    } catch (err) {
      console.warn('[PullSync] Incremental pull failed:', err);
      SyncStatusService.setState('SYNC_ERROR');
    }

    return { appliedCount };
  }
}
