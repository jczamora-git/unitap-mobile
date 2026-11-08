<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
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
  alertCircleOutline,
  calendarOutline,
  receiptOutline,
  informationCircleOutline,
  trashOutline,
} from 'ionicons/icons';
import { financeService } from '@/services/finance.service';
import { studentService } from '@/services/student.service';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { authService } from '@/services/auth.service';
import { useAuth } from '@/composables/useAuth';
import { useOperationPolicy } from '@/composables/useOperationPolicy';
import type { Semester } from '@/types/database';
import type { Student } from '@/types/student';
import type { StudentObligationItem, ObligationRuleItem } from '@/types/finance';
import { formatPeso, pesoToCentavos, centavosToPeso } from '@/utilities/finance-formatters';
import { formatSemesterName, formatObligationStatus } from '@/utilities/presentation-formatters';
import { formatFullName } from '@/utilities/student-formatters';
import { useToast } from '@/composables/useToast';
import {
  UniPageHeader,
  UniButton,
  UniCard,
  UniSheet,
  UniDialog,
  UniEmptyState,
  UniSelect,
  UniRecordList,
  UniExpandableRow,
  UniSegmentedControl,
  UniPagination,
  UniStatusBadge,
} from '@/components/ui';
import { haptics } from '@/utilities/haptics';

const router = useRouter();
const { showToast } = useToast();
const { isPermitted, getDisabledReason } = useOperationPolicy();
const canManageRules = isPermitted('FINANCE_ASSESSMENTS_AND_RULES');
const rulesDisabledReason = getDisabledReason('FINANCE_ASSESSMENTS_AND_RULES');

// --- Section Navigation: Templates vs Student Records ---
type FinesSection = 'TEMPLATES' | 'RECORDS';
const activeSection = ref<FinesSection>('TEMPLATES');
const sectionOptions = [
  { value: 'TEMPLATES', label: 'Fine Templates' },
  { value: 'RECORDS', label: 'Student Records' },
];

// --- Academic Term & Data State ---
const semesters = ref<Semester[]>([]);
const selectedSemesterId = ref<string>('');
const rules = ref<ObligationRuleItem[]>([]);
const fines = ref<StudentObligationItem[]>([]);
const students = ref<Student[]>([]);
const isLoading = ref<boolean>(false);
const errorMessage = ref<string | null>(null);

const semesterOptions = computed(() =>
  semesters.value.map((s) => ({
    value: s.id,
    label: formatSemesterName(s.term),
    badge: s.status === 'ACTIVE' ? 'Active' : undefined,
  }))
);

// --- 1. Templates Section State ---
const fineRules = computed(() => rules.value.filter((r) => r.type === 'FINE'));

const isCreateTemplateSheetOpen = ref(false);
const isCreatingTemplate = ref(false);
const templateName = ref('');
const templateDefaultAmountPesos = ref<number>(50);
const templateTriggerType = ref<'ABSENCE' | 'LATE' | 'EVENT' | 'MANUAL'>('ABSENCE');

const triggerTypeOptions = [
  { value: 'ABSENCE', label: 'Absence Fine (Automated)' },
  { value: 'LATE', label: 'Tardiness Fine (Late Scan)' },
  { value: 'EVENT', label: 'Special Event Penalty' },
  { value: 'MANUAL', label: 'Manual Disciplinary Fine' },
];

const isTemplateDetailsSheetOpen = ref(false);
const selectedTemplateDetails = ref<ObligationRuleItem | null>(null);

// --- 2. Student Records Section State ---
const filterStatus = ref<'ALL' | 'UNPAID' | 'PAID' | 'VOID'>('ALL');
const searchQuery = ref<string>('');
const recordsPage = ref(1);
const recordsPageSize = ref(10);

