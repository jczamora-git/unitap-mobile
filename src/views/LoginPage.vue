<template>
  <ion-page>
    <ion-content :fullscreen="true" class="login-content">
      <div class="login-shell">
        <!-- Top Navigation Bar -->
        <header class="top-nav-bar">
          <div class="brand-cluster">
            <img src="/unitap-logo.png" alt="UniTap" class="brand-avatar" />
            <span class="brand-name">UniTap</span>
          </div>
        </header>

        <!-- Main Body: Centered vertically with comfortable gap for balanced mobile composition -->
        <main class="login-body">
          <!-- Hero Section: Headline matching UniTap NFC attendance & verification -->
          <section class="hero-section">
            <div class="hero-text-block">
              <h1 class="hero-headline">
                Every tap. <br />
                <span class="headline-inline-row">
                  <ion-icon :icon="cardOutline" class="headline-inline-icon" aria-hidden="true" />
                  <span class="headline-mid">Campus Attendance</span>
                </span> <br />
                <span class="highlight-text">Fast &amp; Verified</span>
              </h1>
            </div>
          </section>

          <!-- Form Section: Balanced layout with left-aligned controls -->
          <section class="form-section">
            <!-- Cloud Mode Notice -->
            <div v-if="route.query.mode === 'cloud'" class="alert-box alert-info" role="status">
              <ion-icon :icon="informationCircleOutline" class="alert-icon" />
              <span>Cloud Sign-In: Authenticate with your Supabase account to continue.</span>
            </div>

            <!-- Error Alert -->
            <div v-if="errorMessage" class="alert-box alert-error" role="alert">
              <ion-icon :icon="informationCircleOutline" class="alert-icon" />
              <span>{{ errorMessage }}</span>
            </div>

            <!-- SIGN IN FORM -->
            <form @submit.prevent="handleSignIn" class="form-flow">
              <!-- Identifier Input -->
              <div class="form-group">
                <label for="login-id" class="input-label">Email or School ID</label>
                <div class="modern-input-box">
                  <ion-icon :icon="mailOutline" class="input-lead-icon" />
                  <span class="input-pipe" aria-hidden="true"></span>
                  <input
                    id="login-id"
                    v-model="loginIdentifier"
                    type="text"
                    placeholder="example@gmail.com"
                    required
                    autocomplete="username"
                    class="clean-input"
                  />
                </div>
              </div>

              <!-- Password Input -->
              <div class="form-group">
                <label for="login-password" class="input-label">Password</label>
                <div class="modern-input-box">
                  <ion-icon :icon="lockClosedOutline" class="input-lead-icon" />
                  <span class="input-pipe" aria-hidden="true"></span>
                  <input
                    id="login-password"
                    v-model="loginPassword"
                    :type="showPassword ? 'text' : 'password'"
                    placeholder="••••••••••••"
                    required
                    autocomplete="current-password"
                    class="clean-input"
                  />
                  <button 
                    type="button" 
                    class="btn-eye-toggle" 
                    :aria-label="showPassword ? 'Hide password' : 'Show password'"
                    @click="showPassword = !showPassword"
                  >
                    <ion-icon :icon="showPassword ? eyeOffOutline : eyeOutline" class="eye-icon" />
                    <span class="eye-text">{{ showPassword ? 'Hide' : 'Show' }}</span>
                  </button>
                </div>
              </div>

              <!-- Primary Login Button with Chevron -->
              <button type="submit" class="modern-login-btn" :disabled="loading">
                <ion-spinner v-if="loading" name="crescent" class="btn-spinner" />
                <template v-else>
                  <span class="btn-text">Login</span>
                  <ion-icon :icon="chevronForwardOutline" class="btn-chevron" />
                </template>
              </button>

              <!-- Clean Minimal Helper Style -->
              <div class="helper-footer">
                <span class="helper-text">Don't have an account? </span>
                <button type="button" class="btn-text-link" @click="router.push('/register')">
                  Activate account
                </button>
              </div>
            </form>
          </section>
        </main>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { IonPage, IonContent, IonIcon, IonSpinner, onIonViewDidEnter, onIonViewWillLeave } from '@ionic/vue';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import {
  cardOutline,
  mailOutline,
  lockClosedOutline,
  eyeOutline,
  eyeOffOutline,
  chevronForwardOutline,
  informationCircleOutline,
} from 'ionicons/icons';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { InitialSyncService } from '@/services/sync/initial-sync.service';
import { SyncManager } from '@/services/sync/sync-manager';
import { LegacyMigrationService } from '@/services/legacy-migration.service';
import { DataModeService } from '@/services/data-mode.service';

