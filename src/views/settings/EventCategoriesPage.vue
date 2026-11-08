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
  pricetagOutline
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
import type { EventCategory } from '@/types/database';
import { haptics } from '@/utilities/haptics';
import { useToast } from '@/composables/useToast';

const { showToast } = useToast();

const categories = ref<EventCategory[]>([]);
const usageCounts = ref<Record<string, number>>({});
const isLoading = ref(true);
const searchQuery = ref('');

// Modals
const showAddModal = ref(false);
const showEditModal = ref(false);
const showDeleteConfirm = ref(false);
const isSaving = ref(false);
const errorMessage = ref('');

// Form state
const categoryForm = ref({
  id: '',
  name: '',
  code: '',
  description: '',
  status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  sortOrder: 0,
});
const activeCategoryForDelete = ref<EventCategory | null>(null);

const statusOptions = [
  { value: 'ACTIVE', label: 'ACTIVE' },
  { value: 'INACTIVE', label: 'INACTIVE' },
];


const filteredCategories = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return categories.value;
  return categories.value.filter(
    (c) =>
      c.name.toLowerCase().includes(query) ||
      c.code.toLowerCase().includes(query) ||
      (c.description && c.description.toLowerCase().includes(query))
  );
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

    const list = await SystemSetupService.getEventCategories(true);
    categories.value = list;

    // Load usage count for each category
    const counts: Record<string, number> = {};
    for (const cat of list) {
      counts[cat.id] = await SystemSetupService.getCategoryUsageCount(cat.id);
    }
    usageCounts.value = counts;
  } catch (err) {
    console.error('Failed to load event categories:', err);
  } finally {
    isLoading.value = false;
  }
}

function openAddModal() {
  haptics.light();
  categoryForm.value = {
    id: '',
    name: '',
    code: '',
    description: '',
    status: 'ACTIVE',
    sortOrder: categories.value.length + 1,
  };
  errorMessage.value = '';
  showAddModal.value = true;
}

function openEditModal(cat: EventCategory) {
  haptics.light();
  categoryForm.value = {
    id: cat.id,
    name: cat.name,
    code: cat.code,
    description: cat.description || '',
    status: cat.status,
    sortOrder: cat.sort_order,
  };
  errorMessage.value = '';
  showEditModal.value = true;
}

async function handleSaveCategory(isEdit: boolean) {
  errorMessage.value = '';
  if (!categoryForm.value.name.trim()) {
    errorMessage.value = 'Category Name is required.';
    return;
  }

  isSaving.value = true;
  try {
    if (isEdit) {
      await SystemSetupService.updateEventCategory(categoryForm.value.id, {
        name: categoryForm.value.name,
        code: categoryForm.value.code,
        description: categoryForm.value.description,
        status: categoryForm.value.status,
        sortOrder: Number(categoryForm.value.sortOrder) || 0,
      });
      showEditModal.value = false;
    } else {
      await SystemSetupService.createEventCategory({
        name: categoryForm.value.name,
        code: categoryForm.value.code,
        description: categoryForm.value.description,
        sortOrder: Number(categoryForm.value.sortOrder) || 0,
      });
      showAddModal.value = false;
    }
    haptics.success();
    await showToast(isEdit ? 'Event category updated' : 'Event category created successfully', 'success');
    await loadData();
  } catch (err: unknown) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to save event category.';
    haptics.error();
  } finally {
    isSaving.value = false;
  }
}

async function handleToggleStatus(cat: EventCategory) {
  haptics.medium();
  try {
    await SystemSetupService.toggleCategoryStatus(cat.id);
    await showToast(`Category ${cat.name} ${cat.status === 'ACTIVE' ? 'deactivated' : 'activated'}`, 'info');
    await loadData();
  } catch (err) {
    console.error('Failed to toggle status:', err);
  }
}

function promptDelete(cat: EventCategory) {
  haptics.light();
  activeCategoryForDelete.value = cat;
  showDeleteConfirm.value = true;
}

