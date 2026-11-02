<template>
  <ion-page>
    <ion-content :fullscreen="true" class="register-content">
      <div class="register-shell">
        <!-- Top Navigation Bar -->
        <header class="top-nav-bar">
          <button
            type="button"
            class="back-btn"
            aria-label="Back"
            @click="handleBack"
          >
            <ion-icon :icon="chevronBackOutline" class="back-icon" />
          </button>

          <div class="header-center">
            <span class="header-brand-title">Student Activation</span>
          </div>

          <div class="header-spacer" aria-hidden="true"></div>
        </header>

        <!-- Segmented Step Progress Bar (6 Separate Steps) -->
        <div class="stepper-progress-wrap" role="progressbar" :aria-valuenow="currentStep" aria-valuemin="1" aria-valuemax="6">
          <div class="step-segments-track">
            <div :class="['step-bar-segment', { active: currentStep >= 1 }]"></div>
            <div :class="['step-bar-segment', { active: currentStep >= 2 }]"></div>
            <div :class="['step-bar-segment', { active: currentStep >= 3 }]"></div>
            <div :class="['step-bar-segment', { active: currentStep >= 4 }]"></div>
            <div :class="['step-bar-segment', { active: currentStep >= 5 }]"></div>
            <div :class="['step-bar-segment', { active: currentStep >= 6 }]"></div>
          </div>
        </div>

        <!-- Main Body: Centered vertically with comfortable gap for balanced composition -->
        <main class="register-body">
          <!-- Global Error Alert -->
          <div v-if="errorMessage" class="alert-box alert-error" role="alert">
            <ion-icon :icon="informationCircleOutline" class="alert-icon" />
            <span>{{ errorMessage }}</span>
          </div>

          <!-- STEP 1: School ID -->
          <section v-show="currentStep === 1" class="step-section">
            <div class="step-header">
              <h1 class="step-headline">
                Enter your <br />
                <span class="highlight-text">School ID</span>
              </h1>
              <p class="step-sub">
                This is your official university student ID issued for your student record.
              </p>
            </div>

            <div class="step-form-block">
              <div class="form-group">
                <label for="reg-school-id" class="input-label">School ID</label>
                <div class="modern-input-box">
                  <ion-icon :icon="schoolOutline" class="input-lead-icon" />
                  <span class="input-pipe" aria-hidden="true"></span>
                  <input
                    id="reg-school-id"
                    v-model="schoolId"
                    type="text"
                    placeholder="e.g. 2026-0001"
                    required
                    autocomplete="username"
                    class="clean-input font-mono"
                    @input="onSchoolIdChange"
                    @keydown.enter.prevent="nextStep"
                  />
                </div>
                <span class="field-hint">Matches your university student ID card</span>
              </div>

              <!-- Primary Action Button -->
              <button type="button" class="modern-action-btn" @click="nextStep">
                <span class="btn-text">Continue</span>
                <ion-icon :icon="chevronForwardOutline" class="btn-chevron" />
              </button>

              <!-- Helper Footer -->
              <div class="helper-footer">
                <span class="helper-text">Already have an active account? </span>
                <button type="button" class="btn-text-link" @click="router.push('/login')">
                  Sign In
                </button>
              </div>
            </div>
          </section>

          <!-- STEP 2: Activation Code -->
          <section v-show="currentStep === 2" class="step-section">
            <div class="step-header">
              <h1 class="step-headline">
                Enter your <br />
                <span class="highlight-text">Activation Code</span>
              </h1>
              <p class="step-sub">
                Enter the 8-character single-use code issued by authorized university personnel.
              </p>
            </div>

            <div class="step-form-block">
              <div class="form-group">
                <label for="reg-activation-code" class="input-label">Activation Code</label>
                <div
                  class="modern-input-box"
                  :class="{
                    'box-success': isCodeValid,
                    'box-error': codeCheckError
                  }"
                >
                  <ion-icon :icon="keyOutline" class="input-lead-icon" />
                  <span class="input-pipe" aria-hidden="true"></span>
                  <input
                    id="reg-activation-code"
                    :value="activationCode"
                    type="text"
                    placeholder="8-character code"
                    maxlength="8"
                    required
                    autocomplete="off"
                    class="clean-input font-mono tracking-wider"
                    @input="formatActivationCode"
                    @keydown.enter.prevent="handleStep2Continue"
                  />
                  <!-- Status Indicator Inside Input Box -->
                  <div class="input-status-slot">
                    <ion-spinner v-if="isCheckingCode" name="crescent" class="input-inline-spinner" />
                    <ion-icon v-else-if="isCodeValid" :icon="checkmarkCircle" class="input-success-icon" />
                    <ion-icon v-else-if="codeCheckError" :icon="alertCircle" class="input-error-icon" />
                  </div>
                </div>

                <!-- Status Feedback Message Below Input -->
                <div v-if="isCheckingCode" class="field-feedback checking">
                  <ion-spinner name="dots" class="feedback-spinner" />
                  <span>Checking database records...</span>
                </div>
                <div v-else-if="isCodeValid" class="field-feedback success">
                  <ion-icon :icon="checkmarkCircleOutline" class="feedback-icon" />
                  <span>Verified: <strong>{{ verifiedStudentName }}</strong></span>
                </div>
                <div v-else-if="codeCheckError" class="field-feedback error">
                  <ion-icon :icon="alertCircleOutline" class="feedback-icon" />
                  <span>{{ codeCheckError }}</span>
                </div>
                <span v-else class="field-hint">Single-use code issued by authorized university personnel</span>
              </div>

              <!-- Primary Action Button -->
              <button
                type="button"
                class="modern-action-btn"
                :disabled="!isCodeValid || isCheckingCode"
                @click="nextStep"
              >
                <span class="btn-text">Continue</span>
                <ion-icon :icon="chevronForwardOutline" class="btn-chevron" />
              </button>
            </div>
          </section>

          <!-- STEP 3: Email Address -->
          <section v-show="currentStep === 3" class="step-section">
            <div class="step-header">
              <h1 class="step-headline">
                Your University or <br />
                <span class="highlight-text">Email Address</span>
              </h1>
              <p class="step-sub">
                Used for sign in, notifications, password recovery, and academic attendance logs.
              </p>
            </div>

            <div class="step-form-block">
              <div class="form-group">
                <label for="reg-email" class="input-label">Email Address</label>
                <div class="modern-input-box">
                  <ion-icon :icon="mailOutline" class="input-lead-icon" />
                  <span class="input-pipe" aria-hidden="true"></span>
                  <input
                    id="reg-email"
                    v-model="email"
                    type="email"
                    placeholder="student@university.edu.ph"
                    required
                    autocomplete="email"
                    class="clean-input"
                    @keydown.enter.prevent="nextStep"
                  />
                </div>
                <span class="field-hint">Used for sign in, notifications, and account recovery</span>
              </div>

              <!-- Primary Action Button -->
              <button type="button" class="modern-action-btn" @click="nextStep">
                <span class="btn-text">Continue</span>
                <ion-icon :icon="chevronForwardOutline" class="btn-chevron" />
              </button>
            </div>
          </section>

          <!-- STEP 4: Password & Confirm Password -->
          <section v-show="currentStep === 4" class="step-section">
            <div class="step-header">
              <h1 class="step-headline">
                Create your <br />
                <span class="highlight-text">Password</span>
              </h1>
              <p class="step-sub">
                Set a strong password with at least 8 characters to secure your UniTap profile.
              </p>
            </div>

            <div class="step-form-block">
              <!-- Password -->
              <div class="form-group">
                <label for="reg-password" class="input-label">Password</label>
                <div class="modern-input-box">
                  <ion-icon :icon="lockClosedOutline" class="input-lead-icon" />
                  <span class="input-pipe" aria-hidden="true"></span>
                  <input
                    id="reg-password"
                    v-model="password"
                    :type="showPassword ? 'text' : 'password'"
                    placeholder="Minimum 8 characters"
                    required
                    minlength="8"
                    autocomplete="new-password"
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

              <!-- Confirm Password -->
              <div class="form-group">
                <label for="reg-confirm-password" class="input-label">Confirm Password</label>
                <div class="modern-input-box">
                  <ion-icon :icon="lockClosedOutline" class="input-lead-icon" />
                  <span class="input-pipe" aria-hidden="true"></span>
                  <input
                    id="reg-confirm-password"
                    v-model="confirmPassword"
                    :type="showConfirmPassword ? 'text' : 'password'"
                    placeholder="Re-enter your password"
                    required
                    minlength="8"
                    autocomplete="new-password"
                    class="clean-input"
                    @keydown.enter.prevent="nextStep"
                  />
                  <button
                    type="button"
                    class="btn-eye-toggle"
                    :aria-label="showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'"
                    @click="showConfirmPassword = !showConfirmPassword"
                  >
                    <ion-icon :icon="showConfirmPassword ? eyeOffOutline : eyeOutline" class="eye-icon" />
                    <span class="eye-text">{{ showConfirmPassword ? 'Hide' : 'Show' }}</span>
                  </button>
                </div>
              </div>

              <!-- Continue to Step 5 (Privacy Notice) -->
              <button type="button" class="modern-action-btn" @click="nextStep">
                <span class="btn-text">Continue</span>
                <ion-icon :icon="chevronForwardOutline" class="btn-chevron" />
              </button>
            </div>
          </section>

          <!-- STEP 5: Dedicated Privacy Notice (Full-page readable, mandatory check) -->
          <section v-show="currentStep === 5" class="step-section">
            <div class="step-header">
              <h1 class="step-headline">
                Privacy <br />
                <span class="highlight-text">Notice</span>
              </h1>
              <p class="step-sub">
                Please review our data protection practices under Republic Act No. 10173 before continuing.
              </p>
            </div>

            <div class="step-form-block">
              <!-- Full-Page Policy Points -->
              <div class="policy-full-content">
                <div class="policy-item">
                  <div class="policy-item-title">
                    <span class="policy-num-pill">1</span>
                    <span>Personal Information We Collect</span>
                  </div>
                  <p class="policy-item-desc">
                    We collect only minimum student records including your School ID, full name, enrolled section, NFC card identifier, attendance timestamps, and assessed dues/fines.
                  </p>
                </div>

                <div class="policy-item">
                  <div class="policy-item-title">
                    <span class="policy-num-pill">2</span>
                    <span>Data Protection &amp; RA 10173</span>
                  </div>
                  <p class="policy-item-desc">
                    Your records are processed under legitimate institutional interest and contractual academic governance pursuant to Republic Act No. 10173 (Philippine Data Privacy Act of 2012).
                  </p>
                </div>

                <div class="policy-item">
                  <div class="policy-item-title">
                    <span class="policy-num-pill">3</span>
                    <span>Offline-First Security</span>
                  </div>
                  <p class="policy-item-desc">
                    UniTap stores data in an encrypted local database. Unsynced transactions are queued safely until network connectivity is available.
                  </p>
                </div>

                <div class="policy-item">
                  <div class="policy-item-title">
                    <span class="policy-num-pill">4</span>
                    <span>Your Rights as a Student</span>
                  </div>
                  <p class="policy-item-desc">
                    You have the right to request access to your attendance history, correct inaccuracies, and lodge inquiries with the organization Data Protection Officer.
                  </p>
                </div>
              </div>

              <!-- Dedicated Checkbox: Required to continue -->
              <label class="consent-checkbox-card">
                <input
                  v-model="agreePrivacy"
                  type="checkbox"
                  class="custom-checkbox"
                />
                <span class="consent-label">
                  I have read and acknowledge the <strong>Privacy Notice</strong> under RA 10173.
                </span>
              </label>

              <!-- Continue Button (Disabled until checked) -->
              <button
                type="button"
                class="modern-action-btn"
                :disabled="!agreePrivacy"
                @click="nextStep"
              >
                <span class="btn-text">Continue to Terms of Use</span>
                <ion-icon :icon="chevronForwardOutline" class="btn-chevron" />
              </button>
            </div>
          </section>

          <!-- STEP 6: Dedicated Terms of Use (Full-page readable, mandatory check & final submit) -->
          <section v-show="currentStep === 6" class="step-section">
            <div class="step-header">
              <h1 class="step-headline">
                Terms of <br />
                <span class="highlight-text">Use</span>
              </h1>
              <p class="step-sub">
                Please review student responsibilities and attendance rules before activating your account.
              </p>
            </div>

            <form class="step-form-block" @submit.prevent="handleRegister">
              <!-- Full-Page Policy Points -->
              <div class="policy-full-content">
                <div class="policy-item">
                  <div class="policy-item-title">
                    <span class="policy-num-pill">1</span>
                    <span>Authorized Use</span>
                  </div>
                  <p class="policy-item-desc">
                    UniTap is provided solely for official student government operations, attendance verification, and transparent financial tracking.
                  </p>
                </div>

                <div class="policy-item">
                  <div class="policy-item-title">
                    <span class="policy-num-pill">2</span>
                    <span>NFC Pass &amp; Proxy Scanning Prohibition</span>
                  </div>
                  <p class="policy-item-desc">
                    Your physical NFC card is strictly personal. Tapping another student's pass or allowing others to tap your pass constitutes attendance falsification and academic misconduct.
                  </p>
                </div>

                <div class="policy-item">
                  <div class="policy-item-title">
                    <span class="policy-num-pill">3</span>
                    <span>Account Security</span>
                  </div>
                  <p class="policy-item-desc">
                    You are responsible for safeguarding your login credentials. Do not share your password with other students.
                  </p>
                </div>

                <div class="policy-item">
                  <div class="policy-item-title">
                    <span class="policy-num-pill">4</span>
                    <span>Dues and Receipts</span>
                  </div>
                  <p class="policy-item-desc">
                    All contributions and fines are assessed pursuant to approved student organization bylaws. Digital receipts issued in UniTap serve as official proof of payment.
                  </p>
                </div>
              </div>

              <!-- Dedicated Checkbox: Required to submit -->
              <label class="consent-checkbox-card">
                <input
                  v-model="agreeTerms"
                  type="checkbox"
                  class="custom-checkbox"
                />
                <span class="consent-label">
                  I accept the <strong>Terms of Use</strong> and agree to uphold the attendance code of conduct.
                </span>
              </label>

              <!-- Final Activation Submit Button -->
              <button
                type="submit"
                class="modern-action-btn"
                :disabled="isLoading || !agreeTerms"
              >
                <ion-spinner v-if="isLoading" name="crescent" class="btn-spinner" />
                <template v-else>
                  <span class="btn-text">Activate &amp; Sign In</span>
                  <ion-icon :icon="chevronForwardOutline" class="btn-chevron" />
                </template>
              </button>
            </form>
          </section>
        </main>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonIcon, IonSpinner, onIonViewDidEnter, onIonViewWillLeave, useBackButton } from '@ionic/vue';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import {
  chevronBackOutline,
  chevronForwardOutline,
  schoolOutline,
  keyOutline,
  mailOutline,
  lockClosedOutline,
  eyeOutline,
  eyeOffOutline,
  informationCircleOutline,
  checkmarkCircle,
  checkmarkCircleOutline,
  alertCircle,
  alertCircleOutline,
} from 'ionicons/icons';
import { useAuth } from '@/composables/useAuth';
import { haptics } from '@/utilities/haptics';