const router = useRouter();
const route = useRoute();

const loading = ref(false);
const errorMessage = ref('');

// Sign In
const loginIdentifier = ref('');
const loginPassword = ref('');
const showPassword = ref(false);

onMounted(async () => {
  await LegacyMigrationService.runMigrationIfNeeded();
});

onIonViewDidEnter(async () => {
  if (Capacitor.isNativePlatform()) {
    try {
      await StatusBar.setStyle({ style: Style.Light });
    } catch (_) {}
  }
});

onIonViewWillLeave(async () => {
  if (Capacitor.isNativePlatform()) {
    try {
      const isDark = document.documentElement.classList.contains('dark') || document.documentElement.classList.contains('ion-palette-dark');
      await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
    } catch (_) {}
  }
});

async function handleSignIn() {
  errorMessage.value = '';
  loading.value = true;
  try {
    const redirectTarget = (route.query.redirect as string) || '/tabs/home';

    // 1. In Direct Supabase Mode: Require authentic Supabase Auth session (NEVER fall back to SQLite)
    if (DataModeService.isDirectSupabase()) {
      const res = await SupabaseAuthService.login(loginIdentifier.value, loginPassword.value);
      if (!res.success) {
        errorMessage.value = res.error || 'Failed to authenticate with Supabase Auth. Please check your credentials.';
        return;
      }

      const activeUserId = SupabaseAuthService.user.value?.id || 'dev_user';
      await SyncManager.start(activeUserId);
      router.replace(redirectTarget);
      return;
    }

    // 2. In Offline-First Mode: Try Supabase Auth first, then local SQLite fallback
    let res = await SupabaseAuthService.login(loginIdentifier.value, loginPassword.value);
    if (!res.success) {
      const localRes = await authService.login(loginIdentifier.value, loginPassword.value);
      if (localRes.success) {
        res = { success: true, role: localRes.role, isOffline: true };
      }
    }

    if (res.success) {
      const activeUserId = SupabaseAuthService.user.value?.id || authService.user.value?.id || 'dev_user';
      await SyncManager.start(activeUserId);

      // Check if local database has completed initial hydration for this user
      const hydrated = await InitialSyncService.isHydrated(activeUserId);
      if (!hydrated && !res.isOffline) {
        router.replace('/initial-sync');
      } else {
        router.replace(redirectTarget);
      }
    } else {
      errorMessage.value = res.error || 'Failed to sign in. Please verify your credentials.';
    }
  } catch (err: unknown) {
    errorMessage.value = (err as Error).message || 'An unexpected error occurred.';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
/* Clean pure white background matching reference design */
.login-content {
  --background: #FFFFFF;
  background: #FFFFFF;
}

.login-content::part(scroll) {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100%;
  background: #FFFFFF;
}

.login-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  min-height: 100%;
  padding-top: calc(24px + var(--ion-safe-area-top, env(safe-area-inset-top, 0px)));
  padding-bottom: calc(36px + var(--ion-safe-area-bottom, 0px));
  padding-left: 28px;
  padding-right: 28px;
  max-width: 440px;
  margin: 0 auto;
  box-sizing: border-box;
  background: #FFFFFF;
}

@media (max-width: 380px) {
  .login-shell {
    padding-top: calc(18px + var(--ion-safe-area-top, env(safe-area-inset-top, 0px)));
    padding-bottom: calc(28px + var(--ion-safe-area-bottom, 0px));
    padding-left: 20px;
    padding-right: 20px;
  }
}

/* Top Navigation Bar */
.top-nav-bar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 6px 0 16px;
  flex-shrink: 0;
}