const statusFilterOptions = [
  { value: 'ALL', label: 'All' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PAID', label: 'Settled' },
  { value: 'VOID', label: 'Void' },
];

const filteredFines = computed(() => {
  return fines.value.filter((f) => {
    if (filterStatus.value === 'UNPAID' && (f.status === 'PAID' || f.status === 'VOID')) return false;
    if (filterStatus.value === 'PAID' && f.status !== 'PAID') return false;
    if (filterStatus.value === 'VOID' && f.status !== 'VOID') return false;

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase().trim();
      const matchName = (f.studentName || '').toLowerCase().includes(q);
      const matchId = (f.schoolId || '').toLowerCase().includes(q);
      const matchTitle = f.title.toLowerCase().includes(q);
      if (!matchName && !matchId && !matchTitle) return false;
    }
    return true;
  });
});

const paginatedFines = computed(() => {
  const start = (recordsPage.value - 1) * recordsPageSize.value;
  return filteredFines.value.slice(start, start + recordsPageSize.value);
});

// --- Individual Student Fine Issue Sheet ---
const isIssueFineSheetOpen = ref(false);
const isIssuingFine = ref(false);
const selectedStudentId = ref('');
const selectedFineRuleId = ref('');
const customFineTitle = ref('');
const customFineAmountPesos = ref<number>(50);
const fineRemarks = ref('');

// --- Void Obligation Dialog ---
const isVoidModalOpen = ref(false);
const isVoiding = ref(false);
const voidingObligationId = ref('');
const voidReason = ref('');

const { isDevAdmin } = useAuth();
const showDeleteFineDialog = ref(false);
const fineToDelete = ref<StudentObligationItem | null>(null);
const isDeletingFine = ref(false);

function promptDeleteFine(fine: StudentObligationItem) {
  fineToDelete.value = fine;
  showDeleteFineDialog.value = true;
}

async function confirmDeleteFine() {
  if (!fineToDelete.value) return;
  isDeletingFine.value = true;
  try {
    await financeService.deleteStudentObligation(fineToDelete.value.id);
    await showToast('Fine obligation deleted successfully.', 'success');
    showDeleteFineDialog.value = false;
    fineToDelete.value = null;
    await loadData();
  } catch (err: any) {
    await showToast(err?.message || 'Cannot delete fine because payments have already been collected for it.', 'error');
  } finally {
    isDeletingFine.value = false;
  }
}

// --- Data Loader ---
async function loadData() {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    const activeSem = await AcademicRepository.getActiveSemester();
    semesters.value = await AcademicRepository.getSemesters();

    if (activeSem && !selectedSemesterId.value) {
      selectedSemesterId.value = activeSem.id;
    } else if (semesters.value.length > 0 && !selectedSemesterId.value) {
      selectedSemesterId.value = semesters.value[0].id;
    }

    if (selectedSemesterId.value) {
      const [fetchedRules, fetchedFines, fetchedStudents] = await Promise.all([
        financeService.getRules(selectedSemesterId.value),
        financeService.getObligationsBySemester(selectedSemesterId.value, 'FINE'),
        studentService.getStudents(),
      ]);
      rules.value = fetchedRules;
      fines.value = fetchedFines;
      students.value = fetchedStudents;
    }
  } catch (err: any) {
    console.error('Failed to load fines management data:', err);
    errorMessage.value = err.message || 'Error loading fines data.';
  } finally {
    isLoading.value = false;
  }
}

// --- Template Actions ---
function openCreateTemplateModal() {
  haptics.light();
  templateName.value = '';
  templateDefaultAmountPesos.value = 50;
  templateTriggerType.value = 'ABSENCE';
  isCreateTemplateSheetOpen.value = true;
}

