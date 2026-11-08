import { ReportsRepository, type StudentObligationReportRow, type CategorySummaryReportRow, type CombinedFinancialSummary } from '../database/repositories/reports.repository';
import { formatCentavosToPesos } from '@/utilities/finance-formatters';
import { DataModeService } from './data-mode.service';
import { supabase } from '@/integrations/supabase/client';

export interface ReportFilterOptions {
  semesterId: string;
  type?: 'FINE' | 'CONTRIBUTION';
  yearLevel?: number;
  section?: string;
}

export class ReportService {
  public static async getObligationsReport(filters: ReportFilterOptions): Promise<StudentObligationReportRow[]> {
    if (DataModeService.isDirectSupabase()) {
      let query = supabase
        .from('student_obligations')
        .select('*')
        .eq('semester_id', filters.semesterId);

      if (filters.type) {
        query = query.eq('type', filters.type);
      }

      const { data: obs, error } = await query;
      if (error) {
        throw new Error(`Failed to query financial report from Supabase: ${error.message}`);
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

      const studentIds = Array.from(new Set((obs || []).map((o: any) => o.student_id).filter(Boolean)));
      const [studentsRes, enrollmentsRes] = await Promise.all([
        studentIds.length > 0
          ? supabase.from('students').select('id, school_id, first_name, middle_name, last_name').in('id', studentIds)
          : Promise.resolve({ data: [] }),
        studentIds.length > 0
          ? supabase.from('student_enrollments').select('*').eq('semester_id', filters.semesterId).in('student_id', studentIds)
          : Promise.resolve({ data: [] }),
      ]);

      const studentMap = new Map<string, any>();
      for (const s of (studentsRes.data || [])) studentMap.set(s.id, s);

      const enrollmentMap = new Map<string, any>();
      for (const e of (enrollmentsRes.data || [])) enrollmentMap.set(e.student_id, e);

      const rows: StudentObligationReportRow[] = [];
      for (const row of (obs || []) as any[]) {
        const student = studentMap.get(row.student_id);
        if (!student) continue;
        const enr = enrollmentMap.get(row.student_id);

        if (filters.yearLevel && enr?.year_level !== filters.yearLevel) continue;
        if (filters.section && enr?.section?.toLowerCase() !== filters.section.toLowerCase()) continue;

        const paid = paidByObId.get(row.id) || 0;
        const assessed = Number(row.amount_centavos || 0);
        const balance = Math.max(0, assessed - paid);

        rows.push({
          school_id: student.school_id,
          first_name: student.first_name,
          middle_name: student.middle_name,
          last_name: student.last_name,
          year_level: enr?.year_level || 1,
          section: enr?.section || '1A',
          obligation_type: row.type,
          title: row.title,
          assessed_centavos: assessed,
          paid_centavos: paid,
          balance_centavos: balance,
        });
      }
      return rows;
    }

    return ReportsRepository.getStudentObligationsReport(filters.semesterId, {
      type: filters.type,
      yearLevel: filters.yearLevel,
      section: filters.section,
    });
  }

  public static async getCategorySummary(semesterId: string): Promise<CategorySummaryReportRow[]> {
    if (DataModeService.isDirectSupabase()) {
      const rows = await this.getObligationsReport({ semesterId });
      const fines = rows.filter((r) => r.obligation_type === 'FINE');
      const contribs = rows.filter((r) => r.obligation_type === 'CONTRIBUTION');

      const sumCat = (items: StudentObligationReportRow[], type: 'FINE' | 'CONTRIBUTION'): CategorySummaryReportRow => ({
        type,
        obligations_count: items.length,
        assessed_centavos: items.reduce((sum, r) => sum + r.assessed_centavos, 0),
        paid_centavos: items.reduce((sum, r) => sum + r.paid_centavos, 0),
        outstanding_centavos: items.reduce((sum, r) => sum + r.balance_centavos, 0),
      });

      return [sumCat(fines, 'FINE'), sumCat(contribs, 'CONTRIBUTION')];
    }
    return ReportsRepository.getCategorySummaryReport(semesterId);
  }

  public static async getCombinedSummary(semesterId: string): Promise<CombinedFinancialSummary> {
    if (DataModeService.isDirectSupabase()) {
      const cat = await this.getCategorySummary(semesterId);
      const fines = cat.find((c) => c.type === 'FINE') || { obligations_count: 0, assessed_centavos: 0, paid_centavos: 0, outstanding_centavos: 0, type: 'FINE' as const };
      const contribs = cat.find((c) => c.type === 'CONTRIBUTION') || { obligations_count: 0, assessed_centavos: 0, paid_centavos: 0, outstanding_centavos: 0, type: 'CONTRIBUTION' as const };

      return {
        fines: {
          assessed_centavos: fines.assessed_centavos,
          paid_centavos: fines.paid_centavos,
          outstanding_centavos: fines.outstanding_centavos,
          count: fines.obligations_count,
        },
        contributions: {
          assessed_centavos: contribs.assessed_centavos,
          paid_centavos: contribs.paid_centavos,
          outstanding_centavos: contribs.outstanding_centavos,
          count: contribs.obligations_count,
        },
        overall_collected_centavos: fines.paid_centavos + contribs.paid_centavos,
        overall_outstanding_centavos: fines.outstanding_centavos + contribs.outstanding_centavos,
      };
    }
    return ReportsRepository.getCombinedFinancialSummary(semesterId);
  }

  /**
   * Generates offline CSV representation of student obligations report
   */
  public static generateObligationsCsv(
    reportRows: StudentObligationReportRow[],
    semesterLabel: string,
    generatedBy: string
  ): string {
    const lines: string[] = [];
    lines.push(`UniTap 2.0 Financial Report - ${semesterLabel}`);
    lines.push(`Generated By: ${generatedBy} on ${new Date().toLocaleString()}`);
    lines.push('');
    lines.push('School ID,Full Name,Year Level,Section,Type,Title,Assessed Amount,Paid Amount,Balance');

    for (const r of reportRows) {
      const fullName = `${r.last_name}, ${r.first_name} ${r.middle_name || ''}`.trim();
      // Sanitize CSV strings against formula injection
      const cleanSchoolId = r.school_id.replace(/^[=+\-@]/, '');
      const cleanName = `"${fullName.replace(/"/g, '""')}"`;
      const cleanTitle = `"${r.title.replace(/"/g, '""')}"`;
      const assessed = (r.assessed_centavos / 100).toFixed(2);
      const paid = (r.paid_centavos / 100).toFixed(2);
      const balance = (r.balance_centavos / 100).toFixed(2);

      lines.push(`${cleanSchoolId},${cleanName},${r.year_level},${r.section},${r.obligation_type},${cleanTitle},${assessed},${paid},${balance}`);
    }

    // Totals line
    const totalAssessed = (reportRows.reduce((sum, r) => sum + r.assessed_centavos, 0) / 100).toFixed(2);
    const totalPaid = (reportRows.reduce((sum, r) => sum + r.paid_centavos, 0) / 100).toFixed(2);
    const totalBalance = (reportRows.reduce((sum, r) => sum + r.balance_centavos, 0) / 100).toFixed(2);
    lines.push('');
    lines.push(`TOTALS,,,,,,${totalAssessed},${totalPaid},${totalBalance}`);

    return lines.join('\n');
  }

  /**
   * Generates printable offline HTML report suitable for PDF printing / WebView preview
   */
  public static generatePrintableReportHtml(
    reportRows: StudentObligationReportRow[],
    semesterLabel: string,
    generatedBy: string
  ): string {
    const totalAssessed = formatCentavosToPesos(reportRows.reduce((sum, r) => sum + r.assessed_centavos, 0));
    const totalPaid = formatCentavosToPesos(reportRows.reduce((sum, r) => sum + r.paid_centavos, 0));
    const totalBalance = formatCentavosToPesos(reportRows.reduce((sum, r) => sum + r.balance_centavos, 0));

    const rowsHtml = reportRows.map((r) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-family: monospace;">${r.school_id}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${r.last_name}, ${r.first_name} ${r.middle_name || ''}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: center;">${r.year_level} - ${r.section}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><span style="font-size: 11px; padding: 3px 6px; border-radius: 4px; background: ${r.obligation_type === 'FINE' ? '#fef2f2; color: #b91c1c;' : '#f0fdf4; color: #15803d;'} font-weight: 700;">${r.obligation_type}</span></td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${r.title}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${formatCentavosToPesos(r.assessed_centavos)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right; color: #047857;">${formatCentavosToPesos(r.paid_centavos)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 700; color: ${r.balance_centavos > 0 ? '#b91c1c;' : '#047857;'}">${formatCentavosToPesos(r.balance_centavos)}</td>
      </tr>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>UniTap Report - ${semesterLabel}</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; margin: 24px; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f766e; padding-bottom: 16px; margin-bottom: 24px; }
          .title { font-size: 24px; font-weight: 800; color: #0f766e; }
          .meta { font-size: 12px; color: #64748b; line-height: 1.5; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th { background: #f8fafc; padding: 10px 8px; text-align: left; border-bottom: 2px solid #cbd5e1; font-weight: 700; }
          .summary-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
          .card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 16px; }
          .card-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; }
          .card-val { font-size: 20px; font-weight: 800; margin-top: 4px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="title">UniTap 2.0 Financial Report</div>
            <div class="meta">CSG Student Financial Obligations & Collections</div>
          </div>
          <div style="text-align: right;" class="meta">
            <div><strong>Term:</strong> ${semesterLabel}</div>
            <div><strong>Generated By:</strong> ${generatedBy}</div>
            <div><strong>Date:</strong> ${new Date().toLocaleString()}</div>
          </div>
        </div>

        <div class="summary-cards">
          <div class="card">
            <div class="card-label">Total Assessed</div>
            <div class="card-val" style="color: #0f172a;">${totalAssessed}</div>
          </div>
          <div class="card">
            <div class="card-label">Total Collected</div>
            <div class="card-val" style="color: #047857;">${totalPaid}</div>
          </div>
          <div class="card">
            <div class="card-label">Total Outstanding</div>
            <div class="card-val" style="color: #b91c1c;">${totalBalance}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>School ID</th>
              <th>Student Name</th>
              <th style="text-align: center;">Year & Sec</th>
              <th>Type</th>
              <th>Obligation Title</th>
              <th style="text-align: right;">Assessed</th>
              <th style="text-align: right;">Paid</th>
              <th style="text-align: right;">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
      </html>
    `;
  }

  /**
   * Generates CSV string for attendance with checkpoints completion per student
   */
  public static generateAttendanceCsv(
    occurrenceTitle: string,
    checkpoints: { id: string; label: string; type: string }[],
    participants: {
      studentId: string;
      schoolId?: string;
      fullName?: string;
      course?: string;
      yearLevel?: number;
      section?: string;
      checkpointId?: string;
      attendanceStatus?: string;
      attendanceTime?: string;
    }[]
  ): string {
    const headers = [
      'School ID',
      'Student Name',
      'Course',
      'Year & Section',
      ...checkpoints.map((c) => `"${c.label} (${c.type})"`),
      'Overall Status',
    ];

    // Group participants by studentId
    const studentMap = new Map<
      string,
      {
        schoolId: string;
        fullName: string;
        course: string;
        yearSection: string;
        checkpoints: Map<string, { status: string; time: string }>;
      }
    >();

    for (const p of participants) {
      if (!studentMap.has(p.studentId)) {
        studentMap.set(p.studentId, {
          schoolId: p.schoolId || '',
          fullName: p.fullName || '',
          course: p.course || '',
          yearSection: p.yearLevel ? `${p.yearLevel}-${p.section || ''}` : '',
          checkpoints: new Map(),
        });
      }
      const s = studentMap.get(p.studentId)!;
      if (p.checkpointId) {
        s.checkpoints.set(p.checkpointId, {
          status: p.attendanceStatus || 'PENDING',
          time: p.attendanceTime || '',
        });
      }
    }

    const rows: string[][] = [];
    for (const [, s] of studentMap) {
      const checkpointStatuses = checkpoints.map((c) => {
        const cp = s.checkpoints.get(c.id);
        return cp ? cp.status : 'ABSENT';
      });

      const allPresent = checkpointStatuses.length > 0 && checkpointStatuses.every((st) => st === 'PRESENT' || st === 'LATE');
      const anyPresent = checkpointStatuses.some((st) => st === 'PRESENT' || st === 'LATE');
      const overall = allPresent ? 'COMPLETED' : anyPresent ? 'PARTIAL' : 'ABSENT';

      rows.push([
        s.schoolId,
        `"${s.fullName.replace(/"/g, '""')}"`,
        s.course,
        s.yearSection,
        ...checkpointStatuses,
        overall,
      ]);
    }

    return [
      `UniTap 2.0 Attendance Report - ${occurrenceTitle}`,
      headers.join(','),
      ...rows.map((r) => r.join(',')),
    ].join('\n');
  }
}
