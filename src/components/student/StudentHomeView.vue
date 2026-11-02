<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonContent,
  IonIcon,
  IonSpinner,
  onIonViewWillEnter,
} from '@ionic/vue';
import {
  checkmarkCircle,
  calendarOutline,
  walletOutline,
  cardOutline,
  settingsOutline,
  timeOutline,
  locationOutline,
  chevronForwardOutline,
  receiptOutline,
  flashOutline,
  sparklesOutline,
  shieldCheckmarkOutline,
} from 'ionicons/icons';
import { useCurrentStudentPortal } from '@/composables/useCurrentStudentPortal';
import { formatPeso } from '@/utilities/finance-formatters';
import { formatDate, formatTime } from '@/utilities/date-formatters';
import { haptics } from '@/utilities/haptics';
import { UniPageHeader, UniStatCard, UniButton } from '@/components/ui';
import UniGlobalSyncPill from '@/components/shared/UniGlobalSyncPill.vue';

const router = useRouter();
const {
  student,
  studentName,
  academicSummary,
  recentActivity,
  portalEvents,
  isLoading,
  outstandingBalanceCentavos,
  totalPaidCentavos,
  attendedCount,
  upcomingCount,
  attendanceRate,
  loadPortalData,
} = useCurrentStudentPortal();

function navigate(path: string) {
  haptics.light();
  router.push(path);
}

onMounted(() => {
  loadPortalData();
});

onIonViewWillEnter(() => {
  loadPortalData();
});
</script>

