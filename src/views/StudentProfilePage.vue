<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { 
  IonPage, 
  IonIcon, 
  IonContent, 
  IonSpinner, 
  IonModal,
  onIonViewWillEnter 
} from '@ionic/vue';
import { 
  createOutline, 
  trashOutline, 
  swapHorizontalOutline,
  closeCircleOutline,
  copyOutline,
  receiptOutline,
  calendarOutline,
  alertCircleOutline,
  addOutline,
  keyOutline,
  shieldCheckmarkOutline,
  refreshOutline,
} from 'ionicons/icons';
import { useStudents } from '@/composables/useStudents';
import { useToast } from '@/composables/useToast';
import { financeService } from '@/services/finance.service';
import { attendanceService } from '@/services/attendance.service';
import { StudentActivationService, type StudentActivationDetails } from '@/services/student-activation.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { authService } from '@/services/auth.service';
import { formatFullName, formatStudentAcademicSummary, formatYearLevel } from '@/utilities/student-formatters';
import { formatPeso } from '@/utilities/finance-formatters';
import { formatDate, formatTime } from '@/utilities/date-formatters';
import type { StudentCharge } from '@/types/finance';
import EditStudentModal from '@/components/EditStudentModal.vue';
import ReplaceRfidModal from '@/components/ReplaceRfidModal.vue';
import { 
  UniPageHeader, 
  UniSegmentedControl, 
  UniDialog,
  UniButton,
  UniSheet,
} from '@/components/ui';
import { useOperationPolicy } from '@/composables/useOperationPolicy';
import { haptics } from '@/utilities/haptics';

const route = useRoute();
const router = useRouter();
const { getStudentById, deleteStudent, removeRfid, currentStudent, isLoading } = useStudents();
const { showToast, copyToClipboard } = useToast();

const { isPermitted, getDisabledReason } = useOperationPolicy();
const canManageActivation = isPermitted('STUDENT_ACTIVATION_ACCOUNT_LINKING');
const activationDisabledReason = getDisabledReason('STUDENT_ACTIVATION_ACCOUNT_LINKING');
const canManageCard = isPermitted('NFC_CARD_ASSIGNMENT_REASSIGNMENT');
const cardDisabledReason = getDisabledReason('NFC_CARD_ASSIGNMENT_REASSIGNMENT');
const canEditStudent = isPermitted('STUDENTS_CREATE_UPDATE_DEACTIVATE');
const editStudentDisabledReason = getDisabledReason('STUDENTS_CREATE_UPDATE_DEACTIVATE');

const isStudent = computed(() => {
  const role = authService.role.value || SupabaseAuthService.role.value;
  return role === 'STUDENT';
});

const isEditModalOpen = ref(false);
const isReplaceModalOpen = ref(false);
const activeTab = ref<'OVERVIEW' | 'ATTENDANCE' | 'FINANCE'>('OVERVIEW');

// Activation details
const activationDetails = ref<StudentActivationDetails | null>(null);
const showCodeSheet = ref(false);
const newlyIssuedCode = ref('');
const isIssuingCode = ref(false);
const showAuditHistory = ref(false);

// Financial context
const totalBalanceCentavos = computed(() => {
  return studentCharges.value.reduce((sum, c) => {
    if (c.status === 'VOID') return sum;
    return sum + Math.max(0, c.issuedAmount - c.paidAmount);
  }, 0);
});
const studentCharges = ref<StudentCharge[]>([]);
const studentPayments = ref<import('@/types/finance').Payment[]>([]);

// Attendance history
const attendanceHistory = ref<Array<{
  participant: import('@/types/event').OccurrenceParticipant;
  event?: import('@/types/event').Event;
  occurrence?: import('@/types/event').EventOccurrence;
}>>([]);

const initials = computed(() => {
  if (!currentStudent.value) return 'ST';
  const f = currentStudent.value.firstName?.[0] || '';
  const l = currentStudent.value.lastName?.[0] || '';
  return (f + l).toUpperCase() || 'ST';
});

async function loadProfile() {
  const id = route.params.id as string;
  if (!id) return;

  if (isStudent.value) {
    const authStu = authService.student.value;
    const authUser = authService.user.value || SupabaseAuthService.user.value;
    const myId = authStu?.id || authUser?.student_id;
    if (myId && id !== myId) {
      router.replace('/tabs/home');
      return;
    }
  }

  await getStudentById(id);
  if (currentStudent.value) {
    studentCharges.value = await financeService.getCharges(id);
    studentPayments.value = await financeService.getPayments(id);
    attendanceHistory.value = await attendanceService.getStudentAttendanceHistory(id);
    if (!isStudent.value) {
      activationDetails.value = await StudentActivationService.getStudentActivationStatus(
        id,
        currentStudent.value?.studentNumber
      );
    }
  }
}

