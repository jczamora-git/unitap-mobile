import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import { DataModeService } from '@/services/data-mode.service';
import { supabase } from '@/integrations/supabase/client';
import type {
  ObligationRule,
  StudentObligation,
  PaymentRecord,
  SimulatedWalletRecord,
  EventOccurrenceRecord,
  EventRecord,
  SyncOutboxRecord,
} from '../../types/database';
import type {
  AbsenteeCandidate,
  OccurrenceAbsenteeSummary,
  BulkFineAssessmentResult,
  BulkContributionResult,
  StudentObligationItem,
} from '../../types/finance';

export interface StudentObligationWithBalance extends StudentObligation {
  assessed_centavos: number;
  paid_centavos: number;
  balance_centavos: number;
  school_id?: string;
  first_name?: string;
  last_name?: string;
  year_level?: number;
  section?: string;
  course?: string;
  program?: string;
}

export interface PaymentWithAllocations extends PaymentRecord {
  allocations: {
    id: string;
    obligation_id: string;
    amount_centavos: number;
    obligation_title?: string;
    obligation_type?: string;
  }[];
  school_id?: string;
  first_name?: string;
  last_name?: string;
}

export class FinanceRepository {
  private static generateUuid(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Scans local SQLite student_obligations for non-UUID identifiers (e.g. legacy 'ob_...' or 'demo_chg_...')
   * and remaps them to valid RFC 4122 UUIDs, maintaining foreign keys in payment_allocations,
   * obligation_adjustments, and sync_outbox.
   */
  public static async repairLegacyObligationIds(adapter?: DatabaseAdapter): Promise<number> {
    const db = await this.getDb(adapter);
    const nonUuidRows = await db.query<{ id: string }>(
      `SELECT id FROM student_obligations WHERE id NOT LIKE '%-%-%-%-%'`
    );
    if (!nonUuidRows || nonUuidRows.length === 0) return 0;

    let repaired = 0;
    await db.transaction(async (tx) => {
      for (const row of nonUuidRows) {
        const oldId = row.id;
        const newUuid = this.generateUuid();
        const oldRow = await tx.queryOne<StudentObligation>(
          'SELECT * FROM student_obligations WHERE id = ?',
          [oldId]
        );
        if (oldRow) {
          await tx.execute(
            `INSERT INTO student_obligations (
              id, student_id, semester_id, rule_id, related_event_id, related_occurrence_id,
              title, type, amount_centavos, status, due_date, issued_by_user_id, batch_id, issued_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newUuid,
              oldRow.student_id,
              oldRow.semester_id,
              oldRow.rule_id || null,
              oldRow.related_event_id || null,
              oldRow.related_occurrence_id || null,
              oldRow.title,
              oldRow.type,
              oldRow.amount_centavos,
              oldRow.status,
              oldRow.due_date || null,
              oldRow.issued_by_user_id || null,
              oldRow.batch_id || null,
              oldRow.issued_at,
              oldRow.updated_at || new Date().toISOString(),
            ]
          );
          await tx.execute('UPDATE payment_allocations SET obligation_id = ? WHERE obligation_id = ?', [newUuid, oldId]);
          await tx.execute('UPDATE obligation_adjustments SET obligation_id = ? WHERE obligation_id = ?', [newUuid, oldId]);
          await tx.execute(
            `UPDATE sync_outbox SET entity_id = ? WHERE entity_type = 'OBLIGATION' AND entity_id = ?`,
            [newUuid, oldId]
          );
          await tx.execute('DELETE FROM student_obligations WHERE id = ?', [oldId]);
          repaired++;
        }
      }
    });
    return repaired;
  }

  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  private static async ensureDeviceAndActor(
    tx: DatabaseAdapter,
    actorUserId?: string | null,
    timestamp?: string
  ): Promise<{ deviceId: string; validActorId: string | null }> {
    const ts = timestamp || new Date().toISOString();
    await tx.execute(
      `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', ?)`,
      [ts]
    );
    let validActorId: string | null = null;
    if (actorUserId) {
      const user = await tx.queryOne<{ id: string }>('SELECT id FROM users WHERE id = ?', [actorUserId]);
      if (user) {
        validActorId = user.id;
      }
    }
    return { deviceId: 'dev_default', validActorId };
  }

  /**
   * Scans local SQLite obligation_rules, student_obligations, and sync_outbox for legacy
   * 'rule_' prefixed identifiers and safely remaps them to canonical RFC 4122 UUIDs.
   *
   * Verifies collision safety, preserves outbox operation IDs (e.g. 'op_ob_...'),
   * updates dependent foreign keys in student_obligations, audit_events, sync_conflicts,
   * and sync_audit_logs, and requeues any eligible failed outbox operations for retry.
   */
  public static async repairLegacyObligationRuleIds(
    adapter?: DatabaseAdapter
  ): Promise<{
    rulesRepaired: number;
    obligationsRepaired: number;
    outboxRepaired: number;
    requeuedCount: number;
  }> {
    const db = await this.getDb(adapter);
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    let legacyRules: ObligationRule[] = [];
    let legacyObligations: { rule_id: string }[] = [];
    let legacyOutboxRuleOps: SyncOutboxRecord[] = [];
    let legacyOutboxObOps: SyncOutboxRecord[] = [];

    try {
      legacyRules = await db.query<ObligationRule>(
        `SELECT * FROM obligation_rules WHERE id LIKE 'rule_%'`
      );
      legacyObligations = await db.query<{ rule_id: string }>(
        `SELECT DISTINCT rule_id FROM student_obligations WHERE rule_id LIKE 'rule_%'`
      );
      legacyOutboxRuleOps = await db.query<SyncOutboxRecord>(
        `SELECT * FROM sync_outbox WHERE entity_type = 'OBLIGATION_RULE' AND entity_id LIKE 'rule_%'`
      );
      legacyOutboxObOps = await db.query<SyncOutboxRecord>(
        `SELECT * FROM sync_outbox WHERE entity_type IN ('OBLIGATION', 'STUDENT_OBLIGATION') AND payload_json LIKE '%"rule_id":"rule_%'`
      );
    } catch {
      return {
        rulesRepaired: 0,
        obligationsRepaired: 0,
        outboxRepaired: 0,
        requeuedCount: 0,
      };
    }

    const hasLegacyData =
      legacyRules.length > 0 ||
      legacyObligations.length > 0 ||
      legacyOutboxRuleOps.length > 0 ||
      legacyOutboxObOps.length > 0;

    if (!hasLegacyData) {
      let requeuedCount = 0;
      try {
        const failedOps = await db.query<SyncOutboxRecord>(
          `SELECT id FROM sync_outbox WHERE synced_at IS NULL AND last_error LIKE '%invalid input syntax for type uuid%'`
        );
        if (failedOps.length > 0) {
          await db.execute(
            `UPDATE sync_outbox SET retry_count = 0, last_error = NULL WHERE synced_at IS NULL AND last_error LIKE '%invalid input syntax for type uuid%'`
          );
          requeuedCount = failedOps.length;
        }
      } catch {
        // ignore
      }
      return {
        rulesRepaired: 0,
        obligationsRepaired: 0,
        outboxRepaired: 0,
        requeuedCount,
      };
    }

    // Build consistent mapping from legacyId -> canonicalUuid
    const idMap = new Map<string, string>();
    const registerMapping = (legacyId: string) => {
      if (!legacyId || idMap.has(legacyId)) return;
      if (legacyId.startsWith('rule_')) {
        const suffix = legacyId.substring(5);
        if (UUID_REGEX.test(suffix)) {
          idMap.set(legacyId, suffix.toLowerCase());
          return;
        }
      }
      idMap.set(legacyId, this.generateUuid());
    };

    for (const r of legacyRules) registerMapping(r.id);
    for (const o of legacyObligations) if (o.rule_id) registerMapping(o.rule_id);
    for (const op of legacyOutboxRuleOps) registerMapping(op.entity_id);
    for (const op of legacyOutboxObOps) {
      try {
        const parsed = JSON.parse(op.payload_json);
        if (parsed.rule_id && typeof parsed.rule_id === 'string' && parsed.rule_id.startsWith('rule_')) {
          registerMapping(parsed.rule_id);
        }
      } catch {
        // ignore
      }
    }

    let rulesRepaired = 0;
    let obligationsRepaired = 0;
    let outboxRepaired = 0;

    await db.execute('PRAGMA foreign_keys = OFF;');
    try {
      await db.transaction(async (tx) => {
        for (const [legacyId, canonicalId] of idMap.entries()) {
          const existingTarget = await tx.queryOne<{ id: string }>(
            'SELECT id FROM obligation_rules WHERE id = ?',
            [canonicalId]
          );
          const legacyRow = await tx.queryOne<ObligationRule>(
            'SELECT * FROM obligation_rules WHERE id = ?',
            [legacyId]
          );

          if (legacyRow) {
            if (!existingTarget) {
              await tx.execute(
                `INSERT INTO obligation_rules (
                  id, semester_id, name, type, trigger_type, default_amount_centavos, due_on, status, created_by_user_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  canonicalId,
                  legacyRow.semester_id,
                  legacyRow.name,
                  legacyRow.type,
                  legacyRow.trigger_type,
                  legacyRow.default_amount_centavos,
                  legacyRow.due_on || null,
                  legacyRow.status,
                  legacyRow.created_by_user_id || null,
                  legacyRow.created_at,
                  (legacyRow as any).updated_at || legacyRow.created_at || new Date().toISOString(),
                ]
              );
            }
            await tx.execute(
              'UPDATE student_obligations SET rule_id = ? WHERE rule_id = ?',
              [canonicalId, legacyId]
            );
            await tx.execute('DELETE FROM obligation_rules WHERE id = ?', [legacyId]);
            rulesRepaired++;
          } else {
            await tx.execute(
              'UPDATE student_obligations SET rule_id = ? WHERE rule_id = ?',
              [canonicalId, legacyId]
            );
          }

          const obCountRow = await tx.queryOne<{ count: number }>(
            'SELECT COUNT(*) as count FROM student_obligations WHERE rule_id = ?',
            [canonicalId]
          );
          obligationsRepaired += obCountRow?.count || 0;

          // Update sync_outbox (PRESERVING outbox operation IDs!)
          const ruleOps = await tx.query<SyncOutboxRecord>(
            `SELECT * FROM sync_outbox WHERE entity_type = 'OBLIGATION_RULE' AND (entity_id = ? OR payload_json LIKE ?)`,
            [legacyId, `%"id":"${legacyId}"%`]
          );
          for (const op of ruleOps) {
            let updatedPayloadStr = op.payload_json;
            try {
              const p = JSON.parse(op.payload_json);
              p.id = canonicalId;
              updatedPayloadStr = JSON.stringify(p);
            } catch {
              // ignore
            }
            await tx.execute(
              `UPDATE sync_outbox
               SET entity_id = ?, payload_json = ?, retry_count = 0, last_error = NULL
               WHERE id = ?`,
              [canonicalId, updatedPayloadStr, op.id]
            );
            outboxRepaired++;
          }

          const obOps = await tx.query<SyncOutboxRecord>(
            `SELECT * FROM sync_outbox
             WHERE entity_type IN ('OBLIGATION', 'STUDENT_OBLIGATION')
               AND payload_json LIKE ?`,
            [`%"rule_id":"${legacyId}"%`]
          );
          for (const op of obOps) {
            let updatedPayloadStr = op.payload_json;
            try {
              const p = JSON.parse(op.payload_json);
              if (p.rule_id === legacyId) {
                p.rule_id = canonicalId;
                updatedPayloadStr = JSON.stringify(p);
              }
            } catch {
              // ignore
            }
            await tx.execute(
              `UPDATE sync_outbox
               SET payload_json = ?, retry_count = 0, last_error = NULL
               WHERE id = ?`,
              [updatedPayloadStr, op.id]
            );
            outboxRepaired++;
          }

          try {
            await tx.execute(
              `UPDATE audit_events SET entity_id = ? WHERE entity_type = 'OBLIGATION_RULE' AND entity_id = ?`,
              [canonicalId, legacyId]
            );
            await tx.execute(
              `UPDATE sync_conflicts SET entity_id = ? WHERE entity_type = 'OBLIGATION_RULE' AND entity_id = ?`,
              [canonicalId, legacyId]
            );
            await tx.execute(
              `UPDATE sync_audit_logs SET record_id = ? WHERE entity = 'obligation_rules' AND record_id = ?`,
              [canonicalId, legacyId]
            );
          } catch {
            // ignore
          }
        }

        // Requeue any operations that failed due to the batch UUID syntax rejection
        await tx.execute(
          `UPDATE sync_outbox
           SET retry_count = 0, last_error = NULL
           WHERE synced_at IS NULL AND last_error LIKE '%invalid input syntax for type uuid%'`
        );
      });
    } finally {
      await db.execute('PRAGMA foreign_keys = ON;');
    }

    let requeuedCount = 0;
    try {
      const requeuedRow = await db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM sync_outbox WHERE synced_at IS NULL AND retry_count = 0`
      );
      requeuedCount = requeuedRow?.count || 0;
    } catch {
      // ignore
    }

    return {
      rulesRepaired,
      obligationsRepaired,
      outboxRepaired,
      requeuedCount,
    };
  }

  // ==========================================================================
  // --- 1. OBLIGATION RULES ---
  // ==========================================================================

  public static async createRule(rule: ObligationRule, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    const { deviceId, validActorId } = await this.ensureDeviceAndActor(db, rule.created_by_user_id, rule.created_at);

    let ruleId = rule.id;
    if (ruleId && ruleId.startsWith('rule_')) {
      const suffix = ruleId.substring(5);
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (UUID_REGEX.test(suffix)) {
        ruleId = suffix.toLowerCase();
      }
    }

    await db.execute(
      `INSERT INTO obligation_rules (
        id, semester_id, name, type, trigger_type, default_amount_centavos, due_on, status, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ruleId,
        rule.semester_id,
        rule.name,
        rule.type,
        rule.trigger_type,
        rule.default_amount_centavos,
        rule.due_on || null,
        rule.status,
        validActorId,
        rule.created_at,
      ]
    );

    // Queue sync outbox
    const outboxId = 'op_rule_' + Math.random().toString(36).substring(2, 10);
    const queuedRule = { ...rule, id: ruleId };
    await db.execute(
      `INSERT INTO sync_outbox (
        id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
      ) VALUES (?, ?, 'OBLIGATION_RULE', ?, 'CREATE', ?, 1, ?, 0)`,
      [outboxId, deviceId, ruleId, JSON.stringify(queuedRule), rule.created_at]
    );
  }

  public static async getRulesBySemester(semesterId: string, adapter?: DatabaseAdapter): Promise<ObligationRule[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('obligation_rules')
        .select('*')
        .eq('semester_id', semesterId)
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false });
      if (error) throw new Error(`Failed to query rules from Supabase: ${error.message}`);
      return (data || []) as ObligationRule[];
    }

    const db = await this.getDb(adapter);
    return db.query<ObligationRule>(
      'SELECT * FROM obligation_rules WHERE semester_id = ? AND status = ? ORDER BY created_at DESC',
      [semesterId, 'ACTIVE']
    );
  }

  public static async getActiveRules(semesterId?: string, adapter?: DatabaseAdapter): Promise<ObligationRule[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      let query = supabase.from('obligation_rules').select('*').eq('status', 'ACTIVE').order('created_at', { ascending: false });
      if (semesterId) query = query.eq('semester_id', semesterId);
      const { data, error } = await query;
      if (error) throw new Error(`Failed to query active rules from Supabase: ${error.message}`);
      return (data || []) as ObligationRule[];
    }

    const db = await this.getDb(adapter);
    if (semesterId) {
      return db.query<ObligationRule>(
        'SELECT * FROM obligation_rules WHERE semester_id = ? AND status = ? ORDER BY created_at DESC',
        [semesterId, 'ACTIVE']
      );
    }
    return db.query<ObligationRule>(
      'SELECT * FROM obligation_rules WHERE status = ? ORDER BY created_at DESC',
      ['ACTIVE']
    );
  }

  public static async getRuleById(ruleId: string, adapter?: DatabaseAdapter): Promise<ObligationRule | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<ObligationRule>('SELECT * FROM obligation_rules WHERE id = ?', [ruleId]);
  }

  // ==========================================================================
  // --- 2. STUDENT OBLIGATIONS (ASSESSMENT & QUERY) ---
  // ==========================================================================

  public static async assessObligation(
    obligation: StudentObligation,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    if (obligation.amount_centavos < 0 || !Number.isInteger(obligation.amount_centavos)) {
      throw new Error('Obligation amount must be a non-negative integer in centavos.');
    }
    const db = await this.getDb(adapter);

    await db.transaction(async (tx) => {
      const { deviceId, validActorId } = await this.ensureDeviceAndActor(tx, obligation.issued_by_user_id, obligation.issued_at);

      await tx.execute(
        `INSERT INTO student_obligations (
          id, student_id, semester_id, rule_id, related_event_id, related_occurrence_id,
          title, type, amount_centavos, status, due_date, issued_by_user_id, batch_id, issued_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          obligation.id,
          obligation.student_id,
          obligation.semester_id,
          obligation.rule_id || null,
          obligation.related_event_id || null,
          obligation.related_occurrence_id || null,
          obligation.title,
          obligation.type,
          obligation.amount_centavos,
          obligation.status,
          obligation.due_date || null,
          validActorId,
          obligation.batch_id || null,
          obligation.issued_at || new Date().toISOString(),
          obligation.updated_at || obligation.issued_at || new Date().toISOString(),
        ]
      );

      // Audit event
      const auditId = 'aud_ob_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO audit_events (id, actor_user_id, device_id, entity_type, entity_id, action, details_json, occurred_at)
         VALUES (?, ?, ?, 'STUDENT_OBLIGATION', ?, 'ASSESS', ?, ?)`,
        [
          auditId,
          validActorId,
          deviceId,
          obligation.id,
          JSON.stringify({ type: obligation.type, amount: obligation.amount_centavos, title: obligation.title }),
          obligation.issued_at,
        ]
      );

      // Outbox write
      const outboxId = 'op_ob_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO sync_outbox (
          id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
        ) VALUES (?, ?, 'OBLIGATION', ?, 'CREATE', ?, 1, ?, 0)`,
        [outboxId, deviceId, obligation.id, JSON.stringify(obligation), obligation.issued_at]
      );
    });
  }

  public static async getStudentObligations(
    studentId: string,
    semesterId?: string,
    adapter?: DatabaseAdapter
  ): Promise<StudentObligationWithBalance[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      let query = supabase.from('student_obligations').select('*').eq('student_id', studentId).neq('status', 'VOID');
      if (semesterId) query = query.eq('semester_id', semesterId);
      const { data: obs, error } = await query.order('issued_at', { ascending: false });
      if (error) throw new Error(`Failed to query student obligations from Supabase: ${error.message}`);

      const obIds = (obs || []).map((o: any) => o.id);
      let allocs: any[] = [];
      const postedPayIds = new Set<string>();

      if (obIds.length > 0) {
        const { data: allocData } = await supabase.from('payment_allocations').select('*').in('obligation_id', obIds);
        allocs = allocData || [];
        const payIds = Array.from(new Set(allocs.map((a: any) => a.payment_id).filter(Boolean)));
        if (payIds.length > 0) {
          const { data: payData } = await supabase.from('payments').select('id, status').in('id', payIds).eq('status', 'POSTED');
          for (const p of payData || []) postedPayIds.add(p.id);
        }
      }

      const paidByObId = new Map<string, number>();
      for (const a of allocs) {
        if (postedPayIds.has(a.payment_id)) {
          paidByObId.set(a.obligation_id, (paidByObId.get(a.obligation_id) || 0) + Number(a.amount_centavos || 0));
        }
      }

      const { data: student } = await supabase.from('students').select('*').eq('id', studentId).maybeSingle();
      const { data: enrollment } = semesterId
        ? await supabase.from('student_enrollments').select('*').eq('student_id', studentId).eq('semester_id', semesterId).maybeSingle()
        : { data: null };

      return (obs || []).map((o: any) => {
        const assessed = Number(o.amount_centavos || 0);
        const paid = paidByObId.get(o.id) || 0;
        const balance = Math.max(0, assessed - paid);
        return {
          ...o,
          assessed_centavos: assessed,
          paid_centavos: paid,
          balance_centavos: balance,
          school_id: student?.school_id,
          first_name: student?.first_name,
          last_name: student?.last_name,
          year_level: enrollment?.year_level || 1,
          section: enrollment?.section || '1A',
        };
      });
    }

    const db = await this.getDb(adapter);
    let sql = `
      WITH adjustment_totals AS (
        SELECT obligation_id,
               SUM(CASE WHEN kind='ADDITION' THEN amount_centavos ELSE -amount_centavos END) AS change_centavos
        FROM obligation_adjustments GROUP BY obligation_id
      ),
      paid_totals AS (
        SELECT pa.obligation_id, SUM(pa.amount_centavos) AS paid_centavos
        FROM payment_allocations pa
        JOIN payments p ON p.id = pa.payment_id
        WHERE p.status = 'POSTED'
        GROUP BY pa.obligation_id
      )
      SELECT o.*,
             s.school_id, s.first_name, s.last_name,
             se.year_level, se.section,
             o.amount_centavos + COALESCE(a.change_centavos, 0) AS assessed_centavos,
             COALESCE(p.paid_centavos, 0) AS paid_centavos,
             MAX(0, (o.amount_centavos + COALESCE(a.change_centavos, 0)) - COALESCE(p.paid_centavos, 0)) AS balance_centavos
      FROM student_obligations o
      JOIN students s ON s.id = o.student_id
      LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.semester_id = o.semester_id
      LEFT JOIN adjustment_totals a ON a.obligation_id = o.id
      LEFT JOIN paid_totals p ON p.obligation_id = o.id
      WHERE o.student_id = ? AND o.status = 'ACTIVE'
    `;
    const params: unknown[] = [studentId];
    if (semesterId) {
      sql += ' AND o.semester_id = ?';
      params.push(semesterId);
    }
    sql += ' ORDER BY o.issued_at DESC';

    return db.query<StudentObligationWithBalance>(sql, params);
  }

  public static async getObligationsBySemester(
    semesterId: string,
    type?: 'FINE' | 'CONTRIBUTION',
    adapter?: DatabaseAdapter
  ): Promise<StudentObligationWithBalance[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      let query = supabase.from('student_obligations').select('*').eq('semester_id', semesterId).neq('status', 'VOID');
      if (type) query = query.eq('type', type);
      const { data: obs, error } = await query;
      if (error) throw new Error(`Failed to query obligations by semester from Supabase: ${error.message}`);

      const obIds = (obs || []).map((o: any) => o.id);
      let allocs: any[] = [];
      const postedPayIds = new Set<string>();

      if (obIds.length > 0) {
        const { data: allocData } = await supabase.from('payment_allocations').select('*').in('obligation_id', obIds);
        allocs = allocData || [];
        const payIds = Array.from(new Set(allocs.map((a: any) => a.payment_id).filter(Boolean)));
        if (payIds.length > 0) {
          const { data: payData } = await supabase.from('payments').select('id, status').in('id', payIds).eq('status', 'POSTED');
          for (const p of payData || []) postedPayIds.add(p.id);
        }
      }

      const paidByObId = new Map<string, number>();
      for (const a of allocs) {
        if (postedPayIds.has(a.payment_id)) {
          paidByObId.set(a.obligation_id, (paidByObId.get(a.obligation_id) || 0) + Number(a.amount_centavos || 0));
        }
      }

      const studentIds = Array.from(new Set((obs || []).map((o: any) => o.student_id).filter(Boolean)));
      const [studentsRes, enrollmentsRes, programsRes] = await Promise.all([
        studentIds.length > 0 ? supabase.from('students').select('*').in('id', studentIds) : Promise.resolve({ data: [] }),
        studentIds.length > 0 ? supabase.from('student_enrollments').select('*').in('student_id', studentIds) : Promise.resolve({ data: [] }),
        supabase.from('programs').select('id, code, name'),
      ]);

      const programsMap = new Map<string, string>();
      for (const p of (programsRes.data || [])) {
        if (p.id) programsMap.set(p.id, p.code);
      }

      const stuMap = new Map<string, any>();
      for (const s of (studentsRes.data || [])) stuMap.set(s.id, s);
      const enrMap = new Map<string, any>();
      for (const e of (enrollmentsRes.data || [])) {
        const existing = enrMap.get(e.student_id);
        if (!existing || e.semester_id === semesterId || e.enrollment_status === 'ENROLLED') {
          enrMap.set(e.student_id, e);
        }
      }

      return (obs || []).map((o: any) => {
        const assessed = Number(o.amount_centavos || 0);
        const paid = paidByObId.get(o.id) || 0;
        const balance = Math.max(0, assessed - paid);
        const s = stuMap.get(o.student_id);
        const enr = enrMap.get(o.student_id);
        const progCode = enr?.program_id ? programsMap.get(enr.program_id) : (enr?.course || 'BSIT');

        return {
          ...o,
          assessed_centavos: assessed,
          paid_centavos: paid,
          balance_centavos: balance,
          school_id: s?.school_id,
          first_name: s?.first_name,
          last_name: s?.last_name,
          year_level: enr?.year_level,
          section: enr?.section,
          course: progCode,
          program: progCode,
        };
      });
    }

    const db = await this.getDb(adapter);
    let sql = `
      WITH adjustment_totals AS (
        SELECT obligation_id,
               SUM(CASE WHEN kind='ADDITION' THEN amount_centavos ELSE -amount_centavos END) AS change_centavos
        FROM obligation_adjustments GROUP BY obligation_id
      ),
      paid_totals AS (
        SELECT pa.obligation_id, SUM(pa.amount_centavos) AS paid_centavos
        FROM payment_allocations pa
        JOIN payments p ON p.id = pa.payment_id
        WHERE p.status = 'POSTED'
        GROUP BY pa.obligation_id
      )
      SELECT o.*,
             s.school_id, s.first_name, s.last_name,
             se.year_level, se.section,
             o.amount_centavos + COALESCE(a.change_centavos, 0) AS assessed_centavos,
             COALESCE(p.paid_centavos, 0) AS paid_centavos,
             MAX(0, (o.amount_centavos + COALESCE(a.change_centavos, 0)) - COALESCE(p.paid_centavos, 0)) AS balance_centavos
      FROM student_obligations o
      JOIN students s ON s.id = o.student_id
      LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.semester_id = o.semester_id
      LEFT JOIN adjustment_totals a ON a.obligation_id = o.id
      LEFT JOIN paid_totals p ON p.obligation_id = o.id
      WHERE o.semester_id = ?
    `;
    const params: unknown[] = [semesterId];
    if (type) {
      sql += ' AND o.type = ?';
      params.push(type);
    }
    sql += ' ORDER BY o.issued_at DESC';

    return db.query<StudentObligationWithBalance>(sql, params);
  }

  /**
   * Retrieves unique student IDs that have outstanding (unpaid or partially paid)
   * balances for a given category ('ALL' | 'CONTRIBUTION' | 'FINE') or specific template ruleId.
   * Completely excludes VOID and fully-settled obligations.
   */
  public static async getStudentIdsWithOutstandingBalance(
    filter: {
      category?: 'ALL' | 'CONTRIBUTION' | 'FINE';
      ruleId?: string;
      semesterId?: string;
    },
    adapter?: DatabaseAdapter
  ): Promise<string[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      let query = supabase
        .from('student_obligations')
        .select('id, student_id, amount_centavos, status, type, rule_id')
        .neq('status', 'VOID');

      if (filter.ruleId) {
        query = query.eq('rule_id', filter.ruleId);
      } else if (filter.category === 'CONTRIBUTION') {
        query = query.eq('type', 'CONTRIBUTION');
      } else if (filter.category === 'FINE') {
        query = query.eq('type', 'FINE');
      }

      if (filter.semesterId && filter.semesterId !== 'sem_default') {
        query = query.eq('semester_id', filter.semesterId);
      }

      const { data: obs, error: obsErr } = await query;
      if (obsErr) {
        throw new Error(`Failed to query student obligations for payment filtering: ${obsErr.message}`);
      }

      if (!obs || obs.length === 0) {
        return [];
      }

      const obIds = obs.map((o: any) => o.id);

      // Batched lookup: 1) obligation_adjustments, 2) payment_allocations
      const [adjRes, allocRes] = await Promise.all([
        supabase
          .from('obligation_adjustments')
          .select('obligation_id, adjustment_type, amount_centavos')
          .in('obligation_id', obIds),
        supabase
          .from('payment_allocations')
          .select('obligation_id, amount_centavos, payment_id')
          .in('obligation_id', obIds),
      ]);

      if (adjRes.error) {
        throw new Error(`Failed to query obligation adjustments: ${adjRes.error.message}`);
      }
      if (allocRes.error) {
        throw new Error(`Failed to query payment allocations: ${allocRes.error.message}`);
      }

      // Aggregate adjustments per obligation (ADDITION vs DEDUCTION)
      const adjustmentsByObId = new Map<string, number>();
      for (const adj of adjRes.data || []) {
        const amt = Math.abs(Number(adj.amount_centavos || 0));
        const rawType = String(adj.adjustment_type || (adj as any).kind || '').toUpperCase();
        // Additions increase the obligation balance
        // Deductions/waivers/discounts decrease the obligation balance
        const isAddition = ['ADDITION', 'CHARGE', 'PENALTY', 'ADDITIONAL_CHARGE'].includes(rawType);
        const isDeduction = ['DISCOUNT', 'WAIVE', 'WAIVER', 'REDUCTION', 'DEDUCTION'].includes(rawType);
        const change = isAddition ? amt : isDeduction ? -amt : 0;
        adjustmentsByObId.set(
          adj.obligation_id,
          (adjustmentsByObId.get(adj.obligation_id) || 0) + change
        );
      }

      const allocs = allocRes.data || [];
      const payIds = Array.from(new Set(allocs.map((a: any) => a.payment_id).filter(Boolean)));
      const postedPaymentIds = new Set<string>();

      if (payIds.length > 0) {
        const { data: payData, error: payErr } = await supabase
          .from('payments')
          .select('id, status')
          .in('id', payIds)
          .eq('status', 'POSTED');

        if (payErr) {
          throw new Error(`Failed to query payments: ${payErr.message}`);
        }

        for (const p of payData || []) {
          postedPaymentIds.add(p.id);
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

      // Evaluate remaining balance using the same business rules as Offline-First SQLite:
      // (amount_centavos + adjustments) > posted_paid_centavos
      const owingStudentIds = new Set<string>();
      for (const o of obs) {
        if (o.status === 'PAID' || o.status === 'VOID' || o.status === 'WAIVED') continue;
        const assessed = Number(o.amount_centavos || 0);
        const adj = adjustmentsByObId.get(o.id) || 0;
        const netAssessed = assessed + adj;
        const paid = paidByObId.get(o.id) || 0;
        const remainingBalance = netAssessed - paid;
        if (remainingBalance > 0 && o.student_id) {
          owingStudentIds.add(o.student_id);
        }
      }

      return Array.from(owingStudentIds);
    }

    // Offline / SQLite mode
    const db = await this.getDb(adapter);
    let sql = `
      WITH adjustment_totals AS (
        SELECT obligation_id,
               SUM(CASE WHEN kind='ADDITION' THEN amount_centavos ELSE -amount_centavos END) AS change_centavos
        FROM obligation_adjustments GROUP BY obligation_id
      ),
      paid_totals AS (
        SELECT pa.obligation_id, SUM(pa.amount_centavos) AS paid_centavos
        FROM payment_allocations pa
        JOIN payments p ON p.id = pa.payment_id
        WHERE p.status = 'POSTED'
        GROUP BY pa.obligation_id
      )
      SELECT DISTINCT o.student_id
      FROM student_obligations o
      LEFT JOIN adjustment_totals a ON a.obligation_id = o.id
      LEFT JOIN paid_totals p ON p.obligation_id = o.id
      WHERE o.status != 'VOID' AND o.status != 'PAID'
        AND (o.amount_centavos + COALESCE(a.change_centavos, 0)) > COALESCE(p.paid_centavos, 0)
    `;
    const params: unknown[] = [];
    if (filter.ruleId) {
      sql += ' AND o.rule_id = ?';
      params.push(filter.ruleId);
    } else if (filter.category === 'CONTRIBUTION') {
      sql += ' AND o.type = ?';
      params.push('CONTRIBUTION');
    } else if (filter.category === 'FINE') {
      sql += ' AND o.type = ?';
      params.push('FINE');
    }

    if (filter.semesterId && filter.semesterId !== 'sem_default') {
      sql += ' AND o.semester_id = ?';
      params.push(filter.semesterId);
    }

    const rows = await db.query<{ student_id: string }>(sql, params);
    return rows.map((r) => r.student_id);
  }

  public static async voidObligation(
    obligationId: string,
    reason: string,
    actorUserId: string,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    if (!reason || !reason.trim()) {
      throw new Error('Reason is required to void an obligation.');
    }
    const db = await this.getDb(adapter);
    await db.transaction(async (tx) => {
      const existing = await tx.queryOne<StudentObligation>(
        'SELECT * FROM student_obligations WHERE id = ?',
        [obligationId]
      );
      if (!existing) {
        throw new Error('Obligation not found.');
      }
      if (existing.status === 'VOID') {
        throw new Error('Obligation is already void.');
      }

      const now = new Date().toISOString();
      const { deviceId, validActorId } = await this.ensureDeviceAndActor(tx, actorUserId, now);

      await tx.execute(
        `UPDATE student_obligations
         SET status = 'VOID', voided_at = ?, void_reason = ?, updated_at = ?
         WHERE id = ?`,
        [now, reason.trim(), now, obligationId]
      );

      // Audit event
      const auditId = 'aud_void_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO audit_events (id, actor_user_id, device_id, entity_type, entity_id, action, details_json, occurred_at)
         VALUES (?, ?, ?, 'STUDENT_OBLIGATION', ?, 'VOID', ?, ?)`,
        [auditId, validActorId, deviceId, obligationId, JSON.stringify({ reason: reason.trim() }), now]
      );

      // Outbox write
      const outboxId = 'op_void_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO sync_outbox (
          id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
        ) VALUES (?, ?, 'OBLIGATION', ?, 'VOID', ?, 1, ?, 0)`,
        [outboxId, deviceId, obligationId, JSON.stringify({ id: obligationId, status: 'VOID', voided_at: now, void_reason: reason.trim() }), now]
      );
    });
  }

  // ==========================================================================
  // --- 3. EVENT-BASED ABSENTEE DETECTION ---
  // ==========================================================================

  /**
   * Ensures the required participant roster exists for an occurrence by snapshotting
   * the eligible enrolled students from student_enrollments for the parent event's semester.
   */
  public static async ensureFinalizedRoster(
    occurrenceId: string,
    adapter?: DatabaseAdapter
  ): Promise<number> {
    const db = await this.getDb(adapter);
    // Check if participants already exist
    const countRow = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM event_participants WHERE occurrence_id = ?',
      [occurrenceId]
    );
    if (countRow && countRow.count > 0) {
      return countRow.count;
    }

    // Resolve occurrence and parent event
    const occ = await db.queryOne<EventOccurrenceRecord>(
      'SELECT * FROM event_occurrences WHERE id = ?',
      [occurrenceId]
    );
    if (!occ) {
      throw new Error(`Occurrence ${occurrenceId} not found.`);
    }

    const event = await db.queryOne<EventRecord>(
      'SELECT * FROM events WHERE id = ?',
      [occ.event_id]
    );
    if (!event) {
      throw new Error(`Parent event ${occ.event_id} not found.`);
    }

    // Query enrollments for that specific semester to preserve historical roster
    const enrollments = await db.query<{
      id: string;
      student_id: string;
      year_level: number;
      section: string;
      status: string;
    }>(
      `SELECT e.id, e.student_id, e.year_level, e.section, s.status
       FROM student_enrollments e
       JOIN students s ON s.id = e.student_id
       WHERE e.semester_id = ? AND s.status = 'ACTIVE'`,
      [event.semester_id]
    );

    let audience: { type?: string; yearLevels?: number[]; sections?: string[] } = {};
    try {
      audience = JSON.parse(event.audience_json || '{}');
    } catch {
      audience = {};
    }

    const filtered = enrollments.filter((enr) => {
      if (event.audience_type === 'YEAR' || audience.type === 'YEAR_LEVEL') {
        const allowed = audience.yearLevels || [];
        return allowed.length === 0 || allowed.includes(enr.year_level);
      }
      if (event.audience_type === 'SECTION' || audience.type === 'SECTION') {
        const allowed = (audience.sections || []).map((s) => s.toLowerCase());
        return allowed.length === 0 || allowed.includes(enr.section.toLowerCase());
      }
      return true; // ALL
    });

    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      for (const enr of filtered) {
        const partId = 'ep_' + Math.random().toString(36).substring(2, 10);
        await tx.execute(
          `INSERT OR IGNORE INTO event_participants (
            id, occurrence_id, student_id, enrollment_id, attendance_required, excused, added_at
          ) VALUES (?, ?, ?, ?, 1, 0, ?)`,
          [partId, occurrenceId, enr.student_id, enr.id, now]
        );
      }
    });

    return filtered.length;
  }

  /**
   * Identifies all eligible absentees for an occurrence.
   *
   * Business Rules:
   * 1. Derives expected students from event audience configuration (all, year, section, program) and semester enrollments.
   * 2. Evaluates attendance across all configured checkpoints.
   * 3. Whole-Event Mode: absence means 0 qualifying attendance scans across required checkpoints (partial attendance is not whole absence).
   * 4. Per-Checkpoint Mode: absence means missing that specific checkpoint.
   * 5. CLOSED sessions remain selectable; open/future checkpoints show provisional status without premature finalization.
   * 6. Checks whether student is already fined for this occurrence and checkpoint/rule to prevent duplicates.
   */
  public static async getAbsenteeCandidates(
    occurrenceId: string,
    ruleId?: string,
    checkpointId?: string,
    adapter?: DatabaseAdapter
  ): Promise<{
    summary: OccurrenceAbsenteeSummary;
    candidates: AbsenteeCandidate[];
  }> {
    const { eventService } = await import('@/services/event.service');

    if (!adapter && DataModeService.isDirectSupabase()) {
      const rawOccId = occurrenceId.startsWith('occ_') ? occurrenceId.replace(/^occ_/, '') : occurrenceId;

      const { data: occ, error: occErr } = await supabase
        .from('event_occurrences')
        .select('*')
        .eq('id', rawOccId)
        .maybeSingle();

      if (occErr || !occ) {
        throw new Error(`Occurrence ${occurrenceId} not found on Supabase.`);
      }

      const { data: event, error: evtErr } = await supabase
        .from('events')
        .select('*')
        .eq('id', occ.event_id)
        .maybeSingle();

      if (evtErr || !event) {
        throw new Error(`Parent event not found on Supabase.`);
      }

      const checkpoints = eventService.parseCheckpoints(occ);

      let audienceConfig: any = {};
      try {
        audienceConfig = typeof event.audience_json === 'string'
          ? JSON.parse(event.audience_json)
          : (event.audience_json || {});
      } catch {
        audienceConfig = {};
      }

      // Query semester enrollments joined with students
      const { data: enrollments } = await supabase
        .from('student_enrollments')
        .select('id, student_id, year_level, section, students!inner(id, school_id, first_name, middle_name, last_name, status, program_id)')
        .eq('semester_id', event.semester_id)
        .eq('students.status', 'ACTIVE');

      let expectedStudents: Array<{
        student_id: string;
        school_id: string;
        full_name: string;
        year_level: number;
        section: string;
        excused: boolean;
      }> = [];

      if (enrollments && enrollments.length > 0) {
        const filtered = enrollments.filter((enr: any) => {
          const stu = enr.students;
          if (event.audience_type === 'YEAR' || audienceConfig.type === 'YEAR_LEVEL') {
            const allowed = audienceConfig.yearLevels || [];
            return allowed.length === 0 || allowed.includes(enr.year_level);
          }
          if (event.audience_type === 'SECTION' || audienceConfig.type === 'SECTION') {
            const allowed = (audienceConfig.sections || []).map((s: string) => s.toLowerCase());
            return allowed.length === 0 || allowed.includes(enr.section?.toLowerCase());
          }
          if (event.audience_type === 'PROGRAM' || audienceConfig.type === 'PROGRAM') {
            const allowed = (audienceConfig.programs || audienceConfig.programIds || []).map((p: string) => p.toLowerCase());
            return allowed.length === 0 || allowed.includes(stu?.program_id?.toLowerCase());
          }
          if (audienceConfig.type === 'CUSTOM' && Array.isArray(audienceConfig.studentIds)) {
            return audienceConfig.studentIds.includes(enr.student_id);
          }
          return true;
        });

        expectedStudents = filtered.map((enr: any) => {
          const s = enr.students;
          const mid = s.middle_name ? ` ${s.middle_name}` : '';
          return {
            student_id: s.id,
            school_id: s.school_id,
            full_name: `${s.last_name}, ${s.first_name}${mid}`,
            year_level: enr.year_level || 1,
            section: enr.section || 'N/A',
            excused: false,
          };
        });
      } else {
        const { data: stus } = await supabase.from('students').select('*').eq('status', 'ACTIVE');
        expectedStudents = (stus || []).map((s: any) => {
          const mid = s.middle_name ? ` ${s.middle_name}` : '';
          return {
            student_id: s.id,
            school_id: s.school_id,
            full_name: `${s.last_name}, ${s.first_name}${mid}`,
            year_level: 1,
            section: 'N/A',
            excused: false,
          };
        });
      }

      // Query attendance records for occurrence
      const { data: attendanceData } = await supabase
        .from('attendance_records')
        .select('id, student_id, checkpoint_id, status')
        .eq('occurrence_id', rawOccId);

      const attendanceRecords = attendanceData || [];

      // Query active obligations for occurrence
      const { data: obligationData } = await supabase
        .from('student_obligations')
        .select('id, student_id, rule_id, title, status')
        .eq('related_occurrence_id', rawOccId)
        .eq('status', 'ACTIVE');

      const obligations = obligationData || [];

      // Checkpoint statistics
      const checkpointStats = checkpoints.map((cp) => {
        const attended = expectedStudents.filter((s) => {
          return attendanceRecords.some(
            (ar) => ar.student_id === s.student_id && ar.checkpoint_id === cp.id && ['PRESENT', 'LATE', 'EXCUSED'].includes(ar.status)
          );
        }).length;

        let status: 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'CANCELLED' = occ.status as any;
        return {
          checkpointId: cp.id,
          label: cp.label,
          type: cp.type,
          status,
          attendedCount: attended,
          missingCount: Math.max(0, expectedStudents.length - attended),
        };
      });

      let presentCount = 0;
      let lateCount = 0;
      let excusedCount = 0;
      for (const ar of attendanceRecords) {
        if (ar.status === 'PRESENT') presentCount++;
        else if (ar.status === 'LATE') lateCount++;
        else if (ar.status === 'EXCUSED') excusedCount++;
      }

      const targetCp = checkpointId ? checkpoints.find((c) => c.id === checkpointId) : null;
      const candidates: AbsenteeCandidate[] = [];

      for (const stu of expectedStudents) {
        const stuAtts = attendanceRecords.filter((ar) => ar.student_id === stu.student_id && ['PRESENT', 'LATE', 'EXCUSED'].includes(ar.status));
        const attendedCpIds = stuAtts.map((ar) => ar.checkpoint_id);
        const missedCps = checkpoints.filter((cp) => !attendedCpIds.includes(cp.id)).map((cp) => cp.label);

        if (targetCp) {
          if (attendedCpIds.includes(targetCp.id)) continue;

          const alreadyFined = obligations.some((o) => {
            if (o.student_id !== stu.student_id) return false;
            return o.title?.toLowerCase().includes(targetCp.label.toLowerCase()) ||
                   o.title?.includes(targetCp.id) ||
                   (ruleId && o.rule_id === ruleId);
          });

          candidates.push({
            studentId: stu.student_id,
            schoolId: stu.school_id,
            fullName: stu.full_name,
            yearLevel: stu.year_level,
            section: stu.section,
            occurrenceId,
            attendanceRequired: true,
            excused: stu.excused,
            alreadyFined,
            selected: !alreadyFined,
            attendanceStatus: 'ABSENT',
            missedCheckpoints: missedCps,
            attendedCheckpoints: attendedCpIds,
          });
        } else {
          // Whole-Event: 0 qualifying attendance records across all checkpoints
          if (stuAtts.length > 0) continue;

          const alreadyFined = obligations.some((o) => {
            if (o.student_id !== stu.student_id) return false;
            return (!ruleId || o.rule_id === ruleId);
          });

          candidates.push({
            studentId: stu.student_id,
            schoolId: stu.school_id,
            fullName: stu.full_name,
            yearLevel: stu.year_level,
            section: stu.section,
            occurrenceId,
            attendanceRequired: true,
            excused: stu.excused,
            alreadyFined,
            selected: !alreadyFined,
            attendanceStatus: 'ABSENT',
            missedCheckpoints: missedCps,
            attendedCheckpoints: [],
          });
        }
      }

      const alreadyFinedCount = candidates.filter((c) => c.alreadyFined).length;
      const eligibleForFineCount = candidates.filter((c) => !c.alreadyFined).length;

      const summary: OccurrenceAbsenteeSummary = {
        occurrenceId,
        occurrenceTitle: occ.title,
        eventTitle: event.title,
        occursOn: occ.occurs_on,
        sessionStatus: occ.status,
        totalRequired: expectedStudents.length,
        presentCount,
        lateCount,
        excusedCount,
        absentCount: candidates.length,
        alreadyFinedCount,
        eligibleForFineCount,
        isAuthoritativeRosterFinalized: expectedStudents.length > 0,
        checkpoints: checkpointStats,
        activeMode: targetCp ? 'PER_CHECKPOINT' : 'WHOLE_EVENT',
        selectedCheckpointId: targetCp ? targetCp.id : null,
      };

      return { summary, candidates };
    }

    // --- SQLite Engine Branch ---
    const db = await this.getDb(adapter);

    const occ = await db.queryOne<EventOccurrenceRecord & { event_title: string; semester_id: string; audience_type: string; audience_json?: string }>(
      `SELECT o.*, e.title as event_title, e.semester_id, e.audience_type, e.audience_json
       FROM event_occurrences o
       JOIN events e ON e.id = o.event_id
       WHERE o.id = ?`,
      [occurrenceId]
    );
    if (!occ) {
      throw new Error(`Occurrence ${occurrenceId} not found.`);
    }

    const checkpoints = eventService.parseCheckpoints(occ);

    // Check if event_participants has records for this occurrence
    const participants = await db.query<{
      student_id: string;
      school_id: string;
      full_name: string;
      year_level: number;
      section: string;
      attendance_required: number;
      excused: number;
    }>(
      `SELECT ep.student_id, s.school_id,
              (s.last_name || ', ' || s.first_name || (CASE WHEN s.middle_name IS NOT NULL AND length(trim(s.middle_name)) > 0 THEN ' ' || s.middle_name ELSE '' END)) AS full_name,
              COALESCE(se.year_level, 1) AS year_level,
              COALESCE(se.section, 'N/A') AS section,
              ep.attendance_required,
              ep.excused
       FROM event_participants ep
       JOIN students s ON s.id = ep.student_id
       LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.semester_id = ?
       WHERE ep.occurrence_id = ?`,
      [occ.semester_id, occurrenceId]
    );

    let expectedStudents: Array<{
      student_id: string;
      school_id: string;
      full_name: string;
      year_level: number;
      section: string;
      attendance_required: boolean;
      excused: boolean;
    }> = [];

    if (participants.length > 0) {
      expectedStudents = participants
        .filter((p) => p.attendance_required === 1)
        .map((p) => ({
          student_id: p.student_id,
          school_id: p.school_id,
          full_name: p.full_name,
          year_level: p.year_level,
          section: p.section,
          attendance_required: true,
          excused: p.excused === 1,
        }));
    } else {
      // Derive dynamically from student_enrollments + audience rules
      const enrollments = await db.query<{
        id: string;
        student_id: string;
        year_level: number;
        section: string;
        school_id: string;
        first_name: string;
        middle_name?: string;
        last_name: string;
        program_id?: string;
      }>(
        `SELECT se.id, se.student_id, se.year_level, se.section,
                s.school_id, s.first_name, s.middle_name, s.last_name, s.program_id
         FROM student_enrollments se
         JOIN students s ON s.id = se.student_id
         WHERE se.semester_id = ? AND s.status = 'ACTIVE'`,
        [occ.semester_id]
      );

      let audienceConfig: any = {};
      try {
        audienceConfig = JSON.parse(occ.audience_json || '{}');
      } catch {
        audienceConfig = {};
      }

      const filtered = enrollments.filter((enr) => {
        if (occ.audience_type === 'YEAR' || audienceConfig.type === 'YEAR_LEVEL') {
          const allowed = audienceConfig.yearLevels || [];
          return allowed.length === 0 || allowed.includes(enr.year_level);
        }
        if (occ.audience_type === 'SECTION' || audienceConfig.type === 'SECTION') {
          const allowed = (audienceConfig.sections || []).map((s: string) => s.toLowerCase());
          return allowed.length === 0 || allowed.includes(enr.section.toLowerCase());
        }
        if (occ.audience_type === 'PROGRAM' || audienceConfig.type === 'PROGRAM') {
          const allowed = (audienceConfig.programs || audienceConfig.programIds || []).map((p: string) => p.toLowerCase());
          return allowed.length === 0 || allowed.includes(enr.program_id?.toLowerCase());
        }
        if (audienceConfig.type === 'CUSTOM' && Array.isArray(audienceConfig.studentIds)) {
          return audienceConfig.studentIds.includes(enr.student_id);
        }
        return true;
      });

      expectedStudents = filtered.map((enr) => {
        const mid = enr.middle_name ? ` ${enr.middle_name}` : '';
        return {
          student_id: enr.student_id,
          school_id: enr.school_id,
          full_name: `${enr.last_name}, ${enr.first_name}${mid}`,
          year_level: enr.year_level,
          section: enr.section,
          attendance_required: true,
          excused: false,
        };
      });
    }

    // Query attendance records for occurrence
    const attendanceRecords = await db.query<{
      id: string;
      student_id: string;
      checkpoint_id: string;
      status: string;
    }>(
      `SELECT id, student_id, checkpoint_id, status
       FROM attendance_records
       WHERE occurrence_id = ?`,
      [occurrenceId]
    );

    // Query active obligations for occurrence
    const obligations = await db.query<{
      id: string;
      student_id: string;
      rule_id: string | null;
      title: string;
      status: string;
    }>(
      `SELECT id, student_id, rule_id, title, status
       FROM student_obligations
       WHERE related_occurrence_id = ? AND status = 'ACTIVE'`,
      [occurrenceId]
    );

    // Build checkpoint statistics
    const checkpointStats = checkpoints.map((cp) => {
      const attended = expectedStudents.filter((s) => {
        return attendanceRecords.some(
          (ar) => ar.student_id === s.student_id && ar.checkpoint_id === cp.id && ['PRESENT', 'LATE', 'EXCUSED'].includes(ar.status)
        );
      }).length;

      return {
        checkpointId: cp.id,
        label: cp.label,
        type: cp.type,
        status: occ.status,
        attendedCount: attended,
        missingCount: Math.max(0, expectedStudents.length - attended),
      };
    });

    let presentCount = 0;
    let lateCount = 0;
    let excusedAttendanceCount = 0;

    for (const ar of attendanceRecords) {
      if (ar.status === 'PRESENT') presentCount++;
      else if (ar.status === 'LATE') lateCount++;
      else if (ar.status === 'EXCUSED') excusedAttendanceCount++;
    }

    const excusedRosterCount = expectedStudents.filter((s) => s.excused).length;
    const totalExcused = excusedRosterCount + excusedAttendanceCount;

    const targetCp = checkpointId ? checkpoints.find((c) => c.id === checkpointId) : null;
    const candidates: AbsenteeCandidate[] = [];

    for (const stu of expectedStudents) {
      if (stu.excused) continue;

      const stuAtts = attendanceRecords.filter((ar) => ar.student_id === stu.student_id && ['PRESENT', 'LATE', 'EXCUSED'].includes(ar.status));
      const attendedCpIds = stuAtts.map((ar) => ar.checkpoint_id);
      const missedCps = checkpoints.filter((cp) => !attendedCpIds.includes(cp.id)).map((cp) => cp.label);

      if (targetCp) {
        if (attendedCpIds.includes(targetCp.id)) continue;

        const alreadyFined = obligations.some((o) => {
          if (o.student_id !== stu.student_id) return false;
          return o.title?.toLowerCase().includes(targetCp.label.toLowerCase()) ||
                 o.title?.includes(targetCp.id) ||
                 (ruleId && o.rule_id === ruleId);
        });

        candidates.push({
          studentId: stu.student_id,
          schoolId: stu.school_id,
          fullName: stu.full_name,
          yearLevel: stu.year_level,
          section: stu.section,
          occurrenceId,
          attendanceRequired: true,
          excused: false,
          alreadyFined,
          selected: !alreadyFined,
          attendanceStatus: 'ABSENT',
          missedCheckpoints: missedCps,
          attendedCheckpoints: attendedCpIds,
        });
      } else {
        // Whole-Event: student must have 0 valid attendance records across all checkpoints
        if (stuAtts.length > 0) continue;

        const alreadyFined = obligations.some((o) => {
          if (o.student_id !== stu.student_id) return false;
          return (!ruleId || o.rule_id === ruleId);
        });

        candidates.push({
          studentId: stu.student_id,
          schoolId: stu.school_id,
          fullName: stu.full_name,
          yearLevel: stu.year_level,
          section: stu.section,
          occurrenceId,
          attendanceRequired: true,
          excused: false,
          alreadyFined,
          selected: !alreadyFined,
          attendanceStatus: 'ABSENT',
          missedCheckpoints: missedCps,
          attendedCheckpoints: [],
        });
      }
    }

    const alreadyFinedCount = candidates.filter((c) => c.alreadyFined).length;
    const eligibleForFineCount = candidates.filter((c) => !c.alreadyFined).length;
    const totalRequired = expectedStudents.length;

    const summary: OccurrenceAbsenteeSummary = {
      occurrenceId,
      occurrenceTitle: occ.title,
      eventTitle: occ.event_title,
      occursOn: occ.occurs_on,
      sessionStatus: occ.status,
      totalRequired,
      presentCount,
      lateCount,
      excusedCount: totalExcused,
      absentCount: candidates.length,
      alreadyFinedCount,
      eligibleForFineCount,
      isAuthoritativeRosterFinalized: totalRequired > 0,
      checkpoints: checkpointStats,
      activeMode: targetCp ? 'PER_CHECKPOINT' : 'WHOLE_EVENT',
      selectedCheckpointId: targetCp ? targetCp.id : null,
    };

    return { summary, candidates };
  }

  // ==========================================================================
  // --- 4. BULK FINE ASSESSMENT ---
  // ==========================================================================

  public static async assessBulkFines(
    params: {
      occurrenceId: string;
      ruleId?: string | null;
      fineTitle: string;
      amountCentavos: number;
      dueDate?: string | null;
      studentIds: string[];
      notes?: string | null;
      actorUserId: string;
      mode?: 'WHOLE_EVENT' | 'PER_CHECKPOINT';
      checkpointId?: string | null;
    },
    adapter?: DatabaseAdapter
  ): Promise<BulkFineAssessmentResult> {
    if (!params.studentIds || params.studentIds.length === 0) {
      throw new Error('At least one student must be selected for bulk fine assessment.');
    }
    if (params.amountCentavos <= 0 || !Number.isInteger(params.amountCentavos)) {
      throw new Error('Fine amount must be a positive integer in centavos.');
    }

    const now = new Date().toISOString();
    let assessedCount = 0;
    let skippedCount = 0;
    let invalidCount = 0;

    // Direct Supabase mode
    if (!adapter && DataModeService.isDirectSupabase()) {
      const rawOccId = params.occurrenceId.startsWith('occ_') ? params.occurrenceId.replace(/^occ_/, '') : params.occurrenceId;
      const { data: occ, error: occErr } = await supabase
        .from('event_occurrences')
        .select('id, event_id, status, events(id, semester_id, title)')
        .eq('id', rawOccId)
        .maybeSingle();

      if (occErr || !occ) throw new Error('Occurrence not found on Supabase.');
      if (occ.status !== 'CLOSED') {
        throw new Error('Attendance session is still open or scheduled. Fines can only be assessed on closed sessions.');
      }

      const parentEvent: any = occ.events;
      const semesterId = parentEvent?.semester_id;
      const rawEventId = parentEvent?.id || occ.event_id;

      // Existing active obligations
      const { data: existingObs } = await supabase
        .from('student_obligations')
        .select('id, student_id, rule_id, title, status')
        .eq('related_occurrence_id', rawOccId)
        .eq('status', 'ACTIVE');

      // Attendance records
      const { data: attendanceRecs } = await supabase
        .from('attendance_records')
        .select('id, student_id, checkpoint_id, status')
        .eq('occurrence_id', rawOccId)
        .in('status', ['PRESENT', 'LATE', 'EXCUSED']);

      const attendanceMap = new Map<string, Set<string>>();
      (attendanceRecs || []).forEach((ar: any) => {
        if (!attendanceMap.has(ar.student_id)) attendanceMap.set(ar.student_id, new Set());
        attendanceMap.get(ar.student_id)!.add(ar.checkpoint_id);
      });

      const batchId = this.generateUuid();
      const insertRows: any[] = [];
      const createdItems: StudentObligationItem[] = [];

      for (const studentId of params.studentIds) {
        const attendedCheckpoints = attendanceMap.get(studentId);
        if (params.mode === 'PER_CHECKPOINT' && params.checkpointId) {
          if (attendedCheckpoints && attendedCheckpoints.has(params.checkpointId)) {
            invalidCount++;
            continue;
          }
        } else {
          // Whole event: partial attendance does not count as whole absence
          if (attendedCheckpoints && attendedCheckpoints.size > 0) {
            invalidCount++;
            continue;
          }
        }

        const isAlreadyFined = (existingObs || []).some((o: any) => {
          if (o.student_id !== studentId) return false;
          if (params.mode === 'PER_CHECKPOINT' && params.checkpointId) {
            return o.title === params.fineTitle || o.title.includes(params.checkpointId);
          }
          return (!params.ruleId || o.rule_id === params.ruleId) || o.title === params.fineTitle;
        });

        if (isAlreadyFined) {
          skippedCount++;
          continue;
        }

        const obligationId = this.generateUuid();
        insertRows.push({
          id: obligationId,
          student_id: studentId,
          semester_id: semesterId,
          rule_id: params.ruleId || null,
          related_event_id: rawEventId,
          related_occurrence_id: rawOccId,
          title: params.fineTitle,
          type: 'FINE',
          amount_centavos: params.amountCentavos,
          status: 'ACTIVE',
          due_date: params.dueDate || null,
          issued_by_user_id: params.actorUserId || null,
          batch_id: batchId,
          issued_at: now,
          updated_at: now,
        });

        createdItems.push({
          id: obligationId,
          studentId,
          semesterId,
          ruleId: params.ruleId || undefined,
          relatedEventId: rawEventId,
          relatedOccurrenceId: rawOccId,
          title: params.fineTitle,
          type: 'FINE',
          amountCentavos: params.amountCentavos,
          paidCentavos: 0,
          balanceCentavos: params.amountCentavos,
          status: 'UNPAID',
          dueDate: params.dueDate || null,
          batchId,
          issuedByUserId: params.actorUserId || null,
          issuedAt: now,
          updatedAt: now,
        });

        assessedCount++;
      }

      if (insertRows.length > 0) {
        const { error: insertErr } = await supabase.from('student_obligations').insert(insertRows);
        if (insertErr) throw new Error(`Failed to insert obligations on Supabase: ${insertErr.message}`);
      }

      return {
        batchId,
        totalSelected: params.studentIds.length,
        assessedCount,
        skippedCount,
        invalidCount,
        totalAssessedCentavos: assessedCount * params.amountCentavos,
        createdObligations: createdItems,
      };
    }

    // --- SQLite Engine Branch ---
    const db = await this.getDb(adapter);

    const occ = await db.queryOne<EventOccurrenceRecord & { semester_id: string }>(
      `SELECT o.*, e.semester_id
       FROM event_occurrences o
       JOIN events e ON e.id = o.event_id
       WHERE o.id = ?`,
      [params.occurrenceId]
    );
    if (!occ) {
      throw new Error('Occurrence not found.');
    }
    if (occ.status !== 'CLOSED') {
      throw new Error('Attendance session is still open or scheduled. Fines can only be assessed on closed sessions.');
    }

    let rule: ObligationRule | null = null;
    if (params.ruleId) {
      rule = await db.queryOne<ObligationRule>('SELECT * FROM obligation_rules WHERE id = ?', [params.ruleId]);
    }

    const batchId = 'batch_' + Math.random().toString(36).substring(2, 10);
    const createdObligations: StudentObligationItem[] = [];

    await db.transaction(async (tx) => {
      const { deviceId, validActorId } = await this.ensureDeviceAndActor(tx, params.actorUserId, now);

      for (const studentId of params.studentIds) {
        // A. Verify student belongs to required roster or enrollments
        let isRequired = false;
        let isExcused = false;

        const participant = await tx.queryOne<{ attendance_required: number; excused: number }>(
          `SELECT attendance_required, excused FROM event_participants
           WHERE occurrence_id = ? AND student_id = ?`,
          [params.occurrenceId, studentId]
        );

        if (participant) {
          isRequired = participant.attendance_required === 1;
          isExcused = participant.excused === 1;
        } else {
          const enr = await tx.queryOne<{ id: string }>(
            `SELECT id FROM student_enrollments WHERE student_id = ? AND semester_id = ?`,
            [studentId, occ.semester_id]
          );
          isRequired = Boolean(enr);
        }

        if (!isRequired || isExcused) {
          invalidCount++;
          continue;
        }

        // B. Verify attendance based on mode
        if (params.mode === 'PER_CHECKPOINT' && params.checkpointId) {
          const checkpointAtt = await tx.queryOne<{ id: string }>(
            `SELECT id FROM attendance_records
             WHERE occurrence_id = ? AND student_id = ? AND checkpoint_id = ? AND status IN ('PRESENT', 'LATE', 'EXCUSED')`,
            [params.occurrenceId, studentId, params.checkpointId]
          );
          if (checkpointAtt) {
            invalidCount++;
            continue;
          }
        } else {
          // Whole event: student must have 0 valid scans across all checkpoints
          const validAttendance = await tx.queryOne<{ id: string }>(
            `SELECT id FROM attendance_records
             WHERE occurrence_id = ? AND student_id = ? AND status IN ('PRESENT', 'LATE', 'EXCUSED')`,
            [params.occurrenceId, studentId]
          );
          if (validAttendance) {
            invalidCount++;
            continue;
          }
        }

        // C. Duplicate check (idempotency)
        let alreadyFined;
        if (params.mode === 'PER_CHECKPOINT' && params.checkpointId) {
          alreadyFined = await tx.queryOne<{ id: string }>(
            `SELECT id FROM student_obligations
             WHERE student_id = ? AND related_occurrence_id = ? AND status = 'ACTIVE'
               AND (title = ? OR title LIKE ?)`,
            [studentId, params.occurrenceId, params.fineTitle, `%${params.checkpointId}%`]
          );
        } else {
          alreadyFined = await tx.queryOne<{ id: string }>(
            `SELECT id FROM student_obligations
             WHERE student_id = ? AND related_occurrence_id = ? AND status = 'ACTIVE'
               AND (? IS NULL OR rule_id = ?)`,
            [studentId, params.occurrenceId, params.ruleId || null, params.ruleId || null]
          );
        }
        if (alreadyFined) {
          skippedCount++;
          continue;
        }

        // D. Create student obligation
        const obligationId = this.generateUuid();
        await tx.execute(
          `INSERT INTO student_obligations (
            id, student_id, semester_id, rule_id, related_event_id, related_occurrence_id,
            title, type, amount_centavos, status, due_date, issued_by_user_id, batch_id, issued_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'FINE', ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
          [
            obligationId,
            studentId,
            occ.semester_id,
            params.ruleId || null,
            occ.event_id,
            params.occurrenceId,
            params.fineTitle || (rule ? rule.name : 'Event Absence Fine'),
            params.amountCentavos,
            params.dueDate || null,
            validActorId,
            batchId,
            now,
            now,
          ]
        );

        // Outbox queue for sync
        const outboxId = 'op_ob_' + Math.random().toString(36).substring(2, 10);
        await tx.execute(
          `INSERT INTO sync_outbox (
            id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
          ) VALUES (?, ?, 'OBLIGATION', ?, 'CREATE', ?, 1, ?, 0)`,
          [
            outboxId,
            deviceId,
            obligationId,
            JSON.stringify({
              id: obligationId,
              student_id: studentId,
              semester_id: occ.semester_id,
              rule_id: params.ruleId || null,
              related_event_id: occ.event_id,
              related_occurrence_id: params.occurrenceId,
              title: params.fineTitle || (rule ? rule.name : 'Event Absence Fine'),
              type: 'FINE',
              amount_centavos: params.amountCentavos,
              status: 'ACTIVE',
              due_date: params.dueDate || null,
              batch_id: batchId,
              issued_at: now,
              updated_at: now,
            }),
            now,
          ]
        );

        createdObligations.push({
          id: obligationId,
          studentId,
          semesterId: occ.semester_id,
          ruleId: params.ruleId || null,
          relatedEventId: occ.event_id,
          relatedOccurrenceId: params.occurrenceId,
          title: params.fineTitle || (rule ? rule.name : 'Event Absence Fine'),
          type: 'FINE',
          amountCentavos: params.amountCentavos,
          paidCentavos: 0,
          balanceCentavos: params.amountCentavos,
          status: 'UNPAID',
          dueDate: params.dueDate || null,
          batchId,
          issuedByUserId: validActorId,
          issuedAt: now,
          updatedAt: now,
        });

        assessedCount++;
      }

      // E. Transactional Audit Log
      const auditId = 'aud_bulk_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO audit_events (id, actor_user_id, device_id, entity_type, entity_id, action, details_json, occurred_at)
         VALUES (?, ?, ?, 'BULK_FINE_ASSESSMENT', ?, 'CREATE', ?, ?)`,
        [
          auditId,
          validActorId,
          deviceId,
          batchId,
          JSON.stringify({
            occurrence_id: params.occurrenceId,
            rule_id: params.ruleId || null,
            assessed_count: assessedCount,
            skipped_count: skippedCount,
            invalid_count: invalidCount,
            total_centavos: assessedCount * params.amountCentavos,
          }),
          now,
        ]
      );
    });

    return {
      batchId,
      totalSelected: params.studentIds.length,
      assessedCount,
      skippedCount,
      invalidCount,
      totalAssessedCentavos: assessedCount * params.amountCentavos,
      createdObligations,
    };
  }

  // ==========================================================================
  // --- 5. CONTRIBUTIONS MANAGEMENT ---
  // ==========================================================================

  public static async assessBulkContributions(
    params: {
      semesterId: string;
      ruleId?: string;
      title: string;
      amountCentavos: number;
      dueDate?: string | null;
      targetScope: 'ALL' | 'PROGRAM' | 'YEAR_LEVEL' | 'SECTION' | 'INDIVIDUAL';
      programIds?: string[];
      yearLevels?: number[];
      sections?: string[];
      studentIds?: string[];
      notes?: string | null;
      actorUserId: string;
    },
    adapter?: DatabaseAdapter,
    onProgress?: (stage: string, meta?: { current?: number; total?: number }) => void
  ): Promise<BulkContributionResult> {
    if (!params.title || !params.title.trim()) {
      throw new Error('Contribution title is required.');
    }
    if (params.amountCentavos <= 0 || !Number.isInteger(params.amountCentavos)) {
      throw new Error('Contribution amount must be a positive integer in centavos.');
    }

    if (!adapter && DataModeService.isDirectSupabase()) {
      onProgress?.('LOADING_STUDENTS');

      // 1. Identify target students from Supabase
      let targetStudents: { student_id: string }[] = [];

      if (params.targetScope === 'INDIVIDUAL' && params.studentIds && params.studentIds.length > 0) {
        const { data: stuData, error: stuError } = await supabase
          .from('students')
          .select('id')
          .in('id', params.studentIds)
          .eq('status', 'ACTIVE');

        if (stuError) {
          throw new Error(`Failed to load target students from Supabase: ${stuError.message}`);
        }
        targetStudents = (stuData || []).map((s: any) => ({ student_id: s.id }));
      } else {
        let enrQuery = supabase
          .from('student_enrollments')
          .select('student_id')
          .eq('semester_id', params.semesterId);

        if (params.targetScope === 'PROGRAM' && params.programIds && params.programIds.length > 0) {
          enrQuery = enrQuery.in('program_id', params.programIds);
        } else if (params.targetScope === 'YEAR_LEVEL' && params.yearLevels && params.yearLevels.length > 0) {
          enrQuery = enrQuery.in('year_level', params.yearLevels);
        } else if (params.targetScope === 'SECTION' && params.sections && params.sections.length > 0) {
          enrQuery = enrQuery.in('section', params.sections);
        }

        const { data: enrData, error: enrError } = await enrQuery;
        if (enrError) {
          throw new Error(`Failed to load student enrollments from Supabase: ${enrError.message}`);
        }

        const rawStudentIds = Array.from(
          new Set((enrData || []).map((e: any) => e.student_id).filter(Boolean))
        );

        if (rawStudentIds.length === 0) {
          throw new Error('No eligible enrolled students found for the selected contribution audience.');
        }

        const { data: activeStudents, error: actError } = await supabase
          .from('students')
          .select('id')
          .in('id', rawStudentIds)
          .eq('status', 'ACTIVE');

        if (actError) {
          throw new Error(`Failed to verify active students from Supabase: ${actError.message}`);
        }

        targetStudents = (activeStudents || []).map((s: any) => ({ student_id: s.id }));
      }

      if (targetStudents.length === 0) {
        throw new Error('No eligible enrolled students found for the selected contribution audience.');
      }

      onProgress?.('GENERATING_OBLIGATIONS', { total: targetStudents.length });

      // 2. Prevent duplicate student obligations under the same rule and semester
      let studentsToAssign = targetStudents;
      if (params.ruleId) {
        const { data: existingObs, error: existError } = await supabase
          .from('student_obligations')
          .select('student_id')
          .eq('semester_id', params.semesterId)
          .eq('rule_id', params.ruleId)
          .neq('status', 'VOID');

        if (existError) {
          throw new Error(`Failed to check existing obligations on Supabase: ${existError.message}`);
        }

        const existingStudentIds = new Set((existingObs || []).map((o: any) => o.student_id));
        studentsToAssign = targetStudents.filter((t) => !existingStudentIds.has(t.student_id));
      }

      const batchId = this.generateUuid();
      const now = new Date().toISOString();
      const createdObligations: StudentObligationItem[] = [];

      // Resolve valid actor user UUID
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let validActorId: string | null = null;
      if (params.actorUserId && UUID_REGEX.test(params.actorUserId)) {
        validActorId = params.actorUserId;
      } else {
        const { data: authUser } = await supabase.auth.getUser();
        if (authUser?.user?.id && UUID_REGEX.test(authUser.user.id)) {
          validActorId = authUser.user.id;
        }
      }

      if (studentsToAssign.length > 0) {
        onProgress?.('SAVING_SUPABASE', { current: 0, total: studentsToAssign.length });

        const rowsToInsert = studentsToAssign.map((t) => {
          const id = this.generateUuid();
          return {
            id,
            student_id: t.student_id,
            semester_id: params.semesterId,
            rule_id: params.ruleId || null,
            title: params.title.trim(),
            type: 'CONTRIBUTION',
            amount_centavos: Math.round(params.amountCentavos),
            status: 'ACTIVE',
            due_date: params.dueDate ? params.dueDate.substring(0, 10) : null,
            issued_by_user_id: validActorId,
            batch_id: batchId,
            issued_at: now,
            updated_at: now,
          };
        });

        // Insert in chunks of 100
        const CHUNK_SIZE = 100;
        for (let i = 0; i < rowsToInsert.length; i += CHUNK_SIZE) {
          const chunk = rowsToInsert.slice(i, i + CHUNK_SIZE);
          const { error: insertError } = await supabase
            .from('student_obligations')
            .insert(chunk);

          if (insertError) {
            throw new Error(`Failed to create student obligations on Supabase: ${insertError.message}`);
          }
          onProgress?.('SAVING_SUPABASE', {
            current: Math.min(i + CHUNK_SIZE, rowsToInsert.length),
            total: rowsToInsert.length,
          });
        }

        onProgress?.('FINALIZING', { total: rowsToInsert.length });

        for (const row of rowsToInsert) {
          createdObligations.push({
            id: row.id,
            studentId: row.student_id,
            semesterId: row.semester_id,
            ruleId: row.rule_id,
            title: row.title,
            type: 'CONTRIBUTION',
            amountCentavos: row.amount_centavos,
            paidCentavos: 0,
            balanceCentavos: row.amount_centavos,
            status: 'UNPAID',
            dueDate: row.due_date,
            batchId: row.batch_id,
            issuedByUserId: row.issued_by_user_id,
            issuedAt: row.issued_at,
            updatedAt: row.updated_at,
          });
        }
      }

      return {
        batchId,
        totalAssigned: createdObligations.length,
        totalCentavos: createdObligations.length * params.amountCentavos,
        createdObligations,
      };
    }

    const db = await this.getDb(adapter);

    // 1. Identify target students from student_enrollments for the semester
    let targetStudents: { student_id: string }[] = [];

    if (params.targetScope === 'INDIVIDUAL' && params.studentIds && params.studentIds.length > 0) {
      targetStudents = params.studentIds.map((id) => ({ student_id: id }));
    } else {
      let sql = `
        SELECT se.student_id
        FROM student_enrollments se
        JOIN students s ON s.id = se.student_id
        WHERE se.semester_id = ? AND s.status = 'ACTIVE'
      `;
      const qParams: unknown[] = [params.semesterId];

      if (params.targetScope === 'PROGRAM' && params.programIds && params.programIds.length > 0) {
        const placeholders = params.programIds.map(() => '?').join(',');
        sql += ` AND se.program_id IN (${placeholders})`;
        qParams.push(...params.programIds);
      } else if (params.targetScope === 'YEAR_LEVEL' && params.yearLevels && params.yearLevels.length > 0) {
        const placeholders = params.yearLevels.map(() => '?').join(',');
        sql += ` AND se.year_level IN (${placeholders})`;
        qParams.push(...params.yearLevels);
      } else if (params.targetScope === 'SECTION' && params.sections && params.sections.length > 0) {
        const placeholders = params.sections.map(() => '?').join(',');
        sql += ` AND se.section IN (${placeholders})`;
        qParams.push(...params.sections);
      }

      targetStudents = await db.query<{ student_id: string }>(sql, qParams);
    }

    if (targetStudents.length === 0) {
      throw new Error('No eligible enrolled students found for the selected contribution audience.');
    }

    const batchId = 'batch_c_' + Math.random().toString(36).substring(2, 10);
    const now = new Date().toISOString();
    const createdObligations: StudentObligationItem[] = [];

    await db.transaction(async (tx) => {
      const { deviceId, validActorId } = await this.ensureDeviceAndActor(tx, params.actorUserId, now);

      for (const t of targetStudents) {
        // Prevent duplicate contribution under same rule and semester
        if (params.ruleId) {
          const existing = await tx.queryOne<{ id: string }>(
            `SELECT id FROM student_obligations
             WHERE student_id = ? AND semester_id = ? AND rule_id = ? AND status = 'ACTIVE'`,
            [t.student_id, params.semesterId, params.ruleId]
          );
          if (existing) continue;
        }

        const obligationId = this.generateUuid();
        await tx.execute(
          `INSERT INTO student_obligations (
            id, student_id, semester_id, rule_id, title, type, amount_centavos,
            status, due_date, issued_by_user_id, batch_id, issued_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'CONTRIBUTION', ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
          [
            obligationId,
            t.student_id,
            params.semesterId,
            params.ruleId || null,
            params.title.trim(),
            params.amountCentavos,
            params.dueDate || null,
            validActorId,
            batchId,
            now,
            now,
          ]
        );

        // Outbox queue
        const outboxId = 'op_ob_' + Math.random().toString(36).substring(2, 10);
        await tx.execute(
          `INSERT INTO sync_outbox (
            id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
          ) VALUES (?, ?, 'OBLIGATION', ?, 'CREATE', ?, 1, ?, 0)`,
          [
            outboxId,
            deviceId,
            obligationId,
            JSON.stringify({
              id: obligationId,
              student_id: t.student_id,
              semester_id: params.semesterId,
              rule_id: params.ruleId || null,
              title: params.title.trim(),
              type: 'CONTRIBUTION',
              amount_centavos: params.amountCentavos,
              status: 'ACTIVE',
              due_date: params.dueDate || null,
              batch_id: batchId,
              issued_at: now,
              updated_at: now,
            }),
            now,
          ]
        );

        createdObligations.push({
          id: obligationId,
          studentId: t.student_id,
          semesterId: params.semesterId,
          ruleId: params.ruleId || null,
          title: params.title.trim(),
          type: 'CONTRIBUTION',
          amountCentavos: params.amountCentavos,
          paidCentavos: 0,
          balanceCentavos: params.amountCentavos,
          status: 'UNPAID',
          dueDate: params.dueDate || null,
          batchId,
          issuedByUserId: validActorId,
          issuedAt: now,
          updatedAt: now,
        });
      }

      // Audit
      const auditId = 'aud_contrib_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO audit_events (id, actor_user_id, device_id, entity_type, entity_id, action, details_json, occurred_at)
         VALUES (?, ?, ?, 'BULK_CONTRIBUTION', ?, 'CREATE', ?, ?)`,
        [
          auditId,
          validActorId,
          deviceId,
          batchId,
          JSON.stringify({
            semester_id: params.semesterId,
            count: createdObligations.length,
            total_centavos: createdObligations.length * params.amountCentavos,
          }),
          now,
        ]
      );
    });

    return {
      batchId,
      totalAssigned: createdObligations.length,
      totalCentavos: createdObligations.length * params.amountCentavos,
      createdObligations,
    };
  }

  // ==========================================================================
  // --- 6. ADJUSTMENTS & WAIVERS ---
  // ==========================================================================

  public static async createAdjustment(
    adjustment: {
      id: string;
      obligation_id: string;
      kind: 'REDUCTION' | 'ADDITION';
      amount_centavos: number;
      reason: string;
      approved_by_user_id: string;
      created_at: string;
    },
    adapter?: DatabaseAdapter
  ): Promise<void> {
    if (adjustment.amount_centavos <= 0 || !Number.isInteger(adjustment.amount_centavos)) {
      throw new Error('Adjustment amount must be a positive integer in centavos.');
    }
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO obligation_adjustments (
        id, obligation_id, kind, amount_centavos, reason, approved_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        adjustment.id,
        adjustment.obligation_id,
        adjustment.kind,
        adjustment.amount_centavos,
        adjustment.reason,
        adjustment.approved_by_user_id,
        adjustment.created_at,
      ]
    );
  }

  // ==========================================================================
  // --- 7. DIRECT PAYMENT RECORDS & ALLOCATIONS ---
  // ==========================================================================

  public static async recordPayment(
    payment: PaymentRecord,
    allocations: { id: string; obligation_id: string; amount_centavos: number }[],
    adapter?: DatabaseAdapter
  ): Promise<void> {
    if (payment.amount_centavos <= 0 || !Number.isInteger(payment.amount_centavos)) {
      throw new Error('Payment amount must be a positive integer in centavos.');
    }

    const totalAllocated = allocations.reduce((acc, curr) => acc + curr.amount_centavos, 0);
    if (totalAllocated !== payment.amount_centavos) {
      throw new Error(`Total allocations (${totalAllocated}) must equal payment amount (${payment.amount_centavos}).`);
    }

    const db = await this.getDb(adapter);
    await db.transaction(async (tx) => {
      const { deviceId, validActorId } = await this.ensureDeviceAndActor(tx, payment.processed_by_user_id, payment.processed_at);

      // 1. Check idempotency
      const existing = await tx.queryOne<PaymentRecord>(
        'SELECT id FROM payments WHERE idempotency_key = ?',
        [payment.idempotency_key]
      );
      if (existing) {
        // Idempotent duplicate: skip insert
        return;
      }

      // 2. Validate allocations against remaining balances
      for (const alloc of allocations) {
        if (alloc.amount_centavos <= 0 || !Number.isInteger(alloc.amount_centavos)) {
          throw new Error('Allocation amount must be a positive integer in centavos.');
        }

        const ob = await tx.queryOne<StudentObligation>(
          'SELECT * FROM student_obligations WHERE id = ? AND status = ?',
          [alloc.obligation_id, 'ACTIVE']
        );
        if (!ob) {
          throw new Error(`Obligation ${alloc.obligation_id} not found or inactive.`);
        }
        if (ob.student_id !== payment.student_id) {
          throw new Error(`Obligation ${alloc.obligation_id} does not belong to student ${payment.student_id}.`);
        }

        const paidRow = await tx.queryOne<{ paid: number }>(
          `SELECT COALESCE(SUM(pa.amount_centavos), 0) as paid
           FROM payment_allocations pa
           JOIN payments p ON p.id = pa.payment_id
           WHERE pa.obligation_id = ? AND p.status = 'POSTED'`,
          [alloc.obligation_id]
        );
        const alreadyPaid = paidRow?.paid || 0;
        const remaining = ob.amount_centavos - alreadyPaid;
        if (alloc.amount_centavos > remaining) {
          throw new Error(
            `Allocation of ₱${(alloc.amount_centavos / 100).toFixed(2)} exceeds remaining obligation balance ₱${(remaining / 100).toFixed(2)}.`
          );
        }
      }

      // 3. Insert payment record (Direct payment: Cash or Manual Transfer)
      await tx.execute(
        `INSERT INTO payments (
          id, student_id, semester_id, reference_number, idempotency_key, amount_centavos,
          source, channel, status, processed_by_user_id, device_id, notes, processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payment.id,
          payment.student_id,
          payment.semester_id,
          payment.reference_number,
          payment.idempotency_key,
          payment.amount_centavos,
          payment.source,
          payment.channel,
          payment.status,
          validActorId,
          deviceId,
          payment.notes || null,
          payment.processed_at,
        ]
      );

      // 4. Insert allocations
      for (const alloc of allocations) {
        await tx.execute(
          `INSERT INTO payment_allocations (id, payment_id, obligation_id, amount_centavos)
           VALUES (?, ?, ?, ?)`,
          [alloc.id, payment.id, alloc.obligation_id, alloc.amount_centavos]
        );
      }

      // 5. Transactional Audit Log
      const auditId = 'aud_pay_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO audit_events (id, actor_user_id, device_id, entity_type, entity_id, action, details_json, occurred_at)
         VALUES (?, ?, ?, 'PAYMENT', ?, 'RECORD', ?, ?)`,
        [
          auditId,
          validActorId,
          deviceId,
          payment.id,
          JSON.stringify({
            amount: payment.amount_centavos,
            source: payment.source,
            reference: payment.reference_number,
            allocations_count: allocations.length,
          }),
          payment.processed_at,
        ]
      );

      // 6. Queue Sync Outbox
      const outboxId = 'op_pay_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO sync_outbox (
          id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
        ) VALUES (?, ?, 'PAYMENT', ?, 'CREATE', ?, 1, ?, 0)`,
        [
          outboxId,
          deviceId,
          payment.id,
          JSON.stringify({
            payment,
            allocations,
          }),
          payment.processed_at,
        ]
      );
    });
  }

  public static async reversePayment(
    paymentId: string,
    reason: string,
    reversedByUserId: string,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    if (!reason || reason.trim().length === 0) {
      throw new Error('Reversal reason is mandatory.');
    }

    const db = await this.getDb(adapter);
    await db.transaction(async (tx) => {
      const payment = await tx.queryOne<PaymentRecord>('SELECT * FROM payments WHERE id = ?', [paymentId]);
      if (!payment) {
        throw new Error('Payment not found.');
      }
      if (payment.status === 'REVERSED') {
        throw new Error('Payment is already reversed.');
      }

      const now = new Date().toISOString();
      const { deviceId, validActorId } = await this.ensureDeviceAndActor(tx, reversedByUserId, now);

      await tx.execute(
        `UPDATE payments
         SET status = 'REVERSED', reversed_at = ?, reversed_by_user_id = ?, reversal_reason = ?
         WHERE id = ?`,
        [now, validActorId, reason.trim(), paymentId]
      );

      // Audit event
      const auditId = 'aud_rev_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO audit_events (id, actor_user_id, device_id, entity_type, entity_id, action, details_json, occurred_at)
         VALUES (?, ?, ?, 'PAYMENT', ?, 'REVERSE', ?, ?)`,
        [auditId, validActorId, deviceId, paymentId, JSON.stringify({ reason: reason.trim() }), now]
      );

      // Outbox queue for reversed payment
      const outboxId = 'op_rev_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO sync_outbox (
          id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
        ) VALUES (?, ?, 'PAYMENT', ?, 'UPDATE', ?, 1, ?, 0)`,
        [
          outboxId,
          deviceId,
          paymentId,
          JSON.stringify({
            id: paymentId,
            status: 'REVERSED',
            reversed_at: now,
            reversed_by_user_id: validActorId,
            reversal_reason: reason.trim(),
          }),
          now,
        ]
      );
    });
  }

  /**
   * Mirrors an already server-confirmed payment into local SQLite cache.
   * DOES NOT enqueue to sync_outbox because the transaction has already been durably acknowledged by Supabase.
   */
  public static async recordServerConfirmedPayment(
    payment: PaymentRecord,
    allocations: { id: string; obligation_id: string; amount_centavos: number }[],
    adapter?: DatabaseAdapter
  ): Promise<void> {
    if (payment.amount_centavos <= 0 || !Number.isInteger(payment.amount_centavos)) {
      throw new Error('Payment amount must be a positive integer in centavos.');
    }

    const totalAllocated = allocations.reduce((acc, curr) => acc + curr.amount_centavos, 0);
    if (totalAllocated !== payment.amount_centavos) {
      throw new Error(`Total allocations (${totalAllocated}) must equal payment amount (${payment.amount_centavos}).`);
    }

    const db = await this.getDb(adapter);
    await db.transaction(async (tx) => {
      const { deviceId, validActorId } = await this.ensureDeviceAndActor(tx, payment.processed_by_user_id, payment.processed_at);

      // Check idempotency in local SQLite
      const existing = await tx.queryOne<PaymentRecord>(
        'SELECT id FROM payments WHERE id = ? OR idempotency_key = ?',
        [payment.id, payment.idempotency_key]
      );
      if (existing) {
        return;
      }

      await tx.execute(
        `INSERT INTO payments (
          id, student_id, semester_id, reference_number, idempotency_key, amount_centavos,
          source, channel, status, processed_by_user_id, device_id, notes, processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payment.id,
          payment.student_id,
          payment.semester_id,
          payment.reference_number,
          payment.idempotency_key,
          payment.amount_centavos,
          payment.source,
          payment.channel,
          'POSTED',
          validActorId,
          deviceId,
          payment.notes || null,
          payment.processed_at,
        ]
      );

      for (const alloc of allocations) {
        await tx.execute(
          `INSERT OR IGNORE INTO payment_allocations (id, payment_id, obligation_id, amount_centavos)
           VALUES (?, ?, ?, ?)`,
          [alloc.id, payment.id, alloc.obligation_id, alloc.amount_centavos]
        );
      }

      const auditId = 'aud_pay_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO audit_events (id, actor_user_id, device_id, entity_type, entity_id, action, details_json, occurred_at)
         VALUES (?, ?, ?, 'PAYMENT', ?, 'RECORD', ?, ?)`,
        [
          auditId,
          validActorId,
          deviceId,
          payment.id,
          JSON.stringify({
            amount: payment.amount_centavos,
            source: payment.source,
            reference: payment.reference_number,
            allocations_count: allocations.length,
            confirmed_by_server: true,
          }),
          payment.processed_at,
        ]
      );
      // NOTE: Intentionally NO insert into sync_outbox
    });
  }

  /**
   * Mirrors an already server-confirmed reversal into local SQLite cache.
   * DOES NOT enqueue to sync_outbox because the reversal has already been acknowledged by Supabase.
   */
  public static async recordServerConfirmedReversal(
    paymentId: string,
    reason: string,
    reversedByUserId: string,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    if (!reason || reason.trim().length === 0) {
      throw new Error('Reversal reason is mandatory.');
    }

    const db = await this.getDb(adapter);
    await db.transaction(async (tx) => {
      const payment = await tx.queryOne<PaymentRecord>('SELECT * FROM payments WHERE id = ?', [paymentId]);
      if (!payment) {
        return;
      }
      if (payment.status === 'REVERSED') {
        return;
      }

      const now = new Date().toISOString();
      const { deviceId, validActorId } = await this.ensureDeviceAndActor(tx, reversedByUserId, now);

      await tx.execute(
        `UPDATE payments
         SET status = 'REVERSED', reversed_at = ?, reversed_by_user_id = ?, reversal_reason = ?
         WHERE id = ?`,
        [now, validActorId, reason.trim(), paymentId]
      );

      const auditId = 'aud_rev_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO audit_events (id, actor_user_id, device_id, entity_type, entity_id, action, details_json, occurred_at)
         VALUES (?, ?, ?, 'PAYMENT', ?, 'REVERSE', ?, ?)`,
        [auditId, validActorId, deviceId, paymentId, JSON.stringify({ reason: reason.trim(), confirmed_by_server: true }), now]
      );
      // NOTE: Intentionally NO insert into sync_outbox
    });
  }

  public static async getPaymentsByStudent(
    studentId: string,
    semesterId?: string,
    adapter?: DatabaseAdapter
  ): Promise<PaymentRecord[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      let query = supabase.from('payments').select('*').eq('student_id', studentId);
      if (semesterId) query = query.eq('semester_id', semesterId);
      const { data, error } = await query.order('processed_at', { ascending: false });
      if (error) throw new Error(`Failed to query payments from Supabase: ${error.message}`);
      return (data || []) as PaymentRecord[];
    }

    const db = await this.getDb(adapter);
    let sql = 'SELECT * FROM payments WHERE student_id = ?';
    const params: unknown[] = [studentId];
    if (semesterId) {
      sql += ' AND semester_id = ?';
      params.push(semesterId);
    }
    sql += ' ORDER BY processed_at DESC';
    return db.query<PaymentRecord>(sql, params);
  }

  public static async getAllPayments(
    semesterId?: string,
    adapter?: DatabaseAdapter
  ): Promise<PaymentWithAllocations[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      let query = supabase.from('payments').select('*').order('processed_at', { ascending: false });
      if (semesterId) query = query.eq('semester_id', semesterId);
      const { data: payments, error } = await query;
      if (error) throw new Error(`Failed to query payments from Supabase: ${error.message}`);

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
      const stuMap = new Map<string, any>();
      if (studentIds.length > 0) {
        const { data: stuData } = await supabase.from('students').select('id, school_id, first_name, last_name').in('id', studentIds);
        for (const s of (stuData || [])) stuMap.set(s.id, s);
      }

      return (payments || []).map((p: any) => {
        const s = stuMap.get(p.student_id);
        const pAllocs = allocsByPayId.get(p.id) || [];
        return {
          ...p,
          school_id: s?.school_id,
          first_name: s?.first_name,
          last_name: s?.last_name,
          allocations: pAllocs.map((a: any) => ({
            id: a.id,
            obligation_id: a.obligation_id,
            amount_centavos: Number(a.amount_centavos),
            obligation_title: a.obligation_title,
            obligation_type: a.obligation_type,
          })),
        };
      });
    }

    const db = await this.getDb(adapter);
    let sql = `
      SELECT p.*, s.school_id, s.first_name, s.last_name
      FROM payments p
      JOIN students s ON s.id = p.student_id
    `;
    const params: unknown[] = [];
    if (semesterId) {
      sql += ' WHERE p.semester_id = ?';
      params.push(semesterId);
    }
    sql += ' ORDER BY p.processed_at DESC';

    const payments = await db.query<PaymentWithAllocations>(sql, params);

    // Fetch allocations for each payment
    for (const p of payments) {
      const allocs = await db.query<{
        id: string;
        obligation_id: string;
        amount_centavos: number;
        obligation_title: string;
        obligation_type: string;
      }>(
        `SELECT pa.id, pa.obligation_id, pa.amount_centavos, so.title as obligation_title, so.type as obligation_type
         FROM payment_allocations pa
         JOIN student_obligations so ON so.id = pa.obligation_id
         WHERE pa.payment_id = ?`,
        [p.id]
      );
      p.allocations = allocs;
    }

    return payments;
  }

  public static async getPaymentById(
    paymentId: string,
    adapter?: DatabaseAdapter
  ): Promise<PaymentWithAllocations | null> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data: p, error } = await supabase.from('payments').select('*').eq('id', paymentId).maybeSingle();
      if (error || !p) return null;

      const [allocsRes, stuRes] = await Promise.all([
        supabase.from('payment_allocations').select('*').eq('payment_id', paymentId),
        supabase.from('students').select('id, school_id, first_name, last_name').eq('id', p.student_id).maybeSingle(),
      ]);

      const obIds = Array.from(new Set((allocsRes.data || []).map((a: any) => a.obligation_id).filter(Boolean)));
      const obMap = new Map<string, any>();
      if (obIds.length > 0) {
        const { data: obData } = await supabase.from('student_obligations').select('id, title, type').in('id', obIds);
        for (const ob of obData || []) obMap.set(ob.id, ob);
      }

      return {
        ...p,
        school_id: stuRes.data?.school_id,
        first_name: stuRes.data?.first_name,
        last_name: stuRes.data?.last_name,
        allocations: (allocsRes.data || []).map((a: any) => {
          const ob = obMap.get(a.obligation_id);
          return {
            id: a.id,
            obligation_id: a.obligation_id,
            amount_centavos: Number(a.amount_centavos),
            obligation_title: ob?.title,
            obligation_type: ob?.type,
          };
        }),
      };
    }

    const db = await this.getDb(adapter);
    const payment = await db.queryOne<PaymentWithAllocations>(
      `SELECT p.*, s.school_id, s.first_name, s.last_name
       FROM payments p
       JOIN students s ON s.id = p.student_id
       WHERE p.id = ?`,
      [paymentId]
    );
    if (!payment) return null;

    const allocs = await db.query<{
      id: string;
      obligation_id: string;
      amount_centavos: number;
      obligation_title: string;
      obligation_type: string;
    }>(
      `SELECT pa.id, pa.obligation_id, pa.amount_centavos, so.title as obligation_title, so.type as obligation_type
       FROM payment_allocations pa
       JOIN student_obligations so ON so.id = pa.obligation_id
       WHERE pa.payment_id = ?`,
      [payment.id]
    );
    payment.allocations = allocs;
    return payment;
  }

  // ==========================================================================
  // --- 8. DEPRECATED WALLET METHODS (PRESERVED FOR BACKWARD COMPATIBILITY) ---
  // ==========================================================================

  /** @deprecated UniTap 2.0 uses direct cash/transfer payment records instead of simulated wallet */
  public static async getOrCreateWallet(studentId: string, adapter?: DatabaseAdapter): Promise<SimulatedWalletRecord> {
    const db = await this.getDb(adapter);
    const existing = await db.queryOne<SimulatedWalletRecord>(
      'SELECT * FROM simulated_wallets WHERE student_id = ?',
      [studentId]
    );
    if (existing) return existing;

    const newWallet: SimulatedWalletRecord = {
      id: 'wal_' + Math.random().toString(36).substring(2, 10),
      student_id: studentId,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
    };
    await db.execute(
      'INSERT INTO simulated_wallets (id, student_id, status, created_at) VALUES (?, ?, ?, ?)',
      [newWallet.id, newWallet.student_id, newWallet.status, newWallet.created_at]
    );
    return newWallet;
  }

  /** @deprecated UniTap 2.0 uses direct cash/transfer payment records instead of simulated wallet */
  public static async getWalletBalance(walletId: string, adapter?: DatabaseAdapter): Promise<number> {
    const db = await this.getDb(adapter);
    const rows = await db.query<{ kind: string; amount_centavos: number }>(
      'SELECT kind, amount_centavos FROM simulated_wallet_ledger WHERE wallet_id = ?',
      [walletId]
    );
    let balance = 0;
    for (const row of rows) {
      if (row.kind === 'TOP_UP' || row.kind === 'PAYMENT_REVERSAL' || row.kind === 'ADJUSTMENT_CREDIT') {
        balance += row.amount_centavos;
      } else if (row.kind === 'PAYMENT' || row.kind === 'TOPUP_REVERSAL' || row.kind === 'ADJUSTMENT_DEBIT') {
        balance -= row.amount_centavos;
      }
    }
    return Math.max(0, balance);
  }

  /** @deprecated UniTap 2.0 uses direct cash/transfer payment records instead of simulated wallet */
  public static async topUpWallet(
    studentId: string,
    amountCentavos: number,
    processedByUserId: string,
    referenceNumber: string,
    adapter?: DatabaseAdapter
  ): Promise<number> {
    if (amountCentavos <= 0 || !Number.isInteger(amountCentavos)) {
      throw new Error('Top-up amount must be a positive integer in centavos.');
    }
    const db = await this.getDb(adapter);
    return db.transaction(async (tx) => {
      const wallet = await this.getOrCreateWallet(studentId, tx);
      const ledgerId = 'led_top_' + Math.random().toString(36).substring(2, 10);
      const now = new Date().toISOString();
      await tx.execute(
        `INSERT INTO simulated_wallet_ledger (
          id, wallet_id, kind, amount_centavos, reference_number, processed_by_user_id, created_at
        ) VALUES (?, ?, 'TOP_UP', ?, ?, ?, ?)`,
        [ledgerId, wallet.id, amountCentavos, referenceNumber, processedByUserId, now]
      );
      return this.getWalletBalance(wallet.id, tx);
    });
  }
}