async function handleCreateTemplate() {
  if (!canManageRules.value) {
    errorMessage.value = rulesDisabledReason.value || 'Template management requires an active connection.';
    return;
  }
  if (!templateName.value.trim()) {
    errorMessage.value = 'Fine template name is required.';
    return;
  }
  if (!templateDefaultAmountPesos.value || templateDefaultAmountPesos.value <= 0) {
    errorMessage.value = 'Standard fine amount must be greater than zero.';
    return;
  }

  isCreatingTemplate.value = true;
  errorMessage.value = null;
  try {
    await financeService.createRule({
      semesterId: selectedSemesterId.value,
      name: templateName.value.trim(),
      type: 'FINE',
      triggerType: templateTriggerType.value,
      defaultAmountCentavos: pesoToCentavos(templateDefaultAmountPesos.value),
      actorUserId: authService.user.value?.id || 'officer_user',
    });

    haptics.success();
    await showToast(`Fine template "${templateName.value.trim()}" published successfully.`, 'success');
    isCreateTemplateSheetOpen.value = false;
    await loadData();
  } catch (err: any) {
    console.error('Failed to create fine template:', err);
    errorMessage.value = err.message || 'Error creating fine template.';
    haptics.error();
  } finally {
    isCreatingTemplate.value = false;
  }
}

function viewTemplateDetails(t: ObligationRuleItem) {
  haptics.light();
  selectedTemplateDetails.value = t;
  isTemplateDetailsSheetOpen.value = true;
}

// --- Individual Fine Issuance ---
function openIssueFineModal() {
  haptics.light();
  selectedStudentId.value = '';
  selectedFineRuleId.value = '';
  customFineTitle.value = '';
  customFineAmountPesos.value = 50;
  fineRemarks.value = '';
  isIssueFineSheetOpen.value = true;
}

function onFineRuleSelectChange() {
  const r = fineRules.value.find((rule) => rule.id === selectedFineRuleId.value);
  if (r) {
    customFineTitle.value = r.name;
    customFineAmountPesos.value = centavosToPeso(r.defaultAmountCentavos);
  }
}

async function handleConfirmIssueFine() {
  if (!canManageRules.value) {
    errorMessage.value = rulesDisabledReason.value || 'Issuing fines requires an active connection.';
    return;
  }
  if (!selectedStudentId.value) {
    errorMessage.value = 'Please select a student.';
    return;
  }
  if (!customFineTitle.value.trim()) {
    errorMessage.value = 'Fine title is required.';
    return;
  }
  if (!customFineAmountPesos.value || customFineAmountPesos.value <= 0) {
    errorMessage.value = 'Fine amount must be greater than zero.';
    return;
  }

  isIssuingFine.value = true;
  errorMessage.value = null;
  try {
    await financeService.issueManualFine({
      studentId: selectedStudentId.value,
      semesterId: selectedSemesterId.value,
      ruleId: selectedFineRuleId.value || undefined,
      title: customFineTitle.value.trim(),
      amountCentavos: pesoToCentavos(customFineAmountPesos.value),
      actorUserId: authService.user.value?.id || 'officer_user',
    });

    haptics.success();
    await showToast('Fine assessed successfully for student.', 'success');
    isIssueFineSheetOpen.value = false;
    await loadData();
  } catch (err: any) {
    console.error('Failed to issue fine:', err);
    errorMessage.value = err.message || 'Error issuing fine.';
    haptics.error();
  } finally {
    isIssuingFine.value = false;
  }
}

// --- Void Obligation ---
function openVoidModal(obligationId: string) {
  haptics.medium();
  voidingObligationId.value = obligationId;
  voidReason.value = '';
  isVoidModalOpen.value = true;
}

async function confirmVoidObligation() {
  if (!voidReason.value.trim()) {
    errorMessage.value = 'A void/waiver reason is mandatory.';
    return;
  }
  isVoiding.value = true;
  try {
    await financeService.voidObligation(
      voidingObligationId.value,
      voidReason.value.trim(),
      authService.user.value?.id || 'officer_user'
    );
    haptics.success();
    await showToast('Obligation voided successfully.', 'success');
    isVoidModalOpen.value = false;
    await loadData();
  } catch (err: any) {
    console.error('Failed to void obligation:', err);
    errorMessage.value = err.message || 'Failed to void obligation.';
    haptics.error();
  } finally {
    isVoiding.value = false;
  }
}

