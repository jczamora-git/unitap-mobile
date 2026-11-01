<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  IonSpinner,
} from '@ionic/vue';
import {
  schoolOutline,
  cloudDownloadOutline,
  personAddOutline,
  searchOutline,
  checkmarkCircleOutline,
  copyOutline,
  checkmarkOutline,
  arrowForwardOutline,
  closeOutline,
} from 'ionicons/icons';
import {
  UniPageHeader,
  UniButton,
  UniStatusBadge,
  UniDialog,
} from '@/components/ui';
import {
  OfficerManagementService,
  OFFICER_PERMISSIONS,
} from '@/services/officer-management.service';
import type { OfficerPermissionPreset, OfficerScopeType } from '@/types/database';
import { OfficerRepository } from '@/database/repositories/officer.repository';
import { SystemSetupService } from '@/services/system-setup.service';
import { authService } from '@/services/auth.service';
import { haptics } from '@/utilities/haptics';
import { useToast } from '@/composables/useToast';

const router = useRouter();
const { showToast } = useToast();

type ScenarioType = 'EXISTING_STUDENT' | 'IMPORTED_STUDENT' | 'NEW_OFFICER';

const selectedScenario = ref<ScenarioType>('EXISTING_STUDENT');

// Search states for Option A & B
const studentSearchQuery = ref('');
const isSearchingStudents = ref(false);
const searchResults = ref<any[]>([]);
const selectedStudent = ref<any | null>(null);

// Form Fields
const fullName = ref('');
const email = ref('');
const permissionPreset = ref<OfficerPermissionPreset>('FULL');
const customPermissions = ref<string[]>([]);
const appointmentStart = ref('');
const appointmentEnd = ref('');
const scopeType = ref<OfficerScopeType>('ORGANIZATION');

// Academic options
const academicYears = ref<{ id: string; label: string }[]>([]);
const selectedAcademicYearId = ref('');
const semesters = ref<{ id: string; term: string; academic_year_id: string }[]>([]);
const selectedSemesterId = ref('');

// Submission & Feedback states
const isSubmitting = ref(false);
const createdResult = ref<{
  success: boolean;
  appointmentId?: string;
  activationCode?: string;
  officerName?: string;
} | null>(null);
const isSuccessDialogOpen = ref(false);
const copiedCode = ref(false);

onMounted(async () => {
  // Set default appointment dates (1 year span)
  const now = new Date();
  appointmentStart.value = now.toISOString().substring(0, 10);
  const nextYear = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
  appointmentEnd.value = nextYear.toISOString().substring(0, 10);

  try {
    const [ays, sems] = await Promise.all([
      SystemSetupService.getAcademicYears(),
      SystemSetupService.getSemesters(),
    ]);
    academicYears.value = ays;
    semesters.value = sems;

    const activeSem = sems.find((s: any) => s.status === 'ACTIVE');
    if (activeSem) {
      selectedSemesterId.value = activeSem.id;
      selectedAcademicYearId.value = activeSem.academic_year_id;
    } else if (ays.length > 0) {
      selectedAcademicYearId.value = ays[0].id;
    }
  } catch (e) {
    console.error('Error loading academic terms:', e);
  }
});

// Student Search Debounce
let searchTimeout: any = null;
function handleSearchInput() {
  if (searchTimeout) clearTimeout(searchTimeout);
  if (!studentSearchQuery.value.trim() || studentSearchQuery.value.trim().length < 2) {
    searchResults.value = [];
    return;
  }

  searchTimeout = setTimeout(async () => {
    isSearchingStudents.value = true;
    try {
      const registeredOnly = selectedScenario.value === 'EXISTING_STUDENT';
      searchResults.value = await OfficerRepository.searchStudentsForOfficer(
        studentSearchQuery.value,
        registeredOnly
      );
    } catch (e) {
      console.error('Search error:', e);
    } finally {
      isSearchingStudents.value = false;
    }
  }, 250);
}

function selectStudent(st: any) {
  haptics.light();
  selectedStudent.value = st;
  fullName.value = `${st.first_name} ${st.last_name}`.trim();
  email.value = st.username ? `${st.username}@univ.edu` : `${st.school_id.toLowerCase()}@univ.edu`;
  searchResults.value = [];
}

