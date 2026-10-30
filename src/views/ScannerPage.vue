<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { 
  IonPage, 
  IonContent, 
  IonIcon,
  onIonViewWillEnter, 
  onIonViewDidLeave 
} from '@ionic/vue';
import { 
  personOutline, 
  checkmarkCircle, 
  personAddOutline, 
  chevronForwardOutline,
  alertCircle,
  hardwareChipOutline,
  radioOutline
} from 'ionicons/icons';
import { useNfc } from '@/composables/useNfc';
import { studentService } from '@/services/student.service';
import type { Student } from '@/types/student';
import { formatFullName, formatStudentAcademicSummary } from '@/utilities/student-formatters';
import { UniPageHeader, UniButton } from '@/components/ui';
import NfcStatusCard from '@/components/NfcStatusCard.vue';
import NfcScannerCard from '@/components/NfcScannerCard.vue';
import TagOverviewCard from '@/components/TagOverviewCard.vue';
import TechnologyList from '@/components/TechnologyList.vue';
import NdefRecords from '@/components/NdefRecords.vue';
import TagCapabilities from '@/components/TagCapabilities.vue';
import UidStabilityTest from '@/components/UidStabilityTest.vue';
import RawDiagnostics from '@/components/RawDiagnostics.vue';

const router = useRouter();

const {
  deviceStatus,
  isScanning,
  lastTag,
  scanError,
  isLoading,
  scannerState,
  refreshStatus,
  startScan,
  stopScan,
  openSettings,
  resetLastTag
} = useNfc();

const matchedStudent = ref<Student | null>(null);
const isSearchingStudent = ref(false);
const showAdvancedDiagnostics = ref(false);

onMounted(async () => {
  await refreshStatus();
});

onIonViewWillEnter(async () => {
  await refreshStatus();
});

onIonViewDidLeave(async () => {
  await stopScan();
});

async function handleScanTrigger() {
  matchedStudent.value = null;
  await startScan();
}

// Watch for incoming tag and search student repository
async function onTagDiscovered() {
  if (!lastTag.value?.id) {
    matchedStudent.value = null;
    return;
  }

  isSearchingStudent.value = true;
  try {
    const student = await studentService.findStudentByRfid(lastTag.value.id);
    matchedStudent.value = student;
  } catch (e) {
    console.error('Error finding student by RFID:', e);
    matchedStudent.value = null;
  } finally {
    isSearchingStudent.value = false;
  }
}

watch(lastTag, () => {
  onTagDiscovered();
});

function handleViewMatchedStudent() {
  if (matchedStudent.value) {
    router.push(`/students/${matchedStudent.value.id}`);
  }
}

