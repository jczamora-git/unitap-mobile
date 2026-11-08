<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  onIonViewWillEnter
} from '@ionic/vue';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import StudentHomeView from '@/components/student/StudentHomeView.vue';
import {
  peopleOutline,
  calendarOutline,
  scanOutline,
  walletOutline,
  personAddOutline,
  addOutline,
  settingsOutline,
  checkmarkCircle,
  timeOutline,
  flashOutline,
  radioOutline
} from 'ionicons/icons';
import { studentService } from '@/services/student.service';
import { eventService } from '@/services/event.service';
import { attendanceService } from '@/services/attendance.service';
import { financeService } from '@/services/finance.service';
import { formatPeso } from '@/utilities/finance-formatters';
import { formatTime, formatDate } from '@/utilities/date-formatters';
import { formatAttendanceStatus } from '@/utilities/presentation-formatters';
import type { Event, EventOccurrence } from '@/types/event';
import type { AttendanceStats, AttendanceScanLog } from '@/types/attendance';
import { haptics } from '@/utilities/haptics';
import { UniPageHeader, UniStatCard, UniButton } from '@/components/ui';
import UniGlobalSyncPill from '@/components/shared/UniGlobalSyncPill.vue';
import { logDataSource } from '@/utilities/data-source-logger';
import { DataModeService } from '@/services/data-mode.service';

const router = useRouter();

const isStudent = computed(() => {
  const role = authService.role.value || SupabaseAuthService.role.value;
  return role === 'STUDENT';
});

function navigateWithHaptic(path: string) {
  haptics.light();
  router.push(path);
}

function navigateToAttendance() {
  haptics.light();
  if (activeOccurrence.value) {
    router.push(`/events/attendance/${activeOccurrence.value.id}`);
  } else {
    router.push('/tabs/events');
  }
}

const totalStudents = ref(0);
const activeEventsCount = ref(0);
const totalCheckIns = ref(0);
const totalOutstandingCentavos = ref(0);

const activeEvent = ref<Event | null>(null);
const activeOccurrence = ref<EventOccurrence | null>(null);
const occurrenceStats = ref<AttendanceStats | null>(null);

const recentActivity = ref<AttendanceScanLog[]>([]);
const isLoading = ref(true);

