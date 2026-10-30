import { ref, computed } from 'vue';
import type { NfcDeviceStatus, NormalizedNfcTag, ScannerState } from '@/types/nfc';
import { nfcService } from '@/services/nfc.service';

const deviceStatus = ref<NfcDeviceStatus>({
  supported: false,
  enabled: false,
  status: 'UNKNOWN',
  pluginVersion: null,
  platform: 'web',
  error: null
});

const isScanning = ref(false);
const lastTag = ref<NormalizedNfcTag | null>(null);
const scanError = ref<string | null>(null);
const isLoading = ref(false);

export function useNfc() {
  const scannerState = computed<ScannerState>(() => {
    if (!deviceStatus.value.supported && deviceStatus.value.status === 'UNSUPPORTED') {
      return 'unsupported';
    }
    if (deviceStatus.value.status === 'NFC_DISABLED') {
      return 'disabled';
    }
    if (scanError.value) {
      return 'error';
    }
    if (lastTag.value) {
      return 'detected';
    }
    if (isScanning.value) {
      return 'scanning';
    }
    return 'idle';
  });

  async function refreshStatus(): Promise<NfcDeviceStatus> {
    isLoading.value = true;
    try {
      const status = await nfcService.checkDeviceStatus();
      deviceStatus.value = status;
      return status;
    } finally {
      isLoading.value = false;
    }
  }

  async function startScan(): Promise<void> {
    scanError.value = null;
    lastTag.value = null;

    try {
      await refreshStatus();

      if (!deviceStatus.value.supported && deviceStatus.value.platform === 'web') {
        scanError.value = 'Native NFC is unavailable in web preview mode. Please run NFC Inspector on an Android device to scan physical tags.';
        return;
      }

      if (!deviceStatus.value.supported) {
        scanError.value = 'This device does not report NFC hardware support.';
        return;
      }

      if (!deviceStatus.value.enabled) {
        scanError.value = 'NFC is turned off. Please enable NFC in system settings to scan.';
        return;
      }

      await nfcService.startScanning((tag: NormalizedNfcTag) => {
        lastTag.value = tag;
        // Keep scanner active or let user inspect result
      });

      isScanning.value = true;
    } catch (err: unknown) {
      isScanning.value = false;
      const msg = err instanceof Error ? err.message : String(err);
      scanError.value = msg;
    }
  }

  async function stopScan(): Promise<void> {
    try {
      await nfcService.stopScanning();
    } catch (err: unknown) {
      console.warn('Error during stopScan:', err);
    } finally {
      isScanning.value = false;
    }
  }

  async function openSettings(): Promise<void> {
    try {
      await nfcService.openNfcSettings();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      scanError.value = msg;
    }
  }

  function resetLastTag(): void {
    lastTag.value = null;
    scanError.value = null;
  }

  return {
    deviceStatus,
    isScanning,
    lastTag,
    scanError,
    isLoading,
    scannerState,
    refreshStatus,
    startScan,
    stopScan,
    openSettings,
    resetLastTag
  };
}
