import { PushSyncService } from './push-sync.service';
import { PullSyncService } from './pull-sync.service';
import { RealtimeSyncService } from './realtime-sync.service';
import { SyncStatusService } from './sync-status.service';
import { SyncPreferenceService } from './sync-preference.service';

export class SyncManager {
  private static syncInterval: any = null;
  private static isRunning = false;
  private static debounceTimer: any = null;
  private static onlineListener: (() => void) | null = null;
  private static offlineListener: (() => void) | null = null;

  public static async start(userId: string = 'default'): Promise<void> {
    await SyncPreferenceService.init(userId);

    // Register network online / offline listeners
    if (typeof window !== 'undefined' && !this.onlineListener) {
      this.onlineListener = () => {
        console.log('[SyncManager] Network online detected.');
        SyncStatusService.setState('ONLINE');
        if (SyncPreferenceService.isAutomatic()) {
          this.syncNow();
        }
      };
      this.offlineListener = () => {
        console.log('[SyncManager] Network offline detected.');
        SyncStatusService.setState('OFFLINE');
      };
      window.addEventListener('online', this.onlineListener);
      window.addEventListener('offline', this.offlineListener);
    }

    // Start Realtime listener
    RealtimeSyncService.subscribe();

    // Initial sync run if Automatic
    if (SyncPreferenceService.isAutomatic()) {
      this.syncNow();
      this.restartPeriodicTimer();
    }
  }

  public static restartPeriodicTimer(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (SyncPreferenceService.isAutomatic()) {
      // 60-second background reconciliation
      this.syncInterval = setInterval(() => {
        this.syncNow();
      }, 60000);
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

    if (typeof window !== 'undefined') {
      if (this.onlineListener) {
        window.removeEventListener('online', this.onlineListener);
        this.onlineListener = null;
      }
      if (this.offlineListener) {
        window.removeEventListener('offline', this.offlineListener);
        this.offlineListener = null;
      }
    }

    RealtimeSyncService.unsubscribe();
  }

  /**
   * Debounced sync trigger invoked by Realtime notifications
   */
  public static triggerRealtimeSync(delayMs: number = 3000): void {
    if (!SyncPreferenceService.isAutomatic()) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.syncNow();
    }, delayMs);
  }

  /**
   * Primary synchronization action (used by both automatic triggers and Manual "Sync Now" button)
   */
  public static async syncNow(): Promise<{ pushedCount: number; errorCount: number; pulledCount: number }> {
    if (this.isRunning) {
      return { pushedCount: 0, errorCount: 0, pulledCount: 0 };
    }

    // Check offline status
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      SyncStatusService.setState('OFFLINE');
      return { pushedCount: 0, errorCount: 0, pulledCount: 0 };
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

      if (errorCount === 0) {
        SyncStatusService.setState('SYNCED');
      } else {
        SyncStatusService.setState('SYNC_ERROR');
      }
    } catch (err) {
      console.warn('[SyncManager] Sync cycle encountered an error:', err);
      SyncStatusService.setState('SYNC_ERROR');
      errorCount++;
    } finally {
      this.isRunning = false;
    }

    return { pushedCount, errorCount, pulledCount };
  }
}
