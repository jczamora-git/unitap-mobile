<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { 
  home,
  homeOutline, 
  calendar,
  calendarOutline, 
  scan,
  scanOutline, 
  people,
  peopleOutline, 
  wallet,
  walletOutline 
} from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

interface NavItem {
  id: string;
  name: string;
  path: string;
  activeIcon: any;
  inactiveIcon: any;
  ariaLabel: string;
}

interface Props {
  currentTab?: string;
}

withDefaults(defineProps<Props>(), {
  currentTab: 'home'
});

const emit = defineEmits<{
  (e: 'select', tab: string): void;
}>();

const navItems: NavItem[] = [
  { id: 'home', name: 'Home', path: '/tabs/home', activeIcon: home, inactiveIcon: homeOutline, ariaLabel: 'Home' },
  { id: 'events', name: 'Events', path: '/tabs/events', activeIcon: calendar, inactiveIcon: calendarOutline, ariaLabel: 'Events' },
  { id: 'scan', name: 'Scan', path: '/tabs/scan', activeIcon: scan, inactiveIcon: scanOutline, ariaLabel: 'Scan' },
  { id: 'students', name: 'Students', path: '/tabs/students', activeIcon: people, inactiveIcon: peopleOutline, ariaLabel: 'Students' },
  { id: 'finance', name: 'Finance', path: '/tabs/finance', activeIcon: wallet, inactiveIcon: walletOutline, ariaLabel: 'Finance' },
];

function handleTabClick(item: NavItem) {
  haptics.light();
  emit('select', item.id);
}
</script>

<template>
  <nav class="uni-dock-bar" aria-label="Main Navigation">
    <button
      v-for="item in navItems"
      :key="item.id"
      type="button"
      class="uni-dock-item"
      :class="{ 'is-active': currentTab === item.id }"
      :aria-label="item.ariaLabel"
      :aria-current="currentTab === item.id ? 'page' : undefined"
      @click="handleTabClick(item)"
    >
      <div class="dock-icon-wrap">
        <ion-icon :icon="currentTab === item.id ? item.activeIcon : item.inactiveIcon" class="dock-icon" />
      </div>
    </button>
  </nav>
</template>

<style scoped>
.uni-dock-bar {
  position: fixed;
  bottom: calc(12px + var(--ion-safe-area-bottom, 0px));
  left: 0;
  right: 0;
  width: calc(100% - 24px);
  max-width: 420px;
  margin: 0 auto;
  height: 58px;
  border-radius: var(--uni-radius-dock, 9999px);
  background: var(--uni-surface, #FFFFFF);
  border: 1px solid var(--uni-border, #E2E8F0);
  box-shadow: var(--uni-shadow-dock, 0 8px 24px rgba(0, 0, 0, 0.06));
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: center;
  padding: 0 4px;
  z-index: 1000;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-sizing: border-box;
}

:root.dark .uni-dock-bar,
:root.ion-palette-dark .uni-dock-bar,
body.dark .uni-dock-bar,
body.ion-palette-dark .uni-dock-bar {
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
  box-shadow: var(--uni-shadow-dock, 0 14px 40px rgba(0, 0, 0, 0.6));
}

.uni-dock-item {
  width: 100%;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  user-select: none;
  position: relative;
}

.dock-icon-wrap {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--uni-text-muted, #64748B);
  transition: color 0.16s ease, transform 0.16s ease;
}

.dock-icon {
  font-size: 24px;
  color: var(--uni-text-muted, #64748B);
  transition: transform 0.15s ease, color 0.15s ease;
}

.uni-dock-item:active .dock-icon {
  transform: scale(0.9);
}

.uni-dock-item.is-active .dock-icon-wrap {
  background: transparent;
  color: var(--uni-primary, #0F766E);
}

.uni-dock-item.is-active .dock-icon {
  color: var(--uni-primary, #0F766E);
  transform: scale(1.04);
}

:root.dark .uni-dock-item.is-active .dock-icon-wrap,
:root.ion-palette-dark .uni-dock-item.is-active .dock-icon-wrap,
body.dark .uni-dock-item.is-active .dock-icon-wrap,
body.ion-palette-dark .uni-dock-item.is-active .dock-icon-wrap {
  background: transparent;
  color: var(--uni-primary, #5EEAD4);
}

:root.dark .uni-dock-item.is-active .dock-icon,
:root.ion-palette-dark .uni-dock-item.is-active .dock-icon,
body.dark .uni-dock-item.is-active .dock-icon,
body.ion-palette-dark .uni-dock-item.is-active .dock-icon {
  color: var(--uni-primary, #5EEAD4);
}

@media (max-width: 380px) {
  .uni-dock-bar {
    width: calc(100% - 16px);
    height: 54px;
    padding: 0 2px;
  }

  .dock-icon {
    font-size: 22px;
  }
}
</style>
