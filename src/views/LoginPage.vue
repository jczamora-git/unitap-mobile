<template>
  <ion-page>
    <ion-content :fullscreen="true" class="login-content">
      <div class="login-shell">
        <!-- Hero Header -->
        <div class="login-hero">
          <div class="brand">
            <div class="brandmark">◈</div>
            <div class="brand-text">
              <span class="brand-title">UniTap</span>
              <span class="brand-version">2.0</span>
            </div>
          </div>
          <div class="hero-body">
            <div class="eyebrow">OFFLINE-FIRST CAMPUS OS</div>
            <h1>Every tap. Secure & organized.</h1>
            <p>One identity for every semester. Offline event attendance, academic history, and transparent fines & contributions.</p>
          </div>
          <div class="offline-pill">
            <span class="dot"></span> OFFLINE OPERATION READY
          </div>
        </div>

        <!-- Form Card Container -->
        <div class="login-card-container">
          <div class="login-card">
            <!-- Tabs -->
            <div class="tabs-nav">
              <button
                type="button"
                :class="{ active: activeTab === 'signin' }"
                @click="activeTab = 'signin'"
              >
                Sign In
              </button>
              <button
                type="button"
                :class="{ active: activeTab === 'activate' }"
                @click="activeTab = 'activate'"
              >
                Student Activate
              </button>
              <button
                v-if="!hasAdminConfigured"
                type="button"
                :class="{ active: activeTab === 'setup' }"
                @click="activeTab = 'setup'"
              >
                Initial Admin
              </button>
            </div>

            <!-- Sign In Form -->
            <form v-if="activeTab === 'signin'" @submit.prevent="handleSignIn" class="auth-form">
              <h2 class="form-title">Welcome back</h2>
              <p class="form-sub">Sign in to manage your UniTap profile, attendance, and campus activities.</p>

              <div v-if="errorMessage" class="error-banner">
                {{ errorMessage }}
              </div>

              <div class="form-group">
                <label for="login-id">School ID or Username</label>
                <input
                  id="login-id"
                  v-model="loginIdentifier"
                  type="text"
                  placeholder="e.g. 2026-0001 or devadmin"
                  required
                  autocomplete="username"
                  class="custom-input"
                />
              </div>

              <div class="form-group">
                <label for="login-password">Password</label>
                <div class="password-wrapper">
                  <input
                    id="login-password"
                    v-model="loginPassword"
                    :type="showPassword ? 'text' : 'password'"
                    placeholder="Enter your password"
                    required
                    autocomplete="current-password"
                    class="custom-input"
                  />
                  <button type="button" class="btn-toggle-pass" @click="showPassword = !showPassword">
                    {{ showPassword ? 'Hide' : 'Show' }}
                  </button>
                </div>
              </div>

              <button type="submit" class="btn-primary" :disabled="loading">
                <span v-if="loading">Signing in...</span>
                <span v-else>Sign In →</span>
              </button>

              <div class="form-footer">
                <span>New student? </span>
                <button type="button" class="btn-link" @click="activeTab = 'activate'">
                  Activate your account
                </button>
              </div>
            </form>

            <!-- Student Activation Form -->
            <form v-else-if="activeTab === 'activate'" @submit.prevent="handleActivate" class="auth-form">
              <h2 class="form-title">Activate student account</h2>
              <p class="form-sub">Only enrolled students in the official roster can activate their student account.</p>

              <div v-if="errorMessage" class="error-banner">
                {{ errorMessage }}
              </div>
              <div v-if="successMessage" class="success-banner">
                {{ successMessage }}
              </div>

              <div class="form-group">
                <label for="act-school-id">School ID</label>
                <input
                  id="act-school-id"
                  v-model="actSchoolId"
                  type="text"
                  placeholder="e.g. 2026-0001"
                  required
                  class="custom-input"
                />
              </div>

              <div class="form-group">
                <label for="act-code">Activation Code</label>
                <input
                  id="act-code"
                  v-model="actCode"
                  type="text"
                  placeholder="Provided by an authorized officer"
                  required
                  class="custom-input"
                />
              </div>

              <div class="form-group">
                <label for="act-password">Create Password</label>
                <div class="password-wrapper">
                  <input
                    id="act-password"
                    v-model="actPassword"
                    :type="showActPassword ? 'text' : 'password'"
                    placeholder="At least 8 characters"
                    minlength="8"
                    required
                    class="custom-input"
                  />
                  <button type="button" class="btn-toggle-pass" @click="showActPassword = !showActPassword">
                    {{ showActPassword ? 'Hide' : 'Show' }}
                  </button>
                </div>
              </div>

              <div class="form-group">
                <label for="act-confirm">Confirm Password</label>
                <input
                  id="act-confirm"
                  v-model="actConfirmPassword"
                  type="password"
                  placeholder="Re-enter password"
                  minlength="8"
                  required
                  class="custom-input"
                />
              </div>

              <button type="submit" class="btn-primary" :disabled="loading">
                <span v-if="loading">Activating...</span>
                <span v-else>Activate Student Account →</span>
              </button>

              <div class="form-footer">
                <span>Already activated? </span>
                <button type="button" class="btn-link" @click="activeTab = 'signin'">
                  Back to Sign In
                </button>
              </div>
            </form>

            <!-- Initial DevAdmin Setup Form -->
            <form v-else-if="activeTab === 'setup'" @submit.prevent="handleInitialSetup" class="auth-form">
              <h2 class="form-title">Initial Admin Setup</h2>
              <p class="form-sub">No administrator is provisioned yet. Set the initial password for <strong>devadmin</strong>.</p>

              <div v-if="errorMessage" class="error-banner">
                {{ errorMessage }}
              </div>
              <div v-if="successMessage" class="success-banner">
                {{ successMessage }}
              </div>

              <div class="form-group">
                <label for="setup-password">Admin Password</label>
                <div class="password-wrapper">
                  <input
                    id="setup-password"
                    v-model="setupPassword"
                    :type="showSetupPassword ? 'text' : 'password'"
                    placeholder="Enter strong admin password"
                    minlength="8"
                    required
                    class="custom-input"
                  />
                  <button type="button" class="btn-toggle-pass" @click="showSetupPassword = !showSetupPassword">
                    {{ showSetupPassword ? 'Hide' : 'Show' }}
                  </button>
                </div>
              </div>

              <button type="submit" class="btn-primary" :disabled="loading">
                <span v-if="loading">Provisioning...</span>
                <span v-else>Provision DEVADMIN Account →</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent } from '@ionic/vue';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { InitialSyncService } from '@/services/sync/initial-sync.service';
