<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  IonSpinner,
  onIonViewWillEnter,
} from '@ionic/vue';
import {
  alertCircleOutline,
  checkmarkCircle,
  cashOutline,
  closeCircleOutline,
  calendarOutline,
  downloadOutline,
  layersOutline,
  timerOutline,
  informationCircleOutline,
} from 'ionicons/icons';
import { exportFile } from '@/utilities/file-export';
import { financeService } from '@/services/finance.service';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { EventsRepository } from '@/database/repositories/events.repository';
import type {
  AcademicYear,
  Semester,
  EventRecord,
  EventOccurrenceRecord,
} from '@/types/database';
import type {
  AbsenteeCandidate,
  OccurrenceAbsenteeSummary,
  ObligationRuleItem,
} from '@/types/finance';
import { formatPeso, centavosToPeso, pesoToCentavos } from '@/utilities/finance-formatters';
import { formatSemesterName } from '@/utilities/presentation-formatters';
import { useToast } from '@/composables/useToast';
import {
  UniPageHeader,
  UniButton,
  UniCard,
  UniStatCard,
  UniSheet,
  UniEmptyState,
  UniSelect,
  UniRecordList,
  UniExpandableRow,
} from '@/components/ui';
import { useOperationPolicy } from '@/composables/useOperationPolicy';
import { haptics } from '@/utilities/haptics';

const { showToast } = useToast();
const route = useRoute();
const { isPermitted, getDisabledReason } = useOperationPolicy();
const canAssessFines = isPermitted('FINANCE_ASSESSMENTS_AND_RULES');
const assessFinesDisabledReason = getDisabledReason('FINANCE_ASSESSMENTS_AND_RULES');

// Term & Event State
const academicYears = ref<AcademicYear[]>([]);
const semesters = ref<Semester[]>([]);
const events = ref<EventRecord[]>([]);
const occurrences = ref<EventOccurrenceRecord[]>([]);
const rules = ref<ObligationRuleItem[]>([]);

const selectedYearId = ref<string>('');
const selectedSemesterId = ref<string>('');
const selectedEventId = ref<string>('');
const selectedOccurrenceId = ref<string>('');

// Absentee Data & Mode
const isLoading = ref<boolean>(false);
const summary = ref<OccurrenceAbsenteeSummary | null>(null);
const candidates = ref<AbsenteeCandidate[]>([]);
const assessmentMode = ref<'WHOLE_EVENT' | 'PER_CHECKPOINT'>('WHOLE_EVENT');
const selectedCheckpointId = ref<string>('');
const isExportingCsv = ref<boolean>(false);

// Filters
const searchQuery = ref<string>('');
const selectedYearLevel = ref<string>('ALL');
const selectedSection = ref<string>('ALL');

// Bulk Assessment Sheet State
const isModalOpen = ref<boolean>(false);
const isAssessing = ref<boolean>(false);
const assessmentError = ref<string | null>(null);

const selectedRuleId = ref<string>('');
const customFineTitle = ref<string>('');
const fineAmountPesos = ref<number>(50);
const dueDate = ref<string>('');
const assessmentNotes = ref<string>('');

// Distinct Sections for Filter
const availableSections = computed(() => {
  const s = new Set<string>();
  candidates.value.forEach((c) => {
    if (c.section && c.section !== 'N/A') s.add(c.section);
  });
  return Array.from(s).sort();
});

// Dropdown Options for UniSelect
const semesterOptions = computed(() => {
  return semesters.value.map((sem) => ({
    value: sem.id,
    label: formatSemesterName(sem.term),
    badge: sem.status === 'ACTIVE' ? 'Active' : undefined,
  }));
});

const eventOptions = computed(() => {
  return events.value.map((ev) => ({
    value: ev.id,
    label: ev.title,
  }));
});

const occurrenceOptions = computed(() => {
  return occurrences.value.map((occ) => ({
    value: occ.id,
    label: `${occ.title} (${occ.occurs_on})`,
    badge: occ.status,
  }));
});

const yearLevelOptions = [
  { value: 'ALL', label: 'All Years' },
  { value: '1', label: '1st Year' },
  { value: '2', label: '2nd Year' },
  { value: '3', label: '3rd Year' },
  { value: '4', label: '4th Year' },
];

const sectionOptions = computed(() => [
  { value: 'ALL', label: 'All Sections' },
  ...availableSections.value.map((sec) => ({ value: sec, label: sec })),
]);

const ruleOptions = computed(() => {
  return rules.value.map((r) => ({
    value: r.id,
    label: `${r.name} (${formatPeso(r.defaultAmountCentavos)})`,
  }));
});

function handleSemesterSelect(val: string | number) {
  selectedSemesterId.value = String(val);
  onSemesterChanged();
}

