import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { SyncPreferenceService } from '@/services/sync/sync-preference.service';
import { SyncStatusService } from '@/services/sync/sync-status.service';
import { SyncScopeService } from '@/services/sync/sync-scope.service';
import { InitialSyncService, HYDRATED_USER_KEY } from '@/services/sync/initial-sync.service';
import { Preferences } from '@capacitor/preferences';
import UniDataUpdateScreen from '@/components/ui/UniDataUpdateScreen.vue';

describe('UniTap 2.0 Offline-First Synchronization & Preferences Suite', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await Preferences.clear();
    SyncStatusService.setState('ONLINE');
    SyncStatusService.setPendingCount(0);
  });

  describe('SyncPreferenceService', () => {
    it('defaults to AUTOMATIC sync mode', async () => {
      const mode = await SyncPreferenceService.init('user_test_1');
      expect(mode).toBe('AUTOMATIC');
      expect(SyncPreferenceService.isAutomatic()).toBe(true);
      expect(SyncPreferenceService.isManual()).toBe(false);
    });

    it('persists and updates mode to MANUAL for the active user', async () => {
      await SyncPreferenceService.init('user_test_1');
      await SyncPreferenceService.setMode('MANUAL');

      expect(SyncPreferenceService.isManual()).toBe(true);
      expect(SyncPreferenceService.mode.value).toBe('MANUAL');

      // Re-init with same user restores MANUAL
      const restored = await SyncPreferenceService.init('user_test_1');
      expect(restored).toBe('MANUAL');
    });

    it('isolates sync preferences between different user IDs', async () => {
      await SyncPreferenceService.init('officer_user');
      await SyncPreferenceService.setMode('MANUAL');

      // Different user defaults to AUTOMATIC
      const otherMode = await SyncPreferenceService.init('student_user');
      expect(otherMode).toBe('AUTOMATIC');
    });
  });

  describe('SyncStatusService User-Facing Statuses', () => {
    it('reports "Updating" when actively syncing', () => {
      SyncStatusService.setState('SYNCING');
      expect(SyncStatusService.userFacingStatus.value).toBe('Updating');
    });

    it('reports "Offline" when network is offline', () => {
      SyncStatusService.setState('OFFLINE');
      expect(SyncStatusService.userFacingStatus.value).toBe('Offline');
    });

    it('reports "Waiting to Sync" when outbox has pending records', () => {
      SyncStatusService.setState('SYNCED');
      SyncStatusService.setPendingCount(3);
      expect(SyncStatusService.userFacingStatus.value).toBe('Waiting to Sync');
    });

    it('reports "Needs Attention" on sync conflict', () => {
      SyncStatusService.setState('CONFLICT');
      expect(SyncStatusService.userFacingStatus.value).toBe('Needs Attention');
    });

    it('reports "Update Failed" on sync error', () => {
      SyncStatusService.setState('SYNC_ERROR');
      expect(SyncStatusService.userFacingStatus.value).toBe('Update Failed');
    });

    it('reports "Up to Date" when synced with 0 pending operations', () => {
      SyncStatusService.setState('SYNCED');
      SyncStatusService.setPendingCount(0);
      expect(SyncStatusService.userFacingStatus.value).toBe('Up to Date');
    });

    it('formats last sync timestamp human-readably', () => {
      const now = new Date().toISOString();
      SyncStatusService.setLastSync(now);
      expect(SyncStatusService.formattedLastSync.value).toBe('Just now');
    });
  });

  describe('Role-Based Scoping (SyncScopeService)', () => {
    it('provides restricted tables for STUDENT role (data minimization)', () => {
      const tables = SyncScopeService.getRequiredTablesForRole('STUDENT');
      expect(tables).toContain('students');
      expect(tables).toContain('student_obligations');
      expect(tables).toContain('attendance_records');
      // Must not contain administrative or officer templates
      expect(tables).not.toContain('obligation_rules');
    });

    it('applies student_id filter on personal tables for STUDENT role', () => {
      const studentFilter = SyncScopeService.getTableFilter('students', 'STUDENT', 'stud_uuid_123');
      expect(studentFilter).toEqual({ column: 'id', value: 'stud_uuid_123' });

      const attendanceFilter = SyncScopeService.getTableFilter('attendance_records', 'STUDENT', 'stud_uuid_123');
      expect(attendanceFilter).toEqual({ column: 'student_id', value: 'stud_uuid_123' });
    });

    it('returns null filter for public structural tables', () => {
      const semFilter = SyncScopeService.getTableFilter('semesters', 'STUDENT', 'stud_uuid_123');
      expect(semFilter).toBeNull();
    });
  });

  describe('Account Switching & Cache Isolation (InitialSyncService)', () => {
    it('detects account mismatch when different user tests isHydrated', async () => {
      await Preferences.set({ key: HYDRATED_USER_KEY, value: 'user_A' });

      // If user_B checks isHydrated, it must recognize account mismatch and require rehydration
      const isUserBHydrated = await InitialSyncService.isHydrated('user_B');
      expect(isUserBHydrated).toBe(false);
    });
  });

  describe('Returning User Update Screen (UniDataUpdateScreen.vue)', () => {
    it('renders "Getting everything ready" during UPDATING stage', () => {
      const wrapper = mount(UniDataUpdateScreen, {
        props: {
          stage: 'UPDATING',
          progressPercent: 45,
        },
      });

      expect(wrapper.text()).toContain('Getting everything ready');
      expect(wrapper.text()).toContain('Your latest records are being prepared.');
    });

    it('renders "You\'re up to date" on COMPLETE stage', () => {
      const wrapper = mount(UniDataUpdateScreen, {
        props: {
          stage: 'COMPLETE',
          progressPercent: 100,
        },
      });

      expect(wrapper.text()).toContain("You're up to date");
      expect(wrapper.text()).toContain('Everything needed is ready.');
    });

    it('renders actionable failure view and emits retry when Try Again is clicked', async () => {
      const wrapper = mount(UniDataUpdateScreen, {
        props: {
          stage: 'FAILED',
          errorMessage: 'Check your connection and try again.',
          allowContinueOffline: true,
        },
      });

      expect(wrapper.text()).toContain("We couldn't update your information");
      expect(wrapper.text()).toContain('Try Again');
      expect(wrapper.text()).toContain('Continue Offline');

      const buttons = wrapper.findAll('button');
      await buttons[0].trigger('click');
      expect(wrapper.emitted('retry')).toBeTruthy();

      await buttons[1].trigger('click');
      expect(wrapper.emitted('continue-offline')).toBeTruthy();
    });
  });
});

