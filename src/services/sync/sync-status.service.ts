import { ref, computed } from 'vue';
import { DataModeService } from '../data-mode.service';

export type CanonicalSyncState =
  | 'NOT_INITIALIZED'
  | 'FIRST_SYNC_REQUIRED'
  | 'OFFLINE_READY'
  | 'SYNCING'
  | 'UP_TO_DATE'
  | 'PENDING_UPLOAD'
  | 'SYNC_ERROR'
  | 'CONFLICT_REVIEW_REQUIRED'
  | 'AUTH_REQUIRED'
  | 'DIRECT_MODE';

// Maintain backward compatibility with existing code
export type SyncState =
  | CanonicalSyncState
  | 'OFFLINE'
  | 'ONLINE'
  | 'SYNCED'
  | 'PENDING_CHANGES'
  | 'CONFLICT'
  | 'AUTH_REQUIRED'
  | 'DIRECT_MODE';

export type HydrationState =
  | 'NOT_INITIALIZED'
  | 'DOWNLOADING'
  | 'VERIFYING'
  | 'READY'
  | 'FAILED'
  | 'RESUMABLE';

export type UserFacingSyncStatus =
  | 'Up to Date'
  | 'Syncing'
  | 'Updating'
  | 'Offline Mode'
  | 'Offline'
  | 'Pending Uploads'
  | 'Waiting to Sync'
  | 'Needs Attention'
  | 'Sync Error'
  | 'Update Failed'
  | 'First Sync Required'
  | 'Sign-in Required'
  | 'Direct Supabase Mode';

export interface SyncProgress {
  currentTable: string;
  tablesCompleted: number;
  totalTables: number;
  recordsReceived: number;
  percent: number;
  error?: string;
}

export interface PushSyncProgress {
  isActive: boolean;
  totalEligible: number;
  attempted: number;
  confirmed: number;
  failed: number;
  blocked: number;
  conflicts: number;
  remaining: number;
  currentEntity: string;
  currentBatch: number;
  totalBatches: number;
  lastAck: string | null;
  percent: number;
}

export interface PullSyncProgress {
  isActive: boolean;
  currentEntity: string;
  entitiesCompleted: number;
  totalEntities: number;
  recordsPulled: number;
  percent: number;
}

export interface SyncSummaryReport {
  timestamp: string;
  totalAttempted: number;
  confirmed: number;
  failed: number;
  stillPending: number;
  conflicts: number;
  blocked: number;
  pulledCount: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'NOTHING_TO_SYNC';
}

export class SyncStatusService {
  private static currentState = ref<CanonicalSyncState>('NOT_INITIALIZED');
  private static currentHydration = ref<HydrationState>('NOT_INITIALIZED');
  private static isSyncingActive = ref<boolean>(false);
  private static onlineStatus = ref<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  private static serverReachable = ref<boolean>(true);
  private static pendingOutboxCount = ref<number>(0);
  private static confirmedUploads = ref<number>(0);
  private static failedOperations = ref<number>(0);
  private static blockedOperations = ref<number>(0);
  private static pendingPullEntities = ref<number>(0);
  private static totalLocalRecords = ref<number | null>(null);
  private static unresolvedConflictCount = ref<number>(0);
  private static lastSyncTimestamp = ref<string | null>(null);
  private static lastAttemptTimestamp = ref<string | null>(null);
  private static lastErrorMessage = ref<string | null>(null);
  private static progress = ref<SyncProgress>({
    currentTable: '',
    tablesCompleted: 0,
    totalTables: 0,
    recordsReceived: 0,
    percent: 0,
  });

  private static currentPushProgress = ref<PushSyncProgress>({
    isActive: false,
    totalEligible: 0,
    attempted: 0,
    confirmed: 0,
    failed: 0,
    blocked: 0,
    conflicts: 0,
    remaining: 0,
    currentEntity: '',
    currentBatch: 0,
    totalBatches: 0,
    lastAck: null,
    percent: 0,
  });

