<script setup lang="ts">
import { ref } from 'vue';
import type { Student } from '@/types/student';
import { 
  IonHeader, 
  IonToolbar, 
  IonTitle, 
  IonButtons, 
  IonButton, 
  IonContent, 
  IonIcon
} from '@ionic/vue';
import { closeOutline, swapHorizontalOutline } from 'ionicons/icons';
import RfidScanBox from './RfidScanBox.vue';
import { useStudents } from '@/composables/useStudents';
import { useToast } from '@/composables/useToast';
import { nfcService } from '@/services/nfc.service';
import { UniDialog, UniButton } from '@/components/ui';

const props = defineProps<{
  student: Student;
}>();

const emit = defineEmits<{
  (e: 'dismiss'): void;
  (e: 'replaced', updated: Student): void;
}>();

const { replaceRfid } = useStudents();
const { showToast } = useToast();

const newRfidUid = ref<string | null>(null);
const newRfidCompact = ref<string | null>(null);
const isReplacing = ref(false);
const showConfirmDialog = ref(false);

function handleConfirmReplace() {
  if (!newRfidUid.value) return;
  showConfirmDialog.value = true;
}

async function executeReplace() {
  if (!newRfidUid.value) return;

  isReplacing.value = true;
  try {
    const updated = await replaceRfid(props.student.id, newRfidUid.value);
    await nfcService.triggerHapticFeedback();
    await showToast('RFID card replaced successfully', 'success');
    emit('replaced', updated);
    emit('dismiss');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await showToast(msg, 'error');
  } finally {
    isReplacing.value = false;
  }
}
</script>

<template>
  <ion-header class="ion-no-border modal-header">
    <ion-toolbar>
      <ion-title>Replace RFID Card</ion-title>
      <ion-buttons slot="end">
        <ion-button @click="emit('dismiss')">
          <ion-icon :icon="closeOutline" />
        </ion-button>
      </ion-buttons>
    </ion-toolbar>
  </ion-header>

  <ion-content class="safe-content">
    <div class="replace-modal-container">
      <!-- Current Card Info -->
      <div class="current-card-box">
        <span class="box-label">Current RFID Card</span>
        <div class="current-uid font-mono">
          {{ student.rfidUid || 'No Card Assigned' }}
        </div>
      </div>

      <!-- Scan New Card Box -->
      <RfidScanBox 
        v-model="newRfidUid" 
        v-model:model-compact="newRfidCompact"
        :exclude-student-id="student.id"
      />

      <!-- Action Button -->
      <div v-if="newRfidUid && newRfidUid !== student.rfidUid" class="action-wrap">
        <UniButton 
          variant="primary" 
          block 
          :loading="isReplacing"
          :icon="swapHorizontalOutline"
          class="confirm-btn"
          @click="handleConfirmReplace"
        >
          Confirm Replacement
        </UniButton>
      </div>
    </div>
  </ion-content>

  <!-- Confirm Replacement Dialog -->
  <UniDialog
    v-model:is-open="showConfirmDialog"
    title="Replace RFID Card?"
    :description="`Are you sure you want to replace this student's card with ${newRfidUid}?`"
    confirm-text="Replace Card"
    cancel-text="Cancel"
    type="confirm"
    @confirm="executeReplace"
    @cancel="showConfirmDialog = false"
  />
</template>

<style scoped>
.modal-header ion-toolbar {
  --background: var(--app-surface);
  --border-color: var(--app-border);
}

.replace-modal-container {
  max-width: 540px;
  margin: 0 auto;
  padding: 14px 16px 32px 16px;
}

.current-card-box {
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 6px;
}

.box-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--app-text-secondary);
  display: block;
  margin-bottom: 3px;
}

.current-uid {
  font-size: 15px;
  font-weight: 700;
  color: var(--app-text-primary);
}

.action-wrap {
  margin-top: 10px;
}

.confirm-btn {
  --border-radius: var(--app-btn-radius);
  height: 46px;
  font-size: 14px;
  font-weight: 600;
}
</style>
