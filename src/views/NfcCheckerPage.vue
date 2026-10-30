<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  onIonViewWillEnter,
  onIonViewDidLeave
} from '@ionic/vue';
import {
  radioOutline,
  checkmarkCircleOutline,
  alertCircleOutline,
  warningOutline,
  personOutline,
  hardwareChipOutline,
  refreshOutline,
  personAddOutline,
  eyeOutline,
  stopCircleOutline,
  idCardOutline
} from 'ionicons/icons';
import { useNfc } from '@/composables/useNfc';
import { studentService, type CardLookupResult } from '@/services/student.service';
import { formatFullName, formatYearLevel } from '@/utilities/student-formatters';
import { formatDateTime } from '@/utilities/nfc-formatters';
import { haptics } from '@/utilities/haptics';
import { 
  UniPageHeader, 
  UniButton, 
  UniStatusBadge 
} from '@/components/ui';

const router = useRouter();

const {
  deviceStatus,
  isScanning,
  lastTag,
  scanError,
  startScan,
  stopScan,
  refreshStatus,
  openSettings,
  resetLastTag
} = useNfc();

type CheckerState = 'READY' | 'SCANNING' | 'CHECKING' | 'REGISTERED' | 'UNREGISTERED' | 'INACTIVE' | 'ERROR';

const currentState = ref<CheckerState>('READY');
const lookupResult = ref<CardLookupResult | null>(null);
const scanTimestamp = ref<string>('');
const isChecking = ref(false);

const badgeLabel = computed(() => {
  if (currentState.value === 'REGISTERED') return 'Registered';
  if (currentState.value === 'UNREGISTERED') return 'Unregistered';
  if (currentState.value === 'INACTIVE') return 'Inactive';
  if (currentState.value === 'CHECKING') return 'Checking';
  if (isScanning.value) return 'Scanning';
  return 'Ready';
});

const badgeVariant = computed<'neutral' | 'mint' | 'warning' | 'danger'>(() => {
  if (currentState.value === 'REGISTERED') return 'mint';
  if (currentState.value === 'UNREGISTERED' || currentState.value === 'INACTIVE') return 'warning';
  if (currentState.value === 'ERROR') return 'danger';
  if (isScanning.value) return 'mint';
  return 'neutral';
});

// Process scanned tag read-only
watch(lastTag, async (newTag) => {
  if (!newTag?.id || isChecking.value) return;

  isChecking.value = true;
  currentState.value = 'CHECKING';
  scanTimestamp.value = formatDateTime(Date.now());

  try {
    const result = await studentService.lookupCard(newTag.id);
    lookupResult.value = result;

    if (result.status === 'ACTIVE' && result.student) {
      currentState.value = 'REGISTERED';
      await haptics.success();
    } else if (result.status === 'UNREGISTERED') {
      currentState.value = 'UNREGISTERED';
      await haptics.warning();
    } else {
      // LOST, REPLACED, DEACTIVATED
      currentState.value = 'INACTIVE';
      await haptics.warning();
    }
  } catch (err: unknown) {
    console.error('Error during card lookup:', err);
    currentState.value = 'ERROR';
    await haptics.error();
  } finally {
    isChecking.value = false;
  }
});

watch(scanError, (err) => {
  if (err) {
    currentState.value = 'ERROR';
  }
});

watch(isScanning, (scanning) => {
  if (scanning && !lookupResult.value && currentState.value !== 'CHECKING') {
    currentState.value = 'SCANNING';
  } else if (!scanning && !lookupResult.value && currentState.value !== 'CHECKING' && currentState.value !== 'ERROR') {
    currentState.value = 'READY';
  }
});

async function handleToggleScanner() {
  if (isScanning.value) {
    await stopScan();
    if (!lookupResult.value) {
      currentState.value = 'READY';
    }
  } else {
    resetState();
    await startScan();
  }
}

function resetState() {
  lookupResult.value = null;
  resetLastTag();
  currentState.value = isScanning.value ? 'SCANNING' : 'READY';
}

async function handleScanAnother() {
  resetState();
  if (!isScanning.value && deviceStatus.value.enabled) {
    await startScan();
  }
}

