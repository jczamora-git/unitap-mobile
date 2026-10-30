<script setup lang="ts">
import { ref } from 'vue';
import { IonModal, IonIcon } from '@ionic/vue';
import { 
  arrowForwardOutline, 
  checkmarkCircleOutline, 
  radioOutline, 
  calendarOutline, 
  walletOutline,
  fingerPrintOutline
} from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';
import { onboardingService } from '@/services/onboarding.service';

interface Props {
  isOpen: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  (e: 'complete'): void;
  (e: 'skip'): void;
}>();

const currentStep = ref(0);

const slides = [
  {
    tag: 'STUDENT IDENTITY',
    title: 'Every connection starts with a tap.',
    description: 'Manage student identity, attendance, and CSG activities in one seamless experience.',
    theme: 'mint'
  },
  {
    tag: 'NFC ATTENDANCE',
    title: 'Attendance, made effortless.',
    description: 'Record participation instantly with an NFC tap and keep every event organized in real time.',
    theme: 'sky'
  },
  {
    tag: 'OPERATIONS & WALLET',
    title: 'Everything in one place.',
    description: 'Monitor events, manage obligations, and explore student activity with ease and confidence.',
    theme: 'violet'
  }
];

async function nextStep() {
  haptics.light();
  if (currentStep.value < slides.length - 1) {
    currentStep.value++;
  } else {
    await finish();
  }
}

async function finish() {
  await onboardingService.setCompletedOnboarding();
  haptics.success();
  emit('complete');
}

async function skip() {
  await onboardingService.setCompletedOnboarding();
  haptics.light();
  emit('skip');
}
</script>

<template>
  <ion-modal :is-open="isOpen" class="onboarding-full-modal" :backdrop-dismiss="false">
    <div class="onboarding-canvas">
      <!-- Top Bar with Skip -->
      <div class="onboarding-top-bar">
        <span class="brand-pill font-mono">UniTap</span>
        <button v-if="currentStep < slides.length - 1" class="skip-btn" @click="skip">
          Skip
        </button>
      </div>

      <!-- Slide Graphic Display -->
      <div class="visual-viewport">
        <!-- Slide 0: Identity -->
        <div v-if="currentStep === 0" class="graphic-box graphic-step-0 animate-fade-up">
          <div class="aurora-light-orb orb-mint"></div>
          <div class="nfc-card-mockup">
            <div class="card-chip-graphic"></div>
            <ion-icon :icon="fingerPrintOutline" class="chip-nfc-icon" />
            <div class="mockup-name-line"></div>
            <div class="mockup-num-line"></div>
          </div>
        </div>

        <!-- Slide 1: Smart Attendance -->
        <div v-else-if="currentStep === 1" class="graphic-box graphic-step-1 animate-fade-up">
          <div class="aurora-light-orb orb-sky"></div>
          <div class="scanner-surface-mockup">
            <div class="mockup-ring ring-outer"></div>
            <div class="mockup-ring ring-inner"></div>
            <div class="mockup-core">
              <ion-icon :icon="radioOutline" />
            </div>
          </div>
        </div>

        <!-- Slide 2: Connected Operations -->
        <div v-else class="graphic-box graphic-step-2 animate-fade-up">
          <div class="aurora-light-orb orb-violet"></div>
          <div class="cards-stack-mockup">
            <div class="stacked-card card-back">
              <ion-icon :icon="walletOutline" />
              <span>Simulated Wallet</span>
            </div>
            <div class="stacked-card card-front">
              <ion-icon :icon="calendarOutline" />
              <span>CSG Events & Roster</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Text & Navigation Content -->
      <div class="onboarding-bottom-content">
        <!-- Pagination Dots -->
        <div class="pagination-dots-row">
          <span 
            v-for="(s, idx) in slides" 
            :key="idx" 
            class="pagination-dot"
            :class="{ 'dot-active': idx === currentStep }"
          ></span>
        </div>

        <div class="text-block">
          <span class="slide-tag">{{ slides[currentStep].tag }}</span>
          <h2 class="slide-headline">{{ slides[currentStep].title }}</h2>
          <p class="slide-desc">{{ slides[currentStep].description }}</p>
        </div>

        <!-- CTA Action -->
        <div class="action-footer">
          <button 
            type="button" 
            class="btn-ui btn-ui-primary btn-ui-lg onboarding-cta-btn"
            @click="nextStep"
          >
            <span>{{ currentStep === slides.length - 1 ? 'Get Started' : 'Next' }}</span>
            <ion-icon :icon="currentStep === slides.length - 1 ? checkmarkCircleOutline : arrowForwardOutline" />
          </button>
        </div>
      </div>
    </div>
  </ion-modal>
