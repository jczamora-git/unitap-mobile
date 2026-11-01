<template>
  <ion-page>
    <UniPageHeader
      title="Offline Financial Reports"
      subtitle="Track semester fines, contributions, collections, and outstanding obligations."
      :back-button="true"
      default-back-href="/tabs/finance"
      variant="detail"
    >
      <template #trailing>
        <div class="header-actions">
          <UniButton
            variant="outline"
            size="icon"
            :icon="downloadOutline"
            aria-label="Export CSV"
            title="Export CSV"
            @click="exportCsv"
          />
          <UniButton
            variant="outline"
            size="icon"
            :icon="printOutline"
            aria-label="Printable View"
            title="Printable View"
            @click="openPrintPreview"
          />
        </div>
      </template>
    </UniPageHeader>

    <ion-content :fullscreen="true" class="report-content">
      <div class="page-container">
        <!-- Compact Filter Bar -->
        <UniCard padding="sm" class="compact-filter-card">
          <!-- Active Period Headline & Filter Trigger -->
          <div class="filter-top-row">
            <div class="period-badge-wrap">
              <span class="period-lead-label">Academic Period</span>
              <span class="period-title">{{ currentSemesterLabel }}</span>
            </div>

            <UniButton
              variant="outline"
              size="sm"
              :icon="filterOutline"
              class="btn-open-filters"
              @click="openFilterSheet"
            >
              Filters
              <span v-if="activeFiltersCount > 0" class="filter-badge-counter">
                ({{ activeFiltersCount }})
              </span>
            </UniButton>
          </div>

          <!-- Active Filter Chips Row -->
          <div v-if="activeFiltersCount > 0" class="active-chips-row">
            <UniFilterChip
              v-if="selectedType === 'FINE'"
              label="Fines"
              variant="primary"
              @remove="removeTypeFilter"
            />
            <UniFilterChip
              v-if="selectedType === 'CONTRIBUTION'"
              label="Contributions"
              variant="primary"
              @remove="removeTypeFilter"
            />
            <UniFilterChip
              v-if="filterSection.trim()"
              :label="`Section ${filterSection.trim()}`"
              variant="primary"
              @remove="removeSectionFilter"
            />
            <button
              type="button"
              class="btn-clear-all"
              @click="clearAllFilters"
            >
              Clear all
            </button>
          </div>
        </UniCard>

        <!-- Horizontal Swipeable KPI Carousel -->
        <div class="kpi-section">
          <UniKpiCarousel :items="kpiCards" />
        </div>

        <!-- Category Summary (Single-Column Expandable List) -->
        <UniCard padding="md" class="report-section-card">
          <div class="section-card-header">
            <h2 class="section-title">Category Breakdown</h2>
            <span class="section-count">{{ categorySummary.length }} categories</span>
          </div>

          <UniRecordList
            :empty="categorySummary.length === 0"
            empty-title="No Financial Obligations"
            empty-description="No obligations recorded for the selected academic period."
          >
            <UniExpandableRow
              v-for="cat in categorySummary"
              :key="cat.type"
              :title="formatCategoryType(cat.type)"
              :subtitle="`${cat.obligations_count} total obligations`"
              :badge="cat.type"
              :badge-variant="cat.type === 'FINE' ? 'danger' : 'success'"
              :amount="formatPesos(cat.outstanding_centavos)"
              :amount-variant="cat.outstanding_centavos > 0 ? 'danger' : 'success'"
            >
              <template #content>
                <div class="details-stats-grid">
                  <div class="stat-item">
                    <span class="stat-label">Total Assessed</span>
                    <span class="stat-value font-mono">{{ formatPesos(cat.assessed_centavos) }}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Collected</span>
                    <span class="stat-value font-mono text-success font-bold">{{ formatPesos(cat.paid_centavos) }}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Outstanding</span>
                    <span
                      class="stat-value font-mono font-bold"
                      :class="cat.outstanding_centavos > 0 ? 'text-danger' : 'text-success'"
                    >
                      {{ formatPesos(cat.outstanding_centavos) }}
                    </span>
                  </div>
                </div>
              </template>
            </UniExpandableRow>
          </UniRecordList>
        </UniCard>

        <!-- Student Records (Single-Column Expandable List on All Devices) -->
        <UniCard padding="md" class="report-section-card">
          <div class="section-card-header">
            <h2 class="section-title">Student Records</h2>
            <span class="section-count">{{ studentReport.length }} total</span>
          </div>

          <UniRecordList
            :empty="studentReport.length === 0"
            empty-title="No Records Found"
            empty-description="No student records match the active criteria or filter terms."
          >
            <UniExpandableRow
              v-for="(row, idx) in paginatedStudents"
              :key="`${row.school_id}-${idx}`"
              :title="`${row.last_name}, ${row.first_name}`"
              :subtitle="`${row.school_id} • Year ${row.year_level}-${row.section}`"
              :badge="row.obligation_type"
              :badge-variant="row.obligation_type === 'FINE' ? 'danger' : 'success'"
              :amount="formatPesos(row.balance_centavos)"
              :amount-variant="row.balance_centavos > 0 ? 'danger' : 'success'"
            >
              <template #content>
                <div class="student-details-grid">
                  <div class="detail-cell full-span">
                    <span class="detail-cell-label">Obligation Title</span>
                    <span class="detail-cell-value font-bold">{{ row.title }}</span>
                  </div>
                  <div class="detail-cell">
                    <span class="detail-cell-label">Assessed</span>
                    <span class="detail-cell-value font-mono">{{ formatPesos(row.assessed_centavos) }}</span>
                  </div>
                  <div class="detail-cell">
                    <span class="detail-cell-label">Paid</span>
                    <span class="detail-cell-value font-mono text-success font-bold">{{ formatPesos(row.paid_centavos) }}</span>
                  </div>
                  <div class="detail-cell">
                    <span class="detail-cell-label">Balance</span>
                    <span
                      class="detail-cell-value font-mono font-bold"
                      :class="row.balance_centavos > 0 ? 'text-danger' : 'text-success'"
                    >
                      {{ formatPesos(row.balance_centavos) }}
                    </span>
                  </div>
                </div>
              </template>
            </UniExpandableRow>
          </UniRecordList>

          <!-- Reusable Pagination Control -->
          <UniPagination
            v-if="studentReport.length > 0"
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :total-items="studentReport.length"
          />
        </UniCard>
      </div>
    </ion-content>

    <!-- Custom Reusable Filter Sheet -->
    <UniFilterSheet
      v-model:is-open="isFilterSheetOpen"
      title="Filter Reports"
      subtitle="Refine semester, obligations, and section scope"
      :active-count="activeFiltersCount"
      @apply="applyFilters"
      @reset="resetDraftFilters"
    >
      <div class="sheet-form-layout">
        <!-- Academic Period Selection -->
        <div class="form-group">
          <label class="form-label">Academic Period</label>
          <UniSelect
            v-model="draftSemesterId"
            :options="semesterOptions"
            placeholder="Select Academic Period"
            header="Select Academic Period"
            presentation="embedded"
          />
        </div>

        <!-- Obligation Type Selection -->
        <div class="form-group">
          <label class="form-label">Obligation Type</label>
          <UniSelect
            v-model="draftType"
            :options="typeOptions"
            placeholder="All Obligation Types"
            header="Select Obligation Type"
            presentation="embedded"
          />
        </div>

        <!-- Section Input -->
        <div class="form-group">
          <label class="form-label">Section</label>
          <input
            v-model="draftSection"
            type="text"
            placeholder="Filter by section (e.g. 1F4)"
            class="sheet-filter-input"
          />
        </div>
      </div>
    </UniFilterSheet>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { IonPage, IonContent } from '@ionic/vue';
