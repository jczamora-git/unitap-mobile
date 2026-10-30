<script setup lang="ts">
import { ref } from 'vue';
import type { DecodedNdefRecord } from '@/types/nfc';
import { 
  documentTextOutline, 
  linkOutline, 
  codeSlashOutline, 
  copyOutline, 
  informationCircleOutline,
  chevronDownOutline,
  chevronUpOutline
} from 'ionicons/icons';
import { IonIcon, IonButton } from '@ionic/vue';
import { useToast } from '@/composables/useToast';

defineProps<{
  records: DecodedNdefRecord[];
  hasNdef: boolean;
}>();

const { copyToClipboard } = useToast();
const expandedHex = ref<Record<number, boolean>>({});

function toggleHex(idx: number) {
  expandedHex.value[idx] = !expandedHex.value[idx];
}

function copyPayload(record: DecodedNdefRecord) {
  copyToClipboard(record.payload, 'NDEF Payload');
}

function copyHex(record: DecodedNdefRecord) {
  copyToClipboard(record.payloadHex, 'Payload Hex');
}
</script>

<template>
  <div class="glass-card ndef-card">
    <div class="card-header-row">
      <div class="header-title-wrap">
        <ion-icon :icon="documentTextOutline" class="header-icon" />
        <h3 class="card-title">NDEF Records</h3>
      </div>
      <span v-if="hasNdef" class="count-badge">{{ records.length }} {{ records.length === 1 ? 'record' : 'records' }}</span>
    </div>

    <!-- No NDEF Data State -->
    <div v-if="!hasNdef || records.length === 0" class="no-ndef-box">
      <div class="no-ndef-header">
        <ion-icon :icon="informationCircleOutline" class="no-ndef-icon" />
        <h4 class="no-ndef-title">No NDEF Data</h4>
      </div>
      <p class="no-ndef-desc">
        This tag was detected, but no readable NDEF records were exposed.
      </p>
      <div class="no-ndef-note">
        This is normal for access badges, transit cards, or unformatted memory tags.
      </div>
    </div>

    <!-- NDEF Record List -->
    <div v-else class="records-container">
      <div 
        v-for="record in records" 
        :key="record.index" 
        class="record-item"
      >
        <!-- Record Header -->
        <div class="record-header">
          <div class="record-title-row">
            <span class="record-badge">Record #{{ record.index + 1 }}</span>
            <span class="tnf-badge">{{ record.tnfLabel }}</span>
          </div>
          <ion-button 
            fill="clear" 
            size="small" 
            class="copy-btn"
            @click="copyPayload(record)"
          >
            <ion-icon :icon="copyOutline" slot="start" />
            Copy
          </ion-button>
        </div>

        <!-- Decoded Payload Box -->
        <div class="payload-box">
          <div class="payload-label-row">
            <span class="payload-label">
              <ion-icon v-if="record.uri" :icon="linkOutline" />
              <ion-icon v-else :icon="documentTextOutline" />
              {{ record.uri ? 'Decoded URI / Link' : 'Decoded Payload' }}
            </span>
            <span v-if="record.language" class="lang-tag">Lang: {{ record.language }}</span>
            <span v-if="record.encoding" class="lang-tag">{{ record.encoding }}</span>
          </div>
          <div class="payload-content font-mono">
            {{ record.payload }}
          </div>
        </div>

        <!-- Record Metadata Rows -->
        <div class="record-meta-grid">
          <div class="meta-field">
            <span class="field-title">Type:</span>
            <span class="field-val font-mono">{{ record.type }}</span>
          </div>
          <div v-if="record.mediaType" class="meta-field">
            <span class="field-title">MIME:</span>
            <span class="field-val">{{ record.mediaType }}</span>
          </div>
          <div v-if="record.id && record.id !== 'None'" class="meta-field">
            <span class="field-title">ID:</span>
            <span class="field-val font-mono">{{ record.id }}</span>
          </div>
        </div>

        <!-- Raw Hex Toggle -->
        <div class="raw-hex-toggle-row">
          <button class="hex-toggle-btn" @click="toggleHex(record.index)">
            <ion-icon :icon="codeSlashOutline" />
            <span>{{ expandedHex[record.index] ? 'Hide Raw Payload' : 'View Raw Hex Bytes' }}</span>
            <ion-icon :icon="expandedHex[record.index] ? chevronUpOutline : chevronDownOutline" />
          </button>
        </div>

        <div v-if="expandedHex[record.index]" class="hex-expanded-panel">
          <div class="hex-action-bar">
            <span class="hex-title">Hex Representation ({{ record.rawRecord.payload?.length || 0 }} bytes)</span>
            <button class="small-copy-link" @click="copyHex(record)">Copy Hex</button>
          </div>
          <div class="hex-dump font-mono">{{ record.payloadHex || 'Empty Payload' }}</div>
          <div v-if="record.payloadUtf8" class="utf8-preview">
            <span class="utf8-title">UTF-8 Output:</span>
            <span class="utf8-text">{{ record.payloadUtf8 }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ndef-card {
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

.count-badge {
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(var(--ion-color-primary-rgb), 0.12);
  color: var(--ion-color-primary);
  padding: 3px 8px;
  border-radius: 9999px;
  border: 1px solid rgba(var(--ion-color-primary-rgb), 0.2);
}

.no-ndef-box {
  background: var(--app-surface-subtle);
  border: 1px dashed var(--app-border);
  border-radius: 14px;
  padding: 16px;
  text-align: left;
}

.no-ndef-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.no-ndef-icon {
  font-size: 1.1rem;
  color: var(--app-text-muted);
}

.no-ndef-title {
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0;
  color: var(--app-text-primary);
}

.no-ndef-desc {
  font-size: 0.84rem;
  color: var(--app-text-secondary);
  line-height: 1.4;
  margin: 0 0 6px 0;
}

.no-ndef-note {
  font-size: 0.76rem;
  color: var(--app-text-muted);
}

.records-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.record-item {
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 14px;
  padding: 14px;
}

.record-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.record-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.record-badge {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--app-text-primary);
}

.tnf-badge {
  font-size: 0.7rem;
  font-weight: 600;
  background: var(--app-surface);
  color: var(--app-text-secondary);
  padding: 2px 6px;
  border-radius: 6px;
  border: 1px solid var(--app-border);
}

.copy-btn {
  --color: var(--ion-color-primary);
  height: 26px;
  margin: 0;
  font-size: 0.78rem;
}

.payload-box {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 10px;
}

.payload-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.payload-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--app-text-secondary);
}

