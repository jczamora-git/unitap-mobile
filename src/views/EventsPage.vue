<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonContent,
  IonIcon,
  IonSpinner,
  onIonViewWillEnter
} from '@ionic/vue';
import {
  addOutline,
  calendarOutline,
  peopleOutline,
  chevronForwardOutline,
  radioButtonOnOutline,
  timeOutline
} from 'ionicons/icons';
import { eventService } from '@/services/event.service';
import type { Event, EventOccurrence } from '@/types/event';
import { formatDate } from '@/utilities/date-formatters';
import { haptics } from '@/utilities/haptics';
import { 
  UniPageHeader, 
  UniButton, 
  UniSegmentedControl, 
  UniEmptyState 
} from '@/components/ui';

const router = useRouter();
const events = ref<Event[]>([]);
const occurrencesByEvent = ref<Record<string, EventOccurrence[]>>({});
const filterSegment = ref<'ALL' | 'ACTIVE' | 'COMPLETED'>('ALL');
const isLoading = ref(true);

function setFilter(filter: 'ALL' | 'ACTIVE' | 'COMPLETED') {
  haptics.light();
  filterSegment.value = filter;
}

function onEventClick(id: string) {
  haptics.light();
  router.push(`/events/${id}`);
}

async function loadEvents() {
  isLoading.value = true;
  try {
    const list = await eventService.getEvents();
    events.value = list;

    const occMap: Record<string, EventOccurrence[]> = {};
    for (const ev of list) {
      occMap[ev.id] = await eventService.getOccurrences(ev.id);
    }
    occurrencesByEvent.value = occMap;
  } catch (err) {
    console.error('Error loading events:', err);
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadEvents);
onIonViewWillEnter(loadEvents);

function formatAudience(ev: Event): string {
  if (ev.audience.type === 'ALL_BSIT') return 'All BSIT Students';
  if (ev.audience.type === 'YEAR_LEVEL') {
    return (ev.audience.yearLevels || []).map(y => `${y}th Year`).join(', ');
  }
  if (ev.audience.type === 'SECTION') {
    return (ev.audience.sections || []).join(', ');
  }
  return 'Custom Audience';
}

function filteredEvents() {
  if (filterSegment.value === 'ACTIVE') {
    return events.value.filter(e => e.status === 'ACTIVE');
  }
  if (filterSegment.value === 'COMPLETED') {
    return events.value.filter(e => e.status === 'COMPLETED');
  }
  return events.value;
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Events"
      subtitle="Manage CSG activities"
      variant="root"
    >
      <template #trailing>
        <UniButton
          size="sm"
          :icon="addOutline"
          @click="router.push('/events/create')"
        >
          Add Event
        </UniButton>
      </template>
    </UniPageHeader>

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Segment Filters -->
        <UniSegmentedControl
          v-model="filterSegment"
          :options="[
            { value: 'ALL', label: `All (${events.length})` },
            { value: 'ACTIVE', label: `Active (${events.filter(e => e.status === 'ACTIVE').length})` },
            { value: 'COMPLETED', label: `Completed (${events.filter(e => e.status === 'COMPLETED').length})` }
          ]"
          size="sm"
        />

        <!-- Loading -->
        <div v-if="isLoading && events.length === 0" class="loading-state">
          <ion-spinner name="crescent" color="primary" />
          <p class="metadata-text">Loading events...</p>
        </div>

        <!-- Event List -->
        <div v-else-if="filteredEvents().length > 0" class="events-list">
          <div 
            v-for="ev in filteredEvents()" 
            :key="ev.id" 
            class="event-item minimal-card minimal-card-interactive tactile-press"
            :class="{ 'active-event-strip': ev.status === 'ACTIVE' }"
            @click="onEventClick(ev.id)"
          >
            <div class="event-item-top">
              <span class="type-badge">{{ ev.type }}</span>
              <span class="status-indicator" :class="'status-' + ev.status.toLowerCase()">
                <span class="status-dot"></span>
                {{ ev.status }}
              </span>
            </div>

            <h3 class="event-title">{{ ev.title }}</h3>
            <p v-if="ev.description" class="event-desc">{{ ev.description }}</p>

            <div class="event-meta-info">
              <span class="meta-part">
                <ion-icon :icon="peopleOutline" />
                {{ formatAudience(ev) }}
              </span>
              <span class="meta-part">
                <ion-icon :icon="calendarOutline" />
                {{ (occurrencesByEvent[ev.id] || []).length }} session(s)
              </span>
            </div>

            <!-- Preview sessions if any -->
            <div v-if="(occurrencesByEvent[ev.id] || []).length > 0" class="sessions-preview-row">
              <div 
                v-for="occ in occurrencesByEvent[ev.id]" 
                :key="occ.id" 
                class="session-micro-chip"
                :class="{ 'chip-open': occ.status === 'OPEN' }"
              >
                <ion-icon :icon="occ.status === 'OPEN' ? radioButtonOnOutline : timeOutline" />
                <span>{{ occ.title }} ({{ formatDate(occ.date) }})</span>
                <span class="status-code">{{ occ.status }}</span>
              </div>
            </div>

            <div class="event-item-footer">
              <span class="footer-link">View details &amp; roster</span>
              <ion-icon :icon="chevronForwardOutline" class="chevron-icon" />
            </div>
          </div>
        </div>

        <UniEmptyState
          v-else
          :icon="calendarOutline"
          title="No events yet"
          description="Create an event to manage attendance."
          action-text="Create Event"
          :action-icon="addOutline"
          @action="router.push('/events/create')"
        />
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.add-event-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border-radius: var(--app-pill-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25);
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.add-event-btn:active {
  transform: scale(0.96);
  opacity: 0.9;
}

.add-event-btn ion-icon {
  font-size: 16px;
}

/* Filter Tabs */
.filter-tabs-row {
  display: flex;
  background: var(--app-surface-subtle);
  padding: 4px;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  gap: 4px;
}

.tab-pill {
  flex: 1;
  padding: 7px 12px;
  border-radius: 9px;
  border: none;
  background: transparent;
  color: var(--app-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
  text-align: center;
}

.tab-pill-active {
  background: var(--app-surface);
  color: var(--app-text-primary);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  gap: 8px;
}

/* Events List */
.events-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.event-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.event-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.type-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--ion-color-primary);
  background: var(--app-accent-soft);
  padding: 2px 8px;
  border-radius: 6px;
}