function handleViewProfile(studentId: string) {
  haptics.light();
  router.push(`/students/${studentId}`);
}

function handleRegisterCard(uid: string) {
  haptics.light();
  router.push({
    path: '/register-student',
    query: { rfid: uid }
  });
}

onMounted(async () => {
  await refreshStatus();
});

onIonViewWillEnter(async () => {
  await refreshStatus();
  if (deviceStatus.value.enabled && !lookupResult.value) {
    await startScan();
  }
});

onIonViewDidLeave(async () => {
  await stopScan();
});
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="NFC Checker"
      subtitle="Tap a student ID to view its information."
      :optional-badge="badgeLabel"
      :badge-variant="badgeVariant"
      variant="root"
    >
      <template #trailing>
        <button 
          class="uni-header-action-btn" 
          aria-label="NFC Diagnostics" 
          @click="router.push('/diagnostics/device')"
        >
          <ion-icon :icon="hardwareChipOutline" />
        </button>
      </template>
    </UniPageHeader>

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Supporting Subtext -->
        <div class="supporting-bar">
          <span class="supporting-text">Identify registered student cards</span>
          <span class="read-only-pill">Read-only Lookup</span>
        </div>

        <!-- Scanner Surface Card -->
        <div class="minimal-card scanner-surface-card">
          <div class="nfc-halo-container" :class="{ 'is-active': isScanning && !lookupResult, 'is-checking': isChecking }">
            <div class="nfc-pulse-ring"></div>
            <div class="nfc-halo-core">
              <ion-icon :icon="radioOutline" class="nfc-core-icon" />
            </div>
          </div>

          <div class="scanner-text-block">
            <h3 class="scanner-status-title">
              <template v-if="currentState === 'CHECKING'">Checking Card...</template>
              <template v-else-if="currentState === 'SCANNING'">Ready to Tap</template>
              <template v-else-if="currentState === 'READY'">Scanner Idle</template>
              <template v-else-if="currentState === 'REGISTERED'">Card Recognized</template>
              <template v-else-if="currentState === 'UNREGISTERED'">Unregistered Card</template>
              <template v-else-if="currentState === 'INACTIVE'">Inactive Card</template>
              <template v-else>Scanner Notice</template>
            </h3>
            <p class="scanner-instruction-text">
              <template v-if="currentState === 'CHECKING'">Searching student records locally...</template>
              <template v-else-if="currentState === 'SCANNING'">Hold an NFC student ID card to the back of this device.</template>
              <template v-else-if="currentState === 'READY'">Tap start to activate NFC reader.</template>
              <template v-else-if="currentState === 'REGISTERED'">Student information loaded below.</template>
              <template v-else-if="currentState === 'UNREGISTERED'">This card is not registered in UniTap.</template>
              <template v-else-if="currentState === 'INACTIVE'">Card lifecycle status recorded as inactive.</template>
              <template v-else>{{ scanError || 'Check device NFC settings.' }}</template>
            </p>
          </div>

          <!-- Scanner Control Action -->
          <div class="scanner-controls-row">
            <UniButton
              :variant="isScanning ? 'outline' : 'primary'"
              :size="'sm'"
              :icon="isScanning ? stopCircleOutline : radioOutline"
              @click="handleToggleScanner"
            >
              {{ isScanning ? 'Stop Scanner' : 'Start Scanner' }}
            </UniButton>
          </div>
        </div>

        <!-- Result Container: Refined Card Transitions -->
        <transition name="uni-result-fade" mode="out-in">
          <!-- 1. REGISTERED CARD RESULT -->
          <div 
            v-if="currentState === 'REGISTERED' && lookupResult?.student" 
            key="registered"
            class="minimal-card result-card result-card-registered"
          >
            <div class="result-card-header">
              <div class="result-indicator-wrap">
                <ion-icon :icon="checkmarkCircleOutline" class="indicator-icon icon-mint" />
                <div class="result-title-group">
                  <h4 class="result-headline">Registered Card</h4>
                  <span class="result-meta">Active student record found</span>
                </div>
              </div>
              <UniStatusBadge variant="active" :pulse="true">Active</UniStatusBadge>
            </div>

            <!-- Student Profile Information -->
            <div class="student-info-surface">
              <div class="student-primary-line">
                <div class="student-avatar-box">
                  <ion-icon :icon="personOutline" />
                </div>
                <div class="student-names-wrap">
                  <h3 class="student-full-name">
                    {{ formatFullName(lookupResult.student.firstName, lookupResult.student.middleName, lookupResult.student.lastName) }}
                  </h3>
                  <div class="student-id-row">
                    <span class="student-num-label">Student ID:</span>
                    <span class="student-num-value font-mono">{{ lookupResult.student.studentNumber || 'Unavailable' }}</span>
                  </div>
                </div>
              </div>

              <div class="info-details-grid">
                <div class="info-cell">
                  <span class="cell-label">Course</span>
                  <span class="cell-value">{{ lookupResult.student.course || 'BSIT' }}</span>
                </div>
                <div class="info-cell">
                  <span class="cell-label">Year Level</span>
                  <span class="cell-value">{{ formatYearLevel(lookupResult.student.yearLevel) }}</span>
                </div>
                <div class="info-cell">
                  <span class="cell-label">Section</span>
                  <span class="cell-value">{{ lookupResult.student.section || 'Unavailable' }}</span>
                </div>
                <div class="info-cell">
                  <span class="cell-label">Masked UID</span>
                  <span class="cell-value font-mono">{{ lookupResult.maskedUid }}</span>
                </div>
              </div>

              <div v-if="scanTimestamp" class="scanned-timestamp-line">
                <span class="time-meta">Checked: {{ scanTimestamp }}</span>
              </div>
            </div>

            <!-- Action Buttons -->
            <div class="result-actions-row">
              <UniButton
                variant="primary"
                :icon="eyeOutline"
                block
                @click="handleViewProfile(lookupResult.student.id)"
              >
                View Student Profile
              </UniButton>
              <UniButton
                variant="secondary"
                :icon="refreshOutline"
                block
                @click="handleScanAnother"
              >
                Scan Another Card
              </UniButton>
            </div>
          </div>

          <!-- 2. UNREGISTERED CARD RESULT -->
          <div 
            v-else-if="currentState === 'UNREGISTERED' && lookupResult" 
            key="unregistered"
            class="minimal-card result-card result-card-unregistered"
          >
            <div class="result-card-header">
              <div class="result-indicator-wrap">
                <ion-icon :icon="alertCircleOutline" class="indicator-icon icon-warning" />
                <div class="result-title-group">
                  <h4 class="result-headline">Card Not Registered</h4>
                  <span class="result-meta">Unlinked NFC card</span>
                </div>
              </div>
              <UniStatusBadge variant="neutral">Unregistered</UniStatusBadge>
            </div>

            <p class="unregistered-explanation">
              This NFC card is not linked to any student account in UniTap.
            </p>

            <div class="detected-uid-box">
              <span class="uid-tag-label">Detected UID:</span>
              <span class="uid-tag-value font-mono">{{ lookupResult.scannedUid || 'Unavailable' }}</span>
            </div>

            <!-- Actions -->
            <div class="result-actions-row">
              <UniButton
                variant="primary"
                :icon="personAddOutline"
                block
                @click="handleRegisterCard(lookupResult.scannedUid)"
              >
                Register Card
              </UniButton>
              <UniButton
                variant="secondary"
                :icon="refreshOutline"
                block
                @click="handleScanAnother"
              >
                Scan Again
              </UniButton>
            </div>
          </div>

          <!-- 3. INACTIVE OR REPLACED CARD RESULT -->
          <div 
            v-else-if="currentState === 'INACTIVE' && lookupResult" 
            key="inactive"
            class="minimal-card result-card result-card-inactive"
          >
            <div class="result-card-header">
              <div class="result-indicator-wrap">
                <ion-icon :icon="warningOutline" class="indicator-icon icon-danger" />
                <div class="result-title-group">
                  <h4 class="result-headline">Inactive Card</h4>
                  <span class="result-meta">Card is no longer valid</span>
                </div>
              </div>
              <UniStatusBadge :variant="lookupResult.status === 'REPLACED' ? 'warning' : 'danger'">
                {{ lookupResult.status }}
              </UniStatusBadge>
            </div>

            <p class="inactive-explanation">
              This card was assigned previously but is marked as <strong>{{ lookupResult.status }}</strong>. It cannot be used for active check-ins.
            </p>

            <!-- Historical Linked Student (if any) -->
            <div v-if="lookupResult.student" class="student-info-surface student-info-subtle">
              <div class="student-primary-line">
                <div class="student-avatar-box avatar-muted">
                  <ion-icon :icon="personOutline" />
                </div>
                <div class="student-names-wrap">
                  <h3 class="student-full-name">
                    {{ formatFullName(lookupResult.student.firstName, lookupResult.student.middleName, lookupResult.student.lastName) }}
                  </h3>
                  <div class="student-id-row">
                    <span class="student-num-label">Student ID:</span>
                    <span class="student-num-value font-mono">{{ lookupResult.student.studentNumber || 'Unavailable' }}</span>
                  </div>
                </div>
              </div>

              <div class="info-details-grid">
                <div class="info-cell">
                  <span class="cell-label">Course</span>
                  <span class="cell-value">{{ lookupResult.student.course || 'BSIT' }}</span>
                </div>
                <div class="info-cell">
                  <span class="cell-label">Section</span>
                  <span class="cell-value">{{ lookupResult.student.section || 'Unavailable' }}</span>
                </div>
                <div class="info-cell">
                  <span class="cell-label">Masked UID</span>
                  <span class="cell-value font-mono">{{ lookupResult.maskedUid }}</span>
                </div>
                <div class="info-cell">
                  <span class="cell-label">Card Status</span>
                  <span class="cell-value text-warning">{{ lookupResult.status }}</span>
                </div>
              </div>
            </div>

            <div class="result-actions-row">
              <UniButton
                v-if="lookupResult.student"
                variant="primary"
                :icon="eyeOutline"
                block
                @click="handleViewProfile(lookupResult.student.id)"
              >
                View Student Profile
              </UniButton>
              <UniButton
                variant="secondary"
                :icon="refreshOutline"
                block
                @click="handleScanAnother"
              >
                Scan Another Card
              </UniButton>
            </div>
          </div>

          <!-- 4. ERROR STATE -->
          <div 
            v-else-if="currentState === 'ERROR' && scanError" 
            key="error"
            class="minimal-card result-card result-card-error"
          >
            <div class="result-card-header">
              <div class="result-indicator-wrap">
                <ion-icon :icon="alertCircleOutline" class="indicator-icon icon-danger" />
                <div class="result-title-group">
                  <h4 class="result-headline">Scanner Notice</h4>
                  <span class="result-meta">Hardware or permission alert</span>
                </div>
              </div>
              <UniStatusBadge variant="danger">Error</UniStatusBadge>
            </div>

            <p class="error-explanation">{{ scanError }}</p>

            <div class="result-actions-row">
              <UniButton
                variant="primary"
                :icon="hardwareChipOutline"
                block
                @click="openSettings"
              >
                Open NFC Settings
              </UniButton>
              <UniButton
                variant="secondary"
                :icon="refreshOutline"
                block
                @click="handleScanAnother"
              >
                Retry
              </UniButton>
            </div>
          </div>
        </transition>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.supporting-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 4px;
}

