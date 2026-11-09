import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { INSTITUTION_CONFIG, INSTITUTION_NAME, INSTITUTION_PASS_SUBTITLE } from '@/utilities/branding';
import { INSTITUTION_CONFIG as RE_EXPORTED_CONFIG } from '@/utilities/presentation-formatters';
import StudentPassPage from '@/views/StudentPassPage.vue';

// Mock ionic components & vue-router
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('@ionic/vue', async () => {
  const actual = await vi.importActual<any>('@ionic/vue');
  return {
    ...actual,
    onIonViewWillEnter: vi.fn((cb) => cb?.()),
  };
});

// Mock useCurrentStudentPortal
vi.mock('@/composables/useCurrentStudentPortal', () => ({
  useCurrentStudentPortal: () => ({
    student: ref({
      id: 'stu_minsu_test',
      studentNumber: 'MINSU-2026-0001',
      firstName: 'Juan',
      lastName: 'Dela Cruz',
      course: 'BSIT',
      yearLevel: 3,
      section: '3A',
      rfidUid: '04A1B2C3D4',
    }),
    studentName: ref('Juan Dela Cruz'),
    academicSummary: ref('BSIT - 3rd Year (Sec 3A)'),
    isLoading: ref(false),
    loadPortalData: vi.fn(),
  }),
}));

describe('UniTap 2.0 Institutional Branding & Digital Student Pass', () => {
  it('1. Centralized branding configuration defines Mindoro State University and CSG subtitle', () => {
    expect(INSTITUTION_CONFIG.name).toBe('MINDORO STATE UNIVERSITY');
    expect(INSTITUTION_NAME).toBe('MINDORO STATE UNIVERSITY');
    expect(INSTITUTION_CONFIG.collegeName).toBe('College of Computer Studies');
    expect(INSTITUTION_CONFIG.organizationName).toBe('Computer Studies Government');
    expect(INSTITUTION_CONFIG.organizationAcronym).toBe('CSG');
    expect(INSTITUTION_CONFIG.passSubtitle).toBe('College of Computer Studies - CSG');
    expect(INSTITUTION_PASS_SUBTITLE).toBe('College of Computer Studies - CSG');

    // Re-export consistency
    expect(RE_EXPORTED_CONFIG.name).toBe('MINDORO STATE UNIVERSITY');
    expect(RE_EXPORTED_CONFIG.passSubtitle).toBe('College of Computer Studies - CSG');
  });

  it('2. StudentPassPage renders MINDORO STATE UNIVERSITY as institutional header', () => {
    const wrapper = mount(StudentPassPage, {
      global: {
        stubs: {
          IonPage: { template: '<div><slot /></div>' },
          IonContent: { template: '<div><slot /></div>' },
          IonIcon: true,
          IonSpinner: true,
          UniPageHeader: { template: '<div><slot name="end" /></div>' },
          UniButton: true,
        },
      },
    });

    const instName = wrapper.find('.inst-name');
    expect(instName.exists()).toBe(true);
    expect(instName.text()).toBe('MINDORO STATE UNIVERSITY');

    const deptName = wrapper.find('.dept-name');
    expect(deptName.exists()).toBe(true);
    expect(deptName.text()).toBe('College of Computer Studies - CSG');

    // Never displays legacy Mabalacat City College
    expect(wrapper.text()).not.toContain('MABALACAT');
    expect(wrapper.text()).not.toContain('MALABACAT');

    wrapper.unmount();
  });

  it('3. Digital Student Pass preserves essential student details, chip, and barcode layout', () => {
    const wrapper = mount(StudentPassPage, {
      global: {
        stubs: {
          IonPage: { template: '<div><slot /></div>' },
          IonContent: { template: '<div><slot /></div>' },
          IonIcon: true,
          IonSpinner: true,
          UniPageHeader: true,
          UniButton: true,
        },
      },
    });

    expect(wrapper.find('.smart-pass-card').exists()).toBe(true);
    expect(wrapper.find('.pass-name').text()).toBe('Juan Dela Cruz');
    expect(wrapper.find('.pass-id-number').text()).toBe('MINSU-2026-0001');
    expect(wrapper.find('.pass-type-badge').text()).toBe('STUDENT');
    expect(wrapper.find('.nfc-state').text()).toBe('NFC Pass Linked & Active');

    wrapper.unmount();
  });
});

