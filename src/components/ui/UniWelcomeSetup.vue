<script setup lang="ts">
import { ref, computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import {
  checkmarkCircleOutline,
  alertCircleOutline,
  refreshOutline,
  chevronDownOutline,
  chevronUpOutline,
  sparklesOutline,
} from 'ionicons/icons';
import UniButton from './UniButton.vue';

export type SetupStage =
  | 'WELCOME'
  | 'PREPARING'
  | 'HYDRATING'
  | 'FINALIZING'
  | 'COMPLETE'
  | 'ERROR';

export interface Props {
  stage?: SetupStage;
  heading?: string;
  message?: string;
  progressPercent?: number | null;
  isIndeterminate?: boolean;
  errorMessage?: string;
  errorDetails?: string;
  isRetryable?: boolean;
  showProceedButton?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  stage: 'WELCOME',
  heading: '',
  message: '',
  progressPercent: null,
  isIndeterminate: false,
  errorMessage: '',
  errorDetails: '',
  isRetryable: true,
  showProceedButton: false,
});

const emit = defineEmits<{
  (e: 'retry'): void;
  (e: 'proceed'): void;
}>();

const showDetails = ref(false);

const DEFAULT_MESSAGES: Record<SetupStage, { heading: string; message: string }> = {
  WELCOME: {
    heading: 'Welcome to UniTap.',
    message: 'A smarter way to stay connected with your campus.',
  },
  PREPARING: {
    heading: 'Making UniTap yours.',
    message: "We're preparing a workspace just for you.",
  },
  HYDRATING: {
    heading: 'Getting things ready.',
    message: 'Your important information is being prepared.',
  },
  FINALIZING: {
    heading: 'Bringing everything together.',
    message: "We're getting your experience ready.",
  },
  COMPLETE: {
    heading: "You're all set!",
    message: 'Welcome aboard. Your UniTap journey starts here.',
  },
  ERROR: {
    heading: 'Something needs your attention.',
    message: "Your setup couldn't be completed. You can safely try again.",
  },
};

const isConnectionError = computed(() => {
  const text = `${props.errorMessage} ${props.errorDetails}`.toLowerCase();
  return (
    text.includes('connection') ||
    text.includes('network') ||
    text.includes('fetch') ||
    text.includes('offline') ||
    text.includes('failed to fetch') ||
    text.includes('timeout')
  );
});

const currentHeading = computed(() => {
  if (props.heading) return props.heading;
  if (props.stage === 'ERROR' && isConnectionError.value) {
    return "We couldn't finish setting things up.";
  }
  return DEFAULT_MESSAGES[props.stage]?.heading || 'Setting up UniTap...';
});

const currentMessage = computed(() => {
  if (props.message) return props.message;
  if (props.stage === 'ERROR') {
    if (isConnectionError.value) {
      return 'Please check your connection and try again.';
    }
    return "Your setup couldn't be completed. You can safely try again.";
  }
  return DEFAULT_MESSAGES[props.stage]?.message || 'Please hold on while we prepare your workspace.';
});

const isBusy = computed(() => {
  return ['WELCOME', 'PREPARING', 'HYDRATING', 'FINALIZING'].includes(props.stage);
});

const fillStyle = computed(() => {
  if (props.isIndeterminate || props.progressPercent === null || props.progressPercent === undefined) {
    return {};
  }
  const clamped = Math.min(Math.max(props.progressPercent, 0), 100);
  return { width: `${clamped}%` };
});

function toggleDetails() {
  showDetails.value = !showDetails.value;
}
</script>

