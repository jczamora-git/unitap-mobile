<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

interface Props {
  totalItems: number;
  pageSize?: number;
  currentPage?: number;
  pageSizeOptions?: number[];
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  pageSize: 10,
  currentPage: 1,
  pageSizeOptions: () => [10, 20, 50],
  disabled: false,
});

const emit = defineEmits<{
  (e: 'update:currentPage', page: number): void;
  (e: 'update:pageSize', size: number): void;
}>();

const totalPages = computed(() => {
  if (props.totalItems <= 0 || props.pageSize <= 0) return 1;
  return Math.ceil(props.totalItems / props.pageSize);
});

const safeCurrentPage = computed(() => {
  if (props.currentPage < 1) return 1;
  if (props.currentPage > totalPages.value) return totalPages.value;
  return props.currentPage;
});

const rangeStart = computed(() => {
  if (props.totalItems === 0) return 0;
  return (safeCurrentPage.value - 1) * props.pageSize + 1;
});

const rangeEnd = computed(() => {
  const end = safeCurrentPage.value * props.pageSize;
  return end > props.totalItems ? props.totalItems : end;
});

const canGoPrev = computed(() => safeCurrentPage.value > 1 && !props.disabled);
const canGoNext = computed(() => safeCurrentPage.value < totalPages.value && !props.disabled);

function goToPrev() {
  if (!canGoPrev.value) return;
  haptics.light();
  emit('update:currentPage', safeCurrentPage.value - 1);
}

function goToNext() {
  if (!canGoNext.value) return;
  haptics.light();
  emit('update:currentPage', safeCurrentPage.value + 1);
}

function handlePageSizeChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  const newSize = parseInt(target.value, 10);
  if (!isNaN(newSize) && newSize > 0) {
    haptics.light();
    emit('update:pageSize', newSize);
    emit('update:currentPage', 1);
  }
}
</script>

<template>
  <div v-if="totalItems > 0" class="uni-pagination-container">
    <div class="uni-pagination-info">
      <span class="range-text">
        Showing <strong>{{ rangeStart }}–{{ rangeEnd }}</strong> of <strong>{{ totalItems }}</strong>
      </span>
      
      <!-- Optional Page Size Selector -->
      <div v-if="pageSizeOptions && pageSizeOptions.length > 1" class="page-size-selector">
        <label class="page-size-label">Per page:</label>
        <select
          :value="pageSize"
          :disabled="disabled"
          class="page-size-select"
          @change="handlePageSizeChange"
        >
          <option v-for="opt in pageSizeOptions" :key="opt" :value="opt">
            {{ opt }}
          </option>
        </select>
      </div>
    </div>

    <!-- Navigation Controls -->
    <div class="uni-pagination-controls">
      <button
        type="button"
        class="pagination-btn"
        :disabled="!canGoPrev"
        title="Previous Page"
        @click="goToPrev"
      >
        <ion-icon :icon="chevronBackOutline" />
        <span class="btn-text">Prev</span>
      </button>

      <span class="page-indicator">
        Page {{ safeCurrentPage }} of {{ totalPages }}
      </span>

      <button
        type="button"
        class="pagination-btn"
        :disabled="!canGoNext"
        title="Next Page"
        @click="goToNext"
      >
        <span class="btn-text">Next</span>
        <ion-icon :icon="chevronForwardOutline" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.uni-pagination-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px;
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: var(--uni-radius-card, 14px);
  box-shadow: var(--uni-shadow-card);
  margin-top: 14px;
  box-sizing: border-box;
}

@media (min-width: 480px) {
  .uni-pagination-container {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}

.uni-pagination-info {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
  color: var(--uni-text-secondary, #64748b);
  flex-wrap: wrap;
}

.range-text strong {
  color: var(--uni-text, #0f172a);
  font-weight: 700;
}

.page-size-selector {
  display: flex;
  align-items: center;
  gap: 6px;
}

.page-size-label {
  font-size: 11.5px;
  color: var(--uni-text-secondary, #64748b);
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.page-size-select {
  height: 28px;
  padding: 0 6px;
  background: var(--uni-surface-secondary, #f8fafc);
  border: 1px solid var(--uni-border, #cbd5e1);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--uni-text, #0f172a);
  outline: none;
  cursor: pointer;
}

.uni-pagination-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: flex-end;
}

.page-indicator {
  font-size: 12px;
  font-weight: 600;
  color: var(--uni-text-secondary, #64748b);
  white-space: nowrap;
}

.pagination-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 10px;
  background: var(--uni-surface-secondary, #f1f5f9);
  border: 1px solid var(--uni-border, #cbd5e1);
  border-radius: 8px;
  color: var(--uni-text, #0f172a);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  outline: none;
  transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}

.pagination-btn:hover:not(:disabled) {
  background: var(--uni-surface, #ffffff);
  border-color: var(--uni-primary, #0f766e);
  color: var(--uni-primary, #0f766e);
}

.pagination-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

:root.dark .uni-pagination-container,
:root.ion-palette-dark .uni-pagination-container,
body.dark .uni-pagination-container,
body.ion-palette-dark .uni-pagination-container {
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
}

:root.dark .page-size-select,
:root.ion-palette-dark .page-size-select,
body.dark .page-size-select,
body.ion-palette-dark .page-size-select,
:root.dark .pagination-btn,
:root.ion-palette-dark .pagination-btn,
body.dark .pagination-btn,
body.ion-palette-dark .pagination-btn {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #30343D);
  color: var(--uni-text, #F8FAFC);
}
</style>

