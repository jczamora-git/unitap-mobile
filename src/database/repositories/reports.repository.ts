import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type { ReportExportRecord } from '../../types/database';

export interface StudentObligationReportRow {
  school_id: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  year_level: number;
  section: string;
  obligation_type: 'FINE' | 'CONTRIBUTION';
  title: string;
  assessed_centavos: number;
  paid_centavos: number;
  balance_centavos: number;
}

export interface CategorySummaryReportRow {
  type: 'FINE' | 'CONTRIBUTION';
  obligations_count: number;
  assessed_centavos: number;
  paid_centavos: number;
  outstanding_centavos: number;
}

export interface CombinedFinancialSummary {
  fines: {
    assessed_centavos: number;
    paid_centavos: number;
    outstanding_centavos: number;
    count: number;
  };
  contributions: {
    assessed_centavos: number;
    paid_centavos: number;
    outstanding_centavos: number;
    count: number;
  };
  overall_collected_centavos: number;
  overall_outstanding_centavos: number;
}

export class ReportsRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  // A. FINES and CONTRIBUTIONS per student for semester
  public static async getStudentObligationsReport(
    semesterId: string,
    filters?: { type?: 'FINE' | 'CONTRIBUTION'; yearLevel?: number; section?: string },
    adapter?: DatabaseAdapter
  ): Promise<StudentObligationReportRow[]> {
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
        WHERE p.status = 'POSTED' GROUP BY pa.obligation_id
      ),
      balances AS (
        SELECT o.id, o.student_id, o.semester_id, o.type, o.title,
               o.amount_centavos + COALESCE(a.change_centavos, 0) AS assessed_centavos,
               COALESCE(p.paid_centavos, 0) AS paid_centavos
        FROM student_obligations o
        LEFT JOIN adjustment_totals a ON a.obligation_id = o.id
        LEFT JOIN paid_totals p ON p.obligation_id = o.id
        WHERE o.semester_id = ? AND o.status = 'ACTIVE'
      )
      SELECT s.school_id, s.first_name, s.middle_name, s.last_name,
             COALESCE(e.year_level, 0) as year_level, COALESCE(e.section, 'N/A') as section,
             b.type AS obligation_type, b.title,
             b.assessed_centavos, b.paid_centavos,
             MAX(0, b.assessed_centavos - b.paid_centavos) AS balance_centavos
      FROM balances b
      JOIN students s ON s.id = b.student_id
      LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.semester_id = b.semester_id
      WHERE 1=1
    `;
    const params: unknown[] = [semesterId];

    if (filters?.type) {
      sql += ' AND b.type = ?';
      params.push(filters.type);
    }
    if (filters?.yearLevel !== undefined && filters?.yearLevel !== null) {
      sql += ' AND e.year_level = ?';
      params.push(filters.yearLevel);
    }
    if (filters?.section) {
      sql += ' AND e.section = ? COLLATE NOCASE';
      params.push(filters.section);
    }

    sql += ' ORDER BY b.type ASC, s.last_name ASC, s.first_name ASC, b.title ASC';
    return db.query<StudentObligationReportRow>(sql, params);
  }

  // B. Category summary (FINES vs CONTRIBUTIONS)
  public static async getCategorySummaryReport(
    semesterId: string,
    adapter?: DatabaseAdapter
  ): Promise<CategorySummaryReportRow[]> {
    const db = await this.getDb(adapter);
    const sql = `
      WITH a AS (
        SELECT obligation_id,
               SUM(CASE WHEN kind='ADDITION' THEN amount_centavos ELSE -amount_centavos END) d
        FROM obligation_adjustments GROUP BY obligation_id
      ),
      p AS (
        SELECT pa.obligation_id, SUM(pa.amount_centavos) paid
        FROM payment_allocations pa
        JOIN payments p ON p.id = pa.payment_id
        WHERE p.status = 'POSTED' GROUP BY pa.obligation_id
      )
      SELECT o.type, COUNT(*) AS obligations_count,
             COALESCE(SUM(o.amount_centavos + COALESCE(a.d, 0)), 0) AS assessed_centavos,
             COALESCE(SUM(COALESCE(p.paid, 0)), 0) AS paid_centavos,
             COALESCE(SUM(MAX(0, o.amount_centavos + COALESCE(a.d, 0) - COALESCE(p.paid, 0))), 0) AS outstanding_centavos
      FROM student_obligations o
      LEFT JOIN a ON a.obligation_id = o.id
      LEFT JOIN p ON p.obligation_id = o.id
      WHERE o.semester_id = ? AND o.status = 'ACTIVE'
      GROUP BY o.type
      ORDER BY o.type ASC
    `;
    return db.query<CategorySummaryReportRow>(sql, [semesterId]);
  }

  // C. Combined financial summary
  public static async getCombinedFinancialSummary(
    semesterId: string,
    adapter?: DatabaseAdapter
  ): Promise<CombinedFinancialSummary> {
    const rows = await this.getCategorySummaryReport(semesterId, adapter);
    const finesRow = rows.find((r) => r.type === 'FINE');
    const contributionsRow = rows.find((r) => r.type === 'CONTRIBUTION');

    const fines = {
      assessed_centavos: finesRow?.assessed_centavos || 0,
      paid_centavos: finesRow?.paid_centavos || 0,
      outstanding_centavos: finesRow?.outstanding_centavos || 0,
      count: finesRow?.obligations_count || 0,
    };

    const contributions = {
      assessed_centavos: contributionsRow?.assessed_centavos || 0,
      paid_centavos: contributionsRow?.paid_centavos || 0,
      outstanding_centavos: contributionsRow?.outstanding_centavos || 0,
      count: contributionsRow?.obligations_count || 0,
    };

    return {
      fines,
      contributions,
      overall_collected_centavos: fines.paid_centavos + contributions.paid_centavos,
      overall_outstanding_centavos: fines.outstanding_centavos + contributions.outstanding_centavos,
    };
  }

  // D. Log report export
  public static async logReportExport(
    report: ReportExportRecord,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO report_exports (
        id, semester_id, report_type, filters_json, totals_json, local_file_uri, generated_by_user_id, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        report.id,
        report.semester_id,
        report.report_type,
        report.filters_json,
        report.totals_json,
        report.local_file_uri || null,
        report.generated_by_user_id,
        report.generated_at,
      ]
    );
  }
}

