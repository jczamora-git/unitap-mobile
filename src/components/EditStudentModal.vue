<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Student, YearLevel, UpdateStudentDto } from '@/types/student';
import { 
  IonHeader, 
  IonToolbar, 
  IonTitle, 
  IonButtons, 
  IonButton, 
  IonContent, 
  IonIcon,
  IonInput,
  IonSpinner
} from '@ionic/vue';
import { closeOutline, saveOutline } from 'ionicons/icons';
import YearLevelPicker from './YearLevelPicker.vue';
import { useStudents } from '@/composables/useStudents';
import { useToast } from '@/composables/useToast';

const props = defineProps<{
  student: Student;
}>();

const emit = defineEmits<{
  (e: 'dismiss'): void;
  (e: 'saved', updated: Student): void;
}>();

const { updateStudent } = useStudents();
const { showToast } = useToast();

const studentNumber = ref(props.student.studentNumber || '');
const firstName = ref(props.student.firstName);
const middleName = ref(props.student.middleName || '');
const lastName = ref(props.student.lastName);
const yearLevel = ref<YearLevel>(props.student.yearLevel);
const section = ref(props.student.section);
const course = ref(props.student.course || 'BSIT');
const isSaving = ref(false);
const errorMsg = ref<string | null>(null);

const isValid = computed(() => {
  return (
    firstName.value.trim().length > 0 &&
    lastName.value.trim().length > 0 &&
    section.value.trim().length > 0 &&
    course.value.trim().length > 0
  );
});

async function handleSave() {
  if (!isValid.value) return;

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
      course: course.value.trim()
    };

    const updated = await updateStudent(props.student.id, dto);
    await showToast('Student profile updated', 'success');
    emit('saved', updated);
    emit('dismiss');
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <ion-header class="ion-no-border modal-header">
    <ion-toolbar>
      <ion-title>Edit Student</ion-title>
      <ion-buttons slot="end">
        <ion-button @click="emit('dismiss')">
          <ion-icon :icon="closeOutline" />
        </ion-button>
      </ion-buttons>
    </ion-toolbar>
  </ion-header>

  <ion-content class="safe-content">
    <div class="modal-form-container">
      <form @submit.prevent="handleSave" class="form-content">
        <!-- Student Number -->
        <div class="form-group">
          <label class="input-label">Student Number</label>
          <ion-input
            v-model="studentNumber"
            placeholder="e.g. 2023-10024"
            type="text"
            class="custom-input"
          />
        </div>

        <!-- First Name -->
        <div class="form-group">
          <label class="input-label">First Name *</label>
          <ion-input
            v-model="firstName"
            placeholder="e.g. Juan"
            type="text"
            autocapitalize="words"
            class="custom-input"
            required
          />
        </div>

        <!-- Middle Name -->
        <div class="form-group">
          <label class="input-label">Middle Name (Optional)</label>
          <ion-input
            v-model="middleName"
            placeholder="e.g. Santos"
            type="text"
            autocapitalize="words"
            class="custom-input"
          />
        </div>

        <!-- Last Name -->
        <div class="form-group">
          <label class="input-label">Last Name *</label>
          <ion-input
            v-model="lastName"
            placeholder="e.g. Dela Cruz"
            type="text"
            autocapitalize="words"
            class="custom-input"
            required
          />
        </div>

        <!-- Year Level -->
        <div class="form-group">
          <label class="input-label">Year Level *</label>
          <YearLevelPicker v-model="yearLevel" />
        </div>

        <!-- Section -->
        <div class="form-group">
          <label class="input-label">Section *</label>
          <ion-input
            v-model="section"
            placeholder="e.g. A, 3A, IT-301"
            type="text"
            autocapitalize="characters"
            class="custom-input"
            required
          />
        </div>

        <!-- Course -->
        <div class="form-group">
          <label class="input-label">Course *</label>
          <ion-input
            v-model="course"
            placeholder="e.g. BSIT"
            type="text"
            autocapitalize="characters"
            class="custom-input"
            required
          />
        </div>

        <div v-if="errorMsg" class="form-error">
          {{ errorMsg }}
        </div>

        <div class="submit-wrap">
          <ion-button 
            type="submit" 
            expand="block" 
            color="primary" 
            :disabled="!isValid || isSaving"
            class="save-btn"
          >
            <ion-spinner v-if="isSaving" name="crescent" slot="start" />
            <ion-icon v-else :icon="saveOutline" slot="start" />
            Save Changes
          </ion-button>
        </div>
      </form>
    </div>
  </ion-content>
</template>

<style scoped>
.modal-header ion-toolbar {
  --background: var(--app-surface);
  --border-color: var(--app-border);
}

.modal-form-container {
  max-width: 540px;
  margin: 0 auto;
  padding: 12px 16px 32px 16px;
}

.form-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.input-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text-secondary);
}

.custom-input {
  --background: var(--app-surface-subtle);
  --padding-start: 12px;
  --padding-end: 12px;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  font-size: 14px;
  color: var(--app-text-primary);
  min-height: 44px;
}

.form-error {
  background: rgba(220, 75, 75, 0.1);
  border: 1px solid rgba(220, 75, 75, 0.25);
  color: var(--ion-color-danger);
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
}

.submit-wrap {
  margin-top: 6px;
}

.save-btn {
  --border-radius: var(--app-btn-radius);
  height: 46px;
  font-size: 14px;
  font-weight: 600;
}
</style>
