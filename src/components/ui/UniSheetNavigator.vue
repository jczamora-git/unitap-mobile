<script setup lang="ts">
import { ref, computed, provide } from 'vue';
import { IonIcon } from '@ionic/vue';
import { checkmarkOutline, chevronBackOutline } from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';
import type { SelectOption } from './UniSelect.vue';

export interface SelectionMeta {
  options: SelectOption[];
  selectedValue?: string | number | null;
  onSelect?: (value: string | number) => void;
  [key: string]: any;
}

export interface SheetViewItem {
  id: string;
  title: string;
  meta?: SelectionMeta;
}

interface Props {
  rootTitle?: string;
  rootSubtitle?: string;
  activeCount?: number;
}

const props = withDefaults(defineProps<Props>(), {
  rootTitle: '',
  rootSubtitle: '',
  activeCount: 0,
});

const emit = defineEmits<{
  (e: 'navigate', viewId: string): void;
  (e: 'back', fromViewId: string): void;
}>();

const viewStack = ref<SheetViewItem[]>([
  { id: 'root', title: props.rootTitle },
]);

const currentItem = computed(() => viewStack.value[viewStack.value.length - 1] || { id: 'root', title: props.rootTitle });
const currentView = computed(() => currentItem.value.id);
const currentTitle = computed(() => currentItem.value.title || props.rootTitle);
const canGoBack = computed(() => viewStack.value.length > 1);
const activeSelectionMeta = computed<SelectionMeta | undefined>(() => currentItem.value.meta);
const selectionOptions = computed<SelectOption[]>(() => activeSelectionMeta.value?.options || []);

function pushView(id: string, title?: string, meta?: SelectionMeta) {
  haptics.light();
  viewStack.value.push({
    id,
    title: title || props.rootTitle,
    meta,
  });
  emit('navigate', id);
}

function popView() {
  if (!canGoBack.value) return;
  haptics.light();
  const popped = viewStack.value.pop();
  if (popped) {
    emit('back', popped.id);
  }
}

function resetToRoot() {
  viewStack.value = [{ id: 'root', title: props.rootTitle }];
}

function handleOptionSelect(val: string | number) {
  haptics.light();
  if (activeSelectionMeta.value?.onSelect) {
    activeSelectionMeta.value.onSelect(val);
  }
  // Immediately return to root/previous view
  popView();
}

function isOptionSelected(val: string | number): boolean {
  if (activeSelectionMeta.value?.selectedValue === undefined || activeSelectionMeta.value?.selectedValue === null) {
    return false;
  }
  return String(val) === String(activeSelectionMeta.value.selectedValue);
}

// Provide context for child components such as UniSelect
export interface SheetNavigatorContext {
  currentView: typeof currentView;
  currentTitle: typeof currentTitle;
  canGoBack: typeof canGoBack;
  pushView: typeof pushView;
  popView: typeof popView;
  resetToRoot: typeof resetToRoot;
}

provide('uni-sheet-navigator', {
  currentView,
  currentTitle,
  canGoBack,
  pushView,
  popView,
  resetToRoot,
});

defineExpose({
  currentView,
  currentTitle,
  canGoBack,
  pushView,
  popView,
  resetToRoot,
});
</script>

<template>
  <div class="uni-sheet-navigator">
    <!-- Optional Custom / Nav Header Slot -->
    <div class="navigator-header">
      <slot
        name="header"
        :current-view="currentView"
        :view-title="currentTitle"
        :can-go-back="canGoBack"
        :go-back="popView"
      >
        <!-- Default Sub-Header if in subview -->
        <div v-if="canGoBack" class="default-sub-header">
          <button
            type="button"
            class="nav-back-btn"
            aria-label="Back to previous view"
            @click="popView"
          >
            <ion-icon :icon="chevronBackOutline" class="back-icon" />
            <span class="back-text">Back</span>
          </button>
          <h4 class="sub-view-title">{{ currentTitle }}</h4>
        </div>
      </slot>
    </div>

    <!-- View Content Area with animated transitions -->
    <div class="navigator-body">
      <Transition name="sheet-nav" mode="out-in">
        <!-- Built-in Selection List View -->
        <div
          v-if="currentView === 'selection'"
          key="selection"
          class="selection-view-container"
          role="listbox"
          :aria-label="currentTitle"
        >
          <div v-if="selectionOptions.length > 0" class="selection-options-list">
            <button
              v-for="opt in selectionOptions"
              :key="opt.value"
              type="button"
              role="option"
              :aria-selected="isOptionSelected(opt.value)"
              class="selection-option-item"
              :class="{ 'is-selected': isOptionSelected(opt.value) }"
              @click="handleOptionSelect(opt.value)"
            >
              <div class="option-check-wrap">
                <ion-icon
                  v-if="isOptionSelected(opt.value)"
                  :icon="checkmarkOutline"
                  class="option-check-icon"
                />
              </div>
              <span class="option-label">{{ opt.label }}</span>
              <span v-if="opt.badge" class="option-badge">{{ opt.badge }}</span>
            </button>
          </div>
          <div v-else class="selection-empty-state">
            <p>No options available</p>
          </div>
        </div>

        <!-- Root View / Custom Views -->
        <div
          v-else
          :key="currentView"
          class="nav-custom-view-container"
        >
          <slot
            :name="currentView"
            :can-go-back="canGoBack"
            :go-back="popView"
          >
            <slot :can-go-back="canGoBack" :go-back="popView" />
          </slot>
        </div>
      </Transition>
    </div>

    <!-- Optional Sticky Footer Slot (Only rendered on root by default unless overridden) -->
    <div v-if="$slots.footer" class="navigator-footer">
      <slot
        name="footer"
        :current-view="currentView"
        :can-go-back="canGoBack"
        :go-back="popView"
      />
    </div>
  </div>
