import { SupabaseAuthService } from '@/integrations/supabase/auth.service';

export function useAuth() {
  return {
    user: SupabaseAuthService.user,
    role: SupabaseAuthService.role,
    student: SupabaseAuthService.student,
    isOffline: SupabaseAuthService.isOffline,
    isAuthenticated: SupabaseAuthService.isAuthenticated,
    login: SupabaseAuthService.login.bind(SupabaseAuthService),
    registerStudent: SupabaseAuthService.registerStudent.bind(SupabaseAuthService),
    logout: SupabaseAuthService.logout.bind(SupabaseAuthService),
  };
}