function handleRegisterWithCard() {
  if (lastTag.value?.id) {
    router.push({
      path: '/register-student',
      query: { rfid: lastTag.value.id }
    });
  }
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="RFID Scanner"
      subtitle="Tap card to identify or register student"
      :back-button="true"
      default-back-href="/settings"
    />

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Device Readiness Status -->
        <NfcStatusCard :status="deviceStatus" :is-loading="isLoading" />

        <!-- Main Scanner Interactive Card -->
        <NfcScannerCard 
          :status="deviceStatus"
          :state="scannerState"
          :is-scanning="isScanning"
          :detected-tag="lastTag"
          :error="scanError"
          @start-scan="handleScanTrigger"
          @stop-scan="stopScan"
          @open-settings="openSettings"
          @reset-scan="resetLastTag"
        />

        <!-- Student Identification Result Section -->
        <div v-if="lastTag" class="scan-result-section">
          <!-- Case A: Student FOUND -->
          <div v-if="matchedStudent" class="glass-card result-student-card">
            <div class="card-status-header status-found">
              <ion-icon :icon="checkmarkCircle" />
              <span>✓ Student Found</span>
            </div>

            <div class="student-match-info">
              <h3 class="student-match-name">
                {{ formatFullName(matchedStudent.firstName, matchedStudent.middleName, matchedStudent.lastName) }}
              </h3>
              <p class="student-match-academic">
                {{ formatStudentAcademicSummary(matchedStudent) }}
              </p>

              <div class="rfid-tag-pill font-mono">
                <ion-icon :icon="radioOutline" />
                <span>{{ matchedStudent.rfidUid }}</span>
              </div>
            </div>

            <div class="card-action-row">
              <UniButton 
                variant="primary" 
                :full-width="true" 
                class="view-student-btn"
                @click="handleViewMatchedStudent"
              >
                <ion-icon :icon="personOutline" class="btn-icon" />
                <span>View Student Profile</span>
                <ion-icon :icon="chevronForwardOutline" class="btn-icon" />
              </UniButton>
            </div>
          </div>

          <!-- Case B: Unknown RFID Card -->
          <div v-else class="glass-card result-unknown-card">
            <div class="card-status-header status-unknown">
              <ion-icon :icon="alertCircle" />
              <span>Unknown RFID Card</span>
            </div>

            <div class="unknown-info">
              <div class="unknown-uid font-mono">{{ lastTag.id }}</div>
              <p class="unknown-desc">
                This RFID card is not registered to any student in the system.
              </p>
            </div>

            <div class="card-action-row">
              <UniButton 
                variant="primary" 
                :full-width="true" 
                class="register-card-btn"
                @click="handleRegisterWithCard"
              >
                <ion-icon :icon="personAddOutline" class="btn-icon" />
                <span>Register Student With This Card</span>
              </UniButton>
            </div>
          </div>

          <!-- Advanced Diagnostics Toggle -->
          <div class="diagnostics-toggle-row">
            <button class="toggle-diag-btn" @click="showAdvancedDiagnostics = !showAdvancedDiagnostics">
              <ion-icon :icon="hardwareChipOutline" />
              <span>{{ showAdvancedDiagnostics ? 'Hide NFC Diagnostics' : 'Show NFC Card Diagnostics' }}</span>
            </button>
          </div>

          <!-- Advanced Diagnostics Cards (Optional Collapsible) -->
          <div v-if="showAdvancedDiagnostics" class="advanced-diagnostics-wrap">
            <TagOverviewCard :tag="lastTag" />
            <TechnologyList :technologies="lastTag.technologies" />
            <NdefRecords :records="lastTag.ndefRecords" :has-ndef="lastTag.hasNdef" />
            <TagCapabilities :tag="lastTag" />
            <UidStabilityTest />
            <RawDiagnostics :raw="lastTag.raw" />
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

.scan-result-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: fade-in-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes fade-in-up {
  0% {
    opacity: 0;
    transform: translateY(12px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

.result-student-card, .result-unknown-card {
  padding: 20px;
  background: var(--app-surface);
}

.card-status-header {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 8px;
  margin-bottom: 12px;
}

.status-found {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.status-unknown {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
}

.student-match-name {
  font-size: 1.35rem;
  font-weight: 800;
  color: var(--app-text-primary);
  margin: 0 0 4px 0;
}

.student-match-academic {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--app-text-secondary);
  margin: 0 0 12px 0;
}

.rfid-tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  font-weight: 700;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  padding: 6px 12px;
  border-radius: 8px;
  color: var(--app-text-primary);
  margin-bottom: 16px;
}

.unknown-uid {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--app-text-primary);
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  padding: 10px 14px;
  border-radius: 10px;
  margin-bottom: 8px;
}

.unknown-desc {
  font-size: 0.86rem;
  color: var(--app-text-secondary);
  line-height: 1.4;
  margin: 0 0 16px 0;
}

.view-student-btn, .register-card-btn {
  --border-radius: 14px;
  min-height: 48px;
  font-weight: 700;
}

.diagnostics-toggle-row {
  display: flex;
  justify-content: center;
  margin: 8px 0;
}

.toggle-diag-btn {
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  color: var(--app-text-secondary);
  padding: 8px 16px;
  border-radius: 9999px;
  font-size: 0.78rem;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.toggle-diag-btn:hover {
  color: var(--ion-color-primary);
}

.advanced-diagnostics-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}
</style>