onMounted(loadData);
onIonViewWillEnter(loadData);
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Fines Management"
      subtitle="Absence penalties, disciplinary fines & templates"
      :back-button="true"
      default-back-href="/tabs/finance"
      variant="detail"
    />

    <ion-content class="safe-content non-tab-content">
      <div class="page-container">
        <!-- Top Academic Term Picker -->
        <UniCard padding="sm" class="top-controls-card">
          <div class="sem-picker">
            <label class="field-label">Academic Period</label>
            <UniSelect
              v-model="selectedSemesterId"
              :options="semesterOptions"
              placeholder="Select Academic Period"
              header="Academic Period"
              @change="loadData"
            />
          </div>
        </UniCard>

        <!-- Notification Alerts -->
        <div v-if="errorMessage" class="alert-box error-box">
          <ion-icon :icon="closeCircleOutline" class="alert-icon text-danger" />
          <div class="alert-text">
            <strong>Notice</strong>
            <p>{{ errorMessage }}</p>
          </div>
          <button class="alert-close-btn" @click="errorMessage = null">×</button>
        </div>

        <!-- Section Switcher: Templates vs Student Records -->
        <UniSegmentedControl
          v-model="activeSection"
          :options="sectionOptions"
          size="md"
          class="fines-section-segmented"
        />

        <!-- ==================================================================== -->
        <!-- SECTION 1: FINE TEMPLATES                                           -->
        <!-- ==================================================================== -->
        <template v-if="activeSection === 'TEMPLATES'">
          <div class="section-toolbar-row">
            <div class="toolbar-title-wrap">
              <h3 class="section-title">Fine Templates</h3>
              <p class="section-desc">Standard penalty rates for absences & disciplinary policies</p>
            </div>
            <UniButton
              variant="primary"
              size="sm"
              :icon="addOutline"
              @click="openCreateTemplateModal"
            >
              New Template
            </UniButton>
          </div>

          <div v-if="isLoading && fineRules.length === 0" class="loading-state">
            <ion-spinner name="crescent" color="primary" />
            <p class="loading-text">Loading fine templates...</p>
          </div>

          <div v-else-if="fineRules.length > 0" class="templates-grid">
            <div
              v-for="tmpl in fineRules"
              :key="tmpl.id"
              class="template-card"
              @click="viewTemplateDetails(tmpl)"
            >
              <div class="template-card-top">
                <span class="badge-mini badge-danger">{{ tmpl.type }}</span>
                <UniStatusBadge variant="active">Active</UniStatusBadge>
              </div>

              <h4 class="template-card-name">{{ tmpl.name }}</h4>

              <div class="template-card-meta font-mono">
                <div class="meta-item">
                  <span class="meta-label">Default Rate:</span>
                  <strong class="meta-val text-danger">{{ formatPeso(tmpl.defaultAmountCentavos) }}</strong>
                </div>
                <div class="meta-item">
                  <span class="meta-label">Trigger:</span>
                  <span class="meta-val font-sans">{{ tmpl.triggerType }}</span>
                </div>
              </div>

              <div class="template-card-footer">
                <span class="tap-hint">Tap to inspect details</span>
              </div>
            </div>
          </div>

          <UniEmptyState
            v-else
            title="No Fine Templates Configured"
            description="Create standard penalty rules for event absences and attendance infractions."
            :icon="alertCircleOutline"
            action-text="Create Fine Template"
            @action="openCreateTemplateModal"
          />
        </template>

        <!-- ==================================================================== -->
        <!-- SECTION 2: STUDENT RECORDS                                          -->
        <!-- ==================================================================== -->
        <template v-else-if="activeSection === 'RECORDS'">
          <!-- Records Filter & Actions Bar -->
          <div class="toolbar-stack">
            <div class="toolbar-top-row">
              <ion-searchbar
                v-model="searchQuery"
                placeholder="Search student name, ID, or fine title..."
                class="clean-searchbar"
                :debounce="200"
              />
              <div class="action-buttons-wrap">
                <UniButton
                  variant="outline"
                  size="sm"
                  :icon="calendarOutline"
                  @click="router.push('/finance/absentees')"
                >
                  Absentees
                </UniButton>
                <UniButton
                  variant="primary"
                  size="sm"
                  :icon="addOutline"
                  @click="openIssueFineModal"
                >
                  Issue Fine
                </UniButton>
              </div>
            </div>

            <UniSegmentedControl
              v-model="filterStatus"
              :options="statusFilterOptions"
              size="sm"
            />
          </div>

          <!-- Loading State -->
          <div v-if="isLoading" class="loading-state">
            <ion-spinner name="crescent" color="primary" />
            <p class="loading-text">Loading student fines...</p>
          </div>

          <!-- Fine Obligations List -->
          <div v-else-if="filteredFines.length > 0" class="records-wrap">
            <UniRecordList :empty="false">
              <UniExpandableRow
                v-for="f in paginatedFines"
                :key="f.id"
                :title="f.studentName || 'Student'"
                :subtitle="`${f.schoolId || 'ID'} • Year ${f.yearLevel || 1}-${f.section || 'A'} • ${f.title}`"
                :badge="formatObligationStatus(f.status)"
                :badge-variant="f.status === 'PAID' ? 'success' : (f.status === 'VOID' ? 'neutral' : 'warning')"
                :amount="formatPeso(f.balanceCentavos)"
                :amount-variant="f.balanceCentavos > 0 ? 'danger' : 'success'"
              >
                <template #content>
                  <div class="record-expanded-grid font-mono">
                    <div class="expanded-item">
                      <span class="exp-label">Fine Title</span>
                      <strong class="exp-val font-sans">{{ f.title }}</strong>
                    </div>
                    <div class="expanded-item">
                      <span class="exp-label">Assessed Penalty</span>
                      <span class="exp-val">{{ formatPeso(f.amountCentavos) }}</span>
                    </div>
                    <div class="expanded-item">
                      <span class="exp-label">Settled Amount</span>
                      <span class="exp-val text-success">{{ formatPeso(f.paidCentavos) }}</span>
                    </div>
                    <div class="expanded-item">
                      <span class="exp-label">Outstanding Balance</span>
                      <strong class="exp-val text-danger">{{ formatPeso(f.balanceCentavos) }}</strong>
                    </div>
                    <div v-if="f.issuedAt" class="expanded-item">
                      <span class="exp-label">Issued On</span>
                      <span class="exp-val font-sans">{{ new Date(f.issuedAt).toLocaleDateString() }}</span>
                    </div>
                  </div>

                  <div v-if="f.status !== 'VOID' && f.balanceCentavos > 0" class="expanded-actions-row">
                    <UniButton
                      variant="outline"
                      size="sm"
                      @click="openVoidModal(f.id)"
                    >
                      Void / Waive Fine
                    </UniButton>
                    <UniButton
                      v-if="isDevAdmin && f.balanceCentavos === f.amountCentavos"
                      variant="destructive"
                      size="sm"
                      :icon="trashOutline"
                      @click="promptDeleteFine(f)"
                    >
                      Delete Fine
                    </UniButton>
                  </div>
                </template>
              </UniExpandableRow>
            </UniRecordList>

            <UniPagination
              v-model:current-page="recordsPage"
              v-model:page-size="recordsPageSize"
              :total-items="filteredFines.length"
              :page-size-options="[10, 20, 50]"
            />
          </div>

          <UniEmptyState
            v-else
            title="No Student Fines Found"
            description="No fine obligations match your filter criteria for this academic period."
            :icon="checkmarkCircle"
          />
        </template>
      </div>

      <!-- ==================================================================== -->
      <!-- MODAL A: Create Fine Template Sheet                                  -->
      <!-- ==================================================================== -->
      <UniSheet
        :is-open="isCreateTemplateSheetOpen"
        title="Add Fine Template"
        @close="isCreateTemplateSheetOpen = false"
      >
        <div class="sheet-form">
          <div class="form-group">
            <label class="form-label">Template Name <span class="req">*</span></label>
            <input
              v-model="templateName"
              type="text"
              class="clean-input"
              placeholder="e.g. Assembly Absence Fine"
            />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Standard Fine (₱) <span class="req">*</span></label>
              <input
                v-model.number="templateDefaultAmountPesos"
                type="number"
                min="1"
                step="5"
                class="clean-input font-mono"
              />
            </div>

            <div class="form-group">
              <label class="form-label">Trigger Rule</label>
              <UniSelect
                v-model="templateTriggerType"
                :options="triggerTypeOptions"
                placeholder="Select Trigger"
                header="Trigger Mechanism"
              />
            </div>
          </div>

          <div class="sheet-actions-row">
            <UniButton
              variant="outline"
              size="sm"
              @click="isCreateTemplateSheetOpen = false"
            >
              Cancel
            </UniButton>
            <UniButton
              variant="primary"
              size="sm"
              :disabled="isCreatingTemplate || !templateName.trim()"
              @click="handleCreateTemplate"
            >
              {{ isCreatingTemplate ? 'Publishing...' : 'Publish Template' }}
            </UniButton>
          </div>
        </div>
      </UniSheet>

      <!-- ==================================================================== -->
      <!-- MODAL B: Template Details Inspection Sheet                           -->
      <!-- ==================================================================== -->
      <UniSheet
        :is-open="isTemplateDetailsSheetOpen"
        title="Fine Template Details"
        @close="isTemplateDetailsSheetOpen = false"
      >
        <div v-if="selectedTemplateDetails" class="sheet-form">
          <div class="details-spec-grid font-mono">
            <div class="spec-row">
              <span class="spec-label">Template Name:</span>
              <strong class="spec-val font-sans">{{ selectedTemplateDetails.name }}</strong>
            </div>
            <div class="spec-row">
              <span class="spec-label">Obligation Type:</span>
              <span class="spec-val text-danger font-bold">{{ selectedTemplateDetails.type }}</span>
            </div>
            <div class="spec-row">
              <span class="spec-label">Default Amount:</span>
              <strong class="spec-val">{{ formatPeso(selectedTemplateDetails.defaultAmountCentavos) }}</strong>
            </div>
            <div class="spec-row">
              <span class="spec-label">Trigger Rule:</span>
              <span class="spec-val font-sans">{{ selectedTemplateDetails.triggerType }}</span>
            </div>
            <div class="spec-row">
              <span class="spec-label">Status:</span>
              <span class="spec-val text-success font-bold">{{ selectedTemplateDetails.status }}</span>
            </div>
          </div>

          <div class="audit-notice-box">
            <ion-icon :icon="informationCircleOutline" class="notice-icon" />
            <p>
              Template definitions are immutable once published to preserve historical audit integrity. Create a new template for updated penalty amounts.
            </p>
          </div>

          <div class="sheet-actions-row">
            <UniButton
              variant="primary"
              size="sm"
              @click="isTemplateDetailsSheetOpen = false"
            >
              Done
            </UniButton>
          </div>
        </div>
      </UniSheet>

      <!-- ==================================================================== -->
      <!-- MODAL C: Individual Student Fine Issuance Sheet                      -->
      <!-- ==================================================================== -->
      <UniSheet
        :is-open="isIssueFineSheetOpen"
        title="Issue Student Fine"
        @close="isIssueFineSheetOpen = false"
      >
        <div class="sheet-form">
          <div class="form-group">
            <label class="form-label">Target Student <span class="req">*</span></label>
            <UniSelect
              v-model="selectedStudentId"
              :options="students.map((s) => ({ value: s.id, label: `${formatFullName(s.firstName, s.middleName, s.lastName)} (${s.studentNumber || s.section})` }))"
              placeholder="-- Select Student --"
              header="Target Student"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Pre-configured Template (Optional)</label>
            <UniSelect
              v-model="selectedFineRuleId"
              :options="[
                { value: '', label: '-- Custom Fine (No Template) --' },
                ...fineRules.map((r) => ({ value: r.id, label: `${r.name} (${formatPeso(r.defaultAmountCentavos)})` })),
              ]"
              placeholder="Choose template"
              header="Fine Template"
              @change="onFineRuleSelectChange"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Fine Title <span class="req">*</span></label>
            <input
              v-model="customFineTitle"
              type="text"
              class="clean-input"
              placeholder="e.g. Failure to attend Clean-up Drive"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Penalty Amount (PHP) <span class="req">*</span></label>
            <input
              v-model.number="customFineAmountPesos"
              type="number"
              min="1"
              step="5"
              class="clean-input font-mono"
            />
          </div>

          <div class="sheet-actions-row">
            <UniButton
              variant="outline"
              size="sm"
              @click="isIssueFineSheetOpen = false"
            >
              Cancel
            </UniButton>
            <UniButton
              variant="primary"
              size="sm"
              :disabled="isIssuingFine || !selectedStudentId || !customFineTitle.trim()"
              @click="handleConfirmIssueFine"
            >
              {{ isIssuingFine ? 'Assessing...' : 'Assess Fine' }}
            </UniButton>
          </div>
        </div>
      </UniSheet>

      <!-- ==================================================================== -->
      <!-- MODAL D: Void Obligation Dialog                                      -->
      <!-- ==================================================================== -->
      <UniSheet
        :is-open="isVoidModalOpen"
        title="Void / Waive Student Fine"
        @close="isVoidModalOpen = false"
      >
        <div class="sheet-form">
          <p class="sheet-sub">
            Voiding cancels the outstanding penalty balance. This operation is recorded in the official audit log.
          </p>

          <div class="form-group">
            <label class="form-label">Mandatory Reason <span class="req">*</span></label>
            <input
              v-model="voidReason"
              type="text"
              class="clean-input"
              placeholder="e.g. Excused medical absence / Authorized waiver"
            />
          </div>

          <div class="sheet-actions-row">
            <UniButton
              variant="outline"
              size="sm"
              @click="isVoidModalOpen = false"
            >
              Cancel
            </UniButton>
            <UniButton
              variant="destructive"
              size="sm"
              :disabled="isVoiding || !voidReason.trim()"
              @click="confirmVoidObligation"
            >
              {{ isVoiding ? 'Voiding...' : 'Confirm Void' }}
            </UniButton>
          </div>
        </div>
      </UniSheet>

      <!-- Delete Fine Dialog -->
      <UniDialog
        v-model:is-open="showDeleteFineDialog"
        title="Delete Fine Obligation?"
        :description="`Are you sure you want to permanently delete fine '${fineToDelete?.title}' for ${fineToDelete?.studentName} (${formatPeso(fineToDelete?.amountCentavos || 0)})? If payments exist, deletion will be blocked.`"
        :confirm-text="isDeletingFine ? 'Deleting...' : 'Delete Fine'"
        cancel-text="Cancel"
        :destructive="true"
        type="destructive"
        @confirm="confirmDeleteFine"
        @cancel="showDeleteFineDialog = false"
      />
    </ion-content>
  </ion-page>
