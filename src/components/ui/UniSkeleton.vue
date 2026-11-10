<script setup lang="ts">
interface Props {
  width?: string;
  height?: string;
  borderRadius?: string;
  variant?: 'text' | 'rect' | 'circle';
  animated?: boolean;
}

withDefaults(defineProps<Props>(), {
  width: '100%',
  height: '1rem',
  borderRadius: '6px',
  variant: 'text',
  animated: true,
});
</script>

<template>
  <div
    class="uni-skeleton"
    :class="[
      `skeleton-${variant}`,
      { 'skeleton-animated': animated }
    ]"
    :style="{
      width: width,
      height: height,
      borderRadius: variant === 'circle' ? '9999px' : borderRadius
    }"
    aria-hidden="true"
  ></div>
</template>

<style scoped>
.uni-skeleton {
  position: relative;
  overflow: hidden;
  background: var(--uni-surface-secondary, rgba(255, 255, 255, 0.06));
  display: inline-block;
  vertical-align: middle;
  box-sizing: border-box;
}

/* Dark mode and Aurora support */
:root.dark .uni-skeleton,
:root.ion-palette-dark .uni-skeleton,
body.dark .uni-skeleton,
body.ion-palette-dark .uni-skeleton {
  background: rgba(255, 255, 255, 0.07);
}

.skeleton-animated::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(15, 118, 110, 0.12) 35%,
    rgba(112, 243, 207, 0.18) 50%,
    rgba(15, 118, 110, 0.12) 65%,
    transparent 100%
  );
  transform: translateX(-100%);
  animation: uni-skeleton-shimmer 1.8s ease-in-out infinite;
}

@keyframes uni-skeleton-shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

.skeleton-text {
  min-height: 0.875rem;
}

.skeleton-circle {
  aspect-ratio: 1 / 1;
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-animated::after {
    animation: none;
    display: none;
  }
}
</style>

