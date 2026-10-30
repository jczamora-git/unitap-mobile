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
  walletOutline,
  receiptOutline,
  calendarOutline,
  alertCircleOutline,
  addOutline
} from 'ionicons/icons';
import { useStudents } from '@/composables/useStudents';
import { useToast } from '@/composables/useToast';
import { financeService } from '@/services/finance.service';
import { attendanceService } from '@/services/attendance.service';
import { formatFullName, formatStudentAcademicSummary, formatYearLevel } from '@/utilities/student-formatters';
import { formatPeso } from '@/utilities/finance-formatters';
import { formatDate, formatTime } from '@/utilities/date-formatters';
import type { StudentCharge, WalletTransaction } from '@/types/finance';
import EditStudentModal from '@/components/EditStudentModal.vue';
import ReplaceRfidModal from '@/components/ReplaceRfidModal.vue';
import { 
  UniPageHeader, 
  UniSegmentedControl, 
  UniDialog,
  UniButton
} from '@/components/ui';

const route = useRoute();
const router = useRouter();
const { getStudentById, deleteStudent, removeRfid, currentStudent, isLoading } = useStudents();
const { showToast, copyToClipboard } = useToast();

const isEditModalOpen = ref(false);
const isReplaceModalOpen = ref(false);
const activeTab = ref<'OVERVIEW' | 'ATTENDANCE' | 'FINANCE'>('OVERVIEW');

// Financial context
const walletBalanceCentavos = ref(0);
const studentCharges = ref<StudentCharge[]>([]);
const studentTxns = ref<WalletTransaction[]>([]);

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
  if (id) {
    await getStudentById(id);
    if (currentStudent.value) {
      walletBalanceCentavos.value = await financeService.calculateWalletBalance(id);
      studentCharges.value = await financeService.getCharges(id);
      studentTxns.value = await financeService.getStudentTransactions(id);
      attendanceHistory.value = await attendanceService.getStudentAttendanceHistory(id);
    }
  }
}

onMounted(loadProfile);
onIonViewWillEnter(loadProfile);

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

              <!-- Actions Row -->
              <div class="card-actions-row">
                <button 
                  class="action-subtle-btn"
                  @click="isReplaceModalOpen = true"
                >
                  <ion-icon :icon="swapHorizontalOutline" />
                  {{ currentStudent.rfidUid ? 'Replace NFC Card' : 'Link NFC Card' }}
                </button>

                <button 
                  v-if="currentStudent.rfidUid" 
                  class="action-subtle-btn text-danger"
                  @click="showRemoveRfidDialog = true"
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
                <button class="edit-link-btn" @click="isEditModalOpen = true">
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

          <!-- TAB 3: FINANCE & WALLET -->
          <template v-if="activeTab === 'FINANCE'">
            <!-- Wallet Summary Card -->
            <div class="minimal-card overview-card">
              <div class="card-head-row">
                <div class="head-lead">
                  <ion-icon :icon="walletOutline" class="head-icon text-primary" />
                  <span class="card-title-text">Simulated Wallet</span>
                </div>
                <button 
                  class="action-subtle-btn"
                  @click="router.push(`/finance/wallet/${currentStudent.id}`)"
                >
                  Manage Wallet
                </button>
              </div>

              <div class="balance-inline-box">
                <span class="secondary-text">Available Credits</span>
                <span class="balance-amt text-primary font-mono tabular-nums">{{ formatPeso(walletBalanceCentavos) }}</span>
              </div>
            </div>

            <!-- Student Charges Card -->
            <div class="minimal-card overview-card">
              <div class="card-head-row">
                <span class="card-title-text">Fee Obligations</span>
                <button 
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
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.icon-present, .badge-present {
  background: rgba(21, 154, 116, 0.1);
  color: var(--ion-color-success);
}

.icon-late, .badge-late {
  background: rgba(217, 149, 34, 0.12);
  color: var(--ion-color-warning);
}

.icon-absent, .badge-absent {
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
</style>
