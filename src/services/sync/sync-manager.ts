import { PushSyncService } from './push-sync.service';
import { PullSyncService } from './pull-sync.service';
import { RealtimeSyncService } from './realtime-sync.service';
import { SyncStatusService } from './sync-status.service';
import { SyncPreferenceService } from './sync-preference.service';
import { NetworkService } from '../network.service';
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
        'SELECT count(*) as count FROM sync_outbox'
      );
      const conflictRow = await db.queryOne<{ count: number }>(
        "SELECT count(*) as count FROM sync_conflicts WHERE status = 'OPEN'"
      );
      SyncStatusService.setPendingCount(outboxRow?.count || 0);
      SyncStatusService.setConflictCount(conflictRow?.count || 0);
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
          SyncStatusService.setState('OFFLINE_READY');
          return { pushedCount: 0, errorCount: 0, pulledCount: 0 };
        }
      } catch {
        SyncStatusService.setState('OFFLINE_READY');
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
      pushedCount = pushRes.pushedCount;
      errorCount = pushRes.errorCount;

      // 2. Pull latest server deltas
      const pullRes = await PullSyncService.pullRemoteChanges();
      pulledCount = pullRes.appliedCount;

      // 3. Refresh SQLite counts
      await this.refreshCountsFromDatabase();

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
