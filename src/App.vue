<template>
  <ion-app>
    <ion-router-outlet />
    <OnboardingModal
      :is-open="isOnboardingOpen"
      @complete="closeOnboardingTour"
      @skip="closeOnboardingTour"
    />
    <UniToast
      :show="toastState.show"
      :message="toastState.message"
      :type="toastState.type"
    />
  </ion-app>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import OnboardingModal from '@/components/onboarding/OnboardingModal.vue';
import { UniToast } from '@/components/ui';
import { useOnboarding } from '@/composables/useOnboarding';
import { useToast } from '@/composables/useToast';
import { getDatabase } from '@/database/database';
import { LegacyMigrationService } from '@/services/legacy-migration.service';
import { authService } from '@/services/auth.service';
import { themeService } from '@/services/theme.service';
import { resetScrollPosition } from '@/utilities/scroll';

const { isOnboardingOpen, checkOnboardingStatus, closeOnboardingTour } = useOnboarding();
const { toastState } = useToast();

onMounted(async () => {
  try {
    await themeService.init();
    await getDatabase();
    await LegacyMigrationService.runMigrationIfNeeded();
    await authService.initSession();
  } catch (err) {
    console.error('Initialization error:', err);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('ionViewWillEnter', () => {
      resetScrollPosition();
    });
  }
  await checkOnboardingStatus();
});
</script>
