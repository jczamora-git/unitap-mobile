<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  IonSpinner,
  onIonViewWillEnter,
  onIonViewDidLeave,
} from '@ionic/vue';
import {
  radioOutline,
  checkmarkCircle,
  alertCircle,
  cashOutline,
  printOutline,
  arrowForwardOutline,
  closeCircleOutline,
  informationCircleOutline,
  walletOutline,
  cardOutline,
  searchOutline,
  stopCircleOutline,
  personOutline,
  refreshOutline,
} from 'ionicons/icons';
import { useNfc } from '@/composables/useNfc';
import { studentService } from '@/services/student.service';
import { financeService } from '@/services/finance.service';
import { authService } from '@/services/auth.service';
import StudentCard from '@/components/StudentCard.vue';
import type { Student } from '@/types/student';
import type {
  ObligationRuleItem,
  StudentObligationItem,
  PaymentReceipt,
  PaymentMethod,
} from '@/types/finance';
import { formatPeso, centavosToPeso, pesoToCentavos } from '@/utilities/finance-formatters';
import { formatFullName, formatYearLevel } from '@/utilities/student-formatters';
import {
  UniPageHeader,
  UniButton,
  UniCard,
  UniSheet,
  UniSelect,
  UniSegmentedControl,
  UniPagination,
  UniEmptyState,
  UniStatusBadge,
} from '@/components/ui';
import { useOperationPolicy } from '@/composables/useOperationPolicy';
import { haptics } from '@/utilities/haptics';
import { useToast } from '@/composables/useToast';

const router = useRouter();
const route = useRoute();
const { showToast } = useToast();
const { isPermitted, getDisabledReason } = useOperationPolicy();
const canRecordPayment = isPermitted('PAYMENT_POST_REVERSE_RECEIPT');
const paymentDisabledReason = getDisabledReason('PAYMENT_POST_REVERSE_RECEIPT');

// --- NFC Lifecycle ---
const {
  deviceStatus,
  isScanning,
  lastTag,
  scanError,
  startScan,
  stopScan,
  refreshStatus,
  resetLastTag,
} = useNfc();

// --- Student Identification Tabs ---
type IdentificationTab = 'nfc' | 'search';
const identificationTab = ref<IdentificationTab>('nfc');
const identificationTabs = [
  { value: 'nfc', label: 'Tap NFC Card' },
  { value: 'search', label: 'Find Student' },
];

// --- Eligible Students for Payment (Filtered by Category & Template) ---
const eligibleStudents = ref<Student[]>([]);
const isEligibleLoading = ref<boolean>(false);
const searchQuery = ref<string>('');
const searchCurrentPage = ref(1);
const searchPageSize = ref(5);

const filteredStudents = computed(() => {
  if (!searchQuery.value || !searchQuery.value.trim()) {
    return eligibleStudents.value;
  }
  const q = searchQuery.value.trim().toLowerCase();
  return eligibleStudents.value.filter((s) => {
    const numMatch = s.studentNumber?.toLowerCase().includes(q);
    const nameMatch = `${s.firstName} ${s.middleName || ''} ${s.lastName}`.toLowerCase().includes(q);
    const progMatch = s.course?.toLowerCase().includes(q);
    const secMatch = s.section?.toLowerCase().includes(q);
    return Boolean(numMatch || nameMatch || progMatch || secMatch);
  });
});

const paginatedStudents = computed(() => {
  const start = (searchCurrentPage.value - 1) * searchPageSize.value;
  return filteredStudents.value.slice(start, start + searchPageSize.value);
});

watch(searchQuery, () => {
  searchCurrentPage.value = 1;
});

async function loadEligibleStudents() {
  isEligibleLoading.value = true;
  try {
    const list = await financeService.getEligibleStudentsForPayment({
      category: selectedCategory.value,
      ruleId: selectedRuleId.value || undefined,
    });
    eligibleStudents.value = list;
    searchCurrentPage.value = 1;
  } catch (err) {
    console.error('Failed to load eligible students for payment:', err);
    eligibleStudents.value = [];
  } finally {
    isEligibleLoading.value = false;
  }
}

// --- Category & Templates (Rules) for Continuous Mode ---
export type PaymentCategory = 'ALL' | 'CONTRIBUTION' | 'FINE';
const selectedCategory = ref<PaymentCategory>('ALL');
const categoryOptions = [
  { value: 'ALL', label: 'All Obligations' },
  { value: 'CONTRIBUTION', label: 'Contributions' },
  { value: 'FINE', label: 'Fines' },
];

const activeTemplates = ref<ObligationRuleItem[]>([]);
const selectedRuleId = ref<string>('');
const selectedTemplate = computed(() =>
  activeTemplates.value.find((t) => t.id === selectedRuleId.value) || null
);

const filteredTemplates = computed(() => {
  if (selectedCategory.value === 'CONTRIBUTION') {
    return activeTemplates.value.filter((t) => t.type === 'CONTRIBUTION');
  }
  if (selectedCategory.value === 'FINE') {
    return activeTemplates.value.filter((t) => t.type === 'FINE');
  }
  return activeTemplates.value;
});

const templateOptions = computed(() => {
  let defaultLabel = '-- General Mode (All Student Obligations) --';
  if (selectedCategory.value === 'CONTRIBUTION') {
    defaultLabel = '-- General Mode (All Unsettled Contributions) --';
  } else if (selectedCategory.value === 'FINE') {
    defaultLabel = '-- General Mode (All Unsettled Fines) --';
  }

  return [
    { value: '', label: defaultLabel },
    ...filteredTemplates.value.map((t) => ({
      value: t.id,
      label: `[${t.type}] ${t.name} (Assessed: ${formatPeso(t.defaultAmountCentavos)})`,
    })),
  ];
});

// --- Selected Student State ---
const selectedStudentId = ref<string>('');
const selectedStudent = ref<Student | null>(null);
const identifiedViaNfc = ref(false);
const isCheckingCard = ref(false);

// --- Template-First Continuous Assessment State ---
const templateCheckResult = ref<{
  status: 'DUE' | 'PAID' | 'NO_OBLIGATION';
  obligation: StudentObligationItem | null;
} | null>(null);

// --- General Mode Fallback State ---
const outstandingObligations = ref<StudentObligationItem[]>([]);
const selectedObligationIds = ref<string[]>([]);
const paymentAmountsMap = ref<Record<string, number>>({});

const displayedOutstandingObligations = computed(() => {
  if (selectedCategory.value === 'ALL') {
    return outstandingObligations.value;
  }
  return outstandingObligations.value.filter((o) => o.type === selectedCategory.value);
});

// --- Payment Inputs ---
export type PaymentMethodChoice = 'CASH' | 'GCASH' | 'BANK_TRANSFER';
const paymentMethodChoice = ref<PaymentMethodChoice>('CASH');
const externalReferenceNumber = ref<string>('');
const paymentNotes = ref<string>('');
const singleAmountPesos = ref<number>(0);

const isProcessing = ref(false);
const errorMessage = ref('');
const completedReceipt = ref<PaymentReceipt | null>(null);
const isReceiptModalOpen = ref(false);

// Active attempt identifier preservation
const activeAttempt = ref<{
  paymentId: string;
  referenceNumber: string;
  idempotencyKey: string;
} | null>(null);

// --- Computeds ---
const isContinuousMode = computed(() => Boolean(selectedRuleId.value));

