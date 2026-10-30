import { PushSyncService } from './push-sync.service';
import { PullSyncService } from './pull-sync.service';
import { RealtimeSyncService } from './realtime-sync.service';
import { SyncStatusService } from './sync-status.service';

export class SyncManager {
  private static syncInterval: any = null;
  private static isRunning = false;

  public static start(): void {
    if (this.syncInterval) return;

    // Start Realtime listener
    RealtimeSyncService.subscribe();

    // Initial sync run
    this.syncNow();

    // Background periodic reconciliation
    this.syncInterval = setInterval(() => {
      this.syncNow();
    }, 60000); // Every 60s
  }

  public static stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    RealtimeSyncService.unsubscribe();
  }

  public static async syncNow(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // 1. Push uncommitted local operations
      await PushSyncService.pushPendingOperations();

      // 2. Pull latest server deltas
      await PullSyncService.pullRemoteChanges();
    } catch (err) {
      console.warn('[SyncManager] Sync cycle encountered an error:', err);
      SyncStatusService.setState('SYNC_ERROR');
    } finally {
      this.isRunning = false;
    }
  }
}
