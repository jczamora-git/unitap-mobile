<script setup lang="ts">
import { ref, computed, inject } from 'vue';
import { IonIcon, actionSheetController } from '@ionic/vue';
import { chevronDownOutline, checkmarkOutline, chevronForwardOutline } from 'ionicons/icons';
import { haptics } from '@/utilities/haptics';

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
  presentation?: 'dropdown' | 'embedded' | 'action-sheet';
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

  // If explicit action-sheet or more than 4 options, use action sheet controller
  if (props.presentation === 'action-sheet' || (!props.presentation && props.options.length > 4)) {
    isDropdownOpen.value = false;
    await openActionSheet();
  } else {
    // Floating dropdown: compute viewport bounds to prevent clipping at the bottom
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
}

async function openActionSheet() {
  haptics.light();
  const buttons = props.options.map((opt) => {
    const isSelected = String(opt.value) === String(props.modelValue);
    return {
      text: opt.label + (opt.badge ? ` (${opt.badge})` : ''),
      role: isSelected ? 'selected' : undefined,
      cssClass: isSelected ? 'action-sheet-selected' : undefined,
      handler: () => {
        selectValue(opt.value);
      },
    };
  });

  buttons.push({
    text: 'Cancel',
    role: 'cancel',
    cssClass: 'action-sheet-cancel',
    handler: () => {},
  } as any);

  const sheet = await actionSheetController.create({
    header: props.header || props.placeholder || 'Select',
    buttons,
  });

  await sheet.present();
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
    <!-- Backdrop for custom dropdown when <= 3 options -->
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
        'is-open': !isEmbedded && isDropdownOpen,
        'has-value': !!selectedOption,
        'is-empty': options.length === 0,
        'is-embedded': isEmbedded,
      }"
      :disabled="isEffectivelyDisabled"
      aria-haspopup="listbox"
      :aria-expanded="isEmbedded ? false : isDropdownOpen"
      @click="handleTriggerClick"
    >
      <span class="trigger-label" :class="{ 'is-placeholder': !selectedOption }">
        {{ displayLabel }}
      </span>
      <ion-icon
        :icon="isEmbedded ? chevronForwardOutline : chevronDownOutline"
        class="trigger-chevron"
        :class="{ 'is-rotated': !isEmbedded && isDropdownOpen, 'is-forward': isEmbedded }"
      />
    </button>

    <!-- Custom Modern Floating Dropdown Menu (for <= 4 items) -->
    <Transition name="dropdown-pop">
      <div
        v-if="isDropdownOpen"
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
</style>
