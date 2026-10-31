<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { 
  IonPage, 
  IonContent, 
  IonIcon, 
  IonSpinner,
  onIonViewWillEnter 
} from '@ionic/vue';
import { 
  personAddOutline, 
  searchOutline,
  closeCircleOutline,
  schoolOutline
} from 'ionicons/icons';
import { useStudents } from '@/composables/useStudents';
import StudentCard from '@/components/StudentCard.vue';
import type { Student, YearLevel } from '@/types/student';
import { 
  UniPageHeader, 
  UniButton, 
  UniEmptyState 
} from '@/components/ui';

const router = useRouter();
const { 
  filteredStudents, 
  totalCount, 
  searchQuery, 
  filterYear, 
  isLoading, 
  loadStudents 
} = useStudents();

onMounted(async () => {
  await loadStudents();
});

onIonViewWillEnter(async () => {
  await loadStudents();
});

function handleOpenRegister() {
  router.push('/register-student');
}

function handleSelectStudent(student: Student) {
  router.push(`/students/${student.id}`);
}

function toggleYearFilter(year: YearLevel) {
  if (filterYear.value === year) {
    filterYear.value = null;
  } else {
    filterYear.value = year;
  }
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Students"
      subtitle="Student directory"
      variant="root"
    >
      <template #trailing>
        <UniButton
          size="sm"
          :icon="personAddOutline"
          @click="handleOpenRegister"
        >
          Add Student
        </UniButton>
      </template>
    </UniPageHeader>

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Search and Quick Filter Chips -->
        <div class="search-and-filter-box">
          <!-- Compact Search Bar -->
          <div class="custom-search-input-wrap">
            <ion-icon :icon="searchOutline" class="search-lead-icon" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search name, ID or section"
              class="clean-search-input"
            />
            <button 
              v-if="searchQuery" 
              class="clear-search-btn" 
              @click="searchQuery = ''"
            >
              <ion-icon :icon="closeCircleOutline" />
            </button>
          </div>

          <!-- Horizontal Filter Chips -->
          <div class="filter-chips-scroller">
            <button 
              class="filter-chip"
              :class="{ 'chip-active': filterYear === null }"
              @click="filterYear = null"
            >
              All Years
            </button>
            <button 
              v-for="y in ([1, 2, 3, 4] as YearLevel[])" 
              :key="y"
              class="filter-chip"
              :class="{ 'chip-active': filterYear === y }"
              @click="toggleYearFilter(y)"
            >
              {{ y === 1 ? '1st Year' : y === 2 ? '2nd Year' : y === 3 ? '3rd Year' : '4th Year' }}
            </button>
          </div>

          <!-- Counter Bar -->
          <div class="count-row">
            <span class="count-text font-mono">
              {{ filteredStudents.length }} {{ filteredStudents.length === 1 ? 'student' : 'students' }}
            </span>
            <span v-if="searchQuery || filterYear" class="status-badge badge-accent">
              Filtered
            </span>
          </div>
        </div>

        <!-- Loading State -->
        <div v-if="isLoading && totalCount === 0" class="loading-state">
          <ion-spinner name="crescent" color="primary" />
          <p class="metadata-text">Loading student records...</p>
        </div>

        <!-- Empty State: No Students in Database -->
        <UniEmptyState
          v-else-if="totalCount === 0"
          :icon="schoolOutline"
          title="No students yet"
          description="Register a student to get started with NFC records."
          action-text="Add Student"
          :action-icon="personAddOutline"
          @action="handleOpenRegister"
        />

        <!-- Empty State: Filter Returned No Match -->
        <UniEmptyState
          v-else-if="filteredStudents.length === 0"
          :icon="searchOutline"
          title="No students found"
          description="No student matches your search query or filter."
          action-text="Reset Filters"
          @action="searchQuery = ''; filterYear = null"
        />

        <!-- Student List -->
        <div v-else class="students-list">
          <StudentCard
            v-for="student in filteredStudents"
            :key="student.id"
            :student="student"
            @click="handleSelectStudent"
          />
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.add-student-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border-radius: var(--app-pill-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25);
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.add-student-btn:active {
  transform: scale(0.96);
  opacity: 0.9;
}

.add-student-btn ion-icon {
  font-size: 16px;
}

/* Search and Filter Section */
.search-and-filter-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.custom-search-input-wrap {
  display: flex;
  align-items: center;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  padding: 0 12px;
  height: 46px;
  box-shadow: var(--app-shadow-card);
  transition: border-color 0.15s ease;
}

.custom-search-input-wrap:focus-within {
  border-color: var(--ion-color-primary);
}

.search-lead-icon {
  font-size: 18px;
  color: var(--app-text-muted);
  margin-right: 8px;
  flex-shrink: 0;
}

.clean-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--app-text-primary);
  font-size: 14px;
  font-family: inherit;
}

.clean-search-input::placeholder {
  color: var(--app-text-muted);
}

.clear-search-btn {
  background: transparent;
  border: none;
  color: var(--app-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 4px;
}

.clear-search-btn ion-icon {
  font-size: 16px;
}

/* Filter Chips Horizontal Scroller */
.filter-chips-scroller {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.filter-chips-scroller::-webkit-scrollbar {
  display: none;
}

.filter-chip {
  padding: 6px 14px;
  border-radius: var(--app-pill-radius);
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  color: var(--app-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.filter-chip.chip-active {
  background: var(--ion-color-primary);
  border-color: var(--ion-color-primary);
  color: #ffffff;
  font-weight: 600;
}

.count-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
}

.count-text {
  font-size: 12px;
  color: var(--app-text-secondary);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  gap: 8px;
}

.students-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.primary-compact-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--app-btn-radius);
  background: var(--ion-color-primary);
  color: #ffffff;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 4px;
}

.compact-action-btn {
  padding: 6px 12px;
  border-radius: var(--app-btn-radius);
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  color: var(--app-text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
</style>
