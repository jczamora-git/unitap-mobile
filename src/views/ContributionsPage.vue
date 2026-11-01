<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  IonPage,
  IonContent,
  IonIcon,
  IonSpinner,
  IonSearchbar,
  onIonViewWillEnter,
} from '@ionic/vue';
import {
  addOutline,
  checkmarkCircle,
  closeCircleOutline,
  walletOutline,
} from 'ionicons/icons';
import { financeService } from '@/services/finance.service';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import type { Semester, StudentRecord } from '@/types/database';
import type { StudentObligationItem, ObligationRuleItem } from '@/types/finance';
import { formatPeso, pesoToCentavos, centavosToPeso } from '@/utilities/finance-formatters';
import { formatSemesterName, formatObligationStatus } from '@/utilities/presentation-formatters';
import {
  UniPageHeader,
  UniButton,
  UniCard,
  UniSheet,
  UniEmptyState,
  UniSelect,
  UniRecordList,
  UniExpandableRow,
  UniSegmentedControl,
} from '@/components/ui';
import { haptics } from '@/utilities/haptics';

const semesters = ref<Semester[]>([]);
const selectedSemesterId = ref<string>('');
const rules = ref<ObligationRuleItem[]>([]);
const contributions = ref<StudentObligationItem[]>([]);
const enrolledStudents = ref<StudentRecord[]>([]);

const semesterOptions = computed(() =>
  semesters.value.map((s) => ({
    value: s.id,
    label: formatSemesterName(s.term),
    badge: s.status === 'ACTIVE' ? 'Active' : undefined,
  }))
);

const scopeOptions = [
  { value: 'ALL', label: 'All Enrolled Students' },
  { value: 'YEAR_LEVEL', label: 'Specific Year Level' },
  { value: 'SECTION', label: 'Specific Section' },
];

const yearLevelOptions = [
  { value: 1, label: '1st Year' },
  { value: 2, label: '2nd Year' },
  { value: 3, label: '3rd Year' },
  { value: 4, label: '4th Year' },
];

const isLoading = ref<boolean>(false);
const isSheetOpen = ref<boolean>(false);
const isAssigning = ref<boolean>(false);
const successMessage = ref<string | null>(null);
const errorMessage = ref<string | null>(null);

// Form State for Bulk Contribution Assignment
const contributionTitle = ref<string>('');
const selectedRuleId = ref<string>('');
const amountPesos = ref<number>(100);
const dueDate = ref<string>('');
const notes = ref<string>('');
const targetScope = ref<'ALL' | 'YEAR_LEVEL' | 'SECTION' | 'INDIVIDUAL'>('ALL');
const selectedYearLevel = ref<number>(1);
const selectedSection = ref<string>('1F4');
const selectedStudentIds = ref<string[]>([]);

// Filter state for contributions list
const filterStatus = ref<'ALL' | 'UNPAID' | 'PAID'>('ALL');
const searchQuery = ref<string>('');

const statusFilterOptions = [
  { value: 'ALL', label: 'All' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PAID', label: 'Settled' },
];

const filteredContributions = computed(() => {
  return contributions.value.filter((c) => {
    if (filterStatus.value === 'UNPAID' && c.status === 'PAID') return false;
    if (filterStatus.value === 'PAID' && c.status !== 'PAID') return false;

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase().trim();
      const matchName = (c.studentName || '').toLowerCase().includes(q);
      const matchId = (c.schoolId || '').toLowerCase().includes(q);
      const matchTitle = c.title.toLowerCase().includes(q);
      if (!matchName && !matchId && !matchTitle) return false;
    }
    return true;
  });
});

const estimatedStudentCount = computed(() => {
  if (targetScope.value === 'ALL') return enrolledStudents.value.length;
  if (targetScope.value === 'INDIVIDUAL') return selectedStudentIds.value.length;
  return enrolledStudents.value.length; // Approximate until server executes
});

const totalPreviewCentavos = computed(() => {
  return estimatedStudentCount.value * pesoToCentavos(amountPesos.value || 0);
});

