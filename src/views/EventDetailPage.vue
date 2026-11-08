<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  onIonViewWillEnter
} from '@ionic/vue';
import {
  calendarOutline,
  timeOutline,
  peopleOutline,
  scanOutline,
  lockClosedOutline,
  radioOutline,
  addOutline,
  createOutline,
  checkmarkCircle,
  closeCircleOutline
} from 'ionicons/icons';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { AttendanceRepository } from '@/database/repositories/attendance.repository';
import { eventService } from '@/services/event.service';
import { studentService } from '@/services/student.service';
import type { Event, EventOccurrence, OccurrenceParticipant, AttendanceStatus } from '@/types/event';
import type { AttendanceStats } from '@/types/attendance';
import type { Student } from '@/types/student';
import { formatDate, formatTime } from '@/utilities/date-formatters';
import { formatFullName, formatStudentAcademicSummary } from '@/utilities/student-formatters';
import { 
  UniPageHeader, 
  UniDialog, 
  UniSheet, 
  UniButton, 
  UniFormField, 
  UniInput, 
  UniSelect 
} from '@/components/ui';
import { useToast } from '@/composables/useToast';

const { showToast } = useToast();

const statusOptions = [
  { value: 'PRESENT', label: 'PRESENT' },
  { value: 'LATE', label: 'LATE' },
  { value: 'EXCUSED', label: 'EXCUSED' },
  { value: 'ABSENT', label: 'ABSENT' },
  { value: 'PENDING', label: 'PENDING' },
];

const route = useRoute();
const router = useRouter();
const eventId = route.params.id as string;

const isStudent = computed(() => {
  const role = authService.role.value || SupabaseAuthService.role.value;
  return role === 'STUDENT';
});

const studentAttendanceMap = ref<Record<string, { status: string; checkedInAt?: string }>>({});

const event = ref<Event | null>(null);
const occurrences = ref<EventOccurrence[]>([]);
const statsMap = ref<Record<string, AttendanceStats>>({});
const allStudents = ref<Record<string, Student>>({});

const selectedOccurrence = ref<EventOccurrence | null>(null);
const participants = ref<OccurrenceParticipant[]>([]);
const showRosterModal = ref(false);

// Manual Correction state
const showCorrectionModal = ref(false);
const editingParticipant = ref<OccurrenceParticipant | null>(null);
const correctionStatus = ref<AttendanceStatus>('PRESENT');
const correctionReason = ref('');

// Add Session modal
const showAddSessionModal = ref(false);
const newSessionTitle = ref('Afternoon Session');
const newSessionDate = ref(new Date().toISOString().split('T')[0]);
const newStartTime = ref('13:00');
const newEndTime = ref('17:00');
const newGrace = ref(15);

// Confirmation alert
const showAlert = ref(false);
const alertTitle = ref('');
const alertMessage = ref('');
const alertAction = ref<() => Promise<void>>(() => Promise.resolve());

async function loadData() {
  const ev = await eventService.getEvent(eventId);
  if (!ev) return;
  event.value = ev;

  const occs = await eventService.getOccurrences(eventId);
  occurrences.value = occs;

  if (isStudent.value) {
    const authStu = authService.student.value;
    const authUser = authService.user.value || SupabaseAuthService.user.value;
    let currentStudentId = authStu?.id || authUser?.student_id;
    if (!currentStudentId && authUser?.username) {
      const match = await studentService.findStudentByStudentNumber(authUser.username);
      currentStudentId = match?.id;
    }
    if (currentStudentId) {
      const history = await AttendanceRepository.getStudentAttendanceHistory(currentStudentId);
      const map: Record<string, { status: string; checkedInAt?: string }> = {};
      for (const h of history) {
        map[h.occurrence_id] = { status: h.status, checkedInAt: h.checked_in_at || undefined };
      }
      studentAttendanceMap.value = map;
    }
    return;
  }

  const studentsList = await studentService.getStudents();
  const sMap: Record<string, Student> = {};
  studentsList.forEach(s => { sMap[s.id] = s; });
  allStudents.value = sMap;

  const sStats: Record<string, AttendanceStats> = {};
  for (const o of occs) {
    sStats[o.id] = await eventService.getOccurrenceStats(o.id);
  }
  statsMap.value = sStats;
}

onMounted(loadData);
onIonViewWillEnter(loadData);