  private static currentPullProgress = ref<PullSyncProgress>({
    isActive: false,
    currentEntity: '',
    entitiesCompleted: 0,
    totalEntities: 0,
    recordsPulled: 0,
    percent: 0,
  });

  private static lastSummaryReport = ref<SyncSummaryReport | null>(null);

  public static get state() {
    return computed(() => this.currentState.value);
  }

  public static get canonicalState() {
    return computed<CanonicalSyncState>(() => {
      if (DataModeService.isDirectSupabase()) {
        return 'DIRECT_MODE';
      }
      return this.currentState.value;
    });
  }

  public static get hydration() {
    return computed(() => this.currentHydration.value);
  }

  public static get isOnline() {
    return computed(() => this.onlineStatus.value);
  }

  public static get isServerReachable() {
    return computed(() => this.serverReachable.value);
  }

  public static get pendingCount() {
    return computed(() => this.pendingOutboxCount.value);
  }

  public static get conflictCount() {
    return computed(() => this.unresolvedConflictCount.value);
  }

  public static get lastSync() {
    return computed(() => this.lastSyncTimestamp.value);
  }

  public static get lastAttempt() {
    return computed(() => this.lastAttemptTimestamp.value);
  }

  public static get currentProgress() {
    return computed(() => this.progress.value);
  }

  public static get pushProgress() {
    return computed(() => this.currentPushProgress.value);
  }

  public static get pullProgress() {
    return computed(() => this.currentPullProgress.value);
  }

  public static get syncSummary() {
    return computed(() => this.lastSummaryReport.value);
  }

  public static get confirmedUploadsCount() {
    return computed(() => this.confirmedUploads.value);
  }

  public static get failedOpsCount() {
    return computed(() => this.failedOperations.value);
  }

  public static get blockedOpsCount() {
    return computed(() => this.blockedOperations.value);
  }

  public static get pendingPullCount() {
    return computed(() => this.pendingPullEntities.value);
  }

  public static get totalLocalRecordsCount() {
    return computed(() => this.totalLocalRecords.value);
  }

  public static get lastError() {
    return computed(() => this.lastErrorMessage.value);
  }

  public static setOnline(isOnline: boolean): void {
    this.onlineStatus.value = isOnline;
    this.recomputeState();
  }

  public static setServerReachable(isReachable: boolean): void {
    this.serverReachable.value = isReachable;
    this.recomputeState();
  }

  public static setLastError(error: string | null): void {
    this.lastErrorMessage.value = error;
    if (this.currentState.value === 'AUTH_REQUIRED') {
      return;
    }
    if (error) {
      this.currentState.value = 'SYNC_ERROR';
    } else {
      this.recomputeState();
    }
  }

  public static setConflictCount(count: number): void {
    this.unresolvedConflictCount.value = count;
    this.recomputeState();
  }

  public static setPendingCount(count: number): void {
    this.pendingOutboxCount.value = count;
    this.recomputeState();
  }

  public static setLastAttempt(timestamp: string): void {
    this.lastAttemptTimestamp.value = timestamp;
  }

  public static setLastSync(timestamp: string): void {
    this.lastSyncTimestamp.value = timestamp;
  }

  public static setSyncing(active: boolean): void {
    this.isSyncingActive.value = active;
    if (active) {
      this.currentState.value = 'SYNCING';
    } else {
      this.recomputeState();
    }
  }

  public static setHydration(newState: HydrationState): void {
    this.currentHydration.value = newState;
    if (newState === 'NOT_INITIALIZED') {
      this.lastErrorMessage.value = null;
      this.currentState.value = 'NOT_INITIALIZED';
      return;
    }
    if (newState === 'READY') {
      this.lastErrorMessage.value = null;
      if (this.currentState.value === 'NOT_INITIALIZED' || this.currentState.value === 'FIRST_SYNC_REQUIRED') {
        this.currentState.value = 'UP_TO_DATE';
      }
    }
    this.recomputeState();
  }

