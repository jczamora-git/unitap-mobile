<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonContent,
  IonIcon,
  IonSpinner,
  onIonViewWillEnter,
} from '@ionic/vue';
import {
  calendarOutline,
  timeOutline,
  locationOutline,
  checkmarkCircle,
  alertCircleOutline,
  closeCircleOutline,
  chevronForwardOutline,
} from 'ionicons/icons';
import { useCurrentStudentPortal, type StudentPortalEventItem } from '@/composables/useCurrentStudentPortal';
import { formatDate, formatTime } from '@/utilities/date-formatters';
import { haptics } from '@/utilities/haptics';
import { UniPageHeader, UniSegmentedControl, UniEmptyState } from '@/components/ui';

const router = useRouter();
const {
  portalEvents,
  isLoading,
  attendedCount,
  missedCount,
  upcomingCount,
  loadPortalData,
} = useCurrentStudentPortal();

const activeFilter = ref<'ALL' | 'ATTENDED' | 'UPCOMING' | 'MISSED'>('ALL');

const filterOptions = computed(() => [
  { value: 'ALL', label: `All (${portalEvents.value.length})` },
  { value: 'ATTENDED', label: `Attended (${attendedCount.value})` },
  { value: 'UPCOMING', label: `Upcoming (${upcomingCount.value})` },
  { value: 'MISSED', label: `Missed (${missedCount.value})` },
]);

const filteredEvents = computed(() => {
  if (activeFilter.value === 'ATTENDED') {
    return portalEvents.value.filter((e) => e.status === 'PRESENT' || e.status === 'LATE');
  }
  if (activeFilter.value === 'UPCOMING') {
    return portalEvents.value.filter((e) => e.status === 'UPCOMING');
  }
  if (activeFilter.value === 'MISSED') {
    return portalEvents.value.filter((e) => e.status === 'ABSENT');
  }
  return portalEvents.value;
});

function onEventClick(eventId: string) {
  haptics.light();
  router.push(`/events/${eventId}`);
}

onMounted(() => {
  loadPortalData();
});

onIonViewWillEnter(() => {
  loadPortalData();
});
</script>

<template>
  <div class="student-events-wrapper">
    <UniPageHeader
      title="My Attendance"
      subtitle="CSG campus activities & personal scan logs"
      variant="root"
    />

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Filter Segment -->
        <UniSegmentedControl
          v-model="activeFilter"
          :options="filterOptions"
          size="sm"
        />

        <!-- Loading -->
        <div v-if="isLoading && portalEvents.length === 0" class="loading-state">
          <ion-spinner name="crescent" color="primary" />
          <p class="metadata-text">Loading attendance records...</p>
        </div>

        <!-- Event Cards -->
        <div v-else-if="filteredEvents.length > 0" class="events-list">
          <div
            v-for="ev in filteredEvents"
            :key="ev.occurrenceId"
            class="minimal-card event-item-card"
            @click="onEventClick(ev.eventId)"
          >
            <div class="event-item-top">
              <div class="event-info-main">
                <span class="event-name">{{ ev.eventTitle }}</span>
                <span class="occurrence-name">{{ ev.occurrenceTitle }}</span>
              </div>
              <div class="event-status-badge">
                <span
                  class="status-pill font-mono"
                  :class="{
                    'status-present': ev.status === 'PRESENT',
                    'status-late': ev.status === 'LATE',
                    'status-absent': ev.status === 'ABSENT',
                    'status-upcoming': ev.status === 'UPCOMING'
                  }"
                >
                  <ion-icon
                    :icon="
                      ev.status === 'PRESENT' ? checkmarkCircle :
                      ev.status === 'LATE' ? timeOutline :
                      ev.status === 'ABSENT' ? closeCircleOutline :
                      calendarOutline
                    "
                  />
                  {{ ev.status }}
                </span>
              </div>
            </div>

            <div class="event-item-meta">
              <div class="meta-row">
                <span class="meta-item">
                  <ion-icon :icon="calendarOutline" /> {{ formatDate(ev.date) }}
                </span>
                <span v-if="ev.startTime" class="meta-item font-mono">
                  <ion-icon :icon="timeOutline" /> {{ formatTime(ev.startTime) }}
                </span>
              </div>
              <span v-if="ev.venue" class="meta-item venue-item">
                <ion-icon :icon="locationOutline" /> {{ ev.venue }}
              </span>
            </div>

            <!-- Attendance check-in result info -->
            <div v-if="ev.checkedInAt" class="checkin-detail-box">
              <div class="checkin-time-info">
                <span class="checkin-label">Verified Tap:</span>
                <span class="checkin-timestamp font-mono">
                  {{ new Date(ev.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
                </span>
                <span v-if="ev.method" class="checkin-method font-mono">({{ ev.method }})</span>
              </div>
              <div class="details-chevron">
                <span>Details</span>
                <ion-icon :icon="chevronForwardOutline" />
              </div>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <UniEmptyState
          v-else
          :icon="calendarOutline"
          title="No events found"
          :description="
            activeFilter === 'ATTENDED' ? 'You have not attended any events yet.' :
            activeFilter === 'UPCOMING' ? 'No upcoming events currently scheduled.' :
            activeFilter === 'MISSED' ? 'Great! You have no recorded absences.' :
            'No campus events are currently registered.'
          "
        />
      </div>
    </ion-content>
  </div>
</template>

<style scoped>
.student-events-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.page-container {
  padding: 16px 20px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 600px;
  margin: 0 auto;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 20px;
  gap: 12px;
}

.metadata-text {
  font-size: 13px;
  color: var(--app-text-secondary, #949ba6);
}

.events-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.minimal-card {
  background: var(--uni-surface, #1b1d22);
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.07));
  border-radius: 16px;
}

.event-item-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.event-item-card:active {
  transform: scale(0.985);
  border-color: var(--aurora-mint, #70f3cf);
}

.event-item-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.event-info-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.event-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--app-text-primary, #f5f6f7);
  line-height: 1.25;
}

.occurrence-name {
  font-size: 12px;
  color: var(--app-text-secondary, #949ba6);
  margin-top: 2px;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 20px;
  text-transform: uppercase;
}

.status-present {
  background: rgba(112, 243, 207, 0.15);
  color: var(--aurora-mint, #70f3cf);
  border: 1px solid rgba(112, 243, 207, 0.3);
}

.status-late {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.status-absent {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.status-upcoming {
  background: rgba(101, 191, 255, 0.15);
  color: #38bdf8;
  border: 1px solid rgba(101, 191, 255, 0.3);
}

.event-item-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11.5px;
  color: var(--app-text-secondary, #949ba6);
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.venue-item {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.checkin-detail-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  margin-top: 2px;
}

.checkin-time-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
}

.checkin-label {
  color: var(--app-text-secondary, #949ba6);
}

.checkin-timestamp {
  font-weight: 700;
  color: var(--aurora-mint, #70f3cf);
}

.checkin-method {
  font-size: 10px;
  color: var(--app-text-secondary, #949ba6);
}

.details-chevron {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--aurora-mint, #70f3cf);
}
</style>