const continuousAmountCentavos = computed(() => {
  return Math.round(pesoToCentavos(singleAmountPesos.value || 0));
});

const continuousRemainingCentavos = computed(() => {
  const ob = templateCheckResult.value?.obligation;
  if (!ob) return 0;
  return Math.max(0, ob.balanceCentavos - continuousAmountCentavos.value);
});

const continuousPaymentStatus = computed<'FULL' | 'PARTIAL' | 'OVERPAYMENT' | 'INVALID'>(() => {
  const ob = templateCheckResult.value?.obligation;
  if (!ob) return 'INVALID';
  const pay = continuousAmountCentavos.value;
  if (pay <= 0) return 'INVALID';
  if (pay === ob.balanceCentavos) return 'FULL';
  if (pay < ob.balanceCentavos) return 'PARTIAL';
  return 'OVERPAYMENT';
});

export interface ObligationAllocationPreview {
  obligation: StudentObligationItem;
  outstandingBalanceCentavos: number;
  paymentAmountCentavos: number;
  remainingCentavos: number;
  status: 'FULL' | 'PARTIAL' | 'OVERPAYMENT' | 'INVALID';
}

const allocationPreviews = computed<ObligationAllocationPreview[]>(() => {
  if (isContinuousMode.value) {
    const ob = templateCheckResult.value?.obligation;
    if (!ob || templateCheckResult.value?.status !== 'DUE') return [];
    return [
      {
        obligation: ob,
        outstandingBalanceCentavos: ob.balanceCentavos,
        paymentAmountCentavos: continuousAmountCentavos.value,
        remainingCentavos: continuousRemainingCentavos.value,
        status: continuousPaymentStatus.value,
      },
    ];
  }

  return selectedObligationIds.value
    .map((id) => {
      const ob = outstandingObligations.value.find((o) => o.id === id);
      if (!ob) return null;
      const payCents = paymentAmountsMap.value[id] || 0;
      const remaining = Math.max(0, ob.balanceCentavos - payCents);
      let status: 'FULL' | 'PARTIAL' | 'OVERPAYMENT' | 'INVALID' = 'INVALID';
      if (payCents <= 0) status = 'INVALID';
      else if (payCents === ob.balanceCentavos) status = 'FULL';
      else if (payCents < ob.balanceCentavos) status = 'PARTIAL';
      else status = 'OVERPAYMENT';

      return {
        obligation: ob,
        outstandingBalanceCentavos: ob.balanceCentavos,
        paymentAmountCentavos: payCents,
        remainingCentavos: remaining,
        status,
      };
    })
    .filter(Boolean) as ObligationAllocationPreview[];
});

const canSubmitPayment = computed(() => {
  if (isProcessing.value || !selectedStudent.value || !canRecordPayment.value) return false;

  if (allocationPreviews.value.length === 0) return false;

  const allValid = allocationPreviews.value.every(
    (p) => p.status === 'FULL' || p.status === 'PARTIAL'
  );
  if (!allValid) return false;

  return totalSelectedToPay.value > 0;
});

const totalSelectedToPay = computed(() => {
  if (isContinuousMode.value) {
    return continuousAmountCentavos.value;
  }
  return selectedObligationIds.value.reduce((acc, id) => {
    return acc + (paymentAmountsMap.value[id] || 0);
  }, 0);
});

function getInitials(student: Student | null): string {
  if (!student) return 'ST';
  const f = student.firstName?.[0] || '';
  const l = student.lastName?.[0] || '';
  return (f + l).toUpperCase() || 'ST';
}

// --- Initial Data Loading ---
async function loadInitialData() {
  try {
    const templates = await financeService.getActiveTemplates();
    activeTemplates.value = templates;

    // Check query params for pre-selected template or student
    const queryCategory = route.query.category as string;
    if (queryCategory === 'CONTRIBUTION' || queryCategory === 'FINE' || queryCategory === 'ALL') {
      selectedCategory.value = queryCategory;
    }

    const queryTemplateId = (route.query.templateId || route.query.ruleId) as string;
    if (queryTemplateId) {
      const match = templates.find((t) => t.id === queryTemplateId);
      if (match) {
        selectedCategory.value = match.type === 'FINE' ? 'FINE' : 'CONTRIBUTION';
        selectedRuleId.value = queryTemplateId;
      }
    }

    await loadEligibleStudents();

    const queryStudentId = route.query.studentId as string;
    if (queryStudentId) {
      const student = await studentService.getStudent(queryStudentId);
      if (student) {
        selectedStudent.value = student;
        selectedStudentId.value = student.id;
        identifiedViaNfc.value = false;
        await onStudentSelected();
      }
    }
  } catch (err: any) {
    console.error('Error loading initial finance data:', err);
    errorMessage.value = err.message || 'Error loading finance data.';
  }
}

// --- Student Assessment Handler ---
async function onStudentSelected() {
  activeAttempt.value = null;
  errorMessage.value = '';

  if (!selectedStudentId.value) {
    templateCheckResult.value = null;
    outstandingObligations.value = [];
    selectedObligationIds.value = [];
    paymentAmountsMap.value = {};
    singleAmountPesos.value = 0;
    return;
  }

  try {
    if (isContinuousMode.value) {
      const res = await financeService.checkStudentObligationForTemplate(
        selectedStudentId.value,
        selectedRuleId.value
      );
      templateCheckResult.value = res;

      if (res.status === 'DUE' && res.obligation) {
        singleAmountPesos.value = centavosToPeso(res.obligation.balanceCentavos);
        haptics.success();
      } else {
        singleAmountPesos.value = 0;
        haptics.warning();
      }
    } else {
      const list = await financeService.getStudentObligations(selectedStudentId.value);
      outstandingObligations.value = list.filter((o) => o.balanceCentavos > 0 && o.status !== 'VOID');
      selectedObligationIds.value = [];
      paymentAmountsMap.value = {};

      if (displayedOutstandingObligations.value.length > 0) {
        const first = displayedOutstandingObligations.value[0];
        selectedObligationIds.value = [first.id];
        paymentAmountsMap.value[first.id] = first.balanceCentavos;
      }
    }
  } catch (err: any) {
    console.error('Error checking student obligations:', err);
    errorMessage.value = err.message || 'Error evaluating student obligation.';
  }
}

watch(selectedRuleId, () => {
  loadEligibleStudents();
  if (selectedStudentId.value) {
    onStudentSelected();
  }
});

watch(selectedCategory, () => {
  if (selectedRuleId.value) {
    const stillValid = filteredTemplates.value.some((t) => t.id === selectedRuleId.value);
    if (!stillValid) {
      selectedRuleId.value = '';
    }
  }
  loadEligibleStudents();
  if (selectedStudentId.value) {
    onStudentSelected();
  }
});

watch(selectedStudentId, () => {
  onStudentSelected();
});

// --- Tab Switching Lifecycle ---
watch(identificationTab, async (newTab) => {
  haptics.light();
  if (newTab === 'nfc') {
    if (deviceStatus.value.supported && deviceStatus.value.enabled && !isScanning.value && !selectedStudent.value) {
      await startScan();
    }
  } else {
    // In search tab, pause active NFC scanning and refresh eligible list
    if (isScanning.value) {
      await stopScan();
    }
    await loadEligibleStudents();
  }
});

