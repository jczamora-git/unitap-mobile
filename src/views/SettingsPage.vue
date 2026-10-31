<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  IonSpinner
} from '@ionic/vue';
import {
  hardwareChipOutline,
  timeOutline,
  refreshOutline,
  trashOutline,
  cloudDownloadOutline,
  checkmarkCircle,
  settingsOutline,
  chevronForwardOutline,
  sparklesOutline
} from 'ionicons/icons';
import { useNfc } from '@/composables/useNfc';
import { useOnboarding } from '@/composables/useOnboarding';
import { demoDataService } from '@/services/demo-data.service';
import NfcStatusCard from '@/components/NfcStatusCard.vue';
import UidStabilityTest from '@/components/UidStabilityTest.vue';
import { UniPageHeader, UniDialog } from '@/components/ui';

const router = useRouter();
const { startOnboardingTour } = useOnboarding();

const {
  deviceStatus,
  isLoading: isNfcLoading,
  openSettings,
  refreshStatus
} = useNfc();

const isDemoLoaded = ref(false);
const isOperating = ref(false);
const statusMessage = ref('');
const showResetAlert = ref(false);

async function checkStatus() {
  await refreshStatus();
  isDemoLoaded.value = await demoDataService.isDemoDataLoaded();
}

onMounted(checkStatus);

async function handleLoadSampleData() {
  isOperating.value = true;
  statusMessage.value = '';
  try {
    const res = await demoDataService.loadSampleData();
    isDemoLoaded.value = true;
    statusMessage.value = `Sample data loaded! Added ${res.studentsAdded} students and ${res.eventsAdded} event(s).`;
  } catch (err: unknown) {
    statusMessage.value = err instanceof Error ? err.message : 'Error loading sample data';
  } finally {
    isOperating.value = false;
  }
}

