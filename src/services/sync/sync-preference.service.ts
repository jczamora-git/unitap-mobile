import { ref, computed } from 'vue';
import { Preferences } from '@capacitor/preferences';

export type SyncMode = 'AUTOMATIC' | 'MANUAL';

export class SyncPreferenceService {
  private static currentMode = ref<SyncMode>('AUTOMATIC');
  private static activeUserId = ref<string>('default');
  private static isInitialized = false;

  private static getStorageKey(userId: string): string {
    return `unitap_sync_mode_${userId || 'default'}`;
  }

  /**
   * Initializes sync preference for the active user context
   */
  public static async init(userId: string = 'default'): Promise<SyncMode> {
    this.activeUserId.value = userId || 'default';
    this.isInitialized = true;

    try {
      const { value } = await Preferences.get({ key: this.getStorageKey(userId) });
      if (value === 'AUTOMATIC' || value === 'MANUAL') {
        this.currentMode.value = value;
        return value;
      }
    } catch {
      // Preferences fallback
    }

    if (typeof localStorage !== 'undefined') {
      try {
        const val = localStorage.getItem(this.getStorageKey(userId));
        if (val === 'AUTOMATIC' || val === 'MANUAL') {
          this.currentMode.value = val;
          return val;
        }
      } catch {
        // Fallback
      }
    }

    this.currentMode.value = 'AUTOMATIC';
    return 'AUTOMATIC';
  }

  public static get mode() {
    return computed(() => this.currentMode.value);
  }

  public static isAutomatic(): boolean {
    return this.currentMode.value === 'AUTOMATIC';
  }

  public static isManual(): boolean {
    return this.currentMode.value === 'MANUAL';
  }

  /**
   * Updates and persists the sync mode for the current user
   */
  public static async setMode(newMode: SyncMode): Promise<void> {
    this.currentMode.value = newMode;
    const key = this.getStorageKey(this.activeUserId.value);

    try {
      await Preferences.set({ key, value: newMode });
    } catch {
      // Preferences error
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(key, newMode);
      } catch {
        // LocalStorage fallback
      }
    }
  }
}