// --- NFC Card Tap Listener (Reuses studentService.lookupCard) ---
watch(lastTag, async (tag) => {
  if (!tag?.id || isCheckingCard.value || selectedStudent.value) return;
  isCheckingCard.value = true;
  haptics.medium();

  try {
    const lookup = await studentService.lookupCard(tag.id);
    if (lookup.status === 'ACTIVE' && lookup.student) {
      selectedStudent.value = lookup.student;
      selectedStudentId.value = lookup.student.id;
      identifiedViaNfc.value = true;
      errorMessage.value = '';
      haptics.success();
    } else if (lookup.status === 'UNREGISTERED') {
      errorMessage.value = `Unregistered card (${tag.compactId || tag.id}). Please register card or select student manually via Find Student.`;
      haptics.warning();
    } else {
      errorMessage.value = `Card status: ${lookup.status}. Student record not active.`;
      haptics.warning();
    }
  } catch (err: any) {
    console.error('Failed to resolve NFC card:', err);
    errorMessage.value = err.message || 'Failed to resolve NFC card.';
    haptics.error();
  } finally {
    isCheckingCard.value = false;
  }
});

async function handleToggleScanner() {
  haptics.light();
  if (isScanning.value) {
    await stopScan();
  } else {
    resetLastTag();
    await startScan();
  }
}

// --- Manual Student Selection from Search Tab ---
function handleSelectStudent(student: Student) {
  haptics.medium();
  selectedStudent.value = student;
  selectedStudentId.value = student.id;
  identifiedViaNfc.value = false;
  errorMessage.value = '';
}

function handleClearStudent() {
  haptics.light();
  selectedStudent.value = null;
  selectedStudentId.value = '';
  identifiedViaNfc.value = false;
  templateCheckResult.value = null;
  singleAmountPesos.value = 0;
  errorMessage.value = '';
  activeAttempt.value = null;
  resetLastTag();

  if (identificationTab.value === 'nfc' && deviceStatus.value.enabled && !isScanning.value) {
    startScan();
  }
}

function generateClientUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// --- General Mode Toggles ---
function toggleObligation(ob: StudentObligationItem) {
  haptics.light();
  activeAttempt.value = null;
  const idx = selectedObligationIds.value.indexOf(ob.id);
  if (idx >= 0) {
    selectedObligationIds.value.splice(idx, 1);
    delete paymentAmountsMap.value[ob.id];
  } else {
    selectedObligationIds.value.push(ob.id);
    paymentAmountsMap.value[ob.id] = ob.balanceCentavos;
  }
}

function setPaymentAmount(obId: string, pesos: number) {
  activeAttempt.value = null;
  const num = typeof pesos === 'number' && !isNaN(pesos) ? pesos : 0;
  const cents = Math.round(pesoToCentavos(num));
  const ob = outstandingObligations.value.find((o) => o.id === obId);
  const max = ob ? ob.balanceCentavos : cents;
  paymentAmountsMap.value[obId] = Math.max(0, Math.min(cents, max));
}

function setFullPayment(obId?: string) {
  haptics.light();
  activeAttempt.value = null;
  if (isContinuousMode.value) {
    if (templateCheckResult.value?.obligation) {
      singleAmountPesos.value = centavosToPeso(templateCheckResult.value.obligation.balanceCentavos);
    }
  } else if (obId) {
    const ob = outstandingObligations.value.find((o) => o.id === obId);
    if (ob) {
      paymentAmountsMap.value[obId] = ob.balanceCentavos;
    }
  }
}

// --- Payment Confirmation (Strictly Server-Confirmed RPC) ---
async function handleConfirmPayment() {
  if (!selectedStudentId.value) {
    errorMessage.value = 'Please select or tap a student.';
    return;
  }
  if (!canRecordPayment.value) {
    errorMessage.value = paymentDisabledReason.value || 'Payment recording requires an active internet connection.';
    return;
  }

  let allocations: { obligationId: string; amountCentavos: number }[] = [];
  let semesterId = 'sem_default';

  if (isContinuousMode.value) {
    const ob = templateCheckResult.value?.obligation;
    if (!ob || templateCheckResult.value?.status !== 'DUE') {
      errorMessage.value = 'Student does not have an outstanding balance for this template.';
      return;
    }
    const cents = Math.round(pesoToCentavos(singleAmountPesos.value));
    if (cents <= 0) {
      errorMessage.value = 'Payment amount must be greater than zero.';
      return;
    }
    if (cents > ob.balanceCentavos) {
      errorMessage.value = `Amount exceeds remaining balance of ${formatPeso(ob.balanceCentavos)}.`;
      return;
    }
    allocations = [{ obligationId: ob.id, amountCentavos: cents }];
    semesterId = ob.semesterId;
  } else {
    allocations = selectedObligationIds.value
      .map((id) => ({
        obligationId: id,
        amountCentavos: paymentAmountsMap.value[id] || 0,
      }))
      .filter((a) => a.amountCentavos > 0);

    if (allocations.length === 0 || totalSelectedToPay.value <= 0) {
      errorMessage.value = 'Please select at least one obligation to pay.';
      return;
    }
    const firstOb = outstandingObligations.value.find((o) => o.id === selectedObligationIds.value[0]);
    semesterId = firstOb?.semesterId || 'sem_default';
  }

  isProcessing.value = true;
  errorMessage.value = '';

  try {
    if (!activeAttempt.value) {
      const paymentId = generateClientUuid();
      activeAttempt.value = {
        paymentId,
        referenceNumber: 'PAY-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase(),
        idempotencyKey: 'idemp_' + paymentId,
      };
    }

    const source: PaymentMethod = paymentMethodChoice.value === 'CASH' ? 'CASH' : 'MANUAL_TRANSFER_RECORD';
    let combinedNotes = paymentNotes.value.trim();
    if (paymentMethodChoice.value === 'GCASH') {
      const refTag = externalReferenceNumber.value.trim() ? `[GCash Ref: ${externalReferenceNumber.value.trim()}]` : '[GCash Transfer]';
      combinedNotes = combinedNotes ? `${refTag} ${combinedNotes}` : refTag;
    } else if (paymentMethodChoice.value === 'BANK_TRANSFER') {
      const refTag = externalReferenceNumber.value.trim() ? `[Bank Transfer Ref: ${externalReferenceNumber.value.trim()}]` : '[Bank Transfer]';
      combinedNotes = combinedNotes ? `${refTag} ${combinedNotes}` : refTag;
    }

    const result = await financeService.recordPayment({
      studentId: selectedStudentId.value,
      semesterId,
      amountCentavos: totalSelectedToPay.value,
      source,
      channel: identifiedViaNfc.value ? 'NFC' : 'MANUAL',
      allocations,
      notes: combinedNotes || undefined,
      actorUserId: authService.user.value?.id || 'officer_user',
      paymentId: activeAttempt.value.paymentId,
      referenceNumber: activeAttempt.value.referenceNumber,
      idempotencyKey: activeAttempt.value.idempotencyKey,
    });

    haptics.success();
    await showToast('Payment successfully recorded', 'success');
    activeAttempt.value = null;

    completedReceipt.value = await financeService.generatePaymentReceipt(
      result.paymentId,
      authService.user.value?.username || 'Authorized Officer'
    );
    isReceiptModalOpen.value = true;

    await onStudentSelected();
    await loadEligibleStudents();
  } catch (err: any) {
    console.error('Payment recording failed:', err);
    errorMessage.value = err.message || 'Payment recording failed.';
    haptics.error();
  } finally {
    isProcessing.value = false;
  }
}