async function confirmDelete() {
  if (!activeCategoryForDelete.value) return;
  try {
    await SystemSetupService.deleteCategory(activeCategoryForDelete.value.id);
    showDeleteConfirm.value = false;
    activeCategoryForDelete.value = null;
    haptics.success();
    await showToast('Category deleted successfully', 'success');
    await loadData();
  } catch (err: unknown) {
    showDeleteConfirm.value = false;
    await showToast(err instanceof Error ? err.message : 'Cannot delete category.', 'error');
    haptics.error();
  }
}

onMounted(loadData);
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Event Categories"
      subtitle="Database-managed event types & codes"
      :back-button="true"
      default-back-href="/settings/system-setup"
    />

    <ion-content class="categories-content">
      <div class="page-container">
        <!-- Top Action Bar -->
        <div class="toolbar-row">
          <ion-searchbar
            v-model="searchQuery"
            placeholder="Search categories or codes..."
            class="clean-searchbar"
            :debounce="200"
          />
          <UniButton
            variant="primary"
            size="sm"
            :icon="addOutline"
            aria-label="Create new event category"
            @click="openAddModal"
          >
            New
          </UniButton>
        </div>

        <!-- Categories List (Adaptive Expandable Rows) -->
        <div v-if="filteredCategories.length > 0" class="category-cards-list">
          <UniExpandableRow
            v-for="cat in filteredCategories"
            :key="cat.id"
            :title="cat.name"
            :subtitle="`${usageCounts[cat.id] ?? 0} event(s) linked`"
            :badge="cat.status"
            :badge-variant="cat.status === 'ACTIVE' ? 'success' : 'neutral'"
            :class="{ 'is-inactive-row': cat.status === 'INACTIVE' }"
          >
            <template #title-suffix>
              <span class="code-badge font-mono">{{ cat.code }}</span>
            </template>

            <template #content>
              <div class="cat-details-body">
                <div v-if="cat.description" class="cat-desc-box">
                  <span class="detail-label">Description</span>
                  <p class="cat-desc-text">{{ cat.description }}</p>
                </div>
                <div class="cat-meta-grid">
                  <div class="meta-item">
                    <span class="meta-label">Classification Code:</span>
                    <span class="meta-val font-mono">{{ cat.code }}</span>
                  </div>
                  <div class="meta-item">
                    <span class="meta-label">Display Sort Order:</span>
                    <span class="meta-val font-mono">{{ cat.sort_order }}</span>
                  </div>
                  <div class="meta-item">
                    <span class="meta-label">Linked Events:</span>
                    <span class="meta-val">{{ usageCounts[cat.id] ?? 0 }} event(s)</span>
                  </div>
                </div>
              </div>
            </template>

            <template #actions>
              <div class="cat-row-actions">
                <UniButton
                  variant="outline"
                  size="sm"
                  :icon="createOutline"
                  @click.stop="openEditModal(cat)"
                >
                  Edit
                </UniButton>
                <UniButton
                  variant="outline"
                  size="sm"
                  :icon="cat.status === 'ACTIVE' ? closeCircleOutline : checkmarkCircle"
                  @click.stop="handleToggleStatus(cat)"
                >
                  {{ cat.status === 'ACTIVE' ? 'Deactivate' : 'Activate' }}
                </UniButton>
                <UniButton
                  v-if="(usageCounts[cat.id] || 0) === 0"
                  variant="destructive"
                  size="sm"
                  :icon="trashOutline"
                  @click.stop="promptDelete(cat)"
                >
                  Delete
                </UniButton>
              </div>
            </template>
          </UniExpandableRow>
        </div>

        <!-- Empty State -->
        <div v-else-if="!isLoading" class="empty-state minimal-card">
          <ion-icon :icon="pricetagOutline" class="empty-icon" />
          <h3 class="empty-title">No Categories Found</h3>
          <p class="empty-desc">
            {{ searchQuery ? 'No event categories match your search.' : 'No event categories configured yet.' }}
          </p>
          <UniButton v-if="!searchQuery" variant="primary" size="sm" @click="openAddModal">
            Create First Category
          </UniButton>
        </div>

        <div v-if="isLoading" class="loading-state">
          <ion-spinner name="crescent" />
          <span>Loading event categories...</span>
        </div>
      </div>

      <!-- Add / Edit Category Bottom Sheet -->
      <UniSheet
        :is-open="showAddModal || showEditModal"
        :title="showEditModal ? 'Edit Event Category' : 'Create Event Category'"
        :subtitle="showEditModal ? 'Modify category naming, code, or active status.' : 'Define a new database-managed event category.'"
        size="standard"
        @close="showAddModal = false; showEditModal = false"
      >
        <div class="sheet-form-content">
          <div v-if="errorMessage" class="error-banner">
            {{ errorMessage }}
          </div>

          <div class="form-group">
            <label class="form-label">Category Name <span class="req">*</span></label>
            <input
              v-model="categoryForm.name"
              type="text"
              placeholder="e.g. Hackathon or General Assembly"
              class="form-input"
              required
            />
          </div>

          <div class="form-group">
            <label class="form-label">Classification Code</label>
            <input
              v-model="categoryForm.code"
              type="text"
              placeholder="e.g. HACKATHON"
              class="form-input font-mono"
            />
            <span class="field-hint">Used for reporting and synchronization unique references.</span>
          </div>

          <div class="form-group">
            <label class="form-label">Description</label>
            <textarea
              v-model="categoryForm.description"
              rows="2"
              placeholder="Brief summary of events under this classification..."
              class="form-textarea"
            ></textarea>
          </div>

          <div v-if="showEditModal" class="form-group">
            <label class="form-label">Status</label>
            <UniSelect
              v-model="categoryForm.status"
              :options="statusOptions"
              header="Select Status"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Sort Order</label>
            <input
              v-model.number="categoryForm.sortOrder"
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
              @click="handleSaveCategory(showEditModal)"
            >
              Save Category
            </UniButton>
          </div>
        </template>
      </UniSheet>

      <!-- Delete Confirmation Dialog -->
      <UniDialog
        :is-open="showDeleteConfirm"
        title="Delete Event Category"
        :description="`Are you sure you want to permanently delete category '${activeCategoryForDelete?.name}'? This action cannot be undone.`"
        confirm-text="Delete Category"
        cancel-text="Keep Category"
        confirm-variant="danger"
        @confirm="confirmDelete"
        @cancel="showDeleteConfirm = false"
      />
    </ion-content>
  </ion-page>
