<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  onIonViewWillEnter
} from '@ionic/vue';
import {
  walletOutline,
  addCircleOutline,
  arrowDownOutline,
  arrowUpOutline,
  radioOutline
} from 'ionicons/icons';
import { studentService } from '@/services/student.service';
import { financeService } from '@/services/finance.service';
import type { Student } from '@/types/student';
import type { Wallet, WalletTransaction } from '@/types/finance';
import { formatPeso, pesoToCentavos } from '@/utilities/finance-formatters';
import { formatFullName, formatStudentAcademicSummary } from '@/utilities/student-formatters';
import { formatDateTime } from '@/utilities/date-formatters';
import { UniPageHeader, UniSheet, UniFormField, UniInput, UniButton } from '@/components/ui';

const route = useRoute();
const studentId = route.params.studentId as string;

const student = ref<Student | null>(null);
const wallet = ref<Wallet | null>(null);
const balanceCentavos = ref(0);
const transactions = ref<WalletTransaction[]>([]);

const showTopUpModal = ref(false);
const topUpAmountPesos = ref<number>(50);
const topUpNote = ref('');
const isSubmitting = ref(false);

async function loadData() {
  student.value = await studentService.getStudent(studentId);
  wallet.value = await financeService.getOrCreateWallet(studentId);
  balanceCentavos.value = await financeService.calculateWalletBalance(studentId);
  transactions.value = await financeService.getStudentTransactions(studentId);
}

onMounted(loadData);
onIonViewWillEnter(loadData);

async function executeTopUp() {
  if (topUpAmountPesos.value <= 0) return;
  isSubmitting.value = true;
  try {
    await financeService.topUpWallet(
      studentId, 
      pesoToCentavos(Number(topUpAmountPesos.value)), 
      topUpNote.value || 'Demo Top-Up'
    );
    showTopUpModal.value = false;
    topUpNote.value = '';
    await loadData();
  } catch (err: unknown) {
    alert(err instanceof Error ? err.message : 'Error topping up');
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Student Wallet"
      :subtitle="student ? formatFullName(student.firstName, student.middleName, student.lastName) : 'Personal ledger & transactions'"
      :back-button="true"
      default-back-href="/tabs/finance"
      variant="detail"
    />

    <ion-content class="safe-content">
      <div v-if="student" class="page-container">
        <!-- Student Info Header -->
        <div class="minimal-card student-header-card">
          <div class="student-text-group">
            <h3 class="student-name">{{ formatFullName(student.firstName, student.middleName, student.lastName) }}</h3>
            <p class="student-sub">{{ formatStudentAcademicSummary(student) }}</p>
          </div>
          <div class="student-meta-tags">
            <span v-if="student.studentNumber" class="font-mono text-xs">ID: {{ student.studentNumber }}</span>
            <span v-if="student.rfidUid" class="nfc-tag-badge font-mono">
              <ion-icon :icon="radioOutline" /> {{ student.rfidUid }}
            </span>
          </div>
        </div>

        <!-- Student Wallet Hero Card (Charcoal) -->
        <div class="fintech-hero-card">
          <div class="hero-top-row">
            <span class="hero-label">Available Student Balance</span>
            <span class="status-badge badge-success">ACTIVE</span>
          </div>

          <div class="hero-balance-figure tabular-nums font-mono">
            {{ formatPeso(balanceCentavos) }}
          </div>

          <div class="hero-bottom-actions">
            <span class="demo-subtle-pill">Simulated Wallet</span>
            <UniButton size="sm" :icon="addCircleOutline" @click="showTopUpModal = true">
              Top Up Demo Credits
            </UniButton>
          </div>
        </div>

        <!-- Transaction Ledger Feed -->
        <section class="section-block">
          <div class="section-heading">
            <span>Transaction Ledger</span>
            <span class="metadata-text">{{ transactions.length }} Entries</span>
          </div>

          <div v-if="transactions.length > 0" class="minimal-card activity-card">
            <div 
              v-for="(t, idx) in transactions" 
              :key="t.id" 
              class="activity-row"
              :class="{ 'row-border': idx < transactions.length - 1 }"
            >
              <div 
                class="activity-icon-wrap"
                :class="t.type === 'TOP_UP' ? 'icon-topup' : 'icon-payment'"
              >
                <ion-icon :icon="t.type === 'TOP_UP' ? arrowDownOutline : arrowUpOutline" />
              </div>

              <div class="activity-details">
                <div class="activity-primary-line">
                  <span class="activity-student-name">{{ t.description || t.type }}</span>
                  <span 
                    class="pay-amount tabular-nums font-mono"
                    :class="t.type === 'TOP_UP' ? 'text-success' : 'text-danger'"
                  >
                    {{ t.type === 'TOP_UP' ? '+' : '-' }}{{ formatPeso(t.amount) }}
                  </span>
                </div>

                <div class="activity-sub-line">
                  <span class="activity-note font-mono">
                    {{ t.referenceNumber }} • {{ formatDateTime(t.createdAt) }}
                  </span>
                  <span class="status-badge badge-neutral">
                    {{ t.type }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="empty-state-box">
            <ion-icon :icon="walletOutline" class="empty-state-icon" />
            <p class="empty-state-title">No Transactions Yet</p>
            <p class="empty-state-sub">Add demo top-up funds to test payments.</p>
          </div>
        </section>
      </div>

      <!-- Top Up Sheet -->
      <UniSheet 
        :is-open="showTopUpModal" 
        title="Top Up Demo Wallet" 
        subtitle="Simulated funds for prototype testing"
        @close="showTopUpModal = false"
      >
        <div class="sheet-form-wrap">
          <p class="secondary-text">
            Add simulated funds to student's wallet for prototype testing. No real currency is transferred.
          </p>

          <UniFormField label="Top-Up Amount (PHP)" :required="true">
            <UniInput 
              v-model="topUpAmountPesos" 
              type="number" 
              min="1"
              :monospace="true"
            />
          </UniFormField>

          <UniFormField label="Note / Reference">
            <UniInput 
              v-model="topUpNote" 
              placeholder="e.g. CSG Booth replenishment"
            />
          </UniFormField>

          <div style="margin-top: 16px;">
            <UniButton 
              variant="primary" 
              :full-width="true" 
              :loading="isSubmitting" 
              @click="executeTopUp"
            >
              Confirm Demo Top-Up
            </UniButton>
          </div>
        </div>
      </UniSheet>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.student-header-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.student-text-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.student-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--app-text-primary);
  margin: 0;
}

.student-sub {
  font-size: 12px;
  color: var(--app-text-secondary);
  margin: 0;
}

.student-meta-tags {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.text-xs {
  font-size: 11px;
  color: var(--app-text-muted);
}

.nfc-tag-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  padding: 2px 7px;
  border-radius: 6px;
  color: var(--app-text-secondary);
}

/* Fintech Hero Card */
.fintech-hero-card {
  background: var(--app-fintech-hero-bg);
  color: var(--app-fintech-hero-text);
  border: 1px solid var(--app-fintech-hero-border);
  border-radius: 20px;
  padding: 22px 20px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.hero-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hero-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--app-fintech-hero-sub);
}

