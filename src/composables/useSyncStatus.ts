import { SyncStatusService } from '@/services/sync/sync-status.service';
import { SyncManager } from '@/services/sync/sync-manager';
import { PushSyncService } from '@/services/sync/push-sync.service';

export function useSyncStatus() {
  return {
    state: SyncStatusService.state,
    hydration: SyncStatusService.hydration,
    pendingCount: SyncStatusService.pendingCount,
    lastSync: SyncStatusService.lastSync,
    lastError: SyncStatusService.lastError,
    progress: SyncStatusService.currentProgress,
    syncNow: SyncManager.syncNow.bind(SyncManager),
    getPendingOutbox: PushSyncService.getPendingOutbox.bind(PushSyncService),
    clearPendingOutbox: PushSyncService.clearPendingOutbox.bind(PushSyncService),
    deletePendingItem: PushSyncService.deletePendingItem.bind(PushSyncService),
  };
}

