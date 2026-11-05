<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonInput,
  IonTextarea,
  IonSelect,
  IonSelectOption
} from '@ionic/vue';
import { checkmarkOutline, alertCircleOutline } from 'ionicons/icons';
import { studentService } from '@/services/student.service';
import { financeService } from '@/services/finance.service';
import { useOperationPolicy } from '@/composables/useOperationPolicy';
import type { Student } from '@/types/student';
import type { ChargeType, ChargeTemplate } from '@/types/finance';
import { centavosToPeso, pesoToCentavos } from '@/utilities/finance-formatters';
import { formatFullName } from '@/utilities/student-formatters';
import { UniPageHeader, UniButton } from '@/components/ui';

const route = useRoute();
const router = useRouter();
const { isPermitted, getDisabledReason } = useOperationPolicy();
const canCreateCharge = isPermitted('FINANCE_ASSESSMENTS_AND_RULES');
const createChargeDisabledReason = getDisabledReason('FINANCE_ASSESSMENTS_AND_RULES');

const students = ref<Student[]>([]);
const templates = ref<ChargeTemplate[]>([]);

const selectedStudentId = ref<string>((route.query.studentId as string) || '');
const selectedTemplateId = ref<string>('');
const title = ref('');
const chargeType = ref<ChargeType>('FINE');
const amountPesos = ref<number>(20);
const remarks = ref('');

const isSubmitting = ref(false);
const errorMessage = ref('');

async function loadData() {
  students.value = await studentService.getStudents();
  templates.value = await financeService.getTemplates();
}

onMounted(loadData);

function onTemplateChange() {
  const tmpl = templates.value.find(t => t.id === selectedTemplateId.value);
  if (tmpl) {
    title.value = tmpl.name;
    chargeType.value = tmpl.chargeType || (tmpl.type as any) || 'FINE';
    amountPesos.value = centavosToPeso(tmpl.defaultAmount ?? tmpl.defaultAmountCentavos ?? 0);
  }
}

