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
  personAddOutline,
  searchOutline,
  checkmarkCircleOutline,
  copyOutline,
  checkmarkOutline,
  closeOutline,
  chevronDownOutline,
  chevronUpOutline,
  personOutline,
  shieldCheckmarkOutline,
  cashOutline,
  flashOutline,
  optionsOutline,
  alertCircleOutline,
} from 'ionicons/icons';
import {
  UniPageHeader,
  UniButton,
  UniStatusBadge,
  UniDialog,
  UniSelect,
} from '@/components/ui';
import {
  OfficerManagementService,
  OFFICER_PERMISSIONS,
} from '@/services/officer-management.service';
import { StudentActivationService } from '@/services/student-activation.service';
import type { OfficerPermissionPreset, OfficerScopeType } from '@/types/database';
import { SystemSetupService } from '@/services/system-setup.service';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { haptics } from '@/utilities/haptics';
import { useToast } from '@/composables/useToast';
import { useOperationPolicy } from '@/composables/useOperationPolicy';

const router = useRouter();
const { showToast } = useToast();
const { isPermitted, getDisabledReason } = useOperationPolicy();
const canCreateOfficer = isPermitted('OFFICER_MANAGEMENT_AND_PERMISSIONS');
const createOfficerDisabledReason = getDisabledReason('OFFICER_MANAGEMENT_AND_PERMISSIONS');

type CandidateType = 'STUDENT' | 'EXTERNAL';
const candidateType = ref<CandidateType>('STUDENT');

// Search & Auto-Suggestion states
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
const scopeTypeOptions = [
  { value: 'ORGANIZATION', label: 'All Organization (Campus-Wide)' },
  { value: 'PROGRAM', label: 'Specific Program' },
  { value: 'SECTION', label: 'Specific Section' },
];

// Academic options
const academicYears = ref<{ id: string; label: string }[]>([]);
const selectedAcademicYearId = ref('');
const semesters = ref<{ id: string; term: string; academic_year_id: string }[]>([]);
const selectedSemesterId = ref('');

// Advanced options toggle
const showAdvancedOptions = ref(false);

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

    // Preload top candidate suggestions (limit 10)
    searchResults.value = await OfficerManagementService.searchCandidates('', 10);
  } catch (e) {
    console.error('Error loading initial officer setup data:', e);
  }
});

// Student Search Debounce with max 10 auto-suggestions
let searchTimeout: any = null;
function handleSearchInput() {
  if (searchTimeout) clearTimeout(searchTimeout);
  const clean = studentSearchQuery.value.trim();

  isSearchingStudents.value = true;
  searchTimeout = setTimeout(async () => {
    try {
      searchResults.value = await OfficerManagementService.searchCandidates(clean, 10);
    } catch (e) {
      console.error('Search error:', e);
      searchResults.value = [];
    } finally {
      isSearchingStudents.value = false;
    }
  }, 180);
}

async function handleSearchFocus() {
  if (selectedStudent.value) return;
  if (searchResults.value.length === 0) {
    try {
      isSearchingStudents.value = true;
      searchResults.value = await OfficerManagementService.searchCandidates(studentSearchQuery.value.trim(), 10);
    } catch (e) {
      console.error('Focus suggestion error:', e);
    } finally {
      isSearchingStudents.value = false;
    }
  }
}

async function selectStudent(st: any) {
  haptics.light();
  selectedStudent.value = st;
  fullName.value = `${st.first_name} ${st.last_name}`.trim();
  email.value = st.username ? `${st.username}@univ.edu` : `${st.school_id?.toLowerCase() || 'student'}@univ.edu`;
  searchResults.value = [];
  studentSearchQuery.value = '';

  // Hydrate user_id and registration status from student activation status if not already set
  if (!st.user_id) {
    try {
      const details = await StudentActivationService.getStudentActivationStatus(st.student_id, st.school_id);
      if (details.linkedUserId) {
        selectedStudent.value.user_id = details.linkedUserId;
        selectedStudent.value.is_registered = 1;
        if (details.linkedUsername) {
          selectedStudent.value.username = details.linkedUsername;
          email.value = `${details.linkedUsername}@univ.edu`;
        }
      }
    } catch (statusErr) {
      console.warn('Could not hydrate student user account:', statusErr);
    }
  }

  // Proactively check if student already has an active officer appointment
  try {
    const existing = await OfficerManagementService.getAppointmentForStudent(st.student_id);
    if (existing && (existing.status === 'ACTIVE' || existing.status === 'SUSPENDED')) {
      selectedStudent.value.is_officer = 1;
    }
  } catch {
    // Non-fatal
  }
}