</template>

<style scoped>
.categories-content {
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

.minimal-card {
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 14px;
}

.category-cards-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.is-inactive-row {
  opacity: 0.72;
}

.code-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--uni-surface-secondary, #f1f5f9);
  color: var(--uni-text-secondary, #64748b);
  border: 1px solid var(--uni-border, #e2e8f0);
}

:global(.dark) .code-badge,
:global(.ion-palette-dark) .code-badge {
  background: var(--uni-surface, #1b1d23);
  border-color: var(--uni-border, #333846);
  color: var(--uni-text-secondary, #94a3b8);
}

.cat-details-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cat-desc-box {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.detail-label {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--uni-text-muted, #94a3b8);
}

.cat-desc-text {
  font-size: 13px;
  line-height: 1.4;
  color: var(--uni-text, #0f172a);
  margin: 0;
}

:global(.dark) .cat-desc-text,
:global(.ion-palette-dark) .cat-desc-text {
  color: var(--uni-text, #f1f5f9);
}

.cat-meta-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding: 8px 10px;
  background: var(--uni-surface, #ffffff);
  border-radius: 8px;
  border: 1px solid var(--uni-border, #e2e8f0);
}

:global(.dark) .cat-meta-grid,
:global(.ion-palette-dark) .cat-meta-grid {
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

.cat-row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
  justify-content: flex-end;
}

@media (max-width: 380px) {
  .page-container {
    padding: 12px;
  }

  .cat-row-actions {
    justify-content: stretch;
  }

  .cat-row-actions > * {
    flex: 1 1 auto;
    min-width: 70px;
  }
}

.icon-action-btn.text-danger {
  color: var(--uni-danger, #ef4444);
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
.form-select,
.form-textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--uni-border, #e2e8f0);
  background: var(--uni-surface, #ffffff);
  color: var(--uni-text, #0f172a);
  font-size: 14px;
  outline: none;
  font-family: inherit;
}

.form-input:focus,
.form-select:focus,
.form-textarea:focus {
  border-color: var(--uni-primary, #10b981);
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
