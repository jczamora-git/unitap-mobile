<script setup lang="ts">
import { computed } from 'vue';
import type { Student } from '@/types/student';
import { formatFullName, formatYearLevel } from '@/utilities/student-formatters';
import { radioOutline, chevronForwardOutline } from 'ionicons/icons';
import { IonIcon } from '@ionic/vue';
import { haptics } from '@/utilities/haptics';

const props = defineProps<{
  student: Student;
}>();

const emit = defineEmits<{
  (e: 'click', student: Student): void;
}>();

const initials = computed(() => {
  const f = props.student.firstName?.[0] || '';
  const l = props.student.lastName?.[0] || '';
  return (f + l).toUpperCase() || 'ST';
});

function onRowClick() {
  haptics.light();
  emit('click', props.student);
}
</script>

<template>
  <div class="student-directory-row tactile-press" @click="onRowClick">
    <div class="avatar-circle">
      <img
        v-if="student.photoUrl || student.photoLocalUri"
        :src="(student.photoUrl || student.photoLocalUri) || undefined"
        alt="Avatar"
        class="avatar-img"
      />
      <span v-else>{{ initials }}</span>
    </div>

    <div class="student-info-col">
      <div class="student-name-row">
        <h4 class="student-full-name">
          {{ formatFullName(student.firstName, student.middleName, student.lastName) }}
        </h4>
        <span 
          class="nfc-status-pill"
          :class="student.rfidUid ? 'nfc-active' : 'nfc-none'"
        >
          <ion-icon :icon="radioOutline" />
          {{ student.rfidUid ? 'Linked' : 'No NFC' }}
        </span>
      </div>

      <div class="student-sub-row">
        <span v-if="student.studentNumber" class="student-num font-mono">
          {{ student.studentNumber }}
        </span>
        <span v-else class="student-num text-muted">
          No ID #
        </span>
        <span class="sub-dot">•</span>
        <span class="student-academic">
          {{ formatYearLevel(student.yearLevel) }} - Sec {{ student.section }}
        </span>
      </div>
    </div>

    <ion-icon :icon="chevronForwardOutline" class="row-chevron" />
  </div>
</template>

<style scoped>
.student-directory-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 14px;
  cursor: pointer;
  box-shadow: var(--app-shadow-card);
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.student-directory-row:active {
  transform: scale(0.99);
  border-color: var(--ion-color-primary);
}

.avatar-circle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--app-surface-subtle);
  color: var(--ion-color-primary);
  border: 1px solid var(--app-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  overflow: hidden;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.student-info-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.student-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.student-full-name {
  font-size: 14px;
  font-weight: 650;
  color: var(--app-text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nfc-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: var(--app-pill-radius);
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}

.nfc-active {
  background: rgba(112, 243, 207, 0.14);
  color: var(--aurora-mint);
  border: 1px solid rgba(112, 243, 207, 0.25);
}

.nfc-none {
  background: var(--app-surface-subtle);
  color: var(--app-text-muted);
}

.student-sub-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--app-text-secondary);
}

.student-num {
  font-weight: 600;
  color: var(--app-text-secondary);
}

.sub-dot {
  color: var(--app-text-muted);
}

.student-academic {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-chevron {
  font-size: 15px;
  color: var(--app-text-muted);
  flex-shrink: 0;
}
</style>
