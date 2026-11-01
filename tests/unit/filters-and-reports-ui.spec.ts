import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import UniFilterChip from '@/components/ui/UniFilterChip.vue';
import UniFilterSheet from '@/components/ui/UniFilterSheet.vue';
import UniKpiCarousel from '@/components/ui/UniKpiCarousel.vue';

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
});
