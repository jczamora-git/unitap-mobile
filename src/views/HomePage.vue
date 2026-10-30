<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  onIonViewWillEnter
} from '@ionic/vue';
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
import { authService } from '@/services/auth.service';
import { useSyncStatus } from '@/composables/useSyncStatus';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import type { Semester } from '@/types/database';
import { formatPeso } from '@/utilities/finance-formatters';
import { formatTime, formatDate } from '@/utilities/date-formatters';
import type { Event, EventOccurrence } from '@/types/event';
import type { AttendanceStats, AttendanceScanLog } from '@/types/attendance';
import { haptics } from '@/utilities/haptics';
import { UniPageHeader, UniStatCard, UniButton } from '@/components/ui';

const router = useRouter();

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
const currentSemester = ref<Semester | null>(null);
const currentUserRole = computed(() => authService.role.value);
const currentUsername = computed(() => authService.user.value?.username || 'User');
const { state: syncState } = useSyncStatus();

async function handleLogout() {
  await authService.logout();
  router.replace('/login');
}

const recentActivity = ref<AttendanceScanLog[]>([]);
const isLoading = ref(true);

async function loadDashboardData() {
  isLoading.value = true;
  try {
    currentSemester.value = await AcademicRepository.getActiveSemester();
    // 1. Students
    const students = await studentService.getStudents();
    totalStudents.value = students.length;

    // 2. Events & Active Occurrence
    const events = await eventService.getEvents();
    activeEventsCount.value = events.filter(e => e.status === 'ACTIVE').length;

    const occurrences = await eventService.getOccurrences();
    const openOcc = occurrences.find(o => o.status === 'OPEN') || occurrences[0] || null;
    activeOccurrence.value = openOcc;

    if (openOcc) {
      activeEvent.value = events.find(e => e.id === openOcc.eventId) || null;
      occurrenceStats.value = await attendanceService.getStats(openOcc.id);
      recentActivity.value = (await attendanceService.getScanLogs(openOcc.id)).slice(0, 5);
    } else {
      activeEvent.value = null;
      occurrenceStats.value = null;
      recentActivity.value = (await attendanceService.getScanLogs()).slice(0, 5);
    }

    // 3. Finance
    const finSummary = await financeService.getFinanceSummary();
    totalOutstandingCentavos.value = finSummary.totalOutstandingCentavos;

    // 4. Checkins
    const allParticipants = await eventService.getParticipants();
    totalCheckIns.value = allParticipants.filter(p => p.attendanceStatus === 'PRESENT' || p.attendanceStatus === 'LATE').length;
  } catch (err) {
    console.error('Error loading dashboard data:', err);
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadDashboardData);
onIonViewWillEnter(loadDashboardData);
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="UniTap"
      subtitle="CSG operations & attendance"
      variant="root"
    >
      <template #trailing>
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
        <!-- User Session & Term Banner -->
        <div class="user-session-bar">
          <div class="user-info-side">
            <span class="user-badge" :class="currentUserRole?.toLowerCase()">
              {{ currentUserRole || 'DEVADMIN' }}
            </span>
            <span class="user-name-text">{{ currentUsername }}</span>
          </div>
          <div class="term-info-side">
            <button class="sync-pill" :class="'pill-' + syncState.toLowerCase()" @click="router.push('/sync-status')">
              <span class="sync-dot"></span> {{ syncState === 'SYNCED' ? 'Cloud Synced' : syncState }}
            </button>
            <span v-if="currentSemester" class="term-pill">
              📅 {{ currentSemester.term }} Term
            </span>
            <button class="btn-logout-link" @click="handleLogout">
              Sign Out
            </button>
          </div>
        </div>

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
              <div class="tile-icon-box">
                <ion-icon :icon="scanOutline" />
              </div>
              <span class="tile-label">Scan NFC</span>
            </button>

            <button class="quick-action-tile" @click="navigateWithHaptic('/finance/reports')">
              <div class="tile-icon-box">
                <ion-icon :icon="walletOutline" />
              </div>
              <span class="tile-label">Reports</span>
            </button>

            <button class="quick-action-tile" @click="navigateWithHaptic('/students/import')">
              <div class="tile-icon-box">
                <ion-icon :icon="peopleOutline" />
              </div>
              <span class="tile-label">Import CSV</span>
            </button>

            <button class="quick-action-tile" @click="navigateWithHaptic('/academic')">
              <div class="tile-icon-box">
                <ion-icon :icon="calendarOutline" />
              </div>
              <span class="tile-label">Terms</span>
            </button>

            <button class="quick-action-tile" @click="navigateWithHaptic('/events/create')">
              <div class="tile-icon-box">
                <ion-icon :icon="addOutline" />
              </div>
              <span class="tile-label">New Event</span>
            </button>

            <button class="quick-action-tile" @click="navigateWithHaptic('/register-student')">
              <div class="tile-icon-box">
                <ion-icon :icon="personAddOutline" />
              </div>
              <span class="tile-label">Add Student</span>
            </button>

            <button class="quick-action-tile" @click="navigateWithHaptic('/finance/pay')">
              <div class="tile-icon-box">
                <ion-icon :icon="flashOutline" />
              </div>
              <span class="tile-label">Pay Fee</span>
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
                    {{ item.attendanceStatus || item.result }}
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
  background: var(--aurora-mint);
  color: #0B251D;
  border: none;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(112, 243, 207, 0.38);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.aurora-scan-btn:active {
  transform: scale(0.985);
  box-shadow: 0 2px 8px rgba(112, 243, 207, 0.25);
}

.btn-nfc-icon {
  font-size: 18px;
}

.session-empty-aurora {
  padding: 22px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
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
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.quick-action-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 6px;
  border-radius: var(--app-card-radius);
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  box-shadow: var(--app-shadow-card);
  cursor: pointer;
  transition: transform 0.15s ease;
}

.quick-action-tile:active {
  transform: scale(0.95);
}

.tile-featured-mint {
  border-color: rgba(112, 243, 207, 0.35);
  background: rgba(112, 243, 207, 0.05);
}

.tile-featured-mint .tile-icon-box {
  background: rgba(112, 243, 207, 0.18);
  color: var(--aurora-mint);
  box-shadow: 0 0 12px rgba(112, 243, 207, 0.25);
}

.tile-icon-box {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: var(--app-surface-subtle);
  color: var(--ion-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.session-action-wrap {
  display: flex;
  align-items: center;
  margin-top: 4px;
}

.tile-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--app-text-primary);
  white-space: nowrap;
}

@media (max-width: 360px) {
  .quick-actions-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
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
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.icon-accepted {
  background: rgba(21, 154, 116, 0.1);
  color: var(--ion-color-success);
}

.icon-duplicate, .icon-invalid, .icon-unregistered {
  background: rgba(217, 149, 34, 0.12);
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

/* User Session Bar */
.user-session-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #ffffff;
  border: 1px solid var(--uni-border, #CBD5E1);
  border-radius: 12px;
  padding: 8px 14px;
  margin-bottom: 16px;
  font-size: 12px;
}

.user-info-side {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-badge {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 6px;
  text-transform: uppercase;
}

.user-badge.devadmin {
  background: #fef2f2;
  color: #b91c1c;
}

.user-badge.officer {
  background: #f0fdf4;
  color: #15803d;
}

.user-badge.student {
  background: #f0f9ff;
  color: #0369a1;
}

.user-name-text {
  font-weight: 700;
  color: var(--uni-ink, #0F172A);
}

.term-info-side {
  display: flex;
  align-items: center;
  gap: 10px;
}

.term-pill {
  color: var(--uni-muted, #64748B);
  font-weight: 600;
}

.btn-logout-link {
  background: none;
  border: 0;
  color: var(--uni-danger, #B91C1C);
  font-weight: 700;
  cursor: pointer;
  padding: 0;
}

.sync-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  text-transform: uppercase;
}

.sync-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
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
</style>
