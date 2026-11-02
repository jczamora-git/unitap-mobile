<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  IonContent,
  IonIcon,
  IonSpinner,
  onIonViewWillEnter,
} from '@ionic/vue';
import {
  walletOutline,
  receiptOutline,
  checkmarkCircle,
  alertCircleOutline,
  cashOutline,
  cardOutline,
  chevronForwardOutline,
  shieldCheckmarkOutline,
  closeOutline,
  printOutline,
} from 'ionicons/icons';
import { useCurrentStudentPortal } from '@/composables/useCurrentStudentPortal';
import type { PaymentRecord } from '@/types/database';
import type { StudentObligationWithBalance } from '@/database/repositories/finance.repository';
import { formatPeso } from '@/utilities/finance-formatters';
import { formatDate } from '@/utilities/date-formatters';
import { haptics } from '@/utilities/haptics';
import { UniPageHeader, UniSegmentedControl, UniEmptyState, UniSheet, UniButton } from '@/components/ui';

const {
  student,
  studentName,
  academicSummary,
  obligations,
  payments,
  isLoading,
  totalAssessedCentavos,
  totalPaidCentavos,
  outstandingBalanceCentavos,
  loadPortalData,
} = useCurrentStudentPortal();

const activeSegment = ref<'OBLIGATIONS' | 'PAYMENTS'>('OBLIGATIONS');
const selectedPayment = ref<PaymentRecord | null>(null);
const showReceiptSheet = ref(false);

const segmentOptions = computed(() => [
  { value: 'OBLIGATIONS', label: `Dues & Fees (${obligations.value.length})` },
  { value: 'PAYMENTS', label: `Receipts (${payments.value.length})` },
]);

function openReceipt(payment: PaymentRecord) {
  haptics.light();
  selectedPayment.value = payment;
  showReceiptSheet.value = true;
}

function closeReceipt() {
  showReceiptSheet.value = false;
  selectedPayment.value = null;
}

onMounted(() => {
  loadPortalData();
});

onIonViewWillEnter(() => {
  loadPortalData();
});
</script>

