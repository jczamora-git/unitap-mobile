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

@media (max-width: 380px) {
  .control-md {
    height: 40px;
  }
  .segment-item {
    font-size: 12px;
    padding: 0 6px;
    gap: 2px;
  }
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
  color: var(--uni-primary);
  font-weight: 650;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  border: 1px solid var(--uni-border);
}

:root.dark .segment-active,
:root.ion-palette-dark .segment-active,
body.dark .segment-active,
body.ion-palette-dark .segment-active {
  background: var(--uni-surface-elevated);
  color: var(--uni-primary);
  border-color: rgba(255, 255, 255, 0.1);
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

@media (max-width: 380px) {
  .segment-item {
    padding: 0 6px;
    font-size: 12px;
  }
}
</style>
