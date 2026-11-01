<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonPage, IonContent, IonSpinner } from '@ionic/vue';
import { UniPageHeader, UniButton } from '@/components/ui';
import YearLevelPicker from '@/components/YearLevelPicker.vue';
import { useStudents } from '@/composables/useStudents';
import { useToast } from '@/composables/useToast';
import type { YearLevel, UpdateStudentDto } from '@/types/student';
import { haptics } from '@/utilities/haptics';

const route = useRoute();
const router = useRouter();
const studentId = computed(() => String(route.params.id || ''));

const { getStudentById, updateStudent } = useStudents();
const { showToast } = useToast();

const isLoading = ref(true);
const isSaving = ref(false);
const errorMsg = ref<string | null>(null);

const studentNumber = ref('');
const firstName = ref('');
const middleName = ref('');
const lastName = ref('');
const yearLevel = ref<YearLevel>(1);
const section = ref('');
const course = ref('BSIT');

const isValid = computed(() => {
  return (
    firstName.value.trim().length > 0 &&
    lastName.value.trim().length > 0 &&
    section.value.trim().length > 0 &&
    course.value.trim().length > 0
  );
});

onMounted(async () => {
  if (!studentId.value) {
    router.replace('/tabs/students');
    return;
  }

  try {
    const student = await getStudentById(studentId.value);
    if (!student) {
      router.replace('/tabs/students');
      return;
    }

    studentNumber.value = student.studentNumber || '';
    firstName.value = student.firstName;
    middleName.value = student.middleName || '';
    lastName.value = student.lastName;
    yearLevel.value = student.yearLevel;
    section.value = student.section;
    course.value = student.course || 'BSIT';
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to load student record';
  } finally {
    isLoading.value = false;
  }
});

async function handleSave() {
  if (!isValid.value || isSaving.value) return;

  isSaving.value = true;
  errorMsg.value = null;

  try {
    const dto: UpdateStudentDto = {
      studentNumber: studentNumber.value.trim() || undefined,
      firstName: firstName.value.trim(),
      middleName: middleName.value.trim() || undefined,
      lastName: lastName.value.trim(),
      yearLevel: yearLevel.value,
      section: section.value.trim(),
      course: course.value.trim(),
    };

    await updateStudent(studentId.value, dto);
    haptics.success();
    await showToast('Student profile updated successfully', 'success');
    router.push(`/students/${studentId.value}`);
  } catch (err: unknown) {
    haptics.error();
    errorMsg.value = err instanceof Error ? err.message : 'Error updating student record';
  } finally {
    isSaving.value = false;
  }
}