<template>
  <div class="student-finance-wrapper">
    <UniPageHeader
      title="My Dues &amp; Ledger"
      subtitle="Financial obligations, balances &amp; official receipts"
      variant="root"
    />

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- 1. SUMMARY HERO CARD -->
        <section class="balance-hero-card">
          <div class="hero-top-row">
            <span class="hero-label">OUTSTANDING BALANCE</span>
            <span
              class="balance-status-pill font-mono"
              :class="outstandingBalanceCentavos === 0 ? 'pill-clear' : 'pill-unpaid'"
            >
              {{ outstandingBalanceCentavos === 0 ? 'ALL DUES CLEARED' : 'PENDING PAYMENT' }}
            </span>
          </div>

          <div class="balance-amount-display">
            <h1 class="balance-pesos font-mono">{{ formatPeso(outstandingBalanceCentavos) }}</h1>
          </div>

          <div class="hero-breakdown-row">
            <div class="breakdown-col">
              <span class="breakdown-lbl">Total Assessed</span>
              <span class="breakdown-val font-mono">{{ formatPeso(totalAssessedCentavos) }}</span>
            </div>
            <div class="breakdown-divider"></div>
            <div class="breakdown-col">
              <span class="breakdown-lbl">Total Paid</span>
              <span class="breakdown-val font-mono text-mint">{{ formatPeso(totalPaidCentavos) }}</span>
            </div>
          </div>
        </section>

        <!-- 2. SEGMENT CONTROLLER -->
        <UniSegmentedControl
          v-model="activeSegment"
          :options="segmentOptions"
          size="sm"
        />

        <!-- Loading -->
        <div v-if="isLoading && obligations.length === 0 && payments.length === 0" class="loading-state">
          <ion-spinner name="crescent" color="primary" />
          <p class="metadata-text">Loading student financial records...</p>
        </div>

        <!-- 3. OBLIGATIONS TAB -->
        <div v-else-if="activeSegment === 'OBLIGATIONS'" class="content-tab">
          <div v-if="obligations.length > 0" class="obligations-list">
            <div
              v-for="ob in obligations"
              :key="ob.id"
              class="minimal-card obligation-card"
            >
              <div class="ob-card-top">
                <div class="ob-title-wrap">
                  <h4 class="ob-title">{{ ob.title }}</h4>
                  <span class="ob-type-pill font-mono" :class="ob.type === 'FINE' ? 'pill-fine' : 'pill-contribution'">
                    {{ ob.type }}
                  </span>
                </div>
                <span
                  class="ob-status-badge font-mono"
                  :class="{
                    'status-paid': (ob.balance_centavos || 0) === 0,
                    'status-partial': (ob.balance_centavos || 0) > 0 && (ob.paid_centavos || 0) > 0,
                    'status-unpaid': (ob.paid_centavos || 0) === 0
                  }"
                >
                  {{ (ob.balance_centavos || 0) === 0 ? 'PAID' : (ob.paid_centavos || 0) > 0 ? 'PARTIAL' : 'UNPAID' }}
                </span>
              </div>

              <div class="ob-financials-row">
                <div class="fin-item">
                  <span class="fin-lbl">Assessed</span>
                  <span class="fin-val font-mono">{{ formatPeso(ob.assessed_centavos || ob.amount_centavos) }}</span>
                </div>
                <div class="fin-item">
                  <span class="fin-lbl">Paid</span>
                  <span class="fin-val font-mono text-mint">{{ formatPeso(ob.paid_centavos || 0) }}</span>
                </div>
                <div class="fin-item">
                  <span class="fin-lbl">Balance</span>
                  <span class="fin-val font-mono" :class="(ob.balance_centavos || 0) > 0 ? 'text-amber' : ''">
                    {{ formatPeso(ob.balance_centavos || 0) }}
                  </span>
                </div>
              </div>

              <div class="ob-footer-row" v-if="ob.due_date">
                <span class="due-text">Due: {{ formatDate(ob.due_date) }}</span>
              </div>
            </div>
          </div>

          <UniEmptyState
            v-else
            :icon="walletOutline"
            title="No Dues Assigned"
            description="You have no outstanding fees, fines, or organization contributions at this time."
          />
        </div>

        <!-- 4. PAYMENTS & RECEIPTS TAB -->
        <div v-else-if="activeSegment === 'PAYMENTS'" class="content-tab">
          <div v-if="payments.length > 0" class="payments-list">
            <div
              v-for="p in payments"
              :key="p.id"
              class="minimal-card payment-card"
              @click="openReceipt(p)"
            >
              <div class="payment-card-left">
                <div class="receipt-icon-wrap">
                  <ion-icon :icon="receiptOutline" />
                </div>
                <div class="payment-info">
                  <div class="receipt-ref-row">
                    <span class="ref-num font-mono">Ref: {{ p.reference_number || 'N/A' }}</span>
                    <span class="payment-method-pill font-mono">{{ p.source }}</span>
                  </div>
                  <span class="payment-date">{{ formatDate(p.processed_at) }}</span>
                </div>
              </div>

              <div class="payment-card-right">
                <span class="payment-amount font-mono">{{ formatPeso(p.amount_centavos) }}</span>
                <span class="view-receipt-link">
                  <span>View Receipt</span>
                  <ion-icon :icon="chevronForwardOutline" />
                </span>
              </div>
            </div>
          </div>

          <UniEmptyState
            v-else
            :icon="receiptOutline"
            title="No Receipts Found"
            description="When you pay fees to a CSG officer, your official digital receipts will be listed here."
          />
        </div>
      </div>
    </ion-content>

    <!-- OFFICIAL DIGITAL RECEIPT SHEET -->
    <UniSheet
      :is-open="showReceiptSheet"
      title="Official Digital Receipt"
      subtitle="UniTap CSG Verified Payment Record"
      @dismiss="closeReceipt"
    >
      <div v-if="selectedPayment" class="receipt-sheet-content">
        <div class="receipt-slip-card">
          <div class="slip-header">
            <span class="slip-school font-mono">MABALACAT CITY COLLEGE</span>
            <span class="slip-org">College Studies Government (CSG)</span>
            <span class="slip-title">ACKNOWLEDGMENT RECEIPT</span>
          </div>

          <div class="slip-divider dashed"></div>

          <div class="slip-meta-grid">
            <div class="slip-field">
              <span class="field-label">Receipt Reference</span>
              <span class="field-val font-mono">{{ selectedPayment.reference_number || 'N/A' }}</span>
            </div>
            <div class="slip-field">
              <span class="field-label">Date &amp; Time</span>
              <span class="field-val">{{ formatDate(selectedPayment.processed_at) }}</span>
            </div>
            <div class="slip-field">
              <span class="field-label">Student Name</span>
              <span class="field-val font-semibold">{{ studentName }}</span>
            </div>
            <div class="slip-field">
              <span class="field-label">Student ID</span>
              <span class="field-val font-mono">{{ student?.studentNumber || 'MCC STUDENT' }}</span>
            </div>
            <div class="slip-field">
              <span class="field-label">Academic Summary</span>
              <span class="field-val">{{ academicSummary }}</span>
            </div>
            <div class="slip-field">
              <span class="field-label">Payment Method</span>
              <span class="field-val font-mono">{{ selectedPayment.source }} ({{ selectedPayment.channel }})</span>
            </div>
          </div>

          <div class="slip-divider dashed"></div>

          <div class="slip-total-box">
            <span class="total-lbl">TOTAL AMOUNT PAID</span>
            <span class="total-pesos font-mono">{{ formatPeso(selectedPayment.amount_centavos) }}</span>
          </div>

          <div class="slip-verified-stamp">
            <ion-icon :icon="shieldCheckmarkOutline" />
            <span>OFFICIALLY VERIFIED &amp; RECORDED IN LEDGER</span>
          </div>
        </div>

        <UniButton
          variant="secondary"
          block
          style="margin-top: 14px;"
          @click="closeReceipt"
        >
          Close Receipt
        </UniButton>
      </div>
    </UniSheet>
  </div>
