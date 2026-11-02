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
import { useRouter } from 'vue-router';
import { IonApp, IonRouterOutlet, useBackButton } from '@ionic/vue';
import { App as CapApp } from '@capacitor/app';
import OnboardingModal from '@/components/onboarding/OnboardingModal.vue';
import { UniToast } from '@/components/ui';
import { useOnboarding } from '@/composables/useOnboarding';
import { useToast } from '@/composables/useToast';
import { getDatabase } from '@/database/database';
import { LegacyMigrationService } from '@/services/legacy-migration.service';
import { authService } from '@/services/auth.service';
import { themeService } from '@/services/theme.service';
import { resetScrollPosition } from '@/utilities/scroll';

const router = useRouter();
const { isOnboardingOpen, checkOnboardingStatus, closeOnboardingTour } = useOnboarding();
const { toastState, showToast } = useToast();

let lastBackPressTime = 0;

// Hardware back button handler with priority 10 (above Ionic default exit, below page/modal handlers)
useBackButton(10, async () => {
  // 1. If onboarding tour is open, dismiss it
  if (isOnboardingOpen.value) {
    closeOnboardingTour();
    return;
  }

  // 2. Check if an active modal or overlay is open in the DOM
  const activeOverlay = document.querySelector('ion-modal.show-modal, ion-alert, ion-action-sheet');
  if (activeOverlay) {
    // Overlays have their own higher-priority handlers, so do not navigate
    return;
  }

  const currentPath = router.currentRoute.value.path;
  const isRootRoute = currentPath === '/tabs/home' || currentPath === '/login';

  // 3. If currently on a root page (/tabs/home or /login), require double-tap back within 2s to exit
  if (isRootRoute) {
    const now = Date.now();
    if (now - lastBackPressTime < 2000) {
      try {
        await CapApp.exitApp();
      } catch {
        // Fallback for web dev environment
        window.history.back();
      }
    } else {
      lastBackPressTime = now;
      showToast('Press back again to exit', 'info', 2000);
    }
    return;
  }

  // 4. For all other pages, reverse the natural browser/router navigation history
  if (window.history.state?.back) {
    router.back();
    return;
  }

  // 5. If no remaining history in navigation stack, smoothly navigate to /tabs/home
  router.replace('/tabs/home');
});

onMounted(async () => {
  try {
    await themeService.init();
    await getDatabase();
    await LegacyMigrationService.runMigrationIfNeeded();
    await authService.initSession();

    const { SupabaseAuthService } = await import('@/integrations/supabase/auth.service');
    await SupabaseAuthService.initialize();

    const { NetworkService } = await import('@/services/network.service');
    await NetworkService.init();

    const currentUser = authService.user.value || SupabaseAuthService.user.value;
    if (currentUser) {
      const { SyncManager } = await import('@/services/sync/sync-manager');
      await SyncManager.start(currentUser.id);
    }
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
