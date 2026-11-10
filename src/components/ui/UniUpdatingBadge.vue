<script setup lang="ts">
interface Props {
  text?: string;
  dotOnly?: boolean;
}

withDefaults(defineProps<Props>(), {
  text: 'Updating...',
  dotOnly: false,
});
</script>

<template>
  <span
    class="uni-updating-badge font-mono"
    :class="{ 'dot-only': dotOnly }"
    role="status"
    aria-live="polite"
    aria-label="Updating data in background"
  >
    <span class="updating-dot" aria-hidden="true"></span>
    <span v-if="!dotOnly" class="updating-text">{{ text }}</span>
  </span>
</template>

<style scoped>
.uni-updating-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  border-radius: 9999px;
  background: rgba(15, 118, 110, 0.12);
  border: 1px solid rgba(15, 118, 110, 0.28);
  color: var(--uni-mint, #0F766E);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1;
  user-select: none;
  animation: badge-fade-in 0.2s ease-out;
}

.dot-only {
  padding: 3px;
  background: transparent;
  border: none;
}

.updating-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: #0F766E;
  display: inline-block;
  animation: pulse-breathing 1.4s ease-in-out infinite;
}

:root.dark .updating-dot,
:root.ion-palette-dark .updating-dot,
body.dark .updating-dot,
body.ion-palette-dark .updating-dot {
  background: #70F3CF;
  box-shadow: 0 0 6px rgba(112, 243, 207, 0.6);
}

:root.dark .uni-updating-badge,
:root.ion-palette-dark .uni-updating-badge,
body.dark .uni-updating-badge,
body.ion-palette-dark .uni-updating-badge {
  color: #70F3CF;
  background: rgba(112, 243, 207, 0.08);
  border-color: rgba(112, 243, 207, 0.25);
}

@keyframes pulse-breathing {
  0% {
    transform: scale(0.85);
    opacity: 0.5;
  }
  50% {
    transform: scale(1.15);
    opacity: 1;
  }
  100% {
    transform: scale(0.85);
    opacity: 0.5;
  }
}

@keyframes badge-fade-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .updating-dot {
    animation: none;
  }
}
</style>

