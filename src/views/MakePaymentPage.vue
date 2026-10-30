<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonContent,
  IonIcon,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  onIonViewWillEnter,
  onIonViewDidLeave
} from '@ionic/vue';
import {
  radioOutline,
  checkmarkCircle,
  alertCircle,
  flashOutline
} from 'ionicons/icons';
import { useNfc } from '@/composables/useNfc';
import { studentService } from '@/services/student.service';
import { financeService } from '@/services/finance.service';
import type { Student } from '@/types/student';
import type { StudentCharge, Payment } from '@/types/finance';
import { formatPeso, centavosToPeso, pesoToCentavos } from '@/utilities/finance-formatters';
import { formatFullName } from '@/utilities/student-formatters';
import { formatTime } from '@/utilities/date-formatters';
import { UniPageHeader, UniButton } from '@/components/ui';

const router = useRouter();

const {
  deviceStatus,
  isScanning,
  lastTag,
  startScan,
  stopScan,
  refreshStatus
} = useNfc();

const allStudents = ref<Student[]>([]);
const selectedStudentId = ref<string>('');
const selectedStudent = computed(() => 
  allStudents.value.find(s => s.id === selectedStudentId.value) || null
);

const walletBalanceCentavos = ref(0);
const outstandingCharges = ref<StudentCharge[]>([]);
const selectedChargeIds = ref<string[]>([]);
const paymentAmountsMap = ref<Record<string, number>>({}); // chargeId -> centavos

const identifiedViaNfc = ref(false);
const isProcessing = ref(false);
const errorMessage = ref('');
const completedPayment = ref<Payment | null>(null);

async function loadInitialData() {
  allStudents.value = await studentService.getStudents();
}

async function loadStudentFinancials(studentId: string) {
  if (!studentId) return;
  walletBalanceCentavos.value = await financeService.calculateWalletBalance(studentId);
  const charges = await financeService.getCharges(studentId);
  const activeUnpaid = charges.filter(c => c.status === 'UNPAID' || c.status === 'PARTIALLY_PAID');
  outstandingCharges.value = activeUnpaid;

  // Auto-select all unpaid charges
  selectedChargeIds.value = activeUnpaid.map(c => c.id);
  const amounts: Record<string, number> = {};
  activeUnpaid.forEach(c => {
    amounts[c.id] = c.issuedAmount - c.paidAmount;
  });
  paymentAmountsMap.value = amounts;
}

watch(selectedStudentId, async (newId) => {
  if (newId) {
    completedPayment.value = null;
    errorMessage.value = '';
    await loadStudentFinancials(newId);
  }
});

// Watch NFC card taps
watch(lastTag, async (newTag) => {
  if (!newTag?.id || isProcessing.value) return;
  try {
    const student = await studentService.findStudentByRfid(newTag.id);
    if (student) {
      identifiedViaNfc.value = true;
      selectedStudentId.value = student.id;
    } else {
      errorMessage.value = `Scanned card [${newTag.id}] is not registered to any student.`;
    }
  } catch (err) {
    console.error('Error identifying student via NFC:', err);
  }
});

onMounted(async () => {
  await loadInitialData();
  await refreshStatus();
});

onIonViewWillEnter(async () => {
  await refreshStatus();
  if (deviceStatus.value.enabled) {
    await startScan();
  }
});

onIonViewDidLeave(async () => {
  await stopScan();
});

const totalSelectedToPay = computed(() => {
  let total = 0;
  for (const cid of selectedChargeIds.value) {
    total += paymentAmountsMap.value[cid] || 0;
  }
  return total;
});

function toggleChargeSelection(chargeId: string) {
  if (selectedChargeIds.value.includes(chargeId)) {
    selectedChargeIds.value = selectedChargeIds.value.filter(id => id !== chargeId);
  } else {
    selectedChargeIds.value.push(chargeId);
  }
}

async function handleQuickTopUp(pesos: number) {
  if (!selectedStudentId.value) return;
  try {
    await financeService.topUpWallet(
      selectedStudentId.value, 
      pesos * 100, 
      `Quick Top-up for Payment: ₱${pesos}`
    );
    await loadStudentFinancials(selectedStudentId.value);
  } catch (err: unknown) {
    errorMessage.value = err instanceof Error ? err.message : 'Error topping up wallet';
  }
}

