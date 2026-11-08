import { OfficerRepository, type OfficerListRecord } from '@/database/repositories/officer.repository';
import { AuthRepository } from '@/database/repositories/auth.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { StudentActivationService } from './student-activation.service';
import { OperationPolicyService } from './operation-policy.service';
import { DataModeService } from './data-mode.service';
import type {
  OfficerAppointmentRecord,
  OfficerPermissionPreset,
  OfficerScopeType,
  OfficerStatus,
  UserRoleRecord,
} from '@/types/database';

export const OFFICER_PERMISSIONS = {
  // Attendance Capabilities
  STUDENTS_VIEW: 'students.view_assigned',
  STUDENTS_IMPORT: 'students.import',
  EVENTS_VIEW: 'events.view_assigned',
  EVENTS_CREATE: 'events.create',
  EVENTS_EDIT: 'events.edit_assigned',
  ATTENDANCE_SCAN: 'attendance.scan',
  ATTENDANCE_CONFIRM: 'attendance.confirm',
  ATTENDANCE_REVOKE: 'attendance.revoke',
  ATTENDANCE_ABSENTEES: 'attendance.absentees',
  ATTENDANCE_REPORTS: 'attendance.reports',

  // Finance Capabilities
  FINANCE_OBLIGATIONS_VIEW: 'obligations.view',
  FINANCE_FINES_VIEW: 'fines.view',
  FINANCE_CONTRIBUTIONS_VIEW: 'contributions.view',
  FINANCE_FINES_MANAGE: 'fines.templates.manage',
  FINANCE_FINES_ASSESS: 'fines.assess',
  FINANCE_CONTRIBUTIONS_MANAGE: 'contributions.templates.manage',
  FINANCE_CONTRIBUTIONS_ASSIGN: 'contributions.assign',
  PAYMENTS_RECORD: 'payments.record',
  PAYMENTS_RAPID: 'payments.rapid_collection',
  PAYMENTS_HISTORY: 'payments.history',
  PAYMENTS_REVERSE: 'payments.reverse',
  PAYMENTS_REPORTS: 'payments.reports',
} as const;

export const PRESET_DEFINITIONS: Record<OfficerPermissionPreset, string[]> = {
  ATTENDANCE: [
    OFFICER_PERMISSIONS.STUDENTS_VIEW,
    OFFICER_PERMISSIONS.EVENTS_VIEW,
    OFFICER_PERMISSIONS.ATTENDANCE_SCAN,
    OFFICER_PERMISSIONS.ATTENDANCE_CONFIRM,
    OFFICER_PERMISSIONS.ATTENDANCE_REVOKE,
    OFFICER_PERMISSIONS.ATTENDANCE_ABSENTEES,
    OFFICER_PERMISSIONS.ATTENDANCE_REPORTS,
  ],
  FINANCE: [
    OFFICER_PERMISSIONS.STUDENTS_VIEW,
    OFFICER_PERMISSIONS.FINANCE_OBLIGATIONS_VIEW,
    OFFICER_PERMISSIONS.FINANCE_FINES_VIEW,
    OFFICER_PERMISSIONS.FINANCE_CONTRIBUTIONS_VIEW,
    OFFICER_PERMISSIONS.PAYMENTS_RECORD,
    OFFICER_PERMISSIONS.PAYMENTS_RAPID,
    OFFICER_PERMISSIONS.PAYMENTS_HISTORY,
    OFFICER_PERMISSIONS.PAYMENTS_REPORTS,
  ],
  FULL: [
    OFFICER_PERMISSIONS.STUDENTS_VIEW,
    OFFICER_PERMISSIONS.STUDENTS_IMPORT,
    OFFICER_PERMISSIONS.EVENTS_VIEW,
    OFFICER_PERMISSIONS.EVENTS_CREATE,
    OFFICER_PERMISSIONS.EVENTS_EDIT,
    OFFICER_PERMISSIONS.ATTENDANCE_SCAN,
    OFFICER_PERMISSIONS.ATTENDANCE_CONFIRM,
    OFFICER_PERMISSIONS.ATTENDANCE_REVOKE,
    OFFICER_PERMISSIONS.ATTENDANCE_ABSENTEES,
    OFFICER_PERMISSIONS.ATTENDANCE_REPORTS,
    OFFICER_PERMISSIONS.FINANCE_OBLIGATIONS_VIEW,
    OFFICER_PERMISSIONS.FINANCE_FINES_MANAGE,
    OFFICER_PERMISSIONS.FINANCE_FINES_ASSESS,
    OFFICER_PERMISSIONS.FINANCE_CONTRIBUTIONS_MANAGE,
    OFFICER_PERMISSIONS.FINANCE_CONTRIBUTIONS_ASSIGN,
    OFFICER_PERMISSIONS.PAYMENTS_RECORD,
    OFFICER_PERMISSIONS.PAYMENTS_RAPID,
    OFFICER_PERMISSIONS.PAYMENTS_REVERSE,
    OFFICER_PERMISSIONS.PAYMENTS_REPORTS,
  ],
  CUSTOM: [],
};

