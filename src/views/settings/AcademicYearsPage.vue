<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  IonPage,
  IonContent,
  IonIcon,
  IonSpinner
} from '@ionic/vue';
import {
  addOutline,
  createOutline,
  calendarOutline,
  schoolOutline
} from 'ionicons/icons';
import { UniPageHeader, UniDialog, UniButton, UniSelect, UniSheet } from '@/components/ui';

import { SystemSetupService } from '@/services/system-setup.service';
import { DataModeService } from '@/services/data-mode.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import type { AcademicYear, Semester } from '@/types/database';
import { formatAcademicYear } from '@/utilities/presentation-formatters';
import { haptics } from '@/utilities/haptics';
import { useToast } from '@/composables/useToast';

const { showToast } = useToast();

const academicYears = ref<AcademicYear[]>([]);
const semestersByYear = ref<Record<string, Semester[]>>({});
const isLoading = ref(true);

// Modals
const showAddModal = ref(false);
const showEditModal = ref(false);
const showStatusConfirm = ref(false);
const isSaving = ref(false);
const errorMessage = ref('');

const targetYear = ref<AcademicYear | null>(null);
const pendingStatus = ref<AcademicYear['status']>('ACTIVE');

const yearForm = ref({
  id: '',
  label: '',
  startsOn: '',
  endsOn: '',
  status: 'PLANNED' as AcademicYear['status'],
});

const statusOptions = [
  { value: 'PLANNED', label: 'PLANNED' },
  { value: 'UPCOMING', label: 'UPCOMING' },
  { value: 'ACTIVE', label: 'ACTIVE' },
  { value: 'CLOSED', label: 'CLOSED' },
  { value: 'ARCHIVED', label: 'ARCHIVED' },
];


async function loadData() {
  isLoading.value = true;
  try {
    if (DataModeService.isDirectSupabase()) {
      const valid = await SupabaseAuthService.hasValidCloudSession();
      if (!valid || SupabaseAuthService.role.value !== 'DEVADMIN') {
        isLoading.value = false;
        await showToast('Direct Supabase Mode requires an authenticated cloud DevAdmin session. Please sign in.', 'error');
        return;
      }
    }

    const list = await SystemSetupService.getAcademicYears();
    academicYears.value = list;

    // Load semesters for each year
    const semsMap: Record<string, Semester[]> = {};
    for (const ay of list) {
      semsMap[ay.id] = await SystemSetupService.getSemesters(ay.id);
    }
    semestersByYear.value = semsMap;
  } catch (err) {
    console.error('Failed to load academic years:', err);
  } finally {
    isLoading.value = false;
  }
}

function openAddModal() {
  haptics.light();
  const currentYearNum = new Date().getFullYear();
  yearForm.value = {
    id: '',
    label: `${currentYearNum}-${currentYearNum + 1}`,
    startsOn: `${currentYearNum}-08-01`,
    endsOn: `${currentYearNum + 1}-05-31`,
    status: 'PLANNED',
  };
  errorMessage.value = '';
  showAddModal.value = true;
}

function openEditModal(ay: AcademicYear) {
  haptics.light();
  yearForm.value = {
    id: ay.id,
    label: ay.label,
    startsOn: ay.starts_on,
    endsOn: ay.ends_on,
    status: ay.status,
  };
  errorMessage.value = '';
  showEditModal.value = true;
}

async function handleSave(isEdit: boolean) {
  errorMessage.value = '';
  if (!yearForm.value.label.trim()) {
    errorMessage.value = 'Academic Year label is required (e.g. "2026-2027").';
    return;
  }
  if (!yearForm.value.startsOn || !yearForm.value.endsOn) {
    errorMessage.value = 'Start and end dates are required.';
    return;
  }
  if (yearForm.value.startsOn >= yearForm.value.endsOn) {
    errorMessage.value = 'Start date must be before end date.';
    return;
  }

  isSaving.value = true;
  try {
    if (isEdit) {
      await SystemSetupService.updateAcademicYear(yearForm.value.id, {
        label: yearForm.value.label,
        startsOn: yearForm.value.startsOn,
        endsOn: yearForm.value.endsOn,
        status: yearForm.value.status,
      });
      showEditModal.value = false;
    } else {
      await SystemSetupService.createAcademicYear({
        label: yearForm.value.label,
        startsOn: yearForm.value.startsOn,
        endsOn: yearForm.value.endsOn,
        status: yearForm.value.status,
      });
      showAddModal.value = false;
    }
    haptics.success();
    await showToast(isEdit ? 'Academic year updated successfully' : 'Academic year configured successfully', 'success');
    await loadData();
  } catch (err: unknown) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to save academic year.';
    haptics.error();
  } finally {
    isSaving.value = false;
  }
}

