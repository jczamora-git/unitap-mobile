<script setup lang="ts">
import { ref, computed, inject } from 'vue';
import { IonIcon, actionSheetController } from '@ionic/vue';
import {
  chevronDownOutline,
  checkmarkOutline,
  chevronForwardOutline,
  searchOutline,
} from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';
import UniSheet from './UniSheet.vue';

export interface SelectOption {
  value: string | number;
  label: string;
  badge?: string;
}

interface Props {
  modelValue?: string | number | null;
  options?: SelectOption[];
  placeholder?: string;
  emptyPlaceholder?: string;
  disabled?: boolean;
  header?: string;
  presentation?: 'dropdown' | 'embedded' | 'action-sheet' | 'sheet';
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  options: () => [],
  placeholder: 'Select option',
  emptyPlaceholder: '',
  disabled: false,
  header: '',
  presentation: undefined,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number): void;
  (e: 'change', value: string | number): void;
}>();

const sheetNav = inject<any>('uni-sheet-navigator', null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const openUpward = ref(false);

const isEmbedded = computed(() => {
  if (props.presentation === 'embedded') return true;
  if (props.presentation === undefined && sheetNav) return true;
  return false;
});

const isDropdownOpen = ref(false);
const isSelectionSheetOpen = ref(false);
const searchFilter = ref('');

const selectedOption = computed(() => {
  return props.options.find((opt) => String(opt.value) === String(props.modelValue)) || null;
});

const displayLabel = computed(() => {
  if (selectedOption.value) {
    return selectedOption.value.label;
  }
  if (props.options.length === 0 && props.emptyPlaceholder) {
    return props.emptyPlaceholder;
  }
  return props.placeholder;
});

const isEffectivelyDisabled = computed(() => {
  return props.disabled || props.options.length === 0;
});

// Established UniTap UI rule: when a selection control has 3 or more choices, use a selection sheet
const shouldUseSheet = computed(() => {
  if (isEmbedded.value) return false;
  if (props.presentation === 'dropdown') return false;
  if (props.presentation === 'action-sheet' || props.presentation === 'sheet') return true;
  return props.options.length >= 3;
});

const filteredOptions = computed(() => {
  if (!searchFilter.value.trim()) return props.options;
  const q = searchFilter.value.toLowerCase().trim();
  return props.options.filter(
    (opt) =>
      opt.label.toLowerCase().includes(q) ||
      (opt.badge && opt.badge.toLowerCase().includes(q))
  );
});

async function handleTriggerClick() {
  if (isEffectivelyDisabled.value) return;

  if (isEmbedded.value && sheetNav) {
    haptics.light();
    sheetNav.pushView('selection', props.header || props.placeholder || 'Select', {
      options: props.options,
      selectedValue: props.modelValue,
      onSelect: (val: string | number) => {
        selectValue(val);
      },
    });
    return;
  }

  // 3 or more options, or explicit sheet/action-sheet => open Selection Sheet
  if (shouldUseSheet.value) {
    haptics.light();
    searchFilter.value = '';
    isDropdownOpen.value = false;
    isSelectionSheetOpen.value = true;
    return;
  }

  // Floating dropdown menu for 1-2 options: compute viewport bounds
  if (triggerRef.value && typeof window !== 'undefined') {
    const rect = triggerRef.value.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    openUpward.value = spaceBelow < 250 && rect.top > 220;
  } else {
    openUpward.value = false;
  }
  haptics.light();
  isDropdownOpen.value = !isDropdownOpen.value;
}

function handleSheetOptionSelect(val: string | number) {
  selectValue(val);
  isSelectionSheetOpen.value = false;
}

function selectValue(val: string | number) {
  if (props.modelValue !== val) {
    emit('update:modelValue', val);
    emit('change', val);
    haptics.light();
  }
  isDropdownOpen.value = false;
}
</script>

<template>
  <div
    class="uni-select-container"
    :class="{ 'is-disabled': isEffectivelyDisabled, 'is-active': isDropdownOpen }"
  >
    <!-- Backdrop for custom dropdown when <= 2 options -->
    <div
      v-if="isDropdownOpen"
      class="uni-dropdown-backdrop"
      @click="isDropdownOpen = false"
    />

    <!-- Modern Trigger Button -->
    <button
      ref="triggerRef"
      type="button"
      class="uni-select-trigger"
      :class="{
        'is-open': (!isEmbedded && isDropdownOpen) || isSelectionSheetOpen,
        'has-value': !!selectedOption,
        'is-empty': options.length === 0,
        'is-embedded': isEmbedded,
      }"
      :disabled="isEffectivelyDisabled"
      aria-haspopup="listbox"
      :aria-expanded="isEmbedded ? false : (isDropdownOpen || isSelectionSheetOpen)"
      @click="handleTriggerClick"
    >
      <span class="trigger-label" :class="{ 'is-placeholder': !selectedOption }">
        {{ displayLabel }}
      </span>
      <ion-icon
        :icon="isEmbedded ? chevronForwardOutline : chevronDownOutline"
        class="trigger-chevron"
        :class="{
          'is-rotated': (!isEmbedded && isDropdownOpen) || isSelectionSheetOpen,
          'is-forward': isEmbedded,
        }"
      />
    </button>

    <!-- Custom Modern Floating Dropdown Menu (for <= 2 items) -->
    <Transition name="dropdown-pop">
      <div
        v-if="isDropdownOpen && !shouldUseSheet"
        class="uni-dropdown-menu"
        :class="{ 'is-upward': openUpward }"
        role="listbox"
      >
        <button
          v-for="opt in options"
          :key="opt.value"
          type="button"
          role="option"
          :aria-selected="String(opt.value) === String(modelValue)"
          class="uni-dropdown-item"
          :class="{ 'is-selected': String(opt.value) === String(modelValue) }"
          @click="selectValue(opt.value)"
        >
          <span class="item-text">{{ opt.label }}</span>
          <span v-if="opt.badge" class="item-badge">{{ opt.badge }}</span>
          <ion-icon
            v-if="String(opt.value) === String(modelValue)"
            :icon="checkmarkOutline"
            class="item-check"
          />
        </button>
      </div>
    </Transition>

    <!-- Global Selection Sheet for >= 3 choices -->
    <UniSheet
      v-model:isOpen="isSelectionSheetOpen"
      :title="header || placeholder || 'Select Option'"
      size="compact"
    >
      <div class="uni-selection-sheet-container">
        <!-- Quick search filter for long option lists (> 7 options) -->
        <div v-if="options.length > 7" class="selection-search-box">
          <ion-icon :icon="searchOutline" class="selection-search-icon" />
          <input
            v-model="searchFilter"
            type="text"
            class="selection-search-input"
            :placeholder="`Search ${header || 'options'}...`"
          />
        </div>

        <div class="uni-selection-options-list">
          <button
            v-for="opt in filteredOptions"
            :key="opt.value"
            type="button"
            class="uni-selection-option-row"
            :class="{ 'is-selected': String(opt.value) === String(modelValue) }"
            @click="handleSheetOptionSelect(opt.value)"
          >
            <div class="option-text-group">
              <span class="option-label">{{ opt.label }}</span>
              <span v-if="opt.badge" class="option-badge">{{ opt.badge }}</span>
            </div>
            <ion-icon
              v-if="String(opt.value) === String(modelValue)"
              :icon="checkmarkOutline"
              class="option-check-icon"
            />
          </button>

          <div v-if="filteredOptions.length === 0" class="selection-empty-hint">
            No options match your search.
          </div>
        </div>
      </div>
    </UniSheet>
  </div>
