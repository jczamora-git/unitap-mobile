<template>
  <ion-page>
    <ion-content class="ion-padding sync-content">
      <div class="sync-card">
        <div class="sync-header">
          <div class="sync-icon-circle">
            <ion-icon :icon="cloudDownloadOutline" class="sync-icon" />
          </div>
          <h1 class="sync-title">Initializing UniTap 2.0</h1>
          <p class="sync-subtitle">Downloading your authorized records for offline access...</p>
        </div>

        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" :style="{ width: progress.percent + '%' }"></div>
        </div>
        <div class="progress-stats">
          <span>{{ progress.currentTable ? 'Table: ' + progress.currentTable : 'Preparing...' }}</span>
          <span>{{ progress.percent }}%</span>
        </div>

        <div class="sync-checklist">
          <div class="check-item" :class="{ done: progress.percent >= 20 }">
            <ion-icon :icon="progress.percent >= 20 ? checkmarkCircle : ellipseOutline" />
            <span>Academic Calendars & Semesters</span>
          </div>
          <div class="check-item" :class="{ done: progress.percent >= 50 }">
            <ion-icon :icon="progress.percent >= 50 ? checkmarkCircle : ellipseOutline" />
            <span>Student Profiles & Enrollments</span>
          </div>
          <div class="check-item" :class="{ done: progress.percent >= 75 }">
            <ion-icon :icon="progress.percent >= 75 ? checkmarkCircle : ellipseOutline" />
            <span>NFC Cards & Attendance Sessions</span>
          </div>
          <div class="check-item" :class="{ done: progress.percent >= 90 }">
            <ion-icon :icon="progress.percent >= 90 ? checkmarkCircle : ellipseOutline" />
            <span>Fines, Contributions & Balances</span>
          </div>
          <div class="check-item" :class="{ done: hydration === 'READY' }">
            <ion-icon :icon="hydration === 'READY' ? checkmarkCircle : ellipseOutline" />
            <span>Database Integrity & Offline Readiness</span>
          </div>
        </div>

        <div v-if="hydration === 'FAILED'" class="error-banner">
          <ion-icon :icon="alertCircle" />
          <span>{{ progress.error || 'Sync interrupted. Please check internet connection.' }}</span>
          <button class="btn-retry" @click="startHydration">Retry Download</button>
        </div>

        <div v-if="hydration === 'READY'" class="ready-banner">
          <button class="btn-proceed" @click="proceedToDashboard">
            Open Dashboard
          </button>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonIcon } from '@ionic/vue';
import {
  cloudDownloadOutline,
  checkmarkCircle,
  ellipseOutline,
  alertCircle,
} from 'ionicons/icons';
import { useSyncStatus } from '@/composables/useSyncStatus';
import { useAuth } from '@/composables/useAuth';
import { InitialSyncService } from '@/services/sync/initial-sync.service';

const router = useRouter();
const { role, user } = useAuth();
const { hydration, progress } = useSyncStatus();

async function startHydration() {
  const currentRole = role.value || 'STUDENT';
  const userId = user.value?.id || 'devadmin';
  const studentId = user.value?.student_id;

  const success = await InitialSyncService.performInitialHydration(
    currentRole,
    userId,
    studentId
  );

  if (success) {
    setTimeout(() => {
      proceedToDashboard();
    }, 800);
  }
}

function proceedToDashboard() {
  router.replace('/tabs/home');
}

onMounted(() => {
  startHydration();
});
</script>

<style scoped>
.sync-content {
  --background: var(--uni-background, #F8FAFC);
  display: flex;
  align-items: center;
  justify-content: center;
}

.sync-card {
  max-width: 480px;
  margin: 40px auto;
  background: #FFFFFF;
  border: 1px solid var(--uni-border, #CBD5E1);
  border-radius: 16px;
  padding: 32px 24px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
}

.sync-header {
  text-align: center;
  margin-bottom: 24px;
}

.sync-icon-circle {
  width: 64px;
  height: 64px;
  background: #E6FFFA;
  color: var(--uni-primary, #0F766E);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
}

.sync-icon {
  font-size: 32px;
}

.sync-title {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--uni-ink, #0F172A);
  margin-bottom: 8px;
}

.sync-subtitle {
  font-size: 0.9rem;
  color: var(--uni-muted, #64748B);
}

.progress-bar-wrap {
  width: 100%;
  height: 10px;
  background: #E2E8F0;
  border-radius: 5px;
  overflow: hidden;
  margin: 20px 0 8px;
}

.progress-bar-fill {
  height: 100%;
  background: var(--uni-primary, #0F766E);
  transition: width 0.3s ease;
}

.progress-stats {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: var(--uni-muted, #64748B);
  font-family: monospace;
}

.sync-checklist {
  margin: 24px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.check-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.88rem;
  color: var(--uni-muted, #64748B);
}

.check-item.done {
  color: var(--uni-ink, #0F172A);
  font-weight: 600;
}

.check-item.done ion-icon {
  color: #059669;
}

.ready-banner, .error-banner {
  margin-top: 24px;
}

.btn-proceed {
  width: 100%;
  padding: 14px;
  background: var(--uni-primary, #0F766E);
  color: #FFFFFF;
  border: none;
  border-radius: 8px;
  font-weight: 700;
  font-size: 1rem;
  cursor: pointer;
}

.error-banner {
  background: #FEF2F2;
  border: 1px solid #FCA5A5;
  color: #991B1B;
  padding: 14px;
  border-radius: 8px;
  font-size: 0.88rem;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}

.btn-retry {
  padding: 8px 16px;
  background: #DC2626;
  color: #FFFFFF;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}
</style>
