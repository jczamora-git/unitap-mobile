<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { IonPage, IonContent } from '@ionic/vue';
import { useSyncStatus } from '@/composables/useSyncStatus';
import { useAuth } from '@/composables/useAuth';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { SyncStatusService } from '@/services/sync/sync-status.service';
import { InitialSyncService } from '@/services/sync/initial-sync.service';
import { onboardingService } from '@/services/onboarding.service';
import { useOnboarding } from '@/composables/useOnboarding';
import { getDatabase } from '@/database/database';
import { DataModeService } from '@/services/data-mode.service';
import {
  UniWelcomeSetup,
  UniDataUpdateScreen,
  type SetupStage,
  type UpdateStage,
} from '@/components/ui';

const router = useRouter();
const route = useRoute();
const { role, user } = useAuth();
const { hydration, progress } = useSyncStatus();

const isValidatingSession = ref(true);
const isNavigating = ref(false);
const isReturningUser = ref(false);
const hasCachedOfflineData = ref(false);

/**
 * Maps genuine synchronization & session milestones for returning user updates.
 */
const returningUpdateStage = computed<UpdateStage>(() => {
  if (hydration.value === 'FAILED') {
    return 'FAILED';
  }
  if (hydration.value === 'READY') {
    return 'COMPLETE';
  }
  if (hydration.value === 'VERIFYING') {
    return 'FINALIZING';
  }
  if (hydration.value === 'DOWNLOADING') {
    return progress.value.percent < 45 ? 'PREPARING' : 'UPDATING';
  }
  return 'PREPARING';
});

/**
 * Maps genuine synchronization & session milestones to friendly Windows OOBE-style stages.
 * Strictly driven by real system state (never arbitrary time intervals alone).
 */
const currentStage = computed<SetupStage>(() => {
  if (hydration.value === 'FAILED') {
    return 'ERROR';
  }

  if (hydration.value === 'READY') {
    return 'COMPLETE';
  }

  if (hydration.value === 'VERIFYING') {
    return 'FINALIZING';
  }

  if (hydration.value === 'DOWNLOADING') {
    // Stage 2 vs Stage 3 transition based on actual table download progress
    if (progress.value.percent < 45) {
      return 'PREPARING';
    }
    return 'HYDRATING';
  }

  // Initial authentication & session validation
  if (isValidatingSession.value || hydration.value === 'NOT_INITIALIZED') {
    return 'WELCOME';
  }

  return 'PREPARING';
});

/**
 * Real progress percentage from SyncStatusService.
 */
const realProgressPercent = computed(() => {
  if (currentStage.value === 'WELCOME') return 0;
  if (currentStage.value === 'FINALIZING') return 95;
  if (currentStage.value === 'COMPLETE') return 100;
  return progress.value.percent;
});

/**
 * Performs actual Supabase authentication check, SQLite database preparation,
 * and initial data hydration.
 */
async function startHydration() {
  isValidatingSession.value = true;

  try {
    if (DataModeService.isDirectSupabase()) {
      SyncStatusService.setHydration('READY');
      SyncStatusService.setState('SYNCED');
      isValidatingSession.value = false;
      await proceedToDestination();
      return;
    }

    if (!role.value) {
      await SupabaseAuthService.initialize();
    }

    const currentRole = role.value || SupabaseAuthService.role.value || 'DEVADMIN';
    const userId = user.value?.id || SupabaseAuthService.user.value?.id || 'devadmin';
    const studentId = user.value?.student_id;

    isValidatingSession.value = false;

    const success = await InitialSyncService.performInitialHydration(
      currentRole,
      userId,
      studentId
    );

    if (success) {
      // Reassuring brief transition to "You're all set!" before navigating
      setTimeout(() => {
        proceedToDestination();
      }, 950);
    }
  } catch (err: unknown) {
    console.error('[InitialSyncPage] Setup error:', err);
    isValidatingSession.value = false;
  }
}

/**
 * Role-aware destination navigation after successful initialization.
 */
async function proceedToDestination() {
  if (isNavigating.value) return;
  isNavigating.value = true;

  const currentRole = role.value || SupabaseAuthService.role.value;

  if (currentRole === 'STUDENT') {
    const hasCompleted = await onboardingService.hasCompletedOnboarding();
    if (!hasCompleted) {
      useOnboarding().startOnboardingTour();
    }
  }

  router.replace('/tabs/home');
}

onMounted(async () => {
  try {
    if (DataModeService.isDirectSupabase()) {
      SyncStatusService.setHydration('READY');
      SyncStatusService.setState('SYNCED');
      await proceedToDestination();
      return;
    }

    const hasOnboarded = await onboardingService.hasCompletedOnboarding();
    const isRehydrate = route.query.mode === 'rehydrate';
    isReturningUser.value = hasOnboarded || isRehydrate;

    // Check if offline cached data exists
    const db = await getDatabase();
    const st = await db.queryOne<{ count: number }>('SELECT count(*) as count FROM students');
    hasCachedOfflineData.value = (st?.count || 0) > 0;

    // If device is offline but already has cached data, enter offline mode immediately
    if (typeof navigator !== 'undefined' && !navigator.onLine && hasCachedOfflineData.value) {
      SyncStatusService.setState('OFFLINE_READY');
      proceedToDestination();
      return;
    }
  } catch {
    hasCachedOfflineData.value = false;
  }

  startHydration();
});
</script>

<template>
  <ion-page>
    <ion-content :fullscreen="true" class="welcome-page-content">
      <!-- Returning User Update Screen -->
      <UniDataUpdateScreen
        v-if="isReturningUser"
        :stage="returningUpdateStage"
        :progress-percent="realProgressPercent"
        :error-message="progress.error || 'Check your connection and try again.'"
        :allow-continue-offline="hasCachedOfflineData"
        @retry="startHydration"
        @continue-offline="proceedToDestination"
        @complete="proceedToDestination"
      />

      <!-- First-Time Onboarding Screen (Windows OOBE Style) -->
      <UniWelcomeSetup
        v-else
        :stage="currentStage"
        :progress-percent="realProgressPercent"
        :error-message="progress.error || 'Unable to establish local workspace'"
        :error-details="progress.currentTable ? `Operation interrupted at stage: ${progress.currentTable}` : undefined"
        :show-proceed-button="false"
        @retry="startHydration"
        @proceed="proceedToDestination"
      />
    </ion-content>
  </ion-page>
</template>

<style scoped>
.welcome-page-content {
  --background: var(--uni-background, #F8FAFC);
  --color: var(--uni-text, #0F172A);
}
</style>
