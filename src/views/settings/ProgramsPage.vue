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
  trashOutline,
  checkmarkCircle,
  closeCircleOutline,
  bookOutline,
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
import type { Program } from '@/types/database';
import { haptics } from '@/utilities/haptics';
import { useToast } from '@/composables/useToast';

const { showToast } = useToast();
const { isDevAdmin } = useAuth();

const programs = ref<Program[]>([]);
const sectionCounts = ref<Record<string, number>>({});
const enrollmentCounts = ref<Record<string, number>>({});
const isLoading = ref(true);
const searchQuery = ref('');
const statusFilter = ref<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

// Modals
const showAddModal = ref(false);
const showEditModal = ref(false);
const showDeleteConfirm = ref(false);
const isSaving = ref(false);
const errorMessage = ref('');

// Form state
const programForm = ref({
  id: '',
  code: '',
  name: '',
  status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
});
const activeProgramForDelete = ref<Program | null>(null);

const statusOptions = [
  { value: 'ACTIVE', label: 'ACTIVE' },
  { value: 'INACTIVE', label: 'INACTIVE' },
];

const filteredPrograms = computed(() => {
  let list = programs.value;
  if (statusFilter.value !== 'ALL') {
    list = list.filter((p) => (p.status || (p.is_active === 1 ? 'ACTIVE' : 'INACTIVE')) === statusFilter.value);
  }
  const query = searchQuery.value.trim().toLowerCase();
  if (query) {
    list = list.filter(
      (p) =>
        p.code.toLowerCase().includes(query) ||
        p.name.toLowerCase().includes(query)
    );
  }
  return list;
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

    const list = await SystemSetupService.getPrograms(true);
    programs.value = list;

    // Load section and enrollment counts for each program
    const secCounts: Record<string, number> = {};
    const enrCounts: Record<string, number> = {};
    for (const prog of list) {
      const [sCount, eCount] = await Promise.all([
        SystemSetupService.getProgramSectionCount(prog.id),
        SystemSetupService.getProgramEnrollmentCount(prog.id),
      ]);
      secCounts[prog.id] = sCount;
      enrCounts[prog.id] = eCount;
    }
    sectionCounts.value = secCounts;
    enrollmentCounts.value = enrCounts;
  } catch (err) {
    console.error('Failed to load degree programs:', err);
  } finally {
    isLoading.value = false;
  }
}

function openAddModal() {
  haptics.light();
  programForm.value = {
    id: '',
    code: '',
    name: '',
    status: 'ACTIVE',
  };
  errorMessage.value = '';
  showAddModal.value = true;
}

function openEditModal(prog: Program) {
  haptics.light();
  programForm.value = {
    id: prog.id,
    code: prog.code,
    name: prog.name,
    status: prog.status || (prog.is_active === 1 ? 'ACTIVE' : 'INACTIVE'),
  };
  errorMessage.value = '';
  showEditModal.value = true;
}

async function handleSaveProgram(isEdit: boolean) {
  errorMessage.value = '';
  const cleanCode = programForm.value.code.trim().toUpperCase();
  const cleanName = programForm.value.name.trim();

  if (!cleanCode) {
    errorMessage.value = 'Program Code is required (e.g. "BSIT", "BSCS").';
    return;
  }
  if (!cleanName) {
    errorMessage.value = 'Program Name is required (e.g. "Bachelor of Science in Information Technology").';
    return;
  }

  isSaving.value = true;
  try {
    if (isEdit) {
      await SystemSetupService.updateProgram(programForm.value.id, {
        code: cleanCode,
        name: cleanName,
        status: programForm.value.status,
      });
      showEditModal.value = false;
    } else {
      await SystemSetupService.createProgram({
        code: cleanCode,
        name: cleanName,
        status: programForm.value.status,
      });
      showAddModal.value = false;
    }
    haptics.success();
    await showToast(isEdit ? 'Program updated successfully' : 'Program created successfully', 'success');
    await loadData();
  } catch (err: unknown) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to save program.';
    haptics.error();
  } finally {
    isSaving.value = false;
  }
}

