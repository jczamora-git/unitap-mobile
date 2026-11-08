import { ref, computed } from 'vue';
import { SyncPreferenceService, type SyncMode } from '@/services/sync/sync-preference.service';
import { SyncStatusService, type UserFacingSyncStatus } from '@/services/sync/sync-status.service';
import { SyncManager } from '@/services/sync/sync-manager';
import { InitialSyncService } from '@/services/sync/initial-sync.service';
import { PushSyncService } from '@/services/sync/push-sync.service';
import { PullSyncService } from '@/services/sync/pull-sync.service';
import { PullReconciliationService, type PullPreviewPlan } from '@/services/sync/pull-reconciliation.service';
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
  const lastError = computed(() => SyncStatusService.lastError.value);

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

  const isPreviewOpen = ref(false);
  const isPreviewLoading = ref(false);
  const previewPlan = ref<PullPreviewPlan | null>(null);

  async function openPullPreview(): Promise<PullPreviewPlan | null> {
    isPreviewOpen.value = true;
    isPreviewLoading.value = true;
    syncError.value = null;

    try {
      const plan = await PullSyncService.fetchPullPreview('students');
      previewPlan.value = plan;
      return plan;
    } catch (err: unknown) {
      syncError.value = (err as Error).message || 'Failed to fetch pull preview.';
      return null;
    } finally {
      isPreviewLoading.value = false;
    }
  }

  function closePullPreview() {
    isPreviewOpen.value = false;
    previewPlan.value = null;
  }

  async function applyPullPreview(plan: PullPreviewPlan): Promise<boolean> {
    isRefreshing.value = true;
    syncError.value = null;

    try {
      const res = await PullReconciliationService.applyApprovedPlan(plan);
      if (!res.success) {
        syncError.value = res.error || 'Failed to apply approved sync operations.';
        return false;
      }

      closePullPreview();
      // Follow with role-based hydration for remaining entities
      const role = (SupabaseAuthService.role.value || authService.role.value || 'STUDENT') as UserRole;
      const userId = SupabaseAuthService.user.value?.id || authService.user.value?.id || 'dev_user';
      const studentId = SupabaseAuthService.user.value?.student_id || authService.user.value?.student_id;
      await InitialSyncService.refreshLocalData(role, userId, studentId);
      return true;
    } catch (err: unknown) {
      syncError.value = (err as Error).message || 'Failed to apply pull preview.';
      return false;
    } finally {
      isRefreshing.value = false;
    }
  }

  const pushProgress = computed(() => SyncStatusService.pushProgress.value);
  const pullProgress = computed(() => SyncStatusService.pullProgress.value);
  const syncSummary = computed(() => SyncStatusService.syncSummary.value);
  const confirmedUploadsCount = computed(() => SyncStatusService.confirmedUploadsCount.value);
  const failedOpsCount = computed(() => SyncStatusService.failedOpsCount.value);
  const blockedOpsCount = computed(() => SyncStatusService.blockedOpsCount.value);
  const pendingPullCount = computed(() => SyncStatusService.pendingPullCount.value);
  const totalLocalRecords = computed(() => SyncStatusService.totalLocalRecordsCount.value);

  function dismissSummary() {
    SyncStatusService.setSyncSummary(null);
  }

  return {
    syncMode,
    syncStatus,
    formattedLastSync,
    pendingCount,
    lastError,
    isSyncing,
    isRefreshing,
    syncError,
    pushProgress,
    pullProgress,
    syncSummary,
    confirmedUploadsCount,
    failedOpsCount,
    blockedOpsCount,
    pendingPullCount,
    totalLocalRecords,
    dismissSummary,
    isPreviewOpen,
    isPreviewLoading,
    previewPlan,
    openPullPreview,
    closePullPreview,
    applyPullPreview,
    setSyncMode,
    triggerSyncNow,
    triggerRefreshLocalData,
    getPendingOutbox: PushSyncService.getPendingOutbox.bind(PushSyncService),
    clearPendingOutbox: PushSyncService.clearPendingOutbox.bind(PushSyncService),
    deletePendingItem: PushSyncService.deletePendingItem.bind(PushSyncService),
  };
}

