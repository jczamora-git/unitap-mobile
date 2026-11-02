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

useBackButton(10, (processNextHandler) => {
  if (isOnboardingOpen.value) {
    closeOnboardingTour();
    return;
  }

  const currentPath = router.currentRoute.value.path;

  // 1. If in a secondary tab, navigate back to /tabs/home
  if (currentPath.startsWith('/tabs/') && currentPath !== '/tabs/home') {
    router.replace('/tabs/home');
    return;
  }

  // 2. If in a sub-route (e.g. /settings, /events/..., /students/..., etc.)
  if (currentPath !== '/tabs/home' && currentPath !== '/login') {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.replace('/tabs/home');
    }
    return;
  }

  // 3. If on root route (/tabs/home or /login), require double-press back to exit
  const now = Date.now();
  if (now - lastBackPressTime < 2000) {
    processNextHandler();
  } else {
    lastBackPressTime = now;
    showToast('Press back again to exit', 'info', 2000);
  }
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
