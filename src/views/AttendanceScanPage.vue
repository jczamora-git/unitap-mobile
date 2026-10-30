<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonContent,
  IonIcon,
  IonSelect,
  IonSelectOption,
  onIonViewWillEnter,
  onIonViewDidLeave
} from '@ionic/vue';
import {
  radioOutline,
  checkmarkCircle,
  alertCircle,
  warningOutline,
  personAddOutline,
  refreshOutline,
  hardwareChipOutline,
  peopleOutline,
  calendarOutline,
  stopCircleOutline
} from 'ionicons/icons';
import { useNfc } from '@/composables/useNfc';
import { eventService } from '@/services/event.service';
import { attendanceService } from '@/services/attendance.service';
import type { EventOccurrence, Event } from '@/types/event';
import type { AttendanceScanResult, AttendanceStats, AttendanceScanLog } from '@/types/attendance';
import { formatTime, formatDate } from '@/utilities/date-formatters';
import { formatFullName, formatStudentAcademicSummary } from '@/utilities/student-formatters';
import { haptics } from '@/utilities/haptics';
import { UniPageHeader, UniButton } from '@/components/ui';

const route = useRoute();
const router = useRouter();

const {
  deviceStatus,
  isScanning,
  lastTag,
  startScan,
  stopScan,
  refreshStatus
} = useNfc();

const openOccurrences = ref<Array<{ occurrence: EventOccurrence; event: Event }>>([]);
const selectedOccurrenceId = ref<string>('');
const selectedOccurrence = computed(() => 
  openOccurrences.value.find(item => item.occurrence.id === selectedOccurrenceId.value) || null
);

const sessionStats = ref<AttendanceStats | null>(null);
const recentLogs = ref<AttendanceScanLog[]>([]);
const lastResult = ref<AttendanceScanResult | null>(null);
const isProcessing = ref(false);

async function loadOccurrences() {
  const events = await eventService.getEvents();
  const occurrences = await eventService.getOccurrences();

  const openList: Array<{ occurrence: EventOccurrence; event: Event }> = [];
  for (const occ of occurrences) {
    if (occ.status === 'OPEN') {
      const parentEvent = events.find(e => e.id === occ.eventId);
      if (parentEvent) {
        openList.push({ occurrence: occ, event: parentEvent });
      }
    }
  }

  openOccurrences.value = openList;

  // Check route param or query or pick first
  const targetOccId = (route.params.occurrenceId || route.query.occurrenceId) as string;
  if (targetOccId && openList.some(o => o.occurrence.id === targetOccId)) {
    selectedOccurrenceId.value = targetOccId;
  } else if (openList.length > 0 && !selectedOccurrenceId.value) {
    selectedOccurrenceId.value = openList[0].occurrence.id;
  }

  if (selectedOccurrenceId.value) {
    await refreshSessionData();
  }
}

async function refreshSessionData() {
  if (!selectedOccurrenceId.value) return;
  sessionStats.value = await attendanceService.getStats(selectedOccurrenceId.value);
  recentLogs.value = await attendanceService.getScanLogs(selectedOccurrenceId.value);
}

// Watch tag changes from useNfc
watch(lastTag, async (newTag) => {
  if (!newTag?.id || isProcessing.value) return;
  if (!selectedOccurrenceId.value) {
    lastResult.value = {
      type: 'INVALID',
      message: 'Please select an open attendance session first.',
      timestamp: new Date().toISOString(),
      rfidUid: newTag.id
    };
    return;
  }

  isProcessing.value = true;
  try {
    const result = await attendanceService.processNfcScan(selectedOccurrenceId.value, newTag.id);
    lastResult.value = result;
    if (result.type === 'ACCEPTED') {
      await haptics.success();
    } else if (result.type === 'DUPLICATE') {
      await haptics.warning();
    } else {
      await haptics.error();
    }
    await refreshSessionData();
  } catch (err: unknown) {
    console.error('Error recording attendance:', err);
    await haptics.error();
    lastResult.value = {
      type: 'INVALID',
      message: err instanceof Error ? err.message : 'Error processing NFC tag',
      timestamp: new Date().toISOString(),
      rfidUid: newTag.id
    };
  } finally {
    isProcessing.value = false;
  }
});

onMounted(async () => {
  await refreshStatus();
  await loadOccurrences();
});

onIonViewWillEnter(async () => {
  await refreshStatus();
  await loadOccurrences();
  if (deviceStatus.value.enabled) {
    await startScan();
  }
});

