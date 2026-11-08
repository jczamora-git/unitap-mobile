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
  closeCircleOutline,
  trashOutline,
  optionsOutline,
  flagOutline,
  downloadOutline,
  ellipsisVerticalOutline,
  alertCircleOutline
} from 'ionicons/icons';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { OfficerManagementService, OFFICER_PERMISSIONS } from '@/services/officer-management.service';
import { AttendanceRepository } from '@/database/repositories/attendance.repository';
import { eventService } from '@/services/event.service';
import { studentService } from '@/services/student.service';
import { ReportService } from '@/services/report.service';
import type { Event, EventOccurrence, OccurrenceParticipant, AttendanceStatus, AttendanceCheckpoint, CheckpointType } from '@/types/event';
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
  UniSelect,
  UniStatusBadge,
  UniEmptyState
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

const isDevAdmin = computed(() => {
  const role = authService.role.value || SupabaseAuthService.role.value;
  return role === 'DEVADMIN';
});

const officerCanEdit = ref(false);
const officerCanAddSession = ref(false);
const officerCanManageCheckpoints = ref(false);

const canEditEvent = computed(() => {
  if (isDevAdmin.value) return true;
  if (isStudent.value) return false;
  return officerCanEdit.value;
});

const canAddSession = computed(() => {
  if (isDevAdmin.value) return true;
  if (isStudent.value) return false;
  return officerCanAddSession.value;
});

const canManageCheckpoints = computed(() => {
  if (isDevAdmin.value) return true;
  if (isStudent.value) return false;
  return officerCanManageCheckpoints.value;
});

const canEditSession = computed(() => {
  if (isDevAdmin.value) return true;
  if (isStudent.value) return false;
  return officerCanEdit.value || officerCanManageCheckpoints.value;
});

async function checkOfficerActionPermissions(ev: Event) {
  if (isDevAdmin.value) {
    officerCanEdit.value = true;
    officerCanAddSession.value = true;
    officerCanManageCheckpoints.value = true;
    return;
  }
  if (isStudent.value) {
    officerCanEdit.value = false;
    officerCanAddSession.value = false;
    officerCanManageCheckpoints.value = false;
    return;
  }
  const currentUserId = SupabaseAuthService.user.value?.id || authService.user.value?.id;
  if (!currentUserId || !ev) {
    officerCanEdit.value = false;
    officerCanAddSession.value = false;
    officerCanManageCheckpoints.value = false;
    return;
  }
  try {
    const [canEdit, canAdd, canCp] = await Promise.all([
      OfficerManagementService.userCanManageEvent(
        currentUserId,
        ev.id,
        ev.semesterId,
        OFFICER_PERMISSIONS.EVENTS_EDIT
      ),
      OfficerManagementService.userCanManageEvent(
        currentUserId,
        ev.id,
        ev.semesterId,
        OFFICER_PERMISSIONS.EVENTS_CREATE
      ),
      OfficerManagementService.userCanManageEvent(
        currentUserId,
        ev.id,
        ev.semesterId,
        OFFICER_PERMISSIONS.EVENTS_EDIT
      ),
    ]);
    officerCanEdit.value = canEdit;
    officerCanAddSession.value = canAdd;
    officerCanManageCheckpoints.value = canCp;
  } catch (err) {
    console.warn('Failed to verify officer event action permissions:', err);
    officerCanEdit.value = false;
    officerCanAddSession.value = false;
    officerCanManageCheckpoints.value = false;
  }
}

const showActionsMenu = ref(false);
const showDeleteEventDialog = ref(false);
const isDeletingEvent = ref(false);
const deleteEventError = ref<string | null>(null);

const eventFirstDate = computed(() => {
  return occurrences.value[0]?.date || event.value?.createdAt || null;
});

function handleCancelDeleteEvent() {
  if (!isDevAdmin.value) return;
  if (isDeletingEvent.value) return;
  showDeleteEventDialog.value = false;
  deleteEventError.value = null;
}

async function handleDeleteEvent() {
  if (!isDevAdmin.value) {
    await showToast('Only DEVADMIN can delete events.', 'error');
    return;
  }
  if (!event.value || isDeletingEvent.value) return;
  isDeletingEvent.value = true;
  deleteEventError.value = null;
  try {
    await eventService.deleteEvent(event.value.id);
    await showToast('Event deleted successfully', 'success');
    showDeleteEventDialog.value = false;
    router.replace('/tabs/events');
  } catch (err: any) {
    const errorMsg = err?.message || 'Cannot delete event because paid absence fines are associated with it. Please archive or deactivate the event instead.';
    deleteEventError.value = errorMsg;
    await showToast(errorMsg, 'error');
  } finally {
    isDeletingEvent.value = false;
  }
}

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

// Checkpoint management state
const showCheckpointsModal = ref(false);
const editingOccurrence = ref<EventOccurrence | null>(null);
const editingCheckpoints = ref<AttendanceCheckpoint[]>([]);
const newCpLabel = ref('');
const newCpType = ref<CheckpointType>('IN');
const newCpOpensAt = ref('08:00');
const newCpClosesAt = ref('08:30');
const isSavingCheckpoints = ref(false);

const checkpointTypeOptions = [
  { value: 'IN', label: 'Check-In (IN)' },
  { value: 'OUT', label: 'Check-Out (OUT)' },
];

