<script setup lang="ts">
interface Props {
  variant?: 'active' | 'pending' | 'success' | 'danger' | 'warning' | 'neutral';
  pulse?: boolean;
}

withDefaults(defineProps<Props>(), {
  variant: 'neutral',
  pulse: false
});
</script>

<template>
  <span class="uni-status-badge" :class="[`status-${variant}`]">
    <span v-if="pulse" class="badge-pulse-dot" />
    <slot />
  </span>
</template>

<style scoped>
.uni-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: var(--uni-radius-pill);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
}

.status-active,
.status-success {
  background: var(--uni-success-bg);
  color: var(--uni-success-text);
  border: 1px solid var(--uni-success-border);
}

.status-pending,
.status-warning {
  background: var(--uni-warning-bg);
  color: var(--uni-warning-text);
  border: 1px solid var(--uni-warning-border);
}

.status-danger {
  background: var(--uni-danger-bg);
  color: var(--uni-danger-text);
  border: 1px solid var(--uni-danger-border);
}

.status-neutral {
  background: var(--uni-neutral-bg);
  color: var(--uni-neutral-text);
  border: 1px solid var(--uni-neutral-border);
}

.badge-pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 6px currentColor;
  animation: badge-pulse 2s infinite ease-in-out;
}

@keyframes badge-pulse {
  0%, 100% { opacity: 0.6; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.15); }
}
</style>
