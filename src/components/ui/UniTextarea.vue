<script setup lang="ts">
interface Props {
  modelValue?: string | null;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
}

withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: '',
  rows: 3,
  disabled: false,
  readonly: false,
  required: false
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

function handleInput(event: Event) {
  const target = event.target as HTMLTextAreaElement;
  emit('update:modelValue', target.value);
}
</script>

<template>
  <div class="uni-textarea-wrap" :class="{ 'is-disabled': disabled, 'is-readonly': readonly }">
    <textarea
      :value="modelValue ?? ''"
      :placeholder="placeholder"
      :rows="rows"
      :disabled="disabled"
      :readonly="readonly"
      :required="required"
      class="uni-native-textarea"
      @input="handleInput"
    ></textarea>
  </div>
</template>

<style scoped>
.uni-textarea-wrap {
  width: 100%;
  background: var(--uni-surface-input);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-input);
  padding: 10px 14px;
  box-sizing: border-box;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.uni-textarea-wrap:focus-within {
  border-color: rgba(112, 243, 207, 0.6);
  box-shadow: 0 0 0 3px rgba(112, 243, 207, 0.12);
  background: var(--uni-surface);
}

.uni-native-textarea {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: var(--uni-text-primary);
  font-family: var(--uni-font-family);
  font-size: 14px;
  font-weight: 500;
  resize: vertical;
  line-height: 1.45;
  box-sizing: border-box;
}

.uni-native-textarea::placeholder {
  color: var(--uni-text-muted);
}

.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}
</style>
