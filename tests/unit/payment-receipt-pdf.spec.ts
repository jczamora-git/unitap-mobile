import { describe, it, expect } from 'vitest';
import { ReportService } from '@/services/report.service';
import { financeService } from '@/services/finance.service';
import type { PaymentReceipt } from '@/types/finance';

describe('Official Payment Receipt PDF Specification', () => {
  const sampleReceipt: PaymentReceipt = {
    referenceNumber: 'PAY-20261110-7890',
    paymentDate: '2026-11-10T08:30:00.000Z',
    student: {
      id: 'stu-uuid-1234',
      schoolId: '2026-00456',
      fullName: 'Juan Dela Cruz',
      section: 'IT-3A',
      yearLevel: 3,
    },
    academicTerm: {
      semesterLabel: '1st Semester',
      academicYearLabel: '2026-2027',
    },
    receivedByOfficer: 'Auditor Jane Smith',
    paymentMethod: 'CASH',
    notes: 'Paid in full at station 1',
    items: [
      {
        obligationId: 'ob-shirt-001',
        title: 'CSG College Shirt 2026',
        type: 'CONTRIBUTION',
        paidAmountCentavos: 35000,
        remainingBalanceCentavos: 0,
      },
      {
        obligationId: 'ob-ga-002',
        title: 'General Assembly Absence Fine',
        type: 'FINE',
        paidAmountCentavos: 15000,
        remainingBalanceCentavos: 5000,
      },
    ],
    totalPaidCentavos: 50000,
    isLocallyRecordedPendingSync: false,
  };

  it('1. Generates a descriptive filename in format UniTap_Receipt_{receipt_reference}.pdf', () => {
    const filename1 = ReportService.buildReceiptPdfFilename('PAY-20261110-7890');
    expect(filename1).toBe('UniTap_Receipt_PAY-20261110-7890.pdf');

    const filename2 = financeService.buildReceiptPdfFilename('PAY/2026:SPECIAL#99');
    expect(filename2).toBe('UniTap_Receipt_PAY_2026_SPECIAL_99.pdf');

    const filenameEmpty = ReportService.buildReceiptPdfFilename('');
    expect(filenameEmpty).toBe('UniTap_Receipt_RECORD.pdf');
  });

  it('2. Generates a compliant PDF 1.4 binary buffer with exact header and trailer', () => {
    const pdfBytes = ReportService.generateReceiptPdf(sampleReceipt);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);

    const pdfText = new TextDecoder('latin1').decode(pdfBytes);

    // Verify PDF 1.4 specification compliance
    expect(pdfText.startsWith('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')).toBe(true);
    expect(pdfText).toContain('/Type /Catalog');
    expect(pdfText).toContain('/Type /Pages');
    expect(pdfText).toContain('/Type1');
    expect(pdfText).toContain('/BaseFont /Helvetica');
    expect(pdfText).toContain('/BaseFont /Helvetica-Bold');
    expect(pdfText).toContain('/BaseFont /Courier');
    expect(pdfText).toContain('xref');
    expect(pdfText).toContain('trailer');
    expect(pdfText.trim().endsWith('%%EOF')).toBe(true);
  });

  it('3. Preserves all official receipt design tokens, metadata, student details, and totals', () => {
    const pdfBytes = ReportService.generateReceiptPdf(sampleReceipt);
    const pdfText = new TextDecoder('latin1').decode(pdfBytes);

    // Branding & Header
    expect(pdfText).toContain('UniTap 2.0');
    expect(pdfText).toContain('Computer Studies Government');
    expect(pdfText).toContain('Official Payment Receipt');
    expect(pdfText).toContain('Authoritatively Confirmed - Server Recorded');

    // Metadata
    expect(pdfText).toContain('PAY-20261110-7890');
    expect(pdfText).toContain('1st Semester');
    expect(pdfText).toContain('2026-2027');
    expect(pdfText).toContain('Auditor Jane Smith');
    expect(pdfText).toContain('Cash Collection');

    // Student Details
    expect(pdfText).toContain('Juan Dela Cruz');
    expect(pdfText).toContain('2026-00456');
    expect(pdfText).toContain('Year 3 - IT-3A');

    // Itemized lines
    expect(pdfText).toContain('CSG College Shirt 2026');
    expect(pdfText).toContain('CONTRIBUTION');
    expect(pdfText).toContain('PHP 350.00'); // Paid for shirt
    expect(pdfText).toContain('PHP 0.00');   // Remaining for shirt

    expect(pdfText).toContain('General Assembly Absence Fine');
    expect(pdfText).toContain('FINE');
    expect(pdfText).toContain('PHP 150.00'); // Paid for fine
    expect(pdfText).toContain('PHP 50.00');  // Remaining for fine

    // Total box
    expect(pdfText).toContain('TOTAL COLLECTED:');
    expect(pdfText).toContain('PHP 500.00'); // Total paid

    // Notes
    expect(pdfText).toContain('Payment Notes: Paid in full at station 1');

    // Security Notice & Footer
    expect(pdfText).toContain('Thank you for supporting the CSG community.');
    expect(pdfText).toContain('Official Computer Studies Government Electronic Receipt');
  });

  it('4. Correctly represents sync status badge for offline / locally recorded pending sync receipts', () => {
    const pendingReceipt: PaymentReceipt = {
      ...sampleReceipt,
      isLocallyRecordedPendingSync: true,
      referenceNumber: 'PAY-OFFLINE-001',
    };

    const pdfBytes = ReportService.generateReceiptPdf(pendingReceipt);
    const pdfText = new TextDecoder('latin1').decode(pdfBytes);

    expect(pdfText).toContain('Locally Recorded - Sync Pending');
    expect(pdfText).not.toContain('Authoritatively Confirmed - Server Recorded');
  });

  it('5. Handles electronic transfer methods (GCash / Bank Transfer) based on notes and method', () => {
    const gcashReceipt: PaymentReceipt = {
      ...sampleReceipt,
      paymentMethod: 'MANUAL_TRANSFER_RECORD',
      notes: '[GCash Ref: 994821034] Verified GCash receipt',
    };

    const pdfBytes = ReportService.generateReceiptPdf(gcashReceipt);
    const pdfText = new TextDecoder('latin1').decode(pdfBytes);

    expect(pdfText).toContain('GCash Transfer');
    expect(pdfText).toContain('GCash Ref: 994821034');
  });

  it('6. Supports multi-item receipts and paginates cleanly when item count exceeds page threshold', () => {
    const multiItemReceipt: PaymentReceipt = {
      ...sampleReceipt,
      items: Array.from({ length: 14 }, (_, i) => ({
        obligationId: `ob-test-${i + 1}`,
        title: `Obligation Fee Item #${i + 1}`,
        type: (i % 2 === 0 ? 'CONTRIBUTION' : 'FINE') as any,
        paidAmountCentavos: 10000,
        remainingBalanceCentavos: 0,
      })),
      totalPaidCentavos: 140000,
    };

    const pdfBytes = ReportService.generateReceiptPdf(multiItemReceipt);
    const pdfText = new TextDecoder('latin1').decode(pdfBytes);

    // Should create 2 pages
    expect(pdfText).toContain('/Count 2');
    expect(pdfText).toContain('Page 1 of 2');
    expect(pdfText).toContain('Page 2 of 2');
    expect(pdfText).toContain('Obligation Fee Item #14');
    expect(pdfText).toContain('PHP 1400.00');
  });

  it('7. financeService delegates generateReceiptPdf and buildReceiptPdfFilename seamlessly', () => {
    const filename = financeService.buildReceiptPdfFilename(sampleReceipt.referenceNumber);
    expect(filename).toBe('UniTap_Receipt_PAY-20261110-7890.pdf');

    const pdfBytes = financeService.generateReceiptPdf(sampleReceipt);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);
  });
});
