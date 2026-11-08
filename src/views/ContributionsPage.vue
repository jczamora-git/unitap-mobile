<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  IonSpinner,
  IonSearchbar,
  IonModal,
  onIonViewWillEnter,
} from '@ionic/vue';
import {
  addOutline,
  checkmarkCircle,
  closeCircleOutline,
  walletOutline,
  informationCircleOutline,
  cashOutline,
  peopleOutline,
  calendarOutline,
  listOutline,
  arrowForwardOutline,
  alertCircleOutline,
  trashOutline,
} from 'ionicons/icons';
import { financeService } from '@/services/finance.service';
import { authService } from '@/services/auth.service';
import { useAuth } from '@/composables/useAuth';
import { useOperationPolicy } from '@/composables/useOperationPolicy';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { StudentsRepository, type StudentWithEnrollment } from '@/database/repositories/students.repository';
import { studentService } from '@/services/student.service';
import type { Semester, Program, SectionRecord } from '@/types/database';
import type {
  StudentObligationItem,
  ContributionCollectionItem,
  ContributionCreationStage,
  BulkContributionResult,
  ObligationRuleItem,
} from '@/types/finance';
import { formatPeso, pesoToCentavos, centavosToPeso } from '@/utilities/finance-formatters';
import { formatSemesterName, formatObligationStatus } from '@/utilities/presentation-formatters';
import { useToast } from '@/composables/useToast';
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
  UniPagination,
  UniStatusBadge,
} from '@/components/ui';
import { haptics } from '@/utilities/haptics';

const router = useRouter();
const { showToast } = useToast();
const { isPermitted, getDisabledReason } = useOperationPolicy();
const canManageRules = isPermitted('FINANCE_ASSESSMENTS_AND_RULES');
const rulesDisabledReason = getDisabledReason('FINANCE_ASSESSMENTS_AND_RULES');

// --- Section Navigation: Collections vs Student Records ---
type ContributionsSection = 'COLLECTIONS' | 'RECORDS';
const activeSection = ref<ContributionsSection>('COLLECTIONS');
const sectionOptions = [
  { value: 'COLLECTIONS', label: 'Collections' },
  { value: 'RECORDS', label: 'Student Records' },
];

// --- Academic Term & Data State ---
const semesters = ref<Semester[]>([]);
const selectedSemesterId = ref<string>('');
const collections = ref<ContributionCollectionItem[]>([]);
const contributions = ref<StudentObligationItem[]>([]);
const enrolledStudents = ref<StudentWithEnrollment[]>([]);
const programs = ref<Program[]>([]);
const sections = ref<(SectionRecord & { year_display?: string; program_code?: string })[]>([]);

const semesterOptions = computed(() =>
  semesters.value.map((s) => ({
    value: s.id,
    label: formatSemesterName(s.term),
    badge: s.status === 'ACTIVE' ? 'Active' : undefined,
  }))
);

const programOptions = computed(() =>
  programs.value.map((p) => ({
    value: p.id,
    label: `${p.code} • ${p.name}`,
  }))
);

const sectionOptionsList = computed(() =>
  sections.value.map((s) => ({
    value: s.section_name,
    label: `Sec ${s.section_name}${s.program_code ? ` (${s.program_code})` : ''}`,
  }))
);

const scopeOptions = [
  { value: 'ALL', label: 'All Enrolled Students' },
  { value: 'PROGRAM', label: 'By Degree Program' },
  { value: 'YEAR_LEVEL', label: 'By Year Level' },
  { value: 'SECTION', label: 'By Section' },
  { value: 'INDIVIDUAL', label: 'Selected Students' },
];

const yearLevelOptions = [
  { value: 1, label: '1st Year' },
  { value: 2, label: '2nd Year' },
  { value: 3, label: '3rd Year' },
  { value: 4, label: '4th Year' },
];

const isLoading = ref<boolean>(false);
const errorMessage = ref<string | null>(null);

// --- 1. Collections Section State ---
const isCollectionDetailsSheetOpen = ref(false);
const selectedCollectionDetails = ref<ContributionCollectionItem | null>(null);

// --- 2. Create Contribution Form State ---
const isCreateCollectionSheetOpen = ref(false);
const isCreatingCollection = ref(false);

// --- Blocking Processing & Success Modal State ---
const isBlockingModalOpen = ref(false);
const isSuccessModalOpen = ref(false);
const creationStage = ref<ContributionCreationStage>('IDLE');
const creationStatusTitle = ref('Creating Contribution...');
const creationStatusDesc = ref('Registering contribution definition in Supabase.');
const creationProgressCurrent = ref(0);
const creationProgressTotal = ref(0);
const creationErrorMessage = ref<string | null>(null);
const createdRuleRecord = ref<ObligationRuleItem | null>(null);
const createdAssessResult = ref<BulkContributionResult | null>(null);
const isRuleSavedOnFailure = ref(false);

const selectedSemesterLabel = computed(() => {
  const opt = semesterOptions.value.find((s) => s.value === (collectionSemesterId.value || selectedSemesterId.value));
  return opt ? opt.label : 'Active Semester';
});

const defaultDueDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().split('T')[0];
};

const collectionName = ref<string>('');
const collectionAmountPesos = ref<number>(100);
const collectionDueDate = ref<string>(defaultDueDate());
const collectionSemesterId = ref<string>('');
const collectionTargetScope = ref<'ALL' | 'PROGRAM' | 'YEAR_LEVEL' | 'SECTION' | 'INDIVIDUAL'>('ALL');
const selectedProgramId = ref<string>('');
const selectedYearLevel = ref<number>(1);
const selectedSection = ref<string>('');
const selectedStudentIds = ref<string[]>([]);
const studentSearchInModal = ref<string>('');
const collectionNotes = ref<string>('');

// Filtered student list for individual selection inside modal
const filteredModalStudents = computed(() => {
  if (!studentSearchInModal.value.trim()) {
    return enrolledStudents.value.slice(0, 100);
  }
  const q = studentSearchInModal.value.toLowerCase().trim();
  return enrolledStudents.value.filter(
    (s) =>
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
      s.school_id.toLowerCase().includes(q) ||
      (s.section && s.section.toLowerCase().includes(q))
  );
});

// Dynamic student count preview based on chosen scope
const estimatedStudentCount = computed(() => {
  if (collectionTargetScope.value === 'ALL') {
    return enrolledStudents.value.length;
  }
  if (collectionTargetScope.value === 'PROGRAM' && selectedProgramId.value) {
    return enrolledStudents.value.filter((s) => s.program_id === selectedProgramId.value).length;
  }
  if (collectionTargetScope.value === 'YEAR_LEVEL') {
    return enrolledStudents.value.filter((s) => s.year_level === selectedYearLevel.value).length;
  }
  if (collectionTargetScope.value === 'SECTION' && selectedSection.value) {
    return enrolledStudents.value.filter((s) => s.section === selectedSection.value).length;
  }
  if (collectionTargetScope.value === 'INDIVIDUAL') {
    return selectedStudentIds.value.length;
  }
  return enrolledStudents.value.length;
});

