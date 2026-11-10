<template>
  <ion-page>
    <UniPageHeader
      title="Import Students"
      subtitle="Batch CSV roster import and enrollment"
      :back-button="true"
      default-back-href="/tabs/students"
      variant="detail"
    />

    <!-- FULL BLOCKING PROCESSING MODAL WITH REAL CANCELLATION -->
    <ion-modal
      :is-open="isBlockingModalOpen"
      :backdrop-dismiss="false"
      class="blocking-process-modal"
    >
      <div class="blocking-modal-wrap">
        <div class="blocking-modal-card animate-fade-up">
          <!-- Animated Header Icon -->
          <div class="blocking-icon-box">
            <ion-spinner name="crescent" class="blocking-spinner" />
          </div>

          <!-- Dynamic Title & Description -->
          <div class="blocking-text-block">
            <h3 class="blocking-modal-title">
              {{ importState === 'VALIDATING' ? 'Validating Student Roster...' : 'Importing Student Roster...' }}
            </h3>
            <p class="blocking-modal-desc">
              {{
                importState === 'VALIDATING'
                  ? 'Verifying CSV syntax, student IDs, and academic foreign keys in database.'
                  : 'Contacting Supabase Cloud Database. Ingesting student records and academic enrollments.'
              }}
            </p>
          </div>

          <!-- Indeterminate Progress Indicator -->
          <div class="indeterminate-progress-bar">
            <div class="indeterminate-bar-fill"></div>
          </div>

          <!-- Metadata Context Card -->
          <div class="blocking-meta-box font-mono">
            <div class="meta-row">
              <span class="meta-lbl">File:</span>
              <span class="meta-val">{{ selectedFileName || 'student_roster.csv' }}</span>
            </div>
            <div v-if="parseResult" class="meta-row">
              <span class="meta-lbl">Valid Records:</span>
              <span class="meta-val">{{ parseResult.validRows.length }} Students</span>
            </div>
            <div class="meta-row">
              <span class="meta-lbl">Target Semester:</span>
              <span class="meta-val">{{ selectedSemesterLabel }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-lbl">Target Program:</span>
              <span class="meta-val">{{ selectedProgramLabel }}</span>
            </div>
          </div>

          <div class="blocking-disclaimer font-mono">
            <ion-icon :icon="alertCircleOutline" />
            <span>Screen is blocked to protect data integrity and prevent double execution.</span>
          </div>

          <!-- REAL CANCEL BUTTON -->
          <div class="blocking-modal-actions">
            <UniButton
              variant="destructive"
              size="md"
              :block="true"
              :icon="closeCircleOutline"
              @click="cancelActiveProcess"
            >
              Cancel Process
            </UniButton>
          </div>
        </div>
      </div>
    </ion-modal>

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Error banner -->
        <div v-if="errorMessage" class="error-banner font-mono" role="alert">
          <div class="error-banner-content">
            <ion-icon :icon="alertCircleOutline" class="error-icon" />
            <div class="error-text">
              <strong>Import Operation Alert</strong>
              <p>{{ errorMessage }}</p>
            </div>
          </div>
        </div>

        <!-- Academic Setup Prerequisite Warning -->
        <div v-if="!hasAcademicPrerequisites" class="error-banner font-mono" role="alert">
          <ion-icon :icon="alertCircleOutline" style="font-size: 16px; vertical-align: -2px; margin-right: 6px;" />
          <strong>Academic Setup Required:</strong> Target Semester and Program are required before importing students. Please configure them in Settings.
        </div>

        <div class="form-flow">
          <!-- Section 1: Academic Enrollment Context -->
          <section class="form-section">
            <div class="section-title-row">
              <span class="section-title">Enrollment term &amp; program</span>
            </div>

            <div class="fields-stack">
              <UniFormField
                label="Target Semester"
                hint="Semester where students will be enrolled"
                :required="true"
              >
                <UniSelect
                  v-model="selectedSemesterId"
                  :options="semesterOptions"
                  :disabled="isImporting || importState === 'IMPORTING'"
                  placeholder="Select Semester"
                  header="Target Semester"
                />
              </UniFormField>

              <UniFormField
                label="Program / Course"
                hint="Academic program classification"
                :required="true"
              >
                <UniSelect
                  v-model="selectedProgramId"
                  :options="programOptions"
                  :disabled="isImporting || importState === 'IMPORTING'"
                  placeholder="Select Program"
                  header="Program"
                />
              </UniFormField>
            </div>
          </section>

          <!-- Section 2: File Upload Drop Zone (Hidden during Success state) -->
          <section v-if="importState !== 'SUCCESS'" class="form-section">
            <div class="section-title-row">
              <span class="section-title">Upload roster file</span>
              <button
                type="button"
                class="btn-text-link"
                :disabled="isImporting || importState === 'IMPORTING'"
                @click="downloadTemplate"
              >
                <ion-icon :icon="cloudDownloadOutline" />
                <span>Sample CSV</span>
              </button>
            </div>

            <input
              type="file"
              ref="fileInputRef"
              accept=".csv,text/csv"
              style="display: none"
              :disabled="isImporting || importState === 'IMPORTING'"
              @change="handleFileSelected"
            />

            <!-- Drop Zone -->
            <div
              class="drop-zone"
              :class="{
                'has-file': Boolean(selectedFileName),
                'disabled-zone': !selectedSemesterId || !selectedProgramId || isImporting || importState === 'IMPORTING'
              }"
              @click="triggerFileInput"
            >
              <div class="drop-icon-wrapper">
                <ion-icon :icon="documentTextOutline" class="drop-icon" />
              </div>
              <div v-if="!selectedSemesterId || !selectedProgramId" class="drop-text">
                <span class="drop-primary" style="color: #d97706;">Select Target Semester &amp; Program first</span>
                <div class="drop-hint">Enrollment requires matching Semester and Program foreign keys.</div>
              </div>
              <div v-else-if="isImporting || importState === 'IMPORTING'" class="drop-text">
                <span class="drop-primary">Import in progress...</span>
                <div class="drop-hint">File upload disabled while records are being processed.</div>
              </div>
              <div v-else class="drop-text">
                <span class="drop-primary">Click to select CSV file</span> or drag &amp; drop here
                <div class="drop-hint font-mono">
                  Headers: school_id, first_name, middle_name, last_name, year, section
                </div>
              </div>
            </div>

            <!-- Validating Feedback Banner -->
            <div v-if="importState === 'VALIDATING'" class="validating-banner">
              <ion-spinner name="crescent" class="spinner-sm text-primary" />
              <div class="validating-text font-mono">
                <strong>Validating CSV &amp; Foreign Keys...</strong>
                <span>Matching school IDs, year levels, and sections in database</span>
              </div>
            </div>

            <div v-if="selectedFileName && importState !== 'VALIDATING'" class="selected-file-badge">
              <div class="file-badge-info">
                <ion-icon :icon="checkmarkCircle" class="file-badge-icon" />
                <span class="file-badge-name">{{ selectedFileName }}</span>
              </div>
              <button
                v-if="!isImporting && importState !== 'IMPORTING'"
                type="button"
                class="btn-clear-file"
                @click.stop="resetToIdle"
                aria-label="Clear selected file"
              >
                <ion-icon :icon="closeOutline" />
              </button>
            </div>
          </section>

          <!-- Section 3: Visible In-Flight Progress Panel (IMPORTING STATE) -->
          <section v-if="importState === 'IMPORTING'" class="form-section import-progress-section" role="status">
            <div class="progress-panel-head">
              <div class="progress-spinner-wrap">
                <ion-spinner name="crescent" class="import-spinner" />
              </div>
              <div class="progress-title-col">
                <h3 class="progress-title">Importing student roster...</h3>
                <p class="progress-subtitle">
                  Contacting Supabase Cloud Database. Processing atomic student records and academic enrollments.
                </p>
              </div>
            </div>

            <!-- Indeterminate Progress Indicator (Atomic RPC) -->
            <div class="indeterminate-progress-bar">
              <div class="indeterminate-bar-fill"></div>
            </div>

            <div class="progress-details-grid font-mono">
              <div class="progress-detail-item">
                <span class="p-label">Selected File</span>
                <span class="p-value">{{ selectedFileName }}</span>
              </div>
              <div class="progress-detail-item">
                <span class="p-label">Valid Ingest Rows</span>
                <span class="p-value">{{ parseResult?.validRows.length }} student(s)</span>
              </div>
              <div class="progress-detail-item">
                <span class="p-label">Target Semester</span>
                <span class="p-value">{{ selectedSemesterLabel }}</span>
              </div>
              <div class="progress-detail-item">
                <span class="p-label">Target Program</span>
                <span class="p-value">{{ selectedProgramLabel }}</span>
              </div>
            </div>

            <div class="progress-disclaimer font-mono">
              <ion-icon :icon="alertCircleOutline" />
              <span>Please do not close or navigate away while the database transaction is in progress.</span>
            </div>
          </section>

          <!-- Section 4: Validation Preview & Confirmation (READY or FAILED or IMPORTING) -->
          <section v-if="parseResult && importState !== 'SUCCESS'" class="form-section preview-section">
            <div class="section-title-row">
              <span class="section-title">Validation preview</span>
              <span v-if="importState === 'READY'" class="preview-badge ready-badge font-mono">Ready to Import</span>
              <span v-else-if="importState === 'IMPORTING'" class="preview-badge importing-badge font-mono">Processing</span>
              <span v-else-if="importState === 'FAILED'" class="preview-badge failed-badge font-mono">Retry Allowed</span>
            </div>

            <!-- Foreign Key Enrollment Context -->
            <div class="fk-context-badge">
              <span class="fk-tag">
                <ion-icon :icon="checkmarkCircle" />
                Semester FK: <strong>{{ selectedSemesterLabel }}</strong>
              </span>
              <span class="fk-tag">
                <ion-icon :icon="checkmarkCircle" />
                Program FK: <strong>{{ selectedProgramLabel }}</strong>
              </span>
            </div>

            <!-- KPI Stats Grid -->
            <div class="stats-grid">
              <div class="stat-card">
                <span class="stat-num font-mono">{{ parseResult.totalRows }}</span>
                <span class="stat-lbl">Total Rows</span>
              </div>
              <div class="stat-card valid">
                <span class="stat-num font-mono">{{ parseResult.validRows.length }}</span>
                <span class="stat-lbl">Valid Records</span>
              </div>
              <div class="stat-card update">
                <span class="stat-num font-mono">{{ existingCount }}</span>
                <span class="stat-lbl">Existing Students</span>
              </div>
              <div class="stat-card invalid">
                <span class="stat-num font-mono">{{ parseResult.invalidRows.length }}</span>
                <span class="stat-lbl">Invalid Rows</span>
              </div>
            </div>

            <!-- Duplicate School IDs in CSV Warning -->
            <div v-if="duplicateSchoolIdsInCsv > 0" class="warning-box font-mono">
              <ion-icon :icon="alertCircleOutline" />
              <span><strong>{{ duplicateSchoolIdsInCsv }} Duplicate School ID(s)</strong> detected within CSV file and rejected.</span>
            </div>

            <!-- Year-level and section distribution breakdown -->
            <div v-if="sectionDistribution.length > 0" class="distribution-card">
              <div class="distribution-header">
                <span class="distribution-title">Enrollment Distribution</span>
                <span class="distribution-count font-mono">{{ sectionDistribution.length }} Group(s)</span>
              </div>
              <div class="distribution-grid">
                <div v-for="item in sectionDistribution" :key="item.label" class="distribution-item font-mono">
                  <span class="dist-label">{{ item.label }}</span>
                  <span class="dist-value font-mono">{{ item.count }}</span>
                </div>
              </div>
            </div>

            <!-- Invalid Rows Alerts -->
            <div v-if="parseResult.invalidRows.length > 0" class="invalid-box">
              <div class="invalid-title">
                <ion-icon :icon="alertCircleOutline" />
                <span>Errors found in {{ parseResult.invalidRows.length }} row(s):</span>
              </div>
              <ul class="invalid-list">
                <li v-for="row in parseResult.invalidRows.slice(0, 5)" :key="row.rowNumber">
                  <strong>Row {{ row.rowNumber }}:</strong> {{ row.error }}
                </li>
                <li v-if="parseResult.invalidRows.length > 5" class="invalid-more">
                  ...and {{ parseResult.invalidRows.length - 5 }} more error(s).
                </li>
              </ul>
            </div>

            <!-- Action Button using UniButton -->
            <div class="form-submit-row">
              <UniButton
                variant="primary"
                size="lg"
                :block="true"
                :disabled="!selectedSemesterId || !selectedProgramId || parseResult.validRows.length === 0 || isImporting || importState === 'IMPORTING'"
                :loading="isImporting || importState === 'IMPORTING'"
                :icon="cloudUploadOutline"
                @click="executeImport"
              >
                <span v-if="isImporting || importState === 'IMPORTING'">Importing Students...</span>
                <span v-else-if="importState === 'FAILED'">Retry Import {{ parseResult.validRows.length }} Student(s)</span>
                <span v-else>Confirm &amp; Import {{ parseResult.validRows.length }} Student(s)</span>
              </UniButton>
            </div>
          </section>

          <!-- Section 5: Confirmed Server Success Summary (SUCCESS STATE) -->
          <div v-if="importState === 'SUCCESS' && importResult" class="import-success-card" role="status">
            <div class="success-header">
              <ion-icon :icon="checkmarkCircle" class="success-icon" />
              <div class="success-header-text">
                <h3 class="success-title">Import Completed Successfully</h3>
                <p class="success-sub">
                  Server confirmed ingestion of student records and academic enrollments.
                </p>
              </div>
            </div>

            <div class="success-stats-grid">
              <div class="success-stat-box">
                <span class="stat-num font-mono">{{ importResult.totalRows }}</span>
                <span class="stat-lbl">Processed</span>
              </div>
              <div class="success-stat-box text-success">
                <span class="stat-num font-mono">{{ importResult.importedCount }}</span>
                <span class="stat-lbl">Imported/Updated</span>
              </div>
              <div class="success-stat-box text-accent">
                <span class="stat-num font-mono">{{ importResult.enrolledCount }}</span>
                <span class="stat-lbl">Enrolled</span>
              </div>
              <div class="success-stat-box">
                <span class="stat-num font-mono">{{ importResult.skippedCount }}</span>
                <span class="stat-lbl">Skipped</span>
              </div>
              <div class="success-stat-box" :class="{ 'text-danger': importResult.rejectedCount > 0 }">
                <span class="stat-num font-mono">{{ importResult.rejectedCount }}</span>
                <span class="stat-lbl">Rejected</span>
              </div>
            </div>

            <div class="success-meta-container font-mono">
              <div v-if="importResult.batchId" class="success-meta-row">
                <span class="meta-label">Import Batch ID:</span>
                <code class="meta-code font-mono">{{ importResult.batchId }}</code>
              </div>
              <div v-if="importResult.completedAt" class="success-meta-row">
                <span class="meta-label">Completion Time:</span>
                <span class="meta-val font-mono">{{ new Date(importResult.completedAt).toLocaleString() }}</span>
              </div>
            </div>

            <div v-if="importResult.serverSynced" class="server-sync-badge">
              <ion-icon :icon="cloudDoneOutline" class="sync-icon" />
              <span>Direct Supabase Mode — Confirmed in Remote Database</span>
            </div>
            <div v-else class="server-sync-badge offline">
              <ion-icon :icon="cloudUploadOutline" class="sync-icon" />
              <span>Saved locally &amp; queued to sync outbox</span>
            </div>

            <div class="success-actions">
              <UniButton variant="primary" size="md" :block="true" @click="router.push('/tabs/students')">
                Return to Student Management
              </UniButton>
              <UniButton variant="secondary" size="md" :block="true" @click="resetToIdle">
                Import Another File
              </UniButton>
            </div>
          </div>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonIcon, IonSpinner, IonModal } from '@ionic/vue';
