<script setup lang="ts">
import { toRef } from 'vue';
import { useAnimatedNumber, type NumberFormatType } from '@/composables/useAnimatedNumber';
import UniSkeleton from './UniSkeleton.vue';
import UniUpdatingBadge from './UniUpdatingBadge.vue';

interface Props {
  value: number | string | null | undefined;
  format?: NumberFormatType;
  formatter?: (val: number) => string;
  duration?: number;
  decimals?: number;
  currencySymbol?: string;
  isCentavos?: boolean;
  loading?: boolean;
  updating?: boolean;
  stale?: boolean;
  skeletonWidth?: string;
  skeletonHeight?: string;
  fallback?: string;
  animateInitial?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  format: 'number',
  duration: 650,
  currencySymbol: '₱',
  isCentavos: false,
  loading: false,
  updating: false,
  stale: false,
  skeletonWidth: '70px',
  skeletonHeight: '1.25em',
  fallback: '0',
  animateInitial: true,
});

const valueRef = toRef(props, 'value');

const { formattedValue, isAnimating } = useAnimatedNumber(valueRef, {
  duration: props.duration,
  format: props.format,
  decimals: props.decimals,
  currencySymbol: props.currencySymbol,
  isCentavos: props.isCentavos,
  animateInitial: props.animateInitial,
  formatter: props.formatter,
});
</script>

<template>
  <span class="uni-animated-counter-wrap">
    <!-- Initial Loading Skeleton (never show premature zero) -->
    <UniSkeleton
      v-if="loading && (value === null || value === undefined)"
      :width="skeletonWidth"
      :height="skeletonHeight"
      border-radius="6px"
    />

    <!-- Render Value -->
    <span
      v-else
      class="counter-text tabular-nums font-mono"
      :class="{
        'is-animating': isAnimating,
        'is-stale': stale
      }"
      :title="stale ? 'Data may be outdated' : undefined"
    >
      {{ value !== null && value !== undefined ? formattedValue : fallback }}
    </span>

    <!-- Inline Updating Dot for background refreshes -->
    <UniUpdatingBadge
      v-if="updating"
      :dot-only="true"
      class="counter-updating-dot"
    />
  </span>
</template>

<style scoped>
.uni-animated-counter-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.counter-text {
  transition: opacity 0.2s ease, color 0.2s ease;
}

.counter-text.is-stale {
  opacity: 0.72;
}

.counter-updating-dot {
  margin-left: 2px;
}
</style>

