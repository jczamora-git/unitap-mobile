import { computed } from 'vue';
import { OperationPolicyService } from '@/services/operation-policy.service';
import type { OperationType, PolicyMode } from '@/types/policy';

/**
 * UniTap 2.0 Vue Composable for Operation-Level Policies (Phase 1)
 *
 * Provides reactive bindings for views to disable actions, show offline explanations,
 * and enforce the centralized selective offline-first policy.
 */
export function useOperationPolicy() {
  const isOnline = OperationPolicyService.isOnline;

  function isPermitted(operation: OperationType) {
    return computed(() => OperationPolicyService.isPermittedSync(operation));
  }

  function getDisabledReason(operation: OperationType) {
    return computed(() => OperationPolicyService.getDisabledReason(operation));
  }

  function getPolicyMode(operation: OperationType): PolicyMode {
    return OperationPolicyService.getPolicyMode(operation);
  }

  async function assertPermitted(operation: OperationType): Promise<void> {
    return OperationPolicyService.assertPermitted(operation);
  }

  return {
    isOnline,
    isPermitted,
    getDisabledReason,
    getPolicyMode,
    assertPermitted,
  };
}

