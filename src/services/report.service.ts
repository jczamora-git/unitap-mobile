import { ReportsRepository, type StudentObligationReportRow, type CategorySummaryReportRow, type CombinedFinancialSummary } from '../database/repositories/reports.repository';
import { formatCentavosToPesos } from '@/utilities/finance-formatters';
import { DataModeService } from './data-mode.service';
import { supabase } from '@/integrations/supabase/client';
import type { PaymentReceipt } from '@/types/finance';

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

  /**
   * Generates a descriptive filename for the downloaded financial PDF report.
   * Format: UniTap_Financial_Report_2026-2027_1st_Semester.pdf
   */
  public static buildObligationsPdfFilename(sem?: { term?: string | null; academic_year_id?: string | null }): string {
    if (!sem) return 'UniTap_Financial_Report.pdf';
    const rawYear = (sem.academic_year_id || '2026-2027')
      .replace(/^ay[_-]?/i, '')
      .replace(/_/g, '-');
    const yearClean = rawYear || '2026-2027';

    let termClean = '1st_Semester';
    if (sem.term) {
      const t = sem.term.toLowerCase();
      if (t.includes('1') || t.includes('first')) termClean = '1st_Semester';
      else if (t.includes('2') || t.includes('second')) termClean = '2nd_Semester';
      else if (t.includes('mid') || t.includes('summer')) termClean = 'Midyear';
      else termClean = sem.term.replace(/[^a-zA-Z0-9]/g, '_');
    }
    return `UniTap_Financial_Report_${yearClean}_${termClean}.pdf`;
  }

  /**
   * Generates a descriptive filename for the downloaded official payment receipt PDF.
   * Format: UniTap_Receipt_{receipt_reference}.pdf
   */
  public static buildReceiptPdfFilename(referenceNumber?: string): string {
    const cleanRef = (referenceNumber || 'RECORD')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    return `UniTap_Receipt_${cleanRef}.pdf`;
  }

  /**
   * Generates a fully compliant, self-contained binary PDF 1.4 document
   * representing the official student payment receipt.
   */
  public static generateReceiptPdf(receipt: PaymentReceipt): Uint8Array {
    const pageWidth = 595.28;
    const pageHeight = 841.89;

    const itemsPerPage = 8;
    const items = receipt.items || [];
    const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));

    const methodStr = receipt.paymentMethod === 'CASH'
      ? 'Cash Collection'
      : (receipt.notes && receipt.notes.toLowerCase().includes('gcash')
          ? 'GCash Transfer'
          : (receipt.notes && receipt.notes.toLowerCase().includes('bank')
              ? 'Bank Transfer'
              : (receipt.paymentMethod || 'Manual Record')));

    const paymentDateStr = receipt.paymentDate
      ? new Date(receipt.paymentDate).toLocaleString()
      : new Date().toLocaleString();

    const studentSectionStr = receipt.student?.yearLevel
      ? `Year ${receipt.student.yearLevel} - ${receipt.student.section || 'N/A'}`
      : (receipt.student?.section || 'N/A');

    const semLabel = receipt.academicTerm?.semesterLabel || 'Current Term';
    const ayLabel = receipt.academicTerm?.academicYearLabel || '';
    const termStr = ayLabel ? `${semLabel} (${ayLabel})` : semLabel;

    const pageStreamContents: string[] = [];

    for (let p = 0; p < totalPages; p++) {
      const isFirstPage = p === 0;
      const isLastPage = p === totalPages - 1;
      const pageItems = items.slice(p * itemsPerPage, (p + 1) * itemsPerPage);
      const ops: string[] = [];

      // Top brand accent bar: Teal #0F766E
      ops.push('0.059 0.463 0.431 rg');
      ops.push('40 806 515 4 re f');

      if (isFirstPage) {
        // Brand Title
        ops.push('BT');
        ops.push('/F2 18 Tf');
        ops.push('0.059 0.463 0.431 rg');
        ops.push('1 0 0 1 40 780 Tm');
        ops.push(`(${this.escapePdfText('UniTap 2.0')}) Tj`);

        // Subtitle
        ops.push('/F1 9 Tf');
        ops.push('0.392 0.455 0.545 rg');
        ops.push('1 0 0 1 40 766 Tm');
        ops.push(`(${this.escapePdfText('Computer Studies Government (CSG) - Official Payment Receipt')}) Tj`);
        ops.push('ET');

        // Status Badge
        if (receipt.isLocallyRecordedPendingSync) {
          ops.push('0.996 0.953 0.78 rg 345 762 210 20 re f');
          ops.push('0.96 0.7 0.2 RG 0.5 w 345 762 210 20 re s');
          ops.push('BT /F2 8 Tf 0.706 0.325 0.035 rg 1 0 0 1 355 768 Tm (Locally Recorded - Sync Pending) Tj ET');
        } else {
          ops.push('0.92 0.98 0.94 rg 345 762 210 20 re f');
          ops.push('0.2 0.7 0.4 RG 0.5 w 345 762 210 20 re s');
          ops.push('BT /F2 8 Tf 0.016 0.47 0.34 rg 1 0 0 1 355 768 Tm (Authoritatively Confirmed - Server Recorded) Tj ET');
        }

        // Divider
        ops.push('0.85 0.88 0.92 RG 0.75 w 40 750 m 555 750 l S');

        // Metadata Box
        ops.push('0.973 0.98 0.988 rg 40 656 515 82 re f');
        ops.push('0.88 0.91 0.94 RG 0.5 w 40 656 515 82 re s');

        // Left Column (Receipt details)
        ops.push('BT /F1 8.5 Tf 0.392 0.455 0.545 rg 1 0 0 1 52 720 Tm (Receipt Ref:) Tj /F2 9.5 Tf 0.059 0.09 0.165 rg 1 0 0 1 125 720 Tm (' + this.escapePdfText(receipt.referenceNumber) + ') Tj ET');
        ops.push('BT /F1 8.5 Tf 0.392 0.455 0.545 rg 1 0 0 1 52 702 Tm (Payment Date:) Tj /F1 9 Tf 0.059 0.09 0.165 rg 1 0 0 1 125 702 Tm (' + this.escapePdfText(paymentDateStr) + ') Tj ET');
        ops.push('BT /F1 8.5 Tf 0.392 0.455 0.545 rg 1 0 0 1 52 684 Tm (Academic Term:) Tj /F1 9 Tf 0.059 0.09 0.165 rg 1 0 0 1 125 684 Tm (' + this.escapePdfText(termStr) + ') Tj ET');
        ops.push('BT /F1 8.5 Tf 0.392 0.455 0.545 rg 1 0 0 1 52 666 Tm (Received By:) Tj /F1 9 Tf 0.059 0.09 0.165 rg 1 0 0 1 125 666 Tm (' + this.escapePdfText(receipt.receivedByOfficer || 'Authorized Officer') + ') Tj ET');

        // Right Column (Student & Payment Mode)
        ops.push('BT /F1 8.5 Tf 0.392 0.455 0.545 rg 1 0 0 1 315 720 Tm (Student Name:) Tj /F2 9.5 Tf 0.059 0.09 0.165 rg 1 0 0 1 385 720 Tm (' + this.escapePdfText(receipt.student?.fullName || 'N/A') + ') Tj ET');
        ops.push('BT /F1 8.5 Tf 0.392 0.455 0.545 rg 1 0 0 1 315 702 Tm (School ID:) Tj /F2 9.5 Tf 0.059 0.09 0.165 rg 1 0 0 1 385 702 Tm (' + this.escapePdfText(receipt.student?.schoolId || 'N/A') + ') Tj ET');
        ops.push('BT /F1 8.5 Tf 0.392 0.455 0.545 rg 1 0 0 1 315 684 Tm (Section:) Tj /F1 9 Tf 0.059 0.09 0.165 rg 1 0 0 1 385 684 Tm (' + this.escapePdfText(studentSectionStr) + ') Tj ET');
        ops.push('BT /F1 8.5 Tf 0.392 0.455 0.545 rg 1 0 0 1 315 666 Tm (Payment Mode:) Tj /F2 9 Tf 0.059 0.09 0.165 rg 1 0 0 1 385 666 Tm (' + this.escapePdfText(methodStr) + ') Tj ET');
      } else {
        // Subsequent page header
        ops.push('BT /F2 12 Tf 0.059 0.463 0.431 rg 1 0 0 1 40 778 Tm (' + this.escapePdfText(`UniTap 2.0 Official Receipt - ${receipt.referenceNumber} (Cont.)`) + ') Tj ET');
        ops.push('0.85 0.88 0.92 RG 0.5 w 40 766 m 555 766 l S');
      }

      // Items Table Header
      const tableHeaderY = isFirstPage ? 624 : 740;
      ops.push('0.059 0.463 0.431 rg 40 ' + tableHeaderY + ' 515 20 re f');
      ops.push('BT /F2 8.5 Tf 1 1 1 rg');
      ops.push('1 0 0 1 52 ' + (tableHeaderY + 6) + ' Tm (Obligation / Description) Tj');
      ops.push('1 0 0 1 250 ' + (tableHeaderY + 6) + ' Tm (Type) Tj');
      ops.push('1 0 0 1 340 ' + (tableHeaderY + 6) + ' Tm (Remaining Balance) Tj');
      ops.push('1 0 0 1 475 ' + (tableHeaderY + 6) + ' Tm (Amount Paid) Tj');
      ops.push('ET');

      // Data Rows
      let rowBaselineY = tableHeaderY - 26;
      if (pageItems.length === 0) {
        ops.push('BT /F1 9 Tf 0.392 0.455 0.545 rg 1 0 0 1 52 ' + (rowBaselineY + 6) + ' Tm (No itemized obligations recorded for this transaction.) Tj ET');
        rowBaselineY -= 26;
      } else {
        for (let i = 0; i < pageItems.length; i++) {
          const it = pageItems[i];
          const rowY = rowBaselineY - 4;

          if (i % 2 === 1) {
            ops.push('0.985 0.988 0.995 rg 40 ' + rowY + ' 515 28 re f');
          }

          // Item Title
          ops.push('BT /F2 9 Tf 0.059 0.09 0.165 rg 1 0 0 1 52 ' + (rowY + 15) + ' Tm (' + this.escapePdfText(it.title) + ') Tj ET');
          // Item Obligation Subtext
          const obIdShort = it.obligationId ? `ID: ${it.obligationId.slice(0, 8)}...` : '';
          if (obIdShort) {
            ops.push('BT /F1 7.5 Tf 0.5 0.55 0.62 rg 1 0 0 1 52 ' + (rowY + 5) + ' Tm (' + this.escapePdfText(obIdShort) + ') Tj ET');
          }

          // Type
          ops.push('BT /F1 8.5 Tf 0.25 0.3 0.38 rg 1 0 0 1 250 ' + (rowY + 11) + ' Tm (' + this.escapePdfText(it.type) + ') Tj ET');

          // Remaining Balance
          const remStr = 'PHP ' + (Number(it.remainingBalanceCentavos || 0) / 100).toFixed(2);
          ops.push('BT /F1 9 Tf 0.392 0.455 0.545 rg 1 0 0 1 340 ' + (rowY + 11) + ' Tm (' + this.escapePdfText(remStr) + ') Tj ET');

          // Paid Amount
          const paidStr = 'PHP ' + (Number(it.paidAmountCentavos || 0) / 100).toFixed(2);
          ops.push('BT /F2 10 Tf 0.016 0.47 0.34 rg 1 0 0 1 475 ' + (rowY + 11) + ' Tm (' + this.escapePdfText(paidStr) + ') Tj ET');

          // Divider
          ops.push('0.88 0.91 0.94 RG 0.5 w 40 ' + rowY + ' m 555 ' + rowY + ' l S');

          rowBaselineY -= 28;
        }
      }

      // If last page: render Total Box, Notes, and Audit Stamp
      if (isLastPage) {
        const totalBoxY = Math.max(rowBaselineY - 24, 110);

        // Total Box
        ops.push('0.94 0.98 0.95 rg 40 ' + totalBoxY + ' 515 36 re f');
        ops.push('0.059 0.463 0.431 RG 1 w 40 ' + totalBoxY + ' 515 36 re s');

        const totalStr = 'PHP ' + (Number(receipt.totalPaidCentavos || 0) / 100).toFixed(2);
        ops.push('BT /F2 11 Tf 0.059 0.09 0.165 rg 1 0 0 1 52 ' + (totalBoxY + 13) + ' Tm (TOTAL COLLECTED:) Tj ET');
        ops.push('BT /F2 14 Tf 0.016 0.47 0.34 rg 1 0 0 1 445 ' + (totalBoxY + 12) + ' Tm (' + this.escapePdfText(totalStr) + ') Tj ET');

        // Notes if any
        if (receipt.notes) {
          const notesY = totalBoxY - 20;
          ops.push('BT /F1 8.5 Tf 0.392 0.455 0.545 rg 1 0 0 1 40 ' + notesY + ' Tm (' + this.escapePdfText('Payment Notes: ' + receipt.notes) + ') Tj ET');
        }

        // Receipt Security & Audit Notice
        ops.push('0.85 0.88 0.92 RG 0.5 w 40 70 m 555 70 l S');
        ops.push('BT /F2 8 Tf 0.25 0.3 0.38 rg 1 0 0 1 175 56 Tm (Thank you for supporting the CSG community.) Tj ET');
        ops.push('BT /F1 7.5 Tf 0.5 0.55 0.62 rg 1 0 0 1 125 44 Tm (Official Computer Studies Government Electronic Receipt • Issued via UniTap 2.0) Tj ET');
      }

      // Page Footer
      ops.push('0.85 0.88 0.92 RG 0.5 w 40 32 m 555 32 l S');
      ops.push('BT /F1 7 Tf 0.5 0.55 0.62 rg 1 0 0 1 40 20 Tm (UniTap 2.0 - Official Student Payment Receipt) Tj ET');
      ops.push('BT /F1 7 Tf 0.5 0.55 0.62 rg 1 0 0 1 485 20 Tm (' + this.escapePdfText(`Page ${p + 1} of ${totalPages}`) + ') Tj ET');

      pageStreamContents.push(ops.join('\n'));
    }

    // Assemble PDF Object Hierarchy
    let objIndex = 1;
    const catalogObjNum = objIndex++;
    const pagesObjNum = objIndex++;
    const fontHelvNum = objIndex++;
    const fontBoldNum = objIndex++;
    const fontMonoNum = objIndex++;

    const pageObjNums: number[] = [];
    const streamObjNums: number[] = [];
    for (let i = 0; i < totalPages; i++) {
      pageObjNums.push(objIndex++);
      streamObjNums.push(objIndex++);
    }

    const objects: string[] = [];

    // Catalog
    objects[catalogObjNum] = `<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>`;

    // Pages parent
    const kidsStr = pageObjNums.map((n) => `${n} 0 R`).join(' ');
    objects[pagesObjNum] = `<< /Type /Pages /Kids [${kidsStr}] /Count ${totalPages} >>`;

    // Built-in Standard Type 1 Fonts
    objects[fontHelvNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
    objects[fontBoldNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
    objects[fontMonoNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`;

    // Pages & Streams
    for (let i = 0; i < totalPages; i++) {
      const pNum = pageObjNums[i];
      const sNum = streamObjNums[i];
      const content = pageStreamContents[i];

      objects[pNum] = `<< /Type /Page /Parent ${pagesObjNum} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontHelvNum} 0 R /F2 ${fontBoldNum} 0 R /F3 ${fontMonoNum} 0 R >> >> /Contents ${sNum} 0 R >>`;
      objects[sNum] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    }

    // Assemble PDF file with exact byte offset indexing
    let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets: number[] = [];

    for (let i = 1; i < objIndex; i++) {
      offsets[i] = pdf.length;
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objIndex}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i < objIndex; i++) {
      const offStr = String(offsets[i]).padStart(10, '0');
      pdf += `${offStr} 00000 n \n`;
    }

    pdf += `trailer\n<< /Size ${objIndex} /Root ${catalogObjNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return this.stringToUint8Array(pdf);
  }

  /**
   * Escapes strings and sanitizes non-ASCII/Unicode glyphs (like ₱) for standard PDF WinAnsiEncoding
   */
  private static escapePdfText(str?: string | number | null): string {
    if (str === undefined || str === null) return '';
    const sanitized = String(str)
      .replace(/\u20B1/g, 'PHP ')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[^\x20-\x7E]/g, ' ');
    return sanitized
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  /**
   * Converts a binary string to a Uint8Array byte buffer with 1:1 byte mapping
   */
  private static stringToUint8Array(str: string): Uint8Array {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  /**
   * Generates a fully compliant, self-contained binary PDF 1.4 document
   * representing the student obligations financial report.
   */
  public static generateObligationsPdf(
    reportRows: StudentObligationReportRow[],
    semesterLabel: string,
    generatedBy: string
  ): Uint8Array {
    const pageWidth = 595.28;
    const pageHeight = 841.89;

    const totalAssessed = (reportRows.reduce((sum, r) => sum + r.assessed_centavos, 0) / 100).toFixed(2);
    const totalPaid = (reportRows.reduce((sum, r) => sum + r.paid_centavos, 0) / 100).toFixed(2);
    const totalBalance = (reportRows.reduce((sum, r) => sum + r.balance_centavos, 0) / 100).toFixed(2);

    // Multi-page distribution: 26 rows on page 1, 34 rows on subsequent pages
    const p1Rows = 26;
    const pNextRows = 34;
    const pagesData: StudentObligationReportRow[][] = [];

    if (reportRows.length === 0) {
      pagesData.push([]);
    } else {
      pagesData.push(reportRows.slice(0, p1Rows));
      let idx = p1Rows;
      while (idx < reportRows.length) {
        pagesData.push(reportRows.slice(idx, idx + pNextRows));
        idx += pNextRows;
      }
    }

    const totalPages = pagesData.length;
    const pageStreamContents: string[] = [];

    for (let p = 0; p < totalPages; p++) {
      const isFirstPage = p === 0;
      const pageRows = pagesData[p];
      const ops: string[] = [];

      // Top brand accent bar: Teal #0F766E
      ops.push('0.059 0.463 0.431 rg');
      ops.push('36 802 523 4 re f');

      let tableHeaderY: number;

      if (isFirstPage) {
        // Page 1 Title
        ops.push('BT');
        ops.push('/F2 16 Tf');
        ops.push('0.059 0.463 0.431 rg');
        ops.push('1 0 0 1 36 778 Tm');
        ops.push(`(${this.escapePdfText('UniTap 2.0 Financial Report')}) Tj`);

        // Subtitle
        ops.push('/F1 9 Tf');
        ops.push('0.392 0.455 0.545 rg');
        ops.push('1 0 0 1 36 764 Tm');
        ops.push(`(${this.escapePdfText('CSG Student Financial Obligations & Collections')}) Tj`);

        // Header Meta (Right Side)
        ops.push('/F2 8 Tf');
        ops.push('0.2 0.25 0.35 rg');
        ops.push('1 0 0 1 370 780 Tm');
        ops.push(`(${this.escapePdfText('Academic Period: ' + semesterLabel)}) Tj`);

        ops.push('/F1 8 Tf');
        ops.push('0.392 0.455 0.545 rg');
        ops.push('1 0 0 1 370 768 Tm');
        ops.push(`(${this.escapePdfText('Generated By: ' + generatedBy)}) Tj`);

        ops.push('1 0 0 1 370 756 Tm');
        const formattedDate = new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        ops.push(`(${this.escapePdfText('Date: ' + formattedDate)}) Tj`);
        ops.push('ET');

        // Divider line
        ops.push('0.8 0.83 0.88 RG');
        ops.push('0.75 w');
        ops.push('36 746 m 559 746 l S');

        // KPI Summary Cards
        // Card 1: Total Assessed
        ops.push('0.97 0.98 0.99 rg');
        ops.push('36 696 165 40 re f');
        ops.push('0.8 0.83 0.88 RG 0.75 w 36 696 165 40 re s');
        ops.push('BT /F2 7 Tf 0.392 0.455 0.545 rg 1 0 0 1 44 724 Tm (TOTAL ASSESSED) Tj ET');
        ops.push(`BT /F2 11 Tf 0.059 0.09 0.165 rg 1 0 0 1 44 706 Tm (${this.escapePdfText('PHP ' + totalAssessed)}) Tj ET`);

        // Card 2: Total Collected
        ops.push('0.97 0.98 0.99 rg');
        ops.push('215 696 165 40 re f');
        ops.push('0.8 0.83 0.88 RG 0.75 w 215 696 165 40 re s');
        ops.push('BT /F2 7 Tf 0.392 0.455 0.545 rg 1 0 0 1 223 724 Tm (TOTAL COLLECTED) Tj ET');
        ops.push(`BT /F2 11 Tf 0.016 0.47 0.34 rg 1 0 0 1 223 706 Tm (${this.escapePdfText('PHP ' + totalPaid)}) Tj ET`);

        // Card 3: Total Outstanding
        ops.push('0.97 0.98 0.99 rg');
        ops.push('394 696 165 40 re f');
        ops.push('0.8 0.83 0.88 RG 0.75 w 394 696 165 40 re s');
        ops.push('BT /F2 7 Tf 0.392 0.455 0.545 rg 1 0 0 1 402 724 Tm (TOTAL OUTSTANDING) Tj ET');
        ops.push(`BT /F2 11 Tf 0.72 0.11 0.11 rg 1 0 0 1 402 706 Tm (${this.escapePdfText('PHP ' + totalBalance)}) Tj ET`);

        tableHeaderY = 668;
      } else {
        // Subsequent Pages: Compact Header
        ops.push('BT');
        ops.push('/F2 10 Tf');
        ops.push('0.059 0.463 0.431 rg');
        ops.push('1 0 0 1 36 784 Tm');
        ops.push(`(${this.escapePdfText('UniTap 2.0 Financial Report - ' + semesterLabel)}) Tj`);
        ops.push('ET');

        tableHeaderY = 762;
      }

      // Draw Table Header Bar
      ops.push('0.94 0.96 0.98 rg');
      ops.push(`36 ${tableHeaderY} 523 18 re f`);
      ops.push(`0.8 0.83 0.88 RG 0.75 w 36 ${tableHeaderY} 523 18 re s`);

      ops.push('BT');
      ops.push('/F2 7.5 Tf');
      ops.push('0.2 0.25 0.35 rg');
      const textY = tableHeaderY + 5;
      ops.push(`1 0 0 1 42 ${textY} Tm (School ID) Tj`);
      ops.push(`1 0 0 1 110 ${textY} Tm (Student Name) Tj`);
      ops.push(`1 0 0 1 230 ${textY} Tm (Yr/Sec) Tj`);
      ops.push(`1 0 0 1 275 ${textY} Tm (Type) Tj`);
      ops.push(`1 0 0 1 325 ${textY} Tm (Obligation Title) Tj`);
      ops.push(`1 0 0 1 430 ${textY} Tm (Assessed) Tj`);
      ops.push(`1 0 0 1 475 ${textY} Tm (Paid) Tj`);
      ops.push(`1 0 0 1 515 ${textY} Tm (Balance) Tj`);
      ops.push('ET');

      // Draw Table Rows
      let rowY = tableHeaderY - 18;
      if (pageRows.length === 0) {
        ops.push('BT /F1 9 Tf 0.5 0.55 0.6 rg 1 0 0 1 180 620 Tm (No financial obligation records found for this period.) Tj ET');
      } else {
        for (let rIdx = 0; rIdx < pageRows.length; rIdx++) {
          const row = pageRows[rIdx];
          if (rIdx % 2 === 1) {
            ops.push('0.98 0.985 0.99 rg');
            ops.push(`36 ${rowY} 523 18 re f`);
          }
          // Row divider line
          ops.push('0.92 0.94 0.96 RG 0.5 w');
          ops.push(`36 ${rowY} m 559 ${rowY} l S`);

          const baseline = rowY + 5;
          const fullName = `${row.last_name}, ${row.first_name}`.slice(0, 24);
          const yrSec = `${row.year_level || 1}-${row.section || '1A'}`;
          const title = (row.title || '').slice(0, 22);
          const assessed = (row.assessed_centavos / 100).toFixed(2);
          const paid = (row.paid_centavos / 100).toFixed(2);
          const balance = (row.balance_centavos / 100).toFixed(2);

          ops.push('BT');
          // School ID in monospaced Courier
          ops.push('/F3 7.5 Tf 0.1 0.15 0.2 rg');
          ops.push(`1 0 0 1 42 ${baseline} Tm (${this.escapePdfText(row.school_id)}) Tj`);

          // Name
          ops.push('/F2 7.5 Tf 0.08 0.12 0.18 rg');
          ops.push(`1 0 0 1 110 ${baseline} Tm (${this.escapePdfText(fullName)}) Tj`);

          // Yr/Sec
          ops.push('/F1 7.5 Tf 0.3 0.35 0.4 rg');
          ops.push(`1 0 0 1 230 ${baseline} Tm (${this.escapePdfText(yrSec)}) Tj`);

          // Type
          if (row.obligation_type === 'FINE') {
            ops.push('/F2 7 Tf 0.72 0.11 0.11 rg');
          } else {
            ops.push('/F2 7 Tf 0.059 0.463 0.431 rg');
          }
          ops.push(`1 0 0 1 275 ${baseline} Tm (${this.escapePdfText(row.obligation_type)}) Tj`);

          // Title
          ops.push('/F1 7.5 Tf 0.15 0.2 0.25 rg');
          ops.push(`1 0 0 1 325 ${baseline} Tm (${this.escapePdfText(title)}) Tj`);

          // Assessed
          ops.push('/F1 7.5 Tf 0.15 0.2 0.25 rg');
          const assessedX = 465 - assessed.length * 4.3;
          ops.push(`1 0 0 1 ${assessedX.toFixed(1)} ${baseline} Tm (${this.escapePdfText(assessed)}) Tj`);

          // Paid
          ops.push('/F1 7.5 Tf 0.016 0.47 0.34 rg');
          const paidX = 505 - paid.length * 4.3;
          ops.push(`1 0 0 1 ${paidX.toFixed(1)} ${baseline} Tm (${this.escapePdfText(paid)}) Tj`);

          // Balance
          if (row.balance_centavos > 0) {
            ops.push('/F2 7.5 Tf 0.72 0.11 0.11 rg');
          } else {
            ops.push('/F2 7.5 Tf 0.016 0.47 0.34 rg');
          }
          const balX = 552 - balance.length * 4.3;
          ops.push(`1 0 0 1 ${balX.toFixed(1)} ${baseline} Tm (${this.escapePdfText(balance)}) Tj`);

          ops.push('ET');

          rowY -= 18;
        }
      }

      // Page Footer
      ops.push('0.85 0.88 0.92 RG 0.5 w');
      ops.push('36 36 m 559 36 l S');
      ops.push('BT /F1 7.5 Tf 0.5 0.55 0.62 rg');
      ops.push('1 0 0 1 36 24 Tm (UniTap 2.0 - CSG Confidential Financial Record) Tj');
      ops.push(`1 0 0 1 500 24 Tm (Page ${p + 1} of ${totalPages}) Tj`);
      ops.push('ET');

      pageStreamContents.push(ops.join('\n'));
    }

    // PDF Object Hierarchy
    let objIndex = 1;
    const catalogObjNum = objIndex++;
    const pagesObjNum = objIndex++;
    const fontHelvNum = objIndex++;
    const fontBoldNum = objIndex++;
    const fontMonoNum = objIndex++;

    const pageObjNums: number[] = [];
    const streamObjNums: number[] = [];
    for (let i = 0; i < totalPages; i++) {
      pageObjNums.push(objIndex++);
      streamObjNums.push(objIndex++);
    }

    const objects: string[] = [];

    // Catalog
    objects[catalogObjNum] = `<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>`;

    // Pages parent
    const kidsStr = pageObjNums.map((n) => `${n} 0 R`).join(' ');
    objects[pagesObjNum] = `<< /Type /Pages /Kids [${kidsStr}] /Count ${totalPages} >>`;

    // Built-in Standard Type 1 Fonts
    objects[fontHelvNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
    objects[fontBoldNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
    objects[fontMonoNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`;

    // Pages & Streams
    for (let i = 0; i < totalPages; i++) {
      const pNum = pageObjNums[i];
      const sNum = streamObjNums[i];
      const content = pageStreamContents[i];

      objects[pNum] = `<< /Type /Page /Parent ${pagesObjNum} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontHelvNum} 0 R /F2 ${fontBoldNum} 0 R /F3 ${fontMonoNum} 0 R >> >> /Contents ${sNum} 0 R >>`;
      objects[sNum] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    }

    // Assemble PDF file with exact byte offset indexing
    let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets: number[] = [];

    for (let i = 1; i < objIndex; i++) {
      offsets[i] = pdf.length;
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objIndex}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i < objIndex; i++) {
      const offStr = String(offsets[i]).padStart(10, '0');
      pdf += `${offStr} 00000 n \n`;
    }

    pdf += `trailer\n<< /Size ${objIndex} /Root ${catalogObjNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return this.stringToUint8Array(pdf);
  }
}