async function handleResetSampleData() {
  isOperating.value = true;
  statusMessage.value = '';
  try {
    await demoDataService.resetSampleData();
    isDemoLoaded.value = false;
    statusMessage.value = 'Sample demo records cleared. Your original custom students remain preserved.';
  } catch (err: unknown) {
    statusMessage.value = err instanceof Error ? err.message : 'Error resetting sample data';
  } finally {
    isOperating.value = false;
  }
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Settings"
      subtitle="Diagnostics & sample data"
      :back-button="true"
      default-back-href="/tabs/home"
      variant="detail"
    />

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Status Notification -->
        <div v-if="statusMessage" class="status-banner">
          <ion-icon :icon="checkmarkCircle" />
          <span>{{ statusMessage }}</span>
        </div>

        <!-- Section 1: Prototype Demo Data -->
        <section class="settings-group">
          <div class="group-header">
            <span>Prototype Data</span>
          </div>

          <div class="grouped-list-card minimal-card">
            <div class="list-action-row" @click="handleLoadSampleData">
              <div class="row-icon-box text-primary">
                <ion-spinner v-if="isOperating" name="crescent" class="btn-spinner" />
                <ion-icon v-else :icon="cloudDownloadOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Load Sample Data</span>
                <span class="row-desc">Populate demo students, events, and sample charges</span>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
            </div>

            <div class="row-divider"></div>

            <div class="list-action-row" @click="showResetAlert = true">
              <div class="row-icon-box text-danger">
                <ion-icon :icon="trashOutline" />
              </div>
              <div class="row-content">
                <span class="row-title text-danger">Reset Demo Records</span>
                <span class="row-desc">Clears generated sample data; preserves your manual entries</span>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
            </div>
          </div>
        </section>

        <!-- Section 2: NFC Diagnostics & Hardware -->
        <section class="settings-group">
          <div class="group-header">
            <span>NFC Hardware &amp; Adapter</span>
          </div>

          <NfcStatusCard :status="deviceStatus" :is-loading="isNfcLoading" />

          <div class="grouped-list-card minimal-card">
            <div class="list-action-row" @click="router.push('/diagnostics/history')">
              <div class="row-icon-box">
                <ion-icon :icon="timeOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Raw NFC Scan History</span>
                <span class="row-desc">Diagnostic physical read records</span>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
            </div>

            <div class="row-divider"></div>

            <div class="list-action-row" @click="router.push('/diagnostics/device')">
              <div class="row-icon-box">
                <ion-icon :icon="hardwareChipOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Device &amp; Tag Diagnostics</span>
                <span class="row-desc">Supported tech classes, NDEF inspect</span>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
            </div>

            <div class="row-divider"></div>

            <div class="list-action-row" @click="openSettings">
              <div class="row-icon-box">
                <ion-icon :icon="settingsOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Android NFC Settings</span>
                <span class="row-desc">Open device system preferences</span>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
            </div>
          </div>
        </section>

        <!-- Section 3: Tag Stability Testing -->
        <section class="settings-group">
          <div class="group-header">
            <span>UID Stability Verification</span>
          </div>

          <div class="minimal-card test-card">
            <div class="test-header">
              <ion-icon :icon="refreshOutline" class="test-icon" />
              <div>
                <h4 class="test-title">5-Scan Stability Test</h4>
                <p class="test-sub">Test repeated physical taps of student ID cards.</p>
              </div>
            </div>
            <UidStabilityTest />
          </div>
        </section>

        <!-- Section 4: App Information -->
        <section class="settings-group">
          <div class="group-header">
            <span>About Application</span>
          </div>

          <div class="minimal-card metadata-card">
            <div class="meta-item-row">
              <span class="meta-lbl">Application</span>
              <span class="meta-val font-semibold">UniTap</span>
            </div>
            <div class="meta-item-row">
              <span class="meta-lbl">Package ID</span>
              <span class="meta-val font-mono">com.unitap.app</span>
            </div>
            <div class="meta-item-row">
              <span class="meta-lbl">Storage Engine</span>
              <span class="meta-val">Capacitor Preferences (Offline)</span>
            </div>
            <div class="meta-item-row">
              <span class="meta-lbl">Environment</span>
              <span class="meta-val font-mono">{{ deviceStatus.platform.toUpperCase() }}</span>
            </div>
          </div>

          <div class="grouped-list-card minimal-card" style="margin-top: 12px;">
            <div class="list-action-row" @click="startOnboardingTour">
              <div class="row-icon-box text-accent">
                <ion-icon :icon="sparklesOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Replay Onboarding Tour</span>
                <span class="row-desc">View the welcome guide and feature walkthrough</span>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
            </div>
          </div>
        </section>
      </div>

      <!-- Confirmation Dialog for Reset -->
      <UniDialog
        v-model:is-open="showResetAlert"
        title="Reset Sample Data?"
        description="This will delete sample demo students, sample events, and sample wallet records. Custom records you created manually will NOT be deleted."
        confirm-text="Confirm Reset"
        cancel-text="Cancel"
        :destructive="true"
        type="destructive"
        @confirm="handleResetSampleData"
        @cancel="showResetAlert = false"
      />
    </ion-content>
  </ion-page>
</template>

<style scoped>
.status-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--app-btn-radius);
  background: rgba(21, 154, 116, 0.12);
  color: var(--ion-color-success);
  font-size: 13px;
  font-weight: 500;
}

.settings-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-header {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--app-text-secondary);
  padding-left: 4px;
}

.grouped-list-card {
  padding: 0;
  overflow: hidden;
}

.list-action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.list-action-row:active {
  background: var(--app-surface-subtle);
}

.row-icon-box {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--app-surface-subtle);
  color: var(--app-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.text-primary {
  color: var(--ion-color-primary);
}

.text-danger {
  color: var(--ion-color-danger);
}

.row-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text-primary);
}

.row-desc {
  font-size: 12px;
  color: var(--app-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-arrow {
  font-size: 15px;
  color: var(--app-text-muted);
  flex-shrink: 0;
}

.row-divider {
  height: 1px;
  background: var(--app-border);
  margin-left: 60px;
}

.test-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.test-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.test-icon {
  font-size: 20px;
  color: var(--ion-color-success);
}

.test-title {
  font-size: 15px;
  font-weight: 650;
  color: var(--app-text-primary);
  margin: 0;
}

.test-sub {
  font-size: 12px;
  color: var(--app-text-secondary);
  margin: 2px 0 0 0;
}

.metadata-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
}

.meta-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

.meta-lbl {
  color: var(--app-text-secondary);
}

.meta-val {
  color: var(--app-text-primary);
  font-weight: 500;
}

.font-semibold {
  font-weight: 600;
}

.btn-spinner {
  width: 14px;
  height: 14px;
}
</style>