// --- Continuous Next Student Action ---
function handleNextStudent() {
  haptics.light();
  isReceiptModalOpen.value = false;
  completedReceipt.value = null;

  handleClearStudent();
  identificationTab.value = 'nfc';

  if (deviceStatus.value.supported && deviceStatus.value.enabled && !isScanning.value) {
    startScan();
  }
}

function handleDone() {
  isReceiptModalOpen.value = false;
  router.push('/tabs/finance');
}

function printReceipt() {
  if (!completedReceipt.value) return;
  const html = financeService.generatePrintableReceiptHtml(completedReceipt.value);
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }
}

onMounted(() => {
  loadInitialData();
  refreshStatus();
});

onIonViewWillEnter(() => {
  loadInitialData();
  if (deviceStatus.value.supported && deviceStatus.value.enabled && identificationTab.value === 'nfc' && !selectedStudent.value) {
    startScan();
  }
});

onIonViewDidLeave(() => {
  searchQuery.value = '';
  stopScan();
});
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Record Payment"
      subtitle="Continuous NFC collection & receipt recording"
      :back-button="true"
      default-back-href="/tabs/finance"
      variant="detail"
    />

    <ion-content class="safe-content non-tab-content">
      <div class="page-container">
        <!-- Error Alert Banner -->
        <div v-if="errorMessage" class="error-banner">
          <ion-icon :icon="alertCircle" class="error-icon" />
          <span>{{ errorMessage }}</span>
        </div>

        <!-- STEP 1: Payment Template Selection (Continuous Scanning Anchor) -->
        <UniCard padding="md">
          <div class="card-header-row">
            <h3 class="step-title">1. Payment Category & Template</h3>
            <span v-if="isContinuousMode" class="badge-mini badge-success continuous-badge">
              <span class="live-dot" /> Continuous Mode
            </span>
            <span v-else class="badge-mini badge-neutral">
              General Mode
            </span>
          </div>

          <p class="section-description">
            Filter by category or choose an obligation template to keep active across consecutive student scans.
          </p>

          <!-- Category Segmented Control -->
          <div class="form-group" style="margin-bottom: 12px;">
            <label class="field-label">Category</label>
            <UniSegmentedControl
              v-model="selectedCategory"
              :options="categoryOptions"
              size="sm"
            />
          </div>

          <div class="form-group">
            <label class="field-label">Active Template (Continuous Mode)</label>
            <UniSelect
              v-model="selectedRuleId"
              :options="templateOptions"
              placeholder="-- Select Payment Template --"
              header="Select Template"
            />
          </div>

          <!-- Active Template Summary Card -->
          <div v-if="selectedTemplate" class="active-template-card">
            <div class="template-header">
              <span class="badge-mini" :class="selectedTemplate.type === 'FINE' ? 'badge-danger' : 'badge-primary'">
                {{ selectedTemplate.type }}
              </span>
              <span class="template-name font-bold">{{ selectedTemplate.name }}</span>
            </div>
            <div class="template-meta-row font-mono">
              <span>Standard Amount: <strong>{{ formatPeso(selectedTemplate.defaultAmountCentavos) }}</strong></span>
              <span class="template-hint">Template locked for consecutive student taps</span>
            </div>
          </div>
        </UniCard>

        <!-- STEP 2: Student Identification (Tabs: Tap NFC vs Find Student) -->
        <UniCard padding="md">
          <div class="card-header-row">
            <h3 class="step-title">2. Identify Student</h3>
            <span v-if="selectedStudent && identifiedViaNfc" class="badge-mini badge-success">
              NFC Linked
            </span>
            <span v-else-if="selectedStudent" class="badge-mini badge-neutral">
              Manual Search
            </span>
          </div>

          <!-- A. Selected Student Profile Banner -->
          <div v-if="selectedStudent" class="selected-student-banner">
            <div class="student-avatar-circle">
              {{ getInitials(selectedStudent) }}
            </div>
            <div class="student-details-wrap">
              <div class="student-header-line">
                <h4 class="student-full-name">
                  {{ formatFullName(selectedStudent.firstName, selectedStudent.middleName, selectedStudent.lastName) }}
                </h4>
                <UniStatusBadge :variant="identifiedViaNfc ? 'active' : 'neutral'" :pulse="identifiedViaNfc">
                  {{ identifiedViaNfc ? 'NFC Linked' : 'Manual Search' }}
                </UniStatusBadge>
              </div>
              <div class="student-meta-line font-mono">
                <span>{{ selectedStudent.studentNumber || selectedStudent.id }}</span>
                <span class="meta-dot">•</span>
                <span>{{ formatYearLevel(selectedStudent.yearLevel) }} - Sec {{ selectedStudent.section }}</span>
              </div>
            </div>
            <button class="change-student-btn font-sans" @click="handleClearStudent" title="Change or rescan student">
              Change
            </button>
          </div>

          <!-- B. Unselected: Show Two Tabs (Tap NFC & Find Student) -->
          <div v-else class="identification-flow">
            <UniSegmentedControl
              v-model="identificationTab"
              :options="identificationTabs"
              size="md"
              class="id-tab-control"
            />

            <!-- TAB 1: TAP NFC (Reuses NFC Checker Surface Card) -->
            <div v-if="identificationTab === 'nfc'" class="scanner-surface-card">
              <div
                class="nfc-halo-container"
                :class="{ 'is-active': isScanning && !isCheckingCard, 'is-checking': isCheckingCard }"
              >
                <div class="nfc-pulse-ring" />
                <div class="nfc-halo-core">
                  <ion-icon :icon="radioOutline" class="nfc-core-icon" />
                </div>
              </div>

              <div class="scanner-text-block">
                <h3 class="scanner-status-title">
                  <template v-if="isCheckingCard">Checking Card...</template>
                  <template v-else-if="isScanning">Ready to Tap</template>
                  <template v-else>Scanner Idle</template>
                </h3>
                <p class="scanner-instruction-text">
                  <template v-if="isCheckingCard">Searching student records locally...</template>
                  <template v-else-if="isScanning">Hold an NFC student ID card to the back of this device.</template>
                  <template v-else>Tap start to activate the NFC reader.</template>
                </p>
              </div>

              <div class="scanner-controls-row">
                <UniButton
                  :variant="isScanning ? 'outline' : 'primary'"
                  size="sm"
                  :icon="isScanning ? stopCircleOutline : radioOutline"
                  @click="handleToggleScanner"
                >
                  {{ isScanning ? 'Stop Scanner' : 'Start Scanner' }}
                </UniButton>
              </div>
            </div>

            <!-- TAB 2: FIND STUDENT (Reuses StudentCard & UniPagination) -->
            <div v-else-if="identificationTab === 'search'" class="find-student-section">
              <!-- Compact Search Bar -->
              <div class="custom-search-input-wrap">
                <ion-icon :icon="searchOutline" class="search-lead-icon" />
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="Search student name, school ID, or section..."
                  class="clean-search-input"
                />
                <button
                  v-if="searchQuery"
                  type="button"
                  class="clear-search-btn"
                  @click="searchQuery = ''"
                >
                  <ion-icon :icon="closeCircleOutline" />
                </button>
              </div>

              <!-- Counter Bar -->
              <div class="count-row">
                <span class="count-text font-mono">
                  {{ filteredStudents.length }} {{ filteredStudents.length === 1 ? 'student found' : 'students found' }}
                </span>
                <span v-if="searchQuery" class="filtered-badge">Filtered</span>
              </div>

              <!-- Loading State -->
              <div v-if="isEligibleLoading && eligibleStudents.length === 0" class="loading-state">
                <ion-spinner name="crescent" color="primary" />
                <span class="loading-text">Loading eligible students...</span>
              </div>

              <!-- Empty State: Filter Returned No Match -->
              <UniEmptyState
                v-else-if="filteredStudents.length === 0"
                :icon="searchOutline"
                :title="searchQuery ? 'No matching students' : 'No Outstanding Balances'"
                :description="
                  searchQuery
                    ? 'No student matches your search query. Try searching by student number, last name, or section.'
                    : selectedTemplate
                    ? `No students currently owe payments for &quot;${selectedTemplate.name}&quot;. All obligations are settled.`
                    : selectedCategory === 'CONTRIBUTION'
                    ? 'No students currently have unsettled contributions.'
                    : selectedCategory === 'FINE'
                    ? 'No students currently have unsettled fines.'
                    : 'No students currently have unsettled obligations in this term.'
                "
                :action-text="searchQuery ? 'Clear Search' : undefined"
                @action="searchQuery = ''"
              />

              <!-- Paginated Matching Student Cards -->
              <div v-else class="matching-students-list">
                <StudentCard
                  v-for="student in paginatedStudents"
                  :key="student.id"
                  :student="student"
                  @click="handleSelectStudent"
                />

                <UniPagination
                  v-model:current-page="searchCurrentPage"
                  v-model:page-size="searchPageSize"
                  :total-items="filteredStudents.length"
                  :page-size-options="[5, 10, 20]"
                />
              </div>
            </div>
          </div>
        </UniCard>

        <!-- STEP 3: Obligation Assessment (Template-First Mode) -->
        <UniCard v-if="selectedStudent && isContinuousMode" padding="md">
          <div class="card-header-row">
            <h3 class="step-title">3. Obligation Assessment</h3>
            <span v-if="templateCheckResult?.status === 'PAID'" class="badge-mini badge-success">
              Already Settled
            </span>
            <span v-else-if="templateCheckResult?.status === 'DUE'" class="badge-mini badge-warning font-mono">
              Balance Due: {{ formatPeso(templateCheckResult.obligation?.balanceCentavos || 0) }}
            </span>
            <span v-else-if="templateCheckResult?.status === 'NO_OBLIGATION'" class="badge-mini badge-neutral">
              Not Assessed
            </span>
          </div>

          <!-- CASE A: Student has already paid -->
          <div v-if="templateCheckResult?.status === 'PAID'" class="status-box status-settled">
            <ion-icon :icon="checkmarkCircle" class="status-box-icon text-success" />
            <div class="status-box-content">
              <h4 class="status-box-title">Student Has Already Settled This Obligation</h4>
              <p class="status-box-desc">
                {{ templateCheckResult.obligation?.title }} has a remaining balance of <strong>₱0.00</strong>. No additional payment is required.
              </p>
            </div>
            <div class="status-action-row">
              <UniButton variant="outline" size="sm" @click="handleNextStudent">
                <ion-icon :icon="arrowForwardOutline" slot="start" />
                <span>Next Student Tap</span>
              </UniButton>
            </div>
          </div>

          <!-- CASE B: Student has no obligation for this template -->
          <div v-else-if="templateCheckResult?.status === 'NO_OBLIGATION'" class="status-box status-none">
            <ion-icon :icon="informationCircleOutline" class="status-box-icon text-warning" />
            <div class="status-box-content">
              <h4 class="status-box-title">No Obligation Assessed</h4>
              <p class="status-box-desc">
                This student does not have an active <strong>{{ selectedTemplate?.name }}</strong> obligation assessed on their account.
              </p>
            </div>
            <div class="status-action-row">
              <UniButton variant="outline" size="sm" @click="handleNextStudent">
                <ion-icon :icon="arrowForwardOutline" slot="start" />
                <span>Next Student Tap</span>
              </UniButton>
            </div>
          </div>

          <!-- CASE C: Payment is DUE -->
          <div v-else-if="templateCheckResult?.status === 'DUE' && templateCheckResult.obligation" class="status-box status-due">
            <div class="obligation-details-grid font-mono">
              <div class="ob-row">
                <span class="ob-label">Obligation:</span>
                <strong class="ob-val">{{ templateCheckResult.obligation.title }}</strong>
              </div>
              <div class="ob-row">
                <span class="ob-label">Total Assessed:</span>
                <span class="ob-val">{{ formatPeso(templateCheckResult.obligation.amountCentavos) }}</span>
              </div>
              <div class="ob-row">
                <span class="ob-label">Previously Paid:</span>
                <span class="ob-val text-success">{{ formatPeso(templateCheckResult.obligation.paidCentavos) }}</span>
              </div>
              <div class="ob-row ob-row-highlight">
                <span class="ob-label">Outstanding Balance:</span>
                <strong class="ob-val text-danger">{{ formatPeso(templateCheckResult.obligation.balanceCentavos) }}</strong>
              </div>
            </div>
          </div>
        </UniCard>

        <!-- General Mode: Multi-Obligation Selection Fallback -->
        <UniCard v-else-if="selectedStudent && !isContinuousMode" padding="md">
          <div class="card-header-row">
            <h3 class="step-title">3. Select Obligations to Settle</h3>
            <span class="badge-mini badge-neutral font-mono">
              {{ displayedOutstandingObligations.length }} {{ selectedCategory === 'ALL' ? 'Unpaid' : selectedCategory === 'CONTRIBUTION' ? 'Contributions' : 'Fines' }}
            </span>
          </div>

          <div v-if="displayedOutstandingObligations.length > 0" class="obligations-list">
            <div
              v-for="ob in displayedOutstandingObligations"
              :key="ob.id"
              class="obligation-item"
              :class="{ 'is-selected': selectedObligationIds.includes(ob.id) }"
              @click="toggleObligation(ob)"
            >
              <div class="ob-left">
                <input
                  type="checkbox"
                  :checked="selectedObligationIds.includes(ob.id)"
                  class="uni-checkbox"
                  @click.stop="toggleObligation(ob)"
                />
                <div class="ob-info">
                  <span class="ob-title font-bold">{{ ob.title }}</span>
                  <span class="ob-meta">
                    <span class="badge-mini" :class="ob.type === 'FINE' ? 'badge-danger' : 'badge-primary'">
                      {{ ob.type }}
                    </span>
                    <span class="meta-date">Issued: {{ new Date(ob.issuedAt).toLocaleDateString() }}</span>
                  </span>
                </div>
              </div>

              <div class="ob-right font-mono" @click.stop>
                <span class="rem-label">Balance: <strong>{{ formatPeso(ob.balanceCentavos) }}</strong></span>
                <span v-if="selectedObligationIds.includes(ob.id)" class="badge-mini badge-success">Selected</span>
                <span v-else class="badge-mini badge-neutral">Tap to Select</span>
              </div>
            </div>
          </div>

          <div v-else class="empty-state-inline">
            <ion-icon :icon="checkmarkCircle" class="text-success text-2xl" />
            <p>
              {{ selectedCategory === 'ALL' ? 'Student is fully clear. No outstanding fines or contributions.' : selectedCategory === 'CONTRIBUTION' ? 'No outstanding contributions for this student.' : 'No outstanding fines for this student.' }}
            </p>
          </div>
        </UniCard>

        <!-- STEP 4: Payment Entry & Settlement Preview -->
        <UniCard
          v-if="selectedStudent && ((isContinuousMode && templateCheckResult?.status === 'DUE') || (!isContinuousMode && selectedObligationIds.length > 0))"
          padding="md"
        >
          <div class="card-header-row">
            <h3 class="step-title">4. Payment & Settlement Preview</h3>
            <span class="badge-mini badge-neutral font-mono">
              {{ allocationPreviews.length }} {{ allocationPreviews.length === 1 ? 'Obligation' : 'Obligations' }}
            </span>
          </div>

          <!-- Allocation Previews Breakdown -->
          <div class="allocation-previews-list">
            <div
              v-for="p in allocationPreviews"
              :key="p.obligation.id"
              class="allocation-preview-card"
            >
              <div class="preview-header">
                <div class="preview-title-wrap">
                  <span class="preview-title font-bold">{{ p.obligation.title }}</span>
                  <span class="badge-mini" :class="p.obligation.type === 'FINE' ? 'badge-danger' : 'badge-primary'">
                    {{ p.obligation.type }}
                  </span>
                </div>
                <span
                  class="badge-mini"
                  :class="{
                    'badge-success': p.status === 'FULL',
                    'badge-warning': p.status === 'PARTIAL',
                    'badge-danger': p.status === 'OVERPAYMENT',
                    'badge-neutral': p.status === 'INVALID'
                  }"
                >
                  <template v-if="p.status === 'FULL'">Full Payment</template>
                  <template v-else-if="p.status === 'PARTIAL'">Partial Payment</template>
                  <template v-else-if="p.status === 'OVERPAYMENT'">Overpayment</template>
                  <template v-else>Invalid Amount</template>
                </span>
              </div>

              <div class="preview-grid font-mono">
                <div class="preview-row">
                  <span class="preview-label">Outstanding Balance:</span>
                  <strong class="preview-val text-danger">{{ formatPeso(p.outstandingBalanceCentavos) }}</strong>
                </div>

                <div class="preview-row preview-input-row">
                  <span class="preview-label">Payment Amount:</span>
                  <div class="preview-input-wrap">
                    <span class="currency-prefix">₱</span>
                    <input
                      v-if="isContinuousMode"
                      v-model.number="singleAmountPesos"
                      type="number"
                      min="1"
                      :max="centavosToPeso(p.outstandingBalanceCentavos)"
                      step="0.01"
                      class="clean-input-inline preview-number-input"
                    />
                    <input
                      v-else
                      type="number"
                      min="1"
                      :max="centavosToPeso(p.outstandingBalanceCentavos)"
                      step="0.01"
                      :value="centavosToPeso(paymentAmountsMap[p.obligation.id] || 0)"
                      class="clean-input-inline preview-number-input"
                      @input="setPaymentAmount(p.obligation.id, +($event.target as HTMLInputElement).value)"
                    />
                    <button
                      class="full-btn font-sans"
                      type="button"
                      @click="setFullPayment(p.obligation.id)"
                    >
                      Full
                    </button>
                  </div>
                </div>

                <div class="preview-row preview-remaining-row">
                  <span class="preview-label">Remaining After Payment:</span>
                  <strong
                    class="preview-val"
                    :class="p.remainingCentavos === 0 ? 'text-success' : 'text-warning'"
                  >
                    {{ formatPeso(p.remainingCentavos) }}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          <div class="preview-estimate-disclaimer font-sans">
            Payment preview is estimated. Official settlement is confirmed upon server receipt.
          </div>

          <!-- Payment Method: Cash, GCash, Bank Transfer -->
          <div class="form-group" style="margin-top: 14px;">
            <label class="field-label">Payment Method</label>
            <div class="method-options-3">
              <label class="method-label" :class="{ active: paymentMethodChoice === 'CASH' }">
                <input type="radio" v-model="paymentMethodChoice" value="CASH" />
                <ion-icon :icon="cashOutline" class="method-icon" />
                <span>Cash</span>
              </label>
              <label class="method-label" :class="{ active: paymentMethodChoice === 'GCASH' }">
                <input type="radio" v-model="paymentMethodChoice" value="GCASH" />
                <ion-icon :icon="walletOutline" class="method-icon" />
                <span>GCash</span>
              </label>
              <label class="method-label" :class="{ active: paymentMethodChoice === 'BANK_TRANSFER' }">
                <input type="radio" v-model="paymentMethodChoice" value="BANK_TRANSFER" />
                <ion-icon :icon="cardOutline" class="method-icon" />
                <span>Bank Transfer</span>
              </label>
            </div>
          </div>

          <!-- Electronic Reference Number Input -->
          <div v-if="paymentMethodChoice !== 'CASH'" class="form-group" style="margin-top: 12px;">
            <label class="field-label">
              {{ paymentMethodChoice === 'GCASH' ? 'GCash Reference Number (Optional)' : 'Bank Transfer Reference Number (Optional)' }}
            </label>
            <input
              v-model="externalReferenceNumber"
              type="text"
              :placeholder="paymentMethodChoice === 'GCASH' ? 'e.g. 100293847581' : 'e.g. BDO-9823471'"
              class="clean-input font-mono"
            />
          </div>

          <!-- Official Notes -->
          <div class="form-group" style="margin-top: 12px;">
            <label class="field-label">Official Notes (Optional)</label>
            <input
              v-model="paymentNotes"
              type="text"
              placeholder="e.g. Received at student assembly desk"
              class="clean-input"
            />
          </div>

          <!-- Settlement Summary Banner -->
          <div class="settlement-banner">
            <div class="banner-text">
              <span class="banner-sub font-mono">
                {{ isContinuousMode ? '1 obligation' : `${selectedObligationIds.length} obligations` }}
              </span>
              <span class="banner-main">Total Payment Received:</span>
            </div>
            <span class="banner-figure font-mono font-bold">{{ formatPeso(totalSelectedToPay) }}</span>
          </div>

          <!-- Offline Warning Box -->
          <div v-if="!canRecordPayment" class="offline-warning-box">
            <ion-icon :icon="alertCircle" class="warn-icon" />
            <div class="warn-text">
              <strong>Offline Mode</strong>
              <p>{{ paymentDisabledReason }}</p>
            </div>
          </div>

          <!-- Confirm & Record Button -->
          <UniButton
            variant="primary"
            :disabled="!canSubmitPayment"
            @click="handleConfirmPayment"
          >
            <ion-spinner v-if="isProcessing" name="crescent" slot="start" />
            <ion-icon v-else :icon="cashOutline" slot="start" />
            <span>Confirm & Record Payment (Supabase RPC)</span>
          </UniButton>
        </UniCard>
      </div>

      <!-- STEP 5: Official Printable Payment Receipt Sheet -->
      <UniSheet
        :is-open="isReceiptModalOpen"
        title="Official Payment Receipt"
        @close="handleNextStudent"
      >
        <div v-if="completedReceipt" class="receipt-sheet-wrap">
          <div class="receipt-header-center">
            <div class="receipt-brand">UniTap 2.0</div>
            <div class="receipt-sub">Computer Studies Government (CSG)</div>
            <span class="badge-mini badge-success">Authoritatively Confirmed • Server Recorded</span>
          </div>

          <div class="receipt-details-grid font-mono">
            <div class="rec-row"><span>Ref #:</span><strong>{{ completedReceipt.referenceNumber }}</strong></div>
            <div class="rec-row"><span>Date:</span><span>{{ new Date(completedReceipt.paymentDate).toLocaleString() }}</span></div>
            <div class="rec-row"><span>Student:</span><strong>{{ completedReceipt.student.fullName }}</strong></div>
            <div class="rec-row"><span>ID:</span><span>{{ completedReceipt.student.schoolId }}</span></div>
            <div class="rec-row"><span>Method:</span><span>{{ completedReceipt.paymentMethod === 'CASH' ? 'Cash Collection' : (completedReceipt.notes?.includes('GCash') ? 'GCash Transfer' : 'Bank Transfer') }}</span></div>
            <div v-if="completedReceipt.notes" class="rec-row"><span>Notes:</span><span>{{ completedReceipt.notes }}</span></div>
          </div>

          <div class="receipt-items-table">
            <div class="item-head">
              <span>Obligation</span>
              <span>Amount Paid</span>
            </div>
            <div v-for="it in completedReceipt.items" :key="it.obligationId" class="item-line">
              <div class="item-info">
                <span class="font-bold">{{ it.title }}</span>
                <span class="item-rem font-mono">Remaining: {{ formatPeso(it.remainingBalanceCentavos) }}</span>
              </div>
              <span class="item-amt font-mono font-bold text-success">{{ formatPeso(it.paidAmountCentavos) }}</span>
            </div>
          </div>

          <div class="receipt-total-box">
            <span class="bold">TOTAL COLLECTED:</span>
            <span class="total-figure font-mono font-bold text-success">{{ formatPeso(completedReceipt.totalPaidCentavos) }}</span>
          </div>

          <div class="receipt-actions">
            <UniButton variant="outline" @click="printReceipt">
              <ion-icon :icon="printOutline" slot="start" />
              <span>Print / Save PDF</span>
            </UniButton>
            <UniButton variant="primary" @click="handleNextStudent">
              <ion-icon :icon="arrowForwardOutline" slot="start" />
              <span>Next Student (Scan)</span>
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
  max-width: 680px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.step-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--uni-text);
  margin: 0;
}

