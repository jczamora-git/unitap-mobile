<script setup lang="ts">
import { 
  IonTabBar, 
  IonTabButton, 
  IonTabs, 
  IonIcon, 
  IonPage, 
  IonRouterOutlet 
} from '@ionic/vue';
import { 
  homeOutline, 
  calendarOutline, 
  scanOutline, 
  peopleOutline, 
  walletOutline 
} from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';
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
          @click="haptics.light()"
        >
          <div class="dock-icon-pill">
            <ion-icon :icon="homeOutline" />
          </div>
        </ion-tab-button>

        <ion-tab-button 
          tab="events" 
          href="/tabs/events" 
          aria-label="Events"
          @click="haptics.light()"
        >
          <div class="dock-icon-pill">
            <ion-icon :icon="calendarOutline" />
          </div>
        </ion-tab-button>

        <ion-tab-button 
          tab="scan" 
          href="/tabs/scan" 
          aria-label="Scan"
          @click="haptics.light()"
        >
          <div class="dock-icon-pill">
            <ion-icon :icon="scanOutline" />
          </div>
        </ion-tab-button>

        <ion-tab-button 
          tab="students" 
          href="/tabs/students" 
          aria-label="Students"
          @click="haptics.light()"
        >
          <div class="dock-icon-pill">
            <ion-icon :icon="peopleOutline" />
          </div>
        </ion-tab-button>

        <ion-tab-button 
          tab="finance" 
          href="/tabs/finance" 
          aria-label="Finance"
          @click="haptics.light()"
        >
          <div class="dock-icon-pill">
            <ion-icon :icon="walletOutline" />
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
  border: 1px solid var(--uni-border, rgba(0, 0, 0, 0.06));
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

@media (prefers-color-scheme: dark) {
  .uni-dock-bar {
    background: var(--uni-surface-elevated, #24272D);
    --background: var(--uni-surface-elevated, #24272D);
    border-color: var(--uni-border, rgba(255, 255, 255, 0.07));
  }
}

ion-tab-button {
  --color: var(--uni-text-muted, #949BA6);
  --color-selected: var(--uni-mint, #70F3CF);
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

.dock-icon-pill {
  width: 40px;
  max-width: 100%;
  height: 36px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  color: var(--uni-text-muted, #737B86);
}

ion-tab-button ion-icon {
  font-size: 22px;
  transition: transform 0.15s ease, color 0.15s ease;
  margin: 0;
}

ion-tab-button:active ion-icon {
  transform: scale(0.92);
}

ion-tab-button.tab-selected .dock-icon-pill {
  background: rgba(112, 243, 207, 0.14);
  color: #0E8560;
}

@media (prefers-color-scheme: dark) {
  ion-tab-button.tab-selected .dock-icon-pill {
    background: rgba(112, 243, 207, 0.14);
    color: var(--uni-mint, #70F3CF);
  }
}

ion-tab-button.tab-selected ion-icon {
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

  ion-tab-button ion-icon {
    font-size: 20px;
  }
}
</style>
