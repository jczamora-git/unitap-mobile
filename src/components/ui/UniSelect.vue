<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { chevronDownOutline } from 'ionicons/icons';

interface Option {
  value: string | number;
  label: string;
}

interface Props {
  modelValue?: string | number | null;
  options?: Option[];
  placeholder?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  options: () => [],
  placeholder: 'Select option',
  disabled: false
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number): void;
}>();

function handleChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  emit('update:modelValue', target.value);
}
</script>

<template>
  <div class="uni-select-wrap" :class="{ 'is-disabled': disabled }">
    <select
      :value="modelValue ?? ''"
      :disabled="disabled"
      class="uni-native-select"
      @change="handleChange"
    >
      <option v-if="placeholder" value="" disabled :selected="!modelValue">
        {{ placeholder }}
      </option>
      <option 
        v-for="opt in options" 
        :key="opt.value" 
        :value="opt.value"
      >
        {{ opt.label }}
      </option>
      <slot />
    </select>

    <ion-icon :icon="chevronDownOutline" class="select-chevron" />
  </div>
</template>

<style scoped>
.uni-select-wrap {
  position: relative;
  width: 100%;
  height: 48px;
  background: var(--uni-surface-input);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-input);
  display: flex;
  align-items: center;
  box-sizing: border-box;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.uni-select-wrap:focus-within {
  border-color: rgba(112, 243, 207, 0.6);
  box-shadow: 0 0 0 3px rgba(112, 243, 207, 0.12);
  background: var(--uni-surface);
}

.uni-native-select {
  width: 100%;
  height: 100%;
  padding: 0 36px 0 14px;
  background: transparent;
  border: none;
  outline: none;
  color: var(--uni-text-primary);
  font-family: var(--uni-font-family);
  font-size: 14px;
  font-weight: 500;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}

.uni-native-select option {
  background: var(--uni-surface);
  color: var(--uni-text-primary);
}

.select-chevron {
  position: absolute;
  right: 14px;
  pointer-events: none;
  font-size: 16px;
  color: var(--uni-text-muted);
}

.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}
</style>