const totalPreviewCentavos = computed(() => {
  return estimatedStudentCount.value * pesoToCentavos(collectionAmountPesos.value || 0);
});

const targetAudienceLabel = computed(() => {
  switch (collectionTargetScope.value) {
    case 'PROGRAM': {
      const match = programs.value.find((p) => p.id === selectedProgramId.value);
      return match ? `${match.code} Students` : 'Selected Program';
    }
    case 'YEAR_LEVEL':
      return `${selectedYearLevel.value} Year Students`;
    case 'SECTION':
      return selectedSection.value ? `Section ${selectedSection.value}` : 'Selected Section';
    case 'INDIVIDUAL':
      return `${selectedStudentIds.value.length} Selected Student(s)`;
    case 'ALL':
    default:
      return 'All Enrolled Students';
  }
});

// --- 3. Student Records Section State ---
type RecordPaymentStatusFilter = 'ALL' | 'UNPAID' | 'PARTIAL' | 'OVERDUE' | 'PAID';
const filterStatus = ref<RecordPaymentStatusFilter>('ALL');
const filterCollectionId = ref<string>('ALL');
const searchQuery = ref<string>('');
const recordsPage = ref(1);
const recordsPageSize = ref(10);

const statusFilterOptions = [
  { value: 'ALL', label: 'All' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'PAID', label: 'Fully Paid' },
];

const collectionFilterOptions = computed(() => [
  { value: 'ALL', label: 'All Collections' },
  ...collections.value.map((col) => ({
    value: col.id,
    label: `${col.name} (${formatPeso(col.amountCentavos)})`,
  })),
]);

function isObligationOverdue(c: StudentObligationItem): boolean {
  if (c.status === 'VOID' || c.status === 'PAID' || c.balanceCentavos <= 0) return false;
  if (!c.dueDate) return false;
  const due = new Date(c.dueDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return due < now;
}

function getObligationPaymentStatus(c: StudentObligationItem): 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE' | 'VOID' {
  if (c.status === 'VOID') return 'VOID';
  if (c.status === 'PAID' || c.balanceCentavos <= 0) return 'PAID';
  if (isObligationOverdue(c)) return 'OVERDUE';
  if (c.status === 'PARTIALLY_PAID' || (c.paidCentavos > 0 && c.balanceCentavos > 0)) return 'PARTIAL';
  return 'UNPAID';
}