function handleEventSelect(val: string | number) {
  selectedEventId.value = String(val);
  onEventChanged();
}

function handleOccurrenceSelect(val: string | number) {
  selectedOccurrenceId.value = String(val);
  loadOccurrenceAbsentees();
}

function handleRuleSelect(val: string | number) {
  selectedRuleId.value = String(val);
  handleRuleChange();
}

// Filtered Candidates
const filteredCandidates = computed(() => {
  return candidates.value.filter((c) => {
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase().trim();
      const matchName = c.fullName.toLowerCase().includes(q);
      const matchId = c.schoolId.toLowerCase().includes(q);
      if (!matchName && !matchId) return false;
    }
    if (selectedYearLevel.value !== 'ALL') {
      if (c.yearLevel.toString() !== selectedYearLevel.value) return false;
    }
    if (selectedSection.value !== 'ALL') {
      if (c.section.toLowerCase() !== selectedSection.value.toLowerCase()) return false;
    }
    return true;
  });
});

const selectedCandidates = computed(() => {
  return candidates.value.filter((c) => c.selected && !c.alreadyFined);
});

const totalAssessmentCentavos = computed(() => {
  return selectedCandidates.value.length * pesoToCentavos(fineAmountPesos.value || 0);
});

const isSessionClosed = computed(() => {
  return summary.value?.sessionStatus === 'CLOSED';
});

const emptyStateInfo = computed(() => {
  if (academicYears.value.length === 0 || semesters.value.length === 0) {
    return {
      title: 'No Academic Term Configured',
      description: 'Create an academic year and semester in Settings to track events and attendance.',
    };
  }
  if (events.value.length === 0) {
    return {
      title: 'No Events Found',
      description: 'There are no events recorded for the selected semester.',
    };
  }
  if (!selectedEventId.value) {
    return {
      title: 'Select an Event',
      description: 'Choose an event above to inspect its sessions and absentee records.',
    };
  }
  if (occurrences.value.length === 0) {
    return {
      title: 'No Sessions Scheduled',
      description: 'This event does not have any scheduled occurrence sessions.',
    };
  }
  return {
    title: 'Select a Session',
    description: 'Choose a finalized event occurrence to automatically detect students who were required to attend but did not.',
  };
});

// ============================================================================
// Data Loading
// ============================================================================

async function initializeData() {
  isLoading.value = true;
  try {
    academicYears.value = await AcademicRepository.getYears();
    const activeSem = await AcademicRepository.getActiveSemester();

    if (activeSem) {
      selectedSemesterId.value = activeSem.id;
      selectedYearId.value = activeSem.academic_year_id;
    } else if (academicYears.value.length > 0) {
      selectedYearId.value = academicYears.value[0].id;
    }

    await onYearChanged();

    // If query param occurrenceId is provided, jump directly to it
    const occIdQuery = route.query.occurrenceId as string;
    if (occIdQuery) {
      await selectOccurrenceById(occIdQuery);
    }
  } catch (err) {
    console.error('Failed to initialize event absentee data:', err);
  } finally {
    isLoading.value = false;
  }
}

async function onYearChanged() {
  if (!selectedYearId.value) return;
  const allSemesters = await AcademicRepository.getSemesters();
  semesters.value = allSemesters.filter((s: Semester) => s.academic_year_id === selectedYearId.value);
  if (semesters.value.length > 0 && !semesters.value.some((s) => s.id === selectedSemesterId.value)) {
    selectedSemesterId.value = semesters.value[0].id;
  }
  await onSemesterChanged();
}

async function onSemesterChanged() {
  if (!selectedSemesterId.value) return;
  events.value = await EventsRepository.getEventsBySemester(selectedSemesterId.value);
  rules.value = await financeService.getRules(selectedSemesterId.value);

  // Default rule for absence
  const absenceRule = rules.value.find((r) => r.triggerType === 'ABSENCE') || rules.value[0];
  if (absenceRule) {
    selectedRuleId.value = absenceRule.id;
    fineAmountPesos.value = centavosToPeso(absenceRule.defaultAmountCentavos);
  }

  if (events.value.length > 0) {
    selectedEventId.value = events.value[0].id;
    await onEventChanged();
  } else {
    selectedEventId.value = '';
    occurrences.value = [];
    selectedOccurrenceId.value = '';
    summary.value = null;
    candidates.value = [];
  }
}

async function onEventChanged() {
  if (!selectedEventId.value) return;
  occurrences.value = await EventsRepository.getOccurrencesByEventId(selectedEventId.value);
  if (occurrences.value.length > 0) {
    selectedOccurrenceId.value = occurrences.value[0].id;
    await loadOccurrenceAbsentees();
  } else {
    selectedOccurrenceId.value = '';
    summary.value = null;
    candidates.value = [];
  }
}

