<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

import {
  IonPage,
  IonContent,
  IonIcon,
  IonSpinner
} from '@ionic/vue';
import {
  addOutline,
  createOutline,
  schoolOutline,
  checkmarkCircle,
  trashOutline
} from 'ionicons/icons';
import {
  UniPageHeader,
  UniDialog,
  UniButton,
  UniSelect,
  UniSheet,
  UniExpandableRow,
} from '@/components/ui';

import { SystemSetupService } from '@/services/system-setup.service';
import { DataModeService } from '@/services/data-mode.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { useAuth } from '@/composables/useAuth';
import type { Semester, AcademicYear } from '@/types/database';
import { formatSemesterName, formatAcademicYear } from '@/utilities/presentation-formatters';
import { haptics } from '@/utilities/haptics';
import { useToast } from '@/composables/useToast';

const { showToast } = useToast();
const { isDevAdmin } = useAuth();

const semesters = ref<Semester[]>([]);
const academicYears = ref<AcademicYear[]>([]);
const semesterStats = ref<Record<string, { enrolledCount: number; eventCount: number }>>({});
const activeSemester = ref<Semester | null>(null);
const isLoading = ref(true);

// Modals
const showAddModal = ref(false);
const showEditModal = ref(false);
const showActivateConfirm = ref(false);
const isSaving = ref(false);
const errorMessage = ref('');

const targetSemesterForActivation = ref<Semester | null>(null);

const semesterForm = ref({
  id: '',
  academicYearId: '',
  term: 'FIRST' as Semester['term'],
  startsOn: '',
  endsOn: '',
  status: 'PLANNED' as Semester['status'],
});

const academicYearOptions = computed(() =>
  academicYears.value.map((ay) => ({
    value: ay.id,
    label: `${formatAcademicYear(ay.label)} (${ay.label})`,
  }))
);

const termOptions = [
  { value: 'FIRST', label: '1st Semester (FIRST)' },
  { value: 'SECOND', label: '2nd Semester (SECOND)' },
  { value: 'SUMMER', label: 'Summer Term (SUMMER)' },
];

const semesterStatusOptions = [
  { value: 'PLANNED', label: 'PLANNED' },
  { value: 'ACTIVE', label: 'ACTIVE' },
  { value: 'CLOSED', label: 'CLOSED' },
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

    const [sems, ays, active] = await Promise.all([
      SystemSetupService.getSemesters(),
      SystemSetupService.getAcademicYears(),
      SystemSetupService.getActiveSemester(),
    ]);
    semesters.value = sems;
    academicYears.value = ays;
    activeSemester.value = active;

    const statsMap: Record<string, { enrolledCount: number; eventCount: number }> = {};
    for (const sem of sems) {
      statsMap[sem.id] = await SystemSetupService.getSemesterStats(sem.id);
    }
    semesterStats.value = statsMap;
  } catch (err) {
    console.error('Failed to load semesters:', err);
  } finally {
    isLoading.value = false;
  }
}

function getYearLabel(yearId: string): string {
  const ay = academicYears.value.find((y) => y.id === yearId);
  return ay ? formatAcademicYear(ay.label) : yearId;
}

function openAddModal() {
  haptics.light();
  const currentYear = new Date().getFullYear();
  semesterForm.value = {
    id: '',
    academicYearId: academicYears.value[0]?.id || '',
    term: 'FIRST',
    startsOn: `${currentYear}-08-01`,
    endsOn: `${currentYear}-12-15`,
    status: 'PLANNED',
  };
  errorMessage.value = '';
  showAddModal.value = true;
}

function openEditModal(sem: Semester) {
  haptics.light();
  semesterForm.value = {
    id: sem.id,
    academicYearId: sem.academic_year_id,
    term: sem.term,
    startsOn: sem.starts_on,
    endsOn: sem.ends_on,
    status: sem.status,
  };
  errorMessage.value = '';
  showEditModal.value = true;
}

