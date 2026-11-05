import { ref, computed } from 'vue';
import { NetworkService } from './network.service';
import {
  type OperationType,
  type PolicyMode,
  type OperationEvaluation,
  OPERATION_POLICIES,
  PolicyViolationError,
} from '@/types/policy';

/**
 * UniTap 2.0 Centralized Operation Policy Service (Phase 1)
 *
 * Enforces operation-level selective offline-first access rules across all
 * service entry points and presentation components.
 *
 * Rules:
 * - ATTENDANCE_SCAN: OFFLINE_OUTBOX (offline permitted with durable outbox)
 * - STUDENTS_READ / EVENTS_READ: CACHE_WITH_LIVE_REFRESH (cached reads permitted)
 * - REPORTS_READ: AUTHORIZED_CACHE_ALLOWED (cached reads permitted)
 * - All other mutations: ONLINE_CONFIRMED (strictly fail-closed when offline or unreachable)
 */
export class OperationPolicyService {
  private static mockOfflineOverride = ref<boolean | null>(null);

  /**
   * For testing purposes: allows unit tests to simulate offline mode deterministically.
   */
  public static setMockOfflineOverride(isOffline: boolean | null): void {
    this.mockOfflineOverride.value = isOffline;
  }

  /**
   * Returns current effective online status.
   */
  public static get isOnline() {
    return computed<boolean>(() => {
      if (this.mockOfflineOverride.value !== null) {
        return !this.mockOfflineOverride.value;
      }
      return NetworkService.isOnline.value;
    });
  }

  /**
   * Retrieves the policy mode for a given operation.
   */
  public static getPolicyMode(operation: OperationType): PolicyMode {
    return OPERATION_POLICIES[operation]?.mode || 'ONLINE_CONFIRMED';
  }

  /**
   * Fast synchronous evaluation for UI elements (button disablement, badge indicators).
   */
  public static isPermittedSync(operation: OperationType): boolean {
    const mode = this.getPolicyMode(operation);
    if (mode === 'OFFLINE_OUTBOX' || mode === 'CACHE_WITH_LIVE_REFRESH' || mode === 'AUTHORIZED_CACHE_ALLOWED') {
      return true;
    }
    // ONLINE_CONFIRMED requires active connection
    return this.isOnline.value;
  }

  /**
   * Returns a user-friendly explanatory reason when an operation is currently disabled.
   */
  public static getDisabledReason(operation: OperationType): string | undefined {
    if (this.isPermittedSync(operation)) {
      return undefined;
    }
    const def = OPERATION_POLICIES[operation];
    return def?.offlineErrorMessage || 'This operation requires an active internet connection.';
  }

  /**
   * Comprehensive asynchronous evaluation: verifies connectivity, cloud reachability, and session.
   */
  public static async evaluateOperation(operation: OperationType): Promise<OperationEvaluation> {
    const mode = this.getPolicyMode(operation);

    // 1. Offline-capable or cache-allowed operations
    if (mode === 'OFFLINE_OUTBOX' || mode === 'CACHE_WITH_LIVE_REFRESH' || mode === 'AUTHORIZED_CACHE_ALLOWED') {
      return { permitted: true, mode, code: 'OK' };
    }

    // 2. Connectivity check (prerequisite for ONLINE_CONFIRMED)
    if (!this.isOnline.value) {
      return {
        permitted: false,
        mode,
        code: 'OFFLINE_BLOCKED',
        reason: OPERATION_POLICIES[operation]?.offlineErrorMessage || 'Offline: operation blocked by policy.',
      };
    }

    // 3. Server reachability check (fast probe)
    if (this.mockOfflineOverride.value === null) {
      const isReachable = await NetworkService.checkServerReachability(2500);
      if (!isReachable) {
        return {
          permitted: false,
          mode,
          code: 'SERVER_UNREACHABLE',
          reason: 'Cloud server is temporarily unreachable. Live confirmation unavailable.',
        };
      }
    }

    return { permitted: true, mode, code: 'OK' };
  }

  /**
   * Core assertion guard for service mutation entry points.
   * Throws PolicyViolationError if the operation is not permitted.
   */
  public static async assertPermitted(operation: OperationType): Promise<void> {
    const evalResult = await this.evaluateOperation(operation);
    if (!evalResult.permitted) {
      throw new PolicyViolationError(
        evalResult.code as 'OFFLINE_BLOCKED' | 'SERVER_UNREACHABLE' | 'UNAUTHORIZED',
        operation,
        evalResult.reason
      );
    }
  }
}

