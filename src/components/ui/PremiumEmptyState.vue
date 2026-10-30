<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { haptics } from '@/utilities/haptics';

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

function handleAction() {
  haptics.light();
  emit('action');
}
</script>

<template>
  <div class="empty-state-box animate-fade-up">
    <div v-if="icon" class="empty-state-icon-box">
      <ion-icon :icon="icon" class="empty-state-icon" />
    </div>

    <h4 class="empty-state-title">{{ title }}</h4>
    <p class="empty-state-sub">{{ description }}</p>

    <button 
      v-if="actionText" 
      type="button" 
      class="btn-ui btn-ui-primary btn-ui-sm" 
      @click="handleAction"
    >
      <ion-icon v-if="actionIcon" :icon="actionIcon" />
      {{ actionText }}
    </button>
  </div>
</template>

<style scoped>
.empty-state-icon-box {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
}

.empty-state-icon {
  font-size: 24px;
  color: var(--app-text-muted);
}
</style>