import {
  cloudDownloadOutline,
  cloudUploadOutline,
  cloudDoneOutline,
  documentTextOutline,
  closeOutline,
  closeCircleOutline,
  checkmarkCircle,
  alertCircleOutline,
} from 'ionicons/icons';
import {
  UniPageHeader,
  UniFormField,
  UniSelect,
  UniButton,
} from '@/components/ui';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { exportFile } from '@/utilities/file-export';
import {
  CsvImportService,
  type CsvParseResult,
  type ImportExecutionResult,
} from '@/services/csv-import.service';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { useToast } from '@/composables/useToast';
import { haptics } from '@/utilities/haptics';
import type { Semester, Program } from '@/types/database';

export type ImportUiState = 'IDLE' | 'VALIDATING' | 'READY' | 'IMPORTING' | 'SUCCESS' | 'FAILED';

const router = useRouter();
const { showToast } = useToast();

const importState = ref<ImportUiState>('IDLE');
let activeAbortController: AbortController | null = null;

const isBlockingModalOpen = computed(() => {
  return importState.value === 'VALIDATING' || importState.value === 'IMPORTING';
});
const semesters = ref<Semester[]>([]);
const programs = ref<Program[]>([]);
const selectedSemesterId = ref('');
const selectedProgramId = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);

