<template>
  <ion-page>
    <ion-content :fullscreen="true" class="import-content">
      <div class="page-container">
        <!-- Header -->
        <div class="page-header">
          <div>
            <span class="eyebrow">STUDENT INFORMATION SYSTEM</span>
            <h1 class="page-title">CSV Roster Import</h1>
            <p class="page-subtitle">Batch import or update student enrollments for the targeted semester.</p>
          </div>
          <button class="btn-template" @click="downloadTemplate">
            📥 Download Template
          </button>
        </div>

        <!-- Target Configuration Card -->
        <div class="config-card">
          <div class="card-title">Target Enrollment Term & Program</div>
          <div class="config-grid">
            <div class="form-group">
              <label>Target Semester</label>
              <select v-model="selectedSemesterId" class="custom-select" :disabled="isImporting">
                <option v-for="sem in semesters" :key="sem.id" :value="sem.id">
                  {{ sem.term }} Semester ({{ sem.academic_year_id }}) {{ sem.status === 'ACTIVE' ? '— [ACTIVE]' : '' }}
                </option>
              </select>
            </div>
            <div class="form-group">
              <label>Program</label>
              <select v-model="selectedProgramId" class="custom-select" :disabled="isImporting">
                <option v-for="prog in programs" :key="prog.id" :value="prog.id">
                  {{ prog.code }} — {{ prog.name }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- Upload & Validation Area -->
        <div class="upload-card">
          <input
            type="file"
            ref="fileInputRef"
            accept=".csv,text/csv"
            style="display: none"
            @change="handleFileSelected"
          />
          <div class="drop-zone" @click="triggerFileInput">
            <div class="drop-icon">📄</div>
            <div class="drop-text">
              <strong>Click to select a CSV file</strong> or drag & drop here
            </div>
            <div class="drop-hint">Format: school_id, first_name, middle_name, lastname, year, section</div>
          </div>

          <div v-if="selectedFileName" class="selected-file-badge">
            <span>Selected File: <strong>{{ selectedFileName }}</strong></span>
            <button class="btn-clear" @click="clearSelection">✕</button>
          </div>
        </div>

        <!-- Validation Summary Card -->
        <div v-if="parseResult" class="preview-card">
          <h2 class="section-title">Validation Preview</h2>
          <div class="stats-row">
            <div class="stat-badge">
              <span class="stat-num">{{ parseResult.totalRows }}</span>
              <span class="stat-lbl">Total Rows</span>
            </div>
            <div class="stat-badge valid">
              <span class="stat-num">{{ parseResult.validRows.length }}</span>
              <span class="stat-lbl">Valid Records</span>
            </div>
            <div class="stat-badge update">
              <span class="stat-num">{{ existingCount }}</span>
              <span class="stat-lbl">Existing Students</span>
            </div>
            <div class="stat-badge invalid">
              <span class="stat-num">{{ parseResult.invalidRows.length }}</span>
              <span class="stat-lbl">Invalid Rows</span>
            </div>
          </div>

          <!-- Invalid Rows Alerts -->
          <div v-if="parseResult.invalidRows.length > 0" class="invalid-box">
            <div class="invalid-title">⚠️ Errors Found in {{ parseResult.invalidRows.length }} row(s):</div>
            <ul>
              <li v-for="row in parseResult.invalidRows.slice(0, 5)" :key="row.rowNumber">
                Row {{ row.rowNumber }}: {{ row.error }}
              </li>
              <li v-if="parseResult.invalidRows.length > 5">
                ...and {{ parseResult.invalidRows.length - 5 }} more error(s).
              </li>
            </ul>
          </div>

          <!-- Action Button -->
          <button
            class="btn-import"
            :disabled="parseResult.validRows.length === 0 || isImporting"
            @click="executeImport"
          >
            <span v-if="isImporting">Importing into Database...</span>
            <span v-else>Confirm & Import {{ parseResult.validRows.length }} Student(s) →</span>
          </button>
        </div>

        <!-- Success Toast -->
        <div v-if="importResult" class="import-success-card">
          <h3>✅ Import Completed Successfully</h3>
          <p>Imported/Updated: <strong>{{ importResult.importedCount }}</strong> students.</p>
          <p>Batch ID: <code>{{ importResult.batchId }}</code></p>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { IonPage, IonContent } from '@ionic/vue';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { CsvImportService, type CsvParseResult } from '@/services/csv-import.service';
import { authService } from '@/services/auth.service';
import type { Semester, Program } from '@/types/database';

const semesters = ref<Semester[]>([]);
const programs = ref<Program[]>([]);
const selectedSemesterId = ref('');
const selectedProgramId = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);

const selectedFileName = ref('');
const parseResult = ref<CsvParseResult | null>(null);
const isImporting = ref(false);
const importResult = ref<{ batchId: string; importedCount: number; rejectedCount: number } | null>(null);

