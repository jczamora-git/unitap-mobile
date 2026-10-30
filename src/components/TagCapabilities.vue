<script setup lang="ts">
import type { NormalizedNfcTag } from '@/types/nfc';
import { 
  optionsOutline, 
  createOutline, 
  pieChartOutline, 
  lockClosedOutline, 
  documentTextOutline,
  fingerPrintOutline,
  checkmarkCircle,
  closeCircle,
  helpCircleOutline
} from 'ionicons/icons';
import { IonIcon } from '@ionic/vue';
import { formatByteSize } from '@/utilities/nfc-formatters';

defineProps<{
  tag: NormalizedNfcTag;
}>();

function formatBooleanState(val: boolean | null | undefined): { label: string; type: 'success' | 'danger' | 'unknown' } {
  if (val === true) return { label: 'Yes', type: 'success' };
  if (val === false) return { label: 'No', type: 'danger' };
  return { label: 'Unknown', type: 'unknown' };
}
</script>

<template>
  <div class="glass-card capabilities-card">
    <div class="card-header-row">
      <div class="header-title-wrap">
        <ion-icon :icon="optionsOutline" class="header-icon" />
        <h3 class="card-title">Tag Capabilities</h3>
      </div>
    </div>

    <div class="capabilities-grid">
      <!-- Writable -->
      <div class="capability-item">
        <div class="cap-icon-wrap">
          <ion-icon :icon="createOutline" />
        </div>
        <div class="cap-info">
          <span class="cap-label">Writable</span>
          <div class="cap-status">
            <span 
              class="cap-badge"
              :class="`badge-${formatBooleanState(tag.isWritable).type}`"
            >
              <ion-icon 
                :icon="tag.isWritable === true ? checkmarkCircle : (tag.isWritable === false ? closeCircle : helpCircleOutline)" 
              />
              {{ formatBooleanState(tag.isWritable).label }}
            </span>
          </div>
        </div>
      </div>

      <!-- Capacity -->
      <div class="capability-item">
        <div class="cap-icon-wrap">
          <ion-icon :icon="pieChartOutline" />
        </div>
        <div class="cap-info">
          <span class="cap-label">Max Capacity</span>
          <div class="cap-value font-mono">
            {{ formatByteSize(tag.maxSize) }}
          </div>
        </div>
      </div>

      <!-- Can Make Read-Only -->
      <div class="capability-item">
        <div class="cap-icon-wrap">
          <ion-icon :icon="lockClosedOutline" />
        </div>
        <div class="cap-info">
          <span class="cap-label">Can Lock Read-Only</span>
          <div class="cap-status">
            <span 
              class="cap-badge"
              :class="`badge-${formatBooleanState(tag.canMakeReadOnly).type}`"
            >
              <ion-icon 
                :icon="tag.canMakeReadOnly === true ? checkmarkCircle : (tag.canMakeReadOnly === false ? closeCircle : helpCircleOutline)" 
              />
              {{ formatBooleanState(tag.canMakeReadOnly).label }}
            </span>
          </div>
        </div>
      </div>

      <!-- NDEF Supported -->
      <div class="capability-item">
        <div class="cap-icon-wrap">
          <ion-icon :icon="documentTextOutline" />
        </div>
        <div class="cap-info">
          <span class="cap-label">NDEF Formatted</span>
          <div class="cap-status">
            <span 
              class="cap-badge"
              :class="tag.hasNdef ? 'badge-success' : 'badge-neutral'"
            >
              <ion-icon :icon="tag.hasNdef ? checkmarkCircle : closeCircle" />
              {{ tag.hasNdef ? 'Yes' : 'No' }}
            </span>
          </div>
        </div>
      </div>

      <!-- UID Available -->
      <div class="capability-item full-width">
        <div class="cap-icon-wrap">
          <ion-icon :icon="fingerPrintOutline" />
        </div>
        <div class="cap-info">
          <span class="cap-label">UID Broadcast</span>
          <div class="cap-status">
            <span 
              class="cap-badge"
              :class="tag.id !== 'Unavailable' ? 'badge-success' : 'badge-danger'"
            >
              <ion-icon :icon="tag.id !== 'Unavailable' ? checkmarkCircle : closeCircle" />
              {{ tag.id !== 'Unavailable' ? 'Available' : 'Unavailable' }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.capabilities-card {
  padding: 18px;
  background: var(--app-surface);
}

.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.header-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-icon {
  font-size: 1.25rem;
  color: var(--ion-color-primary);
}

.card-title {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--app-text-primary);
}

.capabilities-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.capability-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  padding: 10px 12px;
}

.full-width {
  grid-column: 1 / -1;
}

.cap-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ion-color-primary);
  font-size: 1.1rem;
  flex-shrink: 0;
}

.cap-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.cap-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--app-text-secondary);
}

.cap-value {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--app-text-primary);
}

.cap-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
}

.badge-success {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.badge-danger {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.badge-unknown {
  background: var(--app-surface);
  color: var(--app-text-muted);
  border: 1px solid var(--app-border);
}

.badge-neutral {
  background: var(--app-surface);
  color: var(--app-text-secondary);
  border: 1px solid var(--app-border);
}
</style>
