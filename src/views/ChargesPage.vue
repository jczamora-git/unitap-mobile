<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonSpinner,
  onIonViewWillEnter
} from '@ionic/vue';
import { addOutline, banOutline, receiptOutline } from 'ionicons/icons';
import { financeService } from '@/services/finance.service';
import { studentService } from '@/services/student.service';
import type { StudentCharge } from '@/types/finance';
import type { Student } from '@/types/student';
import { formatPeso } from '@/utilities/finance-formatters';
import { formatFullName } from '@/utilities/student-formatters';
import { 
  UniPageHeader, 
  UniButton, 
  UniSegmentedControl, 
  UniEmptyState, 
  UniDialog,
  UniInput 
} from '@/components/ui';

const router = useRouter();
const voidReason = ref('');

const charges = ref<StudentCharge[]>([]);
const studentMap = ref<Record<string, Student>>({});
const filterSegment = ref<'ALL' | 'UNPAID' | 'PAID' | 'VOID'>('ALL');
const isLoading = ref(true);

const showVoidAlert = ref(false);
const voidingChargeId = ref<string>('');

async function loadCharges() {
  isLoading.value = true;
  try {
    charges.value = await financeService.getCharges();
    const students = await studentService.getStudents();
    const sMap: Record<string, Student> = {};
    students.forEach(s => { sMap[s.id] = s; });
    studentMap.value = sMap;
  } catch (err) {
    console.error('Error loading charges:', err);
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadCharges);
onIonViewWillEnter(loadCharges);

function filteredCharges() {
  if (filterSegment.value === 'UNPAID') {
    return charges.value.filter(c => c.status === 'UNPAID' || c.status === 'PARTIALLY_PAID');
  }
  if (filterSegment.value === 'PAID') {
    return charges.value.filter(c => c.status === 'PAID');
  }
  if (filterSegment.value === 'VOID') {
    return charges.value.filter(c => c.status === 'VOID');
  }
  return charges.value;
}

function promptVoid(charge: StudentCharge) {
  voidingChargeId.value = charge.id;
  showVoidAlert.value = true;
}

async function executeVoid(reason: string) {
  if (!voidingChargeId.value) return;
  try {
    await financeService.voidCharge(voidingChargeId.value, reason || 'Operator void');
    await loadCharges();
  } catch (err: unknown) {
    alert(err instanceof Error ? err.message : 'Error voiding charge');
  }
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Fee Obligations"
      subtitle="Student fees & contributions"
      :back-button="true"
      default-back-href="/tabs/finance"
      variant="detail"
    >
      <template #trailing>
        <UniButton
          size="sm"
          :icon="addOutline"
          @click="router.push('/finance/charges/create')"
        >
          Issue
        </UniButton>
      </template>
    </UniPageHeader>

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Segment Filters (4 pills, clean, non-truncated) -->
        <UniSegmentedControl
          v-model="filterSegment"
          :options="[
            { value: 'ALL', label: 'All' },
            { value: 'UNPAID', label: 'Unpaid' },
            { value: 'PAID', label: 'Paid' },
            { value: 'VOID', label: 'Void' }
          ]"
          size="sm"
        />

        <!-- Loading -->
        <div v-if="isLoading && charges.length === 0" class="loading-state">
          <ion-spinner name="crescent" color="primary" />
          <p class="metadata-text">Loading student charges...</p>
        </div>

        <!-- Charges List -->
        <div v-else-if="filteredCharges().length > 0" class="charges-list">
          <div 
            v-for="chg in filteredCharges()" 
            :key="chg.id" 
            class="minimal-card charge-card"
          >
            <div class="charge-top-line">
              <span class="type-badge">{{ chg.chargeType }}</span>
              <span 
                class="status-badge"
                :class="chg.status === 'PAID' ? 'badge-success' : (chg.status === 'VOID' ? 'badge-neutral' : 'badge-warning')"
              >
                {{ chg.status }}
              </span>
            </div>

            <div class="charge-main-info">
              <h3 class="charge-title">{{ chg.title }}</h3>
              <p class="charge-student font-semibold">
                {{ studentMap[chg.studentId] ? formatFullName(studentMap[chg.studentId].firstName, studentMap[chg.studentId].middleName, studentMap[chg.studentId].lastName) : 'Student #' + chg.studentId.slice(0, 6) }}
              </p>
              <p v-if="chg.remarks" class="charge-remarks">{{ chg.remarks }}</p>
            </div>

            <div class="charge-finance-row">
              <div class="amount-col">
                <span class="amount-lbl">Total Issued</span>
                <span class="amount-val tabular-nums font-mono">{{ formatPeso(chg.issuedAmount) }}</span>
              </div>
              <div class="amount-col">
                <span class="amount-lbl">Remaining</span>
                <span 
                  class="amount-val tabular-nums font-mono"
                  :class="(chg.issuedAmount - chg.paidAmount) > 0 ? 'text-danger' : 'text-success'"
                >
                  {{ formatPeso(chg.issuedAmount - chg.paidAmount) }}
                </span>
              </div>
            </div>

            <div v-if="chg.status === 'UNPAID' || chg.status === 'PARTIALLY_PAID'" class="charge-footer-action">
              <UniButton 
                variant="destructive" 
                size="sm" 
                :icon="banOutline" 
                @click="promptVoid(chg)"
              >
                Void Charge
              </UniButton>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <UniEmptyState
          v-else
          :icon="receiptOutline"
          title="No charges found"
          description="There are no fee obligations matching the selected filter."
          action-text="Issue New Charge"
          :action-icon="addOutline"
          @action="router.push('/finance/charges/create')"
        />
      </div>

      <!-- Void Prompt Dialog -->
      <UniDialog
        v-model:is-open="showVoidAlert"
        title="Void Charge"
        description="Enter a justification note for voiding this student obligation."
        confirm-text="Confirm Void"
        cancel-text="Cancel"
        :destructive="true"
        type="destructive"
        @confirm="executeVoid(voidReason)"
        @cancel="showVoidAlert = false; voidReason = ''"
      >
        <UniInput
          v-model="voidReason"
          placeholder="e.g. Waived due to CSG officer exemption"
          style="margin-bottom: 12px; width: 100%;"
        />
      </UniDialog>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.add-charge-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: var(--app-pill-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.filter-tabs-row {
  display: flex;
  background: var(--app-surface-subtle);
  padding: 4px;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  gap: 4px;
}

.tab-pill {
  flex: 1;
  padding: 6px 8px;
  border-radius: 9px;
  border: none;
  background: transparent;
  color: var(--app-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  transition: all 0.15s ease;
}

.tab-pill-active {
  background: var(--app-surface);
  color: var(--app-text-primary);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  gap: 8px;
}

.charges-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.charge-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.charge-top-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.type-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--ion-color-primary);
  background: var(--app-accent-soft);
  padding: 2px 8px;
  border-radius: 6px;
}

.charge-main-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.charge-title {
  font-size: 15px;
  font-weight: 650;
  color: var(--app-text-primary);
  margin: 0;
}

.charge-student {
  font-size: 13px;
  color: var(--app-text-secondary);
  margin: 0;
}

.charge-remarks {
  font-size: 12px;
  color: var(--app-text-muted);
  margin: 2px 0 0 0;
}

.charge-finance-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--app-surface-subtle);
  border-radius: 10px;
  padding: 8px 12px;
}

.amount-col {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.amount-lbl {
  font-size: 10px;
  color: var(--app-text-muted);
  text-transform: uppercase;
  font-weight: 600;
}

.amount-val {
  font-size: 14px;
  font-weight: 700;
  color: var(--app-text-primary);
}

.text-danger { color: var(--ion-color-danger); }
.text-success { color: var(--ion-color-success); }

.charge-footer-action {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--app-border);
  padding-top: 8px;
}

.void-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: var(--ion-color-danger);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 6px;
}

.primary-compact-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--app-btn-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 4px;
}
</style>
