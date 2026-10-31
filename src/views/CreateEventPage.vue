<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonInput,
  IonTextarea,
  IonSelect,
  IonSelectOption,
  IonIcon
} from '@ionic/vue';
import { checkmarkOutline, closeCircleOutline } from 'ionicons/icons';
import { eventService } from '@/services/event.service';
import type { EventType, AudienceType } from '@/types/event';
import { UniPageHeader, UniButton } from '@/components/ui';

const router = useRouter();

const title = ref('');
const description = ref('');
const eventType = ref<EventType>('General Assembly');
const audienceType = ref<AudienceType>('ALL_BSIT');

const selectedYears = ref<number[]>([1, 2, 3, 4]);
const selectedSections = ref<string[]>(['BSIT-1A', 'BSIT-2A', 'BSIT-3A', 'BSIT-4A']);
const customSectionInput = ref('');

// Session occurrence
const todayStr = new Date().toISOString().split('T')[0];
const sessionTitle = ref('General Attendance Session');
const sessionDate = ref(todayStr);
const startTime = ref('08:00');
const endTime = ref('12:00');
const gracePeriodMinutes = ref(15);

const isSubmitting = ref(false);
const errorMessage = ref('');

function toggleYear(y: number) {
  if (selectedYears.value.includes(y)) {
    selectedYears.value = selectedYears.value.filter(item => item !== y);
  } else {
    selectedYears.value.push(y);
  }
}

function addSection() {
  if (customSectionInput.value.trim()) {
    const sec = customSectionInput.value.trim().toUpperCase();
    if (!selectedSections.value.includes(sec)) {
      selectedSections.value.push(sec);
    }
    customSectionInput.value = '';
  }
}

function removeSection(sec: string) {
  selectedSections.value = selectedSections.value.filter(s => s !== sec);
}