.section-description {
  font-size: 12px;
  color: var(--uni-text-secondary);
  margin: 2px 0 10px 0;
}

.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.continuous-badge {
  display: flex;
  align-items: center;
  gap: 5px;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--uni-success, #16a34a);
  animation: pulse-dot 1.5s infinite;
}

@keyframes pulse-dot {
  0% { transform: scale(0.9); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.5; }
  100% { transform: scale(0.9); opacity: 1; }
}

.active-template-card {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--uni-primary-bg);
  border: 1px solid var(--uni-primary-light);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.template-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.template-name {
  font-size: 13px;
  color: var(--uni-text);
}

.template-meta-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--uni-text-secondary);
}

.template-meta-row strong {
  color: var(--uni-primary);
}

.template-hint {
  font-size: 10px;
  opacity: 0.8;
}

/* Identification Flow & Tabs */
.identification-flow {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.id-tab-control {
  margin-bottom: 2px;
}

/* Selected Student Profile Banner */
.selected-student-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 12px;
  box-shadow: var(--uni-shadow-card);
}

.student-avatar-circle {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--uni-primary-hover, #0f766e), var(--uni-primary, #14b8a6));
  color: var(--uni-primary-contrast, #ffffff);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 15px;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.student-details-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.student-header-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.student-full-name {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  color: var(--uni-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.student-meta-line {
  font-size: 11px;
  color: var(--uni-text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.meta-dot {
  opacity: 0.5;
}

.change-student-btn {
  background: var(--uni-danger-bg);
  color: var(--uni-danger-text);
  border: 1px solid var(--uni-danger-border);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.15s ease, transform 0.1s ease;
}

.change-student-btn:active {
  opacity: 0.8;
  transform: scale(0.96);
}

/* Scanner Surface Card (Matching NfcCheckerPage.vue) */
.scanner-surface-card {
  padding: 24px 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: 12px;
  box-shadow: var(--uni-shadow-card);
}

.nfc-halo-container {
  position: relative;
  width: 76px;
  height: 76px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nfc-halo-core {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: var(--uni-primary-bg);
  border: 1px solid var(--uni-primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--uni-primary);
  transition: all 0.3s ease;
  z-index: 2;
}

.nfc-core-icon {
  font-size: 26px;
}

.nfc-pulse-ring {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.nfc-halo-container.is-active .nfc-pulse-ring {
  opacity: 1;
  border-color: var(--uni-primary);
  animation: nfc-pulse 2s infinite ease-out;
}

.nfc-halo-container.is-checking .nfc-halo-core {
  background: var(--uni-info-bg);
  border-color: var(--uni-info-border);
  color: var(--uni-info-text);
  transform: scale(1.05);
}

@keyframes nfc-pulse {
  0% { transform: scale(0.85); opacity: 0.8; }
  70% { transform: scale(1.25); opacity: 0; }
  100% { transform: scale(1.25); opacity: 0; }
}

.scanner-text-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 320px;
}

.scanner-status-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--uni-text);
  margin: 0;
}

.scanner-instruction-text {
  font-size: 12px;
  color: var(--uni-text-secondary);
  line-height: 1.4;
  margin: 0;
}

.scanner-controls-row {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

/* Find Student Search Section */
.find-student-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.custom-search-input-wrap {
  display: flex;
  align-items: center;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 10px;
  padding: 0 12px;
  height: 44px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  transition: border-color 0.15s ease;
}

.custom-search-input-wrap:focus-within {
  border-color: var(--uni-primary);
}

.search-lead-icon {
  font-size: 18px;
  color: var(--uni-text-secondary);
  margin-right: 8px;
  flex-shrink: 0;
}

.clean-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--uni-text);
  font-size: 13px;
  font-family: inherit;
}

.clean-search-input::placeholder {
  color: var(--uni-text-secondary);
}

.clear-search-btn {
  background: none;
  border: none;
  color: var(--uni-text-secondary);
  font-size: 18px;
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 0;
}

.count-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 2px;
}

