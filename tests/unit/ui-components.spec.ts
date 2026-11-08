import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import UniButton from '@/components/ui/UniButton.vue';
import UniPageHeader from '@/components/ui/UniPageHeader.vue';
import UniDock from '@/components/navigation/UniDock.vue';
import UniDialog from '@/components/ui/UniDialog.vue';
import UniPagination from '@/components/ui/UniPagination.vue';
import UniExpandableRow from '@/components/ui/UniExpandableRow.vue';
import UniTreeView from '@/components/ui/UniTreeView.vue';
import UniSelect from '@/components/ui/UniSelect.vue';
import UniToast from '@/components/ui/UniToast.vue';
import { useToast } from '@/composables/useToast';


// Mock vue-router for components calling useRouter
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
}));

describe('UI Component Regression Suite', () => {
  describe('UniButton', () => {
    it('renders with default primary variant and md size', () => {
      const wrapper = mount(UniButton, {
        slots: { default: 'Click Me' }
      });
      expect(wrapper.classes()).toContain('uni-btn');
      expect(wrapper.classes()).toContain('uni-btn-primary');
      expect(wrapper.classes()).toContain('uni-btn-md');
      expect(wrapper.text()).toContain('Click Me');
    });

    it('renders destructive variant with proper classes', () => {
      const wrapper = mount(UniButton, {
        props: { variant: 'destructive', size: 'sm' },
        slots: { default: 'Delete Item' }
      });
      expect(wrapper.classes()).toContain('uni-btn-destructive');
      expect(wrapper.classes()).toContain('uni-btn-sm');
    });

    it('supports icon and icon-sm sizes with accessibility label', () => {
      const wrapper = mount(UniButton, {
        props: { size: 'icon', ariaLabel: 'Settings Action' }
      });
      expect(wrapper.classes()).toContain('uni-btn-icon');
      expect(wrapper.attributes('aria-label')).toBe('Settings Action');
    });

    it('handles disabled and loading states preventing click emissions', async () => {
      const wrapper = mount(UniButton, {
        props: { loading: true },
        slots: { default: 'Submitting' }
      });
      expect(wrapper.classes()).toContain('uni-btn-loading');
      expect(wrapper.attributes('disabled')).toBeDefined();
      await wrapper.trigger('click');
      expect(wrapper.emitted('click')).toBeUndefined();
    });
  });

  describe('UniPageHeader', () => {
    it('renders title, subtitle, and badge correctly', () => {
      const wrapper = mount(UniPageHeader, {
        props: {
          title: 'UniTap Dashboard',
          subtitle: 'CSG operations',
          optionalBadge: 'Active',
          badgeVariant: 'mint'
        }
      });
      expect(wrapper.find('.uni-header-title').text()).toBe('UniTap Dashboard');
      expect(wrapper.find('.uni-header-subtitle').text()).toBe('CSG operations');
      expect(wrapper.find('.uni-header-badge').text()).toBe('Active');
      expect(wrapper.find('.uni-header-badge').classes()).toContain('badge-mint');
    });

    it('renders trailing slot action elements', () => {
      const wrapper = mount(UniPageHeader, {
        props: { title: 'Settings' },
        slots: {
          trailing: '<button class="uni-header-action-btn" aria-label="Action">X</button>'
        }
      });
      const trailingBtn = wrapper.find('.uni-header-trailing button');
      expect(trailingBtn.exists()).toBe(true);
      expect(trailingBtn.classes()).toContain('uni-header-action-btn');
    });
  });

  describe('UniDock', () => {
    it('renders exactly five navigation tabs with icons only and proper aria-labels', () => {
      const wrapper = mount(UniDock, {
        props: { currentTab: 'home' }
      });
      const items = wrapper.findAll('.uni-dock-item');
      expect(items).toHaveLength(5);
      
      const labels = items.map(i => i.attributes('aria-label'));
      expect(labels).toEqual(['Home', 'Events', 'Scan', 'Students', 'Finance']);
      
      const activeItem = wrapper.find('.uni-dock-item.is-active');
      expect(activeItem.attributes('aria-label')).toBe('Home');
      expect(activeItem.attributes('aria-current')).toBe('page');
    });

    it('emits select event with tab id when clicked', async () => {
      const wrapper = mount(UniDock, {
        props: { currentTab: 'home' }
      });
      const scanTab = wrapper.findAll('.uni-dock-item')[2];
      await scanTab.trigger('click');
      expect(wrapper.emitted('select')).toBeTruthy();
      expect(wrapper.emitted('select')?.[0]).toEqual(['scan']);
    });
  });

  describe('UniDialog', () => {
    it('renders when isOpen is true and emits confirm on click', async () => {
      const wrapper = mount(UniDialog, {
        props: {
          isOpen: true,
          title: 'Delete Student Record?',
          description: 'Are you sure?',
          confirmText: 'Delete',
          destructive: true,
          type: 'destructive'
        },
        global: {
          stubs: {
            teleport: true,
            transition: false
          }
        }
      });
      
      expect(wrapper.find('.dialog-title').text()).toBe('Delete Student Record?');
      expect(wrapper.find('.dialog-desc').text()).toBe('Are you sure?');
      
      const confirmBtn = wrapper.find('.dialog-btn-destructive');
      expect(confirmBtn.exists()).toBe(true);
      expect(confirmBtn.text()).toBe('Delete');
      
      await confirmBtn.trigger('click');
      expect(wrapper.emitted('confirm')).toBeTruthy();
      expect(wrapper.emitted('update:isOpen')?.[0]).toEqual([false]);
    });

    it('emits cancel and close when cancel button is clicked', async () => {
      const wrapper = mount(UniDialog, {
        props: {
          isOpen: true,
          title: 'Clear History',
          cancelText: 'Dismiss'
        },
        global: {
          stubs: {
            teleport: true,
            transition: false
          }
        }
      });
      
      const cancelBtn = wrapper.find('.dialog-btn-cancel');
      await cancelBtn.trigger('click');
      expect(wrapper.emitted('cancel')).toBeTruthy();
      expect(wrapper.emitted('close')).toBeTruthy();
      expect(wrapper.emitted('update:isOpen')?.[0]).toEqual([false]);
    });

    it('supports loading prop, disables buttons, and prevents auto-close and backdrop cancel while loading', async () => {
      const wrapper = mount(UniDialog, {
        props: {
          isOpen: true,
          title: 'Delete Contribution Collection?',
          confirmText: 'Delete Collection',
          destructive: true,
          loading: true,
          preventAutoClose: true,
        },
        global: {
          stubs: {
            teleport: true,
            transition: false,
          },
        },
      });

      const confirmBtn = wrapper.find('.dialog-btn-destructive');
      const cancelBtn = wrapper.find('.dialog-btn-cancel');
      const overlay = wrapper.find('.uni-dialog-overlay');

      expect((confirmBtn.element as HTMLButtonElement).disabled).toBe(true);
      expect((cancelBtn.element as HTMLButtonElement).disabled).toBe(true);

      // Attempt clicking overlay while loading
      await overlay.trigger('click');
      expect(wrapper.emitted('cancel')).toBeFalsy();
      expect(wrapper.emitted('update:isOpen')).toBeFalsy();

      // Attempt clicking confirm while loading
      await confirmBtn.trigger('click');
      expect(wrapper.emitted('confirm')).toBeFalsy();
    });

    it('supports preventAutoClose prop to keep dialog open until parent finishes operation', async () => {
      const wrapper = mount(UniDialog, {
        props: {
          isOpen: true,
          title: 'Async Operation',
          confirmText: 'Proceed',
          preventAutoClose: true,
        },
        global: {
          stubs: {
            teleport: true,
            transition: false,
          },
        },
      });

      const confirmBtn = wrapper.find('.dialog-btn-confirm');
      await confirmBtn.trigger('click');

      expect(wrapper.emitted('confirm')).toBeTruthy();
      expect(wrapper.emitted('update:isOpen')).toBeFalsy();
    });
  });

  describe('UniPagination', () => {
    it('calculates range and page count correctly', () => {
      const wrapper = mount(UniPagination, {
        props: {
          totalItems: 45,
          pageSize: 10,
          currentPage: 2,
        },
      });

      expect(wrapper.find('.range-text').text()).toContain('Showing 11–20 of 45');
      expect(wrapper.find('.page-indicator').text()).toBe('Page 2 of 5');
    });

    it('emits page update when clicking next and prev', async () => {
      const wrapper = mount(UniPagination, {
        props: {
          totalItems: 30,
          pageSize: 10,
          currentPage: 2,
        },
      });

      const buttons = wrapper.findAll('.pagination-btn');
      const prevBtn = buttons[0];
      const nextBtn = buttons[1];

      await nextBtn.trigger('click');
      expect(wrapper.emitted('update:currentPage')?.[0]).toEqual([3]);

      await prevBtn.trigger('click');
      expect(wrapper.emitted('update:currentPage')?.[1]).toEqual([1]);
    });
  });

  describe('UniExpandableRow', () => {
    it('toggles expansion state and emits events', async () => {
      const wrapper = mount(UniExpandableRow, {
        props: {
          title: 'Juan Dela Cruz',
          subtitle: '2023-0001 • BSIT 2A',
          badge: 'Unpaid',
          amount: '₱100.00',
        },
        slots: {
          content: '<div class="test-details">Fine details</div>',
        },
      });

      expect(wrapper.find('.row-title').text()).toBe('Juan Dela Cruz');
      expect(wrapper.find('.row-badge').text()).toBe('Unpaid');
      expect(wrapper.find('.row-amount').text()).toBe('₱100.00');

      // Click to expand
      await wrapper.find('.row-header').trigger('click');
      expect(wrapper.emitted('toggle')?.[0]).toEqual([true]);
      expect(wrapper.classes()).toContain('is-open');
    });
  });

  describe('UniTreeView', () => {
    it('renders parent nodes and children with expand/collapse', async () => {
      const sampleNodes = [
        {
          id: 'yl_1',
          label: '1st Year',
          count: 2,
          children: [
            { id: 'sec_1', label: '1F1', meta: '35 enrolled' },
            { id: 'sec_2', label: '1F2', meta: '40 enrolled' },
          ],
        },
      ];

      const wrapper = mount(UniTreeView, {
        props: {
          nodes: sampleNodes,
          defaultExpandAll: true,
        },
      });

      expect(wrapper.find('.node-label').text()).toBe('1st Year');
      expect(wrapper.find('.node-count-pill').text()).toBe('2');
      expect(wrapper.findAll('.tree-child-item')).toHaveLength(2);

      // Toggle collapse
      await wrapper.find('.node-header').trigger('click');
      expect(wrapper.emitted('node-toggle')?.[0]).toEqual(['yl_1', false]);
    });
  });

  describe('Toast Notification System', () => {
    it('sets and clears toast state via useToast', () => {
      const { toastState, showToast, hideToast } = useToast();
      showToast('Collection created successfully', 'success', 5000);
      expect(toastState.value.show).toBe(true);
      expect(toastState.value.message).toBe('Collection created successfully');
      expect(toastState.value.type).toBe('success');

      hideToast();
      expect(toastState.value.show).toBe(false);
    });

    it('renders UniToast component with proper message and class', () => {
      const wrapper = mount(UniToast, {
        props: {
          show: true,
          message: 'Payment recorded',
          type: 'success',
        },
        global: {
          stubs: { Teleport: true, IonIcon: true },
        },
      });

      expect(wrapper.find('.toast-text').text()).toBe('Payment recorded');
      expect(wrapper.find('.uni-toast-card').classes()).toContain('toast-success');
    });
  });

  describe('Global Selection Rule (UniSelect)', () => {
    it('uses a selection sheet when 3 or more options are provided', async () => {
      const options = [
        { value: 'ALL', label: 'All Students' },
        { value: 'PROGRAM', label: 'By Program' },
        { value: 'YEAR_LEVEL', label: 'By Year Level' },
      ];

      const wrapper = mount(UniSelect, {
        props: {
          modelValue: 'ALL',
          options,
          header: 'Assignment Scope',
        },
        global: {
          stubs: { Teleport: true, IonIcon: true },
        },
      });

      // Tapping trigger opens selection sheet instead of dropdown menu
      await wrapper.find('.uni-select-trigger').trigger('click');
      // Dropdown menu should not be rendered
      expect(wrapper.find('.uni-dropdown-menu').exists()).toBe(false);
      // UniSheet container should be rendered
      expect(wrapper.find('.uni-selection-sheet-container').exists()).toBe(true);
      expect(wrapper.findAll('.uni-selection-option-row')).toHaveLength(3);
    });

    it('uses dropdown menu when fewer than 3 options are provided', async () => {
      const options = [
        { value: '1', label: 'Option One' },
        { value: '2', label: 'Option Two' },
      ];

      const wrapper = mount(UniSelect, {
        props: {
          modelValue: '1',
          options,
        },
        global: {
          stubs: { Teleport: true, IonIcon: true },
        },
      });

      await wrapper.find('.uni-select-trigger').trigger('click');
      // Selection sheet container should not be rendered
      expect(wrapper.find('.uni-selection-sheet-container').exists()).toBe(false);
      // Floating dropdown menu should be rendered
      expect(wrapper.find('.uni-dropdown-menu').exists()).toBe(true);
      expect(wrapper.findAll('.uni-dropdown-item')).toHaveLength(2);
    });
  });
});
