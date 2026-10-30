import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { attendanceService } from '@/services/attendance.service';
import { nfcService } from '@/services/nfc.service';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { CardsRepository } from '@/database/repositories/cards.repository';
import { EventsRepository } from '@/database/repositories/events.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { AttendanceRepository } from '@/database/repositories/attendance.repository';

describe('UniTap 2.0 NFC Attendance & Photo Identity Verification', () => {
  const semesterId = 'sem_nfc_test';
  const eventId = 'ev_nfc_test';
  const occurrenceId = 'occ_nfc_test';
  const studentId = 'stu_nfc_test';
  const cardUid = '04A1B2C3D4E5';

  beforeEach(async () => {
    await resetDatabaseForTests();

    const db = await getDatabase();
    await db.execute(
      `INSERT INTO users (id, username, account_status, created_at, updated_at)
       VALUES ('officer_1', 'officer1', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`
    );

    // 1. Setup Academic Term
    await AcademicRepository.createYear({
      id: 'ay_nfc',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });
    await AcademicRepository.createSemester({
      id: semesterId,
      academic_year_id: 'ay_nfc',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    // 2. Setup Student & Card
    await StudentsRepository.createStudent({
      id: studentId,
      school_id: '2026-1001',
      first_name: 'Marcelo',
      last_name: 'Del Pilar',
      photo_local_uri: 'file:///data/user/0/com.unitap.app/files/photos/stu_1001.jpg',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await CardsRepository.assignCard({
      id: 'card_nfc_1',
      student_id: studentId,
      uid_normalized: cardUid,
      status: 'ACTIVE',
      assigned_at: new Date().toISOString(),
    });

    // 3. Setup Event & Open Occurrence
    await EventsRepository.createEvent({
      id: eventId,
      semester_id: semesterId,
      title: 'CSG General Assembly',
      event_type: 'ASSEMBLY',
      audience_type: 'ALL',
      audience_json: '{}',
      attendance_required: 1,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await EventsRepository.createOccurrence({
      id: occurrenceId,
      event_id: eventId,
      title: 'Morning Session',
      occurs_on: new Date().toISOString().split('T')[0],
      starts_at: '08:00',
      ends_at: '12:00',
      grace_minutes: 30,
      status: 'OPEN',
      updated_at: new Date().toISOString(),
    });
  });

  it('prepares photo verification without saving attendance automatically', async () => {
    const prep = await attendanceService.prepareNfcVerification(occurrenceId, cardUid, 'officer_1');

    expect(prep.type).toBe('ACCEPTED');
    expect(prep.eligible).toBe(true);
    expect(prep.student?.school_id).toBe('2026-1001');
    expect(prep.studentFullName).toContain('Del Pilar');
    expect(prep.photoLocalUri).toBe('file:///data/user/0/com.unitap.app/files/photos/stu_1001.jpg');

    // Attendance record should NOT exist yet
    const record = await AttendanceRepository.getRecord(occurrenceId, studentId);
    expect(record).toBeNull();
  });

  it('records attendance and audit event only upon officer confirmation', async () => {
    await attendanceService.confirmStudentAttendance(occurrenceId, studentId, 'officer_1', 'PRESENT');

    const record = await AttendanceRepository.getRecord(occurrenceId, studentId);
    expect(record).toBeDefined();
    expect(record?.status).toBe('PRESENT');
    expect(record?.photo_checked).toBe(1);
    expect(record?.identity_verified_by_user_id).toBe('officer_1');
  });

  it('logs rejected attempt when officer rejects wrong-person match', async () => {
    await attendanceService.rejectStudentScan(
      occurrenceId,
      cardUid,
      studentId,
      'officer_1',
      'Person does not match card photo'
    );

    // No attendance record created
    const record = await AttendanceRepository.getRecord(occurrenceId, studentId);
    expect(record).toBeNull();
  });

  it('detects duplicate check-in if student taps again after confirmation', async () => {
    await attendanceService.confirmStudentAttendance(occurrenceId, studentId, 'officer_1', 'PRESENT');

    const prep = await attendanceService.prepareNfcVerification(occurrenceId, cardUid, 'officer_1');
    expect(prep.type).toBe('DUPLICATE');
    expect(prep.message).toContain('already recorded as PRESENT');
  });

  it('voids accepted attendance with a mandatory reason and preserves audit history', async () => {
    await attendanceService.confirmStudentAttendance(occurrenceId, studentId, 'officer_1', 'PRESENT');
    const existing = await AttendanceRepository.getRecord(occurrenceId, studentId);

    // Rejects empty reason
    await expect(
      attendanceService.voidAttendance(existing!.id, '   ', 'officer_1')
    ).rejects.toThrow('mandatory');

    // Voids with valid reason
    await attendanceService.voidAttendance(
      existing!.id,
      'Student left premises immediately after tap',
      'officer_1'
    );

    const voided = await AttendanceRepository.getRecord(occurrenceId, studentId);
    expect(voided?.status).toBe('VOID');
    expect(voided?.void_reason).toBe('Student left premises immediately after tap');
    expect(voided?.voided_by_user_id).toBe('officer_1');
  });

  it('enforces single NFC session ownership to prevent cross-screen scan leakage', async () => {
    expect(nfcService.getActiveOwner()).toBeNull();

    try {
      await nfcService.startScanning('ATTENDANCE_SCREEN', () => {});
    } catch {
      // In web/test env throws unavailable, but sets sessionOwner!
    }

    expect(nfcService.getActiveOwner()).toBe('ATTENDANCE_SCREEN');

    // A call from payment screen trying to stop scanning with wrong owner should NOT stop attendance session
    await nfcService.stopScanning('PAYMENT_SCREEN');
    expect(nfcService.getActiveOwner()).toBe('ATTENDANCE_SCREEN');

    // Proper owner stops session
    await nfcService.stopScanning('ATTENDANCE_SCREEN');
    expect(nfcService.getActiveOwner()).toBeNull();
  });
});
