<template>
  <ion-page>
    <ion-content :fullscreen="true" class="academic-content">
      <div class="page-container">
        <!-- Header -->
        <div class="page-header">
          <div class="header-titles">
            <span class="eyebrow">ACADEMIC STRUCTURE</span>
            <h1 class="page-title">Terms & Semesters</h1>
            <p class="page-subtitle">Manage historical academic years and active semester sessions.</p>
          </div>
          <button class="btn-create" @click="showCreateModal = true">
            + New Term
          </button>
        </div>

        <!-- Active Term Banner -->
        <div v-if="activeSemester" class="active-term-card">
          <div class="term-status-pill">
            <span class="dot"></span> CURRENT ACTIVE SEMESTER
          </div>
          <div class="term-title">
            {{ activeSemester.term }} SEMESTER
          </div>
          <div class="term-dates">
            📅 {{ activeSemester.starts_on }} to {{ activeSemester.ends_on }}
          </div>
        </div>
        <div v-else class="warning-banner">
          ⚠️ No active semester currently configured. Please select or activate a semester below.
        </div>

        <!-- Semesters List -->
        <div class="section-container">
          <h2 class="section-title">All Semesters</h2>
          <div class="semesters-grid">
            <div
              v-for="sem in semesters"
              :key="sem.id"
              class="sem-card"
              :class="{ 'is-active': sem.status === 'ACTIVE' }"
            >
              <div class="sem-card-header">
                <div>
                  <div class="sem-term">{{ sem.term }} SEMESTER</div>
                  <div class="sem-year">{{ sem.academic_year_id }}</div>
                </div>
                <span
                  class="status-badge"
                  :class="sem.status.toLowerCase()"
                >
                  {{ sem.status }}
                </span>
              </div>
              <div class="sem-dates">
                <span>{{ sem.starts_on }} — {{ sem.ends_on }}</span>
              </div>
              <div class="sem-actions">
                <button
                  v-if="sem.status !== 'ACTIVE'"
                  class="btn-activate"
                  @click="activateSemester(sem.id)"
                >
                  Set as Active
                </button>
                <span v-else class="active-label">✓ Active for All Operations</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Create Semester Modal -->
        <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
          <div class="modal-card">
            <h3 class="modal-title">Create New Semester</h3>
            <form @submit.prevent="handleCreateSemester" class="modal-form">
              <div class="form-group">
                <label>Academic Year Label</label>
                <input
                  v-model="newYearLabel"
                  type="text"
                  placeholder="e.g. 2026-2027"
                  required
                  class="modal-input"
                />
              </div>

              <div class="form-group">
                <label>Term</label>
                <select v-model="newTerm" class="modal-input" required>
                  <option value="FIRST">First Semester</option>
                  <option value="SECOND">Second Semester</option>
                  <option value="SUMMER">Summer</option>
                </select>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label>Starts On</label>
                  <input v-model="newStartsOn" type="date" required class="modal-input" />
                </div>
                <div class="form-group">
                  <label>Ends On</label>
                  <input v-model="newEndsOn" type="date" required class="modal-input" />
                </div>
              </div>

              <div class="form-group">
                <label class="checkbox-label">
                  <input v-model="setImmediatelyActive" type="checkbox" />
                  Set as active semester immediately
                </label>
              </div>

              <div class="modal-actions">
                <button type="button" class="btn-cancel" @click="showCreateModal = false">
                  Cancel
                </button>
                <button type="submit" class="btn-submit">
                  Create Term
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { IonPage, IonContent } from '@ionic/vue';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import type { Semester } from '@/types/database';

const activeSemester = ref<Semester | null>(null);
const semesters = ref<Semester[]>([]);
const showCreateModal = ref(false);

const newYearLabel = ref('2026-2027');
const newTerm = ref<'FIRST' | 'SECOND' | 'SUMMER'>('SECOND');
const newStartsOn = ref('2027-01-10');
const newEndsOn = ref('2027-05-30');
const setImmediatelyActive = ref(false);

onMounted(async () => {
  await loadAcademicData();
});

async function loadAcademicData() {
  activeSemester.value = await AcademicRepository.getActiveSemester();
  semesters.value = await AcademicRepository.getSemesters();
}

async function activateSemester(semesterId: string) {
  await AcademicRepository.setActiveSemester(semesterId);
  await loadAcademicData();
}

