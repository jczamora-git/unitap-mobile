import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { FinanceService } from '@/services/finance.service';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { supabase } from '@/integrations/supabase/client';

describe('FinanceService', () => {
  let service: FinanceService;
  const semesterId = 'sem_service_test';
  const studentId = 'stu_service_test';

  beforeEach(async () => {
    await resetDatabaseForTests();
    service = new FinanceService();

    // Mock authoritative server RPC responses for unit testing
    (supabase.rpc as any) = async (rpcName: string, params: any) => {
      if (rpcName === 'record_student_payment') {
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
      if (rpcName === 'reverse_student_payment') {
        return {
          data: {
            success: true,
            status: 'REVERSED',
            payment_id: params.p_payment_id,
            reversed_at: new Date().toISOString(),
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };

    const db = await getDatabase();
    await db.execute(
      `INSERT INTO users (id, username, account_status, created_at, updated_at)
       VALUES ('officer_service', 'officer_service', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`
    );

    await AcademicRepository.createYear({
      id: 'ay_service',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });

    await AcademicRepository.createSemester({
      id: semesterId,
      academic_year_id: 'ay_service',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    await StudentsRepository.createStudent({
      id: studentId,
      school_id: '2026-9999',
      first_name: 'Jose',
      last_name: 'Rizal',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await AcademicRepository.createEnrollment({
      id: 'enr_service',
      student_id: studentId,
      semester_id: semesterId,
      year_level: 4,
      section: '4A',
      enrollment_status: 'ENROLLED',
      first_name_snapshot: 'Jose',
      last_name_snapshot: 'Rizal',
      updated_at: new Date().toISOString(),
    });
  });

  it('creates obligation rules and retrieves them by semester', async () => {
    const rule = await service.createRule({
      semesterId,
      name: 'General Assembly Fine',
      type: 'FINE',
      triggerType: 'ABSENCE',
      defaultAmountCentavos: 5000, // ₱50.00
      actorUserId: 'officer_service',
    });

    expect(rule.id).toBeDefined();
    expect(rule.defaultAmountCentavos).toBe(5000);

    const rules = await service.getRules(semesterId);
    expect(rules.length).toBe(1);
    expect(rules[0].name).toBe('General Assembly Fine');
  });

  it('issues manual fine in integer centavos and computes balances', async () => {
    const fine = await service.issueManualFine({
      studentId,
      semesterId,
      title: 'Uniform Violation',
      amountCentavos: 2500, // ₱25.00
      actorUserId: 'officer_service',
    });

    expect(fine.id).toBeDefined();
    expect(fine.amountCentavos).toBe(2500);
    expect(fine.balanceCentavos).toBe(2500);
    expect(fine.status).toBe('UNPAID');

    const obligations = await service.getStudentObligations(studentId, semesterId);
    expect(obligations.length).toBe(1);
    expect(obligations[0].title).toBe('Uniform Violation');
  });

  it('records direct payment against obligation and generates receipt', async () => {
    const fine = await service.issueManualFine({
      studentId,
      semesterId,
      title: 'Laboratory Fine',
      amountCentavos: 5000,
      actorUserId: 'officer_service',
    });

    const paymentResult = await service.recordPayment({
      studentId,
      semesterId,
      amountCentavos: 5000,
      source: 'CASH',
      allocations: [{ obligationId: fine.id, amountCentavos: 5000 }],
      notes: 'Paid in cash at CSG office',
      actorUserId: 'officer_service',
    });

    expect(paymentResult.paymentId).toBeDefined();
    expect(paymentResult.referenceNumber).toContain('PAY-');

    // Balance should now be 0
    const obligations = await service.getStudentObligations(studentId, semesterId);
    expect(obligations[0].balanceCentavos).toBe(0);
    expect(obligations[0].status).toBe('PAID');

    // Generate receipt
    const receipt = await service.generatePaymentReceipt(paymentResult.paymentId, 'Officer Jane');
    expect(receipt.referenceNumber).toBe(paymentResult.referenceNumber);
    expect(receipt.student.schoolId).toBe('2026-9999');
    expect(receipt.totalPaidCentavos).toBe(5000);
    expect(receipt.items[0].remainingBalanceCentavos).toBe(0);

    // Printable HTML should contain receipt reference and student details
    const html = service.generatePrintableReceiptHtml(receipt);
    expect(html).toContain(paymentResult.referenceNumber);
    expect(html).toContain('Jose');
  });

  it('reverses payment and restores balance', async () => {
    const fine = await service.issueManualFine({
      studentId,
      semesterId,
      title: 'Tardiness Fine',
      amountCentavos: 3000,
      actorUserId: 'officer_service',
    });

    const pay = await service.recordPayment({
      studentId,
      semesterId,
      amountCentavos: 3000,
      source: 'CASH',
      allocations: [{ obligationId: fine.id, amountCentavos: 3000 }],
      actorUserId: 'officer_service',
    });

    // Reverse
    await service.reversePayment(pay.paymentId, 'Duplicate entry error', 'officer_service');

    const obligations = await service.getStudentObligations(studentId, semesterId);
    expect(obligations[0].balanceCentavos).toBe(3000);
    expect(obligations[0].status).toBe('UNPAID');
  });

  it('aggregates finance summary correctly', async () => {
    // Fine: ₱50.00
    await service.issueManualFine({
      studentId,
      semesterId,
      title: 'Meeting Fine',
      amountCentavos: 5000,
      actorUserId: 'officer_service',
    });

    // Contribution: ₱100.00
    await service.assessBulkContributions({
      semesterId,
      title: 'CSG Membership',
      amountCentavos: 10000,
      targetScope: 'ALL',
      actorUserId: 'officer_service',
    });

    const summary = await service.getFinanceSummary(semesterId);
    expect(summary.totalAssessedCentavos).toBe(15000);
    expect(summary.totalOutstandingCentavos).toBe(15000);
    expect(summary.totalPaymentsCollectedCentavos).toBe(0);
    expect(summary.activeFinesCount).toBe(1);
    expect(summary.activeContributionsCount).toBe(1);
  });
});
