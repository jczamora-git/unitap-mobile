<script setup lang="ts">
import { ref } from 'vue';
import { IonIcon } from '@ionic/vue';
import { filterOutline, refreshOutline, checkmarkOutline, chevronBackOutline } from 'ionicons/icons';
import UniSheet from './UniSheet.vue';
import UniButton from './UniButton.vue';
import UniSheetNavigator from './UniSheetNavigator.vue';
import { haptics } from '@/utilities/haptics';

interface Props {
  isOpen: boolean;
  title?: string;
  subtitle?: string;
  activeCount?: number;
  applyText?: string;
  resetText?: string;
  isApplying?: boolean;
}

withDefaults(defineProps<Props>(), {
  title: 'Filter Records',
  subtitle: 'Configure display criteria',
  activeCount: 0,
  applyText: 'Apply Filters',
  resetText: 'Reset Filters',
  isApplying: false,
});

const emit = defineEmits<{
  (e: 'update:isOpen', value: boolean): void;
  (e: 'apply'): void;
  (e: 'reset'): void;
  (e: 'close'): void;
}>();

const navigatorRef = ref<InstanceType<typeof UniSheetNavigator> | null>(null);

function handleBeforeClose(): boolean {
  if (navigatorRef.value?.canGoBack) {
    navigatorRef.value.popView();
    return false; // Stay inside sheet, pop internal view
  }
  return true;
}

function handleSheetClose() {
  navigatorRef.value?.resetToRoot();
  emit('close');
}

function handleOpenUpdate(value: boolean) {
  if (!value) {
    navigatorRef.value?.resetToRoot();
  }
  emit('update:isOpen', value);
}

function handleReset() {
  haptics.medium();
  emit('reset');
}

function handleApply() {
  haptics.success();
  emit('apply');
  navigatorRef.value?.resetToRoot();
  emit('update:isOpen', false);
}
</script>

<template>
  <UniSheet
    :is-open="isOpen"
    :title="title"
    :subtitle="subtitle"
    size="standard"
    :before-close="handleBeforeClose"
    @update:is-open="handleOpenUpdate"
    @close="handleSheetClose"
  >
    <UniSheetNavigator
      ref="navigatorRef"
      :root-title="title"
      :root-subtitle="subtitle"
      :active-count="activeCount"
    >
      <template #header="{ viewTitle, canGoBack, goBack }">
        <!-- Sub-View Back Navigation Header -->
        <div v-if="canGoBack" class="filter-sub-header">
          <button
            type="button"
            class="filter-nav-back-btn"
            aria-label="Back to main filters"
            @click="goBack"
          >
            <ion-icon :icon="chevronBackOutline" class="back-icon" />
            <span class="back-label">Back</span>
          </button>
          <h3 class="sheet-title sub-title">{{ viewTitle }}</h3>
        </div>

        <!-- Root Main Filters Header -->
        <div v-else class="filter-sheet-header">
          <div class="header-lead">
            <div class="icon-avatar">
              <ion-icon :icon="filterOutline" />
            </div>
            <div>
              <div class="title-with-badge">
                <h3 class="sheet-title">{{ title }}</h3>
                <span v-if="activeCount > 0" class="filter-count-badge">
                  {{ activeCount }} active
                </span>
              </div>
              <p v-if="subtitle" class="sheet-subtitle">{{ subtitle }}</p>
            </div>
          </div>
        </div>
      </template>

      <!-- Filter Form Fields Slot (Root View) -->
      <div class="filter-form-fields">
        <slot />
      </div>

      <!-- Sticky Bottom Actions (only visible on root view) -->
      <template #footer="{ canGoBack }">
        <div v-if="!canGoBack" class="filter-actions-footer">
          <UniButton
            variant="outline"
            type="button"
            :icon="refreshOutline"
            class="btn-reset"
            @click="handleReset"
          >
            {{ resetText }}
          </UniButton>

          <UniButton
            variant="primary"
            type="button"
            :icon="checkmarkOutline"
            :loading="isApplying"
            class="btn-apply"
            @click="handleApply"
          >
            {{ applyText }}
          </UniButton>
        </div>
      </template>
    </UniSheetNavigator>
  </UniSheet>
</template>

<style scoped>
.filter-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.filter-sub-header {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding-bottom: 8px;
}

.filter-nav-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: var(--uni-btn-primary-bg, #0F766E);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  padding: 6px 10px;
  margin-left: -8px;
  border-radius: 8px;
  transition: background 0.14s ease;
}

:global(.dark) .filter-nav-back-btn,
:global(.ion-palette-dark) .filter-nav-back-btn {
  color: var(--uni-primary, #5EEAD4);
}

.filter-nav-back-btn:hover {
  background: rgba(15, 118, 110, 0.08);
}

:global(.dark) .filter-nav-back-btn:hover,
:global(.ion-palette-dark) .filter-nav-back-btn:hover {
  background: rgba(94, 234, 212, 0.1);
}

.back-icon {
  font-size: 19px;
}

.back-label {
  font-weight: 600;
}

.header-lead {
  display: flex;
  align-items: center;
  gap: 12px;
}

.icon-avatar {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: rgba(15, 118, 110, 0.12);
  color: var(--uni-primary, #0f766e);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

:global(.dark) .icon-avatar,
:global(.ion-palette-dark) .icon-avatar {
  background: rgba(94, 234, 212, 0.16);
  color: var(--uni-primary, #5EEAD4);
}

.title-with-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sheet-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
  margin: 0;
}

:global(.dark) .sheet-title,
:global(.ion-palette-dark) .sheet-title {
  color: var(--uni-text, #f1f5f9);
}

.sheet-title.sub-title {
  font-size: 16px;
}

.sheet-subtitle {
  font-size: 12px;
  color: var(--uni-text-secondary, #64748b);
  margin: 2px 0 0 0;
}

:global(.dark) .sheet-subtitle,
:global(.ion-palette-dark) .sheet-subtitle {
  color: var(--uni-text-secondary, #94a3b8);
}

.filter-count-badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: 9999px;
  background: var(--uni-btn-primary-bg, #0f766e);
  color: #ffffff;
}

:global(.dark) .filter-count-badge,
:global(.ion-palette-dark) .filter-count-badge {
  background: var(--uni-btn-primary-bg, #0D9488);
}

.filter-form-fields {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0 16px 0;
}

.filter-actions-footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
}

.btn-reset,
.btn-apply {
  width: 100%;
}
</style>
