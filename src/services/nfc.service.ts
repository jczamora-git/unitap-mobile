import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Haptics, NotificationType } from '@capacitor/haptics';
import { CapacitorNfc, type NfcEvent } from '@capgo/capacitor-nfc';
import type { NfcDeviceStatus, NormalizedNfcTag } from '@/types/nfc';
import { normalizeNfcTag } from '@/utilities/tag-normalizer';
import { historyService } from './history.service';

type TagCallback = (tag: NormalizedNfcTag) => void;

class NfcService {
  private listenerHandle: PluginListenerHandle | null = null;
  private isScanning = false;
  private lastScannedTagId: string | null = null;
  private lastScannedTime = 0;
  private currentCallback: TagCallback | null = null;
  private stabilityMode = false;
  private sessionOwner: string | null = null;

  get platform(): 'android' | 'ios' | 'web' {
    const p = Capacitor.getPlatform();
    if (p === 'android') return 'android';
    if (p === 'ios') return 'ios';
    return 'web';
  }

  isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  async checkDeviceStatus(): Promise<NfcDeviceStatus> {
    const platform = this.platform;

    if (!this.isNative()) {
      return {
        supported: false,
        enabled: false,
        status: 'WEB_UNAVAILABLE',
        pluginVersion: null,
        platform: 'web',
        error: null
      };
    }

    try {
      // 1. Check Hardware Support
      const supportRes = await CapacitorNfc.isSupported();
      const supported = supportRes?.supported ?? false;

      if (!supported) {
        return {
          supported: false,
          enabled: false,
          status: 'UNSUPPORTED',
          pluginVersion: null,
          platform,
          error: 'NFC hardware not detected on this device.'
        };
      }

      // 2. Check Adapter Status
      const statusRes = await CapacitorNfc.getStatus();
      const status = statusRes?.status ?? 'UNKNOWN';
      const enabled = status === 'NFC_OK';

      // 3. Get Plugin Version
      let pluginVersion: string | null = null;
      try {
        const verRes = await CapacitorNfc.getPluginVersion();
        pluginVersion = verRes?.version ?? null;
      } catch {
        // Not critical
      }

      return {
        supported: true,
        enabled,
        status: status as NfcDeviceStatus['status'],
        pluginVersion,
        platform,
        error: null
      };
    } catch (err: unknown) {
      console.error('Error querying NFC status:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        supported: false,
        enabled: false,
        status: 'UNKNOWN',
        pluginVersion: null,
        platform,
        error: errMsg
      };
    }
  }

  async openNfcSettings(): Promise<void> {
    if (!this.isNative()) {
      throw new Error('NFC settings can only be opened on a physical mobile device.');
    }
    await CapacitorNfc.showSettings();
  }

  async triggerHapticFeedback(): Promise<void> {
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch {
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(100);
        }
      } catch {
        // Haptics unavailable
      }
    }
  }

  getActiveOwner(): string | null {
    return this.sessionOwner;
  }

  async startScanning(
    onTagDiscoveredOrOwner: TagCallback | string,
    callbackOrOptions?: TagCallback | { isStabilityTest?: boolean },
    options?: { isStabilityTest?: boolean }
  ): Promise<void> {
    let owner = 'GLOBAL';
    let onTagDiscovered: TagCallback;
    let opt = options;

    if (typeof onTagDiscoveredOrOwner === 'string') {
      owner = onTagDiscoveredOrOwner;
      onTagDiscovered = callbackOrOptions as TagCallback;
    } else {
      onTagDiscovered = onTagDiscoveredOrOwner;
      opt = callbackOrOptions as { isStabilityTest?: boolean } | undefined;
    }

    if (!this.isNative()) {
      this.sessionOwner = owner;
      throw new Error('Native NFC scanning is unavailable in web browser preview. Please test on an Android device.');
    }

    // Stop any existing session
    await this.stopScanning();

    this.sessionOwner = owner;
    this.stabilityMode = opt?.isStabilityTest ?? false;
    this.currentCallback = onTagDiscovered;
    this.lastScannedTagId = null;
    this.lastScannedTime = 0;

    // Register single event listener
    this.listenerHandle = await CapacitorNfc.addListener('nfcEvent', (event: NfcEvent) => {
      this.handleIncomingTagEvent(event);
    });

    // Start scanner on native side
    await CapacitorNfc.startScanning({
      iosSessionType: 'tag'
    });

    this.isScanning = true;
  }

  async stopScanning(owner?: string): Promise<void> {
    if (owner && this.sessionOwner && this.sessionOwner !== owner) {
      // Don't stop if another owner already claimed it
      return;
    }

    if (!this.isNative()) {
      this.isScanning = false;
      this.currentCallback = null;
      this.sessionOwner = null;
      return;
    }

    try {
      if (this.listenerHandle) {
        await this.listenerHandle.remove();
        this.listenerHandle = null;
      }
    } catch (e) {
      console.warn('Error removing NFC listener:', e);
    }

    try {
      if (this.isScanning) {
        await CapacitorNfc.stopScanning();
      }
    } catch (e) {
      console.warn('Error stopping NFC scanning:', e);
    } finally {
      this.isScanning = false;
      this.currentCallback = null;
      this.stabilityMode = false;
      this.sessionOwner = null;
    }
  }

  getScanningState(): boolean {
    return this.isScanning;
  }

  private async handleIncomingTagEvent(event: NfcEvent): Promise<void> {
    if (!event || !event.tag) return;

    const normalizedTag = normalizeNfcTag(event.tag);
    const now = Date.now();
    const tagId = normalizedTag.id;

    // Duplicate suppression logic:
    // In stability test mode: debounce 600ms between physical taps
    // In normal scanning mode: debounce 1500ms for exact same tag ID while card rests on phone
    const thresholdMs = this.stabilityMode ? 600 : 1500;

    if (this.lastScannedTagId === tagId && now - this.lastScannedTime < thresholdMs) {
      // Suppress immediate repeated jitter
      return;
    }

    this.lastScannedTagId = tagId;
    this.lastScannedTime = now;

    // Trigger haptic feedback
    await this.triggerHapticFeedback();

    // In normal mode, save to history
    if (!this.stabilityMode) {
      try {
        await historyService.addScan(normalizedTag);
      } catch (e) {
        console.error('Failed to save scan to history:', e);
      }
    }

    // Notify active subscriber
    if (this.currentCallback) {
      this.currentCallback(normalizedTag);
    }
  }
}

export const nfcService = new NfcService();
