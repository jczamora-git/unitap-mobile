<script setup lang="ts">
interface Props {
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string;
}

withDefaults(defineProps<Props>(), {
  label: '',
  required: false,
  hint: '',
  error: ''
});
</script>

<template>
  <div class="uni-form-field">
    <div v-if="label || $slots.label" class="field-label-row">
      <label class="field-label">
        <slot name="label">{{ label }}</slot>
        <span v-if="required" class="field-req-mark" aria-hidden="true">*</span>
      </label>
      <slot name="top-right" />
    </div>

    <div class="field-control-wrap">
      <slot />
    </div>

    <span v-if="error" class="field-error-msg" role="alert">{{ error }}</span>
    <span v-else-if="hint" class="field-hint-msg">{{ hint }}</span>
  </div>
</template>

<style scoped>
.uni-form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field-label {
  font-size: 13px;
  font-weight: 550;
  color: var(--uni-text-secondary);
  line-height: 1.2;
}

.field-req-mark {
  color: #EF4444;
  margin-left: 2px;
}

.field-control-wrap {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.field-error-msg {
  font-size: 11.5px;
  color: #DC2626;
  line-height: 1.3;
  margin-top: 1px;
}

.field-hint-msg {
  font-size: 11.5px;
  color: var(--uni-text-muted);
  line-height: 1.3;
  margin-top: 1px;
}
</style>
