import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import UniFilterChip from '@/components/ui/UniFilterChip.vue';
import UniFilterSheet from '@/components/ui/UniFilterSheet.vue';
import UniKpiCarousel from '@/components/ui/UniKpiCarousel.vue';
import { ReportService } from '@/services/report.service';
import type { StudentObligationReportRow } from '@/database/repositories/reports.repository';

describe('Financial Reports & Filter Components', () => {
  describe('UniFilterChip', () => {
    it('renders label and emits remove when close icon clicked', async () => {
      const wrapper = mount(UniFilterChip, {
        props: {
          label: 'Fines Only',
          removable: true,
        },
      });

      expect(wrapper.find('.chip-label').text()).toBe('Fines Only');
      const closeBtn = wrapper.find('.chip-remove-btn');
      expect(closeBtn.exists()).toBe(true);

      await closeBtn.trigger('click');
      expect(wrapper.emitted('remove')).toBeTruthy();
    });

    it('emits click on chip body', async () => {
      const wrapper = mount(UniFilterChip, {
        props: {
          label: 'Section 4F4',
          removable: false,
        },
      });

      await wrapper.trigger('click');
      expect(wrapper.emitted('click')).toBeTruthy();
    });
  });

  describe('UniKpiCarousel', () => {
    it('renders horizontal scrollable KPI cards with large amounts', () => {
      const items = [
        { id: 'assessed', label: 'Total Assessed', value: '₱12,500.00', meta: 'All obligations' },
        { id: 'collected', label: 'Total Collected', value: '₱8,000.00', meta: '64% rate', variant: 'success' as const },
        { id: 'outstanding', label: 'Total Outstanding', value: '₱4,500.00', meta: 'Balance', variant: 'danger' as const },
      ];

      const wrapper = mount(UniKpiCarousel, {
        props: { items },
      });

      const cards = wrapper.findAll('.report-kpi-card');
      expect(cards).toHaveLength(3);
      expect(cards[0].find('.card-label').text()).toBe('Total Assessed');

      expect(cards[0].find('.card-amount').text()).toBe('₱12,500.00');
      expect(cards[1].classes()).toContain('variant-success');
      expect(cards[2].classes()).toContain('variant-danger');
    });
  });

  describe('UniFilterSheet', () => {
    it('emits apply and reset events correctly', async () => {
      const wrapper = mount(UniFilterSheet, {
        props: {
          isOpen: true,
          title: 'Filter Reports',
          activeCount: 2,
        },
        global: {
          stubs: {
            teleport: true,
            transition: false,
          },
        },
      });

      expect(wrapper.find('.filter-count-badge').text()).toContain('2 active');

      const resetBtn = wrapper.find('.btn-reset');
      const applyBtn = wrapper.find('.btn-apply');

      await resetBtn.trigger('click');
      expect(wrapper.emitted('reset')).toBeTruthy();

      await applyBtn.trigger('click');
      expect(wrapper.emitted('apply')).toBeTruthy();
      expect(wrapper.emitted('update:isOpen')?.[0]).toEqual([false]);
    });
  });

  describe('ReportService PDF Generation & Filename', () => {
    it('builds descriptive filename matching expected convention', () => {
      const filename1 = ReportService.buildObligationsPdfFilename({
        academic_year_id: '2026-2027',
        term: '1ST',
      });
      expect(filename1).toBe('UniTap_Financial_Report_2026-2027_1st_Semester.pdf');

      const filename2 = ReportService.buildObligationsPdfFilename({
        academic_year_id: 'ay_2025_2026',
        term: '2nd Semester',
      });
      expect(filename2).toBe('UniTap_Financial_Report_2025-2026_2nd_Semester.pdf');

      const filename3 = ReportService.buildObligationsPdfFilename({
        academic_year_id: '2026-2027',
        term: 'Summer Midyear',
      });
      expect(filename3).toBe('UniTap_Financial_Report_2026-2027_Midyear.pdf');

      const filenameDefault = ReportService.buildObligationsPdfFilename(undefined);
      expect(filenameDefault).toBe('UniTap_Financial_Report.pdf');
    });

    it('generates valid PDF 1.4 byte stream with correct header, trailer, and metadata', () => {
      const rows: StudentObligationReportRow[] = [
        {
          school_id: '2023-0001',
          first_name: 'Juan',
          middle_name: 'Protacio',
          last_name: 'Dela Cruz',
          year_level: 3,
          section: '3A',
          obligation_type: 'CONTRIBUTION',
          title: 'CSG Membership Fee',
          assessed_centavos: 10000,
          paid_centavos: 10000,
          balance_centavos: 0,
        },
        {
          school_id: '2023-0002',
          first_name: 'Maria',
          middle_name: '',
          last_name: 'Santos',
          year_level: 2,
          section: '2B',
          obligation_type: 'FINE',
          title: 'General Assembly Absentee',
          assessed_centavos: 5000,
          paid_centavos: 2500,
          balance_centavos: 2500,
        },
      ];

      const pdfBytes = ReportService.generateObligationsPdf(rows, '1st Semester • A.Y. 2026-2027', 'DevAdmin');
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(500);

      const pdfText = new TextDecoder('latin1').decode(pdfBytes);

      // Verify PDF 1.4 specification compliance
      expect(pdfText.startsWith('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')).toBe(true);
      expect(pdfText).toContain('/Type /Catalog');
      expect(pdfText).toContain('/Type /Pages');
      expect(pdfText).toContain('/Type1');
      expect(pdfText).toContain('UniTap 2.0 Financial Report');
      expect(pdfText).toContain('2023-0001');
      expect(pdfText).toContain('Dela Cruz, Juan');
      expect(pdfText).toContain('PHP 150.00'); // Total assessed: 100 + 50 = 150
      expect(pdfText).toContain('PHP 125.00'); // Total paid: 100 + 25 = 125
      expect(pdfText).toContain('PHP 25.00');  // Total outstanding: 25
      expect(pdfText).toContain('xref');
      expect(pdfText).toContain('trailer');
      expect(pdfText.trim().endsWith('%%EOF')).toBe(true);
    });

    it('generates multi-page PDF gracefully when rows exceed single-page limit', () => {
      const rows: StudentObligationReportRow[] = [];
      for (let i = 1; i <= 60; i++) {
        rows.push({
          school_id: `2024-${String(i).padStart(4, '0')}`,
          first_name: `Student${i}`,
          middle_name: '',
          last_name: `Test${i}`,
          year_level: 1,
          section: '1A',
          obligation_type: 'CONTRIBUTION',
          title: 'Annual Dues',
          assessed_centavos: 10000,
          paid_centavos: 0,
          balance_centavos: 10000,
        });
      }

      const pdfBytes = ReportService.generateObligationsPdf(rows, '1st Semester • A.Y. 2026-2027', 'DevAdmin');
      const pdfText = new TextDecoder('latin1').decode(pdfBytes);

      // Should have 2 pages (26 on page 1, 34 on page 2)
      expect(pdfText).toContain('/Count 2');
      expect(pdfText).toContain('Page 1 of 2');
      expect(pdfText).toContain('Page 2 of 2');
    });

    it('handles empty report gracefully without crashing', () => {
      const pdfBytes = ReportService.generateObligationsPdf([], '1st Semester • A.Y. 2026-2027', 'DevAdmin');
      const pdfText = new TextDecoder('latin1').decode(pdfBytes);

      expect(pdfText.startsWith('%PDF-1.4')).toBe(true);
      expect(pdfText).toContain('/Count 1');
      expect(pdfText).toContain('No financial obligation records found');
      expect(pdfText.trim().endsWith('%%EOF')).toBe(true);
    });
  });
});
