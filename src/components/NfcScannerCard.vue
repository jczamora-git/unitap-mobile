<script setup lang="ts">
import { 
  radioOutline, 
  checkmarkCircle, 
  alertCircle, 
  settingsOutline,
  refreshOutline,
  stopCircleOutline,
  scanOutline
} from 'ionicons/icons';
import { IonIcon, IonButton, IonSpinner } from '@ionic/vue';
import type { NfcDeviceStatus, NormalizedNfcTag, ScannerState } from '@/types/nfc';

defineProps<{
  status: NfcDeviceStatus;
  state: ScannerState;
  isScanning: boolean;
  detectedTag: NormalizedNfcTag | null;
  error: string | null;
}>();

const emit = defineEmits<{
  (e: 'start-scan'): void;
  (e: 'stop-scan'): void;
  (e: 'open-settings'): void;
  (e: 'reset-scan'): void;
}>();
</script>

<template>
  <div class="glass-card scanner-card" :class="`state-${state}`">
    <!-- Animated NFC Field Icon / Visual -->
    <div class="scanner-visual-container">
      <div 
        class="radar-glow" 
        :class="{ 'pulse-active': isScanning, 'success-active': state === 'detected' }"
      >
        <div class="radar-inner">
          <ion-icon 
            v-if="state === 'detected'" 
            :icon="checkmarkCircle" 
            class="visual-icon success-icon" 
          />
          <ion-icon 
            v-else-if="state === 'disabled' || state === 'unsupported' || state === 'error'" 
            :icon="alertCircle" 
            class="visual-icon warning-icon" 
          />
          <ion-icon 
            v-else 
            :icon="radioOutline" 
            class="visual-icon default-icon" 
          />
        </div>
      </div>
    </div>

    <!-- State: WEB / BROWSER FALLBACK -->
    <div v-if="status.platform === 'web'" class="scanner-content">
      <h3 class="scanner-title">Native NFC Unavailable</h3>
      <p class="scanner-desc">
        Web browser preview detected. To test physical NFC cards, install and run NFC Inspector on an Android device with NFC support.
      </p>
      <div class="action-wrap">
        <ion-button 
          fill="outline" 
          color="primary" 
          class="scan-action-btn"
          @click="emit('start-scan')"
        >
          <ion-icon :icon="scanOutline" slot="start" />
          Simulate Scanner State
        </ion-button>
      </div>
    </div>

    <!-- State: NFC UNSUPPORTED -->
    <div v-else-if="state === 'unsupported' || (!status.supported && status.status === 'UNSUPPORTED')" class="scanner-content">
      <h3 class="scanner-title title-danger">NFC Not Supported</h3>
      <p class="scanner-desc">
        This device does not report NFC hardware support. NFC scanning is unavailable on this device.
      </p>
    </div>

    <!-- State: NFC DISABLED -->
    <div v-else-if="state === 'disabled' || !status.enabled" class="scanner-content">
      <h3 class="scanner-title title-warning">NFC is Turned Off</h3>
      <p class="scanner-desc">
        Enable NFC in your device system settings to inspect NFC and RFID cards.
      </p>
      <div class="action-wrap">
        <ion-button 
          color="warning" 
          class="scan-action-btn"
          @click="emit('open-settings')"
        >
          <ion-icon :icon="settingsOutline" slot="start" />
          Open NFC Settings
        </ion-button>
      </div>
    </div>

    <!-- State: SCANNING IN PROGRESS -->
    <div v-else-if="isScanning" class="scanner-content">
      <h3 class="scanner-title title-primary">Scanning...</h3>
      <p class="scanner-desc">
        Hold the NFC card near the back of your phone. Keep it steady until detected.
      </p>
      <div class="scan-indicator-badge">
        <ion-spinner name="dots" class="dots-spinner" />
        <span>Waiting for NFC tag</span>
      </div>
      <div class="action-wrap">
        <ion-button 
          color="danger" 
          fill="outline" 
          class="scan-action-btn"
          @click="emit('stop-scan')"
        >
          <ion-icon :icon="stopCircleOutline" slot="start" />
          Stop Scanning
        </ion-button>
      </div>
    </div>

    <!-- State: TAG DETECTED -->
    <div v-else-if="state === 'detected' && detectedTag" class="scanner-content">
      <h3 class="scanner-title title-success">✓ Tag Detected</h3>
      <div class="detected-uid font-mono">{{ detectedTag.id }}</div>
      <p class="scanner-desc-small">Tag details loaded below</p>
      <div class="action-row">
        <ion-button 
          color="primary" 
          class="scan-action-btn"
          @click="emit('start-scan')"
        >
          <ion-icon :icon="refreshOutline" slot="start" />
          Scan Another Tag
        </ion-button>
      </div>
    </div>

    <!-- State: READY / IDLE -->
    <div v-else class="scanner-content">
      <h3 class="scanner-title">Ready to Scan</h3>
      <p class="scanner-desc">
        Hold an NFC card or tag near the back of your phone's antenna.
      </p>
      <div class="action-wrap">
        <ion-button 
          color="primary" 
          class="scan-action-btn"
          @click="emit('start-scan')"
        >
          <ion-icon :icon="scanOutline" slot="start" />
          Start Scanning
        </ion-button>
      </div>
    </div>

    <!-- Error message banner if any -->
    <div v-if="error && !isScanning" class="error-banner">
      <ion-icon :icon="alertCircle" class="error-icon" />
      <span>{{ error }}</span>
    </div>
  </div>
