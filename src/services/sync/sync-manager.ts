import { PushSyncService } from './push-sync.service';
import { PullSyncService } from './pull-sync.service';
import { RealtimeSyncService } from './realtime-sync.service';
import { SyncStatusService } from './sync-status.service';
import { SyncPreferenceService } from './sync-preference.service';
import { NetworkService } from '../network.service';
import { DataModeService } from '../data-mode.service';
import { getDatabase } from '@/database/database';
import { supabase } from '@/integrations/supabase/client';

function isTestEnvironment(): boolean {
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
  return proc?.env?.VITEST === 'true' || proc?.env?.NODE_ENV === 'test' || import.meta.env?.MODE === 'test';
}

export class SyncManager {
  private static syncInterval: any = null;
  private static isRunning = false;
  private static hasQueuedRun = false;
  private static debounceTimer: any = null;
  private static retryTimer: any = null;
  private static retryAttempt = 0;
  private static unsubNetwork: (() => void) | null = null;
  private static unsubResume: (() => void) | null = null;

  public static async start(userId: string = 'default'): Promise<void> {
    if (DataModeService.isDirectSupabase()) {
      console.log('[SyncManager] Direct Supabase Mode active: background SQLite sync loops suspended.');
      SyncStatusService.setState('DIRECT_MODE');
      return;
    }

    await SyncPreferenceService.init(userId);
    await NetworkService.init();

    // Check existing outbox & conflict state immediately from SQLite
    await this.refreshCountsFromDatabase();

    // 1. Network status change listener (Reconnection trigger)
    if (!this.unsubNetwork) {
      this.unsubNetwork = NetworkService.onStatusChange((isOnline) => {
        SyncStatusService.setOnline(isOnline);
        if (isOnline) {
          console.log('[SyncManager] Network reconnected; checking server reachability and syncing.');
          this.retryAttempt = 0;
          if (SyncPreferenceService.isAutomatic()) {
            this.triggerDebouncedSync(1200);
          }
        } else {
          console.log('[SyncManager] Network disconnected; offline mode active.');
          SyncStatusService.setState('OFFLINE_READY');
        }
      });
    }

    // 2. App resume listener (Resume trigger)
    if (!this.unsubResume) {
      this.unsubResume = NetworkService.onAppResume(() => {
        console.log('[SyncManager] App resumed to foreground.');
        if (NetworkService.isOnline.value && SyncPreferenceService.isAutomatic()) {
          this.triggerDebouncedSync(1000);
        }
      });
    }

    // 3. Realtime Supabase notifications subscription
    try {
      RealtimeSyncService.subscribe();
    } catch {
      // Non-fatal if offline
    }

    // 4. Initial sync run if Automatic & Online
    if (SyncPreferenceService.isAutomatic()) {
      if (NetworkService.isOnline.value) {
        this.triggerDebouncedSync(800);
      } else {
        SyncStatusService.setState('OFFLINE_READY');
      }
      this.restartPeriodicTimer();
    }
  }

  /**
   * Refreshes pending outbox and conflict counts directly from SQLite.
   */
  public static async refreshCountsFromDatabase(): Promise<void> {
    try {
      const db = await getDatabase();
      const outboxRow = await db.queryOne<{ count: number }>(
        'SELECT count(*) as count FROM sync_outbox WHERE synced_at IS NULL'
      );
      const failedRow = await db.queryOne<{ count: number }>(
        'SELECT count(*) as count FROM sync_outbox WHERE (last_error IS NOT NULL OR retry_count > 0) AND synced_at IS NULL'
      );
      const conflictRow = await db.queryOne<{ count: number }>(
        "SELECT count(*) as count FROM sync_conflicts WHERE status = 'OPEN'"
      );
      const confirmedRow = await db.queryOne<{ count: number }>(
        "SELECT count(*) as count FROM sync_audit_logs WHERE direction = 'PUSH' AND status = 'SUCCESS'"
      );
      const checkpointRow = await db.queryOne<{ count: number }>(
        "SELECT count(*) as count FROM entity_sync_checkpoints WHERE last_sync_status != 'SUCCESS' OR records_pulled = 0"
      );

      SyncStatusService.setPendingCount(outboxRow?.count || 0);
      SyncStatusService.setFailedOpsCount(failedRow?.count || 0);
      SyncStatusService.setConflictCount(conflictRow?.count || 0);
      SyncStatusService.setConfirmedUploadsCount(confirmedRow?.count || 0);
      SyncStatusService.setPendingPullCount(checkpointRow?.count || 0);

      // Total local domain records (indexed fast query)
      try {
        const localCounts = await db.queryOne<{ total: number }>(`
          SELECT (
            (SELECT COUNT(*) FROM students) +
            (SELECT COUNT(*) FROM student_enrollments) +
            (SELECT COUNT(*) FROM attendance_records) +
            (SELECT COUNT(*) FROM student_obligations) +
            (SELECT COUNT(*) FROM obligation_rules) +
            (SELECT COUNT(*) FROM payments) +
            (SELECT COUNT(*) FROM payment_allocations) +
            (SELECT COUNT(*) FROM events) +
            (SELECT COUNT(*) FROM event_occurrences) +
            (SELECT COUNT(*) FROM nfc_cards) +
            (SELECT COUNT(*) FROM academic_years) +
            (SELECT COUNT(*) FROM semesters)
          ) as total
        `);
        SyncStatusService.setTotalLocalRecordsCount(localCounts?.total ?? 0);
      } catch {
        SyncStatusService.setTotalLocalRecordsCount(null);
      }

      // Hydrate last successful sync timestamp and readiness state from SQLite
      const stateRow = await db.queryOne<{ last_success_at: string | null }>(
        'SELECT last_success_at FROM sync_state WHERE last_success_at IS NOT NULL ORDER BY last_success_at DESC LIMIT 1'
      );
      if (stateRow?.last_success_at) {
        SyncStatusService.setLastSync(stateRow.last_success_at);
        if (SyncStatusService.hydration.value === 'NOT_INITIALIZED') {
          SyncStatusService.setHydration('READY');
        }
      }
    } catch (err) {
      console.warn('[SyncManager] Could not refresh counts from SQLite:', err);
    }
  }

