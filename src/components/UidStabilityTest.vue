<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import type { NormalizedNfcTag, UidStabilityScanResult, UidStabilityVerdict } from '@/types/nfc';
import { nfcService } from '@/services/nfc.service';
import { 
  shieldCheckmarkOutline, 
  checkmarkCircle, 
  warningOutline, 
  helpCircleOutline,
  refreshOutline,
  closeOutline,
  shieldOutline
} from 'ionicons/icons';
import { IonIcon, IonButton, IonSpinner } from '@ionic/vue';

const TOTAL_SCANS_REQUIRED = 5;

const isRunning = ref(false);
const scans = ref<UidStabilityScanResult[]>([]);
const isComplete = ref(false);
const statusMessage = ref('Tap the card against the phone to begin Scan 1.');

const verdict = computed<UidStabilityVerdict>(() => {
  if (scans.value.length < TOTAL_SCANS_REQUIRED) return null;

  const validIds = scans.value.map(s => s.formattedId).filter(id => id !== 'Unavailable' && id !== 'N/A');

  if (validIds.length < TOTAL_SCANS_REQUIRED) {
    return 'undetermined';
  }

  const firstId = validIds[0];
  const allIdentical = validIds.every(id => id === firstId);

  return allIdentical ? 'stable' : 'dynamic';
});

async function startTest() {
  scans.value = [];
  isComplete.value = false;
  isRunning.value = true;
  statusMessage.value = `Scan 1 of ${TOTAL_SCANS_REQUIRED}: Tap card to phone.`;

  try {
    await nfcService.startScanning((tag: NormalizedNfcTag) => {
      handleScanReceived(tag);
    }, { isStabilityTest: true });
  } catch (err: unknown) {
    isRunning.value = false;
    statusMessage.value = err instanceof Error ? err.message : 'Failed to start NFC scan.';
  }
}

async function handleScanReceived(tag: NormalizedNfcTag) {
  if (scans.value.length >= TOTAL_SCANS_REQUIRED) return;

  const scanNumber = scans.value.length + 1;
  const result: UidStabilityScanResult = {
    scanNumber,
    rawId: tag.compactId,
    formattedId: tag.id,
    timestamp: Date.now()
  };

  scans.value.push(result);

  if (scans.value.length >= TOTAL_SCANS_REQUIRED) {
    isComplete.value = true;
    isRunning.value = false;
    statusMessage.value = 'Test finished! Review results below.';
    await nfcService.stopScanning();
  } else {
    statusMessage.value = `Scan ${scans.value.length + 1} of ${TOTAL_SCANS_REQUIRED}: Remove card briefly and tap again.`;
  }
}

async function restartTest() {
  await startTest();
}

async function cancelTest() {
  isRunning.value = false;
  await nfcService.stopScanning();
}

onUnmounted(async () => {
  if (isRunning.value) {
    await nfcService.stopScanning();
  }
});
</script>

<template>
  <div class="glass-card stability-card">
    <div class="card-header-row">
      <div class="header-title-wrap">
        <ion-icon :icon="shieldCheckmarkOutline" class="header-icon" />
        <h3 class="card-title">UID Stability Test</h3>
      </div>
      <span v-if="isRunning" class="live-badge">Testing Active</span>
      <span v-else-if="isComplete" class="complete-badge">Completed</span>
    </div>

    <p class="section-desc">
      Evaluates whether this card exposes a fixed hardware UID or generates randomized dynamic identifiers on each tap.
    </p>

    <!-- Initial State / Start Button -->
    <div v-if="!isRunning && !isComplete && scans.length === 0" class="start-panel">
      <div class="test-rules">
        <div class="rule-item">
          <span class="rule-num">1</span>
          <span>Press <strong>Start UID Test</strong> below</span>
        </div>
        <div class="rule-item">
          <span class="rule-num">2</span>
          <span>Tap the same NFC card <strong>5 times</strong> (lifting between taps)</span>
        </div>
        <div class="rule-item">
          <span class="rule-num">3</span>
          <span>Check if the identifier remains consistent</span>
        </div>
      </div>

      <ion-button 
        color="secondary" 
        class="full-btn"
        @click="startTest"
      >
        <ion-icon :icon="shieldOutline" slot="start" />
        Start UID Test (5 Scans)
      </ion-button>
    </div>

    <!-- Active Scan Tracker -->
    <div v-else class="test-active-panel">
      <!-- Status Message Banner -->
      <div class="status-banner" :class="{ 'banner-pulse': isRunning }">
        <ion-spinner v-if="isRunning" name="crescent" class="banner-spinner" />
        <ion-icon v-else-if="isComplete" :icon="checkmarkCircle" class="banner-icon-success" />
        <span>{{ statusMessage }}</span>
      </div>

      <!-- Scans List (1 to 5) -->
      <div class="scans-list">
        <div 
          v-for="i in TOTAL_SCANS_REQUIRED" 
          :key="i"
          class="scan-row"
          :class="{
            'scan-completed': scans[i - 1],
            'scan-current': isRunning && scans.length === i - 1,
            'scan-pending': scans.length < i - 1
          }"
        >
          <div class="scan-num-badge">Scan {{ i }}</div>
          <div class="scan-result-value font-mono">
            <template v-if="scans[i - 1]">
              {{ scans[i - 1].formattedId }}
            </template>
            <template v-else-if="isRunning && scans.length === i - 1">
              <span class="waiting-text">Waiting for tap...</span>
            </template>
            <template v-else>
              <span class="idle-text">-- : -- : -- : --</span>
            </template>
          </div>
          <div class="scan-status-icon">
            <ion-icon 
              v-if="scans[i - 1]" 
              :icon="checkmarkCircle" 
              class="icon-done" 
            />
            <ion-spinner 
              v-else-if="isRunning && scans.length === i - 1" 
              name="dots" 
              class="icon-waiting" 
            />
            <span v-else class="icon-idle">•</span>
          </div>
        </div>
      </div>

      <!-- Verdict Box (when completed) -->
      <div v-if="isComplete && verdict" class="verdict-card" :class="`verdict-${verdict}`">
        <div class="verdict-header">
          <ion-icon 
            v-if="verdict === 'stable'" 
            :icon="checkmarkCircle" 
            class="verdict-icon" 
          />
          <ion-icon 
            v-else-if="verdict === 'dynamic'" 
            :icon="warningOutline" 
            class="verdict-icon" 
          />
          <ion-icon 
            v-else 
            :icon="helpCircleOutline" 
            class="verdict-icon" 
          />
          <h4 class="verdict-title">
            {{ verdict === 'stable' ? '✓ Stable Identifier' : (verdict === 'dynamic' ? '⚠ Dynamic Identifier' : '? Unable to Determine') }}
          </h4>
        </div>

        <p class="verdict-desc">
          <template v-if="verdict === 'stable'">
            The exact same identifier was reported across all 5 scans.
          </template>
          <template v-else-if="verdict === 'dynamic'">
            Different identifiers were reported between scans. This card uses randomized UIDs or anti-tracking emulation.
          </template>
          <template v-else>
            No valid identifier was exposed for one or more scans.
          </template>
        </p>

        <!-- Security Disclaimer -->
        <div class="security-disclaimer">
          <strong>Security Note:</strong> A stable NFC identifier can be useful for identification, but should not automatically be treated as a secure authentication credential.
        </div>
      </div>

      <!-- Controls Row -->
      <div class="test-controls-row">
        <ion-button 
          v-if="isRunning" 
          fill="outline" 
          color="danger" 
          class="control-btn"
          @click="cancelTest"
        >
          <ion-icon :icon="closeOutline" slot="start" />
          Cancel Test
        </ion-button>
        <ion-button 
          v-if="isComplete" 
          color="secondary" 
          class="control-btn"
          @click="restartTest"
        >
          <ion-icon :icon="refreshOutline" slot="start" />
          Restart Test
        </ion-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stability-card {
  padding: 18px;
  background: var(--app-surface);
}