export interface CreateExistingStudentOfficerDto {
  studentId: string;
  userId: string;
  fullName: string;
  email: string;
  permissionPreset: OfficerPermissionPreset;
  customPermissions?: string[];
  academicYearId?: string;
  semesterId?: string;
  startDate: string;
  endDate: string;
  scopeType?: OfficerScopeType;
  scopeId?: string;
  devAdminUserId: string;
}

export interface PrepareImportedStudentOfficerDto {
  studentId: string;
  fullName: string;
  email: string;
  permissionPreset: OfficerPermissionPreset;
  customPermissions?: string[];
  academicYearId?: string;
  semesterId?: string;
  startDate: string;
  endDate: string;
  scopeType?: OfficerScopeType;
  scopeId?: string;
  devAdminUserId: string;
}

export interface InviteNewOfficerDto {
  fullName: string;
  email: string;
  permissionPreset: OfficerPermissionPreset;
  customPermissions?: string[];
  academicYearId?: string;
  semesterId?: string;
  startDate: string;
  endDate: string;
  scopeType?: OfficerScopeType;
  scopeId?: string;
  devAdminUserId: string;
}

export class OfficerManagementService {
  /**
   * Scenario A: Promote or assign an existing registered student as Officer.
   * Does NOT duplicate Auth account or delete STUDENT role.
   */
  public static async assignExistingStudentAsOfficer(
    dto: CreateExistingStudentOfficerDto
  ): Promise<{ success: boolean; appointment: OfficerAppointmentRecord; error?: string }> {
    try {
      await OperationPolicyService.assertPermitted('OFFICER_MANAGEMENT_AND_PERMISSIONS');

      const student = await StudentsRepository.getStudentById(dto.studentId);
      if (!student) {
        return { success: false, appointment: null as any, error: 'Student record not found.' };
      }

      const user = await AuthRepository.getUserById(dto.userId);
      if (!user) {
        return { success: false, appointment: null as any, error: 'Associated user account not found.' };
      }

      // Check if already an active officer
      const existingAppt = await OfficerRepository.getAppointmentByUserId(dto.userId);
      if (existingAppt && existingAppt.status === 'ACTIVE') {
        return { success: false, appointment: null as any, error: 'User is already an active Officer.' };
      }

      const now = new Date().toISOString();
      const apptId = 'appt_' + Math.random().toString(36).substring(2, 10);
      const permissions = dto.permissionPreset === 'CUSTOM'
        ? (dto.customPermissions || [])
        : PRESET_DEFINITIONS[dto.permissionPreset];

      const appointment: OfficerAppointmentRecord = {
        id: apptId,
        user_id: dto.userId,
        student_id: dto.studentId,
        full_name: dto.fullName.trim(),
        email: dto.email.trim().toLowerCase(),
        permission_preset: dto.permissionPreset,
        custom_permissions_json: JSON.stringify(permissions),
        academic_year_id: dto.academicYearId || null,
        semester_id: dto.semesterId || null,
        appointment_start: dto.startDate,
        appointment_end: dto.endDate,
        scope_type: dto.scopeType || 'ORGANIZATION',
        scope_id: dto.scopeId || null,
        status: 'ACTIVE',
        assigned_by_user_id: dto.devAdminUserId,
        created_at: now,
        updated_at: now,
      };

      await OfficerRepository.createAppointment(appointment);

      // Ensure user has active OFFICER role in user_roles
      const existingRoles = await AuthRepository.getUserRoles(dto.userId);
      const hasOfficerRole = existingRoles.some((r) => r.role === 'OFFICER' && !r.revoked_at);
      if (!hasOfficerRole) {
        const roleRecord: UserRoleRecord = {
          id: 'rol_off_' + Math.random().toString(36).substring(2, 9),
          user_id: dto.userId,
          role: 'OFFICER',
          semester_id: dto.semesterId || null,
          assigned_by_user_id: dto.devAdminUserId,
          assigned_at: now,
        };
        await AuthRepository.assignUserRole(roleRecord);
      }

      return { success: true, appointment };
    } catch (err: unknown) {
      return { success: false, appointment: null as any, error: (err as Error).message };
    }
  }