import { downloadOutline, printOutline, filterOutline } from 'ionicons/icons';

import { AcademicRepository } from '@/database/repositories/academic.repository';
import { ReportService } from '@/services/report.service';
import { authService } from '@/services/auth.service';
import { formatCentavosToPesos } from '@/utilities/finance-formatters';
import { formatAcademicPeriod } from '@/utilities/presentation-formatters';
import {
  UniPageHeader,
  UniCard,
  UniSelect,
  UniPagination,
  UniExpandableRow,
  UniRecordList,
  UniButton,
  UniFilterChip,
  UniFilterSheet,
  UniKpiCarousel,
} from '@/components/ui';
import type { KpiCardItem } from '@/components/ui/UniKpiCarousel.vue';

import type { Semester } from '@/types/database';
import type { StudentObligationReportRow, CategorySummaryReportRow } from '@/database/repositories/reports.repository';

const semesters = ref<Semester[]>([]);
const selectedSemesterId = ref('');
const selectedType = ref<'FINE' | 'CONTRIBUTION' | ''>('');
const filterSection = ref('');

// Filter Sheet Draft State
const isFilterSheetOpen = ref(false);
const draftSemesterId = ref('');
const draftType = ref<'FINE' | 'CONTRIBUTION' | ''>('');
const draftSection = ref('');

const semesterOptions = computed(() =>
  semesters.value.map((sem) => ({
    value: sem.id,
    label: formatAcademicPeriod(sem.term, sem.academic_year_id),
    badge: sem.status === 'ACTIVE' ? 'Active' : undefined,
  }))
);

