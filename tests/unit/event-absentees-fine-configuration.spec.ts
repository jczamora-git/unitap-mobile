import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { FinanceRepository } from '@/database/repositories/finance.repository';
import { EventsRepository } from '@/database/repositories/events.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { pesoToCentavos } from '@/utilities/finance-formatters';

describe('UniTap 2.0 Event Absentees Fine Amount Configuration', () => {
  const semesterId = 'sem_test_2026';
  const event1Id = 'evt_it_congress';
  const event2Id = 'evt_test_event';
  const occ1Id = 'occ_it_congress_closed';
  const occ2Id = 'occ_test_event_closed';

  const stu1 = 'stu_absentee_1';
  const stu2 = 'stu_absentee_2';

  beforeEach(async () => {
    await resetDatabaseForTests();
    const db = await getDatabase();
    const now = new Date().toISOString();

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

    // 3. Students
    for (const [id, sId, name] of [
      [stu1, 'MCC2026-0001', 'Alice'],
      [stu2, 'MCC2026-0002', 'Bob'],
    ]) {
      await StudentsRepository.createStudent({
        id,
        school_id: sId,
        first_name: name,
        last_name: 'Test',
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      });

      await AcademicRepository.createEnrollment({
        id: 'enr_' + id,
        student_id: id,
        semester_id: semesterId,
        year_level: 2,
        section: '2F1',
        enrollment_status: 'ENROLLED',
        first_name_snapshot: name,
        last_name_snapshot: 'Test',
        updated_at: now,
      });
    }

    // 4. IT Congress Event & Occurrence with ₱50 fine template
    await EventsRepository.createEvent({
      id: event1Id,
      semester_id: semesterId,
      title: 'IT Congress',
      event_type: 'SEMINAR',
      audience_type: 'ALL',
      audience_json: '{}',
      attendance_required: 1,
      status: 'ACTIVE',
      created_by_user_id: 'officer_test',
      created_at: now,
      updated_at: now,
    });

    await EventsRepository.createOccurrence({
      id: occ1Id,
      event_id: event1Id,
      title: 'Day 1',
      occurs_on: '2026-09-01',
      starts_at: '08:00',
      ends_at: '12:00',
      grace_minutes: 15,
      status: 'CLOSED',
      opened_at: '2026-09-01T08:00:00Z',
      closed_at: '2026-09-01T12:00:00Z',
      updated_at: now,
    });

    // Create ₱50 ABSENCE rule for IT Congress
    await FinanceRepository.createRule({
      id: 'rule_it_congress_absence',
      semester_id: semesterId,
      name: 'IT Congress Absence Fine',
      description: '₱50 fine for missing IT Congress',
      type: 'FINE',
      trigger_type: 'ABSENCE',
      default_amount_centavos: 5000, // ₱50.00
      status: 'ACTIVE',
      created_at: now,
    });

    // 5. Test Event with multiple checkpoints (Morning IN, Afternoon IN)
    await EventsRepository.createEvent({
      id: event2Id,
      semester_id: semesterId,
      title: 'Test Event',
      event_type: 'ASSEMBLY',
      audience_type: 'ALL',
      audience_json: '{}',
      attendance_required: 1,
      status: 'ACTIVE',
      created_by_user_id: 'officer_test',
      created_at: now,
      updated_at: now,
    });

    await EventsRepository.createOccurrence({
      id: occ2Id,
      event_id: event2Id,
      title: 'General Assembly',
      occurs_on: '2026-09-02',
      starts_at: '08:00',
      ends_at: '17:00',
      grace_minutes: 15,
      status: 'CLOSED',
      opened_at: '2026-09-02T08:00:00Z',
      closed_at: '2026-09-02T17:00:00Z',
      updated_at: now,
      checkpoints_json: JSON.stringify([
        { id: 'cp_morning_in', label: 'Morning IN', type: 'IN' },
        { id: 'cp_afternoon_in', label: 'Afternoon IN', type: 'IN' },
      ]),
    });
  });

  it('calculates total assessment correctly for custom amounts (₱25, ₱50, ₱100)', async () => {
    // ₱25 custom amount
    const amount25 = pesoToCentavos(25);
    expect(amount25).toBe(2500);
    const total25 = 2 * amount25;
    expect(total25).toBe(5000); // ₱50.00 total for 2 students

    // ₱50 custom amount
    const amount50 = pesoToCentavos(50);
    expect(amount50).toBe(5000);
    const total50 = 2 * amount50;
    expect(total50).toBe(10000); // ₱100.00 total

    // ₱100 custom amount
    const amount100 = pesoToCentavos(100);
    expect(amount100).toBe(10000);
    const total100 = 2 * amount100;
    expect(total100).toBe(20000); // ₱200.00 total
  });

  it('rejects assessment if amount is not configured or zero', async () => {
    await expect(
      FinanceRepository.assessBulkFines({
        occurrenceId: occ2Id,
        fineTitle: 'Zero Amount Fine',
        amountCentavos: 0,
        studentIds: [stu1],
        actorUserId: 'officer_test',
      })
    ).rejects.toThrow(/positive integer in centavos/i);
  });

  it('does not inherit IT Congress fine template when assessing Test Event', async () => {
    // Assessment on Test Event with custom ₱25 fine
    const result = await FinanceRepository.assessBulkFines({
      occurrenceId: occ2Id,
      fineTitle: 'Absence Fine: Test Event',
      amountCentavos: pesoToCentavos(25), // 2500 centavos
      studentIds: [stu1],
      actorUserId: 'officer_test',
      mode: 'WHOLE_EVENT',
    });

    expect(result.assessedCount).toBe(1);
    expect(result.totalAssessedCentavos).toBe(2500);

    const db = await getDatabase();
    const createdOb = await db.queryOne<{ amount_centavos: number; rule_id: string | null; title: string }>(
      `SELECT amount_centavos, rule_id, title FROM student_obligations WHERE student_id = ? AND related_occurrence_id = ?`,
      [stu1, occ2Id]
    );

    expect(createdOb?.amount_centavos).toBe(2500);
    expect(createdOb?.rule_id).toBeNull(); // No rule template auto-applied!
    expect(createdOb?.title).toBe('Absence Fine: Test Event');
  });

  it('supports explicit fine template selection when chosen', async () => {
    const rules = await FinanceRepository.getRulesBySemester(semesterId);
    const template = rules.find((r) => r.id === 'rule_it_congress_absence');
    expect(template).toBeDefined();

    const result = await FinanceRepository.assessBulkFines({
      occurrenceId: occ1Id,
      ruleId: template!.id,
      fineTitle: `Absence Fine: ${template!.name}`,
      amountCentavos: template!.default_amount_centavos, // 5000 centavos
      studentIds: [stu1],
      actorUserId: 'officer_test',
      mode: 'WHOLE_EVENT',
    });

    expect(result.assessedCount).toBe(1);
    expect(result.totalAssessedCentavos).toBe(5000);

    const db = await getDatabase();
    const createdOb = await db.queryOne<{ amount_centavos: number; rule_id: string }>(
      `SELECT amount_centavos, rule_id FROM student_obligations WHERE student_id = ? AND related_occurrence_id = ?`,
      [stu1, occ1Id]
    );

    expect(createdOb?.amount_centavos).toBe(5000);
    expect(createdOb?.rule_id).toBe('rule_it_congress_absence');
  });

  it('supports independent fine amounts per checkpoint and prevents duplicate assessments', async () => {
    // 1. Assess Morning IN at ₱25
    const resMorning = await FinanceRepository.assessBulkFines({
      occurrenceId: occ2Id,
      checkpointId: 'cp_morning_in',
      fineTitle: 'Absence Fine (Morning IN): Test Event',
      amountCentavos: pesoToCentavos(25),
      studentIds: [stu1, stu2],
      actorUserId: 'officer_test',
      mode: 'PER_CHECKPOINT',
    });

    expect(resMorning.assessedCount).toBe(2);
    expect(resMorning.totalAssessedCentavos).toBe(5000);

    // 2. Assess Afternoon IN at ₱50 for stu1
    const resAfternoon = await FinanceRepository.assessBulkFines({
      occurrenceId: occ2Id,
      checkpointId: 'cp_afternoon_in',
      fineTitle: 'Absence Fine (Afternoon IN): Test Event',
      amountCentavos: pesoToCentavos(50),
      studentIds: [stu1],
      actorUserId: 'officer_test',
      mode: 'PER_CHECKPOINT',
    });

    expect(resAfternoon.assessedCount).toBe(1);
    expect(resAfternoon.totalAssessedCentavos).toBe(5000);

    // 3. Re-assessing Morning IN for stu1 must be skipped as duplicate
    const resMorningDup = await FinanceRepository.assessBulkFines({
      occurrenceId: occ2Id,
      checkpointId: 'cp_morning_in',
      fineTitle: 'Absence Fine (Morning IN): Test Event',
      amountCentavos: pesoToCentavos(25),
      studentIds: [stu1],
      actorUserId: 'officer_test',
      mode: 'PER_CHECKPOINT',
    });

    expect(resMorningDup.assessedCount).toBe(0);
    expect(resMorningDup.skippedCount).toBe(1);

    // 4. Verify candidate detection marks Morning IN as already fined, but Afternoon IN remains eligible for stu2
    const morningCandidates = await FinanceRepository.getAbsenteeCandidates(occ2Id, undefined, 'cp_morning_in');
    const stu1Morning = morningCandidates.candidates.find((c) => c.studentId === stu1);
    expect(stu1Morning?.alreadyFined).toBe(true);
    expect(stu1Morning?.selected).toBe(false);

    const afternoonCandidates = await FinanceRepository.getAbsenteeCandidates(occ2Id, undefined, 'cp_afternoon_in');
    const stu2Afternoon = afternoonCandidates.candidates.find((c) => c.studentId === stu2);
    expect(stu2Afternoon?.alreadyFined).toBe(false); // stu2 not yet fined for afternoon
    expect(stu2Afternoon?.selected).toBe(false); // Default unselected
  });

  it('keeps preview read-only and performs zero financial writes before confirmation', async () => {
    const db = await getDatabase();
    const countBefore = await db.queryOne<{ count: number }>(`SELECT count(*) as count FROM student_obligations`);

    // Fetch absentee candidates (preview)
    const preview = await FinanceRepository.getAbsenteeCandidates(occ2Id);
    expect(preview.candidates.length).toBe(2);
    expect(preview.candidates.every((c) => !c.selected)).toBe(true); // Default to unselected

    const countAfter = await db.queryOne<{ count: number }>(`SELECT count(*) as count FROM student_obligations`);
    expect(countAfter?.count).toBe(countBefore?.count);
  });
});