async function selectOccurrenceById(occId: string) {
  const occ = await EventsRepository.getOccurrenceById(occId);
  if (occ) {
    const ev = await EventsRepository.getEventById(occ.event_id);
    if (ev) {
      selectedSemesterId.value = ev.semester_id;
      selectedEventId.value = ev.id;
      occurrences.value = await EventsRepository.getOccurrencesByEventId(ev.id);
      selectedOccurrenceId.value = occ.id;
      await loadOccurrenceAbsentees();
    }
  }
}

async function loadOccurrenceAbsentees() {
  if (!selectedOccurrenceId.value) return;
  isLoading.value = true;
  assessmentError.value = null;

  try {
    const cpId = assessmentMode.value === 'PER_CHECKPOINT' ? (selectedCheckpointId.value || undefined) : undefined;
    const result = await financeService.getAbsenteeCandidates(
      selectedOccurrenceId.value,
      selectedRuleId.value || undefined,
      cpId
    );
    summary.value = result.summary;
    candidates.value = result.candidates;

    // Automatically select first checkpoint if in PER_CHECKPOINT mode and none selected yet
    if (assessmentMode.value === 'PER_CHECKPOINT' && !selectedCheckpointId.value && summary.value.checkpoints && summary.value.checkpoints.length > 0) {
      selectedCheckpointId.value = summary.value.checkpoints[0].checkpointId;
      const cpResult = await financeService.getAbsenteeCandidates(
        selectedOccurrenceId.value,
        selectedRuleId.value || undefined,
        selectedCheckpointId.value
      );
      summary.value = cpResult.summary;
      candidates.value = cpResult.candidates;
    }

    // Set default fine title
    if (summary.value) {
      if (assessmentMode.value === 'PER_CHECKPOINT') {
        const cp = summary.value.checkpoints?.find((c) => c.checkpointId === selectedCheckpointId.value);
        customFineTitle.value = cp ? `Absence Fine: ${cp.label}` : `Absence Fine: ${summary.value.eventTitle}`;
      } else {
        customFineTitle.value = `Absence Fine: ${summary.value.eventTitle}`;
      }
    }
  } catch (err: any) {
    console.error('Failed to load occurrence absentees:', err);
    assessmentError.value = err.message || 'Error detecting absentees.';
  } finally {
    isLoading.value = false;
  }
}

function switchAssessmentMode(mode: 'WHOLE_EVENT' | 'PER_CHECKPOINT') {
  if (assessmentMode.value === mode) return;
  haptics.light();
  assessmentMode.value = mode;
  if (mode === 'PER_CHECKPOINT' && summary.value?.checkpoints && summary.value.checkpoints.length > 0) {
    if (!selectedCheckpointId.value) {
      selectedCheckpointId.value = summary.value.checkpoints[0].checkpointId;
    }
  } else {
    selectedCheckpointId.value = '';
  }
  loadOccurrenceAbsentees();
}

function selectCheckpoint(cpId: string) {
  if (selectedCheckpointId.value === cpId) return;
  haptics.light();
  selectedCheckpointId.value = cpId;
  loadOccurrenceAbsentees();
}

async function exportAbsenteesCsv() {
  if (candidates.value.length === 0) {
    await showToast('No absentee candidates to export.', 'warning');
    return;
  }

  isExportingCsv.value = true;
  try {
    const header = 'School ID,Full Name,Year Level,Section,Status,Missed Checkpoints,Already Fined\n';
    const rows = candidates.value.map((c) => {
      const missed = c.missedCheckpoints && c.missedCheckpoints.length > 0 ? c.missedCheckpoints.join('; ') : 'All Checkpoints';
      const fined = c.alreadyFined ? 'YES' : 'NO';
      return `"${c.schoolId}","${c.fullName}",${c.yearLevel},"${c.section}","${c.attendanceStatus}","${missed}","${fined}"`;
    }).join('\n');

    const modeStr = assessmentMode.value === 'PER_CHECKPOINT' ? (selectedCheckpointId.value || 'checkpoint') : 'whole_event';
    const filename = `absentees_${(summary.value?.eventTitle || 'event').replace(/\s+/g, '_')}_${modeStr}.csv`;

    await exportFile({
      filename,
      content: header + rows,
      mimeType: 'text/csv;charset=utf-8;',
      dialogTitle: 'Export Absentees CSV',
    });

    await showToast(`Exported ${filename}`, 'success');
  } catch (err: any) {
    console.error('Failed to export absentees CSV:', err);
    await showToast(err?.message || 'Failed to export CSV.', 'error');
  } finally {
    isExportingCsv.value = false;
  }
}

