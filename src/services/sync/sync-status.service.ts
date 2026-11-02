import { ref, computed } from 'vue';

export type CanonicalSyncState =
  | 'NOT_INITIALIZED'
  | 'FIRST_SYNC_REQUIRED'
  | 'OFFLINE_READY'
  | 'SYNCING'
  | 'UP_TO_DATE'
  | 'PENDING_UPLOAD'
  | 'SYNC_ERROR'
  | 'CONFLICT_REVIEW_REQUIRED';

// Maintain backward compatibility with existing code
export type SyncState =
  | CanonicalSyncState
  | 'OFFLINE'
  | 'ONLINE'
  | 'SYNCED'
  | 'PENDING_CHANGES'
  | 'CONFLICT'
  | 'AUTH_REQUIRED';

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
  | 'Pending Uploads'
  | 'Waiting to Sync'
  | 'Needs Attention'
  | 'Sync Error'
  | 'Update Failed'
  | 'First Sync Required';

export interface SyncProgress {
  currentTable: string;
  tablesCompleted: number;
  totalTables: number;
  recordsReceived: number;
  percent: number;
  error?: string;
}

export class SyncStatusService {
  private static currentState = ref<CanonicalSyncState>('NOT_INITIALIZED');
  private static currentHydration = ref<HydrationState>('NOT_INITIALIZED');
  private static isSyncingActive = ref<boolean>(false);
  private static onlineStatus = ref<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  private static serverReachable = ref<boolean>(true);
  private static pendingOutboxCount = ref<number>(0);
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

  public static get state() {
    return computed(() => this.currentState.value);
  }

  public static get canonicalState() {
    return computed(() => this.currentState.value);
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
        this.onlineStatus.value = false;
        break;
      case 'ONLINE':
        this.onlineStatus.value = true;
        break;
      case 'SYNCED':
      case 'UP_TO_DATE':
        this.isSyncingActive.value = false;
        this.lastErrorMessage.value = null;
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
    // 1. Initial hydration check
    if (this.currentHydration.value === 'NOT_INITIALIZED') {
      this.currentState.value = 'NOT_INITIALIZED';
      return;
    }
    if (this.currentHydration.value === 'DOWNLOADING' || this.currentHydration.value === 'VERIFYING') {
      this.currentState.value = 'SYNCING';
      return;
    }
    if (this.currentHydration.value === 'FAILED') {
      this.currentState.value = 'FIRST_SYNC_REQUIRED';
      return;
    }

    // 2. Active sync in progress
    if (this.isSyncingActive.value) {
      this.currentState.value = 'SYNCING';
      return;
    }

    // 3. Unresolved conflicts require attention
    if (this.unresolvedConflictCount.value > 0) {
      this.currentState.value = 'CONFLICT_REVIEW_REQUIRED';
      return;
    }

    // 4. Critical error check
    if (this.lastErrorMessage.value) {
      this.currentState.value = 'SYNC_ERROR';
      return;
    }

    // 5. Outbox pending uploads
    if (this.pendingOutboxCount.value > 0) {
      this.currentState.value = 'PENDING_UPLOAD';
      return;
    }

    // 6. Connectivity distinction
    if (!this.onlineStatus.value || !this.serverReachable.value) {
      this.currentState.value = 'OFFLINE_READY';
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
      switch (this.currentState.value) {
        case 'SYNCING':
          return 'Syncing';
        case 'NOT_INITIALIZED':
        case 'FIRST_SYNC_REQUIRED':
          return 'First Sync Required';
        case 'CONFLICT_REVIEW_REQUIRED':
          return 'Needs Attention';
        case 'SYNC_ERROR':
          return 'Sync Error';
        case 'PENDING_UPLOAD':
          return this.onlineStatus.value ? 'Waiting to Sync' : 'Pending Uploads';
        case 'OFFLINE_READY':
          return 'Offline Mode';
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
}
