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
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--uni-surface-elevated);
  border: 1px solid var(--uni-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: var(--uni-text-muted);
  margin-bottom: 12px;
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