function handleRuleChange() {
  const rule = rules.value.find((r) => r.id === selectedRuleId.value);
  if (rule) {
    fineAmountPesos.value = centavosToPeso(rule.defaultAmountCentavos);
    customFineTitle.value = `Absence Fine: ${rule.name}`;
    loadOccurrenceAbsentees();
  }
}

// ============================================================================
// Selection Actions
// ============================================================================

function selectAllEligible() {
  haptics.light();
  candidates.value.forEach((c) => {
    if (!c.alreadyFined) c.selected = true;
  });
}

function deselectAll() {
  haptics.light();
  candidates.value.forEach((c) => {
    c.selected = false;
  });
}

function toggleStudentSelection(candidate: AbsenteeCandidate) {
  if (candidate.alreadyFined) return;
  haptics.light();
  candidate.selected = !candidate.selected;
}

// ============================================================================
// Bulk Fine Assessment Execution
// ============================================================================

function openBulkAssessmentModal() {
  if (selectedCandidates.value.length === 0) return;
  haptics.medium();
  isModalOpen.value = true;
}

async function confirmBulkAssessment() {
  if (selectedCandidates.value.length === 0) return;
  if (!canAssessFines.value) {
    assessmentError.value = assessFinesDisabledReason.value || 'Assessing fines requires an active internet connection.';
    return;
  }
  if (!isSessionClosed.value) {
    assessmentError.value = 'Cannot assess fines while session is open or scheduled.';
    return;
  }

  isAssessing.value = true;
  assessmentError.value = null;

  try {
    const studentIds = selectedCandidates.value.map((c) => c.studentId);
    const result = await financeService.assessBulkFines({
      occurrenceId: selectedOccurrenceId.value,
      ruleId: selectedRuleId.value || undefined,
      fineTitle: customFineTitle.value.trim() || (assessmentMode.value === 'PER_CHECKPOINT' ? 'Checkpoint Absence Fine' : 'Event Absence Fine'),
      amountCentavos: pesoToCentavos(fineAmountPesos.value),
      dueDate: dueDate.value || null,
      studentIds,
      notes: assessmentNotes.value.trim() || null,
      actorUserId: 'officer_local',
      mode: assessmentMode.value,
      checkpointId: assessmentMode.value === 'PER_CHECKPOINT' ? (selectedCheckpointId.value || undefined) : undefined,
    });

    haptics.success();
    await showToast(
      `Assessed ${result.assessedCount} fines totaling ${formatPeso(result.totalAssessedCentavos)}.`,
      'success'
    );

    isModalOpen.value = false;
    // Reload absentee list to update already-fined indicators
    await loadOccurrenceAbsentees();
  } catch (err: any) {
    console.error('Bulk assessment failed:', err);
    assessmentError.value = err.message || 'Failed to execute bulk assessment.';
    haptics.error();
  } finally {
    isAssessing.value = false;
  }
}

