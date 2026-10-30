<script setup lang="ts">
import { ref, computed } from 'vue';
import { 
  IonPage, 
  IonContent, 
  IonIcon, 
  IonModal,
  onIonViewWillEnter
} from '@ionic/vue';
import { 
  trashOutline, 
  timeOutline, 
  copyOutline, 
  chevronForwardOutline
} from 'ionicons/icons';
import type { ScanHistoryItem } from '@/types/nfc';
import { historyService } from '@/services/history.service';
import { formatTime } from '@/utilities/nfc-formatters';
import { useToast } from '@/composables/useToast';
import ScanDetailModal from '@/components/ScanDetailModal.vue';
import { UniPageHeader, UniDialog } from '@/components/ui';

const historyItems = ref<ScanHistoryItem[]>([]);
const selectedItem = ref<ScanHistoryItem | null>(null);
const isModalOpen = ref(false);
const showClearDialog = ref(false);
const { copyToClipboard } = useToast();

async function loadHistory() {
  historyItems.value = await historyService.getHistory();
}

onIonViewWillEnter(async () => {
  await loadHistory();
});

// Group scans by date label (Today, Yesterday, Earlier)
const groupedHistory = computed(() => {
  const groups: { label: string; items: ScanHistoryItem[] }[] = [];
  const map = new Map<string, ScanHistoryItem[]>();

  for (const item of historyItems.value) {
    const date = new Date(item.tag.timestamp || item.scannedAt);
    const now = new Date();
    let label = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

    if (date.toDateString() === now.toDateString()) {
      label = 'Today';
    } else {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      if (date.toDateString() === yesterday.toDateString()) {
        label = 'Yesterday';
      }
    }

    if (!map.has(label)) {
      map.set(label, []);
    }
    map.get(label)!.push(item);
  }

  for (const [label, items] of map.entries()) {
    groups.push({ label, items });
  }

  return groups;
});

function openDetail(item: ScanHistoryItem) {
  selectedItem.value = item;
  isModalOpen.value = true;
}

function closeModal() {
  isModalOpen.value = false;
  selectedItem.value = null;
}

function handleCopy(item: ScanHistoryItem, e: Event) {
  e.stopPropagation();
  copyToClipboard(item.tag.id, 'UID');
}

function confirmClearHistory() {
  showClearDialog.value = true;
}

async function handleClearHistory() {
  await historyService.clearHistory();
  await loadHistory();
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Scan History"
      :subtitle="`${historyItems.length} ${historyItems.length === 1 ? 'scan' : 'scans'} recorded`"
      :back-button="true"
      default-back-href="/settings"
    >
      <template #trailing v-if="historyItems.length > 0">
        <button class="uni-header-action-btn action-btn-danger" aria-label="Clear History" @click="confirmClearHistory">
          <ion-icon :icon="trashOutline" />
        </button>
      </template>
    </UniPageHeader>

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Empty State -->
        <div v-if="historyItems.length === 0" class="empty-state">
          <div class="empty-icon-wrap">
            <ion-icon :icon="timeOutline" />
          </div>
          <h3 class="empty-title">No Scans Yet</h3>
          <p class="empty-desc">
            NFC cards and RFID tags you scan in the Scanner tab will automatically appear here.
          </p>
        </div>

        <!-- Grouped History List -->
        <div v-else class="history-groups">
          <div v-for="group in groupedHistory" :key="group.label" class="history-group">
            <div class="group-header">{{ group.label }}</div>

            <div class="history-items-list">
              <div 
                v-for="item in group.items" 
                :key="item.id"
                class="glass-card glass-card-interactive history-card"
                @click="openDetail(item)"
              >
                <div class="history-card-top">
                  <div class="history-time-badge">
                    {{ formatTime(item.tag.timestamp || item.scannedAt) }}
                  </div>
                  <button class="quick-copy-btn" @click="handleCopy(item, $event)" title="Copy UID">
                    <ion-icon :icon="copyOutline" />
                  </button>
                </div>

                <div class="history-uid font-mono">
                  {{ item.tag.id }}
                </div>

                <div class="history-card-footer">
                  <div class="tech-summary">
                    <span class="type-text">{{ item.tag.type }}</span>
                    <span v-if="item.tag.technologies.length > 0" class="tech-bullets">
                      • {{ item.tag.technologies.map(t => t.name).slice(0, 2).join(' • ') }}
                    </span>
                  </div>
                  <ion-icon :icon="chevronForwardOutline" class="arrow-icon" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ion-content>

    <!-- Scan Detail Modal -->
    <ion-modal :is-open="isModalOpen" @didDismiss="closeModal">
      <ScanDetailModal 
        v-if="selectedItem" 
        :tag="selectedItem.tag" 
        @dismiss="closeModal" 
      />
    </ion-modal>

    <!-- Clear History Dialog -->
    <UniDialog
      v-model:is-open="showClearDialog"
      title="Clear History"
      description="Are you sure you want to delete all saved NFC scans? This action cannot be undone."
      confirm-text="Clear All"
      cancel-text="Cancel"
      :destructive="true"
      type="destructive"
      @confirm="handleClearHistory"
      @cancel="showClearDialog = false"
    />
  </ion-page>
</template>

<style scoped>
.header-styled ion-toolbar {
  --background: var(--app-bg);
  --border-width: 0;
  padding-top: env(safe-area-inset-top, 0px);
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
}

.brand-title {
  font-size: 1.45rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--app-text-primary);
}

.brand-subtitle {
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--app-text-secondary);
  margin-top: 1px;
}

.page-container {
  max-width: 640px;
  margin: 0 auto;
  padding-bottom: 24px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 60px 20px;
}

.empty-icon-wrap {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.2rem;
  color: var(--app-text-muted);
  margin-bottom: 16px;
}

.empty-title {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--app-text-primary);
  margin: 0 0 8px 0;
}

.empty-desc {
  font-size: 0.88rem;
  color: var(--app-text-secondary);
  max-width: 280px;
  line-height: 1.45;
  margin: 0;
}

.history-groups {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.group-header {
  font-size: 0.82rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--app-text-secondary);
  margin-bottom: 8px;
  padding-left: 4px;
}

.history-items-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.history-card {
  padding: 14px 16px;
  margin-bottom: 0;
  background: var(--app-surface);
}

.history-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.history-time-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--app-text-muted);
}

.quick-copy-btn {
  background: transparent;
  border: none;
  font-size: 1rem;
  color: var(--ion-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  cursor: pointer;
}

.history-uid {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--app-text-primary);
  letter-spacing: 0.03em;
  margin-bottom: 8px;
}

.history-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tech-summary {
  font-size: 0.8rem;
  color: var(--app-text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 85%;
}

.type-text {
  font-weight: 600;
  color: var(--ion-color-primary);
}

.arrow-icon {
  font-size: 1rem;
  color: var(--app-text-muted);
}
</style>
