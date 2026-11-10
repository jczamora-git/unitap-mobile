import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { attendanceService, evaluateCheckpointWindow } from '@/services/attendance.service';
import { eventService } from '@/services/event.service';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { CardsRepository } from '@/database/repositories/cards.repository';
import { EventsRepository } from '@/database/repositories/events.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { AttendanceRepository } from '@/database/repositories/attendance.repository';
import { CHECKPOINT_PRESETS, type AttendanceCheckpoint, type CheckpointPreset } from '@/types/event';

describe('Configurable Attendance Checkpoints with Individual Scan Windows', () => {
  const semesterId = 'sem_window_test';
  const eventId = 'ev_window_test';
  const occurrenceId = 'occ_window_test';

  const testStudent = {
    id: 'stu_window_test_1',
    schoolId: '2026-9001',
    cardUid: '04F1F2F3F4F5',
    firstName: 'Juan',
    lastName: 'Luna',
  };

  // Helper function mirroring EventDetailPage.vue schedule validation
  function timeToMinutes(t?: string | null): number {
    if (!t || !t.includes(':')) return -1;
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return -1;
    return h * 60 + m;
  }

  function validateCheckpointWindow(
    opensAt: string,
    closesAt: string,
    _sessionStart?: string,
    _sessionEnd?: string,
    label: string = 'Checkpoint'
  ): string | null {
    if (!opensAt || !closesAt) {
      return `${label}: Opens At and Closes At times are required.`;
    }
    const openMin = timeToMinutes(opensAt);
    const closeMin = timeToMinutes(closesAt);

    if (openMin < 0 || closeMin < 0) {
      return `${label}: Please enter valid time formats (HH:MM).`;
    }
    if (closeMin <= openMin) {
      return `${label}: Closing time (${closesAt}) must be later than opening time (${opensAt}).`;
    }

    // Checkpoints represent independent attendance scanning windows.
    // Early IN (before official session start) and late OUT (after official session end) are explicitly permitted.
    return null;
  }

  function validateOverlappingCheckpoints(checkpoints: AttendanceCheckpoint[]): string | null {
    // Sort by opening time
    const sorted = [...checkpoints].sort((a, b) => {
      const aStart = timeToMinutes(a.opensAt || a.startTime);
      const bStart = timeToMinutes(b.opensAt || b.startTime);
      return aStart - bStart;
    });

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      const currentClose = timeToMinutes(current.closesAt || current.endTime);
      const nextOpen = timeToMinutes(next.opensAt || next.startTime);

      if (nextOpen < currentClose) {
        return `Checkpoint "${next.label}" (${next.opensAt || next.startTime}) overlaps with "${current.label}" (${current.opensAt || current.startTime} - ${current.closesAt || current.endTime}).`;
      }
    }
    return null;
  }

  describe('1. Checkpoint Schedule Validation & Window Bounds', () => {
    const sessionStart = '08:00';
    const sessionEnd = '17:00';

    it('accepts valid checkpoint windows inside session hours', () => {
      const err = validateCheckpointWindow('08:00', '08:30', sessionStart, sessionEnd, 'Morning IN');
      expect(err).toBeNull();
    });

    it('rejects checkpoint when closing time is equal to or earlier than opening time', () => {
      const errEqual = validateCheckpointWindow('08:30', '08:30', sessionStart, sessionEnd, 'Morning IN');
      expect(errEqual).toContain('Closing time (08:30) must be later than opening time (08:30)');

      const errEarlier = validateCheckpointWindow('09:00', '08:30', sessionStart, sessionEnd, 'Morning IN');
      expect(errEarlier).toContain('Closing time (08:30) must be later than opening time (09:00)');
    });

    it('allows early IN checkpoint window opening earlier than official session start (e.g. 7:00 AM for 8:00 AM event)', () => {
      const err = validateCheckpointWindow('07:00', '08:30', sessionStart, sessionEnd, 'Early Bird IN');
      expect(err).toBeNull();
    });

    it('allows late OUT checkpoint window closing later than official session end (e.g. 5:30 PM for 5:00 PM event)', () => {
      const err = validateCheckpointWindow('16:30', '17:30', sessionStart, sessionEnd, 'Extended OUT');
      expect(err).toBeNull();
    });

    it('detects overlapping checkpoint schedules', () => {
      const overlapping: AttendanceCheckpoint[] = [
        { id: 'cp1', label: 'Morning IN', type: 'IN', opensAt: '08:00', closesAt: '09:00' },
        { id: 'cp2', label: 'Morning Early OUT', type: 'OUT', opensAt: '08:45', closesAt: '09:30' },
      ];
      const overlapErr = validateOverlappingCheckpoints(overlapping);
      expect(overlapErr).toContain('overlaps with "Morning IN"');
    });

    it('accepts consecutive non-overlapping checkpoints', () => {
      const validSeq: AttendanceCheckpoint[] = [
        { id: 'cp1', label: 'Morning IN', type: 'IN', opensAt: '07:30', closesAt: '08:30' },
        { id: 'cp2', label: 'Morning OUT', type: 'OUT', opensAt: '11:30', closesAt: '12:30' },
        { id: 'cp3', label: 'Afternoon IN', type: 'IN', opensAt: '12:30', closesAt: '13:30' },
        { id: 'cp4', label: 'Afternoon OUT', type: 'OUT', opensAt: '16:30', closesAt: '17:30' },
      ];
      const overlapErr = validateOverlappingCheckpoints(validSeq);
      expect(overlapErr).toBeNull();
    });
  });

  describe('2. Philippine Timezone (Asia/Manila UTC+8) Handling', () => {
    it('accurately parses Philippine local schedules relative to UTC', () => {
      // Event on 2026-11-10, opens at 08:00 AM Manila Time
      // Manila is UTC+8 -> 08:00 AM Manila = 00:00 AM UTC
      const occursOn = '2026-11-10';
      const opensAt = '08:00';
      const closesAt = '08:30';

      const manilaOpeningIso = `${occursOn}T${opensAt}:00+08:00`;
      const manilaClosingIso = `${occursOn}T${closesAt}:00+08:00`;

      const openingUtcMs = new Date(manilaOpeningIso).getTime();
      const closingUtcMs = new Date(manilaClosingIso).getTime();

      // Check difference is exactly 30 minutes (1,800,000 ms)
      expect(closingUtcMs - openingUtcMs).toBe(30 * 60 * 1000);

      // 07:59:59 Manila = 23:59:59 (prev day) UTC -> BEFORE opening
      const scanBeforeMs = new Date(`${occursOn}T07:59:59+08:00`).getTime();
      expect(scanBeforeMs < openingUtcMs).toBe(true);

      // 08:15:00 Manila = 00:15:00 UTC -> INSIDE window
      const scanInsideMs = new Date(`${occursOn}T08:15:00+08:00`).getTime();
      expect(scanInsideMs >= openingUtcMs && scanInsideMs <= closingUtcMs).toBe(true);

      // 08:30:01 Manila = 00:30:01 UTC -> AFTER closing
      const scanAfterMs = new Date(`${occursOn}T08:30:01+08:00`).getTime();
      expect(scanAfterMs > closingUtcMs).toBe(true);
    });
  });

  describe('3. Actual Attendance Enforcement: Checkpoint Windows', () => {
    beforeAll(async () => {
      await resetDatabaseForTests();

      const db = await getDatabase();

      // Provision Officer
      await db.execute(`
        INSERT INTO users (id, username, account_status, created_at, updated_at) VALUES
        ('officer_window_1', 'officer_win', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
      `);

      // Provision Academic Term & Event
      await AcademicRepository.createYear({
        id: 'ay_window',
        label: '2026-2027',
        starts_on: '2026-08-01',
        ends_on: '2027-05-31',
        status: 'ACTIVE',
      });

      await AcademicRepository.createSemester({
        id: semesterId,
        academic_year_id: 'ay_window',
        term: 'FIRST',
        starts_on: '2026-08-01',
        ends_on: '2026-12-31',
        status: 'ACTIVE',
      });

      await EventsRepository.createEvent({
        id: eventId,
        semester_id: semesterId,
        title: 'IT Leadership Summit',
        event_type: 'GENERAL_ASSEMBLY',
        audience_type: 'ALL',
        audience_json: '{}',
        attendance_required: 1,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Checkpoints with early IN and late OUT:
      // Session Official Hours: 08:00 - 17:00
      // Morning IN: 07:00 - 08:30 (opens 1 hour BEFORE session start, grace until 08:15)
      // Morning OUT: 11:30 - 12:30
      // Afternoon IN: 12:30 - 13:30
      // Afternoon OUT: 16:30 - 17:30 (closes 30 min AFTER session end)
      const checkpoints: AttendanceCheckpoint[] = [
        {
          id: 'cp_morning_in',
          label: 'Morning IN',
          type: 'IN',
          opensAt: '07:00',
          closesAt: '08:30',
          startTime: '07:00',
          endTime: '08:30',
          graceMinutes: 75, // Grace period until 08:15
          orderIndex: 0,
        },
        {
          id: 'cp_morning_out',
          label: 'Morning OUT',
          type: 'OUT',
          opensAt: '11:30',
          closesAt: '12:30',
          startTime: '11:30',
          endTime: '12:30',
          orderIndex: 1,
        },
        {
          id: 'cp_afternoon_in',
          label: 'Afternoon IN',
          type: 'IN',
          opensAt: '12:30',
          closesAt: '13:30',
          startTime: '12:30',
          endTime: '13:30',
          graceMinutes: 15,
          orderIndex: 2,
        },
        {
          id: 'cp_afternoon_out',
          label: 'Afternoon OUT',
          type: 'OUT',
          opensAt: '16:30',
          closesAt: '17:30',
          startTime: '16:30',
          endTime: '17:30',
          orderIndex: 3,
        },
      ];

      await EventsRepository.createOccurrence({
        id: occurrenceId,
        event_id: eventId,
        title: 'Full Day Summit',
        occurs_on: '2026-11-10',
        starts_at: '08:00:00',
        ends_at: '17:00:00',
        grace_minutes: 15,
        status: 'OPEN',
        checkpoints_json: JSON.stringify(checkpoints),
        active_checkpoint_id: 'cp_morning_in',
        updated_at: new Date().toISOString(),
      });

      // Provision Student & NFC Card
      await StudentsRepository.createStudent({
        id: testStudent.id,
        school_id: testStudent.schoolId,
        first_name: testStudent.firstName,
        last_name: testStudent.lastName,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await CardsRepository.assignCard({
        id: 'card_win_1',
        student_id: testStudent.id,
        uid_normalized: testStudent.cardUid,
        status: 'ACTIVE',
        assigned_at: new Date().toISOString(),
      });
    });

    beforeEach(async () => {
      const db = await getDatabase();
      await db.execute('DELETE FROM attendance_audit WHERE attendance_id IN (SELECT id FROM attendance_records WHERE occurrence_id = ?)', [occurrenceId]);
      await db.execute('DELETE FROM attendance_records WHERE occurrence_id = ?', [occurrenceId]);
    });

    it('allows early IN scan before official session start (e.g. 7:15 AM for 8:00 AM session)', async () => {
      // Session starts at 08:00, but Morning IN window opens at 07:00
      // Scan at 07:15:00 (inside window, inside grace period -> PRESENT)
      const scanTime = '2026-11-10T07:15:00';
      const result = await attendanceService.confirmStudentAttendance(
        occurrenceId,
        testStudent.id,
        'officer_window_1',
        undefined,
        undefined,
        testStudent.cardUid,
        'idem_scan_early_in',
        scanTime,
        'NFC',
        'cp_morning_in'
      );

      expect(result.status).toBe('RECORDED');

      // Verify recorded attendance in repository
      const record = await AttendanceRepository.getRecord(occurrenceId, testStudent.id, 'cp_morning_in');
      expect(record).not.toBeNull();
      expect(record?.status).toBe('PRESENT');
    });

    it('marks attendance as LATE when scanned within window but after grace period', async () => {
      // Scan at 08:20:00 (after 08:15 grace limit and before 08:30 window close)
      const scanTime = '2026-11-10T08:20:00';
      const result = await attendanceService.confirmStudentAttendance(
        occurrenceId,
        testStudent.id,
        'officer_window_1',
        undefined,
        undefined,
        testStudent.cardUid,
        'idem_scan_late_1',
        scanTime,
        'NFC',
        'cp_morning_in'
      );

      expect(result.status).toBe('RECORDED');
      const record = await AttendanceRepository.getRecord(occurrenceId, testStudent.id, 'cp_morning_in');
      expect(record?.status).toBe('LATE');
    });

    it('rejects scan before opening time with clear reason (CHECKPOINT_NOT_OPEN)', async () => {
      // Morning IN window opens at 07:00. Attempt scan at 06:45:00
      const earlyScanTime = '2026-11-10T06:45:00';

      await expect(
        attendanceService.confirmStudentAttendance(
          occurrenceId,
          testStudent.id,
          'officer_window_1',
          undefined,
          undefined,
          testStudent.cardUid,
          'idem_scan_early_1',
          earlyScanTime,
          'NFC',
          'cp_morning_in'
        )
      ).rejects.toThrow(/not yet open for scanning|Window opens at/i);
    });

    it('rejects scan after closing time with clear reason (CHECKPOINT_CLOSED)', async () => {
      // Morning IN window closes at 08:30. Attempt scan at 08:45:00
      const lateScanTime = '2026-11-10T08:45:00';

      await expect(
        attendanceService.confirmStudentAttendance(
          occurrenceId,
          testStudent.id,
          'officer_window_1',
          undefined,
          undefined,
          testStudent.cardUid,
          'idem_scan_closed_1',
          lateScanTime,
          'NFC',
          'cp_morning_in'
        )
      ).rejects.toThrow(/scanning window has closed|Window closed at/i);
    });
  });

  describe('4. Correct IN/OUT Checkpoint Selection & Multi-Checkpoint Lifecycle', () => {
    beforeEach(async () => {
      const db = await getDatabase();
      await db.execute('DELETE FROM attendance_audit WHERE attendance_id IN (SELECT id FROM attendance_records WHERE occurrence_id = ?)', [occurrenceId]);
      await db.execute('DELETE FROM attendance_records WHERE occurrence_id = ?', [occurrenceId]);
    });

    it('supports independent attendance for Morning OUT checkpoint with its own window', async () => {
      // First, set active checkpoint to Morning OUT (11:30 - 12:30)
      await eventService.setActiveCheckpoint(occurrenceId, 'cp_morning_out');

      // Scan at 08:15 against Morning OUT -> MUST FAIL (window not open yet)
      const morningTime = '2026-11-10T08:15:00';
      await expect(
        attendanceService.confirmStudentAttendance(
          occurrenceId,
          testStudent.id,
          'officer_window_1',
          undefined,
          undefined,
          testStudent.cardUid,
          'idem_out_early',
          morningTime,
          'NFC',
          'cp_morning_out'
        )
      ).rejects.toThrow(/not yet open for scanning|Window opens at 11:30 AM/i);

      // Scan at 11:45 within Morning OUT window (11:30 - 12:30) -> MUST SUCCEED
      const outWindowTime = '2026-11-10T11:45:00';
      const outResult = await attendanceService.confirmStudentAttendance(
        occurrenceId,
        testStudent.id,
        'officer_window_1',
        undefined,
        undefined,
        testStudent.cardUid,
        'idem_out_valid',
        outWindowTime,
        'NFC',
        'cp_morning_out'
      );

      expect(outResult.status).toBe('RECORDED');

      // Scan at 12:45 after Morning OUT closed -> MUST FAIL
      const postCloseTime = '2026-11-10T12:45:00';
      await expect(
        attendanceService.confirmStudentAttendance(
          occurrenceId,
          testStudent.id,
          'officer_window_1',
          undefined,
          undefined,
          testStudent.cardUid,
          'idem_out_late',
          postCloseTime,
          'NFC',
          'cp_morning_out'
        )
      ).rejects.toThrow(/scanning window has closed|Window closed at 12:30 PM/i);
    });

    it('allows late OUT scan after official session end (e.g. 5:15 PM for 5:00 PM session)', async () => {
      // Official session ends at 17:00, but Afternoon OUT window runs 16:30 - 17:30
      await eventService.setActiveCheckpoint(occurrenceId, 'cp_afternoon_out');

      const lateOutScanTime = '2026-11-10T17:15:00';
      const outResult = await attendanceService.confirmStudentAttendance(
        occurrenceId,
        testStudent.id,
        'officer_window_1',
        undefined,
        undefined,
        testStudent.cardUid,
        'idem_late_out_valid',
        lateOutScanTime,
        'NFC',
        'cp_afternoon_out'
      );

      expect(outResult.status).toBe('RECORDED');
      const record = await AttendanceRepository.getRecord(occurrenceId, testStudent.id, 'cp_afternoon_out');
      expect(record?.status).toBe('PRESENT');
    });

    it('enforces that checkpoints preserve their unique IDs during editing', async () => {
      const occurrence = await EventsRepository.getOccurrenceById(occurrenceId);
      const originalCheckpoints = eventService.parseCheckpoints(occurrence?.checkpoints_json);
      const originalIds = originalCheckpoints.map(c => c.id);

      // Update checkpoint labels and times while preserving original IDs
      const updatedCheckpoints = originalCheckpoints.map(cp => ({
        ...cp,
        label: `${cp.label} (Revised)`,
      }));

      await eventService.updateOccurrenceCheckpoints(occurrenceId, updatedCheckpoints);

      const refreshed = await EventsRepository.getOccurrenceById(occurrenceId);
      const refreshedCheckpoints = eventService.parseCheckpoints(refreshed?.checkpoints_json);
      const refreshedIds = refreshedCheckpoints.map(c => c.id);

      expect(refreshedIds).toEqual(originalIds);
      expect(refreshedCheckpoints[0].label).toBe('Morning IN (Revised)');
    });
  });

  describe('5. Foreign Key Protection & Missing Parent Reference Handling', () => {
    it('throws meaningful error when occurrence does not exist in local database instead of raw code 787', async () => {
      await expect(
        AttendanceRepository.recordAttendance(
          {
            id: 'att_invalid_occ',
            occurrence_id: 'occ_nonexistent_9999',
            student_id: testStudent.id,
            checkpoint_id: 'default_in',
            status: 'PRESENT' as any,
            checked_in_at: new Date().toISOString(),
            method: 'NFC',
            identity_verified_by_user_id: 'officer_window_1',
            photo_checked: 1,
            updated_at: new Date().toISOString(),
          },
          'officer_window_1'
        )
      ).rejects.toThrow(/Cannot record attendance offline: Event occurrence.*not found in local database/i);
    });

    it('throws meaningful error when student does not exist in local database instead of raw code 787', async () => {
      await expect(
        AttendanceRepository.recordAttendance(
          {
            id: 'att_invalid_stu',
            occurrence_id: occurrenceId,
            student_id: 'stu_nonexistent_9999',
            checkpoint_id: 'default_in',
            status: 'PRESENT' as any,
            checked_in_at: new Date().toISOString(),
            method: 'NFC',
            identity_verified_by_user_id: 'officer_window_1',
            photo_checked: 1,
            updated_at: new Date().toISOString(),
          },
          'officer_window_1'
        )
      ).rejects.toThrow(/Cannot record attendance offline: Student.*not found in local database/i);
    });

    it('gracefully skips or nullifies missing optional foreign keys in logAttempt without throwing code 787', async () => {
      // Calling logAttempt with a non-existent occurrence_id should safely log a warning and not throw
      await expect(
        AttendanceRepository.logAttempt({
          id: 'log_test_nonexistent',
          occurrence_id: 'occ_nonexistent_xyz',
          uid_normalized: '04FFFFFFFFFF',
          actor_user_id: 'officer_unknown_xyz',
          result: 'ERROR',
          photo_displayed: 0,
          notes: 'Test missing occurrence',
          occurred_at: new Date().toISOString(),
        })
      ).resolves.not.toThrow();
    });
  });

  describe('Quick Checkpoint Templates and Duplicate Prevention', () => {
    it('defines exactly four client-side presets with expected scanning windows', () => {
      expect(CHECKPOINT_PRESETS).toHaveLength(4);

      const morningIn = CHECKPOINT_PRESETS.find(p => p.label === 'Morning IN');
      expect(morningIn).toBeDefined();
      expect(morningIn?.type).toBe('IN');
      expect(morningIn?.opensAt).toBe('07:00');
      expect(morningIn?.closesAt).toBe('08:30');

      const morningOut = CHECKPOINT_PRESETS.find(p => p.label === 'Morning OUT');
      expect(morningOut).toBeDefined();
      expect(morningOut?.type).toBe('OUT');
      expect(morningOut?.opensAt).toBe('11:30');
      expect(morningOut?.closesAt).toBe('12:30');

      const afternoonIn = CHECKPOINT_PRESETS.find(p => p.label === 'Afternoon IN');
      expect(afternoonIn).toBeDefined();
      expect(afternoonIn?.type).toBe('IN');
      expect(afternoonIn?.opensAt).toBe('12:30');
      expect(afternoonIn?.closesAt).toBe('13:30');

      const afternoonOut = CHECKPOINT_PRESETS.find(p => p.label === 'Afternoon OUT');
      expect(afternoonOut).toBeDefined();
      expect(afternoonOut?.type).toBe('OUT');
      expect(afternoonOut?.opensAt).toBe('16:30');
      expect(afternoonOut?.closesAt).toBe('17:30');
    });

    it('passes window schedule validation for all presets', () => {
      for (const preset of CHECKPOINT_PRESETS) {
        const error = validateCheckpointWindow(preset.opensAt, preset.closesAt, '08:00', '17:00', preset.label);
        expect(error).toBeNull();
      }
    });

    it('simulates autofilling template and supports manual overrides before adding', () => {
      // Simulating reactive form state
      let formState = {
        label: '',
        type: 'IN' as 'IN' | 'OUT',
        opensAt: '',
        closesAt: '',
      };

      // 1. Apply preset
      const preset = CHECKPOINT_PRESETS[0]; // Morning IN
      formState = {
        label: preset.label,
        type: preset.type,
        opensAt: preset.opensAt,
        closesAt: preset.closesAt,
      };

      expect(formState.label).toBe('Morning IN');
      expect(formState.opensAt).toBe('07:00');
      expect(formState.closesAt).toBe('08:30');

      // 2. Manual override
      formState.opensAt = '06:45';
      formState.closesAt = '08:45';
      formState.label = 'Early Morning IN';

      expect(formState.label).toBe('Early Morning IN');
      expect(formState.opensAt).toBe('06:45');
      expect(formState.closesAt).toBe('08:45');

      const validationError = validateCheckpointWindow(formState.opensAt, formState.closesAt, undefined, undefined, formState.label);
      expect(validationError).toBeNull();
    });

    it('switching preset replaces only unsaved form inputs without mutating existing checkpoints', () => {
      const existingCheckpoints: AttendanceCheckpoint[] = [
        {
          id: 'cp_existing_1',
          label: 'Morning IN',
          type: 'IN',
          opensAt: '07:00',
          closesAt: '08:30',
        },
      ];

      let formState = {
        label: 'Morning IN',
        type: 'IN' as 'IN' | 'OUT',
        opensAt: '07:00',
        closesAt: '08:30',
      };

      // Switch to Morning OUT preset
      const presetOut = CHECKPOINT_PRESETS[1];
      formState = {
        label: presetOut.label,
        type: presetOut.type,
        opensAt: presetOut.opensAt,
        closesAt: presetOut.closesAt,
      };

      // Unsaved form is updated
      expect(formState.label).toBe('Morning OUT');
      expect(formState.type).toBe('OUT');
      expect(formState.opensAt).toBe('11:30');
      expect(formState.closesAt).toBe('12:30');

      // Existing checkpoints list remains untouched
      expect(existingCheckpoints).toHaveLength(1);
      expect(existingCheckpoints[0].label).toBe('Morning IN');
    });

    it('detects duplicate checkpoint labels case-insensitively', () => {
      const existingCheckpoints: AttendanceCheckpoint[] = [
        {
          id: 'cp_1',
          label: 'Morning IN',
          type: 'IN',
          opensAt: '07:00',
          closesAt: '08:30',
        },
      ];

      function checkDuplicate(newLabel: string): boolean {
        return existingCheckpoints.some(
          c => c.label.trim().toLowerCase() === newLabel.trim().toLowerCase()
        );
      }

      expect(checkDuplicate('Morning IN')).toBe(true);
      expect(checkDuplicate('morning in')).toBe(true);
      expect(checkDuplicate('  MORNING IN  ')).toBe(true);
      expect(checkDuplicate('Morning OUT')).toBe(false);
      expect(checkDuplicate('Afternoon IN')).toBe(false);
    });
  });

  describe('6. Late Attendance Window Enforcement (User Scenarios)', () => {
    const testDate = '2026-11-10';
    const lateOccurrenceId = 'occ_late_scenarios';

    const morningInCheckpoint: AttendanceCheckpoint = {
      id: 'cp_morning_in_late_test',
      label: 'Morning IN',
      type: 'IN',
      opensAt: '07:00',
      closesAt: '08:30',
      lateUntil: '11:30',
      startTime: '07:00',
      endTime: '08:30',
      orderIndex: 0,
    };

    const morningOutCheckpoint: AttendanceCheckpoint = {
      id: 'cp_morning_out_late_test',
      label: 'Morning OUT',
      type: 'OUT',
      opensAt: '11:30',
      closesAt: '12:30',
      startTime: '11:30',
      endTime: '12:30',
      orderIndex: 1,
    };

    describe('A. Pure Checkpoint Window Evaluation Logic', () => {
      it('evaluates 7:30 AM as PRESENT (within on-time window)', () => {
        const result = evaluateCheckpointWindow(testDate, morningInCheckpoint, '2026-11-10T07:30:00+08:00');
        expect(result.status).toBe('PRESENT');
        expect(result.isBeforeOpen).toBe(false);
        expect(result.isClosed).toBe(false);
        expect(result.isLate).toBe(false);
      });

      it('evaluates 8:30 AM as PRESENT (at on-time boundary)', () => {
        const result = evaluateCheckpointWindow(testDate, morningInCheckpoint, '2026-11-10T08:30:00+08:00');
        expect(result.status).toBe('PRESENT');
        expect(result.isBeforeOpen).toBe(false);
        expect(result.isClosed).toBe(false);
        expect(result.isLate).toBe(false);
      });

      it('evaluates 8:31 AM as LATE (1 minute past on-time boundary)', () => {
        const result = evaluateCheckpointWindow(testDate, morningInCheckpoint, '2026-11-10T08:31:00+08:00');
        expect(result.status).toBe('LATE');
        expect(result.isBeforeOpen).toBe(false);
        expect(result.isClosed).toBe(false);
        expect(result.isLate).toBe(true);
      });

      it('evaluates 10:34 AM as LATE (within late acceptance window)', () => {
        const result = evaluateCheckpointWindow(testDate, morningInCheckpoint, '2026-11-10T10:34:00+08:00');
        expect(result.status).toBe('LATE');
        expect(result.isBeforeOpen).toBe(false);
        expect(result.isClosed).toBe(false);
        expect(result.isLate).toBe(true);
      });

      it('evaluates 11:30 AM as LATE (at exact late window cutoff)', () => {
        const result = evaluateCheckpointWindow(testDate, morningInCheckpoint, '2026-11-10T11:30:00+08:00');
        expect(result.status).toBe('LATE');
        expect(result.isBeforeOpen).toBe(false);
        expect(result.isClosed).toBe(false);
        expect(result.isLate).toBe(true);
      });

      it('evaluates 11:31 AM as CHECKPOINT_CLOSED (after late acceptance window cutoff)', () => {
        const result = evaluateCheckpointWindow(testDate, morningInCheckpoint, '2026-11-10T11:31:00+08:00');
        expect(result.isClosed).toBe(true);
        expect(result.isBeforeOpen).toBe(false);
        expect(result.status).toBe('ABSENT');
        expect(result.errorMessage).toContain('scanning window has closed');
      });

      it('evaluates 6:59 AM as CHECKPOINT_NOT_OPEN (before opening time)', () => {
        const result = evaluateCheckpointWindow(testDate, morningInCheckpoint, '2026-11-10T06:59:00+08:00');
        expect(result.isBeforeOpen).toBe(true);
        expect(result.isClosed).toBe(false);
        expect(result.errorMessage).toContain('not open for scanning yet');
      });

      it('evaluates OUT checkpoint without late window: closed past closesAt', () => {
        // At 12:00 PM -> PRESENT
        const inside = evaluateCheckpointWindow(testDate, morningOutCheckpoint, '2026-11-10T12:00:00+08:00');
        expect(inside.status).toBe('PRESENT');
        expect(inside.isClosed).toBe(false);

        // At 12:31 PM -> CLOSED (OUT checkpoints do not accept late scans)
        const closed = evaluateCheckpointWindow(testDate, morningOutCheckpoint, '2026-11-10T12:31:00+08:00');
        expect(closed.isClosed).toBe(true);
      });
    });

    describe('B. End-to-End Attendance Service with Late Windows', () => {
      beforeAll(async () => {
        await EventsRepository.createOccurrence({
          id: lateOccurrenceId,
          event_id: eventId,
          title: 'Late Window Test Session',
          occurs_on: testDate,
          starts_at: '08:00:00',
          ends_at: '17:00:00',
          grace_minutes: 0,
          status: 'OPEN',
          checkpoints_json: JSON.stringify([morningInCheckpoint, morningOutCheckpoint]),
          active_checkpoint_id: morningInCheckpoint.id,
          updated_at: new Date().toISOString(),
        });
      });

      beforeEach(async () => {
        const db = await getDatabase();
        await db.execute('DELETE FROM attendance_audit WHERE attendance_id IN (SELECT id FROM attendance_records WHERE occurrence_id = ?)', [lateOccurrenceId]);
        await db.execute('DELETE FROM attendance_records WHERE occurrence_id = ?', [lateOccurrenceId]);
      });

      it('Scenario 1: 7:30 AM records PRESENT', async () => {
        const scanTime = `${testDate}T07:30:00`;
        const res = await attendanceService.confirmStudentAttendance(
          lateOccurrenceId,
          testStudent.id,
          'officer_window_1',
          undefined,
          undefined,
          testStudent.cardUid,
          'idem_late_scen_1',
          scanTime,
          'NFC',
          morningInCheckpoint.id
        );
        expect(res.status).toBe('RECORDED');

        const rec = await AttendanceRepository.getRecord(lateOccurrenceId, testStudent.id, morningInCheckpoint.id);
        expect(rec).not.toBeNull();
        expect(rec?.status).toBe('PRESENT');
      });

      it('Scenario 2: 8:30 AM records PRESENT', async () => {
        const scanTime = `${testDate}T08:30:00`;
        const res = await attendanceService.confirmStudentAttendance(
          lateOccurrenceId,
          testStudent.id,
          'officer_window_1',
          undefined,
          undefined,
          testStudent.cardUid,
          'idem_late_scen_2',
          scanTime,
          'NFC',
          morningInCheckpoint.id
        );
        expect(res.status).toBe('RECORDED');

        const rec = await AttendanceRepository.getRecord(lateOccurrenceId, testStudent.id, morningInCheckpoint.id);
        expect(rec?.status).toBe('PRESENT');
      });

      it('Scenario 3: 8:31 AM records LATE', async () => {
        const scanTime = `${testDate}T08:31:00`;
        const res = await attendanceService.confirmStudentAttendance(
          lateOccurrenceId,
          testStudent.id,
          'officer_window_1',
          undefined,
          undefined,
          testStudent.cardUid,
          'idem_late_scen_3',
          scanTime,
          'NFC',
          morningInCheckpoint.id
        );
        expect(res.status).toBe('RECORDED');

        const rec = await AttendanceRepository.getRecord(lateOccurrenceId, testStudent.id, morningInCheckpoint.id);
        expect(rec?.status).toBe('LATE');
      });

      it('Scenario 4: 10:34 AM records LATE', async () => {
        const scanTime = `${testDate}T10:34:00`;
        const res = await attendanceService.confirmStudentAttendance(
          lateOccurrenceId,
          testStudent.id,
          'officer_window_1',
          undefined,
          undefined,
          testStudent.cardUid,
          'idem_late_scen_4',
          scanTime,
          'NFC',
          morningInCheckpoint.id
        );
        expect(res.status).toBe('RECORDED');

        const rec = await AttendanceRepository.getRecord(lateOccurrenceId, testStudent.id, morningInCheckpoint.id);
        expect(rec?.status).toBe('LATE');
      });

      it('Scenario 5: 11:31 AM is rejected with CHECKPOINT_CLOSED', async () => {
        const scanTime = `${testDate}T11:31:00`;
        await expect(
          attendanceService.confirmStudentAttendance(
            lateOccurrenceId,
            testStudent.id,
            'officer_window_1',
            undefined,
            undefined,
            testStudent.cardUid,
            'idem_late_scen_5',
            scanTime,
            'NFC',
            morningInCheckpoint.id
          )
        ).rejects.toThrow(/scanning window has closed/i);

        const rec = await AttendanceRepository.getRecord(lateOccurrenceId, testStudent.id, morningInCheckpoint.id);
        expect(rec).toBeNull();
      });

      it('Scenario 6: Duplicate tap prevention per student and checkpoint', async () => {
        const scanTime = `${testDate}T08:00:00`;
        // First tap succeeds
        const first = await attendanceService.confirmStudentAttendance(
          lateOccurrenceId,
          testStudent.id,
          'officer_window_1',
          undefined,
          undefined,
          testStudent.cardUid,
          'idem_dupe_1',
          scanTime,
          'NFC',
          morningInCheckpoint.id
        );
        expect(first.status).toBe('RECORDED');

        // Second tap on the same checkpoint returns ALREADY_RECORDED
        const second = await attendanceService.confirmStudentAttendance(
          lateOccurrenceId,
          testStudent.id,
          'officer_window_1',
          undefined,
          undefined,
          testStudent.cardUid,
          'idem_dupe_2',
          scanTime,
          'NFC',
          morningInCheckpoint.id
        );
        expect(second.status).toBe('ALREADY_RECORDED');
        expect(second.message).toMatch(/already recorded/i);
      });

      it('Scenario 7: IN and OUT checkpoints remain independent', async () => {
        // Record Morning IN at 08:00 -> PRESENT
        await attendanceService.confirmStudentAttendance(
          lateOccurrenceId,
          testStudent.id,
          'officer_window_1',
          undefined,
          undefined,
          testStudent.cardUid,
          'idem_indep_in',
          `${testDate}T08:00:00`,
          'NFC',
          morningInCheckpoint.id
        );

        // Switch to Morning OUT
        await eventService.setActiveCheckpoint(lateOccurrenceId, morningOutCheckpoint.id);

        // Record Morning OUT at 12:00 -> PRESENT (not blocked by Morning IN)
        const outRes = await attendanceService.confirmStudentAttendance(
          lateOccurrenceId,
          testStudent.id,
          'officer_window_1',
          undefined,
          undefined,
          testStudent.cardUid,
          'idem_indep_out',
          `${testDate}T12:00:00`,
          'NFC',
          morningOutCheckpoint.id
        );
        expect(outRes.status).toBe('RECORDED');

        // Both records exist independently
        const inRec = await AttendanceRepository.getRecord(lateOccurrenceId, testStudent.id, morningInCheckpoint.id);
        const outRec = await AttendanceRepository.getRecord(lateOccurrenceId, testStudent.id, morningOutCheckpoint.id);
        expect(inRec?.status).toBe('PRESENT');
        expect(outRec?.status).toBe('PRESENT');
      });
    });
  });
});
