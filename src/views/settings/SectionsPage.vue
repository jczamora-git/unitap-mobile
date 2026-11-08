<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  IonPage,
  IonContent,
  IonIcon,
  IonSpinner,
  IonSearchbar
} from '@ionic/vue';
import {
  addOutline,
  createOutline,
  checkmarkCircle,
  closeCircleOutline,
  gridOutline,
  filterOutline,
  trashOutline,
} from 'ionicons/icons';

import {
  UniPageHeader,
  UniButton,
  UniSelect,
  UniTreeView,
  UniFilterChip,
  UniFilterSheet,
  UniSheet,
  UniDialog,
} from '@/components/ui';

import { SystemSetupService } from '@/services/system-setup.service';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { DataModeService } from '@/services/data-mode.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { useAuth } from '@/composables/useAuth';
import type { SectionRecord, YearLevel, AcademicYear, Program } from '@/types/database';
import { haptics } from '@/utilities/haptics';
import { useToast } from '@/composables/useToast';

const { showToast } = useToast();
const { isDevAdmin } = useAuth();

const sections = ref<(SectionRecord & { year_display?: string; program_code?: string })[]>([]);
const yearLevels = ref<YearLevel[]>([]);
const academicYears = ref<AcademicYear[]>([]);
const programs = ref<Program[]>([]);
const enrollmentCounts = ref<Record<string, number>>({});
const isLoading = ref(true);

// Filters
const searchQuery = ref('');
const filterYearLevelId = ref('');
const filterProgramId = ref('');
const filterAcademicYearId = ref('');

// Filter Sheet Draft State
const isFilterSheetOpen = ref(false);
const draftYearLevelId = ref('');
const draftProgramId = ref('');
const draftAcademicYearId = ref('');

const activeFiltersCount = computed(() => {
  let count = 0;
  if (filterYearLevelId.value) count++;
  if (filterProgramId.value) count++;
  if (filterAcademicYearId.value) count++;
  return count;
});

const activeYearLevelLabel = computed(() => {
  const yl = yearLevels.value.find((y) => y.id === filterYearLevelId.value);
  return yl ? yl.display_name : '';
});

const activeProgramLabel = computed(() => {
  const p = programs.value.find((pr) => pr.id === filterProgramId.value);
  return p ? p.code : '';
});

const activeAcademicYearLabel = computed(() => {
  const ay = academicYears.value.find((a) => a.id === filterAcademicYearId.value);
  return ay ? ay.label : '';
});

function openFilterSheet() {
  draftYearLevelId.value = filterYearLevelId.value;
  draftProgramId.value = filterProgramId.value;
  draftAcademicYearId.value = filterAcademicYearId.value;
  isFilterSheetOpen.value = true;
}

function applyFilters() {
  filterYearLevelId.value = draftYearLevelId.value;
  filterProgramId.value = draftProgramId.value;
  filterAcademicYearId.value = draftAcademicYearId.value;
}

function resetDraftFilters() {
  draftYearLevelId.value = '';
  draftProgramId.value = '';
  draftAcademicYearId.value = '';
}

function clearAllFilters() {
  filterYearLevelId.value = '';
  filterProgramId.value = '';
  filterAcademicYearId.value = '';
}

// Modals
const showAddModal = ref(false);
const showEditModal = ref(false);
const isSaving = ref(false);
const errorMessage = ref('');

const sectionForm = ref({
  id: '',
  sectionName: '',
  yearLevelId: '',
  programId: '',
  academicYearId: '',
  status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
});

const filteredSections = computed(() => {
  let list = sections.value;
  if (filterYearLevelId.value) {
    list = list.filter((s) => s.year_level_id === filterYearLevelId.value);
  }
  if (filterProgramId.value) {
    list = list.filter((s) => s.program_id === filterProgramId.value);
  }
  if (filterAcademicYearId.value) {
    list = list.filter((s) => s.academic_year_id === filterAcademicYearId.value);
  }
  const query = searchQuery.value.trim().toLowerCase();
  if (query) {
    list = list.filter(
      (s) =>
        s.section_name.toLowerCase().includes(query) ||
        (s.year_display && s.year_display.toLowerCase().includes(query)) ||
        (s.program_code && s.program_code.toLowerCase().includes(query))
    );
  }
  return list;
});