async function handleConfirmPayment() {
  errorMessage.value = '';
  if (!selectedStudentId.value) {
    errorMessage.value = 'Please select or scan a student.';
    return;
  }
  if (selectedChargeIds.value.length === 0) {
    errorMessage.value = 'Please select at least one charge to pay.';
    return;
  }
  if (totalSelectedToPay.value <= 0) {
    errorMessage.value = 'Payment amount must be greater than 0.';
    return;
  }
  if (walletBalanceCentavos.value < totalSelectedToPay.value) {
    errorMessage.value = 'Insufficient simulated wallet credits. Please add demo funds.';
    return;
  }

  isProcessing.value = true;
  try {
    const allocations = selectedChargeIds.value.map(cid => ({
      chargeId: cid,
      amountCentavos: paymentAmountsMap.value[cid]
    }));

    const payment = await financeService.processPayment({
      studentId: selectedStudentId.value,
      allocations,
      channel: identifiedViaNfc.value ? 'NFC' : 'MANUAL'
    });

    completedPayment.value = payment;
    await loadStudentFinancials(selectedStudentId.value);
  } catch (err: unknown) {
    console.error('Payment processing failed:', err);
    errorMessage.value = err instanceof Error ? err.message : 'Payment error';
  } finally {
    isProcessing.value = false;
  }
}

