<template>
  <ion-page>
    <UniPageHeader
      title="Import Students"
      subtitle="Batch CSV roster import and enrollment"
      :back-button="true"
      default-back-href="/tabs/students"
      variant="detail"
    />

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Error banner -->
        <div v-if="errorMessage" class="error-banner font-mono" role="alert">
          {{ errorMessage }}
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
                  :disabled="isImporting"
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
                  :disabled="isImporting"
                  placeholder="Select Program"
                  header="Program"
                />
              </UniFormField>
            </div>
          </section>

          <!-- Section 2: File Upload Drop Zone -->
          <section class="form-section">
            <div class="section-title-row">
              <span class="section-title">Upload roster file</span>
              <button type="button" class="btn-text-link" @click="downloadTemplate">
                <ion-icon :icon="cloudDownloadOutline" />
                <span>Sample CSV</span>
              </button>
            </div>

            <input
              type="file"
              ref="fileInputRef"
              accept=".csv,text/csv"
              style="display: none"
              @change="handleFileSelected"
            />

            <div
              class="drop-zone"
              :class="{ 'has-file': Boolean(selectedFileName) }"
              @click="triggerFileInput"
            >
              <div class="drop-icon-wrapper">
                <ion-icon :icon="documentTextOutline" class="drop-icon" />
              </div>
              <div class="drop-text">
                <span class="drop-primary">Click to select CSV file</span> or drag &amp; drop here
              </div>
              <div class="drop-hint font-mono">
                Headers: school_id, first_name, middle_name, lastname, year, section
              </div>
            </div>

            <div v-if="selectedFileName" class="selected-file-badge">
              <div class="file-badge-info">
                <ion-icon :icon="checkmarkCircle" class="file-badge-icon" />
                <span class="file-badge-name">{{ selectedFileName }}</span>
              </div>
              <button
                type="button"
                class="btn-clear-file"
                @click.stop="clearSelection"
                aria-label="Clear selected file"
              >
                <ion-icon :icon="closeOutline" />
              </button>
            </div>
          </section>

          <!-- Section 3: Validation Preview & Confirmation -->
          <section v-if="parseResult" class="form-section preview-section">
            <div class="section-title-row">
              <span class="section-title">Validation preview</span>
            </div>

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
                :disabled="parseResult.validRows.length === 0 || isImporting"
                :loading="isImporting"
                :icon="cloudUploadOutline"
                @click="executeImport"
              >
                <span v-if="isImporting">Importing into Database...</span>
                <span v-else>Confirm &amp; Import {{ parseResult.validRows.length }} Student(s)</span>
              </UniButton>
            </div>
          </section>

          <!-- Section 4: Success Summary -->
          <div v-if="importResult" class="import-success-card" role="status">
            <div class="success-header">
              <ion-icon :icon="checkmarkCircle" class="success-icon" />
              <div class="success-header-text">
                <h3 class="success-title">Import Completed Successfully</h3>
                <p class="success-sub">
                  Enrolled and updated <strong>{{ importResult.importedCount }}</strong> student records.
                </p>
              </div>
            </div>
            <div v-if="importResult.batchId" class="batch-badge">
              <span class="batch-label">Batch Reference:</span>
              <code class="font-mono">{{ importResult.batchId }}</code>
            </div>
            <div class="success-actions">
              <UniButton variant="secondary" size="md" @click="router.push('/tabs/students')">
                View Student Roster
              </UniButton>
              <UniButton variant="ghost" size="md" @click="clearSelection">
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
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonIcon } from '@ionic/vue';
import {
  cloudDownloadOutline,
  cloudUploadOutline,
  documentTextOutline,
  closeOutline,
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
import { CsvImportService, type CsvParseResult } from '@/services/csv-import.service';
import { authService } from '@/services/auth.service';
import { useToast } from '@/composables/useToast';
import { haptics } from '@/utilities/haptics';
import type { Semester, Program } from '@/types/database';

const router = useRouter();
const { showToast } = useToast();

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

const selectedFileName = ref('');
const parseResult = ref<CsvParseResult | null>(null);
const isImporting = ref(false);
const importResult = ref<{ batchId: string; importedCount: number; rejectedCount: number } | null>(null);
const errorMessage = ref<string | null>(null);

const existingCount = computed(() => {
  if (!parseResult.value) return 0;
  return parseResult.value.validRows.filter((r) => r.isExistingStudent).length;
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

function triggerFileInput() {
  fileInputRef.value?.click();
}

function clearSelection() {
  selectedFileName.value = '';
  parseResult.value = null;
  importResult.value = null;
  errorMessage.value = null;
  if (fileInputRef.value) fileInputRef.value.value = '';
}

async function handleFileSelected(e: Event) {
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;
  const file = files[0];
  selectedFileName.value = file.name;
  importResult.value = null;
  errorMessage.value = null;

  try {
    const content = await file.text();
    parseResult.value = await CsvImportService.parseAndValidate(
      content,
      file.name,
      selectedSemesterId.value,
      selectedProgramId.value
    );
    haptics.light();
  } catch (err: unknown) {
    const msg = (err as Error).message || 'Failed to parse CSV file.';
    errorMessage.value = msg;
    showToast(msg, 'error');
    haptics.error();
    clearSelection();
  }
}

async function executeImport() {
  if (!parseResult.value) return;
  isImporting.value = true;
  errorMessage.value = null;

  try {
    const user = authService.user.value;
    const userId = user ? user.id : 'usr_admin';
    const res = await CsvImportService.executeImport(
      parseResult.value,
      selectedSemesterId.value,
      selectedProgramId.value,
      userId
    );
    importResult.value = res;
    parseResult.value = null;
    selectedFileName.value = '';
    haptics.success();
    showToast(`Successfully imported ${res.importedCount} student(s)`, 'success');
  } catch (err: unknown) {
    const msg = 'Import failed: ' + ((err as Error).message || String(err));
    errorMessage.value = msg;
    showToast(msg, 'error');
    haptics.error();
  } finally {
    isImporting.value = false;
  }
}

function downloadTemplate() {
  const csvContent =
    'school_id,first_name,middle_name,lastname,year,section\n2026-0001,Juan,Protacio,Dela Cruz,1,1F4\n2026-0002,Maria,Clara,Santos,1,1F4\n';
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'student_import_template.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  haptics.light();
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

.success-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
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

.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