</template>

<style scoped>
.uni-select-container {
  position: relative;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.uni-select-container.is-active {
  z-index: 1000;
}

.uni-dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 998;
  background: transparent;
}

.uni-select-trigger {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 44px;
  padding: 0 14px;
  background: var(--uni-surface-input, var(--uni-surface, #ffffff));
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: var(--uni-radius-card, 14px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  outline: none;
  box-shadow: none;
  user-select: none;
  transition: border-color 0.16s ease, background 0.16s ease;
  box-sizing: border-box;
}

.uni-select-trigger.is-open {
  border-color: var(--uni-border-focus, #0f766e);
}

.uni-select-trigger:hover:not(:disabled) {
  background: var(--uni-surface-secondary, #f8fafc);
}

:global(.dark) .uni-select-trigger,
:global(.ion-palette-dark) .uni-select-trigger {
  background: var(--uni-surface-input, #252830);
  border-color: var(--uni-border, #30343D);
}

:global(.dark) .uni-select-trigger:hover:not(:disabled),
:global(.ion-palette-dark) .uni-select-trigger:hover:not(:disabled) {
  background: var(--uni-surface-secondary, #2d313b);
}

.trigger-label {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--uni-text, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

:global(.dark) .trigger-label,
:global(.ion-palette-dark) .trigger-label {
  color: var(--uni-text, #f8fafc);
}

.trigger-label.is-placeholder {
  color: var(--uni-text-secondary, #64748b);
  font-weight: 500;
}

:global(.dark) .trigger-label.is-placeholder,
:global(.ion-palette-dark) .trigger-label.is-placeholder {
  color: var(--uni-text-secondary, #9ca3af);
}

.trigger-chevron {
  font-size: 16px;
  color: var(--uni-text-secondary, #64748b);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), color 0.16s ease;
  flex-shrink: 0;
  margin-left: 8px;
}

:global(.dark) .trigger-chevron,
:global(.ion-palette-dark) .trigger-chevron {
  color: var(--uni-text-secondary, #9ca3af);
}

.trigger-chevron.is-rotated {
  transform: rotate(180deg);
  color: var(--uni-primary, #0f766e);
}

.trigger-chevron.is-forward {
  font-size: 17px;
  color: var(--uni-text-secondary, #94a3b8);
}

.uni-select-trigger.is-embedded:active {
  background: var(--uni-surface-secondary, #f1f5f9);
}

:global(.dark) .uni-select-trigger.is-embedded:active,
:global(.ion-palette-dark) .uni-select-trigger.is-embedded:active {
  background: var(--uni-surface-secondary, #252830);
}

.uni-dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 100%;
  width: max-content;
  max-width: min(380px, calc(100vw - 32px));
  z-index: 9999;
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 14px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
  padding: 6px;
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  scrollbar-width: thin;
  box-sizing: border-box;
}

.uni-dropdown-menu.is-upward {
  top: auto;
  bottom: calc(100% + 6px);
  box-shadow: 0 -10px 28px rgba(0, 0, 0, 0.14);
}

:root.dark .uni-dropdown-menu,
:root.ion-palette-dark .uni-dropdown-menu,
body.dark .uni-dropdown-menu,
body.ion-palette-dark .uni-dropdown-menu,
:global(.dark) .uni-dropdown-menu,
:global(.ion-palette-dark) .uni-dropdown-menu {
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.5);
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
}

.uni-dropdown-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  user-select: none;
  outline: none;
  gap: 10px;
  box-sizing: border-box;
  transition: background-color 0.14s ease, color 0.14s ease;
}

.uni-dropdown-item:hover {
  background: var(--uni-surface-secondary, #f1f5f9);
}

:global(.dark) .uni-dropdown-item:hover,
:global(.ion-palette-dark) .uni-dropdown-item:hover {
  background: var(--uni-surface-secondary, #252830);
}

.uni-dropdown-item.is-selected {
  background: rgba(15, 118, 110, 0.08);
}

:root.dark .uni-dropdown-item.is-selected,
:root.ion-palette-dark .uni-dropdown-item.is-selected,
body.dark .uni-dropdown-item.is-selected,
body.ion-palette-dark .uni-dropdown-item.is-selected,
:global(.dark) .uni-dropdown-item.is-selected,
:global(.ion-palette-dark) .uni-dropdown-item.is-selected {
  background: rgba(94, 234, 212, 0.14);
}

.item-text {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--uni-text, #0f172a);
  flex: 1;
  white-space: normal;
  word-break: break-word;
  line-height: 1.35;
}

:global(.dark) .item-text,
:global(.ion-palette-dark) .item-text {
  color: var(--uni-text, #F8FAFC);
}

.uni-dropdown-item.is-selected .item-text {
  font-weight: 700;
  color: var(--uni-primary, #0f766e);
}

:root.dark .uni-dropdown-item.is-selected .item-text,
:root.ion-palette-dark .uni-dropdown-item.is-selected .item-text,
body.dark .uni-dropdown-item.is-selected .item-text,
body.ion-palette-dark .uni-dropdown-item.is-selected .item-text,
:global(.dark) .uni-dropdown-item.is-selected .item-text,
:global(.ion-palette-dark) .uni-dropdown-item.is-selected .item-text {
  color: var(--uni-primary, #5EEAD4);
}

.item-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 9999px;
  background: rgba(15, 118, 110, 0.12);
  color: var(--uni-primary, #0f766e);
  margin-right: 8px;
  text-transform: uppercase;
}

.item-check {
  font-size: 16px;
  color: var(--uni-primary, #0f766e);
  flex-shrink: 0;
}

/* Dropdown Animation */
.dropdown-pop-enter-active,
.dropdown-pop-leave-active {
  transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1), transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.dropdown-pop-enter-from,
.dropdown-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

.is-disabled {
  opacity: 0.55;
  pointer-events: none;
}

/* ========================================================
   SELECTION SHEET STYLES (FOR >= 3 OPTIONS)
   ======================================================== */
.uni-selection-sheet-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 4px;
}

.selection-search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--uni-surface-secondary, #F1F5F9);
  border: 1px solid var(--uni-border, #E2E8F0);
  border-radius: 12px;
  padding: 0 12px;
  height: 42px;
  margin-bottom: 4px;
}

:global(.dark) .selection-search-box,
:global(.ion-palette-dark) .selection-search-box {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #30343D);
}

.selection-search-icon {
  font-size: 16px;
  color: var(--uni-text-secondary, #64748B);
  flex-shrink: 0;
}

.selection-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-family: inherit;
  font-size: 13.5px;
  color: var(--uni-text, #0F172A);
}

:global(.dark) .selection-search-input,
:global(.ion-palette-dark) .selection-search-input {
  color: var(--uni-text, #F8FAFC);
}

.uni-selection-options-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 55vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.uni-selection-option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 48px;
  padding: 12px 14px;
  border-radius: 12px;
  background: transparent;
  border: 1px solid transparent;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
  user-select: none;
  box-sizing: border-box;
}

.uni-selection-option-row:hover {
  background: var(--uni-surface-secondary, #F1F5F9);
}

:global(.dark) .uni-selection-option-row:hover,
:global(.ion-palette-dark) .uni-selection-option-row:hover {
  background: var(--uni-surface-secondary, #252830);
}

.uni-selection-option-row.is-selected {
  background: var(--uni-primary-bg, rgba(15, 118, 110, 0.08));
  border-color: rgba(15, 118, 110, 0.2);
}

:global(.dark) .uni-selection-option-row.is-selected,
:global(.ion-palette-dark) .uni-selection-option-row.is-selected {
  background: rgba(94, 234, 212, 0.1);
  border-color: rgba(94, 234, 212, 0.25);
}

.option-text-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.option-label {
  font-size: 14px;
  font-weight: 550;
  color: var(--uni-text, #0F172A);
  line-height: 1.35;
}

.uni-selection-option-row.is-selected .option-label {
  color: var(--uni-primary, #0F766E);
  font-weight: 650;
}

:global(.dark) .option-label,
:global(.ion-palette-dark) .option-label {
  color: var(--uni-text, #F8FAFC);
}

:global(.dark) .uni-selection-option-row.is-selected .option-label,
:global(.ion-palette-dark) .uni-selection-option-row.is-selected .option-label {
  color: var(--uni-primary, #5EEAD4);
}

.option-badge {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: 9999px;
  background: var(--uni-surface-secondary, #E2E8F0);
  color: var(--uni-text-secondary, #475569);
  flex-shrink: 0;
}

.option-check-icon {
  font-size: 19px;
  font-weight: 700;
  color: var(--uni-primary, #0F766E);
  flex-shrink: 0;
  margin-left: 8px;
}

:global(.dark) .option-check-icon,
:global(.ion-palette-dark) .option-check-icon {
  color: var(--uni-primary, #5EEAD4);
}

.selection-empty-hint {
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--uni-text-secondary, #64748B);
}
</style>
