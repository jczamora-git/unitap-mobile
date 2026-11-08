<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { 
  checkmarkCircleOutline, 
  alertCircleOutline, 
  warningOutline, 
  informationCircleOutline 
} from 'ionicons/icons';

interface Props {
  show: boolean;
  message: string;
  type?: 'success' | 'warning' | 'error' | 'info';
}

withDefaults(defineProps<Props>(), {
  type: 'success'
});
</script>

<template>
  <Teleport to="body">
    <Transition name="uni-toast-slide">
      <div 
        v-if="show" 
        class="uni-toast-wrapper" 
        role="status" 
        aria-live="polite"
      >
        <div class="uni-toast-card" :class="[`toast-${type}`]">
          <ion-icon 
            :icon="
              type === 'success' ? checkmarkCircleOutline :
              type === 'warning' ? warningOutline :
              type === 'error' ? alertCircleOutline :
              informationCircleOutline
            " 
            class="toast-icon" 
          />
          <span class="toast-text">{{ message }}</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.uni-toast-wrapper {
  position: fixed;
  top: calc(16px + var(--ion-safe-area-top, 0px));
  right: calc(16px + var(--ion-safe-area-right, 0px));
  left: auto;
  display: flex;
  justify-content: flex-end;
  z-index: 999999;
  pointer-events: none;
  max-width: calc(100vw - 32px);
}

.uni-toast-card {
  max-width: 400px;
  width: auto;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: 9999px;
  padding: 10px 18px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: auto;
  box-sizing: border-box;
}

.toast-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.toast-text {
  font-family: var(--uni-font-family);
  font-size: 13px;
  font-weight: 550;
  color: var(--uni-text-primary);
  line-height: 1.25;
}

.toast-success .toast-icon {
  color: var(--uni-mint);
}
.toast-success {
  border-color: rgba(112, 243, 207, 0.35);
}

.toast-warning .toast-icon {
  color: #F59E0B;
}
.toast-warning {
  border-color: rgba(245, 158, 11, 0.35);
}

.toast-error .toast-icon {
  color: #EF4444;
}
.toast-error {
  border-color: rgba(239, 68, 68, 0.35);
}

.toast-info .toast-icon {
  color: var(--uni-blue);
}
.toast-info {
  border-color: rgba(101, 191, 255, 0.35);
}

.uni-toast-slide-enter-active {
  transition: transform 0.24s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.24s ease;
}

.uni-toast-slide-leave-active {
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.uni-toast-slide-enter-from,
.uni-toast-slide-leave-to {
  transform: translateY(-16px) scale(0.96);
  opacity: 0;
}
</style>
