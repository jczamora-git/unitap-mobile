import { ref, computed } from 'vue';
import { SyncPreferenceService, type SyncMode } from '@/services/sync/sync-preference.service';
import { SyncStatusService, type UserFacingSyncStatus } from '@/services/sync/sync-status.service';
import { SyncManager } from '@/services/sync/sync-manager';
import { InitialSyncService } from '@/services/sync/initial-sync.service';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import type { UserRole } from '@/services/sync/sync-scope.service';

export function useSyncPreferences() {
  const isSyncing = ref(false);
  const isRefreshing = ref(false);
  const syncError = ref<string | null>(null);

  const syncMode = computed(() => SyncPreferenceService.mode.value);
  const syncStatus = computed<UserFacingSyncStatus>(() => SyncStatusService.userFacingStatus.value);
  const formattedLastSync = computed(() => SyncStatusService.formattedLastSync.value);
  const pendingCount = computed(() => SyncStatusService.pendingCount.value);

  async function setSyncMode(mode: SyncMode) {
    await SyncPreferenceService.setMode(mode);
    SyncManager.restartPeriodicTimer();
  }

  async function triggerSyncNow() {
    isSyncing.value = true;
    syncError.value = null;
    try {
      const result = await SyncManager.syncNow();
      if (result.errorCount > 0) {
        syncError.value = 'Some records could not be synchronized.';
      }
      return result;
    } catch (err: unknown) {
      syncError.value = (err as Error).message || 'Sync failed.';
      throw err;
    } finally {
      isSyncing.value = false;
    }
  }

  async function triggerRefreshLocalData(): Promise<boolean> {
    isRefreshing.value = true;
    syncError.value = null;

    try {
      const role = (SupabaseAuthService.role.value || authService.role.value || 'STUDENT') as UserRole;
      const userId = SupabaseAuthService.user.value?.id || authService.user.value?.id || 'dev_user';
      const studentId = SupabaseAuthService.user.value?.student_id || authService.user.value?.student_id;

      const success = await InitialSyncService.refreshLocalData(role, userId, studentId);
      if (!success) {
        syncError.value = 'Failed to refresh local records from server.';
      }
      return success;
    } catch (err: unknown) {
      syncError.value = (err as Error).message || 'Failed to refresh local data.';
      return false;
    } finally {
      isRefreshing.value = false;
    }
  }

  return {
    syncMode,
    syncStatus,
    formattedLastSync,
    pendingCount,
    isSyncing,
    isRefreshing,
    syncError,
    setSyncMode,
    triggerSyncNow,
    triggerRefreshLocalData,
  };
}

