<script setup lang="ts">
import { IonIcon } from '@ionic/vue';

interface Props {
  modelValue?: string | number | null;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  icon?: any;
  monospace?: boolean;
  autocapitalize?: string;
  autocomplete?: string;
  inputmode?: 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url';
}

withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: '',
  type: 'text',
  disabled: false,
  readonly: false,
  required: false,
  icon: undefined,
  monospace: false,
  autocapitalize: 'none',
  autocomplete: 'off',
  inputmode: 'text'
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'focus', event: FocusEvent): void;
  (e: 'blur', event: FocusEvent): void;
}>();

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  emit('update:modelValue', target.value);
}
</script>

<template>
  <div 
    class="uni-input-wrap"
    :class="{ 
      'is-disabled': disabled, 
      'is-readonly': readonly,
      'has-icon': Boolean(icon)
    }"
  >
    <ion-icon v-if="icon" :icon="icon" class="input-lead-icon" />

    <input
      :type="type"
      :value="modelValue ?? ''"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :required="required"
      :autocapitalize="autocapitalize"
      :autocomplete="autocomplete"
      :inputmode="inputmode"
      class="uni-native-input"
      :class="{ 'font-mono': monospace }"
      @input="handleInput"
      @focus="emit('focus', $event)"
      @blur="emit('blur', $event)"
    />

    <slot name="trailing" />
  </div>
</template>

<style scoped>
.uni-input-wrap {
  width: 100%;
  height: 48px;
  background: var(--uni-surface-input);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-input);
  display: flex;
  align-items: center;
  padding: 0 14px;
  gap: 10px;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  box-sizing: border-box;
}

.uni-input-wrap:focus-within {
  border-color: rgba(112, 243, 207, 0.6);
  box-shadow: 0 0 0 3px rgba(112, 243, 207, 0.12);
  background: var(--uni-surface);
}

.uni-native-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: var(--uni-text-primary);
  font-family: var(--uni-font-family);
  font-size: 14px;
  font-weight: 500;
  box-sizing: border-box;
}

.uni-native-input::placeholder {
  color: var(--uni-text-muted);
  font-weight: 400;
}

.input-lead-icon {
  font-size: 18px;
  color: var(--uni-text-muted);
  flex-shrink: 0;
  transition: color 0.15s ease;
}

.uni-input-wrap:focus-within .input-lead-icon {
  color: var(--uni-mint);
}

.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.is-readonly {
  background: var(--uni-surface-elevated);
}
</style>
