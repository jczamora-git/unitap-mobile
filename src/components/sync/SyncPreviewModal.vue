<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  IonIcon,
  IonSpinner,
} from '@ionic/vue';
import {
  closeCircleOutline,
  checkmarkCircleOutline,
  alertCircleOutline,
  searchOutline,
  chevronDownOutline,
  chevronUpOutline,
  syncOutline,
  shieldCheckmarkOutline,
  warningOutline,
} from 'ionicons/icons';
import {
  UniButton,
  UniStatusBadge,
  UniDialog,
} from '@/components/ui';
import type { PullPreviewPlan, ProposedStudentOperation } from '@/services/sync/pull-reconciliation.service';
import { haptics } from '@/utilities/haptics';

const props = defineProps<{
  isOpen: boolean;
  plan: PullPreviewPlan | null;
  isLoading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'approve', plan: PullPreviewPlan): void;
  (e: 'cancel'): void;
}>();

const activeFilter = ref<'ALL' | 'IDENTITY_MATCH' | 'UPDATE' | 'INSERT' | 'CONFLICT' | 'UNCHANGED'>('ALL');
const searchQuery = ref('');
const expandedRowId = ref<string | null>(null);
const showConfirmApproveDialog = ref(false);

const filteredOperations = computed(() => {
  if (!props.plan) return [];
  let list = props.plan.operations;

  // Filter by category
  if (activeFilter.value === 'IDENTITY_MATCH') {
    list = list.filter((op) => op.action === 'IDENTITY_MATCH_REVIEW');
  } else if (activeFilter.value === 'UPDATE') {
    list = list.filter((op) => op.action === 'UPDATE');
  } else if (activeFilter.value === 'INSERT') {
    list = list.filter((op) => op.action === 'INSERT');
  } else if (activeFilter.value === 'CONFLICT') {
    list = list.filter((op) => op.action === 'CONFLICT' || op.action === 'INVALID' || op.action === 'PENDING_LOCAL_CHANGE');
  } else if (activeFilter.value === 'UNCHANGED') {
    list = list.filter((op) => op.action === 'UNCHANGED');
  }

  // Filter by query
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (op) =>
        op.schoolId.toLowerCase().includes(q) ||
        op.canonicalSchoolId.toLowerCase().includes(q) ||
        op.studentName.toLowerCase().includes(q) ||
        (op.localSchoolId && op.localSchoolId.toLowerCase().includes(q))
    );
  }

  return list;
});

const approvedCount = computed(() => {
  if (!props.plan) return 0;
  return props.plan.operations.filter((op) => op.approved).length;
});

function toggleExpand(opId: string) {
  haptics.light();
  expandedRowId.value = expandedRowId.value === opId ? null : opId;
}

function toggleApproval(op: ProposedStudentOperation) {
  haptics.light();
  op.approved = !op.approved;
}

function handleConfirmApprove() {
  showConfirmApproveDialog.value = false;
  if (props.plan) {
    emit('approve', props.plan);
  }
}

function getBadgeVariant(action: string): 'active' | 'pending' | 'success' | 'danger' | 'warning' | 'neutral' {
  switch (action) {
    case 'INSERT':
      return 'success';
    case 'UPDATE':
      return 'active';
    case 'UNCHANGED':
      return 'neutral';
    case 'IDENTITY_MATCH_REVIEW':
      return 'warning';
    case 'PENDING_LOCAL_CHANGE':
      return 'pending';
    case 'CONFLICT':
    case 'INVALID':
      return 'danger';
    default:
      return 'neutral';
  }
}
</script>