<template>
  <div class="student-portal-wrapper">
    <UniPageHeader
      title="Student Portal"
      :subtitle="studentName ? `Welcome back, ${studentName}` : 'Student monitoring dashboard'"
      variant="root"
    >
      <template #trailing>
        <UniGlobalSyncPill style="margin-right: 6px;" />
        <button
          class="uni-header-action-btn"
          aria-label="Settings"
          @click="navigate('/settings')"
        >
          <ion-icon :icon="settingsOutline" />
        </button>
      </template>
    </UniPageHeader>

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- 1. STUDENT IDENTITY DIGITAL PASS BANNER -->
        <section class="student-card-section">
          <div class="aurora-card student-hero-card" @click="navigate('/tabs/pass')">
            <div class="card-inner-top">
              <div class="identity-badge-row">
                <span class="hero-overline font-mono">
                  <span class="pulse-dot"></span> CSG STUDENT PASS
                </span>
                <span class="role-pill-student font-mono">STUDENT</span>
              </div>
              <h2 class="student-display-name">{{ studentName }}</h2>
              <div class="student-id-row">
                <span class="school-id-pill font-mono">{{ student?.studentNumber || 'MCC STUDENT' }}</span>
                <span v-if="academicSummary" class="academic-text">{{ academicSummary }}</span>
              </div>
            </div>

            <div class="card-inner-bottom">
              <div class="card-status-info">
                <div class="nfc-chip-indicator" :class="{ 'is-active': student?.rfidUid }">
                  <ion-icon :icon="student?.rfidUid ? flashOutline : cardOutline" />
                </div>
                <div class="chip-status-text">
                  <span class="chip-label">{{ student?.rfidUid ? 'NFC Pass Linked & Active' : 'No NFC Card Linked' }}</span>
                  <span class="chip-sub font-mono">{{ student?.rfidUid ? `UID: ${student.rfidUid}` : 'Tap with officer to pair' }}</span>
                </div>
              </div>
              <div class="view-pass-btn">
                <span>View Pass</span>
                <ion-icon :icon="chevronForwardOutline" />
              </div>
            </div>
          </div>
        </section>

        <!-- 2. PERSONAL METRICS 2x2 GRID -->
        <section class="metrics-grid">
          <UniStatCard
            label="Attendance Rate"
            :value="`${attendanceRate}%`"
            :meta="`${attendedCount} Sessions Attended`"
            :icon="checkmarkCircle"
            icon-color="mint"
            @click="navigate('/tabs/events')"
          />

          <UniStatCard
            label="Balance / Dues"
            :value="formatPeso(outstandingBalanceCentavos)"
            :meta="outstandingBalanceCentavos === 0 ? 'All Clear • No Dues' : 'Unpaid Obligations'"
            :icon="walletOutline"
            icon-color="amber"
            @click="navigate('/tabs/finance')"
          />

          <UniStatCard
            label="Total Payments"
            :value="formatPeso(totalPaidCentavos)"
            meta="Verified Contributions"
            :icon="receiptOutline"
            icon-color="blue"
            @click="navigate('/tabs/finance')"
          />

          <UniStatCard
            label="Upcoming Events"
            :value="upcomingCount"
            meta="Scheduled Activities"
            :icon="calendarOutline"
            icon-color="violet"
            @click="navigate('/tabs/events')"
          />
        </section>

        <!-- 3. UPCOMING CAMPUS EVENTS -->
        <section class="section-block">
          <div class="section-heading">
            <span>Upcoming Activities</span>
            <span class="heading-action" @click="navigate('/tabs/events')">View All</span>
          </div>

          <div v-if="portalEvents.filter(e => e.status === 'UPCOMING').length > 0" class="events-stack">
            <div
              v-for="ev in portalEvents.filter(e => e.status === 'UPCOMING').slice(0, 2)"
              :key="ev.occurrenceId"
              class="minimal-card event-monitoring-card"
              @click="navigate(`/events/${ev.eventId}`)"
            >
              <div class="event-card-left">
                <div class="event-date-badge">
                  <span class="date-month">{{ formatDate(ev.date).split(' ')[0] }}</span>
                  <span class="date-day">{{ formatDate(ev.date).split(' ')[1]?.replace(',', '') }}</span>
                </div>
                <div class="event-details">
                  <h4 class="event-title">{{ ev.eventTitle }}</h4>
                  <p class="event-sub">{{ ev.occurrenceTitle }}</p>
                  <div class="event-meta-row">
                    <span class="meta-item font-mono" v-if="ev.startTime">
                      <ion-icon :icon="timeOutline" /> {{ formatTime(ev.startTime) }}
                    </span>
                    <span class="meta-item" v-if="ev.venue">
                      <ion-icon :icon="locationOutline" /> {{ ev.venue }}
                    </span>
                  </div>
                </div>
              </div>
              <div class="event-status-wrap">
                <span class="badge-status badge-upcoming">Upcoming</span>
              </div>
            </div>
          </div>

          <div v-else class="minimal-card empty-event-box">
            <ion-icon :icon="calendarOutline" class="empty-icon" />
            <div class="empty-text">
              <span class="empty-title">No upcoming events scheduled</span>
              <span class="empty-sub">Check back later for newly announced CSG activities.</span>
            </div>
          </div>
        </section>

        <!-- 4. RECENT ACTIVITY FEED (MONITORING) -->
        <section class="section-block">
          <div class="section-heading">
            <span>Recent Activity</span>
          </div>

          <div v-if="recentActivity.length > 0" class="activity-list minimal-card">
            <div
              v-for="(act, index) in recentActivity"
              :key="act.id"
              class="activity-row"
            >
              <div class="activity-icon-wrap" :class="act.type === 'ATTENDANCE' ? 'icon-att' : 'icon-pay'">
                <ion-icon :icon="act.type === 'ATTENDANCE' ? checkmarkCircle : walletOutline" />
              </div>
              <div class="activity-content">
                <div class="activity-title-row">
                  <span class="act-title">{{ act.title }}</span>
                  <span v-if="act.status" class="act-badge font-mono" :class="act.badgeClass">
                    {{ act.status }}
                  </span>
                </div>
                <div class="activity-meta-row">
                  <span class="act-sub">{{ act.subtitle }}</span>
                  <span class="act-time">{{ formatDate(act.date) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="minimal-card empty-activity-box">
            <ion-icon :icon="receiptOutline" class="empty-icon" />
            <span class="empty-title">No activity recorded yet</span>
            <span class="empty-sub">Your attendance scans and payment receipts will appear here.</span>
          </div>
        </section>

        <!-- 5. STUDENT QUICK SHORTCUTS -->
        <section class="section-block shortcuts-section">
          <div class="section-heading">
            <span>Quick Shortcuts</span>
          </div>

          <div class="shortcuts-grid">
            <button class="shortcut-tile tile-pass" @click="navigate('/tabs/pass')">
              <div class="shortcut-icon-box">
                <ion-icon :icon="cardOutline" />
              </div>
              <span class="shortcut-label">My Digital Pass</span>
              <span class="shortcut-sub">Smart NFC Card</span>
            </button>

            <button class="shortcut-tile tile-attendance" @click="navigate('/tabs/events')">
              <div class="shortcut-icon-box">
                <ion-icon :icon="calendarOutline" />
              </div>
              <span class="shortcut-label">Attendance</span>
              <span class="shortcut-sub">Logs &amp; Status</span>
            </button>

            <button class="shortcut-tile tile-dues" @click="navigate('/tabs/finance')">
              <div class="shortcut-icon-box">
                <ion-icon :icon="walletOutline" />
              </div>
              <span class="shortcut-label">Dues &amp; Ledger</span>
              <span class="shortcut-sub">Fees &amp; Receipts</span>
            </button>

            <button class="shortcut-tile tile-settings" @click="navigate('/settings')">
              <div class="shortcut-icon-box">
                <ion-icon :icon="settingsOutline" />
              </div>
              <span class="shortcut-label">Account</span>
              <span class="shortcut-sub">Theme &amp; Status</span>
            </button>
          </div>
        </section>
      </div>
    </ion-content>
  </div>
</template>

<style scoped>
.student-portal-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.page-container {
  padding: 16px 20px 48px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 600px;
  margin: 0 auto;
}

/* 1. Student Hero Pass Card */
.student-hero-card {
  border-radius: 20px;
  padding: 20px;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.16) 0%, rgba(6, 78, 59, 0.28) 50%, rgba(15, 23, 42, 0.4) 100%),
              var(--uni-surface, #1b1d22);
  border: 1px solid rgba(112, 243, 207, 0.25);
  box-shadow: 0 10px 30px -10px rgba(112, 243, 207, 0.15);
}

.student-hero-card:active {
  transform: scale(0.985);
}

.identity-badge-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.hero-overline {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--aurora-mint, #70f3cf);
  display: flex;
  align-items: center;
  gap: 6px;
}

.pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--aurora-mint, #70f3cf);
  box-shadow: 0 0 8px var(--aurora-mint, #70f3cf);
}

.role-pill-student {
  font-size: 10.5px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 20px;
  background: rgba(14, 165, 233, 0.16);
  color: #38bdf8;
  border: 1px solid rgba(14, 165, 233, 0.3);
}

.student-display-name {
  font-size: 22px;
  font-weight: 800;
  color: var(--app-text-primary, #f5f6f7);
  margin: 0 0 6px 0;
  line-height: 1.2;
}

.student-id-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
}

.school-id-pill {
  font-size: 12px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--app-text-primary, #f5f6f7);
}

.academic-text {
  font-size: 12px;
  color: var(--app-text-secondary, #949ba6);
}

.card-inner-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.card-status-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.nfc-chip-indicator {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  color: var(--app-text-secondary, #949ba6);
  font-size: 16px;
}

.nfc-chip-indicator.is-active {
  background: rgba(112, 243, 207, 0.15);
  color: var(--aurora-mint, #70f3cf);
  box-shadow: 0 0 10px rgba(112, 243, 207, 0.2);
}

.chip-status-text {
  display: flex;
  flex-direction: column;
}

.chip-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text-primary, #f5f6f7);
}

.chip-sub {
  font-size: 10.5px;
  color: var(--app-text-secondary, #949ba6);
}

.view-pass-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--aurora-mint, #70f3cf);
}

/* 2. Metrics Grid */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

/* 3. Section Blocks */
.section-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 700;
  color: var(--app-text-primary, #f5f6f7);
  padding: 0 2px;
}

.heading-action {
  font-size: 12px;
  font-weight: 600;
  color: var(--aurora-mint, #70f3cf);
  cursor: pointer;
}

/* Minimal Card Base */
.minimal-card {
  background: var(--uni-surface, #1b1d22);
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.07));
  border-radius: 16px;
}

/* Event Cards */
.events-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.event-monitoring-card {
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.event-monitoring-card:active {
  transform: scale(0.985);
  border-color: var(--aurora-mint, #70f3cf);
}

.event-card-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.event-date-badge {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(139, 133, 246, 0.12);
  color: var(--aurora-iris, #8b85f6);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.date-month {
  font-size: 9.5px;
  font-weight: 800;
  text-transform: uppercase;
}

.date-day {
  font-size: 16px;
  font-weight: 800;
  line-height: 1;
}

.event-details {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.event-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--app-text-primary, #f5f6f7);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.event-sub {
  font-size: 11.5px;
  color: var(--app-text-secondary, #949ba6);
  margin: 2px 0 4px 0;
}

.event-meta-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--app-text-secondary, #949ba6);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 3px;
}

.badge-status {
  font-size: 10.5px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 20px;
}

.badge-upcoming {
  background: rgba(101, 191, 255, 0.14);
  color: #38bdf8;
  border: 1px solid rgba(101, 191, 255, 0.3);
}

.empty-event-box,
.empty-activity-box {
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
}

.empty-icon {
  font-size: 32px;
  color: var(--app-text-secondary, #949ba6);
  margin-bottom: 4px;
}

.empty-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--app-text-primary, #f5f6f7);
}

.empty-sub {
  font-size: 11.5px;
  color: var(--app-text-secondary, #949ba6);
  max-width: 300px;
}

/* Activity List */
.activity-list {
  padding: 4px 16px;
}

.activity-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--uni-border, rgba(255, 255, 255, 0.05));
}

.activity-row:last-child {
  border-bottom: none;
}

.activity-icon-wrap {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  flex-shrink: 0;
}

.icon-att {
  background: rgba(112, 243, 207, 0.12);
  color: var(--aurora-mint, #70f3cf);
}

.icon-pay {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
}

.activity-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.activity-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.act-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--app-text-primary, #f5f6f7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.act-badge {
  font-size: 9.5px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.badge-aurora-mint {
  background: rgba(112, 243, 207, 0.15);
  color: var(--aurora-mint, #70f3cf);
}

.badge-warning {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.badge-success {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.badge-danger {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.activity-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--app-text-secondary, #949ba6);
}

.act-sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.act-time {
  flex-shrink: 0;
}

/* Shortcuts Grid */
.shortcuts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.shortcut-tile {
  background: var(--uni-surface, #1b1d22);
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.07));
  border-radius: 14px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.shortcut-tile:active {
  transform: scale(0.975);
  border-color: var(--aurora-mint, #70f3cf);
}

.shortcut-icon-box {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  margin-bottom: 8px;
}

.tile-pass .shortcut-icon-box {
  background: rgba(112, 243, 207, 0.14);
  color: var(--aurora-mint, #70f3cf);
}

.tile-attendance .shortcut-icon-box {
  background: rgba(101, 191, 255, 0.14);
  color: #38bdf8;
}

.tile-dues .shortcut-icon-box {
  background: rgba(245, 158, 11, 0.14);
  color: #f59e0b;
}

.tile-settings .shortcut-icon-box {
  background: rgba(139, 133, 246, 0.14);
  color: var(--aurora-iris, #8b85f6);
}

.shortcut-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--app-text-primary, #f5f6f7);
}

.shortcut-sub {
  font-size: 10.5px;
  color: var(--app-text-secondary, #949ba6);
}
</style>

