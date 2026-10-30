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
  background: rgba(112, 243, 207, 0.12);
  color: #0E8560;
  border: 1px solid rgba(112, 243, 207, 0.28);
}
@media (prefers-color-scheme: dark) {
  .status-active,
  .status-success { color: var(--uni-mint); }
}

.status-pending,
.status-warning {
  background: rgba(255, 183, 143, 0.14);
  color: #D97706;
  border: 1px solid rgba(255, 183, 143, 0.28);
}

.status-danger {
  background: rgba(220, 75, 75, 0.12);
  color: #DC2626;
  border: 1px solid rgba(220, 75, 75, 0.28);
}

.status-neutral {
  background: var(--uni-surface-elevated);
  color: var(--uni-text-secondary);
  border: 1px solid var(--uni-border);
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
