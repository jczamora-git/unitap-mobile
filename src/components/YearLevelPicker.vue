<script setup lang="ts">
import type { YearLevel } from '@/types/student';
import { haptics } from '@/utilities/haptics';

const props = defineProps<{
  modelValue?: YearLevel | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: YearLevel): void;
}>();

const levels: { value: YearLevel; label: string; ariaLabel: string }[] = [
  { value: 1, label: '1', ariaLabel: '1st Year' },
  { value: 2, label: '2', ariaLabel: '2nd Year' },
  { value: 3, label: '3', ariaLabel: '3rd Year' },
  { value: 4, label: '4', ariaLabel: '4th Year' }
];

function selectLevel(lvl: YearLevel) {
  if (props.disabled || props.modelValue === lvl) return;
  haptics.light();
  emit('update:modelValue', lvl);
}
</script>

<template>
  <div class="year-segmented-wrap" role="radiogroup" aria-label="Year Level">
    <button 
      v-for="lvl in levels" 
      :key="lvl.value"
      type="button"
      role="radio"
      :aria-checked="modelValue === lvl.value"
      :aria-label="lvl.ariaLabel"
      class="year-segment-btn"
      :class="{ 'year-segment-active': modelValue === lvl.value }"
      :disabled="disabled"
      @click="selectLevel(lvl.value)"
    >
      <span class="year-digit">{{ lvl.label }}</span>
      <span class="year-suffix">{{ lvl.value === 1 ? 'st' : lvl.value === 2 ? 'nd' : lvl.value === 3 ? 'rd' : 'th' }} Yr</span>
    </button>
  </div>
</template>

<style scoped>
.year-segmented-wrap {
  width: 100%;
  display: flex;
  align-items: center;
  background: var(--uni-surface-input);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-input);
  padding: 3px;
  gap: 3px;
  box-sizing: border-box;
}

.year-segment-btn {
  flex: 1;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--uni-text-secondary);
  font-family: var(--uni-font-family);
  cursor: pointer;
  transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  padding: 0 4px;
  user-select: none;
}

.year-segment-btn:active:not(.year-segment-active) {
  transform: scale(0.96);
}

.year-segment-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.year-digit {
  font-size: 14.5px;
  font-weight: 700;
  line-height: 1;
}

.year-suffix {
  font-size: 11px;
  font-weight: 500;
  opacity: 0.75;
  line-height: 1;
}

.year-segment-active {
  background: var(--uni-surface);
  border-color: rgba(112, 243, 207, 0.45);
  color: #0E8560;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

@media (prefers-color-scheme: dark) {
  .year-segment-active {
    background: rgba(112, 243, 207, 0.12);
    border-color: rgba(112, 243, 207, 0.35);
    color: var(--uni-mint);
  }
}
</style>