function promptStatusChange(ay: AcademicYear, status: AcademicYear['status']) {
  haptics.light();
  targetYear.value = ay;
  pendingStatus.value = status;
  showStatusConfirm.value = true;
}

async function confirmStatusChange() {
  if (!targetYear.value) return;
  try {
    await SystemSetupService.setAcademicYearStatus(targetYear.value.id, pendingStatus.value);
    showStatusConfirm.value = false;
    targetYear.value = null;
    haptics.success();
    await showToast(`Academic year status updated to ${pendingStatus.value.toLowerCase()}`, 'success');
    await loadData();
  } catch (err: unknown) {
    showStatusConfirm.value = false;
    await showToast(err instanceof Error ? err.message : 'Failed to transition academic year status.', 'error');
    haptics.error();
  }
}

onMounted(loadData);
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Academic Years"
      subtitle="School periods, calendar years & statuses"
      :back-button="true"
      default-back-href="/settings/system-setup"
    />

    <ion-content class="academic-years-content">
      <div class="page-container">
        <!-- Top Toolbar -->
        <div class="toolbar-row">
          <span class="count-label">{{ academicYears.length }} School Period(s) Configured</span>
          <UniButton
            variant="primary"
            size="sm"
            :icon="addOutline"
            aria-label="Create new academic year"
            @click="openAddModal"
          >
            New
          </UniButton>
        </div>

        <!-- Academic Years List -->
        <div v-if="academicYears.length > 0" class="ay-cards-list">
          <div
            v-for="ay in academicYears"
            :key="ay.id"
            class="ay-card minimal-card"
            :class="{ 'is-active-year': ay.status === 'ACTIVE' }"
          >
            <div class="ay-main-col">
              <div class="ay-title-row">
                <span class="ay-label">{{ formatAcademicYear(ay.label) }}</span>
                <span class="raw-label font-mono">({{ ay.label }})</span>
                <span
                  class="status-pill font-mono"
                  :class="ay.status.toLowerCase()"
                >
                  {{ ay.status }}
                </span>
              </div>

              <div class="ay-dates-row">
                <span>📅 {{ ay.starts_on }} to {{ ay.ends_on }}</span>
              </div>

              <div class="ay-meta-row">
                <span class="sem-tag font-mono">
                  <ion-icon :icon="schoolOutline" />
                  {{ (semestersByYear[ay.id] || []).length }} semester(s) registered
                </span>
              </div>
            </div>

            <div class="ay-actions-col">
              <button
                class="icon-action-btn edit"
                title="Edit Dates"
                @click="openEditModal(ay)"
              >
                <ion-icon :icon="createOutline" />
              </button>

              <button
                v-if="ay.status !== 'ACTIVE'"
                class="status-btn activate"
                @click="promptStatusChange(ay, 'ACTIVE')"
              >
                Set Active
              </button>
              <button
                v-else
                class="status-btn close"
                @click="promptStatusChange(ay, 'CLOSED')"
              >
                Close Year
              </button>
            </div>
          </div>
        </div>

        <div v-else-if="!isLoading" class="empty-state minimal-card">
          <ion-icon :icon="calendarOutline" class="empty-icon" />
          <h3 class="empty-title">No Academic Years Found</h3>
          <p class="empty-desc">Create the institutional school period calendar.</p>
          <UniButton variant="primary" size="sm" @click="openAddModal">
            Create School Year
          </UniButton>
        </div>

        <div v-if="isLoading" class="loading-state">
          <ion-spinner name="crescent" />
          <span>Loading academic periods...</span>
        </div>
      </div>

      <!-- Add / Edit Academic Year Bottom Sheet -->
      <UniSheet
        :is-open="showAddModal || showEditModal"
        :title="showEditModal ? 'Edit Academic Year' : 'Create Academic Year'"
        :subtitle="showEditModal ? 'Modify calendar duration and dates.' : 'Define a new school period (e.g. 2026-2027).'"
        size="standard"
        @close="showAddModal = false; showEditModal = false"
      >
        <div class="sheet-form-content">
          <div v-if="errorMessage" class="error-banner">
            {{ errorMessage }}
          </div>

          <div class="form-group">
            <label class="form-label">Academic Year Label <span class="req">*</span></label>
            <input
              v-model="yearForm.label"
              type="text"
              placeholder="e.g. 2026-2027"
              class="form-input font-mono"
              required
            />
          </div>

          <div class="form-row-2">
            <div class="form-group">
              <label class="form-label">Starts On <span class="req">*</span></label>
              <input
                v-model="yearForm.startsOn"
                type="date"
                class="form-input"
                required
              />
            </div>
            <div class="form-group">
              <label class="form-label">Ends On <span class="req">*</span></label>
              <input
                v-model="yearForm.endsOn"
                type="date"
                class="form-input"
                required
              />
            </div>
          </div>

          <div v-if="showEditModal" class="form-group">
            <label class="form-label">Status</label>
            <UniSelect
              v-model="yearForm.status"
              :options="statusOptions"
              header="Select Status"
            />
          </div>
        </div>

        <template #footer>
          <div class="sheet-actions">
            <UniButton
              variant="outline"
              type="button"
              @click="showAddModal = false; showEditModal = false"
            >
              Cancel
            </UniButton>
            <UniButton
              variant="primary"
              type="button"
              :loading="isSaving"
              @click="handleSave(showEditModal)"
            >
              Save Academic Year
            </UniButton>
          </div>
        </template>
      </UniSheet>

      <!-- Status Transition Confirmation -->
      <UniDialog
        :is-open="showStatusConfirm"
        :title="pendingStatus === 'ACTIVE' ? 'Activate Academic Year' : 'Close Academic Year'"
        :description="pendingStatus === 'ACTIVE' 
          ? `Setting ${targetYear?.label} to ACTIVE will set any other active academic period to CLOSED. Proceed?`
          : `Closing ${targetYear?.label} will prevent future operational changes unless reopened. Historical events, attendance, and finances will remain preserved. Proceed?`"
        :confirm-text="pendingStatus === 'ACTIVE' ? 'Activate Year' : 'Close Year'"
        cancel-text="Cancel"
        :confirm-variant="pendingStatus === 'ACTIVE' ? 'primary' : 'warning'"
        @confirm="confirmStatusChange"
        @cancel="showStatusConfirm = false"
      />
    </ion-content>
  </ion-page>