async function handleSaveCharge() {
  errorMessage.value = '';
  if (!canCreateCharge.value) {
    errorMessage.value = createChargeDisabledReason.value || 'Creating financial charge rules requires an active internet connection.';
    return;
  }
  if (!selectedStudentId.value) {
    errorMessage.value = 'Please select a student.';
    return;
  }
  if (!title.value.trim()) {
    errorMessage.value = 'Please enter a charge title.';
    return;
  }
  if (amountPesos.value <= 0) {
    errorMessage.value = 'Amount must be greater than 0.';
    return;
  }

  isSubmitting.value = true;
  try {
    await financeService.issueCharge({
      studentId: selectedStudentId.value,
      chargeTemplateId: selectedTemplateId.value || undefined,
      title: title.value.trim(),
      chargeType: chargeType.value,
      issuedAmount: pesoToCentavos(Number(amountPesos.value)),
      remarks: remarks.value.trim()
    });

    router.replace('/finance/charges');
  } catch (err: unknown) {
    console.error('Error issuing charge:', err);
    errorMessage.value = err instanceof Error ? err.message : 'Error creating charge.';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Issue Charge"
      subtitle="Assign fee obligation to a student"
      :back-button="true"
      default-back-href="/finance/charges"
      variant="detail"
    />

    <ion-content class="safe-content">
      <div class="page-container">
        <form @submit.prevent="handleSaveCharge" class="form-layout">
          <!-- Error banner -->
          <div v-if="errorMessage" class="error-banner">
            {{ errorMessage }}
          </div>

          <!-- Section 1: Target Student -->
          <div class="minimal-card form-section-card">
            <h3 class="section-title-sm">Debtor Selection</h3>

            <div class="field-item">
              <label class="field-label">Target Student <span class="req">*</span></label>
              <ion-select 
                v-model="selectedStudentId" 
                interface="action-sheet" 
                :interface-options="{ header: 'Target Student' }"
                placeholder="Choose student"
                class="clean-select"
              >
                <ion-select-option v-for="s in students" :key="s.id" :value="s.id">
                  {{ formatFullName(s.firstName, s.middleName, s.lastName) }} ({{ s.studentNumber || s.section }})
                </ion-select-option>
              </ion-select>
            </div>
          </div>

          <!-- Section 2: Charge Information -->
          <div class="minimal-card form-section-card">
            <h3 class="section-title-sm">Obligation Details</h3>

            <div class="field-item">
              <label class="field-label">Pre-configured Template</label>
              <ion-select 
                v-model="selectedTemplateId" 
                interface="action-sheet" 
                :interface-options="{ header: 'Fee Template' }"
                placeholder="Select fee template (Optional)"
                class="clean-select"
                @ion-change="onTemplateChange"
              >
                <ion-select-option value="">None (Custom Charge)</ion-select-option>
                <ion-select-option v-for="t in templates" :key="t.id" :value="t.id">
                  {{ t.name }} — ₱{{ centavosToPeso(t.defaultAmount ?? t.defaultAmountCentavos ?? 0) }}
                </ion-select-option>
              </ion-select>
            </div>

            <div class="field-item">
              <label class="field-label">Charge Title <span class="req">*</span></label>
              <ion-input 
                v-model="title" 
                placeholder="e.g. Cleanup Drive Absence Fee"
                class="clean-input"
              />
            </div>

            <div class="category-and-amount-grid">
              <div class="field-item">
                <label class="field-label">Category</label>
                <ion-select 
                  v-model="chargeType" 
                  interface="action-sheet" 
                  :interface-options="{ header: 'Category' }"
                  class="clean-select"
                >
                  <ion-select-option value="FINE">Fine</ion-select-option>
                  <ion-select-option value="CONTRIBUTION">Contribution</ion-select-option>
                  <ion-select-option value="OTHER">Other</ion-select-option>
                </ion-select>
              </div>

              <div class="field-item">
                <label class="field-label">Amount (PHP) <span class="req">*</span></label>
                <ion-input 
                  v-model="amountPesos" 
                  type="number" 
                  min="1"
                  step="0.50"
                  class="clean-input font-mono"
                />
              </div>
            </div>

            <div class="field-item">
              <label class="field-label">Justification / Remarks</label>
              <ion-textarea 
                v-model="remarks" 
                placeholder="Reason or CSG policy reference..."
                :rows="2"
                class="clean-textarea"
              />
            </div>
          </div>

          <!-- Submit Button -->
          <div class="form-submit-row">
            <div v-if="!canCreateCharge" class="offline-warning-box">
              <ion-icon :icon="alertCircleOutline" class="warn-icon" />
              <div class="warn-text">
                <strong>Offline Mode</strong>
                <p>{{ createChargeDisabledReason }}</p>
              </div>
            </div>

            <UniButton 
              type="submit" 
              variant="primary"
              block
              :disabled="isSubmitting || !canCreateCharge"
              :loading="isSubmitting"
              :icon="checkmarkOutline"
            >
              Issue Student Charge
            </UniButton>
          </div>
        </form>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.form-layout {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.error-banner {
  padding: 10px 14px;
  border-radius: var(--app-btn-radius);
  background: rgba(220, 75, 75, 0.1);
  color: var(--ion-color-danger);
  font-size: 13px;
  font-weight: 500;
}

.form-section-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title-sm {
  font-size: 13px;
  font-weight: 650;
  color: var(--app-text-primary);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
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

.req {
  color: var(--ion-color-danger);
}

.category-and-amount-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.clean-input, .clean-select, .clean-textarea {
  --background: var(--app-surface-subtle);
  --color: var(--app-text-primary);
  --placeholder-color: var(--app-text-muted);
  --padding-start: 12px;
  --padding-end: 12px;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  font-size: 14px;
  min-height: 44px;
}

.clean-textarea {
  min-height: 70px;
}

.form-submit-row {
  margin-top: 4px;
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
  box-shadow: none;
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

.btn-spinner {
  width: 18px;
  height: 18px;
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
