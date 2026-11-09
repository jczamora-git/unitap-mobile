<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  IonSpinner
} from '@ionic/vue';
import {
  hardwareChipOutline,
  trashOutline,
  cloudDownloadOutline,
  checkmarkCircle,
  chevronForwardOutline,
  sparklesOutline,
  colorPaletteOutline,
  personCircleOutline,
  schoolOutline,
  syncOutline,
  logOutOutline,
  notificationsOutline,
  informationCircleOutline,
  shieldCheckmarkOutline,
  constructOutline,
  cloudUploadOutline,
  optionsOutline,
  refreshOutline,
  alertCircleOutline,
  chevronDownOutline,
  gitCompareOutline,
  listOutline,
  repeatOutline,
  searchOutline,
  documentTextOutline
} from 'ionicons/icons';
import { useNfc } from '@/composables/useNfc';
import { useOnboarding } from '@/composables/useOnboarding';
import { useTheme, type ThemePreference } from '@/composables/useTheme';
import { useSyncPreferences } from '@/composables/useSyncPreferences';
import { useToast } from '@/composables/useToast';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { clearLocalDatabase, getDatabase } from '@/database/database';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import type { Semester, AcademicYear, SyncOutboxRecord } from '@/types/database';
import { demoDataService } from '@/services/demo-data.service';
import { NetworkService } from '@/services/network.service';
import { DataModeService } from '@/services/data-mode.service';
import { SyncStatusService } from '@/services/sync/sync-status.service';
import { SyncManager } from '@/services/sync/sync-manager';
import { EntityCheckpointService, type EntitySyncCheckpoint } from '@/services/sync/entity-checkpoint.service';
import {
  SyncAuditLogService,
  type SyncAuditLogRecord,
  type SyncAuditLogStats,
  type SyncAuditLogDirection,
  type SyncAuditLogStatus,
} from '@/services/sync/sync-audit-log.service';
import {
  SyncReconciliationService,
  type GlobalReconciliationReport,
  type EntityReconciliationReport,
} from '@/services/sync/sync-reconciliation.service';
import {
  formatUserRole,
  formatAcademicPeriod,
} from '@/utilities/presentation-formatters';
import { UniPageHeader, UniDialog, UniSegmentedControl, UniButton, UniSheet } from '@/components/ui';
import WorkspaceSwitcher from '@/components/shared/WorkspaceSwitcher.vue';
import SyncPreviewModal from '@/components/sync/SyncPreviewModal.vue';
import type { PullPreviewPlan } from '@/services/sync/pull-reconciliation.service';
import { haptics } from '@/utilities/haptics';

const router = useRouter();
const { startOnboardingTour } = useOnboarding();
const { themePreference, setTheme } = useTheme();
const {
  syncMode,
  syncStatus,
  formattedLastSync,
  pendingCount,
  lastError,
  isSyncing,
  isRefreshing,
  pushProgress,
  pullProgress,
  syncSummary,
  confirmedUploadsCount,
  failedOpsCount,
  blockedOpsCount,
  pendingPullCount,
  totalLocalRecords,
  dismissSummary,
  setSyncMode,
  triggerSyncNow,
  triggerRefreshLocalData,
  isPreviewOpen,
  isPreviewLoading,
  previewPlan,
  openPullPreview,
  closePullPreview,
  applyPullPreview,
  syncError,
  getPendingOutbox,
  clearPendingOutbox,
  deletePendingItem,
} = useSyncPreferences();

const {
  deviceStatus,
  refreshStatus
} = useNfc();

const isDemoLoaded = ref(false);
const isOperating = ref(false);
const statusMessage = ref('');
const showResetAlert = ref(false);
const showSignOutAlert = ref(false);
const showAdvancedSyncSheet = ref(false);
const showRefreshConfirmDialog = ref(false);
const showClearDbDialog = ref(false);
const isClearingDb = ref(false);
const showPendingSheet = ref(false);
const showClearPendingDialog = ref(false);
const pendingList = ref<SyncOutboxRecord[]>([]);
const isLoadingPending = ref(false);
const notificationsEnabled = ref(true);

const isNetworkOnline = computed(() => NetworkService.isOnline.value);
const isDirectSupabaseMode = computed(() => DataModeService.isDirectSupabase());
const envInfo = computed(() => DataModeService.getEnvironmentInfo());

async function handleToggleDataMode() {
  haptics.medium();
  const nextMode = isDirectSupabaseMode.value ? 'offline_first' : 'supabase_direct';
  DataModeService.setMode(nextMode);
  showToast(
    nextMode === 'supabase_direct'
      ? 'Switched to Direct Supabase Mode'
      : 'Switched to Offline-First SQLite Mode',
    'info'
  );
  if (nextMode === 'offline_first') {
    await SyncManager.refreshCountsFromDatabase();
  }
}
const networkConnType = computed(() => NetworkService.connectionType.value);
const lastSyncAttemptTime = computed(() => SyncStatusService.lastAttempt.value);
const unresolvedConflicts = computed(() => SyncStatusService.conflictCount.value);
const checkpointsList = ref<EntitySyncCheckpoint[]>([]);
const isDbReady = ref(true);
const tableCount = ref(34);
const showCheckpointsList = ref(false);

const { showToast } = useToast();

// Local Sync Audit Logs
const showAuditLogsSheet = ref(false);
const auditLogs = ref<SyncAuditLogRecord[]>([]);
const auditLogsTotal = ref(0);
const auditLogStats = ref<SyncAuditLogStats | null>(null);
const auditFilterDirection = ref<'ALL' | SyncAuditLogDirection>('ALL');
const auditFilterStatus = ref<'ALL' | SyncAuditLogStatus>('ALL');
const auditSearchQuery = ref('');
const selectedLogItem = ref<SyncAuditLogRecord | null>(null);
const showLogDetailSheet = ref(false);
const isLoadingAuditLogs = ref(false);

const directionFilterOptions = [
  { value: 'ALL', label: 'All' },
  { value: 'PUSH', label: 'Push' },
  { value: 'PULL', label: 'Pull' },
  { value: 'RECONCILE', label: 'Reconcile' },
];

const statusFilterOptions = [
  { value: 'ALL', label: 'All' },
  { value: 'SUCCESS', label: 'Success' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CONFLICT', label: 'Conflict' },
];

// Database Reconciliation
const showReconciliationSheet = ref(false);
const isReconciling = ref(false);
const reconciliationReport = ref<GlobalReconciliationReport | null>(null);
const isRepairing = ref(false);
const lastReconcileTime = ref<string | null>(null);

const formattedLocalRecords = computed(() => {
  if (totalLocalRecords.value === null) {
    return isDbReady.value ? 'Loading...' : 'Unavailable (Database Not Ready)';
  }
  return totalLocalRecords.value.toLocaleString();
});

async function loadAuditLogs() {
  isLoadingAuditLogs.value = true;
  try {
    const dir = auditFilterDirection.value === 'ALL' ? undefined : auditFilterDirection.value;
    const stat = auditFilterStatus.value === 'ALL' ? undefined : auditFilterStatus.value;
    const res = await SyncAuditLogService.getLogs({
      direction: dir,
      status: stat,
      searchQuery: auditSearchQuery.value,
      limit: 60,
    });
    auditLogs.value = res.logs;
    auditLogsTotal.value = res.total;
    auditLogStats.value = await SyncAuditLogService.getLogStats();
  } catch (err) {
    console.warn('Failed loading audit logs:', err);
  } finally {
    isLoadingAuditLogs.value = false;
  }
}

function openAuditLogs() {
  haptics.light();
  showAuditLogsSheet.value = true;
  loadAuditLogs();
}

function viewLogDetails(log: SyncAuditLogRecord) {
  haptics.light();
  selectedLogItem.value = log;
  showLogDetailSheet.value = true;
}

async function handleClearAuditLogs() {
  haptics.medium();
  await SyncAuditLogService.clearAllLogs();
  showToast('Local sync audit logs cleared', 'info');
  await loadAuditLogs();
}

async function openReconciliation() {
  haptics.light();
  showReconciliationSheet.value = true;
  await runReconciliationScan();
}

async function runReconciliationScan() {
  isReconciling.value = true;
  try {
    const report = await SyncReconciliationService.reconcileAll();
    reconciliationReport.value = report;
    lastReconcileTime.value = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    SyncStatusService.setTotalLocalRecordsCount(report.totalLocal);
    SyncStatusService.setFailedOpsCount(report.totalFailed);
  } catch (err: any) {
    showToast(err.message || 'Reconciliation scan failed', 'error');
  } finally {
    isReconciling.value = false;
  }
}

async function handleRequeueAllUnsynced() {
  haptics.medium();
  isRepairing.value = true;
  try {
    const { requeuedCount } = await SyncReconciliationService.requeueUnqueuedRecords('all');
    showToast(`Queued ${requeuedCount} unsynced records for push`, 'success');
    await runReconciliationScan();
    await loadPendingList();
  } catch (err: any) {
    showToast(err.message || 'Failed to queue records', 'error');
  } finally {
    isRepairing.value = false;
  }
}

async function handleRetryFailedOps() {
  haptics.medium();
  isRepairing.value = true;
  try {
    const { retried } = await SyncReconciliationService.retryFailedOperations();
    showToast(`Retrying ${retried} operations`, 'info');
    await runReconciliationScan();
    await loadPendingList();
  } catch (err: any) {
    showToast(err.message || 'Retry failed', 'error');
  } finally {
    isRepairing.value = false;
  }
}

async function loadSyncCenterData() {
  try {
    const db = await getDatabase();
    checkpointsList.value = await EntityCheckpointService.getAllCheckpoints(db);
    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
    );
    tableCount.value = tables.length;
    isDbReady.value = tables.length > 0;

    await SyncManager.refreshCountsFromDatabase();
    auditLogStats.value = await SyncAuditLogService.getLogStats(db);
  } catch (err) {
    console.warn('Failed loading checkpoints for Sync Center:', err);
  }
}

async function openPendingSheet() {
  haptics.light();
  showPendingSheet.value = true;
  await loadPendingList();
}

async function loadPendingList() {
  isLoadingPending.value = true;
  try {
    pendingList.value = await getPendingOutbox();
  } catch (err) {
    console.error('Failed loading pending outbox:', err);
  } finally {
    isLoadingPending.value = false;
  }
}

async function handleDeletePending(id: string) {
  haptics.light();
  await deletePendingItem(id);
  await loadPendingList();
}