.count-text {
  font-size: 11px;
  color: var(--uni-text-secondary);
}

.filtered-badge {
  font-size: 10px;
  font-weight: 700;
  background: var(--uni-surface-secondary);
  color: var(--uni-text-secondary);
  border: 1px solid var(--uni-border);
  padding: 2px 6px;
  border-radius: 4px;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 0;
}

.loading-text {
  font-size: 12px;
  color: var(--uni-text-secondary);
}

.matching-students-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Status Boxes */
.status-box {
  padding: 12px;
  border-radius: 8px;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.status-box-icon {
  font-size: 28px;
}

.status-box-title {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
}

.status-box-desc {
  margin: 4px 0 0 0;
  font-size: 12px;
}

.status-settled {
  background: var(--uni-success-bg);
  border: 1px solid var(--uni-success-border);
  color: var(--uni-success-text);
}

.status-none {
  background: var(--uni-warning-bg);
  border: 1px solid var(--uni-warning-border);
  color: var(--uni-warning-text);
}

.status-due {
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  color: var(--uni-text);
}

.status-action-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.obligation-details-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--uni-text);
}

.ob-row {
  display: flex;
  justify-content: space-between;
  color: var(--uni-text);
}

.ob-label {
  color: var(--uni-text-secondary);
}

.ob-val {
  color: var(--uni-text);
}