async function loadData() {
  isLoading.value = true;
  try {
    const activeSem = await AcademicRepository.getActiveSemester();
    semesters.value = await AcademicRepository.getSemesters();

    if (activeSem && !selectedSemesterId.value) {
      selectedSemesterId.value = activeSem.id;
    } else if (semesters.value.length > 0 && !selectedSemesterId.value) {
      selectedSemesterId.value = semesters.value[0].id;
    }

    if (selectedSemesterId.value) {
      rules.value = await financeService.getRules(selectedSemesterId.value);
      contributions.value = await financeService.getObligationsBySemester(
        selectedSemesterId.value,
        'CONTRIBUTION'
      );
      enrolledStudents.value = await StudentsRepository.getStudents({
        semesterId: selectedSemesterId.value,
      });
    }
  } catch (err) {
    console.error('Failed to load contributions data:', err);
  } finally {
    isLoading.value = false;
  }
}

function openAssignModal() {
  haptics.medium();
  const contribRule = rules.value.find((r) => r.type === 'CONTRIBUTION') || rules.value[0];
  if (contribRule) {
    selectedRuleId.value = contribRule.id;
    contributionTitle.value = contribRule.name;
    amountPesos.value = centavosToPeso(contribRule.defaultAmountCentavos);
  } else {
    contributionTitle.value = 'CSG Semester Contribution';
    amountPesos.value = 100;
  }
  isSheetOpen.value = true;
}

async function confirmAssignContribution() {
  if (!contributionTitle.value.trim()) {
    errorMessage.value = 'Contribution title is required.';
    return;
  }
  if (!amountPesos.value || amountPesos.value <= 0) {
    errorMessage.value = 'Amount must be greater than zero.';
    return;
  }

  isAssigning.value = true;
  errorMessage.value = null;

  try {
    const result = await financeService.assessBulkContributions({
      semesterId: selectedSemesterId.value,
      ruleId: selectedRuleId.value || undefined,
      title: contributionTitle.value.trim(),
      amountCentavos: pesoToCentavos(amountPesos.value),
      dueDate: dueDate.value || null,
      notes: notes.value.trim() || null,
      targetScope: targetScope.value,
      yearLevels: targetScope.value === 'YEAR_LEVEL' ? [selectedYearLevel.value] : undefined,
      sections: targetScope.value === 'SECTION' ? [selectedSection.value] : undefined,
      studentIds: targetScope.value === 'INDIVIDUAL' ? selectedStudentIds.value : undefined,
      actorUserId: 'officer_local',
    });

    haptics.success();
    successMessage.value = `Assigned contribution to ${result.totalAssigned} students totaling ${formatPeso(
      result.totalCentavos
    )}.`;
    isSheetOpen.value = false;
    await loadData();
  } catch (err: any) {
    console.error('Failed to assign bulk contribution:', err);
    errorMessage.value = err.message || 'Error assigning contribution.';
    haptics.error();
  } finally {
    isAssigning.value = false;
  }
}

