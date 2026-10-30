<script setup lang="ts">
import { IonModal, IonIcon } from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

interface Props {
  isOpen: boolean;
  title?: string;
  breakpoints?: number[];
  initialBreakpoint?: number;
  handle?: boolean;
}

withDefaults(defineProps<Props>(), {
  title: '',
  breakpoints: () => [0, 0.5, 0.92],
  initialBreakpoint: 0.5,
  handle: true
});

const emit = defineEmits<{
  (e: 'update:isOpen', value: boolean): void;
  (e: 'didDismiss'): void;
}>();

function onDismiss() {
  emit('update:isOpen', false);
  emit('didDismiss');
}

function handleClose() {
  haptics.light();
  emit('update:isOpen', false);
}
</script>

<template>
  <ion-modal
    :is-open="isOpen"
    class="premium-bottom-sheet"
    :initial-breakpoint="initialBreakpoint"
    :breakpoints="breakpoints"
    :handle="false"
    @did-dismiss="onDismiss"
  >
    <div class="sheet-inner-wrap">
      <!-- Drag Handle -->
      <div v-if="handle" class="sheet-drag-handle-bar"></div>

      <!-- Header Row -->
      <div v-if="title || $slots.header" class="sheet-head-row">
        <slot name="header">
          <h3 class="sheet-title">{{ title }}</h3>
          <button class="sheet-close-btn" aria-label="Close sheet" @click="handleClose">
            <ion-icon :icon="closeOutline" />
          </button>
        </slot>
      </div>

      <!-- Content Area -->
      <div class="sheet-body-content">
        <slot />
      </div>
    </div>
  </ion-modal>
</template>

<style scoped>
.sheet-inner-wrap {
  display: flex;
  flex-direction: column;
  padding: 0 20px calc(24px + var(--ion-safe-area-bottom, 0px)) 20px;
  overflow-y: auto;
  max-height: 100%;
}

.sheet-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.sheet-body-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
