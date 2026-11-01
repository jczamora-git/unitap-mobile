import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { h, ref } from 'vue';
import UniSheetNavigator from '@/components/ui/UniSheetNavigator.vue';
import UniSelect from '@/components/ui/UniSelect.vue';
import UniFilterSheet from '@/components/ui/UniFilterSheet.vue';
import UniButton from '@/components/ui/UniButton.vue';

describe('UniTap 2.0 Single-Sheet Navigation & Button Consistency', () => {
  describe('UniSheetNavigator', () => {
    it('initializes on root view and computes canGoBack false', () => {
      const wrapper = mount(UniSheetNavigator, {
        props: {
          rootTitle: 'Filter Sections',
        },
        slots: {
          default: '<div class="main-content">Filter Fields</div>',
        },
      });

      expect(wrapper.vm.currentView).toBe('root');
      expect(wrapper.vm.canGoBack).toBe(false);
      expect(wrapper.find('.main-content').text()).toBe('Filter Fields');
    });

    it('pushes a selection view, renders options list and checkmarks, and auto-pops on select', async () => {
      let selectedVal: string | number = '';
      const options = [
        { value: '', label: 'All Year Levels' },
        { value: 'yl-1', label: '1st Year' },
        { value: 'yl-2', label: '2nd Year' },
      ];

      const wrapper = mount(UniSheetNavigator, {
        props: {
          rootTitle: 'Filter Sections',
        },
        slots: {
          default: '<div class="main-content">Filter Fields</div>',
        },
      });

      // Push selection view
      wrapper.vm.pushView('selection', 'Select Year Level', {
        options,
        selectedValue: '',
        onSelect: (val) => {
          selectedVal = val;
        },
      });

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.currentView).toBe('selection');
      expect(wrapper.vm.currentTitle).toBe('Select Year Level');
      expect(wrapper.vm.canGoBack).toBe(true);

      const optionItems = wrapper.findAll('.selection-option-item');
      expect(optionItems).toHaveLength(3);
      expect(optionItems[0].classes()).toContain('is-selected'); // '' is selected
      expect(optionItems[1].text()).toContain('1st Year');

      // Click second option ('yl-1')
      await optionItems[1].trigger('click');

      expect(selectedVal).toBe('yl-1');
      // Automatically popped back to root
      expect(wrapper.vm.currentView).toBe('root');
      expect(wrapper.vm.canGoBack).toBe(false);
    });

    it('navigates back via popView without changing value', async () => {
      let selectedVal = 'initial';
      const wrapper = mount(UniSheetNavigator, {
        props: { rootTitle: 'Filter Sections' },
      });

      wrapper.vm.pushView('selection', 'Select Year Level', {
        options: [{ value: 'yl-1', label: '1st Year' }],
        selectedValue: 'initial',
        onSelect: (val) => {
          selectedVal = String(val);
        },
      });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.canGoBack).toBe(true);
      wrapper.vm.popView();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.currentView).toBe('root');
      expect(selectedVal).toBe('initial'); // unchanged
    });

    it('resetToRoot resets the stack to root view', async () => {
      const wrapper = mount(UniSheetNavigator, {
        props: { rootTitle: 'Filter Sections' },
      });

      wrapper.vm.pushView('subview-1', 'Sub View 1');
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.currentView).toBe('subview-1');

      wrapper.vm.resetToRoot();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.currentView).toBe('root');
      expect(wrapper.vm.canGoBack).toBe(false);
    });
  });

  describe('UniSelect in Embedded Mode', () => {
    it('pushes selection view to injected UniSheetNavigator instead of standalone dropdown', async () => {
      let pushedView = '';
      let pushedTitle = '';
      let pushedMeta: any = null;

      const mockNavigator = {
        currentView: ref('root'),
        currentTitle: ref('Main'),
        canGoBack: ref(false),
        pushView: (id: string, title?: string, meta?: any) => {
          pushedView = id;
          pushedTitle = title || '';
          pushedMeta = meta;
        },
        popView: () => {},
        resetToRoot: () => {},
      };

      const wrapper = mount(UniSelect, {
        props: {
          modelValue: 'yl-1',
          options: [
            { value: '', label: 'All Year Levels' },
            { value: 'yl-1', label: '1st Year' },
          ],
          placeholder: 'All Year Levels',
          header: 'Select Year Level',
          presentation: 'embedded',
        },
        global: {
          provide: {
            'uni-sheet-navigator': mockNavigator,
          },
        },
      });

      const trigger = wrapper.find('.uni-select-trigger');
      expect(trigger.classes()).toContain('is-embedded');

      // Click trigger
      await trigger.trigger('click');

      expect(pushedView).toBe('selection');
      expect(pushedTitle).toBe('Select Year Level');
      expect(pushedMeta.selectedValue).toBe('yl-1');
      expect(pushedMeta.options).toHaveLength(2);

      // Verify that selecting updates modelValue
      pushedMeta.onSelect('yl-2');
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['yl-2']);
    });
  });

  describe('UniFilterSheet with Single-Sheet Navigation', () => {
    it('renders single sheet container, displays active filters and handles embedded navigation', async () => {
      const wrapper = mount(UniFilterSheet, {
        props: {
          isOpen: true,
          title: 'Filter Sections',
          subtitle: 'Refine options',
          activeCount: 3,
        },
        slots: {
          default: h('div', { class: 'embedded-fields' }, 'Embedded Fields'),
        },
        global: {
          stubs: {
            teleport: true,
            transition: false,
          },
        },
      });

      expect(wrapper.find('.filter-count-badge').text()).toContain('3 active');
      expect(wrapper.find('.embedded-fields').text()).toBe('Embedded Fields');

      // Footer actions are present on root view
      expect(wrapper.find('.btn-reset').exists()).toBe(true);
      expect(wrapper.find('.btn-apply').exists()).toBe(true);

      // Apply triggers apply event
      await wrapper.find('.btn-apply').trigger('click');
      expect(wrapper.emitted('apply')).toBeTruthy();
      expect(wrapper.emitted('update:isOpen')?.[0]).toEqual([false]);
    });
  });

  describe('Button Consistency & Minimal New Button', () => {
    it('UniButton primary variant renders with correct class and type', () => {
      const wrapper = mount(UniButton, {
        props: {
          variant: 'primary',
          size: 'sm',
          ariaLabel: 'Create new section',
        },
        slots: {
          default: 'New',
        },
      });

      expect(wrapper.classes()).toContain('uni-btn-primary');
      expect(wrapper.classes()).toContain('uni-btn-sm');
      expect(wrapper.attributes('aria-label')).toBe('Create new section');
      expect(wrapper.find('.btn-label').text()).toBe('New');
    });

    it('UniButton handles click and emits event', async () => {
      const wrapper = mount(UniButton, {
        props: {
          variant: 'primary',
        },
        slots: {
          default: 'Apply Filters',
        },
      });

      await wrapper.trigger('click');
      expect(wrapper.emitted('click')).toBeTruthy();
    });
  });
});

