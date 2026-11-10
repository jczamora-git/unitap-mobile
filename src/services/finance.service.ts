import { getDatabase } from '@/database/database';
import {
  FinanceRepository,
  type StudentObligationWithBalance,
} from '@/database/repositories/finance.repository';
import type { Student } from '@/types/student';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { studentService } from '@/services/student.service';
import { PushSyncService } from '@/services/sync/push-sync.service';
import { generateReferenceNumber, formatCentavosToPesos } from '@/utilities/finance-formatters';
import { OperationPolicyService } from './operation-policy.service';
import { DataModeService } from './data-mode.service';
import { ReportService } from './report.service';
import { supabase } from '@/integrations/supabase/client';
import { logDataSource } from '@/utilities/data-source-logger';
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
  ContributionCollectionItem,
  CreateContributionCollectionParams,
  ContributionCreationStage,
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
  ObligationStatus,
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
    if (DataModeService.isDirectSupabase()) {
      let query = supabase.from('obligation_rules').select('*').order('created_at', { ascending: false });
      if (semesterId && semesterId !== 'sem_default') {
        query = query.eq('semester_id', semesterId);
      }
      const { data, error } = await query;
      if (error) {
        throw new Error(`Failed to load obligation rules from Supabase: ${error.message}`);
      }
      return (data || []).map((r) => ({
        id: r.id,
        semesterId: r.semester_id,
        name: r.name,
        type: r.type,
        triggerType: r.trigger_type,
        defaultAmountCentavos: Number(r.default_amount_centavos),
        dueOn: r.due_on || null,
        status: r.status,
        createdAt: r.created_at,
      }));
    }

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

  async getRuleById(id: string): Promise<ObligationRuleItem | null> {
    if (!id) return null;
    if (DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('obligation_rules')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id,
        semesterId: data.semester_id,
        name: data.name,
        type: data.type,
        triggerType: data.trigger_type,
        defaultAmountCentavos: Number(data.default_amount_centavos || 0),
        dueOn: data.due_on || null,
        status: data.status,
        createdAt: data.created_at,
      };
    }
    const db = await getDatabase();
    const row = await db.queryOne<any>('SELECT * FROM obligation_rules WHERE id = ?', [id]);
    if (!row) return null;
    return {
      id: row.id,
      semesterId: row.semester_id,
      name: row.name,
      type: row.type,
      triggerType: row.trigger_type,
      defaultAmountCentavos: Number(row.default_amount_centavos || 0),
      dueOn: row.due_on || null,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  async getActiveTemplates(semesterId?: string): Promise<ObligationRuleItem[]> {
    if (DataModeService.isDirectSupabase()) {
      let query = supabase.from('obligation_rules').select('*').eq('status', 'ACTIVE').order('created_at', { ascending: false });
      if (semesterId && semesterId !== 'sem_default') {
        query = query.eq('semester_id', semesterId);
      }
      const { data, error } = await query;
      if (error) {
        throw new Error(`Failed to load obligation rules from Supabase: ${error.message}`);
      }
      return (data || []).map((r) => ({
        id: r.id,
        semesterId: r.semester_id,
        name: r.name,
        type: r.type,
        triggerType: r.trigger_type,
        defaultAmountCentavos: Number(r.default_amount_centavos),
        dueOn: r.due_on || null,
        status: r.status,
        createdAt: r.created_at,
      }));
    }

    let semId = semesterId;
    if (!semId) {
      const activeSem = await AcademicRepository.getActiveSemester();
      semId = activeSem?.id;
    }
    let rules = await FinanceRepository.getActiveRules(semId);
    if ((!rules || rules.length === 0) && semId) {
      rules = await FinanceRepository.getActiveRules();
    }
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

    const id = generateUuid();
    const now = new Date().toISOString();

    if (DataModeService.isDirectSupabase()) {
      let semesterId = params.semesterId;
      if (!semesterId || semesterId === 'sem_default') {
        const { data: semData } = await supabase.from('semesters').select('id').eq('status', 'ACTIVE').limit(1).maybeSingle();
        semesterId = semData?.id || 'sem_2026_2027_1';
      }
      const { error } = await supabase.from('obligation_rules').insert({
        id,
        semester_id: semesterId,
        name: params.name.trim(),
        type: params.type,
        trigger_type: params.triggerType,
        default_amount_centavos: Math.round(params.defaultAmountCentavos),
        status: 'ACTIVE',
        created_at: now,
      });
      if (error) {
        throw new Error(`Failed to create rule on Supabase: ${error.message}`);
      }
      return {
        id,
        semesterId,
        name: params.name.trim(),
        type: params.type,
        triggerType: params.triggerType,
        defaultAmountCentavos: Math.round(params.defaultAmountCentavos),
        dueOn: params.dueOn || null,
        status: 'ACTIVE',
        createdAt: now,
      };
    }

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
    ruleId?: string,
    checkpointId?: string
  ): Promise<{
    summary: OccurrenceAbsenteeSummary;
    candidates: AbsenteeCandidate[];
  }> {
    if (!DataModeService.isDirectSupabase()) {
      try {
        await FinanceRepository.ensureFinalizedRoster(occurrenceId);
      } catch (err) {
        console.warn('[FinanceService] ensureFinalizedRoster notice:', err);
      }
    }
    return FinanceRepository.getAbsenteeCandidates(occurrenceId, ruleId, checkpointId);
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

    if (DataModeService.isDirectSupabase()) {
      let semesterId = params.semesterId;
      if (!semesterId || semesterId === 'sem_default') {
        const { data: semData } = await supabase.from('semesters').select('id').eq('status', 'ACTIVE').limit(1).maybeSingle();
        semesterId = semData?.id || 'sem_2026_2027_1';
      }
      const { error } = await supabase.from('student_obligations').insert({
        id,
        student_id: params.studentId,
        semester_id: semesterId,
        rule_id: params.ruleId || null,
        title: params.title.trim(),
        type: 'FINE',
        amount_centavos: Math.round(params.amountCentavos),
        status: 'ACTIVE',
        due_date: params.dueDate || null,
        issued_at: now,
        updated_at: now,
      });
      if (error) {
        throw new Error(`Failed to assess fine on Supabase: ${error.message}`);
      }
      return {
        id,
        studentId: params.studentId,
        semesterId,
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

  async assessBulkContributions(
    params: BulkContributionParams,
    onProgress?: (stage: string, meta?: { current?: number; total?: number }) => void
  ): Promise<BulkContributionResult> {
    await OperationPolicyService.assertPermitted('FINANCE_ASSESSMENTS_AND_RULES');
    return FinanceRepository.assessBulkContributions(params, undefined, onProgress);
  }

  async createContributionCollection(
    params: CreateContributionCollectionParams,
    onProgress?: (stage: ContributionCreationStage, meta?: { current?: number; total?: number; error?: string }) => void
  ): Promise<{
    rule: ObligationRuleItem;
    assessResult: BulkContributionResult;
  }> {
    await OperationPolicyService.assertPermitted('FINANCE_ASSESSMENTS_AND_RULES');

    if (!params.name || !params.name.trim()) {
      throw new Error('Contribution collection name is required.');
    }
    if (params.amountCentavos <= 0) {
      throw new Error('Amount must be greater than zero centavos.');
    }
    if (!params.semesterId) {
      throw new Error('Academic period (semester) is required.');
    }

    let rule: ObligationRuleItem;

    // 1. If retrying with an existing rule, skip creation to prevent duplicate rules
    if (params.existingRuleId) {
      const existing = await this.getRuleById(params.existingRuleId);
      if (existing) {
        rule = existing;
      } else {
        rule = {
          id: params.existingRuleId,
          semesterId: params.semesterId,
          name: params.name.trim(),
          type: 'CONTRIBUTION',
          triggerType: 'MANUAL',
          defaultAmountCentavos: params.amountCentavos,
          dueOn: params.dueDate || null,
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
        };
      }
    } else {
      onProgress?.('CREATING_RULE');
      rule = await this.createRule({
        semesterId: params.semesterId,
        name: params.name.trim(),
        type: 'CONTRIBUTION',
        triggerType: 'MANUAL',
        defaultAmountCentavos: params.amountCentavos,
        dueOn: params.dueDate || null,
        actorUserId: params.actorUserId,
      });
    }

    // 2. Assess individual student obligations linked to this collection rule
    try {
      const assessResult = await this.assessBulkContributions(
        {
          semesterId: params.semesterId,
          ruleId: rule.id,
          title: params.name.trim(),
          amountCentavos: params.amountCentavos,
          dueDate: params.dueDate || null,
          notes: params.notes || null,
          targetScope: params.targetScope,
          programIds: params.programIds,
          yearLevels: params.yearLevels,
          sections: params.sections,
          studentIds: params.studentIds,
          actorUserId: params.actorUserId || 'officer_user',
        },
        (stage, meta) => onProgress?.(stage as ContributionCreationStage, meta)
      );

      return { rule, assessResult };
    } catch (assessErr: any) {
      const err = new Error(
        `Contribution fee "${rule.name}" was saved, but assigning student obligations failed: ${assessErr.message}`
      );
      (err as any).savedRule = rule;
      (err as any).ruleSaved = true;
      throw err;
    }
  }

  async getContributionCollections(semesterId?: string): Promise<ContributionCollectionItem[]> {
    let semId = semesterId;
    if (!semId) {
      const activeSem = await AcademicRepository.getActiveSemester();
      semId = activeSem?.id;
    }
    if (!semId) return [];

    const [rules, obligations] = await Promise.all([
      this.getRules(semId),
      this.getObligationsBySemester(semId, 'CONTRIBUTION'),
    ]);

    const contribRules = rules.filter((r) => r.type === 'CONTRIBUTION');
    const collections: ContributionCollectionItem[] = [];
    const accountedObligationIds = new Set<string>();

    for (const rule of contribRules) {
      const assigned = obligations.filter((o) => o.ruleId === rule.id && o.status !== 'VOID');
      assigned.forEach((o) => accountedObligationIds.add(o.id));

      const totalStudentsAssigned = assigned.length;
      const fullyPaidCount = assigned.filter((o) => o.status === 'PAID').length;
      const partialPaymentCount = assigned.filter((o) => o.status === 'PARTIALLY_PAID').length;
      const unpaidCount = assigned.filter((o) => o.status === 'UNPAID').length;
      const totalCollectedCentavos = assigned.reduce((sum, o) => sum + o.paidCentavos, 0);
      const totalAssessedCentavos = assigned.reduce((sum, o) => sum + o.amountCentavos, 0);

      let status: 'ACTIVE' | 'COMPLETED' | 'INACTIVE' = rule.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
      if (totalStudentsAssigned > 0 && fullyPaidCount === totalStudentsAssigned) {
        status = 'COMPLETED';
      }

      collections.push({
        id: rule.id,
        ruleId: rule.id,
        name: rule.name,
        amountCentavos: rule.defaultAmountCentavos || (assigned[0]?.amountCentavos ?? 0),
        dueDate: rule.dueOn || assigned[0]?.dueDate || null,
        semesterId: semId,
        totalStudentsAssigned,
        fullyPaidCount,
        partialPaymentCount,
        unpaidCount,
        totalCollectedCentavos,
        totalAssessedCentavos,
        status,
        createdAt: rule.createdAt,
      });
    }

    // Support legacy/unlinked contribution assessments (e.g. created prior to rule linkage)
    const unlinked = obligations.filter((o) => !accountedObligationIds.has(o.id) && o.status !== 'VOID');
    const unlinkedByTitle = new Map<string, StudentObligationItem[]>();
    for (const u of unlinked) {
      const list = unlinkedByTitle.get(u.title) || [];
      list.push(u);
      unlinkedByTitle.set(u.title, list);
    }

    for (const [title, group] of unlinkedByTitle.entries()) {
      const totalStudentsAssigned = group.length;
      const fullyPaidCount = group.filter((o) => o.status === 'PAID').length;
      const partialPaymentCount = group.filter((o) => o.status === 'PARTIALLY_PAID').length;
      const unpaidCount = group.filter((o) => o.status === 'UNPAID').length;
      const totalCollectedCentavos = group.reduce((sum, o) => sum + o.paidCentavos, 0);
      const totalAssessedCentavos = group.reduce((sum, o) => sum + o.amountCentavos, 0);
      const first = group[0];

      let status: 'ACTIVE' | 'COMPLETED' | 'INACTIVE' = 'ACTIVE';
      if (totalStudentsAssigned > 0 && fullyPaidCount === totalStudentsAssigned) {
        status = 'COMPLETED';
      }

      collections.push({
        id: 'legacy_' + (first.batchId || title.replace(/\s+/g, '_').toLowerCase()),
        ruleId: undefined,
        name: title,
        amountCentavos: first.amountCentavos,
        dueDate: first.dueDate || null,
        semesterId: semId,
        totalStudentsAssigned,
        fullyPaidCount,
        partialPaymentCount,
        unpaidCount,
        totalCollectedCentavos,
        totalAssessedCentavos,
        status,
        createdAt: first.issuedAt,
      });
    }

    return collections;
  }

  // ==========================================================================
  // --- 4. OBLIGATION QUERIES & VOIDING ---
  // ==========================================================================

  async getStudentObligations(
    studentId: string,
    semesterId?: string
  ): Promise<StudentObligationItem[]> {
    if (DataModeService.isDirectSupabase()) {
      let query = supabase
        .from('student_obligations')
        .select('*')
        .eq('student_id', studentId)
        .order('issued_at', { ascending: false });

      if (semesterId && semesterId !== 'sem_default') {
        query = query.eq('semester_id', semesterId);
      }

      const { data: obs, error } = await query;
      if (error) {
        throw new Error(`Failed to query student obligations from Supabase: ${error.message}`);
      }

      const obIds = (obs || []).map((o: any) => o.id);
      let allocs: any[] = [];
      const postedPaymentIds = new Set<string>();

      if (obIds.length > 0) {
        const { data: allocData } = await supabase
          .from('payment_allocations')
          .select('*')
          .in('obligation_id', obIds);
        allocs = allocData || [];

        const payIds = Array.from(new Set(allocs.map((a: any) => a.payment_id).filter(Boolean)));
        if (payIds.length > 0) {
          const { data: payData } = await supabase
            .from('payments')
            .select('id, status')
            .in('id', payIds)
            .eq('status', 'POSTED');
          for (const p of payData || []) {
            postedPaymentIds.add(p.id);
          }
        }
      }

      const paidByObId = new Map<string, number>();
      for (const a of allocs) {
        if (postedPaymentIds.has(a.payment_id)) {
          paidByObId.set(
            a.obligation_id,
            (paidByObId.get(a.obligation_id) || 0) + Number(a.amount_centavos || 0)
          );
        }
      }

      return (obs || []).map((row: any) => {
        const paid = paidByObId.get(row.id) || 0;
        const total = Number(row.amount_centavos || 0);
        const balance = Math.max(0, total - paid);
        let derivedStatus: ObligationStatus = 'UNPAID';
        if (row.status === 'VOID') {
          derivedStatus = 'VOID';
        } else if (balance === 0 && total > 0) {
          derivedStatus = 'PAID';
        } else if (paid > 0 && balance > 0) {
          derivedStatus = 'PARTIALLY_PAID';
        }

        return {
          id: row.id,
          studentId: row.student_id,
          semesterId: row.semester_id,
          ruleId: row.rule_id || null,
          title: row.title,
          type: row.type,
          amountCentavos: total,
          paidCentavos: paid,
          balanceCentavos: balance,
          status: derivedStatus,
          dueDate: row.due_date || null,
          issuedAt: row.issued_at,
          updatedAt: row.updated_at,
        };
      });
    }

    await FinanceRepository.repairLegacyObligationIds();
    const records = await FinanceRepository.getStudentObligations(studentId, semesterId);
    return records.map(this.mapObligationRecordToItem);
  }

  async checkStudentObligationForTemplate(
    studentId: string,
    ruleId: string
  ): Promise<{
    status: 'DUE' | 'PAID' | 'NO_OBLIGATION';
    obligation: StudentObligationItem | null;
  }> {
    const obligations = await this.getStudentObligations(studentId);
    const matching = obligations.filter((o) => o.ruleId === ruleId && o.status !== 'VOID');
    if (matching.length === 0) {
      return { status: 'NO_OBLIGATION', obligation: null };
    }
    const withBalance = matching.find((o) => o.balanceCentavos > 0);
    if (withBalance) {
      return { status: 'DUE', obligation: withBalance };
    }
    return { status: 'PAID', obligation: matching[0] };
  }

  async getObligationsBySemester(
    semesterId: string,
    type?: 'FINE' | 'CONTRIBUTION'
  ): Promise<StudentObligationItem[]> {
    if (DataModeService.isDirectSupabase()) {
      let query = supabase.from('student_obligations').select('*').eq('semester_id', semesterId);
      if (type) query = query.eq('type', type);
      const { data: obs, error } = await query.order('issued_at', { ascending: false });
      if (error) throw new Error(`Failed to load obligations from Supabase: ${error.message}`);

      const obIds = (obs || []).map((o: any) => o.id);
      let allocs: any[] = [];
      const postedPaymentIds = new Set<string>();

      if (obIds.length > 0) {
        const { data: allocData } = await supabase
          .from('payment_allocations')
          .select('*')
          .in('obligation_id', obIds);
        allocs = allocData || [];

        const payIds = Array.from(new Set(allocs.map((a: any) => a.payment_id).filter(Boolean)));
        if (payIds.length > 0) {
          const { data: payData } = await supabase
            .from('payments')
            .select('id, status')
            .in('id', payIds)
            .eq('status', 'POSTED');
          for (const p of payData || []) {
            postedPaymentIds.add(p.id);
          }
        }
      }

      const paidByObId = new Map<string, number>();
      for (const a of allocs) {
        if (postedPaymentIds.has(a.payment_id)) {
          paidByObId.set(
            a.obligation_id,
            (paidByObId.get(a.obligation_id) || 0) + Number(a.amount_centavos || 0)
          );
        }
      }

      const allStudents = await studentService.getStudents();
      const studentMap = new Map<string, any>();
      for (const s of allStudents) {
        studentMap.set(s.id, s);
      }

      return (obs || []).map((row: any) => {
        const paid = paidByObId.get(row.id) || 0;
        const total = Number(row.amount_centavos || 0);
        const balance = Math.max(0, total - paid);
        let derivedStatus: ObligationStatus = 'UNPAID';
        if (row.status === 'VOID') derivedStatus = 'VOID';
        else if (balance === 0 && total > 0) derivedStatus = 'PAID';
        else if (paid > 0 && balance > 0) derivedStatus = 'PARTIALLY_PAID';

        const s = studentMap.get(row.student_id);
        return {
          id: row.id,
          studentId: row.student_id,
          semesterId: row.semester_id,
          ruleId: row.rule_id || null,
          title: row.title,
          type: row.type,
          amountCentavos: total,
          paidCentavos: paid,
          balanceCentavos: balance,
          status: derivedStatus,
          dueDate: row.due_date || null,
          issuedAt: row.issued_at,
          updatedAt: row.updated_at,
          schoolId: s?.studentNumber || s?.school_id,
          studentName: s
            ? (s.lastName && s.firstName ? `${s.lastName}, ${s.firstName}` : s.firstName || s.studentNumber)
            : undefined,
          yearLevel: s?.yearLevel || s?.year_level,
          section: s?.section,
          course: s?.course,
          program: s?.course,
        };
      });
    }

    const records = await FinanceRepository.getObligationsBySemester(semesterId, type);
    return records.map(this.mapObligationRecordToItem);
  }

  /**
   * Retrieves students eligible for payment according to the selected category and active template rule.
   * Only returns students who owe outstanding (unpaid or partially paid) balances.
   * Filters at the database query level without fetching all students upfront.
   */
  async getEligibleStudentsForPayment(filter: {
    category?: 'ALL' | 'CONTRIBUTION' | 'FINE';
    ruleId?: string;
    semesterId?: string;
    searchQuery?: string;
  }): Promise<Student[]> {
    const studentIds = await FinanceRepository.getStudentIdsWithOutstandingBalance({
      category: filter.category,
      ruleId: filter.ruleId,
      semesterId: filter.semesterId,
    });

    if (studentIds.length === 0) {
      return [];
    }

    let students = await studentService.getStudentsByIds(studentIds);

    if (filter.searchQuery && filter.searchQuery.trim()) {
      const q = filter.searchQuery.trim().toLowerCase();
      students = students.filter((s) => {
        const numMatch = s.studentNumber?.toLowerCase().includes(q);
        const nameMatch = `${s.firstName} ${s.middleName || ''} ${s.lastName}`.toLowerCase().includes(q);
        const progMatch = s.course?.toLowerCase().includes(q);
        const secMatch = s.section?.toLowerCase().includes(q);
        return Boolean(numMatch || nameMatch || progMatch || secMatch);
      });
    }

    return students;
  }

  async voidObligation(
    obligationId: string,
    reason: string,
    actorUserId: string
  ): Promise<void> {
    await OperationPolicyService.assertPermitted('FINANCE_ASSESSMENTS_AND_RULES');
    if (DataModeService.isDirectSupabase()) {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('student_obligations')
        .update({
          status: 'VOID',
          updated_at: now,
        })
        .eq('id', obligationId);
      if (error) {
        throw new Error(`Failed to void obligation on Supabase: ${error.message}`);
      }
      return;
    }
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

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const alloc of params.allocations) {
      if (!alloc.obligationId || !UUID_REGEX.test(alloc.obligationId)) {
        throw new Error(
          `Invalid obligation ID in payment allocations: "${alloc.obligationId}". Obligation IDs must be valid RFC 4122 UUIDs.`
        );
      }
      if (alloc.amountCentavos <= 0) {
        throw new Error('Each allocation amount must be a positive integer in centavos.');
      }
    }

    // Ensure any locally assessed obligations are pushed to server before RPC row-level locking
    try {
      await PushSyncService.pushPendingOperations();
    } catch (pushErr) {
      console.warn('Pre-payment push sync skipped or failed:', pushErr);
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

    if (DataModeService.isDirectSupabase()) {
      return { paymentId: confirmedPaymentId, referenceNumber: confirmedReferenceNumber };
    }

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

    if (DataModeService.isDirectSupabase()) {
      return;
    }

    // Mirror server-confirmed reversal into local SQLite (NO outbox item created)
    await FinanceRepository.recordServerConfirmedReversal(paymentId, reason.trim(), actorUserId);
  }

  async getAllPayments(semesterId?: string): Promise<PaymentItem[]> {
    if (DataModeService.isDirectSupabase()) {
      let query = supabase.from('payments').select('*').order('processed_at', { ascending: false });
      if (semesterId && semesterId !== 'sem_default') {
        query = query.eq('semester_id', semesterId);
      }
      const { data: payments, error } = await query;
      if (error) throw new Error(`Failed to load payments from Supabase: ${error.message}`);

      const payIds = (payments || []).map((p: any) => p.id);
      let allocs: any[] = [];
      if (payIds.length > 0) {
        const { data: allocData } = await supabase.from('payment_allocations').select('*').in('payment_id', payIds);
        allocs = allocData || [];
      }
      const allocsByPayId = new Map<string, any[]>();
      for (const a of allocs) {
        const list = allocsByPayId.get(a.payment_id) || [];
        list.push(a);
        allocsByPayId.set(a.payment_id, list);
      }

      const studentIds = Array.from(new Set((payments || []).map((p: any) => p.student_id).filter(Boolean)));
      const studentMap = new Map<string, any>();
      if (studentIds.length > 0) {
        const { data: stuData } = await supabase.from('students').select('id, school_id, first_name, last_name').in('id', studentIds);
        for (const s of (stuData || [])) studentMap.set(s.id, s);
      }

      return (payments || []).map((p: any) => {
        const s = studentMap.get(p.student_id);
        const pAllocs = allocsByPayId.get(p.id) || [];
        return {
          id: p.id,
          studentId: p.student_id,
          semesterId: p.semester_id,
          referenceNumber: p.reference_number,
          idempotencyKey: p.idempotency_key,
          amountCentavos: Number(p.amount_centavos),
          source: p.source as PaymentMethod,
          channel: p.channel as PaymentChannel,
          status: p.status as 'POSTED' | 'REVERSED',
          processedByUserId: p.processed_by_user_id,
          processedAt: p.processed_at,
          reversedAt: p.reversed_at,
          reversedByUserId: p.reversed_by_user_id,
          reversalReason: p.reversal_reason,
          notes: p.notes,
          studentSchoolId: s?.school_id,
          studentName: s ? `${s.last_name}, ${s.first_name}` : undefined,
          allocations: pAllocs.map((a: any) => ({
            id: a.id,
            paymentId: p.id,
            obligationId: a.obligation_id,
            amountCentavos: Number(a.amount_centavos),
          })),
        };
      });
    }

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

  generateReceiptPdf(receipt: PaymentReceipt): Uint8Array {
    return ReportService.generateReceiptPdf(receipt);
  }

  buildReceiptPdfFilename(referenceNumber?: string): string {
    return ReportService.buildReceiptPdfFilename(referenceNumber);
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
    if (DataModeService.isDirectSupabase()) {
      let semId = semesterId;
      if (!semId || semId === 'sem_default') {
        const { data: activeSem } = await supabase
          .from('semesters')
          .select('id')
          .eq('status', 'ACTIVE')
          .limit(1)
          .maybeSingle();
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

      const obligations = await this.getObligationsBySemester(semId);

      let totalAssessed = 0;
      let totalOutstanding = 0;
      let unpaidFines = 0;
      let unpaidContribs = 0;
      let activeFines = 0;
      let activeContribs = 0;

      for (const ob of obligations) {
        totalAssessed += ob.amountCentavos;
        totalOutstanding += ob.balanceCentavos;

        if (ob.type === 'FINE') {
          activeFines++;
          if (ob.balanceCentavos > 0) unpaidFines++;
        } else {
          activeContribs++;
          if (ob.balanceCentavos > 0) unpaidContribs++;
        }
      }

      const { data: payRows } = await supabase
        .from('payments')
        .select('amount_centavos')
        .eq('semester_id', semId)
        .eq('status', 'POSTED');

      const totalCollected = (payRows || []).reduce(
        (sum: number, p: any) => sum + Number(p.amount_centavos || 0),
        0
      );

      const summary: FinanceSummary = {
        totalOutstandingCentavos: Math.max(0, totalOutstanding),
        totalPaymentsCollectedCentavos: totalCollected,
        totalAssessedCentavos: totalAssessed,
        unpaidFinesCount: unpaidFines,
        unpaidContributionsCount: unpaidContribs,
        activeFinesCount: activeFines,
        activeContributionsCount: activeContribs,
        totalSimulatedWalletCreditsCentavos: 0,
        unpaidChargesCount: unpaidFines + unpaidContribs,
        activeWalletsCount: 0,
      };

      logDataSource({
        page: 'FinanceService',
        source: 'Supabase',
        operation: 'SELECT finance_summary',
        result: obligations.length,
      });

      return summary;
    }

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
      course: r.course,
      program: r.program || r.course,
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

  // ============================================================================
  // DEVADMIN DELETION & SAFE ARCHIVING
  // ============================================================================

  async deleteContributionCollection(col: ContributionCollectionItem): Promise<void> {
    await OperationPolicyService.assertPermitted('FINANCE_ASSESSMENTS_AND_RULES');

    const ruleId = col.ruleId && !col.ruleId.startsWith('legacy_')
      ? col.ruleId
      : (col.id && !col.id.startsWith('legacy_') ? col.id : undefined);

    if (DataModeService.isDirectSupabase()) {
      // 1. Identify all student obligations for this collection
      let obQuery = supabase.from('student_obligations').select('id');
      if (ruleId) {
        obQuery = obQuery.eq('rule_id', ruleId);
      } else {
        obQuery = obQuery.eq('title', col.name).eq('semester_id', col.semesterId).is('rule_id', null);
      }

      const { data: obligations, error: obFetchErr } = await obQuery;
      if (obFetchErr) {
        throw new Error(`Failed to check student obligations: ${obFetchErr.message}`);
      }

      const obIds = (obligations || []).map((o: any) => o.id);

      // 2. Check if ANY payment allocations exist for these obligations
      if (obIds.length > 0) {
        const { data: allocs, error: allocErr } = await supabase
          .from('payment_allocations')
          .select('id')
          .in('obligation_id', obIds)
          .limit(1);

        if (allocErr) {
          throw new Error(`Failed to check payments: ${allocErr.message}`);
        }

        if (allocs && allocs.length > 0) {
          throw new Error('Cannot delete contribution collection because payments have already been collected for it. Archive or deactivate instead.');
        }

        // 3. Delete student obligations (ensures child cleanup even if DB FK is ON DELETE SET NULL)
        const { error: delObErr } = await supabase
          .from('student_obligations')
          .delete()
          .in('id', obIds);

        if (delObErr) {
          throw new Error(`Failed to delete student obligations: ${delObErr.message}`);
        }
      }

      // 4. Delete the parent obligation rule if ruleId exists
      if (ruleId) {
        const { error: delRuleErr } = await supabase
          .from('obligation_rules')
          .delete()
          .eq('id', ruleId);

        if (delRuleErr) {
          throw new Error(delRuleErr.message || 'Cannot delete contribution collection because payments have already been collected for it. Archive or deactivate instead.');
        }
      }

      return;
    }

    // Offline-First / SQLite Mode
    const db = await getDatabase();
    if (ruleId) {
      const payments = await db.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM payment_allocations pa 
         JOIN student_obligations so ON so.id = pa.obligation_id 
         WHERE so.rule_id = ?`,
        [ruleId]
      );
      if ((payments[0]?.count || 0) > 0) {
        throw new Error('Cannot delete contribution collection because payments have already been collected for it. Archive or deactivate instead.');
      }
      await db.transaction(async (tx) => {
        await tx.execute('DELETE FROM student_obligations WHERE rule_id = ?', [ruleId]);
        await tx.execute('DELETE FROM obligation_rules WHERE id = ?', [ruleId]);
      });
      return;
    }

    // SQLite legacy unlinked collection
    const rows = await db.query<{ id: string }>(
      'SELECT id FROM student_obligations WHERE title = ? AND semester_id = ? AND rule_id IS NULL',
      [col.name, col.semesterId]
    );
    const obIds = rows.map((r) => r.id);
    if (obIds.length > 0) {
      const placeholders = obIds.map(() => '?').join(',');
      const payments = await db.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM payment_allocations WHERE obligation_id IN (${placeholders})`,
        obIds
      );
      if ((payments[0]?.count || 0) > 0) {
        throw new Error('Cannot delete contribution collection because payments have already been collected for it. Archive or deactivate instead.');
      }
      await db.execute(`DELETE FROM student_obligations WHERE id IN (${placeholders})`, obIds);
    }
  }

  async deleteObligationRule(ruleId: string): Promise<void> {
    await OperationPolicyService.assertPermitted('FINANCE_ASSESSMENTS_AND_RULES');
    if (DataModeService.isDirectSupabase()) {
      const { error } = await supabase.from('obligation_rules').delete().eq('id', ruleId);
      if (error) {
        throw new Error(error.message || 'Cannot delete contribution collection because payments have already been collected for it. Archive or deactivate instead.');
      }
      return;
    }
    const db = await getDatabase();
    const payments = await db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM payment_allocations pa 
       JOIN student_obligations so ON so.id = pa.obligation_id 
       WHERE so.rule_id = ?`,
      [ruleId]
    );
    if ((payments[0]?.count || 0) > 0) {
      throw new Error('Cannot delete contribution collection because payments have already been collected for it. Archive or deactivate instead.');
    }
    await db.transaction(async (tx) => {
      await tx.execute('DELETE FROM student_obligations WHERE rule_id = ?', [ruleId]);
      await tx.execute('DELETE FROM obligation_rules WHERE id = ?', [ruleId]);
    });
  }

  async deactivateObligationRule(ruleId: string): Promise<void> {
    await OperationPolicyService.assertPermitted('FINANCE_ASSESSMENTS_AND_RULES');
    if (DataModeService.isDirectSupabase()) {
      const { error } = await supabase.from('obligation_rules').update({ status: 'INACTIVE' }).eq('id', ruleId);
      if (error) throw new Error(error.message || 'Failed to deactivate contribution rule.');
      return;
    }
    const db = await getDatabase();
    await db.execute('UPDATE obligation_rules SET status = "INACTIVE" WHERE id = ?', [ruleId]);
  }

  async deleteStudentObligation(obligationId: string): Promise<void> {
    await OperationPolicyService.assertPermitted('FINANCE_ASSESSMENTS_AND_RULES');
    if (DataModeService.isDirectSupabase()) {
      const { data: allocs, error: allocErr } = await supabase
        .from('payment_allocations')
        .select('id')
        .eq('obligation_id', obligationId)
        .limit(1);

      if (allocErr) {
        throw new Error(`Failed to check payments: ${allocErr.message}`);
      }

      if (allocs && allocs.length > 0) {
        throw new Error('Cannot delete student obligation because payments have already been allocated to it. Reversal or adjustment is required.');
      }

      const { error } = await supabase.from('student_obligations').delete().eq('id', obligationId);
      if (error) {
        throw new Error(error.message || 'Cannot delete student obligation.');
      }
      return;
    }
    const db = await getDatabase();
    const allocs = await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM payment_allocations WHERE obligation_id = ?',
      [obligationId]
    );
    if ((allocs[0]?.count || 0) > 0) {
      throw new Error('Cannot delete student obligation because payments have already been allocated to it. Reversal or adjustment is required.');
    }
    await db.execute('DELETE FROM student_obligations WHERE id = ?', [obligationId]);
  }
}

export const financeService = new FinanceService();