.lang-tag {
  font-size: 0.68rem;
  background: var(--app-surface-subtle);
  color: var(--app-text-muted);
  padding: 1px 5px;
  border-radius: 4px;
  margin-left: auto;
}

.payload-content {
  font-size: 0.88rem;
  color: var(--app-text-primary);
  line-height: 1.45;
  word-break: break-word;
  user-select: all;
}

.record-meta-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
}

.meta-field {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.76rem;
}

.field-title {
  color: var(--app-text-muted);
  font-weight: 600;
}

.field-val {
  color: var(--app-text-secondary);
}

.raw-hex-toggle-row {
  margin-top: 6px;
}

.hex-toggle-btn {
  background: transparent;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ion-color-primary);
  padding: 4px 0;
  cursor: pointer;
}

.hex-expanded-panel {
  margin-top: 8px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 10px;
}

.hex-action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.hex-title {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--app-text-secondary);
}

.small-copy-link {
  background: transparent;
  border: none;
  color: var(--ion-color-primary);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.hex-dump {
  font-size: 0.75rem;
  color: var(--app-text-primary);
  background: var(--app-surface-subtle);
  padding: 8px;
  border-radius: 6px;
  word-break: break-all;
  line-height: 1.5;
  user-select: all;
  max-height: 120px;
  overflow-y: auto;
}

.utf8-preview {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
  font-size: 0.74rem;
}

.utf8-title {
  color: var(--app-text-muted);
  font-weight: 600;
}

.utf8-text {
  color: var(--app-text-secondary);
  word-break: break-word;
}
</style>
