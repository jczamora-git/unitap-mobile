import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import UniButton from '@/components/ui/UniButton.vue';
import UniPageHeader from '@/components/ui/UniPageHeader.vue';
import UniDock from '@/components/navigation/UniDock.vue';
import UniDialog from '@/components/ui/UniDialog.vue';

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
  });
});