const yearLevelOptions = computed(() => [
  { value: '', label: 'All Year Levels' },
  ...yearLevels.value.map((yl) => ({ value: yl.id, label: yl.display_name })),
]);

const programOptions = computed(() => [
  { value: '', label: 'All Programs' },
  ...programs.value.map((p) => ({ value: p.id, label: p.code })),
]);

const academicYearOptions = computed(() => [
  { value: '', label: 'All Academic Years' },
  ...academicYears.value.map((ay) => ({ value: ay.id, label: ay.label })),
]);

const formYearLevelOptions = computed(() =>
  yearLevels.value.map((yl) => ({ value: yl.id, label: `${yl.display_name} (Year ${yl.level_number})` }))
);

const formProgramOptions = computed(() => [
  { value: '', label: 'General / All Programs' },
  ...programs.value.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })),
]);

const formAcademicYearOptions = computed(() => [
  { value: '', label: 'All Academic Years' },
  ...academicYears.value.map((ay) => ({ value: ay.id, label: ay.label })),
]);

const statusOptions = [
  { value: 'ACTIVE', label: 'ACTIVE' },
  { value: 'INACTIVE', label: 'INACTIVE' },
];

const sectionTreeNodes = computed(() => {
  const relevantYLs = filterYearLevelId.value
    ? yearLevels.value.filter((yl) => yl.id === filterYearLevelId.value)
    : yearLevels.value;

  return relevantYLs.map((yl) => {
    const childrenForYL = filteredSections.value
      .filter((s) => s.year_level_id === yl.id)
      .map((sec) => ({
        id: sec.id,
        label: sec.section_name,
        badge: sec.status,
        badgeVariant: (sec.status === 'ACTIVE' ? 'success' : 'neutral') as any,
        meta: `${enrollmentCounts.value[sec.id] ?? 0} enrolled`,
        rawSection: sec,
      }));

    return {
      id: yl.id,
      label: `${yl.display_name} (Year ${yl.level_number})`,
      count: childrenForYL.length,
      children: childrenForYL,
    };
  });
});


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

    const [yls, ays, progs] = await Promise.all([
      SystemSetupService.getYearLevels(true),
      SystemSetupService.getAcademicYears(),
      AcademicRepository.getPrograms(),
    ]);
    yearLevels.value = yls;
    academicYears.value = ays;
    programs.value = progs;

    const list = await SystemSetupService.getSections({ includeInactive: true });
    sections.value = list;

    // Load enrollment count for each section
    const counts: Record<string, number> = {};
    for (const sec of list) {
      counts[sec.id] = await SystemSetupService.getSectionEnrollmentCount(sec.id);
    }
    enrollmentCounts.value = counts;
  } catch (err) {
    console.error('Failed to load sections and relations:', err);
  } finally {
    isLoading.value = false;
  }
}

function openAddModal() {
  haptics.light();
  sectionForm.value = {
    id: '',
    sectionName: '',
    yearLevelId: yearLevels.value[0]?.id || '',
    programId: programs.value[0]?.id || '',
    academicYearId: academicYears.value[0]?.id || '',
    status: 'ACTIVE',
  };
  errorMessage.value = '';
  showAddModal.value = true;
}

function openEditModal(sec: SectionRecord) {
  haptics.light();
  sectionForm.value = {
    id: sec.id,
    sectionName: sec.section_name,
    yearLevelId: sec.year_level_id,
    programId: sec.program_id || '',
    academicYearId: sec.academic_year_id || '',
    status: sec.status,
  };
  errorMessage.value = '';
  showEditModal.value = true;
}

