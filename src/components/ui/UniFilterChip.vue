<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

interface Props {
  label: string;
  removable?: boolean;
  active?: boolean;
  variant?: 'default' | 'primary';
}

withDefaults(defineProps<Props>(), {
  removable: true,
  active: true,
  variant: 'default',
});

const emit = defineEmits<{
  (e: 'remove'): void;
  (e: 'click'): void;
}>();

function handleRemove(event: MouseEvent) {
  event.stopPropagation();
  haptics.light();
  emit('remove');
}

function handleClick() {
  haptics.light();
  emit('click');
}
</script>

<template>
  <span
    class="uni-filter-chip"
    :class="[`chip-${variant}`, { 'is-active': active, 'is-removable': removable }]"
    role="button"
    tabindex="0"
    @click="handleClick"
    @keydown.enter.space.prevent="handleClick"
  >
    <span class="chip-label">{{ label }}</span>
    <button
      v-if="removable"
      type="button"
      class="chip-remove-btn"
      aria-label="Remove filter"
      @click="handleRemove"
    >
      <ion-icon :icon="closeOutline" />
    </button>
  </span>
</template>

<style scoped>
.uni-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  background: var(--uni-surface-secondary, #f1f5f9);
  border: 1px solid var(--uni-border, #cbd5e1);
  border-radius: var(--uni-radius-pill, 9999px);
  color: var(--uni-text, #0f172a);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  box-sizing: border-box;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.uni-filter-chip:hover {
  border-color: var(--uni-primary, #0f766e);
}

.uni-filter-chip.chip-primary {
  background: rgba(15, 118, 110, 0.1);
  border-color: rgba(15, 118, 110, 0.3);
  color: var(--uni-primary, #0f766e);
}

.chip-label {
  display: inline-block;
  line-height: 1;
}

.chip-remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: -2px;
  margin-right: -4px;
  padding: 0;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--uni-text-secondary, #64748b);
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.chip-remove-btn:hover {
  background: rgba(0, 0, 0, 0.08);
  color: var(--uni-danger, #dc2626);
}

:root.dark .uni-filter-chip,
:root.ion-palette-dark .uni-filter-chip,
body.dark .uni-filter-chip,
body.ion-palette-dark .uni-filter-chip,
:global(.dark) .uni-filter-chip,
:global(.ion-palette-dark) .uni-filter-chip {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #30343D);
  color: var(--uni-text, #F8FAFC);
}

:root.dark .uni-filter-chip.chip-primary,
:root.ion-palette-dark .uni-filter-chip.chip-primary,
body.dark .uni-filter-chip.chip-primary,
body.ion-palette-dark .uni-filter-chip.chip-primary,
:global(.dark) .uni-filter-chip.chip-primary,
:global(.ion-palette-dark) .uni-filter-chip.chip-primary {
  background: rgba(94, 234, 212, 0.14);
  border-color: rgba(94, 234, 212, 0.35);
  color: var(--uni-primary, #5EEAD4);
}

:root.dark .chip-remove-btn:hover,
:root.ion-palette-dark .chip-remove-btn:hover,
body.dark .chip-remove-btn:hover,
body.ion-palette-dark .chip-remove-btn:hover,
:global(.dark) .chip-remove-btn:hover,
:global(.ion-palette-dark) .chip-remove-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fca5a5;
}
</style>