onMounted(loadProfile);
onIonViewWillEnter(loadProfile);

const currentOfficerUserId = computed(() => {
  return SupabaseAuthService.user.value?.id || authService.user.value?.id || 'officer_local';
});

async function handleIssueCode() {
  if (!currentStudent.value) return;
  if (!canManageActivation.value) {
    await showToast(activationDisabledReason.value || 'Activation actions require an active connection.', 'error');
    return;
  }
  haptics.medium();
  isIssuingCode.value = true;

  try {
    const res = await StudentActivationService.issueActivationCode(
      currentStudent.value.id,
      currentOfficerUserId.value,
      48
    );

    if (res.success && res.rawCode) {
      newlyIssuedCode.value = res.rawCode;
      showCodeSheet.value = true;
      haptics.success();
      await loadProfile();
    } else {
      await showToast(res.error || 'Failed to issue code', 'error');
    }
  } catch (err: unknown) {
    await showToast((err as Error).message || 'Failed to issue code', 'error');
  } finally {
    isIssuingCode.value = false;
  }
}

async function handleRevokeCode() {
  if (!currentStudent.value || !activationDetails.value?.claimId) return;
  if (!canManageActivation.value) {
    await showToast(activationDisabledReason.value || 'Activation actions require an active connection.', 'error');
    return;
  }
  haptics.warning();

  try {
    const res = await StudentActivationService.revokeActivationCode(
      activationDetails.value.claimId,
      currentStudent.value.id,
      currentOfficerUserId.value,
      'Officer manual revocation'
    );

    if (res.success) {
      await showToast('Activation code revoked', 'info');
      await loadProfile();
    } else {
      await showToast(res.error || 'Failed to revoke code', 'error');
    }
  } catch (err: unknown) {
    await showToast((err as Error).message || 'Failed to revoke code', 'error');
  }
}

function handleCopyIssuedCode() {
  if (newlyIssuedCode.value) {
    copyToClipboard(newlyIssuedCode.value, 'Activation Code');
    haptics.light();
  }
}

function handleCopyUid() {
  if (currentStudent.value?.rfidUid) {
    copyToClipboard(currentStudent.value.rfidUid, 'RFID UID');
  }
}

const showRemoveRfidDialog = ref(false);
const showDeleteDialog = ref(false);

async function handleDeactivateRfid() {
  if (currentStudent.value) {
    await removeRfid(currentStudent.value.id);
    await showToast('NFC card deactivated', 'info');
    await loadProfile();
  }
}