.ob-row-highlight {
  border-top: 1px dashed var(--uni-border);
  padding-top: 6px;
  font-size: 13px;
}

.field-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--uni-text-secondary);
  margin-bottom: 4px;
}

.field-hint {
  font-size: 11px;
  color: var(--uni-text-secondary);
  margin-top: 2px;
  display: block;
}

.clean-input {
  width: 100%;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--uni-border);
  background: var(--uni-surface-secondary);
  color: var(--uni-text);
  font-size: 14px;
  font-weight: 500;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}

.clean-input:focus {
  border-color: var(--uni-primary);
}

.clean-input::placeholder {
  color: var(--uni-text-secondary);
}

.single-amount-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--uni-surface-secondary);
  border: 1.5px solid var(--uni-border);
  border-radius: 10px;
  padding: 6px 10px;
  transition: border-color 0.15s ease;
}

.single-amount-wrap:focus-within {
  border-color: var(--uni-primary);
}

.currency-prefix-large {
  font-size: 18px;
  font-weight: 800;
  color: var(--uni-primary);
}

.clean-input-amount {
  flex: 1;
  border: none;
  outline: none;
  font-size: 18px;
  font-weight: 800;
  color: var(--uni-text);
  background: transparent;
  font-family: inherit;
}

.full-btn {
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 700;
  color: var(--uni-text);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.full-btn:hover {
  background: var(--uni-surface-secondary);
  border-color: var(--uni-primary);
  color: var(--uni-primary);
}

.method-options-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
  margin-top: 4px;
}

