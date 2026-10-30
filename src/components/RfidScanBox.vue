<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
import { 
  radioOutline, 
  checkmarkCircle, 
  alertCircle, 
  refreshOutline, 
  closeCircleOutline, 
  cardOutline,
  personOutline
} from 'ionicons/icons';
import { IonIcon, IonButton } from '@ionic/vue';
import { nfcService } from '@/services/nfc.service';
import { studentService } from '@/services/student.service';
import type { NormalizedNfcTag } from '@/types/nfc';
import type { Student } from '@/types/student';
import { formatFullName, formatStudentAcademicSummary } from '@/utilities/student-formatters';
import { useToast } from '@/composables/useToast';

const props = defineProps<{
  modelValue?: string | null;
  modelCompact?: string | null;
  excludeStudentId?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | null): void;
  (e: 'update:modelCompact', value: string | null): void;
  (e: 'scanned', tag: NormalizedNfcTag): void;
  (e: 'view-duplicate-student', student: Student): void;
}>();

const { showToast } = useToast();
const isScanning = ref(false);
const duplicateStudent = ref<Student | null>(null);
const scanError = ref<string | null>(null);

async function startScanning() {
  scanError.value = null;
  duplicateStudent.value = null;

  if (!nfcService.isNative()) {
    scanError.value = 'Native NFC scanning is only available on physical Android devices.';
    return;
  }

  isScanning.value = true;

  try {
    await nfcService.startScanning(async (tag: NormalizedNfcTag) => {
      await handleTagScanned(tag);
    }, { isStabilityTest: false });
  } catch (err: unknown) {
    isScanning.value = false;
    const msg = err instanceof Error ? err.message : String(err);
    scanError.value = msg;
  }
}

async function handleTagScanned(tag: NormalizedNfcTag) {
  if (!tag.id || tag.id === 'Unavailable') {
    scanError.value = 'Could not read a valid UID from this tag.';
    return;
  }

  // Stop scanning after valid read
  await stopScanning();

  // Check duplicate ownership
  const duplicateCheck = await studentService.checkRfidAvailability(tag.id, props.excludeStudentId);

  if (duplicateCheck.isDuplicate && duplicateCheck.existingStudent) {
    duplicateStudent.value = duplicateCheck.existingStudent;
    emit('update:modelValue', null);
    emit('update:modelCompact', null);
    await showToast('This RFID card is already assigned to another student', 'error');
  } else {
    duplicateStudent.value = null;
    emit('update:modelValue', tag.id);
    emit('update:modelCompact', tag.compactId);
    emit('scanned', tag);
    await showToast('RFID card captured successfully', 'success');
  }
}

async function stopScanning() {
  isScanning.value = false;
  try {
    await nfcService.stopScanning();
  } catch {
    // Ignore
  }
}

function clearCard() {
  duplicateStudent.value = null;
  scanError.value = null;
  emit('update:modelValue', null);
  emit('update:modelCompact', null);
}

function handleViewDuplicate() {
  if (duplicateStudent.value) {
    emit('view-duplicate-student', duplicateStudent.value);
  }
}

onUnmounted(async () => {
  if (isScanning.value) {
    await stopScanning();
  }
});
</script>