const router = useRouter();
const { registerStudent, validateActivationCode } = useAuth();

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

// Onboarding Step Management (1: School ID, 2: Code, 3: Email, 4: Password, 5: Privacy, 6: Terms)
const currentStep = ref(1);

const schoolId = ref('');
const activationCode = ref('');
const email = ref('');
const password = ref('');
const confirmPassword = ref('');

// Step 2 Real-Time Activation Code Validation State
const isCheckingCode = ref(false);
const isCodeValid = ref(false);
const verifiedStudentName = ref('');
const codeCheckError = ref('');

const agreePrivacy = ref(false);
const agreeTerms = ref(false);

const showPassword = ref(false);
const showConfirmPassword = ref(false);

const errorMessage = ref('');
const isLoading = ref(false);

function onSchoolIdChange() {
  // If school ID changes, clear prior activation verification
  isCodeValid.value = false;
  codeCheckError.value = '';
  verifiedStudentName.value = '';
}

function handleBack() {
  if (currentStep.value > 1) {
    prevStep();
  } else {
    router.push('/login');
  }
}

useBackButton(20, () => {
  handleBack();
});

function nextStep() {
  errorMessage.value = '';

  if (currentStep.value === 1) {
    if (!schoolId.value.trim()) {
      errorMessage.value = 'Please enter your School ID.';
      haptics.error();
      return;
    }
    haptics.light();
    currentStep.value = 2;
    if (activationCode.value.length === 8 && !isCodeValid.value && !isCheckingCode.value) {
      checkCodeInDatabase(activationCode.value);
    }
    return;
  }

  if (currentStep.value === 2) {
    if (isCheckingCode.value) return;
    if (!isCodeValid.value) {
      if (activationCode.value.trim().length !== 8) {
        codeCheckError.value = 'Activation code must be 8 alphanumeric characters.';
      }
      haptics.error();
      return;
    }
    haptics.light();
    currentStep.value = 3;
    return;
  }

  if (currentStep.value === 3) {
    if (!email.value.trim() || !email.value.includes('@')) {
      errorMessage.value = 'Please provide a valid university or personal email.';
      haptics.error();
      return;
    }
    haptics.light();
    currentStep.value = 4;
    return;
  }

  if (currentStep.value === 4) {
    if (password.value.length < 8) {
      errorMessage.value = 'Password must be at least 8 characters long.';
      haptics.error();
      return;
    }
    if (password.value !== confirmPassword.value) {
      errorMessage.value = 'Passwords do not match.';
      haptics.error();
      return;
    }
    haptics.light();
    currentStep.value = 5;
    return;
  }

  if (currentStep.value === 5) {
    if (!agreePrivacy.value) {
      errorMessage.value = 'Please acknowledge the Privacy Notice to continue.';
      haptics.error();
      return;
    }
    haptics.light();
    currentStep.value = 6;
    return;
  }
}