.supporting-text {
  font-size: 13px;
  color: var(--uni-text-secondary);
  font-weight: 500;
}

.read-only-pill {
  font-size: 11px;
  font-weight: 600;
  color: var(--uni-text-muted);
  background: var(--uni-surface-elevated);
  border: 1px solid var(--uni-border);
  padding: 2px 8px;
  border-radius: 9999px;
  white-space: nowrap;
}

.diagnostics-action-btn {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  color: var(--uni-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
  transition: transform 0.15s ease, background 0.15s ease;
  padding: 0;
}

.diagnostics-action-btn:active {
  transform: scale(0.92);
  background: var(--uni-surface-elevated);
}

/* Minimal Scanner Surface Card */
.scanner-surface-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 18px;
  gap: 16px;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-card);
  box-shadow: var(--uni-shadow-card);
}

.nfc-halo-container {
  position: relative;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nfc-halo-core {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: rgba(112, 243, 207, 0.1);
  border: 1px solid rgba(112, 243, 207, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #0E8560;
  transition: all 0.3s ease;
  z-index: 2;
}

@media (prefers-color-scheme: dark) {
  .nfc-halo-core {
    color: var(--uni-mint);
  }
}

.nfc-core-icon {
  font-size: 28px;
}

.nfc-pulse-ring {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.nfc-halo-container.is-active .nfc-pulse-ring {
  opacity: 1;
  border-color: rgba(112, 243, 207, 0.4);
  animation: nfc-pulse 2s infinite ease-out;
}

.nfc-halo-container.is-checking .nfc-halo-core {
  background: rgba(101, 191, 255, 0.15);
  border-color: rgba(101, 191, 255, 0.4);
  color: var(--uni-blue);
  transform: scale(1.05);
}

@keyframes nfc-pulse {
  0% {
    transform: scale(0.85);
    opacity: 0.8;
  }
  70% {
    transform: scale(1.25);
    opacity: 0;
  }
  100% {
    transform: scale(1.25);
    opacity: 0;
  }
}

.scanner-text-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 320px;
}

.scanner-status-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--uni-text-primary);
  margin: 0;
  letter-spacing: -0.015em;
}

