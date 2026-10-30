<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon, IonSpinner } from '@ionic/vue';
import { haptics } from '@/utilities/haptics';

interface Props {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: any;
  iconEnd?: any;
  haptic?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  loading: false,
  disabled: false,
  icon: undefined,
  iconEnd: undefined,
  haptic: true
});

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();

const variantClass = computed(() => {
  switch (props.variant) {
    case 'secondary': return 'btn-ui-secondary';
    case 'ghost': return 'btn-ui-ghost';
    case 'destructive': return 'btn-ui-destructive';
    default: return 'btn-ui-primary';
  }
});

const sizeClass = computed(() => {
  if (props.size === 'sm') return 'btn-ui-sm';
  if (props.size === 'lg') return 'btn-ui-lg';
  return '';
});

function handleClick(e: MouseEvent) {
  if (props.disabled || props.loading) return;
  if (props.haptic) {
    haptics.light();
  }
  emit('click', e);
}
</script>

<template>
  <button
    class="btn-ui"
    :class="[variantClass, sizeClass, { 'btn-loading': loading }]"
    :disabled="disabled || loading"
    @click="handleClick"
  >
    <ion-spinner v-if="loading" name="crescent" class="btn-spinner" />
    <ion-icon v-else-if="icon" :icon="icon" class="btn-icon-start" />
    
    <span class="btn-label-text">
      <slot />
    </span>

    <ion-icon v-if="iconEnd && !loading" :icon="iconEnd" class="btn-icon-end" />
  </button>
</template>

<style scoped>
.btn-ui-lg {
  height: 52px;
  padding: 0 24px;
  font-size: 15px;
  border-radius: 15px;
}

.btn-icon-start,
.btn-icon-end {
  font-size: 18px;
}

.btn-spinner {
  width: 18px;
  height: 18px;
  color: currentColor;
}

.btn-loading {
  opacity: 0.85;
  cursor: wait;
}

button:disabled:not(.btn-loading) {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
}
</style>
