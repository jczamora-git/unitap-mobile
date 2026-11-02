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
  walletOutline,
  card,
  cardOutline,
} from 'ionicons/icons';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { haptics } from '@/utilities/haptics';
import { resetScrollPosition } from '@/utilities/scroll';

function onTabButtonClick() {
  haptics.light();
  resetScrollPosition();
}

const route = useRoute();

const isStudent = computed(() => {
  const role = authService.role.value || SupabaseAuthService.role.value;
  return role === 'STUDENT';
});

const currentTab = computed(() => {
  const p = route.path;
  if (p.includes('/tabs/pass') || p.startsWith('/pass')) return 'pass';
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
      
      <ion-tab-bar
        slot="bottom"
        class="uni-dock-bar"
        :class="{ 'student-dock': isStudent }"
      >
        <!-- Tab 1: Home (Both Officer & Student) -->
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

        <!-- Tab 2: Events / Attendance (Both Officer & Student) -->
        <ion-tab-button 
          tab="events" 
          href="/tabs/events" 
          :aria-label="isStudent ? 'Attendance' : 'Events'"
          :aria-current="currentTab === 'events' ? 'page' : undefined"
          @click="onTabButtonClick()"
        >
          <div class="dock-icon-wrap">
            <ion-icon :icon="currentTab === 'events' ? calendar : calendarOutline" class="dock-icon" />
          </div>
        </ion-tab-button>

        <!-- STUDENT ONLY Tab 3: Digital Pass -->
        <ion-tab-button 
          v-if="isStudent"
          tab="pass" 
          href="/tabs/pass" 
          aria-label="Digital Pass"
          :aria-current="currentTab === 'pass' ? 'page' : undefined"
          @click="onTabButtonClick()"
        >
          <div class="dock-icon-wrap">
            <ion-icon :icon="currentTab === 'pass' ? card : cardOutline" class="dock-icon" />
          </div>
        </ion-tab-button>

        <!-- OFFICER ONLY Tab 3: NFC Scan Checker -->
        <ion-tab-button 
          v-if="!isStudent"
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

        <!-- OFFICER ONLY Tab 4: Students Master Directory -->
        <ion-tab-button 
          v-if="!isStudent"
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

        <!-- Tab 4 (or 5 for Officer): Finance / Dues & Ledger -->
        <ion-tab-button 
          tab="finance" 
          href="/tabs/finance" 
          :aria-label="isStudent ? 'Dues & Ledger' : 'Finance'"
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

.uni-dock-bar.student-dock {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

ion-tab-button {
  background: transparent;
  --background: transparent;
  --color: var(--uni-text-secondary, #64748B);
  --color-selected: var(--uni-primary, #0F766E);
  height: 100%;
  padding: 0;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  min-width: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.dock-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--uni-radius-full, 9999px);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  color: var(--uni-text-secondary, #64748B);
  position: relative;
}

.dock-icon {
  font-size: 22px;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), color 0.2s ease;
}

ion-tab-button[aria-current="page"] .dock-icon-wrap {
  color: var(--aurora-mint, #70F3CF);
  background: rgba(112, 243, 207, 0.12);
}

ion-tab-button[aria-current="page"] .dock-icon {
  transform: scale(1.08);
}

ion-tab-button:active .dock-icon-wrap {
  transform: scale(0.92);
}

@media (max-width: 360px) {
  .uni-dock-bar {
    width: calc(100% - 16px);
    height: 54px;
  }
  .dock-icon-wrap {
    width: 34px;
    height: 34px;
  }
  .dock-icon {
    font-size: 20px;
  }
}
</style>
