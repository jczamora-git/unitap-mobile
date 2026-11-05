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
} from 'ionicons/icons';
import { useNfc } from '@/composables/useNfc';
import { studentService } from '@/services/student.service';
import { financeService } from '@/services/finance.service';
import { authService } from '@/services/auth.service';
import { CardsRepository } from '@/database/repositories/cards.repository';
import type { Student } from '@/types/student';
import type {
  StudentObligationItem,
  PaymentReceipt,
  PaymentMethod,
} from '@/types/finance';
import { formatPeso, centavosToPeso, pesoToCentavos } from '@/utilities/finance-formatters';
import { formatFullName } from '@/utilities/student-formatters';
import { UniPageHeader, UniButton, UniCard, UniSheet, UniSelect } from '@/components/ui';
import { useOperationPolicy } from '@/composables/useOperationPolicy';

import { haptics } from '@/utilities/haptics';

const router = useRouter();
const route = useRoute();
const { isPermitted, getDisabledReason } = useOperationPolicy();
const canRecordPayment = isPermitted('PAYMENT_POST_REVERSE_RECEIPT');
const paymentDisabledReason = getDisabledReason('PAYMENT_POST_REVERSE_RECEIPT');

const {
  deviceStatus,
  isScanning,
  lastTag,
  startScan,
  stopScan,
  refreshStatus,
} = useNfc();

const allStudents = ref<Student[]>([]);
const selectedStudentId = ref<string>('');
const selectedStudent = computed(() =>
  allStudents.value.find((s) => s.id === selectedStudentId.value) || null
);

const studentOptions = computed(() => [
  { value: '', label: '-- Choose or Tap Student NFC --' },
  ...allStudents.value.map((s) => ({
    value: s.id,
    label: `${formatFullName(s.firstName, s.middleName, s.lastName)} (${s.studentNumber || s.id}) - ${s.yearLevel}${s.section}`,
  })),
]);


const outstandingObligations = ref<StudentObligationItem[]>([]);
const selectedObligationIds = ref<string[]>([]);
const paymentAmountsMap = ref<Record<string, number>>({}); // obId -> centavos

const paymentMethod = ref<PaymentMethod>('CASH');
const paymentNotes = ref<string>('');

const identifiedViaNfc = ref(false);
const isProcessing = ref(false);
const errorMessage = ref('');
const completedReceipt = ref<PaymentReceipt | null>(null);
const isReceiptModalOpen = ref(false);

const totalSelectedToPay = computed(() => {
  return selectedObligationIds.value.reduce((acc, id) => {
    return acc + (paymentAmountsMap.value[id] || 0);
  }, 0);
});

async function loadInitialData() {
  allStudents.value = await studentService.getStudents();
  const queryStudentId = route.query.studentId as string;
  if (queryStudentId) {
    selectedStudentId.value = queryStudentId;
    await onStudentSelected();
  }
}

async function onStudentSelected() {
  if (!selectedStudentId.value) {
    outstandingObligations.value = [];
    selectedObligationIds.value = [];
    paymentAmountsMap.value = {};
    return;
  }

  try {
    const list = await financeService.getStudentObligations(selectedStudentId.value);
    // Only show active obligations with remaining balance
    outstandingObligations.value = list.filter((o) => o.balanceCentavos > 0 && o.status !== 'VOID');

    selectedObligationIds.value = [];
    paymentAmountsMap.value = {};

    // Auto-select first obligation if available
    if (outstandingObligations.value.length > 0) {
      const first = outstandingObligations.value[0];
      selectedObligationIds.value = [first.id];
      paymentAmountsMap.value[first.id] = first.balanceCentavos;
    }
  } catch (err: any) {
    console.error('Error loading student obligations:', err);
    errorMessage.value = err.message || 'Error loading obligations.';
  }
}

watch(selectedStudentId, () => {
  activeAttempt.value = null;
  onStudentSelected();
});

// NFC Resolution
watch(lastTag, async (tag) => {
  if (!tag) return;
  haptics.medium();

  try {
    const card = await CardsRepository.getCardByNormalizedUid(tag.compactId || tag.id);
    if (card && card.student_id) {
      selectedStudentId.value = card.student_id;
      identifiedViaNfc.value = true;
      errorMessage.value = '';
      haptics.success();
    } else {
      errorMessage.value = `Unregistered card (${tag.compactId || tag.id}). Please register card or select student manually.`;
      haptics.error();
    }
  } catch (err) {
    console.error('Failed to resolve NFC card:', err);
  }
});

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