</template>

<style scoped>
.page-container {
  padding: 8px 12px 24px 12px;
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.top-controls-card {
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
}

.sem-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--uni-text-secondary);
}

.alert-box {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  position: relative;
}

.success-box {
  background: var(--uni-success-bg, rgba(34, 197, 94, 0.1));
  border: 1px solid var(--uni-success-border, rgba(34, 197, 94, 0.2));
  color: var(--uni-success, #22c55e);
}

.error-box {
  background: var(--uni-danger-bg, rgba(239, 68, 68, 0.1));
  border: 1px solid var(--uni-danger-border, rgba(239, 68, 68, 0.2));
  color: var(--uni-danger, #ef4444);
}

.alert-icon {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 1px;
}

.alert-text p {
  margin: 2px 0 0 0;
  font-size: 12px;
  color: var(--uni-text);
}

.alert-close-btn {
  position: absolute;
  top: 8px;
  right: 10px;
  background: none;
  border: none;
  font-size: 18px;
  color: var(--uni-text-secondary);
  cursor: pointer;
}

.fines-section-segmented {
  margin: 2px 0 6px 0;
}

.section-toolbar-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.section-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--uni-text);
  margin: 0;
}

.section-desc {
  font-size: 12px;
  color: var(--uni-text-secondary);
  margin: 2px 0 0 0;
}

.templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.template-card {
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: var(--uni-shadow-card, 0 1px 3px rgba(0, 0, 0, 0.05));
  cursor: pointer;
  transition: all 0.15s ease;
}

.template-card:hover {
  border-color: var(--uni-primary);
  background: var(--uni-surface-secondary);
}

.template-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.template-card-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--uni-text);
  margin: 0;
}

.template-card-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 8px;
  padding: 8px 10px;
}

.meta-item {
  display: flex;
  justify-content: space-between;
}

.meta-label {
  color: var(--uni-text-secondary);
}

.template-card-footer {
  text-align: right;
}

.tap-hint {
  font-size: 10px;
  color: var(--uni-text-secondary);
}

.toolbar-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.toolbar-top-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.clean-searchbar {
  flex: 1;
  padding: 0;
  --background: var(--uni-surface);
  --border-radius: 10px;
  --box-shadow: none;
}

.action-buttons-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.records-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.record-expanded-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  background: var(--uni-surface-secondary);
  border-radius: 8px;
  border: 1px solid var(--uni-border);
  font-size: 12px;
}

.expanded-item {
  display: flex;
  justify-content: space-between;
  color: var(--uni-text);
}

.exp-label {
  color: var(--uni-text-secondary);
}

.expanded-actions-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.sheet-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0 16px 0;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.form-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--uni-text);
}