  /**
   * Scenario B: Imported student without account -> Prepare pending officer appointment
   * and issue single-use activation code.
   */
  public static async prepareImportedStudentOfficerActivation(
    dto: PrepareImportedStudentOfficerDto
  ): Promise<{
    success: boolean;
    appointment: OfficerAppointmentRecord;
    rawActivationCode?: string;
    expiresAt?: string;
    error?: string;
  }> {
    try {
      await OperationPolicyService.assertPermitted('OFFICER_MANAGEMENT_AND_PERMISSIONS');

      const student = await StudentsRepository.getStudentById(dto.studentId);
      if (!student) {
        return { success: false, appointment: null as any, error: 'Student record not found.' };
      }

      const existingAppt = await OfficerRepository.getAppointmentByStudentId(dto.studentId);
      if (existingAppt && (existingAppt.status === 'ACTIVE' || existingAppt.status === 'PENDING')) {
        return { success: false, appointment: null as any, error: 'Officer assignment already pending or active for this student.' };
      }

      const now = new Date().toISOString();
      const apptId = 'appt_' + Math.random().toString(36).substring(2, 10);
      const permissions = dto.permissionPreset === 'CUSTOM'
        ? (dto.customPermissions || [])
        : PRESET_DEFINITIONS[dto.permissionPreset];

      // Issue student activation claim code
      const claimResult = await StudentActivationService.issueActivationCode(
        dto.studentId,
        dto.devAdminUserId,
        48 // 48-hour expiration
      );

      if (!claimResult.success || !claimResult.rawCode) {
        return { success: false, appointment: null as any, error: claimResult.error || 'Failed to generate activation claim.' };
      }

      const appointment: OfficerAppointmentRecord = {
        id: apptId,
        student_id: dto.studentId,
        full_name: dto.fullName.trim(),
        email: dto.email.trim().toLowerCase(),
        permission_preset: dto.permissionPreset,
        custom_permissions_json: JSON.stringify(permissions),
        academic_year_id: dto.academicYearId || null,
        semester_id: dto.semesterId || null,
        appointment_start: dto.startDate,
        appointment_end: dto.endDate,
        scope_type: dto.scopeType || 'ORGANIZATION',
        scope_id: dto.scopeId || null,
        status: 'PENDING',
        invitation_code: claimResult.rawCode,
        invitation_sent_at: now,
        assigned_by_user_id: dto.devAdminUserId,
        created_at: now,
        updated_at: now,
      };

      await OfficerRepository.createAppointment(appointment);

      return {
        success: true,
        appointment,
        rawActivationCode: claimResult.rawCode,
        expiresAt: claimResult.expiresAt,
      };
    } catch (err: unknown) {
      return { success: false, appointment: null as any, error: (err as Error).message };
    }
  }

  /**
   * Scenario C: Completely new individual invited as an Officer (without student profile).
   */
  public static async inviteNewOfficer(
    dto: InviteNewOfficerDto
  ): Promise<{
    success: boolean;
    appointment: OfficerAppointmentRecord;
    invitationCode?: string;
    error?: string;
  }> {
    try {
      await OperationPolicyService.assertPermitted('OFFICER_MANAGEMENT_AND_PERMISSIONS');

      const cleanEmail = dto.email.trim().toLowerCase();
      const existingUser = await AuthRepository.getUserByUsername(cleanEmail);
      if (existingUser) {
        return {
          success: false,
          appointment: null as any,
          error: 'An account with this email already exists. Use "Existing Registered Student" or assign via existing identity.',
        };
      }

      const now = new Date().toISOString();
      const apptId = 'appt_' + Math.random().toString(36).substring(2, 10);
      const invCode = StudentActivationService.generateCode();
      const permissions = dto.permissionPreset === 'CUSTOM'
        ? (dto.customPermissions || [])
        : PRESET_DEFINITIONS[dto.permissionPreset];

      const appointment: OfficerAppointmentRecord = {
        id: apptId,
        student_id: null,
        full_name: dto.fullName.trim(),
        email: cleanEmail,
        permission_preset: dto.permissionPreset,
        custom_permissions_json: JSON.stringify(permissions),
        academic_year_id: dto.academicYearId || null,
        semester_id: dto.semesterId || null,
        appointment_start: dto.startDate,
        appointment_end: dto.endDate,
        scope_type: dto.scopeType || 'ORGANIZATION',
        scope_id: dto.scopeId || null,
        status: 'PENDING',
        invitation_code: invCode,
        invitation_sent_at: now,
        assigned_by_user_id: dto.devAdminUserId,
        created_at: now,
        updated_at: now,
      };

      await OfficerRepository.createAppointment(appointment);

      return {
        success: true,
        appointment,
        invitationCode: invCode,
      };
    } catch (err: unknown) {
      return { success: false, appointment: null as any, error: (err as Error).message };
    }
  }