onIonViewDidLeave(async () => {
  await stopScan();
});

function handleRegisterCard() {
  if (lastResult.value?.rfidUid) {
    router.push({
      path: '/register-student',
      query: { rfid: lastResult.value.rfidUid }
    });
  }
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Attendance Scanner"
      subtitle="Event occurrence check-in"
      :back-button="true"
      default-back-href="/tabs/events"
      :optional-badge="isScanning ? 'Active' : 'Ready'"
      :badge-variant="isScanning ? 'mint' : 'neutral'"
      variant="detail"
    >
      <template #trailing>
        <button 
          class="uni-header-action-btn" 
          aria-label="NFC Diagnostics" 
          @click="router.push('/diagnostics/device')"
        >
          <ion-icon :icon="hardwareChipOutline" />
        </button>
      </template>
    </UniPageHeader>

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Session Selector Surface -->
        <div class="minimal-card session-picker-card">
          <div class="picker-top">
            <span class="picker-title">Target Session</span>
            <span v-if="selectedOccurrence" class="status-badge badge-success">OPEN</span>
          </div>

          <div v-if="openOccurrences.length > 0" class="select-box-wrap">
            <ion-select 
              v-model="selectedOccurrenceId" 
              interface="action-sheet" 
              class="clean-session-select"
              @ion-change="refreshSessionData"
            >
              <ion-select-option 
                v-for="item in openOccurrences" 
                :key="item.occurrence.id" 
                :value="item.occurrence.id"
              >
                {{ item.event.title }} — {{ item.occurrence.title }} ({{ formatTime(item.occurrence.startTime) }})
              </ion-select-option>
            </ion-select>
          </div>

          <div v-else class="neutral-info-banner">
            <ion-icon :icon="calendarOutline" />
            <div class="banner-text">
              <span class="banner-title">No open attendance session</span>
              <span class="banner-sub">Open a session from the Events tab to record scans.</span>
            </div>
            <button class="compact-pill-btn" @click="router.push('/tabs/events')">
              Choose Event
            </button>
          </div>

          <div v-if="selectedOccurrence" class="session-meta-row">
            <span>{{ formatDate(selectedOccurrence.occurrence.date) }} • {{ formatTime(selectedOccurrence.occurrence.startTime) }} - {{ formatTime(selectedOccurrence.occurrence.endTime) }}</span>
            <span>Grace: {{ selectedOccurrence.occurrence.gracePeriodMinutes }}m</span>
          </div>
        </div>

        <!-- Hero Luminous NFC Scanner Panel -->
        <div class="luminous-scanner-surface" :class="{ 'is-scanning': isScanning }">
          <div class="luminous-radar-wrap">
            <div class="radar-ring ring-1"></div>
            <div class="radar-ring ring-2"></div>
            <div class="radar-ring ring-3"></div>
            <div class="radar-core">
              <ion-icon :icon="radioOutline" />
            </div>
          </div>

          <div class="scanner-text-block">
            <h3 class="scanner-headline">
              {{ isScanning ? 'Ready for Student ID' : 'Scanner Paused' }}
            </h3>
            <p class="scanner-instructions">
              {{ isScanning ? 'Hold student university card against the back of your phone' : 'Press start to activate the native NFC receiver' }}
            </p>
          </div>

          <div class="scanner-action-row">
            <button 
              v-if="!isScanning"
              class="scan-toggle-btn btn-mint-action"
              @click="startScan"
            >
              <ion-icon :icon="radioOutline" />
              Start Scanning
            </button>
            <button 
              v-else
              class="scan-toggle-btn btn-subtle"
              @click="stopScan"
            >
              <ion-icon :icon="stopCircleOutline" />
              Stop Scanning
            </button>
          </div>
        </div>

        <!-- Scan Result Card -->
        <div 
          v-if="lastResult" 
          class="minimal-card scan-result-surface"
          :class="'result-' + lastResult.type.toLowerCase()"
        >
          <div class="result-head">
            <div class="result-status-wrap">
              <ion-icon 
                :icon="lastResult.type === 'ACCEPTED' ? checkmarkCircle : (lastResult.type === 'DUPLICATE' ? alertCircle : warningOutline)" 
                class="result-type-icon"
              />
              <span class="result-badge">{{ lastResult.type }}</span>
            </div>
            <span class="result-time font-mono">{{ formatTime(lastResult.timestamp) }}</span>
          </div>

          <div v-if="lastResult.student" class="result-student-info">
            <h4 class="student-name">
              {{ formatFullName(lastResult.student.firstName, lastResult.student.middleName, lastResult.student.lastName) }}
            </h4>
            <div class="student-meta-line">
              <span v-if="lastResult.student.studentNumber" class="font-mono">
                ID: {{ lastResult.student.studentNumber }}
              </span>
              <span>• {{ formatStudentAcademicSummary(lastResult.student) }}</span>
            </div>
            <div class="uid-sub font-mono">
              Card UID: {{ lastResult.rfidUid }}
            </div>
          </div>

          <p class="result-detail-text">
            {{ lastResult.message }}
          </p>

          <div v-if="lastResult.type === 'UNREGISTERED'" class="result-cta-row">
            <UniButton 
              size="sm" 
              :icon="personAddOutline" 
              @click="handleRegisterCard"
            >
              Register Student With This Card
            </UniButton>
          </div>
        </div>

        <!-- Session Stats Counters -->
        <div v-if="sessionStats" class="metrics-grid stats-counter-grid">
          <div class="stat-card">
            <span class="stat-label">Present</span>
            <div class="stat-value text-success tabular-nums">{{ sessionStats.presentCount }}</div>
            <span class="stat-meta">On time</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Late</span>
            <div class="stat-value text-warning tabular-nums">{{ sessionStats.lateCount }}</div>
            <span class="stat-meta">After grace</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Pending</span>
            <div class="stat-value tabular-nums">{{ sessionStats.pendingCount }}</div>
            <span class="stat-meta">Unchecked</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Expected</span>
            <div class="stat-value tabular-nums">{{ sessionStats.expectedCount }}</div>
            <span class="stat-meta">Total audience</span>
          </div>
        </div>

        <!-- Session Check-in Feed -->
        <section class="section-block">
          <div class="section-heading">
            <span>Session Scans</span>
            <button class="refresh-icon-btn" aria-label="Refresh" @click="refreshSessionData">
              <ion-icon :icon="refreshOutline" />
            </button>
          </div>

          <div v-if="recentLogs.length > 0" class="minimal-card activity-card">
            <div 
              v-for="(log, idx) in recentLogs" 
              :key="log.id" 
              class="activity-row"
              :class="{ 'row-border': idx < recentLogs.length - 1 }"
            >
              <div class="activity-icon-wrap" :class="'icon-' + log.result.toLowerCase()">
                <ion-icon :icon="log.result === 'ACCEPTED' ? checkmarkCircle : alertCircle" />
              </div>
              <div class="activity-details">
                <div class="activity-primary-line">
                  <span class="activity-student-name">{{ log.studentName || 'Card: ' + log.rfidUid }}</span>
                  <span class="activity-time font-mono">{{ formatTime(log.timestamp) }}</span>
                </div>
                <div class="activity-sub-line">
                  <span class="activity-note">{{ log.note || log.result }}</span>
                  <span class="status-badge" :class="log.result === 'ACCEPTED' ? 'badge-success' : 'badge-warning'">
                    {{ log.attendanceStatus || log.result }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="empty-state-box">
            <ion-icon :icon="peopleOutline" class="empty-state-icon" />
            <p class="empty-state-title">No Scans Recorded Yet</p>
            <p class="empty-state-sub">Taps for this session will show in real time.</p>
          </div>
        </section>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.header-right-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.circular-icon-btn-sm {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  color: var(--app-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: var(--app-shadow-card);
}

.circular-icon-btn-sm ion-icon {
  font-size: 16px;
}

.session-picker-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.picker-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.picker-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--app-text-secondary);
}

.select-box-wrap {
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  padding: 0 10px;
}

.clean-session-select {
  --padding-start: 4px;
  --padding-end: 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text-primary);
  border: none;
}