  /**
   * Five-minute foreground periodic timer with jitter (300s + 0-15s jitter)
   */
  public static restartPeriodicTimer(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (SyncPreferenceService.isAutomatic()) {
      // 5 minutes (300,000 ms) plus jitter
      const jitterMs = Math.floor(Math.random() * 15000);
      const intervalMs = 300000 + jitterMs;

      this.syncInterval = setInterval(() => {
        if (NetworkService.isOnline.value && NetworkService.isAppActive.value) {
          this.syncNow();
        }
      }, intervalMs);
    }
  }

  public static stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (this.unsubNetwork) {
      this.unsubNetwork();
      this.unsubNetwork = null;
    }

    if (this.unsubResume) {
      this.unsubResume();
      this.unsubResume = null;
    }

    try {
      RealtimeSyncService.unsubscribe();
    } catch {
      // Ignored
    }
  }

  /**
   * Debounced sync trigger invoked by local outbox writes or Realtime events.
   * Duplicate calls within delayMs are coalesced into a single execution.
   */
  public static triggerDebouncedSync(delayMs: number = 1000): void {
    if (DataModeService.isDirectSupabase()) {
      return;
    }

    if (!SyncPreferenceService.isAutomatic()) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.syncNow();
    }, delayMs);
  }

  /**
   * Debounced sync trigger invoked by Realtime notifications
   */
  public static triggerRealtimeSync(delayMs: number = 3000): void {
    this.triggerDebouncedSync(delayMs);
  }

  /**
   * Single-flight worker with duplicate-trigger coalescing and exponential backoff retry.
   */
  public static async syncNow(): Promise<{ pushedCount: number; errorCount: number; pulledCount: number }> {
    if (DataModeService.isDirectSupabase()) {
      console.log('[SyncManager] Direct Supabase Mode active: syncNow bypassed.');
      SyncStatusService.setState('DIRECT_MODE');
      return { pushedCount: 0, errorCount: 0, pulledCount: 0 };
    }

    // Single-flight lock: if already running, queue exactly one subsequent run
    if (this.isRunning) {
      this.hasQueuedRun = true;
      return { pushedCount: 0, errorCount: 0, pulledCount: 0 };
    }

    const nowIso = new Date().toISOString();
    SyncStatusService.setLastAttempt(nowIso);

    // Fast connectivity check
    if (!NetworkService.isOnline.value) {
      await this.refreshCountsFromDatabase();
      SyncStatusService.setOnline(false);
      SyncStatusService.setState('OFFLINE_READY');
      return { pushedCount: 0, errorCount: 0, pulledCount: 0 };
    }

    // Verify authenticated Supabase session before sending cloud requests
    const isTest = isTestEnvironment();
    if (!isTest) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session) {
          await this.refreshCountsFromDatabase();
          if (NetworkService.isOnline.value) {
            SyncStatusService.setState('AUTH_REQUIRED');
          } else {
            SyncStatusService.setState('OFFLINE_READY');
          }
          return { pushedCount: 0, errorCount: 0, pulledCount: 0 };
        }
      } catch {
        await this.refreshCountsFromDatabase();
        if (NetworkService.isOnline.value) {
          SyncStatusService.setState('AUTH_REQUIRED');
        } else {
          SyncStatusService.setState('OFFLINE_READY');
        }
        return { pushedCount: 0, errorCount: 0, pulledCount: 0 };
      }
    }

    this.isRunning = true;
    SyncStatusService.setState('SYNCING');

    let pushedCount = 0;
    let errorCount = 0;
    let pulledCount = 0;

    try {
      // 1. Push uncommitted local operations from sync_outbox
      const pushRes = await PushSyncService.pushPendingOperations();
      pushedCount = pushRes.confirmedCount;
      errorCount = pushRes.failedCount + pushRes.blockedCount;

      // 2. Pull latest server deltas
      SyncStatusService.updatePullProgress({
        isActive: true,
        currentEntity: 'Starting...',
        entitiesCompleted: 0,
        totalEntities: 18,
        recordsPulled: 0,
        percent: 0,
      });

      const pullRes = await PullSyncService.pullRemoteChanges({
        onProgress: (entity, current, total, pulled) => {
          SyncStatusService.updatePullProgress({
            isActive: true,
            currentEntity: entity,
            entitiesCompleted: current,
            totalEntities: total,
            recordsPulled: pulled,
            percent: total > 0 ? Math.round((current / total) * 100) : 0,
          });
        },
      });
      pulledCount = pullRes.appliedCount;
      SyncStatusService.updatePullProgress({ isActive: false });

      // 3. Refresh SQLite counts
      await this.refreshCountsFromDatabase();

      // 4. Construct authoritative Sync Summary Report
      const isPushNothing = pushRes.attemptedCount === 0 && pushRes.blockedCount === 0 && pushRes.failedCount === 0;
      const isCleanSuccess = pushRes.failedCount === 0 && pushRes.blockedCount === 0 && pullRes.isComplete;
      const summaryStatus = isCleanSuccess
        ? (isPushNothing && pullRes.appliedCount === 0 ? 'NOTHING_TO_SYNC' : 'SUCCESS')
        : (pushedCount > 0 || pulledCount > 0 ? 'PARTIAL' : 'FAILED');

      SyncStatusService.setSyncSummary({
        timestamp: new Date().toISOString(),
        totalAttempted: pushRes.attemptedCount,
        confirmed: pushRes.confirmedCount,
        failed: pushRes.failedCount,
        stillPending: SyncStatusService.pendingCount.value,
        conflicts: pushRes.conflictCount,
        blocked: pushRes.blockedCount,
        pulledCount: pullRes.appliedCount,
        status: summaryStatus,
      });

      if (errorCount === 0) {
        this.retryAttempt = 0;
        SyncStatusService.setLastSync(new Date().toISOString());
        SyncStatusService.setLastError(null);
        SyncStatusService.setState('UP_TO_DATE');
      } else {
        SyncStatusService.setState('SYNC_ERROR');
        this.scheduleExponentialBackoff();
      }
    } catch (err: unknown) {
      const errMsg = (err as Error).message || 'Sync cycle failed';
      console.warn('[SyncManager] Sync cycle error:', errMsg);
      SyncStatusService.setLastError(errMsg);
      SyncStatusService.setState('SYNC_ERROR');
      errorCount++;
      SyncStatusService.updatePullProgress({ isActive: false });
      await this.refreshCountsFromDatabase();
      this.scheduleExponentialBackoff();
    } finally {
      this.isRunning = false;

      // Execute queued run if another trigger arrived while syncing
      if (this.hasQueuedRun) {
        this.hasQueuedRun = false;
        if (NetworkService.isOnline.value) {
          setTimeout(() => this.syncNow(), 250);
        }
      }
    }

    return { pushedCount, errorCount, pulledCount };
  }

  /**
   * Schedules an exponential backoff retry for transient network/server failures
   * Base: 5s, 10s, 20s, up to max 60s with jitter.
   */
  private static scheduleExponentialBackoff(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (!NetworkService.isOnline.value || !SyncPreferenceService.isAutomatic()) {
      return;
    }

    this.retryAttempt = Math.min(this.retryAttempt + 1, 5);
    const baseDelayMs = Math.min(5000 * Math.pow(2, this.retryAttempt - 1), 60000);
    const jitterMs = Math.floor(Math.random() * 2000);
    const delayMs = baseDelayMs + jitterMs;

    console.log(`[SyncManager] Scheduling retry in ${Math.round(delayMs / 1000)}s (attempt ${this.retryAttempt})`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (NetworkService.isOnline.value) {
        this.syncNow();
      }
    }, delayMs);
  }
}
