<script setup lang="ts">
import { useRouter } from 'vue-router';
import { IonIcon } from '@ionic/vue';
import { arrowBackOutline } from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

interface Props {
  title: string;
  subtitle?: string;
  backButton?: boolean;
  defaultBackHref?: string;
  optionalBadge?: string;
  badgeVariant?: 'neutral' | 'mint' | 'warning' | 'danger';
  variant?: 'root' | 'detail' | 'utility';
}

const props = withDefaults(defineProps<Props>(), {
  subtitle: '',
  backButton: false,
  defaultBackHref: '/tabs/home',
  optionalBadge: '',
  badgeVariant: 'neutral',
  variant: 'root'
});

const emit = defineEmits<{
  (e: 'back'): void;
}>();

const router = useRouter();

function handleBack() {
  haptics.light();
  emit('back');
  if (window.history.length > 1) {
    router.back();
  } else if (props.defaultBackHref) {
    router.push(props.defaultBackHref);
  }
}
</script>

<template>
  <header class="uni-header" :class="[`variant-${variant}`]">
    <div class="uni-header-inner">
      <!-- Main row: Leading, Title, Trailing -->
      <div class="uni-header-main-row">
        <!-- Leading section (Back button or custom leading slot) -->
        <div v-if="backButton || $slots.leading" class="uni-header-leading">
          <slot name="leading">
            <button 
              v-if="backButton" 
              type="button" 
              class="uni-back-btn" 
              aria-label="Navigate back" 
              @click="handleBack"
            >
              <ion-icon :icon="arrowBackOutline" />
            </button>
          </slot>
        </div>

        <!-- Center / Titles section -->
        <div class="uni-header-content">
          <div class="uni-title-row">
            <h1 class="uni-header-title">{{ title }}</h1>
            <span 
              v-if="optionalBadge" 
              class="uni-header-badge" 
              :class="[`badge-${badgeVariant}`]"
            >
              {{ optionalBadge }}
            </span>
            <slot name="badge" />
          </div>
          <p v-if="subtitle" class="uni-header-subtitle">{{ subtitle }}</p>
        </div>

        <!-- Trailing actions section -->
        <div v-if="$slots.trailing" class="uni-header-trailing">
          <slot name="trailing" />
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.uni-header {
  width: 100%;
  background: var(--uni-bg);
  padding-top: calc(8px + var(--ion-safe-area-top, 0px));
  padding-bottom: 8px;
  padding-left: 16px;
  padding-right: 16px;
  position: relative;
  z-index: 10;
  box-sizing: border-box;
}

.uni-header-inner {
  max-width: 580px;
  margin: 0 auto;
}

.uni-header-main-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.uni-header-leading {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  min-height: 38px;
}

.uni-back-btn {
  width: 38px;
  height: 38px;
  min-width: 38px;
  border-radius: 11px;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  color: var(--uni-text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 19px;
  cursor: pointer;
  transition: transform 0.15s ease, background 0.15s ease;
  padding: 0;
  box-sizing: border-box;
}

.uni-back-btn:active {
  transform: scale(0.92);
  background: var(--uni-surface-elevated);
}

.uni-header-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 38px;
}

.uni-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 34px;
}

.uni-header-title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--uni-text-primary);
  line-height: 1.2;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.variant-detail .uni-header-title,
.variant-utility .uni-header-title {
  font-size: 18px;
  font-weight: 650;
}

.uni-header-subtitle {
  font-size: 12.5px;
  font-weight: 400;
  color: var(--uni-text-secondary);
  line-height: 1.35;
  margin: 2px 0 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.uni-header-trailing {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-height: 40px;
}

.uni-header-trailing :deep(.uni-header-action-btn),
.uni-header-trailing :deep(.settings-action-btn),
.uni-header-trailing :deep(.diagnostics-action-btn),
.uni-header-trailing :deep(.delete-icon-btn),
.uni-header-trailing :deep(.circular-icon-btn),
.uni-header-trailing :deep(.circular-icon-btn-sm) {
  width: 40px;
  height: 40px;
  min-width: 40px;
  min-height: 40px;
  border-radius: 11px;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  color: var(--uni-text-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  box-sizing: border-box;
  transition: transform 0.15s ease, background 0.15s ease;
}

.uni-header-trailing :deep(.uni-header-action-btn ion-icon),
.uni-header-trailing :deep(.settings-action-btn ion-icon),
.uni-header-trailing :deep(.diagnostics-action-btn ion-icon),
.uni-header-trailing :deep(.delete-icon-btn ion-icon),
.uni-header-trailing :deep(.circular-icon-btn ion-icon),
.uni-header-trailing :deep(.circular-icon-btn-sm ion-icon) {
  font-size: 21px;
  width: 21px;
  height: 21px;
  color: currentColor;
  flex-shrink: 0;
}

.uni-header-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 9999px;
  text-transform: capitalize;
  display: inline-flex;
  align-items: center;
}

.badge-neutral {
  background: var(--uni-surface-elevated);
  color: var(--uni-text-secondary);
  border: 1px solid var(--uni-border);
}

.badge-mint {
  background: rgba(112, 243, 207, 0.12);
  color: #0E8560;
  border: 1px solid rgba(112, 243, 207, 0.28);
}

@media (prefers-color-scheme: dark) {
  .badge-mint {
    color: var(--uni-mint);
  }
}

.badge-warning {
  background: rgba(255, 183, 143, 0.12);
  color: #D97706;
  border: 1px solid rgba(255, 183, 143, 0.28);
}

.badge-danger {
  background: rgba(220, 75, 75, 0.12);
  color: #DC2626;
  border: 1px solid rgba(220, 75, 75, 0.28);
}
</style>