function clearSelectedStudent() {
  selectedStudent.value = null;
  fullName.value = '';
  email.value = '';
}

function toggleCustomPermission(perm: string) {
  haptics.light();
  const idx = customPermissions.value.indexOf(perm);
  if (idx > -1) {
    customPermissions.value.splice(idx, 1);
  } else {
    customPermissions.value.push(perm);
  }
}

const isFormValid = computed(() => {
  if (selectedScenario.value === 'EXISTING_STUDENT') {
    return selectedStudent.value && selectedStudent.value.user_id && fullName.value.trim();
  }
  if (selectedScenario.value === 'IMPORTED_STUDENT') {
    return selectedStudent.value && fullName.value.trim() && email.value.trim();
  }
  if (selectedScenario.value === 'NEW_OFFICER') {
    return fullName.value.trim().length > 2 && email.value.includes('@');
  }
  return false;
});

async function handleSubmit() {
  if (!isFormValid.value || isSubmitting.value) return;

  isSubmitting.value = true;
  const devAdminUserId = authService.user.value?.id || 'devadmin_local';

  try {
    if (selectedScenario.value === 'EXISTING_STUDENT') {
      const res = await OfficerManagementService.assignExistingStudentAsOfficer({
        studentId: selectedStudent.value.student_id,
        userId: selectedStudent.value.user_id,
        fullName: fullName.value.trim(),
        email: email.value.trim(),
        permissionPreset: permissionPreset.value,
        customPermissions: permissionPreset.value === 'CUSTOM' ? customPermissions.value : undefined,
        academicYearId: selectedAcademicYearId.value,
        semesterId: selectedSemesterId.value,
        startDate: appointmentStart.value,
        endDate: appointmentEnd.value,
        scopeType: scopeType.value,
        devAdminUserId,
      });

      if (!res.success) throw new Error(res.error || 'Failed to assign officer.');
      haptics.success();
      createdResult.value = {
        success: true,
        officerName: fullName.value,
      };
      isSuccessDialogOpen.value = true;
    } else if (selectedScenario.value === 'IMPORTED_STUDENT') {
      const res = await OfficerManagementService.prepareImportedStudentOfficerActivation({
        studentId: selectedStudent.value.student_id,
        fullName: fullName.value.trim(),
        email: email.value.trim(),
        permissionPreset: permissionPreset.value,
        customPermissions: permissionPreset.value === 'CUSTOM' ? customPermissions.value : undefined,
        academicYearId: selectedAcademicYearId.value,
        semesterId: selectedSemesterId.value,
        startDate: appointmentStart.value,
        endDate: appointmentEnd.value,
        scopeType: scopeType.value,
        devAdminUserId,
      });

      if (!res.success) throw new Error(res.error || 'Failed to prepare officer activation.');
      haptics.success();
      createdResult.value = {
        success: true,
        officerName: fullName.value,
        activationCode: res.rawActivationCode,
      };
      isSuccessDialogOpen.value = true;
    } else if (selectedScenario.value === 'NEW_OFFICER') {
      const res = await OfficerManagementService.inviteNewOfficer({
        fullName: fullName.value.trim(),
        email: email.value.trim(),
        permissionPreset: permissionPreset.value,
        customPermissions: permissionPreset.value === 'CUSTOM' ? customPermissions.value : undefined,
        academicYearId: selectedAcademicYearId.value,
        semesterId: selectedSemesterId.value,
        startDate: appointmentStart.value,
        endDate: appointmentEnd.value,
        scopeType: scopeType.value,
        devAdminUserId,
      });

      if (!res.success) throw new Error(res.error || 'Failed to send officer invitation.');
      haptics.success();
      createdResult.value = {
        success: true,
        officerName: fullName.value,
        activationCode: res.invitationCode,
      };
      isSuccessDialogOpen.value = true;
    }
  } catch (err: unknown) {
    haptics.error();
    await showToast((err as Error).message || 'Failed to create officer.', 'error');
  } finally {
    isSubmitting.value = false;
  }
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    copiedCode.value = true;
    haptics.success();
    await showToast('Code copied to clipboard', 'success');
    setTimeout(() => {
      copiedCode.value = false;
    }, 2500);
  } catch {
    await showToast(code, 'info');
  }
}