function handleCancel() {
  haptics.light();
  router.push(`/students/${studentId.value}`);
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Edit Student Profile"
      subtitle="Update demographic and academic directory data"
      :back-button="true"
      :default-back-href="`/students/${studentId}`"
      variant="detail"
    />

    <ion-content class="edit-student-content safe-content">
      <div v-if="isLoading" class="loading-state">
        <ion-spinner name="crescent" color="primary" />
        <p class="secondary-text">Loading profile details...</p>
      </div>

      <div v-else class="page-container">
        <form class="edit-form-card" @submit.prevent="handleSave">
          <div v-if="errorMsg" class="error-banner">
            {{ errorMsg }}
          </div>

          <!-- Academic Identification -->
          <div class="form-section">
            <h3 class="section-title">Academic Identification</h3>

            <div class="form-group">
              <label class="input-label">Student ID Number</label>
              <input
                v-model="studentNumber"
                type="text"
                placeholder="e.g. 2023-10024"
                class="form-input font-mono"
              />
              <span class="field-hint">Institutional identifier printed on ID card.</span>
            </div>

            <div class="form-group">
              <label class="input-label">Program / Course <span class="req">*</span></label>
              <input
                v-model="course"
                type="text"
                placeholder="e.g. BSIT"
                class="form-input"
                required
              />
            </div>
          </div>

          <!-- Personal Information -->
          <div class="form-section">
            <h3 class="section-title">Personal Name</h3>

            <div class="form-row-2">
              <div class="form-group">
                <label class="input-label">First Name <span class="req">*</span></label>
                <input
                  v-model="firstName"
                  type="text"
                  placeholder="e.g. Juan"
                  class="form-input"
                  required
                />
              </div>

              <div class="form-group">
                <label class="input-label">Middle Name</label>
                <input
                  v-model="middleName"
                  type="text"
                  placeholder="e.g. Protacio"
                  class="form-input"
                />
              </div>
            </div>

            <div class="form-group">
              <label class="input-label">Last Name <span class="req">*</span></label>
              <input
                v-model="lastName"
                type="text"
                placeholder="e.g. Dela Cruz"
                class="form-input"
                required
              />
            </div>
          </div>

          <!-- Academic Placement -->
          <div class="form-section">
            <h3 class="section-title">Academic Placement</h3>

            <div class="form-group">
              <label class="input-label">Year Level <span class="req">*</span></label>
              <YearLevelPicker v-model="yearLevel" />
            </div>

            <div class="form-group">
              <label class="input-label">Section <span class="req">*</span></label>
              <input
                v-model="section"
                type="text"
                placeholder="e.g. 1F4"
                class="form-input font-mono"
                required
              />
            </div>
          </div>

          <!-- Sticky / Inline Form Actions -->
          <div class="form-actions-row">
            <UniButton
              type="button"
              variant="outline"
              @click="handleCancel"
            >
              Cancel
            </UniButton>

            <UniButton
              type="submit"
              variant="primary"
              :disabled="!isValid || isSaving"
              :loading="isSaving"
            >
              Save Changes
            </UniButton>
          </div>
        </form>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.edit-student-content {
  --background: var(--uni-background, #F8FAFC);
}

.page-container {
  max-width: 600px;
  margin: 0 auto;
  padding: 4px 0 24px 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.edit-form-card {
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #E2E8F0);
  border-radius: var(--uni-radius-card, 16px);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  box-shadow: var(--uni-shadow-card);
}

@media (max-width: 380px) {
  .edit-form-card {
    padding: 14px;
    gap: 14px;
  }
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--uni-border, #E2E8F0);
}

.form-section:last-of-type {
  border-bottom: none;
  padding-bottom: 0;
}

.section-title {
  font-size: 13.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--uni-text-secondary, #64748B);
  margin: 0;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.form-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 480px) {
  .form-row-2 {
    grid-template-columns: 1fr;
  }
}

.input-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--uni-text, #0F172A);
}

.req {
  color: var(--uni-danger, #DC2626);
}

.field-hint {
  font-size: 11px;
  color: var(--uni-text-secondary, #64748B);
}

.form-input {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  background: var(--uni-surface-secondary, #F1F5F9);
  border: 1px solid var(--uni-border, #E2E8F0);
  border-radius: var(--uni-radius-card, 12px);
  color: var(--uni-text, #0F172A);
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.16s ease;
}

.form-input:focus {
  border-color: var(--uni-primary, #0F766E);
  background: var(--uni-surface, #ffffff);
}

.form-actions-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 10px;
}

.error-banner {
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(220, 38, 38, 0.1);
  color: var(--uni-danger, #DC2626);
  font-size: 13px;
  font-weight: 600;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
  gap: 12px;
}

:global(.dark) .edit-student-content {
  --background: var(--uni-background, #0F1117);
}

:global(.dark) .edit-form-card {
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
}

:global(.dark) .form-section {
  border-color: var(--uni-border, #30343D);
}

:global(.dark) .section-title {
  color: var(--uni-text-secondary, #9CA3AF);
}

:global(.dark) .input-label {
  color: var(--uni-text, #F8FAFC);
}

:global(.dark) .form-input {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #30343D);
  color: var(--uni-text, #F8FAFC);
}

:global(.dark) .form-input:focus {
  border-color: var(--uni-primary, #5EEAD4);
  background: var(--uni-surface, #1B1D23);
}
</style>