function prevStep() {
  errorMessage.value = '';
  if (currentStep.value > 1) {
    haptics.light();
    currentStep.value--;
  }
}

async function formatActivationCode(e: Event) {
  const target = e.target as HTMLInputElement;
  const raw = target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  activationCode.value = raw.slice(0, 8);

  // If user deletes or alters code under 8 chars, reset validation state immediately
  if (activationCode.value.length < 8) {
    isCodeValid.value = false;
    codeCheckError.value = '';
    verifiedStudentName.value = '';
    isCheckingCode.value = false;
    return;
  }

  // Exactly 8 characters: trigger instant database checker
  if (activationCode.value.length === 8) {
    await checkCodeInDatabase(activationCode.value);
  }
}

async function checkCodeInDatabase(code: string) {
  if (!schoolId.value.trim()) {
    codeCheckError.value = 'Please enter your School ID first.';
    isCodeValid.value = false;
    return;
  }

  isCheckingCode.value = true;
  codeCheckError.value = '';
  isCodeValid.value = false;
  verifiedStudentName.value = '';

  try {
    const res = await validateActivationCode(schoolId.value.trim(), code);
    // Guard against race conditions if user typed/deleted while checking
    if (activationCode.value !== code) return;

    if (res.valid) {
      isCodeValid.value = true;
      verifiedStudentName.value = res.studentName || 'Student';
      codeCheckError.value = '';
      haptics.success();
    } else {
      isCodeValid.value = false;
      codeCheckError.value = res.error || 'Activation code not found in records for this student.';
      haptics.error();
    }
  } catch (err: unknown) {
    if (activationCode.value !== code) return;
    isCodeValid.value = false;
    codeCheckError.value = (err as Error).message || 'Failed to verify activation code.';
    haptics.error();
  } finally {
    if (activationCode.value === code) {
      isCheckingCode.value = false;
    }
  }
}