<template>
  <div class="rfid-scan-container">
    <div class="label-row">
      <span class="field-label">RFID Card Association *</span>
      <span v-if="modelValue" class="status-indicator-tag status-success">
        <ion-icon :icon="checkmarkCircle" />
        Captured
      </span>
    </div>

    <!-- State 1: Active Scanning -->
    <div v-if="isScanning" class="scan-box state-scanning">
      <div class="scan-pulse-icon">
        <ion-icon :icon="radioOutline" class="pulse-icon" />
      </div>
      <h4 class="scan-title">Scanning for RFID...</h4>
      <p class="scan-subtitle">
        Hold the student's NFC/RFID card near the back of this phone.
      </p>
      <ion-button 
        fill="outline" 
        color="danger" 
        size="small" 
        class="action-btn"
        @click="stopScanning"
      >
        <ion-icon :icon="closeCircleOutline" slot="start" />
        Cancel Scan
      </ion-button>
    </div>

    <!-- State 2: Duplicate Conflict -->
    <div v-else-if="duplicateStudent" class="scan-box state-duplicate">
      <div class="dup-header">
        <ion-icon :icon="alertCircle" class="dup-icon" />
        <h4 class="dup-title">RFID Already Registered</h4>
      </div>
      <p class="dup-desc">This card is already assigned to:</p>
      
      <div class="dup-student-card">
        <div class="dup-name">
          {{ formatFullName(duplicateStudent.firstName, duplicateStudent.middleName, duplicateStudent.lastName) }}
        </div>
        <div class="dup-academic">
          {{ formatStudentAcademicSummary(duplicateStudent) }}
        </div>
      </div>

      <div class="dup-actions">
        <ion-button 
          fill="outline" 
          color="primary" 
          size="small"
          class="dup-btn"
          @click="handleViewDuplicate"
        >
          <ion-icon :icon="personOutline" slot="start" />
          View Student
        </ion-button>
        <ion-button 
          color="warning" 
          size="small"
          class="dup-btn"
          @click="startScanning"
        >
          <ion-icon :icon="refreshOutline" slot="start" />
          Scan Another Card
        </ion-button>
      </div>
    </div>

    <!-- State 3: Card Detected / Configured -->
    <div v-else-if="modelValue" class="scan-box state-detected">
      <div class="detected-header">
        <div class="detected-badge">
          <ion-icon :icon="checkmarkCircle" />
          <span>RFID Detected</span>
        </div>
        <ion-button 
          fill="clear" 
          size="small" 
          color="medium" 
          class="change-btn"
          @click="startScanning"
        >
          <ion-icon :icon="refreshOutline" slot="start" />
          Change Card
        </ion-button>
        <ion-button 
          fill="clear" 
          size="small" 
          color="danger" 
          class="change-btn"
          @click="clearCard"
        >
          <ion-icon :icon="closeCircleOutline" slot="start" />
          Clear
        </ion-button>
      </div>
      <div class="detected-uid font-mono">
        {{ modelValue }}
      </div>
    </div>

    <!-- State 4: Empty Initial State -->
    <div v-else class="scan-box state-idle">
      <div class="idle-icon-wrap">
        <ion-icon :icon="cardOutline" />
      </div>
      <h4 class="idle-title">No RFID card registered</h4>
      <p class="idle-desc">Tap below to scan and link the student's physical card.</p>
      <ion-button 
        color="primary" 
        class="scan-btn"
        @click="startScanning"
      >
        <ion-icon :icon="radioOutline" slot="start" />
        Scan RFID Card
      </ion-button>
    </div>

    <!-- Error Banner -->
    <div v-if="scanError && !isScanning" class="error-note">
      <ion-icon :icon="alertCircle" />
      <span>{{ scanError }}</span>
    </div>
  </div>
</template>

<style scoped>
.rfid-scan-container {
  margin-top: 12px;
  margin-bottom: 14px;
}

.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--app-text-secondary);
}

.status-indicator-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--app-pill-radius);
}

.status-success {
  background: rgba(21, 154, 116, 0.12);
  color: var(--ion-color-success);
}

.scan-box {
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 14px;
  padding: 18px 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: all 0.2s ease;
}

.state-scanning {
  border-color: var(--ion-color-primary);
  background: var(--app-accent-soft);
}

.scan-pulse-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ion-color-primary);
  font-size: 1.4rem;
  margin-bottom: 10px;
}

.scan-title {
  font-size: 15px;
  font-weight: 650;
  color: var(--app-text-primary);
  margin: 0 0 4px 0;
}

.scan-subtitle {
  font-size: 12px;
  color: var(--app-text-secondary);
  max-width: 260px;
  margin: 0 0 14px 0;
  line-height: 1.35;
}

.idle-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.3rem;
  color: var(--app-text-muted);
  margin-bottom: 10px;
}

.idle-title {
  font-size: 14px;
  font-weight: 650;
  color: var(--app-text-primary);
  margin: 0 0 4px 0;
}

.idle-desc {
  font-size: 12px;
  color: var(--app-text-secondary);
  margin: 0 0 14px 0;
}

.scan-btn {
  width: 100%;
  max-width: 220px;
  height: 42px;
}

.state-detected {
  background: var(--app-surface);
  border-color: rgba(21, 154, 116, 0.4);
  padding: 14px;
  align-items: stretch;
}

.detected-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.detected-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ion-color-success);
}

.detected-uid {
  font-size: 16px;
  font-weight: 700;
  color: var(--app-text-primary);
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 10px;
  padding: 10px 14px;
  text-align: center;
  letter-spacing: 0.04em;
}

.change-btn {
  font-size: 12px;
  font-weight: 600;
  height: 28px;
  margin: 0;
}

.state-duplicate {
  border-color: rgba(217, 149, 34, 0.4);
  background: rgba(217, 149, 34, 0.05);
  text-align: left;
  align-items: stretch;
}

.dup-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.dup-icon {
  font-size: 18px;
  color: var(--ion-color-warning);
}

.dup-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ion-color-warning);
  margin: 0;
}

.dup-desc {
  font-size: 12px;
  color: var(--app-text-secondary);
  margin: 0 0 8px 0;
}

.dup-student-card {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 12px;
}

.dup-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--app-text-primary);
}

.dup-academic {
  font-size: 12px;
  color: var(--app-text-secondary);
  margin-top: 2px;
}

.dup-actions {
  display: flex;
  gap: 8px;
}

.dup-btn {
  flex: 1;
}

.error-note {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ion-color-danger);
}
</style>
