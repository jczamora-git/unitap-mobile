<template>
  <ion-page>
    <ion-content :fullscreen="true" class="report-content">
      <div class="page-container">
        <!-- Header -->
        <div class="page-header">
          <div>
            <span class="eyebrow">FINANCIAL OBLIGATIONS & AUDIT</span>
            <h1 class="page-title">Offline Financial Reports</h1>
            <p class="page-subtitle">Track semester fines, contributions, collections, and outstanding obligations.</p>
          </div>
          <div class="header-actions">
            <button class="btn-export" @click="exportCsv">
              📊 Export CSV
            </button>
            <button class="btn-print" @click="openPrintPreview">
              🖨️ Printable View
            </button>
          </div>
        </div>

        <!-- Filter Bar -->
        <div class="filter-card">
          <div class="filter-grid">
            <div class="filter-group">
              <label>Semester</label>
              <select v-model="selectedSemesterId" class="filter-select" @change="loadReportData">
                <option v-for="sem in semesters" :key="sem.id" :value="sem.id">
                  {{ sem.term }} Semester ({{ sem.academic_year_id }})
                </option>
              </select>
            </div>
            <div class="filter-group">
              <label>Obligation Type</label>
              <select v-model="selectedType" class="filter-select" @change="loadReportData">
                <option value="">All Types</option>
                <option value="FINE">Fines Only</option>
                <option value="CONTRIBUTION">Contributions Only</option>
              </select>
            </div>
            <div class="filter-group">
              <label>Section</label>
              <input
                v-model="filterSection"
                type="text"
                placeholder="Filter by section (e.g. 1F4)"
                class="filter-input"
                @input="loadReportData"
              />
            </div>
          </div>
        </div>

        <!-- Financial Summary Cards -->
        <div class="summary-grid">
          <div class="summary-card">
            <span class="card-label">Total Assessed</span>
            <span class="card-amount">{{ formatPesos(totalAssessedCentavos) }}</span>
            <span class="card-meta">All issued obligations</span>
          </div>
          <div class="summary-card collected">
            <span class="card-label">Total Collected</span>
            <span class="card-amount">{{ formatPesos(totalCollectedCentavos) }}</span>
            <span class="card-meta">{{ collectionRate }}% collection rate</span>
          </div>
          <div class="summary-card outstanding">
            <span class="card-label">Total Outstanding</span>
            <span class="card-amount">{{ formatPesos(totalOutstandingCentavos) }}</span>
            <span class="card-meta">Remaining uncollected balance</span>
          </div>
        </div>

        <!-- Category Summary Table -->
        <div class="section-card">
          <h2 class="section-title">Category Breakdown</h2>
          <div class="table-responsive">
            <table class="report-table">
              <thead>
                <tr>
                  <th>Category Type</th>
                  <th style="text-align: center;">Total Obligations</th>
                  <th style="text-align: right;">Assessed (₱)</th>
                  <th style="text-align: right;">Collected (₱)</th>
                  <th style="text-align: right;">Outstanding (₱)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="cat in categorySummary" :key="cat.type">
                  <td>
                    <span class="type-pill" :class="cat.type.toLowerCase()">
                      {{ cat.type }}
                    </span>
                  </td>
                  <td style="text-align: center;">{{ cat.obligations_count }}</td>
                  <td style="text-align: right;">{{ formatPesos(cat.assessed_centavos) }}</td>
                  <td style="text-align: right; color: var(--uni-success, #047857); font-weight: 700;">
                    {{ formatPesos(cat.paid_centavos) }}
                  </td>
                  <td style="text-align: right; color: var(--uni-danger, #B91C1C); font-weight: 700;">
                    {{ formatPesos(cat.outstanding_centavos) }}
                  </td>
                </tr>
                <tr v-if="categorySummary.length === 0">
                  <td colspan="5" class="empty-cell">No financial obligations recorded for this term.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Detailed Student Obligations Table -->
        <div class="section-card">
          <h2 class="section-title">Student Records ({{ studentReport.length }})</h2>
          <div class="table-responsive">
            <table class="report-table">
              <thead>
                <tr>
                  <th>School ID</th>
                  <th>Student Name</th>
                  <th style="text-align: center;">Year & Sec</th>
                  <th>Type</th>
                  <th>Title</th>
                  <th style="text-align: right;">Assessed</th>
                  <th style="text-align: right;">Paid</th>
                  <th style="text-align: right;">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in studentReport" :key="idx">
                  <td class="mono-id">{{ row.school_id }}</td>
                  <td class="name-cell">{{ row.last_name }}, {{ row.first_name }}</td>
                  <td style="text-align: center;">{{ row.year_level }} - {{ row.section }}</td>
                  <td>
                    <span class="type-pill" :class="row.obligation_type.toLowerCase()">
                      {{ row.obligation_type }}
                    </span>
                  </td>
                  <td>{{ row.title }}</td>
                  <td style="text-align: right;">{{ formatPesos(row.assessed_centavos) }}</td>
                  <td style="text-align: right; color: var(--uni-success, #047857);">
                    {{ formatPesos(row.paid_centavos) }}
                  </td>
                  <td
                    style="text-align: right; font-weight: 700;"
                    :class="row.balance_centavos > 0 ? 'text-danger' : 'text-success'"
                  >
                    {{ formatPesos(row.balance_centavos) }}
                  </td>
                </tr>
                <tr v-if="studentReport.length === 0">
                  <td colspan="8" class="empty-cell">No student records match the selected filters.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { IonPage, IonContent } from '@ionic/vue';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { ReportService } from '@/services/report.service';
import { authService } from '@/services/auth.service';
import { formatCentavosToPesos } from '@/utilities/finance-formatters';
import type { Semester } from '@/types/database';
import type { StudentObligationReportRow, CategorySummaryReportRow } from '@/database/repositories/reports.repository';

