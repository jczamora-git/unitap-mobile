<script setup lang="ts">
import { haptics } from '@/utilities/haptics';

interface Props {
  variant?: 'default' | 'elevated' | 'subtle';
  padding?: 'sm' | 'md' | 'lg' | 'none';
  interactive?: boolean;
  overflow?: 'visible' | 'hidden';
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  padding: 'md',
  interactive: false,
  overflow: 'visible',
});

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();

function handleClick(event: MouseEvent) {
  if (props.interactive) {
    haptics.light();
    emit('click', event);
  }
}
</script>

<template>
  <div
    class="uni-card"
    :class="[
      `uni-card-${variant}`,
      `uni-card-p-${padding}`,
      `uni-card-overflow-${overflow}`,
      { 'uni-card-interactive': interactive }
    ]"
    @click="handleClick"
  >
    <slot />
  </div>
</template>

<style scoped>
.uni-card {
  border-radius: var(--uni-radius-card);
  transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), 
              border-color 0.15s ease, 
              background 0.15s ease;
  box-sizing: border-box;
  position: relative;
}

.uni-card:has(.uni-select-container.is-active),
.uni-card:has(.is-active) {
  z-index: 50;
}

.uni-card-overflow-visible {
  overflow: visible;
}

.uni-card-overflow-hidden {
  overflow: hidden;
}

/* Variants */
.uni-card-default {
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  box-shadow: var(--uni-shadow-card);
}

.uni-card-elevated {
  background: var(--uni-surface-elevated);
  border: 1px solid var(--uni-border);
  box-shadow: var(--uni-shadow-card);
}

.uni-card-subtle {
  background: var(--uni-surface-elevated);
  border: 1px solid transparent;
}

/* Paddings */
.uni-card-p-none {
  padding: 0;
}

.uni-card-p-sm {
  padding: var(--uni-card-p-sm, 12px 14px);
}

.uni-card-p-md {
  padding: var(--uni-card-p-md, 16px 18px);
}

.uni-card-p-lg {
  padding: var(--uni-card-p-lg, 20px 22px);
}

@media (max-width: 380px) {
  .uni-card-p-md {
    padding: 12px 14px;
  }
  .uni-card-p-lg {
    padding: 14px 16px;
  }
}

/* Interactive */
.uni-card-interactive {
  cursor: pointer;
}

.uni-card-interactive:active {
  transform: scale(0.985);
  border-color: rgba(112, 243, 207, 0.4);
}
</style>
