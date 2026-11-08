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
  checkmarkCircle,
  closeCircleOutline,
  layersOutline
} from 'ionicons/icons';
import { UniPageHeader, UniButton, UniSelect, UniSheet } from '@/components/ui';

import { SystemSetupService } from '@/services/system-setup.service';
import { DataModeService } from '@/services/data-mode.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import type { YearLevel } from '@/types/database';
import { haptics } from '@/utilities/haptics';
import { useToast } from '@/composables/useToast';

const { showToast } = useToast();

const yearLevels = ref<YearLevel[]>([]);
const sectionCounts = ref<Record<string, number>>({});
const isLoading = ref(true);

const showAddModal = ref(false);
const showEditModal = ref(false);
const isSaving = ref(false);
const errorMessage = ref('');

const yearLevelForm = ref({
  id: '',
  levelNumber: 1,
  displayName: '',
  status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  sortOrder: 1,
});

const statusOptions = [
  { value: 'ACTIVE', label: 'ACTIVE' },
  { value: 'INACTIVE', label: 'INACTIVE' },
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

    const list = await SystemSetupService.getYearLevels(true);
    yearLevels.value = list;

    // Count sections for each year level
    const counts: Record<string, number> = {};
    for (const yl of list) {
      const secs = await SystemSetupService.getSections({ yearLevelId: yl.id, includeInactive: true });
      counts[yl.id] = secs.length;
    }
    sectionCounts.value = counts;
  } catch (err) {
    console.error('Failed to load year levels:', err);
  } finally {
    isLoading.value = false;
  }
}

function openAddModal() {
  haptics.light();
  const nextNum = yearLevels.value.length + 1;
  yearLevelForm.value = {
    id: '',
    levelNumber: nextNum,
    displayName: `${nextNum}th Year`,
    status: 'ACTIVE',
    sortOrder: nextNum,
  };
  errorMessage.value = '';
  showAddModal.value = true;
}

function openEditModal(yl: YearLevel) {
  haptics.light();
  yearLevelForm.value = {
    id: yl.id,
    levelNumber: yl.level_number,
    displayName: yl.display_name,
    status: yl.status,
    sortOrder: yl.sort_order,
  };
  errorMessage.value = '';
  showEditModal.value = true;
}

async function handleSave(isEdit: boolean) {
  errorMessage.value = '';
  if (!yearLevelForm.value.displayName.trim()) {
    errorMessage.value = 'Display Name is required (e.g. "1st Year").';
    return;
  }

  isSaving.value = true;
  try {
    if (isEdit) {
      await SystemSetupService.updateYearLevel(yearLevelForm.value.id, {
        displayName: yearLevelForm.value.displayName,
        status: yearLevelForm.value.status,
        sortOrder: Number(yearLevelForm.value.sortOrder) || 0,
      });
      showEditModal.value = false;
    } else {
      await SystemSetupService.createYearLevel({
        levelNumber: Number(yearLevelForm.value.levelNumber),
        displayName: yearLevelForm.value.displayName,
        sortOrder: Number(yearLevelForm.value.sortOrder) || 0,
      });
      showAddModal.value = false;
    }
    haptics.success();
    await showToast(isEdit ? 'Year level updated successfully' : 'Year level created successfully', 'success');
    await loadData();
  } catch (err: unknown) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to save year level.';
    haptics.error();
  } finally {
    isSaving.value = false;
  }
}

async function handleToggleStatus(yl: YearLevel) {
  haptics.medium();
  try {
    await SystemSetupService.toggleYearLevelStatus(yl.id);
    await showToast(`Year level ${yl.display_name} ${yl.status === 'ACTIVE' ? 'deactivated' : 'activated'}`, 'info');
    await loadData();
  } catch (err) {
    console.error('Failed to toggle status:', err);
  }
}