function handleDone() {
  isSuccessDialogOpen.value = false;
  router.replace('/settings/system-setup/officers');
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Create Officer"
      subtitle="Select candidate scenario & configure authorization"
      :back-button="true"
      default-back-href="/settings/system-setup/officers"
    />

    <ion-content class="create-officer-content">
      <div class="page-container">
        <!-- Scenario Selector Cards -->
        <div class="scenarios-grid">
          <!-- Option A -->
          <div
            class="scenario-card minimal-card"
            :class="{ 'is-active': selectedScenario === 'EXISTING_STUDENT' }"
            @click="selectedScenario = 'EXISTING_STUDENT'; clearSelectedStudent()"
          >
            <div class="scenario-icon-wrap icon-student">
              <ion-icon :icon="schoolOutline" />
            </div>
            <div class="scenario-text">
              <div class="scenario-title">Existing Student</div>
              <p class="scenario-desc">Promote an active student without duplicating account or wiping role.</p>
            </div>
          </div>

          <!-- Option B -->
          <div
            class="scenario-card minimal-card"
            :class="{ 'is-active': selectedScenario === 'IMPORTED_STUDENT' }"
            @click="selectedScenario = 'IMPORTED_STUDENT'; clearSelectedStudent()"
          >
            <div class="scenario-icon-wrap icon-import">
              <ion-icon :icon="cloudDownloadOutline" />
            </div>
            <div class="scenario-text">
              <div class="scenario-title">Imported Student</div>
              <p class="scenario-desc">Prepare verified officer activation for an imported student awaiting signup.</p>
            </div>
          </div>

          <!-- Option C -->
          <div
            class="scenario-card minimal-card"
            :class="{ 'is-active': selectedScenario === 'NEW_OFFICER' }"
            @click="selectedScenario = 'NEW_OFFICER'; clearSelectedStudent()"
          >
            <div class="scenario-icon-wrap icon-new">
              <ion-icon :icon="personAddOutline" />
            </div>
            <div class="scenario-text">
              <div class="scenario-title">New Officer</div>
              <p class="scenario-desc">Invite a new individual without creating an unnecessary student record.</p>
            </div>
          </div>
        </div>

        <!-- Candidate Search (Option A & B) -->
        <div v-if="selectedScenario !== 'NEW_OFFICER'" class="section-card minimal-card">
          <div class="section-header">
            <span class="section-title">
              {{ selectedScenario === 'EXISTING_STUDENT' ? 'Find Registered Student' : 'Find Imported Student' }}
            </span>
            <span class="section-sub">
              {{ selectedScenario === 'EXISTING_STUDENT' ? 'Search by name or student ID' : 'Search roster records awaiting activation' }}
            </span>
          </div>

          <!-- Selected Student Banner -->
          <div v-if="selectedStudent" class="selected-student-box">
            <div class="selected-student-info">
              <div class="student-name">{{ selectedStudent.first_name }} {{ selectedStudent.last_name }}</div>
              <div class="student-meta font-mono">ID: {{ selectedStudent.school_id }}</div>
              <UniStatusBadge
                :variant="selectedStudent.account_status === 'ACTIVE' ? 'success' : 'warning'"
              >
                {{ selectedStudent.account_status === 'ACTIVE' ? 'Registered User' : 'Awaiting Activation' }}
              </UniStatusBadge>
            </div>
            <button type="button" class="btn-clear-student" @click="clearSelectedStudent">
              <ion-icon :icon="closeOutline" />
            </button>
          </div>

          <!-- Search Input -->
          <div v-else class="search-wrap">
            <div class="input-with-icon">
              <ion-icon :icon="searchOutline" class="input-icon" />
              <input
                v-model="studentSearchQuery"
                type="text"
                class="form-input"
                :placeholder="selectedScenario === 'EXISTING_STUDENT' ? 'Search registered student name or ID...' : 'Search imported student roster...'"
                @input="handleSearchInput"
              />
            </div>

            <!-- Autocomplete Results -->
            <div v-if="isSearchingStudents" class="search-loading">
              <ion-spinner name="crescent" />
              <span>Searching directory...</span>
            </div>

            <div v-else-if="searchResults.length > 0" class="search-results-list">
              <div
                v-for="st in searchResults"
                :key="st.student_id"
                class="search-result-item"
                @click="selectStudent(st)"
              >
                <div class="res-info">
                  <span class="res-name">{{ st.first_name }} {{ st.last_name }}</span>
                  <span class="res-id font-mono">ID: {{ st.school_id }}</span>
                </div>
                <ion-icon :icon="arrowForwardOutline" class="res-arrow" />
              </div>
            </div>
          </div>
        </div>

        <!-- Candidate Details (Option C) -->
        <div v-if="selectedScenario === 'NEW_OFFICER'" class="section-card minimal-card">
          <div class="section-header">
            <span class="section-title">Officer Contact Information</span>
            <span class="section-sub">Enter official email where invitation code will be sent</span>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Full Name</label>
              <input
                v-model="fullName"
                type="text"
                class="form-input"
                placeholder="e.g. Maria Santos"
              />
            </div>

            <div class="form-group">
              <label class="form-label">Email Address</label>
              <input
                v-model="email"
                type="email"
                class="form-input"
                placeholder="e.g. maria.santos@univ.edu"
              />
            </div>
          </div>
        </div>

        <!-- Permission Preset Section -->
        <div class="section-card minimal-card">
          <div class="section-header">
            <span class="section-title">Officer Authorization Preset</span>
            <span class="section-sub">Select operational capabilities and privileges</span>
          </div>

          <div class="preset-cards-grid">
            <!-- Attendance -->
            <div
              class="preset-card"
              :class="{ 'is-selected': permissionPreset === 'ATTENDANCE' }"
              @click="permissionPreset = 'ATTENDANCE'"
            >
              <div class="preset-name">Attendance Officer</div>
              <p class="preset-desc">NFC check-in scanning, attendance verification, absentees tracking, reports.</p>
            </div>

            <!-- Finance -->
            <div
              class="preset-card"
              :class="{ 'is-selected': permissionPreset === 'FINANCE' }"
              @click="permissionPreset = 'FINANCE'"
            >
              <div class="preset-name">Finance Officer</div>
              <p class="preset-desc">Collect fines & contributions, rapid NFC payment, transaction history.</p>
            </div>

            <!-- Full -->
            <div
              class="preset-card"
              :class="{ 'is-selected': permissionPreset === 'FULL' }"
              @click="permissionPreset = 'FULL'"
            >
              <div class="preset-name">Full Officer</div>
              <p class="preset-desc">Comprehensive operational access across attendance, finance, and events.</p>
            </div>

            <!-- Custom -->
            <div
              class="preset-card"
              :class="{ 'is-selected': permissionPreset === 'CUSTOM' }"
              @click="permissionPreset = 'CUSTOM'"
            >
              <div class="preset-name">Custom Permissions</div>
              <p class="preset-desc">Tailor granular permissions per operational necessity.</p>
            </div>
          </div>

          <!-- Custom Permissions Matrix -->
          <div v-if="permissionPreset === 'CUSTOM'" class="custom-perms-matrix">
            <div class="matrix-title">Individual Capabilities</div>
            <div class="perms-chips">
              <button
                v-for="(val, key) in OFFICER_PERMISSIONS"
                :key="key"
                type="button"
                class="perm-chip"
                :class="{ 'is-checked': customPermissions.includes(val) }"
                @click="toggleCustomPermission(val)"
              >
                {{ val }}
              </button>
            </div>
          </div>
        </div>

        <!-- Appointment Period & Scope -->
        <div class="section-card minimal-card">
          <div class="section-header">
            <span class="section-title">Appointment Schedule & Scope</span>
            <span class="section-sub">Configure term duration and organizational reach</span>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Appointment Start Date</label>
              <input v-model="appointmentStart" type="date" class="form-input" />
            </div>

            <div class="form-group">
              <label class="form-label">Appointment End Date</label>
              <input v-model="appointmentEnd" type="date" class="form-input" />
            </div>

            <div class="form-group">
              <label class="form-label">Scope Reach</label>
              <select v-model="scopeType" class="form-input form-select">
                <option value="ORGANIZATION">All Organization (Campus-Wide)</option>
                <option value="PROGRAM">Specific Program</option>
                <option value="SECTION">Specific Section</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Submit Button -->
        <div class="form-actions-bar">
          <UniButton
            variant="outline"
            @click="router.replace('/settings/system-setup/officers')"
          >
            Cancel
          </UniButton>

          <UniButton
            variant="primary"
            :disabled="!isFormValid || isSubmitting"
            @click="handleSubmit"
          >
            <ion-spinner v-if="isSubmitting" name="crescent" slot="start" />
            <ion-icon v-else :icon="checkmarkCircleOutline" slot="start" />
            <span>
              {{
                selectedScenario === 'EXISTING_STUDENT'
                  ? 'Confirm Officer Promotion'
                  : selectedScenario === 'IMPORTED_STUDENT'
                  ? 'Generate Officer Activation'
                  : 'Send Officer Invitation'
              }}
            </span>
          </UniButton>
        </div>
      </div>
    </ion-content>

    <!-- Success Dialog with Activation/Invitation Code -->
    <UniDialog
      :is-open="isSuccessDialogOpen"
      :title="selectedScenario === 'EXISTING_STUDENT' ? 'Officer Role Assigned' : 'Activation Code Generated'"
      :description="
        selectedScenario === 'EXISTING_STUDENT'
          ? `${createdResult?.officerName} has been assigned the Officer role. Their student identity remains active.`
          : `Provide this activation code to ${createdResult?.officerName} to complete enrollment.`
      "
      type="info"
      confirm-text="Done"
      cancel-text=""
      @confirm="handleDone"
      @close="isSuccessDialogOpen = false"
    >
      <div v-if="createdResult?.activationCode" class="dialog-code-box">
        <span class="code-label">Single-Use Code</span>
        <div class="code-flex font-mono">
          <span class="code-str">{{ createdResult.activationCode }}</span>
          <button
            type="button"
            class="copy-btn"
            @click="copyCode(createdResult.activationCode!)"
          >
            <ion-icon :icon="copiedCode ? checkmarkOutline : copyOutline" />
            <span>{{ copiedCode ? 'Copied' : 'Copy' }}</span>
          </button>
        </div>
        <span class="code-note">Expires in 48 hours. Activates officer privileges upon account claim.</span>
      </div>
    </UniDialog>
  </ion-page>
</template>

<style scoped>
.create-officer-content {
  --background: var(--uni-background, #f8fafc);
}

.page-container {
  max-width: 680px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

@media (max-width: 380px) {
  .page-container {
    padding: 12px;
    gap: 12px;
  }
}

.minimal-card {
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 14px;
}

.scenarios-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.scenario-card {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  transition: all 0.16s ease;
  border: 1.5px solid var(--uni-border, #e2e8f0);
}

.scenario-card.is-active {
  border-color: var(--uni-primary, #0f766e);
  background: rgba(15, 118, 110, 0.05);
}

.scenario-icon-wrap {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.icon-student {
  background: rgba(15, 118, 110, 0.12);
  color: var(--uni-primary, #0f766e);
}

.icon-import {
  background: rgba(2, 132, 199, 0.12);
  color: #0284c7;
}

.icon-new {
  background: rgba(124, 58, 237, 0.12);
  color: #7c3aed;
}

.scenario-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
}

.scenario-desc {
  font-size: 11.5px;
  color: var(--uni-text-secondary, #64748b);
  margin: 2px 0 0 0;
  line-height: 1.35;
}

.section-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.section-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
}

.section-sub {
  font-size: 12px;
  color: var(--uni-text-secondary, #64748b);
}

.input-with-icon {
  position: relative;
  display: flex;
  align-items: center;
}

.input-icon {
  position: absolute;
  left: 12px;
  font-size: 18px;
  color: var(--uni-text-secondary, #64748b);
}

.input-with-icon .form-input {
  padding-left: 38px;
}

.form-input {
  width: 100%;
  height: 42px;
  padding: 0 12px;
  background: var(--uni-surface-secondary, #f1f5f9);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 10px;
  font-size: 13.5px;
  color: var(--uni-text, #0f172a);
  outline: none;
  box-sizing: border-box;
}

.form-select {
  cursor: pointer;
}

.selected-student-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(15, 118, 110, 0.08);
  border: 1px solid var(--uni-primary, #0f766e);
}

.student-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
}

.student-meta {
  font-size: 12px;
  color: var(--uni-text-secondary, #64748b);
  margin-bottom: 4px;
}

.btn-clear-student {
  background: transparent;
  border: none;
  font-size: 20px;
  color: var(--uni-text-secondary, #64748b);
  cursor: pointer;
}

.search-results-list {
  display: flex;
  flex-direction: column;
  margin-top: 6px;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 10px;
  background: var(--uni-surface, #ffffff);
}

.search-result-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--uni-border, #e2e8f0);
  cursor: pointer;
}

.search-result-item:last-child {
  border-bottom: none;
}

.res-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--uni-text, #0f172a);
}

.res-id {
  font-size: 11px;
  color: var(--uni-text-secondary, #64748b);
}

.search-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  font-size: 12px;
  color: var(--uni-text-secondary, #64748b);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--uni-text-secondary, #64748b);
  letter-spacing: 0.05em;
}

.preset-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}

.preset-card {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1.5px solid var(--uni-border, #e2e8f0);
  background: var(--uni-surface-secondary, #f8fafc);
  cursor: pointer;
  transition: all 0.16s ease;
}

.preset-card.is-selected {
  border-color: var(--uni-primary, #0f766e);
  background: rgba(15, 118, 110, 0.06);
}

.preset-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
}

.preset-desc {
  font-size: 11px;
  color: var(--uni-text-secondary, #64748b);
  margin-top: 2px;
  line-height: 1.3;
}

.custom-perms-matrix {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--uni-border, #e2e8f0);
}

.matrix-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
}

.perms-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.perm-chip {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-family: monospace;
  border: 1px solid var(--uni-border, #e2e8f0);
  background: var(--uni-surface, #ffffff);
  color: var(--uni-text-secondary, #64748b);
  cursor: pointer;
}

.perm-chip.is-checked {
  background: var(--uni-primary, #0f766e);
  color: white;
  border-color: var(--uni-primary, #0f766e);
}

.form-actions-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 8px;
}

.dialog-code-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(15, 118, 110, 0.08);
  border: 1px dashed var(--uni-primary, #0f766e);
  margin: 12px 0 6px 0;
  width: 100%;
  box-sizing: border-box;
}

.code-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--uni-primary, #0f766e);
}

.code-flex {
  display: flex;
  align-items: center;
  gap: 12px;
}

.code-str {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 0.18em;
  color: var(--uni-primary, #0f766e);
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--uni-primary, #0f766e);
  background: white;
  color: var(--uni-primary, #0f766e);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.code-note {
  font-size: 11px;
  color: var(--uni-text-secondary, #64748b);
  text-align: center;
}

:global(.dark) .create-officer-content {
  --background: var(--uni-background, #0f1117);
}

:global(.dark) .minimal-card,
:global(.dark) .search-results-list {
  background: var(--uni-surface, #1b1d23);
  border-color: var(--uni-border, #30343d);
}

:global(.dark) .scenario-card,
:global(.dark) .preset-card {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #30343d);
}

:global(.dark) .scenario-card.is-active,
:global(.dark) .preset-card.is-selected {
  background: rgba(94, 234, 212, 0.08);
  border-color: var(--uni-primary, #5eead4);
}

:global(.dark) .form-input {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #30343d);
}

:global(.dark) .copy-btn {
  background: var(--uni-surface, #1b1d23);
}
</style>