.hero-balance-figure {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #ffffff;
  line-height: 1.1;
}

.hero-bottom-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 4px;
}

.demo-subtle-pill {
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 7px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.topup-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  border-radius: var(--app-pill-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.35);
}

.topup-action-btn:active {
  transform: scale(0.96);
}

/* Activity Card */
.activity-card {
  padding: 0;
  overflow: hidden;
}

.activity-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.row-border {
  border-bottom: 1px solid var(--app-border);
}

.activity-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.icon-topup {
  background: rgba(21, 154, 116, 0.1);
  color: var(--ion-color-success);
}

.icon-payment {
  background: rgba(220, 75, 75, 0.1);
  color: var(--ion-color-danger);
}

.activity-details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.activity-primary-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.activity-student-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pay-amount {
  font-size: 13px;
  font-weight: 700;
}

.text-success { color: var(--ion-color-success); }
.text-danger { color: var(--ion-color-danger); }

.activity-sub-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.activity-note {
  font-size: 11px;
  color: var(--app-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Modal */
.modal-header-wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0 16px;
}

.modal-title-text {
  font-size: 16px;
  font-weight: 700;
  color: var(--app-text-primary);
}

.modal-cancel-btn {
  background: transparent;
  border: none;
  color: var(--ion-color-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.modal-inner-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
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

.clean-input {
  --background: var(--app-surface-subtle);
  --color: var(--app-text-primary);
  --padding-start: 12px;
  --padding-end: 12px;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  font-size: 14px;
  min-height: 44px;
}

.primary-submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 46px;
  border-radius: var(--app-btn-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 6px;
}
</style>
