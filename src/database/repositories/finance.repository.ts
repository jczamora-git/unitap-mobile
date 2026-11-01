import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type {
  ObligationRule,
  StudentObligation,
  PaymentRecord,
  SimulatedWalletRecord,
  EventOccurrenceRecord,
  EventRecord,
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

  // ==========================================================================
  // --- 1. OBLIGATION RULES ---
  // ==========================================================================

  public static async createRule(rule: ObligationRule, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    const { deviceId, validActorId } = await this.ensureDeviceAndActor(db, rule.created_by_user_id, rule.created_at);

    await db.execute(
      `INSERT INTO obligation_rules (
        id, semester_id, name, type, trigger_type, default_amount_centavos, due_on, status, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rule.id,
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
    await db.execute(
      `INSERT INTO sync_outbox (
        id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
      ) VALUES (?, ?, 'OBLIGATION_RULE', ?, 'CREATE', ?, 1, ?, 0)`,
      [outboxId, deviceId, rule.id, JSON.stringify(rule), rule.created_at]
    );
  }

  public static async getRulesBySemester(semesterId: string, adapter?: DatabaseAdapter): Promise<ObligationRule[]> {
    const db = await this.getDb(adapter);
    return db.query<ObligationRule>(
      'SELECT * FROM obligation_rules WHERE semester_id = ? AND status = ? ORDER BY created_at DESC',
      [semesterId, 'ACTIVE']
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
          obligation.issued_at,
          obligation.updated_at,
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
   * 1. Occurrence must be CLOSED (attendance finalized).
   * 2. Student is in event_participants with attendance_required = 1.
   * 3. Student has excused = 0.
   * 4. Student has NO attendance record with status IN ('PRESENT', 'LATE', 'EXCUSED')
   *    (Voided attendance does not count as attendance).
   * 5. Checks whether student is already fined for this occurrence and rule.
   */
  public static async getAbsenteeCandidates(
    occurrenceId: string,
    ruleId?: string,
    adapter?: DatabaseAdapter
  ): Promise<{
    summary: OccurrenceAbsenteeSummary;
    candidates: AbsenteeCandidate[];
  }> {
    const db = await this.getDb(adapter);

    // 1. Fetch occurrence and parent event
    const occ = await db.queryOne<EventOccurrenceRecord & { event_title: string; semester_id: string }>(
      `SELECT o.*, e.title as event_title, e.semester_id
       FROM event_occurrences o
       JOIN events e ON e.id = o.event_id
       WHERE o.id = ?`,
      [occurrenceId]
    );
    if (!occ) {
      throw new Error(`Occurrence ${occurrenceId} not found.`);
    }

    // 2. Fetch participant stats
    const totalRequiredRow = await db.queryOne<{ count: number }>(
      `SELECT count(*) as count FROM event_participants
       WHERE occurrence_id = ? AND attendance_required = 1`,
      [occurrenceId]
    );
    const totalRequired = totalRequiredRow?.count || 0;

    const excusedRosterRow = await db.queryOne<{ count: number }>(
      `SELECT count(*) as count FROM event_participants
       WHERE occurrence_id = ? AND excused = 1`,
      [occurrenceId]
    );
    const excusedRosterCount = excusedRosterRow?.count || 0;

    // 3. Attendance breakdown
    const attendanceStats = await db.query<{ status: string; count: number }>(
      `SELECT status, count(*) as count
       FROM attendance_records
       WHERE occurrence_id = ?
       GROUP BY status`,
      [occurrenceId]
    );

    let presentCount = 0;
    let lateCount = 0;
    let excusedAttendanceCount = 0;

    for (const stat of attendanceStats) {
      if (stat.status === 'PRESENT') presentCount = stat.count;
      else if (stat.status === 'LATE') lateCount = stat.count;
      else if (stat.status === 'EXCUSED') excusedAttendanceCount = stat.count;
    }

    const totalExcused = excusedRosterCount + excusedAttendanceCount;

    // 4. Query Absentees using authoritative SQL logic
    // Parameterized and accounts for voided attendance, excuses, and existing fines
    const sql = `
      SELECT
        s.id AS student_id,
        s.school_id,
        (s.last_name || ', ' || s.first_name || (CASE WHEN s.middle_name IS NOT NULL AND length(trim(s.middle_name)) > 0 THEN ' ' || s.middle_name ELSE '' END)) AS full_name,
        COALESCE(se.year_level, 1) AS year_level,
        COALESCE(se.section, 'N/A') AS section,
        ep.occurrence_id,
        ep.attendance_required,
        ep.excused,
        (
          SELECT COUNT(*)
          FROM student_obligations so
          WHERE so.student_id = ep.student_id
            AND so.related_occurrence_id = ep.occurrence_id
            AND so.status = 'ACTIVE'
            AND (? IS NULL OR so.rule_id = ?)
        ) AS already_fined_count
      FROM event_participants ep
      JOIN students s ON s.id = ep.student_id
      JOIN event_occurrences eo ON eo.id = ep.occurrence_id
      JOIN events ev ON ev.id = eo.event_id
      LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.semester_id = ev.semester_id
      WHERE ep.occurrence_id = ?
        AND ep.attendance_required = 1
        AND ep.excused = 0
        AND NOT EXISTS (
          SELECT 1
          FROM attendance_records ar
          WHERE ar.occurrence_id = ep.occurrence_id
            AND ar.student_id = ep.student_id
            AND ar.status IN ('PRESENT', 'LATE', 'EXCUSED')
        )
      ORDER BY se.year_level ASC, se.section ASC, s.last_name ASC, s.first_name ASC
    `;

    const rows = await db.query<{
      student_id: string;
      school_id: string;
      full_name: string;
      year_level: number;
      section: string;
      occurrence_id: string;
      attendance_required: number;
      excused: number;
      already_fined_count: number;
    }>(sql, [ruleId || null, ruleId || null, occurrenceId]);

    const candidates: AbsenteeCandidate[] = rows.map((r) => {
      const alreadyFined = r.already_fined_count > 0;
      return {
        studentId: r.student_id,
        schoolId: r.school_id,
        fullName: r.full_name,
        yearLevel: r.year_level,
        section: r.section,
        occurrenceId: r.occurrence_id,
        attendanceRequired: r.attendance_required === 1,
        excused: r.excused === 1,
        alreadyFined,
        selected: !alreadyFined,
        attendanceStatus: 'ABSENT',
      };
    });

    const alreadyFinedCount = candidates.filter((c) => c.alreadyFined).length;
    const eligibleForFineCount = candidates.filter((c) => !c.alreadyFined).length;
    const absentCount = candidates.length;

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
      absentCount,
      alreadyFinedCount,
      eligibleForFineCount,
      isAuthoritativeRosterFinalized: totalRequired > 0,
    };

    return { summary, candidates };
  }

  // ==========================================================================
  // --- 4. BULK FINE ASSESSMENT ---
  // ==========================================================================

  public static async assessBulkFines(
    params: {
      occurrenceId: string;
      ruleId: string;
      fineTitle: string;
      amountCentavos: number;
      dueDate?: string | null;
      studentIds: string[];
      notes?: string | null;
      actorUserId: string;
    },
    adapter?: DatabaseAdapter
  ): Promise<BulkFineAssessmentResult> {
    if (!params.studentIds || params.studentIds.length === 0) {
      throw new Error('At least one student must be selected for bulk fine assessment.');
    }
    if (params.amountCentavos <= 0 || !Number.isInteger(params.amountCentavos)) {
      throw new Error('Fine amount must be a positive integer in centavos.');
    }

    const db = await this.getDb(adapter);

    // 1. Occurrence must exist and be CLOSED
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

    // 2. Validate Rule
    const rule = await db.queryOne<ObligationRule>('SELECT * FROM obligation_rules WHERE id = ?', [params.ruleId]);
    if (!rule) {
      throw new Error('Obligation fine rule not found.');
    }

    const batchId = 'batch_' + Math.random().toString(36).substring(2, 10);
    const now = new Date().toISOString();

    const createdObligations: StudentObligationItem[] = [];
    let assessedCount = 0;
    let skippedCount = 0;
    let invalidCount = 0;

    await db.transaction(async (tx) => {
      const { deviceId, validActorId } = await this.ensureDeviceAndActor(tx, params.actorUserId, now);

      for (const studentId of params.studentIds) {
        // A. Verify student belongs to required roster
        const participant = await tx.queryOne<{ attendance_required: number; excused: number }>(
          `SELECT attendance_required, excused FROM event_participants
           WHERE occurrence_id = ? AND student_id = ?`,
          [params.occurrenceId, studentId]
        );

        if (!participant || participant.attendance_required !== 1 || participant.excused === 1) {
          invalidCount++;
          continue;
        }

        // B. Verify student has NO valid attendance
        const validAttendance = await tx.queryOne<{ id: string }>(
          `SELECT id FROM attendance_records
           WHERE occurrence_id = ? AND student_id = ? AND status IN ('PRESENT', 'LATE', 'EXCUSED')`,
          [params.occurrenceId, studentId]
        );
        if (validAttendance) {
          invalidCount++;
          continue;
        }

        // C. Check if already fined under same rule and occurrence
        const alreadyFined = await tx.queryOne<{ id: string }>(
          `SELECT id FROM student_obligations
           WHERE student_id = ? AND rule_id = ? AND related_occurrence_id = ? AND status = 'ACTIVE'`,
          [studentId, params.ruleId, params.occurrenceId]
        );
        if (alreadyFined) {
          skippedCount++;
          continue;
        }

        // D. Create student obligation
        const obligationId = 'ob_' + Math.random().toString(36).substring(2, 10);
        await tx.execute(
          `INSERT INTO student_obligations (
            id, student_id, semester_id, rule_id, related_event_id, related_occurrence_id,
            title, type, amount_centavos, status, due_date, issued_by_user_id, batch_id, issued_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'FINE', ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
          [
            obligationId,
            studentId,
            occ.semester_id,
            params.ruleId,
            occ.event_id,
            params.occurrenceId,
            params.fineTitle || rule.name,
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
              rule_id: params.ruleId,
              related_event_id: occ.event_id,
              related_occurrence_id: params.occurrenceId,
              title: params.fineTitle || rule.name,
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
          ruleId: params.ruleId,
          relatedEventId: occ.event_id,
          relatedOccurrenceId: params.occurrenceId,
          title: params.fineTitle || rule.name,
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
            rule_id: params.ruleId,
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
      targetScope: 'ALL' | 'YEAR_LEVEL' | 'SECTION' | 'INDIVIDUAL';
      yearLevels?: number[];
      sections?: string[];
      studentIds?: string[];
      notes?: string | null;
      actorUserId: string;
    },
    adapter?: DatabaseAdapter
  ): Promise<BulkContributionResult> {
    if (!params.title || !params.title.trim()) {
      throw new Error('Contribution title is required.');
    }
    if (params.amountCentavos <= 0 || !Number.isInteger(params.amountCentavos)) {
      throw new Error('Contribution amount must be a positive integer in centavos.');
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

      if (params.targetScope === 'YEAR_LEVEL' && params.yearLevels && params.yearLevels.length > 0) {
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

        const obligationId = 'ob_' + Math.random().toString(36).substring(2, 10);
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

  public static async getPaymentsByStudent(
    studentId: string,
    semesterId?: string,
    adapter?: DatabaseAdapter
  ): Promise<PaymentRecord[]> {
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