.method-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 6px;
  background: var(--uni-surface-secondary);
  border: 1.5px solid var(--uni-border);
  border-radius: 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--uni-text);
  cursor: pointer;
  text-align: center;
  transition: all 0.15s ease;
  user-select: none;
  position: relative;
}

.method-label input[type="radio"] {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}

.method-label:hover {
  border-color: var(--uni-primary);
}

.method-label.active {
  border-color: var(--uni-primary);
  background: var(--uni-primary-bg);
  color: var(--uni-primary);
  box-shadow: 0 0 0 1px var(--uni-primary);
}

.method-icon {
  font-size: 22px;
  color: currentColor;
}

.settlement-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 10px;
  margin: 14px 0;
  color: var(--uni-text);
}

.banner-text {
  display: flex;
  flex-direction: column;
}

.banner-sub {
  font-size: 11px;
  color: var(--uni-text-secondary);
}

.banner-main {
  font-size: 13px;
  font-weight: 700;
  color: var(--uni-text);
}

.banner-figure {
  font-size: 20px;
  font-weight: 800;
  color: var(--uni-primary);
}

.badge-mini {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid transparent;
  display: inline-flex;
  align-items: center;
  line-height: 1.3;
}

.badge-success {
  background: var(--uni-success-bg);
  color: var(--uni-success-text);
  border-color: var(--uni-success-border);
}

.badge-warning {
  background: var(--uni-warning-bg);
  color: var(--uni-warning-text);
  border-color: var(--uni-warning-border);
}

.badge-danger {
  background: var(--uni-danger-bg);
  color: var(--uni-danger-text);
  border-color: var(--uni-danger-border);
}

.badge-neutral {
  background: var(--uni-neutral-bg);
  color: var(--uni-neutral-text);
  border-color: var(--uni-neutral-border);
}

.badge-primary {
  background: var(--uni-primary-bg);
  color: var(--uni-primary-text, var(--uni-primary));
  border-color: var(--uni-primary-light);
}

.error-banner {
  background: var(--uni-danger-bg);
  border: 1px solid var(--uni-danger-border);
  color: var(--uni-danger-text);
  padding: 10px 14px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.receipt-sheet-wrap {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.receipt-header-center {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.receipt-brand {
  font-size: 18px;
  font-weight: 900;
  color: var(--uni-primary);
}

.receipt-sub {
  font-size: 11px;
  color: var(--uni-text-secondary);
  margin-bottom: 4px;
}

.receipt-details-grid {
  background: var(--uni-surface-secondary);
  border: 1px dashed var(--uni-border);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--uni-text);
}

.receipt-details-grid .rec-row span:first-child {
  color: var(--uni-text-secondary);
}

.rec-row {
  display: flex;
  justify-content: space-between;
}

.receipt-items-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px dashed var(--uni-border);
  padding-top: 8px;
}

.item-head {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
  color: var(--uni-text-secondary);
  text-transform: uppercase;
}

.item-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 13px;
  color: var(--uni-text);
}

.item-info {
  display: flex;
  flex-direction: column;
}

.item-rem {
  font-size: 11px;
  color: var(--uni-text-secondary);
}

.receipt-total-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 8px;
  padding: 12px;
  color: var(--uni-text);
}

.total-figure {
  font-size: 18px;
}

.receipt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

.offline-warning-box {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 14px;
  background: var(--uni-danger-bg);
  border: 1px solid var(--uni-danger-border);
  border-radius: 8px;
  color: var(--uni-danger-text);
  margin-bottom: 12px;
}

.offline-warning-box .warn-icon {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
  color: currentColor;
}

.offline-warning-box .warn-text strong {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: currentColor;
}

.offline-warning-box .warn-text p {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--uni-text-secondary);
}

.obligations-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.obligation-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.obligation-item:hover {
  background: var(--uni-surface-secondary);
}

.obligation-item.is-selected {
  border-color: var(--uni-primary);
  background: var(--uni-primary-bg);
}

.ob-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.uni-checkbox {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border: 1.5px solid var(--uni-border);
  border-radius: 5px;
  background: var(--uni-surface-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: all 0.15s ease;
  vertical-align: middle;
  flex-shrink: 0;
  margin: 0;
  padding: 0;
}

.uni-checkbox:hover {
  border-color: var(--uni-primary);
}

.uni-checkbox:checked {
  background: var(--uni-primary);
  border-color: var(--uni-primary);
}

.uni-checkbox:checked::after {
  content: '';
  width: 4px;
  height: 8px;
  border: solid var(--uni-primary-contrast, #ffffff);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  position: absolute;
  top: 2px;
  left: 5px;
}

.ob-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ob-title {
  font-size: 13px;
  color: var(--uni-text);
}

.ob-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.meta-date {
  color: var(--uni-text-secondary);
}

.ob-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.rem-label {
  font-size: 11px;
  color: var(--uni-text-secondary);
}

.amount-input-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.currency-prefix {
  font-size: 12px;
  font-weight: 700;
  color: var(--uni-primary);
}

.clean-input-inline {
  width: 80px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--uni-primary);
  background: var(--uni-surface);
  color: var(--uni-text);
  font-size: 13px;
  font-weight: 700;
  text-align: right;
  outline: none;
}

/* Settlement & Allocation Preview Styles */
.allocation-previews-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.allocation-preview-card {
  padding: 12px;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.preview-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.preview-title {
  font-size: 13px;
  color: var(--uni-text);
}

.preview-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--uni-text);
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: 8px;
  padding: 8px 10px;
}

.preview-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.preview-label {
  color: var(--uni-text-secondary);
  font-size: 12px;
}

.preview-val {
  font-size: 12px;
}

.preview-input-row {
  border-top: 1px dashed var(--uni-border);
  border-bottom: 1px dashed var(--uni-border);
  padding: 6px 0;
}

.preview-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview-number-input {
  width: 90px;
}

.preview-remaining-row {
  padding-top: 2px;
}

.preview-estimate-disclaimer {
  font-size: 11px;
  color: var(--uni-text-secondary);
  margin-top: 8px;
  font-style: italic;
  text-align: right;
}
</style>