function handleStep2Continue() {
  if (isCheckingCode.value) return;
  if (!isCodeValid.value) {
    if (activationCode.value.length === 8) {
      checkCodeInDatabase(activationCode.value);
    } else {
      codeCheckError.value = 'Activation code must be 8 alphanumeric characters.';
      haptics.error();
    }
    return;
  }
  nextStep();
}

async function handleRegister() {
  errorMessage.value = '';

  if (!schoolId.value.trim()) {
    currentStep.value = 1;
    errorMessage.value = 'Please enter your School ID.';
    haptics.error();
    return;
  }

  if (activationCode.value.trim().length !== 8) {
    currentStep.value = 2;
    errorMessage.value = 'Activation code must be 8 alphanumeric characters.';
    haptics.error();
    return;
  }

  if (!email.value.trim() || !email.value.includes('@')) {
    currentStep.value = 3;
    errorMessage.value = 'Please provide a valid university or personal email.';
    haptics.error();
    return;
  }

  if (password.value.length < 8) {
    currentStep.value = 4;
    errorMessage.value = 'Password must be at least 8 characters long.';
    haptics.error();
    return;
  }

  if (password.value !== confirmPassword.value) {
    currentStep.value = 4;
    errorMessage.value = 'Passwords do not match.';
    haptics.error();
    return;
  }

  if (!agreePrivacy.value) {
    currentStep.value = 5;
    errorMessage.value = 'Please acknowledge the Privacy Notice to proceed.';
    haptics.error();
    return;
  }

  if (!agreeTerms.value) {
    currentStep.value = 6;
    errorMessage.value = 'Please accept the Terms of Use to proceed.';
    haptics.error();
    return;
  }

  haptics.medium();
  isLoading.value = true;

  try {
    const res = await registerStudent(
      schoolId.value.trim(),
      activationCode.value.trim(),
      email.value.trim(),
      password.value
    );

    if (res.success) {
      haptics.success();
      router.replace('/initial-sync');
    } else {
      errorMessage.value = res.error || 'Activation failed. Please check your credentials.';
      haptics.error();
    }
  } catch (err: unknown) {
    errorMessage.value = (err as Error).message || 'An unexpected error occurred during activation.';
    haptics.error();
  } finally {
    isLoading.value = false;
  }
}
</script>

