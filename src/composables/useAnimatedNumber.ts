import { ref, computed, watch, onBeforeUnmount, getCurrentInstance, type Ref } from 'vue';
import { formatPeso } from '@/utilities/finance-formatters';

export type NumberFormatType = 'number' | 'currency' | 'percent' | 'decimal' | 'raw';

export interface UseAnimatedNumberOptions {
  duration?: number;
  easing?: (t: number) => number;
  format?: NumberFormatType;
  decimals?: number;
  currencySymbol?: string;
  isCentavos?: boolean;
  animateInitial?: boolean;
  formatter?: (val: number) => string;
}

/**
 * Natural cubic ease-out easing curve: fast start, soft organic landing.
 */
function cubicOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Checks if the user has requested reduced motion.
 */
function isReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Composable for animating numeric transitions smoothly over 500–800ms.
 */
export function useAnimatedNumber(
  targetValue: Ref<number | string | null | undefined>,
  options: UseAnimatedNumberOptions = {}
) {
  const duration = options.duration ?? 650;
  const easing = options.easing ?? cubicOut;
  const format = options.format ?? 'number';
  const decimals = options.decimals ?? (format === 'decimal' || format === 'currency' ? 2 : 0);
  const currencySymbol = options.currencySymbol ?? '₱';
  const isCentavos = options.isCentavos ?? false;
  const animateInitial = options.animateInitial ?? true;

  // Extract raw numeric value from input
  function parseNumeric(val: number | string | null | undefined): number {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') {
      return Number.isFinite(val) ? val : 0;
    }
    const cleanStr = String(val).replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleanStr);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const initialNum = parseNumeric(targetValue.value);
  const currentNumber = ref(animateInitial ? 0 : initialNum);
  const isAnimating = ref(false);

  let rafId: number | null = null;
  let previousTarget: number | null = animateInitial ? null : initialNum;

  function formatValue(val: number): string {
    if (options.formatter) {
      return options.formatter(val);
    }

    if (format === 'currency') {
      if (isCentavos) {
        return formatPeso(Math.round(val));
      }
      const isNegative = val < 0;
      const absVal = Math.abs(val);
      const formatted = absVal.toLocaleString('en-PH', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      return isNegative ? `-${currencySymbol}${formatted}` : `${currencySymbol}${formatted}`;
    }

    if (format === 'percent') {
      const rounded = decimals > 0 ? val.toFixed(decimals) : Math.round(val).toString();
      return `${rounded}%`;
    }

    if (format === 'decimal') {
      return val.toLocaleString('en-PH', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }

    if (format === 'raw') {
      return val.toString();
    }

    // Default 'number' format (whole numbers with commas)
    return Math.round(val).toLocaleString('en-PH');
  }

  const formattedValue = computed(() => formatValue(currentNumber.value));

  function cancelAnimation() {
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    isAnimating.value = false;
  }

  function startAnimation(fromVal: number, toVal: number) {
    cancelAnimation();

    if (isReducedMotion() || typeof requestAnimationFrame !== 'function') {
      currentNumber.value = toVal;
      return;
    }

    isAnimating.value = true;
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    function step(timestamp: number) {
      const elapsed = timestamp - startTime;
      const progress = Math.min(Math.max(elapsed / duration, 0), 1);
      const eased = easing(progress);

      currentNumber.value = fromVal + (toVal - fromVal) * eased;

      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        currentNumber.value = toVal;
        isAnimating.value = false;
        rafId = null;
      }
    }

    rafId = requestAnimationFrame(step);
  }

  watch(
    () => parseNumeric(targetValue.value),
    (newVal) => {
      // Avoid restarting animations when numeric value hasn't changed
      if (previousTarget !== null && newVal === previousTarget) {
        return;
      }

      const startVal = currentNumber.value;
      previousTarget = newVal;

      if (previousTarget === null && !animateInitial) {
        currentNumber.value = newVal;
      } else {
        startAnimation(startVal, newVal);
      }
    },
    { immediate: true }
  );

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      cancelAnimation();
    });
  }

  return {
    currentNumber,
    formattedValue,
    isAnimating,
    cancelAnimation,
  };
}