</template>

<style scoped>
.academic-years-content {
  --background: var(--uni-background, #f8fafc);
}

.page-container {
  max-width: 600px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

@media (max-width: 380px) {
  .page-container {
    padding: 12px;
    gap: 10px;
  }
}

.count-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--uni-text-secondary, #64748b);
}

.minimal-card {
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 14px;
}

.ay-cards-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ay-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  gap: 12px;
}

.ay-card.is-active-year {
  border-left: 3px solid var(--uni-primary, #10b981);
}

.ay-main-col {
  flex: 1;
  min-width: 0;
}

.ay-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.ay-label {
  font-size: 16px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
}

.raw-label {
  font-size: 12px;
  color: var(--uni-text-muted, #94a3b8);
}

.status-pill {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 2px 7px;
  border-radius: 999px;
  text-transform: uppercase;
}

.status-pill.active {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.status-pill.planned,
.status-pill.upcoming {
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
}

.status-pill.closed,
.status-pill.archived {
  background: rgba(100, 116, 139, 0.12);
  color: #64748b;
}

.ay-dates-row {
  font-size: 13px;
  color: var(--uni-text-secondary, #64748b);
  margin-bottom: 6px;
}

.ay-meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--uni-text-muted, #94a3b8);
}

.sem-tag {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ay-actions-col {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.icon-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--uni-border, #e2e8f0);
  background: var(--uni-surface, #ffffff);
  color: var(--uni-text, #0f172a);
  font-size: 16px;
  cursor: pointer;
}

.status-btn {
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--uni-border, #e2e8f0);
}

.status-btn.activate {
  background: var(--uni-surface-secondary, #f1f5f9);
  color: var(--uni-primary, #10b981);
}

.status-btn.close {
  background: var(--uni-surface-secondary, #f1f5f9);
  color: var(--uni-text-muted, #94a3b8);
}

.dialog-form-fields,
.sheet-form-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  text-align: left;
}

.sheet-actions {
  display: flex;
  gap: 10px;
  width: 100%;
  justify-content: flex-end;
}

.form-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--uni-text, #0f172a);
}

.req {
  color: var(--uni-danger, #ef4444);
}

.form-input,
.form-select {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--uni-border, #e2e8f0);
  background: var(--uni-surface, #ffffff);
  color: var(--uni-text, #0f172a);
  font-size: 14px;
  outline: none;
}

.error-banner {
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.1);
  color: var(--uni-danger, #ef4444);
  font-size: 12px;
  font-weight: 500;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 36px 20px;
}

.empty-icon {
  font-size: 40px;
  color: var(--uni-text-muted, #94a3b8);
  margin-bottom: 8px;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--uni-text, #0f172a);
  margin: 0 0 4px 0;
}

.empty-desc {
  font-size: 13px;
  color: var(--uni-text-secondary, #64748b);
  margin: 0 0 16px 0;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  font-size: 13px;
  color: var(--uni-text-muted, #94a3b8);
}
</style>