async function handleSave(isEdit: boolean) {
  errorMessage.value = '';
  if (!semesterForm.value.academicYearId) {
    errorMessage.value = 'Academic Year is required.';
    return;
  }
  if (!semesterForm.value.startsOn || !semesterForm.value.endsOn) {
    errorMessage.value = 'Start and end dates are required.';
    return;
  }
  if (semesterForm.value.startsOn >= semesterForm.value.endsOn) {
    errorMessage.value = 'Start date must be before end date.';
    return;
  }

  isSaving.value = true;
  try {
    if (isEdit) {
      await SystemSetupService.updateSemester(semesterForm.value.id, {
        term: semesterForm.value.term,
        startsOn: semesterForm.value.startsOn,
        endsOn: semesterForm.value.endsOn,
        status: semesterForm.value.status,
      });
      showEditModal.value = false;
    } else {
      await SystemSetupService.createSemester({
        academicYearId: semesterForm.value.academicYearId,
        term: semesterForm.value.term,
        startsOn: semesterForm.value.startsOn,
        endsOn: semesterForm.value.endsOn,
      });
      showAddModal.value = false;
    }
    haptics.success();
    await showToast(isEdit ? 'Semester updated successfully' : 'Semester configured successfully', 'success');
    await loadData();
  } catch (err: unknown) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to save semester.';
    haptics.error();
  } finally {
    isSaving.value = false;
  }
}

function promptActivation(sem: Semester) {
  haptics.light();
  targetSemesterForActivation.value = sem;
  showActivateConfirm.value = true;
}

async function confirmActivation() {
  if (!targetSemesterForActivation.value) return;
  try {
    await SystemSetupService.activateSemester(targetSemesterForActivation.value.id);
    showActivateConfirm.value = false;
    targetSemesterForActivation.value = null;
    haptics.success();
    await showToast('Semester activated successfully', 'success');
    await loadData();
  } catch (err: unknown) {
    showActivateConfirm.value = false;
    await showToast(err instanceof Error ? err.message : 'Failed to activate semester.', 'error');
    haptics.error();
  }
}

const showDeleteConfirm = ref(false);
const semesterToDelete = ref<Semester | null>(null);
const isDeleting = ref(false);

function promptDelete(sem: Semester) {
  haptics.light();
  semesterToDelete.value = sem;
  showDeleteConfirm.value = true;
}

async function confirmDelete() {
  if (!semesterToDelete.value) return;
  isDeleting.value = true;
  try {
    await SystemSetupService.deleteSemester(semesterToDelete.value.id);
    showDeleteConfirm.value = false;
    semesterToDelete.value = null;
    haptics.success();
    await showToast('Semester deleted successfully', 'success');
    await loadData();
  } catch (err: unknown) {
    showDeleteConfirm.value = false;
    await showToast(err instanceof Error ? err.message : 'Cannot delete semester.', 'error');
    haptics.error();
  } finally {
    isDeleting.value = false;
  }
}