<style scoped>
/* Uniform Pure White Canvas matching Login */
.register-content {
  --background: #FFFFFF;
  background: #FFFFFF;
}

.register-content::part(scroll) {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100%;
  background: #FFFFFF;
}

.register-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  min-height: 100%;
  padding-top: calc(20px + var(--ion-safe-area-top, env(safe-area-inset-top, 0px)));
  padding-bottom: calc(36px + var(--ion-safe-area-bottom, 0px));
  padding-left: 28px;
  padding-right: 28px;
  max-width: 440px;
  margin: 0 auto;
  box-sizing: border-box;
  background: #FFFFFF;
}

@media (max-width: 380px) {
  .register-shell {
    padding-top: calc(16px + var(--ion-safe-area-top, env(safe-area-inset-top, 0px)));
    padding-bottom: calc(28px + var(--ion-safe-area-bottom, 0px));
    padding-left: 20px;
    padding-right: 20px;
  }
}

/* Top Navigation Bar with Back Button */
.top-nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0 12px;
  flex-shrink: 0;
}

.back-btn {
  background: transparent;
  border: 0;
  padding: 8px;
  margin-left: -8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #0F172A;
  border-radius: 8px;
  transition: background 0.15s ease;
}

.back-btn:hover {
  background: #F1F5F9;
}

