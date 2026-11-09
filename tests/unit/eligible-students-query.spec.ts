import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinanceRepository } from '@/database/repositories/finance.repository';
import { DataModeService } from '@/services/data-mode.service';
import { supabase } from '@/integrations/supabase/client';
import { getDatabase, resetDatabaseForTests } from '@/database/database';

describe('Eligible Students Outstanding Balance Query Specification', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Direct Supabase Mode', () => {
    beforeEach(() => {
      vi.spyOn(DataModeService, 'isDirectSupabase').mockReturnValue(true);
    });

    it('1. College Shirt unpaid students appear in eligible list', async () => {
      const mockObligations = [
        {
          id: 'ob-shirt-1',
          student_id: 'stu-shirt-1',
          rule_id: 'rule-college-shirt',
          type: 'CONTRIBUTION',
          amount_centavos: 35000,
          status: 'ACTIVE',
        },
      ];

      supabase.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'student_obligations') {
          return {
            select: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockObligations, error: null }),
          };
        }
        if (table === 'obligation_adjustments') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: [], error: null }),
          };
        }
        if (table === 'payment_allocations') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: [], error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ data: [], error: null }),
        };
      });

      const eligibleIds = await FinanceRepository.getStudentIdsWithOutstandingBalance({
        ruleId: 'rule-college-shirt',
      });

      expect(eligibleIds).toContain('stu-shirt-1');
    });

    it('2. Partial payments show correct remaining balance and keep student eligible', async () => {
      const mockObligations = [
        {
          id: 'ob-part-1',
          student_id: 'stu-part-1',
          rule_id: 'rule-shirt',
          type: 'CONTRIBUTION',
          amount_centavos: 50000,
          status: 'PARTIALLY_PAID',
        },
      ];

      const mockAllocations = [
        {
          obligation_id: 'ob-part-1',
          payment_id: 'pay-part-1',
          amount_centavos: 20000,
        },
      ];

      const mockPayments = [
        {
          id: 'pay-part-1',
          status: 'POSTED',
        },
      ];

      supabase.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'student_obligations') {
          return {
            select: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockObligations, error: null }),
          };
        }
        if (table === 'obligation_adjustments') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: [], error: null }),
          };
        }
        if (table === 'payment_allocations') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockAllocations, error: null }),
          };
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockPayments, error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ data: [], error: null }),
        };
      });

      const eligibleIds = await FinanceRepository.getStudentIdsWithOutstandingBalance({
        ruleId: 'rule-shirt',
      });

      expect(eligibleIds).toContain('stu-part-1');
    });

    it('3. Discounts and waivers reduce balance; full waiver excludes student', async () => {
      const mockObligations = [
        {
          id: 'ob-disc-1',
          student_id: 'stu-disc-1',
          type: 'CONTRIBUTION',
          amount_centavos: 30000,
          status: 'ACTIVE',
        },
        {
          id: 'ob-waived-1',
          student_id: 'stu-waived-1',
          type: 'CONTRIBUTION',
          amount_centavos: 25000,
          status: 'ACTIVE',
        },
      ];

      // Discount of 10000 on ob-disc-1 -> 20000 remaining (> 0)
      // Waiver of 25000 on ob-waived-1 -> 0 remaining (settled)
      const mockAdjustments = [
        {
          obligation_id: 'ob-disc-1',
          adjustment_type: 'DISCOUNT',
          amount_centavos: 10000,
        },
        {
          obligation_id: 'ob-waived-1',
          adjustment_type: 'WAIVE',
          amount_centavos: 25000,
        },
      ];

      supabase.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'student_obligations') {
          return {
            select: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockObligations, error: null }),
          };
        }
        if (table === 'obligation_adjustments') {
          return {
            select: vi.fn().mockImplementation((cols: string) => {
              expect(cols).toContain('adjustment_type');
              expect(cols).not.toContain('kind');
              return {
                in: vi.fn().mockReturnThis(),
                then: (resolve: any) => resolve({ data: mockAdjustments, error: null }),
              };
            }),
          };
        }
        if (table === 'payment_allocations') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: [], error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ data: [], error: null }),
        };
      });

      const eligibleIds = await FinanceRepository.getStudentIdsWithOutstandingBalance({
        category: 'CONTRIBUTION',
      });

      expect(eligibleIds).toContain('stu-disc-1');
      expect(eligibleIds).not.toContain('stu-waived-1');
    });

    it('4. Additional charges/penalties increase balance and keep student eligible', async () => {
      const mockObligations = [
        {
          id: 'ob-add-1',
          student_id: 'stu-add-1',
          type: 'FINE',
          amount_centavos: 10000,
          status: 'ACTIVE',
        },
      ];

      // Initially paid 10000, but penalty of 5000 added -> net balance 5000
      const mockAllocations = [
        {
          obligation_id: 'ob-add-1',
          payment_id: 'pay-add-1',
          amount_centavos: 10000,
        },
      ];

      const mockPayments = [
        {
          id: 'pay-add-1',
          status: 'POSTED',
        },
      ];

      const mockAdjustments = [
        {
          obligation_id: 'ob-add-1',
          adjustment_type: 'PENALTY',
          amount_centavos: 5000,
        },
      ];

      supabase.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'student_obligations') {
          return {
            select: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockObligations, error: null }),
          };
        }
        if (table === 'obligation_adjustments') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockAdjustments, error: null }),
          };
        }
        if (table === 'payment_allocations') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockAllocations, error: null }),
          };
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockPayments, error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ data: [], error: null }),
        };
      });

      const eligibleIds = await FinanceRepository.getStudentIdsWithOutstandingBalance({
        category: 'FINE',
      });

      expect(eligibleIds).toContain('stu-add-1');
    });

    it('5. Fully paid students and VOID obligations are excluded', async () => {
      const mockObligations = [
        {
          id: 'ob-paid-1',
          student_id: 'stu-paid-1',
          type: 'CONTRIBUTION',
          amount_centavos: 10000,
          status: 'PAID',
        },
        {
          id: 'ob-void-1',
          student_id: 'stu-void-1',
          type: 'CONTRIBUTION',
          amount_centavos: 10000,
          status: 'VOID',
        },
        {
          id: 'ob-active-1',
          student_id: 'stu-active-1',
          type: 'CONTRIBUTION',
          amount_centavos: 10000,
          status: 'ACTIVE',
        },
      ];

      supabase.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'student_obligations') {
          return {
            select: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockObligations, error: null }),
          };
        }
        if (table === 'obligation_adjustments') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: [], error: null }),
          };
        }
        if (table === 'payment_allocations') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: [], error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ data: [], error: null }),
        };
      });

      const eligibleIds = await FinanceRepository.getStudentIdsWithOutstandingBalance({
        category: 'CONTRIBUTION',
      });

      expect(eligibleIds).not.toContain('stu-paid-1');
      expect(eligibleIds).not.toContain('stu-void-1');
      expect(eligibleIds).toContain('stu-active-1');
    });

    it('6. Propagates query errors instead of returning empty results', async () => {
      supabase.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'student_obligations') {
          return {
            select: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: null, error: { message: 'Network connection failed' } }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ data: [], error: null }),
        };
      });

      await expect(
        FinanceRepository.getStudentIdsWithOutstandingBalance({ category: 'ALL' })
      ).rejects.toThrow('Failed to query student obligations for payment filtering: Network connection failed');
    });

    it('7. Propagates obligation_adjustments query errors', async () => {
      const mockObligations = [
        {
          id: 'ob-err-1',
          student_id: 'stu-err-1',
          type: 'CONTRIBUTION',
          amount_centavos: 10000,
          status: 'ACTIVE',
        },
      ];

      supabase.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'student_obligations') {
          return {
            select: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockObligations, error: null }),
          };
        }
        if (table === 'obligation_adjustments') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: null, error: { message: 'column obligation_adjustments.kind does not exist' } }),
          };
        }
        if (table === 'payment_allocations') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: [], error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ data: [], error: null }),
        };
      });

      await expect(
        FinanceRepository.getStudentIdsWithOutstandingBalance({ category: 'ALL' })
      ).rejects.toThrow('Failed to query obligation adjustments: column obligation_adjustments.kind does not exist');
    });
  });

  describe('Offline-First SQLite Mode', () => {
    it('8. Correctly computes outstanding balances with adjustments and allocations in SQLite', async () => {
      vi.spyOn(DataModeService, 'isDirectSupabase').mockReturnValue(false);
      await resetDatabaseForTests();
      const adapter = await getDatabase();

      // Seed academic year and semester
      const now = new Date().toISOString();
      await adapter.execute(
        `INSERT INTO academic_years (id, label, starts_on, ends_on, status)
         VALUES ('ay-1', '2026-2027', '2026-08-01', '2027-06-01', 'ACTIVE')`
      );
      await adapter.execute(
        `INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
         VALUES ('sem-test', 'ay-1', 'FIRST', '2026-08-01', '2026-12-31', 'ACTIVE')`
      );

      // Seed user for authorized_by_user_id
      await adapter.execute(
        `INSERT INTO users (id, username, account_status, created_at, updated_at)
         VALUES ('user-test-1', 'testadmin', 'ACTIVE', ?, ?)`,
        [now, now]
      );

      // Seed students
      await adapter.execute(
        `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
         VALUES ('stu-sqlite-1', '2026-0001', 'Juan', 'Dela Cruz', 'ACTIVE', ?, ?)`,
        [now, now]
      );
      await adapter.execute(
        `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
         VALUES ('stu-sqlite-2', '2026-0002', 'Maria', 'Santos', 'ACTIVE', ?, ?)`,
        [now, now]
      );

      // Seed obligations:
      // stu-sqlite-1: 50000 centavos, ACTIVE
      // stu-sqlite-2: 30000 centavos, ACTIVE
      await adapter.execute(
        `INSERT INTO student_obligations (id, student_id, semester_id, title, type, amount_centavos, status, issued_at, updated_at)
         VALUES ('ob-sql-1', 'stu-sqlite-1', 'sem-test', 'Membership', 'CONTRIBUTION', 50000, 'ACTIVE', ?, ?)`,
        [now, now]
      );
      await adapter.execute(
        `INSERT INTO student_obligations (id, student_id, semester_id, title, type, amount_centavos, status, issued_at, updated_at)
         VALUES ('ob-sql-2', 'stu-sqlite-2', 'sem-test', 'Shirt Fee', 'CONTRIBUTION', 30000, 'ACTIVE', ?, ?)`,
        [now, now]
      );

      // stu-sqlite-2 receives full waiver reduction (30000)
      await adapter.execute(
        `INSERT INTO obligation_adjustments (id, obligation_id, kind, amount_centavos, reason, approved_by_user_id, created_at)
         VALUES ('adj-sql-1', 'ob-sql-2', 'REDUCTION', 30000, 'Scholarship waiver', 'user-test-1', ?)`,
        [now]
      );

      const eligible = await FinanceRepository.getStudentIdsWithOutstandingBalance(
        { category: 'CONTRIBUTION', semesterId: 'sem-test' },
        adapter
      );

      expect(eligible).toContain('stu-sqlite-1');
      expect(eligible).not.toContain('stu-sqlite-2');
    });
  });
});