onMounted(loadData);
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Semesters"
      subtitle="Active operational term & academic schedules"
      :back-button="true"
      default-back-href="/settings/system-setup"
    />

    <ion-content class="semesters-content">
      <div class="page-container">
        <!-- Active Term Highlight Card -->
        <div v-if="activeSemester" class="active-term-card minimal-card">
          <div class="active-badge font-mono">
            <span class="active-dot"></span> CURRENT ACTIVE SEMESTER
          </div>
          <div class="active-title">
            {{ formatSemesterName(activeSemester.term) }} • {{ getYearLabel(activeSemester.academic_year_id) }}
          </div>
          <div class="active-dates">
            📅 {{ activeSemester.starts_on }} to {{ activeSemester.ends_on }}
          </div>
          <div class="active-stats font-mono">
            <span>{{ semesterStats[activeSemester.id]?.enrolledCount ?? 0 }} Students Enrolled</span>
            <span>•</span>
            <span>{{ semesterStats[activeSemester.id]?.eventCount ?? 0 }} Events</span>
          </div>
        </div>

        <div v-else class="no-active-banner minimal-card">
          ⚠️ No semester is currently set to ACTIVE. Please activate an operational term below.
        </div>

        <!-- Toolbar -->
        <div class="toolbar-row">
          <span class="count-label">{{ semesters.length }} Semester Term(s)</span>
          <UniButton
            variant="primary"
            size="sm"
            :icon="addOutline"
            aria-label="Create new semester"
            @click="openAddModal"
          >
            New
          </UniButton>
        </div>

        <!-- Semesters List (Adaptive Expandable Rows) -->
        <div v-if="semesters.length > 0" class="semesters-list">
          <UniExpandableRow
            v-for="sem in semesters"
            :key="sem.id"
            :title="formatSemesterName(sem.term)"
            :subtitle="`${getYearLabel(sem.academic_year_id)} • ${sem.starts_on} — ${sem.ends_on}`"
            :badge="sem.status"
            :badge-variant="sem.status === 'ACTIVE' ? 'success' : (sem.status === 'PLANNED' ? 'primary' : 'neutral')"
            :class="{ 'is-active-sem-row': sem.status === 'ACTIVE' }"
          >
            <template #content>
              <div class="sem-expanded-details">
                <div class="sem-details-grid">
                  <div class="sem-detail-cell">
                    <span class="detail-label">Academic Year</span>
                    <span class="detail-val font-bold">{{ getYearLabel(sem.academic_year_id) }}</span>
                  </div>
                  <div class="sem-detail-cell">
                    <span class="detail-label">Date Duration</span>
                    <span class="detail-val font-mono">📅 {{ sem.starts_on }} — {{ sem.ends_on }}</span>
                  </div>
                  <div class="sem-detail-cell">
                    <span class="detail-label">Enrolled Students</span>
                    <span class="detail-val font-mono">👥 {{ semesterStats[sem.id]?.enrolledCount ?? 0 }} enrolled</span>
                  </div>
                  <div class="sem-detail-cell">
                    <span class="detail-label">Linked Events</span>
                    <span class="detail-val font-mono">🗓️ {{ semesterStats[sem.id]?.eventCount ?? 0 }} events</span>
                  </div>
                </div>
              </div>
            </template>

            <template #actions>
              <div class="sem-row-actions">
                <UniButton
                  variant="outline"
                  size="sm"
                  :icon="createOutline"
                  @click.stop="openEditModal(sem)"
                >
                  Edit
                </UniButton>
                <UniButton
                  v-if="sem.status !== 'ACTIVE'"
                  variant="primary"
                  size="sm"
                  :icon="checkmarkCircle"
                  @click.stop="promptActivation(sem)"
                >
                  Set Active
                </UniButton>
                <span v-else class="active-badge-indicator font-mono">
                  ✓ Current Active Term
                </span>
                <UniButton
                  v-if="isDevAdmin"
                  variant="destructive"
                  size="sm"
                  :icon="trashOutline"
                  @click.stop="promptDelete(sem)"
                >
                  Delete
                </UniButton>
              </div>
            </template>
          </UniExpandableRow>
        </div>

        <div v-else-if="!isLoading" class="empty-state minimal-card">
          <ion-icon :icon="schoolOutline" class="empty-icon" />
          <h3 class="empty-title">No Semesters Found</h3>
          <p class="empty-desc">Create academic terms under configured school years.</p>
          <UniButton variant="primary" size="sm" @click="openAddModal">
            Create First Semester
          </UniButton>
        </div>

        <div v-if="isLoading" class="loading-state">
          <ion-spinner name="crescent" />
          <span>Loading semesters...</span>
        </div>
      </div>

      <!-- Add / Edit Semester Bottom Sheet -->
      <UniSheet
        :is-open="showAddModal || showEditModal"
        :title="showEditModal ? 'Edit Semester' : 'Create Semester'"
        :subtitle="showEditModal ? 'Modify semester term dates.' : 'Define a new semester under an academic year.'"
        size="standard"
        @close="showAddModal = false; showEditModal = false"
      >
        <div class="sheet-form-content">
          <div v-if="errorMessage" class="error-banner">
            {{ errorMessage }}
          </div>

          <div class="form-group">
            <label class="form-label">Academic Year <span class="req">*</span></label>
            <UniSelect
              v-model="semesterForm.academicYearId"
              :options="academicYearOptions"
              :disabled="showEditModal"
              placeholder="Select Parent Academic Year"
              header="Select Academic Year"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Term <span class="req">*</span></label>
            <UniSelect
              v-model="semesterForm.term"
              :options="termOptions"
              header="Select Term"
            />
          </div>

          <div class="form-row-2">
            <div class="form-group">
              <label class="form-label">Starts On <span class="req">*</span></label>
              <input
                v-model="semesterForm.startsOn"
                type="date"
                class="form-input"
                required
              />
            </div>
            <div class="form-group">
              <label class="form-label">Ends On <span class="req">*</span></label>
              <input
                v-model="semesterForm.endsOn"
                type="date"
                class="form-input"
                required
              />
            </div>
          </div>

          <div v-if="showEditModal" class="form-group">
            <label class="form-label">Status</label>
            <UniSelect
              v-model="semesterForm.status"
              :options="semesterStatusOptions"
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
              Save Semester
            </UniButton>
          </div>
        </template>
      </UniSheet>

      <!-- Activate Confirmation -->
      <UniDialog
        :is-open="showActivateConfirm"
        title="Activate Semester"
        :description="`Activating ${formatSemesterName(targetSemesterForActivation?.term)} will automatically transition any currently active term to CLOSED. All subsequent operational attendances and fines will scope to this new term. Proceed?`"
        confirm-text="Activate Semester"
        cancel-text="Cancel"
        confirm-variant="primary"
        @confirm="confirmActivation"
        @cancel="showActivateConfirm = false"
      />

      <!-- Delete Confirmation Dialog -->
      <UniDialog
        :is-open="showDeleteConfirm"
        title="Delete Semester Term"
        :description="`Are you sure you want to permanently delete '${formatSemesterName(semesterToDelete?.term)}'? This will remove non-financial associated records. If financial records exist, deletion will be blocked.`"
        :confirm-text="isDeleting ? 'Deleting...' : 'Delete Semester'"
        cancel-text="Cancel"
        confirm-variant="danger"
        @confirm="confirmDelete"
        @cancel="showDeleteConfirm = false"
      />
    </ion-content>
  </ion-page>
