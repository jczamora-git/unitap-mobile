<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from 'vue';
import { IonIcon, useBackButton } from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

interface Props {
  isOpen?: boolean;
  open?: boolean;
  title?: string;
  subtitle?: string;
  description?: string;
  showClose?: boolean;
  closeOnBackdrop?: boolean;
  maxHeight?: string;
  size?: 'compact' | 'standard' | 'expanded';
  beforeClose?: () => boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isOpen: false,
  open: undefined,
  title: '',
  subtitle: '',
  description: '',
  showClose: true,
  closeOnBackdrop: true,
  maxHeight: '88vh',
  size: 'standard',
  beforeClose: undefined,
});

const isEffectiveOpen = computed(() => {
  if (props.open !== undefined) return props.open;
  return props.isOpen;
});

const effectiveSubtitle = computed(() => {
  return props.subtitle || props.description || '';
});

const effectiveMaxHeight = computed(() => {
  if (props.size === 'expanded') return '92vh';
  if (props.size === 'compact') return '60vh';
  return props.maxHeight || '88vh';
});

const emit = defineEmits<{
  (e: 'update:isOpen', value: boolean): void;
  (e: 'update:open', value: boolean): void;
  (e: 'close'): void;
}>();

function dismiss() {
  if (props.beforeClose && props.beforeClose() === false) {
    return;
  }
  haptics.light();
  emit('update:isOpen', false);
  emit('update:open', false);
  emit('close');
}

function handleBackdropClick() {
  if (props.closeOnBackdrop) {
    dismiss();
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isEffectiveOpen.value) {
    dismiss();
  }
}

// Lock / unlock body scroll
watch(isEffectiveOpen, (open) => {
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
  if (isEffectiveOpen.value) {
    dismiss();
  } else {
    processNextHandler();
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="uni-sheet-fade">
      <div 
        v-if="isEffectiveOpen" 
        class="uni-sheet-overlay" 
        role="dialog" 
        aria-modal="true"
        @click.self="handleBackdropClick"
      >
        <Transition name="uni-sheet-slide" appear>
          <div 
            class="uni-sheet-container" 
            :style="{ maxHeight: effectiveMaxHeight }"
            @click.stop
          >
            <!-- Drag Handle Bar -->
            <div class="sheet-handle-wrap" @click="dismiss">
              <div class="sheet-drag-handle"></div>
            </div>

            <!-- Header Row -->
            <div v-if="title || effectiveSubtitle || $slots.header" class="sheet-header">
              <slot name="header">
                <div class="sheet-header-titles">
                  <h3 class="sheet-title">{{ title }}</h3>
                  <p v-if="effectiveSubtitle" class="sheet-subtitle">{{ effectiveSubtitle }}</p>
                </div>
                <button 
                  v-if="showClose" 
                  type="button" 
                  class="sheet-close-btn" 
                  aria-label="Close sheet" 
                  @click="dismiss"
                >
                  <ion-icon :icon="closeOutline" />
                </button>
              </slot>
            </div>

            <!-- Scrollable Content Body -->
            <div class="sheet-scroll-body">
              <slot />
            </div>

            <!-- Optional Sticky Footer -->
            <div v-if="$slots.footer" class="sheet-footer">
              <slot name="footer" />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.uni-sheet-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.48);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.uni-sheet-container {
  width: 100%;
  max-width: 580px;
  background: var(--uni-surface);
  border-top-left-radius: 24px;
  border-top-right-radius: 24px;
  border: 1px solid var(--uni-border);
  border-bottom: none;
  box-shadow: var(--uni-shadow-sheet);
  display: flex;
  flex-direction: column;
  padding-bottom: calc(16px + var(--ion-safe-area-bottom, 0px));
  box-sizing: border-box;
  overflow: hidden;
}

.sheet-handle-wrap {
  width: 100%;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  flex-shrink: 0;
  padding-top: 4px;
}

.sheet-drag-handle {
  width: 36px;
  height: 4px;
  border-radius: 9999px;
  background: var(--uni-border);
  opacity: 0.85;
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px 12px 18px;
  border-bottom: 1px solid var(--uni-border-subtle);
  flex-shrink: 0;
}

.sheet-header-titles {
  flex: 1;
  min-width: 0;
}

.sheet-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--uni-text-primary);
  margin: 0;
  line-height: 1.25;
}

.sheet-subtitle {
  font-size: 12px;
  color: var(--uni-text-secondary);
  margin: 2px 0 0 0;
  line-height: 1.3;
}

.sheet-close-btn {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--uni-surface-elevated);
  border: 1px solid var(--uni-border);
  color: var(--uni-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
  padding: 0;
  transition: transform 0.12s ease;
  box-sizing: border-box;
}

.sheet-close-btn:active {
  transform: scale(0.92);
}

.sheet-scroll-body {
  padding: 14px 18px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  flex: 1;
}

.sheet-footer {
  padding: 12px 18px 0 18px;
  border-top: 1px solid var(--uni-border-subtle);
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

@media (max-width: 380px) {
  .sheet-header {
    padding: 0 14px 10px 14px;
  }
  .sheet-scroll-body {
    padding: 12px 14px;
  }
  .sheet-footer {
    padding: 10px 14px 0 14px;
  }
}

/* Animations */
.uni-sheet-fade-enter-active,
.uni-sheet-fade-leave-active {
  transition: opacity 0.22s ease;
}

.uni-sheet-fade-enter-from,
.uni-sheet-fade-leave-to {
  opacity: 0;
}

.uni-sheet-slide-enter-active {
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}

.uni-sheet-slide-leave-active {
  transition: transform 0.22s cubic-bezier(0.4, 0, 1, 1);
}

.uni-sheet-slide-enter-from,
.uni-sheet-slide-leave-to {
  transform: translateY(100%);
}

/* Dark Mode Overrides */
:global(.dark) .uni-sheet-container,
:global(.ion-palette-dark) .uni-sheet-container {
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.6);
}

:global(.dark) .sheet-title,
:global(.ion-palette-dark) .sheet-title {
  color: var(--uni-text, #F8FAFC);
}

:global(.dark) .sheet-subtitle,
:global(.ion-palette-dark) .sheet-subtitle {
  color: var(--uni-text-secondary, #9CA3AF);
}

:global(.dark) .sheet-drag-handle,
:global(.ion-palette-dark) .sheet-drag-handle {
  background: var(--uni-border, #30343D);
}

:global(.dark) .sheet-header,
:global(.ion-palette-dark) .sheet-header,
:global(.dark) .sheet-footer,
:global(.ion-palette-dark) .sheet-footer {
  border-color: var(--uni-border, #30343D);
}

:global(.dark) .sheet-close-btn,
:global(.ion-palette-dark) .sheet-close-btn {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #30343D);
  color: var(--uni-text-secondary, #9CA3AF);
}
</style>
