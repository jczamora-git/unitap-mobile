import { ref } from 'vue';
import { haptics } from '@/utilities/haptics';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastState {
  show: boolean;
  message: string;
  type: ToastType;
}

const toastState = ref<ToastState>({
  show: false,
  message: '',
  type: 'success'
});

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function useToast() {
  function showToast(
    message: string,
    type: ToastType = 'success',
    duration = 2200
  ) {
    if (toastTimer) {
      clearTimeout(toastTimer);
    }

    // Restrained haptic feedback
    if (type === 'success') {
      haptics.light();
    } else if (type === 'warning') {
      haptics.warning();
    } else if (type === 'error') {
      haptics.error();
    }

    toastState.value = {
      show: true,
      message,
      type
    };

    toastTimer = setTimeout(() => {
      toastState.value.show = false;
    }, duration);
  }

  function hideToast() {
    if (toastTimer) clearTimeout(toastTimer);
    toastState.value.show = false;
  }

  async function copyToClipboard(text: string, label = 'Copied'): Promise<boolean> {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      showToast(`${label} to clipboard`, 'success', 1800);
      return true;
    } catch {
      showToast('Failed to copy to clipboard', 'error', 2000);
      return false;
    }
  }

  return {
    toastState,
    showToast,
    hideToast,
    copyToClipboard
  };
}
