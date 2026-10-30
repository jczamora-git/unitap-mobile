<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { 
  homeOutline, 
  calendarOutline, 
  scanOutline, 
  peopleOutline, 
  walletOutline 
} from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

interface NavItem {
  id: string;
  name: string;
  path: string;
  icon: any;
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
  { id: 'home', name: 'Home', path: '/tabs/home', icon: homeOutline, ariaLabel: 'Home' },
  { id: 'events', name: 'Events', path: '/tabs/events', icon: calendarOutline, ariaLabel: 'Events' },
  { id: 'scan', name: 'Scan', path: '/tabs/scan', icon: scanOutline, ariaLabel: 'Scan' },
  { id: 'students', name: 'Students', path: '/tabs/students', icon: peopleOutline, ariaLabel: 'Students' },
  { id: 'finance', name: 'Finance', path: '/tabs/finance', icon: walletOutline, ariaLabel: 'Finance' },
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
      <div class="dock-icon-pill">
        <ion-icon :icon="item.icon" class="dock-icon" />
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
  border-radius: var(--uni-radius-dock);
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  box-shadow: var(--uni-shadow-dock);
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: center;
  padding: 0 4px;
  z-index: 1000;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-sizing: border-box;
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

.dock-icon-pill {
  width: 40px;
  max-width: 100%;
  height: 36px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  color: var(--uni-text-muted);
}

.dock-icon {
  font-size: 22px;
  transition: transform 0.15s ease, color 0.15s ease;
}

.uni-dock-item:active .dock-icon {
  transform: scale(0.9);
}

.uni-dock-item.is-active .dock-icon-pill {
  background: rgba(112, 243, 207, 0.12);
  color: var(--uni-mint);
}

@media (prefers-color-scheme: light) {
  .uni-dock-item.is-active .dock-icon-pill {
    background: rgba(21, 154, 116, 0.1);
    color: #0E8560;
  }
}

.uni-dock-item.is-active .dock-icon {
  color: currentColor;
}

@media (max-width: 360px) {
  .uni-dock-bar {
    width: calc(100% - 16px);
    height: 54px;
    padding: 0 2px;
  }

  .dock-icon-pill {
    width: 34px;
    height: 32px;
  }

  .dock-icon {
    font-size: 20px;
  }
}
</style>
