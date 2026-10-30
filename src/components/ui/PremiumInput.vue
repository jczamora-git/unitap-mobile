<script setup lang="ts">
import { IonIcon } from '@ionic/vue';

interface Props {
  modelValue?: string | number;
  label?: string;
  placeholder?: string;
  type?: string;
  icon?: any;
  error?: string;
  hint?: string;
  disabled?: boolean;
}

withDefaults(defineProps<Props>(), {
  modelValue: '',
  label: '',
  placeholder: '',
  type: 'text',
  icon: undefined,
  error: '',
  hint: '',
  disabled: false
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

function onInput(e: Event) {
  const target = e.target as HTMLInputElement;
  emit('update:modelValue', target.value);
}
</script>

<template>
  <div class="premium-input-group" :class="{ 'has-error': !!error, 'is-disabled': disabled }">
    <label v-if="label" class="input-label">{{ label }}</label>
    
    <div class="input-field-surface">
      <ion-icon v-if="icon" :icon="icon" class="input-prefix-icon" />
      <input
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        class="native-input"
        @input="onInput"
      />
    </div>

    <span v-if="error" class="input-error-msg">{{ error }}</span>
    <span v-else-if="hint" class="input-hint-msg">{{ hint }}</span>
  </div>
</template>

<style scoped>
.premium-input-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
}

.input-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-primary);
}

.input-field-surface {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 14px;
  border-radius: var(--app-input-radius);
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  transition: border-color var(--motion-fast) ease, box-shadow var(--motion-fast) ease;
}

.input-field-surface:focus-within {
  border-color: var(--aurora-mint);
  box-shadow: 0 0 0 2px rgba(112, 243, 207, 0.2);
}

.native-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 14px;
  color: var(--app-text-primary);
  font-family: inherit;
}

.native-input::placeholder {
  color: var(--app-text-muted);
}

.input-prefix-icon {
  font-size: 18px;
  color: var(--app-text-secondary);
}

.has-error .input-field-surface {
  border-color: var(--ion-color-danger);
  box-shadow: 0 0 0 2px rgba(220, 75, 75, 0.15);
}

.input-error-msg {
  font-size: 11px;
  font-weight: 500;
  color: var(--ion-color-danger);
}

.input-hint-msg {
  font-size: 11px;
  color: var(--app-text-muted);
}
</style>
