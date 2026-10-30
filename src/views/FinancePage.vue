<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  onIonViewWillEnter
} from '@ionic/vue';
import {
  flashOutline,
  addOutline,
  listOutline,
  walletOutline,
  checkmarkCircle,
  receiptOutline
} from 'ionicons/icons';
import { financeService } from '@/services/finance.service';
import { studentService } from '@/services/student.service';
import type { FinanceSummary, StudentCharge, Payment } from '@/types/finance';
import type { Student } from '@/types/student';
import { formatPeso } from '@/utilities/finance-formatters';
import { formatDate } from '@/utilities/date-formatters';
import { formatFullName } from '@/utilities/student-formatters';
import { 
  UniPageHeader, 
  UniHeroCard, 
  UniStatCard, 
  UniActionCard, 
  UniSheet, 
  UniButton, 
  UniEmptyState 
} from '@/components/ui';
import { haptics } from '@/utilities/haptics';

const router = useRouter();

const isDetailSheetOpen = ref(false);
const selectedPayment = ref<Payment | null>(null);

function openPaymentDetail(pay: Payment) {
  selectedPayment.value = pay;
  isDetailSheetOpen.value = true;
  haptics.light();
}

const summary = ref<FinanceSummary>({
  totalOutstandingCentavos: 0,
  totalSimulatedWalletCreditsCentavos: 0,
  totalPaymentsCollectedCentavos: 0,
  unpaidChargesCount: 0,
  activeWalletsCount: 0
});

const recentPayments = ref<Payment[]>([]);
const recentCharges = ref<StudentCharge[]>([]);
const studentMap = ref<Record<string, Student>>({});
const isLoading = ref(true);

