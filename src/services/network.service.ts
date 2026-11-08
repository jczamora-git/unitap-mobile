import { ref, computed } from 'vue';
import { Network, type ConnectionStatus } from '@capacitor/network';
import { App, type AppState } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export class NetworkService {
  private static onlineStatus = ref<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  private static connType = ref<string>('unknown');
  private static appActive = ref<boolean>(true);
  private static initialized = false;
  private static statusListeners: Array<(isOnline: boolean) => void> = [];
  private static resumeListeners: Array<() => void> = [];

  public static get isOnline() {
    return computed(() => this.onlineStatus.value);
  }

  public static get connectionType() {
    return computed(() => this.connType.value);
  }

  public static get isAppActive() {
    return computed(() => this.appActive.value);
  }

  public static async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // 1. Initial status query
    try {
      const status = await Network.getStatus();
      this.onlineStatus.value = status.connected;
      this.connType.value = status.connectionType;
    } catch {
      this.onlineStatus.value = typeof navigator !== 'undefined' ? navigator.onLine : true;
    }

    // 2. Native / Web Network status listeners
    try {
      await Network.addListener('networkStatusChange', (status: ConnectionStatus) => {
        const wasOnline = this.onlineStatus.value;
        this.onlineStatus.value = status.connected;
        this.connType.value = status.connectionType;

        if (status.connected !== wasOnline) {
          this.notifyStatusListeners(status.connected);
        }
      });
    } catch {
      // Fallback to browser window events
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => {
          this.onlineStatus.value = true;
          this.notifyStatusListeners(true);
        });
        window.addEventListener('offline', () => {
          this.onlineStatus.value = false;
          this.notifyStatusListeners(false);
        });
      }
    }

    // 3. App resume & lifecycle listeners
    try {
      await App.addListener('appStateChange', (state: AppState) => {
        const wasActive = this.appActive.value;
        this.appActive.value = state.isActive;
        if (state.isActive && !wasActive) {
          this.notifyResumeListeners();
        }
      });
    } catch {
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          const isActive = document.visibilityState === 'visible';
          const wasActive = this.appActive.value;
          this.appActive.value = isActive;
          if (isActive && !wasActive) {
            this.notifyResumeListeners();
          }
        });
      }
    }
  }

  public static onStatusChange(listener: (isOnline: boolean) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  public static onAppResume(listener: () => void): () => void {
    this.resumeListeners.push(listener);
    return () => {
      this.resumeListeners = this.resumeListeners.filter((l) => l !== listener);
    };
  }

  private static notifyStatusListeners(isOnline: boolean): void {
    for (const listener of this.statusListeners) {
      try {
        listener(isOnline);
      } catch (err) {
        console.warn('[NetworkService] Status listener error:', err);
      }
    }
  }

  private static notifyResumeListeners(): void {
    for (const listener of this.resumeListeners) {
      try {
        listener();
      } catch (err) {
        console.warn('[NetworkService] Resume listener error:', err);
      }
    }
  }

  /**
   * Fast asynchronous reachability probe to determine if Supabase endpoint is reachable.
   * Uses the properly configured Supabase client with authenticated credentials and get_current_user_role helper.
   * Does NOT block the UI thread and avoids raw unauthenticated HEAD probes to /rest/v1/.
   */
  public static async checkServerReachability(timeoutMs: number = 3000): Promise<boolean> {
    if (!this.onlineStatus.value) return false;

    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const rpcCall = supabase.rpc('get_current_user_role');
      const rpcPromise = typeof (rpcCall as any)?.abortSignal === 'function'
        ? (rpcCall as any).abortSignal(controller.signal)
        : rpcCall;

      const timeoutPromise = new Promise<{ error: any; status: number }>((resolve) => {
        setTimeout(() => resolve({ error: new Error('Probe timed out'), status: 0 }), timeoutMs);
      });

      const res = await Promise.race([rpcPromise, timeoutPromise]);
      clearTimeout(timer);

      if (controller.signal.aborted || res?.status === 0) {
        return false;
      }

      // If status is present, verify it is a valid non-error server response (< 500)
      if (typeof res?.status === 'number') {
        return res.status >= 200 && res.status < 500;
      }

      return true;
    } catch {
      return false;
    }
  }
}