.neutral-info-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 12px;
}

.neutral-info-banner ion-icon {
  font-size: 20px;
  color: var(--app-text-muted);
  flex-shrink: 0;
}

.banner-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.banner-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-primary);
}

.banner-sub {
  font-size: 11px;
  color: var(--app-text-secondary);
}

.compact-pill-btn {
  padding: 6px 12px;
  border-radius: var(--app-pill-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.session-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--app-text-secondary);
  padding: 0 2px;
}

/* Hero Scanner Card */
.scanner-hero-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 28px 20px;
  gap: 16px;
  background: var(--app-surface);
  position: relative;
  overflow: hidden;
}

.scanner-circle-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
}

.sensor-circle {
  width: 90px;
  height: 90px;
  border-radius: 50%;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s ease;
}

.scanning-active .sensor-circle {
  background: var(--app-accent-soft);
  border-color: rgba(59, 130, 246, 0.4);
}

.nfc-hero-icon {
  font-size: 40px;
  color: var(--ion-color-primary);
}

.scanner-text-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.scanner-headline {
  font-size: 18px;
  font-weight: 650;
  color: var(--app-text-primary);
  margin: 0;
}

.scanner-instructions {
  font-size: 13px;
  color: var(--app-text-secondary);
  max-width: 280px;
  margin: 0;
  line-height: 1.4;
}