</template>

<style scoped>
.semesters-content {
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

.minimal-card {
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 14px;
}

.active-term-card {
  padding: 16px;
  border-left: 3px solid var(--uni-primary, #10b981);
}

.active-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--uni-primary, #10b981);
  margin-bottom: 4px;
}

.active-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--uni-primary, #10b981);
}

.active-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
  margin-bottom: 4px;
}

.active-dates {
  font-size: 13px;
  color: var(--uni-text-secondary, #64748b);
  margin-bottom: 8px;
}

.active-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--uni-text-muted, #94a3b8);
}

.no-active-banner {
  padding: 14px 16px;
  font-size: 13px;
  color: #b45309;
  background: rgba(245, 158, 11, 0.08);
  border-color: rgba(245, 158, 11, 0.2);
}

.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.count-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--uni-text-secondary, #64748b);
}

.semesters-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.semesters-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.is-active-sem-row {
  border-left: 4px solid var(--uni-btn-primary-bg, #0F766E);
}

:global(.dark) .is-active-sem-row,
:global(.ion-palette-dark) .is-active-sem-row {
  border-left-color: var(--uni-primary, #5EEAD4);
}

.sem-expanded-details {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sem-details-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
  padding: 8px 10px;
  background: var(--uni-surface, #ffffff);
  border-radius: 8px;
  border: 1px solid var(--uni-border, #e2e8f0);
}

:global(.dark) .sem-details-grid,
:global(.ion-palette-dark) .sem-details-grid {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #333846);
}

.sem-detail-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--uni-text-muted, #94a3b8);
}

.detail-val {
  font-size: 12.5px;
  color: var(--uni-text, #0f172a);
}

:global(.dark) .detail-val,
:global(.ion-palette-dark) .detail-val {
  color: var(--uni-text, #f1f5f9);
}

.sem-row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
  justify-content: flex-end;
}

.active-badge-indicator {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--uni-btn-primary-bg, #0F766E);
  padding: 4px 8px;
}

:global(.dark) .active-badge-indicator,
:global(.ion-palette-dark) .active-badge-indicator {
  color: var(--uni-primary, #5EEAD4);
}

@media (max-width: 380px) {
  .page-container {
    padding: 12px;
  }

  .sem-row-actions {
    justify-content: stretch;
  }

  .sem-row-actions > * {
    flex: 1 1 auto;
    min-width: 80px;
  }
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
