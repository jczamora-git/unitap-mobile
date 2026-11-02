<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { 
  IonTabBar, 
  IonTabButton, 
  IonTabs, 
  IonIcon, 
  IonPage, 
  IonRouterOutlet 
} from '@ionic/vue';
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
import { resetScrollPosition } from '@/utilities/scroll';

function onTabButtonClick() {
  haptics.light();
  resetScrollPosition();
}

const route = useRoute();

const currentTab = computed(() => {
  const p = route.path;
  if (p.includes('/tabs/events') || p.startsWith('/events')) return 'events';
  if (p.includes('/tabs/scan') || p.startsWith('/scan')) return 'scan';
  if (p.includes('/tabs/students') || p.startsWith('/students')) return 'students';
  if (p.includes('/tabs/finance') || p.startsWith('/finance')) return 'finance';
  return 'home';
});
</script>

<template>
  <ion-page>
    <ion-tabs>
      <ion-router-outlet></ion-router-outlet>
      
      <ion-tab-bar slot="bottom" class="uni-dock-bar">
        <ion-tab-button 
          tab="home" 
          href="/tabs/home" 
          aria-label="Home"
          :aria-current="currentTab === 'home' ? 'page' : undefined"
          @click="onTabButtonClick()"
        >
          <div class="dock-icon-wrap">
            <ion-icon :icon="currentTab === 'home' ? home : homeOutline" class="dock-icon" />
          </div>
        </ion-tab-button>

        <ion-tab-button 
          tab="events" 
          href="/tabs/events" 
          aria-label="Events"
          :aria-current="currentTab === 'events' ? 'page' : undefined"
          @click="onTabButtonClick()"
        >
          <div class="dock-icon-wrap">
            <ion-icon :icon="currentTab === 'events' ? calendar : calendarOutline" class="dock-icon" />
          </div>
        </ion-tab-button>

        <ion-tab-button 
          tab="scan" 
          href="/tabs/scan" 
          aria-label="NFC Scan"
          :aria-current="currentTab === 'scan' ? 'page' : undefined"
          @click="onTabButtonClick()"
        >
          <div class="dock-icon-wrap">
            <ion-icon :icon="currentTab === 'scan' ? scan : scanOutline" class="dock-icon" />
          </div>
        </ion-tab-button>

        <ion-tab-button 
          tab="students" 
          href="/tabs/students" 
          aria-label="Students"
          :aria-current="currentTab === 'students' ? 'page' : undefined"
          @click="onTabButtonClick()"
        >
          <div class="dock-icon-wrap">
            <ion-icon :icon="currentTab === 'students' ? people : peopleOutline" class="dock-icon" />
          </div>
        </ion-tab-button>

        <ion-tab-button 
          tab="finance" 
          href="/tabs/finance" 
          aria-label="Finance"
          :aria-current="currentTab === 'finance' ? 'page' : undefined"
          @click="onTabButtonClick()"
        >
          <div class="dock-icon-wrap">
            <ion-icon :icon="currentTab === 'finance' ? wallet : walletOutline" class="dock-icon" />
          </div>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  </ion-page>
</template>

<style scoped>
.uni-dock-bar {
  position: absolute;
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
  --background: var(--uni-surface, #FFFFFF);
  --border: none;
  padding: 0 4px;
  contain: none;
  overflow: hidden;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: center;
  z-index: 1000;
  box-sizing: border-box;
}

:root.dark .uni-dock-bar,
:root.ion-palette-dark .uni-dock-bar,
body.dark .uni-dock-bar,
body.ion-palette-dark .uni-dock-bar {
  background: var(--uni-surface, #1B1D23);
  --background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
  box-shadow: var(--uni-shadow-dock, 0 14px 40px rgba(0, 0, 0, 0.6));
}

ion-tab-button {
  --color: var(--uni-text-muted, #64748B);
  --color-selected: var(--uni-primary, #0F766E);
  background: transparent;
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s ease;
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
  transition: transform 0.15s ease, color 0.15s ease;
  margin: 0;
  color: var(--uni-text-muted, #64748B);
}

ion-tab-button:active .dock-icon {
  transform: scale(0.92);
}

ion-tab-button.tab-selected .dock-icon-wrap {
  background: transparent;
  color: var(--uni-primary, #0F766E);
}

ion-tab-button.tab-selected .dock-icon {
  color: var(--uni-primary, #0F766E);
  transform: scale(1.04);
}

:root.dark ion-tab-button.tab-selected .dock-icon-wrap,
:root.ion-palette-dark ion-tab-button.tab-selected .dock-icon-wrap,
body.dark ion-tab-button.tab-selected .dock-icon-wrap,
body.ion-palette-dark ion-tab-button.tab-selected .dock-icon-wrap {
  background: transparent;
  color: var(--uni-primary, #5EEAD4);
}

:root.dark ion-tab-button.tab-selected .dock-icon,
:root.ion-palette-dark ion-tab-button.tab-selected .dock-icon,
body.dark ion-tab-button.tab-selected .dock-icon,
body.ion-palette-dark ion-tab-button.tab-selected .dock-icon {
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