onMounted(loadData);
onIonViewWillEnter(loadData);
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Contributions"
      subtitle="Organization dues & required collections"
      :back-button="true"
      default-back-href="/tabs/finance"
      variant="detail"
    />

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Top Controls Card -->
        <UniCard padding="sm" class="top-controls-card">
          <div class="sem-picker">
            <label class="field-label">Active Term</label>
            <UniSelect
              v-model="selectedSemesterId"
              :options="semesterOptions"
              placeholder="Select Term"
              header="Active Term"
              @change="loadData"
            />
          </div>
        </UniCard>

        <!-- Success Notification -->
        <div v-if="successMessage" class="alert-box success-box">
          <ion-icon :icon="checkmarkCircle" class="alert-icon text-success" />
          <div class="alert-text">
            <strong>Contribution Assigned</strong>
            <p>{{ successMessage }}</p>
          </div>
        </div>

        <!-- Filter & Search Toolbar (Setup Layout Style) -->
        <div class="toolbar-row">
          <ion-searchbar
            v-model="searchQuery"
            placeholder="Search student, ID, or title..."
            class="clean-searchbar"
            :debounce="200"
          />
          <UniButton
            variant="primary"
            size="sm"
            :icon="addOutline"
            @click="openAssignModal"
          >
            New
          </UniButton>
        </div>

        <UniSegmentedControl
          v-model="filterStatus"
          :options="statusFilterOptions"
          size="sm"
          class="contributions-filter-segment"
        />

        <!-- Loading Spinner -->
        <div v-if="isLoading" class="loading-state">
          <ion-spinner name="crescent" color="primary" />
          <p class="loading-text">Loading contributions...</p>
        </div>

        <!-- Contributions Record List (UniTap Reusable Components) -->
        <div v-else-if="filteredContributions.length > 0" class="contributions-records-list">
          <UniRecordList
            :empty="filteredContributions.length === 0"
            empty-title="No Contributions Found"
            empty-description="Create a new organization contribution to assign to students in bulk."
          >
            <UniExpandableRow
              v-for="c in filteredContributions"
              :key="c.id"
              :title="c.studentName || 'Student'"
              :subtitle="`${c.schoolId} • Year ${c.yearLevel}-${c.section} • ${c.title}`"
              :badge="formatObligationStatus(c.status)"
              :badge-variant="c.status === 'PAID' ? 'success' : 'warning'"
              :amount="formatPeso(c.balanceCentavos)"
              :amount-variant="c.balanceCentavos > 0 ? 'danger' : 'success'"
            >
              <template #content>
                <div class="contrib-details-grid">
                  <div class="detail-item">
                    <span class="detail-label">Contribution Title</span>
                    <span class="detail-val font-bold">{{ c.title }}</span>
                  </div>
                  <div class="detail-item">
                    <span class="detail-label">Assessed Amount</span>
                    <span class="detail-val font-mono">{{ formatPeso(c.amountCentavos) }}</span>
                  </div>
                  <div class="detail-item">
                    <span class="detail-label">Paid to Date</span>
                    <span class="detail-val font-mono text-success font-bold">{{ formatPeso(c.paidCentavos) }}</span>
                  </div>
                  <div class="detail-item">
                    <span class="detail-label">Remaining Balance</span>
                    <span
                      class="detail-val font-mono font-bold"
                      :class="c.balanceCentavos > 0 ? 'text-danger' : 'text-success'"
                    >
                      {{ formatPeso(c.balanceCentavos) }}
                    </span>
                  </div>
                </div>
              </template>
            </UniExpandableRow>
          </UniRecordList>
        </div>

        <UniEmptyState
          v-else
          title="No Contributions Found"
          description="Create a new organization contribution to assign to students in bulk."
          :icon="walletOutline"
        />
      </div>

      <!-- Bulk Contribution Assignment Sheet -->
      <UniSheet
        :is-open="isSheetOpen"
        title="Assign Organization Contribution"
        @close="isSheetOpen = false"
      >
        <div class="sheet-form">
          <div v-if="errorMessage" class="alert-box error-box">
            <ion-icon :icon="closeCircleOutline" class="alert-icon" />
            <div class="alert-text">{{ errorMessage }}</div>
          </div>

          <div class="form-group">
            <label class="form-label">Contribution Title</label>
            <input
              v-model="contributionTitle"
              type="text"
              class="clean-input"
              placeholder="e.g. CSG 1st Semester Membership Fee"
            />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Amount per Student (PHP)</label>
              <input
                v-model.number="amountPesos"
                type="number"
                min="1"
                step="10"
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
            <label class="form-label">Target Audience Scope</label>
            <UniSelect
              v-model="targetScope"
              :options="scopeOptions"
              placeholder="Select Audience Scope"
              header="Target Audience Scope"
              presentation="action-sheet"
            />
          </div>

          <div v-if="targetScope === 'YEAR_LEVEL'" class="form-group">
            <label class="form-label">Select Year Level</label>
            <UniSelect
              v-model="selectedYearLevel"
              :options="yearLevelOptions"
              placeholder="Select Year Level"
              header="Select Year Level"
              presentation="action-sheet"
            />
          </div>

          <div v-if="targetScope === 'SECTION'" class="form-group">
            <label class="form-label">Target Section</label>
            <input
              v-model="selectedSection"
              type="text"
              placeholder="e.g. 1F4, 2F1"
              class="clean-input"
            />
          </div>

          <!-- Preview Summary -->
          <div class="preview-box">
            <div class="preview-row">
              <span>Audience Scope:</span>
              <strong>{{ targetScope }}</strong>
            </div>
            <div class="preview-row">
              <span>Amount per Student:</span>
              <strong class="font-mono">{{ formatPeso(pesoToCentavos(amountPesos)) }}</strong>
            </div>
            <div class="preview-divider"></div>
            <div class="preview-row total-row">
              <span>Estimated Total Assessment:</span>
              <strong class="text-primary font-mono font-bold">{{ formatPeso(totalPreviewCentavos) }}</strong>
            </div>
          </div>

          <div class="sheet-actions">
            <UniButton variant="outline" @click="isSheetOpen = false">
              Cancel
            </UniButton>
            <UniButton
              variant="primary"
              :disabled="isAssigning"
              @click="confirmAssignContribution"
            >
              <ion-spinner v-if="isAssigning" name="crescent" slot="start" />
              <span>Confirm & Assign</span>
            </UniButton>
          </div>
        </div>
      </UniSheet>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.page-container {
  padding: 4px 0 calc(96px + var(--ion-safe-area-bottom, 0px)) 0;
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.top-controls-card {
  position: relative;
  z-index: 30;
}

.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 12px;
}