function resetForNextPayment() {
  completedPayment.value = null;
  selectedStudentId.value = '';
  identifiedViaNfc.value = false;
  errorMessage.value = '';
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Make Payment"
      subtitle="Simulated NFC wallet settlement"
      :back-button="true"
      default-back-href="/tabs/finance"
      variant="detail"
    />

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Error Banner -->
        <div v-if="errorMessage" class="error-banner">
          <ion-icon :icon="alertCircle" />
          <span>{{ errorMessage }}</span>
        </div>

        <!-- SUCCESS RECEIPT VIEW -->
        <div v-if="completedPayment" class="minimal-card receipt-card">
          <div class="receipt-icon-circle">
            <ion-icon :icon="checkmarkCircle" />
          </div>
          <h2 class="receipt-headline">Payment Successful</h2>
          <p class="receipt-sub">Simulated wallet settlement recorded in ledger</p>

          <div class="receipt-table">
            <div class="receipt-line">
              <span class="line-label">Reference No.</span>
              <span class="line-val font-mono">{{ completedPayment.referenceNumber }}</span>
            </div>
            <div class="receipt-line">
              <span class="line-label">Student</span>
              <span class="line-val font-semibold">{{ selectedStudent ? formatFullName(selectedStudent.firstName, selectedStudent.middleName, selectedStudent.lastName) : '' }}</span>
            </div>
            <div class="receipt-line">
              <span class="line-label">Amount Paid</span>
              <span class="line-val text-success font-mono font-semibold">{{ formatPeso(completedPayment.amount) }}</span>
            </div>
            <div class="receipt-line">
              <span class="line-label">Identification</span>
              <span class="status-badge" :class="completedPayment.paymentChannel === 'NFC' ? 'badge-accent' : 'badge-neutral'">
                {{ completedPayment.paymentChannel }}
              </span>
            </div>
            <div class="receipt-line">
              <span class="line-label">Remaining Balance</span>
              <span class="line-val font-mono">{{ formatPeso(walletBalanceCentavos) }}</span>
            </div>
            <div class="receipt-line">
              <span class="line-label">Timestamp</span>
              <span class="line-val">{{ formatTime(completedPayment.processedAt) }}</span>
            </div>
          </div>

          <div class="receipt-actions">
            <UniButton variant="primary" @click="resetForNextPayment">
              Make Another Payment
            </UniButton>
            <UniButton variant="secondary" @click="router.push('/tabs/finance')">
              Return to Finance
            </UniButton>
          </div>
        </div>

        <!-- PAYMENT WORKFLOW FORM -->
        <div v-else class="workflow-container">
          <!-- Step 1: NFC Scanner / Student Selection -->
          <div class="minimal-card step-card">
            <div class="step-header">
              <span class="step-badge">1</span>
              <h4 class="step-title">Identify Student</h4>
              <span v-if="identifiedViaNfc" class="status-badge badge-success">NFC Verified</span>
            </div>

            <!-- NFC Tap radar banner -->
            <div class="nfc-tap-banner" :class="{ 'scanning': isScanning }">
              <div class="nfc-icon-wrap" :class="{ 'nfc-pulse-active': isScanning }">
                <ion-icon :icon="radioOutline" />
              </div>
              <div class="banner-text">
                <strong class="banner-title">Hold Student ID Against Device</strong>
                <p class="banner-sub">Tap card or select manually from list below</p>
              </div>
            </div>

            <div class="field-item">
              <label class="field-label">Select Student Manually</label>
              <ion-select 
                v-model="selectedStudentId" 
                placeholder="Choose student from directory..."
                interface="action-sheet" 
                class="clean-select"
              >
                <ion-select-option 
                  v-for="s in allStudents" 
                  :key="s.id" 
                  :value="s.id"
                >
                  {{ formatFullName(s.firstName, s.middleName, s.lastName) }} ({{ s.studentNumber || s.section }})
                </ion-select-option>
              </ion-select>
            </div>
          </div>

          <!-- Step 2: Student Wallet & Balances -->
          <div v-if="selectedStudent" class="minimal-card step-card">
            <div class="step-header">
              <span class="step-badge">2</span>
              <h4 class="step-title">Student Wallet Balance</h4>
            </div>

            <div class="wallet-balance-row">
              <div class="wallet-stat">
                <span class="secondary-text">Available Demo Credits</span>
                <div class="balance-num tabular-nums font-mono">
                  {{ formatPeso(walletBalanceCentavos) }}
                </div>
              </div>

              <!-- Quick Demo Top-Up Buttons -->
              <div class="topup-quick-col">
                <span class="metadata-text">Add Demo Credits:</span>
                <div class="quick-topup-pills">
                  <button type="button" class="mini-topup-pill" @click="handleQuickTopUp(50)">+₱50</button>
                  <button type="button" class="mini-topup-pill" @click="handleQuickTopUp(100)">+₱100</button>
                  <button type="button" class="mini-topup-pill" @click="handleQuickTopUp(200)">+₱200</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Step 3: Select Outstanding Charges -->
          <div v-if="selectedStudent" class="minimal-card step-card">
            <div class="step-header">
              <span class="step-badge">3</span>
              <h4 class="step-title">Select Charges to Pay</h4>
              <span class="status-badge badge-neutral">{{ outstandingCharges.length }} Outstanding</span>
            </div>

            <div v-if="outstandingCharges.length > 0" class="charges-selection-list">
              <div 
                v-for="chg in outstandingCharges" 
                :key="chg.id" 
                class="charge-item-box"
                :class="{ selected: selectedChargeIds.includes(chg.id) }"
              >
                <div class="charge-item-head">
                  <label class="custom-checkbox-label">
                    <input 
                      type="checkbox" 
                      :checked="selectedChargeIds.includes(chg.id)" 
                      @change="toggleChargeSelection(chg.id)" 
                    />
                    <span class="charge-name-text">{{ chg.title }}</span>
                  </label>
                  <span class="charge-rem-val font-mono">
                    Rem: {{ formatPeso(chg.issuedAmount - chg.paidAmount) }}
                  </span>
                </div>

                <div v-if="selectedChargeIds.includes(chg.id)" class="payment-amount-inline">
                  <label class="field-label-sub">Amount to Apply (₱):</label>
                  <ion-input 
                    type="number"
                    :value="centavosToPeso(paymentAmountsMap[chg.id] || 0)"
                    @ion-input="(e) => paymentAmountsMap[chg.id] = pesoToCentavos(Number(e.detail.value))"
                    class="clean-input flex-1 font-mono"
                  />
                </div>
              </div>
            </div>

            <div v-else class="empty-state-box">
              <ion-icon :icon="checkmarkCircle" class="empty-state-icon text-success" />
              <p class="empty-state-title">No Unpaid Fees</p>
              <p class="empty-state-sub">This student has no outstanding fee obligations.</p>
            </div>
          </div>

          <!-- Step 4: Summary & Confirm -->
          <div v-if="selectedStudent && outstandingCharges.length > 0" class="minimal-card summary-card">
            <div class="summary-line">
              <span class="secondary-text">Total Payment:</span>
              <strong class="total-figure font-mono tabular-nums">{{ formatPeso(totalSelectedToPay) }}</strong>
            </div>
            <div class="summary-line">
              <span class="secondary-text">Current Wallet Balance:</span>
              <span class="font-mono tabular-nums">{{ formatPeso(walletBalanceCentavos) }}</span>
            </div>
            <div class="summary-line">
              <span class="secondary-text">Balance After Payment:</span>
              <span 
                class="font-mono tabular-nums font-semibold"
                :class="walletBalanceCentavos - totalSelectedToPay >= 0 ? 'text-success' : 'text-danger'"
              >
                {{ formatPeso(walletBalanceCentavos - totalSelectedToPay) }}
              </span>
            </div>

            <div class="confirm-btn-wrap">
              <UniButton 
                variant="primary"
                block
                :loading="isProcessing"
                :disabled="totalSelectedToPay <= 0 || walletBalanceCentavos < totalSelectedToPay"
                :icon="flashOutline"
                @click="handleConfirmPayment"
              >
                Confirm Simulated Payment
              </UniButton>
            </div>
          </div>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.workflow-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(220, 75, 75, 0.1);
  color: var(--ion-color-danger);
  padding: 10px 14px;
  border-radius: var(--app-btn-radius);
  font-size: 13px;
  font-weight: 500;
}

