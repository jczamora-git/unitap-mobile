import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { attendanceService } from '@/services/attendance.service';
import { eventService } from '@/services/event.service';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { CardsRepository } from '@/database/repositories/cards.repository';
import { EventsRepository } from '@/database/repositories/events.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { AttendanceRepository } from '@/database/repositories/attendance.repository';
import type { AttendanceCheckpoint } from '@/types/event';

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
    sessionStart?: string,
    sessionEnd?: string,
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

    if (sessionStart && sessionEnd) {
      const sessionStartMin = timeToMinutes(sessionStart);
      const sessionEndMin = timeToMinutes(sessionEnd);

      if (sessionStartMin >= 0 && sessionEndMin >= 0) {
        if (openMin < sessionStartMin) {
          return `${label}: Opening time (${opensAt}) cannot be earlier than session start (${sessionStart}).`;
        }
        if (closeMin > sessionEndMin) {
          return `${label}: Closing time (${closesAt}) cannot be later than session end (${sessionEnd}).`;
        }
      }
    }

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

    it('rejects checkpoint when opening time is earlier than session start', () => {
      const err = validateCheckpointWindow('07:45', '08:30', sessionStart, sessionEnd, 'Early Bird');
      expect(err).toContain('Opening time (07:45) cannot be earlier than session start (08:00)');
    });

    it('rejects checkpoint when closing time is later than session end', () => {
      const err = validateCheckpointWindow('16:30', '17:30', sessionStart, sessionEnd, 'Late Exit');
      expect(err).toContain('Closing time (17:30) cannot be later than session end (17:00)');
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
        { id: 'cp1', label: 'Morning IN', type: 'IN', opensAt: '08:00', closesAt: '08:30' },
        { id: 'cp2', label: 'Morning OUT', type: 'OUT', opensAt: '11:30', closesAt: '12:00' },
        { id: 'cp3', label: 'Afternoon IN', type: 'IN', opensAt: '13:00', closesAt: '13:30' },
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

      // Simulating SQL: (occurs_on || ' ' || opensAt)::timestamp AT TIME ZONE 'Asia/Manila'
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

      // Checkpoints:
      // Session: 08:00 - 17:00
      // Morning IN: 08:00 - 08:30 (grace: 15 min -> 08:15)
      // Morning OUT: 11:30 - 12:00
      // Afternoon IN: 13:00 - 13:30 (grace: 15 min -> 13:15)
      // Afternoon OUT: 16:30 - 17:00
      const checkpoints: AttendanceCheckpoint[] = [
        {
          id: 'cp_morning_in',
          label: 'Morning IN',
          type: 'IN',
          opensAt: '08:00',
          closesAt: '08:30',
          startTime: '08:00',
          endTime: '08:30',
          graceMinutes: 15,
          orderIndex: 0,
        },
        {
          id: 'cp_morning_out',
          label: 'Morning OUT',
          type: 'OUT',
          opensAt: '11:30',
          closesAt: '12:00',
          startTime: '11:30',
          endTime: '12:00',
          orderIndex: 1,
        },
        {
          id: 'cp_afternoon_in',
          label: 'Afternoon IN',
          type: 'IN',
          opensAt: '13:00',
          closesAt: '13:30',
          startTime: '13:00',
          endTime: '13:30',
          graceMinutes: 15,
          orderIndex: 2,
        },
        {
          id: 'cp_afternoon_out',
          label: 'Afternoon OUT',
          type: 'OUT',
          opensAt: '16:30',
          closesAt: '17:00',
          startTime: '16:30',
          endTime: '17:00',
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

    it('allows scan within the allowed window (PRESENT within grace period)', async () => {
      // Morning IN window: 08:00 - 08:30, grace period: 15 min (until 08:15)
      // Scan at 08:10:00 (inside grace period -> PRESENT)
      const scanTime = '2026-11-10T08:10:00';
      const result = await attendanceService.confirmStudentAttendance(
        occurrenceId,
        testStudent.id,
        'officer_window_1',
        undefined, // auto status
        undefined,
        testStudent.cardUid,
        'idem_scan_inside_1',
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
      // Scan at 08:20:00 (between 08:15 grace limit and 08:30 window close)
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
      // Morning IN window opens at 08:00. Attempt scan at 07:45:00
      const earlyScanTime = '2026-11-10T07:45:00';

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
      // First, set active checkpoint to Morning OUT (11:30 - 12:00)
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

      // Scan at 11:45 within Morning OUT window (11:30 - 12:00) -> MUST SUCCEED
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

      // Scan at 12:15 after Morning OUT closed -> MUST FAIL
      const postCloseTime = '2026-11-10T12:15:00';
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
      ).rejects.toThrow(/scanning window has closed|Window closed at 12:00 PM/i);
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
});