async function handleOpenOccurrence(occ: EventOccurrence) {
  try {
    await eventService.openOccurrence(occ.id);
    await showToast(`Attendance session "${occ.title}" is now open for scanning`, 'success');
    await loadData();
  } catch (err: unknown) {
    await showToast(err instanceof Error ? err.message : 'Error opening session', 'error');
  }
}

function confirmCloseOccurrence(occ: EventOccurrence) {
  alertTitle.value = 'Close Attendance Session?';
  alertMessage.value = `Closing "${occ.title}" will finalize attendance and convert any remaining unscanned students from PENDING to ABSENT. New scans will be blocked.`;
  alertAction.value = async () => {
    await eventService.closeOccurrence(occ.id);
    await showToast(`Attendance session "${occ.title}" closed and finalized`, 'info');
    await loadData();
  };
  showAlert.value = true;
}

async function viewRoster(occ: EventOccurrence) {
  selectedOccurrence.value = occ;
  participants.value = await eventService.getParticipants(occ.id);
  showRosterModal.value = true;
}

function openCorrection(p: OccurrenceParticipant) {
  editingParticipant.value = p;
  correctionStatus.value = p.attendanceStatus;
  correctionReason.value = p.manualNote || '';
  showCorrectionModal.value = true;
}

async function saveCorrection() {
  if (!editingParticipant.value) return;
  try {
    await eventService.updateParticipantStatus(
      editingParticipant.value.id,
      correctionStatus.value,
      correctionReason.value || 'Manual operator adjustment'
    );
    showCorrectionModal.value = false;
    await showToast('Participant status updated successfully', 'success');
    if (selectedOccurrence.value) {
      participants.value = await eventService.getParticipants(selectedOccurrence.value.id);
    }
    await loadData();
  } catch (err: unknown) {
    await showToast(err instanceof Error ? err.message : 'Error updating participant status', 'error');
  }
}