  /**
   * Sets the synchronization state. Normalizes legacy state tokens to canonical states.
   */
  public static setState(newState: SyncState): void {
    switch (newState) {
      case 'SYNCING':
        this.isSyncingActive.value = true;
        this.currentState.value = 'SYNCING';
        return;
      case 'OFFLINE':
        this.isSyncingActive.value = false;
        this.onlineStatus.value = false;
        break;
      case 'ONLINE':
        this.onlineStatus.value = true;
        break;
      case 'SYNCED':
      case 'UP_TO_DATE':
        this.isSyncingActive.value = false;
        this.lastErrorMessage.value = null;
        this.unresolvedConflictCount.value = 0;
        this.currentHydration.value = 'READY';
        this.currentState.value = 'UP_TO_DATE';
        break;
      case 'SYNC_ERROR':
        this.isSyncingActive.value = false;
        this.currentState.value = 'SYNC_ERROR';
        return;
      case 'CONFLICT':
        this.unresolvedConflictCount.value = Math.max(this.unresolvedConflictCount.value, 1);
        break;
      case 'PENDING_CHANGES':
        this.pendingOutboxCount.value = Math.max(this.pendingOutboxCount.value, 1);
        break;
      case 'AUTH_REQUIRED':
        this.isSyncingActive.value = false;
        this.currentState.value = 'AUTH_REQUIRED';
        return;
      default:
        this.isSyncingActive.value = false;
        this.currentState.value = newState as CanonicalSyncState;
        return;
    }
    this.recomputeState();
  }

  /**
   * Evaluates the definitive canonical state according to Section F:
   * - NOT_INITIALIZED: Database/app not initialized
   * - FIRST_SYNC_REQUIRED: Initial hydration has not been completed
   * - CONFLICT_REVIEW_REQUIRED: Unresolved sync conflicts exist
   * - SYNCING: Currently performing push or pull operations
   * - SYNC_ERROR: Last sync attempt failed with error
   * - PENDING_UPLOAD: Durable outbox operations exist
   * - OFFLINE_READY: Offline, but local database is ready and no outbox pending
   * - UP_TO_DATE: Online, server reachable, all entity pages synced, 0 pending outbox
   */
  public static recomputeState(): void {
    // 0. Whole-App Direct Supabase Development Mode Check
    if (DataModeService.isDirectSupabase()) {
      this.currentState.value = 'DIRECT_MODE';
      return;
    }

    // 1. Active sync in progress or downloading/verifying
    if (this.isSyncingActive.value || this.currentHydration.value === 'DOWNLOADING' || this.currentHydration.value === 'VERIFYING') {
      this.currentState.value = 'SYNCING';
      return;
    }

    // 2. Unresolved conflicts require attention
    if (this.unresolvedConflictCount.value > 0) {
      this.currentState.value = 'CONFLICT_REVIEW_REQUIRED';
      return;
    }

    // 2b. Cloud session authorization check
    if (this.currentState.value === 'AUTH_REQUIRED') {
      return;
    }

    // 3. Critical error check
    if (this.lastErrorMessage.value || this.currentState.value === 'SYNC_ERROR') {
      this.currentState.value = 'SYNC_ERROR';
      return;
    }

    // 4. Outbox pending uploads
    if (this.pendingOutboxCount.value > 0) {
      this.currentState.value = 'PENDING_UPLOAD';
      return;
    }

    // 5. Connectivity distinction
    if (!this.onlineStatus.value || !this.serverReachable.value) {
      this.currentState.value = 'OFFLINE_READY';
      return;
    }

    // 6. Initial hydration checks
    if (this.currentHydration.value === 'FAILED') {
      this.currentState.value = 'FIRST_SYNC_REQUIRED';
      return;
    }
    if (this.currentHydration.value === 'NOT_INITIALIZED') {
      this.currentState.value = 'NOT_INITIALIZED';
      return;
    }

    // 7. Fully synchronized
    this.currentState.value = 'UP_TO_DATE';
  }