const currentSemesterLabel = computed(() => {
  const sem = semesters.value.find((s) => s.id === selectedSemesterId.value);
  if (!sem) return 'Select Academic Period';
  return formatAcademicPeriod(sem.term, sem.academic_year_id);
});

const typeOptions = [
  { value: '', label: 'All Types' },
  { value: 'FINE', label: 'Fines Only' },
  { value: 'CONTRIBUTION', label: 'Contributions Only' },
];

const studentReport = ref<StudentObligationReportRow[]>([]);
const categorySummary = ref<CategorySummaryReportRow[]>([]);

const currentPage = ref(1);
const pageSize = ref(10);
const paginatedStudents = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return studentReport.value.slice(start, start + pageSize.value);
});

watch([selectedSemesterId, selectedType, filterSection], () => {
  currentPage.value = 1;
});

const activeFiltersCount = computed(() => {
  let count = 0;
  if (selectedType.value) count++;
  if (filterSection.value.trim()) count++;
  return count;
});

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
  if (totalAssessedCentavos.value === 0) return null;
  return Math.round((totalCollectedCentavos.value / totalAssessedCentavos.value) * 100);
});

const collectionRateMeta = computed(() => {
  if (totalAssessedCentavos.value === 0) return 'No collections yet';
  return `${collectionRate.value}% collection rate`;
});

const kpiCards = computed<KpiCardItem[]>(() => [
  {
    id: 'assessed',
    label: 'Total Assessed',
    value: formatPesos(totalAssessedCentavos.value),
    meta: 'All issued obligations',
    variant: 'default',
  },
  {
    id: 'collected',
    label: 'Total Collected',
    value: formatPesos(totalCollectedCentavos.value),
    meta: collectionRateMeta.value,
    variant: 'success',
  },
  {
    id: 'outstanding',
    label: 'Total Outstanding',
    value: formatPesos(totalOutstandingCentavos.value),
    meta: 'Remaining uncollected balance',
    variant: totalOutstandingCentavos.value > 0 ? 'danger' : 'default',
  },
]);

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

function openFilterSheet() {
  draftSemesterId.value = selectedSemesterId.value;
  draftType.value = selectedType.value;
  draftSection.value = filterSection.value;
  isFilterSheetOpen.value = true;
}

function applyFilters() {
  selectedSemesterId.value = draftSemesterId.value;
  selectedType.value = draftType.value;
  filterSection.value = draftSection.value;
  loadReportData();
}

function resetDraftFilters() {
  draftType.value = '';
  draftSection.value = '';
}

function removeTypeFilter() {
  selectedType.value = '';
  loadReportData();
}

function removeSectionFilter() {
  filterSection.value = '';
  loadReportData();
}

function clearAllFilters() {
  selectedType.value = '';
  filterSection.value = '';
  loadReportData();
}

function formatCategoryType(type: string): string {
  if (type === 'FINE') return 'Fines';
  if (type === 'CONTRIBUTION') return 'Contributions';
  return type;
}

function formatPesos(centavos: number): string {
  return formatCentavosToPesos(centavos);
}

