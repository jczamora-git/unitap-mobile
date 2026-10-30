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

  it('rejects simulated wallet payment when funds are insufficient and succeeds when funded', async () => {
    await FinanceRepository.assessObligation({
      id: 'ob_wallet_test',
      student_id: studentId,
      semester_id: semesterId,
      title: 'Sportsfest Contribution',
      type: 'CONTRIBUTION',
      amount_centavos: 10000, // ₱100.00
      status: 'ACTIVE',
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 1. Attempt payment with 0 balance -> should fail
    await expect(
      FinanceRepository.recordPayment(
        {
          id: 'pay_insufficient',
          student_id: studentId,
          semester_id: semesterId,
          reference_number: 'REF-INSUFF',
          idempotency_key: 'IDEMP-INSUFF',
          amount_centavos: 10000,
          source: 'SIMULATED_WALLET',
          channel: 'MANUAL',
          status: 'POSTED',
          processed_by_user_id: 'officer_1',
          processed_at: new Date().toISOString(),
        },
        [{ id: 'alloc_1', obligation_id: 'ob_wallet_test', amount_centavos: 10000 }]
      )
    ).rejects.toThrow('Insufficient wallet balance');

    // 2. Top up wallet with ₱150.00 (15000 centavos)
    const newBal = await FinanceRepository.topUpWallet(
      studentId,
      15000,
      'officer_1',
      'REF-TOPUP-1'
    );
    expect(newBal).toBe(15000);

    // 3. Payment now succeeds
    await FinanceRepository.recordPayment(
      {
        id: 'pay_success',
        student_id: studentId,
        semester_id: semesterId,
        reference_number: 'REF-WALLET-SUCCESS',
        idempotency_key: 'IDEMP-SUCCESS',
        amount_centavos: 10000,
        source: 'SIMULATED_WALLET',
        channel: 'NFC',
        status: 'POSTED',
        processed_by_user_id: 'officer_1',
        processed_at: new Date().toISOString(),
      },
      [{ id: 'alloc_success', obligation_id: 'ob_wallet_test', amount_centavos: 10000 }]
    );

    // Wallet balance should now be 5000 centavos (₱50.00)
    const wallet = await FinanceRepository.getOrCreateWallet(studentId);
    const remaining = await FinanceRepository.getWalletBalance(wallet.id);
    expect(remaining).toBe(5000);

    // Obligation balance should be 0
    const obligations = await FinanceRepository.getStudentObligations(studentId, semesterId);
    expect(obligations[0].balance_centavos).toBe(0);
  });

  it('reverses payments with a mandatory reason and refunds wallet ledger', async () => {
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

    await FinanceRepository.topUpWallet(studentId, 5000, 'officer_1', 'REF-TOPUP-REV');

    await FinanceRepository.recordPayment(
      {
        id: 'pay_to_reverse',
        student_id: studentId,
        semester_id: semesterId,
        reference_number: 'REF-TO-REV',
        idempotency_key: 'IDEMP-REV',
        amount_centavos: 5000,
        source: 'SIMULATED_WALLET',
        channel: 'MANUAL',
        status: 'POSTED',
        processed_by_user_id: 'officer_1',
        processed_at: new Date().toISOString(),
      },
      [{ id: 'alloc_rev', obligation_id: 'ob_rev_test', amount_centavos: 5000 }]
    );

    const wallet = await FinanceRepository.getOrCreateWallet(studentId);
    expect(await FinanceRepository.getWalletBalance(wallet.id)).toBe(0);

    // Reversal without reason fails
    await expect(
      FinanceRepository.reversePayment('pay_to_reverse', '  ', 'officer_1')
    ).rejects.toThrow('mandatory');

    // Reversal with reason succeeds
    await FinanceRepository.reversePayment(
      'pay_to_reverse',
      'Incorrect student tapped',
      'officer_1'
    );

    // Wallet refunded back to 5000 centavos
    expect(await FinanceRepository.getWalletBalance(wallet.id)).toBe(5000);

    // Obligation balance restored to 5000
    const obligations = await FinanceRepository.getStudentObligations(studentId, semesterId);
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
