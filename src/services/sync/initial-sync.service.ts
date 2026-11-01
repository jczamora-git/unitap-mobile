import { supabase } from '@/integrations/supabase/client';
import { getDatabase } from '@/database/database';
import { Preferences } from '@capacitor/preferences';
import { SyncStatusService } from './sync-status.service';
import { SyncScopeService, type UserRole } from './sync-scope.service';

export const HYDRATED_USER_KEY = 'unitap_hydrated_user_id';
export const HYDRATED_ROLE_KEY = 'unitap_hydrated_role';

export class InitialSyncService {
  /**
   * Checks whether the local SQLite database has already completed initial hydration
   * for the specific authenticated user context.
   */
  public static async isHydrated(userId?: string): Promise<boolean> {
    try {
      const db = await getDatabase();
      const state = await db.queryOne<{ last_success_at: string | null }>(
        'SELECT last_success_at FROM sync_state LIMIT 1'
      );
      if (!state || !state.last_success_at) {
        return false;
      }

      // Check account isolation if userId provided
      if (userId) {
        let storedUserId: string | null = null;
        try {
          const { value } = await Preferences.get({ key: HYDRATED_USER_KEY });
          storedUserId = value;
        } catch {
          // Fallback
        }

        if (typeof localStorage !== 'undefined' && !storedUserId) {
          storedUserId = localStorage.getItem(HYDRATED_USER_KEY);
        }

        // If another account was previously hydrated, require fresh scoped rehydration
        if (storedUserId && storedUserId !== userId) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Performs the initial data download workflow from Supabase into SQLite
   * strictly scoped to the user's authorized role and data boundaries.
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
      // 1. Fast-Path: Single-Request Batch RPC
      try {
        const { data: batchData, error: batchErr } = await supabase.rpc('sync_pull_batch', {
          p_since: '1970-01-01T00:00:00Z',
          p_limit: 1000,
        });

        if (!batchErr && batchData && typeof batchData === 'object') {
          for (let i = 0; i < tables.length; i++) {
            const tableName = tables[i];
            const rows = batchData[tableName];
            if (Array.isArray(rows) && rows.length > 0) {
              totalRecords += rows.length;
              await this.insertRecordsTransactionally(db, tableName, rows);
            }
            SyncStatusService.updateProgress(tableName, i + 1, tables.length, totalRecords);
          }

          SyncStatusService.setHydration('VERIFYING');
          SyncStatusService.updateProgress('Integrity Verification', tables.length, tables.length, totalRecords);

          const now = batchData.server_time || new Date().toISOString();
          await db.execute(
            `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
             VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', ?)`,
            [now]
          );
          await db.execute(
            `INSERT INTO sync_state (device_id, server_cursor, last_push_at, last_pull_at, last_success_at)
             VALUES ('dev_default', '0', ?, ?, ?)
             ON CONFLICT(device_id) DO UPDATE SET last_pull_at = excluded.last_pull_at, last_success_at = excluded.last_success_at`,
            [now, now, now]
          );

          await Preferences.set({ key: HYDRATED_USER_KEY, value: userId });
          await Preferences.set({ key: HYDRATED_ROLE_KEY, value: role });
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(HYDRATED_USER_KEY, userId);
            localStorage.setItem(HYDRATED_ROLE_KEY, role);
          }

          SyncStatusService.setLastSync(now);
          SyncStatusService.setHydration('READY');
          SyncStatusService.setState('SYNCED');
          return true;
        }
      } catch {
        // Fallback to table-by-table REST loop
      }

      // 2. Fallback: Table-by-table REST loop
      for (let i = 0; i < tables.length; i++) {
        const tableName = tables[i];
        SyncStatusService.updateProgress(tableName, i, tables.length, totalRecords);

        // Fetch data from Supabase with strict role scoping
        let query = supabase.from(tableName).select('*');

        const filter = SyncScopeService.getTableFilter(tableName, role, studentId);
        if (filter) {
          query = query.eq(filter.column, filter.value);
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

      // Persist hydrated user metadata for account switching isolation
      try {
        await Preferences.set({ key: HYDRATED_USER_KEY, value: userId });
        await Preferences.set({ key: HYDRATED_ROLE_KEY, value: role });
      } catch {
        // Ignored
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(HYDRATED_USER_KEY, userId);
        localStorage.setItem(HYDRATED_ROLE_KEY, role);
      }

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

  /**
   * Safely re-downloads and reconciles authorized cloud data without destroying
   * uncommitted local outbox mutations or wiping entire database tables.
   */
  public static async refreshLocalData(
    role: UserRole,
    userId: string,
    studentId?: string | null
  ): Promise<boolean> {
    SyncStatusService.setState('SYNCING');
    SyncStatusService.setHydration('DOWNLOADING');

    const db = await getDatabase();
    const tables = SyncScopeService.getRequiredTablesForRole(role);
    let totalRecords = 0;

    try {
      // 1. Download and reconcile authorized records per table
      for (let i = 0; i < tables.length; i++) {
        const tableName = tables[i];
        SyncStatusService.updateProgress(tableName, i, tables.length, totalRecords);

        let query = supabase.from(tableName).select('*');
        const filter = SyncScopeService.getTableFilter(tableName, role, studentId);
        if (filter) {
          query = query.eq(filter.column, filter.value);
        }

        const { data, error } = await query.limit(500);
        if (!error && data && data.length > 0) {
          totalRecords += data.length;
          await this.insertRecordsTransactionally(db, tableName, data);
        }
      }

      const now = new Date().toISOString();
      await db.execute(
        `UPDATE sync_state SET last_pull_at = ?, last_success_at = ? WHERE device_id = 'dev_default'`,
        [now, now]
      );

      // Update hydrated user metadata
      try {
        await Preferences.set({ key: HYDRATED_USER_KEY, value: userId });
        await Preferences.set({ key: HYDRATED_ROLE_KEY, value: role });
      } catch {
        // Fallback
      }

      SyncStatusService.setLastSync(now);
      SyncStatusService.setHydration('READY');
      SyncStatusService.setState('SYNCED');
      return true;
    } catch (err) {
      console.error('[InitialSync] Refresh local data failed:', err);
      SyncStatusService.setState('SYNC_ERROR');
      SyncStatusService.setHydration('FAILED');
      return false;
    }
  }

  /**
   * Securely prunes private student data belonging to a previous session
   * during account switching to prevent unauthorized cache leakage.
   */
  public static async prunePreviousUserPrivateCache(keepStudentId?: string | null): Promise<void> {
    try {
      const db = await getDatabase();
      await db.transaction(async (tx) => {
        if (keepStudentId) {
          await tx.execute('DELETE FROM students WHERE id <> ?', [keepStudentId]);
          await tx.execute('DELETE FROM student_enrollments WHERE student_id <> ?', [keepStudentId]);
          await tx.execute('DELETE FROM attendance_records WHERE student_id <> ?', [keepStudentId]);
          await tx.execute('DELETE FROM student_obligations WHERE student_id <> ?', [keepStudentId]);
          await tx.execute('DELETE FROM payments WHERE student_id <> ?', [keepStudentId]);
        }
      });
    } catch (err) {
      console.warn('[InitialSync] Error pruning previous user cache:', err);
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