.sem-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 220px;
}

.field-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--uni-text-secondary, #64748b);
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.clean-searchbar {
  --background: var(--uni-surface, #ffffff);
  --color: var(--uni-text, #0f172a);
  --placeholder-color: var(--uni-text-muted, #94a3b8);
  --box-shadow: none;
  --border-radius: 12px;
  padding: 0;
  flex: 1;
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 12px;
  min-height: 40px;
}

:root.dark .clean-searchbar,
:root.ion-palette-dark .clean-searchbar,
body.dark .clean-searchbar,
body.ion-palette-dark .clean-searchbar {
  --background: var(--uni-surface, #1e293b);
  --color: #ffffff;
  --placeholder-color: #94a3b8;
  border-color: var(--uni-border, #334155);
}

.filter-card {
  position: relative;
  z-index: 10;
}

.filter-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.search-input-wrap {
  position: relative;
  flex: 1;
  min-width: 200px;
  display: flex;
  align-items: center;
}

.search-input-icon {
  position: absolute;
  left: 12px;
  font-size: 18px;
  color: var(--uni-text-secondary, #64748b);
  pointer-events: none;
}

.clean-search-input {
  width: 100%;
  height: 42px;
  padding: 0 14px 0 38px;
  border-radius: var(--uni-radius-btn, 12px);
  border: 1px solid var(--uni-border, #e2e8f0);
  background: var(--uni-surface, #ffffff);
  color: var(--uni-text, #0f172a);
  font-size: 13.5px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.16s ease;
}

.clean-search-input:focus {
  border-color: var(--uni-primary, #0f766e);
}

.clean-search-input::placeholder {
  color: var(--uni-text-secondary, #64748b);
}

.contributions-filter-segment {
  flex-shrink: 0;
}

/* Contributions Records List */
.contributions-records-list {
  width: 100%;
}

.contrib-details-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  padding: 4px 0;
}

@media (min-width: 600px) {
  .contrib-details-grid {
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

.badge-mini {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.badge-success {
  background: rgba(5, 150, 105, 0.12);
  color: var(--uni-success, #059669);
}

.badge-warning {
  background: rgba(217, 119, 6, 0.12);
  color: var(--uni-warning, #d97706);
}

.alert-box {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  font-size: 13px;
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

.clean-input {
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

.clean-input:focus {
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

/* Explicit Dark Mode Overrides */
:root.dark .clean-search-input,
:root.ion-palette-dark .clean-search-input,
body.dark .clean-search-input,
body.ion-palette-dark .clean-search-input {
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
  color: var(--uni-text, #F8FAFC);
}

:root.dark .clean-input,
:root.ion-palette-dark .clean-input,
body.dark .clean-input,
body.ion-palette-dark .clean-input {
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
  color: var(--uni-text, #F8FAFC);
}

:root.dark .preview-box,
:root.ion-palette-dark .preview-box,
body.dark .preview-box,
body.ion-palette-dark .preview-box {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #30343D);
  color: var(--uni-text, #F8FAFC);
}
</style>