const semesterOptions = computed(() =>
  semesters.value.map((sem) => ({
    value: sem.id,
    label: `${sem.term} Semester (${sem.academic_year_id})`,
    badge: sem.status === 'ACTIVE' ? 'Active' : undefined,
  }))
);

const programOptions = computed(() =>
  programs.value.map((prog) => ({
    value: prog.id,
    label: `${prog.code} — ${prog.name}`,
  }))
);

const selectedSemesterLabel = computed(() => {
  const sem = semesters.value.find((s) => s.id === selectedSemesterId.value);
  return sem ? `${sem.term} Semester (${sem.academic_year_id})` : 'None Selected';
});

const selectedProgramLabel = computed(() => {
  const prog = programs.value.find((p) => p.id === selectedProgramId.value);
  return prog ? `${prog.code} — ${prog.name}` : 'None Selected';
});

const hasAcademicPrerequisites = computed(() => semesters.value.length > 0 && programs.value.length > 0);

const selectedFileName = ref('');
const rawFileContent = ref<string | null>(null);
const parseResult = ref<CsvParseResult | null>(null);
const isImporting = ref(false);
const importResult = ref<ImportExecutionResult | null>(null);
const errorMessage = ref<string | null>(null);

const existingCount = computed(() => {
  if (!parseResult.value) return 0;
  return parseResult.value.validRows.filter((r) => r.isExistingStudent).length;
});

