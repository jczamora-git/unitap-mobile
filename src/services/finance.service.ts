import { getDatabase } from '@/database/database';
import {
  FinanceRepository,
  type StudentObligationWithBalance,
} from '@/database/repositories/finance.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { generateReferenceNumber, formatCentavosToPesos } from '@/utilities/finance-formatters';
import { OperationPolicyService } from './operation-policy.service';
import { supabase } from '@/integrations/supabase/client';
import type {
  ObligationRuleItem,
  StudentObligationItem,
  PaymentItem,
  AbsenteeCandidate,
  OccurrenceAbsenteeSummary,
  BulkFineAssessmentParams,
  BulkFineAssessmentResult,
  BulkContributionParams,
  BulkContributionResult,
  PaymentReceipt,
  FinanceSummary,
  PaymentMethod,
  PaymentChannel,
  ChargeTemplate,
  StudentCharge,
  Payment,
  Wallet,
  WalletTransaction,
  ChargeType,
  ChargeTrigger,
} from '@/types/finance';

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class FinanceService {
  // ==========================================================================
  // --- 1. RULES & TEMPLATES ---
  // ==========================================================================

  async getRules(semesterId: string): Promise<ObligationRuleItem[]> {
    const rules = await FinanceRepository.getRulesBySemester(semesterId);
    return rules.map((r) => ({
      id: r.id,
      semesterId: r.semester_id,
      name: r.name,
      type: r.type,
      triggerType: r.trigger_type,
      defaultAmountCentavos: r.default_amount_centavos,
      dueOn: r.due_on,
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  async createRule(params: {
    semesterId: string;
    name: string;
    type: 'FINE' | 'CONTRIBUTION';
    triggerType: 'MANUAL' | 'ABSENCE' | 'LATE' | 'EVENT';
    defaultAmountCentavos: number;
    dueOn?: string | null;
    actorUserId?: string;
  }): Promise<ObligationRuleItem> {
    await OperationPolicyService.assertPermitted('FINANCE_ASSESSMENTS_AND_RULES');

    if (!params.name || !params.name.trim()) {
      throw new Error('Rule name is required.');
    }
    if (params.defaultAmountCentavos <= 0) {
      throw new Error('Default amount must be greater than 0.');
    }

    const id = generateId('rule');
    const now = new Date().toISOString();
    await FinanceRepository.createRule({
      id,
      semester_id: params.semesterId,
      name: params.name.trim(),
      type: params.type,
      trigger_type: params.triggerType,
      default_amount_centavos: Math.round(params.defaultAmountCentavos),
      due_on: params.dueOn || null,
      status: 'ACTIVE',
      created_by_user_id: params.actorUserId || null,
      created_at: now,
    });

    return {
      id,
      semesterId: params.semesterId,
      name: params.name.trim(),
      type: params.type,
      triggerType: params.triggerType,
      defaultAmountCentavos: Math.round(params.defaultAmountCentavos),
      dueOn: params.dueOn || null,
      status: 'ACTIVE',
      createdAt: now,
    };
  }

  // ==========================================================================
  // --- 2. EVENT ABSENTEE DETECTION & BULK FINES ---
  // ==========================================================================

  async getAbsenteeCandidates(
    occurrenceId: string,
    ruleId?: string
  ): Promise<{
    summary: OccurrenceAbsenteeSummary;
    candidates: AbsenteeCandidate[];
  }> {
    // Ensure authoritative roster is populated from semester enrollments
    await FinanceRepository.ensureFinalizedRoster(occurrenceId);
    return FinanceRepository.getAbsenteeCandidates(occurrenceId, ruleId);
  }

  async assessBulkFines(params: BulkFineAssessmentParams): Promise<BulkFineAssessmentResult> {
    await OperationPolicyService.assertPermitted('FINANCE_ASSESSMENTS_AND_RULES');
    return FinanceRepository.assessBulkFines(params);
  }

  async issueManualFine(params: {
    studentId: string;
    semesterId: string;
    title: string;
    amountCentavos: number;
    dueDate?: string | null;
    ruleId?: string;
    actorUserId?: string;
  }): Promise<StudentObligationItem> {
    await OperationPolicyService.assertPermitted('FINANCE_ASSESSMENTS_AND_RULES');
    if (!params.studentId) throw new Error('Student is required.');
    if (!params.title || !params.title.trim()) throw new Error('Fine title is required.');
    if (params.amountCentavos <= 0) throw new Error('Fine amount must be greater than zero.');

    const id = generateUuid();
    const now = new Date().toISOString();

    await FinanceRepository.assessObligation({
      id,
      student_id: params.studentId,
      semester_id: params.semesterId,
      rule_id: params.ruleId || null,
      title: params.title.trim(),
      type: 'FINE',
      amount_centavos: Math.round(params.amountCentavos),
      status: 'ACTIVE',
      due_date: params.dueDate || null,
      issued_by_user_id: params.actorUserId || null,
      issued_at: now,
      updated_at: now,
    });

    return {
      id,
      studentId: params.studentId,
      semesterId: params.semesterId,
      ruleId: params.ruleId || null,
      title: params.title.trim(),
      type: 'FINE',
      amountCentavos: Math.round(params.amountCentavos),
      paidCentavos: 0,
      balanceCentavos: Math.round(params.amountCentavos),
      status: 'UNPAID',
      dueDate: params.dueDate || null,
      issuedByUserId: params.actorUserId || null,
      issuedAt: now,
      updatedAt: now,
    };
  }

  // ==========================================================================
  // --- 3. CONTRIBUTIONS MANAGEMENT ---
  // ==========================================================================

  async assessBulkContributions(params: BulkContributionParams): Promise<BulkContributionResult> {
    await OperationPolicyService.assertPermitted('FINANCE_ASSESSMENTS_AND_RULES');
    return FinanceRepository.assessBulkContributions(params);
  }

  // ==========================================================================
  // --- 4. OBLIGATION QUERIES & VOIDING ---
  // ==========================================================================

  async getStudentObligations(
    studentId: string,
    semesterId?: string
  ): Promise<StudentObligationItem[]> {
    const records = await FinanceRepository.getStudentObligations(studentId, semesterId);
    return records.map(this.mapObligationRecordToItem);
  }

  async getObligationsBySemester(
    semesterId: string,
    type?: 'FINE' | 'CONTRIBUTION'
  ): Promise<StudentObligationItem[]> {
    const records = await FinanceRepository.getObligationsBySemester(semesterId, type);
    return records.map(this.mapObligationRecordToItem);
  }

  async voidObligation(
    obligationId: string,
    reason: string,
    actorUserId: string
  ): Promise<void> {
    await OperationPolicyService.assertPermitted('FINANCE_ASSESSMENTS_AND_RULES');
    return FinanceRepository.voidObligation(obligationId, reason, actorUserId);
  }

  // ==========================================================================
  // --- 5. DIRECT PAYMENT RECORDING & RECEIPT GENERATION ---
  // ==========================================================================

  async recordPayment(params: {
    studentId: string;
    semesterId: string;
    amountCentavos: number;
    source: PaymentMethod;
    channel?: PaymentChannel;
    allocations: { obligationId: string; amountCentavos: number }[];
    notes?: string;
    actorUserId: string;
    paymentId?: string;
    referenceNumber?: string;
    idempotencyKey?: string;
  }): Promise<{ paymentId: string; referenceNumber: string }> {
    await OperationPolicyService.assertPermitted('PAYMENT_POST_REVERSE_RECEIPT');

    if (params.amountCentavos <= 0) {
      throw new Error('Payment amount must be greater than zero.');
    }
    if (!params.allocations || params.allocations.length === 0) {
      throw new Error('Payment must be allocated to at least one obligation.');
    }

    const totalAlloc = params.allocations.reduce((sum, a) => sum + a.amountCentavos, 0);
    if (totalAlloc !== params.amountCentavos) {
      throw new Error(`Total allocations (${totalAlloc}) must match payment amount (${params.amountCentavos}).`);
    }

    // Source normalization & strict validation (reject unsupported/retired sources)
    const normalizedSource = params.source === 'CASH' ? 'CASH_RECORDED' : params.source;
    if (normalizedSource !== 'CASH_RECORDED' && normalizedSource !== 'MANUAL_TRANSFER_RECORD') {
      throw new Error(`Unsupported payment source: ${params.source}`);
    }

    // Reuse client-supplied attempt identifiers if provided (for safe retry), otherwise generate fresh RFC 4122 UUID
    const paymentId = params.paymentId || generateUuid();
    const referenceNumber = params.referenceNumber || generateReferenceNumber('PAY');
    const idempotencyKey = params.idempotencyKey || ('idemp_' + paymentId);
    const now = new Date().toISOString();

    const allocPayload = params.allocations.map((a) => ({
      id: generateUuid(),
      obligation_id: a.obligationId,
      amount_centavos: a.amountCentavos,
    }));

    // 1. Authoritative Server RPC Confirmation
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('record_student_payment', {
      p_payment_id: paymentId,
      p_student_id: params.studentId,
      p_semester_id: params.semesterId,
      p_reference_number: referenceNumber,
      p_idempotency_key: idempotencyKey,
      p_amount_centavos: params.amountCentavos,
      p_source: normalizedSource,
      p_channel: params.channel || 'MANUAL',
      p_allocations: allocPayload,
      p_notes: params.notes || null,
    });

    if (rpcErr) {
      if (rpcErr.code === 'PGRST202' || rpcErr.message?.includes('Could not find the function') || rpcErr.message?.includes('schema cache')) {
        throw new Error('Payment system server update in progress. Please contact system administrator.');
      }
      throw new Error(`Server payment recording failed: ${rpcErr.message}`);
    }

    if (rpcRes?.status !== 'CONFIRMED' && rpcRes?.status !== 'ALREADY_RECORDED') {
      throw new Error(`Payment rejected by server: ${rpcRes?.error || rpcRes?.message || 'Server did not confirm transaction.'}`);
    }

    const confirmedPaymentId = rpcRes.payment_id || paymentId;
    const confirmedReferenceNumber = rpcRes.reference_number || referenceNumber;

    // 2. Mirror server-confirmed payment into local SQLite (NO outbox item created)
    await FinanceRepository.recordServerConfirmedPayment(
      {
        id: confirmedPaymentId,
        student_id: params.studentId,
        semester_id: params.semesterId,
        reference_number: confirmedReferenceNumber,
        idempotency_key: idempotencyKey,
        amount_centavos: params.amountCentavos,
        source: normalizedSource,
        channel: params.channel || 'MANUAL',
        status: 'POSTED',
        processed_by_user_id: params.actorUserId,
        notes: params.notes || null,
        processed_at: rpcRes.processed_at || now,
      },
      allocPayload
    );

    return { paymentId: confirmedPaymentId, referenceNumber: confirmedReferenceNumber };
  }

  async reversePayment(
    paymentId: string,
    reason: string,
    actorUserId: string
  ): Promise<void> {
    await OperationPolicyService.assertPermitted('PAYMENT_POST_REVERSE_RECEIPT');

    if (!reason || reason.trim().length === 0) {
      throw new Error('Reversal reason is mandatory.');
    }

    const idempotencyKey = 'idemp_rev_' + paymentId;
    const { data: revRes, error: revErr } = await supabase.rpc('reverse_student_payment', {
      p_payment_id: paymentId,
      p_reversal_reason: reason.trim(),
      p_idempotency_key: idempotencyKey,
    });

    if (revErr) {
      if (revErr.code === 'PGRST202' || revErr.message?.includes('Could not find the function') || revErr.message?.includes('schema cache')) {
        throw new Error('Payment system server update in progress. Please contact system administrator.');
      }
      throw new Error(`Server payment reversal failed: ${revErr.message}`);
    }

    if (!revRes?.success && revRes?.status !== 'ALREADY_REVERSED' && revRes?.status !== 'REVERSED') {
      throw new Error(`Payment reversal rejected by server: ${revRes?.error || revRes?.message || 'Server did not confirm reversal.'}`);
    }

    // Mirror server-confirmed reversal into local SQLite (NO outbox item created)
    await FinanceRepository.recordServerConfirmedReversal(paymentId, reason.trim(), actorUserId);
  }

  async getAllPayments(semesterId?: string): Promise<PaymentItem[]> {
    const records = await FinanceRepository.getAllPayments(semesterId);
    return records.map((p) => ({
      id: p.id,
      studentId: p.student_id,
      semesterId: p.semester_id,
      referenceNumber: p.reference_number,
      idempotencyKey: p.idempotency_key,
      amountCentavos: p.amount_centavos,
      source: p.source as PaymentMethod,
      channel: p.channel as PaymentChannel,
      status: p.status as 'POSTED' | 'REVERSED',
      processedByUserId: p.processed_by_user_id,
      processedAt: p.processed_at,
      reversedAt: p.reversed_at,
      reversedByUserId: p.reversed_by_user_id,
      reversalReason: p.reversal_reason,
      notes: p.notes,
      studentSchoolId: p.school_id,
      studentName: p.last_name && p.first_name ? `${p.last_name}, ${p.first_name}` : undefined,
      allocations: (p.allocations || []).map((a) => ({
        id: a.id,
        paymentId: p.id,
        obligationId: a.obligation_id,
        amountCentavos: a.amount_centavos,
        obligationTitle: a.obligation_title,
        obligationType: a.obligation_type as any,
      })),
    }));
  }

  async generatePaymentReceipt(
    paymentId: string,
    officerName = 'Authorized Officer'
  ): Promise<PaymentReceipt> {
    const payment = await FinanceRepository.getPaymentById(paymentId);
    if (!payment) throw new Error('Payment not found.');

    const student = await StudentsRepository.getStudentById(payment.student_id);
    const semester = await AcademicRepository.getSemesterById(payment.semester_id);
    const year = semester ? await AcademicRepository.getYearById(semester.academic_year_id) : null;
    const enrollment = await AcademicRepository.getStudentEnrollmentInSemester(payment.student_id, payment.semester_id);

    // Fetch up-to-date balances for allocated obligations
    const obligations = await FinanceRepository.getStudentObligations(payment.student_id, payment.semester_id);
    const obMap = new Map(obligations.map((o) => [o.id, o]));

    const items = payment.allocations.map((a) => {
      const ob = obMap.get(a.obligation_id);
      return {
        obligationId: a.obligation_id,
        title: a.obligation_title || ob?.title || 'Obligation',
        type: (a.obligation_type || ob?.type || 'FINE') as any,
        paidAmountCentavos: a.amount_centavos,
        remainingBalanceCentavos: ob ? ob.balance_centavos : 0,
      };
    });

    return {
      referenceNumber: payment.reference_number,
      paymentDate: payment.processed_at,
      student: {
        id: payment.student_id,
        schoolId: student?.school_id || 'N/A',
        fullName: student ? `${student.last_name}, ${student.first_name}` : 'Student',
        section: enrollment?.section || 'N/A',
        yearLevel: enrollment?.year_level || 1,
      },
      academicTerm: {
        semesterLabel: semester ? `${semester.term} Semester` : 'Current Semester',
        academicYearLabel: year?.label || 'Academic Year',
      },
      receivedByOfficer: officerName,
      paymentMethod: (payment.source === 'MANUAL_TRANSFER_RECORD' ? 'MANUAL_TRANSFER_RECORD' : 'CASH') as PaymentMethod,
      notes: payment.notes || undefined,
      items,
      totalPaidCentavos: payment.amount_centavos,
      isLocallyRecordedPendingSync: true,
    };
  }

  generatePrintableReceiptHtml(receipt: PaymentReceipt): string {
    const itemRows = receipt.items
      .map(
        (it) => `
      <tr>
        <td style="padding: 6px 0; border-bottom: 1px dashed #cbd5e1; font-size: 13px;">${it.title} (${it.type})</td>
        <td style="padding: 6px 0; border-bottom: 1px dashed #cbd5e1; text-align: right; font-weight: 700; font-size: 13px;">${formatCentavosToPesos(it.paidAmountCentavos)}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding-bottom: 6px; font-size: 11px; color: #64748b;">Remaining balance: ${formatCentavosToPesos(it.remainingBalanceCentavos)}</td>
      </tr>
    `
      )
      .join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Receipt - ${receipt.referenceNumber}</title>
        <style>
          body { font-family: monospace, system-ui; max-width: 380px; margin: 0 auto; padding: 16px; color: #0f172a; font-size: 13px; }
          .center { text-align: center; }
          .brand { font-size: 18px; font-weight: 900; color: #0f766e; margin-bottom: 2px; }
          .sub { font-size: 11px; color: #64748b; margin-bottom: 12px; }
          .divider { border-top: 1px dashed #94a3b8; margin: 12px 0; }
          .row { display: flex; justify-content: space-between; margin: 3px 0; }
          .bold { font-weight: 700; }
          .total-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin: 12px 0; }
          .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; background: #fef3c7; color: #b45309; }
        </style>
      </head>
      <body>
        <div class="center">
          <div class="brand">UniTap 2.0</div>
          <div class="sub">CSG Official Payment Receipt</div>
          ${receipt.isLocallyRecordedPendingSync ? '<div class="badge">Locally Recorded • Sync Pending</div>' : ''}
        </div>
        <div class="divider"></div>
        <div class="row"><span>Ref #:</span><span class="bold">${receipt.referenceNumber}</span></div>
        <div class="row"><span>Date:</span><span>${new Date(receipt.paymentDate).toLocaleString()}</span></div>
        <div class="row"><span>Term:</span><span>${receipt.academicTerm.semesterLabel} (${receipt.academicTerm.academicYearLabel})</span></div>
        <div class="divider"></div>
        <div class="row"><span>Student ID:</span><span class="bold">${receipt.student.schoolId}</span></div>
        <div class="row"><span>Student:</span><span>${receipt.student.fullName}</span></div>
        <div class="row"><span>Section:</span><span>${receipt.student.yearLevel} - ${receipt.student.section}</span></div>
        <div class="row"><span>Method:</span><span>${receipt.paymentMethod === 'CASH' ? 'Cash Collection' : 'Bank/Transfer Record'}</span></div>
        <div class="divider"></div>
        <table style="width: 100%; border-collapse: collapse;">
          ${itemRows}
        </table>
        <div class="total-box">
          <div class="row" style="font-size: 15px;">
            <span class="bold">TOTAL PAID:</span>
            <span class="bold" style="color: #047857;">${formatCentavosToPesos(receipt.totalPaidCentavos)}</span>
          </div>
        </div>
        <div class="row" style="font-size: 11px; color: #64748b;">
          <span>Officer:</span>
          <span>${receipt.receivedByOfficer}</span>
        </div>
        ${receipt.notes ? `<div style="font-size: 11px; color: #64748b; margin-top: 6px;">Notes: ${receipt.notes}</div>` : ''}
        <div class="divider"></div>
        <div class="center" style="font-size: 11px; color: #64748b;">
          Thank you for supporting the CSG community.<br>UniTap Offline-First System
        </div>
      </body>
      </html>
    `;
  }

  // ==========================================================================
  // --- 6. AGGREGATE SUMMARY ---
  // ==========================================================================

  async getFinanceSummary(semesterId?: string): Promise<FinanceSummary> {
    const db = await getDatabase();

    let semId = semesterId;
    if (!semId) {
      const activeSem = await db.queryOne<{ id: string }>('SELECT id FROM semesters WHERE status = ?', ['ACTIVE']);
      semId = activeSem?.id;
    }

    if (!semId) {
      return {
        totalOutstandingCentavos: 0,
        totalPaymentsCollectedCentavos: 0,
        totalAssessedCentavos: 0,
        unpaidFinesCount: 0,
        unpaidContributionsCount: 0,
        activeFinesCount: 0,
        activeContributionsCount: 0,
        totalSimulatedWalletCreditsCentavos: 0,
        unpaidChargesCount: 0,
        activeWalletsCount: 0,
      };
    }

    // Assessed & breakdown
    const obligations = await FinanceRepository.getObligationsBySemester(semId);

    let totalAssessed = 0;
    let totalOutstanding = 0;
    let unpaidFines = 0;
    let unpaidContribs = 0;
    let activeFines = 0;
    let activeContribs = 0;

    for (const ob of obligations) {
      totalAssessed += ob.assessed_centavos;
      totalOutstanding += ob.balance_centavos;

      if (ob.type === 'FINE') {
        activeFines++;
        if (ob.balance_centavos > 0) unpaidFines++;
      } else {
        activeContribs++;
        if (ob.balance_centavos > 0) unpaidContribs++;
      }
    }

    // Collected payments
    const collectedRow = await db.queryOne<{ collected: number }>(
      `SELECT COALESCE(SUM(amount_centavos), 0) as collected
       FROM payments
       WHERE semester_id = ? AND status = 'POSTED'`,
      [semId]
    );
    const totalCollected = collectedRow?.collected || 0;

    return {
      totalOutstandingCentavos: Math.max(0, totalOutstanding),
      totalPaymentsCollectedCentavos: totalCollected,
      totalAssessedCentavos: totalAssessed,
      unpaidFinesCount: unpaidFines,
      unpaidContributionsCount: unpaidContribs,
      activeFinesCount: activeFines,
      activeContributionsCount: activeContribs,
      // Backward compatibility:
      totalSimulatedWalletCreditsCentavos: 0,
      unpaidChargesCount: unpaidFines + unpaidContribs,
      activeWalletsCount: 0,
    };
  }

  // ==========================================================================
  // --- 7. BACKWARD COMPATIBILITY HELPERS ---
  // ==========================================================================

  private mapObligationRecordToItem(r: StudentObligationWithBalance): StudentObligationItem {
    let status: any = 'UNPAID';
    if (r.status === 'VOID') {
      status = 'VOID';
    } else if (r.balance_centavos === 0 && r.assessed_centavos > 0) {
      status = 'PAID';
    } else if (r.paid_centavos > 0 && r.balance_centavos > 0) {
      status = 'PARTIALLY_PAID';
    }

    return {
      id: r.id,
      studentId: r.student_id,
      semesterId: r.semester_id,
      ruleId: r.rule_id,
      relatedEventId: r.related_event_id,
      relatedOccurrenceId: r.related_occurrence_id,
      title: r.title,
      type: r.type,
      amountCentavos: r.assessed_centavos,
      paidCentavos: r.paid_centavos,
      balanceCentavos: r.balance_centavos,
      status,
      dueDate: r.due_date,
      batchId: r.batch_id,
      issuedByUserId: r.issued_by_user_id,
      issuedAt: r.issued_at,
      updatedAt: r.updated_at,
      voidReason: r.void_reason || undefined,
      schoolId: r.school_id,
      studentName: r.last_name && r.first_name ? `${r.last_name}, ${r.first_name}` : undefined,
      yearLevel: r.year_level,
      section: r.section,
    };
  }

  /** @deprecated Kept for backward compatibility with legacy tests */
  async getTemplates(): Promise<ChargeTemplate[]> {
    const db = await getDatabase();
    const activeSem = await db.queryOne<{ id: string }>('SELECT id FROM semesters WHERE status = ?', ['ACTIVE']);
    if (!activeSem) return [];
    const rules = await this.getRules(activeSem.id);
    return rules.map((r) => ({
      ...r,
      chargeType: r.type,
      defaultAmount: r.defaultAmountCentavos,
    }));
  }

  /** @deprecated Kept for backward compatibility with legacy tests */
  async createTemplate(params: {
    name: string;
    chargeType: ChargeType;
    defaultAmount: number;
    triggerType: ChargeTrigger;
  }): Promise<ChargeTemplate> {
    const db = await getDatabase();
    const activeSem = await db.queryOne<{ id: string }>('SELECT id FROM semesters WHERE status = ?', ['ACTIVE']);
    const semesterId = activeSem?.id || 'sem_default';
    return this.createRule({
      semesterId,
      name: params.name,
      type: params.chargeType === 'CONTRIBUTION' ? 'CONTRIBUTION' : 'FINE',
      triggerType: params.triggerType,
      defaultAmountCentavos: params.defaultAmount,
    });
  }

  /** @deprecated Kept for backward compatibility with legacy tests */
  async getCharges(studentId?: string): Promise<StudentCharge[]> {
    if (studentId) {
      const items = await this.getStudentObligations(studentId);
      return items.map((it) => ({
        id: it.id,
        studentId: it.studentId,
        chargeTemplateId: it.ruleId || undefined,
        title: it.title,
        chargeType: it.type,
        issuedAmount: it.amountCentavos,
        paidAmount: it.paidCentavos,
        status: it.status,
        relatedEventId: it.relatedEventId || undefined,
        relatedOccurrenceId: it.relatedOccurrenceId || undefined,
        issuedAt: it.issuedAt,
        updatedAt: it.updatedAt,
        voidReason: it.voidReason,
      }));
    }
    const db = await getDatabase();
    const activeSem = await db.queryOne<{ id: string }>('SELECT id FROM semesters WHERE status = ?', ['ACTIVE']);
    if (!activeSem) return [];
    const items = await this.getObligationsBySemester(activeSem.id);
    return items.map((it) => ({
      id: it.id,
      studentId: it.studentId,
      chargeTemplateId: it.ruleId || undefined,
      title: it.title,
      chargeType: it.type,
      issuedAmount: it.amountCentavos,
      paidAmount: it.paidCentavos,
      status: it.status,
      relatedEventId: it.relatedEventId || undefined,
      relatedOccurrenceId: it.relatedOccurrenceId || undefined,
      issuedAt: it.issuedAt,
      updatedAt: it.updatedAt,
      voidReason: it.voidReason,
    }));
  }

  /** @deprecated Kept for backward compatibility with legacy tests */
  async issueCharge(params: {
    studentId: string;
    chargeTemplateId?: string;
    title: string;
    chargeType: ChargeType;
    issuedAmount: number;
    relatedEventId?: string;
    relatedOccurrenceId?: string;
    remarks?: string;
  }): Promise<StudentCharge> {
    const db = await getDatabase();
    const activeSem = await db.queryOne<{ id: string }>('SELECT id FROM semesters WHERE status = ?', ['ACTIVE']);
    const semesterId = activeSem?.id || 'sem_default';
    const ob = await this.issueManualFine({
      studentId: params.studentId,
      semesterId,
      title: params.title,
      amountCentavos: params.issuedAmount,
      ruleId: params.chargeTemplateId,
    });
    return {
      id: ob.id,
      studentId: ob.studentId,
      chargeTemplateId: ob.ruleId || undefined,
      title: ob.title,
      chargeType: ob.type,
      issuedAmount: ob.amountCentavos,
      paidAmount: 0,
      status: 'UNPAID',
      issuedAt: ob.issuedAt,
      updatedAt: ob.updatedAt,
    };
  }

  /** @deprecated Kept for backward compatibility with legacy tests */
  async voidCharge(chargeId: string, reason: string): Promise<StudentCharge> {
    await this.voidObligation(chargeId, reason, 'officer_default');
    return {
      id: chargeId,
      studentId: '',
      title: '',
      chargeType: 'FINE',
      issuedAmount: 0,
      paidAmount: 0,
      status: 'VOID',
      voidReason: reason,
      issuedAt: '',
      updatedAt: new Date().toISOString(),
    };
  }

  /** @deprecated Kept for backward compatibility with legacy tests */
  async getPayments(studentId?: string): Promise<Payment[]> {
    const list = await this.getAllPayments();
    const filtered = studentId ? list.filter((p) => p.studentId === studentId) : list;
    return filtered.map((p) => ({
      id: p.id,
      studentId: p.studentId,
      referenceNumber: p.referenceNumber,
      amount: p.amountCentavos,
      paymentSource: p.source,
      paymentChannel: p.channel,
      status: p.status === 'POSTED' ? 'COMPLETED' : 'REVERSED',
      processedAt: p.processedAt,
      allocations: p.allocations.map((a) => ({
        id: a.id,
        paymentId: a.paymentId,
        studentChargeId: a.obligationId,
        amountApplied: a.amountCentavos,
      })),
    }));
  }

  /** @deprecated Kept for backward compatibility with legacy tests */
  async processPayment(params: {
    studentId: string;
    allocations: { chargeId: string; amountCentavos: number }[];
    channel?: PaymentChannel;
    notes?: string;
  }): Promise<Payment> {
    const total = params.allocations.reduce((sum, a) => sum + a.amountCentavos, 0);
    const db = await getDatabase();
    const activeSem = await db.queryOne<{ id: string }>('SELECT id FROM semesters WHERE status = ?', ['ACTIVE']);
    const semesterId = activeSem?.id || 'sem_default';

    const result = await this.recordPayment({
      studentId: params.studentId,
      semesterId,
      amountCentavos: total,
      source: 'CASH',
      channel: params.channel || 'MANUAL',
      allocations: params.allocations.map((a) => ({
        obligationId: a.chargeId,
        amountCentavos: a.amountCentavos,
      })),
      notes: params.notes,
      actorUserId: 'officer_default',
    });

    return {
      id: result.paymentId,
      studentId: params.studentId,
      referenceNumber: result.referenceNumber,
      amount: total,
      paymentSource: 'CASH',
      paymentChannel: params.channel || 'MANUAL',
      status: 'COMPLETED',
      processedAt: new Date().toISOString(),
      allocations: params.allocations.map((a) => ({
        id: generateId('pa'),
        paymentId: result.paymentId,
        studentChargeId: a.chargeId,
        amountApplied: a.amountCentavos,
      })),
    };
  }

  /** @deprecated UniTap 2.0 retired wallet. Always returns 0. */
  async calculateWalletBalance(_studentId: string): Promise<number> {
    void _studentId;
    return 0;
  }

  /** @deprecated UniTap 2.0 retired wallet */
  async getOrCreateWallet(studentId: string): Promise<Wallet> {
    return {
      id: 'wal_' + studentId,
      studentId,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /** @deprecated UniTap 2.0 retired wallet */
  async topUpWallet(
    studentId: string,
    amountCentavos: number,
    note?: string
  ): Promise<WalletTransaction> {
    return {
      id: 'txn_' + Date.now(),
      walletId: 'wal_' + studentId,
      studentId,
      type: 'TOP_UP',
      amount: amountCentavos,
      referenceNumber: generateReferenceNumber('TOP'),
      description: note || 'Deprecated Top-up',
      createdAt: new Date().toISOString(),
    };
  }

  /** @deprecated UniTap 2.0 retired wallet */
  async getWalletTransactions(_walletId: string): Promise<WalletTransaction[]> {
    void _walletId;
    return [];
  }

  /** @deprecated UniTap 2.0 retired wallet */
  async getStudentTransactions(_studentId: string): Promise<WalletTransaction[]> {
    void _studentId;
    return [];
  }
}

export const financeService = new FinanceService();