async function loadDashboardData() {
  if (isStudent.value) {
    isLoading.value = false;
    return;
  }
  isLoading.value = true;
  const isDirect = DataModeService.isDirectSupabase();
  const source = isDirect ? 'Supabase' : 'SQLite';

  // 1. Students KPI
  try {
    const students = await studentService.getStudents();
    totalStudents.value = students.length;
    logDataSource({
      page: 'HomePage',
      source,
      operation: 'KPI: totalStudents',
      result: students.length,
    });
  } catch (stuErr) {
    console.error('Error loading students KPI:', stuErr);
  }

  // 2. Events & Active Occurrence KPI
  try {
    const events = await eventService.getEvents();
    activeEventsCount.value = events.filter((e) => e.status === 'ACTIVE').length;

    const occurrences = await eventService.getOccurrences();
    const openOcc = occurrences.find((o) => o.status === 'OPEN') || occurrences[0] || null;
    activeOccurrence.value = openOcc;

    if (openOcc) {
      activeEvent.value = events.find((e) => e.id === openOcc.eventId) || null;
      occurrenceStats.value = await attendanceService.getStats(openOcc.id);
      recentActivity.value = (await attendanceService.getScanLogs(openOcc.id)).slice(0, 5);
    } else {
      activeEvent.value = null;
      occurrenceStats.value = null;
      recentActivity.value = (await attendanceService.getScanLogs()).slice(0, 5);
    }
    logDataSource({
      page: 'HomePage',
      source,
      operation: 'KPI: events & occurrences',
      result: events.length,
    });
  } catch (evtErr) {
    console.error('Error loading events KPI:', evtErr);
  }

  // 3. Finance KPI
  try {
    const finSummary = await financeService.getFinanceSummary();
    totalOutstandingCentavos.value = finSummary.totalOutstandingCentavos;
    logDataSource({
      page: 'HomePage',
      source,
      operation: 'KPI: financeSummary',
      result: finSummary.totalOutstandingCentavos,
    });
  } catch (finErr) {
    console.error('Error loading finance KPI:', finErr);
  }

  // 4. Checkins KPI
  try {
    const allParticipants = await eventService.getParticipants();
    totalCheckIns.value = allParticipants.filter(
      (p) => p.attendanceStatus === 'PRESENT' || p.attendanceStatus === 'LATE'
    ).length;
    logDataSource({
      page: 'HomePage',
      source,
      operation: 'KPI: checkIns',
      result: totalCheckIns.value,
    });
  } catch (checkErr) {
    console.error('Error loading checkins KPI:', checkErr);
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadDashboardData);
onIonViewWillEnter(loadDashboardData);
</script>

<template>
  <ion-page>
    <!-- 1. STUDENT PORTAL DASHBOARD (MONITORING ONLY) -->
    <StudentHomeView v-if="isStudent" />

    <!-- 2. OFFICER / DEVADMIN WORKSPACE -->
    <template v-else>
      <UniPageHeader
        title="UniTap"
        subtitle="CSG operations & attendance"
        variant="root"
      >
      <template #trailing>
        <UniGlobalSyncPill style="margin-right: 6px;" />
        <button 
          class="uni-header-action-btn" 
          aria-label="Settings & Diagnostics" 
          @click="navigateWithHaptic('/settings')"
        >
          <ion-icon :icon="settingsOutline" />
        </button>
      </template>
    </UniPageHeader>

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- 2x2 Metric Grid -->
        <section class="metrics-grid">
          <UniStatCard
            label="Students"
            :value="totalStudents"
            meta="Registered"
            :icon="peopleOutline"
            icon-color="mint"
            @click="navigateWithHaptic('/tabs/students')"
          />

          <UniStatCard
            label="Active Events"
            :value="activeEventsCount"
            meta="Ongoing"
            :icon="calendarOutline"
            icon-color="blue"
            @click="navigateWithHaptic('/tabs/events')"
          />

          <UniStatCard
            label="Check-ins"
            :value="totalCheckIns"
            meta="Verified"
            :icon="scanOutline"
            icon-color="violet"
            @click="navigateWithHaptic('/tabs/scan')"
          />

          <UniStatCard
            label="Outstanding"
            :value="formatPeso(totalOutstandingCentavos)"
            meta="Unpaid fees"
            :icon="walletOutline"
            icon-color="amber"
            @click="navigateWithHaptic('/tabs/finance')"
          />
        </section>

        <!-- Active Attendance Session (Aurora Focal Point) -->
        <section class="section-block">
          <div class="section-heading">
            <span>Attendance Session</span>
            <span v-if="activeOccurrence?.status === 'OPEN'" class="status-badge badge-aurora-mint">
              <span class="pulse-dot"></span> Live Open
            </span>
          </div>

          <div v-if="activeOccurrence && activeEvent" class="aurora-card session-aurora-card">
            <div class="session-header-row">
              <div class="session-title-wrap">
                <span class="hero-overline">
                  <span class="pulse-dot"></span> Active Session
                </span>
                <h3 class="hero-title">{{ activeEvent.title }}</h3>
                <p class="hero-sub">
                  {{ formatDate(activeOccurrence.date) }} • {{ formatTime(activeOccurrence.startTime) }} - {{ formatTime(activeOccurrence.endTime) }}
                </p>
              </div>
              <span class="status-badge badge-aurora-mint font-mono">
                {{ activeOccurrence.status }}
              </span>
            </div>

            <!-- Progress -->
            <div v-if="occurrenceStats" class="progress-section">
              <div class="progress-info">
                <span class="aurora-progress-sub">
                  {{ occurrenceStats.checkedInCount }} of {{ occurrenceStats.expectedCount }} checked in
                </span>
                <span class="aurora-progress-pct tabular-nums font-mono">
                  {{ occurrenceStats.expectedCount > 0 ? Math.round((occurrenceStats.checkedInCount / occurrenceStats.expectedCount) * 100) : 0 }}%
                </span>
              </div>
              <div class="aurora-progress-track">
                <div 
                  class="aurora-progress-fill" 
                  :style="{ width: `${occurrenceStats.expectedCount > 0 ? Math.round((occurrenceStats.checkedInCount / occurrenceStats.expectedCount) * 100) : 0}%` }"
                ></div>
              </div>
              <div class="stat-pills">
                <span class="micro-pill pill-present">✓ Present: {{ occurrenceStats.presentCount }}</span>
                <span class="micro-pill pill-late">⏱ Late: {{ occurrenceStats.lateCount }}</span>
                <span class="micro-pill pill-pending">⌛ Pending: {{ occurrenceStats.pendingCount }}</span>
              </div>
            </div>

            <UniButton 
              variant="primary" 
              :icon="radioOutline" 
              block 
              @click="navigateToAttendance"
            >
              Open Attendance
            </UniButton>
          </div>

          <div v-else class="aurora-card aurora-variant-mint session-empty-aurora">
            <div class="empty-aurora-content">
              <span class="hero-overline">
                <span class="mint-indicator"></span> CSG Operations
              </span>
              <h3 class="hero-title">No active session</h3>
              <p class="hero-sub">Create or open an event to begin attendance.</p>
            </div>
            <div class="session-action-wrap">
              <UniButton 
                variant="primary" 
                :icon="addOutline" 
                @click="router.push('/events/create')"
              >
                Create Event
              </UniButton>
            </div>
          </div>
        </section>

        <!-- Quick Actions Panel -->
        <section class="section-block">
          <div class="section-heading">
            <span>Quick Actions</span>
          </div>

          <div class="quick-actions-row">
            <button class="quick-action-tile tile-featured-mint" @click="navigateWithHaptic('/tabs/scan')">
              <ion-icon :icon="scanOutline" class="tile-icon" />
              <span class="tile-label">Scan NFC</span>
            </button>

            <button class="quick-action-tile" @click="navigateWithHaptic('/finance/reports')">
              <ion-icon :icon="walletOutline" class="tile-icon" />
              <span class="tile-label">Reports</span>
            </button>

            <button class="quick-action-tile" @click="navigateWithHaptic('/students/import')">
              <ion-icon :icon="peopleOutline" class="tile-icon" />
              <span class="tile-label">Import Students</span>
            </button>

            <button class="quick-action-tile" @click="navigateWithHaptic('/academic')">
              <ion-icon :icon="calendarOutline" class="tile-icon" />
              <span class="tile-label">Academic Terms</span>
            </button>

            <button class="quick-action-tile" @click="navigateWithHaptic('/events/create')">
              <ion-icon :icon="addOutline" class="tile-icon" />
              <span class="tile-label">New Event</span>
            </button>

            <button class="quick-action-tile" @click="navigateWithHaptic('/register-student')">
              <ion-icon :icon="personAddOutline" class="tile-icon" />
              <span class="tile-label">Add Student</span>
            </button>

            <button class="quick-action-tile" @click="navigateWithHaptic('/finance/pay')">
              <ion-icon :icon="flashOutline" class="tile-icon" />
              <span class="tile-label">Record Payment</span>
            </button>
          </div>
        </section>

        <!-- Recent Scan Activity -->
        <section class="section-block">
          <div class="section-heading">
            <span>Recent Activity</span>
            <span v-if="recentActivity.length > 0" class="metadata-text">Last {{ recentActivity.length }} scans</span>
          </div>

          <div v-if="recentActivity.length > 0" class="minimal-card activity-card">
            <div v-for="(item, idx) in recentActivity" :key="item.id" class="activity-row" :class="{ 'row-border': idx < recentActivity.length - 1 }">
              <div class="activity-icon-wrap" :class="'icon-' + item.result.toLowerCase()">
                <ion-icon :icon="item.result === 'ACCEPTED' ? checkmarkCircle : timeOutline" />
              </div>
              <div class="activity-details">
                <div class="activity-primary-line">
                  <span class="activity-student-name">{{ item.studentName || 'Card ID: ' + item.rfidUid }}</span>
                  <span class="activity-time font-mono">{{ formatTime(item.timestamp) }}</span>
                </div>
                <div class="activity-sub-line">
                  <span class="activity-note">{{ item.note || item.result }}</span>
                  <span class="status-badge" :class="item.result === 'ACCEPTED' ? 'badge-success' : 'badge-warning'">
                    {{ formatAttendanceStatus(item.attendanceStatus || item.result) }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="empty-state-box">
            <ion-icon :icon="timeOutline" class="empty-state-icon" />
            <p class="empty-state-title">No Recent Activity</p>
            <p class="empty-state-sub">Student scans will appear here in real time.</p>
          </div>
        </section>
      </div>
    </ion-content>
    </template>
  </ion-page>
</template>

<style scoped>
.mint-glow-dot {
  color: var(--aurora-mint);
  text-shadow: 0 0 10px rgba(112, 243, 207, 0.6);
  margin-left: 1px;
}

.greeting-overline {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--app-text-secondary);
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.stat-card {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--app-card-radius);
  padding: 14px 16px;
  box-shadow: var(--app-shadow-card);
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.stat-card:active {
  transform: scale(0.985);
  border-color: var(--aurora-mint);
}

.stat-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.stat-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--app-text-secondary);
}

