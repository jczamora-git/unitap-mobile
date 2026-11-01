import { ref, computed } from 'vue';
import { themeService, type ThemePreference } from '@/services/theme.service';

const themePreference = ref<ThemePreference>(themeService.getPreference());
const isDarkMode = ref<boolean>(themeService.isDark());

// Global listener subscription to synchronize reactive state across all components
themeService.subscribe((pref, dark) => {
  themePreference.value = pref;
  isDarkMode.value = dark;
});

export function useTheme() {
  const effectiveTheme = computed<'light' | 'dark'>(() => (isDarkMode.value ? 'dark' : 'light'));

  async function setTheme(pref: ThemePreference): Promise<void> {
    await themeService.setPreference(pref);
    themePreference.value = pref;
    isDarkMode.value = themeService.isDark();
  }

  async function toggleTheme(): Promise<void> {
    const next: ThemePreference = isDarkMode.value ? 'light' : 'dark';
    await setTheme(next);
  }

  return {
    themePreference,
    isDarkMode,
    effectiveTheme,
    setTheme,
    toggleTheme,
    initTheme: () => themeService.init(),
  };
}

export type { ThemePreference };

