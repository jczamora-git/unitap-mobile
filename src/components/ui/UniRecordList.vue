<script setup lang="ts">
interface Props {
  loading?: boolean;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

withDefaults(defineProps<Props>(), {
  loading: false,
  empty: false,
  emptyTitle: 'No records found',
  emptyDescription: 'There are no items to display.',
});
</script>

<template>
  <div class="uni-record-list">
    <!-- Optional Toolbar / Search slot -->
    <div v-if="$slots.toolbar" class="list-toolbar">
      <slot name="toolbar" />
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="list-loading">
      <slot name="loading">
        <div class="default-spinner-box">
          <span class="loading-label">Loading records...</span>
        </div>
      </slot>
    </div>

    <!-- Empty State -->
    <div v-else-if="empty" class="list-empty">
      <slot name="empty">
        <div class="default-empty-box">
          <p class="empty-title">{{ emptyTitle }}</p>
          <p class="empty-desc">{{ emptyDescription }}</p>
        </div>
      </slot>
    </div>

    <!-- Records Items List -->
    <div v-else class="list-items">
      <slot />
    </div>

    <!-- Pagination slot -->
    <div v-if="$slots.pagination" class="list-pagination">
      <slot name="pagination" />
    </div>
  </div>
</template>

<style scoped>
.uni-record-list {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.list-toolbar {
  margin-bottom: 12px;
}

.list-loading,
.list-empty {
  padding: 32px 16px;
  text-align: center;
}

.default-empty-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.empty-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
  margin: 0;
}

.empty-desc {
  font-size: 12.5px;
  color: var(--uni-text-secondary, #64748b);
  margin: 0;
}

.list-items {
  display: flex;
  flex-direction: column;
}

.list-pagination {
  margin-top: 4px;
}
</style>