const existingCount = computed(() => {
  if (!parseResult.value) return 0;
  return parseResult.value.validRows.filter((r) => r.isExistingStudent).length;
});

onMounted(async () => {
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
});

function triggerFileInput() {
  fileInputRef.value?.click();
}

function clearSelection() {
  selectedFileName.value = '';
  parseResult.value = null;
  importResult.value = null;
  if (fileInputRef.value) fileInputRef.value.value = '';
}

async function handleFileSelected(e: Event) {
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;
  const file = files[0];
  selectedFileName.value = file.name;
  importResult.value = null;

  const content = await file.text();
  try {
    parseResult.value = await CsvImportService.parseAndValidate(
      content,
      file.name,
      selectedSemesterId.value,
      selectedProgramId.value
    );
  } catch (err: unknown) {
    alert((err as Error).message);
    clearSelection();
  }
}

async function executeImport() {
  if (!parseResult.value) return;
  isImporting.value = true;
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
  } catch (err: unknown) {
    alert('Import failed: ' + (err as Error).message);
  } finally {
    isImporting.value = false;
  }
}

function downloadTemplate() {
  const csvContent = 'school_id,first_name,middle_name,lastname,year,section\n2026-0001,Juan,Protacio,Dela Cruz,1,1F4\n2026-0002,Maria,Clara,Santos,1,1F4\n';
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'student_import_template.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
</script>

<style scoped>
.import-content {
  --background: var(--uni-background, #F8FAFC);
}

.page-container {
  padding: 24px;
  max-width: 800px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  gap: 16px;
}

.eyebrow {
  font-size: 11px;
  font-weight: 800;
  color: var(--uni-primary, #0F766E);
  letter-spacing: 1.5px;
}

.page-title {
  font-size: 26px;
  font-weight: 800;
  color: var(--uni-ink, #0F172A);
  margin: 4px 0;
}

.page-subtitle {
  font-size: 13px;
  color: var(--uni-muted, #64748B);
  margin: 0;
}

.btn-template {
  background: white;
  border: 1.5px solid var(--uni-border, #CBD5E1);
  color: var(--uni-ink, #0F172A);
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.config-card {
  background: white;
  border: 1px solid var(--uni-border, #CBD5E1);
  border-radius: 16px;
  padding: 20px;
  margin-bottom: 20px;
}

.card-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--uni-ink, #0F172A);
  margin-bottom: 14px;
}

.config-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.form-group label {
  display: block;
  font-size: 11px;
  font-weight: 700;
  color: #334155;
  margin-bottom: 6px;
}

.custom-select {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid var(--uni-border, #CBD5E1);
  border-radius: 10px;
  font-size: 13px;
  background: white;
}

.upload-card {
  background: white;
  border: 2px dashed #cbd5e1;
  border-radius: 16px;
  padding: 30px;
  text-align: center;
  margin-bottom: 20px;
  cursor: pointer;
}

.drop-icon {
  font-size: 36px;
  margin-bottom: 8px;
}

.drop-text {
  font-size: 14px;
  color: #334155;
}

.drop-hint {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 6px;
}

.selected-file-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: #f1f5f9;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  margin-top: 14px;
}

.btn-clear {
  background: none;
  border: 0;
  font-weight: bold;
  cursor: pointer;
  color: #64748b;
}

.preview-card {
  background: white;
  border: 1px solid var(--uni-border, #CBD5E1);
  border-radius: 16px;
  padding: 20px;
  margin-bottom: 20px;
}

.section-title {
  font-size: 16px;
  font-weight: 800;
  margin: 0 0 16px;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.stat-badge {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px;
  text-align: center;
}

.stat-badge.valid {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #15803d;
}

.stat-badge.update {
  background: #f0f9ff;
  border-color: #bae6fd;
  color: #0369a1;
}

.stat-badge.invalid {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}

.stat-num {
  display: block;
  font-size: 20px;
  font-weight: 800;
}

.stat-lbl {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.invalid-box {
  background: #fffbeb;
  border: 1px solid #fef3c7;
  padding: 12px;
  border-radius: 10px;
  margin-bottom: 16px;
  font-size: 12px;
}

.invalid-title {
  font-weight: 700;
  color: #92400e;
  margin-bottom: 4px;
}

.invalid-box ul {
  margin: 0;
  padding-left: 20px;
  color: #78350f;
}

.btn-import {
  width: 100%;
  background: var(--uni-primary, #0F766E);
  color: white;
  border: 0;
  border-radius: 12px;
  padding: 14px;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}

.import-success-card {
  background: #f0fdf4;
  border: 1px solid #86efac;
  border-radius: 14px;
  padding: 16px;
  color: #14532d;
}

.import-success-card h3 {
  margin: 0 0 8px;
  font-size: 16px;
}

.import-success-card p {
  margin: 4px 0;
  font-size: 13px;
}
</style>

