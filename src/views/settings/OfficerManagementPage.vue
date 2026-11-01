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
  addOutline,
  searchOutline,
  shieldCheckmarkOutline,
  keyOutline,
  refreshOutline,
  closeCircleOutline,
  pauseCircleOutline,
  playCircleOutline,
  createOutline,
  copyOutline,
  checkmarkOutline,
  peopleOutline,
} from 'ionicons/icons';
import {
  UniPageHeader,
  UniButton,
  UniStatusBadge,
  UniExpandableRow,
  UniSheet,
  UniDialog,
} from '@/components/ui';
import {
  OfficerManagementService,
} from '@/services/officer-management.service';
import type { OfficerPermissionPreset } from '@/types/database';
import type { OfficerListRecord } from '@/database/repositories/officer.repository';
import { haptics } from '@/utilities/haptics';
import { useToast } from '@/composables/useToast';

const router = useRouter();
const { showToast } = useToast();

const isLoading = ref(true);
const officers = ref<OfficerListRecord[]>([]);
const searchQuery = ref('');
const activeTab = ref<'ALL' | 'ACTIVE' | 'PENDING' | 'INACTIVE'>('ALL');

// Copy feedback
const copiedCodeId = ref<string | null>(null);

// Dialogs & Sheets state
const selectedOfficer = ref<OfficerListRecord | null>(null);
const isSuspendDialogOpen = ref(false);
const isRevokeDialogOpen = ref(false);
const isCancelInviteDialogOpen = ref(false);
const isEditPermSheetOpen = ref(false);
const isEditApptSheetOpen = ref(false);
const isProcessing = ref(false);

// Edit permissions form
const editPreset = ref<OfficerPermissionPreset>('FULL');
const editCustomPerms = ref<string[]>([]);

// Edit appointment form
const editStartDate = ref('');
const editEndDate = ref('');

async function loadOfficers() {
  isLoading.value = true;
  try {
    officers.value = await OfficerManagementService.getOfficers();
  } catch (err: unknown) {
    console.error('Failed to load officers:', err);
    await showToast('Failed to load officers list', 'error');
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadOfficers);

const filteredOfficers = computed(() => {
  let list = officers.value;

  // Filter by tab
  if (activeTab.value === 'ACTIVE') {
    list = list.filter((o) => o.status === 'ACTIVE');
  } else if (activeTab.value === 'PENDING') {
    list = list.filter((o) => o.status === 'PENDING');
  } else if (activeTab.value === 'INACTIVE') {
    list = list.filter((o) => o.status === 'SUSPENDED' || o.status === 'REVOKED');
  }

  // Filter by search query
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase();
    list = list.filter(
      (o) =>
        o.full_name.toLowerCase().includes(q) ||
        o.email.toLowerCase().includes(q) ||
        (o.school_id && o.school_id.toLowerCase().includes(q))
    );
  }

  return list;
});

const counts = computed(() => {
  return {
    all: officers.value.length,
    active: officers.value.filter((o) => o.status === 'ACTIVE').length,
    pending: officers.value.filter((o) => o.status === 'PENDING').length,
    inactive: officers.value.filter((o) => o.status === 'SUSPENDED' || o.status === 'REVOKED').length,
  };
});

function handleOpenCreate() {
  haptics.light();
  router.push('/settings/system-setup/officers/create');
}

async function copyInvitationCode(code: string, id: string) {
  try {
    await navigator.clipboard.writeText(code);
    copiedCodeId.value = id;
    haptics.success();
    await showToast('Code copied to clipboard', 'success');
    setTimeout(() => {
      if (copiedCodeId.value === id) copiedCodeId.value = null;
    }, 2000);
  } catch {
    await showToast(code, 'info');
  }
}

// Suspend
function promptSuspend(officer: OfficerListRecord) {
  selectedOfficer.value = officer;
  isSuspendDialogOpen.value = true;
}

async function confirmSuspend() {
  if (!selectedOfficer.value) return;
  isProcessing.value = true;
  try {
    await OfficerManagementService.suspendOfficer(selectedOfficer.value.id);
    haptics.medium();
    await showToast(`${selectedOfficer.value.full_name} suspended`, 'warning');
    await loadOfficers();
  } catch (err: unknown) {
    await showToast((err as Error).message || 'Failed to suspend officer', 'error');
  } finally {
    isProcessing.value = false;
    isSuspendDialogOpen.value = false;
  }
}