  /**
   * User-friendly minimal sync status label adhering to specification.
   */
  public static get userFacingStatus() {
    return computed<UserFacingSyncStatus>(() => {
      if (DataModeService.isDirectSupabase()) {
        return 'Direct Supabase Mode';
      }
      switch (this.currentState.value) {
        case 'SYNCING':
          return 'Updating';
        case 'NOT_INITIALIZED':
        case 'FIRST_SYNC_REQUIRED':
          return 'First Sync Required';
        case 'CONFLICT_REVIEW_REQUIRED':
          return 'Needs Attention';
        case 'SYNC_ERROR':
          return 'Update Failed';
        case 'PENDING_UPLOAD':
          return this.onlineStatus.value ? 'Waiting to Sync' : 'Pending Uploads';
        case 'AUTH_REQUIRED':
          return 'Sign-in Required';
        case 'DIRECT_MODE':
          return 'Direct Supabase Mode';
        case 'OFFLINE_READY':
          return 'Offline';
        case 'UP_TO_DATE':
        default:
          return 'Up to Date';
      }
    });
  }

  /**
   * Formats last sync timestamp for minimal display: "Today, 9:30 AM" or "Just now"
   */
  public static get formattedLastSync() {
    return computed<string>(() => {
      if (!this.lastSyncTimestamp.value) return 'Never';
      const date = new Date(this.lastSyncTimestamp.value);
      if (isNaN(date.getTime())) return 'Never';

      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      if (diffMs < 60000) return 'Just now';

      const isToday =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();

      const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return isToday ? `Today, ${timeStr}` : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
    });
  }

  public static updateProgress(
    currentTable: string,
    tablesCompleted: number,
    totalTables: number,
    recordsReceived: number,
    error?: string
  ): void {
    const percent = totalTables > 0 ? Math.round((tablesCompleted / totalTables) * 100) : 0;
    this.progress.value = {
      currentTable,
      tablesCompleted,
      totalTables,
      recordsReceived,
      percent,
      error,
    };
  }

  public static updatePushProgress(update: Partial<PushSyncProgress>): void {
    this.currentPushProgress.value = {
      ...this.currentPushProgress.value,
      ...update,
    };
  }

  public static resetPushProgress(): void {
    this.currentPushProgress.value = {
      isActive: false,
      totalEligible: 0,
      attempted: 0,
      confirmed: 0,
      failed: 0,
      blocked: 0,
      conflicts: 0,
      remaining: 0,
      currentEntity: '',
      currentBatch: 0,
      totalBatches: 0,
      lastAck: null,
      percent: 0,
    };
  }

  public static updatePullProgress(update: Partial<PullSyncProgress>): void {
    this.currentPullProgress.value = {
      ...this.currentPullProgress.value,
      ...update,
    };
  }

  public static resetPullProgress(): void {
    this.currentPullProgress.value = {
      isActive: false,
      currentEntity: '',
      entitiesCompleted: 0,
      totalEntities: 0,
      recordsPulled: 0,
      percent: 0,
    };
  }

  public static setSyncSummary(summary: SyncSummaryReport | null): void {
    this.lastSummaryReport.value = summary;
  }

  public static setConfirmedUploadsCount(count: number): void {
    this.confirmedUploads.value = count;
  }

  public static setFailedOpsCount(count: number): void {
    this.failedOperations.value = count;
  }

  public static setBlockedOpsCount(count: number): void {
    this.blockedOperations.value = count;
  }

  public static setPendingPullCount(count: number): void {
    this.pendingPullEntities.value = count;
  }

  public static setTotalLocalRecordsCount(count: number | null): void {
    this.totalLocalRecords.value = count;
  }
}
