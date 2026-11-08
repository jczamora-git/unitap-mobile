<script setup lang="ts">
import { IonIcon, IonSpinner } from '@ionic/vue';
import { haptics } from '@/utilities/haptics';

interface Props {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  block?: boolean;
  icon?: any;
  iconPosition?: 'left' | 'right';
  iconOnly?: boolean;
  ariaLabel?: string;
  title?: string;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  disabled: false,
  loading: false,
  type: 'button',
  block: false,
  icon: undefined,
  iconPosition: 'left',
  iconOnly: false,
  ariaLabel: undefined,
  title: undefined,
});


const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();

function handleClick(event: MouseEvent) {
  if (props.disabled || props.loading) {
    event.preventDefault();
    return;
  }
  haptics.light();
  emit('click', event);
}
</script>

<template>
  <button
    :type="type"
    class="uni-btn"
    :class="[
      `uni-btn-${variant}`,
      `uni-btn-${size}`,
      { 
        'uni-btn-block': block, 
        'uni-btn-loading': loading,
        'uni-btn-icon-only': iconOnly || size === 'icon' || size === 'icon-sm'
      }
    ]"
    :disabled="disabled || loading"
    :aria-label="ariaLabel"
    :title="title || ariaLabel"
    @click="handleClick"

  >
    <ion-spinner v-if="loading" name="crescent" class="btn-spinner" />
    
    <template v-else>
      <ion-icon 
        v-if="icon && (iconPosition === 'left' || iconOnly || size === 'icon' || size === 'icon-sm')" 
        :icon="icon" 
        class="btn-icon btn-icon-start" 
      />
      
      <span v-if="$slots.default && !iconOnly && size !== 'icon' && size !== 'icon-sm'" class="btn-label">
        <slot />
      </span>

      <ion-icon 
        v-if="icon && iconPosition === 'right' && !iconOnly && size !== 'icon' && size !== 'icon-sm'" 
        :icon="icon" 
        class="btn-icon btn-icon-end" 
      />
    </template>
  </button>
</template>

<style scoped>
.uni-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--uni-font-family);
  font-weight: 600;
  border-radius: var(--uni-radius-btn);
  border: 1px solid transparent;
  cursor: pointer;
  transition: transform 0.14s cubic-bezier(0.16, 1, 0.3, 1), 
              background 0.14s ease, 
              border-color 0.14s ease, 
              opacity 0.14s ease;
  user-select: none;
  -webkit-user-select: none;
  text-decoration: none;
  white-space: nowrap;
  box-sizing: border-box;
}

.uni-btn:active:not(:disabled) {
  transform: scale(0.975);
}

.uni-btn-block {
  width: 100%;
}

.uni-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}

/* Sizes */
.uni-btn-sm {
  height: 36px;
  padding: 0 14px;
  font-size: 12.5px;
  gap: 6px;
}

.uni-btn-md {
  height: 48px;
  padding: 0 18px;
  font-size: 14px;
  gap: 8px;
}

.uni-btn-lg {
  height: 52px;
  padding: 0 22px;
  font-size: 15px;
  gap: 10px;
}

.uni-btn-icon {
  width: 40px;
  height: 40px;
  min-width: 40px;
  padding: 0;
  border-radius: 11px;
}

.uni-btn-icon-sm {
  width: 36px;
  height: 36px;
  min-width: 36px;
  padding: 0;
  border-radius: 9px;
}

.uni-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--uni-border-focus, #0F766E);
}

/* Variants */
.uni-btn-primary {
  background: var(--uni-btn-primary-bg, #0F766E);
  color: #FFFFFF;
  border-color: transparent;
  box-shadow: none;
}

:root.dark .uni-btn-primary,
:root.ion-palette-dark .uni-btn-primary,
body.dark .uni-btn-primary,
body.ion-palette-dark .uni-btn-primary,
:global(.dark) .uni-btn-primary,
:global(.ion-palette-dark) .uni-btn-primary {
  background: var(--uni-btn-primary-bg, #0D9488);
  color: #FFFFFF;
  box-shadow: none;
}

.uni-btn-primary:hover:not(:disabled) {
  filter: brightness(1.06);
}

.uni-btn-secondary {
  background: var(--uni-surface-elevated);
  color: var(--uni-text-primary);
  border-color: var(--uni-border);
}

.uni-btn-secondary:hover:not(:disabled) {
  background: var(--uni-surface);
}

.uni-btn-outline {
  background: transparent;
  color: var(--uni-text-primary);
  border-color: var(--uni-border);
}

.uni-btn-outline:hover:not(:disabled) {
  background: var(--uni-surface-elevated);
}

.uni-btn-ghost {
  background: transparent;
  color: var(--uni-text-secondary);
  border-color: transparent;
}

.uni-btn-ghost:hover:not(:disabled) {
  color: var(--uni-text-primary);
  background: var(--uni-surface-elevated);
}

.uni-btn-destructive {
  background: var(--uni-danger-bg);
  color: var(--uni-danger-text);
  border-color: var(--uni-danger-border);
}

.uni-btn-destructive:hover:not(:disabled) {
  opacity: 0.9;
}

/* Icons and Spinners */
.btn-icon {
  font-size: 19px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.uni-btn-sm .btn-icon {
  font-size: 15px;
}

.uni-btn-icon .btn-icon {
  font-size: 21px;
}

.uni-btn-icon-sm .btn-icon {
  font-size: 18px;
}

.btn-spinner {
  width: 20px;
  height: 20px;
  --color: currentColor;
}
</style>