async function handleAddSession() {
  try {
    await eventService.createOccurrence({
      eventId,
      title: newSessionTitle.value.trim(),
      date: newSessionDate.value,
      startTime: newStartTime.value,
      endTime: newEndTime.value,
      gracePeriodMinutes: Number(newGrace.value) || 15
    });
    showAddSessionModal.value = false;
    await showToast('Attendance session created successfully', 'success');
    await loadData();
  } catch (err: unknown) {
    await showToast(err instanceof Error ? err.message : 'Error creating session', 'error');
  }
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Event Details"
      :subtitle="event ? event.title : 'Attendance sessions'"
      :back-button="true"
      default-back-href="/tabs/events"
      variant="detail"
    >
      <template #trailing v-if="!isStudent">
        <div class="header-trailing-actions">
          <UniButton
            v-if="event"
            variant="outline"
            size="sm"
            :icon="createOutline"
            @click="router.push(`/events/${event.id}/edit`)"
          >
            Edit
          </UniButton>
          <UniButton size="sm" :icon="addOutline" @click="showAddSessionModal = true">
            Session
          </UniButton>
        </div>
      </template>
    </UniPageHeader>

    <ion-content class="safe-content">
      <div v-if="event" class="page-container">
        <!-- Event Overview Header Card -->
        <div class="minimal-card event-header-card">
          <div class="badge-row">
            <span class="type-badge">{{ event.type }}</span>
            <span class="status-indicator" :class="'status-' + event.status.toLowerCase()">
              <span class="status-dot"></span>
              {{ event.status }}
            </span>
          </div>

          <h2 class="event-headline">{{ event.title }}</h2>
          <p v-if="event.description" class="event-desc-text">{{ event.description }}</p>

          <div class="audience-bar">
            <ion-icon :icon="peopleOutline" />
            <span>Audience: 
              <strong v-if="event.audience.type === 'ALL_BSIT'">All BSIT Students</strong>
              <strong v-else-if="event.audience.type === 'YEAR_LEVEL'">{{ (event.audience.yearLevels || []).join(', ') }} Year Levels</strong>
              <strong v-else>{{ (event.audience.sections || []).join(', ') }}</strong>
            </span>
          </div>
        </div>

        <!-- Occurrences Section -->
        <section class="section-block">
          <div class="section-heading">
            <span>Attendance Sessions</span>
            <span class="metadata-text">{{ occurrences.length }} Session(s)</span>
          </div>

          <div class="occurrences-list">
            <div v-for="occ in occurrences" :key="occ.id" class="minimal-card occurrence-card">
              <div class="occ-top-line">
                <div class="occ-title-group">
                  <h4 class="occ-title">{{ occ.title }}</h4>
                  <div class="occ-meta-line">
                    <ion-icon :icon="calendarOutline" />
                    <span>{{ formatDate(occ.date) }}</span> • 
                    <ion-icon :icon="timeOutline" />
                    <span>{{ formatTime(occ.startTime) }} - {{ formatTime(occ.endTime) }}</span>
                  </div>
                </div>
                <span class="status-badge" :class="occ.status === 'OPEN' ? 'badge-success' : 'badge-neutral'">
                  {{ occ.status }}
                </span>
              </div>

              <!-- STUDENT VIEW: Personal Attendance Record -->
              <div v-if="isStudent" class="student-session-status-box">
                <div v-if="studentAttendanceMap[occ.id]" class="status-confirmed">
                  <ion-icon :icon="checkmarkCircle" class="text-mint" />
                  <span class="status-text">Your Status: <strong>{{ studentAttendanceMap[occ.id].status }}</strong></span>
                  <span v-if="studentAttendanceMap[occ.id].checkedInAt" class="checkin-time-text font-mono">
                    (Checked in at {{ formatTime(studentAttendanceMap[occ.id].checkedInAt!) }})
                  </span>
                </div>
                <div v-else-if="occ.status === 'OPEN'" class="status-live-open">
                  <span class="pulse-dot"></span>
                  <span>Attendance Session is OPEN. Approach a CSG officer to tap your card.</span>
                </div>
                <div v-else-if="occ.status === 'SCHEDULED'" class="status-scheduled">
                  <ion-icon :icon="calendarOutline" />
                  <span>Session is Scheduled. Tapping will begin when the session opens.</span>
                </div>
                <div v-else class="status-closed">
                  <ion-icon :icon="closeCircleOutline" class="text-danger" />
                  <span>Session Closed. No attendance was recorded for your account.</span>
                </div>
              </div>

              <!-- OFFICER VIEW: Stats Bar & Actions Row -->
              <template v-else>
                <!-- Stats Bar -->
                <div v-if="statsMap[occ.id]" class="stats-counter-grid">
                  <div class="stat-mini-box">
                    <span class="num text-success tabular-nums font-mono">{{ statsMap[occ.id].presentCount }}</span>
                    <span class="lbl">Present</span>
                  </div>
                  <div class="stat-mini-box">
                    <span class="num text-warning tabular-nums font-mono">{{ statsMap[occ.id].lateCount }}</span>
                    <span class="lbl">Late</span>
                  </div>
                  <div class="stat-mini-box">
                    <span class="num tabular-nums font-mono">{{ statsMap[occ.id].pendingCount }}</span>
                    <span class="lbl">Pending</span>
                  </div>
                  <div class="stat-mini-box">
                    <span class="num text-danger tabular-nums font-mono">{{ statsMap[occ.id].absentCount }}</span>
                    <span class="lbl">Absent</span>
                  </div>
                  <div class="stat-mini-box">
                    <span class="num tabular-nums font-mono">{{ statsMap[occ.id].expectedCount }}</span>
                    <span class="lbl">Expected</span>
                  </div>
                </div>

                <!-- Actions Row -->
                <div class="occ-actions-row">
                  <!-- SCHEDULED: Open Session -->
                  <button 
                    v-if="occ.status === 'SCHEDULED'" 
                    class="action-btn btn-primary"
                    @click="handleOpenOccurrence(occ)"
                  >
                    <ion-icon :icon="radioOutline" />
                    <span>Open Session</span>
                  </button>

                  <!-- OPEN: Scan NFC & Close Session -->
                  <template v-if="occ.status === 'OPEN'">
                    <button 
                      class="action-btn btn-primary"
                      @click="router.push(`/events/attendance/${occ.id}`)"
                    >
                      <ion-icon :icon="scanOutline" />
                      <span>Scan NFC</span>
                    </button>
                    <button 
                      class="action-btn btn-danger-outline"
                      @click="confirmCloseOccurrence(occ)"
                    >
                      <ion-icon :icon="lockClosedOutline" />
                      <span>Close Session</span>
                    </button>
                  </template>

                  <!-- CLOSED / View Roster -->
                  <button 
                    class="action-btn btn-subtle"
                    @click="viewRoster(occ)"
                  >
                    <ion-icon :icon="peopleOutline" />
                    <span>Roster</span>
                  </button>
                </div>
              </template>
            </div>
          </div>
        </section>
      </div>

      <!-- Confirmation Dialog -->
      <UniDialog
        v-model:is-open="showAlert"
        :title="alertTitle"
        :description="alertMessage"
        confirm-text="Confirm"
        cancel-text="Cancel"
        :destructive="true"
        type="destructive"
        @confirm="async () => { showAlert = false; await alertAction(); }"
        @cancel="showAlert = false"
      />

      <!-- Roster Sheet -->
      <UniSheet 
        :is-open="showRosterModal" 
        title="Attendance Roster"
        :subtitle="selectedOccurrence ? `${selectedOccurrence.title} • ${formatDate(selectedOccurrence.date)}` : ''"
        size="expanded"
        @close="showRosterModal = false"
      >
        <div class="sheet-inner-container">
          <div class="roster-meta-header" v-if="selectedOccurrence">
            <p class="roster-meta-sub">{{ participants.length }} Expected Students</p>
          </div>

          <div class="roster-list-wrap minimal-card">
            <div v-for="(p, idx) in participants" :key="p.id" class="roster-row" :class="{ 'row-divider': idx < participants.length - 1 }">
              <div class="student-cell">
                <span class="student-cell-name">
                  {{ allStudents[p.studentId] ? formatFullName(allStudents[p.studentId].firstName, allStudents[p.studentId].middleName, allStudents[p.studentId].lastName) : 'Student #' + p.studentId }}
                </span>
                <span class="student-cell-sub" v-if="allStudents[p.studentId]">
                  {{ allStudents[p.studentId].studentNumber || 'No ID #' }} • {{ formatStudentAcademicSummary(allStudents[p.studentId]) }}
                </span>
                <span v-if="p.attendanceTime" class="student-cell-time font-mono">
                  Scanned: {{ formatTime(p.attendanceTime) }} ({{ p.attendanceMethod || 'NFC' }})
                </span>
                <span v-if="p.manualNote" class="student-cell-note">
                  Note: {{ p.manualNote }}
                </span>
              </div>

              <div class="status-cell">
                <span class="status-badge" :class="'badge-' + p.attendanceStatus.toLowerCase()">
                  {{ p.attendanceStatus }}
                </span>
                <button class="edit-status-btn" aria-label="Edit Status" @click="openCorrection(p)">
                  <ion-icon :icon="createOutline" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </UniSheet>

      <!-- Manual Correction Sheet -->
      <UniSheet 
        :is-open="showCorrectionModal" 
        title="Attendance Correction"
        subtitle="Audit logged adjustment"
        @close="showCorrectionModal = false"
      >
        <div class="sheet-form-wrap">
          <p class="secondary-text">
            Adjust student attendance status with mandatory justification for audit logging.
          </p>

          <UniFormField label="New Status" :required="true">
            <UniSelect 
              v-model="correctionStatus" 
              :options="statusOptions"
            />
          </UniFormField>

          <UniFormField label="Reason / Adjustment Note" :required="true">
            <UniInput 
              v-model="correctionReason" 
              placeholder="e.g. Excused due to CSG council duty"
            />
          </UniFormField>

          <div style="margin-top: 16px;">
            <UniButton 
              variant="primary" 
              :full-width="true" 
              @click="saveCorrection"
            >
              Save Attendance Correction
            </UniButton>
          </div>
        </div>
      </UniSheet>

      <!-- Add Session Sheet -->
      <UniSheet 
        :is-open="showAddSessionModal" 
        title="Add Attendance Session"
        subtitle="Schedule new check-in period"
        @close="showAddSessionModal = false"
      >
        <div class="sheet-form-wrap">
          <UniFormField label="Session Name" :required="true">
            <UniInput v-model="newSessionTitle" />
          </UniFormField>

          <UniFormField label="Date" :required="true">
            <UniInput v-model="newSessionDate" type="date" />
          </UniFormField>

          <div class="time-grid">
            <UniFormField label="Start Time" :required="true">
              <UniInput v-model="newStartTime" type="time" />
            </UniFormField>
            <UniFormField label="End Time" :required="true">
              <UniInput v-model="newEndTime" type="time" />
            </UniFormField>
          </div>

          <UniFormField label="Grace Period (Minutes)">
            <UniInput v-model="newGrace" type="number" />
          </UniFormField>

          <div style="margin-top: 16px;">
            <UniButton 
              variant="primary" 
              :full-width="true" 
              @click="handleAddSession"
            >
              Add Session
            </UniButton>
          </div>
        </div>
      </UniSheet>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.student-session-status-box {
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  font-size: 12.5px;
  margin-top: 4px;
}

.status-confirmed {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--app-text-primary, #f5f6f7);
}

.text-mint {
  color: var(--aurora-mint, #70f3cf);
  font-size: 16px;
}

.text-danger {
  color: #ef4444;
  font-size: 16px;
}

.checkin-time-text {
  font-size: 11px;
  color: var(--aurora-mint, #70f3cf);
}

.status-live-open {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--aurora-mint, #70f3cf);
  font-weight: 600;
}

.pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--aurora-mint, #70f3cf);
  box-shadow: 0 0 8px var(--aurora-mint, #70f3cf);
}

.status-scheduled,
.status-closed {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--app-text-secondary, #949ba6);
}
.add-session-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: var(--app-pill-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.header-trailing-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.event-header-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.badge-row {
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

.status-active .status-dot { background: var(--ion-color-success); }
.status-active { color: var(--ion-color-success); }
.status-completed .status-dot { background: var(--app-text-muted); }
.status-completed { color: var(--app-text-secondary); }

.event-headline {
  font-size: 18px;
  font-weight: 700;
  color: var(--app-text-primary);
  margin: 0;
  line-height: 1.25;
}

.event-desc-text {
  font-size: 13px;
  color: var(--app-text-secondary);
  margin: 0;
  line-height: 1.4;
}

.audience-bar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--app-text-secondary);
  background: var(--app-surface-subtle);
  padding: 6px 10px;
  border-radius: 8px;
  margin-top: 4px;
}

.occurrences-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.occurrence-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.occ-top-line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.occ-title-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.occ-title {
  font-size: 15px;
  font-weight: 650;
  color: var(--app-text-primary);
  margin: 0;
}

.occ-meta-line {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--app-text-muted);
}

.occ-meta-line ion-icon {
  font-size: 13px;
}

.stats-counter-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
  background: var(--app-surface-subtle);
  border-radius: 10px;
  padding: 8px 6px;
  text-align: center;
}

.stat-mini-box {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.stat-mini-box .num {
  font-size: 15px;
  font-weight: 700;
  color: var(--app-text-primary);
}

.stat-mini-box .lbl {
  font-size: 10px;
  color: var(--app-text-secondary);
}

.text-present, .text-success { color: var(--ion-color-success); }
.text-late, .text-warning { color: var(--ion-color-warning); }
.text-absent, .text-danger { color: var(--ion-color-danger); }

.occ-actions-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: var(--app-btn-radius);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: transform 0.12s ease;
}

.action-btn:active {
  transform: scale(0.96);
}

.btn-primary {
  background: var(--ion-color-primary);
  color: #ffffff;
}

.btn-danger-outline {
  background: transparent;
  border: 1px solid var(--ion-color-danger);
  color: var(--ion-color-danger);
}

.btn-subtle {
  background: var(--app-surface-subtle);
  color: var(--app-text-secondary);
  border: 1px solid var(--app-border);
}

/* Modal Inner */
.modal-inner-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}

