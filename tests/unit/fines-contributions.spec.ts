import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { FinanceRepository } from '@/database/repositories/finance.repository';
import { ReportsRepository } from '@/database/repositories/reports.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';

describe('UniTap 2.0 Fines & Contributions Management', () => {
  const semesterId = 'sem_fin_test';
  const studentId = 'stu_fin_test';

  beforeEach(async () => {
    await resetDatabaseForTests();

    const db = await getDatabase();
    await db.execute(
      `INSERT INTO users (id, username, account_status, created_at, updated_at)
       VALUES ('officer_1', 'officer1', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`
    );

    // 1. Setup Academic Term
    await AcademicRepository.createYear({
      id: 'ay_fin',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });
    await AcademicRepository.createSemester({
      id: semesterId,
      academic_year_id: 'ay_fin',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    // 2. Setup Student & Enrollment
    await StudentsRepository.createStudent({
      id: studentId,
      school_id: '2026-5555',
      first_name: 'Melchora',
      last_name: 'Aquino',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await AcademicRepository.createEnrollment({
      id: 'enr_fin',
      student_id: studentId,
      semester_id: semesterId,
      year_level: 3,
      section: '3F4',
      enrollment_status: 'ENROLLED',
      first_name_snapshot: 'Melchora',
      last_name_snapshot: 'Aquino',
      updated_at: new Date().toISOString(),
    });
  });

  it('separates FINE and CONTRIBUTION obligations and computes balances', async () => {
    // 1. Create a Fine rule (e.g. Assembly Absence Fine ₱50.00 = 5000 centavos)
    await FinanceRepository.createRule({
      id: 'rule_fine_1',
      semester_id: semesterId,
      name: 'Assembly Absence Fine',
      type: 'FINE',
      trigger_type: 'ABSENCE',
      default_amount_centavos: 5000,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
    });

    // 2. Create a Contribution rule (e.g. CSG T-Shirt Contribution ₱150.00 = 15000 centavos)
    await FinanceRepository.createRule({
      id: 'rule_contrib_1',
      semester_id: semesterId,
      name: 'CSG T-Shirt Contribution',
      type: 'CONTRIBUTION',
      trigger_type: 'MANUAL',
      default_amount_centavos: 15000,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
    });

    // 3. Issue obligations to student
    await FinanceRepository.assessObligation({
      id: 'ob_fine_1',
      student_id: studentId,
      semester_id: semesterId,
      rule_id: 'rule_fine_1',
      title: 'Assembly Absence Fine',
      type: 'FINE',
      amount_centavos: 5000,
      status: 'ACTIVE',
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await FinanceRepository.assessObligation({
      id: 'ob_contrib_1',
      student_id: studentId,
      semester_id: semesterId,
      rule_id: 'rule_contrib_1',
      title: 'CSG T-Shirt Contribution',
      type: 'CONTRIBUTION',
      amount_centavos: 15000,
      status: 'ACTIVE',
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Query obligations with balance
    const obligations = await FinanceRepository.getStudentObligations(studentId, semesterId);
    expect(obligations.length).toBe(2);

    const fine = obligations.find((o) => o.type === 'FINE');
    const contrib = obligations.find((o) => o.type === 'CONTRIBUTION');

    expect(fine?.balance_centavos).toBe(5000);
    expect(contrib?.balance_centavos).toBe(15000);
  });

  it('rejects non-positive payment amounts and invalid allocations', async () => {
    await FinanceRepository.assessObligation({
      id: 'ob_zero_test',
      student_id: studentId,
      semester_id: semesterId,
      title: 'Sample Fine',
      type: 'FINE',
      amount_centavos: 2000,
      status: 'ACTIVE',
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Reject <= 0 payment
    await expect(
      FinanceRepository.recordPayment(
        {
          id: 'pay_zero',
          student_id: studentId,
          semester_id: semesterId,
          reference_number: 'REF-ZERO',
          idempotency_key: 'IDEMP-ZERO',
          amount_centavos: 0,
          source: 'CASH_RECORDED',
          channel: 'MANUAL',
          status: 'POSTED',
          processed_by_user_id: 'officer_1',
          processed_at: new Date().toISOString(),
        },
        [{ id: 'alloc_zero', obligation_id: 'ob_zero_test', amount_centavos: 0 }]
      )
    ).rejects.toThrow();

    // Reject mismatched allocations
    await expect(
      FinanceRepository.recordPayment(
        {
          id: 'pay_mismatch',
          student_id: studentId,
          semester_id: semesterId,
          reference_number: 'REF-MISMATCH',
          idempotency_key: 'IDEMP-MISMATCH',
          amount_centavos: 2000,
          source: 'CASH_RECORDED',
          channel: 'MANUAL',
          status: 'POSTED',
          processed_by_user_id: 'officer_1',
          processed_at: new Date().toISOString(),
        },
        [{ id: 'alloc_bad', obligation_id: 'ob_zero_test', amount_centavos: 1000 }]
      )
    ).rejects.toThrow('must equal');
  });

  it('records direct payments across multiple obligations with partial payments and rejects overpayment', async () => {
    // 1. Issue two obligations: Fine ₱50.00 (5000) and Contribution ₱100.00 (10000)
    await FinanceRepository.assessObligation({
      id: 'ob_mult_1',
      student_id: studentId,
      semester_id: semesterId,
      title: 'Sportsfest Absence Fine',
      type: 'FINE',
      amount_centavos: 5000,
      status: 'ACTIVE',
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await FinanceRepository.assessObligation({
      id: 'ob_mult_2',
      student_id: studentId,
      semester_id: semesterId,
      title: 'CSG T-Shirt Contribution',
      type: 'CONTRIBUTION',
      amount_centavos: 10000,
      status: 'ACTIVE',
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 2. Reject overpayment on ob_mult_1 (trying to allocate 6000 on 5000 balance)
    await expect(
      FinanceRepository.recordPayment(
        {
          id: 'pay_over',
          student_id: studentId,
          semester_id: semesterId,
          reference_number: 'REF-OVERPAY',
          idempotency_key: 'IDEMP-OVERPAY',
          amount_centavos: 6000,
          source: 'CASH_RECORDED',
          channel: 'MANUAL',
          status: 'POSTED',
          processed_by_user_id: 'officer_1',
          processed_at: new Date().toISOString(),
        },
        [{ id: 'alloc_over', obligation_id: 'ob_mult_1', amount_centavos: 6000 }]
      )
    ).rejects.toThrow('exceeds remaining');

    // 3. Record valid split payment: ₱50.00 on Fine (Full) + ₱30.00 on Contribution (Partial) = ₱80.00 (8000 cents)
    await FinanceRepository.recordPayment(
      {
        id: 'pay_split_1',
        student_id: studentId,
        semester_id: semesterId,
        reference_number: 'REF-SPLIT-1',
        idempotency_key: 'IDEMP-SPLIT-1',
        amount_centavos: 8000,
        source: 'MANUAL_TRANSFER_RECORD',
        channel: 'MANUAL',
        status: 'POSTED',
        processed_by_user_id: 'officer_1',
        notes: 'GCash collection ref #998877',
        processed_at: new Date().toISOString(),
      },
      [
        { id: 'alloc_split_1', obligation_id: 'ob_mult_1', amount_centavos: 5000 },
        { id: 'alloc_split_2', obligation_id: 'ob_mult_2', amount_centavos: 3000 },
      ]
    );

    // 4. Verify resulting balances
    const obligations = await FinanceRepository.getStudentObligations(studentId, semesterId);
    const fine = obligations.find((o) => o.id === 'ob_mult_1');
    const contrib = obligations.find((o) => o.id === 'ob_mult_2');

    expect(fine?.paid_centavos).toBe(5000);
    expect(fine?.balance_centavos).toBe(0); // Fully paid

    expect(contrib?.paid_centavos).toBe(3000);
    expect(contrib?.balance_centavos).toBe(7000); // Remaining partial balance
  });

  it('reverses payments with a mandatory reason and restores obligation balance', async () => {
    await FinanceRepository.assessObligation({
      id: 'ob_rev_test',
      student_id: studentId,
      semester_id: semesterId,
      title: 'Library Fine',
      type: 'FINE',
      amount_centavos: 5000,
      status: 'ACTIVE',
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await FinanceRepository.recordPayment(
      {
        id: 'pay_to_reverse',
        student_id: studentId,
        semester_id: semesterId,
        reference_number: 'REF-TO-REV',
        idempotency_key: 'IDEMP-REV',
        amount_centavos: 5000,
        source: 'CASH_RECORDED',
        channel: 'MANUAL',
        status: 'POSTED',
        processed_by_user_id: 'officer_1',
        processed_at: new Date().toISOString(),
      },
      [{ id: 'alloc_rev', obligation_id: 'ob_rev_test', amount_centavos: 5000 }]
    );

    // Initial check: balance should be 0
    let obligations = await FinanceRepository.getStudentObligations(studentId, semesterId);
    expect(obligations[0].balance_centavos).toBe(0);

    // Reversal without reason fails
    await expect(
      FinanceRepository.reversePayment('pay_to_reverse', '  ', 'officer_1')
    ).rejects.toThrow('mandatory');

    // Reversal with reason succeeds
    await FinanceRepository.reversePayment(
      'pay_to_reverse',
      'Incorrect student receipt issued',
      'officer_1'
    );

    // Obligation balance restored to 5000
    obligations = await FinanceRepository.getStudentObligations(studentId, semesterId);
    expect(obligations[0].balance_centavos).toBe(5000);
  });

  it('calculates combined financial reports correctly', async () => {
    // 1 Fine: ₱50.00 assessed, ₱20.00 paid => ₱30.00 balance
    await FinanceRepository.assessObligation({
      id: 'ob_rep_fine',
      student_id: studentId,
      semester_id: semesterId,
      title: 'Lab Fine',
      type: 'FINE',
      amount_centavos: 5000,
      status: 'ACTIVE',
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await FinanceRepository.recordPayment(
      {
        id: 'pay_rep_fine',
        student_id: studentId,
        semester_id: semesterId,
        reference_number: 'REF-REP-FINE',
        idempotency_key: 'IDEMP-REP-FINE',
        amount_centavos: 2000,
        source: 'CASH_RECORDED',
        channel: 'MANUAL',
        status: 'POSTED',
        processed_by_user_id: 'officer_1',
        processed_at: new Date().toISOString(),
      },
      [{ id: 'alloc_rep_f', obligation_id: 'ob_rep_fine', amount_centavos: 2000 }]
    );

    const summary = await ReportsRepository.getCombinedFinancialSummary(semesterId);
    expect(summary.fines.assessed_centavos).toBe(5000);
    expect(summary.fines.paid_centavos).toBe(2000);
    expect(summary.fines.outstanding_centavos).toBe(3000);
    expect(summary.overall_collected_centavos).toBe(2000);
    expect(summary.overall_outstanding_centavos).toBe(3000);
  });
});