const duplicateSchoolIdsInCsv = computed(() => {
  if (!parseResult.value) return 0;
  return parseResult.value.invalidRows.filter((r) =>
    r.error?.toLowerCase().includes('duplicate school_id')
  ).length;
});

const sectionDistribution = computed(() => {
  if (!parseResult.value) return [];
  const map = new Map<string, number>();
  for (const row of parseResult.value.validRows) {
    if (!row.data) continue;
    const key = `Year ${row.data.year} • Sec ${row.data.section}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

onMounted(async () => {
  try {
    semesters.value = await AcademicRepository.getSemesters();
    programs.value = await AcademicRepository.getPrograms();

    const active = await AcademicRepository.getActiveSemester();
    if (active) {
      selectedSemesterId.value = active.id;
    } else if (semesters.value.length > 0) {
      selectedSemesterId.value = semesters.value[0].id;
    }

    if (programs.value.length > 0) {
      selectedProgramId.value = programs.value[0].id;
    }
  } catch (err: unknown) {
    console.error('[CsvImportPage] Failed to load academic terms/programs:', err);
  }
});

function cancelActiveProcess() {
  haptics.warning();
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  CsvImportService.resetImportLock();
  const wasValidating = importState.value === 'VALIDATING';
  if (wasValidating) {
    resetToIdle();
    errorMessage.value = 'Validation process was cancelled by user.';
    showToast('Validation cancelled.', 'warning');
  } else {
    isImporting.value = false;
    importState.value = 'FAILED';
    errorMessage.value = 'Import operation was cancelled by user. No database changes were applied.';
    showToast('Import cancelled by user.', 'warning');
  }
}

async function revalidateCurrentFile() {
  if (!rawFileContent.value || !selectedFileName.value) return;
  if (!selectedSemesterId.value || !selectedProgramId.value) {
    parseResult.value = null;
    importState.value = 'IDLE';
    return;
  }
  activeAbortController = new AbortController();
  importState.value = 'VALIDATING';
  try {
    const res = await CsvImportService.parseAndValidate(
      rawFileContent.value,
      selectedFileName.value,
      selectedSemesterId.value,
      selectedProgramId.value,
      activeAbortController.signal
    );
    parseResult.value = res;
    errorMessage.value = null;
    importState.value = res.validRows.length > 0 ? 'READY' : 'FAILED';
  } catch (err: unknown) {
    if (activeAbortController?.signal.aborted) {
      resetToIdle();
      return;
    }
    const msg = (err as Error).message || 'Failed to re-validate CSV file.';
    errorMessage.value = msg;
    parseResult.value = null;
    importState.value = 'FAILED';
  } finally {
    activeAbortController = null;
  }
}

watch([selectedSemesterId, selectedProgramId], () => {
  if (rawFileContent.value && importState.value !== 'IMPORTING') {
    revalidateCurrentFile();
  }
});

function triggerFileInput() {
  if (isImporting.value || importState.value === 'IMPORTING') return;
  if (!selectedSemesterId.value || !selectedProgramId.value) {
    const msg = 'Please select both Target Semester and Program above to validate foreign key matching for enrollment.';
    errorMessage.value = msg;
    showToast(msg, 'warning');
    haptics.error();
    return;
  }
  fileInputRef.value?.click();
}

function resetToIdle() {
  if (isImporting.value || importState.value === 'IMPORTING') return;
  selectedFileName.value = '';
  rawFileContent.value = null;
  parseResult.value = null;
  importResult.value = null;
  errorMessage.value = null;
  importState.value = 'IDLE';
  if (fileInputRef.value) fileInputRef.value.value = '';
}

async function handleFileSelected(e: Event) {
  if (isImporting.value || importState.value === 'IMPORTING') return;
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;
  const file = files[0];
  selectedFileName.value = file.name;
  importResult.value = null;
  errorMessage.value = null;

  if (!selectedSemesterId.value || !selectedProgramId.value) {
    const msg = 'Please select both Target Semester and Program first so enrollment foreign keys can be validated.';
    errorMessage.value = msg;
    showToast(msg, 'warning');
    haptics.error();
    resetToIdle();
    return;
  }

  activeAbortController = new AbortController();
  importState.value = 'VALIDATING';

  try {
    const content = await file.text();
    rawFileContent.value = content;
    const res = await CsvImportService.parseAndValidate(
      content,
      file.name,
      selectedSemesterId.value,
      selectedProgramId.value,
      activeAbortController.signal
    );
    parseResult.value = res;
    importState.value = res.validRows.length > 0 ? 'READY' : 'FAILED';
    haptics.light();
  } catch (err: unknown) {
    if (activeAbortController?.signal.aborted) {
      resetToIdle();
      return;
    }
    const msg = (err as Error).message || 'Failed to parse CSV file.';
    errorMessage.value = msg;
    showToast(msg, 'error');
    haptics.error();
    importState.value = 'FAILED';
    resetToIdle();
  } finally {
    activeAbortController = null;
  }
}

async function executeImport() {
  // Prevent double-click or concurrent clicks
  if (isImporting.value || importState.value === 'IMPORTING') return;
  if (!parseResult.value || parseResult.value.validRows.length === 0) return;

  if (!selectedSemesterId.value) {
    errorMessage.value = 'Target semester foreign key is required.';
    showToast(errorMessage.value, 'error');
    return;
  }
  if (!selectedProgramId.value) {
    errorMessage.value = 'Program foreign key is required.';
    showToast(errorMessage.value, 'error');
    return;
  }

  // Switch immediately to IMPORTING state
  importState.value = 'IMPORTING';
  isImporting.value = true;
  errorMessage.value = null;
  activeAbortController = new AbortController();

  try {
    // Persistent duplicate protection check
    if (parseResult.value.sha256) {
      const existing = await CsvImportService.findExistingBatch(
        parseResult.value.sha256,
        selectedSemesterId.value
      );
      if (existing) {
        const msg = `This CSV roster (${existing.source_filename}) was already successfully imported for ${selectedSemesterLabel.value} on ${new Date(existing.imported_at).toLocaleString()} (Batch: ${existing.id}). Duplicate submission prevented.`;
        errorMessage.value = msg;
        importState.value = 'FAILED';
        isImporting.value = false;
        haptics.error();
        showToast(msg, 'warning');
        return;
      }
    }

    if (activeAbortController.signal.aborted) {
      return;
    }

    const user = SupabaseAuthService.user.value || authService.user.value;
    const userId = user ? user.id : 'usr_admin';
    const res = await CsvImportService.executeImport(
      parseResult.value,
      selectedSemesterId.value,
      selectedProgramId.value,
      userId,
      activeAbortController.signal
    );

    // Confirmed server success
    importResult.value = res;
    importState.value = 'SUCCESS';
    haptics.success();
    showToast(`Successfully imported ${res.importedCount} student(s)`, 'success');
  } catch (err: unknown) {
    if (activeAbortController?.signal.aborted) {
      errorMessage.value = 'Import was cancelled by user.';
      importState.value = 'FAILED';
      return;
    }
    // Failure handling: preserve selected CSV and validation preview for safe retry
    const msg = 'Import failed: ' + ((err as Error).message || String(err));
    errorMessage.value = msg;
    importState.value = 'FAILED';
    showToast(msg, 'error');
    haptics.error();
  } finally {
    isImporting.value = false;
    activeAbortController = null;
  }
}

async function downloadTemplate() {
  const csvContent =
    'school_id,first_name,middle_name,last_name,year,section\nMCC2026-0001,Juan,Protacio,Dela Cruz,1,1F4\nMCC2026-0002,Maria,Clara,Santos,1,1F4\n';
  try {
    await exportFile({
      filename: 'student_import_template.csv',
      content: csvContent,
      mimeType: 'text/csv;charset=utf-8;',
      dialogTitle: 'Download Student Import Template',
    });
    haptics.light();
  } catch (err: any) {
    console.error('Failed to export CSV template:', err);
  }
}
</script>

<style scoped>
.safe-content {
  --background: var(--uni-bg);
  background: var(--uni-bg);
}

.page-container {
  padding: 4px 0 24px 0;
  max-width: 680px;
  margin: 0 auto;
  box-sizing: border-box;
}

.form-flow {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Card Sections matching RegisterStudentPage */
.form-section {
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: var(--uni-radius-card, 16px);
  padding: 18px 16px;
  box-shadow: var(--uni-shadow-card);
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
}

:global(.dark) .form-section,
:global(.ion-palette-dark) .form-section {
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--uni-border-subtle, #e2e8f0);
  padding-bottom: 8px;
  gap: 8px;
}

:global(.dark) .section-title-row,
:global(.ion-palette-dark) .section-title-row {
  border-bottom-color: var(--uni-border, #30343D);
}

.section-title {
  font-size: 14.5px;
  font-weight: 650;
  color: var(--uni-text-primary, #0f172a);
  letter-spacing: -0.01em;
}

:global(.dark) .section-title,
:global(.ion-palette-dark) .section-title {
  color: var(--uni-text-primary, #F8FAFC);
}

.btn-text-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--uni-primary, #0F766E);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

:global(.dark) .btn-text-link,
:global(.ion-palette-dark) .btn-text-link {
  color: var(--uni-primary, #5EEAD4);
}

.btn-text-link:hover {
  opacity: 0.85;
}

.fields-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

/* Upload Drop Zone */
.drop-zone {
  background: var(--uni-surface-secondary, #F1F5F9);
  border: 2px dashed var(--uni-border, #E2E8F0);
  border-radius: var(--uni-radius-card, 16px);
  padding: 24px 16px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
}

.drop-zone.disabled-zone {
  border-color: rgba(217, 119, 6, 0.4);
  background: rgba(245, 158, 11, 0.04);
}

.fk-context-badge {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.fk-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: #047857;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
  padding: 4px 8px;
  border-radius: 6px;
}

.fk-tag strong {
  color: var(--uni-text-primary);
}

:global(.dark) .drop-zone,
:global(.ion-palette-dark) .drop-zone {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #30343D);
}

.drop-zone:hover,
.drop-zone:focus {
  border-color: var(--uni-primary, #0F766E);
  background: rgba(15, 118, 110, 0.05);
}

:global(.dark) .drop-zone:hover,
:global(.ion-palette-dark) .drop-zone:hover {
  border-color: var(--uni-primary, #5EEAD4);
  background: rgba(94, 234, 212, 0.08);
}

.drop-icon-wrapper {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(15, 118, 110, 0.12);
  color: var(--uni-primary, #0F766E);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2px;
}

:global(.dark) .drop-icon-wrapper,
:global(.ion-palette-dark) .drop-icon-wrapper {
  background: rgba(94, 234, 212, 0.14);
  color: var(--uni-primary, #5EEAD4);
}

.drop-icon {
  font-size: 24px;
}

.drop-text {
  font-size: 13.5px;
  color: var(--uni-text-primary, #0F172A);
  line-height: 1.4;
}

:global(.dark) .drop-text,
:global(.ion-palette-dark) .drop-text {
  color: var(--uni-text-primary, #F8FAFC);
}

.drop-primary {
  font-weight: 700;
  color: var(--uni-primary, #0F766E);
}

:global(.dark) .drop-primary,
:global(.ion-palette-dark) .drop-primary {
  color: var(--uni-primary, #5EEAD4);
}

.drop-hint {
  font-size: 11px;
  color: var(--uni-text-muted, #64748B);
  line-height: 1.4;
  word-break: normal;
  overflow-wrap: break-word;
  max-width: 100%;
}

:global(.dark) .drop-hint,
:global(.ion-palette-dark) .drop-hint {
  color: var(--uni-text-muted, #9CA3AF);
}

.selected-file-badge {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(15, 118, 110, 0.08);
  border: 1px solid rgba(15, 118, 110, 0.25);
  padding: 10px 14px;
  border-radius: 12px;
  gap: 10px;
}

:global(.dark) .selected-file-badge,
:global(.ion-palette-dark) .selected-file-badge {
  background: rgba(94, 234, 212, 0.1);
  border-color: rgba(94, 234, 212, 0.3);
}

.file-badge-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.file-badge-icon {
  font-size: 18px;
  color: #059669;
  flex-shrink: 0;
}

:global(.dark) .file-badge-icon,
:global(.ion-palette-dark) .file-badge-icon {
  color: #34D399;
}

.file-badge-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--uni-text-primary, #0F172A);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.dark) .file-badge-name,
:global(.ion-palette-dark) .file-badge-name {
  color: var(--uni-text-primary, #F8FAFC);
}

.btn-clear-file {
  background: transparent;
  border: 0;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--uni-text-muted, #64748B);
  font-size: 18px;
  cursor: pointer;
  border-radius: 6px;
  transition: color 0.15s ease;
}

:global(.dark) .btn-clear-file,
:global(.ion-palette-dark) .btn-clear-file {
  color: var(--uni-text-muted, #9CA3AF);
}

.btn-clear-file:hover {
  color: #DC2626;
}

:global(.dark) .btn-clear-file:hover,
:global(.ion-palette-dark) .btn-clear-file:hover {
  color: #F87171;
}

/* Stats Grid: 4 columns on desktop/tablet, 2x2 on mobile */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

@media (max-width: 540px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
}

.stat-card {
  background: var(--uni-surface-secondary, #F1F5F9);
  border: 1px solid var(--uni-border, #E2E8F0);
  border-radius: 12px;
  padding: 12px 8px;
  text-align: center;
}

:global(.dark) .stat-card,
:global(.ion-palette-dark) .stat-card {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #30343D);
}

.stat-card.valid {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.3);
  color: #059669;
}

:global(.dark) .stat-card.valid,
:global(.ion-palette-dark) .stat-card.valid {
  color: #34D399;
}

.stat-card.update {
  background: rgba(14, 165, 233, 0.08);
  border-color: rgba(14, 165, 233, 0.3);
  color: #0284C7;
}

:global(.dark) .stat-card.update,
:global(.ion-palette-dark) .stat-card.update {
  color: #38BDF8;
}

.stat-card.invalid {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
  color: #DC2626;
}

:global(.dark) .stat-card.invalid,
:global(.ion-palette-dark) .stat-card.invalid {
  color: #F87171;
}

.stat-num {
  display: block;
  font-size: 20px;
  font-weight: 800;
  line-height: 1.2;
}

.stat-lbl {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-top: 2px;
  display: block;
  color: var(--uni-text-secondary, #64748B);
}

:global(.dark) .stat-lbl,
:global(.ion-palette-dark) .stat-lbl {
  color: var(--uni-text-secondary, #9CA3AF);
}

/* Invalid Box */
.invalid-box {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.3);
  padding: 12px 14px;
  border-radius: 12px;
  font-size: 12px;
}

.invalid-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  color: #B45309;
  margin-bottom: 6px;
}

:global(.dark) .invalid-title,
:global(.ion-palette-dark) .invalid-title {
  color: #FBBF24;
}

:global(.dark) .invalid-box,
:global(.ion-palette-dark) .invalid-box {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.35);
}

.invalid-list {
  margin: 0;
  padding-left: 20px;
  color: var(--uni-text-primary);
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.invalid-more {
  color: var(--uni-text-muted);
  list-style: none;
  margin-left: -20px;
  margin-top: 4px;
  font-style: italic;
}

/* Success Card */
.import-success-card {
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.35);
  border-radius: var(--uni-radius-card, 16px);
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
}

.success-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.success-icon {
  font-size: 26px;
  color: #059669;
  flex-shrink: 0;
  margin-top: 2px;
}

.success-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.success-title {
  font-size: 15.5px;
  font-weight: 750;
  color: var(--uni-text-primary);
  margin: 0;
}

.success-sub {
  font-size: 13px;
  color: var(--uni-text-secondary);
  margin: 0;
}

.batch-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--uni-text-muted);
}

.batch-badge code {
  background: var(--uni-surface);
  padding: 2px 6px;
  border-radius: 6px;
  border: 1px solid var(--uni-border);
  color: var(--uni-primary);
}

.server-sync-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: #059669;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  padding: 4px 10px;
  border-radius: 8px;
  width: fit-content;
  max-width: 100%;
  box-sizing: border-box;
  flex-wrap: wrap;
}

.server-sync-badge.offline {
  color: #D97706;
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.3);
}

.server-sync-badge .sync-icon {
  font-size: 14px;
}

.success-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 6px;
  width: 100%;
}

@media (min-width: 640px) {
  .success-actions {
    flex-direction: row;
  }

  .success-actions > * {
    flex: 1;
  }
}

.form-submit-row {
  margin-top: 6px;
}

.error-banner {
  background: rgba(220, 75, 75, 0.1);
  border: 1px solid rgba(220, 75, 75, 0.3);
  color: #DC2626;
  padding: 12px 14px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.4;
}

.error-banner-content {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.error-icon {
  font-size: 20px;
  color: #DC2626;
  flex-shrink: 0;
  margin-top: 1px;
}

.error-text strong {
  display: block;
  font-size: 13px;
  margin-bottom: 2px;
}

.error-text p {
  margin: 0;
}

/* Validating banner */
.validating-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(15, 118, 110, 0.08);
  border: 1px dashed rgba(15, 118, 110, 0.35);
  border-radius: 12px;
  padding: 12px 14px;
}

:global(.dark) .validating-banner,
:global(.ion-palette-dark) .validating-banner {
  background: rgba(94, 234, 212, 0.08);
  border-color: rgba(94, 234, 212, 0.35);
}

.spinner-sm {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.validating-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--uni-text-primary);
}

.validating-text span {
  font-size: 11px;
  color: var(--uni-text-muted);
}

/* Import Progress Section */
.import-progress-section {
  background: rgba(15, 118, 110, 0.05);
  border: 1px solid rgba(15, 118, 110, 0.3);
  gap: 14px;
}

:global(.dark) .import-progress-section,
:global(.ion-palette-dark) .import-progress-section {
  background: rgba(94, 234, 212, 0.06);
  border-color: rgba(94, 234, 212, 0.35);
}

.progress-panel-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.progress-spinner-wrap {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(15, 118, 110, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

:global(.dark) .progress-spinner-wrap,
:global(.ion-palette-dark) .progress-spinner-wrap {
  background: rgba(94, 234, 212, 0.15);
}

.import-spinner {
  width: 20px;
  height: 20px;
  --color: var(--uni-primary);
}

.progress-title-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.progress-title {
  font-size: 15px;
  font-weight: 750;
  color: var(--uni-text-primary);
  margin: 0;
}

.progress-subtitle {
  font-size: 12px;
  color: var(--uni-text-secondary);
  margin: 0;
  line-height: 1.4;
}

/* Indeterminate Progress Bar */
.indeterminate-progress-bar {
  width: 100%;
  height: 6px;
  background: rgba(15, 118, 110, 0.15);
  border-radius: 999px;
  overflow: hidden;
  position: relative;
}

:global(.dark) .indeterminate-progress-bar,
:global(.ion-palette-dark) .indeterminate-progress-bar {
  background: rgba(94, 234, 212, 0.15);
}

.indeterminate-bar-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: linear-gradient(90deg, #0F766E, #14B8A6, #0F766E);
  border-radius: 999px;
  animation: indeterminate-loading 1.6s infinite ease-in-out;
}

:global(.dark) .indeterminate-bar-fill,
:global(.ion-palette-dark) .indeterminate-bar-fill {
  background: linear-gradient(90deg, #0D9488, #5EEAD4, #0D9488);
}

@keyframes indeterminate-loading {
  0% {
    left: -35%;
    right: 100%;
    width: 35%;
  }
  60% {
    left: 100%;
    right: -35%;
    width: 35%;
  }
  100% {
    left: 100%;
    right: -35%;
    width: 35%;
  }
}

.progress-details-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: 10px;
  padding: 10px 12px;
}

:global(.dark) .progress-details-grid,
:global(.ion-palette-dark) .progress-details-grid {
  background: rgba(255, 255, 255, 0.02);
}

.progress-detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.p-label {
  font-size: 10px;
  text-transform: uppercase;
  color: var(--uni-text-muted);
  letter-spacing: 0.05em;
}

.p-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--uni-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-disclaimer {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #D97706;
}

/* Badges */
.preview-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.ready-badge {
  color: #059669;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.importing-badge {
  color: #0284C7;
  background: rgba(14, 165, 233, 0.12);
  border: 1px solid rgba(14, 165, 233, 0.3);
}

.failed-badge {
  color: #DC2626;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

/* Warning box for duplicates */
.warning-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 10px;
  padding: 10px 12px;
  color: #B45309;
  font-size: 12px;
}

:global(.dark) .warning-box,
:global(.ion-palette-dark) .warning-box {
  color: #FBBF24;
}

/* Section distribution */
.distribution-card {
  background: var(--uni-surface-secondary, #F8FAFC);
  border: 1px solid var(--uni-border, #E2E8F0);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

:global(.dark) .distribution-card,
:global(.ion-palette-dark) .distribution-card {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #30343D);
}

.distribution-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.distribution-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--uni-text-muted);
}

.distribution-count {
  font-size: 11px;
  color: var(--uni-primary);
  font-weight: 600;
}

.distribution-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.distribution-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11.5px;
}

.dist-label {
  color: var(--uni-text-secondary);
}

.dist-value {
  color: var(--uni-primary);
  font-weight: 700;
}

/* Success details */
.success-stats-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

@media (max-width: 600px) {
  .success-stats-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.success-stat-box {
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: 10px;
  padding: 8px 4px;
  text-align: center;
  min-width: 0;
  box-sizing: border-box;
}

.text-accent {
  color: #0284C7;
}

.success-meta-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: 10px;
  padding: 10px 12px;
}

.success-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.meta-label {
  color: var(--uni-text-muted);
}

.meta-code {
  color: var(--uni-primary);
  font-weight: 600;
}

.meta-val {
  color: var(--uni-text-primary);
}

.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* Full Blocking Processing Modal */
:global(ion-modal.blocking-process-modal) {
  --background: transparent;
  --box-shadow: none;
  --width: calc(100% - 32px);
  --max-width: 380px;
  --height: auto;
  --border-radius: 20px;
  align-items: center;
  justify-content: center;
}

:global(ion-modal.blocking-process-modal::part(backdrop)) {
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

:global(ion-modal.blocking-process-modal::part(content)) {
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  box-shadow: none;
  border-radius: 20px;
  width: calc(100% - 32px);
  max-width: 380px;
  margin: auto;
  overflow: visible;
}

.blocking-modal-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 380px;
  box-sizing: border-box;
}

.blocking-modal-card {
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: var(--uni-radius-card, 20px);
  padding: 22px 18px;
  width: 100%;
  max-width: 380px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  gap: 14px;
  text-align: center;
  box-sizing: border-box;
}

:global(.dark) .blocking-modal-card,
:global(.ion-palette-dark) .blocking-modal-card {
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
}

.blocking-icon-box {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: rgba(15, 118, 110, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
}

:global(.dark) .blocking-icon-box,
:global(.ion-palette-dark) .blocking-icon-box {
  background: rgba(94, 234, 212, 0.15);
}

.blocking-spinner {
  width: 28px;
  height: 28px;
  --color: var(--uni-primary, #0F766E);
}

:global(.dark) .blocking-spinner,
:global(.ion-palette-dark) .blocking-spinner {
  --color: var(--uni-primary, #5EEAD4);
}

.blocking-text-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.blocking-modal-title {
  font-size: 16.5px;
  font-weight: 750;
  color: var(--uni-text-primary, #0F172A);
  margin: 0;
}

.blocking-modal-desc {
  font-size: 12px;
  color: var(--uni-text-secondary, #64748B);
  margin: 0;
  line-height: 1.45;
}

.blocking-meta-box {
  background: var(--uni-surface-secondary, #F8FAFC);
  border: 1px solid var(--uni-border, #E2E8F0);
  border-radius: 10px;
  padding: 10px 12px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11.5px;
}

:global(.dark) .blocking-meta-box,
:global(.ion-palette-dark) .blocking-meta-box {
  background: rgba(255, 255, 255, 0.03);
  border-color: var(--uni-border, #30343D);
}

.blocking-meta-box .meta-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.blocking-meta-box .meta-lbl {
  color: var(--uni-text-muted);
}

.blocking-meta-box .meta-val {
  color: var(--uni-text-primary);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60%;
}

.blocking-disclaimer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 11px;
  color: #D97706;
}

.blocking-modal-actions {
  margin-top: 4px;
}
</style>
