import { Preferences } from '@capacitor/preferences';

const ONBOARDING_STORAGE_KEY = 'unitap_onboarding_completed_v1';

export const onboardingService = {
  async hasCompletedOnboarding(): Promise<boolean> {
    try {
      const { value } = await Preferences.get({ key: ONBOARDING_STORAGE_KEY });
      return value === 'true';
    } catch {
      return false;
    }
  },

  async setCompletedOnboarding(): Promise<void> {
    try {
      await Preferences.set({ key: ONBOARDING_STORAGE_KEY, value: 'true' });
    } catch {
      // Gracefully handle
    }
  },

  async resetOnboarding(): Promise<void> {
    try {
      await Preferences.remove({ key: ONBOARDING_STORAGE_KEY });
    } catch {
      // Gracefully handle
    }
  }
};