async function handleDeleteStudent() {
  if (currentStudent.value) {
    await deleteStudent(currentStudent.value.id);
    await showToast('Student deleted', 'error');
    router.replace('/tabs/students');
  }
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Student Profile"
      subtitle="Identity & records"
      :back-button="true"
      default-back-href="/tabs/students"
      variant="detail"
    >
      <template #trailing>
        <button class="uni-header-action-btn action-btn-danger" aria-label="Delete Student" @click="showDeleteDialog = true">
          <ion-icon :icon="trashOutline" />
        </button>
      </template>
    </UniPageHeader>

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Loading State -->
        <div v-if="isLoading && !currentStudent" class="loading-state">
          <ion-spinner name="crescent" color="primary" />
          <p class="metadata-text">Loading profile...</p>
        </div>

        <!-- Not Found State -->
        <div v-else-if="!currentStudent" class="empty-state-box">
          <p class="empty-state-title">Student Not Found</p>
          <p class="empty-state-sub">This record does not exist or was deleted.</p>
          <UniButton size="sm" @click="router.push('/tabs/students')">
            Back to Directory
          </UniButton>
        </div>

        <!-- Student Profile Details -->
        <div v-else class="profile-layout">
          <!-- Hero Header Card -->
          <div class="minimal-card profile-hero-card">
            <div class="profile-avatar-circle">
              {{ initials }}
            </div>
            <h2 class="profile-fullname">
              {{ formatFullName(currentStudent.firstName, currentStudent.middleName, currentStudent.lastName) }}
            </h2>
            <p class="profile-academic-sub">
              {{ formatStudentAcademicSummary(currentStudent) }}
            </p>

            <!-- Student Number Pill -->
            <div class="id-badge-row">
              <span class="id-pill font-mono" v-if="currentStudent.studentNumber">
                ID: {{ currentStudent.studentNumber }}
              </span>
              <button class="missing-id-badge" v-else @click="isEditModalOpen = true">
                <ion-icon :icon="alertCircleOutline" /> Missing ID # (Tap to add)
              </button>
            </div>
          </div>

          <!-- Section Navigation Tabs -->
          <UniSegmentedControl
            v-model="activeTab"
            :options="[
              { value: 'OVERVIEW', label: 'Overview' },
              { value: 'ATTENDANCE', label: `Attendance (${attendanceHistory.length})` },
              { value: 'FINANCE', label: `Finance (${studentCharges.length})` }
            ]"
            size="sm"
          />

          <!-- TAB 1: OVERVIEW -->
          <template v-if="activeTab === 'OVERVIEW'">
            <!-- Digital Student ID Card (Aurora) -->
            <div class="digital-id-card">
              <div class="digital-id-chip-row">
                <div class="simulated-emv-chip"></div>
                <span 
                  class="status-badge" 
                  :class="currentStudent.rfidUid ? 'badge-aurora-mint' : 'badge-warning'"
                >
                  <span class="pulse-dot" v-if="currentStudent.rfidUid"></span>
                  {{ currentStudent.rfidUid ? 'NFC Active' : 'No Card Linked' }}
                </span>
              </div>

              <div class="digital-id-info">
                <span class="digital-id-univ-label">UNIVERSITY ID • CSG</span>
                <div class="digital-id-name">
                  {{ formatFullName(currentStudent.firstName, currentStudent.middleName, currentStudent.lastName) }}
                </div>
                <div class="digital-id-num font-mono">
                  {{ currentStudent.studentNumber || 'PENDING ASSIGNMENT' }}
                </div>
              </div>

              <!-- RFID Display -->
              <div v-if="currentStudent.rfidUid" class="uid-display-panel">
                <div class="uid-top-bar">
                  <span class="metadata-text">HARDWARE UID</span>
                  <button class="copy-subtle-btn" @click="handleCopyUid">
                    <ion-icon :icon="copyOutline" /> Copy
                  </button>
                </div>
                <div class="uid-hex-text font-mono" @click="handleCopyUid">
                  {{ currentStudent.rfidUid }}
                </div>
                <div v-if="currentStudent.rfidUidCompact" class="uid-compact-line font-mono">
                  Compact: {{ currentStudent.rfidUidCompact }}
                </div>
              </div>

              <!-- Actions Row (Officer only) -->
              <div class="card-actions-row" v-if="!isStudent">
                <span v-if="!canManageCard" class="policy-hint-text">
                  {{ cardDisabledReason }}
                </span>
                <button 
                  class="action-subtle-btn"
                  :disabled="!canManageCard"
                  @click="canManageCard && (isReplaceModalOpen = true)"
                >
                  <ion-icon :icon="swapHorizontalOutline" />
                  {{ currentStudent.rfidUid ? 'Replace NFC Card' : 'Link NFC Card' }}
                </button>

                <button 
                  v-if="currentStudent.rfidUid" 
                  class="action-subtle-btn text-danger"
                  :disabled="!canManageCard"
                  @click="canManageCard && (showRemoveRfidDialog = true)"
                >
                  <ion-icon :icon="closeCircleOutline" />
                  Deactivate
                </button>
              </div>

              <!-- Card History if replaced cards exist -->
              <div v-if="currentStudent.cards && currentStudent.cards.length > 1" class="lifecycle-history-wrap">
                <span class="metadata-text">CARD LIFECYCLE ({{ currentStudent.cards.length }})</span>
                <div class="history-chips-row">
                  <div v-for="c in currentStudent.cards" :key="c.id" class="lifecycle-chip">
                    <span class="font-mono text-xs">{{ c.rfidUid }}</span>
                    <span class="status-badge" :class="c.status === 'ACTIVE' ? 'badge-success' : 'badge-neutral'">
                      {{ c.status }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Academic & Personal Details Card -->
            <div class="minimal-card overview-card">
              <div class="card-head-row">
                <span class="card-title-text">Student Information</span>
                <button
                  v-if="!isStudent"
                  class="edit-link-btn"
                  :disabled="!canEditStudent"
                  :title="!canEditStudent ? editStudentDisabledReason : undefined"
                  @click="canEditStudent && router.push(`/students/${currentStudent.id}/edit`)"
                >
                  <ion-icon :icon="createOutline" /> Edit
                </button>
              </div>

              <div class="info-table">
                <div class="info-row">
                  <span class="info-lbl">Student Number</span>
                  <span class="info-val font-mono">{{ currentStudent.studentNumber || 'Not configured' }}</span>
                </div>
                <div class="info-row">
                  <span class="info-lbl">Full Name</span>
                  <span class="info-val font-semibold">{{ formatFullName(currentStudent.firstName, currentStudent.middleName, currentStudent.lastName) }}</span>
                </div>
                <div class="info-row">
                  <span class="info-lbl">Course</span>
                  <span class="info-val font-mono">{{ currentStudent.course }}</span>
                </div>
                <div class="info-row">
                  <span class="info-lbl">Year Level</span>
                  <span class="info-val">{{ formatYearLevel(currentStudent.yearLevel) }}</span>
                </div>
                <div class="info-row">
                  <span class="info-lbl">Section</span>
                  <span class="info-val font-mono">{{ currentStudent.section }}</span>
                </div>
              </div>
            </div>

            <!-- Account & Activation Status Card (Officer only) -->
            <div class="minimal-card overview-card activation-card" v-if="!isStudent">
              <div class="card-head-row">
                <div class="activation-title-wrap">
                  <ion-icon :icon="keyOutline" class="text-primary text-base" />
                  <span class="card-title-text">Account &amp; Activation</span>
                </div>
                <span
                  class="status-badge"
                  :class="{
                    'badge-success': activationDetails?.status === 'ACTIVATED',
                    'badge-warning': activationDetails?.status === 'ACTIVATION_PENDING',
                    'badge-danger': activationDetails?.status === 'REQUIRES_ATTENTION',
                    'badge-neutral': activationDetails?.status === 'NOT_ACTIVATED' || !activationDetails
                  }"
                >
                  {{
                    activationDetails?.status === 'ACTIVATED' ? 'Activated' :
                    activationDetails?.status === 'ACTIVATION_PENDING' ? 'Activation Pending' :
                    activationDetails?.status === 'REQUIRES_ATTENTION' ? 'Requires Attention' :
                    'Not Activated'
                  }}
                </span>
              </div>

              <div class="info-table">
                <!-- If Activated -->
                <template v-if="activationDetails?.status === 'ACTIVATED'">
                  <div class="info-row">
                    <span class="info-lbl">Auth Status</span>
                    <span class="info-val text-success font-semibold">Linked &amp; Active</span>
                  </div>
                  <div v-if="activationDetails.linkedUsername" class="info-row">
                    <span class="info-lbl">Username / School ID</span>
                    <span class="info-val font-mono">{{ activationDetails.linkedUsername }}</span>
                  </div>
                  <div v-if="activationDetails.linkedUserId" class="info-row">
                    <span class="info-lbl">Account UID</span>
                    <span class="info-val font-mono text-xs">{{ activationDetails.linkedUserId.slice(0, 12) }}...</span>
                  </div>
                </template>

                <!-- If Pending -->
                <template v-else-if="activationDetails?.status === 'ACTIVATION_PENDING'">
                  <div class="info-row">
                    <span class="info-lbl">Code Status</span>
                    <span class="info-val text-warning font-semibold">Active (Pending Claim)</span>
                  </div>
                  <div v-if="activationDetails.expiresAt" class="info-row">
                    <span class="info-lbl">Expires</span>
                    <span class="info-val">{{ formatDate(activationDetails.expiresAt) }} {{ formatTime(activationDetails.expiresAt) }}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-lbl">Attempt Limits</span>
                    <span class="info-val font-mono">{{ activationDetails.attemptCount ?? 0 }} / {{ activationDetails.maxAttempts ?? 5 }} attempts</span>
                  </div>
                </template>

                <!-- If Requires Attention -->
                <template v-else-if="activationDetails?.status === 'REQUIRES_ATTENTION'">
                  <div class="info-row">
                    <span class="info-lbl">Alert</span>
                    <span class="info-val text-danger font-semibold">Code Expired or Locked</span>
                  </div>
                  <div class="info-row">
                    <span class="info-lbl">Reason</span>
                    <span class="info-val text-xs text-muted">
                      {{ (activationDetails.attemptCount ?? 0) >= (activationDetails.maxAttempts ?? 5) ? 'Max failed attempts exceeded' : 'Activation code has expired' }}
                    </span>
                  </div>
                </template>

                <!-- If Not Activated -->
                <template v-else>
                  <div class="info-row">
                    <span class="info-lbl">Eligibility</span>
                    <span class="info-val text-success">Imported &amp; Eligible for Activation</span>
                  </div>
                </template>
              </div>

              <!-- Officer Actions -->
              <div class="activation-actions-row">
                <span v-if="!canManageActivation" class="policy-hint-text">
                  {{ activationDisabledReason }}
                </span>
                <UniButton
                  v-if="activationDetails?.status === 'NOT_ACTIVATED' || !activationDetails"
                  variant="primary"
                  size="sm"
                  :disabled="isIssuingCode || !canManageActivation"
                  @click="handleIssueCode"
                >
                  <ion-icon :icon="keyOutline" slot="start" />
                  Issue Activation Code
                </UniButton>

                <template v-else-if="activationDetails?.status === 'ACTIVATION_PENDING'">
                  <UniButton
                    variant="outline"
                    size="sm"
                    :disabled="isIssuingCode || !canManageActivation"
                    @click="handleIssueCode"
                  >
                    <ion-icon :icon="refreshOutline" slot="start" />
                    Reissue Code
                  </UniButton>
                  <UniButton
                    variant="destructive"
                    size="sm"
                    :disabled="!canManageActivation"
                    @click="handleRevokeCode"
                  >
                    <ion-icon :icon="closeCircleOutline" slot="start" />
                    Revoke Code
                  </UniButton>
                </template>

                <UniButton
                  v-else-if="activationDetails?.status === 'REQUIRES_ATTENTION'"
                  variant="primary"
                  size="sm"
                  :disabled="isIssuingCode || !canManageActivation"
                  @click="handleIssueCode"
                >
                  <ion-icon :icon="refreshOutline" slot="start" />
                  Reissue New Code
                </UniButton>

                <UniButton
                  v-if="activationDetails?.auditHistory && activationDetails.auditHistory.length > 0"
                  variant="ghost"
                  size="sm"
                  @click="showAuditHistory = !showAuditHistory"
                >
                  {{ showAuditHistory ? 'Hide History' : 'Audit Trail' }} ({{ activationDetails.auditHistory.length }})
                </UniButton>
              </div>

              <!-- Collapsible Audit Trail -->
              <div v-if="showAuditHistory && activationDetails?.auditHistory?.length" class="audit-history-box">
                <span class="metadata-text">ACTIVATION AUDIT LOG</span>
                <div class="audit-records-list">
                  <div v-for="aud in activationDetails.auditHistory" :key="aud.id" class="audit-record-item">
                    <div class="audit-action-line">
                      <span class="audit-action-badge" :class="'audit-' + aud.action.toLowerCase()">{{ aud.action }}</span>
                      <span class="audit-time font-mono">{{ formatDate(aud.created_at) }}</span>
                    </div>
                    <span v-if="aud.notes" class="audit-notes">{{ aud.notes }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- TAB 2: ATTENDANCE HISTORY -->
          <template v-if="activeTab === 'ATTENDANCE'">
            <div class="minimal-card activity-card">
              <div v-if="attendanceHistory.length > 0" class="history-list">
                <div 
                  v-for="(item, idx) in attendanceHistory" 
                  :key="item.participant.id" 
                  class="activity-row"
                  :class="{ 'row-border': idx < attendanceHistory.length - 1 }"
                >
                  <div class="activity-icon-wrap" :class="'icon-' + item.participant.attendanceStatus.toLowerCase()">
                    <ion-icon :icon="calendarOutline" />
                  </div>
                  <div class="activity-details">
                    <div class="activity-primary-line">
                      <span class="activity-student-name">{{ item.event?.title || 'CSG Event' }}</span>
                      <span class="status-badge" :class="'badge-' + item.participant.attendanceStatus.toLowerCase()">
                        {{ item.participant.attendanceStatus }}
                      </span>
                    </div>
                    <div class="activity-sub-line">
                      <span class="activity-note">{{ item.occurrence?.title || 'Session' }} • {{ formatDate(item.occurrence?.date) }}</span>
                      <span v-if="item.participant.attendanceTime" class="metadata-text font-mono">
                        {{ formatTime(item.participant.attendanceTime) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else class="empty-state-box">
                <ion-icon :icon="calendarOutline" class="empty-state-icon" />
                <p class="empty-state-title">No Attendance Records</p>
                <p class="empty-state-sub">Event check-ins will appear here.</p>
              </div>
            </div>
          </template>

          <!-- TAB 3: OBLIGATIONS & PAYMENTS -->
          <template v-if="activeTab === 'FINANCE'">
            <!-- Balance Summary Card -->
            <div class="minimal-card overview-card">
              <div class="card-head-row">
                <div class="head-lead">
                  <ion-icon :icon="receiptOutline" class="head-icon text-primary" />
                  <span class="card-title-text">Outstanding Balance</span>
                </div>
                <button 
                  v-if="!isStudent && totalBalanceCentavos > 0"
                  class="action-subtle-btn"
                  @click="router.push({ path: '/finance/pay', query: { studentId: currentStudent.id } })"
                >
                  Record Payment
                </button>
              </div>

              <div class="balance-inline-box">
                <span class="secondary-text">Total Unpaid Balance</span>
                <span class="balance-amt font-mono tabular-nums" :class="totalBalanceCentavos > 0 ? 'text-danger' : 'text-success'">
                  {{ formatPeso(totalBalanceCentavos) }}
                </span>
              </div>
            </div>

            <!-- Student Charges Card -->
            <div class="minimal-card overview-card">
              <div class="card-head-row">
                <span class="card-title-text">Fee Obligations</span>
                <button 
                  v-if="!isStudent"
                  class="edit-link-btn"
                  @click="router.push({ path: '/finance/charges/create', query: { studentId: currentStudent.id } })"
                >
                  <ion-icon :icon="addOutline" /> Issue
                </button>
              </div>

              <div v-if="studentCharges.length > 0" class="charges-simple-list">
                <div v-for="chg in studentCharges" :key="chg.id" class="charge-mini-row">
                  <div class="charge-mini-text">
                    <span class="charge-mini-title">{{ chg.title }}</span>
                    <span class="metadata-text font-mono">
                      Rem: {{ formatPeso(chg.issuedAmount - chg.paidAmount) }}
                    </span>
                  </div>
                  <span 
                    class="status-badge"
                    :class="chg.status === 'PAID' ? 'badge-success' : (chg.status === 'VOID' ? 'badge-neutral' : 'badge-warning')"
                  >
                    {{ chg.status }}
                  </span>
                </div>
              </div>

              <div v-else class="empty-state-box">
                <ion-icon :icon="receiptOutline" class="empty-state-icon" />
                <p class="empty-state-title">No Obligations</p>
                <p class="empty-state-sub">Student is clear of fees.</p>
              </div>
            </div>

            <!-- Payment Records Card -->
            <div class="minimal-card overview-card" v-if="studentPayments.length > 0">
              <div class="card-head-row">
                <span class="card-title-text">Payment Records</span>
              </div>
              <div class="charges-simple-list">
                <div v-for="pay in studentPayments" :key="pay.id" class="charge-mini-row">
                  <div class="charge-mini-text">
                    <span class="charge-mini-title font-mono">{{ pay.referenceNumber }}</span>
                    <span class="metadata-text">
                      {{ new Date(pay.processedAt).toLocaleDateString() }}
                    </span>
                  </div>
                  <span class="font-mono text-success font-bold">
                    {{ formatPeso(pay.amount) }}
                  </span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </ion-content>

    <!-- Edit Student Modal -->
    <ion-modal :is-open="isEditModalOpen" @didDismiss="isEditModalOpen = false">
      <EditStudentModal 
        v-if="currentStudent" 
        :student="currentStudent" 
        @saved="loadProfile"
        @dismiss="isEditModalOpen = false" 
      />
    </ion-modal>

    <!-- Replace RFID Modal -->
    <ion-modal :is-open="isReplaceModalOpen" @didDismiss="isReplaceModalOpen = false">
      <ReplaceRfidModal 
        v-if="currentStudent" 
        :student="currentStudent" 
        @saved="loadProfile"
        @dismiss="isReplaceModalOpen = false" 
      />
    </ion-modal>

    <!-- Delete Student Dialog -->
    <UniDialog
      v-model:is-open="showDeleteDialog"
      title="Delete Student Record?"
      :description="`Are you sure you want to remove ${currentStudent?.firstName} ${currentStudent?.lastName}? This action cannot be undone.`"
      confirm-text="Delete"
      cancel-text="Cancel"
      :destructive="true"
      type="destructive"
      @confirm="handleDeleteStudent"
      @cancel="showDeleteDialog = false"
    />

    <!-- Deactivate RFID Dialog -->
    <UniDialog
      v-model:is-open="showRemoveRfidDialog"
      title="Deactivate RFID Card?"
      description="Are you sure you want to unlink the current RFID card? The card record will be archived as DEACTIVATED."
      confirm-text="Deactivate"
      cancel-text="Cancel"
      :destructive="true"
      type="warning"
      @confirm="handleDeactivateRfid"
      @cancel="showRemoveRfidDialog = false"
    />

    <!-- Single-Use Plaintext Code Presentation Sheet -->
    <UniSheet
      :is-open="showCodeSheet"
      title="Activation Code Issued"
      @close="showCodeSheet = false"
    >
      <div class="issued-code-content">
        <div class="code-security-alert">
          <ion-icon :icon="shieldCheckmarkOutline" class="security-shield-icon" />
          <div class="alert-desc">
            <strong>Single-Use Activation Credential</strong>
            <p>Provide this 8-character code directly to the verified student. For security, this plaintext code is stored only as a cryptographic hash and will <strong>never</strong> be shown again.</p>
          </div>
        </div>

        <div class="plaintext-code-box">
          <span class="code-label">ACTIVATION CODE</span>
          <div class="plaintext-code-display font-mono" @click="handleCopyIssuedCode">
            {{ newlyIssuedCode }}
          </div>
          <span class="code-hint">Tap code to copy • Expires in 48 hours</span>
        </div>

        <div class="code-actions">
          <UniButton variant="outline" size="md" @click="handleCopyIssuedCode">
            <ion-icon :icon="copyOutline" slot="start" />
            Copy Code
          </UniButton>
          <UniButton variant="primary" size="md" @click="showCodeSheet = false">
            Done
          </UniButton>
        </div>
      </div>
    </UniSheet>
  </ion-page>
</template>

<style scoped>
.delete-icon-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  color: var(--ion-color-danger);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  cursor: pointer;
}

.profile-layout {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.profile-hero-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 22px 16px;
  gap: 6px;
}

.profile-avatar-circle {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--app-accent-soft);
  color: var(--ion-color-primary);
  border: 1px solid var(--app-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.02em;
  margin-bottom: 4px;
}

.profile-fullname {
  font-size: 18px;
  font-weight: 700;
  color: var(--app-text-primary);
  margin: 0;
}

.profile-academic-sub {
  font-size: 13px;
  color: var(--app-text-secondary);
  margin: 0;
}

.id-badge-row {
  margin-top: 4px;
}

.id-pill {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text-primary);
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  padding: 3px 10px;
  border-radius: 6px;
}

.missing-id-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ion-color-warning);
  background: rgba(217, 149, 34, 0.1);
  border: 1px solid rgba(217, 149, 34, 0.25);
  padding: 3px 10px;
  border-radius: 6px;
  cursor: pointer;
}

