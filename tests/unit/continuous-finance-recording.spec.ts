import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { FinanceService } from '@/services/finance.service';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { CardsRepository } from '@/database/repositories/cards.repository';
import { supabase } from '@/integrations/supabase/client';

describe('Phase 5: Continuous NFC Finance Recording', () => {
  let service: FinanceService;
  const semesterId = 'sem_phase5_test';
  const officerId = 'officer_phase5';
  const student1Id = 'stu_phase5_1';
  const student2Id = 'stu_phase5_2';
  const student3Id = 'stu_phase5_3';
  let contributionRuleId: string;
  let fineRuleId: string;

  beforeEach(async () => {
    await resetDatabaseForTests();
    service = new FinanceService();

    // Mock authoritative server RPC responses
    (supabase.rpc as any) = async (rpcName: string, params: any) => {
      if (rpcName === 'record_student_payment') {
        if (params.p_amount_centavos <= 0) {
          return { data: null, error: { message: 'Payment amount must be positive' } };
        }
        return {
          data: {
            success: true,
            status: 'CONFIRMED',
            payment_id: params.p_payment_id,
            reference_number: params.p_reference_number,
            amount_centavos: params.p_amount_centavos,
            processed_at: new Date().toISOString(),
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };

    const db = await getDatabase();
    await db.execute(
      `INSERT INTO users (id, username, account_status, created_at, updated_at)
       VALUES (?, 'officer_tester', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`,
      [officerId]
    );

    // Setup active Academic Year & Semester
    await AcademicRepository.createYear({
      id: 'ay_phase5',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });

    await AcademicRepository.createSemester({
      id: semesterId,
      academic_year_id: 'ay_phase5',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    const now = new Date().toISOString();

    // Setup 3 Students
    await StudentsRepository.createStudent({
      id: student1Id,
      school_id: '2026-0001',
      first_name: 'Juan',
      last_name: 'Dela Cruz',
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    });

    await StudentsRepository.createStudent({
      id: student2Id,
      school_id: '2026-0002',
      first_name: 'Maria',
      last_name: 'Clara',
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    });

    await StudentsRepository.createStudent({
      id: student3Id,
      school_id: '2026-0003',
      first_name: 'Crisostomo',
      last_name: 'Ibarra',
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    });

    await AcademicRepository.createEnrollment({
      id: 'enr_phase5_1',
      student_id: student1Id,
      semester_id: semesterId,
      year_level: 3,
      section: 'A',
      enrollment_status: 'ENROLLED',
      first_name_snapshot: 'Juan',
      last_name_snapshot: 'Dela Cruz',
      updated_at: now,
    });

    await AcademicRepository.createEnrollment({
      id: 'enr_phase5_2',
      student_id: student2Id,
      semester_id: semesterId,
      year_level: 3,
      section: 'A',
      enrollment_status: 'ENROLLED',
      first_name_snapshot: 'Maria',
      last_name_snapshot: 'Clara',
      updated_at: now,
    });

    // Register NFC Cards
    await CardsRepository.assignCard({
      id: 'card_stu1',
      student_id: student1Id,
      uid_normalized: '04A1B2C3D4E5F6',
      status: 'ACTIVE',
      assigned_at: now,
    });

    await CardsRepository.assignCard({
      id: 'card_stu2',
      student_id: student2Id,
      uid_normalized: '04E5F6A1B2C3D4',
      status: 'ACTIVE',
      assigned_at: now,
    });

    // Create payment templates (obligation rules)
    const contrib = await service.createRule({
      semesterId,
      name: 'CSG Membership Fee 2026',
      type: 'CONTRIBUTION',
      triggerType: 'MANUAL',
      defaultAmountCentavos: 15000, // ₱150.00
      actorUserId: officerId,
    });
    contributionRuleId = contrib.id;

    const fine = await service.createRule({
      semesterId,
      name: 'General Assembly Absence Fine',
      type: 'FINE',
      triggerType: 'ABSENCE',
      defaultAmountCentavos: 5000, // ₱50.00
      actorUserId: officerId,
    });
    fineRuleId = fine.id;
  });

  describe('1. Payment Template Selection', () => {
    it('loads active payment templates for the current semester', async () => {
      const templates = await service.getActiveTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(2);
      expect(templates.some((t) => t.id === contributionRuleId)).toBe(true);
      expect(templates.some((t) => t.id === fineRuleId)).toBe(true);

      const contrib = templates.find((t) => t.id === contributionRuleId)!;
      expect(contrib.name).toBe('CSG Membership Fee 2026');
      expect(contrib.defaultAmountCentavos).toBe(15000);
      expect(contrib.type).toBe('CONTRIBUTION');
    });
  });

  describe('2. Student Obligation Assessment for Active Template', () => {
    it('returns NO_OBLIGATION when student has not been assessed for template', async () => {
      const res = await service.checkStudentObligationForTemplate(student1Id, contributionRuleId);
      expect(res.status).toBe('NO_OBLIGATION');
      expect(res.obligation).toBeNull();
    });

    it('returns DUE when student has an outstanding unpaid obligation', async () => {
      // Assess fine for student 1
      await service.issueManualFine({
        studentId: student1Id,
        semesterId,
        ruleId: fineRuleId,
        title: 'General Assembly Absence Fine',
        amountCentavos: 5000,
        actorUserId: officerId,
      });

      const res = await service.checkStudentObligationForTemplate(student1Id, fineRuleId);
      expect(res.status).toBe('DUE');
      expect(res.obligation).not.toBeNull();
      expect(res.obligation!.balanceCentavos).toBe(5000);
      expect(res.obligation!.paidCentavos).toBe(0);
    });

    it('returns PAID when student has already fully settled the obligation', async () => {
      // Assess fine
      const ob = await service.issueManualFine({
        studentId: student2Id,
        semesterId,
        ruleId: fineRuleId,
        title: 'General Assembly Absence Fine',
        amountCentavos: 5000,
        actorUserId: officerId,
      });

      // Pay in full
      await service.recordPayment({
        studentId: student2Id,
        semesterId,
        amountCentavos: 5000,
        source: 'CASH',
        allocations: [{ obligationId: ob.id, amountCentavos: 5000 }],
        actorUserId: officerId,
      });

      const res = await service.checkStudentObligationForTemplate(student2Id, fineRuleId);
      expect(res.status).toBe('PAID');
      expect(res.obligation).not.toBeNull();
      expect(res.obligation!.balanceCentavos).toBe(0);
      expect(res.obligation!.paidCentavos).toBe(5000);
    });
  });

  describe('3. Template Persistence Across Consecutive Student Scans', () => {
    it('keeps template active across multiple students and returns correct individual statuses', async () => {
      const activeRuleId = fineRuleId;

      // Student 1: Assessed ₱50.00
      await service.issueManualFine({
        studentId: student1Id,
        semesterId,
        ruleId: activeRuleId,
        title: 'General Assembly Absence Fine',
        amountCentavos: 5000,
        actorUserId: officerId,
      });

      // Student 2: Assessed ₱50.00 and paid
      const ob2 = await service.issueManualFine({
        studentId: student2Id,
        semesterId,
        ruleId: activeRuleId,
        title: 'General Assembly Absence Fine',
        amountCentavos: 5000,
        actorUserId: officerId,
      });
      await service.recordPayment({
        studentId: student2Id,
        semesterId,
        amountCentavos: 5000,
        source: 'CASH',
        allocations: [{ obligationId: ob2.id, amountCentavos: 5000 }],
        actorUserId: officerId,
      });

      // Student 3: Not assessed

      // Tap Student 1:
      const check1 = await service.checkStudentObligationForTemplate(student1Id, activeRuleId);
      expect(check1.status).toBe('DUE');
      expect(check1.obligation!.balanceCentavos).toBe(5000);

      // Consecutive Tap Student 2 (same template active):
      const check2 = await service.checkStudentObligationForTemplate(student2Id, activeRuleId);
      expect(check2.status).toBe('PAID');
      expect(check2.obligation!.balanceCentavos).toBe(0);

      // Consecutive Tap Student 3 (same template active):
      const check3 = await service.checkStudentObligationForTemplate(student3Id, activeRuleId);
      expect(check3.status).toBe('NO_OBLIGATION');
      expect(check3.obligation).toBeNull();
    });
  });

  describe('4. Payment Recording & Method Handling', () => {
    it('records Cash payment and generates authoritative receipt', async () => {
      const ob = await service.issueManualFine({
        studentId: student1Id,
        semesterId,
        ruleId: fineRuleId,
        title: 'General Assembly Absence Fine',
        amountCentavos: 5000,
        actorUserId: officerId,
      });

      const { paymentId, referenceNumber } = await service.recordPayment({
        studentId: student1Id,
        semesterId,
        amountCentavos: 5000,
        source: 'CASH',
        channel: 'NFC',
        allocations: [{ obligationId: ob.id, amountCentavos: 5000 }],
        notes: 'Paid cash at scan station',
        actorUserId: officerId,
      });

      expect(paymentId).toBeDefined();
      expect(referenceNumber).toBeDefined();

      const receipt = await service.generatePaymentReceipt(paymentId, 'Treasurer Juan');
      expect(receipt.totalPaidCentavos).toBe(5000);
      expect(receipt.paymentMethod).toBe('CASH');
      expect(receipt.items[0].remainingBalanceCentavos).toBe(0);
      expect(receipt.items[0].paidAmountCentavos).toBe(5000);
    });

    it('records GCash and Bank Transfer payments with reference number notes', async () => {
      const ob = await service.issueManualFine({
        studentId: student1Id,
        semesterId,
        ruleId: fineRuleId,
        title: 'General Assembly Absence Fine',
        amountCentavos: 5000,
        actorUserId: officerId,
      });

      const gcashRef = 'GCASH-991283';
      const { paymentId } = await service.recordPayment({
        studentId: student1Id,
        semesterId,
        amountCentavos: 5000,
        source: 'MANUAL_TRANSFER_RECORD',
        allocations: [{ obligationId: ob.id, amountCentavos: 5000 }],
        notes: `[GCash Ref: ${gcashRef}] Transfer confirmed`,
        actorUserId: officerId,
      });

      const receipt = await service.generatePaymentReceipt(paymentId, 'Auditor Maria');
      expect(receipt.paymentMethod).toBe('MANUAL_TRANSFER_RECORD');
      expect(receipt.notes).toContain(gcashRef);
    });

    it('rejects recording when server Supabase RPC fails', async () => {
      // Mock failure in Supabase RPC
      (supabase.rpc as any) = async () => ({
        data: null,
        error: { message: 'Network offline / connection timeout' },
      });

      const ob = await service.issueManualFine({
        studentId: student1Id,
        semesterId,
        ruleId: fineRuleId,
        title: 'General Assembly Absence Fine',
        amountCentavos: 5000,
        actorUserId: officerId,
      });

      await expect(
        service.recordPayment({
          studentId: student1Id,
          semesterId,
          amountCentavos: 5000,
          source: 'CASH',
          allocations: [{ obligationId: ob.id, amountCentavos: 5000 }],
          actorUserId: officerId,
        })
      ).rejects.toThrow('Server payment recording failed: Network offline / connection timeout');
    });

    it('rejects zero or negative payment amounts', async () => {
      const ob = await service.issueManualFine({
        studentId: student1Id,
        semesterId,
        ruleId: fineRuleId,
        title: 'General Assembly Absence Fine',
        amountCentavos: 5000,
        actorUserId: officerId,
      });

      await expect(
        service.recordPayment({
          studentId: student1Id,
          semesterId,
          amountCentavos: 0,
          source: 'CASH',
          allocations: [{ obligationId: ob.id, amountCentavos: 0 }],
          actorUserId: officerId,
        })
      ).rejects.toThrow('Payment amount must be greater than zero.');
    });

    it('rejects allocation mismatch with total payment amount', async () => {
      const ob = await service.issueManualFine({
        studentId: student1Id,
        semesterId,
        ruleId: fineRuleId,
        title: 'General Assembly Absence Fine',
        amountCentavos: 5000,
        actorUserId: officerId,
      });

      await expect(
        service.recordPayment({
          studentId: student1Id,
          semesterId,
          amountCentavos: 5000,
          source: 'CASH',
          allocations: [{ obligationId: ob.id, amountCentavos: 3000 }],
          actorUserId: officerId,
        })
      ).rejects.toThrow('Total allocations (3000) must match payment amount (5000).');
    });
  });

  describe('5. Regression: Payment Allocation ID Validation & Legacy Repair', () => {
    it('rejects payment recording when allocation obligation ID is not a valid RFC 4122 UUID', async () => {
      await expect(
        service.recordPayment({
          studentId: student1Id,
          semesterId,
          amountCentavos: 5000,
          source: 'CASH',
          allocations: [{ obligationId: 'ob_invalid_12345', amountCentavos: 5000 }],
          actorUserId: officerId,
        })
      ).rejects.toThrow('Invalid obligation ID in payment allocations');
    });

    it('automatically repairs legacy non-UUID obligation IDs in SQLite to valid UUIDs', async () => {
      const db = await getDatabase();
      const legacyId = 'ob_legacy_non_uuid_999';
      const now = new Date().toISOString();

      await db.execute(
        `INSERT INTO student_obligations (
          id, student_id, semester_id, title, type, amount_centavos, status, issued_at, updated_at
        ) VALUES (?, ?, ?, 'Legacy Sportsfest Fine', 'FINE', 2500, 'ACTIVE', ?, ?)`,
        [legacyId, student1Id, semesterId, now, now]
      );

      // Fetching student obligations automatically triggers repairLegacyObligationIds
      const obligations = await service.getStudentObligations(student1Id);
      const repaired = obligations.find((o) => o.title === 'Legacy Sportsfest Fine');
      expect(repaired).toBeDefined();
      expect(repaired!.id).not.toBe(legacyId);
      expect(repaired!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('supports partial payments and preserves remaining balance', async () => {
      const ob = await service.issueManualFine({
        studentId: student1Id,
        semesterId,
        ruleId: fineRuleId,
        title: 'General Assembly Absence Fine',
        amountCentavos: 10000, // ₱100.00
        actorUserId: officerId,
      });

      // Pay ₱80.00 (partial payment)
      await service.recordPayment({
        studentId: student1Id,
        semesterId,
        amountCentavos: 8000,
        source: 'CASH',
        allocations: [{ obligationId: ob.id, amountCentavos: 8000 }],
        actorUserId: officerId,
      });

      const check = await service.checkStudentObligationForTemplate(student1Id, fineRuleId);
      expect(check.status).toBe('DUE');
      expect(check.obligation!.paidCentavos).toBe(8000);
      expect(check.obligation!.balanceCentavos).toBe(2000); // ₱20.00 remaining
    });

    it('stores legacy bulk contribution assessments without rule_id when no template was selected', async () => {
      const res = await service.assessBulkContributions({
        semesterId,
        title: 'Christmas Outreach Program 2026',
        amountCentavos: 5000,
        targetScope: 'INDIVIDUAL',
        studentIds: [student1Id, student2Id],
        actorUserId: officerId,
      });

      expect(res.totalAssigned).toBe(2);
      // Appears in obligations by semester for Contributions
      const contribs = await service.getObligationsBySemester(semesterId, 'CONTRIBUTION');
      const christmas = contribs.filter((c) => c.title === 'Christmas Outreach Program 2026');
      expect(christmas.length).toBe(2);
      expect(christmas[0].ruleId).toBeNull();

      // Does NOT appear in obligation_rules / getRules
      const rules = await service.getRules(semesterId);
      const matchingRule = rules.find((r) => r.name === 'Christmas Outreach Program 2026');
      expect(matchingRule).toBeUndefined();

      // Student can still settle the legacy assessment via General Mode
      const studentObs = await service.getStudentObligations(student1Id);
      const studentChristmas = studentObs.find((o) => o.title === 'Christmas Outreach Program 2026');
      expect(studentChristmas).toBeDefined();
      expect(studentChristmas!.balanceCentavos).toBe(5000);

      await service.recordPayment({
        studentId: student1Id,
        semesterId,
        amountCentavos: 5000,
        source: 'CASH',
        allocations: [{ obligationId: studentChristmas!.id, amountCentavos: 5000 }],
        actorUserId: officerId,
      });

      const updatedObs = await service.getStudentObligations(student1Id);
      const settled = updatedObs.find((o) => o.id === studentChristmas!.id);
      expect(settled!.paidCentavos).toBe(5000);
      expect(settled!.balanceCentavos).toBe(0);
    });

    it('properly links rule_id when creating a template and assigning bulk dues to it', async () => {
      // 1. Create a published template
      const newTemplate = await service.createRule({
        semesterId,
        name: 'Sportsfest 2026 Student Contribution',
        type: 'CONTRIBUTION',
        triggerType: 'MANUAL',
        defaultAmountCentavos: 10000,
        actorUserId: officerId,
      });

      // 2. Verified in getRules and getActiveTemplates
      const rules = await service.getRules(semesterId);
      const foundRule = rules.find((r) => r.name === 'Sportsfest 2026 Student Contribution');
      expect(foundRule).toBeDefined();
      expect(foundRule!.type).toBe('CONTRIBUTION');

      const activeTemplates = await service.getActiveTemplates(semesterId);
      expect(activeTemplates.some((t) => t.id === newTemplate.id)).toBe(true);

      // 3. Assess students under this template
      await service.assessBulkContributions({
        semesterId,
        ruleId: newTemplate.id,
        title: newTemplate.name,
        amountCentavos: newTemplate.defaultAmountCentavos,
        targetScope: 'INDIVIDUAL',
        studentIds: [student1Id],
        actorUserId: officerId,
      });

      // 4. Verified that student obligation has valid rule_id and continuous mode checks work
      const check = await service.checkStudentObligationForTemplate(student1Id, newTemplate.id);
      expect(check.status).toBe('DUE');
      expect(check.obligation!.ruleId).toBe(newTemplate.id);
      expect(check.obligation!.balanceCentavos).toBe(10000);
    });
  });

  describe('6. Simplified Contribution Collection Management', () => {
    it('creates a contribution collection and assigns obligations in one step without a separate template interface', async () => {
      const dueDate = '2026-12-20';
      const { rule, assessResult } = await service.createContributionCollection({
        name: 'College Fest 2026 T-Shirt',
        amountCentavos: 25000, // ₱250.00
        dueDate,
        semesterId,
        targetScope: 'INDIVIDUAL',
        studentIds: [student1Id, student2Id],
        actorUserId: officerId,
      });

      // 1. Verify rule is created under the hood
      expect(rule).toBeDefined();
      expect(rule.name).toBe('College Fest 2026 T-Shirt');
      expect(rule.type).toBe('CONTRIBUTION');
      expect(rule.defaultAmountCentavos).toBe(25000);
      expect(rule.dueOn).toBe(dueDate);

      // 2. Verify assessment result
      expect(assessResult.totalAssigned).toBe(2);
      expect(assessResult.totalCentavos).toBe(50000);

      // 3. Verify obligations are linked to rule_id and have dueDate
      const check1 = await service.checkStudentObligationForTemplate(student1Id, rule.id);
      expect(check1.status).toBe('DUE');
      expect(check1.obligation!.ruleId).toBe(rule.id);
      expect(check1.obligation!.amountCentavos).toBe(25000);
      expect(check1.obligation!.dueDate).toBe(dueDate);

      // 4. Verify duplicate prevention
      const duplicateRes = await service.assessBulkContributions({
        semesterId,
        ruleId: rule.id,
        title: rule.name,
        amountCentavos: rule.defaultAmountCentavos,
        targetScope: 'INDIVIDUAL',
        studentIds: [student1Id, student2Id],
        actorUserId: officerId,
      });
      expect(duplicateRes.totalAssigned).toBe(0);

      // 5. Verify getContributionCollections returns complete statistics
      const cols = await service.getContributionCollections(semesterId);
      const festCol = cols.find((c) => c.ruleId === rule.id);
      expect(festCol).toBeDefined();
      expect(festCol!.name).toBe('College Fest 2026 T-Shirt');
      expect(festCol!.totalStudentsAssigned).toBe(2);
      expect(festCol!.unpaidCount).toBe(2);
      expect(festCol!.fullyPaidCount).toBe(0);
      expect(festCol!.partialPaymentCount).toBe(0);
      expect(festCol!.status).toBe('ACTIVE');

      // 6. Record partial payment on student 1
      await service.recordPayment({
        studentId: student1Id,
        semesterId,
        amountCentavos: 10000, // ₱100.00 partial
        source: 'CASH',
        allocations: [{ obligationId: check1.obligation!.id, amountCentavos: 10000 }],
        actorUserId: officerId,
      });

      // 7. Verify collection stats reflect partial payment
      const colsAfterPartial = await service.getContributionCollections(semesterId);
      const festColPartial = colsAfterPartial.find((c) => c.ruleId === rule.id);
      expect(festColPartial!.totalCollectedCentavos).toBe(10000);
      expect(festColPartial!.partialPaymentCount).toBe(1);
      expect(festColPartial!.unpaidCount).toBe(1);

      // 8. Settle student 1 remaining balance and full payment on student 2
      const check2 = await service.checkStudentObligationForTemplate(student2Id, rule.id);
      await service.recordPayment({
        studentId: student1Id,
        semesterId,
        amountCentavos: 15000,
        source: 'CASH',
        allocations: [{ obligationId: check1.obligation!.id, amountCentavos: 15000 }],
        actorUserId: officerId,
      });
      await service.recordPayment({
        studentId: student2Id,
        semesterId,
        amountCentavos: 25000,
        source: 'CASH',
        allocations: [{ obligationId: check2.obligation!.id, amountCentavos: 25000 }],
        actorUserId: officerId,
      });

      // 9. Verify collection marked COMPLETED when all students fully paid
      const colsCompleted = await service.getContributionCollections(semesterId);
      const festColCompleted = colsCompleted.find((c) => c.ruleId === rule.id);
      expect(festColCompleted!.fullyPaidCount).toBe(2);
      expect(festColCompleted!.partialPaymentCount).toBe(0);
      expect(festColCompleted!.unpaidCount).toBe(0);
      expect(festColCompleted!.totalCollectedCentavos).toBe(50000);
      expect(festColCompleted!.status).toBe('COMPLETED');
    }, 20000);

    it('assigns contribution collection by degree program scope', async () => {
      await AcademicRepository.upsertProgram({
        id: 'prog_bscs_test',
        code: 'BSCS',
        name: 'Computer Science',
        is_active: 1,
      });

      const db = await AcademicRepository.getDb();
      await db.execute(
        `UPDATE student_enrollments SET program_id = 'prog_bscs_test' WHERE student_id = ?`,
        [student1Id]
      );

      const { rule, assessResult } = await service.createContributionCollection({
        name: 'BSCS Departmental Fee 2026',
        amountCentavos: 7500, // ₱75.00
        dueDate: '2026-11-30',
        semesterId,
        targetScope: 'PROGRAM',
        programIds: ['prog_bscs_test'],
        actorUserId: officerId,
      });

      expect(rule).toBeDefined();
      expect(assessResult.totalAssigned).toBe(1);

      // Verify that all assigned students belong to the program
      const obs = await service.getObligationsBySemester(semesterId, 'CONTRIBUTION');
      const bscsObs = obs.filter((o) => o.ruleId === rule.id);
      expect(bscsObs.length).toBe(1);
      expect(bscsObs[0].studentId).toBe(student1Id);
    });
  });
});
