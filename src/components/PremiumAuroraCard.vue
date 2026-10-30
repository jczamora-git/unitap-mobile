<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';

interface Props {
  variant?: 'primary' | 'cool' | 'warm' | 'mint';
  overline?: string;
  title?: string;
  subtitle?: string;
  icon?: any;
  actionText?: string;
  actionIcon?: any;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  overline: '',
  title: '',
  subtitle: '',
  icon: undefined,
  actionText: '',
  actionIcon: undefined
});

const emit = defineEmits<{
  (e: 'action'): void;
}>();

const variantClass = computed(() => {
  switch (props.variant) {
    case 'cool': return 'aurora-variant-cool';
    case 'warm': return 'aurora-variant-warm';
    case 'mint': return 'aurora-variant-mint';
    default: return 'aurora-variant-primary';
  }
});
</script>

<template>
  <div class="aurora-card" :class="variantClass">
    <div class="aurora-card-inner">
      <!-- Card Header Area -->
      <div v-if="overline || title || subtitle || icon" class="card-head-area">
        <div class="head-text-block">
          <span v-if="overline" class="hero-overline">
            <span class="mint-indicator"></span>
            {{ overline }}
          </span>
          <h2 v-if="title" class="hero-title">{{ title }}</h2>
          <p v-if="subtitle" class="hero-sub">{{ subtitle }}</p>
        </div>

        <div v-if="icon" class="head-icon-box">
          <ion-icon :icon="icon" />
        </div>
      </div>

      <!-- Main Slot Content -->
      <div class="card-body-content">
        <slot />
      </div>

      <!-- Optional Footer Action -->
      <div v-if="actionText || $slots.footer" class="card-footer-area">
        <slot name="footer">
          <button v-if="actionText" class="aurora-action-btn" @click="emit('action')">
            <span>{{ actionText }}</span>
            <ion-icon v-if="actionIcon" :icon="actionIcon" class="action-btn-icon" />
          </button>
        </slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aurora-card-inner {
  position: relative;
  z-index: 1;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.card-head-area {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.head-text-block {
  flex: 1;
}

.mint-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--aurora-mint);
  display: inline-block;
  box-shadow: 0 0 8px var(--aurora-mint);
}

.head-icon-box {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--aurora-mint);
  font-size: 20px;
  backdrop-filter: blur(8px);
}

.card-body-content {
  display: flex;
  flex-direction: column;
}

.card-footer-area {
  padding-top: 4px;
}

.aurora-action-btn {
  width: 100%;
  height: 42px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #FFFFFF;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: all 0.15s ease;
}

.aurora-action-btn:active {
  background: rgba(255, 255, 255, 0.22);
  transform: scale(0.99);
}

.action-btn-icon {
  font-size: 16px;
  color: var(--aurora-mint);
}
</style>
