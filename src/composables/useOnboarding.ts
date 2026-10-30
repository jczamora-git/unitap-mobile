import { ref } from 'vue';
import { onboardingService } from '@/services/onboarding.service';

const isOnboardingOpen = ref(false);

export function useOnboarding() {
  async function checkOnboardingStatus() {
    const completed = await onboardingService.hasCompletedOnboarding();
    if (!completed) {
      isOnboardingOpen.value = true;
    }
  }

  function startOnboardingTour() {
    isOnboardingOpen.value = true;
  }

  function closeOnboardingTour() {
    isOnboardingOpen.value = false;
  }

  return {
    isOnboardingOpen,
    checkOnboardingStatus,
    startOnboardingTour,
    closeOnboardingTour
  };
}
