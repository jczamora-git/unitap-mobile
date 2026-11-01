<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { IonIcon } from '@ionic/vue';
import { schoolOutline, shieldCheckmarkOutline, swapHorizontalOutline } from 'ionicons/icons';
import { authService } from '@/services/auth.service';
import { haptics } from '@/utilities/haptics';
import { useToast } from '@/composables/useToast';

const router = useRouter();
const { showToast } = useToast();

const canSwitch = computed(() => authService.canSwitchWorkspace.value);
const currentWorkspace = computed(() => authService.activeWorkspace.value);

async function toggleWorkspace() {
  if (!canSwitch.value) return;
  haptics.medium();
  const target = currentWorkspace.value === 'OFFICER' ? 'STUDENT' : 'OFFICER';
  try {
    await authService.switchWorkspace(target);
    await showToast(
      target === 'OFFICER' ? 'Switched to Officer Workspace' : 'Switched to Student Portal',
      'success'
    );
    router.replace('/tabs/home');
  } catch (err: unknown) {
    await showToast((err as Error).message || 'Failed to switch workspace', 'error');
  }
}
</script>

<template>
  <div v-if="canSwitch" class="workspace-switcher-card">
    <div class="switcher-left">
      <div class="switcher-icon-wrap" :class="(currentWorkspace || 'STUDENT').toLowerCase()">
        <ion-icon :icon="currentWorkspace === 'OFFICER' ? shieldCheckmarkOutline : schoolOutline" />
      </div>
      <div class="switcher-titles">
        <span class="switcher-badge font-mono">ACTIVE WORKSPACE</span>
        <span class="switcher-name">
          {{ currentWorkspace === 'OFFICER' ? 'Officer Workspace' : 'Student Portal' }}
        </span>
      </div>
    </div>

    <button type="button" class="switch-toggle-btn" @click="toggleWorkspace">
      <ion-icon :icon="swapHorizontalOutline" />
      <span>Switch to {{ currentWorkspace === 'OFFICER' ? 'Student' : 'Officer' }}</span>
    </button>
  </div>
</template>

<style scoped>
.workspace-switcher-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 12px;
  gap: 10px;
}

.switcher-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.switcher-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.switcher-icon-wrap.officer {
  background: rgba(15, 118, 110, 0.12);
  color: var(--uni-primary, #0f766e);
}

.switcher-icon-wrap.student {
  background: rgba(2, 132, 199, 0.12);
  color: #0284c7;
}

.switcher-titles {
  display: flex;
  flex-direction: column;
}

.switcher-badge {
  font-size: 9.5px;
  font-weight: 700;
  color: var(--uni-text-secondary, #64748b);
  letter-spacing: 0.05em;
}

.switcher-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
}

.switch-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--uni-primary, #0f766e);
  background: transparent;
  color: var(--uni-primary, #0f766e);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

:global(.dark) .workspace-switcher-card {
  background: var(--uni-surface, #1b1d23);
  border-color: var(--uni-border, #30343d);
}

:global(.dark) .switch-toggle-btn {
  border-color: var(--uni-primary, #5eead4);
  color: var(--uni-primary, #5eead4);
}
</style>
