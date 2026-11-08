<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  IonSpinner,
  onIonViewWillEnter,
} from '@ionic/vue';
import {
  cardOutline,
  flashOutline,
  checkmarkCircle,
  copyOutline,
  hardwareChipOutline,
  shieldCheckmarkOutline,
  settingsOutline,
  alertCircleOutline,
  refreshOutline,
} from 'ionicons/icons';
import { useCurrentStudentPortal } from '@/composables/useCurrentStudentPortal';
import { formatYearLevel } from '@/utilities/student-formatters';
import { useToast } from '@/composables/useToast';
import { haptics } from '@/utilities/haptics';
import { UniPageHeader, UniButton } from '@/components/ui';

const router = useRouter();
const { showToast, copyToClipboard } = useToast();
const {
  student,
  studentName,
  academicSummary,
  isLoading,
  loadPortalData,
} = useCurrentStudentPortal();

const passImgError = ref(false);

const initials = computed(() => {
  if (!student.value) return 'ST';
  const f = student.value.firstName?.[0] || '';
  const l = student.value.lastName?.[0] || '';
  return (f + l).toUpperCase() || 'ST';
});

function handleCopy(text: string, label: string) {
  haptics.light();
  copyToClipboard(text, label);
}

onMounted(() => {
  loadPortalData();
});

