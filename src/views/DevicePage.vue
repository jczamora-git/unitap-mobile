<script setup lang="ts">
import { 
  IonPage, 
  IonContent, 
  IonIcon, 
  IonButton,
  onIonViewWillEnter 
} from '@ionic/vue';
import { 
  hardwareChipOutline, 
  informationCircleOutline, 
  settingsOutline,
  helpCircleOutline,
  shieldCheckmarkOutline,
  checkmarkCircle,
  closeCircle,
  alertCircle,
  refreshOutline,
  timeOutline
} from 'ionicons/icons';
import { useNfc } from '@/composables/useNfc';
import { UniPageHeader } from '@/components/ui';

const { deviceStatus, refreshStatus, openSettings } = useNfc();

onIonViewWillEnter(async () => {
  await refreshStatus();
});
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Hardware Diagnostics"
      subtitle="NFC hardware and runtime state"
      :back-button="true"
      default-back-href="/settings"
      variant="detail"
    />

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Section 1: NFC Hardware & Adapter -->
        <div class="glass-card dev-card">
          <div class="card-header-row">
            <div class="header-title-wrap">
              <ion-icon :icon="hardwareChipOutline" class="header-icon" />
              <h3 class="card-title">NFC Environment</h3>
            </div>
            <ion-button fill="clear" size="small" class="refresh-btn" @click="refreshStatus">
              <ion-icon :icon="refreshOutline" slot="icon-only" />
            </ion-button>
          </div>

          <div class="info-table">
            <!-- Hardware Support -->
            <div class="info-row">
              <span class="info-key">Hardware Support</span>
              <span 
                class="badge"
                :class="deviceStatus.supported ? 'badge-success' : 'badge-danger'"
              >
                <ion-icon :icon="deviceStatus.supported ? checkmarkCircle : closeCircle" />
                {{ deviceStatus.supported ? 'Supported' : 'Unsupported' }}
              </span>
            </div>

            <!-- Adapter Status -->
            <div class="info-row">
              <span class="info-key">Adapter Status</span>
              <span 
                class="badge"
                :class="deviceStatus.enabled ? 'badge-success' : (deviceStatus.platform === 'web' ? 'badge-warning' : 'badge-danger')"
              >
                <ion-icon :icon="deviceStatus.enabled ? checkmarkCircle : alertCircle" />
                {{ deviceStatus.enabled ? 'Enabled' : (deviceStatus.platform === 'web' ? 'Web Preview' : 'Disabled') }}
              </span>
            </div>

            <!-- Platform -->
            <div class="info-row">
              <span class="info-key">Platform Target</span>
              <span class="info-val font-mono">{{ deviceStatus.platform.toUpperCase() }}</span>
            </div>

            <!-- Plugin Version -->
            <div class="info-row">
              <span class="info-key">NFC Plugin Version</span>
              <span class="info-val font-mono">{{ deviceStatus.pluginVersion || 'Capgo NFC 8.2.7' }}</span>
            </div>
          </div>

          <!-- Open Settings Button -->
          <div class="action-box">
            <ion-button 
              fill="outline" 
              color="primary" 
              class="full-btn"
              @click="openSettings"
            >
              <ion-icon :icon="settingsOutline" slot="start" />
              Open NFC Settings
            </ion-button>
          </div>
        </div>

        <!-- Section 2: Application Spec -->
        <div class="glass-card dev-card">
          <div class="card-header-row">
            <div class="header-title-wrap">
              <ion-icon :icon="informationCircleOutline" class="header-icon" />
              <h3 class="card-title">Application</h3>
            </div>
          </div>

          <div class="info-table">
            <div class="info-row">
              <span class="info-key">Application Name</span>
              <span class="info-val">NFC Inspector</span>
            </div>

            <div class="info-row">
              <span class="info-key">Version</span>
              <span class="info-val font-mono">1.0.0</span>
            </div>

            <div class="info-row">
              <span class="info-key">Capacitor Runtime</span>
              <span class="info-val font-mono">8.5.2</span>
            </div>

            <div class="info-row">
              <span class="info-key">Operating Mode</span>
              <span class="badge badge-success">
                <ion-icon :icon="shieldCheckmarkOutline" />
                Safe Read-Only
              </span>
            </div>
          </div>

          <div class="action-box">
            <ion-button 
              fill="outline" 
              color="secondary" 
              class="full-btn"
              router-link="/diagnostics/history"
            >
              <ion-icon :icon="timeOutline" slot="start" />
              View Diagnostic Scan History
            </ion-button>
          </div>
        </div>

        <!-- Section 3: Scanning Guide -->
        <div class="glass-card dev-card">
          <div class="card-header-row">
            <div class="header-title-wrap">
              <ion-icon :icon="helpCircleOutline" class="header-icon" />
              <h3 class="card-title">NFC Scanning Help</h3>
            </div>
          </div>

          <div class="guide-steps">
            <div class="step-item">
              <div class="step-badge">1</div>
              <div class="step-body">
                <div class="step-title">Ensure NFC is turned on</div>
                <div class="step-desc">Go to system settings and verify the NFC switch is active.</div>
              </div>
            </div>

            <div class="step-item">
              <div class="step-badge">2</div>
              <div class="step-body">
                <div class="step-title">Open the Scanner tab</div>
                <div class="step-desc">Tap "Start Scanning" to arm the reader mode listener.</div>
              </div>
            </div>

            <div class="step-item">
              <div class="step-badge">3</div>
              <div class="step-body">
                <div class="step-title">Locate phone NFC antenna</div>
                <div class="step-desc">Hold the card against the back of your phone (usually near the top camera module or center back).</div>
              </div>
            </div>

            <div class="step-item">
              <div class="step-badge">4</div>
              <div class="step-body">
                <div class="step-title">Keep tag steady</div>
                <div class="step-desc">Hold the card firmly for 1-2 seconds until the success vibration triggers.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.header-styled ion-toolbar {
  --background: var(--app-bg);
  --border-width: 0;
  padding-top: env(safe-area-inset-top, 0px);
}

.header-inner {
  padding: 8px 16px;
}

.brand-title {
  font-size: 1.45rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--app-text-primary);
}

.brand-subtitle {
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--app-text-secondary);
  margin-top: 1px;
}

.page-container {
  max-width: 640px;
  margin: 0 auto;
  padding-bottom: 24px;
}

.dev-card {
  padding: 18px;
  background: var(--app-surface);
}

.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.header-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-icon {
  font-size: 1.25rem;
  color: var(--ion-color-primary);
}

.card-title {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--app-text-primary);
}

.refresh-btn {
  --color: var(--app-text-secondary);
  margin: 0;
  height: 32px;
}

.info-table {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--app-border);
}

.info-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.info-key {
  font-size: 0.84rem;
  color: var(--app-text-secondary);
  font-weight: 500;
}

.info-val {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--app-text-primary);
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
}

.badge-success {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.badge-warning {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
}

.badge-danger {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.action-box {
  margin-top: 16px;
}

.full-btn {
  width: 100%;
}

.guide-steps {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.step-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.step-badge {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  color: var(--ion-color-primary);
  font-size: 0.8rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}

.step-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.step-title {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--app-text-primary);
}

.step-desc {
  font-size: 0.8rem;
  color: var(--app-text-secondary);
  line-height: 1.4;
}
</style>
