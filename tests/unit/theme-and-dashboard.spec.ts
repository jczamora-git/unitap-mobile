import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { themeService } from '@/services/theme.service';
import { useTheme } from '@/composables/useTheme';
import { Preferences } from '@capacitor/preferences';
import HomePage from '@/views/HomePage.vue';
import SettingsPage from '@/views/SettingsPage.vue';

// Mock router
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  useRoute: () => ({
    query: {},
    params: {},
  }),
}));

// Mock ionic components for vue-test-utils
vi.mock('@ionic/vue', async () => {
  const actual = await vi.importActual<any>('@ionic/vue');
  return {
    ...actual,
    onIonViewWillEnter: vi.fn((cb) => cb()),
    onIonViewDidLeave: vi.fn(),
  };
});

describe('UniTap 2.0 Theme System & Dashboard Cleanup', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Preferences.clear();
    document.documentElement.className = '';
    if (document.body) document.body.className = '';
  });

  describe('ThemeService', () => {
    it('initializes with default preference when no saved preference exists', async () => {
      const pref = await themeService.getStoredPreference();
      expect(pref).toBe('system');
    });

    it('forces light mode and removes dark palette classes', async () => {
      await themeService.setPreference('light');
      expect(themeService.getPreference()).toBe('light');
      expect(themeService.isDark()).toBe(false);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.classList.contains('ion-palette-dark')).toBe(false);
    });

    it('forces dark mode and adds dark palette classes to documentElement and body', async () => {
      await themeService.setPreference('dark');
      expect(themeService.getPreference()).toBe('dark');
      expect(themeService.isDark()).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('ion-palette-dark')).toBe(true);
      expect(document.body.classList.contains('dark')).toBe(true);
      expect(document.body.classList.contains('ion-palette-dark')).toBe(true);
    });

    it('persists selected preference to Preferences and localStorage', async () => {
      await themeService.setPreference('dark');
      const { value } = await Preferences.get({ key: 'unitap_theme_preference' });
      expect(value).toBe('dark');
      expect(localStorage.getItem('unitap_theme_preference')).toBe('dark');

      await themeService.setPreference('light');
      const { value: lightVal } = await Preferences.get({ key: 'unitap_theme_preference' });
      expect(lightVal).toBe('light');
      expect(localStorage.getItem('unitap_theme_preference')).toBe('light');
    });

    it('updates meta theme-color tag dynamically based on mode', async () => {
      await themeService.setPreference('light');
      let meta = document.querySelector('meta[name="theme-color"]');
      expect(meta?.getAttribute('content')).toBe('#F8FAFC');

      await themeService.setPreference('dark');
      meta = document.querySelector('meta[name="theme-color"]');
      expect(meta?.getAttribute('content')).toBe('#0F1117');
    });
  });

  describe('useTheme Composable', () => {
    it('provides reactive theme preference and toggles accurately', async () => {
      const { themePreference, isDarkMode, effectiveTheme, setTheme, toggleTheme } = useTheme();

      await setTheme('light');
      expect(themePreference.value).toBe('light');
      expect(isDarkMode.value).toBe(false);
      expect(effectiveTheme.value).toBe('light');

      await toggleTheme();
      expect(themePreference.value).toBe('dark');
      expect(isDarkMode.value).toBe(true);
      expect(effectiveTheme.value).toBe('dark');
    });
  });

  describe('Dashboard UI Cleanup (HomePage.vue)', () => {
    it('renders without the removed horizontal white account status bar', () => {
      const wrapper = mount(HomePage, {
        global: {
          stubs: {
            IonPage: { template: '<div><slot /></div>' },
            IonContent: { template: '<div><slot /></div>' },
            IonIcon: true,
            UniPageHeader: { template: '<header><slot /><slot name="trailing" /></header>' },
            UniStatCard: { template: '<div class="stub-stat-card"><slot /></div>' },
            UniButton: { template: '<button><slot /></button>' },
          },
        },
      });

      // The removed status bar elements must not exist
      expect(wrapper.find('.user-session-bar').exists()).toBe(false);
      expect(wrapper.find('.user-badge').exists()).toBe(false);
      expect(wrapper.find('.sync-pill').exists()).toBe(false);
      expect(wrapper.find('.term-pill').exists()).toBe(false);
      expect(wrapper.find('.btn-logout-link').exists()).toBe(false);

      // Dashboard metric cards must immediately be present
      expect(wrapper.find('.metrics-grid').exists()).toBe(true);
    });
  });

  describe('Settings Page Controls (SettingsPage.vue)', () => {
    it('includes Appearance theme selector, Account session, Academic period, and Sync controls', () => {
      const wrapper = mount(SettingsPage, {
        global: {
          stubs: {
            IonPage: { template: '<div><slot /></div>' },
            IonContent: { template: '<div><slot /></div>' },
            IonIcon: true,
            IonSpinner: true,
            UniPageHeader: { template: '<header><slot /></header>' },
            UniSegmentedControl: { template: '<div class="stub-segmented"><slot /></div>' },
            UniButton: { template: '<button><slot /></button>' },
            UniDialog: { template: '<div class="stub-dialog"><slot /></div>' },
            NfcStatusCard: { template: '<div class="stub-nfc-status" />' },
            UidStabilityTest: { template: '<div class="stub-uid-test" />' },
          },
        },
      });

      // 1. Appearance section
      expect(wrapper.text()).toContain('Appearance');
      expect(wrapper.text()).toContain('Theme Preference');
      expect(wrapper.find('.appearance-card').exists()).toBe(true);

      // 2. Account section
      expect(wrapper.text()).toContain('Account');
      expect(wrapper.text()).toContain('Sign Out');

      // 3. Academic Period section
      expect(wrapper.text()).toContain('Academic Period');

      // 4. Synchronization section
      expect(wrapper.text()).toContain('Synchronization');
      expect(wrapper.text()).toContain('Sync Now');
    });
  });
});
