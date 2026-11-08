import { ref, computed } from 'vue';

export type DataMode = 'supabase_direct' | 'offline_first';

function resolveInitialMode(): DataMode {
  // When running inside Vitest / test environment, default to offline_first so existing SQLite unit tests execute cleanly
  if (import.meta.env?.MODE === 'test' && import.meta.env?.VITE_DATA_MODE_TEST !== 'supabase_direct') {
    return 'offline_first';
  }
  const envMode = (import.meta.env?.VITE_DATA_MODE as string | undefined)?.trim().toLowerCase();
  if (envMode === 'supabase_direct' || envMode === 'direct') {
    return 'supabase_direct';
  }
  return 'offline_first';
}

const currentMode = ref<DataMode>(resolveInitialMode());

export class DataModeService {
  /**
   * Reactive computed indicator of the current active data mode.
   */
  public static get mode() {
    return computed(() => currentMode.value);
  }

  /**
   * Returns true when UniTap 2.0 is operating in Whole-App Direct Supabase Development Mode.
   * In this mode:
   * - Reads are directed to Supabase PostgreSQL.
   * - Writes execute directly through authorized Supabase RPCs / PostgREST APIs.
   * - Local SQLite persistence, sync_outbox queuing, and background sync are bypassed.
   * - Stale local SQLite records are never returned as fallback.
   */
  public static isDirectSupabase(): boolean {
    return currentMode.value === 'supabase_direct';
  }

  /**
   * Returns true when standard offline-first hybrid SQLite mode is active.
   */
  public static isOfflineFirst(): boolean {
    return currentMode.value === 'offline_first';
  }

  /**
   * Human-readable label for the current data mode.
   */
  public static getModeLabel(): string {
    return currentMode.value === 'supabase_direct' ? 'Direct Supabase Mode' : 'Offline-First SQLite Mode';
  }

  /**
   * Programmatically switch mode (useful for integration testing and runtime inspection).
   */
  public static setMode(mode: DataMode): void {
    currentMode.value = mode;
  }
}
