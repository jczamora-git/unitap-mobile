<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  variant?: 'success' | 'warning' | 'danger' | 'neutral' | 'accent' | 'mint';
  label?: string;
  pulse?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'neutral',
  label: '',
  pulse: false
});

const badgeClass = computed(() => {
  switch (props.variant) {
    case 'success': return 'badge-success';
    case 'warning': return 'badge-warning';
    case 'danger': return 'badge-danger';
    case 'accent': return 'badge-accent';
    case 'mint': return 'badge-aurora-mint';
    default: return 'badge-neutral';
  }
});
</script>

<template>
  <span class="status-badge" :class="badgeClass">
    <span v-if="pulse" class="pulse-dot"></span>
    <slot>{{ label }}</slot>
  </span>
</template>

<style scoped>
.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  display: inline-block;
  box-shadow: 0 0 8px currentColor;
}
</style>