</template>

<style scoped>
.scanner-card {
  padding: 28px 20px;
  text-align: center;
  position: relative;
  overflow: hidden;
  background: var(--app-surface);
}

.scanner-visual-container {
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 20px;
}

.radar-glow {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  background: var(--app-surface-subtle);
  border: 2px solid var(--app-border);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.pulse-active {
  background: rgba(var(--ion-color-primary-rgb), 0.1);
  border-color: var(--ion-color-primary);
  animation: nfc-pulse 1.8s infinite ease-out;
}

.success-active {
  background: rgba(16, 185, 129, 0.15);
  border-color: #10b981;
}

.radar-inner {
  display: flex;
  align-items: center;
  justify-content: center;
}

.visual-icon {
  font-size: 3rem;
  transition: all 0.25s ease;
}

.default-icon {
  color: var(--ion-color-primary);
}

.success-icon {
  color: #10b981;
  animation: scale-up 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.warning-icon {
  color: #f59e0b;
}

@keyframes scale-up {
  0% { transform: scale(0.6); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.scanner-content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.scanner-title {
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 8px 0;
  color: var(--app-text-primary);
}

.title-primary {
  color: var(--ion-color-primary);
}

.title-success {
  color: #10b981;
}

.title-warning {
  color: #f59e0b;
}

.title-danger {
  color: #ef4444;
}

.scanner-desc {
  font-size: 0.92rem;
  line-height: 1.45;
  color: var(--app-text-secondary);
  max-width: 320px;
  margin: 0 0 20px 0;
}

.scanner-desc-small {
  font-size: 0.82rem;
  color: var(--app-text-muted);
  margin: 4px 0 16px 0;
}

.detected-uid {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--ion-color-primary);
  background: var(--app-surface-subtle);
  padding: 8px 16px;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  margin-bottom: 8px;
}

.scan-indicator-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--app-surface-subtle);
  padding: 6px 14px;
  border-radius: 9999px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ion-color-primary);
  margin-bottom: 20px;
}

.dots-spinner {
  width: 20px;
  height: 20px;
}

.action-wrap, .action-row {
  width: 100%;
  max-width: 300px;
}

.scan-action-btn {
  width: 100%;
  --border-radius: 14px;
}

.error-banner {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 10px;
  color: #ef4444;
  font-size: 0.82rem;
  text-align: left;
}

.error-icon {
  font-size: 1.1rem;
  flex-shrink: 0;
}
</style>