onMounted(loadData);
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Year Levels"
      subtitle="Student progression tiers & display labels"
      :back-button="true"
      default-back-href="/settings/system-setup"
    />

    <ion-content class="year-levels-content">
      <div class="page-container">
        <!-- Header Actions -->
        <div class="toolbar-row">
          <div class="header-count-text">
            <span>{{ yearLevels.length }} Academic Level(s) Configured</span>
          </div>
          <UniButton
            variant="primary"
            size="sm"
            :icon="addOutline"
            aria-label="Create new year level"
            @click="openAddModal"
          >
            New
          </UniButton>
        </div>

        <!-- Year Levels List -->
        <div v-if="yearLevels.length > 0" class="year-level-cards">
          <div
            v-for="yl in yearLevels"
            :key="yl.id"
            class="year-level-card minimal-card"
            :class="{ 'is-inactive': yl.status === 'INACTIVE' }"
          >
            <div class="yl-number-badge font-mono">
              {{ yl.level_number }}
            </div>

            <div class="yl-info-col">
              <div class="yl-name-row">
                <span class="yl-display-name">{{ yl.display_name }}</span>
                <span
                  class="status-pill font-mono"
                  :class="yl.status.toLowerCase()"
                >
                  {{ yl.status }}
                </span>
              </div>
              <div class="yl-meta-row">
                <span class="sec-count font-mono">
                  {{ sectionCounts[yl.id] ?? 0 }} section(s) offering
                </span>
                <span class="sort-tag font-mono">Order: {{ yl.sort_order }}</span>
              </div>
            </div>

            <div class="yl-actions-col">
              <button
                class="icon-action-btn edit"
                title="Edit Year Level"
                @click="openEditModal(yl)"
              >
                <ion-icon :icon="createOutline" />
              </button>
              <button
                class="icon-action-btn toggle"
                :title="yl.status === 'ACTIVE' ? 'Deactivate' : 'Activate'"
                @click="handleToggleStatus(yl)"
              >
                <ion-icon :icon="yl.status === 'ACTIVE' ? closeCircleOutline : checkmarkCircle" />
              </button>
            </div>
          </div>
        </div>

        <div v-else-if="!isLoading" class="empty-state minimal-card">
          <ion-icon :icon="layersOutline" class="empty-icon" />
          <h3 class="empty-title">No Year Levels Found</h3>
          <p class="empty-desc">Configure institutional year progression tiers.</p>
          <UniButton variant="primary" size="sm" @click="openAddModal">
            Add Year Level
          </UniButton>
        </div>

        <div v-if="isLoading" class="loading-state">
          <ion-spinner name="crescent" />
          <span>Loading year levels...</span>
        </div>
      </div>

      <!-- Add / Edit Year Level Bottom Sheet -->
      <UniSheet
        :is-open="showAddModal || showEditModal"
        :title="showEditModal ? 'Edit Year Level' : 'Add Year Level'"
        :subtitle="showEditModal ? 'Update display title and status.' : 'Register a new institutional student level.'"
        size="standard"
        @close="showAddModal = false; showEditModal = false"
      >
        <div class="sheet-form-content">
          <div v-if="errorMessage" class="error-banner">
            {{ errorMessage }}
          </div>

          <div v-if="!showEditModal" class="form-group">
            <label class="form-label">Level Number <span class="req">*</span></label>
            <input
              v-model.number="yearLevelForm.levelNumber"
              type="number"
              min="1"
              max="10"
              class="form-input font-mono"
              required
            />
            <span class="field-hint">Numeric level integer (e.g. 5 for 5th Year).</span>
          </div>

          <div class="form-group">
            <label class="form-label">Display Name <span class="req">*</span></label>
            <input
              v-model="yearLevelForm.displayName"
              type="text"
              placeholder="e.g. 5th Year or Senior Year"
              class="form-input"
              required
            />
          </div>

          <div v-if="showEditModal" class="form-group">
            <label class="form-label">Status</label>
            <UniSelect
              v-model="yearLevelForm.status"
              :options="statusOptions"
              header="Select Status"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Sort Order</label>
            <input
              v-model.number="yearLevelForm.sortOrder"
              type="number"
              class="form-input font-mono"
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
              Save Year Level
            </UniButton>
          </div>
        </template>
      </UniSheet>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.year-levels-content {
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

.header-count-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--uni-text-secondary, #64748b);
}

.minimal-card {
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 14px;
}

.year-level-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.year-level-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
}

.year-level-card.is-inactive {
  opacity: 0.7;
  background: var(--uni-surface-secondary, #f8fafc);
}

.yl-number-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--uni-surface-secondary, #f1f5f9);
  color: var(--uni-text, #0f172a);
  font-size: 16px;
  font-weight: 700;
  border: 1px solid var(--uni-border, #e2e8f0);
  flex-shrink: 0;
}

.yl-info-col {
  flex: 1;
  min-width: 0;
}

.yl-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}

.yl-display-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--uni-text, #0f172a);
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

.yl-meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--uni-text-muted, #94a3b8);
}

.yl-actions-col {
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

.field-hint {
  font-size: 11px;
  color: var(--uni-text-muted, #94a3b8);
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
