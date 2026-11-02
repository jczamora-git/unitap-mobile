<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue';
import { IonIcon, useBackButton } from '@ionic/vue';
import { alertCircleOutline, helpCircleOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

interface Props {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  confirmLabel?: string;
  cancelText?: string;
  cancelLabel?: string;
  destructive?: boolean;
  type?: 'confirm' | 'warning' | 'destructive' | 'info';
  icon?: any;
}

const props = withDefaults(defineProps<Props>(), {
  description: '',
  confirmText: 'Confirm',
  confirmLabel: '',
  cancelText: 'Cancel',
  cancelLabel: '',
  destructive: false,
  type: 'confirm',
  icon: undefined
});

const emit = defineEmits<{
  (e: 'update:isOpen', value: boolean): void;
  (e: 'confirm'): void;
  (e: 'cancel'): void;
  (e: 'close'): void;
}>();

function handleConfirm() {
  if (props.destructive || props.type === 'destructive') {
    haptics.warning();
  } else {
    haptics.light();
  }
  emit('confirm');
  emit('update:isOpen', false);
}

function handleCancel() {
  haptics.light();
  emit('cancel');
  emit('close');
  emit('update:isOpen', false);
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.isOpen) {
    handleCancel();
  }
}

watch(() => props.isOpen, (open) => {
  if (open) {
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeydown);
  } else {
    document.body.style.overflow = '';
    window.removeEventListener('keydown', handleKeydown);
  }
}, { immediate: true });

onBeforeUnmount(() => {
  document.body.style.overflow = '';
  window.removeEventListener('keydown', handleKeydown);
});

useBackButton(100, (processNextHandler) => {
  if (props.isOpen) {
    handleCancel();
  } else {
    processNextHandler();
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="uni-dialog-fade">
      <div 
        v-if="isOpen" 
        class="uni-dialog-overlay" 
        role="dialog" 
        aria-modal="true"
        @click.self="handleCancel"
      >
        <Transition name="uni-dialog-scale" appear>
          <div class="uni-dialog-card" @click.stop>
            <!-- Contextual Icon -->
            <div 
              class="dialog-icon-box"
              :class="[
                destructive || type === 'destructive' ? 'icon-destructive' :
                type === 'warning' ? 'icon-warning' :
                type === 'info' ? 'icon-info' : 'icon-confirm'
              ]"
            >
              <ion-icon 
                :icon="
                  icon || (
                    (destructive || type === 'destructive') ? alertCircleOutline :
                    type === 'warning' ? alertCircleOutline :
                    type === 'info' ? checkmarkCircleOutline : helpCircleOutline
                  )
                " 
              />
            </div>

            <h3 class="dialog-title">{{ title }}</h3>
            <p v-if="description" class="dialog-desc">{{ description }}</p>

            <slot />

            <!-- Actions Row -->
            <div class="dialog-actions-row">
              <button 
                type="button" 
                class="dialog-btn dialog-btn-cancel" 
                @click="handleCancel"
              >
                {{ cancelLabel || cancelText }}
              </button>

              <button 
                type="button" 
                class="dialog-btn" 
                :class="[
                  destructive || type === 'destructive' 
                    ? 'dialog-btn-destructive' 
                    : 'dialog-btn-confirm'
                ]"
                @click="handleConfirm"
              >
                {{ confirmLabel || confirmText }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.uni-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.52);
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  box-sizing: border-box;
}

.uni-dialog-card {
  width: 100%;
  max-width: 360px;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-modal);
  padding: 24px 20px 18px 20px;
  box-shadow: var(--uni-shadow-dialog);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  box-sizing: border-box;
}

@media (max-width: 380px) {
  .uni-dialog-overlay {
    padding: 16px;
  }
  .uni-dialog-card {
    padding: 20px 16px 16px 16px;
  }
}

.dialog-icon-box {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  margin-bottom: 12px;
}

.icon-confirm {
  background: rgba(112, 243, 207, 0.12);
  color: #0E8560;
}
@media (prefers-color-scheme: dark) {
  .icon-confirm { color: var(--uni-mint); }
}

.icon-warning {
  background: rgba(255, 183, 143, 0.16);
  color: #D97706;
}

.icon-info {
  background: rgba(101, 191, 255, 0.14);
  color: var(--uni-blue);
}

.icon-destructive {
  background: rgba(220, 75, 75, 0.12);
  color: #DC2626;
}

.dialog-title {
  font-size: 16px;
  font-weight: 650;
  color: var(--uni-text-primary);
  margin: 0 0 6px 0;
  line-height: 1.3;
}

.dialog-desc {
  font-size: 13px;
  color: var(--uni-text-secondary);
  margin: 0 0 18px 0;
  line-height: 1.4;
}

.dialog-actions-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-top: 6px;
}

.dialog-btn {
  flex: 1;
  height: 44px;
  border-radius: var(--uni-radius-btn);
  font-family: var(--uni-font-family);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: transform 0.12s ease;
  user-select: none;
}

.dialog-btn:active {
  transform: scale(0.97);
}

.dialog-btn-cancel {
  background: var(--uni-surface-elevated);
  border-color: var(--uni-border);
  color: var(--uni-text-secondary);
}

.dialog-btn-confirm {
  background: var(--uni-btn-primary-bg, #0F766E);
  color: #FFFFFF;
}

:root.dark .dialog-btn-confirm,
:root.ion-palette-dark .dialog-btn-confirm {
  background: var(--uni-btn-primary-bg, #0D9488);
  color: #FFFFFF;
}

.dialog-btn-destructive {
  background: #DC2626;
  color: #FFFFFF;
}

/* Transitions */
.uni-dialog-fade-enter-active,
.uni-dialog-fade-leave-active {
  transition: opacity 0.18s ease;
}

.uni-dialog-fade-enter-from,
.uni-dialog-fade-leave-to {
  opacity: 0;
}

.uni-dialog-scale-enter-active {
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}

.uni-dialog-scale-leave-active {
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.uni-dialog-scale-enter-from,
.uni-dialog-scale-leave-to {
  transform: scale(0.94);
  opacity: 0;
}
</style>
