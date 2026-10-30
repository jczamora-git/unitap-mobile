<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { arrowForwardOutline } from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

interface Props {
  icon: any;
  title: string;
  subtitle?: string;
  primary?: boolean;
  arrow?: boolean;
}

withDefaults(defineProps<Props>(), {
  subtitle: '',
  primary: false,
  arrow: true
});

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();

function handleClick(event: MouseEvent) {
  haptics.light();
  emit('click', event);
}
</script>

<template>
  <button
    type="button"
    class="uni-action-card"
    :class="{ 'action-primary': primary }"
    @click="handleClick"
  >
    <div class="action-icon-box">
      <ion-icon :icon="icon" />
    </div>

    <div class="action-body">
      <span class="action-title">{{ title }}</span>
      <span v-if="subtitle" class="action-sub">{{ subtitle }}</span>
    </div>

    <ion-icon v-if="arrow" :icon="arrowForwardOutline" class="action-arrow" />
  </button>
</template>

<style scoped>
.uni-action-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  box-shadow: var(--uni-shadow-card);
  text-align: left;
  cursor: pointer;
  transition: transform 0.14s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.14s ease;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  user-select: none;
}

.uni-action-card:active {
  transform: scale(0.98);
  border-color: rgba(112, 243, 207, 0.4);
}

.action-icon-box {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--uni-surface-elevated);
  color: var(--uni-text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  flex-shrink: 0;
}

.action-primary {
  border-color: rgba(112, 243, 207, 0.35);
  background: rgba(112, 243, 207, 0.04);
}

.action-primary .action-icon-box {
  background: rgba(112, 243, 207, 0.16);
  color: #0E8560;
}
@media (prefers-color-scheme: dark) {
  .action-primary .action-icon-box {
    color: var(--uni-mint);
  }
}

.action-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.action-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--uni-text-primary);
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.action-sub {
  font-size: 11px;
  color: var(--uni-text-secondary);
  line-height: 1.3;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.action-arrow {
  font-size: 14px;
  color: var(--uni-text-muted);
  flex-shrink: 0;
}
</style>