.metric-icon-box {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-box-mint {
  background: rgba(112, 243, 207, 0.14);
  color: var(--aurora-mint);
}
.icon-box-sky {
  background: rgba(101, 191, 255, 0.14);
  color: var(--aurora-sky);
}
.icon-box-iris {
  background: rgba(139, 133, 246, 0.14);
  color: var(--aurora-iris);
}
.icon-box-peach {
  background: rgba(255, 183, 143, 0.16);
  color: var(--aurora-peach);
}

.stat-icon {
  font-size: 16px;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--app-text-primary);
  line-height: 1.2;
}

.stat-meta {
  font-size: 11px;
  color: var(--app-text-muted);
}

/* Active Session Aurora Card */
.session-aurora-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.session-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.session-title-wrap {
  flex: 1;
}

.progress-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.aurora-progress-sub {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.76);
}

.aurora-progress-pct {
  font-size: 12px;
  font-weight: 600;
  color: var(--aurora-mint);
}

.aurora-progress-track {
  width: 100%;
  height: 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.14);
  overflow: hidden;
}

.aurora-progress-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--aurora-mint) 0%, var(--aurora-sky) 100%);
  transition: width 0.3s ease;
}

.stat-pills {
  display: flex;
  gap: 8px;
  margin-top: 2px;
  flex-wrap: wrap;
}