const semesters = ref<Semester[]>([]);
const selectedSemesterId = ref('');
const selectedType = ref<'FINE' | 'CONTRIBUTION' | ''>('');
const filterSection = ref('');

const studentReport = ref<StudentObligationReportRow[]>([]);
const categorySummary = ref<CategorySummaryReportRow[]>([]);

const totalAssessedCentavos = computed(() =>
  categorySummary.value.reduce((acc, c) => acc + c.assessed_centavos, 0)
);

const totalCollectedCentavos = computed(() =>
  categorySummary.value.reduce((acc, c) => acc + c.paid_centavos, 0)
);

const totalOutstandingCentavos = computed(() =>
  categorySummary.value.reduce((acc, c) => acc + c.outstanding_centavos, 0)
);

const collectionRate = computed(() => {
  if (totalAssessedCentavos.value === 0) return 100;
  return Math.round((totalCollectedCentavos.value / totalAssessedCentavos.value) * 100);
});

onMounted(async () => {
  semesters.value = await AcademicRepository.getSemesters();
  const active = await AcademicRepository.getActiveSemester();
  if (active) {
    selectedSemesterId.value = active.id;
  } else if (semesters.value.length > 0) {
    selectedSemesterId.value = semesters.value[0].id;
  }
  await loadReportData();
});

async function loadReportData() {
  if (!selectedSemesterId.value) return;

  categorySummary.value = await ReportService.getCategorySummary(selectedSemesterId.value);
  studentReport.value = await ReportService.getObligationsReport({
    semesterId: selectedSemesterId.value,
    type: selectedType.value || undefined,
    section: filterSection.value.trim() || undefined,
  });
}

function formatPesos(centavos: number): string {
  return formatCentavosToPesos(centavos);
}

function exportCsv() {
  const currentSem = semesters.value.find((s) => s.id === selectedSemesterId.value);
  const semLabel = currentSem ? `${currentSem.term} Semester (${currentSem.academic_year_id})` : 'Semester';
  const user = authService.user.value?.username || 'Officer';

  const csv = ReportService.generateObligationsCsv(studentReport.value, semLabel, user);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `unitap_report_${selectedSemesterId.value}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function openPrintPreview() {
  const currentSem = semesters.value.find((s) => s.id === selectedSemesterId.value);
  const semLabel = currentSem ? `${currentSem.term} Semester (${currentSem.academic_year_id})` : 'Semester';
  const user = authService.user.value?.username || 'Officer';

  const html = ReportService.generatePrintableReportHtml(studentReport.value, semLabel, user);
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
</script>

<style scoped>
.report-content {
  --background: var(--uni-background, #F8FAFC);
}

.page-container {
  padding: 24px;
  max-width: 1000px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  gap: 16px;
  flex-wrap: wrap;
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

.header-actions {
  display: flex;
  gap: 10px;
}

.btn-export {
  background: var(--uni-primary, #0F766E);
  color: white;
  border: 0;
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.btn-print {
  background: white;
  border: 1.5px solid var(--uni-border, #CBD5E1);
  color: var(--uni-ink, #0F172A);
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.filter-card {
  background: white;
  border: 1px solid var(--uni-border, #CBD5E1);
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 20px;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.filter-group label {
  display: block;
  font-size: 11px;
  font-weight: 700;
  color: #334155;
  margin-bottom: 6px;
}

.filter-select, .filter-input {
  width: 100%;
  padding: 9px 12px;
  border: 1.5px solid var(--uni-border, #CBD5E1);
  border-radius: 10px;
  font-size: 13px;
  background: white;
  box-sizing: border-box;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.summary-card {
  background: white;
  border: 1px solid var(--uni-border, #CBD5E1);
  border-radius: 16px;
  padding: 18px;
}

.summary-card.collected {
  border-left: 4px solid var(--uni-success, #047857);
}

.summary-card.outstanding {
  border-left: 4px solid var(--uni-danger, #B91C1C);
}

.card-label {
  display: block;
  font-size: 11px;
  font-weight: 800;
  color: var(--uni-muted, #64748B);
  text-transform: uppercase;
}

.card-amount {
  display: block;
  font-size: 24px;
  font-weight: 800;
  color: var(--uni-ink, #0F172A);
  margin: 6px 0;
}

.card-meta {
  font-size: 11px;
  color: #64748b;
}

.section-card {
  background: white;
  border: 1px solid var(--uni-border, #CBD5E1);
  border-radius: 16px;
  padding: 20px;
  margin-bottom: 24px;
}

.section-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--uni-ink, #0F172A);
  margin: 0 0 16px;
}

.table-responsive {
  overflow-x: auto;
}

.report-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.report-table th {
  background: #f8fafc;
  padding: 10px 12px;
  text-align: left;
  border-bottom: 2px solid #cbd5e1;
  font-weight: 700;
  color: #334155;
  white-space: nowrap;
}

.report-table td {
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
}

.mono-id {
  font-family: monospace;
  font-size: 12px;
}

.name-cell {
  font-weight: 600;
}

.type-pill {
  font-size: 10px;
  font-weight: 800;
  padding: 3px 8px;
  border-radius: 6px;
  text-transform: uppercase;
}

.type-pill.fine {
  background: #fee2e2;
  color: #b91c1c;
}

.type-pill.contribution {
  background: #f0fdf4;
  color: #15803d;
}

.text-danger {
  color: var(--uni-danger, #B91C1C);
}

.text-success {
  color: var(--uni-success, #047857);
}

.empty-cell {
  text-align: center;
  color: #94a3b8;
  padding: 24px !important;
}
</style>

