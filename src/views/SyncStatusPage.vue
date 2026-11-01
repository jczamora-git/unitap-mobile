<template>
  <ion-page>
    <ion-content class="ion-padding sync-status-content">
      <div class="page-container">
        <div class="page-head">
          <button class="back-link" @click="router.back()">← Back</button>
          <h1 class="page-title">Synchronization Status</h1>
          <p class="page-subtitle">UniTap 2.0 Hybrid Cloud & Offline Storage</p>
        </div>

        <div class="status-summary-card">
          <div class="status-badge-row">
            <span class="status-pill" :class="'pill-' + state.toLowerCase()">
              {{ state }}
            </span>
            <span v-if="isOnline" class="online-tag">● Connected</span>
            <span v-else class="offline-tag">○ Offline</span>
          </div>

          <div class="metric-grid">
            <div class="metric-box">
              <span class="metric-val">{{ pendingCount }}</span>
              <span class="metric-lbl">Pending Outbox</span>
            </div>
            <div class="metric-box">
              <span class="metric-val">{{ hydration }}</span>
              <span class="metric-lbl">Local Database</span>
            </div>
          </div>

          <div class="meta-row font-mono">
            <span>Last Sync:</span>
            <span>{{ lastSync ? formatTime(lastSync) : 'Never' }}</span>
          </div>

          <button class="btn-sync-now" :disabled="state === 'SYNCING'" @click="handleManualSync">
            <ion-icon :icon="refreshOutline" :class="{ spin: state === 'SYNCING' }" />
            <span>{{ state === 'SYNCING' ? 'Synchronizing...' : 'Sync Now' }}</span>
          </button>
        </div>

        <!-- Sync Error Alert if lastError exists -->
        <div v-if="lastError" class="sync-error-card">
          <ion-icon :icon="alertCircleOutline" class="error-card-icon" />
          <div class="error-card-content">
            <span class="error-card-title">Push Synchronization Error</span>
            <span class="error-card-msg font-mono">{{ lastError }}</span>
          </div>
        </div>

        <!-- Pending Outbox Queue -->
        <div v-if="pendingCount > 0" class="outbox-section">
          <div class="section-head-row">
            <h3 class="section-title">Pending Operations Queue ({{ pendingCount }})</h3>
            <button class="clear-queue-btn" @click="handleClearQueue">Clear Queue</button>
          </div>
          <div class="outbox-cards">
            <div v-for="item in outboxItems" :key="item.id" class="outbox-item-card">
              <div class="outbox-head">
                <span class="outbox-entity">{{ item.entity_type }}</span>
                <span class="outbox-op">{{ item.operation }}</span>
                <span v-if="item.retry_count && item.retry_count > 0" class="outbox-retry">
                  Retried {{ item.retry_count }}x
                </span>
                <button class="delete-btn" title="Discard item" @click="handleDeleteItem(item.id)">
                  <ion-icon :icon="trashOutline" />
                </button>
              </div>
              <div v-if="item.last_error" class="outbox-err font-mono">
                {{ item.last_error }}
              </div>
            </div>
          </div>
        </div>

        <div class="info-section">
          <h3 class="section-title">How UniTap 2.0 Sync Works</h3>
          <ul class="info-list">
            <li><strong>Offline-First Writes:</strong> Operations are written to local SQLite and queued in the outbox.</li>
            <li><strong>Automatic Uplink:</strong> When connected, outbox operations upload to Supabase.</li>
            <li><strong>Supabase Realtime:</strong> Server changes notify this device instantly when connected.</li>
            <li><strong>Conflict Auditing:</strong> Disconnected concurrent changes are audited safely without silent data loss.</li>
          </ul>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonIcon } from '@ionic/vue';
import { refreshOutline, alertCircleOutline, trashOutline } from 'ionicons/icons';
import { useSyncStatus } from '@/composables/useSyncStatus';
import { useConnectivity } from '@/composables/useConnectivity';
import { formatTime } from '@/utilities/date-formatters';
import type { SyncOutboxRecord } from '@/types/database';

const router = useRouter();
const { 
  state, 
  hydration, 
  pendingCount, 
  lastSync, 
  lastError, 
  syncNow, 
  getPendingOutbox, 
  clearPendingOutbox, 
  deletePendingItem 
} = useSyncStatus();
const { isOnline } = useConnectivity();

const outboxItems = ref<SyncOutboxRecord[]>([]);

async function loadOutbox() {
  try {
    outboxItems.value = await getPendingOutbox();
  } catch (err) {
    console.error('Failed loading outbox:', err);
  }
}

onMounted(async () => {
  await loadOutbox();
});

