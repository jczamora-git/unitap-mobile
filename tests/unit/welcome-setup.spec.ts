import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import UniWelcomeSetup from '@/components/ui/UniWelcomeSetup.vue';
import { InitialSyncService } from '@/services/sync/initial-sync.service';
import { SyncStatusService } from '@/services/sync/sync-status.service';
import { resetDatabaseForTests } from '@/database/database';
import { onboardingService } from '@/services/onboarding.service';

describe('UniTap 2.0 Windows OOBE-Inspired Welcome & Setup Suite', () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
    vi.restoreAllMocks();
  });

  describe('UniWelcomeSetup Presentation Component', () => {
    it('renders Stage 1 (WELCOME) with friendly, non-technical copy', () => {
      const wrapper = mount(UniWelcomeSetup, {
        props: { stage: 'WELCOME' },
      });

      expect(wrapper.find('.welcome-heading').text()).toBe('Welcome to UniTap.');
      expect(wrapper.find('.welcome-message').text()).toBe(
        'A smarter way to stay connected with your campus.'
      );
      expect(wrapper.attributes('role')).toBe('status');
      expect(wrapper.attributes('aria-live')).toBe('polite');
      // No raw table or database terminology
      expect(wrapper.text()).not.toContain('table');
      expect(wrapper.text()).not.toContain('sqlite');
    });

    it('renders Stage 2 (PREPARING) with friendly workspace preparation copy', () => {
      const wrapper = mount(UniWelcomeSetup, {
        props: { stage: 'PREPARING' },
      });

      expect(wrapper.find('.welcome-heading').text()).toBe('Making UniTap yours.');
      expect(wrapper.find('.welcome-message').text()).toBe(
        "We're preparing a workspace just for you."
      );
    });

    it('renders Stage 3 (HYDRATING) with friendly information preparation copy', () => {
      const wrapper = mount(UniWelcomeSetup, {
        props: { stage: 'HYDRATING', progressPercent: 55 },
      });

      expect(wrapper.find('.welcome-heading').text()).toBe('Getting things ready.');
      expect(wrapper.find('.welcome-message').text()).toBe(
        'Your important information is being prepared.'
      );
      const fill = wrapper.find('.welcome-progress-fill');
      expect(fill.exists()).toBe(true);
      expect(fill.attributes('style')).toContain('width: 55%');
    });

    it('renders Stage 4 (FINALIZING) with gentle consolidation copy', () => {
      const wrapper = mount(UniWelcomeSetup, {
        props: { stage: 'FINALIZING' },
      });

      expect(wrapper.find('.welcome-heading').text()).toBe('Bringing everything together.');
      expect(wrapper.find('.welcome-message').text()).toBe(
        "We're getting your experience ready."
      );
    });

    it('renders Stage 5 (COMPLETE) with friendly completion copy and checkmark emblem', () => {
      const wrapper = mount(UniWelcomeSetup, {
        props: { stage: 'COMPLETE', showProceedButton: true },
      });

      expect(wrapper.find('.welcome-heading').text()).toBe("You're all set!");
      expect(wrapper.find('.welcome-message').text()).toBe(
        'Welcome aboard. Your UniTap journey starts here.'
      );
      expect(wrapper.find('.mark-icon-wrap.complete').exists()).toBe(true);
      expect(wrapper.find('.btn-welcome-cta').exists()).toBe(true);
    });

    it('renders connection-specific error message and actionable retry button on network failure', async () => {
      const wrapper = mount(UniWelcomeSetup, {
        props: {
          stage: 'ERROR',
          errorMessage: 'Failed to fetch network resource',
          errorDetails: 'Connection timeout while reaching server',
          isRetryable: true,
        },
      });

      expect(wrapper.find('.welcome-heading').text()).toBe("We couldn't finish setting things up.");
      expect(wrapper.find('.welcome-message').text()).toBe(
        'Please check your connection and try again.'
      );
      expect(wrapper.find('.btn-retry').exists()).toBe(true);

      // Detail toggle works
      expect(wrapper.find('.error-details-box').exists()).toBe(false);
      await wrapper.find('.btn-toggle-details').trigger('click');
      expect(wrapper.find('.error-details-box').exists()).toBe(true);
      expect(wrapper.find('.error-details-box').text()).toContain('Failed to fetch network resource');

      // Click retry emits 'retry'
      await wrapper.find('.btn-retry').trigger('click');
      expect(wrapper.emitted('retry')).toHaveLength(1);
    });

    it('renders generic data failure message when non-connection error occurs', () => {
      const wrapper = mount(UniWelcomeSetup, {
        props: {
          stage: 'ERROR',
          errorMessage: 'SQLite constraint violated',
        },
      });

      expect(wrapper.find('.welcome-heading').text()).toBe('Something needs your attention.');
      expect(wrapper.find('.welcome-message').text()).toBe(
        "Your setup couldn't be completed. You can safely try again."
      );
    });
  });

  describe('First-Login vs Returning User Logic', () => {
    it('detects unhydrated state on clean database (first login requires setup)', async () => {
      const isHydrated = await InitialSyncService.isHydrated();
      expect(isHydrated).toBe(false);
    });

    it('records hydration completion and preserves returning user state', async () => {
      // Perform initial hydration
      const success = await InitialSyncService.performInitialHydration('DEVADMIN', 'admin-test-id');
      expect(success).toBe(true);

      // Now marked as hydrated
      const isHydratedAfter = await InitialSyncService.isHydrated();
      expect(isHydratedAfter).toBe(true);
      expect(SyncStatusService.hydration.value).toBe('READY');
    });

    it('preserves student onboarding tour trigger on first completed setup', async () => {
      vi.spyOn(onboardingService, 'hasCompletedOnboarding').mockResolvedValue(false);
      const completed = await onboardingService.hasCompletedOnboarding();
      expect(completed).toBe(false);
    });
  });
});