<template>
  <div v-if="isOpen" class="sync-preview-overlay">
    <div class="sync-preview-modal" role="dialog" aria-modal="true">
      <!-- Modal Header -->
      <div class="modal-header">
        <div class="header-titles">
          <div class="title-row">
            <ion-icon :icon="syncOutline" class="title-icon" />
            <h2 class="title-text">Sync Preflight Preview</h2>
          </div>
          <p class="subtitle-text">
            Verify proposed operations before writing to local SQLite database. No data has been modified.
          </p>
        </div>
        <button type="button" class="close-btn" @click="$emit('cancel')">
          <ion-icon :icon="closeCircleOutline" />
        </button>
      </div>

      <!-- Loading State -->
      <div v-if="isLoading" class="preview-loading-state">
        <ion-spinner name="crescent" />
        <p>Analyzing remote records against local database...</p>
      </div>

      <!-- Plan Content -->
      <div v-else-if="plan" class="modal-body">
        <!-- Metric Cards Grid -->
        <div class="metrics-grid">
          <div class="metric-card">
            <span class="metric-label">Remote Records</span>
            <span class="metric-val">{{ plan.remoteCount }}</span>
            <span class="metric-sub">Authoritative server</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Local Records</span>
            <span class="metric-val">{{ plan.localCount }}</span>
            <span class="metric-sub">Current SQLite count</span>
          </div>
          <div class="metric-card metric-warning" v-if="plan.summary.identityMatches > 0">
            <span class="metric-label">Identity Matches</span>
            <span class="metric-val">{{ plan.summary.identityMatches }}</span>
            <span class="metric-sub">Probable duplicates to reconcile</span>
          </div>
          <div class="metric-card metric-info">
            <span class="metric-label">To Update</span>
            <span class="metric-val">{{ plan.summary.toUpdate }}</span>
            <span class="metric-sub">Existing with changes</span>
          </div>
          <div class="metric-card metric-success">
            <span class="metric-label">To Insert</span>
            <span class="metric-val">{{ plan.summary.toInsert }}</span>
            <span class="metric-sub">New students</span>
          </div>
          <div class="metric-card" v-if="plan.summary.unchanged > 0">
            <span class="metric-label">Unchanged</span>
            <span class="metric-val">{{ plan.summary.unchanged }}</span>
            <span class="metric-sub">Already in sync</span>
          </div>
        </div>

        <!-- Amber Warning Banner for Identity Matches -->
        <div v-if="plan.summary.identityMatches > 0" class="identity-match-banner">
          <ion-icon :icon="alertCircleOutline" class="banner-icon" />
          <div class="banner-text">
            <strong>{{ plan.summary.identityMatches }} Identity Reconciliation Candidate(s) Detected</strong>
            <p>
              Local records match server students by canonical School ID but have differing client-side UUIDs.
              Reconciliation will remap local child records to the authoritative server identity without data loss.
            </p>
          </div>
        </div>

        <!-- Filter Chips & Search Bar -->
        <div class="filter-controls">
          <div class="filter-chips">
            <button
              type="button"
              class="chip"
              :class="{ active: activeFilter === 'ALL' }"
              @click="activeFilter = 'ALL'"
            >
              All ({{ plan.operations.length }})
            </button>
            <button
              v-if="plan.summary.identityMatches > 0"
              type="button"
              class="chip chip-warning"
              :class="{ active: activeFilter === 'IDENTITY_MATCH' }"
              @click="activeFilter = 'IDENTITY_MATCH'"
            >
              Identity Matches ({{ plan.summary.identityMatches }})
            </button>
            <button
              v-if="plan.summary.toUpdate > 0"
              type="button"
              class="chip"
              :class="{ active: activeFilter === 'UPDATE' }"
              @click="activeFilter = 'UPDATE'"
            >
              Updates ({{ plan.summary.toUpdate }})
            </button>
            <button
              v-if="plan.summary.toInsert > 0"
              type="button"
              class="chip"
              :class="{ active: activeFilter === 'INSERT' }"
              @click="activeFilter = 'INSERT'"
            >
              Inserts ({{ plan.summary.toInsert }})
            </button>
            <button
              v-if="plan.summary.conflicts > 0"
              type="button"
              class="chip chip-danger"
              :class="{ active: activeFilter === 'CONFLICT' }"
              @click="activeFilter = 'CONFLICT'"
            >
              Conflicts ({{ plan.summary.conflicts }})
            </button>
            <button
              v-if="plan.summary.unchanged > 0"
              type="button"
              class="chip"
              :class="{ active: activeFilter === 'UNCHANGED' }"
              @click="activeFilter = 'UNCHANGED'"
            >
              Unchanged ({{ plan.summary.unchanged }})
            </button>
          </div>

          <div class="search-box">
            <ion-icon :icon="searchOutline" class="search-icon" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search by School ID or Name..."
              class="search-input"
            />
          </div>
        </div>

        <!-- Operations List -->
        <div class="operations-list">
          <div
            v-for="op in filteredOperations"
            :key="op.id"
            class="op-card"
            :class="{ expanded: expandedRowId === op.id }"
          >
            <div class="op-summary-row" @click="toggleExpand(op.id)">
              <div class="op-left">
                <input
                  type="checkbox"
                  :checked="op.approved"
                  :disabled="!op.isSafeToApply"
                  @click.stop="toggleApproval(op)"
                  class="op-checkbox"
                />
                <div class="op-id-info">
                  <div class="op-school-id font-mono">{{ op.canonicalSchoolId || op.schoolId }}</div>
                  <div class="op-name">{{ op.studentName }}</div>
                </div>
              </div>

              <div class="op-states">
                <div class="state-col">
                  <span class="state-tag-label">Local:</span>
                  <span class="state-val font-mono">{{ op.localState }}</span>
                </div>
                <div class="state-col">
                  <span class="state-tag-label">Remote:</span>
                  <span class="state-val font-mono">{{ op.remoteState }}</span>
                </div>
              </div>

              <div class="op-right">
                <UniStatusBadge :variant="getBadgeVariant(op.action)" size="sm">
                  {{ op.action.replace(/_/g, ' ') }}
                </UniStatusBadge>
                <ion-icon :icon="expandedRowId === op.id ? chevronUpOutline : chevronDownOutline" class="chevron-icon" />
              </div>
            </div>

            <!-- Expanded Details View -->
            <div v-if="expandedRowId === op.id" class="op-expanded-details">
              <div class="reason-row">
                <strong>Proposed Action:</strong> {{ op.reason }}
              </div>

              <div v-if="op.fieldDifferences.length > 0" class="diff-section">
                <div class="diff-title">Field Level Differences:</div>
                <div class="diff-table">
                  <div class="diff-header">
                    <span>Field</span>
                    <span>Local Value</span>
                    <span>Remote Value</span>
                  </div>
                  <div
                    v-for="d in op.fieldDifferences"
                    :key="d.field"
                    class="diff-row"
                  >
                    <span class="field-name font-mono">{{ d.field }}</span>
                    <span class="field-old font-mono">{{ d.localVal ?? 'null' }}</span>
                    <span class="field-new font-mono">{{ d.remoteVal ?? 'null' }}</span>
                  </div>
                </div>
              </div>

              <div class="op-uuid-compare font-mono">
                <div>Remote UUID: {{ op.remoteId }}</div>
                <div v-if="op.localId">Local UUID: {{ op.localId }}</div>
              </div>
            </div>
          </div>

          <div v-if="filteredOperations.length === 0" class="empty-filter">
            No records match the current filter or search criteria.
          </div>
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer">
        <UniButton variant="ghost" @click="$emit('cancel')">
          Cancel Pull
        </UniButton>

        <UniButton
          variant="primary"
          :disabled="approvedCount === 0 || isLoading"
          @click="showConfirmApproveDialog = true"
        >
          <ion-icon :icon="checkmarkCircleOutline" slot="start" />
          <span>Approve Safe Changes ({{ approvedCount }})</span>
        </UniButton>
      </div>
    </div>

    <!-- Safety Confirmation Dialog -->
    <UniDialog
      :is-open="showConfirmApproveDialog"
      title="Apply Synchronized Changes?"
      variant="warning"
      confirm-text="Confirm & Write to SQLite"
      cancel-text="Back to Review"
      @confirm="handleConfirmApprove"
      @cancel="showConfirmApproveDialog = false"
    >
      <p>
        You are about to commit <strong>{{ approvedCount }}</strong> operation(s) to the local SQLite database.
      </p>
      <p v-if="plan && plan.summary.identityMatches > 0" style="margin-top: 8px;">
        This includes reconciling <strong>{{ plan.summary.identityMatches }}</strong> duplicate School ID alias(es)
        to authoritative server UUIDs while preserving local enrollments and outbox operations.
      </p>
    </UniDialog>
  </div>
