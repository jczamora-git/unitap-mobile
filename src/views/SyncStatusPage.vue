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
            <span class="error-card-title">Sync Notice</span>
            <span class="error-card-msg">{{ formatFriendlyError(lastError) }}</span>
          </div>
        </div>

        <!-- Pending Outbox Queue -->
        <div v-if="pendingCount > 0" class="outbox-section">
          <div class="section-head-row">
            <h3 class="section-title">Pending Changes ({{ pendingCount }})</h3>
            <button class="clear-queue-btn" @click="handleClearQueue">Clear Queue</button>
          </div>
          <div class="outbox-cards">
            <div v-for="item in outboxItems" :key="item.id" class="outbox-item-card">
              <div class="outbox-head">
                <div class="outbox-info">
                  <div class="outbox-title-row">
                    <span class="outbox-friendly-title">{{ getFriendlyItem(item).title }}</span>
                    <span class="outbox-badge" :class="getFriendlyItem(item).badgeClass">
                      {{ getFriendlyItem(item).badge }}
                    </span>
                  </div>
                  <span class="outbox-desc">{{ getFriendlyItem(item).subtitle }}</span>
                </div>
                <div class="outbox-actions">
                  <span class="outbox-time font-mono">{{ getFriendlyItem(item).timeStr }}</span>
                  <button class="delete-btn" title="Discard this change" @click="handleDeleteItem(item.id)">
                    <ion-icon :icon="trashOutline" />
                  </button>
                </div>
              </div>
              <div v-if="getFriendlyItem(item).friendlyError" class="outbox-err">
                <ion-icon :icon="alertCircleOutline" class="err-icon" />
                <span>{{ getFriendlyItem(item).friendlyError }}</span>
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

function formatFriendlyError(rawError?: string | null): string | undefined {
  if (!rawError) return undefined;
  const lower = rawError.toLowerCase();
  if (lower.includes('duplicate key') || lower.includes('unique constraint') || lower.includes('23505')) {
    if (lower.includes('school_id')) {
      return 'Already saved in the cloud. This student ID is already registered.';
    }
    return 'This record already exists on the server.';
  }
  if (lower.includes('foreign key') || lower.includes('23503')) {
    return 'Already up to date in the cloud. You can safely clear this item.';
  }
  if (lower.includes('permission denied') || lower.includes('rls') || lower.includes('42501')) {
    return 'Permission denied by server security policy.';
  }
  if (lower.includes('unauthorized') || lower.includes('authentication')) {
    return 'Session expired. Please sign in again.';
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('connection')) {
    return 'Network connection issue. Will retry automatically.';
  }
  return rawError;
}

function getFriendlyItem(item: SyncOutboxRecord) {
  let title = item.entity_type;
  let subtitle = 'Pending sync update';
  let badge: string = item.operation;
  let badgeClass = 'badge-primary';

  try {
    const payload = item.payload_json ? JSON.parse(item.payload_json) : {};
    
    if (item.entity_type === 'STUDENT') {
      const name = [payload.first_name, payload.last_name].filter(Boolean).join(' ');
      title = name ? `Student: ${name}` : 'Student Record';
      const meta = [
        payload.school_id ? `ID: ${payload.school_id}` : null,
        payload.section ? `Sec ${payload.section}` : null,
        payload.year ? `Year ${payload.year}` : null,
      ].filter(Boolean).join(' • ');
      subtitle = meta || 'Student profile information';
      badge = item.operation === 'CREATE' ? 'New Registration' : 'Update Info';
      badgeClass = item.operation === 'CREATE' ? 'badge-success' : 'badge-info';
    } else if (item.entity_type === 'ENROLLMENT') {
      const name = [payload.first_name_snapshot, payload.last_name_snapshot].filter(Boolean).join(' ');
      title = name ? `Enrollment: ${name}` : 'Class Enrollment';
      const meta = [
        payload.year_level ? `${payload.year_level} Year` : null,
        payload.section ? `Section ${payload.section}` : null,
        payload.program_id ? (payload.program_id.replace('prog_', '').toUpperCase()) : null,
      ].filter(Boolean).join(' • ');
      subtitle = meta || 'Term enrollment record';
      badge = 'Enrollment';
      badgeClass = 'badge-primary';
    } else if (item.entity_type === 'ATTENDANCE') {
      title = 'Event Attendance Check-in';
      subtitle = payload.scanned_at ? `Tap at ${new Date(payload.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Attendance check-in record';
      badge = 'Attendance';
      badgeClass = 'badge-warning';
    } else if (item.entity_type === 'PAYMENT' || item.entity_type === 'PAYMENT_ALLOCATION') {
      const pesos = payload.amount_centavos ? `₱${(payload.amount_centavos / 100).toFixed(2)}` : '';
      title = pesos ? `Payment: ${pesos}` : 'Payment Transaction';
      subtitle = payload.reference_number ? `Ref: ${payload.reference_number}` : 'Collected fee/contribution';
      badge = 'Payment';
      badgeClass = 'badge-success';
    } else if (item.entity_type === 'CARD') {
      title = 'NFC Smart Card';
      subtitle = payload.uid_normalized ? `Card UID: ${payload.uid_normalized}` : 'Student smart card linked';
      badge = 'NFC Card';
      badgeClass = 'badge-accent';
    } else {
      title = item.entity_type.charAt(0) + item.entity_type.slice(1).toLowerCase().replace(/_/g, ' ');
      subtitle = `Operation: ${item.operation}`;
    }
  } catch {
    title = `${item.entity_type} Record`;
    subtitle = `Operation: ${item.operation}`;
  }

  const friendlyError = formatFriendlyError(item.last_error);
  const timeStr = item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return {
    title,
    subtitle,
    badge,
    badgeClass,
    friendlyError,
    timeStr,
  };
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
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.outbox-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.outbox-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.outbox-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.outbox-friendly-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--uni-ink, #0F172A);
}

.outbox-badge {
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.outbox-badge.badge-success {
  background: rgba(16, 185, 129, 0.15);
  color: #10B981;
}

.outbox-badge.badge-info {
  background: rgba(59, 130, 246, 0.15);
  color: #3B82F6;
}

.outbox-badge.badge-primary {
  background: var(--uni-primary-bg, rgba(15, 118, 110, 0.15));
  color: var(--uni-primary, #0F766E);
}

.outbox-badge.badge-warning {
  background: rgba(245, 158, 11, 0.15);
  color: #F59E0B;
}

.outbox-badge.badge-accent {
  background: rgba(139, 92, 246, 0.15);
  color: #8B5CF6;
}

.outbox-desc {
  font-size: 11px;
  color: var(--uni-muted, #64748B);
}

.outbox-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.outbox-time {
  font-size: 10.5px;
  color: var(--uni-muted, #64748B);
}

.delete-btn {
  background: none;
  border: none;
  color: var(--uni-muted, #64748B);
  cursor: pointer;
  padding: 2px 4px;
  font-size: 15px;
  display: flex;
  align-items: center;
}

.delete-btn:hover {
  color: var(--uni-danger, #EF4444);
}

.outbox-err {
  font-size: 11px;
  color: var(--uni-danger, #EF4444);
  line-height: 1.35;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  padding: 6px 8px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.err-icon {
  font-size: 14px;
  flex-shrink: 0;
}
</style>