onMounted(initializeData);
onIonViewWillEnter(initializeData);
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Event Absentees"
      subtitle="Automated absentee detection & bulk fines"
      :back-button="true"
      default-back-href="/tabs/finance"
      variant="detail"
    />

    <ion-content class="safe-content non-tab-content">
      <div class="page-container">
        <!-- 1. Selection & Context Bar -->
        <UniCard class="selectors-card" padding="sm">
          <div class="selectors-grid">
            <!-- Semester Select -->
            <div class="field-col">
              <label class="field-label">Semester</label>
              <UniSelect
                :model-value="selectedSemesterId"
                :options="semesterOptions"
                placeholder="Select Semester"
                empty-placeholder="No semesters available"
                @change="handleSemesterSelect"
              />
            </div>

            <!-- Event Select -->
            <div class="field-col">
              <label class="field-label">Event</label>
              <UniSelect
                :model-value="selectedEventId"
                :options="eventOptions"
                placeholder="Select Event"
                empty-placeholder="No events found"
                @change="handleEventSelect"
              />
            </div>

            <!-- Occurrence / Session Select -->
            <div class="field-col">
              <label class="field-label">Occurrence / Session</label>
              <UniSelect
                :model-value="selectedOccurrenceId"
                :options="occurrenceOptions"
                :placeholder="!selectedEventId ? 'Select an event first' : 'Select Occurrence / Session'"
                :empty-placeholder="!selectedEventId ? 'Select an event first' : 'No sessions found'"
                @change="handleOccurrenceSelect"
              />
            </div>
          </div>
        </UniCard>

        <!-- Loading Spinner -->
        <div v-if="isLoading" class="loading-state">
          <ion-spinner name="crescent" color="primary" />
          <p class="loading-text">Analyzing attendance records and required roster...</p>
        </div>

        <template v-else-if="summary">
          <!-- Session Finalization Warning if Not CLOSED -->
          <div v-if="!isSessionClosed" class="alert-box warning-box">
            <ion-icon :icon="informationCircleOutline" class="alert-icon text-warning" />
            <div class="alert-text">
              <strong>Provisional Attendance (Session {{ summary.sessionStatus }})</strong>
              <p>
                Showing live/provisional absentee projections. Fines can be assessed once the attendance session is officially finalized and CLOSED.
              </p>
            </div>
          </div>

          <!-- Error Alert -->
          <div v-if="assessmentError" class="alert-box error-box">
            <ion-icon :icon="closeCircleOutline" class="alert-icon text-danger" />
            <div class="alert-text">
              <strong>Assessment Error</strong>
              <p>{{ assessmentError }}</p>
            </div>
          </div>

          <!-- Mode & Checkpoint Selector Card -->
          <UniCard class="mode-selector-card" padding="sm">
            <div class="mode-header">
              <span class="mode-title font-bold">Assessment Mode</span>
              <div class="mode-toggle-group">
                <button
                  type="button"
                  class="mode-btn"
                  :class="{ active: assessmentMode === 'WHOLE_EVENT' }"
                  @click="switchAssessmentMode('WHOLE_EVENT')"
                >
                  <ion-icon :icon="layersOutline" />
                  <span>Whole Event Fine</span>
                </button>
                <button
                  type="button"
                  class="mode-btn"
                  :class="{ active: assessmentMode === 'PER_CHECKPOINT' }"
                  @click="switchAssessmentMode('PER_CHECKPOINT')"
                >
                  <ion-icon :icon="timerOutline" />
                  <span>Per-Checkpoint Fine</span>
                </button>
              </div>
            </div>

            <!-- Checkpoint Selector Pills when in PER_CHECKPOINT mode -->
            <div
              v-if="assessmentMode === 'PER_CHECKPOINT' && summary.checkpoints && summary.checkpoints.length > 0"
              class="checkpoint-pills-row"
            >
              <button
                v-for="cp in summary.checkpoints"
                :key="cp.checkpointId"
                type="button"
                class="cp-pill"
                :class="{ selected: selectedCheckpointId === cp.checkpointId }"
                @click="selectCheckpoint(cp.checkpointId)"
              >
                <div class="cp-pill-top">
                  <span class="cp-pill-label font-bold">{{ cp.label }}</span>
                  <span
                    class="badge-mini"
                    :class="cp.type === 'IN' ? 'badge-in' : 'badge-out'"
                  >
                    {{ cp.type }}
                  </span>
                </div>
                <div class="cp-pill-meta">
                  <span class="text-danger font-mono font-bold">{{ cp.missingCount }} missing</span>
                  <span class="badge-mini badge-neutral">{{ cp.status }}</span>
                </div>
              </button>
            </div>
          </UniCard>

          <!-- 2. Attendance & Absentee Summary Grid -->
          <div class="summary-stats-grid">
            <UniStatCard
              label="Required"
              :value="summary.totalRequired.toString()"
              meta="Total audience"
              :interactive="false"
            />
            <UniStatCard
              label="Present"
              :value="summary.presentCount.toString()"
              value-color="success"
              meta="Verified check-ins"
              :interactive="false"
            />
            <UniStatCard
              label="Late"
              :value="summary.lateCount.toString()"
              value-color="warning"
              meta="Late check-ins"
              :interactive="false"
            />
            <UniStatCard
              label="Excused"
              :value="summary.excusedCount.toString()"
              meta="Approved excuses"
              :interactive="false"
            />
            <UniStatCard
              label="Total Absent"
              :value="summary.absentCount.toString()"
              value-color="danger"
              meta="No valid check-in"
              :interactive="false"
            />
            <UniStatCard
              label="Eligible to Fine"
              :value="summary.eligibleForFineCount.toString()"
              value-color="danger"
              meta="Awaiting penalty"
              :interactive="false"
            >
              <template #top-right>
                <span class="badge-mini badge-neutral">{{ summary.alreadyFinedCount }} already fined</span>
              </template>
            </UniStatCard>
          </div>

          <!-- 3. Filters & Action Toolbar -->
          <UniCard class="table-toolbar-card" padding="sm">
            <div class="toolbar-top">
              <div class="search-wrap">
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="Search student by name or ID..."
                  class="clean-search-input"
                />
              </div>

              <div class="filter-controls">
                <div class="filter-col">
                  <UniSelect
                    v-model="selectedYearLevel"
                    :options="yearLevelOptions"
                    placeholder="All Years"
                  />
                </div>

                <div class="filter-col">
                  <UniSelect
                    v-model="selectedSection"
                    :options="sectionOptions"
                    placeholder="All Sections"
                    empty-placeholder="No Sections"
                  />
                </div>
              </div>
            </div>

            <div class="toolbar-actions">
              <div class="selection-count">
                <span class="count-pill">
                  <strong>{{ selectedCandidates.length }}</strong> of {{ summary.eligibleForFineCount }} selected
                </span>
              </div>

              <div class="btn-group">
                <button
                  type="button"
                  class="action-pill-btn export-btn"
                  :disabled="filteredCandidates.length === 0 || isExportingCsv"
                  @click="exportAbsenteesCsv"
                >
                  <ion-icon :icon="downloadOutline" />
                  <span>{{ isExportingCsv ? 'Exporting...' : 'Export CSV' }}</span>
                </button>
                <button
                  type="button"
                  class="action-pill-btn"
                  @click="selectAllEligible"
                >
                  Select All Eligible
                </button>
                <button
                  type="button"
                  class="action-pill-btn text-muted"
                  @click="deselectAll"
                >
                  Deselect All
                </button>
              </div>
            </div>
          </UniCard>

          <!-- 4. Absentee List (UniTap Reusable Components) -->
          <div class="absentee-records-card">
            <UniRecordList
              :empty="filteredCandidates.length === 0"
              empty-title="No Absentees Match Filters"
              empty-description="No absentees found matching your search or filters."
            >
              <UniExpandableRow
                v-for="c in filteredCandidates"
                :key="c.studentId"
                :title="c.fullName"
                :subtitle="`${c.schoolId} • Year ${c.yearLevel} - ${c.section}`"
                :badge="c.alreadyFined ? 'Already Fined' : c.selected ? 'Selected for Fine' : 'Eligible'"
                :badge-variant="c.alreadyFined ? 'neutral' : c.selected ? 'primary' : 'warning'"
                :amount="formatPeso(pesoToCentavos(fineAmountPesos))"
                :amount-variant="c.alreadyFined ? 'default' : 'danger'"
              >
                <template #leading>
                  <div class="row-checkbox-wrap" @click.stop>
                    <input
                      type="checkbox"
                      v-model="c.selected"
                      :disabled="c.alreadyFined"
                      class="uni-checkbox"
                      aria-label="Select student for fine"
                      @click.stop
                    />
                  </div>
                </template>

                <template #content>
                  <div class="candidate-details-grid">
                    <div class="detail-item">
                      <span class="detail-label">School ID</span>
                      <span class="detail-val font-mono">{{ c.schoolId }}</span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">Year & Section</span>
                      <span class="detail-val">{{ c.yearLevel }} - {{ c.section }}</span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">Attendance Record</span>
                      <span class="detail-val text-danger font-bold">Unexcused Absence</span>
                    </div>
                    <div class="detail-item" v-if="c.missedCheckpoints && c.missedCheckpoints.length > 0">
                      <span class="detail-label">Missed Checkpoints</span>
                      <span class="detail-val text-warning">{{ c.missedCheckpoints.join(', ') }}</span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">Fine Status</span>
                      <span class="detail-val">
                        <strong v-if="c.alreadyFined" class="text-muted">Already Assessed</strong>
                        <strong v-else-if="c.selected" class="text-primary font-bold">Selected for Assessment</strong>
                        <strong v-else class="text-warning font-bold">Eligible for Assessment</strong>
                      </span>
                    </div>
                  </div>

                  <div v-if="!c.alreadyFined" class="candidate-row-actions">
                    <UniButton
                      variant="outline"
                      size="sm"
                      @click="toggleStudentSelection(c)"
                    >
                      {{ c.selected ? 'Deselect from Fine' : 'Select for Fine' }}
                    </UniButton>
                  </div>
                </template>
              </UniExpandableRow>
            </UniRecordList>
          </div>
        </template>

        <!-- Empty States when No Summary Loaded -->
        <UniEmptyState
          v-else
          :title="emptyStateInfo.title"
          :description="emptyStateInfo.description"
          :icon="calendarOutline"
        />
      </div>

      <!-- 5. Floating Bottom Assessment Action Bar -->
      <div
        v-if="summary && summary.eligibleForFineCount > 0"
        class="floating-action-dock"
      >
        <div class="dock-summary">
          <span class="dock-meta font-mono">{{ selectedCandidates.length }} students</span>
          <span class="dock-total font-mono font-bold">{{ formatPeso(totalAssessmentCentavos) }}</span>
        </div>

        <UniButton
          variant="primary"
          :disabled="selectedCandidates.length === 0 || !isSessionClosed || !canAssessFines"
          @click="openBulkAssessmentModal"
        >
          <ion-icon :icon="cashOutline" slot="start" />
          Bulk Assign Fines
        </UniButton>
      </div>

      <!-- 6. Bulk Assessment Configuration Sheet / Modal -->
      <UniSheet
        :is-open="isModalOpen"
        title="Confirm Bulk Fine Assessment"
        @close="isModalOpen = false"
      >
        <div class="sheet-form">
          <div class="form-group">
            <label class="form-label">Obligation Fine Rule</label>
            <UniSelect
              :model-value="selectedRuleId"
              :options="ruleOptions"
              placeholder="Select Fine Rule"
              empty-placeholder="No fine rules available"
              @change="handleRuleSelect"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Fine Title</label>
            <input
              v-model="customFineTitle"
              type="text"
              class="clean-input"
              placeholder="e.g. CSG General Assembly Absence Fine"
            />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Amount per Student (PHP)</label>
              <input
                v-model.number="fineAmountPesos"
                type="number"
                min="1"
                step="5"
                class="clean-input font-mono"
              />
            </div>
            <div class="form-group">
              <label class="form-label">Due Date (Optional)</label>
              <input
                v-model="dueDate"
                type="date"
                class="clean-input"
              />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Officer Assessment Notes (Optional)</label>
            <textarea
              v-model="assessmentNotes"
              class="clean-textarea"
              rows="2"
              placeholder="e.g. Approved under CSG Resolution 2026-04"
            ></textarea>
          </div>

          <!-- Preview Summary Box -->
          <div class="preview-box">
            <div class="preview-row">
              <span>Event:</span>
              <strong>{{ summary?.eventTitle }}</strong>
            </div>
            <div class="preview-row">
              <span>Assessment Scope:</span>
              <strong class="text-primary">{{ assessmentMode === 'PER_CHECKPOINT' ? 'Per-Checkpoint Fine' : 'Whole-Event Fine' }}</strong>
            </div>
            <div class="preview-row">
              <span>Selected Students:</span>
              <strong class="font-mono">{{ selectedCandidates.length }}</strong>
            </div>
            <div class="preview-row">
              <span>Fine per Student:</span>
              <strong class="font-mono">{{ formatPeso(pesoToCentavos(fineAmountPesos)) }}</strong>
            </div>
            <div class="preview-divider"></div>
            <div class="preview-row total-row">
              <span>Total Bulk Assessment:</span>
              <strong class="text-primary font-mono font-bold">{{ formatPeso(totalAssessmentCentavos) }}</strong>
            </div>
          </div>

          <div v-if="!canAssessFines" class="offline-warning-box">
            <ion-icon :icon="alertCircleOutline" class="warn-icon" />
            <div class="warn-text">
              <strong>Offline Mode</strong>
              <p>{{ assessFinesDisabledReason }}</p>
            </div>
          </div>

          <div class="sheet-actions">
            <UniButton
              variant="outline"
              @click="isModalOpen = false"
            >
              Cancel
            </UniButton>
            <UniButton
              variant="primary"
              :disabled="isAssessing || selectedCandidates.length === 0 || !canAssessFines"
              @click="confirmBulkAssessment"
            >
              <ion-spinner v-if="isAssessing" name="crescent" slot="start" />
              <span>Confirm & Assess Fines</span>
            </UniButton>
          </div>
        </div>
      </UniSheet>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.page-container {
  padding: 4px 0 16px 0;
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.selectors-card {
  border: 1px solid var(--uni-border);
  box-shadow: var(--uni-shadow-card);
}

.selectors-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

@media (min-width: 580px) {
  .selectors-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.field-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--uni-text-secondary);
  letter-spacing: 0.06em;
}

