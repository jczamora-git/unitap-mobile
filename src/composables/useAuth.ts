import { computed } from 'vue';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { AccountLinkingService } from '@/integrations/supabase/account-linking.service';
import { authService } from '@/services/auth.service';

export function useAuth() {
  const isDevAdmin = computed(() => {
    return SupabaseAuthService.role.value === 'DEVADMIN' || authService.role.value === 'DEVADMIN';
  });

  const isOfficer = computed(() => {
    return SupabaseAuthService.role.value === 'OFFICER' || authService.role.value === 'OFFICER';
  });

  const availablePortals = computed(() => {
    return SupabaseAuthService.availablePortals.value.length > 0
      ? SupabaseAuthService.availablePortals.value
      : authService.availablePortals.value;
  });

  const availableRoles = computed(() => {
    return SupabaseAuthService.roles.value.length > 0
      ? SupabaseAuthService.roles.value
      : authService.roles.value;
  });

  const activeWorkspace = computed(() => {
    return SupabaseAuthService.activeWorkspace.value || authService.activeWorkspace.value || SupabaseAuthService.role.value || authService.role.value;
  });

  const canSwitchPortal = computed(() => availablePortals.value.length > 1);

  return {
    user: SupabaseAuthService.user,
    role: SupabaseAuthService.role,
    roles: availableRoles,
    availablePortals,
    activeWorkspace,
    canSwitchPortal,
    student: SupabaseAuthService.student,
    isOffline: SupabaseAuthService.isOffline,
    isAuthenticated: SupabaseAuthService.isAuthenticated,
    isDevAdmin,
    isOfficer,
    switchWorkspace: SupabaseAuthService.switchWorkspace.bind(SupabaseAuthService),
    login: SupabaseAuthService.login.bind(SupabaseAuthService),
    registerStudent: SupabaseAuthService.registerStudent.bind(SupabaseAuthService),
    validateActivationCode: AccountLinkingService.validateActivationCode.bind(AccountLinkingService),
    logout: SupabaseAuthService.logout.bind(SupabaseAuthService),
  };
}

