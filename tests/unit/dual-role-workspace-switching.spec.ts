import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { authService } from '@/services/auth.service';
import { useAuth } from '@/composables/useAuth';
import { OfficerManagementService } from '@/services/officer-management.service';
import { Preferences } from '@capacitor/preferences';
import { supabase } from '@/integrations/supabase/client';

describe('UniTap 2.0 Dual-Role Workspace Detection and Portal Switching', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await Preferences.clear();
    await Preferences.remove({ key: 'unitap_active_workspace' });
    await Preferences.remove({ key: 'unitap_auth_session_v2' });
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }

    // Reset services state
    (SupabaseAuthService as any).currentUser.value = null;
    (SupabaseAuthService as any).currentRole.value = null;
    (SupabaseAuthService as any).currentRoles.value = [];
    (SupabaseAuthService as any).currentAvailablePortals.value = [];
    (SupabaseAuthService as any).currentActiveWorkspace.value = null;
    (SupabaseAuthService as any).currentStudent.value = null;

    (authService as any).currentUser.value = null;
    (authService as any).currentRole.value = null;
    (authService as any).currentRoles.value = [];
    (authService as any).currentWorkspace.value = null;
    (authService as any).currentStudent.value = null;
  });

  function setupSupabaseMocks(options: {
    user: any;
    roles: ('DEVADMIN' | 'OFFICER' | 'STUDENT')[];
    student?: any;
  }) {
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: options.user,
                error: null,
              }),
            }),
          }),
        } as any;
      }
      if (table === 'user_roles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({
                data: options.roles.map((r, i) => ({
                  id: `role_${i}`,
                  role: r,
                  semester_id: 'sem_2026_2027_1',
                  assigned_at: '2026-11-01T00:00:00Z',
                  revoked_at: null,
                })),
                error: null,
              }),
            }),
          }),
        } as any;
      }
      if (table === 'students') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: options.student || null,
                error: null,
              }),
            }),
          }),
        } as any;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    });
  }

  it('correctly resolves both OFFICER and STUDENT portals for dual-role user', async () => {
    vi.spyOn(OfficerManagementService, 'hasValidOfficerAppointment').mockResolvedValue(true);

    const mockUser = {
      id: '2c870f93-4387-4aca-8c87-a2480c9a2a89',
      username: 'mcc2026-0256',
      email: 'mcc2026-0256@unitap.com',
      account_status: 'ACTIVE' as const,
      student_id: '522717fc-100c-43f5-ba69-c6f0a6af1996',
    };

    const mockStudent = {
      id: '522717fc-100c-43f5-ba69-c6f0a6af1996',
      school_id: 'MCC2026-0256',
      student_id_number: 'MCC2026-0256',
      first_name: 'Althea',
      last_name: 'Abella',
      status: 'ACTIVE' as const,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    };

    setupSupabaseMocks({
      user: mockUser,
      roles: ['STUDENT', 'OFFICER'],
      student: mockStudent,
    });

    // Hydrate online session
    await (SupabaseAuthService as any).handleOnlineSession(mockUser.id, mockUser.email);

    const { availablePortals, canSwitchPortal, activeWorkspace, isOfficer, isStudent } = useAuth();

    expect(availablePortals.value).toContain('OFFICER');
    expect(availablePortals.value).toContain('STUDENT');
    expect(availablePortals.value.length).toBe(2);
    expect(canSwitchPortal.value).toBe(true);

    // Initial fallback should default to STUDENT workspace when no saved preference exists while keeping OFFICER available
    expect(activeWorkspace.value).toBe('STUDENT');
    expect(isStudent.value).toBe(true);
    expect(isOfficer.value).toBe(false);
  });

  it('restricts single-role STUDENT user to STUDENT portal without switcher', async () => {
    vi.spyOn(OfficerManagementService, 'hasValidOfficerAppointment').mockResolvedValue(false);

    const mockUser = {
      id: 'student-only-id',
      username: 'student123',
      email: 'student123@unitap.com',
      account_status: 'ACTIVE' as const,
      student_id: 'student-profile-id',
    };

    const mockStudent = {
      id: 'student-profile-id',
      school_id: 'MCC2026-9999',
      student_id_number: 'MCC2026-9999',
      first_name: 'Juan',
      last_name: 'Dela Cruz',
      status: 'ACTIVE' as const,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    };

    setupSupabaseMocks({
      user: mockUser,
      roles: ['STUDENT'],
      student: mockStudent,
    });

    await (SupabaseAuthService as any).handleOnlineSession(mockUser.id, mockUser.email);

    const { availablePortals, canSwitchPortal, activeWorkspace, isOfficer, isStudent } = useAuth();

    expect(availablePortals.value).toEqual(['STUDENT']);
    expect(canSwitchPortal.value).toBe(false);
    expect(activeWorkspace.value).toBe('STUDENT');
    expect(isStudent.value).toBe(true);
    expect(isOfficer.value).toBe(false);
  });

  it('restricts single-role OFFICER user to OFFICER portal without switcher', async () => {
    vi.spyOn(OfficerManagementService, 'hasValidOfficerAppointment').mockResolvedValue(true);

    const mockUser = {
      id: 'officer-only-id',
      username: 'officer123',
      email: 'officer123@unitap.com',
      account_status: 'ACTIVE' as const,
      student_id: null,
    };

    setupSupabaseMocks({
      user: mockUser,
      roles: ['OFFICER'],
      student: null,
    });

    await (SupabaseAuthService as any).handleOnlineSession(mockUser.id, mockUser.email);

    const { availablePortals, canSwitchPortal, activeWorkspace, isOfficer, isStudent } = useAuth();

    expect(availablePortals.value).toEqual(['OFFICER']);
    expect(canSwitchPortal.value).toBe(false);
    expect(activeWorkspace.value).toBe('OFFICER');
    expect(isOfficer.value).toBe(true);
    expect(isStudent.value).toBe(false);
  });

  it('switches dynamically between OFFICER and STUDENT workspaces and persists preference', async () => {
    vi.spyOn(OfficerManagementService, 'hasValidOfficerAppointment').mockResolvedValue(true);

    const mockUser = {
      id: '2c870f93-4387-4aca-8c87-a2480c9a2a89',
      username: 'mcc2026-0256',
      email: 'mcc2026-0256@unitap.com',
      account_status: 'ACTIVE' as const,
      student_id: '522717fc-100c-43f5-ba69-c6f0a6af1996',
    };

    const mockStudent = {
      id: '522717fc-100c-43f5-ba69-c6f0a6af1996',
      school_id: 'MCC2026-0256',
      student_id_number: 'MCC2026-0256',
      first_name: 'Althea',
      last_name: 'Abella',
      status: 'ACTIVE' as const,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    };

    setupSupabaseMocks({
      user: mockUser,
      roles: ['STUDENT', 'OFFICER'],
      student: mockStudent,
    });

    await (SupabaseAuthService as any).handleOnlineSession(mockUser.id, mockUser.email);

    const { activeWorkspace, switchWorkspace, isOfficer, isStudent, student } = useAuth();

    // Default to STUDENT workspace if no saved preference exists
    expect(activeWorkspace.value).toBe('STUDENT');
    expect(isStudent.value).toBe(true);
    expect(isOfficer.value).toBe(false);

    // Switch to OFFICER workspace
    await switchWorkspace('OFFICER');

    expect(activeWorkspace.value).toBe('OFFICER');
    expect(isOfficer.value).toBe(true);
    expect(isStudent.value).toBe(false);

    // Verify preference persisted
    const storedPref = await Preferences.get({ key: 'unitap_active_workspace' });
    expect(storedPref.value).toBe('OFFICER');

    // Switch back to STUDENT workspace
    await switchWorkspace('STUDENT');

    expect(activeWorkspace.value).toBe('STUDENT');
    expect(isStudent.value).toBe(true);
    expect(isOfficer.value).toBe(false);
    // Student identity must be preserved
    expect(student.value?.id).toBe('522717fc-100c-43f5-ba69-c6f0a6af1996');

    const storedPrefStudent = await Preferences.get({ key: 'unitap_active_workspace' });
    expect(storedPrefStudent.value).toBe('STUDENT');
  });

  it('rejects unauthorized workspace switch attempts', async () => {
    vi.spyOn(OfficerManagementService, 'hasValidOfficerAppointment').mockResolvedValue(false);

    const mockUser = {
      id: 'student-only-id',
      username: 'student123',
      email: 'student123@unitap.com',
      account_status: 'ACTIVE' as const,
      student_id: 'student-profile-id',
    };

    setupSupabaseMocks({
      user: mockUser,
      roles: ['STUDENT'],
      student: null,
    });

    await (SupabaseAuthService as any).handleOnlineSession(mockUser.id, mockUser.email);

    const { switchWorkspace } = useAuth();

    await expect(switchWorkspace('DEVADMIN')).rejects.toThrow('Unauthorized portal');
    await expect(switchWorkspace('OFFICER')).rejects.toThrow('Unauthorized portal');
  });

  it('excludes OFFICER portal when officer appointment is revoked or expired', async () => {
    // Appointment check returns false (e.g. revoked or expired)
    vi.spyOn(OfficerManagementService, 'hasValidOfficerAppointment').mockResolvedValue(false);

    const mockUser = {
      id: '2c870f93-4387-4aca-8c87-a2480c9a2a89',
      username: 'mcc2026-0256',
      email: 'mcc2026-0256@unitap.com',
      account_status: 'ACTIVE' as const,
      student_id: '522717fc-100c-43f5-ba69-c6f0a6af1996',
    };

    const mockStudent = {
      id: '522717fc-100c-43f5-ba69-c6f0a6af1996',
      school_id: 'MCC2026-0256',
      student_id_number: 'MCC2026-0256',
      first_name: 'Althea',
      last_name: 'Abella',
      status: 'ACTIVE' as const,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    };

    setupSupabaseMocks({
      user: mockUser,
      roles: ['STUDENT', 'OFFICER'],
      student: mockStudent,
    });

    await (SupabaseAuthService as any).handleOnlineSession(mockUser.id, mockUser.email);

    const { availablePortals, canSwitchPortal, activeWorkspace } = useAuth();

    // Since appointment is invalid/expired, only STUDENT portal should be granted
    expect(availablePortals.value).toEqual(['STUDENT']);
    expect(canSwitchPortal.value).toBe(false);
    expect(activeWorkspace.value).toBe('STUDENT');
  });

  it('officer without separate STUDENT role record accesses both portals when student linkage exists', async () => {
    vi.spyOn(OfficerManagementService, 'hasValidOfficerAppointment').mockResolvedValue(true);

    const mockUser = {
      id: 'officer-student-link-only',
      username: 'officer-student',
      email: 'officer-student@unitap.com',
      account_status: 'ACTIVE' as const,
      student_id: 'stu_officer_link_unique_01',
    };

    const mockStudent = {
      id: 'stu_officer_link_unique_01',
      school_id: 'MCC2026-0888',
      student_id_number: 'MCC2026-0888',
      first_name: 'UniqueOfficer',
      last_name: 'Student',
      status: 'ACTIVE' as const,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    };

    // User has ONLY 'OFFICER' role in user_roles table (NO STUDENT role row)
    setupSupabaseMocks({
      user: mockUser,
      roles: ['OFFICER'],
      student: mockStudent,
    });

    await (SupabaseAuthService as any).handleOnlineSession(mockUser.id, mockUser.email);

    const { availablePortals, canSwitchPortal, activeWorkspace } = useAuth();

    expect(availablePortals.value).toContain('OFFICER');
    expect(availablePortals.value).toContain('STUDENT');
    expect(canSwitchPortal.value).toBe(true);
    // Defaults to STUDENT portal when no saved preference exists
    expect(activeWorkspace.value).toBe('STUDENT');
  });

  it('restricts DEVADMIN user exclusively to DEVADMIN portal', async () => {
    const mockUser = {
      id: 'devadmin-uuid',
      username: 'devadmin',
      email: 'admin@unitap.com',
      account_status: 'ACTIVE' as const,
      student_id: null,
    };

    setupSupabaseMocks({
      user: mockUser,
      roles: ['DEVADMIN'],
      student: null,
    });

    await (SupabaseAuthService as any).handleOnlineSession(mockUser.id, mockUser.email);

    const { availablePortals, canSwitchPortal, activeWorkspace, isDevAdmin } = useAuth();

    expect(availablePortals.value).toEqual(['DEVADMIN']);
    expect(canSwitchPortal.value).toBe(false);
    expect(activeWorkspace.value).toBe('DEVADMIN');
    expect(isDevAdmin.value).toBe(true);
  });
});