onIonViewWillEnter(() => {
  loadPortalData();
});
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Digital Pass"
      subtitle="UniTap Smart NFC &amp; Optical Student ID"
      variant="root"
    >
      <template #trailing>
        <button
          class="uni-header-action-btn"
          aria-label="Settings"
          @click="router.push('/settings')"
        >
          <ion-icon :icon="settingsOutline" />
        </button>
      </template>
    </UniPageHeader>

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- 1. SMART NFC PASS CARD (AUTHENTIC CAMPUS ID) -->
        <section class="pass-card-section">
          <div class="smart-pass-container">
            <div class="smart-pass-card">
              <!-- Holographic / Aurora Glow overlay -->
              <div class="pass-glow-overlay"></div>

              <!-- Top institution branding -->
              <div class="pass-header-row">
                <div class="institution-branding">
                  <span class="inst-name font-mono">MABALACAT CITY COLLEGE</span>
                  <span class="dept-name">College of Computing Studies • CSG</span>
                </div>
                <div class="pass-type-badge font-mono">
                  <span>STUDENT</span>
                </div>
              </div>

              <!-- Mid Card: Avatar + Details -->
              <div class="pass-body-row">
                <div class="pass-avatar-box">
                  <img
                    v-if="(student?.photoUrl || student?.photoLocalUri) && !passImgError"
                    :src="(student?.photoUrl || student?.photoLocalUri) || undefined"
                    alt="Student Photo"
                    class="pass-photo-img"
                    @error="passImgError = true"
                  />
                  <span v-else class="avatar-initials">{{ initials }}</span>
                  <div class="avatar-status-dot" :class="{ 'is-active': student?.rfidUid }"></div>
                </div>

                <div class="pass-student-details">
                  <span class="pass-label font-mono">STUDENT NAME</span>
                  <h3 class="pass-name">{{ studentName }}</h3>

                  <span class="pass-label font-mono">STUDENT ID NUMBER</span>
                  <span class="pass-id-number font-mono">{{ student?.studentNumber || 'MCC STUDENT' }}</span>

                  <span class="pass-label font-mono">PROGRAM &amp; LEVEL</span>
                  <span class="pass-program-text">
                    {{ student?.course || 'BSIT' }} • {{ formatYearLevel(student?.yearLevel) }}
                  </span>
                  <span v-if="student?.section" class="pass-section-text">
                    Section {{ student.section }}
                  </span>
                </div>
              </div>

              <!-- Smart Chip & NFC Status -->
              <div class="pass-chip-row">
                <div class="smart-chip-sim">
                  <div class="chip-line horizontal"></div>
                  <div class="chip-line vertical"></div>
                </div>

                <div class="nfc-live-status">
                  <div class="nfc-pulse-indicator" :class="{ 'is-active': student?.rfidUid }">
                    <ion-icon :icon="student?.rfidUid ? flashOutline : alertCircleOutline" />
                  </div>
                  <div class="nfc-status-texts">
                    <span class="nfc-state font-semibold">
                      {{ student?.rfidUid ? 'NFC Pass Linked & Active' : 'No NFC Card Linked' }}
                    </span>
                    <span class="nfc-sub font-mono">
                      {{ student?.rfidUid ? `UID: ${student.rfidUid}` : 'Tap with officer to pair' }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Bottom Barcode & Term Stamp -->
              <div class="pass-footer-row">
                <div class="barcode-container" @click="student?.studentNumber && handleCopy(student.studentNumber, 'Student ID')">
                  <div class="simulated-barcode">
                    <div class="bar-col w-2"></div>
                    <div class="bar-col w-1"></div>
                    <div class="bar-col w-3"></div>
                    <div class="bar-col w-1"></div>
                    <div class="bar-col w-2"></div>
                    <div class="bar-col w-1"></div>
                    <div class="bar-col w-4"></div>
                    <div class="bar-col w-2"></div>
                    <div class="bar-col w-1"></div>
                    <div class="bar-col w-3"></div>
                    <div class="bar-col w-1"></div>
                    <div class="bar-col w-2"></div>
                    <div class="bar-col w-3"></div>
                    <div class="bar-col w-1"></div>
                    <div class="bar-col w-2"></div>
                  </div>
                  <span class="barcode-number font-mono">{{ student?.studentNumber }}</span>
                </div>

                <div class="validity-stamp">
                  <span class="term-lbl font-mono">1ST SEM 2026–2027</span>
                  <span class="status-lbl font-mono">AUTHENTICATED</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 2. QUICK ACTIONS & GUIDANCE -->
        <section class="section-block">
          <div class="section-heading">
            <span>Pass Management &amp; Actions</span>
          </div>

          <div class="minimal-card pass-guidance-card">
            <div class="guidance-item" v-if="student?.studentNumber">
              <div class="guide-icon-wrap text-mint">
                <ion-icon :icon="copyOutline" />
              </div>
              <div class="guide-text">
                <span class="guide-title">Copy School ID</span>
                <span class="guide-sub font-mono">{{ student.studentNumber }}</span>
              </div>
              <UniButton size="sm" variant="secondary" @click="handleCopy(student.studentNumber, 'Student ID')">
                Copy
              </UniButton>
            </div>

            <div class="guidance-divider" v-if="student?.rfidUid"></div>

            <div class="guidance-item" v-if="student?.rfidUid">
              <div class="guide-icon-wrap text-sky">
                <ion-icon :icon="flashOutline" />
              </div>
              <div class="guide-text">
                <span class="guide-title">Copy RFID UID</span>
                <span class="guide-sub font-mono">{{ student.rfidUid }}</span>
              </div>
              <UniButton size="sm" variant="secondary" @click="handleCopy(student.rfidUid, 'RFID UID')">
                Copy
              </UniButton>
            </div>

            <div class="guidance-divider"></div>

            <div class="guidance-item" @click="router.push('/diagnostics/device')">
              <div class="guide-icon-wrap text-violet">
                <ion-icon :icon="hardwareChipOutline" />
              </div>
              <div class="guide-text">
                <span class="guide-title">NFC Hardware Diagnostics</span>
                <span class="guide-sub">Check phone NFC sensor &amp; antenna</span>
              </div>
              <UniButton size="sm" variant="secondary">
                Inspect
              </UniButton>
            </div>
          </div>
        </section>

        <!-- 3. HOW TO USE INSTRUCTIONS -->
        <section class="section-block">
          <div class="section-heading">
            <span>Attendance Instructions</span>
          </div>

          <div class="minimal-card instructions-card">
            <div class="instruction-step">
              <span class="step-num font-mono">01</span>
              <div class="step-content">
                <span class="step-title">Physical NFC Pass Tapping</span>
                <span class="step-desc">
                  Tap your registered physical NFC card against an officer's phone reader during events to register your check-in instantly.
                </span>
              </div>
            </div>

            <div class="step-divider"></div>

            <div class="instruction-step">
              <span class="step-num font-mono">02</span>
              <div class="step-content">
                <span class="step-title">Backup Optical Barcode</span>
                <span class="step-desc">
                  If you forgot your physical card, show this digital pass screen to an officer to look up your student record and confirm attendance.
                </span>
              </div>
            </div>

            <div class="step-divider"></div>

            <div class="instruction-step">
              <span class="step-num font-mono">03</span>
              <div class="step-content">
                <span class="step-title">Card Replacement</span>
                <span class="step-desc">
                  Lost your card? Approach a CSG officer to deactivate your old card and bind a new NFC card in seconds.
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.page-container {
  padding: 16px 20px 48px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 600px;
  margin: 0 auto;
}

/* SMART PASS CARD PRESENTATION */
.pass-card-section {
  display: flex;
  justify-content: center;
}

.smart-pass-container {
  width: 100%;
}

.smart-pass-card {
  position: relative;
  border-radius: 22px;
  padding: 22px;
  background: linear-gradient(135deg, #0d1f1b 0%, #132822 45%, #182228 100%);
  border: 1px solid rgba(112, 243, 207, 0.3);
  box-shadow: 0 16px 36px -12px rgba(0, 0, 0, 0.6), 0 0 24px -6px rgba(112, 243, 207, 0.2);
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: hidden;
}

.pass-glow-overlay {
  position: absolute;
  top: -40px;
  right: -40px;
  width: 160px;
  height: 160px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(112, 243, 207, 0.2) 0%, transparent 70%);
  pointer-events: none;
}

.pass-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.institution-branding {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.inst-name {
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--app-text-primary, #f5f6f7);
}

.dept-name {
  font-size: 10px;
  color: var(--aurora-mint, #70f3cf);
  font-weight: 600;
}

.pass-type-badge {
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  padding: 3px 8px;
  border-radius: 20px;
  background: rgba(14, 165, 233, 0.16);
  color: #38bdf8;
  border: 1px solid rgba(14, 165, 233, 0.35);
}

.pass-body-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.pass-avatar-box {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(112, 243, 207, 0.2) 0%, rgba(14, 165, 233, 0.2) 100%);
  border: 2px solid rgba(112, 243, 207, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}

.pass-photo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-initials {
  font-size: 24px;
  font-weight: 800;
  color: var(--aurora-mint, #70f3cf);
}

.avatar-status-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #64748b;
  border: 2px solid #132822;
}

.avatar-status-dot.is-active {
  background: var(--aurora-mint, #70f3cf);
  box-shadow: 0 0 8px var(--aurora-mint, #70f3cf);
}

.pass-student-details {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.pass-label {
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 4px;
}

.pass-label:first-child {
  margin-top: 0;
}

.pass-name {
  font-size: 16.5px;
  font-weight: 800;
  color: var(--app-text-primary, #f5f6f7);
  margin: 0;
  line-height: 1.2;
}

.pass-id-number {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--aurora-mint, #70f3cf);
}

.pass-program-text {
  font-size: 11px;
  font-weight: 600;
  color: var(--app-text-primary, #f5f6f7);
}

.pass-section-text {
  font-size: 10.5px;
  color: var(--app-text-secondary, #949ba6);
}

/* Simulated Smart Chip */
.pass-chip-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.smart-chip-sim {
  width: 38px;
  height: 28px;
  border-radius: 6px;
  background: linear-gradient(135deg, #d4af37 0%, #aa820a 100%);
  border: 1px solid rgba(255, 255, 255, 0.2);
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
}

.chip-line.horizontal {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: rgba(0, 0, 0, 0.35);
}

.chip-line.vertical {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(0, 0, 0, 0.35);
}

.nfc-live-status {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.nfc-pulse-indicator {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--app-text-secondary, #949ba6);
}

.nfc-pulse-indicator.is-active {
  background: rgba(112, 243, 207, 0.15);
  color: var(--aurora-mint, #70f3cf);
}

.nfc-status-texts {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.nfc-state {
  font-size: 12px;
  color: var(--app-text-primary, #f5f6f7);
}

.nfc-sub {
  font-size: 10.5px;
  color: var(--app-text-secondary, #949ba6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Footer: Barcode & Validity */
.pass-footer-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.barcode-container {
  display: flex;
  flex-direction: column;
  gap: 3px;
  cursor: pointer;
}

.simulated-barcode {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding: 2px 4px;
  background: #ffffff;
  border-radius: 4px;
}

.bar-col {
  background: #000000;
  height: 100%;
}

.w-1 { width: 1.5px; }
.w-2 { width: 3px; }
.w-3 { width: 4.5px; }
.w-4 { width: 6px; }

.barcode-number {
  font-size: 10px;
  font-weight: 700;
  color: var(--app-text-primary, #f5f6f7);
  letter-spacing: 0.05em;
}

.validity-stamp {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.term-lbl {
  font-size: 9.5px;
  font-weight: 700;
  color: var(--aurora-mint, #70f3cf);
}

.status-lbl {
  font-size: 8.5px;
  color: var(--app-text-secondary, #949ba6);
}

/* Section Blocks */
.section-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-heading {
  font-size: 14px;
  font-weight: 700;
  color: var(--app-text-primary, #f5f6f7);
  padding: 0 2px;
}

.minimal-card {
  background: var(--uni-surface, #1b1d22);
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.07));
  border-radius: 16px;
}

/* Guidance Card */
.pass-guidance-card {
  padding: 6px 16px;
}

.guidance-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  cursor: pointer;
}

.guidance-divider {
  border-top: 1px solid var(--uni-border, rgba(255, 255, 255, 0.05));
}

.guide-icon-wrap {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  background: rgba(255, 255, 255, 0.05);
  flex-shrink: 0;
}

.text-mint { color: var(--aurora-mint, #70f3cf); }
.text-sky { color: #38bdf8; }
.text-violet { color: var(--aurora-iris, #8b85f6); }

.guide-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.guide-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--app-text-primary, #f5f6f7);
}

.guide-sub {
  font-size: 11px;
  color: var(--app-text-secondary, #949ba6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Instructions Card */
.instructions-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.instruction-step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.step-num {
  font-size: 12px;
  font-weight: 800;
  color: var(--aurora-mint, #70f3cf);
  padding: 3px 6px;
  border-radius: 6px;
  background: rgba(112, 243, 207, 0.12);
  flex-shrink: 0;
}

.step-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.step-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--app-text-primary, #f5f6f7);
}

.step-desc {
  font-size: 11.5px;
  color: var(--app-text-secondary, #949ba6);
  line-height: 1.4;
}

.step-divider {
  border-top: 1px solid var(--uni-border, rgba(255, 255, 255, 0.05));
}
</style>

