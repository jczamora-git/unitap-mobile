import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import UniPageHeader from '@/components/ui/UniPageHeader.vue';
import UniExpandableRow from '@/components/ui/UniExpandableRow.vue';
import UniKpiCarousel from '@/components/ui/UniKpiCarousel.vue';

describe('UniTap 2.0 Responsive UI & Adaptive Layouts', () => {
  describe('UniPageHeader Responsive Title & Actions', () => {
    it('renders full title without rigid clipping for long titles like Offline Financial Reports', () => {
      const wrapper = mount(UniPageHeader, {
        props: {
          title: 'Offline Financial Reports',
          subtitle: 'Track semester fines, contributions, collections, and outstanding obligations.',
          backButton: true,
          variant: 'detail',
        },
        slots: {
          trailing: h('div', { class: 'actions-test' }, 'Action Buttons'),
        },
      });

      const titleEl = wrapper.find('.uni-header-title');
      expect(titleEl.exists()).toBe(true);
      expect(titleEl.text()).toBe('Offline Financial Reports');
      expect(wrapper.find('.uni-header-subtitle').text()).toContain('Track semester fines');
      expect(wrapper.find('.actions-test').exists()).toBe(true);
    });

    it('renders root header without back button when backButton is false', () => {
      const wrapper = mount(UniPageHeader, {
        props: {
          title: 'Event Categories',
          subtitle: 'Manage event classifications',
          backButton: false,
        },
      });

      expect(wrapper.find('.uni-back-btn').exists()).toBe(false);
      expect(wrapper.find('.uni-header-title').text()).toBe('Event Categories');
    });
  });

  describe('UniExpandableRow Responsive Wrapping', () => {
    it('allows long titles to wrap naturally without rigid ellipsis', () => {
      const wrapper = mount(UniExpandableRow, {
        props: {
          title: 'General Institutional Student Assembly with Extended Title Description',
          subtitle: '0 event(s) linked',
          badge: 'ACTIVE',
          badgeVariant: 'success',
        },
        slots: {
          actions: h('div', { class: 'test-action-buttons' }, 'Buttons'),
        },
      });

      expect(wrapper.find('.row-title').text()).toBe(
        'General Institutional Student Assembly with Extended Title Description'
      );
      expect(wrapper.find('.row-badge').text()).toBe('ACTIVE');
      expect(wrapper.find('.row-badge').classes()).toContain('badge-success');
    });

    it('toggles expansion state and exposes action buttons', async () => {
      const wrapper = mount(UniExpandableRow, {
        props: {
          title: '1st Semester',
          subtitle: 'A.Y. 2026–2027 • Aug 1 – Dec 31, 2026',
          badge: 'ACTIVE',
          badgeVariant: 'success',
        },
        slots: {
          content: h('div', { class: 'semester-stats' }, '45 enrolled • 3 events'),
          actions: h('button', { class: 'btn-test-action' }, 'Edit'),
        },
      });

      // Initially collapsed
      expect(wrapper.classes()).not.toContain('is-open');

      // Click row header to toggle
      await wrapper.find('.row-header').trigger('click');
      expect(wrapper.classes()).toContain('is-open');
      expect(wrapper.find('.semester-stats').text()).toContain('45 enrolled');
      expect(wrapper.find('.btn-test-action').text()).toBe('Edit');
    });
  });

  describe('UniKpiCarousel Responsive KPI Amounts', () => {
    it('renders amounts with tabular numeric class and responsive typography', () => {
      const wrapper = mount(UniKpiCarousel, {
        props: {
          items: [
            { id: '1', label: 'Total Assessed', value: '₱1,250,500.00' },
            { id: '2', label: 'Total Collected', value: '₱980,250.00', variant: 'success' },
            { id: '3', label: 'Total Outstanding', value: '₱270,250.00', variant: 'danger' },
          ],
        },
      });

      const cards = wrapper.findAll('.report-kpi-card');
      expect(cards).toHaveLength(3);
      expect(cards[0].find('.card-amount').text()).toBe('₱1,250,500.00');
      expect(cards[1].classes()).toContain('variant-success');
      expect(cards[2].classes()).toContain('variant-danger');
    });
  });
});