  /**
   * Accepts/Activates invitation for Option C new officer.
   */
  public static async completeNewOfficerOnboarding(
    invitationCode: string,
    password: string
  ): Promise<{ success: boolean; user?: any; error?: string }> {
    try {
      await OperationPolicyService.assertPermitted('OFFICER_MANAGEMENT_AND_PERMISSIONS');

      if (password.length < 8) {
        return { success: false, error: 'Password must be at least 8 characters long.' };
      }

      const appointments = await OfficerRepository.getAppointments();
      const appt = appointments.find(
        (a) => a.invitation_code === invitationCode.trim().toUpperCase() && a.status === 'PENDING'
      );

      if (!appt) {
        return { success: false, error: 'Invalid or expired officer invitation code.' };
      }

      const now = new Date().toISOString();
      const userId = 'usr_off_' + Math.random().toString(36).substring(2, 9);
      const { authService } = await import('@/services/auth.service');
      const hash = await authService.hashPassword(password);

      const user = {
        id: userId,
        username: appt.email,
        account_status: 'ACTIVE' as const,
        created_by_user_id: appt.assigned_by_user_id,
        created_at: now,
        updated_at: now,
      };

      const cred = {
        user_id: userId,
        password_hash: hash,
        algorithm: 'ARGON2ID' as const,
        provisioned_at: now,
      };

      const role: UserRoleRecord = {
        id: 'rol_off_' + Math.random().toString(36).substring(2, 9),
        user_id: userId,
        role: 'OFFICER',
        semester_id: appt.semester_id || null,
        assigned_by_user_id: appt.assigned_by_user_id,
        assigned_at: now,
      };

      await AuthRepository.createUserWithCredentials(user, cred, role);

      await OfficerRepository.updateAppointment(appt.id, {
        user_id: userId,
        status: 'ACTIVE',
        updated_at: now,
      });

      return { success: true, user };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Query all officer records with filters.
   */
  public static async getOfficers(filter?: {
    status?: OfficerStatus;
    search?: string;
  }): Promise<OfficerListRecord[]> {
    if (DataModeService.isDirectSupabase()) {
      const { supabase } = await import('@/integrations/supabase/client');
      let query = supabase.from('officer_appointments').select('*').order('created_at', { ascending: false });
      if (filter?.status) {
        query = query.eq('status', filter.status);
      }
      const { data, error } = await query;
      if (error) throw new Error(`Failed to query officers from Supabase: ${error.message}`);
      return (data || []).map((row: any) => ({
        id: row.id,
        user_id: row.user_id,
        student_id: row.student_id,
        full_name: row.full_name,
        email: row.email,
        permission_preset: row.permission_preset,
        custom_permissions_json: JSON.stringify(row.custom_permissions || []),
        academic_year_id: row.academic_year_id,
        semester_id: row.semester_id,
        appointment_start: row.appointment_start,
        appointment_end: row.appointment_end,
        scope_type: row.scope_type,
        scope_id: row.scope_id,
        status: row.status,
        invitation_code: row.invitation_code,
        invitation_sent_at: row.invitation_sent_at,
        assigned_by_user_id: row.assigned_by_user_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        suspended_at: row.suspended_at,
        revoked_at: row.revoked_at,
        last_activity_at: row.last_activity_at,
        username: row.email || null,
        school_id: null,
      }));
    }
    return OfficerRepository.getAppointments(filter);
  }

  /**
   * Suspend an active officer.
   */
  public static async suspendOfficer(
    appointmentId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await OperationPolicyService.assertPermitted('OFFICER_MANAGEMENT_AND_PERMISSIONS');
      if (DataModeService.isDirectSupabase()) {
        const { supabase } = await import('@/integrations/supabase/client');
        const now = new Date().toISOString();
        const { error } = await supabase
          .from('officer_appointments')
          .update({ status: 'SUSPENDED', suspended_at: now, updated_at: now })
          .eq('id', appointmentId);
        if (error) throw new Error(`Failed to suspend officer on Supabase: ${error.message}`);
        return { success: true };
      }
      await OfficerRepository.suspendAppointment(appointmentId);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Revoke an officer. Preserves student profile and STUDENT role.
   */
  public static async revokeOfficer(
    appointmentId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await OperationPolicyService.assertPermitted('OFFICER_MANAGEMENT_AND_PERMISSIONS');
      if (DataModeService.isDirectSupabase()) {
        const { supabase } = await import('@/integrations/supabase/client');
        const now = new Date().toISOString();
        const { error } = await supabase
          .from('officer_appointments')
          .update({ status: 'REVOKED', revoked_at: now, updated_at: now })
          .eq('id', appointmentId);
        if (error) throw new Error(`Failed to revoke officer on Supabase: ${error.message}`);
        return { success: true };
      }
      await OfficerRepository.revokeAppointment(appointmentId);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Update officer permissions.
   */
  public static async updatePermissions(
    appointmentId: string,
    preset: OfficerPermissionPreset,
    customPermissions?: string[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await OperationPolicyService.assertPermitted('OFFICER_MANAGEMENT_AND_PERMISSIONS');
      const perms = preset === 'CUSTOM' ? (customPermissions || []) : PRESET_DEFINITIONS[preset];
      if (DataModeService.isDirectSupabase()) {
        const { supabase } = await import('@/integrations/supabase/client');
        const { error } = await supabase
          .from('officer_appointments')
          .update({
            permission_preset: preset,
            custom_permissions: perms,
            updated_at: new Date().toISOString(),
          })
          .eq('id', appointmentId);
        if (error) throw new Error(`Failed to update officer permissions on Supabase: ${error.message}`);
        return { success: true };
      }
      await OfficerRepository.updateAppointment(appointmentId, {
        permission_preset: preset,
        custom_permissions_json: JSON.stringify(perms),
      });
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Update officer appointment term and scope.
   */
  public static async updateAppointment(
    appointmentId: string,
    updates: {
      academicYearId?: string | null;
      semesterId?: string | null;
      startDate?: string;
      endDate?: string;
      scopeType?: OfficerScopeType;
      scopeId?: string | null;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await OperationPolicyService.assertPermitted('OFFICER_MANAGEMENT_AND_PERMISSIONS');
      if (DataModeService.isDirectSupabase()) {
        const { supabase } = await import('@/integrations/supabase/client');
        const remoteUpdates: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        if (updates.academicYearId !== undefined) remoteUpdates.academic_year_id = updates.academicYearId;
        if (updates.semesterId !== undefined) remoteUpdates.semester_id = updates.semesterId;
        if (updates.startDate) remoteUpdates.appointment_start = updates.startDate;
        if (updates.endDate) remoteUpdates.appointment_end = updates.endDate;
        if (updates.scopeType) remoteUpdates.scope_type = updates.scopeType;
        if (updates.scopeId !== undefined) remoteUpdates.scope_id = updates.scopeId;

        const { error } = await supabase
          .from('officer_appointments')
          .update(remoteUpdates)
          .eq('id', appointmentId);
        if (error) throw new Error(`Failed to update appointment on Supabase: ${error.message}`);
        return { success: true };
      }
      await OfficerRepository.updateAppointment(appointmentId, {
        ...(updates.academicYearId !== undefined && { academic_year_id: updates.academicYearId }),
        ...(updates.semesterId !== undefined && { semester_id: updates.semesterId }),
        ...(updates.startDate && { appointment_start: updates.startDate }),
        ...(updates.endDate && { appointment_end: updates.endDate }),
        ...(updates.scopeType && { scope_type: updates.scopeType }),
        ...(updates.scopeId !== undefined && { scope_id: updates.scopeId }),
      });
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Resend / Refresh invitation code.
   */
  public static async resendInvitation(
    appointmentId: string,
    callerUserId?: string
  ): Promise<{ success: boolean; code?: string; error?: string }> {
    try {
      await OperationPolicyService.assertPermitted('OFFICER_MANAGEMENT_AND_PERMISSIONS');
      const appt = await OfficerRepository.getAppointmentById(appointmentId);
      if (!appt) {
        return { success: false, error: 'Appointment record not found.' };
      }

      let newCode: string;
      if (appt.student_id) {
        const issuerId = callerUserId || appt.assigned_by_user_id;
        const claimRes = await StudentActivationService.issueActivationCode(
          appt.student_id,
          issuerId,
          48
        );
        if (!claimRes.success || !claimRes.rawCode) {
          return { success: false, error: claimRes.error || 'Failed to generate new activation code.' };
        }
        newCode = claimRes.rawCode;
      } else {
        newCode = StudentActivationService.generateCode();
      }

      const now = new Date().toISOString();
      await OfficerRepository.updateAppointment(appointmentId, {
        invitation_code: newCode,
        invitation_sent_at: now,
      });
      return { success: true, code: newCode };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Cancel pending invitation.
   */
  public static async cancelInvitation(
    appointmentId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const appt = await OfficerRepository.getAppointmentById(appointmentId);
      if (appt && appt.student_id) {
        const claim = await AuthRepository.getLatestActivationClaimByStudentId(appt.student_id);
        if (claim && !claim.used_at && !claim.revoked_at) {
          await AuthRepository.revokeActivationClaim(claim.id);
        }
      }
      await OfficerRepository.updateAppointment(appointmentId, {
        status: 'REVOKED',
        revoked_at: new Date().toISOString(),
      });
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Check if a given user currently holds an active permission.
   */
  public static async userHasPermission(
    userId: string,
    permission: string
  ): Promise<boolean> {
    const appt = await OfficerRepository.getAppointmentByUserId(userId);
    if (!appt || appt.status !== 'ACTIVE') return false;

    // Check expiration
    if (new Date() > new Date(appt.appointment_end)) return false;

    let perms: string[] = [];
    try {
      perms = JSON.parse(appt.custom_permissions_json || '[]');
    } catch {
      perms = [];
    }

    return perms.includes(permission);
  }

  /**
   * Search student candidates across SQLite and remote Supabase (limit 10).
   */
  public static async searchCandidates(
    query: string,
    limit = 10
  ): Promise<any[]> {
    const clean = (query || '').trim();

    // 1. Search local SQLite
    const local = await OfficerRepository.searchStudentsForOfficer(clean, null, limit);
    const resultMap = new Map<string, any>();
    local.forEach((item: any) => {
      resultMap.set(item.school_id?.toLowerCase() || item.student_id, item);
    });

    // 2. If under limit, query is non-empty, and online, supplement from Supabase
    if (resultMap.size < limit && clean.length > 0) {
      try {
        const { supabase } = await import('@/integrations/supabase/client');
        const { data: remote } = await supabase
          .from('students')
          .select('id, school_id, first_name, middle_name, last_name, status, users (id, username, account_status)')
          .or(`school_id.ilike.%${clean}%,first_name.ilike.%${clean}%,last_name.ilike.%${clean}%`)
          .limit(limit);

        if (remote && remote.length > 0) {
          for (const r of remote) {
            const key = r.school_id?.toLowerCase() || r.id;
            if (!resultMap.has(key) && resultMap.size < limit) {
              const u = Array.isArray(r.users) ? r.users[0] : r.users;
              const mapped = {
                student_id: r.id,
                school_id: r.school_id,
                first_name: r.first_name,
                middle_name: r.middle_name,
                last_name: r.last_name,
                user_id: u?.id || null,
                username: u?.username || null,
                account_status: u?.account_status || null,
                is_registered: u?.id && u.account_status === 'ACTIVE' ? 1 : 0,
                is_officer: 0,
              };
              resultMap.set(key, mapped);

              // Cache into local SQLite for consistency
              StudentsRepository.createStudent({
                id: r.id,
                school_id: r.school_id,
                first_name: r.first_name,
                middle_name: r.middle_name,
                last_name: r.last_name,
                status: r.status || 'ACTIVE',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }).catch(() => {});
            }
          }
        }
      } catch {
        // Fall back to local SQLite results
      }
    }

    return Array.from(resultMap.values()).slice(0, limit);
  }
}