function timeToMinutes(t?: string | null): number {
  if (!t || !t.includes(':')) return -1;
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

function validateCheckpointWindow(
  opensAt: string,
  closesAt: string,
  sessionStart?: string,
  sessionEnd?: string,
  label: string = 'Checkpoint'
): string | null {
  if (!opensAt || !closesAt) {
    return `${label}: Opens At and Closes At times are required.`;
  }
  const openMin = timeToMinutes(opensAt);
  const closeMin = timeToMinutes(closesAt);

  if (openMin < 0 || closeMin < 0) {
    return `${label}: Please enter valid time formats (HH:MM).`;
  }
  if (closeMin <= openMin) {
    return `${label}: Closing time (${formatTime(closesAt)}) must be later than opening time (${formatTime(opensAt)}).`;
  }

  if (sessionStart && sessionEnd) {
    const sessionStartMin = timeToMinutes(sessionStart);
    const sessionEndMin = timeToMinutes(sessionEnd);

    if (sessionStartMin >= 0 && sessionEndMin >= 0) {
      if (openMin < sessionStartMin) {
        return `${label}: Opening time (${formatTime(opensAt)}) cannot be earlier than session start (${formatTime(sessionStart)}).`;
      }
      if (closeMin > sessionEndMin) {
        return `${label}: Closing time (${formatTime(closesAt)}) cannot be later than session end (${formatTime(sessionEnd)}).`;
      }
    }
  }

  return null;
}

function openCheckpointsModal(occ: EventOccurrence) {
  if (!canManageCheckpoints.value) {
    showToast('You do not have permission to manage attendance checkpoints for this event.', 'error');
    return;
  }
  editingOccurrence.value = occ;
  const parsed = (occ.checkpoints && occ.checkpoints.length > 0)
    ? JSON.parse(JSON.stringify(occ.checkpoints))
    : eventService.getDefaultCheckpoints(occ.id, occ.startTime, occ.endTime);
  editingCheckpoints.value = parsed.map((c: any) => ({
    ...c,
    opensAt: c.opensAt || c.startTime || occ.startTime || '08:00',
    closesAt: c.closesAt || c.endTime || occ.endTime || '08:30',
    startTime: c.opensAt || c.startTime || occ.startTime || '08:00',
    endTime: c.closesAt || c.endTime || occ.endTime || '08:30',
  }));
  newCpLabel.value = '';
  newCpType.value = 'IN';
  newCpOpensAt.value = occ.startTime || '08:00';
  newCpClosesAt.value = occ.endTime || '08:30';
  showCheckpointsModal.value = true;
}

function addCheckpoint() {
  if (!newCpLabel.value.trim()) {
    showToast('Please enter a checkpoint label', 'warning');
    return;
  }
  const err = validateCheckpointWindow(
    newCpOpensAt.value,
    newCpClosesAt.value,
    editingOccurrence.value?.startTime,
    editingOccurrence.value?.endTime,
    newCpLabel.value.trim()
  );
  if (err) {
    showToast(err, 'warning');
    return;
  }
  const id = 'cp_' + Math.random().toString(36).substring(2, 9);
  editingCheckpoints.value.push({
    id,
    label: newCpLabel.value.trim(),
    type: newCpType.value,
    opensAt: newCpOpensAt.value,
    closesAt: newCpClosesAt.value,
    startTime: newCpOpensAt.value,
    endTime: newCpClosesAt.value,
    orderIndex: editingCheckpoints.value.length,
  });
  newCpLabel.value = '';
}

function removeCheckpoint(idx: number) {
  if (editingCheckpoints.value.length <= 1) {
    showToast('At least one checkpoint is required', 'warning');
    return;
  }
  editingCheckpoints.value.splice(idx, 1);
  editingCheckpoints.value.forEach((c, i) => { c.orderIndex = i; });
}

async function saveCheckpoints() {
  if (!canManageCheckpoints.value) {
    await showToast('You do not have permission to manage attendance checkpoints for this event.', 'error');
    return;
  }
  if (!editingOccurrence.value) return;
  if (editingCheckpoints.value.length === 0) {
    showToast('At least one checkpoint is required', 'warning');
    return;
  }
  for (const cp of editingCheckpoints.value) {
    const err = validateCheckpointWindow(
      cp.opensAt || cp.startTime || '',
      cp.closesAt || cp.endTime || '',
      editingOccurrence.value.startTime,
      editingOccurrence.value.endTime,
      cp.label
    );
    if (err) {
      showToast(err, 'warning');
      return;
    }
  }
  isSavingCheckpoints.value = true;
  try {
    await eventService.updateOccurrenceCheckpoints(editingOccurrence.value.id, editingCheckpoints.value);
    showCheckpointsModal.value = false;
    await showToast('Attendance checkpoints updated successfully', 'success');
    await loadData();
  } catch (err: any) {
    await showToast(err?.message || 'Failed to update checkpoints', 'error');
  } finally {
    isSavingCheckpoints.value = false;
  }
}

// Session Actions Menu & Edit / Delete Session state
const showSessionActionsSheet = ref(false);
const selectedSessionForMenu = ref<EventOccurrence | null>(null);

function openSessionActionsMenu(occ: EventOccurrence) {
  selectedSessionForMenu.value = occ;
  showSessionActionsSheet.value = true;
}

function handleOpenEditFromMenu() {
  const occ = selectedSessionForMenu.value;
  showSessionActionsSheet.value = false;
  if (occ) {
    openEditSessionModal(occ);
  }
}

function handleOpenDeleteFromMenu() {
  const occ = selectedSessionForMenu.value;
  showSessionActionsSheet.value = false;
  if (occ) {
    openDeleteSessionDialog(occ);
  }
}

// Edit Session state
const showEditSessionModal = ref(false);
const editingSessionOccurrence = ref<EventOccurrence | null>(null);
const editSessionTitle = ref('');
const editSessionDate = ref('');
const editSessionStartTime = ref('');
const editSessionEndTime = ref('');
const editSessionGrace = ref(15);
const editSessionCheckpoints = ref<AttendanceCheckpoint[]>([]);
const editSessionNewCpLabel = ref('');
const editSessionNewCpType = ref<CheckpointType>('IN');
const editSessionNewCpOpensAt = ref('08:00');
const editSessionNewCpClosesAt = ref('08:30');
const isSavingSession = ref(false);
const editSessionError = ref<string | null>(null);

function openEditSessionModal(occ: EventOccurrence) {
  if (!canEditSession.value) {
    showToast('You do not have permission to edit this session.', 'error');
    return;
  }
  editingSessionOccurrence.value = occ;
  editSessionTitle.value = occ.title;
  editSessionDate.value = occ.date;
  editSessionStartTime.value = occ.startTime;
  editSessionEndTime.value = occ.endTime;
  editSessionGrace.value = occ.gracePeriodMinutes ?? 15;
  const parsed = (occ.checkpoints && occ.checkpoints.length > 0)
    ? JSON.parse(JSON.stringify(occ.checkpoints))
    : eventService.getDefaultCheckpoints(occ.id, occ.startTime, occ.endTime);
  editSessionCheckpoints.value = parsed.map((c: any) => ({
    ...c,
    opensAt: c.opensAt || c.startTime || occ.startTime || '08:00',
    closesAt: c.closesAt || c.endTime || occ.endTime || '08:30',
    startTime: c.opensAt || c.startTime || occ.startTime || '08:00',
    endTime: c.closesAt || c.endTime || occ.endTime || '08:30',
  }));
  editSessionNewCpLabel.value = '';
  editSessionNewCpType.value = 'IN';
  editSessionNewCpOpensAt.value = occ.startTime || '08:00';
  editSessionNewCpClosesAt.value = occ.endTime || '08:30';
  editSessionError.value = null;
  showEditSessionModal.value = true;
}

function addEditSessionCheckpoint() {
  if (!editSessionNewCpLabel.value.trim()) {
    showToast('Please enter a checkpoint label', 'warning');
    return;
  }
  const err = validateCheckpointWindow(
    editSessionNewCpOpensAt.value,
    editSessionNewCpClosesAt.value,
    editSessionStartTime.value,
    editSessionEndTime.value,
    editSessionNewCpLabel.value.trim()
  );
  if (err) {
    showToast(err, 'warning');
    return;
  }
  const id = 'cp_' + Math.random().toString(36).substring(2, 9);
  editSessionCheckpoints.value.push({
    id,
    label: editSessionNewCpLabel.value.trim(),
    type: editSessionNewCpType.value,
    opensAt: editSessionNewCpOpensAt.value,
    closesAt: editSessionNewCpClosesAt.value,
    startTime: editSessionNewCpOpensAt.value,
    endTime: editSessionNewCpClosesAt.value,
    orderIndex: editSessionCheckpoints.value.length,
  });
  editSessionNewCpLabel.value = '';
}

function removeEditSessionCheckpoint(idx: number) {
  if (editSessionCheckpoints.value.length <= 1) {
    showToast('At least one checkpoint is required', 'warning');
    return;
  }
  editSessionCheckpoints.value.splice(idx, 1);
  editSessionCheckpoints.value.forEach((c, i) => { c.orderIndex = i; });
}

async function handleSaveSessionChanges() {
  if (!canEditSession.value) {
    await showToast('You do not have permission to edit this session.', 'error');
    return;
  }
  if (!editingSessionOccurrence.value) return;
  if (!editSessionTitle.value.trim()) {
    showToast('Session title is required', 'warning');
    return;
  }
  if (!editSessionDate.value) {
    showToast('Session date is required', 'warning');
    return;
  }
  if (!editSessionStartTime.value || !editSessionEndTime.value) {
    showToast('Start and end times are required', 'warning');
    return;
  }
  if (editSessionCheckpoints.value.length === 0) {
    showToast('At least one checkpoint is required', 'warning');
    return;
  }
  for (const cp of editSessionCheckpoints.value) {
    const err = validateCheckpointWindow(
      cp.opensAt || cp.startTime || '',
      cp.closesAt || cp.endTime || '',
      editSessionStartTime.value,
      editSessionEndTime.value,
      cp.label
    );
    if (err) {
      editSessionError.value = err;
      showToast(err, 'warning');
      return;
    }
  }
  isSavingSession.value = true;
  editSessionError.value = null;
  try {
    await eventService.updateOccurrence({
      occurrenceId: editingSessionOccurrence.value.id,
      title: editSessionTitle.value.trim(),
      date: editSessionDate.value,
      startTime: editSessionStartTime.value,
      endTime: editSessionEndTime.value,
      gracePeriodMinutes: Number(editSessionGrace.value) || 0,
      checkpoints: editSessionCheckpoints.value,
    });
    showEditSessionModal.value = false;
    await showToast('Attendance session updated successfully', 'success');
    await loadData();
  } catch (err: any) {
    const msg = err?.message || 'Failed to update session';
    editSessionError.value = msg;
    await showToast(msg, 'error');
  } finally {
    isSavingSession.value = false;
  }
}

// Delete Session state (DEVADMIN Only)
const showDeleteSessionDialog = ref(false);
const sessionToDelete = ref<EventOccurrence | null>(null);
const isDeletingSession = ref(false);
const deleteSessionError = ref<string | null>(null);

function openDeleteSessionDialog(occ: EventOccurrence) {
  if (!isDevAdmin.value) {
    showToast('Only DEVADMIN can delete attendance sessions.', 'error');
    return;
  }
  sessionToDelete.value = occ;
  deleteSessionError.value = null;
  showDeleteSessionDialog.value = true;
}

function handleCancelDeleteSession() {
  if (isDeletingSession.value) return;
  showDeleteSessionDialog.value = false;
  deleteSessionError.value = null;
  sessionToDelete.value = null;
}

async function handleConfirmDeleteSession() {
  if (!isDevAdmin.value) {
    await showToast('Only DEVADMIN can delete attendance sessions.', 'error');
    return;
  }
  if (!sessionToDelete.value || isDeletingSession.value) return;
  isDeletingSession.value = true;
  deleteSessionError.value = null;
  try {
    await eventService.deleteOccurrence(sessionToDelete.value.id);
    await showToast('Attendance session deleted successfully', 'success');
    showDeleteSessionDialog.value = false;
    sessionToDelete.value = null;
    await loadData();
  } catch (err: any) {
    const errorMsg = err?.message || 'Cannot delete attendance session because paid absence fines are associated with it. Please retain or archive the session instead.';
    deleteSessionError.value = errorMsg;
    await showToast(errorMsg, 'error');
  } finally {
    isDeletingSession.value = false;
  }
}

function downloadAttendanceCsv() {
  if (!selectedOccurrence.value) return;
  const occ = selectedOccurrence.value;
  const cps = occ.checkpoints && occ.checkpoints.length > 0
    ? occ.checkpoints
    : [{ id: 'default_in', label: 'General Check-In', type: 'IN' as const, orderIndex: 0 }];

  const exportParticipants = participants.value.map((p) => {
    const stu = allStudents.value[p.studentId];
    return {
      studentId: p.studentId,
      schoolId: stu?.studentNumber || '',
      fullName: stu ? formatFullName(stu.firstName, stu.middleName, stu.lastName) : p.studentId,
      course: stu?.course || '',
      yearLevel: stu?.yearLevel || 1,
      section: stu?.section || '',
      checkpointId: p.checkpointId || 'default_in',
      attendanceStatus: p.attendanceStatus,
      attendanceTime: p.attendanceTime,
    };
  });

  const csv = ReportService.generateAttendanceCsv(
    `${event.value?.title || 'Event'} - ${occ.title}`,
    cps,
    exportParticipants
  );

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `attendance_${occ.title.replace(/\s+/g, '_')}_${occ.date}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('Attendance report exported as CSV', 'success');
}

// Confirmation alert
const showAlert = ref(false);
const alertTitle = ref('');
const alertMessage = ref('');
const alertAction = ref<() => Promise<void>>(() => Promise.resolve());

async function loadData() {
  const ev = await eventService.getEvent(eventId);
  if (!ev) return;
  event.value = ev;
  await checkOfficerActionPermissions(ev);

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
  if (!canAddSession.value) {
    await showToast('You do not have permission to add attendance sessions to this event.', 'error');
    return;
  }
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
      :title="event ? event.title : 'Event Details'"
      :subtitle="event ? `${event.type} • ${event.status}` : 'Attendance sessions'"
      :back-button="true"
      default-back-href="/tabs/events"
      variant="detail"
    >
      <template #trailing v-if="!isStudent && event">
        <div class="header-trailing-actions">
          <UniButton
            v-if="canAddSession"
            size="sm"
            :icon="addOutline"
            @click="showAddSessionModal = true"
          >
            Add Session
          </UniButton>
          <UniButton
            v-if="canEditEvent || isDevAdmin"
            variant="ghost"
            size="sm"
            :icon="ellipsisVerticalOutline"
            class="action-menu-trigger-btn"
            title="Event Options"
            aria-label="Event Options"
            @click="showActionsMenu = true"
          />
        </div>
      </template>
    </UniPageHeader>

    <ion-content class="safe-content">
      <div v-if="event" class="page-container">
        <!-- Event Overview Header Card -->
        <div class="minimal-card event-header-card">
          <div class="info-top-row">
            <span class="type-badge">{{ event.type }}</span>
            <UniStatusBadge
              :variant="event.status === 'ACTIVE' ? 'active' : event.status === 'COMPLETED' ? 'success' : 'neutral'"
            >
              {{ event.status }}
            </UniStatusBadge>
          </div>

          <h2 class="event-headline">{{ event.title }}</h2>
          <p v-if="event.description" class="event-desc-text">{{ event.description }}</p>

          <div class="event-meta-grid">
            <div class="meta-item">
              <ion-icon :icon="peopleOutline" class="meta-icon" />
              <div class="meta-content">
                <span class="meta-label">Audience</span>
                <span class="meta-val">
                  <strong v-if="event.audience.type === 'ALL_BSIT'">All BSIT Students</strong>
                  <strong v-else-if="event.audience.type === 'YEAR_LEVEL'">{{ (event.audience.yearLevels || []).join(', ') }} Year Levels</strong>
                  <strong v-else>{{ (event.audience.sections || []).join(', ') }}</strong>
                </span>
              </div>
            </div>

            <div v-if="eventFirstDate" class="meta-item">
              <ion-icon :icon="calendarOutline" class="meta-icon" />
              <div class="meta-content">
                <span class="meta-label">Event Date</span>
                <span class="meta-val font-sans">{{ formatDate(eventFirstDate) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Occurrences Section -->
        <section class="section-block">
          <div class="section-heading">
            <span>Attendance Sessions</span>
            <span class="metadata-text">{{ occurrences.length }} Session(s)</span>
          </div>

          <div v-if="occurrences.length === 0" class="empty-sessions-wrap">
            <UniEmptyState
              title="No Attendance Sessions"
              description="Add an attendance session to start tracking student check-ins."
              :icon="calendarOutline"
              :action-text="canAddSession ? 'Add Session' : undefined"
              @action="canAddSession && (showAddSessionModal = true)"
            />
          </div>

          <div v-else class="occurrences-list">
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
                  <div v-if="occ.checkpoints && occ.checkpoints.length > 0" class="occ-checkpoints-row">
                    <span v-for="cp in occ.checkpoints" :key="cp.id" class="occ-cp-badge" :class="{ 'type-out': cp.type === 'OUT' }">
                      {{ cp.label }} ({{ cp.type }}): {{ formatTime(cp.opensAt || cp.startTime) }} – {{ formatTime(cp.closesAt || cp.endTime) }}
                    </span>
                  </div>
                </div>
                <div class="occ-top-trailing">
                  <span class="status-badge" :class="occ.status === 'OPEN' ? 'badge-success' : 'badge-neutral'">
                    {{ occ.status }}
                  </span>
                  <UniButton
                    v-if="!isStudent && (canEditSession || isDevAdmin)"
                    variant="ghost"
                    size="sm"
                    :icon="ellipsisVerticalOutline"
                    class="action-menu-trigger-btn session-menu-trigger-btn"
                    title="Session Options"
                    aria-label="Session Options"
                    @click="openSessionActionsMenu(occ)"
                  />
                </div>
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

                  <!-- Checkpoints button -->
                  <button 
                    v-if="canManageCheckpoints"
                    class="action-btn btn-subtle"
                    @click="openCheckpointsModal(occ)"
                  >
                    <ion-icon :icon="optionsOutline" />
                    <span>Checkpoints</span>
                  </button>

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
            <UniButton
              variant="outline"
              size="sm"
              :icon="downloadOutline"
              @click="downloadAttendanceCsv"
            >
              Export CSV
            </UniButton>
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
                <span v-if="p.checkpointLabel" class="student-cell-checkpoint font-mono">
                  Checkpoint: {{ p.checkpointLabel }} ({{ p.checkpointType || 'IN' }})
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

      <!-- Checkpoint Management Sheet -->
      <UniSheet
        :is-open="showCheckpointsModal"
        title="Configure Checkpoints"
        :subtitle="editingOccurrence ? `${editingOccurrence.title} Checkpoints` : ''"
        size="expanded"
        @close="showCheckpointsModal = false"
      >
        <div class="sheet-form-wrap">
          <p class="secondary-text">
            Configure attendance checkpoints for this session (e.g. Morning IN, Morning OUT, Afternoon IN, Afternoon OUT). Each checkpoint tracks attendance independently.
          </p>

          <div class="checkpoints-list-box minimal-card">
            <div
              v-for="(cp, idx) in editingCheckpoints"
              :key="cp.id"
              class="checkpoint-manage-row"
            >
              <div class="cp-info-group">
                <span class="cp-type-tag" :class="{ 'type-out': cp.type === 'OUT' }">{{ cp.type }}</span>
                <div class="cp-text-group">
                  <span class="cp-label-name">{{ cp.label }}</span>
                  <span class="cp-time-window font-mono">{{ formatTime(cp.opensAt || cp.startTime) }} – {{ formatTime(cp.closesAt || cp.endTime) }}</span>
                </div>
              </div>
              <button
                v-if="editingCheckpoints.length > 1"
                type="button"
                class="cp-delete-btn"
                @click="removeCheckpoint(idx)"
                aria-label="Remove Checkpoint"
              >
                <ion-icon :icon="trashOutline" />
              </button>
            </div>
          </div>

          <!-- Add Checkpoint Form -->
          <div class="add-cp-box">
            <h5 class="add-cp-title">Add Checkpoint</h5>
            <div class="add-cp-grid">
              <UniFormField label="Checkpoint Label" :required="true">
                <UniInput v-model="newCpLabel" placeholder="e.g. Morning IN" />
              </UniFormField>
              <UniFormField label="Type" :required="true">
                <UniSelect v-model="newCpType" :options="checkpointTypeOptions" />
              </UniFormField>
            </div>
            <div class="time-grid" style="margin-top: 8px; margin-bottom: 12px;">
              <UniFormField label="Opens At" :required="true">
                <UniInput v-model="newCpOpensAt" type="time" />
              </UniFormField>
              <UniFormField label="Closes At" :required="true">
                <UniInput v-model="newCpClosesAt" type="time" />
              </UniFormField>
            </div>
            <UniButton
              variant="outline"
              size="sm"
              :icon="addOutline"
              @click="addCheckpoint"
            >
              Add Checkpoint
            </UniButton>
          </div>

          <div style="margin-top: 20px;">
            <UniButton
              variant="primary"
              :full-width="true"
              :disabled="isSavingCheckpoints"
              @click="saveCheckpoints"
            >
              {{ isSavingCheckpoints ? 'Saving Checkpoints...' : 'Save Checkpoints' }}
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

      <!-- Delete Event Confirmation Modal (DEVADMIN Only) -->
      <UniDialog
        v-if="isDevAdmin"
        v-model:is-open="showDeleteEventDialog"
        title="Delete Event?"
        confirm-text="Delete Event"
        cancel-text="Cancel"
        :destructive="true"
        type="destructive"
        :loading="isDeletingEvent"
        :prevent-auto-close="true"
        @confirm="handleDeleteEvent"
        @cancel="handleCancelDeleteEvent"
      >
        <div v-if="event" class="delete-event-dialog-body">
          <p class="dialog-instruction">
            Are you sure you want to permanently delete this event? This action cannot be undone.
          </p>

          <div class="dialog-summary-card">
            <div class="summary-line">
              <span class="summary-key">Event:</span>
              <strong class="summary-val">{{ event.title }}</strong>
            </div>
            <div class="summary-line">
              <span class="summary-key">Type:</span>
              <span class="summary-val">{{ event.type }}</span>
            </div>
            <div class="summary-line">
              <span class="summary-key">Sessions:</span>
              <span class="summary-val">{{ occurrences.length }} attendance session(s)</span>
            </div>
          </div>

          <div v-if="deleteEventError" class="dialog-error-callout">
            <ion-icon :icon="alertCircleOutline" class="error-callout-icon" />
            <div class="callout-body">
              <strong>Cannot Delete:</strong> {{ deleteEventError }}
            </div>
          </div>

          <div v-else class="dialog-warning-callout">
            <ion-icon :icon="alertCircleOutline" class="callout-icon" />
            <div class="callout-body">
              <strong>Warning:</strong> All attendance sessions, scan records, and associated unpaid student absence fines will also be permanently deleted. If paid absence fines exist, deletion will be blocked by Supabase to protect audit history.
            </div>
          </div>
        </div>
      </UniDialog>

      <!-- Event Options Action Sheet -->
      <UniSheet
        v-model:is-open="showActionsMenu"
        title="Event Options"
        subtitle="Manage event details and administrative actions"
        @close="showActionsMenu = false"
      >
        <div v-if="event" class="actions-menu-list">
          <button
            v-if="canEditEvent"
            type="button"
            class="menu-item-row"
            @click="
              showActionsMenu = false;
              router.push(`/events/${event.id}/edit`);
            "
          >
            <div class="menu-icon-box">
              <ion-icon :icon="createOutline" />
            </div>
            <div class="menu-item-text">
              <strong>Edit Event Details</strong>
              <span>Update title, audience scope, or settings</span>
            </div>
          </button>

          <button
            v-if="isDevAdmin"
            type="button"
            class="menu-item-row menu-item-destructive"
            @click="
              showActionsMenu = false;
              deleteEventError = null;
              showDeleteEventDialog = true;
            "
          >
            <div class="menu-icon-box menu-icon-destructive">
              <ion-icon :icon="trashOutline" />
            </div>
            <div class="menu-item-text">
              <strong>Delete Event</strong>
              <span>Permanently delete this event and unpaid fines</span>
            </div>
          </button>
        </div>
      </UniSheet>

      <!-- Session Options Action Sheet -->
      <UniSheet
        v-model:is-open="showSessionActionsSheet"
        title="Session Options"
        :subtitle="selectedSessionForMenu ? `${selectedSessionForMenu.title} • ${formatDate(selectedSessionForMenu.date)}` : 'Manage session'"
        @close="showSessionActionsSheet = false"
      >
        <div v-if="selectedSessionForMenu" class="actions-menu-list">
          <button
            v-if="canEditSession"
            type="button"
            class="menu-item-row"
            @click="handleOpenEditFromMenu"
          >
            <div class="menu-icon-box">
              <ion-icon :icon="createOutline" />
            </div>
            <div class="menu-item-text">
              <strong>Edit Session</strong>
              <span>Update title, date, times, grace period, and checkpoints</span>
            </div>
          </button>

          <button
            v-if="isDevAdmin"
            type="button"
            class="menu-item-row menu-item-destructive"
            @click="handleOpenDeleteFromMenu"
          >
            <div class="menu-icon-box menu-icon-destructive">
              <ion-icon :icon="trashOutline" />
            </div>
            <div class="menu-item-text">
              <strong>Delete Session</strong>
              <span>Permanently remove this attendance session (DEVADMIN only)</span>
            </div>
          </button>
        </div>
      </UniSheet>

      <!-- Edit Session Sheet -->
      <UniSheet
        :is-open="showEditSessionModal"
        title="Edit Attendance Session"
        :subtitle="editingSessionOccurrence ? `${editingSessionOccurrence.title}` : 'Update session details'"
        size="expanded"
        @close="showEditSessionModal = false"
      >
        <div class="sheet-form-wrap">
          <UniFormField label="Session Name" :required="true">
            <UniInput v-model="editSessionTitle" placeholder="e.g. Afternoon Session" />
          </UniFormField>

          <UniFormField label="Date" :required="true">
            <UniInput v-model="editSessionDate" type="date" />
          </UniFormField>

          <div class="time-grid">
            <UniFormField label="Start Time" :required="true">
              <UniInput v-model="editSessionStartTime" type="time" />
            </UniFormField>
            <UniFormField label="End Time" :required="true">
              <UniInput v-model="editSessionEndTime" type="time" />
            </UniFormField>
          </div>

          <UniFormField label="Grace Period (Minutes)">
            <UniInput v-model="editSessionGrace" type="number" />
          </UniFormField>

          <!-- Checkpoints Configuration in Edit Session -->
          <div class="edit-session-checkpoints-section">
            <div class="section-subheading">
              <span>Attendance Checkpoints</span>
              <span class="metadata-text">{{ editSessionCheckpoints.length }} Checkpoint(s)</span>
            </div>

            <div class="checkpoints-list-box minimal-card">
              <div
                v-for="(cp, idx) in editSessionCheckpoints"
                :key="cp.id"
                class="checkpoint-manage-row"
              >
                <div class="cp-info-group">
                  <span class="cp-type-tag" :class="{ 'type-out': cp.type === 'OUT' }">{{ cp.type }}</span>
                  <div class="cp-text-group">
                    <span class="cp-label-name">{{ cp.label }}</span>
                    <span class="cp-time-window font-mono">{{ formatTime(cp.opensAt || cp.startTime) }} – {{ formatTime(cp.closesAt || cp.endTime) }}</span>
                  </div>
                </div>
                <button
                  v-if="editSessionCheckpoints.length > 1"
                  type="button"
                  class="cp-delete-btn"
                  @click="removeEditSessionCheckpoint(idx)"
                  aria-label="Remove Checkpoint"
                >
                  <ion-icon :icon="trashOutline" />
                </button>
              </div>
            </div>

            <div class="add-cp-box">
              <h5 class="add-cp-title">Add Checkpoint</h5>
              <div class="add-cp-grid">
                <UniFormField label="Checkpoint Label" :required="true">
                  <UniInput v-model="editSessionNewCpLabel" placeholder="e.g. Afternoon IN" />
                </UniFormField>
                <UniFormField label="Type" :required="true">
                  <UniSelect v-model="editSessionNewCpType" :options="checkpointTypeOptions" />
                </UniFormField>
              </div>
              <div class="time-grid" style="margin-top: 8px; margin-bottom: 12px;">
                <UniFormField label="Opens At" :required="true">
                  <UniInput v-model="editSessionNewCpOpensAt" type="time" />
                </UniFormField>
                <UniFormField label="Closes At" :required="true">
                  <UniInput v-model="editSessionNewCpClosesAt" type="time" />
                </UniFormField>
              </div>
              <UniButton
                variant="outline"
                size="sm"
                :icon="addOutline"
                @click="addEditSessionCheckpoint"
              >
                Add Checkpoint
              </UniButton>
            </div>
          </div>

          <div v-if="editSessionError" class="dialog-error-callout" style="margin-top: 16px;">
            <ion-icon :icon="alertCircleOutline" class="error-callout-icon" />
            <div class="callout-body">
              <strong>Error:</strong> {{ editSessionError }}
            </div>
          </div>

          <div style="margin-top: 20px;">
            <UniButton
              variant="primary"
              :full-width="true"
              :disabled="isSavingSession"
              @click="handleSaveSessionChanges"
            >
              {{ isSavingSession ? 'Saving Changes...' : 'Save Session Changes' }}
            </UniButton>
          </div>
        </div>
      </UniSheet>

      <!-- Delete Session Confirmation Modal (DEVADMIN Only) -->
      <UniDialog
        v-if="isDevAdmin"
        v-model:is-open="showDeleteSessionDialog"
        title="Delete Attendance Session?"
        confirm-text="Delete Session"
        cancel-text="Cancel"
        :destructive="true"
        type="destructive"
        :loading="isDeletingSession"
        :prevent-auto-close="true"
        @confirm="handleConfirmDeleteSession"
        @cancel="handleCancelDeleteSession"
      >
        <div v-if="sessionToDelete" class="delete-event-dialog-body">
          <p class="dialog-instruction">
            Are you sure you want to permanently delete this attendance session? This action cannot be undone.
          </p>

          <div class="dialog-summary-card">
            <div class="summary-line">
              <span class="summary-key">Session:</span>
              <strong class="summary-val">{{ sessionToDelete.title }}</strong>
            </div>
            <div class="summary-line">
              <span class="summary-key">Date:</span>
              <span class="summary-val">{{ formatDate(sessionToDelete.date) }}</span>
            </div>
            <div class="summary-line">
              <span class="summary-key">Time:</span>
              <span class="summary-val font-sans">{{ formatTime(sessionToDelete.startTime) }} - {{ formatTime(sessionToDelete.endTime) }}</span>
            </div>
            <div class="summary-line">
              <span class="summary-key">Status:</span>
              <span class="summary-val">{{ sessionToDelete.status }}</span>
            </div>
          </div>

          <div v-if="deleteSessionError" class="dialog-error-callout">
            <ion-icon :icon="alertCircleOutline" class="error-callout-icon" />
            <div class="callout-body">
              <strong>Cannot Delete:</strong> {{ deleteSessionError }}
            </div>
          </div>

          <div v-else class="dialog-warning-callout">
            <ion-icon :icon="alertCircleOutline" class="callout-icon" />
            <div class="callout-body">
              <strong>Warning:</strong> All attendance scan records and associated unpaid student absence fines for this session will be permanently deleted. If paid absence fines exist, deletion will be blocked by Supabase to protect financial audit history.
            </div>
          </div>
        </div>
      </UniDialog>
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

.action-menu-trigger-btn {
  width: 34px;
  height: 34px;
  min-width: 34px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--uni-text-muted, #94a3b8);
}

.action-menu-trigger-btn:hover {
  background: var(--uni-surface-hover, rgba(255, 255, 255, 0.08));
  color: var(--uni-text-primary, #ffffff);
}

/* Event Overview Header Card */
.event-header-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  background: var(--uni-surface, #0f172a);
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.1));
}

.info-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.event-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--uni-border, rgba(255, 255, 255, 0.1));
}

.meta-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.meta-icon {
  font-size: 16px;
  color: var(--uni-primary, #0F766E);
  margin-top: 2px;
  flex-shrink: 0;
}

.meta-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.meta-label {
  font-size: 11px;
  color: var(--uni-text-muted, #94a3b8);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}

.meta-val {
  font-size: 13px;
  color: var(--uni-text-primary, #ffffff);
}

.empty-sessions-wrap {
  padding: 12px 0;
}

/* Actions Menu Sheet */
.actions-menu-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0 16px 0;
}

.menu-item-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  background: transparent;
  border: none;
  width: 100%;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
}

.menu-item-row:hover {
  background: var(--uni-surface-subtle, rgba(255, 255, 255, 0.05));
}

.menu-icon-box {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--uni-surface-subtle, rgba(255, 255, 255, 0.06));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--uni-primary, #0F766E);
  font-size: 18px;
  flex-shrink: 0;
}

.menu-icon-destructive {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.menu-item-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.menu-item-text strong {
  font-size: 14px;
  color: var(--uni-text-primary, #ffffff);
}

.menu-item-destructive .menu-item-text strong {
  color: #ef4444;
}

.menu-item-text span {
  font-size: 12px;
  color: var(--uni-text-muted, #94a3b8);
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

.occ-top-trailing {
  display: flex;
  align-items: center;
  gap: 8px;
}

.session-menu-trigger-btn {
  --padding-start: 6px;
  --padding-end: 6px;
  min-width: 32px;
  height: 32px;
  margin: -4px 0 -4px 0;
}

.edit-session-checkpoints-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}

.section-subheading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-primary);
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

.occ-checkpoints-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.occ-cp-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 9999px;
  background: rgba(15, 118, 110, 0.12);
  color: #0f766e;
  border: 1px solid rgba(15, 118, 110, 0.25);
}

.occ-cp-badge.type-out {
  background: rgba(225, 29, 72, 0.12);
  color: #e11d48;
  border-color: rgba(225, 29, 72, 0.25);
}

.student-cell-checkpoint {
  font-size: 11px;
  color: #0f766e;
  font-weight: 600;
}

.roster-meta-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.checkpoints-list-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
  padding: 12px;
}

.checkpoint-manage-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 8px;
}

.cp-info-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cp-type-tag {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(15, 118, 110, 0.15);
  color: #0f766e;
}

.cp-type-tag.type-out {
  background: rgba(225, 29, 72, 0.15);
  color: #e11d48;
}

.cp-label-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-primary);
}

.cp-text-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.cp-time-window {
  font-size: 11px;
  color: var(--app-text-muted);
}

.cp-delete-btn {
  background: none;
  border: none;
  color: #ef4444;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}

.add-cp-box {
  border: 1px dashed var(--app-border);
  border-radius: 12px;
  padding: 14px;
  margin-top: 12px;
}

.add-cp-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--app-text-secondary);
  margin: 0 0 10px 0;
}

.add-cp-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}

/* Delete Event Dialog Styles */
.delete-event-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: left;
}

.dialog-instruction {
  font-size: 0.9rem;
  color: var(--uni-text-secondary, #cbd5e1);
  margin: 0;
  line-height: 1.45;
}

.dialog-summary-card {
  background: var(--uni-surface-subtle, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dialog-summary-card .summary-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
}

.dialog-summary-card .summary-key {
  color: var(--uni-text-muted, #94a3b8);
}

.dialog-summary-card .summary-val {
  color: var(--uni-text-primary, #ffffff);
  text-align: right;
  word-break: break-word;
}

.dialog-warning-callout {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 8px;
  font-size: 0.82rem;
  line-height: 1.4;
  color: #fca5a5;
}

.dialog-warning-callout .callout-icon {
  font-size: 1.15rem;
  color: #ef4444;
  flex-shrink: 0;
  margin-top: 1px;
}

.dialog-error-callout {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.14);
  border: 1px solid rgba(239, 68, 68, 0.45);
  border-radius: 8px;
  font-size: 0.82rem;
  line-height: 1.4;
  color: #fca5a5;
}

.dialog-error-callout .error-callout-icon {
  font-size: 1.15rem;
  color: #f87171;
  flex-shrink: 0;
  margin-top: 1px;
}

.callout-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.callout-body strong {
  color: #ef4444;
}

@media (max-width: 440px) {
  .actions-menu-list {
    gap: 4px;
  }
  .menu-item-row {
    padding: 10px 12px;
  }
  .dialog-summary-card {
    padding: 8px 10px;
  }
}
</style>