const activeAttempt = ref<{
  paymentId: string;
  referenceNumber: string;
  idempotencyKey: string;
} | null>(null);

function toggleObligation(ob: StudentObligationItem) {
  haptics.light();
  activeAttempt.value = null;
  const idx = selectedObligationIds.value.indexOf(ob.id);
  if (idx >= 0) {
    selectedObligationIds.value.splice(idx, 1);
    delete paymentAmountsMap.value[ob.id];
  } else {
    selectedObligationIds.value.push(ob.id);
    paymentAmountsMap.value[ob.id] = ob.balanceCentavos; // Default to full remaining balance
  }
}

function setPaymentAmount(obId: string, pesos: number) {
  activeAttempt.value = null;
  const cents = Math.round(pesoToCentavos(pesos));
  const ob = outstandingObligations.value.find((o) => o.id === obId);
  const max = ob ? ob.balanceCentavos : cents;
  paymentAmountsMap.value[obId] = Math.max(0, Math.min(cents, max));
}

async function handleConfirmPayment() {
  if (!selectedStudentId.value) {
    errorMessage.value = 'Please select a student.';
    return;
  }
  if (selectedObligationIds.value.length === 0 || totalSelectedToPay.value <= 0) {
    errorMessage.value = 'Please select at least one obligation to pay.';
    return;
  }
  if (!canRecordPayment.value) {
    errorMessage.value = paymentDisabledReason.value || 'Payment recording requires an active internet connection.';
    return;
  }

  isProcessing.value = true;
  errorMessage.value = '';

  try {
    const allocations = selectedObligationIds.value.map((id) => ({
      obligationId: id,
      amountCentavos: paymentAmountsMap.value[id] || 0,
    })).filter((a) => a.amountCentavos > 0);

    const firstOb = outstandingObligations.value.find((o) => o.id === selectedObligationIds.value[0]);
    const semesterId = firstOb?.semesterId || 'sem_default';

    // Preserve attempt identifiers across retries to prevent duplicate collection/charges
    if (!activeAttempt.value) {
      const paymentId = generateClientUuid();
      activeAttempt.value = {
        paymentId,
        referenceNumber: 'PAY-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase(),
        idempotencyKey: 'idemp_' + paymentId,
      };
    }

    const result = await financeService.recordPayment({
      studentId: selectedStudentId.value,
      semesterId,
      amountCentavos: totalSelectedToPay.value,
      source: paymentMethod.value,
      channel: identifiedViaNfc.value ? 'NFC' : 'MANUAL',
      allocations,
      notes: paymentNotes.value.trim() || undefined,
      actorUserId: authService.user.value?.id || 'officer_user',
      paymentId: activeAttempt.value.paymentId,
      referenceNumber: activeAttempt.value.referenceNumber,
      idempotencyKey: activeAttempt.value.idempotencyKey,
    });

    haptics.success();

    // Reset attempt upon confirmed completion
    activeAttempt.value = null;

    // Generate receipt
    completedReceipt.value = await financeService.generatePaymentReceipt(
      result.paymentId,
      authService.user.value?.username || 'Authorized Officer'
    );
    isReceiptModalOpen.value = true;

    // Refresh remaining obligations
    await onStudentSelected();
  } catch (err: any) {
    console.error('Payment recording failed:', err);
    errorMessage.value = err.message || 'Payment recording failed.';
    haptics.error();
  } finally {
    isProcessing.value = false;
  }
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

function handleDone() {
  isReceiptModalOpen.value = false;
  router.push('/tabs/finance');
}

onMounted(() => {
  loadInitialData();
  refreshStatus();
});

onIonViewWillEnter(() => {
  loadInitialData();
  if (deviceStatus.value.supported && deviceStatus.value.enabled) {
    startScan();
  }
});

onIonViewDidLeave(() => {
  stopScan();
});
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Record Payment"
      subtitle="Direct cash and transfer receipt recording"
      :back-button="true"
      default-back-href="/tabs/finance"
      variant="detail"
    />

    <ion-content class="safe-content non-tab-content">
      <div class="page-container">
        <!-- Error Alert -->
        <div v-if="errorMessage" class="error-banner">
          <ion-icon :icon="alertCircle" class="error-icon" />
          <span>{{ errorMessage }}</span>
        </div>

        <!-- 1. Student Selection / NFC Tap -->
        <UniCard padding="md">
          <div class="card-header-row">
            <h3 class="step-title">1. Select Student</h3>
            <span v-if="identifiedViaNfc" class="badge-mini badge-success">
              NFC Identified
            </span>
          </div>

          <div class="nfc-tap-prompt" v-if="isScanning">
            <ion-icon :icon="radioOutline" class="pulse-icon text-primary" />
            <span>Ready for NFC student card tap...</span>
          </div>

          <div class="form-group">
            <label class="field-label">Student</label>
            <UniSelect
              v-model="selectedStudentId"
              :options="studentOptions"
              placeholder="Choose or Tap Student NFC"
              header="Select Student"
              @change="onStudentSelected"
            />
          </div>

        </UniCard>

        <!-- 2. Outstanding Obligations Selection -->
        <UniCard v-if="selectedStudent" padding="md">
          <div class="card-header-row">
            <h3 class="step-title">2. Select Obligations to Settle</h3>
            <span class="badge-mini badge-neutral font-mono">
              {{ outstandingObligations.length }} Unpaid
            </span>
          </div>

          <div v-if="outstandingObligations.length > 0" class="obligations-list">
            <div
              v-for="ob in outstandingObligations"
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
                  @click.stop
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
                <span class="rem-label">Balance: {{ formatPeso(ob.balanceCentavos) }}</span>
                <div v-if="selectedObligationIds.includes(ob.id)" class="amount-input-row">
                  <span class="currency-prefix">₱</span>
                  <input
                    type="number"
                    min="1"
                    :max="centavosToPeso(ob.balanceCentavos)"
                    :value="centavosToPeso(paymentAmountsMap[ob.id] || 0)"
                    class="clean-input-inline"
                    @input="setPaymentAmount(ob.id, +($event.target as HTMLInputElement).value)"
                  />
                </div>
              </div>
            </div>
          </div>

          <div v-else class="empty-state-inline">
            <ion-icon :icon="checkmarkCircle" class="text-success text-2xl" />
            <p>Student is fully clear. No outstanding fines or contributions.</p>
          </div>
        </UniCard>

        <!-- 3. Payment Method & Confirmation -->
        <UniCard v-if="selectedObligationIds.length > 0" padding="md">
          <h3 class="step-title">3. Payment Details</h3>

          <div class="form-group">
            <label class="field-label">Payment Method</label>
            <div class="method-options">
              <label class="method-label" :class="{ active: paymentMethod === 'CASH' }">
                <input type="radio" v-model="paymentMethod" value="CASH" />
                <span>Cash Collection</span>
              </label>
              <label class="method-label" :class="{ active: paymentMethod === 'MANUAL_TRANSFER_RECORD' }">
                <input type="radio" v-model="paymentMethod" value="MANUAL_TRANSFER_RECORD" />
                <span>Bank / Transfer Record</span>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label class="field-label">Official Notes (Optional)</label>
            <input
              v-model="paymentNotes"
              type="text"
              placeholder="e.g. Paid in full to CSG Treasurer"
              class="clean-input"
            />
          </div>

          <!-- Total Banner -->
          <div class="settlement-banner">
            <div class="banner-text">
              <span class="banner-sub font-mono">{{ selectedObligationIds.length }} obligations</span>
              <span class="banner-main">Total Payment Received:</span>
            </div>
            <span class="banner-figure font-mono font-bold">{{ formatPeso(totalSelectedToPay) }}</span>
          </div>

          <div v-if="!canRecordPayment" class="offline-warning-box">
            <ion-icon :icon="alertCircle" class="warn-icon" />
            <div class="warn-text">
              <strong>Offline Mode</strong>
              <p>{{ paymentDisabledReason }}</p>
            </div>
          </div>

          <UniButton
            variant="primary"
            :disabled="isProcessing || totalSelectedToPay <= 0 || !canRecordPayment"
            @click="handleConfirmPayment"
          >
            <ion-spinner v-if="isProcessing" name="crescent" slot="start" />
            <ion-icon v-else :icon="cashOutline" slot="start" />
            <span>Record Payment & Generate Receipt</span>
          </UniButton>
        </UniCard>
      </div>

      <!-- 4. Official Printable Payment Receipt Sheet -->
      <UniSheet
        :is-open="isReceiptModalOpen"
        title="Official Payment Receipt"
        @close="handleDone"
      >
        <div v-if="completedReceipt" class="receipt-sheet-wrap">
          <div class="receipt-header-center">
            <div class="receipt-brand">UniTap 2.0</div>
            <div class="receipt-sub">Computer Studies Government (CSG)</div>
            <span class="badge-mini badge-warning">Locally Recorded • Sync Pending</span>
          </div>

          <div class="receipt-details-grid font-mono">
            <div class="rec-row"><span>Ref #:</span><strong>{{ completedReceipt.referenceNumber }}</strong></div>
            <div class="rec-row"><span>Date:</span><span>{{ new Date(completedReceipt.paymentDate).toLocaleString() }}</span></div>
            <div class="rec-row"><span>Student:</span><strong>{{ completedReceipt.student.fullName }}</strong></div>
            <div class="rec-row"><span>ID:</span><span>{{ completedReceipt.student.schoolId }}</span></div>
            <div class="rec-row"><span>Method:</span><span>{{ completedReceipt.paymentMethod === 'CASH' ? 'Cash Collection' : 'Bank Transfer' }}</span></div>
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
            <UniButton variant="primary" @click="handleDone">
              <span>Done</span>
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
  color: var(--uni-ink, #0f172a);
  margin: 0;
}

.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.nfc-tap-prompt {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--uni-primary-bg, #ccfbf1);
  color: var(--uni-primary-dark, #115e59);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 12px;
}

.pulse-icon {
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.2); opacity: 0.7; }
  100% { transform: scale(1); opacity: 1; }
}

