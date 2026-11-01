<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { chevronForwardOutline } from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

interface Props {
  icon: any;
  title: string;
  subtitle?: string;
  description?: string;
  primary?: boolean;
  variant?: 'featured' | 'primary' | 'default';
  layout?: 'row' | 'tile';
  arrow?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  subtitle: '',
  description: '',
  primary: false,
  variant: 'default',
  layout: 'tile',
  arrow: true
});

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();

const displaySubtitle = computed(() => props.subtitle || props.description);
const isPrimary = computed(() => props.primary || props.variant === 'featured' || props.variant === 'primary');

function handleClick(event: MouseEvent) {
  haptics.light();
  emit('click', event);
}
</script>

<template>
  <button
    type="button"
    class="uni-action-card"
    :class="[
      `action-layout-${layout}`,
      { 'action-primary': isPrimary }
    ]"
    @click="handleClick"
  >
    <div class="action-icon-wrap">
      <ion-icon :icon="icon" class="action-icon" />
    </div>

    <div class="action-body">
      <span class="action-title">{{ title }}</span>
      <span v-if="displaySubtitle && layout === 'row'" class="action-sub">{{ displaySubtitle }}</span>
    </div>

    <ion-icon v-if="arrow && layout === 'row'" :icon="chevronForwardOutline" class="action-arrow" />
  </button>
</template>

<style scoped>
.uni-action-card {
  border-radius: var(--uni-radius-card, 16px);
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  box-shadow: var(--uni-shadow-card);
  cursor: pointer;
  transition: transform 0.14s cubic-bezier(0.16, 1, 0.3, 1), 
              border-color 0.14s ease, 
              background 0.14s ease,
              box-shadow 0.14s ease;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  user-select: none;
}

/* Row Layout */
.action-layout-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  text-align: left;
}

/* Tile Layout (2x2 Grid) */
.action-layout-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 18px 12px;
  text-align: center;
  min-height: 88px;
}

.uni-action-card:hover {
  border-color: var(--uni-primary);
  box-shadow: 0 4px 16px rgba(15, 118, 110, 0.08);
}

.uni-action-card:active {
  transform: scale(0.975);
  border-color: var(--uni-primary);
}

.action-icon-wrap {
  width: auto;
  height: auto;
  background: transparent !important;
  color: var(--uni-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.action-icon {
  font-size: 26px;
  color: var(--uni-primary);
  transition: transform 0.15s ease;
}

:root.dark .action-icon,
:root.ion-palette-dark .action-icon {
  color: var(--uni-primary, #5EEAD4);
}

.action-primary {
  border-color: rgba(15, 118, 110, 0.3);
}

:root.dark .action-primary,
:root.ion-palette-dark .action-primary {
  border-color: rgba(94, 234, 212, 0.3);
}

.action-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.action-title {
  font-size: 13.5px;
  font-weight: 650;
  color: var(--uni-text-primary);
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.action-layout-tile .action-title {
  font-size: 13px;
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.action-sub {
  font-size: 11.5px;
  color: var(--uni-text-secondary);
  line-height: 1.35;
  margin-top: 2px;
}

.action-arrow {
  font-size: 18px;
  color: var(--uni-text-muted);
  flex-shrink: 0;
  transition: transform 0.14s ease, color 0.14s ease;
}

.uni-action-card:hover .action-arrow {
  color: var(--uni-primary);
  transform: translateX(2px);
}
</style>
