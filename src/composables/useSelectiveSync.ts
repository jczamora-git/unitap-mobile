import { computed } from 'vue';
import {
  SelectiveSyncService,
  type SyncDomain,
  type SelectiveRefreshResult,
  type EntityRefreshStatus,
} from '@/services/sync/selective-sync.service';
import { OperationPolicyService } from '@/services/operation-policy.service';

/**
 * UniTap 2.0 Composable for Smart Selective Offline Hybrid Sync (Phase 3)
 *
 * Provides reactive bindings for views to observe fine-grained entity freshness,
 * trigger selective domain refreshes, and gracefully display cached data offline.
 */
export function useSelectiveSync() {
  const isOnline = OperationPolicyService.isOnline;

  function isDomainRefreshing(domain: SyncDomain) {
    return SelectiveSyncService.isDomainRefreshing(domain);
  }

  function getDomainLastRefreshed(domain: SyncDomain) {
    return SelectiveSyncService.getDomainLastRefreshed(domain);
  }

  function getDomainStatus(domain: SyncDomain) {
    return computed<EntityRefreshStatus>(() => {
      if (!isOnline.value) return 'OFFLINE';
      if (SelectiveSyncService.isDomainRefreshing(domain).value) return 'REFRESHING';
      const last = SelectiveSyncService.getDomainLastRefreshed(domain).value;
      if (last) return 'UP_TO_DATE';
      return 'IDLE';
    });
  }

  async function refreshDomain(domain: SyncDomain, force = false): Promise<SelectiveRefreshResult> {
    return SelectiveSyncService.refreshDomain(domain, { force });
  }

  async function refreshStudents(force = false): Promise<SelectiveRefreshResult> {
    return SelectiveSyncService.refreshStudents(force);
  }

  async function refreshEvents(force = false): Promise<SelectiveRefreshResult> {
    return SelectiveSyncService.refreshEvents(force);
  }

  async function refreshAcademic(force = false): Promise<SelectiveRefreshResult> {
    return SelectiveSyncService.refreshAcademic(force);
  }

  async function refreshFinanceReference(force = false): Promise<SelectiveRefreshResult> {
    return SelectiveSyncService.refreshFinanceReference(force);
  }

  async function refreshAttendance(force = false): Promise<SelectiveRefreshResult> {
    return SelectiveSyncService.refreshAttendance(force);
  }

  return {
    isOnline,
    isDomainRefreshing,
    getDomainLastRefreshed,
    getDomainStatus,
    refreshDomain,
    refreshStudents,
    refreshEvents,
    refreshAcademic,
    refreshFinanceReference,
    refreshAttendance,
  };
}

