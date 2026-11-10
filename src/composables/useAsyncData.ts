import { ref, computed, type Ref, type ComputedRef } from 'vue';

export type DataState = 'INITIAL_LOADING' | 'LOADED' | 'REFRESHING' | 'ERROR' | 'EMPTY';

export interface AsyncDataOptions<T> {
  initialData?: T | null;
  isEmpty?: (data: T) => boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: unknown) => void;
}

export interface UseAsyncDataReturn<T> {
  state: Ref<DataState>;
  data: Ref<T | null>;
  error: Ref<Error | null>;
  isInitialLoading: ComputedRef<boolean>;
  isRefreshing: ComputedRef<boolean>;
  isLoading: ComputedRef<boolean>;
  isStale: Ref<boolean>;
  lastUpdated: Ref<Date | null>;
  execute: (fetcher: () => Promise<T>) => Promise<T | null>;
  refresh: () => Promise<T | null>;
  reset: () => void;
  setData: (val: T | null) => void;
}

/**
 * Reusable async data loading composable for UniTap 2.0.
 * Guarantees responsive and polished transitions:
 * - Prevents premature zero values during initial loading.
 * - Preserves last known successful data during background refresh.
 * - Enforces request sequencing to prevent slower older requests from overwriting newer responses.
 * - Retains existing data and flags stale status when background refresh fails.
 * - Distinguishes between successful empty results (EMPTY) and failed fetches (ERROR).
 */
export function useAsyncData<T>(options: AsyncDataOptions<T> = {}): UseAsyncDataReturn<T> {
  const initial = options.initialData !== undefined ? options.initialData : null;
  const data = ref<T | null>(initial) as Ref<T | null>;
  const state = ref<DataState>(initial !== null ? 'LOADED' : 'INITIAL_LOADING');
  const error = ref<Error | null>(null);
  const isStale = ref(false);
  const lastUpdated = ref<Date | null>(initial !== null ? new Date() : null);

  let currentRequestId = 0;
  let lastFetcher: (() => Promise<T>) | null = null;

  const isInitialLoading = computed(() => state.value === 'INITIAL_LOADING');
  const isRefreshing = computed(() => state.value === 'REFRESHING');
  const isLoading = computed(() => isInitialLoading.value || isRefreshing.value);

  async function execute(fetcher: () => Promise<T>): Promise<T | null> {
    lastFetcher = fetcher;
    const thisRequestId = ++currentRequestId;

    // Transition state: if we already have valid data, enter REFRESHING without wiping data.
    // If no previous data exists, enter INITIAL_LOADING.
    if (data.value !== null) {
      state.value = 'REFRESHING';
    } else {
      state.value = 'INITIAL_LOADING';
    }

    try {
      const result = await fetcher();

      // Discard slower or out-of-sequence responses
      if (thisRequestId !== currentRequestId) {
        return null;
      }

      data.value = result;
      error.value = null;
      isStale.value = false;
      lastUpdated.value = new Date();

      const isEmpty = options.isEmpty
        ? options.isEmpty(result)
        : Array.isArray(result)
        ? result.length === 0
        : false;

      state.value = isEmpty ? 'EMPTY' : 'LOADED';

      if (options.onSuccess) {
        options.onSuccess(result);
      }

      return result;
    } catch (err: unknown) {
      // Discard out-of-sequence errors
      if (thisRequestId !== currentRequestId) {
        return null;
      }

      const normalizedError = err instanceof Error ? err : new Error(String(err));
      error.value = normalizedError;

      // Rule: If previous data exists, retain it and mark it as potentially outdated (stale).
      // Only switch to ERROR state if no previous data exists.
      if (data.value !== null) {
        isStale.value = true;
        state.value = 'LOADED';
      } else {
        state.value = 'ERROR';
      }

      if (options.onError) {
        options.onError(normalizedError);
      }

      return null;
    }
  }

  async function refresh(): Promise<T | null> {
    if (lastFetcher) {
      return execute(lastFetcher);
    }
    return null;
  }

  function reset() {
    currentRequestId++;
    data.value = initial;
    state.value = initial !== null ? 'LOADED' : 'INITIAL_LOADING';
    error.value = null;
    isStale.value = false;
    lastUpdated.value = null;
    lastFetcher = null;
  }

  function setData(val: T | null) {
    data.value = val;
    isStale.value = false;
    if (val !== null) {
      const isEmpty = options.isEmpty
        ? options.isEmpty(val)
        : Array.isArray(val)
        ? val.length === 0
        : false;
      state.value = isEmpty ? 'EMPTY' : 'LOADED';
      lastUpdated.value = new Date();
    } else {
      state.value = 'INITIAL_LOADING';
    }
  }

  return {
    state,
    data,
    error,
    isInitialLoading,
    isRefreshing,
    isLoading,
    isStale,
    lastUpdated,
    execute,
    refresh,
    reset,
    setData,
  };
}