</template>

<style scoped>
.uni-sheet-navigator {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.navigator-header {
  width: 100%;
}

.default-sub-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0 14px 0;
  border-bottom: 1px solid var(--uni-border, #e2e8f0);
  margin-bottom: 12px;
}

:global(.dark) .default-sub-header,
:global(.ion-palette-dark) .default-sub-header {
  border-bottom-color: var(--uni-border, #2d3748);
}

.nav-back-btn {
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
  transition: background 0.15s ease, opacity 0.15s ease;
}

:global(.dark) .nav-back-btn,
:global(.ion-palette-dark) .nav-back-btn {
  color: var(--uni-primary, #5EEAD4);
}

.nav-back-btn:hover {
  background: rgba(15, 118, 110, 0.08);
}

:global(.dark) .nav-back-btn:hover,
:global(.ion-palette-dark) .nav-back-btn:hover {
  background: rgba(94, 234, 212, 0.1);
}

.back-icon {
  font-size: 18px;
}

.back-text {
  letter-spacing: -0.01em;
}

.sub-view-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
  flex: 1;
}

:global(.dark) .sub-view-title,
:global(.ion-palette-dark) .sub-view-title {
  color: var(--uni-text, #f1f5f9);
}

.navigator-body {
  width: 100%;
  position: relative;
}

/* Built-in Selection List View */
.selection-view-container {
  width: 100%;
  max-height: 58vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 4px 0;
}

.selection-options-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.selection-option-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  color: var(--uni-text, #0f172a);
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease, transform 0.1s ease;
}

:global(.dark) .selection-option-item,
:global(.ion-palette-dark) .selection-option-item {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #333846);
  color: var(--uni-text, #f1f5f9);
}

.selection-option-item:active {
  transform: scale(0.985);
}

.selection-option-item:hover {
  border-color: var(--uni-btn-primary-bg, #0F766E);
  background: rgba(15, 118, 110, 0.04);
}

:global(.dark) .selection-option-item:hover,
:global(.ion-palette-dark) .selection-option-item:hover {
  border-color: var(--uni-primary, #5EEAD4);
  background: rgba(94, 234, 212, 0.06);
}

.selection-option-item.is-selected {
  background: rgba(15, 118, 110, 0.08);
  border-color: var(--uni-btn-primary-bg, #0F766E);
  color: var(--uni-btn-primary-bg, #0F766E);
  font-weight: 600;
}

:global(.dark) .selection-option-item.is-selected,
:global(.ion-palette-dark) .selection-option-item.is-selected {
  background: rgba(94, 234, 212, 0.12);
  border-color: var(--uni-primary, #5EEAD4);
  color: var(--uni-primary, #5EEAD4);
}

.option-check-wrap {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.option-check-icon {
  font-size: 19px;
  color: var(--uni-btn-primary-bg, #0F766E);
}

:global(.dark) .option-check-icon,
:global(.ion-palette-dark) .option-check-icon {
  color: var(--uni-primary, #5EEAD4);
}

.option-label {
  flex: 1;
  line-height: 1.4;
}

.option-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--uni-surface-secondary, #f1f5f9);
  color: var(--uni-text-secondary, #64748b);
}

:global(.dark) .option-badge,
:global(.ion-palette-dark) .option-badge {
  background: var(--uni-surface, #1b1d23);
  color: var(--uni-text-secondary, #94a3b8);
}

.selection-empty-state {
  text-align: center;
  padding: 32px 16px;
  color: var(--uni-text-secondary, #64748b);
  font-size: 13px;
}

/* Transitions */
.sheet-nav-enter-active,
.sheet-nav-leave-active {
  transition: opacity 0.16s ease, transform 0.16s cubic-bezier(0.16, 1, 0.3, 1);
}

.sheet-nav-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

.sheet-nav-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

@media (prefers-reduced-motion: reduce) {
  .sheet-nav-enter-active,
  .sheet-nav-leave-active {
    transition: none;
  }
}
</style>

