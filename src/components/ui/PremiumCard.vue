<script setup lang="ts">
import { computed } from 'vue';
import { haptics } from '@/utilities/haptics';

interface Props {
  variant?: 'standard' | 'hero' | 'interactive' | 'digital-id';
  gradient?: 'primary' | 'cool' | 'warm' | 'mint';
  interactive?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'standard',
  gradient: 'primary',
  interactive: false
});

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();

const cardClass = computed(() => {
  if (props.variant === 'hero') {
    return `aurora-card aurora-variant-${props.gradient}`;
  }
  if (props.variant === 'digital-id') {
    return 'digital-id-card';
  }
  return 'minimal-card';
});

function handleClick(e: MouseEvent) {
  if (props.interactive || props.variant === 'interactive') {
    haptics.light();
    emit('click', e);
  }
}
</script>

<template>
  <div
    class="premium-card-root"
    :class="[
      cardClass,
      { 'tactile-press interactive-surface': interactive || variant === 'interactive' }
    ]"
    @click="handleClick"
  >
    <slot />
  </div>
</template>

<style scoped>
.premium-card-root {
  position: relative;
  transition: transform var(--motion-fast) var(--ease-spring), box-shadow var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.interactive-surface {
  cursor: pointer;
}

.interactive-surface:active {
  transform: scale(0.985);
  border-color: var(--aurora-mint);
}
</style>
