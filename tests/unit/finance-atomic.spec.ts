import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { FinanceService } from '@/services/finance.service';
import { FinanceRepository } from '@/database/repositories/finance.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { PushSyncService } from '@/services/sync/push-sync.service';
import { ConflictService } from '@/services/sync/conflict.service';
import { supabase } from '@/integrations/supabase/client';
import type { PaymentRecord } from '@/types/database';

describe('UniTap 2.0: Atomic Server-Confirmed Finance Integrity (Phase 2A.3)', () => {
  let service: FinanceService;
  const semesterId = 'AY2627-S1';
  const studentId = '10000000-0000-4000-8000-000000000001';
  let fineId: string;

  beforeEach(async () => {
    await resetDatabaseForTests();
    service = new FinanceService();

    const db = await getDatabase();
    await db.execute(
      `INSERT INTO users (id, username, account_status, created_at, updated_at)
       VALUES ('officer_tester', 'officer_tester', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`
    );

    await db.execute(
      `INSERT INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_test', 'Test Device', 'DEV-TEST-001', 'ACTIVE', '2026-08-01T00:00:00Z')`
    );

    await AcademicRepository.createYear({
      id: 'AY2627',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });

    await AcademicRepository.createSemester({
      id: semesterId,
      academic_year_id: 'AY2627',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    await StudentsRepository.createStudent({
      id: studentId,
      school_id: 'MCC2026-1001',
      first_name: 'Juan',
      last_name: 'Luna',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const fine = await service.issueManualFine({
      studentId,
      semesterId,
      title: 'Lab Fee',
      amountCentavos: 5000,
      actorUserId: 'officer_tester',
    });
    fineId = fine.id;
  });

  it('Test 1: Server-confirmed payment posts to SQLite WITHOUT creating a fresh sync_outbox item', async () => {
    const db = await getDatabase();

    // Mock successful server confirmation
    (supabase.rpc as any) = vi.fn().mockImplementation(async (rpcName: string, params: any) => {
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
      return { data: null, error: null };
    });

    const paymentResult = await service.recordPayment({
      studentId,
      semesterId,
      amountCentavos: 5000,
      source: 'CASH',
      allocations: [{ obligationId: fineId, amountCentavos: 5000 }],
      actorUserId: 'officer_tester',
    });

    expect(paymentResult.paymentId).toBeDefined();
    expect(paymentResult.referenceNumber).toContain('PAY-');

    // Verify payment in SQLite is POSTED
    const payment = await db.queryOne<PaymentRecord>(
      'SELECT * FROM payments WHERE id = ?',
      [paymentResult.paymentId]
    );
    expect(payment).toBeDefined();
    expect(payment?.status).toBe('POSTED');

    // CRITICAL: Verify NO payment record was queued in sync_outbox
    const outboxPayment = await db.queryOne<{ count: number }>(
      "SELECT count(*) as count FROM sync_outbox WHERE entity_type = 'PAYMENT' AND entity_id = ?",
      [paymentResult.paymentId]
    );
    expect(outboxPayment?.count).toBe(0);

    // Verify receipt can be generated successfully
    const receipt = await service.generatePaymentReceipt(paymentResult.paymentId, 'Officer Tester');
    expect(receipt.referenceNumber).toBe(paymentResult.referenceNumber);
    expect(receipt.totalPaidCentavos).toBe(5000);
  });

  it('Test 2: Server rejection fails closed: no SQLite commit and no receipt issued', async () => {
    const db = await getDatabase();

    // Mock server rejection (e.g. permission denied or balance exceeded)
    (supabase.rpc as any) = vi.fn().mockImplementation(async () => {
      return {
        data: null,
        error: { message: 'Unauthorized: Officer lacks FINANCE permission.' },
      };
    });

    await expect(
      service.recordPayment({
        studentId,
        semesterId,
        amountCentavos: 5000,
        source: 'CASH',
        allocations: [{ obligationId: fineId, amountCentavos: 5000 }],
        actorUserId: 'officer_tester',
      })
    ).rejects.toThrowError(/Server payment recording failed: Unauthorized/);

    // Verify SQLite has zero payments recorded
    const paymentsCount = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM payments'
    );
    expect(paymentsCount?.count).toBe(0);

    // Verify student obligation remains UNPAID
    const obligations = await service.getStudentObligations(studentId, semesterId);
    expect(obligations[0].balanceCentavos).toBe(5000);
    expect(obligations[0].status).toBe('UNPAID');
  });

  it('Test 3: Idempotent server retry returns ALREADY_RECORDED and safely mirrors payment', async () => {
    const db = await getDatabase();
    const existingRef = 'PAY-20261106-EXISTING';
    const serverTime = '2026-11-06T00:00:00.000Z';

    // Mock server returning ALREADY_RECORDED
    (supabase.rpc as any) = vi.fn().mockImplementation(async (rpcName: string, params: any) => {
      if (rpcName === 'record_student_payment') {
        return {
          data: {
            success: true,
            status: 'ALREADY_RECORDED',
            payment_id: params.p_payment_id,
            reference_number: existingRef,
            amount_centavos: params.p_amount_centavos,
            processed_at: serverTime,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const result = await service.recordPayment({
      studentId,
      semesterId,
      amountCentavos: 5000,
      source: 'CASH',
      allocations: [{ obligationId: fineId, amountCentavos: 5000 }],
      actorUserId: 'officer_tester',
    });

    expect(result.referenceNumber).toBe(existingRef);

    // Verify local SQLite has the payment recorded
    const payment = await db.queryOne<PaymentRecord>(
      'SELECT * FROM payments WHERE reference_number = ?',
      [existingRef]
    );
    expect(payment).toBeDefined();
    expect(payment?.status).toBe('POSTED');
  });

  it('Test 4: Server-confirmed reversal updates SQLite status to REVERSED without outbox queue', async () => {
    const db = await getDatabase();

    // 1. First record a confirmed payment
    (supabase.rpc as any) = vi.fn().mockImplementation(async (rpcName: string, params: any) => {
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
    });

    const pay = await service.recordPayment({
      studentId,
      semesterId,
      amountCentavos: 5000,
      source: 'CASH',
      allocations: [{ obligationId: fineId, amountCentavos: 5000 }],
      actorUserId: 'officer_tester',
    });

    // 2. Reverse payment
    await service.reversePayment(pay.paymentId, 'Mistakenly collected', 'officer_tester');

    // 3. Verify SQLite payment status is REVERSED
    const payment = await db.queryOne<PaymentRecord>(
      'SELECT * FROM payments WHERE id = ?',
      [pay.paymentId]
    );
    expect(payment?.status).toBe('REVERSED');
    expect(payment?.reversal_reason).toBe('Mistakenly collected');

    // 4. Verify obligation balance is restored to 5000
    const obligations = await service.getStudentObligations(studentId, semesterId);
    expect(obligations[0].balanceCentavos).toBe(5000);
    expect(obligations[0].status).toBe('UNPAID');

    // 5. Verify NO reversal item was queued in sync_outbox
    const outboxReversal = await db.queryOne<{ count: number }>(
      "SELECT count(*) as count FROM sync_outbox WHERE entity_type = 'PAYMENT' AND operation = 'UPDATE'",
    );
    expect(outboxReversal?.count).toBe(0);
  });

  it('Test 5: PushSyncService safely pushes legacy outbox payments via atomic RPC and purges outbox on success', async () => {
    const db = await getDatabase();
    await db.execute('DELETE FROM sync_outbox');

    // 1. Enqueue a legacy payment directly into sync_outbox (simulating pre-Phase 2A outbox item)
    const legacyPayId = '00000000-0000-4000-8000-000000000001';
    const legacyOutboxId = 'op_legacy_pay_1';
    await db.execute(
      `INSERT INTO sync_outbox (
        id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
      ) VALUES (?, 'dev_test', 'PAYMENT', ?, 'CREATE', ?, 1, ?, 0)`,
      [
        legacyOutboxId,
        legacyPayId,
        JSON.stringify({
          payment: {
            id: legacyPayId,
            student_id: studentId,
            semester_id: semesterId,
            reference_number: 'PAY-LEGACY-001',
            idempotency_key: 'idemp_' + legacyPayId,
            amount_centavos: 5000,
            source: 'CASH_RECORDED',
            channel: 'MANUAL',
            status: 'POSTED',
            processed_by_user_id: 'officer_tester',
            processed_at: new Date().toISOString(),
          },
          allocations: [
            { id: '00000000-0000-4000-8000-000000000002', obligation_id: fineId, amount_centavos: 5000 }
          ],
        }),
        new Date().toISOString(),
      ]
    );

    // Mock batch push failing so it tests the table-by-table handler
    let rpcCalledWith: any = null;
    (supabase.rpc as any) = vi.fn().mockImplementation(async (rpcName: string, params: any) => {
      if (rpcName === 'sync_push_batch') {
        throw new Error('Batch RPC disabled for testing fallback');
      }
      if (rpcName === 'record_student_payment') {
        rpcCalledWith = params;
        return {
          data: {
            success: true,
            status: 'CONFIRMED',
            payment_id: params.p_payment_id,
            reference_number: params.p_reference_number,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const result = await PushSyncService.pushPendingOperations();
    expect(result.pushedCount).toBe(1);
    expect(result.errorCount).toBe(0);

    // Verify record_student_payment was called with atomic payload
    expect(rpcCalledWith).toBeDefined();
    expect(rpcCalledWith.p_payment_id).toBe(legacyPayId);
    expect(rpcCalledWith.p_allocations.length).toBe(1);

    // Verify the legacy outbox item was purged
    const outboxRemaining = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM sync_outbox WHERE id = ?',
      [legacyOutboxId]
    );
    expect(outboxRemaining?.count).toBe(0);
  });

  it('Test 6: PushSyncService preserves outbox and routes to sync_conflicts when server rejects over-allocated payment', async () => {
    const db = await getDatabase();
    await db.execute('DELETE FROM sync_outbox');
    const conflictSpy = vi.spyOn(ConflictService, 'recordConflict');

    // Enqueue an outbox item where obligation balance is already exhausted on server
    const conflictPayId = '00000000-0000-4000-8000-000000000099';
    const conflictOutboxId = 'op_conflict_pay_1';
    await db.execute(
      `INSERT INTO sync_outbox (
        id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
      ) VALUES (?, 'dev_test', 'PAYMENT', ?, 'CREATE', ?, 1, ?, 0)`,
      [
        conflictOutboxId,
        conflictPayId,
        JSON.stringify({
          payment: {
            id: conflictPayId,
            student_id: studentId,
            semester_id: semesterId,
            reference_number: 'PAY-CONFLICT-001',
            idempotency_key: 'idemp_' + conflictPayId,
            amount_centavos: 5000,
            source: 'CASH_RECORDED',
          },
          allocations: [{ id: '00000000-0000-4000-8000-000000000098', obligation_id: fineId, amount_centavos: 5000 }],
        }),
        new Date().toISOString(),
      ]
    );

    // Mock server returning balance exceeded error
    (supabase.rpc as any) = vi.fn().mockImplementation(async (rpcName: string) => {
      if (rpcName === 'sync_push_batch') {
        throw new Error('Batch RPC fallback');
      }
      if (rpcName === 'record_student_payment') {
        return {
          data: null,
          error: { message: 'Allocation of 5000 centavos exceeds remaining balance of 0 centavos for obligation' },
        };
      }
      return { data: null, error: null };
    });

    await PushSyncService.pushPendingOperations();

    // Verify conflict was recorded in sync_conflicts for DevAdmin review
    expect(conflictSpy).toHaveBeenCalled();
    const conflictArg = conflictSpy.mock.calls[0][0];
    expect(conflictArg.conflictType).toBe('PAYMENT_CONCURRENCY_CONFLICT');
    expect(conflictArg.entityId).toBe(conflictPayId);

    // Verify conflict was safely persisted in SQLite sync_conflicts table
    const storedConflict = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM sync_conflicts WHERE entity_id = ?',
      [conflictPayId]
    );
    expect(storedConflict?.count).toBe(1);
  });

  it('Test 7: Client validates strictly positive integer centavos before network submission', async () => {
    // Zero amount
    await expect(
      service.recordPayment({
        studentId,
        semesterId,
        amountCentavos: 0,
        source: 'CASH',
        allocations: [{ obligationId: fineId, amountCentavos: 0 }],
        actorUserId: 'officer_tester',
      })
    ).rejects.toThrowError(/greater than zero/);

    // Negative amount
    await expect(
      service.recordPayment({
        studentId,
        semesterId,
        amountCentavos: -100,
        source: 'CASH',
        allocations: [{ obligationId: fineId, amountCentavos: -100 }],
        actorUserId: 'officer_tester',
      })
    ).rejects.toThrowError(/greater than zero/);

    // Allocations mismatch total
    await expect(
      service.recordPayment({
        studentId,
        semesterId,
        amountCentavos: 5000,
        source: 'CASH',
        allocations: [{ obligationId: fineId, amountCentavos: 3000 }],
        actorUserId: 'officer_tester',
      })
    ).rejects.toThrowError(/must match payment amount/);
  });

  it('Test 8: Network drop / timeout fails closed without SQLite write, subsequent retry recovers transaction', async () => {
    const db = await getDatabase();
    let networkFailed = true;

    // Simulate network drop on first attempt, recovery on second attempt
    (supabase.rpc as any) = vi.fn().mockImplementation(async (rpcName: string, params: any) => {
      if (rpcName === 'record_student_payment') {
        if (networkFailed) {
          throw new Error('TypeError: Failed to fetch (Network request timeout)');
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
    });

    // First attempt fails with network error
    await expect(
      service.recordPayment({
        studentId,
        semesterId,
        amountCentavos: 5000,
        source: 'CASH',
        allocations: [{ obligationId: fineId, amountCentavos: 5000 }],
        actorUserId: 'officer_tester',
      })
    ).rejects.toThrowError(/Failed to fetch/);

    // Ensure zero records written to SQLite
    const paymentsCount = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM payments'
    );
    expect(paymentsCount?.count).toBe(0);

    // Network recovers: second attempt succeeds
    networkFailed = false;
    const retryResult = await service.recordPayment({
      studentId,
      semesterId,
      amountCentavos: 5000,
      source: 'CASH',
      allocations: [{ obligationId: fineId, amountCentavos: 5000 }],
      actorUserId: 'officer_tester',
    });

    expect(retryResult.paymentId).toBeDefined();
    const finalPaymentsCount = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM payments'
    );
    expect(finalPaymentsCount?.count).toBe(1);
  });

  it('Test 9: Missing RPC (deployment order / PGRST202) surfaces actionable update-in-progress error', async () => {
    (supabase.rpc as any) = vi.fn().mockImplementation(async (rpcName: string) => {
      if (rpcName === 'record_student_payment') {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find the function public.record_student_payment in schema cache',
          },
        };
      }
      return { data: null, error: null };
    });

    await expect(
      service.recordPayment({
        studentId,
        semesterId,
        amountCentavos: 5000,
        source: 'CASH',
        allocations: [{ obligationId: fineId, amountCentavos: 5000 }],
        actorUserId: 'officer_tester',
      })
    ).rejects.toThrowError('Payment system server update in progress. Please contact system administrator.');
  });

  it('Test 10: Unsupported or retired payment sources (e.g. SIMULATED_WALLET) are rejected immediately', async () => {
    await expect(
      service.recordPayment({
        studentId,
        semesterId,
        amountCentavos: 5000,
        source: 'SIMULATED_WALLET' as any,
        allocations: [{ obligationId: fineId, amountCentavos: 5000 }],
        actorUserId: 'officer_tester',
      })
    ).rejects.toThrowError(/Unsupported payment source/);
  });

  it('Test 11: Client idempotency identifier reuse preserves keys and payment ID on retry', async () => {
    const customPaymentId = '11111111-2222-4333-8444-555555555555';
    const customRef = 'PAY-RETRY-001';
    const customIdemp = 'idemp_custom_retry_key';

    let transmittedParams: any = null;
    (supabase.rpc as any) = vi.fn().mockImplementation(async (rpcName: string, params: any) => {
      if (rpcName === 'record_student_payment') {
        transmittedParams = params;
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
    });

    const res = await service.recordPayment({
      studentId,
      semesterId,
      amountCentavos: 5000,
      source: 'CASH',
      allocations: [{ obligationId: fineId, amountCentavos: 5000 }],
      actorUserId: 'officer_tester',
      paymentId: customPaymentId,
      referenceNumber: customRef,
      idempotencyKey: customIdemp,
    });

    expect(res.paymentId).toBe(customPaymentId);
    expect(res.referenceNumber).toBe(customRef);
    expect(transmittedParams.p_payment_id).toBe(customPaymentId);
    expect(transmittedParams.p_reference_number).toBe(customRef);
    expect(transmittedParams.p_idempotency_key).toBe(customIdemp);
  });

  it('Test 12: PushSyncService detects legacy non-UUID payments and safely routes them to sync_conflicts', async () => {
    const db = await getDatabase();
    await db.execute('DELETE FROM sync_outbox');
    const conflictSpy = vi.spyOn(ConflictService, 'recordConflict');

    // Enqueue an outbox item with legacy string ID (non-UUID)
    const legacyNonUuidId = 'pay_legacy_abc123';
    const legacyOutboxId = 'op_legacy_non_uuid';
    await db.execute(
      `INSERT INTO sync_outbox (
        id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at, retry_count
      ) VALUES (?, 'dev_test', 'PAYMENT', ?, 'CREATE', ?, 1, ?, 0)`,
      [
        legacyOutboxId,
        legacyNonUuidId,
        JSON.stringify({
          payment: {
            id: legacyNonUuidId,
            student_id: studentId,
            semester_id: semesterId,
            reference_number: 'PAY-LEGACY-NONUUID',
            amount_centavos: 5000,
            source: 'CASH_RECORDED',
          },
          allocations: [{ id: 'alloc_legacy_1', obligation_id: fineId, amount_centavos: 5000 }],
        }),
        new Date().toISOString(),
      ]
    );

    (supabase.rpc as any) = vi.fn().mockImplementation(async (rpcName: string) => {
      if (rpcName === 'sync_push_batch') throw new Error('Batch fallback');
      return { data: null, error: null };
    });

    const pushRes = await PushSyncService.pushPendingOperations();
    expect(pushRes.pushedCount).toBe(1);
    expect(pushRes.errorCount).toBe(0);

    // Verify conflict was recorded
    expect(conflictSpy).toHaveBeenCalled();
    const conflictArg = conflictSpy.mock.calls[conflictSpy.mock.calls.length - 1][0];
    expect(conflictArg.conflictType).toBe('LEGACY_UNSUPPORTED_PAYMENT_PAYLOAD');

    // Verify outbox item was purged so sync does not get blocked forever
    const outboxRemaining = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM sync_outbox WHERE id = ?',
      [legacyOutboxId]
    );
    expect(outboxRemaining?.count).toBe(0);
  });
});