/* Filter Tabs Row */
.filter-tabs-row {
  display: flex;
  background: var(--app-surface-subtle);
  padding: 4px;
  border-radius: 12px;
  border: 1px solid var(--app-border);
  gap: 4px;
}

.tab-pill {
  flex: 1;
  padding: 6px 8px;
  border-radius: 9px;
  border: none;
  background: transparent;
  color: var(--app-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  transition: all 0.15s ease;
}

.tab-pill-active {
  background: var(--app-surface);
  color: var(--app-text-primary);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.digital-id-info {
  margin-bottom: 14px;
}

.digital-id-univ-label {
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
  color: var(--aurora-mint);
  display: block;
  margin-bottom: 4px;
}

.digital-id-name {
  font-size: 18px;
  font-weight: 700;
  color: #FFFFFF;
  line-height: 1.2;
}

.digital-id-num {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
  margin-top: 3px;
}

.overview-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.head-lead {
  display: flex;
  align-items: center;
  gap: 6px;
}

.head-icon {
  font-size: 16px;
  color: var(--ion-color-primary);
}

.card-title-text {
  font-size: 14px;
  font-weight: 650;
  color: var(--app-text-primary);
}

.uid-display-panel {
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.uid-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.copy-subtle-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: transparent;
  border: none;
  color: var(--ion-color-primary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.uid-hex-text {
  font-size: 15px;
  font-weight: 700;
  color: var(--app-text-primary);
}

.uid-compact-line {
  font-size: 11px;
  color: var(--app-text-muted);
}

.card-actions-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.action-subtle-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  border-radius: var(--app-btn-radius);
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  color: var(--app-text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.text-danger { color: var(--ion-color-danger); }

.lifecycle-history-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--app-border);
}

.history-chips-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.lifecycle-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
}

.text-xs { font-size: 11px; }

.edit-link-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: transparent;
  border: none;
  color: var(--ion-color-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.info-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

.info-lbl { color: var(--app-text-secondary); }
.info-val { color: var(--app-text-primary); }
.font-semibold { font-weight: 600; }

.balance-inline-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--app-surface-subtle);
  border-radius: 10px;
  padding: 10px 14px;
}

.balance-amt {
  font-size: 18px;
  font-weight: 700;
}

.charges-simple-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.charge-mini-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: var(--app-surface-subtle);
  border-radius: 8px;
}

