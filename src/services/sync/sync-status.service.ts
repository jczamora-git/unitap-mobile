import { ref, computed } from 'vue';

export type SyncState =
  | 'OFFLINE'
  | 'ONLINE'
  | 'SYNCING'
  | 'SYNCED'
  | 'PENDING_CHANGES'
  | 'SYNC_ERROR'
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
  | 'Updating'
  | 'Offline'
  | 'Waiting to Sync'
  | 'Needs Attention'
  | 'Update Failed';

export interface SyncProgress {
  currentTable: string;
  tablesCompleted: number;
  totalTables: number;
  recordsReceived: number;
  percent: number;
  error?: string;
}

export class SyncStatusService {
  private static currentState = ref<SyncState>('ONLINE');
  private static currentHydration = ref<HydrationState>('NOT_INITIALIZED');
  private static pendingOutboxCount = ref<number>(0);
  private static lastSyncTimestamp = ref<string | null>(null);
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

  public static get hydration() {
    return computed(() => this.currentHydration.value);
  }

  public static get pendingCount() {
    return computed(() => this.pendingOutboxCount.value);
  }

  public static get lastSync() {
    return computed(() => this.lastSyncTimestamp.value);
  }

  public static get currentProgress() {
    return computed(() => this.progress.value);
  }

  /**
   * User-friendly minimal sync status label adhering to specification:
   * - Up to Date
   * - Updating
   * - Offline
   * - Waiting to Sync
   * - Needs Attention
   * - Update Failed
   */
  public static get userFacingStatus() {
    return computed<UserFacingSyncStatus>(() => {
      if (this.currentState.value === 'SYNCING') {
        return 'Updating';
      }

      const isOffline =
        this.currentState.value === 'OFFLINE' ||
        (typeof navigator !== 'undefined' && !navigator.onLine);

      if (isOffline) {
        return 'Offline';
      }

      if (this.currentState.value === 'CONFLICT') {
        return 'Needs Attention';
      }

      if (this.currentState.value === 'SYNC_ERROR') {
        return 'Update Failed';
      }

      if (this.pendingOutboxCount.value > 0) {
        return 'Waiting to Sync';
      }

      if (this.currentState.value === 'SYNCED') {
        return 'Up to Date';
      }

      return 'Up to Date';
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

  public static setState(newState: SyncState): void {
    this.currentState.value = newState;
  }

  public static setHydration(newState: HydrationState): void {
    this.currentHydration.value = newState;
  }

  public static setPendingCount(count: number): void {
    this.pendingOutboxCount.value = count;
    if (count > 0 && this.currentState.value === 'SYNCED') {
      this.currentState.value = 'PENDING_CHANGES';
    }
  }

  public static setLastSync(timestamp: string): void {
    this.lastSyncTimestamp.value = timestamp;
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
