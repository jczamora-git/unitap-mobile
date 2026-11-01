import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import UniSheet from '@/components/ui/UniSheet.vue';
import router from '@/router';

describe('UniTap 2.0 Add/Edit Form Architecture', () => {
  describe('UniSheet Reusable Bottom Sheet Component', () => {
    it('renders with title, description, and slot contents when open', () => {
      const wrapper = mount(UniSheet, {
        props: {
          isOpen: true,
          title: 'Create Semester',
          description: 'Define a new school period',
        },
        slots: {
          default: '<div class="test-form">Form Input Fields</div>',
          footer: '<button class="test-save">Save Semester</button>',
        },
      });

      const container = document.body.querySelector('.uni-sheet-container');
      expect(container).toBeTruthy();
      expect(container?.querySelector('.sheet-title')?.textContent).toBe('Create Semester');
      expect(container?.querySelector('.sheet-subtitle')?.textContent).toBe('Define a new school period');
      expect(container?.querySelector('.test-form')?.textContent).toBe('Form Input Fields');
      expect(container?.querySelector('.test-save')?.textContent).toBe('Save Semester');

      wrapper.unmount();
    });

    it('emits close and update:isOpen events when dismiss is triggered', async () => {
      const wrapper = mount(UniSheet, {
        props: {
          isOpen: true,
          title: 'Edit Year Level',
        },
      });

      const closeBtn = document.body.querySelector('.sheet-close-btn') as HTMLButtonElement;
      expect(closeBtn).toBeTruthy();
      closeBtn?.click();

      expect(wrapper.emitted('close')).toBeTruthy();
      expect(wrapper.emitted('update:isOpen')?.[0]).toEqual([false]);

      wrapper.unmount();
    });
  });

  describe('Full-Page Add/Edit Routes Configuration', () => {
    it('contains full-page routes for Edit Student and Edit Event', () => {
      const routes = router.getRoutes();

      const editStudentRoute = routes.find((r) => r.path === '/students/:id/edit');
      expect(editStudentRoute).toBeDefined();
      expect(editStudentRoute?.name).toBe('EditStudent');

      const editEventRoute = routes.find((r) => r.path === '/events/:id/edit');
      expect(editEventRoute).toBeDefined();
      expect(editEventRoute?.name).toBe('EditEvent');

      const createEventRoute = routes.find((r) => r.path === '/events/create');
      expect(createEventRoute).toBeDefined();

      const registerStudentRoute = routes.find((r) => r.path === '/register-student');
      expect(registerStudentRoute).toBeDefined();
    });
  });
});

