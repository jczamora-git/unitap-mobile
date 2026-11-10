import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { useAsyncData } from '@/composables/useAsyncData';
import { useAnimatedNumber } from '@/composables/useAnimatedNumber';

describe('UniTap 2.0 Data Loading Experience & Dashboard Value Transitions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1. Initial Loading States
  // --------------------------------------------------------------------------
  it('1. Initial loading starts in INITIAL_LOADING without displaying zero prematurely', () => {
    const resource = useAsyncData<{ count: number }>();

    expect(resource.state.value).toBe('INITIAL_LOADING');
    expect(resource.isInitialLoading.value).toBe(true);
    expect(resource.isRefreshing.value).toBe(false);
    expect(resource.isLoading.value).toBe(true);
    expect(resource.data.value).toBeNull();
    expect(resource.error.value).toBeNull();
    expect(resource.isStale.value).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 2. Background Refresh Preserving Previous Values
  // --------------------------------------------------------------------------
  it('2. Refresh preserves previous loaded values while new request is pending', async () => {
    const resource = useAsyncData<{ count: number }>();

    // Initial successful fetch
    await resource.execute(async () => ({ count: 125 }));

    expect(resource.state.value).toBe('LOADED');
    expect(resource.data.value).toEqual({ count: 125 });
    expect(resource.isInitialLoading.value).toBe(false);

    // Trigger background refresh with a delayed fetcher
    let resolveRefresh: (val: { count: number }) => void = () => {};
    const refreshPromise = new Promise<{ count: number }>((resolve) => {
      resolveRefresh = resolve;
    });

    const pendingExecution = resource.execute(() => refreshPromise);

    // During background refresh:
    expect(resource.state.value).toBe('REFRESHING');
    expect(resource.isRefreshing.value).toBe(true);
    expect(resource.isInitialLoading.value).toBe(false);
    expect(resource.isLoading.value).toBe(true);
    // Crucial: Existing data MUST NOT be wiped to null or replaced with zero!
    expect(resource.data.value).toEqual({ count: 125 });

    // Settle refresh
    resolveRefresh({ count: 130 });
    await pendingExecution;

    expect(resource.state.value).toBe('LOADED');
    expect(resource.isRefreshing.value).toBe(false);
    expect(resource.data.value).toEqual({ count: 130 });
  });

  // --------------------------------------------------------------------------
  // 3. Successful Empty Response Displaying Actual Zero
  // --------------------------------------------------------------------------
  it('3. Successful empty response displays actual zero and transitions to EMPTY state', async () => {
    const resource = useAsyncData<{ studentsCount: number; records: string[] }>({
      isEmpty: (res) => res.studentsCount === 0 || res.records.length === 0,
    });

    await resource.execute(async () => ({
      studentsCount: 0,
      records: [],
    }));

    expect(resource.state.value).toBe('EMPTY');
    expect(resource.data.value).toEqual({ studentsCount: 0, records: [] });
    expect(resource.error.value).toBeNull();
    expect(resource.isStale.value).toBe(false);
    expect(resource.isInitialLoading.value).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 4. Failed Request Preserving Last Successful Data
  // --------------------------------------------------------------------------
  it('4. Failed request preserves last successful data and marks it as stale', async () => {
    const resource = useAsyncData<{ balanceCentavos: number }>();

    // Step A: Initial successful load
    await resource.execute(async () => ({ balanceCentavos: 50000 }));
    expect(resource.data.value).toEqual({ balanceCentavos: 50000 });
    expect(resource.isStale.value).toBe(false);

    // Step B: Subsequent refresh fails with network error
    const failedResult = await resource.execute(async () => {
      throw new Error('Supabase fetch failed: 503 Service Unavailable');
    });

    expect(failedResult).toBeNull();
    // Rule: Retain previous data and mark it as potentially outdated (stale)
    expect(resource.data.value).toEqual({ balanceCentavos: 50000 });
    expect(resource.isStale.value).toBe(true);
    expect(resource.error.value?.message).toContain('503 Service Unavailable');
    expect(resource.state.value).toBe('LOADED');
    expect(resource.isRefreshing.value).toBe(false);
  });

  it('4b. Initial failed request with no previous data shows ERROR state', async () => {
    const resource = useAsyncData<{ balanceCentavos: number }>();

    await resource.execute(async () => {
      throw new Error('Initial connection failed');
    });

    expect(resource.data.value).toBeNull();
    expect(resource.state.value).toBe('ERROR');
    expect(resource.error.value?.message).toBe('Initial connection failed');
    expect(resource.isStale.value).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 5. Race Condition: Slow Requests Not Overwriting Newer Results
  // --------------------------------------------------------------------------
  it('5. Slow requests do not overwrite newer successful responses', async () => {
    const resource = useAsyncData<{ queryId: string; version: number }>();

    let resolveSlow: (val: { queryId: string; version: number }) => void = () => {};
    const slowPromise = new Promise<{ queryId: string; version: number }>((resolve) => {
      resolveSlow = resolve;
    });

    let resolveFast: (val: { queryId: string; version: number }) => void = () => {};
    const fastPromise = new Promise<{ queryId: string; version: number }>((resolve) => {
      resolveFast = resolve;
    });

    // Request 1 starts (slow)
    const exec1 = resource.execute(() => slowPromise);

    // Request 2 starts later (fast)
    const exec2 = resource.execute(() => fastPromise);

    // Fast request 2 finishes first
    resolveFast({ queryId: 'req_2', version: 2 });
    await exec2;

    expect(resource.data.value).toEqual({ queryId: 'req_2', version: 2 });

    // Slow request 1 finishes afterward
    resolveSlow({ queryId: 'req_1', version: 1 });
    await exec1;

    // Must still retain request 2's fresh result!
    expect(resource.data.value).toEqual({ queryId: 'req_2', version: 2 });
  });

  // --------------------------------------------------------------------------
  // 6. Animated Number Transitions
  // --------------------------------------------------------------------------
  describe('6. Animated Number Transitions', () => {
    it('formats whole numbers, percentages, decimals, and negative values', () => {
      const target = ref<number | string>(1250);
      const counterNumber = useAnimatedNumber(target, { format: 'number', animateInitial: false });
      expect(counterNumber.formattedValue.value).toBe('1,250');

      const targetPct = ref(85);
      const counterPct = useAnimatedNumber(targetPct, { format: 'percent', animateInitial: false });
      expect(counterPct.formattedValue.value).toBe('85%');

      const targetDec = ref(3.14159);
      const counterDec = useAnimatedNumber(targetDec, { format: 'decimal', decimals: 2, animateInitial: false });
      expect(counterDec.formattedValue.value).toBe('3.14');

      const targetNeg = ref(-42);
      const counterNeg = useAnimatedNumber(targetNeg, { format: 'number', animateInitial: false });
      expect(counterNeg.formattedValue.value).toBe('-42');
    });

    it('formats currency correctly in integer centavos and handles negative balances', () => {
      const centavosTarget = ref(125050); // ₱1,250.50
      const counterCurrency = useAnimatedNumber(centavosTarget, {
        format: 'currency',
        isCentavos: true,
        animateInitial: false,
      });
      expect(counterCurrency.formattedValue.value).toContain('1,250.50');
      expect(counterCurrency.formattedValue.value).toContain('₱');

      const negativeTarget = ref(-5000); // -₱50.00
      const counterNegative = useAnimatedNumber(negativeTarget, {
        format: 'currency',
        isCentavos: true,
        animateInitial: false,
      });
      expect(counterNegative.formattedValue.value).toContain('50.00');
      expect(counterNegative.formattedValue.value).toContain('-');
    });

    it('does not re-trigger animation when identical value is assigned', async () => {
      const target = ref(100);
      const counter = useAnimatedNumber(target, { animateInitial: false });

      expect(counter.currentNumber.value).toBe(100);
      expect(counter.isAnimating.value).toBe(false);

      // Reassigning same value should not restart animation
      target.value = 100;
      await nextTick();
      expect(counter.isAnimating.value).toBe(false);
    });

    it('immediately sets value without animation when prefers-reduced-motion is enabled', async () => {
      // Mock window.matchMedia for reduced motion
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const target = ref(0);
      const counter = useAnimatedNumber(target, { animateInitial: false });

      target.value = 500;
      await nextTick();

      // Because reduced motion is enabled, value immediately jumps to 500 without RAF looping
      expect(counter.currentNumber.value).toBe(500);
      expect(counter.isAnimating.value).toBe(false);

      window.matchMedia = originalMatchMedia;
    });
  });
});

