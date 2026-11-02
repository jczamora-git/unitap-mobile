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
  alertCircleOutline
} from 'ionicons/icons';
import { useNfc } from '@/composables/useNfc';
import { useOnboarding } from '@/composables/useOnboarding';
import { useTheme, type ThemePreference } from '@/composables/useTheme';
import { useSyncPreferences } from '@/composables/useSyncPreferences';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { clearLocalDatabase } from '@/database/database';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import type { Semester, AcademicYear, SyncOutboxRecord } from '@/types/database';
import { demoDataService } from '@/services/demo-data.service';
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
    case 'Updating': return 'syncing';
    case 'Offline': return 'offline';
    case 'Waiting to Sync': return 'pending';
    case 'Needs Attention': return 'attention';
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
  isDemoLoaded.value = await demoDataService.isDemoDataLoaded();
}

onMounted(checkStatus);

async function handleConfirmSignOut() {
  showSignOutAlert.value = false;
  haptics.medium();
  try {
    await authService.logout();
    router.replace('/login');
  } catch (err) {
    console.error('Sign out error:', err);
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

    <ion-content class="safe-content">
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

        <!-- 4. OFFLINE & SYNC -->
        <section class="settings-group">
          <div class="group-header">
            <span>Offline &amp; Synchronization</span>
          </div>

          <div class="grouped-list-card minimal-card">
            <!-- Sync Status Header Row -->
            <div class="sync-overview-row">
              <div class="sync-status-indicator">
                <span class="status-indicator-dot" :class="`dot-${syncStatusClass}`"></span>
                <span class="status-indicator-text">{{ syncStatus }}</span>
              </div>
              <span class="last-sync-caption">Last Updated: {{ formattedLastSync }}</span>
            </div>

            <!-- Sync Error Banner if lastError exists -->
            <div
              v-if="lastError && syncStatus === 'Update Failed'"
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
                <span class="row-desc">Tap to inspect outbox logs &amp; queue</span>
              </div>
              <div class="pending-badge-row">
                <span class="badge-pill font-mono" :class="pendingCount > 0 ? 'badge-warning' : 'badge-neutral'">
                  {{ pendingCount }}
                </span>
                <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
              </div>
            </div>

            <!-- Sync Now Button -->
            <div class="sync-btn-container">
              <UniButton
                variant="primary"
                size="md"
                :disabled="isSyncing || syncStatus === 'Offline'"
                :icon="syncOutline"
                class="btn-full-width"
                @click="onSyncNow"
              >
                {{ isSyncing ? 'Updating...' : 'Sync Now' }}
              </UniButton>
            </div>

            <div class="row-divider"></div>

            <!-- Advanced Sync Options (Refresh Local Data & Diagnostics) -->
            <div class="list-action-row" @click="showAdvancedSyncSheet = true">
              <div class="row-icon-box">
                <ion-icon :icon="optionsOutline" />
              </div>
              <div class="row-content">
                <span class="row-title">Advanced Sync Options</span>
                <span class="row-desc">Refresh local data &amp; system diagnostics</span>
              </div>
              <ion-icon :icon="chevronForwardOutline" class="row-arrow" />
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
    </ion-content>
  </ion-page>
</template>

<style scoped>
.page-container {
  padding: 4px 0 calc(96px + var(--ion-safe-area-bottom, 0px)) 0;
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
</style>