// Reactivate Suspended
async function handleReactivate(officer: OfficerListRecord) {
  isProcessing.value = true;
  try {
    await OfficerManagementService.updateAppointment(officer.id, {});
    // Direct repo reactivate
    const { OfficerRepository } = await import('@/database/repositories/officer.repository');
    await OfficerRepository.updateAppointment(officer.id, { status: 'ACTIVE', suspended_at: null });
    haptics.success();
    await showToast(`${officer.full_name} reactivated`, 'success');
    await loadOfficers();
  } catch (err: unknown) {
    await showToast((err as Error).message || 'Failed to reactivate officer', 'error');
  } finally {
    isProcessing.value = false;
  }
}

// Revoke
function promptRevoke(officer: OfficerListRecord) {
  selectedOfficer.value = officer;
  isRevokeDialogOpen.value = true;
}

async function confirmRevoke() {
  if (!selectedOfficer.value) return;
  isProcessing.value = true;
  try {
    await OfficerManagementService.revokeOfficer(selectedOfficer.value.id);
    haptics.error();
    await showToast(`Officer privileges revoked for ${selectedOfficer.value.full_name}`, 'warning');
    await loadOfficers();
  } catch (err: unknown) {
    await showToast((err as Error).message || 'Failed to revoke officer', 'error');
  } finally {
    isProcessing.value = false;
    isRevokeDialogOpen.value = false;
  }
}

// Resend Invitation
async function handleResendInvitation(officer: OfficerListRecord) {
  isProcessing.value = true;
  try {
    const res = await OfficerManagementService.resendInvitation(officer.id);
    if (res.success) {
      haptics.success();
      await showToast(`New code generated: ${res.code}`, 'success');
      await loadOfficers();
    }
  } catch (err: unknown) {
    await showToast((err as Error).message || 'Failed to refresh invitation', 'error');
  } finally {
    isProcessing.value = false;
  }
}

// Cancel Invitation
function promptCancelInvite(officer: OfficerListRecord) {
  selectedOfficer.value = officer;
  isCancelInviteDialogOpen.value = true;
}

async function confirmCancelInvite() {
  if (!selectedOfficer.value) return;
  isProcessing.value = true;
  try {
    await OfficerManagementService.cancelInvitation(selectedOfficer.value.id);
    haptics.light();
    await showToast('Invitation cancelled', 'info');
    await loadOfficers();
  } catch (err: unknown) {
    await showToast((err as Error).message || 'Failed to cancel invitation', 'error');
  } finally {
    isProcessing.value = false;
    isCancelInviteDialogOpen.value = false;
  }
}

// Edit Permissions
function openEditPermissions(officer: OfficerListRecord) {
  selectedOfficer.value = officer;
  editPreset.value = officer.permission_preset;
  try {
    editCustomPerms.value = JSON.parse(officer.custom_permissions_json || '[]');
  } catch {
    editCustomPerms.value = [];
  }
  isEditPermSheetOpen.value = true;
}

async function savePermissions() {
  if (!selectedOfficer.value) return;
  isProcessing.value = true;
  try {
    await OfficerManagementService.updatePermissions(
      selectedOfficer.value.id,
      editPreset.value,
      editPreset.value === 'CUSTOM' ? editCustomPerms.value : undefined
    );
    haptics.success();
    await showToast('Officer permissions updated', 'success');
    isEditPermSheetOpen.value = false;
    await loadOfficers();
  } catch (err: unknown) {
    await showToast((err as Error).message || 'Failed to update permissions', 'error');
  } finally {
    isProcessing.value = false;
  }
}

// Edit Appointment
function openEditAppointment(officer: OfficerListRecord) {
  selectedOfficer.value = officer;
  editStartDate.value = officer.appointment_start?.substring(0, 10) || '';
  editEndDate.value = officer.appointment_end?.substring(0, 10) || '';
  isEditApptSheetOpen.value = true;
}

