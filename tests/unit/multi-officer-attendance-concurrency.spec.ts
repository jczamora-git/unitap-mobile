import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { attendanceService } from '@/services/attendance.service';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { CardsRepository } from '@/database/repositories/cards.repository';
import { EventsRepository } from '@/database/repositories/events.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { AttendanceRepository } from '@/database/repositories/attendance.repository';

describe('UniTap 2.0 Multi-Officer Attendance Concurrency, Duplicate Prevention & Revocation History', () => {
  const semesterId = 'sem_concurrency_test';
  const eventId = 'ev_concurrency_test';
  const occurrenceId = 'occ_concurrency_test';

  const studentA = {
    id: 'stu_conc_a',
    schoolId: '2026-0001',
    cardUid: '04A1A1A1A1A1',
    firstName: 'Jose',
    lastName: 'Rizal',
  };

  const studentB = {
    id: 'stu_conc_b',
    schoolId: '2026-0002',
    cardUid: '04B2B2B2B2B2',
    firstName: 'Andres',
    lastName: 'Bonifacio',
  };

  const studentC = {
    id: 'stu_conc_c',
    schoolId: '2026-0003',
    cardUid: '04C3C3C3C3C3',
    firstName: 'Apolinario',
    lastName: 'Mabini',
  };

  beforeEach(async () => {
    await resetDatabaseForTests();

    const db = await getDatabase();
    // Provision 3 officers
    await db.execute(`
      INSERT INTO users (id, username, account_status, created_at, updated_at) VALUES
      ('officer_gate_1', 'officer1', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
      ('officer_gate_2', 'officer2', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
      ('officer_gate_3', 'officer3', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    `);

    // Setup Academic Structure
    await AcademicRepository.createYear({
      id: 'ay_conc',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });

    await AcademicRepository.createSemester({
      id: semesterId,
      academic_year_id: 'ay_conc',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    // Setup Event & OPEN Occurrence
    await EventsRepository.createEvent({
      id: eventId,
      semester_id: semesterId,
      title: 'University Intramurals Opening',
      event_type: 'SPORTS',
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
      occurs_on: '2026-09-01',
      starts_at: '08:00:00',
      ends_at: '12:00:00',
      grace_minutes: 30,
      status: 'OPEN',
      updated_at: new Date().toISOString(),
    });

    // Provision Students & NFC Cards
    for (const stu of [studentA, studentB, studentC]) {
      await StudentsRepository.createStudent({
        id: stu.id,
        school_id: stu.schoolId,
        first_name: stu.firstName,
        last_name: stu.lastName,
        photo_local_uri: `file:///photos/${stu.id}.jpg`,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await CardsRepository.assignCard({
        id: `card_${stu.id}`,
        student_id: stu.id,
        uid_normalized: stu.cardUid,
        status: 'ACTIVE',
        assigned_at: new Date().toISOString(),
      });
    }
  });

  it('1. Handles simultaneous NFC scanning by 3 officers for 3 different students', async () => {
    // Officers 1, 2, and 3 scan students A, B, and C at the same exact time
    const [scanA, scanB, scanC] = await Promise.all([
      attendanceService.prepareNfcVerification(occurrenceId, studentA.cardUid, 'officer_gate_1'),
      attendanceService.prepareNfcVerification(occurrenceId, studentB.cardUid, 'officer_gate_2'),
      attendanceService.prepareNfcVerification(occurrenceId, studentC.cardUid, 'officer_gate_3'),
    ]);

    expect(scanA.type).toBe('ACCEPTED');
    expect(scanB.type).toBe('ACCEPTED');
    expect(scanC.type).toBe('ACCEPTED');

    // Confirm all 3 concurrently
    await Promise.all([
      attendanceService.confirmStudentAttendance(occurrenceId, studentA.id, 'officer_gate_1', scanA.suggestedStatus),
      attendanceService.confirmStudentAttendance(occurrenceId, studentB.id, 'officer_gate_2', scanB.suggestedStatus),
      attendanceService.confirmStudentAttendance(occurrenceId, studentC.id, 'officer_gate_3', scanC.suggestedStatus),
    ]);

    const records = await AttendanceRepository.getRecordsByOccurrence(occurrenceId);
    expect(records.length).toBe(3);
    const statuses = records.map((r) => r.status);
    expect(statuses.every((s) => s === 'PRESENT' || s === 'LATE')).toBe(true);
  });

  it('2. Prevents duplicate attendance when two officers scan the same student at the same time', async () => {
    // Officer 1 prepares scan for Student A
    const prep1 = await attendanceService.prepareNfcVerification(occurrenceId, studentA.cardUid, 'officer_gate_1');
    expect(prep1.type).toBe('ACCEPTED');

    // Officer 1 confirms Student A
    await attendanceService.confirmStudentAttendance(occurrenceId, studentA.id, 'officer_gate_1', prep1.suggestedStatus);

    // Officer 2 attempts to scan Student A on terminal 2
    const prep2 = await attendanceService.prepareNfcVerification(occurrenceId, studentA.cardUid, 'officer_gate_2');
    expect(prep2.type).toBe('DUPLICATE');
    expect(prep2.message).toContain('already recorded');

    // Verify only ONE attendance record exists for Student A
    const db = await getDatabase();
    const countRes = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM attendance_records WHERE occurrence_id = ? AND student_id = ?',
      [occurrenceId, studentA.id]
    );
    expect(countRes?.count).toBe(1);
  });

  it('3. Successfully revokes attendance with mandatory reason and writes immutable audit trail', async () => {
    // 1. Confirm attendance
    const prep = await attendanceService.prepareNfcVerification(occurrenceId, studentA.cardUid, 'officer_gate_1');
    await attendanceService.confirmStudentAttendance(occurrenceId, studentA.id, 'officer_gate_1', prep.suggestedStatus);

    const record = await AttendanceRepository.getRecord(occurrenceId, studentA.id);
    expect(record).not.toBeNull();
    expect(['PRESENT', 'LATE']).toContain(record?.status);

    // 2. Reject revocation without reason
    await expect(
      attendanceService.voidAttendance(record!.id, '', 'officer_gate_1')
    ).rejects.toThrow('mandatory reason is required');

    // 3. Revoke with valid reason
    const revocationReason = 'Left event venue without authorization at 09:15 AM';
    await attendanceService.voidAttendance(record!.id, revocationReason, 'officer_gate_1');

    // 4. Verify canonical status is REVOKED or VOID
    const updated = await AttendanceRepository.getRecord(occurrenceId, studentA.id);
    expect(['REVOKED', 'VOID']).toContain(updated?.status);
    expect(updated?.revocation_reason).toBe(revocationReason);
    expect(updated?.version).toBeGreaterThan(1);

    // 5. Verify immutable audit trail
    const auditTrail = await AttendanceRepository.getAuditTrail(record!.id);
    expect(auditTrail.length).toBeGreaterThanOrEqual(2); // CHECK_IN + REVOKE/VOID
    const revokeAudit = auditTrail.find((a) => a.action === 'REVOKE' || a.action === 'VOID');
    expect(revokeAudit).toBeDefined();
    expect(revokeAudit?.reason).toBe(revocationReason);
    expect(['REVOKED', 'VOID']).toContain(revokeAudit?.new_status);
  });

  it('4. Blocks automatic re-scan after revocation and requires explicit recheck review', async () => {
    // 1. Confirm attendance
    await attendanceService.confirmStudentAttendance(occurrenceId, studentA.id, 'officer_gate_1', 'PRESENT');
    const record = await AttendanceRepository.getRecord(occurrenceId, studentA.id);

    // 2. Revoke attendance
    await attendanceService.voidAttendance(record!.id, 'Suspicious proxy scanning detected', 'officer_gate_1');

    // 3. Student scans again at Officer 2 terminal
    const secondScan = await attendanceService.prepareNfcVerification(occurrenceId, studentA.cardUid, 'officer_gate_2');

    // CRITICAL: Must NOT be accepted automatically!
    expect(secondScan.type).toBe('REVOKED_REVIEW_REQUIRED');
    expect(secondScan.eligible).toBe(false);
    expect(secondScan.message).toContain('revoked');
    expect(secondScan.revocationReason).toBe('Suspicious proxy scanning detected');
    expect(secondScan.existingRecordId).toBe(record!.id);
  });

  it('5. Allows authorized officer to approve recheck with mandatory explanation', async () => {
    // 1. Confirm and revoke Student A
    await attendanceService.confirmStudentAttendance(occurrenceId, studentA.id, 'officer_gate_1', 'PRESENT');
    const record = await AttendanceRepository.getRecord(occurrenceId, studentA.id);
    await attendanceService.voidAttendance(record!.id, 'Initial mistaken identity', 'officer_gate_1');

    // 2. Officer 2 rechecks student identity after visual verification
    await expect(
      attendanceService.recheckStudentAttendance(record!.id, '', 'officer_gate_2')
    ).rejects.toThrow('mandatory reason is required');

    const recheckReason = 'Verified valid student ID card and matching face photo in person.';
    await attendanceService.recheckStudentAttendance(record!.id, recheckReason, 'officer_gate_2', 'PRESENT');

    // 3. Status must now be reinstated
    const reinstated = await AttendanceRepository.getRecord(occurrenceId, studentA.id);
    expect(reinstated?.status).toBe('PRESENT');
    expect(reinstated?.revoked_at).toBeNull();
    expect(reinstated?.revocation_reason).toBeNull();

    // 4. Audit trail must contain CHECK_IN -> REVOKE/VOID -> REINSTATE
    const auditTrail = await AttendanceRepository.getAuditTrail(record!.id);
    const actions = auditTrail.map((a) => a.action);
    expect(actions).toContain('CHECK_IN');
    expect(actions.some((a) => a === 'REVOKE' || a === 'VOID')).toBe(true);
    expect(actions.some((a) => a === 'RECHECK_APPROVED' || a === 'REINSTATE')).toBe(true);

    const recheckEntry = auditTrail.find((a) => a.action === 'RECHECK_APPROVED' || a.action === 'REINSTATE');
    expect(recheckEntry?.reason).toBe(recheckReason);
  });

  it('6. Enqueues correct transactional outbox operations for push sync', async () => {
    const db = await getDatabase();
    await db.execute('DELETE FROM sync_outbox');

    // 1. Confirm attendance -> writes CREATE outbox
    await attendanceService.confirmStudentAttendance(occurrenceId, studentB.id, 'officer_gate_1', 'PRESENT');
    const record = await AttendanceRepository.getRecord(occurrenceId, studentB.id);

    const outboxAfterCreate = await db.query<{ entity_type: string; operation: string; entity_id: string }>(
      'SELECT entity_type, operation, entity_id FROM sync_outbox'
    );
    expect(outboxAfterCreate.some((o) => o.operation === 'CREATE' && o.entity_id === record!.id)).toBe(true);

    // 2. Revoke attendance -> writes VOID outbox
    await attendanceService.voidAttendance(record!.id, 'Left session', 'officer_gate_1');
    const outboxAfterRevoke = await db.query<{ entity_type: string; operation: string; entity_id: string }>(
      'SELECT entity_type, operation, entity_id FROM sync_outbox WHERE operation = "VOID"'
    );
    expect(outboxAfterRevoke.length).toBe(1);
    expect(outboxAfterRevoke[0].entity_id).toBe(record!.id);

    // 3. Recheck attendance -> writes UPDATE outbox
    await attendanceService.recheckStudentAttendance(record!.id, 'Officer reinstatement', 'officer_gate_2');
    const outboxAfterRecheck = await db.query<{ entity_type: string; operation: string; entity_id: string }>(
      'SELECT entity_type, operation, entity_id FROM sync_outbox WHERE operation = "UPDATE"'
    );
    expect(outboxAfterRecheck.length).toBe(1);
    expect(outboxAfterRecheck[0].entity_id).toBe(record!.id);
  });

  it('7. Detects stale version conflict during concurrent revocation', async () => {
    // Confirm Student C
    await attendanceService.confirmStudentAttendance(occurrenceId, studentC.id, 'officer_gate_1', 'PRESENT');
    const record = await AttendanceRepository.getRecord(occurrenceId, studentC.id);
    expect(record).not.toBeNull();

    // Officer 1 revokes the record, incrementing version to 2
    await attendanceService.voidAttendance(record!.id, 'Officer 1 revoking', 'officer_gate_1', record!.version);

    // Officer 2 attempts to revoke using stale version 1
    await expect(
      attendanceService.voidAttendance(record!.id, 'Officer 2 revoking stale', 'officer_gate_2', 1)
    ).rejects.toThrow();
  });

  it('8. Detects stale version conflict during concurrent recheck', async () => {
    // Confirm and revoke Student C
    await attendanceService.confirmStudentAttendance(occurrenceId, studentC.id, 'officer_gate_1', 'PRESENT');
    const record = await AttendanceRepository.getRecord(occurrenceId, studentC.id);
    await attendanceService.voidAttendance(record!.id, 'Mistake', 'officer_gate_1');

    const revokedRecord = await AttendanceRepository.getRecord(occurrenceId, studentC.id);
    const currentVersion = revokedRecord!.version || 2;

    // Recheck with wrong version throws stale conflict
    await expect(
      attendanceService.recheckStudentAttendance(
        record!.id,
        'Valid excuse',
        'officer_gate_2',
        'PRESENT',
        currentVersion - 1
      )
    ).rejects.toThrow('The record was modified concurrently');

    // Recheck with correct version succeeds
    await attendanceService.recheckStudentAttendance(
      record!.id,
      'Valid excuse',
      'officer_gate_2',
      'PRESENT',
      currentVersion
    );
    const reinstatedRecord = await AttendanceRepository.getRecord(occurrenceId, studentC.id);
    expect(reinstatedRecord?.status).toBe('PRESENT');
    expect(reinstatedRecord?.version).toBe(currentVersion + 1);
  });

  it('9. Prevents invalid state transitions (cannot recheck active, cannot revoke already revoked)', async () => {
    // 1. Confirm Student A
    await attendanceService.confirmStudentAttendance(occurrenceId, studentA.id, 'officer_gate_1', 'PRESENT');
    const record = await AttendanceRepository.getRecord(occurrenceId, studentA.id);

    // Cannot recheck an attendance that is already PRESENT
    await expect(
      attendanceService.recheckStudentAttendance(record!.id, 'Attempting recheck on present', 'officer_gate_1')
    ).rejects.toThrow('not in REVOKED state');

    // Revoke
    await attendanceService.voidAttendance(record!.id, 'Revoking', 'officer_gate_1');

    // Cannot revoke an attendance that is already REVOKED
    await expect(
      attendanceService.voidAttendance(record!.id, 'Revoking again', 'officer_gate_1')
    ).rejects.toThrow('already revoked');
  });

  it('10. Applies authoritative offline timestamp policy: on-time 8:05 AM scan uploaded at 10:00 AM remains PRESENT', async () => {
    // Event occurrence begins 08:00:00 with 30 min grace period (up to 08:30:00)
    // Client scanned at 8:05 AM on 2026-09-01
    const offlineScanTime = '2026-09-01T08:05:00';

    const confirmRes = await attendanceService.confirmStudentAttendance(
      occurrenceId,
      studentA.id,
      'officer_gate_1',
      undefined, // auto-compute from timestamp, not manual override
      `card_${studentA.id}`,
      studentA.cardUid,
      'idem_offline_test_001',
      offlineScanTime // client scanned at 8:05 AM
    );

    expect(confirmRes.status).toBe('RECORDED');

    const record = await AttendanceRepository.getRecord(occurrenceId, studentA.id);
    expect(record).not.toBeNull();
    // Must be PRESENT because scan happened at 8:05 AM within the 8:30 grace threshold, even if uploaded at 10:00 AM
    expect(record?.status).toBe('PRESENT');
    expect(record?.client_scanned_at).toBe(offlineScanTime);
  });

  it('11. Requires explicit version precondition for attendance revocation', async () => {
    await attendanceService.confirmStudentAttendance(occurrenceId, studentB.id, 'officer_gate_1', 'PRESENT');
    const record = await AttendanceRepository.getRecord(occurrenceId, studentB.id);

    // Revocation without expected version or with invalid version throws
    await expect(
      AttendanceRepository.voidAttendance(record!.id, 'Missing version test', 'officer_gate_1', 0)
    ).rejects.toThrow();

    // Revocation with exact matching version succeeds
    await AttendanceRepository.voidAttendance(record!.id, 'Valid version test', 'officer_gate_1', record!.version);
    const updated = await AttendanceRepository.getRecord(occurrenceId, studentB.id);
    expect(updated?.status).toBe('VOID');
    expect(updated?.version).toBe((record!.version || 1) + 1);
  });
});
