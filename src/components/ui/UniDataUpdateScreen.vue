<script setup lang="ts">
import { computed } from 'vue';
import {
  refreshOutline,
  cloudOfflineOutline,
  checkmarkCircle,
  alertCircle,
} from 'ionicons/icons';
import { IonIcon } from '@ionic/vue';
import UniButton from './UniButton.vue';

export type UpdateStage = 'PREPARING' | 'UPDATING' | 'FINALIZING' | 'COMPLETE' | 'FAILED';

interface Props {
  stage?: UpdateStage;
  progressPercent?: number;
  errorMessage?: string;
  allowContinueOffline?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  stage: 'UPDATING',
  progressPercent: 0,
  errorMessage: '',
  allowContinueOffline: false,
});

const emit = defineEmits<{
  (e: 'retry'): void;
  (e: 'continue-offline'): void;
  (e: 'complete'): void;
}>();

const stageContent = computed(() => {
  switch (props.stage) {
    case 'PREPARING':
      return {
        title: 'Updating your data',
        subtitle: 'Making sure your information is current.',
      };
    case 'UPDATING':
      return {
        title: 'Getting everything ready',
        subtitle: 'Your latest records are being prepared.',
      };
    case 'FINALIZING':
      return {
        title: 'Almost ready',
        subtitle: 'Finishing a few things before you continue.',
      };
    case 'COMPLETE':
      return {
        title: "You're up to date",
        subtitle: 'Everything needed is ready.',
      };
    case 'FAILED':
      return {
        title: "We couldn't update your information",
        subtitle: props.errorMessage || 'Check your connection and try again.',
      };
    default:
      return {
        title: 'Updating your data',
        subtitle: 'Making sure your information is current.',
      };
  }
});
</script>

<template>
  <div class="update-screen-backdrop" role="region" aria-label="Returning User Data Update">
    <div class="update-screen-card">
      <!-- UniTap Brand Mark -->
      <div class="brand-badge-wrap">
        <span class="brand-name">UniTap</span>
      </div>

      <!-- Icon / Status Visualizer -->
      <div class="status-visualizer" :class="`is-${stage.toLowerCase()}`">
        <div v-if="stage === 'COMPLETE'" class="complete-icon-box">
          <ion-icon :icon="checkmarkCircle" class="icon-complete" />
        </div>
        <div v-else-if="stage === 'FAILED'" class="failed-icon-box">
          <ion-icon :icon="alertCircle" class="icon-failed" />
        </div>
        <div v-else class="pulse-loader-box">
          <div class="pulse-ring"></div>
          <div class="pulse-core"></div>
        </div>
      </div>

      <!-- Stage Copy -->
      <div class="update-copy-block">
        <h1 class="update-headline">{{ stageContent.title }}</h1>
        <p class="update-description">{{ stageContent.subtitle }}</p>
      </div>

      <!-- Genuine Progress Indicator (when not complete or failed) -->
      <div v-if="stage !== 'COMPLETE' && stage !== 'FAILED'" class="progress-bar-wrap">
        <div
          class="progress-bar-fill"
          :style="{ width: `${Math.min(100, Math.max(8, progressPercent))}%` }"
        ></div>
      </div>

      <!-- Action Buttons on Error / Manual Intervention -->
      <div v-if="stage === 'FAILED'" class="action-buttons-wrap">
        <UniButton
          variant="primary"
          size="md"
          :icon="refreshOutline"
          class="btn-action"
          @click="emit('retry')"
        >
          Try Again
        </UniButton>

        <UniButton
          v-if="allowContinueOffline"
          variant="outline"
          size="md"
          :icon="cloudOfflineOutline"
          class="btn-action"
          @click="emit('continue-offline')"
        >
          Continue Offline
        </UniButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.update-screen-backdrop {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  width: 100%;
  padding: 24px;
  background: var(--uni-background, #0F1117);
  box-sizing: border-box;
}

.update-screen-card {
  width: 100%;
  max-width: 420px;
  background: var(--uni-surface, #1B1D23);
  border: 1px solid var(--uni-border, #30343D);
  border-radius: var(--uni-radius-dialog, 24px);
  padding: 36px 28px;
  box-shadow: var(--uni-shadow-dialog, 0 20px 48px rgba(0, 0, 0, 0.45));
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 22px;
  box-sizing: border-box;
  animation: cardFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes cardFadeIn {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.brand-badge-wrap {
  display: inline-flex;
  align-items: center;
}

.brand-name {
  font-size: 15px;
  font-weight: 850;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--uni-primary, #5EEAD4);
}

/* Status Visualizer */
.status-visualizer {
  position: relative;
  width: 76px;
  height: 76px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pulse-loader-box {
  position: relative;
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pulse-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--uni-primary, #5EEAD4);
  opacity: 0.6;
  animation: ringPulse 2s cubic-bezier(0.25, 0.8, 0.25, 1) infinite;
}

.pulse-core {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--uni-primary, #5EEAD4);
  box-shadow: 0 0 18px var(--uni-primary, #5EEAD4);
}

@keyframes ringPulse {
  0% {
    transform: scale(0.8);
    opacity: 0.8;
  }
  70% {
    transform: scale(1.4);
    opacity: 0;
  }
  100% {
    transform: scale(1.4);
    opacity: 0;
  }
}

.complete-icon-box .icon-complete {
  font-size: 56px;
  color: var(--uni-success, #34D399);
  animation: popIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.failed-icon-box .icon-failed {
  font-size: 56px;
  color: var(--uni-danger, #F87171);
  animation: popIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes popIn {
  from {
    transform: scale(0.6);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

.update-copy-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.update-headline {
  font-size: 20px;
  font-weight: 750;
  color: var(--uni-text, #F8FAFC);
  margin: 0;
  letter-spacing: -0.015em;
  line-height: 1.25;
}

.update-description {
  font-size: 14px;
  color: var(--uni-text-secondary, #9CA3AF);
  margin: 0;
  line-height: 1.45;
  max-width: 320px;
}

.progress-bar-wrap {
  width: 100%;
  height: 6px;
  background: var(--uni-surface-secondary, #252830);
  border-radius: 999px;
  overflow: hidden;
  margin-top: 4px;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--uni-primary, #5EEAD4), var(--uni-btn-primary-bg, #0D9488));
  border-radius: 999px;
  transition: width 0.35s ease;
}

.action-buttons-wrap {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 6px;
}

.btn-action {
  width: 100%;
}
</style>