async function handleCreateSemester() {
  const yearId = 'ay_' + newYearLabel.value.replace(/[^0-9]/g, '_');
  const existingYear = await AcademicRepository.getYearById(yearId);
  if (!existingYear) {
    await AcademicRepository.createYear({
      id: yearId,
      label: newYearLabel.value,
      starts_on: newStartsOn.value,
      ends_on: newEndsOn.value,
      status: 'ACTIVE',
    });
  }

  const semesterId = `sem_${yearId}_${newTerm.value.toLowerCase()}`;
  await AcademicRepository.createSemester({
    id: semesterId,
    academic_year_id: yearId,
    term: newTerm.value,
    starts_on: newStartsOn.value,
    ends_on: newEndsOn.value,
    status: setImmediatelyActive.value ? 'ACTIVE' : 'PLANNED',
  });

  if (setImmediatelyActive.value) {
    await AcademicRepository.setActiveSemester(semesterId);
  }

  showCreateModal.value = false;
  await loadAcademicData();
}
</script>

<style scoped>
.academic-content {
  --background: var(--uni-background, #F8FAFC);
}

.page-container {
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  gap: 16px;
}

.eyebrow {
  font-size: 11px;
  font-weight: 800;
  color: var(--uni-primary, #0F766E);
  letter-spacing: 1.5px;
}

.page-title {
  font-size: 26px;
  font-weight: 800;
  color: var(--uni-ink, #0F172A);
  margin: 4px 0;
}

.page-subtitle {
  font-size: 13px;
  color: var(--uni-muted, #64748B);
  margin: 0;
}

.btn-create {
  background: var(--uni-primary, #0F766E);
  color: white;
  border: 0;
  border-radius: 12px;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.active-term-card {
  background: linear-gradient(135deg, #0f766e, #115e59);
  color: white;
  border-radius: 16px;
  padding: 20px;
  margin-bottom: 24px;
  box-shadow: 0 4px 16px rgba(15, 118, 110, 0.2);
}

.term-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.2);
  padding: 4px 10px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1px;
}

.term-status-pill .dot {
  width: 6px;
  height: 6px;
  background: #34d399;
  border-radius: 50%;
}

.term-title {
  font-size: 24px;
  font-weight: 800;
  margin: 12px 0 6px;
}

.term-dates {
  font-size: 13px;
  color: #ccfbf1;
}

.warning-banner {
  background: #fffbeb;
  border: 1px solid #fef3c7;
  color: var(--uni-warning, #B45309);
  padding: 14px;
  border-radius: 12px;
  font-size: 13px;
  margin-bottom: 24px;
}

.section-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--uni-ink, #0F172A);
  margin-bottom: 16px;
}

.semesters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.sem-card {
  background: #ffffff;
  border: 1px solid var(--uni-border, #CBD5E1);
  border-radius: 14px;
  padding: 18px;
}

.sem-card.is-active {
  border-color: var(--uni-primary, #0F766E);
  box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.15);
}

.sem-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.sem-term {
  font-size: 16px;
  font-weight: 800;
  color: var(--uni-ink, #0F172A);
}

.sem-year {
  font-size: 12px;
  color: var(--uni-muted, #64748B);
}

.status-badge {
  font-size: 10px;
  font-weight: 800;
  padding: 3px 8px;
  border-radius: 6px;
  text-transform: uppercase;
}

.status-badge.active {
  background: #dcfce7;
  color: #15803d;
}

.status-badge.planned {
  background: #f1f5f9;
  color: #475569;
}

.status-badge.closed {
  background: #fee2e2;
  color: #b91c1c;
}

.sem-dates {
  font-size: 12px;
  color: var(--uni-muted, #64748B);
  margin-bottom: 16px;
}

.btn-activate {
  background: white;
  border: 1.5px solid var(--uni-primary, #0F766E);
  color: var(--uni-primary, #0F766E);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  width: 100%;
}

.active-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--uni-primary, #0F766E);
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 1000;
}

.modal-card {
  background: white;
  border-radius: 16px;
  padding: 24px;
  max-width: 440px;
  width: 100%;
}

.modal-title {
  font-size: 18px;
  font-weight: 800;
  margin: 0 0 16px;
}

.form-group {
  margin-bottom: 14px;
}

.form-group label {
  display: block;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 6px;
  color: #334155;
}

.modal-input {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid var(--uni-border, #CBD5E1);
  border-radius: 10px;
  font-size: 14px;
  box-sizing: border-box;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.btn-cancel {
  flex: 1;
  background: #f1f5f9;
  border: 0;
  border-radius: 10px;
  padding: 12px;
  font-weight: 700;
  color: #475569;
  cursor: pointer;
}

.btn-submit {
  flex: 1;
  background: var(--uni-primary, #0F766E);
  border: 0;
  border-radius: 10px;
  padding: 12px;
  font-weight: 700;
  color: white;
  cursor: pointer;
}
</style>