import { SyncManager } from '@/services/sync/sync-manager';
import { LegacyMigrationService } from '@/services/legacy-migration.service';

const router = useRouter();

const activeTab = ref<'signin' | 'activate' | 'setup'>('signin');
const hasAdminConfigured = ref(true);
const loading = ref(false);
const errorMessage = ref('');
const successMessage = ref('');

// Sign In
const loginIdentifier = ref('');
const loginPassword = ref('');
const showPassword = ref(false);

// Activate
const actSchoolId = ref('');
const actCode = ref('');
const actPassword = ref('');
const actConfirmPassword = ref('');
const showActPassword = ref(false);

// Initial Setup
const setupPassword = ref('');
const showSetupPassword = ref(false);

onMounted(async () => {
  // Check migration & admin setup
  await LegacyMigrationService.runMigrationIfNeeded();
  const configured = await authService.isDevAdminConfigured();
  hasAdminConfigured.value = configured;
  if (!configured) {
    activeTab.value = 'setup';
  }
});

async function handleSignIn() {
  errorMessage.value = '';
  loading.value = true;
  try {
    // 1. Try Supabase Auth first
    let res = await SupabaseAuthService.login(loginIdentifier.value, loginPassword.value);

    // 2. Fallback to local auth if Supabase Auth is not provisioned or during local dev test
    if (!res.success) {
      const localRes = await authService.login(loginIdentifier.value, loginPassword.value);
      if (localRes.success) {
        res = { success: true, role: localRes.role };
      }
    }

    if (res.success) {
      SyncManager.start();

      // Check if local database has completed initial hydration
      const hydrated = await InitialSyncService.isHydrated();
      if (!hydrated && !res.isOffline) {
        router.replace('/initial-sync');
      } else {
        router.replace('/tabs/home');
      }
    } else {
      errorMessage.value = res.error || 'Failed to sign in.';
    }
  } catch (err: unknown) {
    errorMessage.value = (err as Error).message || 'An unexpected error occurred.';
  } finally {
    loading.value = false;
  }
}

async function handleActivate() {
  errorMessage.value = '';
  successMessage.value = '';

  if (actPassword.value !== actConfirmPassword.value) {
    errorMessage.value = 'Passwords do not match.';
    return;
  }

  loading.value = true;
  try {
    await authService.activateStudentAccount(actSchoolId.value, actCode.value, actPassword.value);
    successMessage.value = 'Account successfully activated! You can now sign in.';
    loginIdentifier.value = actSchoolId.value;
    activeTab.value = 'signin';
  } catch (err: unknown) {
    errorMessage.value = (err as Error).message || 'Activation failed.';
  } finally {
    loading.value = false;
  }
}

