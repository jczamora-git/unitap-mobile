import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type {
  ObligationRule,
  StudentObligation,
  PaymentRecord,
  SimulatedWalletRecord,
} from '../../types/database';

export interface StudentObligationWithBalance extends StudentObligation {
  assessed_centavos: number;
  paid_centavos: number;
  balance_centavos: number;
  school_id?: string;
  first_name?: string;
  last_name?: string;
}

export class FinanceRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  // --- OBLIGATION RULES ---
  public static async createRule(rule: ObligationRule, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
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
        rule.created_by_user_id || null,
        rule.created_at,
      ]
    );
  }

  public static async getRulesBySemester(semesterId: string, adapter?: DatabaseAdapter): Promise<ObligationRule[]> {
    const db = await this.getDb(adapter);
    return db.query<ObligationRule>(
      'SELECT * FROM obligation_rules WHERE semester_id = ? AND status = ? ORDER BY created_at DESC',
      [semesterId, 'ACTIVE']
    );
  }

  // --- STUDENT OBLIGATIONS ---
  public static async assessObligation(
    obligation: StudentObligation,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    if (obligation.amount_centavos < 0 || !Number.isInteger(obligation.amount_centavos)) {
      throw new Error('Obligation amount must be a non-negative integer in centavos.');
    }
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO student_obligations (
        id, student_id, semester_id, rule_id, related_occurrence_id,
        title, type, amount_centavos, status, issued_by_user_id, issued_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        obligation.id,
        obligation.student_id,
        obligation.semester_id,
        obligation.rule_id || null,
        obligation.related_occurrence_id || null,
        obligation.title,
        obligation.type,
        obligation.amount_centavos,
        obligation.status,
        obligation.issued_by_user_id || null,
        obligation.issued_at,
        obligation.updated_at,
      ]
    );
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
             o.amount_centavos + COALESCE(a.change_centavos, 0) AS assessed_centavos,
             COALESCE(p.paid_centavos, 0) AS paid_centavos,
             MAX(0, (o.amount_centavos + COALESCE(a.change_centavos, 0)) - COALESCE(p.paid_centavos, 0)) AS balance_centavos
      FROM student_obligations o
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

  // --- ADJUSTMENTS ---
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

  // --- PAYMENTS & ALLOCATIONS ---
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
      // 1. If SIMULATED_WALLET, verify wallet balance
      let wallet: SimulatedWalletRecord | null = null;
      if (payment.source === 'SIMULATED_WALLET') {
        wallet = await this.getOrCreateWallet(payment.student_id, tx);
        const balance = await this.getWalletBalance(wallet.id, tx);
        if (balance < payment.amount_centavos) {
          throw new Error(`Insufficient wallet balance. Available: ₱${(balance / 100).toFixed(2)}, Required: ₱${(payment.amount_centavos / 100).toFixed(2)}`);
        }
      }

      // 2. Insert payment first so child rows referencing payment.id succeed
      await tx.execute(
        `INSERT INTO payments (
          id, student_id, semester_id, reference_number, idempotency_key, amount_centavos,
          source, channel, status, processed_by_user_id, device_id, processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          payment.processed_by_user_id,
          payment.device_id || null,
          payment.processed_at,
        ]
      );

      // 3. Add ledger PAYMENT entry if simulated wallet
      if (payment.source === 'SIMULATED_WALLET' && wallet) {
        const ledgerId = 'led_' + Math.random().toString(36).substring(2, 10);
        await tx.execute(
          `INSERT INTO simulated_wallet_ledger (
            id, wallet_id, kind, amount_centavos, related_payment_id, reference_number, processed_by_user_id, created_at
          ) VALUES (?, ?, 'PAYMENT', ?, ?, ?, ?, ?)`,
          [
            ledgerId,
            wallet.id,
            payment.amount_centavos,
            payment.id,
            'WAL-' + payment.reference_number,
            payment.processed_by_user_id,
            payment.processed_at,
          ]
        );
      }

      // 4. Insert allocations
      for (const alloc of allocations) {
        if (alloc.amount_centavos <= 0) {
          throw new Error('Allocation amount must be positive.');
        }
        await tx.execute(
          `INSERT INTO payment_allocations (id, payment_id, obligation_id, amount_centavos)
           VALUES (?, ?, ?, ?)`,
          [alloc.id, payment.id, alloc.obligation_id, alloc.amount_centavos]
        );
      }
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
      await tx.execute(
        `UPDATE payments
         SET status = 'REVERSED', reversed_at = ?, reversed_by_user_id = ?, reversal_reason = ?
         WHERE id = ?`,
        [now, reversedByUserId, reason.trim(), paymentId]
      );

      // If simulated wallet, refund balance
      if (payment.source === 'SIMULATED_WALLET') {
        const wallet = await this.getOrCreateWallet(payment.student_id, tx);
        const ledgerId = 'led_rev_' + Math.random().toString(36).substring(2, 10);
        await tx.execute(
          `INSERT INTO simulated_wallet_ledger (
            id, wallet_id, kind, amount_centavos, related_payment_id, reference_number, processed_by_user_id, created_at
          ) VALUES (?, ?, 'PAYMENT_REVERSAL', ?, ?, ?, ?, ?)`,
          [
            ledgerId,
            wallet.id,
            payment.amount_centavos,
            payment.id,
            'REV-' + payment.reference_number,
            reversedByUserId,
            now,
          ]
        );
      }
    });
  }

  // --- SIMULATED WALLET ---
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
}
