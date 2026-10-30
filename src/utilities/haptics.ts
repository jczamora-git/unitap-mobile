import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

/**
 * Safe, restrained haptic feedback utility for UniTap Living Interface.
 * Operates on native Android platforms; gracefully no-ops on desktop / web preview.
 */
export const haptics = {
  /** Light tap for selection, tab switch, or button press */
  async light(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Graceful silence
    }
  },

  /** Medium tap for modal open or action sheet */
  async medium(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch {
      // Graceful silence
    }
  },

  /** Success notification for completed NFC scan or settled payment */
  async success(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch {
      // Graceful silence
    }
  },

  /** Warning notification for duplicate check-in or grace period */
  async warning(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.notification({ type: NotificationType.Warning });
    } catch {
      // Graceful silence
    }
  },

  /** Error notification for unrecognized card or void */
  async error(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.notification({ type: NotificationType.Error });
    } catch {
      // Graceful silence
    }
  }
};