.modal-done-btn {
  background: transparent;
  border: none;
  color: var(--ion-color-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  padding: 0 12px;
}

.roster-meta-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.roster-meta-title {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  color: var(--app-text-primary);
}

.roster-meta-sub {
  font-size: 12px;
  color: var(--app-text-secondary);
  margin: 0;
}

.roster-list-wrap {
  padding: 0;
  overflow: hidden;
}

.roster-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
}

.row-divider {
  border-bottom: 1px solid var(--app-border);
}

.student-cell {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.student-cell-name {
  font-size: 14px;
  font-weight: 650;
  color: var(--app-text-primary);
}

.student-cell-sub {
  font-size: 12px;
  color: var(--app-text-secondary);
}

.student-cell-time {
  font-size: 11px;
  color: var(--app-text-muted);
}

.student-cell-note {
  font-size: 11px;
  color: var(--ion-color-warning);
}

.status-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.edit-status-btn {
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  color: var(--app-text-secondary);
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.edit-status-btn ion-icon {
  font-size: 14px;
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

.clean-input, .clean-select {
  --background: var(--app-surface-subtle);
  --color: var(--app-text-primary);
  --padding-start: 12px;
  --padding-end: 12px;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  font-size: 14px;
  min-height: 44px;
}

.time-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.primary-submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 46px;
  border-radius: var(--app-btn-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 6px;
}
</style>