async function handleManualSync() {
  await syncNow();
  await loadOutbox();
}

async function handleClearQueue() {
  await clearPendingOutbox();
  outboxItems.value = [];
}

async function handleDeleteItem(id: string) {
  await deletePendingItem(id);
  await loadOutbox();
}
</script>

<style scoped>
.sync-status-content {
  --background: var(--uni-background, #F8FAFC);
}

.page-container {
  max-width: 600px;
  margin: 0 auto;
}

.page-head {
  margin-bottom: 20px;
}

.back-link {
  background: none;
  border: none;
  color: var(--uni-primary, #0F766E);
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  margin-bottom: 8px;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--uni-ink, #0F172A);
  margin: 0;
}

.page-subtitle {
  font-size: 0.88rem;
  color: var(--uni-muted, #64748B);
  margin-top: 4px;
}

.status-summary-card {
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: var(--uni-shadow-card);
}

.status-badge-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.status-pill {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
}

.pill-synced {
  background: #DCFCE7;
  color: #166534;
}

.pill-syncing {
  background: #E0E7FF;
  color: #3730A3;
}

.pill-pending_changes {
  background: #FEF3C7;
  color: #92400E;
}

.pill-sync_error, .pill-conflict {
  background: #FEE2E2;
  color: #991B1B;
}

.pill-offline {
  background: #F1F5F9;
  color: #475569;
}

.dark .pill-synced {
  background: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.dark .pill-syncing {
  background: rgba(99, 102, 241, 0.2);
  color: #c7d2fe;
}

.dark .pill-pending_changes {
  background: rgba(245, 158, 11, 0.2);
  color: #fde68a;
}

.dark .pill-sync_error, .dark .pill-conflict {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

.dark .pill-offline {
  background: rgba(100, 116, 139, 0.2);
  color: #cbd5e1;
}

.online-tag {
  color: var(--uni-success);
  font-size: 0.82rem;
  font-weight: 600;
}

.offline-tag {
  color: var(--uni-text-secondary);
  font-size: 0.82rem;
  font-weight: 600;
}

.metric-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}

.metric-box {
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 8px;
  padding: 16px;
  text-align: center;
}

.metric-val {
  display: block;
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--uni-text);
}

.metric-lbl {
  font-size: 0.75rem;
  color: var(--uni-text-secondary);
}

.meta-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.82rem;
  color: var(--uni-text-secondary);
  padding: 12px 0;
  border-top: 1px solid var(--uni-border);
  border-bottom: 1px solid var(--uni-border);
  margin-bottom: 20px;
}

.btn-sync-now {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  background: var(--uni-primary);
  color: var(--uni-primary-contrast);
  border: none;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  100% {
    transform: rotate(360deg);
  }
}

.info-section {
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: 12px;
  padding: 20px;
}

.section-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--uni-ink, #0F172A);
  margin-top: 0;
  margin-bottom: 12px;
}

.info-list {
  padding-left: 20px;
  margin: 0;
  color: var(--uni-muted, #64748B);
  font-size: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sync-error-card {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 20px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.error-card-icon {
  font-size: 22px;
  color: var(--uni-danger, #EF4444);
  flex-shrink: 0;
  margin-top: 1px;
}

.error-card-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}

.error-card-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--uni-danger, #EF4444);
}

.error-card-msg {
  font-size: 11.5px;
  color: var(--uni-ink, #0F172A);
  line-height: 1.4;
  word-break: break-all;
}

.outbox-section {
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 20px;
}

.section-head-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.clear-queue-btn {
  background: none;
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: var(--uni-danger, #EF4444);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.outbox-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.outbox-item-card {
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid var(--uni-border);
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.outbox-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.outbox-entity {
  font-size: 11px;
  font-weight: 700;
  background: var(--uni-primary-bg, rgba(15, 118, 110, 0.15));
  color: var(--uni-primary, #0F766E);
  padding: 2px 6px;
  border-radius: 4px;
}

.outbox-op {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--uni-muted, #64748B);
}

.outbox-retry {
  font-size: 10px;
  color: var(--uni-danger, #EF4444);
  margin-left: auto;
}

.delete-btn {
  background: none;
  border: none;
  color: var(--uni-muted, #64748B);
  cursor: pointer;
  padding: 2px 4px;
  font-size: 14px;
  margin-left: auto;
}

.delete-btn:hover {
  color: var(--uni-danger, #EF4444);
}

.outbox-err {
  font-size: 11px;
  color: var(--uni-danger, #EF4444);
  line-height: 1.35;
  background: rgba(239, 68, 68, 0.08);
  padding: 6px 8px;
  border-radius: 4px;
  word-break: break-all;
}
</style>

