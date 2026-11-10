<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { haptics } from '@/utilities/haptics';
import UniSkeleton from './UniSkeleton.vue';
import UniUpdatingBadge from './UniUpdatingBadge.vue';
import UniAnimatedCounter from './UniAnimatedCounter.vue';
import type { NumberFormatType } from '@/composables/useAnimatedNumber';

interface Props {
  label: string;
  value?: string | number | null;
  meta?: string;
  icon?: any;
  iconColor?: 'mint' | 'blue' | 'violet' | 'amber' | 'neutral';
  valueColor?: 'default' | 'mint' | 'danger' | 'success' | 'warning';
  interactive?: boolean;
  loading?: boolean;
  updating?: boolean;
  stale?: boolean;
  animated?: boolean;
  format?: NumberFormatType;
  isCentavos?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  value: '',
  meta: '',
  icon: undefined,
  iconColor: 'mint',
  valueColor: 'default',
  interactive: true,
  loading: false,
  updating: false,
  stale: false,
  animated: false,
  format: 'number',
  isCentavos: false,
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
      <div class="stat-right-wrap">
        <UniUpdatingBadge v-if="updating" :dot-only="true" />
        <div v-if="icon" class="stat-icon-box" :class="[`icon-box-${iconColor}`]">
          <ion-icon :icon="icon" />
        </div>
        <slot name="top-right" />
      </div>
    </div>

    <div class="stat-value-row">
      <!-- 1. Skeleton during initial loading (keeps exact height/width, 0 layout shift) -->
      <UniSkeleton
        v-if="loading && (value === '' || value === null || value === undefined)"
        width="80px"
        height="24px"
        border-radius="6px"
      />

      <!-- 2. Loaded Value -->
      <span v-else class="stat-num tabular-nums font-mono" :class="[`num-${valueColor}`, { 'is-stale': stale }]">
        <slot name="value">
          <UniAnimatedCounter
            v-if="animated && (typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value))))"
            :value="value"
            :format="format"
            :is-centavos="isCentavos"
            :stale="stale"
          />
          <template v-else>
            {{ value }}
          </template>
        </slot>
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

.stat-right-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stat-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--uni-text-secondary);
  line-height: 1.2;
}

.stat-icon-box {
  width: 22px;
  height: 22px;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 21px;
}

.icon-box-mint {
  background: transparent;
  color: var(--uni-primary);
}

.icon-box-blue {
  background: transparent;
  color: var(--uni-blue);
}

.icon-box-violet {
  background: transparent;
  color: var(--uni-violet);
}

.icon-box-amber {
  background: transparent;
  color: var(--uni-warning, #D97706);
}

.icon-box-neutral {
  background: transparent;
  color: var(--uni-text-secondary);
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

.stat-num.is-stale {
  opacity: 0.72;
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

@media (max-width: 380px) {
  .uni-stat-card {
    padding: 12px;
    border-radius: 14px;
  }

  .stat-label {
    font-size: 11.5px;
  }

  .stat-icon-box {
    font-size: 18px;
    width: 20px;
    height: 20px;
  }

  .stat-num {
    font-size: clamp(15px, 4.2vw, 18px);
  }

  .stat-meta {
    font-size: 10.5px;
  }
}
</style>
