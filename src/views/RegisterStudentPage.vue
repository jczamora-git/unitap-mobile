<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { 
  IonPage, 
  IonContent 
} from '@ionic/vue';
import { 
  personAddOutline, 
  idCardOutline, 
  schoolOutline 
} from 'ionicons/icons';
import { 
  UniPageHeader, 
  UniInput, 
  UniFormField, 
  UniButton 
} from '@/components/ui';
import YearLevelPicker from '@/components/YearLevelPicker.vue';
import RfidScanBox from '@/components/RfidScanBox.vue';
import { useStudents } from '@/composables/useStudents';
import { useToast } from '@/composables/useToast';
import { nfcService } from '@/services/nfc.service';
import type { CreateStudentDto, YearLevel, Student } from '@/types/student';

const router = useRouter();
const route = useRoute();
const { addStudent } = useStudents();
const { showToast } = useToast();

const studentNumber = ref('');
const firstName = ref('');
const middleName = ref('');
const lastName = ref('');
const yearLevel = ref<YearLevel>(1);
const section = ref('');
const course = ref('BSIT');

const rfidUid = ref<string | null>(null);
const rfidUidCompact = ref<string | null>(null);

const isSubmitting = ref(false);
const errorMessage = ref<string | null>(null);

onMounted(() => {
  const queryRfid = route.query.rfid as string;
  if (queryRfid && queryRfid.trim()) {
    rfidUid.value = queryRfid.trim();
    rfidUidCompact.value = queryRfid.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  }
});

const isFormValid = computed(() => {
  return (
    firstName.value.trim().length > 0 &&
    lastName.value.trim().length > 0 &&
    section.value.trim().length > 0 &&
    course.value.trim().length > 0 &&
    Boolean(rfidUid.value && rfidUid.value.trim().length > 0)
  );
});

async function handleRegister() {
  if (!isFormValid.value || isSubmitting.value) return;

  isSubmitting.value = true;
  errorMessage.value = null;

  try {
    const dto: CreateStudentDto = {
      studentNumber: studentNumber.value.trim() || undefined,
      firstName: firstName.value.trim(),
      middleName: middleName.value.trim() || undefined,
      lastName: lastName.value.trim(),
      yearLevel: yearLevel.value,
      section: section.value.trim(),
      course: course.value.trim() || 'BSIT',
      rfidUid: rfidUid.value?.trim(),
      rfidUidCompact: rfidUidCompact.value?.trim()
    };

    const newStudent = await addStudent(dto);

    await nfcService.triggerHapticFeedback();
    await showToast('Student registered successfully', 'success');

    router.replace(`/students/${newStudent.id}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errorMessage.value = msg;
    await showToast(msg, 'error');
  } finally {
    isSubmitting.value = false;
  }
}

function handleViewDuplicateStudent(dup: Student) {
  router.push(`/students/${dup.id}`);
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Register Student"
      subtitle="Enroll profile and link physical NFC ID"
      :back-button="true"
      default-back-href="/tabs/students"
      variant="detail"
    />

    <ion-content class="safe-content">
      <div class="page-container">
        <form @submit.prevent="handleRegister" class="form-flow">
          <!-- Error banner -->
          <div v-if="errorMessage" class="error-banner font-mono" role="alert">
            {{ errorMessage }}
          </div>

          <!-- Section 1: Personal Information -->
          <section class="form-section">
            <div class="section-title-row">
              <span class="section-title">Personal information</span>
            </div>

            <div class="fields-stack">
              <UniFormField label="Student ID Number" hint="University issued student ID">
                <UniInput
                  v-model="studentNumber"
                  placeholder="e.g. 2024-10492"
                  :monospace="true"
                  :icon="idCardOutline"
                />
              </UniFormField>

              <div class="fields-grid-2">
                <UniFormField label="First Name" :required="true">
                  <UniInput
                    v-model="firstName"
                    placeholder="e.g. Juan"
                    autocapitalize="words"
                    :required="true"
                  />
                </UniFormField>

                <UniFormField label="Last Name" :required="true">
                  <UniInput
                    v-model="lastName"
                    placeholder="e.g. Dela Cruz"
                    autocapitalize="words"
                    :required="true"
                  />
                </UniFormField>
              </div>

              <UniFormField label="Middle Name (Optional)">
                <UniInput
                  v-model="middleName"
                  placeholder="e.g. Protacio"
                  autocapitalize="words"
                />
              </UniFormField>
            </div>
          </section>

          <!-- Section 2: Academic Information -->
          <section class="form-section">
            <div class="section-title-row">
              <span class="section-title">Academic details</span>
            </div>

            <div class="fields-stack">
              <UniFormField label="Year Level" :required="true">
                <YearLevelPicker v-model="yearLevel" />
              </UniFormField>

              <div class="fields-grid-2">
                <UniFormField label="Section" :required="true">
                  <UniInput
                    v-model="section"
                    placeholder="e.g. 3A"
                    autocapitalize="characters"
                    :required="true"
                  />
                </UniFormField>

                <UniFormField label="Course" :required="true">
                  <UniInput
                    v-model="course"
                    placeholder="e.g. BSIT"
                    autocapitalize="characters"
                    :required="true"
                    :icon="schoolOutline"
                  />
                </UniFormField>
              </div>
            </div>
          </section>

          <!-- Section 3: NFC Card -->
          <section class="form-section">
            <div class="section-title-row">
              <span class="section-title">NFC card</span>
            </div>

            <RfidScanBox 
              v-model="rfidUid" 
              v-model:model-compact="rfidUidCompact"
              @view-duplicate-student="handleViewDuplicateStudent"
            />
          </section>

          <!-- Sticky / Prominent Save Action -->
          <div class="form-submit-row">
            <UniButton
              type="submit"
              variant="primary"
              size="lg"
              :block="true"
              :disabled="!isFormValid || isSubmitting"
              :loading="isSubmitting"
              :icon="personAddOutline"
            >
              Save Student Profile
            </UniButton>
          </div>
        </form>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.form-flow {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-section {
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-card);
  padding: 18px 16px;
  box-shadow: var(--uni-shadow-card);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--uni-border-subtle);
  padding-bottom: 8px;
}

.section-title {
  font-size: 14.5px;
  font-weight: 650;
  color: var(--uni-text-primary);
  letter-spacing: -0.01em;
}

.fields-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fields-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 360px) {
  .fields-grid-2 {
    grid-template-columns: 1fr;
  }
}

.form-submit-row {
  margin-top: 6px;
  margin-bottom: calc(24px + var(--ion-safe-area-bottom, 0px));
}

.error-banner {
  background: rgba(220, 75, 75, 0.1);
  border: 1px solid rgba(220, 75, 75, 0.3);
  color: #DC2626;
  padding: 12px 14px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.4;
}
</style>