.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.header-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-icon {
  font-size: 1.25rem;
  color: var(--ion-color-secondary);
}

.card-title {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--app-text-primary);
}

.live-badge {
  font-size: 0.72rem;
  font-weight: 700;
  background: rgba(121, 40, 202, 0.15);
  color: var(--ion-color-secondary);
  padding: 3px 8px;
  border-radius: 9999px;
  border: 1px solid rgba(121, 40, 202, 0.3);
}

.complete-badge {
  font-size: 0.72rem;
  font-weight: 700;
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  padding: 3px 8px;
  border-radius: 9999px;
}

.section-desc {
  font-size: 0.84rem;
  color: var(--app-text-secondary);
  line-height: 1.4;
  margin: 0 0 16px 0;
}

.test-rules {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  padding: 12px 14px;
}

.rule-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.84rem;
  color: var(--app-text-secondary);
}

.rule-num {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--ion-color-secondary);
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.full-btn {
  width: 100%;
}

.status-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--app-text-primary);
  margin-bottom: 14px;
}

.banner-pulse {
  border-color: var(--ion-color-secondary);
}

.banner-spinner {
  width: 16px;
  height: 16px;
}

.banner-icon-success {
  font-size: 1.2rem;
  color: #10b981;
}

.scans-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.scan-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  transition: all 0.2s ease;
}

.scan-current {
  border-color: var(--ion-color-secondary);
  background: rgba(121, 40, 202, 0.05);
}

.scan-completed {
  border-color: rgba(16, 185, 129, 0.3);
}

.scan-num-badge {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--app-text-secondary);
  width: 60px;
}

.scan-result-value {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--app-text-primary);
  flex: 1;
  text-align: center;
}

.waiting-text {
  font-size: 0.8rem;
  color: var(--ion-color-secondary);
  font-style: italic;
}

.idle-text {
  font-size: 0.8rem;
  color: var(--app-text-muted);
}

.scan-status-icon {
  width: 24px;
  display: flex;
  justify-content: flex-end;
}

.icon-done {
  font-size: 1.1rem;
  color: #10b981;
}

.icon-waiting {
  width: 18px;
  height: 18px;
}

.icon-idle {
  color: var(--app-text-muted);
  font-size: 1.2rem;
}

.verdict-card {
  border-radius: 14px;
  padding: 14px;
  margin-bottom: 16px;
}

.verdict-stable {
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.verdict-dynamic {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.verdict-undetermined {
  background: rgba(148, 163, 184, 0.08);
  border: 1px solid rgba(148, 163, 184, 0.3);
}

.verdict-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.verdict-icon {
  font-size: 1.3rem;
}

.verdict-stable .verdict-icon, .verdict-stable .verdict-title {
  color: #10b981;
}

.verdict-dynamic .verdict-icon, .verdict-dynamic .verdict-title {
  color: #f59e0b;
}

.verdict-undetermined .verdict-icon, .verdict-undetermined .verdict-title {
  color: var(--app-text-secondary);
}

.verdict-title {
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0;
}

.verdict-desc {
  font-size: 0.84rem;
  color: var(--app-text-primary);
  margin: 0 0 10px 0;
  line-height: 1.4;
}

.security-disclaimer {
  font-size: 0.76rem;
  color: var(--app-text-secondary);
  background: var(--app-surface);
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--app-border);
  line-height: 1.35;
}

.test-controls-row {
  display: flex;
  gap: 10px;
}

.control-btn {
  flex: 1;
}
</style>