.clean-select {
  width: 100%;
  padding: 10px 14px;
  border-radius: var(--uni-radius-input, 12px);
  border: 1px solid var(--uni-border);
  background: var(--uni-surface);
  font-size: 13.5px;
  color: var(--uni-text-primary);
  font-weight: 600;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  box-sizing: border-box;
}

.clean-select:focus {
  border-color: var(--uni-primary);
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  gap: 12px;
}

.loading-text {
  font-size: 13px;
  color: var(--uni-muted, #64748b);
}

.alert-box {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--uni-radius-card, 12px);
  font-size: 13px;
}

.alert-icon {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}

.warning-box {
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: var(--uni-warning, #d97706);
}

.success-box {
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: var(--uni-success, #059669);
}

.error-box {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: var(--uni-danger, #dc2626);
}

.summary-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}

.badge-mini {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.badge-primary {
  background: var(--uni-primary-bg, rgba(15, 118, 110, 0.15));
  color: var(--uni-primary, #0f766e);
}

.badge-danger {
  background: rgba(239, 68, 68, 0.15);
  color: var(--uni-danger, #dc2626);
}

.badge-warning {
  background: rgba(245, 158, 11, 0.15);
  color: var(--uni-warning, #d97706);
}

.badge-neutral {
  background: var(--uni-surface-secondary, rgba(100, 116, 139, 0.15));
  color: var(--uni-text-secondary, #64748b);
}

.table-toolbar-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
}

.toolbar-top {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.search-wrap {
  flex: 1;
  min-width: 200px;
}

.clean-search-input {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border-radius: var(--uni-radius-card, 14px);
  border: 1px solid var(--uni-border);
  background: var(--uni-surface);
  color: var(--uni-text);
  font-size: 13.5px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.16s ease;
}

.clean-search-input:focus {
  border-color: var(--uni-primary);
}

.clean-search-input::placeholder {
  color: var(--uni-text-secondary);
}

.filter-controls {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.filter-col {
  min-width: 130px;
}

.toolbar-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  border-top: 1px solid var(--uni-border);
  padding-top: 8px;
}

.count-pill {
  font-size: 12px;
  color: var(--uni-text-secondary);
}

.btn-group {
  display: flex;
  gap: 8px;
}

.action-pill-btn {
  background: transparent;
  border: 1px solid var(--uni-border);
  border-radius: 9999px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 700;
  color: var(--uni-primary);
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease;
}

.action-pill-btn:hover {
  background: var(--uni-surface-secondary);
}

.action-pill-btn.text-muted {
  color: var(--uni-text-secondary);
}

/* Absentee Records List */
.absentee-records-card {
  width: 100%;
}

.row-checkbox-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-right: 4px;
}

.uni-checkbox {
  width: 18px;
  height: 18px;
  accent-color: var(--uni-primary, #0f766e);
  cursor: pointer;
}

.candidate-details-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  padding: 4px 0;
}

@media (min-width: 600px) {
  .candidate-details-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-label {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--uni-text-secondary);
}

.detail-val {
  font-size: 13px;
  color: var(--uni-text);
}

.candidate-row-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
  border-top: 1px dashed var(--uni-border);
  margin-top: 4px;
}

.floating-action-dock {
  position: fixed;
  bottom: calc(16px + var(--ion-safe-area-bottom, 0px));
  left: 0;
  right: 0;
  width: calc(100% - 24px);
  max-width: 500px;
  margin: 0 auto;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-dock, 9999px);
  padding: 10px 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: var(--uni-shadow-dock);
  z-index: 1000;
  box-sizing: border-box;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.dock-summary {
  display: flex;
  flex-direction: column;
}

.dock-meta {
  font-size: 11px;
  font-weight: 500;
  color: var(--uni-text-secondary);
}

.dock-total {
  font-size: 17px;
  font-weight: 800;
  color: var(--uni-primary);
}

.sheet-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.form-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--uni-text-secondary);
}

.clean-input,
.clean-textarea {
  width: 100%;
  padding: 10px 14px;
  border-radius: var(--uni-radius-card, 12px);
  border: 1px solid var(--uni-border);
  background: var(--uni-surface);
  color: var(--uni-text);
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
}

.clean-input:focus,
.clean-textarea:focus {
  border-color: var(--uni-primary);
}

.preview-box {
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-card, 12px);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--uni-text);
}

.preview-row {
  display: flex;
  justify-content: space-between;
}

.preview-divider {
  border-top: 1px dashed var(--uni-border);
  margin: 4px 0;
}

.total-row {
  font-size: 14px;
}

.sheet-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

.mode-selector-card {
  border: 1px solid var(--uni-border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mode-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.mode-title {
  font-size: 13px;
  color: var(--uni-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.mode-toggle-group {
  display: flex;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-input, 12px);
  padding: 3px;
  gap: 4px;
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 9px;
  border: none;
  background: transparent;
  color: var(--uni-text-secondary);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-btn ion-icon {
  font-size: 16px;
}

.mode-btn.active {
  background: var(--uni-primary);
  color: #ffffff;
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.checkpoint-pills-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  padding-top: 4px;
  border-top: 1px dashed var(--uni-border);
}

.cp-pill {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--uni-radius-card, 12px);
  border: 1px solid var(--uni-border);
  background: var(--uni-surface);
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cp-pill:hover {
  border-color: var(--uni-primary);
}

.cp-pill.selected {
  border-color: var(--uni-primary);
  background: rgba(15, 118, 110, 0.08);
  box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.2);
}

.cp-pill-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}

.cp-pill-label {
  font-size: 13px;
  color: var(--uni-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cp-pill-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.badge-in {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.badge-out {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.export-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  border-color: var(--uni-primary);
  color: var(--uni-primary);
}

.offline-warning-box {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: #ef4444;
  margin-bottom: 12px;
}

.offline-warning-box .warn-icon {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}

.offline-warning-box .warn-text strong {
  display: block;
  font-size: 13px;
  font-weight: 700;
}

.offline-warning-box .warn-text p {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--uni-text-muted, #94a3b8);
}
</style>