async function clearSelectedStudent() {
  selectedStudent.value = null;
  fullName.value = '';
  email.value = '';
  studentSearchQuery.value = '';
  try {
    searchResults.value = await OfficerManagementService.searchCandidates('', 10);
  } catch {
    searchResults.value = [];
  }
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

const isAlreadyActiveOfficer = computed(() => {
  return candidateType.value === 'STUDENT' && Boolean(selectedStudent.value?.is_officer);
});

const isFormValid = computed(() => {
  if (candidateType.value === 'STUDENT') {
    return selectedStudent.value && fullName.value.trim().length > 0 && !isAlreadyActiveOfficer.value;
  }
  return fullName.value.trim().length > 2 && email.value.includes('@');
});

const submitButtonLabel = computed(() => {
  if (candidateType.value === 'STUDENT') {
    return 'Promote to Officer';
  }
  return 'Send Officer Invitation';
});

async function handleSubmit() {
  if (!isFormValid.value || isSubmitting.value) return;
  if (!canCreateOfficer.value) {
    await showToast(createOfficerDisabledReason.value || 'Officer administration requires an active internet connection.', 'error');
    return;
  }

  isSubmitting.value = true;
  const devAdminUserId = SupabaseAuthService.user.value?.id || authService.user.value?.id || 'devadmin_local';

  try {
    if (candidateType.value === 'STUDENT') {
      // Student-to-Officer Promotion: promotes existing authenticated student account directly
      const res = await OfficerManagementService.promoteStudentToOfficer({
        studentId: selectedStudent.value.student_id,
        userId: selectedStudent.value.user_id || undefined,
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

      if (!res || res.success !== true) {
        throw new Error(res?.error || 'Failed to promote student to officer.');
      }
      haptics.success();
      createdResult.value = {
        success: true,
        officerName: fullName.value,
      };
      isSuccessDialogOpen.value = true;
    } else {
      // External Non-Student Invite
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
    await showToast('Activation code copied to clipboard', 'success');
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
      subtitle="Assign operational capabilities and permissions"
      :back-button="true"
      default-back-href="/settings/system-setup/officers"
    />

    <ion-content class="create-officer-content">
      <div class="page-container">
        <!-- Candidate Type Segment -->
        <div class="type-segment-wrap">
          <button
            type="button"
            class="type-segment-btn"
            :class="{ 'is-active': candidateType === 'STUDENT' }"
            @click="candidateType = 'STUDENT'; clearSelectedStudent()"
          >
            <ion-icon :icon="schoolOutline" />
            <span>Student Roster</span>
          </button>
          <button
            type="button"
            class="type-segment-btn"
            :class="{ 'is-active': candidateType === 'EXTERNAL' }"
            @click="candidateType = 'EXTERNAL'; clearSelectedStudent()"
          >
            <ion-icon :icon="personAddOutline" />
            <span>Non-Student Invite</span>
          </button>
        </div>

        <!-- 1. Candidate Selection: Student Roster -->
        <div v-if="candidateType === 'STUDENT'" class="section-card minimal-card">
          <div class="section-header">
            <span class="section-title">Select Student Candidate</span>
            <span class="section-sub">Type student name or School ID for auto-suggestions</span>
          </div>

          <!-- Selected Student Compact Chip -->
          <div v-if="selectedStudent" class="selected-student-box">
            <div class="selected-avatar">
              <ion-icon :icon="personOutline" />
            </div>
            <div class="selected-info">
              <div class="selected-name">{{ selectedStudent.first_name }} {{ selectedStudent.last_name }}</div>
              <div class="selected-meta font-mono">{{ selectedStudent.school_id }}</div>
            </div>
            <div class="selected-badge">
              <UniStatusBadge v-if="selectedStudent.is_officer" variant="danger">
                Active Officer
              </UniStatusBadge>
              <UniStatusBadge v-else :variant="selectedStudent.is_registered ? 'success' : 'neutral'">
                {{ selectedStudent.is_registered ? 'Registered Account' : 'Roster (Awaiting Signup)' }}
              </UniStatusBadge>
            </div>
            <button type="button" class="btn-clear" title="Change Student" @click="clearSelectedStudent">
              <ion-icon :icon="closeOutline" />
            </button>
          </div>

          <!-- Duplicate Officer Warning Banner -->
          <div v-if="selectedStudent?.is_officer" class="duplicate-officer-banner">
            <ion-icon :icon="alertCircleOutline" />
            <span>This student already holds an active officer appointment. Multiple active appointments are not permitted.</span>
          </div>

          <!-- Search Input with Auto-Suggestions -->
          <div v-else class="search-input-wrap">
            <div class="search-bar-row">
              <ion-icon :icon="searchOutline" class="search-icon" />
              <input
                v-model="studentSearchQuery"
                type="text"
                class="search-input"
                placeholder="Search name or ID (e.g. MCC-2026-0001)..."
                autocomplete="off"
                @focus="handleSearchFocus"
                @input="handleSearchInput"
              />
              <ion-spinner v-if="isSearchingStudents" name="crescent" class="search-spinner" />
              <button
                v-else-if="studentSearchQuery.length > 0"
                type="button"
                class="btn-clear-input"
                @click="studentSearchQuery = ''; searchResults = []"
              >
                <ion-icon :icon="closeOutline" />
              </button>
            </div>

            <!-- Auto-Suggestions Dropdown List (Limit 10) -->
            <div v-if="searchResults.length > 0" class="auto-suggestions-dropdown">
              <div class="suggestions-header">
                <span>Top Results ({{ searchResults.length }})</span>
              </div>
              <div
                v-for="st in searchResults"
                :key="st.student_id"
                class="suggestion-row"
                @click="selectStudent(st)"
                @mousedown.prevent="selectStudent(st)"
              >
                <div class="sugg-avatar">
                  <ion-icon :icon="schoolOutline" />
                </div>
                <div class="sugg-details">
                  <span class="sugg-name">{{ st.first_name }} {{ st.last_name }}</span>
                  <span class="sugg-id font-mono">{{ st.school_id }}</span>
                </div>
                <div class="sugg-tag">
                  <span v-if="st.is_officer" class="tag-officer">Active Officer</span>
                  <span v-else-if="st.is_registered" class="tag-registered">Registered</span>
                  <span v-else class="tag-roster">Roster</span>
                </div>
              </div>
            </div>

            <div
              v-else-if="studentSearchQuery.trim().length >= 2 && !isSearchingStudents"
              class="empty-suggestions"
            >
              No matching students found in directory.
            </div>
          </div>
        </div>

        <!-- 1B. Candidate Selection: External Invite -->
        <div v-else class="section-card minimal-card">
          <div class="section-header">
            <span class="section-title">Candidate Details</span>
            <span class="section-sub">Enter official contact details for officer invitation</span>
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

        <!-- 2. Officer Role & Permission Preset -->
        <div class="section-card minimal-card">
          <div class="section-header">
            <span class="section-title">Officer Role Preset</span>
            <span class="section-sub">Select primary responsibilities and system capabilities</span>
          </div>

          <div class="preset-cards-grid">
            <!-- Attendance -->
            <div
              class="preset-card"
              :class="{ 'is-selected': permissionPreset === 'ATTENDANCE' }"
              @click="permissionPreset = 'ATTENDANCE'"
            >
              <div class="preset-icon-wrap icon-attendance">
                <ion-icon :icon="shieldCheckmarkOutline" />
              </div>
              <div class="preset-content">
                <div class="preset-name">Attendance Officer</div>
                <p class="preset-desc">NFC check-in scanning, attendance logs & absentees tracking.</p>
              </div>
            </div>

            <!-- Finance -->
            <div
              class="preset-card"
              :class="{ 'is-selected': permissionPreset === 'FINANCE' }"
              @click="permissionPreset = 'FINANCE'"
            >
              <div class="preset-icon-wrap icon-finance">
                <ion-icon :icon="cashOutline" />
              </div>
              <div class="preset-content">
                <div class="preset-name">Finance Officer</div>
                <p class="preset-desc">Rapid NFC payment collection, fine issuance & obligation tracking.</p>
              </div>
            </div>

            <!-- Full -->
            <div
              class="preset-card"
              :class="{ 'is-selected': permissionPreset === 'FULL' }"
              @click="permissionPreset = 'FULL'"
            >
              <div class="preset-icon-wrap icon-full">
                <ion-icon :icon="flashOutline" />
              </div>
              <div class="preset-content">
                <div class="preset-name">Full Officer</div>
                <p class="preset-desc">Comprehensive access across attendance, finance, and events.</p>
              </div>
            </div>

            <!-- Custom -->
            <div
              class="preset-card"
              :class="{ 'is-selected': permissionPreset === 'CUSTOM' }"
              @click="permissionPreset = 'CUSTOM'"
            >
              <div class="preset-icon-wrap icon-custom">
                <ion-icon :icon="optionsOutline" />
              </div>
              <div class="preset-content">
                <div class="preset-name">Custom Permissions</div>
                <p class="preset-desc">Granularly select capabilities per officer necessity.</p>
              </div>
            </div>
          </div>

          <!-- Custom Permissions Matrix (if Custom selected) -->
          <div v-if="permissionPreset === 'CUSTOM'" class="custom-perms-matrix">
            <div class="matrix-title">Selected Capabilities ({{ customPermissions.length }})</div>
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

        <!-- 3. Advanced Duration & Scope (Collapsible, Minimal by default) -->
        <div class="section-card minimal-card">
          <button
            type="button"
            class="advanced-toggle-btn"
            @click="showAdvancedOptions = !showAdvancedOptions"
          >
            <div class="toggle-left">
              <span class="section-title">Term Duration & Scope</span>
              <span class="toggle-hint">
                {{ showAdvancedOptions ? 'Hide options' : 'Campus-Wide, 1-Year term (Default)' }}
              </span>
            </div>
            <ion-icon :icon="showAdvancedOptions ? chevronUpOutline : chevronDownOutline" />
          </button>

          <div v-if="showAdvancedOptions" class="advanced-body">
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label">Appointment Start</label>
                <input v-model="appointmentStart" type="date" class="form-input" />
              </div>

              <div class="form-group">
                <label class="form-label">Appointment End</label>
                <input v-model="appointmentEnd" type="date" class="form-input" />
              </div>

              <div class="form-group">
                <label class="form-label">Scope Reach</label>
                <UniSelect
                  v-model="scopeType"
                  :options="scopeTypeOptions"
                  placeholder="Select Scope"
                  header="Scope Reach"
                />
              </div>
            </div>
          </div>
        </div>

        <div v-if="!canCreateOfficer" class="offline-warning-box">
          <ion-icon :icon="alertCircleOutline" class="warn-icon" />
          <div class="warn-text">
            <strong>Offline Mode</strong>
            <p>{{ createOfficerDisabledReason }}</p>
          </div>
        </div>

        <!-- Form Actions Bar -->
        <div class="form-actions-bar">
          <UniButton
            variant="outline"
            @click="router.replace('/settings/system-setup/officers')"
          >
            Cancel
          </UniButton>

          <UniButton
            variant="primary"
            :disabled="!isFormValid || isSubmitting || !canCreateOfficer"
            @click="handleSubmit"
          >
            <ion-spinner v-if="isSubmitting" name="crescent" slot="start" />
            <ion-icon v-else :icon="checkmarkCircleOutline" slot="start" />
            <span>{{ submitButtonLabel }}</span>
          </UniButton>
        </div>
      </div>
    </ion-content>

    <!-- Success Dialog: Promoted directly or External Invitation Code -->
    <UniDialog
      :is-open="isSuccessDialogOpen"
      :title="createdResult?.activationCode ? 'Officer Invitation Issued' : 'Officer Promoted'"
      :description="
        createdResult?.activationCode
          ? `Provide this single-use code to ${createdResult?.officerName} to complete officer enrollment.`
          : `${createdResult?.officerName} has been successfully promoted to Officer.`
      "
      type="info"
      confirm-text="Done"
      cancel-text=""
      @confirm="handleDone"
      @close="handleDone"
    >
      <div v-if="createdResult?.activationCode" class="dialog-code-box">
        <span class="code-label">Single-Use Activation Code</span>
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
        <span class="code-note">Expires in 48 hours. Officer privileges activate automatically upon signup.</span>
      </div>
    </UniDialog>
  </ion-page>
</template>

<style scoped>
.create-officer-content {
  --background: var(--uni-background, #0f1117);
}

.page-container {
  max-width: 600px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Type Segmented Control */
.type-segment-wrap {
  display: flex;
  background: var(--uni-surface, #1e222d);
  padding: 4px;
  border-radius: 12px;
  gap: 4px;
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.08));
}

.type-segment-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--uni-text-secondary, #94a3b8);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}

.type-segment-btn ion-icon {
  font-size: 1.15rem;
}

.type-segment-btn.is-active {
  background: var(--uni-primary, #0f766e);
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(15, 118, 110, 0.35);
}

/* Section Card */
.section-card {
  background: var(--uni-surface, #1e222d);
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.08));
  border-radius: 14px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--uni-text, #f1f5f9);
}

.section-sub {
  font-size: 0.8rem;
  color: var(--uni-text-secondary, #94a3b8);
}

/* Selected Student Box */
.selected-student-box {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(15, 118, 110, 0.1);
  border: 1px solid rgba(15, 118, 110, 0.35);
  padding: 12px 14px;
  border-radius: 12px;
}

.selected-avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--uni-primary, #0f766e);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.3rem;
  flex-shrink: 0;
}

.selected-info {
  flex: 1;
  min-width: 0;
}

.selected-name {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--uni-text, #f1f5f9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.selected-meta {
  font-size: 0.8rem;
  color: var(--uni-text-secondary, #94a3b8);
}

.btn-clear {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: var(--uni-text-secondary, #94a3b8);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-clear:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.duplicate-officer-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: #ef4444;
  font-size: 0.85rem;
  font-weight: 500;
  margin-top: 8px;
}

.duplicate-officer-banner ion-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

/* Search Input & Dropdown */
.search-input-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
}

.search-bar-row {
  display: flex;
  align-items: center;
  background: var(--uni-surface-secondary, #f8fafc);
  border: 1.5px solid var(--uni-border, #e2e8f0);
  border-radius: 10px;
  padding: 0 12px;
  gap: 10px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.search-bar-row:focus-within {
  border-color: var(--uni-primary, #0f766e);
  box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.18);
}

.search-icon {
  font-size: 1.2rem;
  color: var(--uni-text-secondary, #94a3b8);
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  height: 44px;
  color: var(--uni-text, #0f172a);
  font-size: 0.92rem;
}

.search-input::placeholder {
  color: var(--uni-text-secondary, #64748b);
}

.search-spinner {
  width: 20px;
  height: 20px;
  color: var(--uni-primary, #0f766e);
}

.btn-clear-input {
  background: transparent;
  border: none;
  color: var(--uni-text-secondary, #94a3b8);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}

/* Auto-Suggestions Dropdown */
.auto-suggestions-dropdown {
  position: relative;
  margin-top: 6px;
  background: var(--uni-surface, #1e222d);
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.15));
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  max-height: 280px;
  overflow-y: auto;
  z-index: 20;
}

.suggestions-header {
  padding: 8px 12px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--uni-text-secondary, #94a3b8);
  border-bottom: 1px solid var(--uni-border, rgba(255, 255, 255, 0.06));
}

.suggestion-row {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  gap: 10px;
  cursor: pointer;
  border-bottom: 1px solid var(--uni-border, rgba(255, 255, 255, 0.04));
  transition: background 0.12s ease;
}

.suggestion-row:hover,
.suggestion-row:active {
  background: rgba(15, 118, 110, 0.15);
}

.sugg-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--uni-primary, #14b8a6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  flex-shrink: 0;
}

.sugg-details {
  flex: 1;
  min-width: 0;
}

.sugg-name {
  display: block;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--uni-text, #f1f5f9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sugg-id {
  display: block;
  font-size: 0.78rem;
  color: var(--uni-text-secondary, #94a3b8);
}

.sugg-tag {
  flex-shrink: 0;
}

.tag-registered {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 3px 7px;
  border-radius: 6px;
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.tag-officer {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 3px 7px;
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.tag-roster {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 3px 7px;
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.12);
  color: #94a3b8;
}

.empty-suggestions {
  padding: 12px;
  font-size: 0.82rem;
  color: var(--uni-text-secondary, #94a3b8);
  text-align: center;
}

/* Preset Cards Grid */
.preset-cards-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

@media (min-width: 500px) {
  .preset-cards-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.preset-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: var(--uni-background, #0f1117);
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.08));
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.preset-card.is-selected {
  border-color: var(--uni-primary, #0f766e);
  background: rgba(15, 118, 110, 0.12);
}

.preset-icon-wrap {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.15rem;
  flex-shrink: 0;
}

.icon-attendance { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
.icon-finance { background: rgba(16, 185, 129, 0.15); color: #10b981; }
.icon-full { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
.icon-custom { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }

.preset-content {
  flex: 1;
}

.preset-name {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--uni-text, #f1f5f9);
}

.preset-desc {
  font-size: 0.75rem;
  color: var(--uni-text-secondary, #94a3b8);
  margin: 2px 0 0;
  line-height: 1.3;
}

/* Custom Permissions Matrix */
.custom-perms-matrix {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--uni-border, rgba(255, 255, 255, 0.08));
}

.matrix-title {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--uni-text, #f1f5f9);
  margin-bottom: 8px;
}

.perms-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.perm-chip {
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.1));
  background: var(--uni-background, #0f1117);
  color: var(--uni-text-secondary, #94a3b8);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s ease;
}

.perm-chip.is-checked {
  background: var(--uni-primary, #0f766e);
  color: #ffffff;
  border-color: var(--uni-primary, #0f766e);
}

/* Advanced Toggle */
.advanced-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: transparent;
  border: none;
  padding: 0;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.toggle-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggle-hint {
  font-size: 0.78rem;
  color: var(--uni-text-secondary, #94a3b8);
}

.advanced-body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--uni-border, rgba(255, 255, 255, 0.08));
}

/* Form Grid */
.form-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--uni-text-secondary, #94a3b8);
}

.form-input {
  height: 42px;
  background: var(--uni-background, #0f1117);
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  padding: 0 12px;
  color: var(--uni-text, #f1f5f9);
  font-size: 0.88rem;
  outline: none;
}

.form-input:focus {
  border-color: var(--uni-primary, #0f766e);
}

/* Actions Bar */
.form-actions-bar {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 6px;
}

/* Dialog Code Box */
.dialog-code-box {
  background: rgba(15, 118, 110, 0.1);
  border: 1px solid rgba(15, 118, 110, 0.3);
  padding: 14px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 12px 0 6px;
}

.code-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--uni-primary, #14b8a6);
}

.code-flex {
  display: flex;
  align-items: center;
  gap: 10px;
}

.code-str {
  font-size: 1.6rem;
  font-weight: 800;
  letter-spacing: 0.15em;
  color: var(--uni-text, #f1f5f9);
}

.copy-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--uni-primary, #0f766e);
  color: #ffffff;
  border: none;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.code-note {
  font-size: 0.75rem;
  color: var(--uni-text-secondary, #94a3b8);
  text-align: center;
  line-height: 1.3;
}

.offline-warning-box {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: #ef4444;
  margin-bottom: 12px;
}

.offline-warning-box .warn-icon {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}

.offline-warning-box .warn-text strong {
  display: block;
  font-size: 13px;
  font-weight: 700;
}

.offline-warning-box .warn-text p {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--uni-text-muted, #94a3b8);
}
</style>
