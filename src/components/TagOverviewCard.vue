<script setup lang="ts">
import type { NormalizedNfcTag } from '@/types/nfc';
import { copyOutline, timeOutline, pricetagOutline, fingerPrintOutline } from 'ionicons/icons';
import { IonIcon, IonButton } from '@ionic/vue';
import { useToast } from '@/composables/useToast';

const props = defineProps<{
  tag: NormalizedNfcTag;
}>();

const { copyToClipboard } = useToast();

function handleCopyUid() {
  copyToClipboard(props.tag.id, 'UID');
}

function handleCopyCompact() {
  copyToClipboard(props.tag.compactId, 'Compact UID');
}
</script>

<template>
  <div class="glass-card overview-card">
    <div class="card-header-row">
      <div class="header-title-wrap">
        <ion-icon :icon="fingerPrintOutline" class="header-icon" />
        <h3 class="card-title">Tag Overview</h3>
      </div>
      <span class="type-badge">{{ tag.type }}</span>
    </div>

    <!-- Main UID Section -->
    <div class="uid-section">
      <div class="uid-label-row">
        <span class="field-label">UID / Identifier</span>
        <div class="uid-actions">
          <ion-button 
            fill="clear" 
            size="small" 
            class="copy-btn"
            @click="handleCopyUid"
          >
            <ion-icon :icon="copyOutline" slot="start" />
            Copy
          </ion-button>
        </div>
      </div>
      <div class="uid-display font-mono" @click="handleCopyUid">
        {{ tag.id }}
      </div>
      <div v-if="tag.compactId !== 'N/A' && tag.compactId !== tag.id" class="compact-row">
        <span class="compact-label">Compact:</span>
        <span class="compact-value font-mono" @click="handleCopyCompact">{{ tag.compactId }}</span>
      </div>
    </div>

    <!-- Metadata Grid -->
    <div class="metadata-grid">
      <div class="meta-item">
        <div class="meta-label">
          <ion-icon :icon="timeOutline" />
          <span>Detected At</span>
        </div>
        <div class="meta-value">{{ tag.formattedTimestamp }}</div>
      </div>

      <div class="meta-item">
        <div class="meta-label">
          <ion-icon :icon="pricetagOutline" />
          <span>Classification</span>
        </div>
        <div class="meta-value">{{ tag.type }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overview-card {
  padding: 18px;
  background: var(--app-surface);
}

.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
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

.type-badge {
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(var(--ion-color-primary-rgb), 0.12);
  color: var(--ion-color-primary);
  padding: 4px 10px;
  border-radius: 9999px;
  border: 1px solid rgba(var(--ion-color-primary-rgb), 0.2);
}

.uid-section {
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 14px;
  padding: 14px 16px;
  margin-bottom: 16px;
}

.uid-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.field-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--app-text-secondary);
}

.copy-btn {
  --color: var(--ion-color-primary);
  font-size: 0.8rem;
  height: 28px;
  margin: 0;
}

.uid-display {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--app-text-primary);
  letter-spacing: 0.04em;
  word-break: break-all;
  user-select: all;
  cursor: pointer;
}

.compact-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 0.78rem;
  color: var(--app-text-secondary);
}

.compact-label {
  font-weight: 600;
}

.compact-value {
  color: var(--app-text-muted);
  cursor: pointer;
}

.compact-value:hover {
  color: var(--ion-color-primary);
}

.metadata-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--app-text-secondary);
}

.meta-value {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--app-text-primary);
}
</style>
