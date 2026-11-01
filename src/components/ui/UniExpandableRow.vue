<script setup lang="ts">
import { ref, watch } from 'vue';
import { IonIcon } from '@ionic/vue';
import { chevronDownOutline } from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

interface Props {
  title?: string;
  subtitle?: string;
  badge?: string;
  badgeVariant?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  amount?: string;
  amountVariant?: 'default' | 'success' | 'danger';
  isExpanded?: boolean;
  defaultExpanded?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  subtitle: '',
  badge: '',
  badgeVariant: 'neutral',
  amount: '',
  amountVariant: 'default',
  isExpanded: undefined,
  defaultExpanded: false,
});

const emit = defineEmits<{
  (e: 'update:isExpanded', expanded: boolean): void;
  (e: 'toggle', expanded: boolean): void;
}>();

const internalExpanded = ref(props.defaultExpanded);

watch(
  () => props.isExpanded,
  (val) => {
    if (val !== undefined) {
      internalExpanded.value = val;
    }
  },
  { immediate: true }
);

function toggleRow() {
  haptics.light();
  const next = !internalExpanded.value;
  internalExpanded.value = next;
  emit('update:isExpanded', next);
  emit('toggle', next);
}
</script>

<template>
  <div class="uni-expandable-row" :class="{ 'is-open': internalExpanded }">
    <!-- Row Header (Always Visible Summary) -->
    <div
      class="row-header"
      role="button"
      tabindex="0"
      :aria-expanded="internalExpanded"
      @click="toggleRow"
      @keydown.enter.space.prevent="toggleRow"
    >
      <div class="row-left">
        <slot name="leading" />
        <div class="row-titles">
          <div class="title-line">
            <span class="row-title">{{ title }}</span>
            <slot name="title-suffix" />
            <span
              v-if="badge"
              class="row-badge"
              :class="`badge-${badgeVariant}`"
            >
              {{ badge }}
            </span>
          </div>
          <span v-if="subtitle" class="row-subtitle">{{ subtitle }}</span>
        </div>
      </div>

      <div class="row-right">
        <div v-if="amount" class="row-amount" :class="`amount-${amountVariant}`">
          {{ amount }}
        </div>
        <slot name="trailing" />
        <ion-icon
          :icon="chevronDownOutline"
          class="row-chevron"
          :class="{ 'is-rotated': internalExpanded }"
        />
      </div>
    </div>

    <!-- Collapsible Body Details -->
    <div v-show="internalExpanded" class="row-body">
      <div class="body-content">
        <slot name="content">
          <slot />
        </slot>
      </div>
      <div v-if="$slots.actions" class="body-actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.uni-expandable-row {
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: var(--uni-radius-card, 14px);
  box-shadow: var(--uni-shadow-card);
  overflow: hidden;
  transition: border-color 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease;
  margin-bottom: 8px;
}

.uni-expandable-row.is-open {
  border-color: var(--uni-primary, #0f766e);
}

.row-header {
  min-height: 52px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  user-select: none;
  background: transparent;
  outline: none;
  transition: background-color 0.14s ease;
}

.row-header:hover {
  background: var(--uni-surface-secondary, #f8fafc);
}

.row-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.row-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.row-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
  word-break: break-word;
  line-height: 1.3;
}

.row-subtitle {
  font-size: 11.5px;
  color: var(--uni-text-secondary, #64748b);
  word-break: break-word;
  line-height: 1.35;
}

.row-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 9999px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.badge-neutral {
  background: var(--uni-surface-secondary, #f1f5f9);
  color: var(--uni-text-secondary, #64748b);
  border: 1px solid var(--uni-border, #e2e8f0);
}

.badge-primary {
  background: rgba(15, 118, 110, 0.1);
  color: var(--uni-primary, #0f766e);
}

.badge-success {
  background: rgba(5, 150, 105, 0.1);
  color: var(--uni-success, #059669);
}

.badge-warning {
  background: rgba(217, 119, 6, 0.1);
  color: var(--uni-warning, #d97706);
}

.badge-danger {
  background: rgba(220, 38, 38, 0.1);
  color: var(--uni-danger, #dc2626);
}

.row-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.row-amount {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
}

.amount-success {
  color: var(--uni-success, #059669);
}

.amount-danger {
  color: var(--uni-danger, #dc2626);
}

.row-chevron {
  font-size: 16px;
  color: var(--uni-text-secondary, #64748b);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), color 0.16s ease;
  flex-shrink: 0;
}

.row-chevron.is-rotated {
  transform: rotate(180deg);
  color: var(--uni-primary, #0f766e);
}

.row-body {
  border-top: 1px solid var(--uni-border, #f1f5f9);
  padding: 12px 14px;
  background: var(--uni-surface-secondary, #f8fafc);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.body-content {
  font-size: 12.5px;
  color: var(--uni-text, #0f172a);
}

.body-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px dashed var(--uni-border, #e2e8f0);
}

@media (max-width: 380px) {
  .row-header {
    padding: 10px 12px;
    gap: 8px;
  }

  .row-body {
    padding: 10px 12px;
    gap: 8px;
  }

  .body-actions {
    justify-content: stretch;
  }

  .body-actions > * {
    flex: 1 1 auto;
    min-width: 80px;
  }
}

:root.dark .uni-expandable-row,
:root.ion-palette-dark .uni-expandable-row,
body.dark .uni-expandable-row,
body.ion-palette-dark .uni-expandable-row {
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
}

:root.dark .row-body,
:root.ion-palette-dark .row-body,
body.dark .row-body,
body.ion-palette-dark .row-body {
  background: var(--uni-surface-secondary, #252830);
  border-top-color: var(--uni-border, #30343D);
}

:root.dark .uni-expandable-row.is-open,
:root.ion-palette-dark .uni-expandable-row.is-open,
body.dark .uni-expandable-row.is-open,
body.ion-palette-dark .uni-expandable-row.is-open {
  border-color: var(--uni-primary, #5EEAD4);
}
</style>