async function saveAppointment() {
  if (!selectedOfficer.value) return;
  isProcessing.value = true;
  try {
    await OfficerManagementService.updateAppointment(selectedOfficer.value.id, {
      startDate: editStartDate.value,
      endDate: editEndDate.value,
    });
    haptics.success();
    await showToast('Appointment schedule updated', 'success');
    isEditApptSheetOpen.value = false;
    await loadOfficers();
  } catch (err: unknown) {
    await showToast((err as Error).message || 'Failed to update appointment', 'error');
  } finally {
    isProcessing.value = false;
  }
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Officer Management"
      subtitle="Authorize, configure, and monitor operational officers"
      :back-button="true"
      default-back-href="/settings/system-setup"
    >
      <template #trailing>
        <UniButton size="sm" variant="primary" @click="handleOpenCreate">
          <ion-icon :icon="addOutline" slot="start" />
          <span>New</span>
        </UniButton>
      </template>
    </UniPageHeader>

    <ion-content class="officers-content">
      <div class="page-container">
        <!-- Search and Filter Bar -->
        <div class="toolbar-box minimal-card">
          <div class="search-input-wrap">
            <ion-icon :icon="searchOutline" class="search-icon" />
            <input
              v-model="searchQuery"
              type="text"
              class="search-input"
              placeholder="Search by name, email, or school ID..."
            />
            <button
              v-if="searchQuery"
              class="clear-search-btn"
              @click="searchQuery = ''"
            >
              &times;
            </button>
          </div>

          <!-- Segment Tabs -->
          <div class="tab-strip">
            <button
              type="button"
              class="tab-btn"
              :class="{ 'is-active': activeTab === 'ALL' }"
              @click="activeTab = 'ALL'"
            >
              All ({{ counts.all }})
            </button>
            <button
              type="button"
              class="tab-btn"
              :class="{ 'is-active': activeTab === 'ACTIVE' }"
              @click="activeTab = 'ACTIVE'"
            >
              Active ({{ counts.active }})
            </button>
            <button
              type="button"
              class="tab-btn"
              :class="{ 'is-active': activeTab === 'PENDING' }"
              @click="activeTab = 'PENDING'"
            >
              Pending ({{ counts.pending }})
            </button>
            <button
              type="button"
              class="tab-btn"
              :class="{ 'is-active': activeTab === 'INACTIVE' }"
              @click="activeTab = 'INACTIVE'"
            >
              Inactive ({{ counts.inactive }})
            </button>
          </div>
        </div>

        <!-- Pending Banner if any -->
        <div v-if="counts.pending > 0 && activeTab !== 'PENDING'" class="pending-alert-banner">
          <ion-icon :icon="keyOutline" class="alert-icon" />
          <div class="alert-text">
            <strong>{{ counts.pending }} Pending Invitation(s)</strong>
            <span>Officers must verify activation code to complete enrollment.</span>
          </div>
          <button class="alert-link-btn" @click="activeTab = 'PENDING'">
            View Pending
          </button>
        </div>

        <!-- Officers List -->
        <div v-if="isLoading" class="loading-state">
          <ion-spinner name="crescent" />
          <span>Loading officers directory...</span>
        </div>

        <div v-else-if="filteredOfficers.length === 0" class="empty-state minimal-card">
          <ion-icon :icon="peopleOutline" class="empty-icon" />
          <div class="empty-title">No officers found</div>
          <p class="empty-desc">
            {{ searchQuery ? 'No records match your search criteria.' : 'No officers currently registered in this view.' }}
          </p>
          <UniButton size="sm" variant="outline" @click="handleOpenCreate">
            <ion-icon :icon="addOutline" slot="start" />
            <span>Create First Officer</span>
          </UniButton>
        </div>

        <div v-else class="officers-list-flow">
          <UniExpandableRow
            v-for="officer in filteredOfficers"
            :key="officer.id"
            :title="officer.full_name"
            :subtitle="officer.email"
            :icon="shieldCheckmarkOutline"
          >
            <template #badge>
              <div class="badge-row">
                <UniStatusBadge
                  :variant="
                    officer.status === 'ACTIVE' ? 'success' :
                    officer.status === 'PENDING' ? 'warning' : 'danger'
                  "
                >
                  {{ officer.status }}
                </UniStatusBadge>
                <UniStatusBadge variant="neutral">
                  {{ officer.permission_preset }}
                </UniStatusBadge>
              </div>
            </template>

            <!-- Expanded Body Details -->
            <div class="officer-detail-body">
              <div class="detail-grid">
                <div v-if="officer.school_id" class="detail-item">
                  <span class="detail-label">Linked Student ID</span>
                  <span class="detail-val font-mono">{{ officer.school_id }}</span>
                </div>

                <div class="detail-item">
                  <span class="detail-label">Appointment Scope</span>
                  <span class="detail-val">{{ officer.scope_type }}</span>
                </div>

                <div class="detail-item">
                  <span class="detail-label">Validity Period</span>
                  <span class="detail-val font-mono">
                    {{ officer.appointment_start?.substring(0, 10) }} to {{ officer.appointment_end?.substring(0, 10) }}
                  </span>
                </div>

                <div class="detail-item">
                  <span class="detail-label">Authorization Preset</span>
                  <span class="detail-val">{{ officer.permission_preset }} Officer</span>
                </div>
              </div>

              <!-- Pending Activation Display -->
              <div v-if="officer.status === 'PENDING' && officer.invitation_code" class="pending-activation-card">
                <div class="pending-code-info">
                  <span class="code-eyebrow">Activation / Claim Code</span>
                  <div class="code-number-row">
                    <span class="font-mono code-digits">{{ officer.invitation_code }}</span>
                    <button
                      type="button"
                      class="copy-code-btn"
                      @click="copyInvitationCode(officer.invitation_code!, officer.id)"
                    >
                      <ion-icon :icon="copiedCodeId === officer.id ? checkmarkOutline : copyOutline" />
                      <span>{{ copiedCodeId === officer.id ? 'Copied' : 'Copy' }}</span>
                    </button>
                  </div>
                  <span class="code-hint">Provide this 8-character single-use code to the candidate.</span>
                </div>
              </div>

              <!-- Action Buttons -->
              <div class="officer-actions-footer">
                <UniButton
                  size="sm"
                  variant="outline"
                  @click="openEditPermissions(officer)"
                >
                  <ion-icon :icon="keyOutline" slot="start" />
                  <span>Permissions</span>
                </UniButton>

                <UniButton
                  size="sm"
                  variant="outline"
                  @click="openEditAppointment(officer)"
                >
                  <ion-icon :icon="createOutline" slot="start" />
                  <span>Schedule</span>
                </UniButton>

                <UniButton
                  v-if="officer.status === 'ACTIVE'"
                  size="sm"
                  variant="secondary"
                  @click="promptSuspend(officer)"
                >
                  <ion-icon :icon="pauseCircleOutline" slot="start" />
                  <span>Suspend</span>
                </UniButton>

                <UniButton
                  v-else-if="officer.status === 'SUSPENDED'"
                  size="sm"
                  variant="primary"
                  @click="handleReactivate(officer)"
                >
                  <ion-icon :icon="playCircleOutline" slot="start" />
                  <span>Reactivate</span>
                </UniButton>

                <UniButton
                  v-if="officer.status === 'PENDING'"
                  size="sm"
                  variant="outline"
                  @click="handleResendInvitation(officer)"
                >
                  <ion-icon :icon="refreshOutline" slot="start" />
                  <span>New Code</span>
                </UniButton>

                <UniButton
                  v-if="officer.status === 'PENDING'"
                  size="sm"
                  variant="destructive"
                  @click="promptCancelInvite(officer)"
                >
                  <ion-icon :icon="closeCircleOutline" slot="start" />
                  <span>Cancel</span>
                </UniButton>

                <UniButton
                  v-if="officer.status !== 'REVOKED'"
                  size="sm"
                  variant="destructive"
                  @click="promptRevoke(officer)"
                >
                  <ion-icon :icon="closeCircleOutline" slot="start" />
                  <span>Revoke</span>
                </UniButton>
              </div>
            </div>
          </UniExpandableRow>
        </div>
      </div>
    </ion-content>

    <!-- Dialog: Suspend Officer -->
    <UniDialog
      :is-open="isSuspendDialogOpen"
      title="Suspend Officer Privileges?"
      :description="`Temporarily pause operational access for ${selectedOfficer?.full_name}. Their historical records and student identity remain intact.`"
      type="warning"
      confirm-text="Suspend Officer"
      cancel-text="Keep Active"
      @confirm="confirmSuspend"
      @cancel="isSuspendDialogOpen = false"
      @close="isSuspendDialogOpen = false"
    />

    <!-- Dialog: Revoke Officer -->
    <UniDialog
      :is-open="isRevokeDialogOpen"
      title="Revoke Officer Access?"
      :description="`Revoking ${selectedOfficer?.full_name} will permanently remove Officer role privileges. The student profile and historical audits will NOT be deleted.`"
      type="destructive"
      confirm-text="Revoke Access"
      cancel-text="Cancel"
      @confirm="confirmRevoke"
      @cancel="isRevokeDialogOpen = false"
      @close="isRevokeDialogOpen = false"
    />

    <!-- Dialog: Cancel Invitation -->
    <UniDialog
      :is-open="isCancelInviteDialogOpen"
      title="Cancel Pending Invitation?"
      :description="`The activation code for ${selectedOfficer?.full_name} will be invalidated immediately.`"
      type="destructive"
      confirm-text="Invalidate Invitation"
      cancel-text="Back"
      @confirm="confirmCancelInvite"
      @cancel="isCancelInviteDialogOpen = false"
      @close="isCancelInviteDialogOpen = false"
    />

    <!-- Sheet: Edit Permissions -->
    <UniSheet
      v-model:open="isEditPermSheetOpen"
      title="Edit Officer Permissions"
      :subtitle="selectedOfficer?.full_name"
    >
      <div class="sheet-form-content">
        <label class="form-label">Permission Preset</label>
        <div class="preset-options-grid">
          <div
            class="preset-choice-card"
            :class="{ 'is-selected': editPreset === 'ATTENDANCE' }"
            @click="editPreset = 'ATTENDANCE'"
          >
            <div class="choice-title">Attendance Officer</div>
            <div class="choice-desc">NFC check-in, attendance confirmations, absentees list.</div>
          </div>

          <div
            class="preset-choice-card"
            :class="{ 'is-selected': editPreset === 'FINANCE' }"
            @click="editPreset = 'FINANCE'"
          >
            <div class="choice-title">Finance Officer</div>
            <div class="choice-desc">Dues, collections, fines, rapid NFC payment.</div>
          </div>

          <div
            class="preset-choice-card"
            :class="{ 'is-selected': editPreset === 'FULL' }"
            @click="editPreset = 'FULL'"
          >
            <div class="choice-title">Full Officer</div>
            <div class="choice-desc">Complete organizational operational authority.</div>
          </div>
        </div>
      </div>

      <template #footer>
        <UniButton variant="outline" @click="isEditPermSheetOpen = false">Cancel</UniButton>
        <UniButton variant="primary" :disabled="isProcessing" @click="savePermissions">
          Save Permissions
        </UniButton>
      </template>
    </UniSheet>

    <!-- Sheet: Edit Appointment Dates -->
    <UniSheet
      v-model:open="isEditApptSheetOpen"
      title="Edit Appointment Schedule"
      :subtitle="selectedOfficer?.full_name"
    >
      <div class="sheet-form-content">
        <div class="form-group">
          <label class="form-label">Appointment Start Date</label>
          <input v-model="editStartDate" type="date" class="form-input" />
        </div>

        <div class="form-group">
          <label class="form-label">Appointment End Date</label>
          <input v-model="editEndDate" type="date" class="form-input" />
        </div>
      </div>

      <template #footer>
        <UniButton variant="outline" @click="isEditApptSheetOpen = false">Cancel</UniButton>
        <UniButton variant="primary" :disabled="isProcessing" @click="saveAppointment">
          Update Schedule
        </UniButton>
      </template>
    </UniSheet>
  </ion-page>
</template>

<style scoped>
.officers-content {
  --background: var(--uni-background, #f8fafc);
}

.page-container {
  max-width: 720px;
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

.toolbar-box {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.search-input-wrap {
  display: flex;
  align-items: center;
  background: var(--uni-surface-secondary, #f1f5f9);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 10px;
  padding: 0 12px;
  height: 40px;
}

.search-icon {
  font-size: 16px;
  color: var(--uni-text-secondary, #64748b);
  margin-right: 8px;
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 13.5px;
  color: var(--uni-text, #0f172a);
}

.clear-search-btn {
  background: transparent;
  border: none;
  font-size: 18px;
  color: var(--uni-text-secondary, #64748b);
  cursor: pointer;
}

.tab-strip {
  display: flex;
  gap: 4px;
  background: var(--uni-surface-secondary, #f1f5f9);
  padding: 3px;
  border-radius: 10px;
  overflow-x: auto;
}

.tab-btn {
  flex: 1;
  min-width: 70px;
  padding: 6px 10px;
  border-radius: 8px;
  border: none;
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  color: var(--uni-text-secondary, #64748b);
  cursor: pointer;
  white-space: nowrap;
}

.tab-btn.is-active {
  background: var(--uni-surface, #ffffff);
  color: var(--uni-primary, #0f766e);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.pending-alert-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(217, 149, 34, 0.12);
  border: 1px solid rgba(217, 149, 34, 0.25);
}

.alert-icon {
  font-size: 20px;
  color: #d97706;
}

.alert-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--uni-text, #0f172a);
}

.alert-link-btn {
  background: #d97706;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.officers-list-flow {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.badge-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.officer-detail-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  padding: 10px;
  background: var(--uni-surface, #ffffff);
  border-radius: 10px;
  border: 1px solid var(--uni-border, #e2e8f0);
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-label {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--uni-text-secondary, #64748b);
  letter-spacing: 0.05em;
}

.detail-val {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--uni-text, #0f172a);
}

.pending-activation-card {
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(15, 118, 110, 0.08);
  border: 1px dashed var(--uni-primary, #0f766e);
}

.pending-code-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.code-eyebrow {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--uni-primary, #0f766e);
  text-transform: uppercase;
}

.code-number-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.code-digits {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.15em;
  color: var(--uni-primary, #0f766e);
}

.copy-code-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--uni-primary, #0f766e);
  background: var(--uni-surface, #ffffff);
  color: var(--uni-primary, #0f766e);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.code-hint {
  font-size: 11px;
  color: var(--uni-text-secondary, #64748b);
}

.officer-actions-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 4px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  gap: 10px;
}

.empty-icon {
  font-size: 40px;
  color: var(--uni-text-secondary, #64748b);
  opacity: 0.5;
}

.empty-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
}

.empty-desc {
  font-size: 13px;
  color: var(--uni-text-secondary, #64748b);
  margin: 0 0 8px 0;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
  gap: 10px;
  color: var(--uni-text-secondary, #64748b);
}

.sheet-form-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--uni-text-secondary, #64748b);
}

.form-input {
  height: 42px;
  padding: 0 12px;
  background: var(--uni-surface-secondary, #f1f5f9);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 10px;
  font-size: 13.5px;
  color: var(--uni-text, #0f172a);
  outline: none;
}

.preset-options-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preset-choice-card {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1.5px solid var(--uni-border, #e2e8f0);
  background: var(--uni-surface, #ffffff);
  cursor: pointer;
  transition: all 0.16s ease;
}

.preset-choice-card.is-selected {
  border-color: var(--uni-primary, #0f766e);
  background: rgba(15, 118, 110, 0.05);
}

.choice-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--uni-text, #0f172a);
}

.choice-desc {
  font-size: 12px;
  color: var(--uni-text-secondary, #64748b);
  margin-top: 2px;
}

:global(.dark) .officers-content {
  --background: var(--uni-background, #0f1117);
}

:global(.dark) .minimal-card {
  background: var(--uni-surface, #1b1d23);
  border-color: var(--uni-border, #30343d);
}

:global(.dark) .search-input-wrap,
:global(.dark) .tab-strip,
:global(.dark) .detail-grid,
:global(.dark) .form-input {
  background: var(--uni-surface-secondary, #252830);
  border-color: var(--uni-border, #30343d);
}

:global(.dark) .tab-btn.is-active {
  background: var(--uni-surface, #1b1d23);
  color: var(--uni-primary, #5eead4);
}

:global(.dark) .preset-choice-card {
  background: var(--uni-surface, #1b1d23);
  border-color: var(--uni-border, #30343d);
}

:global(.dark) .preset-choice-card.is-selected {
  border-color: var(--uni-primary, #5eead4);
  background: rgba(94, 234, 212, 0.08);
}
</style>
