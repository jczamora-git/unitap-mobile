import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { FinanceRepository } from '@/database/repositories/finance.repository';
import { EventsRepository } from '@/database/repositories/events.repository';
import { AttendanceRepository } from '@/database/repositories/attendance.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import type { SyncOutboxRecord } from '@/types/database';

describe('UniTap 2.0 Event-Based Absentee Detection & Bulk Fine Assessment', () => {
  const semesterId = 'sem_absentee_2026';
  const eventId = 'evt_assembly_2026';
  const occurrenceId = 'occ_session_1';
  const ruleId = 'rule_assembly_absence';

  // 6 Students for exhaustive scenario testing
  const stuPresent = 'stu_present_1';
  const stuLate = 'stu_late_2';
  const stuExcused = 'stu_excused_3';
  const stuAbsent = 'stu_absent_4';
  const stuVoidAttendance = 'stu_void_5';
  const stuNotRequired = 'stu_not_req_6';

  beforeEach(async () => {
    await resetDatabaseForTests();
    const db = await getDatabase();

    // 1. Officer user
    await db.execute(
      `INSERT INTO users (id, username, account_status, created_at, updated_at)
       VALUES ('officer_test', 'officer_test', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`
    );

    // 2. Academic structure
    await AcademicRepository.createYear({
      id: 'ay_2026',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });

    await AcademicRepository.createSemester({
      id: semesterId,
      academic_year_id: 'ay_2026',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    // 3. Create Students
    const studentDefs = [
      { id: stuPresent, school_id: '2026-0001', first_name: 'Juan', last_name: 'Dela Cruz' },
      { id: stuLate, school_id: '2026-0002', first_name: 'Maria', last_name: 'Clara' },
      { id: stuExcused, school_id: '2026-0003', first_name: 'Crisostomo', last_name: 'Ibarra' },
      { id: stuAbsent, school_id: '2026-0004', first_name: 'Basilio', last_name: 'Sison' },
      { id: stuVoidAttendance, school_id: '2026-0005', first_name: 'Crispin', last_name: 'Sison' },
      { id: stuNotRequired, school_id: '2026-0006', first_name: 'Elias', last_name: 'Salome' },
    ];

    for (const s of studentDefs) {
      await StudentsRepository.createStudent({
        id: s.id,
        school_id: s.school_id,
        first_name: s.first_name,
        last_name: s.last_name,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await AcademicRepository.createEnrollment({
        id: 'enr_' + s.id,
        student_id: s.id,
        semester_id: semesterId,
        year_level: 2,
        section: '2F1',
        enrollment_status: 'ENROLLED',
        first_name_snapshot: s.first_name,
        last_name_snapshot: s.last_name,
        updated_at: new Date().toISOString(),
      });
    }

    // 4. Create Event & Occurrence
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
      occurs_on: '2026-09-15',
      starts_at: '08:00',
      ends_at: '12:00',
      grace_minutes: 15,
      status: 'CLOSED', // Officially closed/finalized
      opened_at: '2026-09-15T08:00:00Z',
      closed_at: '2026-09-15T12:00:00Z',
      updated_at: new Date().toISOString(),
    });

    // 5. Create Obligation Rule for Absence
    await FinanceRepository.createRule({
      id: ruleId,
      semester_id: semesterId,
      name: 'Assembly Absence Fine',
      type: 'FINE',
      trigger_type: 'ABSENCE',
      default_amount_centavos: 5000, // ₱50.00
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
    });

    // 6. Populate event_participants
    // Students 1 to 5: required = 1, excused = 0 (except stuExcused has excused = 1)
    // Student 6: required = 0
    await db.execute(
      `INSERT INTO event_participants (id, occurrence_id, student_id, enrollment_id, attendance_required, excused, added_at)
       VALUES
       ('ep_1', '${occurrenceId}', '${stuPresent}', 'enr_${stuPresent}', 1, 0, '2026-09-15T07:00:00Z'),
       ('ep_2', '${occurrenceId}', '${stuLate}', 'enr_${stuLate}', 1, 0, '2026-09-15T07:00:00Z'),
       ('ep_3', '${occurrenceId}', '${stuExcused}', 'enr_${stuExcused}', 1, 1, '2026-09-15T07:00:00Z'),
       ('ep_4', '${occurrenceId}', '${stuAbsent}', 'enr_${stuAbsent}', 1, 0, '2026-09-15T07:00:00Z'),
       ('ep_5', '${occurrenceId}', '${stuVoidAttendance}', 'enr_${stuVoidAttendance}', 1, 0, '2026-09-15T07:00:00Z'),
       ('ep_6', '${occurrenceId}', '${stuNotRequired}', 'enr_${stuNotRequired}', 0, 0, '2026-09-15T07:00:00Z')`
    );

    // 7. Record Attendance
    // Student 1: PRESENT
    await AttendanceRepository.recordAttendance(
      {
        id: 'att_1',
        occurrence_id: occurrenceId,
        student_id: stuPresent,
        status: 'PRESENT',
        checked_in_at: '2026-09-15T08:05:00Z',
        method: 'NFC',
        photo_checked: 1,
        updated_at: '2026-09-15T08:05:00Z',
      },
      'officer_test'
    );

    // Student 2: LATE
    await AttendanceRepository.recordAttendance(
      {
        id: 'att_2',
        occurrence_id: occurrenceId,
        student_id: stuLate,
        status: 'LATE',
        checked_in_at: '2026-09-15T08:45:00Z',
        method: 'NFC',
        photo_checked: 1,
        updated_at: '2026-09-15T08:45:00Z',
      },
      'officer_test'
    );

    // Student 5: Had attendance, but it was VOIDED
    await AttendanceRepository.recordAttendance(
      {
        id: 'att_5',
        occurrence_id: occurrenceId,
        student_id: stuVoidAttendance,
        status: 'PRESENT',
        checked_in_at: '2026-09-15T08:10:00Z',
        method: 'NFC',
        photo_checked: 1,
        updated_at: '2026-09-15T08:10:00Z',
      },
      'officer_test'
    );
    await AttendanceRepository.voidAttendance('att_5', 'Proxy NFC card detected', 'officer_test');
  });

  // ==========================================================================
  // --- 1. ABSENTEE DETECTION TESTS ---
  // ==========================================================================

  it('excludes required student with PRESENT attendance', async () => {
    const { candidates } = await FinanceRepository.getAbsenteeCandidates(occurrenceId, ruleId);
    expect(candidates.some((c) => c.studentId === stuPresent)).toBe(false);
  });

  it('excludes required student with LATE attendance', async () => {
    const { candidates } = await FinanceRepository.getAbsenteeCandidates(occurrenceId, ruleId);
    expect(candidates.some((c) => c.studentId === stuLate)).toBe(false);
  });

  it('excludes student with approved excuse (excused = 1)', async () => {
    const { candidates } = await FinanceRepository.getAbsenteeCandidates(occurrenceId, ruleId);
    expect(candidates.some((c) => c.studentId === stuExcused)).toBe(false);
  });

  it('includes required student without valid attendance as absentee', async () => {
    const { candidates } = await FinanceRepository.getAbsenteeCandidates(occurrenceId, ruleId);
    const absent = candidates.find((c) => c.studentId === stuAbsent);
    expect(absent).toBeDefined();
    expect(absent?.attendanceRequired).toBe(true);
    expect(absent?.alreadyFined).toBe(false);
  });

  it('excludes student who is not required to attend (attendance_required = 0)', async () => {
    const { candidates } = await FinanceRepository.getAbsenteeCandidates(occurrenceId, ruleId);
    expect(candidates.some((c) => c.studentId === stuNotRequired)).toBe(false);
  });

  it('evaluates voided attendance correctly by including student as absent', async () => {
    const { candidates } = await FinanceRepository.getAbsenteeCandidates(occurrenceId, ruleId);
    const voidedStu = candidates.find((c) => c.studentId === stuVoidAttendance);
    expect(voidedStu).toBeDefined();
    expect(voidedStu?.fullName).toContain('Crispin');
  });

  it('prevents generating fines if attendance session is still OPEN or SCHEDULED', async () => {
    // Open the occurrence session
    await EventsRepository.updateOccurrence({
      id: occurrenceId,
      status: 'OPEN',
    });

    await expect(
      FinanceRepository.assessBulkFines({
        occurrenceId,
        ruleId,
        fineTitle: 'Assembly Absence Fine',
        amountCentavos: 5000,
        studentIds: [stuAbsent],
        actorUserId: 'officer_test',
      })
    ).rejects.toThrow('still open');
  });

  // ==========================================================================
  // --- 2. BULK FINE ASSESSMENT TESTS ---
  // ==========================================================================

  it('allows officers to select and bulk assess all eligible absentees', async () => {
    const { candidates } = await FinanceRepository.getAbsenteeCandidates(occurrenceId, ruleId);
    const eligibleIds = candidates.filter((c) => !c.alreadyFined).map((c) => c.studentId);
    expect(eligibleIds.length).toBe(2); // stuAbsent and stuVoidAttendance

    const result = await FinanceRepository.assessBulkFines({
      occurrenceId,
      ruleId,
      fineTitle: 'CSG Assembly Absence Fine',
      amountCentavos: 5000,
      studentIds: eligibleIds,
      dueDate: '2026-10-15',
      notes: 'Resolution 2026-01',
      actorUserId: 'officer_test',
    });

    expect(result.assessedCount).toBe(2);
    expect(result.totalAssessedCentavos).toBe(10000); // 2 * ₱50.00 = ₱100.00
    expect(result.createdObligations.length).toBe(2);

    // Verify obligations created in database
    const obAbsent = await FinanceRepository.getStudentObligations(stuAbsent, semesterId);
    expect(obAbsent.length).toBe(1);
    expect(obAbsent[0].amount_centavos).toBe(5000);
    expect(obAbsent[0].balance_centavos).toBe(5000);
    expect(obAbsent[0].related_occurrence_id).toBe(occurrenceId);
  });

  it('prevents duplicate absence fines for already-fined students', async () => {
    // 1. Fine stuAbsent first
    await FinanceRepository.assessBulkFines({
      occurrenceId,
      ruleId,
      fineTitle: 'Assembly Absence Fine',
      amountCentavos: 5000,
      studentIds: [stuAbsent],
      actorUserId: 'officer_test',
    });

    // 2. Query candidates again -> stuAbsent should show alreadyFined = true
    const { candidates } = await FinanceRepository.getAbsenteeCandidates(occurrenceId, ruleId);
    const absentCandidate = candidates.find((c) => c.studentId === stuAbsent);
    expect(absentCandidate?.alreadyFined).toBe(true);

    // 3. Re-attempting to fine stuAbsent skips it safely without creating duplicate
    const retryResult = await FinanceRepository.assessBulkFines({
      occurrenceId,
      ruleId,
      fineTitle: 'Assembly Absence Fine',
      amountCentavos: 5000,
      studentIds: [stuAbsent, stuVoidAttendance],
      actorUserId: 'officer_test',
    });

    expect(retryResult.skippedCount).toBe(1); // stuAbsent was skipped
    expect(retryResult.assessedCount).toBe(1); // stuVoidAttendance was assessed

    // Total obligations for stuAbsent remains exactly 1
    const obligations = await FinanceRepository.getStudentObligations(stuAbsent, semesterId);
    expect(obligations.length).toBe(1);
  });

  it('rejects invalid or non-positive fine amounts', async () => {
    await expect(
      FinanceRepository.assessBulkFines({
        occurrenceId,
        ruleId,
        fineTitle: 'Invalid Fine',
        amountCentavos: 0,
        studentIds: [stuAbsent],
        actorUserId: 'officer_test',
      })
    ).rejects.toThrow('positive integer');

    await expect(
      FinanceRepository.assessBulkFines({
        occurrenceId,
        ruleId,
        fineTitle: 'Negative Fine',
        amountCentavos: -500,
        studentIds: [stuAbsent],
        actorUserId: 'officer_test',
      })
    ).rejects.toThrow('positive integer');
  });

  it('queues outbox operations and audit events upon bulk assessment', async () => {
    const db = await getDatabase();

    await FinanceRepository.assessBulkFines({
      occurrenceId,
      ruleId,
      fineTitle: 'Assembly Absence Fine',
      amountCentavos: 5000,
      studentIds: [stuAbsent],
      actorUserId: 'officer_test',
    });

    // Verify outbox entry
    const outboxRows = await db.query<SyncOutboxRecord>(
      "SELECT * FROM sync_outbox WHERE entity_type = 'OBLIGATION'"
    );
    expect(outboxRows.length).toBeGreaterThan(0);

    // Verify audit event
    const auditRows = await db.query<{ action: string; entity_type: string }>(
      "SELECT * FROM audit_events WHERE entity_type = 'BULK_FINE_ASSESSMENT'"
    );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].action).toBe('CREATE');
  });

  it('rejects ineligible students safely during bulk assessment', async () => {
    // Attempt to fine a student who was PRESENT (stuPresent)
    const result = await FinanceRepository.assessBulkFines({
      occurrenceId,
      ruleId,
      fineTitle: 'Invalid Absence Fine',
      amountCentavos: 5000,
      studentIds: [stuPresent],
      actorUserId: 'officer_test',
    });

    expect(result.invalidCount).toBe(1);
    expect(result.assessedCount).toBe(0);

    const ob = await FinanceRepository.getStudentObligations(stuPresent, semesterId);
    expect(ob.length).toBe(0);
  });

  it('supports per-checkpoint absentee detection and fine assessment', async () => {
    const { eventService } = await import('@/services/event.service');

    // Configure 2 checkpoints: Morning IN and Morning OUT
    const checkpoints = [
      { id: 'cp_in', label: 'Morning IN', type: 'IN' as const, orderIndex: 0 },
      { id: 'cp_out', label: 'Morning OUT', type: 'OUT' as const, orderIndex: 1 },
    ];
    await eventService.updateOccurrenceCheckpoints(occurrenceId, checkpoints);

    // stuAbsent scanned Morning IN only (partial attendance)
    await AttendanceRepository.recordAttendance(
      {
        id: 'att_stu_absent_cp_in',
        occurrence_id: occurrenceId,
        student_id: stuAbsent,
        status: 'PRESENT',
        checked_in_at: '2026-09-15T08:05:00Z',
        method: 'NFC',
        checkpoint_id: 'cp_in',
        photo_checked: 0,
        updated_at: '2026-09-15T08:05:00Z',
      },
      'officer_test'
    );

    // 1. Checkpoint IN absentee detection: stuAbsent should NOT be absent
    const inResult = await FinanceRepository.getAbsenteeCandidates(occurrenceId, ruleId, 'cp_in');
    expect(inResult.candidates.some((c) => c.studentId === stuAbsent)).toBe(false);

    // 2. Checkpoint OUT absentee detection: stuAbsent SHOULD be absent
    const outResult = await FinanceRepository.getAbsenteeCandidates(occurrenceId, ruleId, 'cp_out');
    expect(outResult.candidates.some((c) => c.studentId === stuAbsent)).toBe(true);

    // 3. Whole-Event mode: stuAbsent has partial attendance, so NOT a whole-event absentee
    const wholeResult = await FinanceRepository.getAbsenteeCandidates(occurrenceId, ruleId);
    expect(wholeResult.candidates.some((c) => c.studentId === stuAbsent)).toBe(false);

    // 4. Assess bulk fine for Checkpoint OUT
    const assessResult = await FinanceRepository.assessBulkFines({
      occurrenceId,
      ruleId,
      fineTitle: 'Absence Fine: Morning OUT',
      amountCentavos: 3000,
      studentIds: [stuAbsent],
      actorUserId: 'officer_test',
      mode: 'PER_CHECKPOINT',
      checkpointId: 'cp_out',
    });
    expect(assessResult.assessedCount).toBe(1);

    // 5. Duplicate assessment check (idempotency)
    const duplicateResult = await FinanceRepository.assessBulkFines({
      occurrenceId,
      ruleId,
      fineTitle: 'Absence Fine: Morning OUT',
      amountCentavos: 3000,
      studentIds: [stuAbsent],
      actorUserId: 'officer_test',
      mode: 'PER_CHECKPOINT',
      checkpointId: 'cp_out',
    });
    expect(duplicateResult.skippedCount).toBe(1);
    expect(duplicateResult.assessedCount).toBe(0);
  });

  it('initializes canonical checkpoints with default_in when checkpoints omitted', async () => {
    const { eventService } = await import('@/services/event.service');
    const occ = await eventService.createOccurrence({
      eventId,
      title: 'Canonical Session',
      date: '2026-10-15',
      startTime: '08:00',
      endTime: '12:00',
    });

    expect(occ.checkpoints).toBeDefined();
    expect(occ.checkpoints!.length).toBe(1);
    expect(occ.checkpoints![0].id).toBe('default_in');
    expect(occ.activeCheckpointId).toBe('default_in');
  });

  it('preserves custom checkpoints without injecting phantom default_in', async () => {
    const { eventService } = await import('@/services/event.service');
    const customCps = [
      { id: 'cp_morning_in', label: 'Morning IN', type: 'IN' as const, orderIndex: 0 },
      { id: 'cp_morning_out', label: 'Morning OUT', type: 'OUT' as const, orderIndex: 1 },
    ];
    const occ = await eventService.createOccurrence({
      eventId,
      title: 'Custom Multi-Checkpoint Session',
      date: '2026-10-16',
      startTime: '08:00',
      endTime: '17:00',
      checkpoints: customCps,
    });

    expect(occ.checkpoints).toBeDefined();
    expect(occ.checkpoints!.length).toBe(2);
    expect(occ.checkpoints!.some((c) => c.id === 'default_in')).toBe(false);
    expect(occ.checkpoints![0].id).toBe('cp_morning_in');
  });
});