.back-icon {
  font-size: 22px;
}

.header-center {
  flex: 1;
  text-align: center;
}

.header-brand-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #0F172A;
}

.header-spacer {
  width: 38px;
}

/* Segmented Step Progress Bar */
.stepper-progress-wrap {
  padding: 4px 0 16px;
  flex-shrink: 0;
}

.step-segments-track {
  display: flex;
  gap: 5px;
  width: 100%;
}

.step-bar-segment {
  flex: 1;
  height: 3.5px;
  border-radius: 9999px;
  background: #E2E8F0;
  transition: background 0.25s ease;
}

.step-bar-segment.active {
  background: #0F766E;
}

/* Main Body: Balanced vertical layout, centered content block, left-aligned text */
.register-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  justify-content: center;
  padding: 8px 0 20px;
  gap: 24px;
  width: 100%;
  text-align: left;
}

/* Step Section */
.step-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  text-align: left;
}

.step-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}

.step-headline {
  font-size: clamp(28px, 7.5vw, 34px);
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.03em;
  color: #0F172A;
  margin: 0;
  text-align: left;
}

.highlight-text {
  color: #0F766E;
  display: inline-block;
  font-weight: 800;
}

.step-sub {
  font-size: 13.5px;
  color: #64748B;
  line-height: 1.5;
  margin: 0;
  text-align: left;
}