async function handleSaveEvent() {
  errorMessage.value = '';
  if (!title.value.trim()) {
    errorMessage.value = 'Please enter an event title.';
    return;
  }
  if (!sessionTitle.value.trim()) {
    errorMessage.value = 'Please enter a session title.';
    return;
  }
  if (!sessionDate.value) {
    errorMessage.value = 'Please choose a session date.';
    return;
  }
  if (!startTime.value || !endTime.value) {
    errorMessage.value = 'Please enter start and end times.';
    return;
  }

  isSubmitting.value = true;
  try {
    const event = await eventService.createEvent({
      title: title.value.trim(),
      description: description.value.trim(),
      type: eventType.value,
      audience: {
        type: audienceType.value,
        yearLevels: audienceType.value === 'YEAR_LEVEL' ? selectedYears.value : undefined,
        sections: audienceType.value === 'SECTION' ? selectedSections.value : undefined
      },
      attendanceRequired: true
    });

    // Create initial session occurrence
    await eventService.createOccurrence({
      eventId: event.id,
      title: sessionTitle.value.trim(),
      date: sessionDate.value,
      startTime: startTime.value,
      endTime: endTime.value,
      gracePeriodMinutes: Number(gracePeriodMinutes.value) || 15
    });

    router.replace(`/events/${event.id}`);
  } catch (err: unknown) {
    console.error('Failed to create event:', err);
    errorMessage.value = err instanceof Error ? err.message : 'Error creating event.';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Create Event"
      subtitle="Configure activity and attendance session"
      :back-button="true"
      default-back-href="/tabs/events"
      variant="detail"
    />

    <ion-content class="safe-content">
      <div class="page-container">
        <form @submit.prevent="handleSaveEvent" class="form-layout">
          <div v-if="errorMessage" class="error-banner">
            {{ errorMessage }}
          </div>

          <!-- Section 1: Overview -->
          <div class="minimal-card form-section-card">
            <h3 class="section-title-sm">Event Overview</h3>

            <div class="field-item">
              <label class="field-label">Event Title <span class="req">*</span></label>
              <ion-input 
                v-model="title" 
                placeholder="e.g. IT Days 2026 General Assembly"
                class="clean-input"
              />
            </div>

            <div class="field-item">
              <label class="field-label">Event Category <span class="req">*</span></label>
              <ion-select v-model="eventType" interface="action-sheet" class="clean-select">
                <ion-select-option value="General Assembly">General Assembly</ion-select-option>
                <ion-select-option value="Cleanup Drive">Cleanup Drive</ion-select-option>
                <ion-select-option value="Sportsfest">Sportsfest</ion-select-option>
                <ion-select-option value="IT Day">IT Day</ion-select-option>
                <ion-select-option value="Orientation">Orientation</ion-select-option>
                <ion-select-option value="Seminar">Seminar</ion-select-option>
                <ion-select-option value="Other">Other</ion-select-option>
              </ion-select>
            </div>

            <div class="field-item">
              <label class="field-label">Description</label>
              <ion-textarea 
                v-model="description" 
                placeholder="Event description, venue, or CSG instructions..."
                :rows="3"
                class="clean-textarea"
              />
            </div>
          </div>

          <!-- Section 2: Audience Configuration -->
          <div class="minimal-card form-section-card">
            <h3 class="section-title-sm">Target Audience</h3>

            <div class="field-item">
              <label class="field-label">Audience Scope <span class="req">*</span></label>
              <ion-select v-model="audienceType" interface="action-sheet" class="clean-select">
                <ion-select-option value="ALL_BSIT">All BSIT Students</ion-select-option>
                <ion-select-option value="YEAR_LEVEL">Specific Year Level(s)</ion-select-option>
                <ion-select-option value="SECTION">Specific Section(s)</ion-select-option>
              </ion-select>
            </div>

            <!-- Year Level Selection -->
            <div v-if="audienceType === 'YEAR_LEVEL'" class="sub-field-box">
              <label class="field-label-sub">Select Eligible Years:</label>
              <div class="chips-toggle-row">
                <button 
                  v-for="y in [1, 2, 3, 4]" 
                  :key="y"
                  type="button"
                  class="toggle-chip"
                  :class="{ active: selectedYears.includes(y) }"
                  @click="toggleYear(y)"
                >
                  {{ y }}th Year
                </button>
              </div>
            </div>

            <!-- Section Selection -->
            <div v-if="audienceType === 'SECTION'" class="sub-field-box">
              <label class="field-label-sub">Eligible Sections:</label>
              <div class="sections-wrap">
                <span v-for="sec in selectedSections" :key="sec" class="sec-pill">
                  {{ sec }}
                  <button type="button" class="del-sec-btn" @click="removeSection(sec)">
                    <ion-icon :icon="closeCircleOutline" />
                  </button>
                </span>
              </div>

              <div class="add-section-inline">
                <ion-input 
                  v-model="customSectionInput" 
                  placeholder="e.g. BSIT-3B" 
                  class="clean-input flex-1"
                  @keyup.enter="addSection"
                />
                <button type="button" class="compact-add-sec-btn" @click="addSection">
                  Add Section
                </button>
              </div>
            </div>
          </div>

          <!-- Section 3: Session Schedule -->
          <div class="minimal-card form-section-card">
            <h3 class="section-title-sm">Attendance Session</h3>

            <div class="field-item">
              <label class="field-label">Session Name <span class="req">*</span></label>
              <ion-input 
                v-model="sessionTitle" 
                placeholder="e.g. Morning Roll Call"
                class="clean-input"
              />
            </div>

            <div class="field-item">
              <label class="field-label">Date <span class="req">*</span></label>
              <ion-input 
                v-model="sessionDate" 
                type="date"
                class="clean-input"
              />
            </div>

            <div class="time-grid">
              <div class="field-item">
                <label class="field-label">Start Time <span class="req">*</span></label>
                <ion-input 
                  v-model="startTime" 
                  type="time"
                  class="clean-input"
                />
              </div>

              <div class="field-item">
                <label class="field-label">End Time <span class="req">*</span></label>
                <ion-input 
                  v-model="endTime" 
                  type="time"
                  class="clean-input"
                />
              </div>
            </div>

            <div class="field-item">
              <label class="field-label">Grace Period (Minutes)</label>
              <ion-input 
                v-model="gracePeriodMinutes" 
                type="number"
                placeholder="15"
                class="clean-input"
              />
              <span class="field-hint">Students scanning after Start Time + Grace are marked LATE.</span>
            </div>
          </div>

          <!-- Sticky / Bottom Submit Action -->
          <div class="form-submit-row">
            <UniButton 
              type="submit" 
              variant="primary"
              block
              :loading="isSubmitting"
              :icon="checkmarkOutline"
            >
              Save and Create Event
            </UniButton>
          </div>
        </form>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.form-layout {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.error-banner {
  padding: 10px 14px;
  border-radius: var(--app-btn-radius);
  background: rgba(220, 75, 75, 0.1);
  color: var(--ion-color-danger);
  font-size: 13px;
  font-weight: 500;
}

.form-section-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title-sm {
  font-size: 14px;
  font-weight: 650;
  color: var(--app-text-primary);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.field-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text-secondary);
}

.field-label-sub {
  font-size: 11px;
  font-weight: 500;
  color: var(--app-text-secondary);
}

.req {
  color: var(--ion-color-danger);
}

.clean-input, .clean-select, .clean-textarea {
  --background: var(--app-surface-subtle);
  --color: var(--app-text-primary);
  --placeholder-color: var(--app-text-muted);
  --padding-start: 12px;
  --padding-end: 12px;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  font-size: 14px;
  min-height: 44px;
}

.clean-textarea {
  min-height: 80px;
}

.sub-field-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 10px;
  padding: 10px 12px;
}

.chips-toggle-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.toggle-chip {
  padding: 5px 12px;
  border-radius: var(--app-pill-radius);
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  color: var(--app-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.toggle-chip.active {
  background: var(--ion-color-primary);
  border-color: var(--ion-color-primary);
  color: #ffffff;
  font-weight: 600;
}

.sections-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.sec-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text-primary);
}

.del-sec-btn {
  background: transparent;
  border: none;
  color: var(--app-text-muted);
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 0;
}

.del-sec-btn ion-icon {
  font-size: 14px;
}

.add-section-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.flex-1 {
  flex: 1;
}

.compact-add-sec-btn {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  color: var(--app-text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.time-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.field-hint {
  font-size: 11px;
  color: var(--app-text-muted);
}

.form-submit-row {
  margin-top: 4px;
}

.primary-submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 46px;
  border-radius: var(--app-btn-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.3);
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.primary-submit-btn:active {
  transform: scale(0.985);
  opacity: 0.92;
}

.primary-submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-spinner {
  width: 18px;
  height: 18px;
}
</style>
