<script setup lang="ts">
import type { NfcDeviceStatus } from '@/types/nfc';
import { 
  hardwareChipOutline, 
  checkmarkCircle, 
  closeCircle, 
  phonePortraitOutline,
  informationCircleOutline
} from 'ionicons/icons';
import { IonIcon, IonSpinner } from '@ionic/vue';

defineProps<{
  status: NfcDeviceStatus;
  isLoading?: boolean;
}>();
</script>

<template>
  <div class="minimal-card status-card">
    <div class="status-grid">
      <!-- Hardware -->
      <div class="status-item">
        <div class="status-header">
          <ion-icon :icon="hardwareChipOutline" class="status-icon" />
          <span class="status-label">NFC Hardware</span>
        </div>
        <div class="status-value-row">
          <span v-if="isLoading" class="loading-state">
            <ion-spinner name="crescent" class="inline-spinner" />
          </span>
          <template v-else>
            <span 
              v-if="status.platform === 'web'" 
              class="status-badge badge-neutral"
            >
              <ion-icon :icon="informationCircleOutline" />
              Android Native Only
            </span>
            <span 
              v-else
              class="status-badge"
              :class="status.supported ? 'badge-success' : 'badge-danger'"
            >
              <ion-icon :icon="status.supported ? checkmarkCircle : closeCircle" />
              {{ status.supported ? 'Supported' : 'Unsupported' }}
            </span>
          </template>
        </div>
      </div>

      <!-- Status -->
      <div class="status-item">
        <div class="status-header">
          <ion-icon :icon="phonePortraitOutline" class="status-icon" />
          <span class="status-label">Adapter Status</span>
        </div>
        <div class="status-value-row">
          <span v-if="isLoading" class="loading-state">
            <ion-spinner name="crescent" class="inline-spinner" />
          </span>
          <template v-else>
            <span 
              v-if="status.platform === 'web'"
              class="status-badge badge-neutral"
            >
              <ion-icon :icon="informationCircleOutline" />
              Web Preview
            </span>
            <span 
              v-else
              class="status-badge"
              :class="status.enabled ? 'badge-success' : 'badge-danger'"
            >
              <ion-icon :icon="status.enabled ? checkmarkCircle : closeCircle" />
              {{ status.enabled ? 'Enabled' : 'Disabled' }}
            </span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.status-card {
  padding: 12px 14px;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 14px;
}

.status-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-header {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--app-text-secondary);
}

.status-icon {
  font-size: 14px;
  color: var(--app-text-muted);
}

.status-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--app-text-secondary);
}

.status-value-row {
  display: flex;
  align-items: center;
}

.inline-spinner {
  width: 14px;
  height: 14px;
}
</style>
