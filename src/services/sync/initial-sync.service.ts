import { supabase } from '@/integrations/supabase/client';
import { getDatabase } from '@/database/database';
import { SyncStatusService } from './sync-status.service';
import { SyncScopeService, type UserRole } from './sync-scope.service';

export class InitialSyncService {
  /**
   * Checks whether the local SQLite database has already completed initial hydration
   */
  public static async isHydrated(): Promise<boolean> {
    try {
      const db = await getDatabase();
      const state = await db.queryOne<{ last_success_at: string | null }>(
        'SELECT last_success_at FROM sync_state LIMIT 1'
      );
      return !!(state && state.last_success_at);
    } catch {
      return false;
    }
  }

  /**
   * Performs the initial data download workflow from Supabase into SQLite
   */
  public static async performInitialHydration(
    role: UserRole,
    userId: string,
    studentId?: string | null
  ): Promise<boolean> {
    SyncStatusService.setHydration('DOWNLOADING');
    SyncStatusService.setState('SYNCING');

    const tables = SyncScopeService.getRequiredTablesForRole(role);
    let totalRecords = 0;
    const db = await getDatabase();

    try {
      for (let i = 0; i < tables.length; i++) {
        const tableName = tables[i];
        SyncStatusService.updateProgress(tableName, i, tables.length, totalRecords);

        // Fetch data from Supabase
        let query = supabase.from(tableName).select('*');

        // Apply student scope filtering if STUDENT role
        if (role === 'STUDENT' && studentId) {
          if (tableName === 'students') {
            query = query.eq('id', studentId);
          } else if (['student_enrollments', 'attendance_records', 'student_obligations', 'payments', 'simulated_wallets'].includes(tableName)) {
            query = query.eq('student_id', studentId);
          }
        }

        const { data, error } = await query.limit(500);

        if (error) {
          console.warn(`[InitialSync] Warning: Failed to query remote table ${tableName}:`, error.message);
          // For initial offline dev/testing or tables not yet populated in Supabase, continue gracefully
          continue;
        }

        if (data && data.length > 0) {
          totalRecords += data.length;
          await this.insertRecordsTransactionally(db, tableName, data);
        }
      }

      // Transition to VERIFYING
      SyncStatusService.setHydration('VERIFYING');
      SyncStatusService.updateProgress('Integrity Verification', tables.length, tables.length, totalRecords);

      const now = new Date().toISOString();

      // Ensure default device exists
      await db.execute(
        `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
         VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', ?)`,
        [now]
      );

      // Save initial sync state
      await db.execute(
        `INSERT INTO sync_state (device_id, server_cursor, last_push_at, last_pull_at, last_success_at)
         VALUES ('dev_default', '0', ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET last_success_at = excluded.last_success_at`,
        [now, now, now]
      );

      SyncStatusService.setLastSync(now);
      SyncStatusService.setHydration('READY');
      SyncStatusService.setState('SYNCED');
      return true;
    } catch (err: unknown) {
      console.error('[InitialSync] Hydration failed:', err);
      SyncStatusService.setHydration('FAILED');
      SyncStatusService.setState('SYNC_ERROR');
      SyncStatusService.updateProgress('Failed', 0, tables.length, totalRecords, (err as Error).message);
      return false;
    }
  }

  private static async insertRecordsTransactionally(
    db: any,
    tableName: string,
    records: any[]
  ): Promise<void> {
    if (records.length === 0) return;

    await db.transaction(async (tx: any) => {
      for (const record of records) {
        const keys = Object.keys(record);
        const placeholders = keys.map(() => '?').join(', ');
        const values = keys.map((k) => {
          const val = record[k];
          if (val === null || val === undefined) return null;
          if (typeof val === 'boolean') return val ? 1 : 0;
          if (typeof val === 'object') return JSON.stringify(val);
          return val;
        });

        const sql = `INSERT OR REPLACE INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`;
        await tx.execute(sql, values);
      }
    });
  }
}