</template>

<style scoped>
.sync-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background-color: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.sync-preview-modal {
  background: var(--ion-background-color, #ffffff);
  border-radius: 16px;
  width: 100%;
  max-width: 900px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  border: 1px solid var(--ion-color-step-150, #e2e8f0);
}

.modal-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--ion-color-step-150, #e2e8f0);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  background: var(--ion-color-step-50, #f8fafc);
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title-icon {
  font-size: 24px;
  color: var(--ion-color-primary, #3b82f6);
}

.title-text {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--ion-text-color, #0f172a);
}

.subtitle-text {
  margin: 4px 0 0 0;
  font-size: 0.875rem;
  color: var(--ion-color-step-600, #64748b);
}

.close-btn {
  background: transparent;
  border: none;
  font-size: 28px;
  color: var(--ion-color-step-400, #94a3b8);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: var(--ion-text-color, #0f172a);
}

.modal-body {
  padding: 20px 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.preview-loading-state {
  padding: 48px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--ion-color-step-600, #64748b);
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
}

.metric-card {
  background: var(--ion-color-step-50, #f8fafc);
  border: 1px solid var(--ion-color-step-150, #e2e8f0);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
}

.metric-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ion-color-step-500, #64748b);
}

.metric-val {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--ion-text-color, #0f172a);
  margin: 4px 0;
}

.metric-sub {
  font-size: 0.7rem;
  color: var(--ion-color-step-400, #94a3b8);
}

.metric-warning {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.08);
}

.metric-warning .metric-val {
  color: #b45309;
}

.metric-info {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.08);
}

.metric-info .metric-val {
  color: #1d4ed8;
}

.metric-success {
  border-color: #10b981;
  background: rgba(16, 185, 129, 0.08);
}

.metric-success .metric-val {
  color: #047857;
}

.identity-match-banner {
  background: #fffbeb;
  border: 1px solid #fef3c7;
  border-left: 4px solid #f59e0b;
  border-radius: 8px;
  padding: 12px 16px;
  display: flex;
  gap: 12px;
  color: #92400e;
}

.banner-icon {
  font-size: 24px;
  flex-shrink: 0;
  color: #d97706;
}

.banner-text strong {
  display: block;
  font-size: 0.875rem;
  margin-bottom: 2px;
}

.banner-text p {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.filter-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  background: var(--ion-color-step-100, #f1f5f9);
  border: 1px solid var(--ion-color-step-200, #e2e8f0);
  border-radius: 20px;
  padding: 6px 12px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--ion-color-step-700, #334155);
  cursor: pointer;
}

.chip.active {
  background: var(--ion-color-primary, #3b82f6);
  color: #ffffff;
  border-color: var(--ion-color-primary, #3b82f6);
}

.chip-warning.active {
  background: #d97706;
  border-color: #d97706;
}

.chip-danger.active {
  background: #dc2626;
  border-color: #dc2626;
}

.search-box {
  position: relative;
  min-width: 260px;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ion-color-step-400, #94a3b8);
  font-size: 16px;
}

.search-input {
  width: 100%;
  padding: 6px 12px 6px 32px;
  border-radius: 8px;
  border: 1px solid var(--ion-color-step-200, #e2e8f0);
  font-size: 0.8125rem;
  background: var(--ion-background-color, #ffffff);
  color: var(--ion-text-color, #0f172a);
}

.operations-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--ion-color-step-150, #e2e8f0);
  border-radius: 12px;
  padding: 8px;
}

.op-card {
  border: 1px solid var(--ion-color-step-150, #e2e8f0);
  border-radius: 8px;
  background: var(--ion-background-color, #ffffff);
  transition: all 0.15s ease;
}

.op-card:hover {
  border-color: var(--ion-color-step-300, #cbd5e1);
}

.op-summary-row {
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  gap: 12px;
}

.op-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 200px;
}

.op-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.op-school-id {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--ion-text-color, #0f172a);
}

.op-name {
  font-size: 0.8125rem;
  color: var(--ion-color-step-600, #475569);
}

.op-states {
  display: flex;
  gap: 20px;
  flex: 1;
}

.state-col {
  display: flex;
  flex-direction: column;
  font-size: 0.75rem;
}

.state-tag-label {
  font-weight: 600;
  color: var(--ion-color-step-500, #64748b);
}

.state-val {
  color: var(--ion-text-color, #0f172a);
}

.op-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chevron-icon {
  font-size: 16px;
  color: var(--ion-color-step-400, #94a3b8);
}

.op-expanded-details {
  border-top: 1px dashed var(--ion-color-step-150, #e2e8f0);
  padding: 12px 14px;
  background: var(--ion-color-step-50, #f8fafc);
  font-size: 0.8125rem;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.diff-section {
  margin-top: 4px;
}

.diff-title {
  font-weight: 600;
  margin-bottom: 4px;
}

.diff-table {
  background: var(--ion-background-color, #ffffff);
  border: 1px solid var(--ion-color-step-200, #e2e8f0);
  border-radius: 6px;
  overflow: hidden;
}

.diff-header {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  padding: 6px 10px;
  background: var(--ion-color-step-100, #f1f5f9);
  font-weight: 600;
  font-size: 0.75rem;
}

.diff-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  padding: 6px 10px;
  border-top: 1px solid var(--ion-color-step-150, #e2e8f0);
  font-size: 0.75rem;
}

.field-old {
  color: #dc2626;
}

.field-new {
  color: #16a34a;
}

.op-uuid-compare {
  font-size: 0.75rem;
  color: var(--ion-color-step-500, #64748b);
  display: flex;
  gap: 16px;
}

.empty-filter {
  padding: 32px;
  text-align: center;
  color: var(--ion-color-step-400, #94a3b8);
  font-size: 0.875rem;
}

.modal-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--ion-color-step-150, #e2e8f0);
  background: var(--ion-color-step-50, #f8fafc);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>