async function handleSave(isEdit: boolean) {
  errorMessage.value = '';
  if (!sectionForm.value.sectionName.trim()) {
    errorMessage.value = 'Section Name is required (e.g. "4F4").';
    return;
  }
  if (!sectionForm.value.yearLevelId) {
    errorMessage.value = 'Year Level is required.';
    return;
  }

  isSaving.value = true;
  try {
    if (isEdit) {
      await SystemSetupService.updateSection(sectionForm.value.id, {
        sectionName: sectionForm.value.sectionName,
        yearLevelId: sectionForm.value.yearLevelId,
        programId: sectionForm.value.programId || null,
        academicYearId: sectionForm.value.academicYearId || null,
        status: sectionForm.value.status,
      });
      showEditModal.value = false;
    } else {
      await SystemSetupService.createSection({
        sectionName: sectionForm.value.sectionName,
        yearLevelId: sectionForm.value.yearLevelId,
        programId: sectionForm.value.programId || null,
        academicYearId: sectionForm.value.academicYearId || null,
      });
      showAddModal.value = false;
    }
    haptics.success();
    await showToast(isEdit ? 'Section updated successfully' : 'Section created successfully', 'success');
    await loadData();
  } catch (err: unknown) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to save section.';
    haptics.error();
  } finally {
    isSaving.value = false;
  }
}

async function handleToggleStatus(sec: SectionRecord) {
  haptics.medium();
  try {
    await SystemSetupService.toggleSectionStatus(sec.id);
    await showToast(`Section ${sec.section_name} ${sec.status === 'ACTIVE' ? 'deactivated' : 'activated'}`, 'info');
    await loadData();
  } catch (err) {
    console.error('Failed to toggle section status:', err);
  }
}

const showDeleteConfirm = ref(false);
const sectionToDelete = ref<SectionRecord | null>(null);
const isDeleting = ref(false);

function promptDelete(sec: SectionRecord) {
  haptics.light();
  sectionToDelete.value = sec;
  showDeleteConfirm.value = true;
}

