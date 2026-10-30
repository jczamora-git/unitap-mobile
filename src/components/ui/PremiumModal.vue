<script setup lang="ts">
import { IonModal, IonIcon } from '@ionic/vue';
import { 
  alertCircleOutline, 
  helpCircleOutline, 
  informationCircleOutline 
} from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

interface Props {
  isOpen: boolean;
  type?: 'confirmation' | 'destructive' | 'info';
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  type: 'confirmation',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  loading: false
});

const emit = defineEmits<{
  (e: 'update:isOpen', value: boolean): void;
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

function handleConfirm() {
  if (props.type === 'destructive') {
    haptics.error();
  } else {
    haptics.medium();
  }
  emit('confirm');
}

function handleCancel() {
  haptics.light();
  emit('cancel');
  emit('update:isOpen', false);
}
</script>

<template>
  <ion-modal
    :is-open="isOpen"
    class="premium-dialog-modal"
    @did-dismiss="handleCancel"
  >
    <div class="modal-card-center-wrap">
      <div class="premium-dialog-card animate-fade-up">
        <!-- Contextual Icon -->
        <div 
          class="dialog-icon-wrap"
          :class="{
            'dialog-icon-mint': type === 'confirmation',
            'dialog-icon-danger': type === 'destructive',
            'dialog-icon-warning': type === 'info'
          }"
        >
          <ion-icon 
            :icon="type === 'destructive' ? alertCircleOutline : (type === 'confirmation' ? helpCircleOutline : informationCircleOutline)" 
          />
        </div>

        <h3 class="dialog-title">{{ title }}</h3>
        <p class="dialog-desc">{{ message }}</p>

        <slot />

        <div class="dialog-actions-row">
          <button 
            type="button" 
            class="btn-ui btn-ui-secondary" 
            :disabled="loading"
            @click="handleCancel"
          >
            {{ cancelText }}
          </button>
          
          <button 
            type="button" 
            class="btn-ui"
            :class="type === 'destructive' ? 'btn-ui-destructive' : 'btn-ui-primary'"
            :disabled="loading"
            @click="handleConfirm"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </ion-modal>
</template>

<style scoped>
ion-modal.premium-dialog-modal {
  --background: transparent;
  --box-shadow: none;
  --width: 90%;
  --max-width: 380px;
  --height: auto;
  --border-radius: 24px;
}

ion-modal.premium-dialog-modal::part(backdrop) {
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.modal-card-center-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 16px;
}

.premium-dialog-card {
  width: 100%;
}
</style>