.step-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-badge {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--ion-color-primary);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-title {
  font-size: 14px;
  font-weight: 650;
  color: var(--app-text-primary);
  margin: 0;
  flex: 1;
}

.nfc-tap-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--app-surface-subtle);
  border: 1px dashed var(--app-border);
  border-radius: 12px;
  padding: 12px;
}

.nfc-tap-banner.scanning {
  border-color: rgba(59, 130, 246, 0.5);
  background: var(--app-accent-soft);
}

.nfc-icon-wrap {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--app-surface);
  color: var(--ion-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
  border: 1px solid var(--app-border);
}

.banner-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.banner-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-primary);
}

.banner-sub {
  font-size: 11px;
  color: var(--app-text-secondary);
  margin: 0;
}

.field-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text-secondary);
}

.field-label-sub {
  font-size: 11px;
  font-weight: 500;
  color: var(--app-text-secondary);
}

.clean-select, .clean-input {
  --background: var(--app-surface-subtle);
  --color: var(--app-text-primary);
  --padding-start: 12px;
  --padding-end: 12px;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  font-size: 14px;
  min-height: 44px;
}

.wallet-balance-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--app-surface-subtle);
  border-radius: 12px;
  padding: 12px 14px;
}

.wallet-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.balance-num {
  font-size: 20px;
  font-weight: 700;
  color: var(--ion-color-primary);
}

.topup-quick-col {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.quick-topup-pills {
  display: flex;
  gap: 6px;
}

.mini-topup-pill {
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  color: var(--app-text-primary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mini-topup-pill:active {
  background: var(--app-accent-soft);
  color: var(--ion-color-primary);
}

/* Charges Selection */
.charges-selection-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.charge-item-box {
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.15s ease;
}

.charge-item-box.selected {
  border-color: var(--ion-color-primary);
  background: var(--app-surface);
}

.charge-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.custom-checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.custom-checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--ion-color-primary);
}

.charge-name-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-primary);
}

.charge-rem-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text-secondary);
}

.payment-amount-inline {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 6px;
  border-top: 1px dashed var(--app-border);
}

.flex-1 {
  flex: 1;
}

/* Summary Card */
.summary-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--app-surface);
}

.summary-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

.total-figure {
  font-size: 18px;
  color: var(--app-text-primary);
}

.font-semibold {
  font-weight: 600;
}

.confirm-btn-wrap {
  margin-top: 6px;
}

.primary-submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 46px;
  border-radius: var(--app-btn-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.3);
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.primary-submit-btn:active {
  transform: scale(0.985);
  opacity: 0.92;
}

.primary-submit-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.secondary-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 42px;
  border-radius: var(--app-btn-radius);
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  color: var(--app-text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

/* Receipt Card */
.receipt-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 18px;
  gap: 12px;
}

.receipt-icon-circle {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(21, 154, 116, 0.12);
  color: var(--ion-color-success);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
}

.receipt-headline {
  font-size: 18px;
  font-weight: 700;
  color: var(--app-text-primary);
  margin: 0;
}

.receipt-sub {
  font-size: 12px;
  color: var(--app-text-secondary);
  margin: -4px 0 6px 0;
}

.receipt-table {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--app-surface-subtle);
  border-radius: 12px;
  padding: 12px 14px;
}

.receipt-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}

.line-label {
  color: var(--app-text-secondary);
}

.line-val {
  color: var(--app-text-primary);
}

.receipt-actions {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.btn-spinner {
  width: 18px;
  height: 18px;
}
</style>
