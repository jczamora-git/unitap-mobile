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

  return {
    user: SupabaseAuthService.user,
    role: SupabaseAuthService.role,
    student: SupabaseAuthService.student,
    isOffline: SupabaseAuthService.isOffline,
    isAuthenticated: SupabaseAuthService.isAuthenticated,
    isDevAdmin,
    isOfficer,
    login: SupabaseAuthService.login.bind(SupabaseAuthService),
    registerStudent: SupabaseAuthService.registerStudent.bind(SupabaseAuthService),
    validateActivationCode: AccountLinkingService.validateActivationCode.bind(AccountLinkingService),
    logout: SupabaseAuthService.logout.bind(SupabaseAuthService),
  };
}

