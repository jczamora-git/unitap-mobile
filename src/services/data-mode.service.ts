import { ref, computed } from 'vue';
import { Preferences } from '@capacitor/preferences';

export type DataMode = 'supabase_direct' | 'offline_first';

const STORAGE_KEY = 'unitap_data_mode';

function resolveInitialMode(): DataMode {
  // When running inside Vitest / test environment, default to offline_first so existing SQLite unit tests execute cleanly
  if (import.meta.env?.MODE === 'test' && import.meta.env?.VITE_DATA_MODE_TEST !== 'supabase_direct') {
    return 'offline_first';
  }
  // Check localStorage if available
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'supabase_direct' || saved === 'offline_first') {
        return saved;
      }
    } catch {
      // Ignore storage access issues
    }
  }
  const envMode = (import.meta.env?.VITE_DATA_MODE as string | undefined)?.trim().toLowerCase();
  if (envMode === 'offline_first') {
    return 'offline_first';
  }
  if (envMode === 'supabase_direct' || envMode === 'direct') {
    return 'supabase_direct';
  }
  // Default to supabase_direct in production / development
  return 'supabase_direct';
}

const currentMode = ref<DataMode>(resolveInitialMode());

// Asynchronously hydrate from Capacitor Preferences on native Android
if (typeof window !== 'undefined') {
  Preferences.get({ key: STORAGE_KEY }).then(({ value }) => {
    if (value === 'supabase_direct' || value === 'offline_first') {
      currentMode.value = value;
    }
  }).catch(() => {
    // Non-fatal fallback
  });
}

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
   * Programmatically switch mode (persisting to localStorage & Capacitor Preferences).
   */
  public static setMode(mode: DataMode): void {
    currentMode.value = mode;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage?.setItem(STORAGE_KEY, mode);
      } catch {
        // Ignore storage errors
      }
      Preferences.set({ key: STORAGE_KEY, value: mode }).catch(() => {
        // Ignore preferences errors
      });
    }
  }

  /**
   * Returns metadata about the active environment and build identity.
   */
  public static getEnvironmentInfo() {
    return {
      mode: currentMode.value,
      modeLabel: this.getModeLabel(),
      supabaseUrl: import.meta.env?.VITE_SUPABASE_URL || 'https://snqcbmroefhxkhcadidr.supabase.co',
      isDirect: currentMode.value === 'supabase_direct',
      versionName: '1.0.1',
      versionCode: 2,
    };
  }
}