async function loadFinanceData() {
  isLoading.value = true;
  try {
    summary.value = await financeService.getFinanceSummary();
    const payments = await financeService.getPayments();
    recentPayments.value = payments.slice(0, 5);

    const charges = await financeService.getCharges();
    recentCharges.value = charges.slice(0, 5);

    const students = await studentService.getStudents();
    const sMap: Record<string, Student> = {};
    students.forEach(s => { sMap[s.id] = s; });
    studentMap.value = sMap;
  } catch (err) {
    console.error('Error loading finance data:', err);
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadFinanceData);
onIonViewWillEnter(loadFinanceData);
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Finance"
      subtitle="Student obligations & simulated credits"
      optional-badge="Simulated"
      badge-variant="neutral"
      variant="root"
    />

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Refined Aurora Hero Card -->
        <UniHeroCard gradient="primary" class="finance-hero">
          <div class="hero-top-row">
            <div class="hero-label-wrap">
              <span class="hero-overline">
                <span class="mint-indicator"></span> Wallet credits
              </span>
            </div>
            <div class="hero-tags-row">
              <span class="hero-wallets-tag font-mono">{{ summary.activeWalletsCount }} Wallets</span>
              <ion-icon :icon="flashOutline" class="hero-nfc-symbol" />
            </div>
          </div>

          <div class="hero-balance-figure tabular-nums font-mono">
            {{ formatPeso(summary.totalSimulatedWalletCreditsCentavos) }}
          </div>

          <div class="hero-bottom-row">
            <span class="hero-caption">Aggregate student ledger balances</span>
            <span class="demo-subtle-pill font-mono">Simulated Ledger</span>
          </div>
        </UniHeroCard>

        <!-- 2 Secondary Summary Stat Cards -->
        <div class="summary-cards-grid">
          <UniStatCard
            label="Outstanding Fees"
            :value="formatPeso(summary.totalOutstandingCentavos)"
            value-color="danger"
            meta="Receivables"
            @click="router.push('/finance/charges')"
          >
            <template #top-right>
              <span class="badge-mini badge-warn">{{ summary.unpaidChargesCount }} Unpaid</span>
            </template>
          </UniStatCard>

          <UniStatCard
            label="Collected"
            :value="formatPeso(summary.totalPaymentsCollectedCentavos)"
            value-color="success"
            meta="Settled payments"
            :interactive="false"
          >
            <template #top-right>
              <ion-icon :icon="checkmarkCircle" class="check-lead" />
            </template>
          </UniStatCard>
        </div>

        <!-- Responsive Quick Action Grid (Fix Horizontal Overflow) -->
        <div class="action-tiles-grid">
          <UniActionCard
            :icon="flashOutline"
            title="Pay Charge"
            subtitle="Tap card to settle"
            :primary="true"
            @click="router.push('/finance/pay')"
          />

          <UniActionCard
            :icon="addOutline"
            title="Issue Charge"
            subtitle="Add fine or fee"
            @click="router.push('/finance/charges/create')"
          />

          <UniActionCard
            :icon="listOutline"
            title="Fee Obligations"
            subtitle="Unpaid & paid charges"
            @click="router.push('/finance/charges')"
          />

          <UniActionCard
            :icon="walletOutline"
            title="Student Wallets"
            subtitle="Ledgers & top up"
            @click="router.push('/finance/wallets')"
          />
        </div>

        <!-- Recent Payments Feed -->
        <section class="section-block">
          <div class="section-heading">
            <span>Recent payments</span>
            <span v-if="recentPayments.length > 0" class="metadata-text">Simulated transactions</span>
          </div>

          <div v-if="recentPayments.length > 0" class="activity-card">
            <div 
              v-for="(pay, idx) in recentPayments" 
              :key="pay.id" 
              class="activity-row"
              :class="{ 'row-border': idx < recentPayments.length - 1 }"
              @click="openPaymentDetail(pay)"
            >
              <div class="activity-icon-wrap icon-payment">
                <ion-icon :icon="receiptOutline" />
              </div>

              <div class="activity-details">
                <div class="activity-primary-line">
                  <span class="activity-student-name">
                    {{ studentMap[pay.studentId] ? formatFullName(studentMap[pay.studentId].firstName, studentMap[pay.studentId].middleName, studentMap[pay.studentId].lastName) : 'Student #' + pay.studentId.slice(0, 6) }}
                  </span>
                  <span class="pay-amount tabular-nums font-mono text-success">
                    +{{ formatPeso(pay.amount) }}
                  </span>
                </div>

                <div class="activity-sub-line">
                  <span class="activity-note font-mono">
                    {{ pay.referenceNumber }} • {{ formatDate(pay.processedAt) }}
                  </span>
                  <span class="status-pill-success">Paid</span>
                </div>
              </div>
            </div>
          </div>

          <UniEmptyState
            v-else
            :icon="receiptOutline"
            title="No payments recorded"
            description="Completed simulated fee payments will appear here."
          />
        </section>
      </div>
    </ion-content>

    <!-- Payment Detail Custom Sheet -->
    <UniSheet
      v-model:is-open="isDetailSheetOpen"
      title="Payment Details"
      subtitle="Simulated transaction record"
    >
      <div v-if="selectedPayment" class="receipt-sheet-body">
        <div class="receipt-amount-hero">
          <span class="receipt-val-lead text-success tabular-nums font-mono">
            +{{ formatPeso(selectedPayment.amount) }}
          </span>
          <span class="status-pill-success">Simulated Settlement</span>
        </div>

        <div class="receipt-info-card">
          <div class="meta-item-row">
            <span class="meta-lbl">Student</span>
            <span class="meta-val font-semibold">
              {{ studentMap[selectedPayment.studentId] ? formatFullName(studentMap[selectedPayment.studentId].firstName, studentMap[selectedPayment.studentId].middleName, studentMap[selectedPayment.studentId].lastName) : 'Student #' + selectedPayment.studentId.slice(0, 8) }}
            </span>
          </div>

          <div class="meta-item-row">
            <span class="meta-lbl">Reference</span>
            <span class="meta-val font-mono">{{ selectedPayment.referenceNumber }}</span>
          </div>

          <div class="meta-item-row">
            <span class="meta-lbl">Date &amp; time</span>
            <span class="meta-val">{{ formatDate(selectedPayment.processedAt) }}</span>
          </div>

          <div class="meta-item-row">
            <span class="meta-lbl">Payment source</span>
            <span class="meta-val font-mono">{{ selectedPayment.paymentSource }}</span>
          </div>
        </div>

        <div v-if="selectedPayment.allocations && selectedPayment.allocations.length > 0" class="allocations-block">
          <span class="metadata-text">Charges covered ({{ selectedPayment.allocations.length }})</span>
          <div 
            v-for="alloc in selectedPayment.allocations" 
            :key="alloc.studentChargeId" 
            class="alloc-row font-mono"
          >
            <span>Charge #{{ alloc.studentChargeId.slice(0, 6) }}</span>
            <span class="text-success">+{{ formatPeso(alloc.amountApplied) }}</span>
          </div>
        </div>

        <UniButton
          variant="secondary"
          :block="true"
          @click="isDetailSheetOpen = false"
        >
          Close
        </UniButton>
      </div>
    </UniSheet>
  </ion-page>
</template>

<style scoped>
.finance-hero {
  display: flex;
  flex-direction: column;
}

.hero-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.hero-overline {
  font-size: 12.5px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  display: flex;
  align-items: center;
  gap: 7px;
}

.mint-indicator {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--uni-mint);
  box-shadow: 0 0 8px var(--uni-mint);
}