async function handleInitialSetup() {
  errorMessage.value = '';
  successMessage.value = '';
  loading.value = true;
  try {
    await authService.setupInitialDevAdmin(setupPassword.value);
    hasAdminConfigured.value = true;
    successMessage.value = 'DEVADMIN successfully provisioned. You may now sign in with username: devadmin';
    loginIdentifier.value = 'devadmin';
    activeTab.value = 'signin';
  } catch (err: unknown) {
    errorMessage.value = (err as Error).message || 'Setup failed.';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-content {
  --background: var(--uni-background, #F8FAFC);
}

.login-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

@media (min-width: 768px) {
  .login-shell {
    display: grid;
    grid-template-columns: 45% 55%;
  }
}

.login-hero {
  background: linear-gradient(145deg, #0b2535 0%, #0d3c43 50%, #0f766e 100%);
  color: white;
  padding: 36px 28px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brandmark {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: #9fe7d8;
}

.brand-title {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.5px;
}

.brand-version {
  font-size: 11px;
  color: #a7f3d0;
  margin-left: 6px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.1);
  padding: 2px 6px;
  border-radius: 6px;
}

.hero-body h1 {
  font-size: 28px;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -1px;
  margin: 12px 0 8px;
}

.hero-body p {
  font-size: 14px;
  color: #d4e9e9;
  line-height: 1.6;
}

.eyebrow {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1.5px;
  color: #9fe7d8;
}

.offline-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(204, 251, 241, 0.2);
  border: 1px solid rgba(167, 243, 208, 0.3);
  color: #a7f3d0;
  font-size: 11px;
  font-weight: 800;
  padding: 8px 14px;
  border-radius: 9999px;
  align-self: flex-start;
}

.offline-pill .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #34d399;
}

.login-card-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px 48px;
}

.login-card {
  width: 100%;
  max-width: 440px;
}

.tabs-nav {
  display: flex;
  background: #e2e8f0;
  padding: 4px;
  border-radius: 12px;
  gap: 4px;
  margin-bottom: 24px;
}

.tabs-nav button {
  flex: 1;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #64748b;
  font-size: 13px;
  font-weight: 700;
  padding: 10px 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tabs-nav button.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

.auth-form {
  background: #ffffff;
  padding: 24px;
  border-radius: 18px;
  border: 1px solid var(--uni-border, #CBD5E1);
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
}

.form-title {
  font-size: 22px;
  font-weight: 800;
  color: var(--uni-ink, #0F172A);
  margin: 0 0 6px;
}

.form-sub {
  font-size: 13px;
  color: var(--uni-muted, #64748B);
  margin: 0 0 20px;
  line-height: 1.5;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: #334155;
  margin-bottom: 6px;
}

.custom-input {
  width: 100%;
  padding: 12px 14px;
  border: 1.5px solid var(--uni-border, #CBD5E1);
  border-radius: 12px;
  font-size: 14px;
  color: var(--uni-ink, #0F172A);
  background: #ffffff;
  outline: none;
  box-sizing: border-box;
}

.custom-input:focus {
  border-color: var(--uni-primary, #0F766E);
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
}

.password-wrapper {
  position: relative;
}

.btn-toggle-pass {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: 0;
  color: var(--uni-primary, #0F766E);
  font-size: 12px;
  font-weight: 700;
  padding: 6px 8px;
  cursor: pointer;
}

.btn-primary {
  width: 100%;
  background: var(--uni-primary, #0F766E);
  color: #ffffff;
  border: 0;
  border-radius: 12px;
  padding: 14px;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  margin-top: 8px;
  box-shadow: 0 4px 12px rgba(15, 118, 110, 0.2);
}

.btn-primary:hover {
  background: var(--uni-primary-dark, #115E59);
}

.btn-primary:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.form-footer {
  text-align: center;
  font-size: 12px;
  color: var(--uni-muted, #64748B);
  margin-top: 18px;
}

.btn-link {
  background: none;
  border: 0;
  color: var(--uni-primary, #0F766E);
  font-weight: 700;
  cursor: pointer;
  padding: 0;
}

.error-banner {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: var(--uni-danger, #B91C1C);
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12px;
  margin-bottom: 16px;
  line-height: 1.4;
}

.success-banner {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: var(--uni-success, #047857);
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12px;
  margin-bottom: 16px;
  line-height: 1.4;
}
</style>

