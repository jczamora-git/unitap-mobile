<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import UniButton from './UniButton.vue';

interface Props {
  icon?: any;
  title: string;
  description: string;
  actionText?: string;
  actionIcon?: any;
}

withDefaults(defineProps<Props>(), {
  icon: undefined,
  actionText: '',
  actionIcon: undefined
});

const emit = defineEmits<{
  (e: 'action'): void;
}>();
</script>

<template>
  <div class="uni-empty-state">
    <div v-if="icon" class="empty-icon-box">
      <ion-icon :icon="icon" />
    </div>

    <h4 class="empty-title">{{ title }}</h4>
    <p class="empty-desc">{{ description }}</p>

    <UniButton
      v-if="actionText"
      size="sm"
      :icon="actionIcon"
      class="empty-action-btn"
      @click="emit('action')"
    >
      {{ actionText }}
    </UniButton>
  </div>
</template>

<style scoped>
.uni-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 20px;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-card);
  box-sizing: border-box;
}

.empty-icon-box {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: rgba(15, 118, 110, 0.1);
  border: 1px solid rgba(15, 118, 110, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
}

.empty-icon-box ion-icon {
  font-size: 26px;
  width: 26px;
  height: 26px;
  color: var(--uni-primary, #0f766e);
  display: block;
}

:global(.dark) .empty-icon-box,
:global(.ion-palette-dark) .empty-icon-box {
  background: rgba(94, 234, 212, 0.12);
  border-color: rgba(94, 234, 212, 0.28);
}

:global(.dark) .empty-icon-box ion-icon,
:global(.ion-palette-dark) .empty-icon-box ion-icon {
  color: var(--uni-primary, #5EEAD4);
}

.empty-title {
  font-size: 15px;
  font-weight: 650;
  color: var(--uni-text-primary);
  margin: 0 0 6px 0;
  line-height: 1.25;
}

.empty-desc {
  font-size: 13px;
  color: var(--uni-text-secondary);
  margin: 0;
  max-width: 280px;
  line-height: 1.4;
}

.empty-action-btn {
  margin-top: 14px;
}
</style>
