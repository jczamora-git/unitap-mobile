import { SyncStatusService } from '@/services/sync/sync-status.service';
import { SyncManager } from '@/services/sync/sync-manager';

export function useSyncStatus() {
  return {
    state: SyncStatusService.state,
    hydration: SyncStatusService.hydration,
    pendingCount: SyncStatusService.pendingCount,
    lastSync: SyncStatusService.lastSync,
    progress: SyncStatusService.currentProgress,
    syncNow: SyncManager.syncNow.bind(SyncManager),
  };
}