async function handleClearAllPending() {
  showClearPendingDialog.value = false;
  haptics.medium();
  await clearPendingOutbox();
  pendingList.value = [];
  statusMessage.value = 'Pending changes cleared.';
}

function formatFriendlyError(rawError?: string | null): string | undefined {
  if (!rawError) return undefined;
  const lower = rawError.toLowerCase();
  if (lower.includes('duplicate key') || lower.includes('unique constraint') || lower.includes('23505')) {
    if (lower.includes('school_id')) {
      return 'Already saved in the cloud. This student ID is already registered.';
    }
    return 'This record already exists on the server.';
  }
  if (lower.includes('foreign key') || lower.includes('23503')) {
    return 'Already up to date in the cloud. You can safely clear this item.';
  }
  if (lower.includes('permission denied') || lower.includes('rls') || lower.includes('42501')) {
    return 'Permission denied by server security policy.';
  }
  if (lower.includes('unauthorized') || lower.includes('authentication')) {
    return 'Session expired. Please sign in again.';
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('connection')) {
    return 'Network connection issue. Will retry automatically.';
  }
  return rawError;
}

function getFriendlyItem(item: SyncOutboxRecord) {
  let title = item.entity_type;
  let subtitle = 'Pending sync update';
  let badge: string = item.operation;
  let badgeClass = 'badge-primary';

  try {
    const payload = item.payload_json ? JSON.parse(item.payload_json) : {};
    
    if (item.entity_type === 'STUDENT') {
      const name = [payload.first_name, payload.last_name].filter(Boolean).join(' ');
      title = name ? `Student: ${name}` : 'Student Record';
      const meta = [
        payload.school_id ? `ID: ${payload.school_id}` : null,
        payload.section ? `Sec ${payload.section}` : null,
        payload.year ? `Year ${payload.year}` : null,
      ].filter(Boolean).join(' • ');
      subtitle = meta || 'Student profile information';
      badge = item.operation === 'CREATE' ? 'New Registration' : 'Update Info';
      badgeClass = item.operation === 'CREATE' ? 'badge-success' : 'badge-info';
    } else if (item.entity_type === 'ENROLLMENT') {
      const name = [payload.first_name_snapshot, payload.last_name_snapshot].filter(Boolean).join(' ');
      title = name ? `Enrollment: ${name}` : 'Class Enrollment';
      const meta = [
        payload.year_level ? `${payload.year_level} Year` : null,
        payload.section ? `Section ${payload.section}` : null,
        payload.program_id ? (payload.program_id.replace('prog_', '').toUpperCase()) : null,
      ].filter(Boolean).join(' • ');
      subtitle = meta || 'Term enrollment record';
      badge = 'Enrollment';
      badgeClass = 'badge-primary';
    } else if (item.entity_type === 'ATTENDANCE') {
      title = 'Event Attendance Check-in';
      subtitle = payload.scanned_at ? `Tap at ${new Date(payload.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Attendance check-in record';
      badge = 'Attendance';
      badgeClass = 'badge-warning';
    } else if (item.entity_type === 'PAYMENT' || item.entity_type === 'PAYMENT_ALLOCATION') {
      const pesos = payload.amount_centavos ? `₱${(payload.amount_centavos / 100).toFixed(2)}` : '';
      title = pesos ? `Payment: ${pesos}` : 'Payment Transaction';
      subtitle = payload.reference_number ? `Ref: ${payload.reference_number}` : 'Collected fee/contribution';
      badge = 'Payment';
      badgeClass = 'badge-success';
    } else if (item.entity_type === 'CARD') {
      title = 'NFC Smart Card';
      subtitle = payload.uid_normalized ? `Card UID: ${payload.uid_normalized}` : 'Student smart card linked';
      badge = 'NFC Card';
      badgeClass = 'badge-accent';
    } else {
      title = item.entity_type.charAt(0) + item.entity_type.slice(1).toLowerCase().replace(/_/g, ' ');
      subtitle = `Operation: ${item.operation}`;
    }
  } catch {
    title = `${item.entity_type} Record`;
    subtitle = `Operation: ${item.operation}`;
  }

  const friendlyError = formatFriendlyError(item.last_error);
  const timeStr = item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return {
    title,
    subtitle,
    badge,
    badgeClass,
    friendlyError,
    timeStr,
  };
}

const syncModeOptions = [
  { value: 'AUTOMATIC', label: 'Automatic' },
  { value: 'MANUAL', label: 'Manual' },
];

const syncStatusClass = computed(() => {
  switch (syncStatus.value) {
    case 'Up to Date': return 'synced';
    case 'Syncing':
    case 'Updating': return 'syncing';
    case 'Offline Mode':
    case 'Offline': return 'offline';
    case 'Pending Uploads':
    case 'Waiting to Sync':
    case 'Sync Incomplete': return 'pending';
    case 'Needs Attention':
    case 'Sign-in Required': return 'attention';
    case 'Sync Error':
    case 'Update Failed': return 'failed';
    default: return 'synced';
  }
});

async function handleSyncModeChange(val: string) {
  haptics.light();
  await setSyncMode(val as 'AUTOMATIC' | 'MANUAL');
}

async function onSyncNow() {
  haptics.medium();
  statusMessage.value = '';
  try {
    await triggerSyncNow();
    statusMessage.value = 'Synchronization completed successfully.';
  } catch (err: unknown) {
    statusMessage.value = err instanceof Error ? err.message : 'Sync failed. Local data remains safe.';
  } finally {
    await loadSyncCenterData();
  }
}

async function handleConfirmRefreshData() {
  showRefreshConfirmDialog.value = false;
  haptics.medium();
  await openPullPreview();
}

async function handleConfirmClearDb() {
  showClearDbDialog.value = false;
  haptics.medium();
  isClearingDb.value = true;
  statusMessage.value = 'Clearing and rebuilding local database...';
  try {
    await clearLocalDatabase();
    showAdvancedSyncSheet.value = false;
    statusMessage.value = 'Local database reset successfully. Reloading application...';
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    }, 600);
  } catch (err: unknown) {
    statusMessage.value = err instanceof Error ? err.message : 'Failed to clear local database.';
  } finally {
    isClearingDb.value = false;
  }
}

async function handleApprovePreview(plan: PullPreviewPlan) {
  haptics.medium();
  const success = await applyPullPreview(plan);
  if (success) {
    showAdvancedSyncSheet.value = false;
    statusMessage.value = 'Local data reconciled and updated successfully from cloud.';
  } else {
    statusMessage.value = syncError.value || 'Failed to apply pull operations.';
  }
}

const currentUser = computed(() => SupabaseAuthService.user.value || authService.user.value);
const currentRole = computed(() => SupabaseAuthService.role.value || authService.role.value);
const currentSemester = ref<Semester | null>(null);
const currentYear = ref<AcademicYear | null>(null);

const themeOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System Default' }
];

async function handleThemeChange(val: string) {
  haptics.light();
  await setTheme(val as ThemePreference);
}

async function loadAcademicInfo() {
  try {
    currentSemester.value = await AcademicRepository.getActiveSemester();
    if (currentSemester.value?.academic_year_id) {
      currentYear.value = await AcademicRepository.getYearById(currentSemester.value.academic_year_id);
    }
  } catch (err) {
    console.error('Failed to load academic term for settings:', err);
  }
}

async function checkStatus() {
  try {
    await authService.initSession();
    await SupabaseAuthService.initialize();
  } catch (err) {
    console.warn('Auth session check in settings:', err);
  }
  await refreshStatus();
  await loadAcademicInfo();
  if (!isDirectSupabaseMode.value) {
    await loadSyncCenterData();
  }
  isDemoLoaded.value = await demoDataService.isDemoDataLoaded();
}

onMounted(checkStatus);

async function handleConfirmSignOut() {
  showSignOutAlert.value = false;
  haptics.medium();
  try {
    await SupabaseAuthService.logout();
    await authService.logout();
  } catch (err) {
    console.error('Sign out error:', err);
  } finally {
    router.replace('/login');
  }
}

async function handleLoadSampleData() {
  isOperating.value = true;
  statusMessage.value = '';
  try {
    const res = await demoDataService.loadSampleData();
    isDemoLoaded.value = true;
    statusMessage.value = `Sample data loaded! Added ${res.studentsAdded} students and ${res.eventsAdded} event(s).`;
  } catch (err: unknown) {
    statusMessage.value = err instanceof Error ? err.message : 'Error loading sample data';
  } finally {
    isOperating.value = false;
  }
}

async function handleResetSampleData() {
  isOperating.value = true;
  statusMessage.value = '';
  try {
    await demoDataService.resetSampleData();
    isDemoLoaded.value = false;
    statusMessage.value = 'Sample demo records cleared. Your original custom students remain preserved.';
  } catch (err: unknown) {
    statusMessage.value = err instanceof Error ? err.message : 'Error resetting sample data';
  } finally {
    isOperating.value = false;
  }
}

function toggleNotifications() {
  haptics.light();
  notificationsEnabled.value = !notificationsEnabled.value;
}
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Settings"
      subtitle="Preferences, account & system"
      :back-button="true"
      default-back-href="/tabs/home"
      variant="detail"
    />

    <ion-content class="safe-content non-tab-content">
      <div class="page-container">
        <!-- Status Notification -->
        <div v-if="statusMessage" class="status-banner">
          <ion-icon :icon="checkmarkCircle" />
          <span>{{ statusMessage }}</span>
        </div>

        <!-- 1. PROFILE / ACCOUNT SECTION -->
        <section class="settings-group">
          <div class="group-header">
            <span>Account</span>
          </div>

          <div class="profile-card minimal-card">
            <div class="profile-avatar-box">
              <ion-icon :icon="personCircleOutline" class="avatar-icon" />
            </div>
            <div class="profile-info">
              <div class="profile-name-row">
                <span class="profile-name">{{ currentUser?.username || 'Authenticated User' }}</span>
                <span class="role-badge" :class="currentRole?.toLowerCase()">
                  {{ formatUserRole(currentRole) }}
                </span>
              </div>
              <span class="profile-meta">
                {{ currentUser?.id ? `UID: ${currentUser.id.substring(0, 8)}...` : 'Local Offline Session' }}
              </span>
            </div>
          </div>

          <WorkspaceSwitcher style="margin-top: 10px;" />
        </section>

        <!-- 2. APPEARANCE (THEME SELECTOR) -->
        <section class="settings-group">
          <div class="group-header">
            <span>Appearance</span>
          </div>

          <div class="minimal-card appearance-card">
            <div class="appearance-header-row">
              <div class="appearance-title-wrap">
                <ion-icon :icon="colorPaletteOutline" class="appearance-icon text-primary" />
                <span class="row-title">Theme Preference</span>
              </div>
              <span class="active-theme-label font-mono">
                {{ themePreference.toUpperCase() }}
              </span>
            </div>

            <UniSegmentedControl
              :model-value="themePreference"
              :options="themeOptions"
              class="theme-segmented"
              @update:model-value="handleThemeChange"
            />
          </div>
        </section>

        <!-- 3. PREFERENCES & SYSTEM OPERATIONS -->
        <section class="settings-group">
          <div class="group-header">
            <span>Preferences &amp; System</span>
          </div>

          <div class="grouped-list-card minimal-card">
            <!-- Academic Period -->
            <div
              class="list-action-row"
              @click="currentRole === 'DEVADMIN' || currentRole === 'OFFICER' ? router.push('/academic') : null"
            >
              <div class="row-icon-box text-primary">
                <ion-icon :icon="schoolOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Academic Period</span>
                <span class="row-desc">
                  {{ currentSemester ? formatAcademicPeriod(currentSemester.term, currentSemester.academic_year_id) : (currentYear?.label || 'No Active Term') }}
                </span>
              </div>
              <span v-if="currentSemester" class="badge-pill badge-primary font-mono">
                {{ currentSemester.status === 'ACTIVE' ? 'Active' : currentSemester.status }}
              </span>
              <ion-icon
                v-if="currentRole === 'DEVADMIN' || currentRole === 'OFFICER'"
                :icon="chevronForwardOutline"
                class="row-arrow"
              />
            </div>

            <div class="row-divider"></div>

            <!-- Notifications Toggle -->
            <div class="list-action-row" @click="toggleNotifications">
              <div class="row-icon-box">
                <ion-icon :icon="notificationsOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">In-App Notifications</span>
                <span class="row-desc">Attendance alerts &amp; scan feedback</span>
              </div>
              <span class="toggle-pill" :class="{ 'is-enabled': notificationsEnabled }">
                {{ notificationsEnabled ? 'On' : 'Off' }}
              </span>
            </div>

            <div class="row-divider"></div>

            <!-- NFC Hardware Diagnostics -->
            <div class="list-action-row" @click="router.push('/diagnostics/device')">
              <div class="row-icon-box">
                <ion-icon :icon="hardwareChipOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">NFC Hardware &amp; Diagnostics</span>
                <span class="row-desc">{{ deviceStatus.platform.toUpperCase() }} • {{ deviceStatus.supported ? 'Supported' : 'Disabled' }}</span>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
            </div>
          </div>
        </section>

        <!-- 4. DATA MODE, OFFLINE & SYNC CENTER -->
        <section class="settings-group">
          <div class="group-header">
            <span>Data Mode, Sync Center &amp; Diagnostics</span>
          </div>

          <div class="grouped-list-card minimal-card">
            <!-- Data Mode & Build Identity Selector -->
            <div class="data-mode-control-card">
              <div class="data-mode-control-header">
                <div class="data-mode-title-col">
                  <span class="data-mode-headline">Runtime Data Mode</span>
                  <span class="data-mode-subheadline font-mono">{{ envInfo.modeLabel }} • v{{ envInfo.versionName }} (Build {{ envInfo.versionCode }})</span>
                </div>
                <button
                  type="button"
                  class="data-mode-toggle-btn font-mono"
                  :class="{ 'btn-direct': isDirectSupabaseMode, 'btn-offline': !isDirectSupabaseMode }"
                  @click="handleToggleDataMode"
                >
                  {{ isDirectSupabaseMode ? 'Switch to Offline SQLite' : 'Switch to Direct Supabase' }}
                </button>
              </div>
              <div class="data-mode-env-details font-mono">
                <span>Supabase: {{ envInfo.supabaseUrl }}</span>
              </div>
            </div>

            <!-- Direct Supabase Mode Alert Banner -->
            <div v-if="isDirectSupabaseMode" class="direct-mode-banner" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; color: #10b981; font-size: 0.82rem; font-weight: 600;">
              <span class="status-indicator-dot dot-online" style="background: #10b981;"></span>
              <span>Direct Supabase Mode Active — All reads/writes authoritative in cloud. SQLite sync paused.</span>
            </div>

            <!-- Offline-First Sync Center (Active when in Offline-First Mode) -->
            <div v-if="!isDirectSupabaseMode">
              <!-- Sync Status Header Row -->
              <div class="sync-overview-row">
                <div class="sync-status-indicator">
                  <span class="status-indicator-dot" :class="`dot-${syncStatusClass}`"></span>
                  <span class="status-indicator-text">{{ syncStatus }}</span>
                </div>
                <div class="sync-timestamps font-mono">
                  <span class="last-sync-caption">Last Sync: {{ formattedLastSync }}</span>
                  <span class="last-sync-caption text-neutral">• Local Records: {{ formattedLocalRecords }}</span>
                  <span v-if="lastReconcileTime" class="last-sync-caption text-neutral">• Compared: {{ lastReconcileTime }}</span>
                </div>
              </div>

            <!-- Sync Overview KPI Grid (6 Distinct Separated Metrics) -->
            <div class="sync-kpi-grid">
              <div class="sync-kpi-card" :class="{ 'kpi-warn': pendingCount > 0 }" @click="openPendingSheet">
                <span class="kpi-value font-mono">{{ pendingCount }}</span>
                <span class="kpi-label">Pending Push</span>
              </div>
              <div class="sync-kpi-card kpi-success" @click="openAuditLogs">
                <span class="kpi-value font-mono">{{ confirmedUploadsCount }}</span>
                <span class="kpi-label">Confirmed Uploads</span>
              </div>
              <div class="sync-kpi-card" :class="{ 'kpi-danger': failedOpsCount > 0 }" @click="openPendingSheet">
                <span class="kpi-value font-mono">{{ failedOpsCount }}</span>
                <span class="kpi-label">Failed Ops</span>
              </div>
              <div class="sync-kpi-card" :class="{ 'kpi-warn': blockedOpsCount > 0 }">
                <span class="kpi-value font-mono">{{ blockedOpsCount }}</span>
                <span class="kpi-label">Blocked Ops</span>
              </div>
              <div class="sync-kpi-card" :class="{ 'kpi-danger': unresolvedConflicts > 0 }" @click="openReconciliation">
                <span class="kpi-value font-mono">{{ unresolvedConflicts }}</span>
                <span class="kpi-label">Conflicts</span>
              </div>
              <div class="sync-kpi-card" :class="{ 'kpi-info': pendingPullCount > 0 }" @click="showCheckpointsList = !showCheckpointsList">
                <span class="kpi-value font-mono">{{ pendingPullCount }}</span>
                <span class="kpi-label">Pending Pull</span>
              </div>
            </div>

            <!-- Live Sync Progress Section (Active while syncing or when push/pull progress is active) -->
            <div v-if="isSyncing || pushProgress.isActive || pullProgress.isActive" class="live-sync-monitor">
              <!-- PUSH PROGRESS BLOCK -->
              <div class="sync-progress-card push-card">
                <div class="progress-card-head">
                  <div class="progress-title-col">
                    <span class="progress-badge badge-push font-mono">PUSH</span>
                    <span class="progress-title">
                      {{ pushProgress.totalEligible === 0 ? 'Outbox Upload' : `Pushing ${pushProgress.currentEntity || 'Records'}` }}
                    </span>
                  </div>
                  <span v-if="pushProgress.totalEligible > 0" class="progress-batch-tag font-mono">
                    Batch {{ pushProgress.currentBatch }} of {{ pushProgress.totalBatches }}
                  </span>
                  <span v-else class="progress-batch-tag font-mono text-neutral">
                    Empty
                  </span>
                </div>

                <!-- Empty state when nothing to push -->
                <div v-if="pushProgress.totalEligible === 0" class="nothing-to-upload-row">
                  <ion-icon :icon="checkmarkCircle" class="text-success" />
                  <span>Nothing to upload • Outbox is empty</span>
                </div>

                <!-- Active progress bar when operations exist -->
                <div v-else class="progress-bar-container">
                  <div class="progress-track">
                    <div class="progress-fill fill-push" :style="{ width: `${pushProgress.percent}%` }"></div>
                  </div>
                  <div class="progress-meta-row font-mono">
                    <span>{{ pushProgress.percent }}% • {{ pushProgress.attempted }} of {{ pushProgress.totalEligible }} attempted</span>
                    <span class="text-primary">{{ pushProgress.remaining }} remaining</span>
                  </div>

                  <!-- Live Operation Metrics Breakdown -->
                  <div class="progress-metrics-breakdown font-mono">
                    <span class="metric-pill pill-success" title="Server Confirmed">✓ {{ pushProgress.confirmed }} Confirmed</span>
                    <span v-if="pushProgress.failed > 0" class="metric-pill pill-danger" title="Failed Operations">✕ {{ pushProgress.failed }} Failed</span>
                    <span v-if="pushProgress.blocked > 0" class="metric-pill pill-warn" title="Blocked Operations">⊘ {{ pushProgress.blocked }} Blocked</span>
                    <span v-if="pushProgress.conflicts > 0" class="metric-pill pill-conflict" title="Conflicts">⚡ {{ pushProgress.conflicts }} Conflict</span>
                  </div>

                  <div v-if="pushProgress.lastAck" class="progress-ack-row font-mono">
                    <ion-icon :icon="checkmarkCircle" class="ack-icon" />
                    <span class="ack-text">Last Ack: {{ pushProgress.lastAck }}</span>
                  </div>
                </div>
              </div>

              <!-- PULL PROGRESS BLOCK -->
              <div v-if="pullProgress.isActive" class="sync-progress-card pull-card">
                <div class="progress-card-head">
                  <div class="progress-title-col">
                    <span class="progress-badge badge-pull font-mono">PULL</span>
                    <span class="progress-title">Ingesting {{ pullProgress.currentEntity || 'Updates' }}</span>
                  </div>
                  <span class="progress-batch-tag font-mono">
                    {{ pullProgress.entitiesCompleted }} of {{ pullProgress.totalEntities }} Entities
                  </span>
                </div>

                <div class="progress-bar-container">
                  <div class="progress-track">
                    <div class="progress-fill fill-pull" :style="{ width: `${pullProgress.percent}%` }"></div>
                  </div>
                  <div class="progress-meta-row font-mono">
                    <span>{{ pullProgress.percent }}%</span>
                    <span>{{ pullProgress.recordsPulled }} rows ingested</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Synchronization Completion Summary Report Card -->
            <div v-if="syncSummary && !isSyncing" class="sync-summary-card" :class="`summary-${syncSummary.status.toLowerCase()}`">
              <div class="summary-card-head">
                <div class="summary-title-row">
                  <ion-icon
                    :icon="syncSummary.status === 'SUCCESS' || syncSummary.status === 'NOTHING_TO_SYNC' ? checkmarkCircle : alertCircleOutline"
                    class="summary-status-icon"
                  />
                  <div class="summary-title-text">
                    <span class="summary-heading">
                      {{ syncSummary.status === 'SUCCESS' ? 'Synchronization Complete' : syncSummary.status === 'NOTHING_TO_SYNC' ? 'Already Up to Date' : (syncSummary.status === 'PARTIAL' ? 'Sync Completed with Issues' : 'Sync Incomplete') }}
                    </span>
                    <span class="summary-subtitle font-mono">Finished at {{ new Date(syncSummary.timestamp).toLocaleTimeString() }}</span>
                  </div>
                </div>
                <button class="dismiss-summary-btn" title="Dismiss" @click="dismissSummary">✕</button>
              </div>

              <div class="summary-stats-grid font-mono">
                <div class="summary-stat-box">
                  <span class="stat-num">{{ syncSummary.totalAttempted }}</span>
                  <span class="stat-lbl">Attempted</span>
                </div>
                <div class="summary-stat-box text-success">
                  <span class="stat-num">{{ syncSummary.confirmed }}</span>
                  <span class="stat-lbl">Confirmed</span>
                </div>
                <div class="summary-stat-box" :class="{ 'text-danger': syncSummary.failed > 0 }">
                  <span class="stat-num">{{ syncSummary.failed }}</span>
                  <span class="stat-lbl">Failed</span>
                </div>
                <div class="summary-stat-box" :class="{ 'text-warn': syncSummary.stillPending > 0 }">
                  <span class="stat-num">{{ syncSummary.stillPending }}</span>
                  <span class="stat-lbl">Pending</span>
                </div>
                <div v-if="syncSummary.conflicts > 0" class="summary-stat-box text-danger">
                  <span class="stat-num">{{ syncSummary.conflicts }}</span>
                  <span class="stat-lbl">Conflicts</span>
                </div>
                <div v-if="syncSummary.blocked > 0" class="summary-stat-box text-warn">
                  <span class="stat-num">{{ syncSummary.blocked }}</span>
                  <span class="stat-lbl">Blocked</span>
                </div>
              </div>
            </div>

            <!-- Sync Actions Button Row -->
            <div class="sync-btn-container">
              <UniButton
                variant="primary"
                size="md"
                :disabled="isSyncing || !isNetworkOnline"
                :icon="syncOutline"
                class="btn-half-width"
                @click="onSyncNow"
              >
                {{ isSyncing ? 'Syncing...' : 'Sync Now' }}
              </UniButton>
              <UniButton
                variant="outline"
                size="md"
                :disabled="isReconciling"
                :icon="gitCompareOutline"
                class="btn-half-width"
                @click="openReconciliation"
              >
                {{ isReconciling ? 'Scanning...' : 'Reconcile' }}
              </UniButton>
            </div>

            <!-- Sync Error Banner if lastError exists -->
            <div
              v-if="lastError && (syncStatus === 'Update Failed' || syncStatus === 'Sync Error')"
              class="sync-error-banner tactile-press"
              @click="openPendingSheet"
            >
              <ion-icon :icon="alertCircleOutline" class="error-banner-icon" />
              <div class="error-banner-text">
                <span class="error-banner-label">Error Details:</span>
                <span class="error-banner-msg">{{ lastError }}</span>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="error-banner-arrow" />
            </div>

            <div class="row-divider"></div>

            <!-- Network Connectivity Status -->
            <div class="list-action-row">
              <div class="row-icon-box" :class="isNetworkOnline ? 'text-primary' : 'text-neutral'">
                <ion-icon :icon="isNetworkOnline ? checkmarkCircle : alertCircleOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Network Connectivity</span>
                <span class="row-desc">
                  {{ isNetworkOnline ? `Connected (${networkConnType.toUpperCase()})` : 'Disconnected • Offline Mode Active' }}
                </span>
              </div>
              <span class="badge-pill font-mono" :class="isNetworkOnline ? 'badge-primary' : 'badge-neutral'">
                {{ isNetworkOnline ? 'ONLINE' : 'OFFLINE' }}
              </span>
            </div>

            <div class="row-divider"></div>

            <!-- Local SQLite Database Readiness -->
            <div class="list-action-row">
              <div class="row-icon-box text-primary">
                <ion-icon :icon="shieldCheckmarkOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Local SQLite Engine</span>
                <span class="row-desc">
                  {{ isDbReady ? `Active & Persistent • ${tableCount} tables ready` : 'Initializing SQLite...' }}
                </span>
              </div>
              <span class="badge-pill badge-primary font-mono">
                READY
              </span>
            </div>

            <div class="row-divider"></div>

            <!-- Sync Preference Control -->
            <div class="list-control-block">
              <span class="control-label">Sync Preference</span>
              <UniSegmentedControl
                :model-value="syncMode"
                :options="syncModeOptions"
                size="sm"
                @update:model-value="handleSyncModeChange"
              />
            </div>

            <div class="row-divider"></div>

            <!-- Pending Changes Counter & Action Row -->
            <div class="list-action-row tactile-press cursor-pointer" @click="openPendingSheet">
              <div class="row-icon-box text-primary">
                <ion-icon :icon="cloudUploadOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Pending Changes</span>
                <span class="row-desc">Durable local outbox entries awaiting push</span>
              </div>
              <div class="pending-badge-row">
                <span class="badge-pill font-mono" :class="pendingCount > 0 ? 'badge-warning' : 'badge-neutral'">
                  {{ pendingCount }}
                </span>
                <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
              </div>
            </div>

            <div class="row-divider"></div>

            <!-- Conflicts Counter -->
            <div class="list-action-row">
              <div class="row-icon-box" :class="unresolvedConflicts > 0 ? 'text-danger' : 'text-primary'">
                <ion-icon :icon="alertCircleOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Sync Conflicts</span>
                <span class="row-desc">
                  {{ unresolvedConflicts === 0 ? 'Zero conflicts • All mutations reconciled' : `${unresolvedConflicts} unresolved conflict(s)` }}
                </span>
              </div>
              <span class="badge-pill font-mono" :class="unresolvedConflicts > 0 ? 'badge-danger' : 'badge-neutral'">
                {{ unresolvedConflicts }}
              </span>
            </div>

            <div class="row-divider"></div>

            <!-- Sync Activity Logs Row -->
            <div class="list-action-row tactile-press cursor-pointer" @click="openAuditLogs">
              <div class="row-icon-box text-primary">
                <ion-icon :icon="listOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Sync Activity Logs</span>
                <span class="row-desc">
                  Local-only diagnostics • {{ auditLogStats?.totalLogs || 0 }} logged events
                </span>
              </div>
              <div class="pending-badge-row">
                <span class="badge-pill font-mono badge-neutral">
                  {{ auditLogStats?.totalLogs || 0 }}
                </span>
                <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
              </div>
            </div>

            <div class="row-divider"></div>

            <!-- Per-Entity Checkpoints Toggle -->
            <div class="list-action-row tactile-press cursor-pointer" @click="showCheckpointsList = !showCheckpointsList">
              <div class="row-icon-box text-primary">
                <ion-icon :icon="optionsOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Per-Entity Checkpoints</span>
                <span class="row-desc">{{ checkpointsList.length }} tracked tables</span>
              </div>
              <ion-icon :icon="showCheckpointsList ? chevronDownOutline : chevronForwardOutline" class="row-arrow" />
            </div>

            <!-- Inline Checkpoints List -->
            <div v-if="showCheckpointsList" class="checkpoints-table-wrap">
              <div v-for="cp in checkpointsList" :key="cp.entity_name" class="checkpoint-item">
                <div class="checkpoint-row font-mono">
                  <span class="cp-name">{{ cp.entity_name }}</span>
                  <span class="cp-count">{{ cp.records_pulled }} rows</span>
                  <span class="cp-status" :class="`cp-status-${cp.last_sync_status.toLowerCase()}`">{{ cp.last_sync_status }}</span>
                </div>
                <div v-if="cp.last_sync_status === 'FAILED' && cp.last_error_message" class="checkpoint-error-desc">
                  {{ formatFriendlyError(cp.last_error_message) || cp.last_error_message }}
                </div>
              </div>
            </div>

            <div class="row-divider"></div>

            <!-- Advanced Sync Options (Refresh Local Data & Diagnostics) -->
            <div class="list-action-row" @click="showAdvancedSyncSheet = true">
              <div class="row-icon-box">
                <ion-icon :icon="optionsOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Advanced Data Tools</span>
                <span class="row-desc">Preflight preview &amp; cloud data refresh</span>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
            </div>
            </div>
          </div>
        </section>

        <!-- 4. ADMINISTRATION (DEVADMIN ONLY) -->
        <section v-if="currentRole === 'DEVADMIN'" class="settings-group">
          <div class="group-header">
            <span>Administration</span>
            <span class="group-tag font-mono">DevAdmin</span>
          </div>

          <div class="grouped-list-card minimal-card highlight-group">
            <!-- DevAdmin System Setup -->
            <div
              class="list-action-row"
              @click="router.push('/settings/system-setup')"
            >
              <div class="row-icon-box text-primary">
                <ion-icon :icon="constructOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">System Setup &amp; Academic Structure</span>
                <span class="row-desc">Event categories, year levels, sections, years &amp; terms</span>
              </div>
              <span class="badge-pill badge-primary font-mono">Setup</span>
              <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
            </div>

            <div class="row-divider"></div>

            <!-- Prototype Demo Data (DevAdmin Only) -->
            <div class="list-action-row" @click="handleLoadSampleData">
              <div class="row-icon-box text-primary">
                <ion-spinner v-if="isOperating" name="crescent" class="btn-spinner" />
                <ion-icon v-else :icon="cloudDownloadOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Load Sample Demo Data</span>
                <span class="row-desc">Populate demo students, events, and sample charges</span>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
            </div>

            <div class="row-divider"></div>

            <div class="list-action-row" @click="showResetAlert = true">
              <div class="row-icon-box text-danger">
                <ion-icon :icon="trashOutline" />
              </div>
              <div class="row-content">
                <span class="row-title text-danger">Reset Prototype Demo Records</span>
                <span class="row-desc">Clears generated mock data; preserves custom records</span>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
            </div>
          </div>
        </section>

        <!-- 5. SUPPORT & ABOUT -->
        <section class="settings-group">
          <div class="group-header">
            <span>Support &amp; About</span>
          </div>

          <div class="grouped-list-card minimal-card">
            <!-- Walkthrough Tour -->
            <div class="list-action-row" @click="startOnboardingTour">
              <div class="row-icon-box text-accent">
                <ion-icon :icon="sparklesOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Feature Tour</span>
                <span class="row-desc">Walkthrough of UniTap 2.0 capabilities</span>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
            </div>

            <div class="row-divider"></div>

            <!-- Privacy & Security -->
            <div class="list-action-row">
              <div class="row-icon-box">
                <ion-icon :icon="shieldCheckmarkOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Privacy &amp; Security</span>
                <span class="row-desc">Offline-first encrypted SQLite database</span>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
            </div>

            <div class="row-divider"></div>

            <!-- App Info Row -->
            <div class="list-item-row app-info-row">
              <div class="row-icon-box">
                <ion-icon :icon="informationCircleOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">UniTap</span>
                <span class="row-desc">Version 2.0.0 • com.unitap.app</span>
              </div>
              <span class="version-tag font-mono">v2.0.0</span>
            </div>
          </div>
        </section>

        <!-- 5. SIGN OUT BUTTON (STANDALONE MINIMAL) -->
        <section class="logout-section">
          <UniButton
            variant="destructive"
            size="md"
            block
            :icon="logOutOutline"
            @click="showSignOutAlert = true"
          >
            Sign Out
          </UniButton>
        </section>
      </div>

      <!-- Confirmation Dialog for Sign Out -->
      <UniDialog
        v-model:is-open="showSignOutAlert"
        title="Sign Out"
        description="Are you sure you want to sign out of your UniTap account? Unsynced records will be preserved safely in local SQLite storage."
        confirm-text="Confirm Sign Out"
        cancel-text="Cancel"
        :destructive="true"
        type="destructive"
        @confirm="handleConfirmSignOut"
        @cancel="showSignOutAlert = false"
      />

      <!-- Confirmation Dialog for Reset -->
      <UniDialog
        v-model:is-open="showResetAlert"
        title="Reset Sample Data?"
        description="This will delete sample demo students, sample events, and sample records. Custom records you created manually will NOT be deleted."
        confirm-text="Confirm Reset"
        cancel-text="Cancel"
        :destructive="true"
        type="destructive"
        @confirm="handleResetSampleData"
        @cancel="showResetAlert = false"
      />

      <!-- Advanced Sync Options Sheet -->
      <UniSheet
        v-model:is-open="showAdvancedSyncSheet"
        title="Advanced Sync Options"
        subtitle="Data recovery, cache refresh, and technical diagnostics"
      >
        <div class="advanced-sync-content">
          <!-- Refresh Local Data Card -->
          <div class="advanced-option-card">
            <div class="option-header-row">
              <ion-icon :icon="refreshOutline" class="option-icon text-primary" />
              <div class="option-text">
                <span class="option-title">Refresh Local Data</span>
                <span class="option-desc">
                  Re-downloads your authorized records from the cloud. Unsynced local operations are safely preserved.
                </span>
              </div>
            </div>
            <UniButton
              variant="outline"
              size="sm"
              :disabled="isRefreshing"
              class="option-btn"
              @click="showRefreshConfirmDialog = true"
            >
              {{ isRefreshing ? 'Refreshing...' : 'Refresh Data' }}
            </UniButton>
          </div>

          <!-- Terminal Diagnostics Card -->
          <div class="advanced-option-card">
            <div class="option-header-row">
              <ion-icon :icon="hardwareChipOutline" class="option-icon" />
              <div class="option-text">
                <span class="option-title">Terminal Diagnostics</span>
                <span class="option-desc">
                  Inspect raw synchronization queue, SQLite storage cursors, and network latency.
                </span>
              </div>
            </div>
            <UniButton
              variant="outline"
              size="sm"
              class="option-btn"
              @click="showAdvancedSyncSheet = false; router.push('/sync-status')"
            >
              View Diagnostics
            </UniButton>
          </div>

          <!-- Reset / Clear Local Database Card -->
          <div class="advanced-option-card">
            <div class="option-header-row">
              <ion-icon :icon="trashOutline" class="option-icon text-danger" />
              <div class="option-text">
                <span class="option-title text-danger">Reset Local Database</span>
                <span class="option-desc">
                  Completely wipes all local SQLite tables, duplicated students, offline outbox, and sync checkpoints. Rebuilds a clean, empty database.
                </span>
              </div>
            </div>
            <UniButton
              variant="destructive"
              size="sm"
              :disabled="isClearingDb"
              class="option-btn"
              @click="showClearDbDialog = true"
            >
              {{ isClearingDb ? 'Clearing...' : 'Clear Local DB' }}
            </UniButton>
          </div>
        </div>
      </UniSheet>

      <!-- Confirmation Dialog for Database Reset -->
      <UniDialog
        v-model:is-open="showClearDbDialog"
        title="Wipe Local Database?"
        description="This will permanently delete all local SQLite data, duplicated students, and sync checkpoints on this device, then recreate a clean, empty database structure. Are you sure?"
        confirm-text="Wipe & Reset"
        cancel-text="Cancel"
        :destructive="true"
        type="destructive"
        @confirm="handleConfirmClearDb"
        @cancel="showClearDbDialog = false"
      />

      <!-- Confirmation Dialog for Refresh -->
      <UniDialog
        v-model:is-open="showRefreshConfirmDialog"
        title="Refresh Local Data?"
        description="This will analyze all current authorized records against your local database. A preflight preview will be displayed for your review before writing to SQLite."
        confirm-text="Open Preview"
        cancel-text="Cancel"
        type="confirm"
        @confirm="handleConfirmRefreshData"
        @cancel="showRefreshConfirmDialog = false"
      />

      <!-- Preflight Sync Preview Modal -->
      <SyncPreviewModal
        :is-open="isPreviewOpen"
        :plan="previewPlan"
        :is-loading="isPreviewLoading"
        @close="closePullPreview"
        @cancel="closePullPreview"
        @approve="handleApprovePreview"
      />

      <!-- Pending Changes & Outbox Logs Sheet -->
      <UniSheet
        v-model:is-open="showPendingSheet"
        title="Pending Changes"
        :subtitle="`${pendingList.length} updates waiting to upload`"
      >
        <div class="pending-sheet-content">
          <div v-if="pendingList.length > 0" class="pending-sheet-toolbar">
            <span class="sheet-summary-text">
              These changes are saved safely on this device. They will automatically upload when connected to the server.
            </span>
            <div class="toolbar-actions">
              <UniButton
                variant="outline"
                size="sm"
                :icon="refreshOutline"
                :disabled="isSyncing"
                @click="onSyncNow(); loadPendingList()"
              >
                Retry Sync
              </UniButton>
              <UniButton
                variant="destructive"
                size="sm"
                :icon="trashOutline"
                @click="showClearPendingDialog = true"
              >
                Clear Queue
              </UniButton>
            </div>
          </div>

          <div v-if="isLoadingPending" class="loading-state">
            <ion-spinner name="crescent" color="primary" />
            <p class="metadata-text">Checking pending changes...</p>
          </div>

          <div v-else-if="pendingList.length === 0" class="empty-pending-state">
            <ion-icon :icon="checkmarkCircle" class="empty-icon text-success" />
            <span class="empty-title">All Caught Up!</span>
            <span class="empty-desc">All student records and operations are up to date with the server.</span>
          </div>

          <div v-else class="pending-items-list">
            <div
              v-for="item in pendingList"
              :key="item.id"
              class="pending-item-card"
            >
              <div class="item-head-row">
                <div class="item-info">
                  <div class="item-title-row">
                    <span class="item-friendly-title">{{ getFriendlyItem(item).title }}</span>
                    <span class="item-badge" :class="getFriendlyItem(item).badgeClass">
                      {{ getFriendlyItem(item).badge }}
                    </span>
                  </div>
                  <span class="item-friendly-desc">{{ getFriendlyItem(item).subtitle }}</span>
                </div>
                <div class="item-actions">
                  <span class="item-time font-mono">{{ getFriendlyItem(item).timeStr }}</span>
                  <button class="delete-item-btn" title="Discard this change" @click="handleDeletePending(item.id)">
                    <ion-icon :icon="trashOutline" />
                  </button>
                </div>
              </div>

              <!-- Friendly Error Note if error exists -->
              <div v-if="getFriendlyItem(item).friendlyError" class="item-error-box">
                <ion-icon :icon="alertCircleOutline" class="item-error-icon" />
                <span class="item-error-text">{{ getFriendlyItem(item).friendlyError }}</span>
              </div>
            </div>
          </div>
        </div>
      </UniSheet>

      <!-- Clear Pending Confirmation Dialog -->
      <UniDialog
        v-model:is-open="showClearPendingDialog"
        title="Clear Pending Queue?"
        description="Are you sure you want to discard all pending outbox changes? If records were already saved to Supabase (like imported students), discarding duplicate queue entries will safely resolve the 'Update Failed' state."
        confirm-text="Clear Queue"
        cancel-text="Cancel"
        type="destructive"
        @confirm="handleClearAllPending"
        @cancel="showClearPendingDialog = false"
      />

      <!-- Sync Activity Logs Sheet (Strictly Local) -->
      <UniSheet
        v-model:is-open="showAuditLogsSheet"
        title="Sync Activity Logs"
        :subtitle="`Local SQLite Diagnostics • ${auditLogsTotal} Total Entries`"
      >
        <div class="audit-sheet-content">
          <!-- Notice / Disclaimer -->
          <div class="audit-info-banner">
            <ion-icon :icon="shieldCheckmarkOutline" class="banner-icon" />
            <span>Strictly local to this device. Automatically pruned after 30 days or 5,000 entries. Never pushed to Supabase.</span>
          </div>

          <!-- Filters -->
          <div class="audit-filters-container">
            <!-- Search Input -->
            <div class="audit-search-row">
              <ion-icon :icon="searchOutline" class="search-icon" />
              <input
                v-model="auditSearchQuery"
                type="text"
                placeholder="Search entity, error, or record ID..."
                class="audit-search-input"
                @input="loadAuditLogs"
              />
              <button v-if="auditSearchQuery" class="clear-search-btn" @click="auditSearchQuery = ''; loadAuditLogs()">×</button>
            </div>

            <!-- Direction Filter -->
            <div class="filter-row">
              <span class="filter-label">Direction</span>
              <UniSegmentedControl
                :model-value="auditFilterDirection"
                :options="directionFilterOptions"
                size="sm"
                @update:model-value="(val) => { auditFilterDirection = val as any; loadAuditLogs(); }"
              />
            </div>

            <!-- Status Filter -->
            <div class="filter-row">
              <span class="filter-label">Status</span>
              <UniSegmentedControl
                :model-value="auditFilterStatus"
                :options="statusFilterOptions"
                size="sm"
                @update:model-value="(val) => { auditFilterStatus = val as any; loadAuditLogs(); }"
              />
            </div>
          </div>

          <!-- Action Toolbar -->
          <div class="audit-toolbar">
            <span class="audit-count-label">Showing {{ auditLogs.length }} of {{ auditLogsTotal }} logs</span>
            <div class="audit-toolbar-buttons">
              <UniButton variant="outline" size="sm" :icon="refreshOutline" :disabled="isLoadingAuditLogs" @click="loadAuditLogs">
                Refresh
              </UniButton>
              <UniButton variant="destructive" size="sm" :icon="trashOutline" @click="handleClearAuditLogs">
                Clear
              </UniButton>
            </div>
          </div>

          <!-- Loading State -->
          <div v-if="isLoadingAuditLogs" class="loading-state">
            <ion-spinner name="crescent" color="primary" />
            <p class="metadata-text">Loading local audit logs...</p>
          </div>

          <!-- Empty State -->
          <div v-else-if="auditLogs.length === 0" class="empty-state">
            <ion-icon :icon="documentTextOutline" class="empty-icon" />
            <p class="empty-title">No Audit Logs Found</p>
            <p class="empty-desc">Synchronization operations will appear here automatically.</p>
          </div>

          <!-- Logs List -->
          <div v-else class="audit-logs-list">
            <div
              v-for="log in auditLogs"
              :key="log.id"
              class="audit-log-item tactile-press cursor-pointer"
              @click="viewLogDetails(log)"
            >
              <div class="log-icon-col">
                <ion-icon
                  :icon="log.direction === 'PUSH' ? cloudUploadOutline : log.direction === 'PULL' ? cloudDownloadOutline : gitCompareOutline"
                  :class="`icon-${log.direction.toLowerCase()}`"
                />
              </div>
              <div class="log-info-col">
                <div class="log-title-row">
                  <span class="log-entity">{{ log.entity_type }}</span>
                  <span class="log-op-type font-mono">{{ log.operation_type }}</span>
                  <span class="badge-pill font-mono" :class="`badge-${log.status === 'SUCCESS' ? 'primary' : log.status === 'FAILED' ? 'danger' : 'warning'}`">
                    {{ log.status }}
                  </span>
                </div>
                <div class="log-meta-row font-mono">
                  <span>{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
                  <span v-if="log.duration_ms">• {{ log.duration_ms }}ms</span>
                  <span v-if="log.record_id">• ID: {{ log.record_id.substring(0, 8) }}...</span>
                </div>
                <div v-if="log.error_message" class="log-error-preview">
                  {{ log.error_message }}
                </div>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="log-arrow" />
            </div>
          </div>
        </div>
      </UniSheet>

      <!-- Log Item Detail Sheet -->
      <UniSheet
        v-model:is-open="showLogDetailSheet"
        title="Operation Details"
        :subtitle="selectedLogItem ? `${selectedLogItem.direction} • ${selectedLogItem.entity_type}` : ''"
      >
        <div v-if="selectedLogItem" class="log-detail-content font-mono">
          <div class="detail-section">
            <div class="detail-row">
              <span class="detail-key">Log ID:</span>
              <span class="detail-val">{{ selectedLogItem.id }}</span>
            </div>
            <div v-if="selectedLogItem.operation_id" class="detail-row">
              <span class="detail-key">Operation ID:</span>
              <span class="detail-val">{{ selectedLogItem.operation_id }}</span>
            </div>
            <div v-if="selectedLogItem.record_id" class="detail-row">
              <span class="detail-key">Record ID:</span>
              <span class="detail-val">{{ selectedLogItem.record_id }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-key">Attempt Number:</span>
              <span class="detail-val">{{ selectedLogItem.attempt_count ?? 1 }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-key">Timestamp:</span>
              <span class="detail-val">{{ selectedLogItem.timestamp }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-key">Direction:</span>
              <span class="detail-val">{{ selectedLogItem.direction }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-key">Entity:</span>
              <span class="detail-val">{{ selectedLogItem.entity_type }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-key">Operation:</span>
              <span class="detail-val">{{ selectedLogItem.operation_type }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-key">Status:</span>
              <span class="detail-val" :class="`text-${selectedLogItem.status === 'SUCCESS' ? 'primary' : 'danger'}`">{{ selectedLogItem.status }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-key">Duration:</span>
              <span class="detail-val">{{ selectedLogItem.duration_ms }} ms</span>
            </div>
            <div v-if="selectedLogItem.server_ack_ref" class="detail-row">
              <span class="detail-key">Server Ack:</span>
              <span class="detail-val">{{ selectedLogItem.server_ack_ref }}</span>
            </div>
            <div v-if="selectedLogItem.error_message" class="detail-row text-danger">
              <span class="detail-key">Error:</span>
              <span class="detail-val">{{ selectedLogItem.error_message }}</span>
            </div>
          </div>

          <div v-if="selectedLogItem.details_json" class="detail-json-section">
            <span class="json-header">Sanitized Payload / Context:</span>
            <pre class="json-box">{{ JSON.stringify(JSON.parse(selectedLogItem.details_json), null, 2) }}</pre>
          </div>
        </div>
      </UniSheet>

      <!-- Database Reconciliation Sheet -->
      <UniSheet
        v-model:is-open="showReconciliationSheet"
        title="Database Reconciliation"
        subtitle="Compare local SQLite vs cloud PostgreSQL"
      >
        <div class="reconciliation-content">
          <!-- Summary Banner -->
          <div
            v-if="reconciliationReport"
            class="reconciliation-summary-banner"
            :class="reconciliationReport.isHealthy ? 'banner-healthy' : 'banner-warning'"
          >
            <ion-icon :icon="reconciliationReport.isHealthy ? checkmarkCircle : alertCircleOutline" class="summary-icon" />
            <div class="summary-text">
              <span class="summary-title">{{ reconciliationReport.isHealthy ? 'Databases Fully Reconciled' : 'Discrepancies Detected' }}</span>
              <span class="summary-desc">
                {{ reconciliationReport.isHealthy
                  ? 'All local records match authoritative server records.'
                  : `${reconciliationReport.totalUnqueued} unqueued local records, ${reconciliationReport.totalConflicts} conflicts, ${reconciliationReport.totalFailed} failed operations.` }}
              </span>
            </div>
          </div>

          <!-- Reconciliation KPI Row -->
          <div v-if="reconciliationReport" class="rec-kpi-row font-mono">
            <div class="rec-kpi-item">
              <span class="kpi-num text-primary">{{ reconciliationReport.totalInSync }}</span>
              <span class="kpi-txt">In Sync</span>
            </div>
            <div class="rec-kpi-item" :class="{ 'kpi-alert': reconciliationReport.totalUnqueued > 0 }">
              <span class="kpi-num">{{ reconciliationReport.totalUnqueued }}</span>
              <span class="kpi-txt">Unqueued</span>
            </div>
            <div class="rec-kpi-item">
              <span class="kpi-num">{{ reconciliationReport.totalRemoteOnly }}</span>
              <span class="kpi-txt">Remote Only</span>
            </div>
            <div class="rec-kpi-item" :class="{ 'kpi-alert': reconciliationReport.totalFailed > 0 || reconciliationReport.totalConflicts > 0 }">
              <span class="kpi-num text-danger">{{ reconciliationReport.totalFailed + reconciliationReport.totalConflicts }}</span>
              <span class="kpi-txt">Issues</span>
            </div>
          </div>

          <!-- Loading State -->
          <div v-if="isReconciling" class="loading-state">
            <ion-spinner name="crescent" color="primary" />
            <p class="metadata-text">Scanning &amp; comparing tables...</p>
          </div>

          <!-- Entity Breakdown List -->
          <div v-else-if="reconciliationReport" class="rec-entities-list">
            <div v-for="ent in reconciliationReport.entities" :key="ent.entity" class="rec-entity-card">
              <div class="entity-header-row font-mono">
                <span class="ent-title">{{ ent.entity }}</span>
                <span class="badge-pill" :class="`badge-${ent.status === 'IN_SYNC' ? 'primary' : ent.status === 'DISCREPANCY' ? 'danger' : 'neutral'}`">
                  {{ ent.status }}
                </span>
              </div>
              <div class="entity-stats-row font-mono">
                <span>Local: {{ ent.localCount }}</span>
                <span>• Remote: {{ ent.remoteCount }}</span>
                <span>• In Sync: {{ ent.inSyncCount }}</span>
                <span v-if="ent.localUnqueuedCount > 0" class="text-danger">• Unqueued: {{ ent.localUnqueuedCount }}</span>
                <span v-if="ent.failedCount > 0" class="text-danger">• Failed: {{ ent.failedCount }}</span>
              </div>
              <div v-if="ent.errorMessage" class="entity-error-row">
                {{ ent.errorMessage }}
              </div>
            </div>
          </div>

          <!-- Action Toolbar -->
          <div class="rec-bottom-actions">
            <UniButton
              v-if="reconciliationReport?.totalUnqueued && reconciliationReport.totalUnqueued > 0"
              variant="primary"
              size="md"
              :icon="cloudUploadOutline"
              :disabled="isRepairing"
              class="btn-full-width"
              @click="handleRequeueAllUnsynced"
            >
              {{ isRepairing ? 'Queuing...' : `Queue ${reconciliationReport.totalUnqueued} Unsynced Records` }}
            </UniButton>

            <UniButton
              v-if="reconciliationReport?.totalFailed && reconciliationReport.totalFailed > 0"
              variant="outline"
              size="md"
              :icon="repeatOutline"
              :disabled="isRepairing"
              class="btn-full-width"
              @click="handleRetryFailedOps"
            >
              Retry Failed Operations ({{ reconciliationReport.totalFailed }})
            </UniButton>

            <UniButton
              variant="outline"
              size="md"
              :icon="refreshOutline"
              :disabled="isReconciling"
              class="btn-full-width"
              @click="runReconciliationScan"
            >
              {{ isReconciling ? 'Scanning...' : 'Scan Again' }}
            </UniButton>
          </div>
        </div>
      </UniSheet>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.page-container {
  padding: 4px 0 16px 0;
  max-width: 580px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.status-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--uni-radius-btn, 12px);
  background: rgba(15, 118, 110, 0.1);
  color: var(--uni-primary);
  font-size: 13px;
  font-weight: 550;
  border: 1px solid rgba(15, 118, 110, 0.2);
}

.settings-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--uni-text-secondary);
  padding: 0 4px;
}

.group-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(15, 118, 110, 0.1);
  color: var(--uni-primary);
  border: 1px solid rgba(15, 118, 110, 0.2);
}

.minimal-card {
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-card, 16px);
  box-shadow: var(--uni-shadow-card);
  box-sizing: border-box;
}

.grouped-list-card {
  padding: 0;
  overflow: hidden;
}

/* Profile Card */
.profile-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
}

.profile-avatar-box {
  width: 40px;
  height: 40px;
  color: var(--uni-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: transparent;
}

.avatar-icon {
  font-size: 38px;
}

.profile-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.profile-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.profile-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--uni-text-primary);
}

.profile-meta {
  font-size: 12px;
  color: var(--uni-text-secondary);
}

/* Appearance Card */
.appearance-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.appearance-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.appearance-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.appearance-icon {
  font-size: 18px;
}

.active-theme-label {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--uni-primary);
  background: var(--uni-surface-secondary);
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--uni-border);
}

.theme-segmented {
  width: 100%;
}

/* List Rows */
.list-item-row,
.list-action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
}

.list-action-row {
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.list-action-row:active {
  background: var(--uni-surface-secondary);
}

.row-icon-box {
  width: 24px;
  height: 24px;
  background: transparent;
  color: var(--uni-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.text-primary {
  color: var(--uni-primary);
}

.text-danger {
  color: var(--uni-danger);
}

.row-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--uni-text-primary);
  line-height: 1.25;
}

.row-desc {
  font-size: 11.5px;
  color: var(--uni-text-secondary);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-arrow {
  font-size: 16px;
  color: var(--uni-text-secondary);
  flex-shrink: 0;
}

.row-divider {
  height: 1px;
  background: var(--uni-border);
  margin-left: 52px;
}

.badge-pill {
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 9999px;
}

.badge-primary {
  background: rgba(15, 118, 110, 0.1);
  color: var(--uni-primary);
  border: 1px solid rgba(15, 118, 110, 0.2);
}

.toggle-pill {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 9999px;
  background: var(--uni-surface-secondary);
  color: var(--uni-text-secondary);
  border: 1px solid var(--uni-border);
  user-select: none;
}

.toggle-pill.is-enabled {
  background: rgba(15, 118, 110, 0.12);
  color: var(--uni-primary);
  border-color: rgba(15, 118, 110, 0.25);
}

.sync-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid transparent;
  cursor: pointer;
  background: var(--uni-primary);
  color: #FFFFFF;
  transition: opacity 0.14s ease;
}

.sync-pill:active {
  opacity: 0.85;
}

.sync-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #FFFFFF;
}

.role-badge {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.role-badge.devadmin {
  background: #fee2e2;
  color: #b91c1c;
}

.role-badge.officer {
  background: #dcfce7;
  color: #15803d;
}

.role-badge.student {
  background: #e0f2fe;
  color: #0369a1;
}

:root.dark .role-badge.devadmin,
:root.ion-palette-dark .role-badge.devadmin {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

:root.dark .role-badge.officer,
:root.ion-palette-dark .role-badge.officer {
  background: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

:root.dark .role-badge.student,
:root.ion-palette-dark .role-badge.student {
  background: rgba(56, 189, 248, 0.2);
  color: #7dd3fc;
}

.version-tag {
  font-size: 11px;
  font-weight: 600;
  color: var(--uni-text-secondary);
  background: var(--uni-surface-secondary);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--uni-border);
}

.logout-section {
  margin-top: 8px;
}

.btn-spinner {
  width: 14px;
  height: 14px;
}

/* Data Mode & Environment Selector Styles */
.data-mode-control-card {
  background: var(--uni-surface-subtle, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--uni-border, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.data-mode-control-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.data-mode-title-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.data-mode-headline {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--app-text-primary, #f8fafc);
}

.data-mode-subheadline {
  font-size: 0.76rem;
  color: var(--ion-color-primary, #14b8a6);
}

.data-mode-env-details {
  font-size: 0.72rem;
  color: var(--app-text-muted, #94a3b8);
  word-break: break-all;
}

.data-mode-toggle-btn {
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.data-mode-toggle-btn.btn-direct {
  background: rgba(20, 184, 166, 0.15);
  color: #14b8a6;
  border-color: rgba(20, 184, 166, 0.3);
}

.data-mode-toggle-btn.btn-offline {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border-color: rgba(59, 130, 246, 0.3);
}

/* Offline & Sync Section Styles */
.sync-overview-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  gap: 12px;
}

.sync-status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-indicator-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-indicator-dot.dot-synced {
  background: var(--uni-success, #34D399);
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.4);
}

.status-indicator-dot.dot-syncing {
  background: var(--uni-primary, #5EEAD4);
  box-shadow: 0 0 8px rgba(94, 234, 212, 0.4);
  animation: pulseDot 1.2s infinite ease-in-out;
}

.status-indicator-dot.dot-offline {
  background: var(--uni-text-secondary, #9CA3AF);
}

.status-indicator-dot.dot-pending {
  background: var(--uni-warning, #FBBF24);
  box-shadow: 0 0 8px rgba(251, 191, 36, 0.4);
}

.status-indicator-dot.dot-attention,
.status-indicator-dot.dot-failed {
  background: var(--uni-danger, #F87171);
  box-shadow: 0 0 8px rgba(248, 113, 113, 0.4);
}

@keyframes pulseDot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}

.status-indicator-text {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--uni-text);
}

.last-sync-caption {
  font-size: 12px;
  color: var(--uni-text-secondary);
}

.list-control-block {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.control-label {
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--uni-text-secondary);
}

.sync-btn-container {
  padding: 12px 16px 16px 16px;
}

.btn-full-width {
  width: 100%;
}

.list-action-row.no-hover {
  cursor: default;
}
.list-action-row.no-hover:hover {
  background: transparent;
}

/* Advanced Sync Sheet Content */
.advanced-sync-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.advanced-option-card {
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-card, 16px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.option-header-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.option-icon {
  font-size: 24px;
  flex-shrink: 0;
  margin-top: 2px;
}

.option-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.option-title {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--uni-text);
}

.option-desc {
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--uni-text-secondary);
}

.option-btn {
  align-self: flex-end;
}

/* Checkpoints Inline Viewer */
.checkpoints-table-wrap {
  margin: 0 16px 12px 16px;
  padding: 8px 12px;
  background: var(--uni-surface-subtle, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--uni-border-subtle, rgba(255, 255, 255, 0.08));
  border-radius: var(--uni-radius-card, 12px);
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
}

.checkpoint-item {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
  border-bottom: 1px dashed var(--uni-border-subtle, rgba(255, 255, 255, 0.06));
}

.checkpoint-item:last-child {
  border-bottom: none;
}

.checkpoint-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
}

.checkpoint-error-desc {
  font-size: 10px;
  color: #F43F5E;
  margin-top: 2px;
  line-height: 1.3;
  word-break: break-word;
}

.cp-name {
  color: var(--uni-text);
  font-weight: 600;
}

.cp-count {
  color: var(--uni-text-secondary);
}

.cp-status {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 700;
}

.cp-status-success {
  background: rgba(16, 185, 129, 0.15);
  color: #10B981;
}

.cp-status-failed {
  background: rgba(244, 63, 94, 0.15);
  color: #F43F5E;
}

.cp-status-idle {
  background: rgba(148, 163, 184, 0.15);
  color: #94A3B8;
}

.cp-status-pending_outbox {
  background: rgba(245, 158, 11, 0.15);
  color: #F59E0B;
}

/* Sync Error Callout Banner */
.sync-error-banner {
  margin: 0 16px 12px 16px;
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--uni-radius-card, 12px);
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.error-banner-icon {
  font-size: 20px;
  color: var(--uni-danger, #EF4444);
  flex-shrink: 0;
}

.error-banner-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.error-banner-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--uni-danger, #EF4444);
  letter-spacing: 0.04em;
}

.error-banner-msg {
  font-size: 12px;
  color: var(--uni-text);
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.error-banner-arrow {
  font-size: 16px;
  color: var(--uni-danger, #EF4444);
  flex-shrink: 0;
}

.pending-badge-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Pending Sheet Styles */
.pending-sheet-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 70vh;
  overflow-y: auto;
}

.pending-sheet-toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--uni-border);
}

.sheet-summary-text {
  font-size: 12.5px;
  color: var(--uni-text-secondary);
  line-height: 1.4;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.empty-pending-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 30px 16px;
  gap: 8px;
}

.empty-icon {
  font-size: 40px;
}

.empty-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--uni-text);
}

.empty-desc {
  font-size: 12.5px;
  color: var(--uni-text-secondary);
  max-width: 280px;
}

.pending-items-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pending-item-card {
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-card, 12px);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item-head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.item-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.item-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.item-friendly-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--uni-text);
}

.item-friendly-desc {
  font-size: 11.5px;
  color: var(--uni-text-secondary);
  line-height: 1.35;
}

.item-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.item-badge.badge-success {
  background: rgba(16, 185, 129, 0.15);
  color: #10B981;
}

.item-badge.badge-info {
  background: rgba(59, 130, 246, 0.15);
  color: #3B82F6;
}

.item-badge.badge-primary {
  background: var(--uni-primary-bg, rgba(15, 118, 110, 0.15));
  color: var(--uni-primary, #0F766E);
}

.item-badge.badge-warning {
  background: rgba(245, 158, 11, 0.15);
  color: #F59E0B;
}

.item-badge.badge-accent {
  background: rgba(139, 92, 246, 0.15);
  color: #8B5CF6;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.item-time {
  font-size: 11px;
  color: var(--uni-text-secondary);
}

.delete-item-btn {
  background: none;
  border: none;
  color: var(--uni-text-secondary);
  font-size: 17px;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  transition: color 0.15s ease;
}

.delete-item-btn:hover {
  color: var(--uni-danger, #EF4444);
}

.item-error-box {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.22);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.item-error-icon {
  font-size: 16px;
  color: var(--uni-danger, #EF4444);
  flex-shrink: 0;
  margin-top: 1px;
}

.item-error-text {
  font-size: 11.5px;
  color: var(--uni-danger, #EF4444);
  line-height: 1.4;
}

/* ============================================================================
   Sync Center KPI Grid & Enhanced Controls
   ============================================================================ */
.sync-timestamps {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.sync-kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 10px 14px 12px 14px;
}

@media (min-width: 640px) {
  .sync-kpi-grid {
    grid-template-columns: repeat(6, 1fr);
  }
}

.sync-kpi-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px 4px;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-btn, 10px);
  cursor: pointer;
  transition: transform 0.1s ease, border-color 0.15s ease;
}

.sync-kpi-card:active {
  transform: scale(0.97);
}

.sync-kpi-card.kpi-success {
  border-color: rgba(16, 185, 129, 0.3);
  background: rgba(16, 185, 129, 0.06);
}

.sync-kpi-card.kpi-success .kpi-value {
  color: #10B981;
}

.sync-kpi-card.kpi-warn {
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.08);
}

.sync-kpi-card.kpi-warn .kpi-value {
  color: #F59E0B;
}

.sync-kpi-card.kpi-danger {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.08);
}

.sync-kpi-card.kpi-danger .kpi-value {
  color: var(--uni-danger, #EF4444);
}

.sync-kpi-card.kpi-info {
  border-color: rgba(101, 191, 255, 0.4);
  background: rgba(101, 191, 255, 0.08);
}

.sync-kpi-card.kpi-info .kpi-value {
  color: #65BFFF;
}

.kpi-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--uni-text-primary);
}

.kpi-label {
  font-size: 9.5px;
  color: var(--uni-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin-top: 2px;
  text-align: center;
}

/* ============================================================================
   Live Sync Progress Monitor & Summary
   ============================================================================ */
.live-sync-monitor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  background: var(--uni-surface-secondary);
  border-top: 1px solid var(--uni-border);
  border-bottom: 1px solid var(--uni-border);
}

.sync-progress-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-btn, 10px);
}

.progress-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.progress-title-col {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
}

.badge-push {
  background: rgba(112, 243, 207, 0.15);
  color: var(--uni-accent-teal, #70F3CF);
  border: 1px solid rgba(112, 243, 207, 0.3);
}

.badge-pull {
  background: rgba(101, 191, 255, 0.15);
  color: #65BFFF;
  border: 1px solid rgba(101, 191, 255, 0.3);
}

.progress-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--uni-text-primary);
}

.progress-batch-tag {
  font-size: 11px;
  color: var(--uni-text-secondary);
}

.nothing-to-upload-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--uni-text-secondary);
  padding: 4px 0;
}

.progress-bar-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-track {
  width: 100%;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  transition: width 0.25s ease-out;
}

.fill-push {
  background: linear-gradient(90deg, #70F3CF 0%, #00BFA5 100%);
}

.fill-pull {
  background: linear-gradient(90deg, #65BFFF 0%, #3B82F6 100%);
}

.progress-meta-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--uni-text-secondary);
}

.progress-metrics-breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.metric-pill {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
}

.pill-success {
  background: rgba(16, 185, 129, 0.12);
  color: #10B981;
}

.pill-danger {
  background: rgba(239, 68, 68, 0.12);
  color: #EF4444;
}

.pill-warn {
  background: rgba(245, 158, 11, 0.12);
  color: #F59E0B;
}

.pill-conflict {
  background: rgba(139, 92, 246, 0.12);
  color: #A78BFA;
}

.progress-ack-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: var(--uni-text-secondary);
  margin-top: 2px;
}

.ack-icon {
  color: #10B981;
  font-size: 12px;
}

.ack-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Sync Summary Card */
.sync-summary-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 10px 14px;
  padding: 12px 14px;
  border-radius: var(--uni-radius-btn, 10px);
  border: 1px solid var(--uni-border);
  background: var(--uni-surface-secondary);
}

.summary-success,
.summary-nothing_to_sync {
  border-color: rgba(16, 185, 129, 0.3);
  background: rgba(16, 185, 129, 0.06);
}

.summary-partial {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.06);
}

.summary-failed {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.06);
}

.summary-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.summary-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.summary-status-icon {
  font-size: 20px;
}

.summary-success .summary-status-icon,
.summary-nothing_to_sync .summary-status-icon {
  color: #10B981;
}

.summary-partial .summary-status-icon {
  color: #F59E0B;
}

.summary-failed .summary-status-icon {
  color: #EF4444;
}

.summary-title-text {
  display: flex;
  flex-direction: column;
}

.summary-heading {
  font-size: 13px;
  font-weight: 700;
  color: var(--uni-text-primary);
}

.summary-subtitle {
  font-size: 10px;
  color: var(--uni-text-secondary);
}

.dismiss-summary-btn {
  background: none;
  border: none;
  color: var(--uni-text-secondary);
  font-size: 14px;
  cursor: pointer;
  padding: 4px;
}

.summary-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.summary-stat-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 2px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 6px;
}

.summary-stat-box .stat-num {
  font-size: 14px;
  font-weight: 700;
}

.summary-stat-box .stat-lbl {
  font-size: 9.5px;
  color: var(--uni-text-secondary);
}

.btn-half-width {
  flex: 1;
}

.sync-btn-container {
  display: flex;
  gap: 8px;
  padding: 8px 14px 14px 14px;
}

/* ============================================================================
   Sync Activity Logs Sheet
   ============================================================================ */
.audit-sheet-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0 16px 0;
}

.audit-info-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(15, 118, 110, 0.08);
  border: 1px solid rgba(15, 118, 110, 0.2);
  border-radius: 8px;
  font-size: 11px;
  color: var(--uni-primary);
}

.audit-info-banner .banner-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.audit-filters-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.audit-search-row {
  position: relative;
  display: flex;
  align-items: center;
}

.audit-search-row .search-icon {
  position: absolute;
  left: 10px;
  font-size: 16px;
  color: var(--uni-text-secondary);
}

.audit-search-input {
  width: 100%;
  padding: 8px 32px 8px 32px;
  border-radius: var(--uni-radius-btn, 8px);
  border: 1px solid var(--uni-border);
  background: var(--uni-surface-secondary);
  color: var(--uni-text-primary);
  font-size: 12.5px;
}

.clear-search-btn {
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  color: var(--uni-text-secondary);
  font-size: 18px;
  cursor: pointer;
}

.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.filter-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--uni-text-secondary);
  flex-shrink: 0;
  width: 60px;
}

.audit-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px solid var(--uni-border);
}

.audit-count-label {
  font-size: 11px;
  color: var(--uni-text-secondary);
}

.audit-toolbar-buttons {
  display: flex;
  gap: 6px;
}

.audit-logs-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 50vh;
  overflow-y: auto;
}

.audit-log-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 8px;
  transition: background 0.12s ease;
}

.audit-log-item:active {
  background: var(--uni-surface-active, rgba(255, 255, 255, 0.05));
}

.log-icon-col {
  font-size: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.icon-push {
  color: var(--uni-primary);
}

.icon-pull {
  color: #3B82F6;
}

.icon-reconcile {
  color: #8B5CF6;
}

.log-info-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.log-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.log-entity {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--uni-text-primary);
}

.log-op-type {
  font-size: 10.5px;
  color: var(--uni-text-secondary);
}

.log-meta-row {
  font-size: 10px;
  color: var(--uni-text-secondary);
  display: flex;
  gap: 4px;
}

.log-error-preview {
  font-size: 10.5px;
  color: var(--uni-danger, #EF4444);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}

.log-arrow {
  font-size: 14px;
  color: var(--uni-text-secondary);
  flex-shrink: 0;
}

/* ============================================================================
   Log Detail Modal Content
   ============================================================================ */
.log-detail-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 8px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  gap: 8px;
}

.detail-key {
  color: var(--uni-text-secondary);
}

.detail-val {
  color: var(--uni-text-primary);
  word-break: break-all;
  text-align: right;
}

.detail-json-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.json-header {
  font-size: 11.5px;
  color: var(--uni-text-secondary);
}

.json-box {
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 8px;
  padding: 10px;
  font-size: 10.5px;
  color: var(--uni-text-primary);
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
}

/* ============================================================================
   Reconciliation Modal Content
   ============================================================================ */
.reconciliation-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0;
}

.reconciliation-summary-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
}

.reconciliation-summary-banner.banner-healthy {
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: #10B981;
}

.reconciliation-summary-banner.banner-warning {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.25);
  color: #F59E0B;
}

.summary-icon {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 1px;
}

.summary-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.summary-title {
  font-size: 13px;
  font-weight: 700;
}

.summary-desc {
  font-size: 11px;
  color: var(--uni-text-secondary);
  line-height: 1.35;
}

.rec-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.rec-kpi-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 4px;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 8px;
}

.rec-kpi-item.kpi-alert {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
}

.kpi-num {
  font-size: 15px;
  font-weight: 700;
  color: var(--uni-text-primary);
}

.kpi-txt {
  font-size: 9.5px;
  color: var(--uni-text-secondary);
  text-transform: uppercase;
}

.rec-entities-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 40vh;
  overflow-y: auto;
}

.rec-entity-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: var(--uni-surface-secondary);
  border: 1px solid var(--uni-border);
  border-radius: 8px;
}

.entity-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ent-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--uni-text-primary);
}

.entity-stats-row {
  font-size: 10.5px;
  color: var(--uni-text-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.entity-error-row {
  font-size: 10.5px;
  color: var(--uni-danger, #EF4444);
}

.rec-bottom-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
}
</style>