/* Step Form Block */
.step-form-block {
  display: flex;
  flex-direction: column;
  gap: 16px;
  text-align: left;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}

.input-label {
  font-size: 13px;
  font-weight: 650;
  color: #0F172A;
  letter-spacing: -0.01em;
}

/* Modern Input Box (Uniform with Login UI) */
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

.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.tracking-wider {
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

/* Status Indicator Inside Input Box */
.input-status-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.input-inline-spinner {
  width: 17px;
  height: 17px;
  color: #0F766E;
}

.input-success-icon {
  font-size: 20px;
  color: #059669;
}

.input-error-icon {
  font-size: 20px;
  color: #DC2626;
}

.modern-input-box.box-success {
  border-color: #059669 !important;
  background: #F0FDF4 !important;
}

.modern-input-box.box-error {
  border-color: #F87171 !important;
  background: #FEF2F2 !important;
}

.field-hint {
  font-size: 11.5px;
  color: #64748B;
}

/* Field Feedback messages below input */
.field-feedback {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1.4;
  margin-top: 2px;
}

.field-feedback.checking {
  color: #64748B;
}

.field-feedback.success {
  color: #059669;
  font-weight: 550;
}

.field-feedback.error {
  color: #DC2626;
  font-weight: 500;
}

.feedback-spinner {
  width: 14px;
  height: 14px;
  color: #64748B;
}

.feedback-icon {
  font-size: 15px;
  flex-shrink: 0;
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

/* Full-Page Policy Content (Steps 5 & 6) */
.policy-full-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0 8px;
}

.policy-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.policy-item-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 750;
  color: #0F172A;
}

.policy-num-pill {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(15, 118, 110, 0.12);
  color: #0F766E;
  font-size: 11px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.policy-item-desc {
  font-size: 12.5px;
  color: #475569;
  line-height: 1.5;
  margin: 0;
  padding-left: 28px;
}

/* Consent Checkbox Card */
.consent-checkbox-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: #F8FAFC;
  border: 1.5px solid #E2E8F0;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.consent-checkbox-card:focus-within {
  border-color: #0F766E;
}

.custom-checkbox {
  margin-top: 2px;
  width: 18px;
  height: 18px;
  accent-color: #0F766E;
  cursor: pointer;
  flex-shrink: 0;
}

.consent-label {
  font-size: 12.5px;
  color: #334155;
  line-height: 1.45;
}

/* Modern Action Pill Button (Uniform with Login UI) */
.modern-action-btn {
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
  margin-top: 4px;
  transition: transform 0.15s ease, background 0.15s ease;
}

.modern-action-btn:hover:not(:disabled) {
  background: #272B33;
}

.modern-action-btn:active:not(:disabled) {
  transform: scale(0.985);
}

.modern-action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  background: #94A3B8;
}

.btn-chevron {
  font-size: 19px;
}

.btn-spinner {
  margin: 0 auto;
}

/* Helper Footer & Secondary Back */
.helper-footer {
  text-align: center;
  font-size: 13px;
  color: #64748B;
  margin-top: 4px;
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
}

.alert-error {
  background: #FEF2F2;
  border: 1px solid #FECACA;
  color: #B91C1C;
}

.alert-icon {
  font-size: 18px;
  flex-shrink: 0;
}
</style>