</template>

<style scoped>
ion-modal.onboarding-full-modal {
  --background: var(--app-bg);
  --width: 100%;
  --height: 100%;
}

.onboarding-canvas {
  width: 100%;
  height: 100%;
  background: var(--app-bg);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: calc(16px + var(--ion-safe-area-top, 0px)) 24px calc(24px + var(--ion-safe-area-bottom, 0px)) 24px;
}

.onboarding-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand-pill {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--aurora-mint);
  padding: 4px 10px;
  background: rgba(112, 243, 207, 0.12);
  border: 1px solid rgba(112, 243, 207, 0.25);
  border-radius: 20px;
}

.skip-btn {
  background: transparent;
  border: none;
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text-secondary);
  cursor: pointer;
  padding: 6px 12px;
}

.visual-viewport {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  min-height: 240px;
}

.graphic-box {
  position: relative;
  width: 100%;
  height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.aurora-light-orb {
  position: absolute;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  filter: blur(50px);
  pointer-events: none;
}

.orb-mint { background: rgba(112, 243, 207, 0.3); }
.orb-sky { background: rgba(101, 191, 255, 0.3); }
.orb-violet { background: rgba(139, 133, 246, 0.3); }

/* Card Mockup Graphic */
.nfc-card-mockup {
  position: relative;
  width: 210px;
  height: 135px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(20, 26, 36, 0.95) 0%, rgba(32, 24, 42, 0.95) 100%);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-top: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.35);
  padding: 16px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transform: rotate(-4deg);
}

.card-chip-graphic {
  width: 28px;
  height: 22px;
  border-radius: 5px;
  background: linear-gradient(135deg, #FFB78F 0%, #D99522 100%);
}

.chip-nfc-icon {
  position: absolute;
  top: 16px;
  right: 16px;
  font-size: 24px;
  color: var(--aurora-mint);
}

.mockup-name-line {
  width: 90px;
  height: 7px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.4);
}

.mockup-num-line {
  width: 50px;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.2);
  margin-top: 4px;
}

/* Scanner Mockup Graphic */
.scanner-surface-mockup {
  position: relative;
  width: 140px;
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mockup-ring {
  position: absolute;
  border-radius: 50%;
  border: 1.5px solid rgba(101, 191, 255, 0.3);
}

.ring-outer { width: 140px; height: 140px; }
.ring-inner { width: 105px; height: 105px; border-color: rgba(112, 243, 207, 0.4); }

.mockup-core {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(112, 243, 207, 0.25) 0%, rgba(101, 191, 255, 0.2) 100%);
  border: 2px solid var(--aurora-mint);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--aurora-mint);
  font-size: 30px;
  box-shadow: 0 0 24px rgba(112, 243, 207, 0.5);
}

/* Stack Mockup Graphic */
.cards-stack-mockup {
  position: relative;
  width: 220px;
  height: 130px;
}

.stacked-card {
  position: absolute;
  width: 190px;
  height: 75px;
  border-radius: 14px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.3);
}

.card-back {
  top: 0;
  left: 0;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  color: var(--app-text-secondary);
  transform: rotate(-3deg);
}

.card-front {
  bottom: 0;
  right: 0;
  background: linear-gradient(135deg, rgba(25, 28, 42, 0.95) 0%, rgba(20, 32, 38, 0.95) 100%);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-top: 1px solid rgba(255, 255, 255, 0.35);
  color: #FFFFFF;
  transform: rotate(3deg);
}

.card-front ion-icon {
  color: var(--aurora-mint);
  font-size: 18px;
}

/* Content Area */
.onboarding-bottom-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.pagination-dots-row {
  display: flex;
  gap: 8px;
}

.pagination-dot {
  width: 8px;
  height: 8px;
  border-radius: 4px;
  background: var(--app-border);
  transition: all 0.25s ease;
}

.dot-active {
  width: 24px;
  background: var(--aurora-mint);
  box-shadow: 0 0 8px rgba(112, 243, 207, 0.4);
}

.slide-tag {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--aurora-mint);
  text-transform: uppercase;
  display: block;
  margin-bottom: 6px;
}

.slide-headline {
  font-size: 24px;
  font-weight: 750;
  letter-spacing: -0.025em;
  color: var(--app-text-primary);
  line-height: 1.2;
  margin: 0 0 8px 0;
}

.slide-desc {
  font-size: 14px;
  color: var(--app-text-secondary);
  line-height: 1.5;
  margin: 0;
}

.onboarding-cta-btn {
  width: 100%;
}
</style>