.hero-tags-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hero-wallets-tag {
  font-size: 11px;
  font-weight: 600;
  color: var(--uni-mint);
  background: rgba(112, 243, 207, 0.12);
  border: 1px solid rgba(112, 243, 207, 0.3);
  padding: 2px 8px;
  border-radius: 9999px;
}

.hero-nfc-symbol {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.7);
}

.hero-balance-figure {
  font-size: var(--uni-font-financial, 30px);
  font-weight: 700;
  line-height: 1.1;
  color: #FFFFFF;
  margin-bottom: 14px;
  letter-spacing: -0.02em;
}

.hero-bottom-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 10px;
}

.hero-caption {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.65);
}

.demo-subtle-pill {
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 8px;
  border-radius: 9999px;
}

/* Secondary Summary Cards Grid */
.summary-cards-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.badge-mini {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 9999px;
}

.badge-warn {
  background: rgba(255, 183, 143, 0.15);
  color: #D97706;
}

.check-lead {
  font-size: 18px;
  color: #10B981;
}

/* Responsive Action Grid (No Horizontal Overflow) */
.action-tiles-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
}

@media (max-width: 340px) {
  .action-tiles-grid {
    grid-template-columns: 1fr;
  }
}

/* Activity Card */
.activity-card {
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-card);
  overflow: hidden;
  box-shadow: var(--uni-shadow-card);
}

.activity-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  transition: background 0.14s ease;
}

.activity-row:active {
  background: var(--uni-surface-elevated);
}

.row-border {
  border-bottom: 1px solid var(--uni-border-subtle);
}

.activity-icon-wrap {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  flex-shrink: 0;
}

.icon-payment {
  background: rgba(112, 243, 207, 0.12);
  color: #0E8560;
}
@media (prefers-color-scheme: dark) {
  .icon-payment { color: var(--uni-mint); }
}

.activity-details {
  flex: 1;
  min-width: 0;
}

.activity-primary-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.activity-student-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--uni-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pay-amount {
  font-size: 13.5px;
  font-weight: 700;
  flex-shrink: 0;
}

.activity-sub-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
}

.activity-note {
  font-size: 11px;
  color: var(--uni-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-pill-success {
  font-size: 10px;
  font-weight: 600;
  color: #0E8560;
  background: rgba(112, 243, 207, 0.12);
  padding: 1px 6px;
  border-radius: 9999px;
  flex-shrink: 0;
}
@media (prefers-color-scheme: dark) {
  .status-pill-success { color: var(--uni-mint); }
}

/* Receipt Sheet */
.receipt-sheet-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.receipt-amount-hero {
  text-align: center;
  padding: 14px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.receipt-val-lead {
  font-size: 26px;
  font-weight: 700;
  color: #10B981;
}

.receipt-info-card {
  background: var(--uni-surface-elevated);
  border: 1px solid var(--uni-border);
  border-radius: 14px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.meta-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
}

.meta-lbl {
  color: var(--uni-text-secondary);
}

.meta-val {
  color: var(--uni-text-primary);
  text-align: right;
}

.allocations-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.alloc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--uni-surface-elevated);
  font-size: 12px;
}
</style>