.charge-mini-text {
  display: flex;
  flex-direction: column;
}

.charge-mini-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-primary);
}

.activity-card {
  padding: 0;
  overflow: hidden;
}

.activity-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
}

.row-border {
  border-bottom: 1px solid var(--app-border);
}

.activity-icon-wrap {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
  background: transparent;
}

.icon-present {
  color: var(--ion-color-success);
}

.icon-late {
  color: var(--ion-color-warning);
}

.icon-absent {
  color: var(--ion-color-danger);
}

.badge-present {
  background: rgba(21, 154, 116, 0.1);
  color: var(--ion-color-success);
}

.badge-late {
  background: rgba(217, 149, 34, 0.12);
  color: var(--ion-color-warning);
}

.badge-absent {
  background: rgba(220, 75, 75, 0.1);
  color: var(--ion-color-danger);
}

.activity-details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.activity-primary-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.activity-student-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-primary);
}

.activity-sub-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.activity-note {
  font-size: 11px;
  color: var(--app-text-secondary);
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
}

/* Activation Card & Officer Actions */
.activation-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.activation-actions-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--uni-border, rgba(0, 0, 0, 0.08));
}

.policy-hint-text {
  width: 100%;
  font-size: 12px;
  line-height: 1.4;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 6px;
  padding: 6px 10px;
  margin-bottom: 4px;
}