const filteredContributions = computed(() => {
  return contributions.value.filter((c) => {
    const status = getObligationPaymentStatus(c);
    if (filterStatus.value === 'UNPAID' && status !== 'UNPAID') return false;
    if (filterStatus.value === 'PARTIAL' && status !== 'PARTIAL') return false;
    if (filterStatus.value === 'OVERDUE' && status !== 'OVERDUE') return false;
    if (filterStatus.value === 'PAID' && status !== 'PAID') return false;

    if (filterCollectionId.value && filterCollectionId.value !== 'ALL') {
      if (filterCollectionId.value.startsWith('legacy_')) {
        const titleMatch = filterCollectionId.value.replace('legacy_', '');
        if (c.title.replace(/\s+/g, '_').toLowerCase() !== titleMatch && c.batchId !== titleMatch) {
          return false;
        }
      } else {
        if (c.ruleId !== filterCollectionId.value) return false;
      }
    }

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

const paginatedContributions = computed(() => {
  const start = (recordsPage.value - 1) * recordsPageSize.value;
  return filteredContributions.value.slice(start, start + recordsPageSize.value);
});

function formatObligationAcademicSubtitle(c: StudentObligationItem): string {
  const schoolId = c.schoolId || '—';
  const program = c.program || c.course || '—';
  const yearText = c.yearLevel ? `Year ${c.yearLevel}` : '—';
  const sectionText = c.section || '—';
  const academic = (yearText === '—' && sectionText === '—') ? '—' : `${yearText}-${sectionText}`;
  return `${schoolId} • ${program} • ${academic} • ${c.title}`;
}

function formatStudentYearSection(s: { year_level?: number | null; section?: string | null }): string {
  const yearText = s.year_level ? `Year ${s.year_level}` : '—';
  const sectionText = s.section || '—';
  return (yearText === '—' && sectionText === '—') ? '—' : `${yearText}-${sectionText}`;
}

// --- 4. Void Obligation Dialog ---
const isVoidModalOpen = ref(false);
const isVoiding = ref(false);
const voidingObligationId = ref('');
const voidReason = ref('');

const { isDevAdmin } = useAuth();

const showDeleteCollectionDialog = ref(false);
const collectionToDelete = ref<ContributionCollectionItem | null>(null);
const isDeletingCollection = ref(false);

function promptDeleteCollection(col: ContributionCollectionItem) {
  collectionToDelete.value = col;
  showDeleteCollectionDialog.value = true;
}

async function confirmDeleteCollection() {
  if (!collectionToDelete.value) return;
  const targetRuleId = collectionToDelete.value.ruleId || collectionToDelete.value.id;
  if (!targetRuleId) return;
  isDeletingCollection.value = true;
  try {
    await financeService.deleteObligationRule(targetRuleId);
    await showToast('Contribution collection deleted successfully.', 'success');
    showDeleteCollectionDialog.value = false;
    collectionToDelete.value = null;
    await loadData();
  } catch (err: any) {
    await showToast(err?.message || 'Cannot delete contribution collection because payments have already been collected for it. Archive or deactivate instead.', 'error');
  } finally {
    isDeletingCollection.value = false;
  }
}

const showDeleteObligationDialog = ref(false);
const obligationToDelete = ref<StudentObligationItem | null>(null);
const isDeletingObligation = ref(false);

function promptDeleteObligation(ob: StudentObligationItem) {
  obligationToDelete.value = ob;
  showDeleteObligationDialog.value = true;
}

async function confirmDeleteObligation() {
  if (!obligationToDelete.value) return;
  isDeletingObligation.value = true;
  try {
    await financeService.deleteStudentObligation(obligationToDelete.value.id);
    await showToast('Student obligation deleted successfully.', 'success');
    showDeleteObligationDialog.value = false;
    obligationToDelete.value = null;
    await loadData();
  } catch (err: any) {
    await showToast(err?.message || 'Cannot delete student obligation because payments have already been allocated to it.', 'error');
  } finally {
    isDeletingObligation.value = false;
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
      collectionSemesterId.value = selectedSemesterId.value;

      const [fetchedCols, fetchedContribs, fetchedStudents, fetchedPrograms, fetchedSections] =
        await Promise.all([
          financeService.getContributionCollections(selectedSemesterId.value),
          financeService.getObligationsBySemester(selectedSemesterId.value, 'CONTRIBUTION'),
          studentService.getStudents(),
          AcademicRepository.getPrograms(),
          AcademicRepository.getSections(),
        ]);

      collections.value = fetchedCols;
      contributions.value = fetchedContribs;
      programs.value = fetchedPrograms;
      sections.value = fetchedSections;

      enrolledStudents.value = (fetchedStudents || []).map((s: any) => ({
        id: s.id,
        school_id: s.studentNumber || s.school_id || '',
        first_name: s.firstName || s.first_name || '',
        last_name: s.lastName || s.last_name || '',
        status: (s.status === 'INACTIVE' || s.status === 'GRADUATED') ? s.status : 'ACTIVE',
        created_at: s.createdAt || new Date().toISOString(),
        updated_at: s.updatedAt || new Date().toISOString(),
        year_level: s.yearLevel ?? s.year_level ?? null,
        section: s.section || '',
        program_id: s.programId || s.program_id || (fetchedPrograms.find((p: any) => p.code === s.course)?.id) || '',
        enrollment_status: s.status || 'ENROLLED',
      }));

      if (!selectedProgramId.value && fetchedPrograms.length > 0) {
        selectedProgramId.value = fetchedPrograms[0].id;
      }
      if (!selectedSection.value && fetchedSections.length > 0) {
        selectedSection.value = fetchedSections[0].section_name;
      }
    }
  } catch (err: any) {
    console.error('Failed to load contributions data:', err);
    errorMessage.value = err.message || 'Failed to load contributions data.';
  } finally {
    isLoading.value = false;
  }
}

// --- Create Contribution Workflow ---
function openCreateContributionModal() {
  haptics.light();
  collectionName.value = '';
  collectionAmountPesos.value = 100;
  collectionDueDate.value = defaultDueDate();
  collectionSemesterId.value = selectedSemesterId.value || '';
  collectionTargetScope.value = 'ALL';
  selectedStudentIds.value = [];
  studentSearchInModal.value = '';
  collectionNotes.value = '';
  isBlockingModalOpen.value = false;
  isSuccessModalOpen.value = false;
  isCreateCollectionSheetOpen.value = true;
}

function toggleStudentSelection(studentId: string) {
  const index = selectedStudentIds.value.indexOf(studentId);
  if (index >= 0) {
    selectedStudentIds.value.splice(index, 1);
  } else {
    selectedStudentIds.value.push(studentId);
  }
}

function selectAllModalStudents() {
  haptics.light();
  selectedStudentIds.value = enrolledStudents.value.map((s) => s.id);
}

function clearModalStudentSelection() {
  haptics.light();
  selectedStudentIds.value = [];
}

async function handleCreateContribution(retryRuleId?: string | unknown) {
  const effectiveRetryRuleId = typeof retryRuleId === 'string' ? retryRuleId : undefined;
  if (!canManageRules.value) {
    errorMessage.value = rulesDisabledReason.value || 'Creating contributions requires an active connection.';
    return;
  }
  if (!collectionName.value.trim()) {
    errorMessage.value = 'Contribution name is required.';
    return;
  }
  if (!collectionAmountPesos.value || collectionAmountPesos.value <= 0) {
    errorMessage.value = 'Contribution amount must be greater than zero.';
    return;
  }
  if (!collectionDueDate.value) {
    errorMessage.value = 'Due date is required.';
    return;
  }
  if (collectionTargetScope.value === 'INDIVIDUAL' && selectedStudentIds.value.length === 0) {
    errorMessage.value = 'Please select at least one student for individual assignment.';
    return;
  }

  isCreatingCollection.value = true;
  isBlockingModalOpen.value = true;
  isSuccessModalOpen.value = false;
  creationProgressCurrent.value = 0;
  creationProgressTotal.value = 0;
  creationErrorMessage.value = null;
  isRuleSavedOnFailure.value = false;

  if (effectiveRetryRuleId) {
    creationStage.value = 'LOADING_STUDENTS';
    creationStatusTitle.value = 'Retrying Student Assignment...';
    creationStatusDesc.value = 'Assigning eligible students to existing contribution fee definition.';
  } else {
    creationStage.value = 'CREATING_RULE';
    creationStatusTitle.value = 'Creating Contribution...';
    creationStatusDesc.value = 'Registering contribution fee definition in Supabase Cloud.';
  }

  try {
    const res = await financeService.createContributionCollection(
      {
        name: collectionName.value.trim(),
        amountCentavos: pesoToCentavos(collectionAmountPesos.value),
        dueDate: collectionDueDate.value,
        semesterId: collectionSemesterId.value || selectedSemesterId.value,
        targetScope: collectionTargetScope.value,
        programIds: collectionTargetScope.value === 'PROGRAM' ? [selectedProgramId.value] : undefined,
        yearLevels: collectionTargetScope.value === 'YEAR_LEVEL' ? [selectedYearLevel.value] : undefined,
        sections: collectionTargetScope.value === 'SECTION' ? [selectedSection.value] : undefined,
        studentIds: collectionTargetScope.value === 'INDIVIDUAL' ? selectedStudentIds.value : undefined,
        notes: collectionNotes.value.trim() || null,
        actorUserId: authService.user.value?.id || 'officer_user',
        existingRuleId: effectiveRetryRuleId,
      },
      (stage, meta) => {
        creationStage.value = stage;
        if (stage === 'CREATING_RULE') {
          creationStatusTitle.value = 'Creating Contribution...';
          creationStatusDesc.value = 'Registering contribution fee definition in Supabase Cloud.';
        } else if (stage === 'LOADING_STUDENTS') {
          creationStatusTitle.value = 'Loading Students...';
          creationStatusDesc.value = 'Querying enrolled active students matching audience criteria.';
        } else if (stage === 'GENERATING_OBLIGATIONS') {
          creationStatusTitle.value = 'Generating Student Obligations...';
          creationStatusDesc.value = meta?.total
            ? `Preparing obligation records for ${meta.total} eligible students.`
            : 'Preparing student obligation records and checking duplicates.';
          if (meta?.total) creationProgressTotal.value = meta.total;
        } else if (stage === 'SAVING_SUPABASE') {
          creationStatusTitle.value = 'Saving to Supabase...';
          creationStatusDesc.value = meta?.total
            ? `Persisting student obligations to Supabase (${meta.current || 0}/${meta.total}).`
            : 'Persisting student obligations to Supabase Cloud Database.';
          if (meta?.current !== undefined) creationProgressCurrent.value = meta.current;
          if (meta?.total) creationProgressTotal.value = meta.total;
        } else if (stage === 'FINALIZING') {
          creationStatusTitle.value = 'Finalizing...';
          creationStatusDesc.value = 'Confirming assignments and calculating collection target.';
        }
      }
    );

    creationStage.value = 'SUCCESS';
    creationStatusTitle.value = 'Contribution Created & Assigned';
    creationStatusDesc.value = 'Contribution fee and student obligations have been confirmed on Supabase.';
    createdRuleRecord.value = res.rule;
    createdAssessResult.value = res.assessResult;
    haptics.success();

    // 1. After confirmed Supabase success, close and dismiss the Create Contribution sheet
    isCreateCollectionSheetOpen.value = false;

    // 2. Close the blocking processing modal before displaying the success modal
    isBlockingModalOpen.value = false;

    // 3. Prevent stacked or overlapping Ionic modals by yielding for dismiss transition
    await new Promise((resolve) => setTimeout(resolve, 150));

    // 4. Display the dedicated success modal
    isSuccessModalOpen.value = true;
  } catch (err: any) {
    console.error('Failed to create contribution collection:', err);
    creationStage.value = 'ERROR';
    isRuleSavedOnFailure.value = !!err.ruleSaved;
    if (err.savedRule) createdRuleRecord.value = err.savedRule;
    creationErrorMessage.value = err.message || 'Error creating contribution collection.';
    creationStatusTitle.value = err.ruleSaved ? 'Student Assignment Incomplete' : 'Creation Failed';
    creationStatusDesc.value = err.ruleSaved
      ? 'The contribution fee was saved, but assigning individual student obligations failed.'
      : 'Failed to create contribution fee in Supabase.';
    haptics.error();
  } finally {
    isCreatingCollection.value = false;
  }
}

async function handleFinishCreationSuccess() {
  isSuccessModalOpen.value = false;
  isBlockingModalOpen.value = false;
  isCreateCollectionSheetOpen.value = false;
  collectionName.value = '';
  collectionNotes.value = '';
  selectedStudentIds.value = [];
  await loadData();
  activeSection.value = 'COLLECTIONS';
}

function handleRetryAssignment() {
  if (createdRuleRecord.value?.id) {
    handleCreateContribution(createdRuleRecord.value.id);
  }
}

async function handleDismissFailureModal() {
  isBlockingModalOpen.value = false;
  if (isRuleSavedOnFailure.value) {
    isCreateCollectionSheetOpen.value = false;
    await loadData();
    activeSection.value = 'COLLECTIONS';
  }
}

// --- Navigation to Record Payment ---
function navigateToPayment(ruleId?: string, studentId?: string) {
  haptics.light();
  const query: Record<string, string> = { category: 'CONTRIBUTION' };
  if (ruleId) query.templateId = ruleId;
  if (studentId) query.studentId = studentId;
  router.push({ path: '/tabs/finance/record-payment', query });
}

function viewCollectionStudents(col: ContributionCollectionItem) {
  haptics.light();
  filterCollectionId.value = col.id;
  filterStatus.value = 'ALL';
  activeSection.value = 'RECORDS';
}

function viewCollectionDetails(col: ContributionCollectionItem) {
  haptics.light();
  selectedCollectionDetails.value = col;
  isCollectionDetailsSheetOpen.value = true;
}

// --- Void Obligation Actions ---
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

function formatDueDate(d?: string | null): string {
  if (!d) return 'No due date';
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

onMounted(loadData);
onIonViewWillEnter(loadData);
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Contributions Management"
      subtitle="Organization dues, collection tracking & student obligations"
      :back-button="true"
      default-back-href="/tabs/finance"
      variant="detail"
    />

    <!-- FULL BLOCKING PROCESSING MODAL -->
    <ion-modal
      :is-open="isBlockingModalOpen"
      :backdrop-dismiss="false"
      class="blocking-process-modal"
    >
      <div class="blocking-modal-wrap">
        <div class="blocking-modal-card animate-fade-up">
          <!-- Animated Header Icon / Status Icon -->
          <div
            class="blocking-icon-box"
            :class="{
              'is-error': creationStage === 'ERROR',
            }"
          >
            <ion-spinner
              v-if="creationStage !== 'ERROR'"
              name="crescent"
              class="blocking-spinner"
            />
            <ion-icon
              v-else
              :icon="alertCircleOutline"
              class="error-icon"
            />
          </div>

          <!-- Dynamic Title & Description -->
          <div class="blocking-text-block">
            <h3 class="blocking-modal-title">
              {{ creationStatusTitle }}
            </h3>
            <p class="blocking-modal-desc">
              {{ creationStatusDesc }}
            </p>
          </div>

          <!-- Progress Bar (Determinate if counts known, else Indeterminate) -->
          <div
            v-if="creationStage !== 'ERROR'"
            class="indeterminate-progress-bar"
          >
            <div
              v-if="creationProgressTotal > 0 && creationProgressCurrent > 0"
              class="determinate-bar-fill"
              :style="{ width: Math.min(100, Math.round((creationProgressCurrent / creationProgressTotal) * 100)) + '%' }"
            ></div>
            <div v-else class="indeterminate-bar-fill"></div>
          </div>

          <!-- Metadata Context Card -->
          <div class="blocking-meta-box font-mono">
            <div class="meta-row">
              <span class="meta-lbl">Contribution:</span>
              <span class="meta-val">{{ collectionName || 'Contribution Fee' }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-lbl">Target Semester:</span>
              <span class="meta-val">{{ selectedSemesterLabel }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-lbl">Assignment Scope:</span>
              <span class="meta-val">{{ targetAudienceLabel }}</span>
            </div>

            <!-- On Error: show partial success status or error note -->
            <template v-if="creationStage === 'ERROR'">
              <div class="meta-row">
                <span class="meta-lbl">Contribution Rule:</span>
                <span class="meta-val" :class="isRuleSavedOnFailure ? 'text-amber font-bold' : 'text-danger'">
                  {{ isRuleSavedOnFailure ? 'Saved in Supabase' : 'Not Created' }}
                </span>
              </div>
              <div v-if="creationProgressTotal > 0" class="meta-row">
                <span class="meta-lbl">Target Students:</span>
                <span class="meta-val">{{ creationProgressTotal }} students</span>
              </div>
            </template>

            <!-- While Processing: show active count if available -->
            <template v-else-if="creationProgressTotal > 0">
              <div class="meta-row">
                <span class="meta-lbl">Progress:</span>
                <span class="meta-val">{{ creationProgressCurrent }} / {{ creationProgressTotal }}</span>
              </div>
            </template>
          </div>

          <!-- Error Alert Banner inside modal -->
          <div v-if="creationStage === 'ERROR' && creationErrorMessage" class="blocking-error-banner font-mono">
            <p>{{ creationErrorMessage }}</p>
          </div>

          <!-- Disclaimer while processing -->
          <div v-if="creationStage !== 'ERROR'" class="blocking-disclaimer font-mono">
            <ion-icon :icon="alertCircleOutline" />
            <span>Screen is blocked to protect data integrity and prevent double execution.</span>
          </div>

          <div v-if="creationStage === 'ERROR'" class="blocking-modal-actions">
            <UniButton
              v-if="isRuleSavedOnFailure"
              variant="primary"
              size="md"
              :block="true"
              @click="handleRetryAssignment"
            >
              Retry Student Assignment
            </UniButton>
            <UniButton
              variant="outline"
              size="md"
              :block="true"
              @click="handleDismissFailureModal"
            >
              Close
            </UniButton>
          </div>
        </div>
      </div>
    </ion-modal>

    <!-- CONFIRMED SUCCESS MODAL -->
    <ion-modal
      :is-open="isSuccessModalOpen"
      :backdrop-dismiss="false"
      class="blocking-process-modal"
    >
      <div class="blocking-modal-wrap">
        <div class="blocking-modal-card animate-fade-up">
          <div class="blocking-icon-box is-success">
            <ion-icon :icon="checkmarkCircle" class="success-icon" />
          </div>

          <div class="blocking-text-block">
            <h3 class="blocking-modal-title">
              {{ creationStatusTitle }}
            </h3>
            <p class="blocking-modal-desc">
              {{ creationStatusDesc }}
            </p>
          </div>

          <div class="blocking-meta-box font-mono">
            <div class="meta-row">
              <span class="meta-lbl">Contribution:</span>
              <span class="meta-val">{{ createdRuleRecord?.name || collectionName || 'Contribution Fee' }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-lbl">Target Semester:</span>
              <span class="meta-val">{{ selectedSemesterLabel }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-lbl">Assignment Scope:</span>
              <span class="meta-val">{{ targetAudienceLabel }}</span>
            </div>
            <template v-if="createdAssessResult">
              <div class="meta-row">
                <span class="meta-lbl">Assigned Students:</span>
                <span class="meta-val text-success font-bold">{{ createdAssessResult.totalAssigned }} students</span>
              </div>
              <div class="meta-row">
                <span class="meta-lbl">Collection Target:</span>
                <span class="meta-val text-primary font-bold">{{ formatPeso(createdAssessResult.totalCentavos) }}</span>
              </div>
            </template>
          </div>

          <div class="blocking-modal-actions">
            <UniButton
              variant="primary"
              size="md"
              :block="true"
              :icon="checkmarkCircle"
              @click="handleFinishCreationSuccess"
            >
              Done & View Collections
            </UniButton>
          </div>
        </div>
      </div>
    </ion-modal>

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

        <!-- Section Switcher: Collections vs Student Records -->
        <UniSegmentedControl
          v-model="activeSection"
          :options="sectionOptions"
          size="md"
          class="contributions-section-segmented"
        />

        <!-- ==================================================================== -->
        <!-- SECTION 1: CONTRIBUTION COLLECTIONS                                  -->
        <!-- ==================================================================== -->
        <template v-if="activeSection === 'COLLECTIONS'">
          <div class="section-toolbar-row">
            <div class="toolbar-title-wrap">
              <h3 class="section-title">Contribution Collections</h3>
              <p class="section-desc">Active fee drives, student assignments & progress</p>
            </div>
            <UniButton
              variant="primary"
              size="sm"
              :icon="addOutline"
              @click="openCreateContributionModal"
            >
              Create Contribution
            </UniButton>
          </div>

          <div v-if="isLoading && collections.length === 0" class="loading-state">
            <ion-spinner name="crescent" color="primary" />
            <p class="loading-text">Loading contribution collections...</p>
          </div>

          <div v-else-if="collections.length > 0" class="collections-grid">
            <div
              v-for="col in collections"
              :key="col.id"
              class="collection-card"
            >
              <div class="collection-header">
                <div class="header-main">
                  <span class="badge-mini badge-contrib">CONTRIBUTION</span>
                  <UniStatusBadge
                    :variant="col.status === 'COMPLETED' ? 'success' : col.status === 'ACTIVE' ? 'active' : 'neutral'"
                  >
                    {{ col.status }}
                  </UniStatusBadge>
                </div>
                <h4 class="collection-name">{{ col.name }}</h4>
              </div>

              <!-- Rate & Due Date -->
              <div class="collection-meta-row font-mono">
                <div class="meta-cell">
                  <span class="meta-label">Rate / Student</span>
                  <strong class="meta-val text-primary">{{ formatPeso(col.amountCentavos) }}</strong>
                </div>
                <div class="meta-cell">
                  <span class="meta-label">Due Date</span>
                  <span class="meta-val font-sans">{{ formatDueDate(col.dueDate) }}</span>
                </div>
                <div class="meta-cell">
                  <span class="meta-label">Assigned</span>
                  <span class="meta-val font-sans font-bold">{{ col.totalStudentsAssigned }} students</span>
                </div>
              </div>

              <!-- Progress bar -->
              <div class="collection-progress-wrap">
                <div class="progress-labels">
                  <span class="progress-caption">Collection Progress</span>
                  <strong class="progress-percent font-mono">
                    {{ col.totalStudentsAssigned > 0 ? Math.round((col.fullyPaidCount / col.totalStudentsAssigned) * 100) : 0 }}%
                  </strong>
                </div>
                <div class="progress-bar-bg">
                  <div
                    class="progress-bar-fill"
                    :style="{
                      width: `${col.totalStudentsAssigned > 0 ? Math.min(100, Math.round((col.fullyPaidCount / col.totalStudentsAssigned) * 100)) : 0}%`,
                    }"
                  />
                </div>
                <div class="progress-stats font-mono">
                  <span>Collected: <strong class="text-success">{{ formatPeso(col.totalCollectedCentavos) }}</strong></span>
                  <span>Target: {{ formatPeso(col.totalAssessedCentavos) }}</span>
                </div>
              </div>

              <!-- Compact Counts Breakdown -->
              <div class="status-pills-row font-mono">
                <span class="status-pill pill-paid">
                  <ion-icon :icon="checkmarkCircle" />
                  {{ col.fullyPaidCount }} Paid
                </span>
                <span class="status-pill pill-partial">
                  <ion-icon :icon="alertCircleOutline" />
                  {{ col.partialPaymentCount }} Partial
                </span>
                <span class="status-pill pill-unpaid">
                  <ion-icon :icon="closeCircleOutline" />
                  {{ col.unpaidCount }} Unpaid
                </span>
              </div>

              <!-- Card Action Buttons -->
              <div class="collection-card-actions">
                <UniButton
                  variant="primary"
                  size="sm"
                  :icon="cashOutline"
                  class="action-btn"
                  @click="navigateToPayment(col.ruleId)"
                >
                  Record Payment
                </UniButton>
                <UniButton
                  variant="outline"
                  size="sm"
                  :icon="listOutline"
                  class="action-btn"
                  @click="viewCollectionStudents(col)"
                >
                  View Students
                </UniButton>
                <UniButton
                  v-if="isDevAdmin"
                  variant="destructive"
                  size="sm"
                  :icon="trashOutline"
                  class="action-btn"
                  title="Delete Collection"
                  @click="promptDeleteCollection(col)"
                >
                  Delete
                </UniButton>
                <UniButton
                  variant="ghost"
                  size="sm"
                  :icon="informationCircleOutline"
                  class="action-btn-icon-only"
                  title="Collection Details"
                  @click="viewCollectionDetails(col)"
                />
              </div>
            </div>
          </div>

          <UniEmptyState
            v-else
            title="No Contribution Collections Created"
            description="Create your first contribution collection, set the fee and due date, and assign it to students in one straightforward step."
            :icon="walletOutline"
            action-text="Create Contribution"
            @action="openCreateContributionModal"
          />
        </template>

        <!-- ==================================================================== -->
        <!-- SECTION 2: STUDENT RECORDS                                           -->
        <!-- ==================================================================== -->
        <template v-else-if="activeSection === 'RECORDS'">
          <!-- Records Filter & Actions Bar -->
          <div class="toolbar-stack">
            <div class="toolbar-top-row">
              <ion-searchbar
                v-model="searchQuery"
                placeholder="Search student, ID, or contribution..."
                class="clean-searchbar"
                :debounce="200"
              />
              <UniButton
                variant="primary"
                size="sm"
                :icon="addOutline"
                @click="openCreateContributionModal"
              >
                New Collection
              </UniButton>
            </div>

            <!-- Collection & Status Filters -->
            <div class="filter-controls-row">
              <div class="collection-select-wrap">
                <UniSelect
                  v-model="filterCollectionId"
                  :options="collectionFilterOptions"
                  placeholder="Filter by Collection"
                  header="Filter by Collection"
                  presentation="action-sheet"
                />
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
            <p class="loading-text">Loading student contributions...</p>
          </div>

          <!-- Contributions Obligations List -->
          <div v-else-if="filteredContributions.length > 0" class="records-wrap">
            <UniRecordList :empty="false">
              <UniExpandableRow
                v-for="c in paginatedContributions"
                :key="c.id"
                :title="c.studentName || 'Student'"
                :subtitle="formatObligationAcademicSubtitle(c)"
                :badge="
                  isObligationOverdue(c)
                    ? 'Overdue'
                    : c.status === 'PAID'
                    ? 'Fully Paid'
                    : c.status === 'PARTIALLY_PAID'
                    ? 'Partial'
                    : formatObligationStatus(c.status)
                "
                :badge-variant="
                  isObligationOverdue(c)
                    ? 'danger'
                    : c.status === 'PAID'
                    ? 'success'
                    : c.status === 'PARTIALLY_PAID'
                    ? 'warning'
                    : 'neutral'
                "
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
                    <div class="detail-item">
                      <span class="detail-label">Due Date</span>
                      <span
                        class="detail-val font-sans"
                        :class="isObligationOverdue(c) ? 'text-danger font-bold' : ''"
                      >
                        {{ formatDueDate(c.dueDate) }}
                        {{ isObligationOverdue(c) ? '(Past Due)' : '' }}
                      </span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">Obligation Status</span>
                      <span class="detail-val font-bold">{{ c.status }}</span>
                    </div>
                  </div>

                  <!-- Actions inside row -->
                  <div class="row-actions-row">
                    <UniButton
                      v-if="c.status !== 'PAID' && c.status !== 'VOID'"
                      variant="primary"
                      size="sm"
                      :icon="cashOutline"
                      @click="navigateToPayment(c.ruleId || undefined, c.studentId)"
                    >
                      Record Payment
                    </UniButton>
                    <UniButton
                      v-if="c.status !== 'PAID' && c.status !== 'VOID'"
                      variant="outline"
                      size="sm"
                      class="void-action-btn"
                      @click="openVoidModal(c.id)"
                    >
                      Void / Waive Dues
                    </UniButton>
                    <UniButton
                      v-if="isDevAdmin && c.balanceCentavos === c.amountCentavos"
                      variant="destructive"
                      size="sm"
                      :icon="trashOutline"
                      class="void-action-btn"
                      @click="promptDeleteObligation(c)"
                    >
                      Delete Dues
                    </UniButton>
                  </div>
                </template>
              </UniExpandableRow>
            </UniRecordList>

            <!-- Pagination -->
            <UniPagination
              v-model:current-page="recordsPage"
              v-model:page-size="recordsPageSize"
              :total-items="filteredContributions.length"
              :disabled="isLoading"
              class="pagination-bar"
            />
          </div>

          <UniEmptyState
            v-else
            title="No Contribution Records Found"
            description="No student assessment records match your current filter criteria."
            :icon="walletOutline"
            action-text="Create Contribution"
            @action="openCreateContributionModal"
          />
        </template>
      </div>

      <!-- ==================================================================== -->
      <!-- MODAL A: Create Contribution Collection Sheet                        -->
      <!-- ==================================================================== -->
      <UniSheet
        :is-open="isCreateCollectionSheetOpen"
        title="Create Contribution Collection"
        @close="isCreateCollectionSheetOpen = false"
      >
        <div class="sheet-form">
          <p class="sheet-sub">
            Set contribution fee details and assign student obligations in one straightforward step.
          </p>

          <div class="form-group">
            <label class="form-label">Contribution Name <span class="req">*</span></label>
            <input
              v-model="collectionName"
              type="text"
              class="clean-input"
              placeholder="e.g. CSG 1st Semester Membership Fee, College T-Shirt"
            />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Amount per Student (PHP) <span class="req">*</span></label>
              <input
                v-model.number="collectionAmountPesos"
                type="number"
                min="1"
                step="10"
                class="clean-input font-mono"
              />
            </div>
            <div class="form-group">
              <label class="form-label">Due Date <span class="req">*</span></label>
              <input
                v-model="collectionDueDate"
                type="date"
                class="clean-input"
              />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Academic Period <span class="req">*</span></label>
            <UniSelect
              v-model="collectionSemesterId"
              :options="semesterOptions"
              placeholder="Select Academic Period"
              header="Academic Period"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Student Assignment <span class="req">*</span></label>
            <UniSelect
              v-model="collectionTargetScope"
              :options="scopeOptions"
              placeholder="Select Assignment Scope"
              header="Student Assignment"
              presentation="action-sheet"
            />
          </div>

          <!-- Scope: Program -->
          <div v-if="collectionTargetScope === 'PROGRAM'" class="form-group">
            <label class="form-label">Select Degree Program <span class="req">*</span></label>
            <UniSelect
              v-model="selectedProgramId"
              :options="programOptions"
              placeholder="Select Degree Program"
              header="Select Degree Program"
            />
          </div>

          <!-- Scope: Year Level -->
          <div v-if="collectionTargetScope === 'YEAR_LEVEL'" class="form-group">
            <label class="form-label">Select Year Level <span class="req">*</span></label>
            <UniSelect
              v-model="selectedYearLevel"
              :options="yearLevelOptions"
              placeholder="Select Year Level"
              header="Select Year Level"
              presentation="action-sheet"
            />
          </div>

          <!-- Scope: Section -->
          <div v-if="collectionTargetScope === 'SECTION'" class="form-group">
            <label class="form-label">Select Section <span class="req">*</span></label>
            <UniSelect
              v-model="selectedSection"
              :options="sectionOptionsList"
              placeholder="Select Section"
              header="Select Section"
            />
          </div>

          <!-- Scope: Individual Students -->
          <div v-if="collectionTargetScope === 'INDIVIDUAL'" class="form-group">
            <div class="student-select-header">
              <label class="form-label">Select Students ({{ selectedStudentIds.length }} chosen)</label>
              <div class="select-helpers">
                <button type="button" class="link-btn" @click="selectAllModalStudents">Select All</button>
                <span class="sep">•</span>
                <button type="button" class="link-btn" @click="clearModalStudentSelection">Clear</button>
              </div>
            </div>
            <input
              v-model="studentSearchInModal"
              type="text"
              class="clean-input student-search-input"
              placeholder="Filter student by name or ID..."
            />
            <div class="student-checkbox-list">
              <label
                v-for="s in filteredModalStudents"
                :key="s.id"
                class="student-checkbox-item"
              >
                <input
                  type="checkbox"
                  :checked="selectedStudentIds.includes(s.id)"
                  @change="toggleStudentSelection(s.id)"
                />
                <div class="student-info-col">
                  <span class="stu-name font-bold">{{ s.first_name }} {{ s.last_name }}</span>
                  <span class="stu-sub font-mono">{{ s.school_id || '—' }} • {{ formatStudentYearSection(s) }}</span>
                </div>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Notes / Remarks (Optional)</label>
            <input
              v-model="collectionNotes"
              type="text"
              class="clean-input"
              placeholder="e.g. Official receipt issued at College Office"
            />
          </div>

          <!-- Live Assignment Preview Box -->
          <div class="preview-box">
            <div class="preview-header">
              <ion-icon :icon="informationCircleOutline" class="preview-icon text-primary" />
              <span class="preview-title">Assignment Preview</span>
            </div>
            <div class="preview-row">
              <span>Target Audience:</span>
              <strong>{{ targetAudienceLabel }}</strong>
            </div>
            <div class="preview-row">
              <span>Eligible Students:</span>
              <strong class="font-mono">{{ estimatedStudentCount }} enrolled students</strong>
            </div>
            <div class="preview-row">
              <span>Amount per Student:</span>
              <strong class="font-mono">{{ formatPeso(pesoToCentavos(collectionAmountPesos || 0)) }}</strong>
            </div>
            <div class="preview-row">
              <span>Due Date:</span>
              <strong class="font-sans">{{ formatDueDate(collectionDueDate) }}</strong>
            </div>
            <div class="preview-divider"></div>
            <div class="preview-row total-row">
              <span>Expected Total Assessment:</span>
              <strong class="text-primary font-mono font-bold">{{ formatPeso(totalPreviewCentavos) }}</strong>
            </div>
          </div>

          <!-- Actions -->
          <div class="sheet-actions-row">
            <UniButton
              variant="outline"
              size="sm"
              @click="isCreateCollectionSheetOpen = false"
            >
              Cancel
            </UniButton>
            <UniButton
              variant="primary"
              size="sm"
              :disabled="isCreatingCollection || !collectionName.trim() || !collectionDueDate || estimatedStudentCount === 0"
              @click="() => handleCreateContribution()"
            >
              <ion-spinner v-if="isCreatingCollection" name="crescent" slot="start" />
              <span>{{ isCreatingCollection ? 'Creating Collection...' : 'Confirm & Create Collection' }}</span>
            </UniButton>
          </div>
        </div>
      </UniSheet>

      <!-- ==================================================================== -->
      <!-- MODAL B: Collection Details Sheet                                    -->
      <!-- ==================================================================== -->
      <UniSheet
        :is-open="isCollectionDetailsSheetOpen"
        title="Collection Details"
        @close="isCollectionDetailsSheetOpen = false"
      >
        <div v-if="selectedCollectionDetails" class="sheet-form">
          <div class="collection-details-hero">
            <span class="badge-mini badge-contrib">CONTRIBUTION COLLECTION</span>
            <h3 class="hero-name">{{ selectedCollectionDetails.name }}</h3>
            <UniStatusBadge
              :variant="selectedCollectionDetails.status === 'COMPLETED' ? 'success' : 'active'"
            >
              {{ selectedCollectionDetails.status }}
            </UniStatusBadge>
          </div>

          <div class="details-spec-grid font-mono">
            <div class="spec-row">
              <span class="spec-label">Rate / Student:</span>
              <strong class="spec-val text-primary">{{ formatPeso(selectedCollectionDetails.amountCentavos) }}</strong>
            </div>
            <div class="spec-row">
              <span class="spec-label">Due Date:</span>
              <span class="spec-val font-sans">{{ formatDueDate(selectedCollectionDetails.dueDate) }}</span>
            </div>
            <div class="spec-row">
              <span class="spec-label">Total Assigned Students:</span>
              <strong class="spec-val">{{ selectedCollectionDetails.totalStudentsAssigned }}</strong>
            </div>
            <div class="spec-row">
              <span class="spec-label">Fully Paid Students:</span>
              <strong class="spec-val text-success">{{ selectedCollectionDetails.fullyPaidCount }}</strong>
            </div>
            <div class="spec-row">
              <span class="spec-label">Partial Payments:</span>
              <strong class="spec-val text-warning">{{ selectedCollectionDetails.partialPaymentCount }}</strong>
            </div>
            <div class="spec-row">
              <span class="spec-label">Unpaid Students:</span>
              <strong class="spec-val text-danger">{{ selectedCollectionDetails.unpaidCount }}</strong>
            </div>
            <div class="spec-row">
              <span class="spec-label">Total Collected:</span>
              <strong class="spec-val text-success">{{ formatPeso(selectedCollectionDetails.totalCollectedCentavos) }}</strong>
            </div>
            <div class="spec-row">
              <span class="spec-label">Total Target:</span>
              <strong class="spec-val">{{ formatPeso(selectedCollectionDetails.totalAssessedCentavos) }}</strong>
            </div>
          </div>

          <div class="sheet-actions-row">
            <UniButton
              variant="outline"
              size="sm"
              :icon="listOutline"
              @click="
                isCollectionDetailsSheetOpen = false;
                viewCollectionStudents(selectedCollectionDetails);
              "
            >
              View Student Records
            </UniButton>
            <UniButton
              variant="primary"
              size="sm"
              :icon="cashOutline"
              @click="
                isCollectionDetailsSheetOpen = false;
                navigateToPayment(selectedCollectionDetails.ruleId);
              "
            >
              Record Payment
            </UniButton>
          </div>
        </div>
      </UniSheet>

      <!-- ==================================================================== -->
      <!-- MODAL C: Void Obligation Dialog                                      -->
      <!-- ==================================================================== -->
      <UniSheet
        :is-open="isVoidModalOpen"
        title="Void / Waive Contribution"
        @close="isVoidModalOpen = false"
      >
        <div class="sheet-form">
          <p class="sheet-sub">
            Voiding cancels the outstanding assessment balance. This operation is recorded in the official audit log.
          </p>

          <div class="form-group">
            <label class="form-label">Mandatory Reason <span class="req">*</span></label>
            <input
              v-model="voidReason"
              type="text"
              class="clean-input"
              placeholder="e.g. Granted exemption / Error in assessment"
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
      <!-- Delete Collection Dialog -->
      <UniDialog
        v-model:is-open="showDeleteCollectionDialog"
        title="Delete Contribution Collection?"
        :description="`Are you sure you want to permanently delete collection '${collectionToDelete?.name}'? If no payments have been collected, all student obligations under this rule will be deleted. If payments exist, deletion will be blocked.`"
        :confirm-text="isDeletingCollection ? 'Deleting...' : 'Delete Collection'"
        cancel-text="Cancel"
        :destructive="true"
        type="destructive"
        @confirm="confirmDeleteCollection"
        @cancel="showDeleteCollectionDialog = false"
      />

      <!-- Delete Individual Student Obligation Dialog -->
      <UniDialog
        v-model:is-open="showDeleteObligationDialog"
        title="Delete Student Obligation?"
        :description="`Are you sure you want to delete this obligation for ${obligationToDelete?.studentName} (${obligationToDelete?.title} - ${formatPeso(obligationToDelete?.amountCentavos || 0)})? If payments exist, deletion will be blocked.`"
        :confirm-text="isDeletingObligation ? 'Deleting...' : 'Delete Dues'"
        cancel-text="Cancel"
        :destructive="true"
        type="destructive"
        @confirm="confirmDeleteObligation"
        @cancel="showDeleteObligationDialog = false"
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

.alert-text strong {
  display: block;
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

.contributions-section-segmented {
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

/* Collections Grid & Cards */
.collections-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.collection-card {
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-card, 14px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--uni-shadow-card, 0 1px 3px rgba(0, 0, 0, 0.05));
  transition: all 0.15s ease;
}

.collection-card:hover {
  border-color: var(--uni-teal-primary, #0D9488);
}

.collection-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.header-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.badge-mini {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 6px;
  letter-spacing: 0.04em;
}

.badge-contrib {
  background: rgba(13, 148, 136, 0.12);
  color: var(--uni-teal-primary, #0D9488);
}

.collection-name {
  font-size: 15px;
  font-weight: 800;
  color: var(--uni-text);
  margin: 0;
  line-height: 1.3;
}

.collection-meta-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 11px;
}

.meta-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.meta-label {
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--uni-text-secondary);
}

.meta-val {
  font-size: 12px;
  color: var(--uni-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collection-progress-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.progress-labels {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.progress-caption {
  font-weight: 600;
  color: var(--uni-text-secondary);
}

.progress-percent {
  font-size: 12px;
  color: var(--uni-teal-primary, #0D9488);
}

.progress-bar-bg {
  width: 100%;
  height: 6px;
  border-radius: 9999px;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border-subtle);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  border-radius: 9999px;
  background: var(--uni-teal-primary, #0D9488);
  transition: width 0.3s ease;
}

.progress-stats {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--uni-text-secondary);
}

.status-pills-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
}

.pill-paid {
  background: rgba(16, 185, 129, 0.12);
  color: #10B981;
}

.pill-partial {
  background: rgba(245, 158, 11, 0.12);
  color: #F59E0B;
}

.pill-unpaid {
  background: var(--uni-surface-secondary);
  color: var(--uni-text-secondary);
  border: 1px solid var(--uni-border);
}

.collection-card-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  padding-top: 10px;
  border-top: 1px dashed var(--uni-border);
}

.action-btn {
  flex: 1;
}

.action-btn-icon-only {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  padding: 0;
}

/* Records Stack */
.toolbar-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toolbar-top-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-controls-row {
  display: flex;
  gap: 8px;
}

.collection-select-wrap {
  flex: 1;
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

.records-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.contrib-details-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  padding: 6px 0;
}

@media (min-width: 600px) {
  .contrib-details-grid {
    grid-template-columns: repeat(3, 1fr);
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

.row-actions-row {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--uni-border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.void-action-btn {
  --color: var(--uni-danger, #ef4444);
  --border-color: var(--uni-danger, #ef4444);
}

.loading-state {
  text-align: center;
  padding: 40px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.loading-text {
  font-size: 13px;
  color: var(--uni-text-secondary);
}

.sheet-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sheet-sub {
  font-size: 12.5px;
  color: var(--uni-text-secondary);
  margin: 0;
}

.req {
  color: var(--uni-danger);
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
  font-size: 12px;
  font-weight: 600;
  color: var(--uni-text);
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
  border-color: var(--uni-teal-primary, #0D9488);
}

/* Individual student select inside modal */
.student-select-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.select-helpers {
  display: flex;
  align-items: center;
  gap: 6px;
}

.link-btn {
  background: none;
  border: none;
  color: var(--uni-teal-primary, #0D9488);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.sep {
  color: var(--uni-text-secondary);
  font-size: 10px;
}

.student-search-input {
  font-size: 12.5px;
  padding: 6px 10px;
  margin-bottom: 4px;
}

.student-checkbox-list {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-card, 10px);
  background: var(--uni-surface-secondary);
  display: flex;
  flex-direction: column;
}

.student-checkbox-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--uni-border-subtle);
  cursor: pointer;
}

.student-checkbox-item:last-child {
  border-bottom: none;
}

.student-info-col {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.stu-name {
  font-size: 12px;
  color: var(--uni-text);
}

.stu-sub {
  font-size: 10.5px;
  color: var(--uni-text-secondary);
}

/* Preview Box */
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

.preview-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.preview-icon {
  font-size: 16px;
}

.preview-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--uni-text-secondary);
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

.sheet-actions-row {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}

.collection-details-hero {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--uni-border);
}

.hero-name {
  font-size: 17px;
  font-weight: 800;
  color: var(--uni-text);
  margin: 0;
}

.details-spec-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 10px;
  padding: 12px;
  font-size: 12.5px;
}

.spec-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.spec-label {
  color: var(--uni-text-secondary);
}

.spec-val {
  color: var(--uni-text);
}

/* Explicit Dark Mode Overrides */
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

:root.dark .collection-meta-row,
:root.ion-palette-dark .collection-meta-row,
body.dark .collection-meta-row,
body.ion-palette-dark .collection-meta-row,
:root.dark .student-checkbox-list,
:root.ion-palette-dark .student-checkbox-list,
body.dark .student-checkbox-list,
body.ion-palette-dark .student-checkbox-list {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #30343D);
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

.blocking-icon-box.is-success {
  background: rgba(16, 185, 129, 0.15);
  color: #10B981;
}

.blocking-icon-box.is-error {
  background: rgba(239, 68, 68, 0.15);
  color: #EF4444;
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

.success-icon {
  font-size: 32px;
  color: #10B981;
}

.error-icon {
  font-size: 32px;
  color: #EF4444;
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

.determinate-bar-fill {
  height: 100%;
  background: var(--uni-primary, #0F766E);
  border-radius: 999px;
  transition: width 0.3s ease;
}

:global(.dark) .indeterminate-bar-fill,
:global(.ion-palette-dark) .indeterminate-bar-fill {
  background: linear-gradient(90deg, #0D9488, #5EEAD4, #0D9488);
}

@keyframes indeterminate-loading {
  0% {
    left: -40%;
    width: 40%;
  }
  50% {
    left: 20%;
    width: 60%;
  }
  100% {
    left: 100%;
    width: 40%;
  }
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
  color: var(--uni-text-muted, #94A3B8);
}

.blocking-meta-box .meta-val {
  color: var(--uni-text-primary, #0F172A);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60%;
}

:global(.dark) .blocking-meta-box .meta-val,
:global(.ion-palette-dark) .blocking-meta-box .meta-val {
  color: var(--uni-text-primary, #F8FAFC);
}

.blocking-error-banner {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 11px;
  color: #EF4444;
  text-align: left;
  word-break: break-word;
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
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.text-amber {
  color: #D97706 !important;
}

.text-success {
  color: #10B981 !important;
}
</style>