.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-active .status-dot {
  background: var(--ion-color-success);
}
.status-active {
  color: var(--ion-color-success);
}

.status-completed .status-dot {
  background: var(--app-text-muted);
}
.status-completed {
  color: var(--app-text-secondary);
}

.status-draft .status-dot, .status-cancelled .status-dot {
  background: var(--ion-color-warning);
}
.status-draft, .status-cancelled {
  color: var(--ion-color-warning);
}

.event-title {
  font-size: 16px;
  font-weight: 650;
  color: var(--app-text-primary);
  margin: 0;
  line-height: 1.25;
}

.event-desc {
  font-size: 13px;
  color: var(--app-text-secondary);
  margin: 0;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.event-meta-info {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12px;
  color: var(--app-text-secondary);
}

.meta-part {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.meta-part ion-icon {
  font-size: 14px;
  color: var(--app-text-muted);
}

.sessions-preview-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

.session-micro-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--app-surface-subtle);
  font-size: 11px;
  color: var(--app-text-secondary);
}

.session-micro-chip.chip-open {
  background: rgba(21, 154, 116, 0.1);
  color: var(--ion-color-success);
  font-weight: 600;
}

.status-code {
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 600;
  opacity: 0.85;
}

.event-item-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--app-border);
  margin-top: 2px;
}

.footer-link {
  font-size: 12px;
  font-weight: 500;
  color: var(--app-text-secondary);
}

.chevron-icon {
  font-size: 14px;
  color: var(--app-text-muted);
}

.primary-compact-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--app-btn-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 4px;
}
</style>