async function handleToggleStatus(prog: Program) {
  haptics.medium();
  try {
    await SystemSetupService.toggleProgramStatus(prog.id);
    const newStatus = (prog.status || (prog.is_active === 1 ? 'ACTIVE' : 'INACTIVE')) === 'ACTIVE' ? 'deactivated' : 'activated';
    await showToast(`Program ${prog.code} ${newStatus}`, 'info');
    await loadData();
  } catch (err: unknown) {
    console.error('Failed to toggle status:', err);
    await showToast(err instanceof Error ? err.message : 'Failed to change program status.', 'error');
  }
}

const isDeleting = ref(false);

function promptDelete(prog: Program) {
  haptics.light();
  activeProgramForDelete.value = prog;
  showDeleteConfirm.value = true;
}

async function confirmDelete() {
  if (!activeProgramForDelete.value) return;
  isDeleting.value = true;
  try {
    await SystemSetupService.deleteProgram(activeProgramForDelete.value.id);
    showDeleteConfirm.value = false;
    activeProgramForDelete.value = null;
    haptics.success();
    await showToast('Program deleted successfully', 'success');
    await loadData();
  } catch (err: unknown) {
    showDeleteConfirm.value = false;
    await showToast(err instanceof Error ? err.message : 'Cannot delete program.', 'error');
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
      title="Degree Programs"
      subtitle="Academic curriculums, majors & degree codes"
      :back-button="true"
      default-back-href="/settings/system-setup"
    />

    <ion-content class="programs-content">
      <div class="page-container">
        <!-- Top Toolbar -->
        <div class="toolbar-row">
          <ion-searchbar
            v-model="searchQuery"
            placeholder="Search code or name..."
            class="clean-searchbar"
            :debounce="200"
          />
          <UniButton
            variant="primary"
            size="sm"
            :icon="addOutline"
            aria-label="Create new program"
            @click="openAddModal"
          >
            New
          </UniButton>
        </div>

        <!-- Filter Chips Bar -->
        <div class="filter-chips-row">
          <button
            type="button"
            class="filter-pill font-mono"
            :class="{ active: statusFilter === 'ALL' }"
            @click="statusFilter = 'ALL'"
          >
            All ({{ programs.length }})
          </button>
          <button
            type="button"
            class="filter-pill font-mono"
            :class="{ active: statusFilter === 'ACTIVE' }"
            @click="statusFilter = 'ACTIVE'"
          >
            Active ({{ programs.filter(p => (p.status || (p.is_active === 1 ? 'ACTIVE' : 'INACTIVE')) === 'ACTIVE').length }})
          </button>
          <button
            type="button"
            class="filter-pill font-mono"
            :class="{ active: statusFilter === 'INACTIVE' }"
            @click="statusFilter = 'INACTIVE'"
          >
            Inactive ({{ programs.filter(p => (p.status || (p.is_active === 1 ? 'ACTIVE' : 'INACTIVE')) === 'INACTIVE').length }})
          </button>
        </div>

        <!-- Programs List (Adaptive Expandable Rows) -->
        <div v-if="filteredPrograms.length > 0" class="programs-cards-list">
          <UniExpandableRow
            v-for="prog in filteredPrograms"
            :key="prog.id"
            :title="prog.name"
            :subtitle="`${sectionCounts[prog.id] ?? 0} section(s) offering`"
            :badge="prog.status || (prog.is_active === 1 ? 'ACTIVE' : 'INACTIVE')"
            :badge-variant="(prog.status || (prog.is_active === 1 ? 'ACTIVE' : 'INACTIVE')) === 'ACTIVE' ? 'success' : 'neutral'"
            :class="{ 'is-inactive-row': (prog.status || (prog.is_active === 1 ? 'ACTIVE' : 'INACTIVE')) === 'INACTIVE' }"
          >
            <template #title-suffix>
              <span class="code-badge font-mono">{{ prog.code }}</span>
            </template>

            <template #content>
              <div class="prog-details-body">
                <div class="prog-meta-grid">
                  <div class="meta-item">
                    <span class="meta-label">Program Code:</span>
                    <span class="meta-val font-mono">{{ prog.code }}</span>
                  </div>
                  <div class="meta-item">
                    <span class="meta-label">Status:</span>
                    <span class="meta-val font-mono">{{ prog.status || (prog.is_active === 1 ? 'ACTIVE' : 'INACTIVE') }}</span>
                  </div>
                  <div class="meta-item">
                    <span class="meta-label">Sections Offering:</span>
                    <span class="meta-val font-mono">{{ sectionCounts[prog.id] ?? 0 }} section(s)</span>
                  </div>
                  <div class="meta-item">
                    <span class="meta-label">Enrolled Students:</span>
                    <span class="meta-val font-mono">{{ enrollmentCounts[prog.id] ?? 0 }} student(s)</span>
                  </div>
                </div>
              </div>
            </template>

            <template #actions>
              <div class="prog-row-actions">
                <UniButton
                  variant="outline"
                  size="sm"
                  :icon="createOutline"
                  @click.stop="openEditModal(prog)"
                >
                  Edit
                </UniButton>
                <UniButton
                  variant="outline"
                  size="sm"
                  :icon="(prog.status || (prog.is_active === 1 ? 'ACTIVE' : 'INACTIVE')) === 'ACTIVE' ? closeCircleOutline : checkmarkCircle"
                  @click.stop="handleToggleStatus(prog)"
                >
                  {{ (prog.status || (prog.is_active === 1 ? 'ACTIVE' : 'INACTIVE')) === 'ACTIVE' ? 'Deactivate' : 'Activate' }}
                </UniButton>
                <UniButton
                  v-if="isDevAdmin && (sectionCounts[prog.id] || 0) === 0 && (enrollmentCounts[prog.id] || 0) === 0"
                  variant="destructive"
                  size="sm"
                  :icon="trashOutline"
                  @click.stop="promptDelete(prog)"
                >
                  Delete
                </UniButton>
              </div>
            </template>
          </UniExpandableRow>
        </div>

        <!-- Empty State -->
        <div v-else-if="!isLoading" class="empty-state minimal-card">
          <ion-icon :icon="bookOutline" class="empty-icon" />
          <h3 class="empty-title">No Programs Found</h3>
          <p class="empty-desc">
            {{ searchQuery ? 'No programs match your search query.' : 'Configure degree programs to unlock section creation and student roster imports.' }}
          </p>
          <UniButton v-if="!searchQuery" variant="primary" size="sm" @click="openAddModal">
            Create Degree Program
          </UniButton>
        </div>

        <!-- Loading State -->
        <div v-if="isLoading" class="loading-state">
          <ion-spinner name="crescent" />
          <span>Loading academic programs...</span>
        </div>
      </div>

      <!-- Add / Edit Program Bottom Sheet -->
      <UniSheet
        :is-open="showAddModal || showEditModal"
        :title="showEditModal ? 'Edit Program' : 'New Degree Program'"
        :subtitle="showEditModal ? 'Modify program code, full name, or status.' : 'Register a new institutional degree program.'"
        size="standard"
        @close="showAddModal = false; showEditModal = false"
      >
        <div class="sheet-form-content">
          <div v-if="errorMessage" class="error-banner">
            {{ errorMessage }}
          </div>

          <div class="form-group">
            <label class="form-label">Program Code <span class="req">*</span></label>
            <input
              v-model="programForm.code"
              type="text"
              placeholder="e.g. BSIT or BSCS"
              class="form-input font-mono"
              required
              maxlength="20"
            />
            <span class="field-hint">Unique institutional acronym or degree identifier.</span>
          </div>

          <div class="form-group">
            <label class="form-label">Full Degree Title / Name <span class="req">*</span></label>
            <input
              v-model="programForm.name"
              type="text"
              placeholder="e.g. Bachelor of Science in Information Technology"
              class="form-input"
              required
            />
            <span class="field-hint">Official diploma and report title.</span>
          </div>

          <div v-if="showEditModal" class="form-group">
            <label class="form-label">Lifecycle Status</label>
            <UniSelect
              v-model="programForm.status"
              :options="statusOptions"
              header="Select Program Status"
            />
            <span class="field-hint">Inactive programs cannot be selected for new sections or roster imports.</span>
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
              @click="handleSaveProgram(showEditModal)"
            >
              {{ showEditModal ? 'Update Program' : 'Save Program' }}
            </UniButton>
          </div>
        </template>
      </UniSheet>

      <!-- Delete Confirmation Dialog -->
      <UniDialog
        :is-open="showDeleteConfirm"
        title="Delete Degree Program"
        :description="`Are you sure you want to permanently delete program '${activeProgramForDelete?.code} - ${activeProgramForDelete?.name}'? This action cannot be undone.`"
        :confirm-text="isDeleting ? 'Deleting...' : 'Delete Program'"
        cancel-text="Keep Program"
        confirm-variant="danger"
        @confirm="confirmDelete"
        @cancel="showDeleteConfirm = false"
      />
    </ion-content>
  </ion-page>
</template>

<style scoped>
.programs-content {
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
}

.clean-searchbar {
  --background: var(--uni-surface, #ffffff);
  --color: var(--uni-text, #0f172a);
  --placeholder-color: var(--uni-text-muted, #94a3b8);
  --box-shadow: none;
  --border-radius: 12px;
  padding: 0;
  flex: 1;
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 12px;
}

.filter-chips-row {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.filter-pill {
  padding: 5px 12px;
  border-radius: 20px;
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid var(--uni-border, #e2e8f0);
  background: var(--uni-surface, #ffffff);
  color: var(--uni-text-secondary, #64748b);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.filter-pill.active {
  background: var(--uni-primary, #0284c7);
  color: #ffffff;
  border-color: var(--uni-primary, #0284c7);
}

:global(.dark) .filter-pill,
:global(.ion-palette-dark) .filter-pill {
  background: var(--uni-surface, #1e293b);
  border-color: var(--uni-border, #334155);
  color: var(--uni-text-secondary, #94a3b8);
}

:global(.dark) .filter-pill.active,
:global(.ion-palette-dark) .filter-pill.active {
  background: var(--uni-primary, #38bdf8);
  color: #0f172a;
  border-color: var(--uni-primary, #38bdf8);
}

.minimal-card {
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 14px;
}

:global(.dark) .minimal-card,
:global(.ion-palette-dark) .minimal-card {
  background: var(--uni-surface, #1e293b);
  border-color: var(--uni-border, #334155);
}

.programs-cards-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.is-inactive-row {
  opacity: 0.72;
}

.code-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--uni-surface-secondary, #f1f5f9);
  color: var(--uni-text-secondary, #475569);
  border: 1px solid var(--uni-border, #e2e8f0);
}

:global(.dark) .code-badge,
:global(.ion-palette-dark) .code-badge {
  background: var(--uni-surface, #1b1d23);
  border-color: var(--uni-border, #333846);
  color: var(--uni-text-secondary, #94a3b8);
}

.prog-details-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.prog-meta-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding: 8px 10px;
  background: var(--uni-surface, #ffffff);
  border-radius: 8px;
  border: 1px solid var(--uni-border, #e2e8f0);
}

:global(.dark) .prog-meta-grid,
:global(.ion-palette-dark) .prog-meta-grid {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #333846);
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.meta-label {
  color: var(--uni-text-secondary, #64748b);
  font-weight: 500;
}

.meta-val {
  color: var(--uni-text, #0f172a);
  font-weight: 600;
}

:global(.dark) .meta-val,
:global(.ion-palette-dark) .meta-val {
  color: var(--uni-text, #f1f5f9);
}

.prog-row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  color: var(--uni-text-muted, #94a3b8);
  font-size: 13px;
}

.empty-state {
  padding: 40px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
}

.empty-icon {
  font-size: 42px;
  color: var(--uni-text-muted, #94a3b8);
}

.empty-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
}

:global(.dark) .empty-title,
:global(.ion-palette-dark) .empty-title {
  color: var(--uni-text, #f8fafc);
}

.empty-desc {
  margin: 0;
  font-size: 13px;
  color: var(--uni-text-muted, #64748b);
  max-width: 320px;
  line-height: 1.4;
}

.sheet-form-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.error-banner {
  padding: 10px 12px;
  border-radius: 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  font-size: 12.5px;
  font-weight: 500;
}

:global(.dark) .error-banner,
:global(.ion-palette-dark) .error-banner {
  background: #450a0a;
  border-color: #7f1d1d;
  color: #fca5a5;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--uni-text, #0f172a);
}

:global(.dark) .form-label,
:global(.ion-palette-dark) .form-label {
  color: var(--uni-text, #f1f5f9);
}

.req {
  color: #ef4444;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--uni-border, #cbd5e1);
  background: var(--uni-surface, #ffffff);
  color: var(--uni-text, #0f172a);
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: var(--uni-primary, #0284c7);
}

:global(.dark) .form-input,
:global(.ion-palette-dark) .form-input {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #333846);
  color: var(--uni-text, #f8fafc);
}

.field-hint {
  font-size: 11px;
  color: var(--uni-text-muted, #94a3b8);
}

.sheet-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
}
</style>