.scanner-instruction-text {
  font-size: 13px;
  color: var(--uni-text-secondary);
  line-height: 1.4;
  margin: 0;
}

.scanner-controls-row {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

/* Result Card Styles */
.result-card {
  padding: 18px;
  border-radius: var(--uni-radius-card);
  border: 1px solid var(--uni-border);
  background: var(--uni-surface);
  box-shadow: var(--uni-shadow-card);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.result-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.result-indicator-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.indicator-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.icon-mint {
  color: #0E8560;
}

@media (prefers-color-scheme: dark) {
  .icon-mint { color: var(--uni-mint); }
}

.icon-warning {
  color: #D97706;
}

.icon-danger {
  color: #DC2626;
}

.result-title-group {
  display: flex;
  flex-direction: column;
}

.result-headline {
  font-size: 16px;
  font-weight: 700;
  color: var(--uni-text-primary);
  margin: 0;
}

.result-meta {
  font-size: 12px;
  color: var(--uni-text-secondary);
}

/* Student Information Surface */
.student-info-surface {
  padding: 14px;
  border-radius: 14px;
  background: var(--uni-surface-elevated);
  border: 1px solid var(--uni-border);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.student-info-subtle {
  opacity: 0.95;
}

.student-primary-line {
  display: flex;
  align-items: center;
  gap: 12px;
}

.student-avatar-box {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(112, 243, 207, 0.15);
  color: #0E8560;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}

@media (prefers-color-scheme: dark) {
  .student-avatar-box { color: var(--uni-mint); }
}

.avatar-muted {
  background: var(--uni-surface);
  color: var(--uni-text-muted);
}

.student-names-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.student-full-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--uni-text-primary);
  margin: 0;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.student-id-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
}

.student-num-label {
  font-size: 12px;
  color: var(--uni-text-secondary);
}

.student-num-value {
  font-size: 12px;
  color: var(--uni-text-primary);
  font-weight: 600;
}

.info-details-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.info-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cell-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--uni-text-muted);
}

.cell-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--uni-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.text-warning {
  color: #D97706;
}

.scanned-timestamp-line {
  font-size: 11.5px;
  color: var(--uni-text-muted);
  border-top: 1px solid var(--uni-border);
  padding-top: 8px;
}

.detected-uid-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--uni-surface-elevated);
  border: 1px solid var(--uni-border);
  border-radius: 12px;
}

.uid-tag-label {
  font-size: 12px;
  color: var(--uni-text-secondary);
}

.uid-tag-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--uni-text-primary);
}

.unregistered-explanation,
.inactive-explanation,
.error-explanation {
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--uni-text-secondary);
  margin: 0;
}

.result-actions-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Transitions */
.uni-result-fade-enter-active,
.uni-result-fade-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.uni-result-fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.uni-result-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (max-width: 360px) {
  .info-details-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
</style>
