import { getDatabase } from '@/database/database';
import { Preferences } from '@capacitor/preferences';
import { SyncStatusService } from './sync-status.service';
import { SyncScopeService, type UserRole } from './sync-scope.service';
import { SchemaMapperService } from './schema-mapper.service';
import { PullSyncService } from './pull-sync.service';
import { EntityCheckpointService } from './entity-checkpoint.service';

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
   * strictly scoped to the user's authorized role and data boundaries using
   * the lossless multi-table pull pagination protocol.
   */
  public static async performInitialHydration(
    role: UserRole,
    userId: string,
    _studentId?: string | null
  ): Promise<boolean> {
    SyncStatusService.setHydration('DOWNLOADING');
    SyncStatusService.setState('SYNCING');

    const tables = SyncScopeService.getRequiredTablesForRole(role);
    const db = await getDatabase();

    try {
      // 1. Reset checkpoints for the scoped tables to ensure clean, full pagination from epoch
      for (const table of tables) {
        await EntityCheckpointService.resetCheckpoint(db, table);
      }

      // 2. Primary Path: Lossless per-entity pagination
      const pullResult = await PullSyncService.pullRemoteChanges({
        entities: tables,
        onProgress: (entity, current, total, recordsPulled) => {
          SyncStatusService.updateProgress(entity, current, total, recordsPulled);
        },
      });

      // 3. Verification transition: ensure all required scoped checkpoints succeeded
      SyncStatusService.setHydration('VERIFYING');
      SyncStatusService.updateProgress('Integrity Verification', tables.length, tables.length, pullResult.appliedCount);

      let allCompleted = pullResult.isComplete;
      for (const table of tables) {
        const cp = await EntityCheckpointService.getCheckpoint(db, table);
        if (cp.last_sync_status !== 'SUCCESS') {
          allCompleted = false;
          console.warn(`[InitialSync] Entity ${table} checkpoint incomplete: ${cp.last_sync_status}`);
        }
      }

      if (!allCompleted) {
        SyncStatusService.setHydration('RESUMABLE');
        SyncStatusService.setState('SYNC_ERROR');
        return false;
      }

      const now = pullResult.serverTime || new Date().toISOString();
      await this.persistHydrationState(db, userId, role, now);

      return true;
    } catch (err: unknown) {
      console.error('[InitialSync] Hydration failed:', err);
      SyncStatusService.setHydration('FAILED');
      SyncStatusService.setState('SYNC_ERROR');
      SyncStatusService.updateProgress('Failed', 0, tables.length, 0, (err as Error).message);
      return false;
    }
  }

  /**
   * Safely re-downloads and reconciles authorized cloud data without destroying
   * uncommitted local outbox mutations or wiping entire database tables.
   * Utilizes lossless multi-table pagination from epoch.
   */
  public static async refreshLocalData(
    role: UserRole,
    userId: string,
    _studentId?: string | null
  ): Promise<boolean> {
    SyncStatusService.setState('SYNCING');
    SyncStatusService.setHydration('DOWNLOADING');

    const db = await getDatabase();
    const tables = SyncScopeService.getRequiredTablesForRole(role);

    try {
      // 1. Reset entity checkpoints to re-pull all authorized records without truncating
      for (const table of tables) {
        await EntityCheckpointService.resetCheckpoint(db, table);
      }

      // 2. Execute lossless pagination
      const pullResult = await PullSyncService.pullRemoteChanges({
        entities: tables,
        onProgress: (entity, current, total, recordsPulled) => {
          SyncStatusService.updateProgress(entity, current, total, recordsPulled);
        },
      });

      if (!pullResult.isComplete) {
        SyncStatusService.setState('SYNC_ERROR');
        SyncStatusService.setHydration('FAILED');
        return false;
      }

      const now = pullResult.serverTime || new Date().toISOString();
      await this.persistHydrationState(db, userId, role, now);
      return true;
    } catch (err) {
      console.error('[InitialSync] Refresh local data failed:', err);
      SyncStatusService.setState('SYNC_ERROR');
      SyncStatusService.setHydration('FAILED');
      return false;
    }
  }

  /**
   * Persists device record, sync_state, capacitor preferences, and UI status
   */
  private static async persistHydrationState(
    db: any,
    userId: string,
    role: UserRole,
    now: string,
    hasSkippedPending: boolean = false
  ): Promise<void> {
    await db.execute(
      `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', ?)`,
      [now]
    );

    if (!hasSkippedPending) {
      await db.execute(
        `INSERT INTO sync_state (device_id, server_cursor, last_pull_at, last_success_at)
         VALUES ('dev_default', '0', ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET last_pull_at = excluded.last_pull_at, last_success_at = excluded.last_success_at`,
        [now, now]
      );
    } else {
      await db.execute(
        `INSERT INTO sync_state (device_id, server_cursor, last_pull_at, last_success_at)
         VALUES ('dev_default', '0', NULL, ?)
         ON CONFLICT(device_id) DO UPDATE SET last_success_at = excluded.last_success_at`,
        [now]
      );
    }

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
  ): Promise<{ applied: number; skippedPending: number }> {
    if (!records || records.length === 0) return { applied: 0, skippedPending: 0 };

    return await db.transaction(async (tx: any) => {
      return await SchemaMapperService.upsertBatchSafe(tx, tableName, records);
    });
  }
}