function exportCsv() {
  const currentSem = semesters.value.find((s) => s.id === selectedSemesterId.value);
  const semLabel = currentSem ? formatAcademicPeriod(currentSem.term, currentSem.academic_year_id) : 'Semester';
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
  const semLabel = currentSem ? formatAcademicPeriod(currentSem.term, currentSem.academic_year_id) : 'Semester';
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
  padding: 16px;
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

@media (min-width: 640px) {
  .page-container {
    padding: 24px;
    gap: 22px;
  }
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* Compact Filter Card */
.compact-filter-card {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.filter-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.period-badge-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.period-lead-label {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--uni-text-secondary, #64748B);
}

.period-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--uni-text, #0F172A);
  letter-spacing: -0.01em;
  word-break: break-word;
}

.btn-open-filters {
  flex-shrink: 0;
}

@media (max-width: 380px) {
  .page-container {
    padding: 12px;
  }

  .compact-filter-card {
    padding: 12px;
  }
}

.filter-badge-counter {
  margin-left: 4px;
  font-weight: 700;
  color: var(--uni-primary, #0F766E);
}

.active-chips-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--uni-border, #E2E8F0);
}

.btn-clear-all {
  background: transparent;
  border: none;
  color: var(--uni-text-secondary, #64748B);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  transition: color 0.14s ease;
}

.btn-clear-all:hover {
  color: var(--uni-danger, #DC2626);
}

/* KPI Section */
.kpi-section {
  width: 100%;
}

/* Report Section Cards */
.report-section-card {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.section-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--uni-text, #0F172A);
  margin: 0;
  letter-spacing: -0.01em;
}

.section-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--uni-text-secondary, #64748B);
}

/* Details Stats Grid (Category Breakdown expanded) */
.details-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  padding: 6px 0;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--uni-text-secondary, #64748B);
}

.stat-value {
  font-size: 13.5px;
  color: var(--uni-text, #0F172A);
}

/* Student Record Details Grid */
.student-details-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 8px 0;
}

.detail-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.detail-cell.full-span {
  grid-column: 1 / -1;
}

.detail-cell-label {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--uni-text-secondary, #64748B);
}

.detail-cell-value {
  font-size: 13.5px;
  color: var(--uni-text, #0F172A);
}

/* Sheet Form Layout */
.sheet-form-layout {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--uni-text-secondary, #64748B);
}

.sheet-filter-input {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #E2E8F0);
  border-radius: var(--uni-radius-card, 14px);
  color: var(--uni-text, #0F172A);
  font-size: 13.5px;
  font-weight: 500;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.16s ease;
}

.sheet-filter-input:focus {
  border-color: var(--uni-primary, #0F766E);
}

.sheet-filter-input::placeholder {
  color: var(--uni-text-secondary, #64748B);
}

/* Utility Helpers */
.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.font-bold {
  font-weight: 700;
}

.text-success {
  color: var(--uni-success, #059669);
}

.text-danger {
  color: var(--uni-danger, #DC2626);
}

/* Dark Mode Overrides */
:root.dark .report-content,
:root.ion-palette-dark .report-content,
body.dark .report-content,
body.ion-palette-dark .report-content,
:global(.dark) .report-content,
:global(.ion-palette-dark) .report-content {
  --background: var(--uni-background, #0F1117);
}

:root.dark .compact-filter-card,
:root.ion-palette-dark .compact-filter-card,
body.dark .compact-filter-card,
body.ion-palette-dark .compact-filter-card,
:global(.dark) .compact-filter-card,
:global(.ion-palette-dark) .compact-filter-card,
:root.dark .report-section-card,
:root.ion-palette-dark .report-section-card,
body.dark .report-section-card,
body.ion-palette-dark .report-section-card,
:global(.dark) .report-section-card,
:global(.ion-palette-dark) .report-section-card {
  background: var(--uni-surface, #1B1D23) !important;
  border-color: var(--uni-border, #30343D) !important;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
}

:root.dark .period-title,
:root.ion-palette-dark .period-title,
body.dark .period-title,
body.ion-palette-dark .period-title,
:global(.dark) .period-title,
:global(.ion-palette-dark) .period-title,
:root.dark .section-title,
:root.ion-palette-dark .section-title,
body.dark .section-title,
body.ion-palette-dark .section-title,
:global(.dark) .section-title,
:global(.ion-palette-dark) .section-title,
:root.dark .detail-cell-value,
:root.ion-palette-dark .detail-cell-value,
body.dark .detail-cell-value,
body.ion-palette-dark .detail-cell-value,
:global(.dark) .detail-cell-value,
:global(.ion-palette-dark) .detail-cell-value,
:root.dark .stat-value,
:root.ion-palette-dark .stat-value,
body.dark .stat-value,
body.ion-palette-dark .stat-value,
:global(.dark) .stat-value,
:global(.ion-palette-dark) .stat-value {
  color: var(--uni-text, #F8FAFC) !important;
}

:root.dark .active-chips-row,
:root.ion-palette-dark .active-chips-row,
body.dark .active-chips-row,
body.ion-palette-dark .active-chips-row,
:global(.dark) .active-chips-row,
:global(.ion-palette-dark) .active-chips-row {
  border-color: var(--uni-border, #30343D);
}

:root.dark .sheet-filter-input,
:root.ion-palette-dark .sheet-filter-input,
body.dark .sheet-filter-input,
body.ion-palette-dark .sheet-filter-input,
:global(.dark) .sheet-filter-input,
:global(.ion-palette-dark) .sheet-filter-input {
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
  color: var(--uni-text, #F8FAFC);
}

:global(.dark) .btn-clear-all,
:global(.ion-palette-dark) .btn-clear-all {
  color: var(--uni-text-secondary, #9CA3AF);
}

:global(.dark) .btn-clear-all:hover,
:global(.ion-palette-dark) .btn-clear-all:hover {
  color: var(--uni-danger, #F87171);
}

:global(.dark) .text-success,
:global(.ion-palette-dark) .text-success {
  color: var(--uni-success, #34D399);
}

:global(.dark) .text-danger,
:global(.ion-palette-dark) .text-danger {
  color: var(--uni-danger, #F87171);
}
</style>
