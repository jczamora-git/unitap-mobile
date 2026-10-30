<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { checkmarkOutline } from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

interface Props {
  modelValue?: boolean;
  label?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  label: '',
  disabled: false
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

function toggle() {
  if (props.disabled) return;
  haptics.light();
  emit('update:modelValue', !props.modelValue);
}
</script>

<template>
  <label class="uni-checkbox-wrap" :class="{ 'is-disabled': disabled }" @click.prevent="toggle">
    <div class="checkbox-box" :class="{ 'is-checked': modelValue }">
      <ion-icon v-if="modelValue" :icon="checkmarkOutline" class="check-icon" />
    </div>
    <span v-if="label || $slots.default" class="checkbox-label">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>

<style scoped>
.uni-checkbox-wrap {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.checkbox-box {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1.5px solid var(--uni-border);
  background: var(--uni-surface-input);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.checkbox-box.is-checked {
  background: var(--uni-mint);
  border-color: var(--uni-mint);
  box-shadow: 0 0 10px rgba(112, 243, 207, 0.3);
}

.check-icon {
  font-size: 14px;
  color: #0A1C16;
  font-weight: 800;
}

.checkbox-label {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--uni-text-primary);
}

.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}
</style>
