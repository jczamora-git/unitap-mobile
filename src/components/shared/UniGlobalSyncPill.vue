<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { IonIcon } from '@ionic/vue';
import {
  cloudOfflineOutline,
  syncOutline,
  cloudUploadOutline,
  checkmarkCircle,
  alertCircleOutline,
} from 'ionicons/icons';
import { SyncStatusService } from '@/services/sync/sync-status.service';
import { NetworkService } from '@/services/network.service';
import { haptics } from '@/utilities/haptics';

const router = useRouter();

const state = computed(() => SyncStatusService.canonicalState.value);
const isOnline = computed(() => NetworkService.isOnline.value);
const pendingCount = computed(() => SyncStatusService.pendingCount.value);
const userStatus = computed(() => SyncStatusService.userFacingStatus.value);

const pillClass = computed(() => {
  switch (state.value) {
    case 'SYNCING':
      return 'pill-syncing';
    case 'PENDING_UPLOAD':
      return 'pill-pending';
    case 'OFFLINE_READY':
      return 'pill-offline';
    case 'SYNC_ERROR':
    case 'CONFLICT_REVIEW_REQUIRED':
      return 'pill-error';
    case 'UP_TO_DATE':
    default:
      return isOnline.value ? 'pill-synced' : 'pill-offline';
  }
});

const pillIcon = computed(() => {
  switch (state.value) {
    case 'SYNCING':
      return syncOutline;
    case 'PENDING_UPLOAD':
      return cloudUploadOutline;
    case 'OFFLINE_READY':
      return cloudOfflineOutline;
    case 'SYNC_ERROR':
    case 'CONFLICT_REVIEW_REQUIRED':
      return alertCircleOutline;
    case 'UP_TO_DATE':
    default:
      return isOnline.value ? checkmarkCircle : cloudOfflineOutline;
  }
});

const pillLabel = computed(() => {
  if (state.value === 'SYNCING') return 'Syncing...';
  if (state.value === 'PENDING_UPLOAD') {
    return isOnline.value ? `Pending (${pendingCount.value})` : `Offline (${pendingCount.value})`;
  }
  if (!isOnline.value || state.value === 'OFFLINE_READY') return 'Offline';
  if (state.value === 'SYNC_ERROR') return 'Sync Error';
  if (state.value === 'CONFLICT_REVIEW_REQUIRED') return 'Review Needed';
  return 'Synced';
});

function openSyncCenter() {
  haptics.light();
  router.push('/settings');
}
</script>

<template>
  <button
    class="global-sync-pill"
    :class="pillClass"
    :title="`UniTap Status: ${userStatus}`"
    aria-label="UniTap Sync Status"
    @click="openSyncCenter"
  >
    <ion-icon
      :icon="pillIcon"
      class="pill-icon"
      :class="{ 'spin-anim': state === 'SYNCING' }"
    />
    <span class="pill-text">{{ pillLabel }}</span>
  </button>
</template>

<style scoped>
.global-sync-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
  background: transparent;
}

.global-sync-pill:active {
  transform: scale(0.96);
}

.pill-icon {
  font-size: 13px;
  flex-shrink: 0;
}

.spin-anim {
  animation: pill-spin 1s linear infinite;
}

@keyframes pill-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Synced / Up to Date */
.pill-synced {
  background: rgba(16, 185, 129, 0.12);
  color: #10B981;
  border-color: rgba(16, 185, 129, 0.25);
}

/* Syncing */
.pill-syncing {
  background: rgba(56, 189, 248, 0.14);
  color: #38BDF8;
  border-color: rgba(56, 189, 248, 0.3);
}

/* Pending Uploads */
.pill-pending {
  background: rgba(245, 158, 11, 0.14);
  color: #F59E0B;
  border-color: rgba(245, 158, 11, 0.3);
}

/* Offline Mode */
.pill-offline {
  background: rgba(148, 163, 184, 0.14);
  color: #94A3B8;
  border-color: rgba(148, 163, 184, 0.25);
}

/* Error / Attention */
.pill-error {
  background: rgba(244, 63, 94, 0.14);
  color: #F43F5E;
  border-color: rgba(244, 63, 94, 0.3);
}
</style>