.scanner-action-row {
  width: 100%;
  max-width: 220px;
}

.scan-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 42px;
  border-radius: var(--app-btn-radius);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.scan-toggle-btn:active {
  transform: scale(0.97);
}

.btn-primary {
  background: var(--ion-color-primary);
  color: #ffffff;
  box-shadow: 0 2px 10px rgba(59, 130, 246, 0.3);
}

.btn-mint-action {
  background: var(--aurora-mint);
  color: #0A261D;
  font-weight: 700;
  box-shadow: 0 4px 16px rgba(112, 243, 207, 0.38);
}

.btn-subtle {
  background: var(--app-surface-subtle);
  color: var(--app-text-secondary);
  border: 1px solid var(--app-border);
}

/* Scan Result Surface */
.scan-result-surface {
  border-left: 4px solid var(--ion-color-primary);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.scan-result-surface.result-accepted {
  border-left-color: var(--aurora-mint);
}

.scan-result-surface.result-duplicate {
  border-left-color: var(--ion-color-warning);
}

.scan-result-surface.result-unregistered,
.scan-result-surface.result-invalid,
.scan-result-surface.result-not_eligible {
  border-left-color: var(--ion-color-danger);
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.result-status-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.result-type-icon {
  font-size: 18px;
}

.result-accepted .result-type-icon { color: var(--ion-color-success); }
.result-duplicate .result-type-icon { color: var(--ion-color-warning); }
.result-unregistered .result-type-icon,
.result-invalid .result-type-icon,
.result-not_eligible .result-type-icon { color: var(--ion-color-danger); }

.result-badge {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.result-time {
  font-size: 11px;
  color: var(--app-text-muted);
}

.result-student-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.student-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--app-text-primary);
  margin: 0;
}

.student-meta-line {
  font-size: 13px;
  color: var(--app-text-secondary);
}

.uid-sub {
  font-size: 11px;
  color: var(--app-text-muted);
}

.result-detail-text {
  font-size: 13px;
  color: var(--app-text-secondary);
  margin: 0;
}

.result-cta-row {
  margin-top: 4px;
}

.primary-compact-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: var(--app-btn-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.stat-card {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--app-card-radius);
  padding: 12px 14px;
  box-shadow: var(--app-shadow-card);
}

.stat-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--app-text-secondary);
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--app-text-primary);
  line-height: 1.2;
}

.text-success { color: var(--ion-color-success); }
.text-warning { color: var(--ion-color-warning); }

.stat-meta {
  font-size: 10px;
  color: var(--app-text-muted);
}

.refresh-icon-btn {
  width: 34px;
  height: 34px;
  min-width: 34px;
  min-height: 34px;
  border-radius: 9px;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  color: var(--app-text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  cursor: pointer;
  padding: 0;
  box-sizing: border-box;
  transition: transform 0.15s ease, background 0.15s ease;
}

.refresh-icon-btn:active {
  transform: scale(0.92);
  background: var(--app-surface);
}

.refresh-icon-btn ion-icon {
  font-size: 17px;
  width: 17px;
  height: 17px;
}

.activity-card {
  padding: 0;
  overflow: hidden;
}

.activity-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
}

.row-border {
  border-bottom: 1px solid var(--app-border);
}

.activity-icon-wrap {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  flex-shrink: 0;
}

.icon-accepted {
  background: rgba(21, 154, 116, 0.1);
  color: var(--ion-color-success);
}

.icon-duplicate, .icon-invalid, .icon-unregistered, .icon-not_eligible {
  background: rgba(217, 149, 34, 0.12);
  color: var(--ion-color-warning);
}

.activity-details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.activity-primary-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.activity-student-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.activity-time {
  font-size: 11px;
  color: var(--app-text-muted);
}

.activity-sub-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.activity-note {
  font-size: 11px;
  color: var(--app-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ion-color-success);
  display: inline-block;
}
</style>