.audit-history-box {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--uni-surface-secondary, rgba(0, 0, 0, 0.03));
  border: 1px solid var(--uni-border, rgba(0, 0, 0, 0.08));
  border-radius: var(--uni-radius-btn, 10px);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.audit-records-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.audit-record-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
  border-bottom: 1px solid var(--uni-border, rgba(0, 0, 0, 0.04));
}

.audit-record-item:last-child {
  border-bottom: none;
}

.audit-action-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.audit-action-badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 4px;
}

.audit-issued {
  background: rgba(15, 118, 110, 0.12);
  color: var(--uni-primary, #0f766e);
}

.audit-reissued {
  background: rgba(217, 119, 6, 0.12);
  color: var(--uni-warning, #d97706);
}

.audit-claimed {
  background: rgba(16, 185, 129, 0.12);
  color: var(--uni-success, #10b981);
}

.audit-revoked, .audit-attempt_failed {
  background: rgba(239, 68, 68, 0.12);
  color: var(--uni-danger, #ef4444);
}

.audit-time {
  font-size: 11px;
  color: var(--uni-text-secondary, #64748b);
}

.audit-notes {
  font-size: 11px;
  color: var(--uni-text-secondary, #64748b);
}

/* Code Sheet Display */
.issued-code-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 0;
}

.code-security-alert {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  background: rgba(15, 118, 110, 0.08);
  border: 1px solid rgba(15, 118, 110, 0.2);
  border-radius: var(--uni-radius-card, 12px);
  color: var(--uni-text, #0f172a);
}

:global(.dark) .code-security-alert,
:global(.ion-palette-dark) .code-security-alert {
  background: rgba(94, 234, 212, 0.1);
  border-color: rgba(94, 234, 212, 0.25);
  color: var(--uni-text, #f8fafc);
}

.security-shield-icon {
  font-size: 24px;
  color: var(--uni-primary, #0f766e);
  flex-shrink: 0;
}

:global(.dark) .security-shield-icon,
:global(.ion-palette-dark) .security-shield-icon {
  color: var(--uni-primary, #5EEAD4);
}

.alert-desc strong {
  display: block;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 2px;
}

.alert-desc p {
  font-size: 12px;
  line-height: 1.4;
  margin: 0;
  color: var(--uni-text-secondary, #64748b);
}

.plaintext-code-box {
  background: var(--uni-surface-secondary, rgba(0, 0, 0, 0.04));
  border: 2px dashed var(--uni-primary, #0f766e);
  border-radius: var(--uni-radius-card, 14px);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
}

:global(.dark) .plaintext-code-box,
:global(.ion-palette-dark) .plaintext-code-box {
  border-color: var(--uni-primary, #5EEAD4);
}

.code-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--uni-text-secondary, #64748b);
}

.plaintext-code-display {
  font-size: clamp(20px, 6vw, 28px);
  font-weight: 800;
  letter-spacing: clamp(0.08em, 2vw, 0.2em);
  color: var(--uni-primary, #0f766e);
  user-select: all;
  word-break: break-all;
}

:global(.dark) .plaintext-code-display,
:global(.ion-palette-dark) .plaintext-code-display {
  color: var(--uni-primary, #5EEAD4);
}

.code-hint {
  font-size: 11px;
  color: var(--uni-text-secondary, #64748b);
}

.code-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}
</style>
