<script setup lang="ts">
import { haptics } from '@/utilities/haptics';

interface Option {
  value: any;
  label: string;
  ariaLabel?: string;
  sublabel?: string;
}

interface Props {
  modelValue: any;
  options: Option[];
  size?: 'sm' | 'md';
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  disabled: false
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: any): void;
}>();

function selectOption(value: any) {
  if (props.disabled || props.modelValue === value) return;
  haptics.light();
  emit('update:modelValue', value);
}
</script>

<template>
  <div 
    class="uni-segmented-control" 
    :class="[`control-${size}`, { 'is-disabled': disabled }]"
    role="tablist"
  >
    <button
      v-for="opt in options"
      :key="String(opt.value)"
      type="button"
      role="tab"
      :aria-selected="modelValue === opt.value"
      :aria-label="opt.ariaLabel || opt.label"
      class="segment-item"
      :class="{ 'segment-active': modelValue === opt.value }"
      @click="selectOption(opt.value)"
    >
      <span class="segment-label">{{ opt.label }}</span>
      <span v-if="opt.sublabel" class="segment-sublabel">{{ opt.sublabel }}</span>
    </button>
  </div>
</template>

<style scoped>
.uni-segmented-control {
  display: flex;
  align-items: center;
  background: var(--uni-surface-input);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-pill);
  padding: 3px;
  gap: 2px;
  width: 100%;
  box-sizing: border-box;
}

.control-sm {
  height: 38px;
}

.control-md {
  height: 44px;
}

.segment-item {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: var(--uni-radius-pill);
  border: none;
  background: transparent;
  color: var(--uni-text-secondary);
  font-family: var(--uni-font-family);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  padding: 0 10px;
  user-select: none;
  white-space: nowrap;
}

.segment-item:active:not(.segment-active) {
  transform: scale(0.96);
}

.segment-active {
  background: var(--uni-surface);
  color: var(--uni-text-primary);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  border: 1px solid var(--uni-border);
}

@media (prefers-color-scheme: dark) {
  .segment-active {
    background: var(--uni-surface-elevated);
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.segment-label {
  line-height: 1;
}

.segment-sublabel {
  font-size: 10.5px;
  opacity: 0.7;
}

.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}
</style>
