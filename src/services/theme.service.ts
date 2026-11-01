import { Preferences } from '@capacitor/preferences';

export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'unitap_theme_preference';

export class ThemeService {
  private currentPreference: ThemePreference = 'system';
  private mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null;
  private listeners: Set<(pref: ThemePreference, isDark: boolean) => void> = new Set();
  private isInitialized = false;

  /**
   * Initializes theme on startup.
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    const saved = await this.getStoredPreference();
    this.currentPreference = saved;
    this.applyTheme(saved);
  }

  /**
   * Retrieves the stored preference, defaulting to 'system'.
   */
  async getStoredPreference(): Promise<ThemePreference> {
    try {
      const { value } = await Preferences.get({ key: THEME_STORAGE_KEY });
      if (value === 'light' || value === 'dark' || value === 'system') {
        return value;
      }
    } catch {
      // Preferences error/fallback
    }

    if (typeof localStorage !== 'undefined') {
      try {
        const val = localStorage.getItem(THEME_STORAGE_KEY);
        if (val === 'light' || val === 'dark' || val === 'system') {
          return val;
        }
      } catch {
        // LocalStorage fallback
      }
    }

    return 'system';
  }

  /**
   * Returns the current theme preference.
   */
  getPreference(): ThemePreference {
    return this.currentPreference;
  }

  /**
   * Determines whether the app is effectively in dark mode right now.
   */
  isDark(): boolean {
    if (this.currentPreference === 'dark') return true;
    if (this.currentPreference === 'light') return false;
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    );
  }

  /**
   * Sets the theme preference, persists it, and applies it immediately.
   */
  async setPreference(preference: ThemePreference): Promise<void> {
    this.currentPreference = preference;

    try {
      await Preferences.set({ key: THEME_STORAGE_KEY, value: preference });
    } catch {
      // Preferences fallback
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, preference);
      } catch {
        // LocalStorage fallback
      }
    }

    this.applyTheme(preference);
  }

  /**
   * Applies the theme classes to the document without reload.
   */
  applyTheme(preference: ThemePreference): void {
    if (typeof document === 'undefined') return;

    let isDark = false;
    if (preference === 'dark') {
      isDark = true;
    } else if (preference === 'light') {
      isDark = false;
    } else {
      isDark =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    // Toggle .dark and .ion-palette-dark on <html> and <body>
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('ion-palette-dark', isDark);
    if (document.body) {
      document.body.classList.toggle('dark', isDark);
      document.body.classList.toggle('ion-palette-dark', isDark);
    }

    // Update <meta name="theme-color"> for mobile browser navigation bar
    let metaTheme = document.querySelector('meta[name="theme-color"]');
    if (!metaTheme && document.head) {
      metaTheme = document.createElement('meta');
      metaTheme.setAttribute('name', 'theme-color');
      document.head.appendChild(metaTheme);
    }
    if (metaTheme) {
      metaTheme.setAttribute('content', isDark ? '#0F1117' : '#F8FAFC');
    }

    // Manage system media query listener
    if (preference === 'system' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      if (!this.mediaQueryListener) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        this.mediaQueryListener = () => {
          if (this.currentPreference === 'system') {
            this.applyTheme('system');
          }
        };
        mq.addEventListener?.('change', this.mediaQueryListener);
      }
    } else if (this.mediaQueryListener && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.removeEventListener?.('change', this.mediaQueryListener);
      this.mediaQueryListener = null;
    }

    // Notify reactive subscribers
    this.listeners.forEach((cb) => {
      try {
        cb(preference, isDark);
      } catch (err) {
        console.error('Error in theme listener:', err);
      }
    });
  }

  /**
   * Subscribe to theme changes
   */
  subscribe(callback: (pref: ThemePreference, isDark: boolean) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}

export const themeService = new ThemeService();

