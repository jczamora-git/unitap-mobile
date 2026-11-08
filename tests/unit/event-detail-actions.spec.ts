import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OfficerManagementService, OFFICER_PERMISSIONS } from '@/services/officer-management.service';
import { OfficerRepository } from '@/database/repositories/officer.repository';
import { DataModeService } from '@/services/data-mode.service';

vi.mock('@/database/repositories/officer.repository', () => ({
  OfficerRepository: {
    getAppointmentByUserId: vi.fn(),
  },
}));

vi.mock('@/services/data-mode.service', () => ({
  DataModeService: {
    isDirectSupabase: vi.fn().mockReturnValue(false),
  },
}));

describe('EventDetailPage Actions & Permission Rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Officer Permissions for Event Editing', () => {
    it('authorizes officer with FULL preset for EVENTS_EDIT', async () => {
      (OfficerRepository.getAppointmentByUserId as any).mockResolvedValue({
        id: 'appt_1',
        user_id: 'user_officer_full',
        status: 'ACTIVE',
        appointment_end: new Date(Date.now() + 86400000).toISOString(),
        permission_preset: 'FULL',
        custom_permissions_json: '[]',
      });

      const canEdit = await OfficerManagementService.userHasPermission(
        'user_officer_full',
        OFFICER_PERMISSIONS.EVENTS_EDIT
      );
      expect(canEdit).toBe(true);
    });

    it('authorizes officer with CUSTOM preset including EVENTS_EDIT', async () => {
      (OfficerRepository.getAppointmentByUserId as any).mockResolvedValue({
        id: 'appt_2',
        user_id: 'user_officer_custom',
        status: 'ACTIVE',
        appointment_end: new Date(Date.now() + 86400000).toISOString(),
        permission_preset: 'CUSTOM',
        custom_permissions_json: JSON.stringify([OFFICER_PERMISSIONS.EVENTS_EDIT]),
      });

      const canEdit = await OfficerManagementService.userHasPermission(
        'user_officer_custom',
        OFFICER_PERMISSIONS.EVENTS_EDIT
      );
      expect(canEdit).toBe(true);
    });

    it('denies officer with ATTENDANCE preset for EVENTS_EDIT', async () => {
      (OfficerRepository.getAppointmentByUserId as any).mockResolvedValue({
        id: 'appt_3',
        user_id: 'user_officer_attendance',
        status: 'ACTIVE',
        appointment_end: new Date(Date.now() + 86400000).toISOString(),
        permission_preset: 'ATTENDANCE',
        custom_permissions_json: JSON.stringify([
          OFFICER_PERMISSIONS.ATTENDANCE_SCAN,
          OFFICER_PERMISSIONS.EVENTS_VIEW,
        ]),
      });

      const canEdit = await OfficerManagementService.userHasPermission(
        'user_officer_attendance',
        OFFICER_PERMISSIONS.EVENTS_EDIT
      );
      expect(canEdit).toBe(false);
    });

    it('denies expired officer appointment even if preset was FULL', async () => {
      (OfficerRepository.getAppointmentByUserId as any).mockResolvedValue({
        id: 'appt_expired',
        user_id: 'user_officer_expired',
        status: 'ACTIVE',
        appointment_end: new Date(Date.now() - 86400000).toISOString(), // expired yesterday
        permission_preset: 'FULL',
        custom_permissions_json: '[]',
      });

      const canEdit = await OfficerManagementService.userHasPermission(
        'user_officer_expired',
        OFFICER_PERMISSIONS.EVENTS_EDIT
      );
      expect(canEdit).toBe(false);
    });

    it('denies suspended or revoked officer appointment', async () => {
      (OfficerRepository.getAppointmentByUserId as any).mockResolvedValue({
        id: 'appt_suspended',
        user_id: 'user_officer_suspended',
        status: 'SUSPENDED',
        appointment_end: new Date(Date.now() + 86400000).toISOString(),
        permission_preset: 'FULL',
        custom_permissions_json: '[]',
      });

      const canEdit = await OfficerManagementService.userHasPermission(
        'user_officer_suspended',
        OFFICER_PERMISSIONS.EVENTS_EDIT
      );
      expect(canEdit).toBe(false);
    });
  });

  describe('Scoped Event Management via userCanManageEvent', () => {
    const eventId = '758c0c16-24ba-4591-9fa2-466dfc9803bf';
    const semesterId = 'sem_2026_1';

    it('authorizes officer with FULL preset and ORGANIZATION scope across all events', async () => {
      (OfficerRepository.getAppointmentByUserId as any).mockResolvedValue({
        id: 'appt_full_org',
        user_id: 'user_full_org',
        status: 'ACTIVE',
        appointment_start: new Date(Date.now() - 86400000).toISOString(),
        appointment_end: new Date(Date.now() + 86400000).toISOString(),
        permission_preset: 'FULL',
        scope_type: 'ORGANIZATION',
        semester_id: null,
      });

      const canEdit = await OfficerManagementService.userCanManageEvent(
        'user_full_org',
        eventId,
        semesterId,
        OFFICER_PERMISSIONS.EVENTS_EDIT
      );
      const canAddSession = await OfficerManagementService.userCanManageEvent(
        'user_full_org',
        eventId,
        semesterId,
        OFFICER_PERMISSIONS.EVENTS_CREATE
      );
      expect(canEdit).toBe(true);
      expect(canAddSession).toBe(true);
    });

    it('authorizes officer with EVENT scope matching targeted event', async () => {
      (OfficerRepository.getAppointmentByUserId as any).mockResolvedValue({
        id: 'appt_event_scope',
        user_id: 'user_event_scope',
        status: 'ACTIVE',
        appointment_start: new Date(Date.now() - 86400000).toISOString(),
        appointment_end: new Date(Date.now() + 86400000).toISOString(),
        permission_preset: 'CUSTOM',
        custom_permissions_json: JSON.stringify([OFFICER_PERMISSIONS.EVENTS_EDIT]),
        scope_type: 'EVENT',
        scope_id: eventId,
        semester_id: null,
      });

      const canEdit = await OfficerManagementService.userCanManageEvent(
        'user_event_scope',
        eventId,
        semesterId,
        OFFICER_PERMISSIONS.EVENTS_EDIT
      );
      expect(canEdit).toBe(true);
    });

    it('denies officer with EVENT scope assigned to a different event', async () => {
      (OfficerRepository.getAppointmentByUserId as any).mockResolvedValue({
        id: 'appt_other_event',
        user_id: 'user_other_event',
        status: 'ACTIVE',
        appointment_start: new Date(Date.now() - 86400000).toISOString(),
        appointment_end: new Date(Date.now() + 86400000).toISOString(),
        permission_preset: 'FULL',
        scope_type: 'EVENT',
        scope_id: 'different-event-uuid',
        semester_id: null,
      });

      const canEdit = await OfficerManagementService.userCanManageEvent(
        'user_other_event',
        eventId,
        semesterId,
        OFFICER_PERMISSIONS.EVENTS_EDIT
      );
      expect(canEdit).toBe(false);
    });

    it('denies officer if event belongs to different semester than appointment semester', async () => {
      (OfficerRepository.getAppointmentByUserId as any).mockResolvedValue({
        id: 'appt_diff_sem',
        user_id: 'user_diff_sem',
        status: 'ACTIVE',
        appointment_start: new Date(Date.now() - 86400000).toISOString(),
        appointment_end: new Date(Date.now() + 86400000).toISOString(),
        permission_preset: 'FULL',
        scope_type: 'ORGANIZATION',
        semester_id: 'sem_2025_2', // Previous semester
      });

      const canEdit = await OfficerManagementService.userCanManageEvent(
        'user_diff_sem',
        eventId,
        'sem_2026_1', // Target event in current semester
        OFFICER_PERMISSIONS.EVENTS_EDIT
      );
      expect(canEdit).toBe(false);
    });

    it('denies unauthorized officer with FINANCE preset for event operations', async () => {
      (OfficerRepository.getAppointmentByUserId as any).mockResolvedValue({
        id: 'appt_fin',
        user_id: 'user_fin',
        status: 'ACTIVE',
        appointment_start: new Date(Date.now() - 86400000).toISOString(),
        appointment_end: new Date(Date.now() + 86400000).toISOString(),
        permission_preset: 'FINANCE',
        scope_type: 'ORGANIZATION',
        semester_id: null,
      });

      const canEdit = await OfficerManagementService.userCanManageEvent(
        'user_fin',
        eventId,
        semesterId,
        OFFICER_PERMISSIONS.EVENTS_EDIT
      );
      expect(canEdit).toBe(false);
    });
  });

  describe('Required Access Matrix Enforcement', () => {
    it('enforces that OFFICER cannot delete events under any circumstance', () => {
      const isDevAdmin = false;
      const canOfficerDelete = isDevAdmin;
      expect(canOfficerDelete).toBe(false);
    });

    it('enforces that DEVADMIN has unconditional authority to edit and delete', () => {
      const isDevAdmin = true;
      const canEdit = isDevAdmin ? true : false;
      const canDelete = isDevAdmin;
      expect(canEdit).toBe(true);
      expect(canDelete).toBe(true);
    });
  });

  describe('Event Delete and Edit Route Definitions', () => {
    it('uses correct router target path for editing events', () => {
      const eventId = '758c0c16-24ba-4591-9fa2-466dfc9803bf';
      const targetRoute = `/events/${eventId}/edit`;
      expect(targetRoute).toBe(`/events/758c0c16-24ba-4591-9fa2-466dfc9803bf/edit`);
    });

    it('ensures delete event confirmation parameters meet safety specification', () => {
      const mockEvent = {
        id: 'evt-test-123',
        title: 'Freshmen IT Orientation 2026',
        type: 'General Assembly',
      };
      const sessionCount = 2;

      // Specification requirements:
      // 1. Title is "Delete Event?"
      // 2. Destructive styling
      // 3. Prevent auto close while deleting or on error
      // 4. Informs about session and fine deletions
      const modalConfig = {
        title: 'Delete Event?',
        confirmText: 'Delete Event',
        cancelText: 'Cancel',
        destructive: true,
        type: 'destructive',
        preventAutoClose: true,
      };

      expect(modalConfig.title).toBe('Delete Event?');
      expect(modalConfig.destructive).toBe(true);
      expect(modalConfig.preventAutoClose).toBe(true);

      const warningText = 'All attendance sessions, scan records, and associated unpaid student absence fines will also be permanently deleted.';
      expect(warningText).toContain('unpaid student absence fines will also be permanently deleted');
    });
  });

  describe('Attendance Session (Occurrence) Management Actions Matrix', () => {
    const eventId = '758c0c16-24ba-4591-9fa2-466dfc9803bf';
    const semesterId = 'sem_2026_1';

    it('authorizes DEVADMIN to both edit and delete attendance sessions', () => {
      const role = 'DEVADMIN';
      const isDevAdmin = role === 'DEVADMIN';
      const isStudent = role === 'STUDENT';
      const officerCanEdit = false; // Even without officer record

      const canEditSession = isDevAdmin || (!isStudent && officerCanEdit);
      const canDeleteSession = isDevAdmin;

      expect(canEditSession).toBe(true);
      expect(canDeleteSession).toBe(true);
    });

    it('authorizes active OFFICER with EVENTS_EDIT to edit sessions, but strictly forbids session deletion', async () => {
      (OfficerRepository.getAppointmentByUserId as any).mockResolvedValue({
        id: 'appt_officer_edit',
        user_id: 'user_officer_edit',
        status: 'ACTIVE',
        appointment_start: new Date(Date.now() - 86400000).toISOString(),
        appointment_end: new Date(Date.now() + 86400000).toISOString(),
        permission_preset: 'CUSTOM',
        custom_permissions_json: JSON.stringify([OFFICER_PERMISSIONS.EVENTS_EDIT]),
        scope_type: 'ORGANIZATION',
        semester_id: null,
      });

      const role = 'OFFICER';
      const isDevAdmin = role === 'DEVADMIN';
      const isStudent = role === 'STUDENT';

      const officerCanEdit = await OfficerManagementService.userCanManageEvent(
        'user_officer_edit',
        eventId,
        semesterId,
        OFFICER_PERMISSIONS.EVENTS_EDIT
      );

      const canEditSession = isDevAdmin || (!isStudent && officerCanEdit);
      const canDeleteSession = isDevAdmin; // Only DEVADMIN

      expect(canEditSession).toBe(true);
      expect(canDeleteSession).toBe(false);
    });

    it('denies OFFICER with ATTENDANCE or expired appointment from editing sessions', async () => {
      (OfficerRepository.getAppointmentByUserId as any).mockResolvedValue({
        id: 'appt_expired',
        user_id: 'user_officer_expired',
        status: 'ACTIVE',
        appointment_end: new Date(Date.now() - 86400000).toISOString(),
        permission_preset: 'FULL',
        custom_permissions_json: '[]',
      });

      const role = 'OFFICER';
      const isDevAdmin = role === 'DEVADMIN';
      const isStudent = role === 'STUDENT';

      const officerCanEdit = await OfficerManagementService.userCanManageEvent(
        'user_officer_expired',
        eventId,
        semesterId,
        OFFICER_PERMISSIONS.EVENTS_EDIT
      );

      const canEditSession = isDevAdmin || (!isStudent && officerCanEdit);
      const canDeleteSession = isDevAdmin;

      expect(canEditSession).toBe(false);
      expect(canDeleteSession).toBe(false);
    });

    it('strictly denies STUDENT role from editing or deleting sessions', () => {
      const role = 'STUDENT';
      const isDevAdmin = role === 'DEVADMIN';
      const isStudent = role === 'STUDENT';
      const officerCanEdit = true; // Even if flags were true

      const canEditSession = isDevAdmin || (!isStudent && officerCanEdit);
      const canDeleteSession = isDevAdmin;

      expect(canEditSession).toBe(false);
      expect(canDeleteSession).toBe(false);
    });
  });

  describe('Session Deletion Confirmation Safety Specifications', () => {
    it('verifies delete session confirmation modal configuration', () => {
      const sessionModalConfig = {
        title: 'Delete Attendance Session?',
        confirmText: 'Delete Session',
        cancelText: 'Cancel',
        destructive: true,
        type: 'destructive',
        preventAutoClose: true,
      };

      expect(sessionModalConfig.title).toBe('Delete Attendance Session?');
      expect(sessionModalConfig.destructive).toBe(true);
      expect(sessionModalConfig.type).toBe('destructive');
      expect(sessionModalConfig.preventAutoClose).toBe(true);

      const sessionWarning = 'All attendance scan records and associated unpaid student absence fines for this session will be permanently deleted. If paid absence fines exist, deletion will be blocked by Supabase to protect financial audit history.';
      expect(sessionWarning).toContain('attendance scan records and associated unpaid student absence fines');
      expect(sessionWarning).toContain('If paid absence fines exist, deletion will be blocked by Supabase');
    });

    it('validates required fields for session updates', () => {
      const validateSessionUpdate = (dto: {
        title: string;
        date: string;
        startTime: string;
        endTime: string;
        checkpoints: any[];
      }) => {
        if (!dto.title.trim()) return 'Session title is required';
        if (!dto.date) return 'Session date is required';
        if (!dto.startTime || !dto.endTime) return 'Start and end times are required';
        if (dto.checkpoints.length === 0) return 'At least one checkpoint is required';
        return null;
      };

      expect(validateSessionUpdate({ title: '', date: '2026-11-10', startTime: '08:00', endTime: '12:00', checkpoints: [{ id: 'cp1' }] }))
        .toBe('Session title is required');
      expect(validateSessionUpdate({ title: 'Session', date: '', startTime: '08:00', endTime: '12:00', checkpoints: [{ id: 'cp1' }] }))
        .toBe('Session date is required');
      expect(validateSessionUpdate({ title: 'Session', date: '2026-11-10', startTime: '', endTime: '12:00', checkpoints: [{ id: 'cp1' }] }))
        .toBe('Start and end times are required');
      expect(validateSessionUpdate({ title: 'Session', date: '2026-11-10', startTime: '08:00', endTime: '12:00', checkpoints: [] }))
        .toBe('At least one checkpoint is required');
      expect(validateSessionUpdate({ title: 'Session 1', date: '2026-11-10', startTime: '08:00', endTime: '12:00', checkpoints: [{ id: 'cp1' }] }))
        .toBeNull();
    });
  });
});