.field-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--uni-muted, #64748b);
  margin-bottom: 4px;
}

.clean-select,
.clean-input {
  width: 100%;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--uni-border, #e2e8f0);
  background: var(--uni-surface, #ffffff);
  font-size: 14px;
  font-weight: 600;
  outline: none;
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
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.obligation-item:hover {
  background: #f8fafc;
}

.obligation-item.is-selected {
  border-color: var(--uni-primary, #0f766e);
  background: #f0fdfa;
}

.ob-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ob-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ob-title {
  font-size: 13px;
  color: var(--uni-ink, #0f172a);
}

.ob-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.meta-date {
  color: var(--uni-muted, #64748b);
}

.ob-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.rem-label {
  font-size: 11px;
  color: var(--uni-muted, #64748b);
}

.amount-input-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.currency-prefix {
  font-size: 12px;
  font-weight: 700;
  color: var(--uni-primary-dark, #115e59);
}

.clean-input-inline {
  width: 80px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--uni-primary, #0f766e);
  font-size: 13px;
  font-weight: 700;
  text-align: right;
  outline: none;
}

.method-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 4px;
}

.method-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--uni-border, #cbd5e1);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}

.method-label.active {
  border-color: var(--uni-primary, #0f766e);
  background: var(--uni-primary-bg, #ccfbf1);
  color: var(--uni-primary-dark, #115e59);
}

.settlement-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px;
  background: #f8fafc;
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 8px;
  margin: 14px 0;
}

.banner-text {
  display: flex;
  flex-direction: column;
}

.banner-sub {
  font-size: 11px;
  color: var(--uni-muted, #64748b);
}

.banner-main {
  font-size: 13px;
  font-weight: 700;
}

.banner-figure {
  font-size: 18px;
  color: var(--uni-primary-dark, #115e59);
}

.badge-mini {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
}

.badge-success { background: #dcfce7; color: #15803d; }
.badge-warning { background: #fef3c7; color: #b45309; }
.badge-danger { background: #fee2e2; color: #b91c1c; }
.badge-neutral { background: #f1f5f9; color: #64748b; }

.error-banner {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
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
  color: var(--uni-primary, #0f766e);
}

.receipt-sub {
  font-size: 11px;
  color: var(--uni-muted, #64748b);
  margin-bottom: 4px;
}

.receipt-details-grid {
  background: #f8fafc;
  border: 1px dashed var(--uni-border, #cbd5e1);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.rec-row {
  display: flex;
  justify-content: space-between;
}

.receipt-items-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px dashed var(--uni-border, #cbd5e1);
  padding-top: 8px;
}

.item-head {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
  color: var(--uni-muted, #64748b);
  text-transform: uppercase;
}

.item-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 13px;
}

.item-info {
  display: flex;
  flex-direction: column;
}

.item-rem {
  font-size: 11px;
  color: var(--uni-muted, #64748b);
}

.receipt-total-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 8px;
  padding: 12px;
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