.req {
  color: var(--uni-danger);
}

.clean-input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--uni-border);
  background: var(--uni-surface-secondary);
  color: var(--uni-text);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}

.clean-input:focus {
  border-color: var(--uni-primary);
}

.sheet-actions-row {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}

.details-spec-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 8px;
  padding: 12px;
  font-size: 13px;
}

.spec-row {
  display: flex;
  justify-content: space-between;
}

.spec-label {
  color: var(--uni-text-secondary);
}

.spec-val {
  color: var(--uni-text);
}

.audit-notice-box {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: var(--uni-info-bg, rgba(59, 130, 246, 0.1));
  border: 1px solid var(--uni-info-border, rgba(59, 130, 246, 0.2));
  color: var(--uni-info, #3b82f6);
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.4;
}

.audit-notice-box p {
  margin: 0;
  color: var(--uni-text);
}

.notice-icon {
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}

.badge-mini {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
}

.badge-danger {
  background: var(--uni-danger-bg, rgba(239, 68, 68, 0.1));
  color: var(--uni-danger, #ef4444);
  border: 1px solid var(--uni-danger-border, rgba(239, 68, 68, 0.2));
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px 0;
  gap: 8px;
}

.loading-text {
  font-size: 12px;
  color: var(--uni-text-secondary);
}
</style>