async function confirmDelete() {
  if (!sectionToDelete.value) return;
  isDeleting.value = true;
  try {
    await SystemSetupService.deleteSection(sectionToDelete.value.id);
    showDeleteConfirm.value = false;
    sectionToDelete.value = null;
    haptics.success();
    await showToast('Section deleted successfully', 'success');
    await loadData();
  } catch (err: unknown) {
    showDeleteConfirm.value = false;
    await showToast(err instanceof Error ? err.message : 'Cannot delete section.', 'error');
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
      title="Sections"
      subtitle="Section offerings by year level & program"
      :back-button="true"
      default-back-href="/settings/system-setup"
    />

    <ion-content class="sections-content">
      <div class="page-container">
        <!-- Search & New Button -->
        <div class="toolbar-row">
          <ion-searchbar
            v-model="searchQuery"
            placeholder="Search section..."
            class="clean-searchbar"
            :debounce="200"
          />
          <UniButton
            variant="primary"
            size="sm"
            :icon="addOutline"
            aria-label="Create new section"
            @click="openAddModal"
          >
            New
          </UniButton>
        </div>

        <!-- Compact Filter Bar -->
        <div class="compact-filter-bar">
          <div class="filter-top-row">
            <span class="filter-headline">Filter Offerings</span>
            <UniButton
              variant="outline"
              size="sm"
              :icon="filterOutline"
              class="btn-open-filters"
              @click="openFilterSheet"
            >
              Filters
              <span v-if="activeFiltersCount > 0" class="filter-badge-counter">
                ({{ activeFiltersCount }})
              </span>
            </UniButton>
          </div>

          <!-- Active Filter Chips -->
          <div v-if="activeFiltersCount > 0" class="active-chips-row">
            <UniFilterChip
              v-if="filterYearLevelId"
              :label="activeYearLevelLabel"
              variant="primary"
              @remove="filterYearLevelId = ''"
            />
            <UniFilterChip
              v-if="filterProgramId"
              :label="activeProgramLabel"
              variant="primary"
              @remove="filterProgramId = ''"
            />
            <UniFilterChip
              v-if="filterAcademicYearId"
              :label="activeAcademicYearLabel"
              variant="primary"
              @remove="filterAcademicYearId = ''"
            />
            <button
              type="button"
              class="btn-clear-all"
              @click="clearAllFilters"
            >
              Clear all
            </button>
          </div>
        </div>

        <!-- Sections Hierarchical Tree View (Year Level -> Sections) -->
        <div v-if="filteredSections.length > 0" class="sections-tree-wrapper">
          <UniTreeView :nodes="sectionTreeNodes" :default-expand-all="true">
            <template #child-actions="{ child }">
              <div class="sec-tree-actions">
                <button
                  type="button"
                  class="icon-action-btn edit"
                  title="Edit Section"
                  @click.stop="openEditModal(child.rawSection)"
                >
                  <ion-icon :icon="createOutline" />
                </button>
                <button
                  type="button"
                  class="icon-action-btn toggle"
                  :title="child.rawSection.status === 'ACTIVE' ? 'Deactivate' : 'Activate'"
                  @click.stop="handleToggleStatus(child.rawSection)"
                >
                  <ion-icon :icon="child.rawSection.status === 'ACTIVE' ? closeCircleOutline : checkmarkCircle" />
                </button>
                <button
                  v-if="isDevAdmin"
                  type="button"
                  class="icon-action-btn delete"
                  title="Delete Section"
                  @click.stop="promptDelete(child.rawSection)"
                >
                  <ion-icon :icon="trashOutline" />
                </button>
              </div>
            </template>
          </UniTreeView>
        </div>


        <div v-else-if="!isLoading" class="empty-state minimal-card">
          <ion-icon :icon="gridOutline" class="empty-icon" />
          <h3 class="empty-title">No Sections Found</h3>
          <p class="empty-desc">
            {{ searchQuery || filterYearLevelId ? 'No sections match the current filters.' : 'No sections configured yet.' }}
          </p>
          <UniButton v-if="!searchQuery && !filterYearLevelId" variant="primary" size="sm" @click="openAddModal">
            Create First Section
          </UniButton>
        </div>

        <div v-if="isLoading" class="loading-state">
          <ion-spinner name="crescent" />
          <span>Loading sections...</span>
        </div>
      </div>

      <!-- Add / Edit Section Bottom Sheet -->
      <UniSheet
        :is-open="showAddModal || showEditModal"
        :title="showEditModal ? 'Edit Section' : 'Add Section'"
        :subtitle="showEditModal ? 'Update section attributes and status.' : 'Register a new section under a year level.'"
        size="standard"
        @close="showAddModal = false; showEditModal = false"
      >
        <div class="sheet-form-content">
          <div v-if="errorMessage" class="error-banner">
            {{ errorMessage }}
          </div>

          <div class="form-group">
            <label class="form-label">Section Name <span class="req">*</span></label>
            <input
              v-model="sectionForm.sectionName"
              type="text"
              placeholder="e.g. 4F4 or 1F1"
              class="form-input font-mono"
              required
            />
          </div>

          <div class="form-group">
            <label class="form-label">Year Level <span class="req">*</span></label>
            <UniSelect
              v-model="sectionForm.yearLevelId"
              :options="formYearLevelOptions"
              placeholder="Select Year Level"
              header="Select Year Level"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Program (Optional)</label>
            <UniSelect
              v-model="sectionForm.programId"
              :options="formProgramOptions"
              placeholder="General / All Programs"
              header="Select Program"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Academic Year (Optional)</label>
            <UniSelect
              v-model="sectionForm.academicYearId"
              :options="formAcademicYearOptions"
              placeholder="All Academic Years"
              header="Select Academic Year"
            />
          </div>

          <div v-if="showEditModal" class="form-group">
            <label class="form-label">Status</label>
            <UniSelect
              v-model="sectionForm.status"
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
              Save Section
            </UniButton>
          </div>
        </template>
      </UniSheet>
    </ion-content>

    <!-- Custom Reusable Filter Sheet -->
    <UniFilterSheet
      v-model:is-open="isFilterSheetOpen"
      title="Filter Sections"
      subtitle="Refine year level, program, and academic year"
      :active-count="activeFiltersCount"
      @apply="applyFilters"
      @reset="resetDraftFilters"
    >
      <div class="sheet-filter-form">
        <div class="form-group">
          <label class="form-label">Year Level</label>
          <UniSelect
            v-model="draftYearLevelId"
            :options="yearLevelOptions"
            placeholder="All Year Levels"
            header="Select Year Level"
            presentation="embedded"
          />
        </div>

        <div class="form-group">
          <label class="form-label">Program</label>
          <UniSelect
            v-model="draftProgramId"
            :options="programOptions"
            placeholder="All Programs"
            header="Select Program"
            presentation="embedded"
          />
        </div>

        <div class="form-group">
          <label class="form-label">Academic Year</label>
          <UniSelect
            v-model="draftAcademicYearId"
            :options="academicYearOptions"
            placeholder="All Academic Years"
            header="Select Academic Year"
            presentation="embedded"
          />
        </div>
      </div>
    </UniFilterSheet>
    <!-- Delete Confirmation Dialog -->
    <UniDialog
      :is-open="showDeleteConfirm"
      title="Delete Section"
      :description="`Are you sure you want to permanently delete section '${sectionToDelete?.section_name}'? If students are enrolled in this section, deletion will be blocked.`"
      :confirm-text="isDeleting ? 'Deleting...' : 'Delete Section'"
      cancel-text="Cancel"
      confirm-variant="danger"
      @confirm="confirmDelete"
      @cancel="showDeleteConfirm = false"
    />
  </ion-page>
</template>

<style scoped>
.sections-content {
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
  gap: 10px;
  min-width: 0;
}

.clean-searchbar {
  --background: var(--uni-surface, #ffffff);
  --color: var(--uni-text, #0f172a);
  --placeholder-color: var(--uni-text-muted, #94a3b8);
  --box-shadow: none;
  --border-radius: 12px;
  padding: 0;
  flex: 1;
  min-width: 0;
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 12px;
}

@media (max-width: 380px) {
  .page-container {
    padding: 12px;
    gap: 10px;
  }

  .toolbar-row {
    flex-wrap: wrap;
    gap: 8px;
  }
}

.sections-tree-wrapper {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sec-tree-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.compact-filter-bar {
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 14px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.filter-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.filter-headline {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
}

.btn-open-filters {
  flex-shrink: 0;
}

.filter-badge-counter {
  margin-left: 4px;
  font-weight: 700;
  color: var(--uni-primary, #0f766e);
}

.active-chips-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--uni-border, #e2e8f0);
}

.btn-clear-all {
  background: transparent;
  border: none;
  color: var(--uni-text-secondary, #64748b);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  transition: color 0.14s ease;
}

.btn-clear-all:hover {
  color: var(--uni-danger, #dc2626);
}

.sheet-filter-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

:global(.dark) .compact-filter-bar {
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
}

:global(.dark) .filter-headline {
  color: var(--uni-text, #F8FAFC);
}

:global(.dark) .active-chips-row {
  border-color: var(--uni-border, #30343D);
}

:global(.dark) .btn-clear-all {
  color: var(--uni-text-secondary, #9CA3AF);
}

:global(.dark) .btn-clear-all:hover {
  color: var(--uni-danger, #F87171);
}

.sections-grid-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  gap: 12px;
}

.section-card.is-inactive {
  opacity: 0.7;
  background: var(--uni-surface-secondary, #f8fafc);
}

.sec-main-col {
  flex: 1;
  min-width: 0;
}

.sec-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.sec-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
}

.yl-tag {
  font-size: 11.5px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 6px;
  background: var(--uni-surface-secondary, #f1f5f9);
  color: var(--uni-text, #0f172a);
  border: 1px solid var(--uni-border, #e2e8f0);
}

.prog-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(16, 185, 129, 0.08);
  color: var(--uni-primary, #10b981);
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

.status-pill.inactive {
  background: rgba(100, 116, 139, 0.12);
  color: #64748b;
}

.sec-meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--uni-text-muted, #94a3b8);
}

.student-count {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sec-actions-col {
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

.icon-action-btn.delete {
  color: var(--ion-color-danger, #ef4444);
}

.icon-action-btn.delete:hover {
  background: rgba(239, 68, 68, 0.08);
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