</template>

<style scoped>
.student-finance-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.page-container {
  padding: 16px 20px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 600px;
  margin: 0 auto;
}

/* Balance Hero Card */
.balance-hero-card {
  padding: 20px;
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.14) 0%, rgba(180, 83, 9, 0.22) 50%, rgba(15, 23, 42, 0.4) 100%),
              var(--uni-surface, #1b1d22);
  border: 1px solid rgba(245, 158, 11, 0.25);
  box-shadow: 0 10px 30px -10px rgba(245, 158, 11, 0.15);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hero-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hero-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--app-text-secondary, #949ba6);
}

.balance-status-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 20px;
}

.pill-clear {
  background: rgba(112, 243, 207, 0.15);
  color: var(--aurora-mint, #70f3cf);
  border: 1px solid rgba(112, 243, 207, 0.3);
}

.pill-unpaid {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.balance-amount-display {
  padding: 4px 0;
}

.balance-pesos {
  font-size: 32px;
  font-weight: 800;
  color: var(--app-text-primary, #f5f6f7);
  margin: 0;
  line-height: 1.1;
}

.hero-breakdown-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.breakdown-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.breakdown-lbl {
  font-size: 11px;
  color: var(--app-text-secondary, #949ba6);
}

.breakdown-val {
  font-size: 15px;
  font-weight: 700;
  color: var(--app-text-primary, #f5f6f7);
}

.breakdown-divider {
  width: 1px;
  height: 28px;
  background: rgba(255, 255, 255, 0.08);
}

.text-mint {
  color: var(--aurora-mint, #70f3cf);
}

.text-amber {
  color: #f59e0b;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 20px;
  gap: 12px;
}

.metadata-text {
  font-size: 13px;
  color: var(--app-text-secondary, #949ba6);
}

.minimal-card {
  background: var(--uni-surface, #1b1d22);
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.07));
  border-radius: 16px;
}

/* Obligations List */
.obligations-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.obligation-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ob-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.ob-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.ob-title {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--app-text-primary, #f5f6f7);
  margin: 0;
  line-height: 1.25;
}

.ob-type-pill {
  align-self: flex-start;
  font-size: 9.5px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
}

.pill-contribution {
  background: rgba(101, 191, 255, 0.12);
  color: #38bdf8;
}

.pill-fine {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.ob-status-badge {
  font-size: 10.5px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 20px;
}

.status-paid {
  background: rgba(112, 243, 207, 0.15);
  color: var(--aurora-mint, #70f3cf);
  border: 1px solid rgba(112, 243, 207, 0.3);
}

.status-partial {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.status-unpaid {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.ob-financials-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
}

.fin-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fin-lbl {
  font-size: 10.5px;
  color: var(--app-text-secondary, #949ba6);
}

.fin-val {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--app-text-primary, #f5f6f7);
}

.ob-footer-row {
  font-size: 11px;
  color: var(--app-text-secondary, #949ba6);
}

/* Payments List */
.payments-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.payment-card {
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.payment-card:active {
  transform: scale(0.985);
  border-color: var(--aurora-mint, #70f3cf);
}

.payment-card-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.receipt-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgba(112, 243, 207, 0.12);
  color: var(--aurora-mint, #70f3cf);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 19px;
  flex-shrink: 0;
}

.payment-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.receipt-ref-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ref-num {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--app-text-primary, #f5f6f7);
}

.payment-method-pill {
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--app-text-secondary, #949ba6);
}

.payment-date {
  font-size: 11px;
  color: var(--app-text-secondary, #949ba6);
  margin-top: 2px;
}

.payment-card-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.payment-amount {
  font-size: 16px;
  font-weight: 800;
  color: var(--aurora-mint, #70f3cf);
}

.view-receipt-link {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--app-text-secondary, #949ba6);
}

/* Official Receipt Sheet Content */
.receipt-sheet-content {
  padding: 8px 4px 16px;
}

.receipt-slip-card {
  padding: 20px;
  background: var(--uni-surface-elevated, #24272d);
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.08));
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.slip-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 2px;
}

.slip-school {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.05em;
  color: var(--app-text-primary, #f5f6f7);
}

.slip-org {
  font-size: 11px;
  color: var(--app-text-secondary, #949ba6);
}

.slip-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--aurora-mint, #70f3cf);
  margin-top: 4px;
  letter-spacing: 0.06em;
}

.slip-divider.dashed {
  border-top: 1px dashed rgba(255, 255, 255, 0.15);
}

.slip-meta-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slip-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}

.field-label {
  color: var(--app-text-secondary, #949ba6);
}

.field-val {
  color: var(--app-text-primary, #f5f6f7);
}

.slip-total-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(112, 243, 207, 0.08);
  border: 1px solid rgba(112, 243, 207, 0.2);
}

.total-lbl {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--aurora-mint, #70f3cf);
}

.total-pesos {
  font-size: 20px;
  font-weight: 800;
  color: var(--aurora-mint, #70f3cf);
}

.slip-verified-stamp {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--app-text-secondary, #949ba6);
  padding-top: 4px;
}
</style>