.brand-cluster {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-avatar {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  object-fit: contain;
}

.brand-name {
  font-size: 18px;
  font-weight: 750;
  letter-spacing: -0.02em;
  color: #0F172A;
}

/* Main Body: Balanced vertical layout, centered content block, left-aligned text */
.login-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  justify-content: center;
  padding: 16px 0 24px;
  gap: 32px;
  width: 100%;
  text-align: left;
}

/* Hero Section: Big bold headline */
.hero-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  flex-shrink: 0;
}

.hero-text-block {
  width: 100%;
  text-align: left;
}

.hero-headline {
  font-size: clamp(28px, 7.5vw, 34px);
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.03em;
  color: #0F172A;
  margin: 0;
  text-align: left;
}

.headline-inline-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.headline-inline-icon {
  font-size: 26px;
  color: #0F172A;
  flex-shrink: 0;
}

.headline-mid {
  font-weight: 800;
  color: #0F172A;
}

.highlight-text {
  color: #0F766E;
  display: inline-block;
  font-weight: 800;
}

/* Form Section: Balanced layout with left-aligned inputs */
.form-section {
  display: flex;
  flex-direction: column;
  padding-bottom: 8px;
  flex-shrink: 0;
  text-align: left;
}

.form-flow {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-label {
  font-size: 13px;
  font-weight: 650;
  color: #0F172A;
  letter-spacing: -0.01em;
}

/* Modern Input Box (Matches Image 1 reference) */
.modern-input-box {
  display: flex;
  align-items: center;
  height: 50px;
  border-radius: 16px;
  background: #F8FAFC;
  border: 1.5px solid #E2E8F0;
  padding: 0 16px;
  gap: 12px;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.modern-input-box:focus-within {
  border-color: #0F766E;
  background: #FFFFFF;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
}

.input-lead-icon {
  font-size: 19px;
  color: #64748B;
  flex-shrink: 0;
}

.input-pipe {
  width: 1px;
  height: 20px;
  background: #CBD5E1;
  flex-shrink: 0;
}

.clean-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  outline: none;
  font-size: 14px;
  color: #0F172A;
  font-family: inherit;
}

.clean-input::placeholder {
  color: #94A3B8;
  font-size: 13.5px;
}

/* Password Eye / Show toggle */
.btn-eye-toggle {
  background: transparent;
  border: 0;
  padding: 4px 6px;
  display: flex;
  align-items: center;
  gap: 5px;
  color: #64748B;
  cursor: pointer;
  border-radius: 6px;
  transition: color 0.15s ease;
}

.btn-eye-toggle:hover {
  color: #0F766E;
}

.eye-icon {
  font-size: 17px;
}

.eye-text {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

/* Modern Login Pill Button (Matches Image 1 reference) */
.modern-login-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 52px;
  border-radius: 9999px;
  background: #18191E;
  color: #FFFFFF;
  border: 0;
  padding: 0 24px;
  font-size: 14.5px;
  font-weight: 650;
  cursor: pointer;
  margin-top: 6px;
  transition: transform 0.15s ease, background 0.15s ease;
}

.modern-login-btn:hover:not(:disabled) {
  background: #272B33;
}

.modern-login-btn:active:not(:disabled) {
  transform: scale(0.985);
}

.modern-login-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-chevron {
  font-size: 19px;
}

.btn-spinner {
  margin: 0 auto;
}

/* Helper Footer */
.helper-footer {
  text-align: center;
  font-size: 13px;
  color: #64748B;
  margin-top: 6px;
}

.helper-text {
  color: #64748B;
}

.btn-text-link {
  background: transparent;
  border: 0;
  color: #0F766E;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
  font-size: 13px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.btn-text-link:hover {
  color: #115E59;
}

/* Alert Boxes */
.alert-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 12.5px;
  font-weight: 550;
  line-height: 1.4;
  margin-bottom: 12px;
}

.alert-error {
  background: #FEF2F2;
  border: 1px solid #FECACA;
  color: #B91C1C;
}

.alert-info {
  background: #F0FDF4;
  border: 1px solid #BBF7D0;
  color: #166534;
}

.alert-icon {
  font-size: 18px;
  flex-shrink: 0;
}
</style>