<template>
  <div
    class="uni-welcome-setup"
    role="status"
    aria-live="polite"
    :class="[`stage-${stage.toLowerCase()}`]"
  >
    <!-- Background Ambient Aura -->
    <div class="welcome-ambient-bg" aria-hidden="true">
      <div class="ambient-glow glow-1"></div>
      <div class="ambient-glow glow-2"></div>
    </div>

    <div class="welcome-container">
      <!-- Minimalist Brand Emblem -->
      <div class="welcome-brand-mark" aria-hidden="true">
        <div v-if="stage === 'COMPLETE'" class="mark-icon-wrap complete">
          <ion-icon :icon="checkmarkCircleOutline" class="mark-icon" />
        </div>
        <div v-else-if="stage === 'ERROR'" class="mark-icon-wrap error">
          <ion-icon :icon="alertCircleOutline" class="mark-icon" />
        </div>
        <div v-else class="mark-icon-wrap active">
          <div class="pulse-ring"></div>
          <ion-icon :icon="sparklesOutline" class="mark-icon" />
        </div>
      </div>

      <!-- Heading & Supporting Message with Smooth Crossfade -->
      <Transition name="welcome-fade" mode="out-in">
        <div :key="currentHeading + currentMessage" class="welcome-text-group">
          <h1 class="welcome-heading">{{ currentHeading }}</h1>
          <p class="welcome-message">{{ currentMessage }}</p>
        </div>
      </Transition>

      <!-- Progress Section for Active Setup Stages -->
      <div v-if="isBusy" class="welcome-progress-section" aria-hidden="true">
        <div
          class="welcome-progress-track"
          :class="{ indeterminate: isIndeterminate || progressPercent === null }"
        >
          <div
            v-if="!isIndeterminate && progressPercent !== null"
            class="welcome-progress-fill"
            :style="fillStyle"
          ></div>
          <div v-else class="welcome-progress-flow"></div>
        </div>
      </div>

      <!-- Success Action -->
      <div v-if="stage === 'COMPLETE' && showProceedButton" class="welcome-action-section">
        <UniButton
          variant="primary"
          size="lg"
          class="btn-welcome-cta"
          @click="emit('proceed')"
        >
          Get Started
        </UniButton>
      </div>

      <!-- Failure Actions & Expandable Details -->
      <div v-if="stage === 'ERROR'" class="welcome-error-section">
        <div class="error-actions-row">
          <UniButton
            v-if="isRetryable"
            variant="primary"
            size="md"
            class="btn-retry"
            @click="emit('retry')"
          >
            <ion-icon :icon="refreshOutline" slot="start" />
            Try Again
          </UniButton>

          <button
            v-if="errorDetails || errorMessage"
            type="button"
            class="btn-toggle-details"
            :aria-expanded="showDetails"
            @click="toggleDetails"
          >
            <span>{{ showDetails ? 'Hide Details' : 'View Details' }}</span>
            <ion-icon :icon="showDetails ? chevronUpOutline : chevronDownOutline" />
          </button>
        </div>

        <!-- Safe Sanitized Technical Diagnostics Drawer -->
        <Transition name="details-expand">
          <div v-if="showDetails" class="error-details-box" role="region" aria-label="Error details">
            <p v-if="errorMessage" class="error-detail-msg font-mono">{{ errorMessage }}</p>
            <p v-if="errorDetails" class="error-detail-sub font-mono">{{ errorDetails }}</p>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.uni-welcome-setup {
  position: relative;
  width: 100%;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--uni-background, #F8FAFC);
  color: var(--uni-text, #0F172A);
  overflow: hidden;
  box-sizing: border-box;
  padding: 24px;
}

/* Ambient Subtle Lighting */
.welcome-ambient-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}

.ambient-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.45;
  transition: opacity 0.4s ease;
}

.glow-1 {
  width: 380px;
  height: 380px;
  background: radial-gradient(circle, rgba(15, 118, 110, 0.22) 0%, rgba(15, 118, 110, 0) 70%);
  top: 15%;
  left: 50%;
  transform: translateX(-50%);
}

.glow-2 {
  width: 460px;
  height: 460px;
  background: radial-gradient(circle, rgba(94, 234, 212, 0.16) 0%, rgba(94, 234, 212, 0) 70%);
  bottom: 10%;
  left: 50%;
  transform: translateX(-50%);
}