.micro-pill {
  font-size: 11px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(4px);
}

.pill-present {
  color: var(--aurora-mint);
  border: 1px solid rgba(112, 243, 207, 0.25);
}

.pill-late {
  color: var(--aurora-peach);
  border: 1px solid rgba(255, 183, 143, 0.25);
}

.pill-pending {
  color: rgba(255, 255, 255, 0.65);
}

.aurora-scan-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 44px;
  border-radius: 14px;
  background: var(--uni-btn-primary-bg, #0F766E);
  color: #FFFFFF;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: none;
  transition: transform 0.15s ease;
}

:root.dark .aurora-scan-btn,
:root.ion-palette-dark .aurora-scan-btn {
  background: var(--uni-btn-primary-bg, #0D9488);
  color: #FFFFFF;
  box-shadow: none;
}

.aurora-scan-btn:active {
  transform: scale(0.985);
  box-shadow: none;
}

.btn-nfc-icon {
  font-size: 18px;
}

.session-empty-aurora {
  padding: 22px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--uni-surface, #FFFFFF);
  border: 1px solid var(--uni-border, #E2E8F0);
  border-radius: var(--uni-radius-hero, 22px);
  box-shadow: var(--uni-shadow-card, 0 4px 18px rgba(0, 0, 0, 0.04));
}

:root.dark .session-empty-aurora,
:root.ion-palette-dark .session-empty-aurora {
  background: linear-gradient(135deg, #092620 0%, #0c1e22 55%, #101925 100%);
  border: 1px solid rgba(94, 234, 212, 0.18);
  border-top: 1px solid rgba(94, 234, 212, 0.3);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
}

.empty-aurora-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-scan-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 44px;
  border-radius: var(--app-btn-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.session-scan-btn:active {
  opacity: 0.92;
  transform: scale(0.99);
}

.arrow-end {
  font-size: 14px;
  margin-left: 2px;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ion-color-success);
  display: inline-block;
  box-shadow: 0 0 0 3px rgba(21, 154, 116, 0.25);
}

/* Quick Actions */
.quick-actions-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

@media (max-width: 380px) {
  .quick-actions-row {
    gap: 8px;
  }
}

@media (min-width: 600px) {
  .quick-actions-row {
    grid-template-columns: repeat(4, 1fr);
  }
}

.quick-actions-row .quick-action-tile:last-child:nth-child(odd) {
  grid-column: 1 / -1;
  flex-direction: row;
  justify-content: center;
  gap: 10px;
  padding: 12px 14px;
}

.quick-action-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 8px;
  border-radius: var(--app-card-radius, 16px);
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  box-shadow: var(--app-shadow-card);
  cursor: pointer;
  transition: transform 0.15s ease;
}

.quick-action-tile:active {
  transform: scale(0.96);
}

.tile-icon {
  font-size: 24px;
  color: var(--uni-primary);
  display: block;
}

.tile-featured-mint {
  border-color: rgba(15, 118, 110, 0.28);
}

:root.dark .tile-featured-mint,
:root.ion-palette-dark .tile-featured-mint {
  border-color: rgba(94, 234, 212, 0.35);
}

.session-action-wrap {
  display: flex;
  align-items: center;
  margin-top: 4px;
}

.tile-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--app-text-primary);
  text-align: center;
  line-height: 1.25;
}

/* Recent Activity */
.activity-card {
  padding: 0;
  overflow: hidden;
}

.activity-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.row-border {
  border-bottom: 1px solid var(--app-border);
}

.activity-icon-wrap {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
  background: transparent;
}

.icon-accepted {
  color: var(--ion-color-success);
}

.icon-duplicate, .icon-invalid, .icon-unregistered {
  color: var(--ion-color-warning);
}

.activity-details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
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
  font-size: 12px;
  color: var(--app-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.compact-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: var(--app-btn-radius);
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  color: var(--app-text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
</style>
