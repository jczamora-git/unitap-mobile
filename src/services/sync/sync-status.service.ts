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