:root.dark .glow-1,
:root.ion-palette-dark .glow-1,
body.dark .glow-1,
body.ion-palette-dark .glow-1 {
  background: radial-gradient(circle, rgba(94, 234, 212, 0.18) 0%, rgba(94, 234, 212, 0) 70%);
}

:root.dark .glow-2,
:root.ion-palette-dark .glow-2,
body.dark .glow-2,
body.ion-palette-dark .glow-2 {
  background: radial-gradient(circle, rgba(15, 118, 110, 0.24) 0%, rgba(15, 118, 110, 0) 70%);
}

/* Central Content Container */
.welcome-container {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 32px 16px;
}

/* Brand Emblem & Status Mark */
.welcome-brand-mark {
  margin-bottom: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mark-icon-wrap {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--uni-surface, #FFFFFF);
  border: 1px solid var(--uni-border, #E2E8F0);
  box-shadow: 0 10px 25px -5px rgba(15, 118, 110, 0.12);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.mark-icon-wrap.active {
  border-color: rgba(15, 118, 110, 0.3);
}

.mark-icon-wrap.complete {
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(16, 185, 129, 0.08);
}

.mark-icon-wrap.complete .mark-icon {
  color: var(--uni-success, #059669);
}

.mark-icon-wrap.error {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.08);
}

.mark-icon-wrap.error .mark-icon {
  color: var(--uni-danger, #DC2626);
}

.mark-icon {
  font-size: 34px;
  color: var(--uni-primary, #0F766E);
}

/* Soft Breathing Pulse Ring for Active States */
.pulse-ring {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 2px solid var(--uni-primary, #0F766E);
  opacity: 0.35;
  animation: breathingPulse 2.8s ease-in-out infinite;
}

@keyframes breathingPulse {
  0%, 100% {
    transform: scale(0.96);
    opacity: 0.2;
  }
  50% {
    transform: scale(1.08);
    opacity: 0.5;
  }
}

/* Typography Group */
.welcome-text-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  margin-bottom: 36px;
}

.welcome-heading {
  font-size: clamp(24px, 5.5vw, 32px);
  font-weight: 800;
  color: var(--uni-text, #0F172A);
  margin: 0;
  letter-spacing: -0.025em;
  line-height: 1.25;
}

.welcome-message {
  font-size: clamp(14.5px, 3.8vw, 17px);
  font-weight: 450;
  color: var(--uni-text-secondary, #64748B);
  margin: 0;
  max-width: 440px;
  line-height: 1.55;
}

/* Progress Track & Shimmer Flow */
.welcome-progress-section {
  width: 100%;
  max-width: 260px;
  margin: 0 auto;
}

.welcome-progress-track {
  position: relative;
  width: 100%;
  height: 4px;
  background: var(--uni-surface-secondary, rgba(226, 232, 240, 0.8));
  border-radius: 9999px;
  overflow: hidden;
}

.welcome-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--uni-primary, #0F766E), #2DD4BF);
  border-radius: 9999px;
  transition: width 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.welcome-progress-track.indeterminate .welcome-progress-flow {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 45%;
  background: linear-gradient(90deg, transparent 0%, var(--uni-primary, #0F766E) 50%, #5EEAD4 100%);
  border-radius: 9999px;
  animation: indeterminateSlide 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes indeterminateSlide {
  0% {
    left: -45%;
    width: 30%;
  }
  50% {
    width: 50%;
  }
  100% {
    left: 100%;
    width: 30%;
  }
}

/* Action Section */
.welcome-action-section {
  margin-top: 12px;
  width: 100%;
  max-width: 260px;
}

.btn-welcome-cta {
  width: 100%;
}

/* Error Section */
.welcome-error-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  margin-top: 8px;
}

.error-actions-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  justify-content: center;
}

.btn-retry {
  min-width: 130px;
}

.btn-toggle-details {
  background: transparent;
  border: none;
  color: var(--uni-text-secondary, #64748B);
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: 8px;
  transition: color 0.16s ease, background 0.16s ease;
}

.btn-toggle-details:hover {
  color: var(--uni-text, #0F172A);
  background: var(--uni-surface-secondary, rgba(0, 0, 0, 0.04));
}

.error-details-box {
  width: 100%;
  max-width: 440px;
  background: var(--uni-surface-secondary, #F1F5F9);
  border: 1px solid var(--uni-border, #E2E8F0);
  border-radius: var(--uni-radius-card, 12px);
  padding: 14px 16px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 6px;
  word-break: break-word;
}

.error-detail-msg {
  font-size: 12px;
  color: var(--uni-danger, #DC2626);
  margin: 0;
  font-weight: 600;
}

.error-detail-sub {
  font-size: 11.5px;
  color: var(--uni-text-secondary, #64748B);
  margin: 0;
}

/* Transitions */
.welcome-fade-enter-active,
.welcome-fade-leave-active {
  transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.welcome-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.welcome-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.details-expand-enter-active,
.details-expand-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.details-expand-enter-from,
.details-expand-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* Dark Mode Overrides */
:root.dark .uni-welcome-setup,
:root.ion-palette-dark .uni-welcome-setup,
body.dark .uni-welcome-setup,
body.ion-palette-dark .uni-welcome-setup {
  background: var(--uni-background, #0F1117);
  color: var(--uni-text, #F8FAFC);
}

:root.dark .mark-icon-wrap,
:root.ion-palette-dark .mark-icon-wrap,
body.dark .mark-icon-wrap,
body.ion-palette-dark .mark-icon-wrap {
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
  box-shadow: 0 14px 35px -5px rgba(0, 0, 0, 0.5);
}

:root.dark .mark-icon,
:root.ion-palette-dark .mark-icon,
body.dark .mark-icon,
body.ion-palette-dark .mark-icon {
  color: var(--uni-primary, #5EEAD4);
}

:root.dark .pulse-ring,
:root.ion-palette-dark .pulse-ring,
body.dark .pulse-ring,
body.ion-palette-dark .pulse-ring {
  border-color: var(--uni-primary, #5EEAD4);
}

:root.dark .welcome-heading,
:root.ion-palette-dark .welcome-heading,
body.dark .welcome-heading,
body.ion-palette-dark .welcome-heading {
  color: var(--uni-text, #F8FAFC);
}

:root.dark .welcome-message,
:root.ion-palette-dark .welcome-message,
body.dark .welcome-message,
body.ion-palette-dark .welcome-message {
  color: var(--uni-text-secondary, #9CA3AF);
}

:root.dark .welcome-progress-track,
:root.ion-palette-dark .welcome-progress-track,
body.dark .welcome-progress-track,
body.ion-palette-dark .welcome-progress-track {
  background: var(--uni-surface-secondary, #252830);
}

:root.dark .error-details-box,
:root.ion-palette-dark .error-details-box,
body.dark .error-details-box,
body.ion-palette-dark .error-details-box {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #30343D);
}

:root.dark .btn-toggle-details:hover,
:root.ion-palette-dark .btn-toggle-details:hover,
body.dark .btn-toggle-details:hover,
body.ion-palette-dark .btn-toggle-details:hover {
  color: var(--uni-text, #F8FAFC);
  background: var(--uni-surface-secondary, rgba(255, 255, 255, 0.06));
}

/* Reduced Motion Mode */
@media (prefers-reduced-motion: reduce) {
  .pulse-ring {
    animation: none;
    opacity: 0.3;
  }
  .welcome-progress-track.indeterminate .welcome-progress-flow {
    animation: none;
    width: 100%;
    opacity: 0.6;
  }
  .welcome-fade-enter-active,
  .welcome-fade-leave-active,
  .details-expand-enter-active,
  .details-expand-leave-active,
  .welcome-progress-fill {
    transition: none !important;
  }
}
</style>

