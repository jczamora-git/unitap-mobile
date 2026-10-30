<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { haptics } from '@/utilities/haptics';

interface Props {
  label: string;
  value: string | number;
  meta?: string;
  icon?: any;
  iconColor?: 'mint' | 'blue' | 'violet' | 'amber' | 'neutral';
  valueColor?: 'default' | 'mint' | 'danger' | 'success' | 'warning';
  interactive?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  meta: '',
  icon: undefined,
  iconColor: 'mint',
  valueColor: 'default',
  interactive: true
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
    class="uni-stat-card" 
    :class="{ 'stat-interactive': interactive }"
    @click="handleClick"
  >
    <div class="stat-top-row">
      <span class="stat-label">{{ label }}</span>
      <div v-if="icon" class="stat-icon-box" :class="[`icon-box-${iconColor}`]">
        <ion-icon :icon="icon" />
      </div>
      <slot name="top-right" />
    </div>

    <div class="stat-value-row">
      <span class="stat-num tabular-nums font-mono" :class="[`num-${valueColor}`]">
        {{ value }}
      </span>
    </div>

    <span v-if="meta || $slots.meta" class="stat-meta">
      <slot name="meta">{{ meta }}</slot>
    </span>
  </div>
</template>

<style scoped>
.uni-stat-card {
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-card);
  padding: 14px 16px;
  box-shadow: var(--uni-shadow-card);
  display: flex;
  flex-direction: column;
  transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.15s ease;
  box-sizing: border-box;
}

.stat-interactive {
  cursor: pointer;
}

.stat-interactive:active {
  transform: scale(0.985);
  border-color: rgba(112, 243, 207, 0.35);
}

.stat-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.stat-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--uni-text-secondary);
  line-height: 1.2;
}

.stat-icon-box {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
}

.icon-box-mint {
  background: rgba(112, 243, 207, 0.12);
  color: #0E8560;
}
@media (prefers-color-scheme: dark) {
  .icon-box-mint { color: var(--uni-mint); }
}

.icon-box-blue {
  background: rgba(101, 191, 255, 0.12);
  color: var(--uni-blue);
}

.icon-box-violet {
  background: rgba(139, 133, 246, 0.12);
  color: var(--uni-violet);
}

.icon-box-amber {
  background: rgba(255, 183, 143, 0.14);
  color: #D97706;
}

.icon-box-neutral {
  background: var(--uni-surface-elevated);
  color: var(--uni-text-muted);
}

.stat-value-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.stat-num {
  font-size: 20px;
  font-weight: 700;
  color: var(--uni-text-primary);
  line-height: 1.2;
}

.num-mint { color: var(--uni-mint); }
.num-success { color: #10B981; }
.num-danger { color: #EF4444; }
.num-warning { color: #F59E0B; }

.stat-meta {
  font-size: 11px;
  color: var(--uni-text-muted);
  margin-top: 4px;
  line-height: 1.2;
}
</style>
