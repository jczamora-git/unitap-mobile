<template>
  <ion-page>
    <ion-content class="ion-padding register-content">
      <div class="register-card">
        <div class="brand-block">
          <div class="brand-icon-wrap">
            <ion-icon :icon="cardOutline" class="brand-icon" />
          </div>
          <h1 class="brand-title">UniTap 2.0</h1>
          <p class="brand-subtitle">Activate Student Account</p>
        </div>

        <form class="register-form" @submit.prevent="handleRegister">
          <div class="form-group">
            <label class="form-label">School ID</label>
            <input
              v-model="schoolId"
              type="text"
              placeholder="e.g. 2026-0001"
              required
              class="form-input font-mono"
            />
            <span class="form-hint">Matches your university student ID card</span>
          </div>

          <div class="form-group">
            <label class="form-label">Activation Code</label>
            <input
              v-model="activationCode"
              type="text"
              placeholder="8-character officer code"
              maxlength="8"
              required
              class="form-input font-mono uppercase"
            />
            <span class="form-hint">Issued by an authorized CSG officer</span>
          </div>

          <div class="form-group">
            <label class="form-label">Email Address</label>
            <input
              v-model="email"
              type="email"
              placeholder="student@university.edu.ph"
              required
              class="form-input"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Password</label>
            <input
              v-model="password"
              type="password"
              placeholder="Minimum 8 characters"
              required
              minlength="8"
              class="form-input"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Confirm Password</label>
            <input
              v-model="confirmPassword"
              type="password"
              placeholder="Re-enter your password"
              required
              minlength="8"
              class="form-input"
            />
          </div>

          <div v-if="errorMessage" class="error-box">
            <ion-icon :icon="alertCircle" />
            <span>{{ errorMessage }}</span>
          </div>

          <button type="submit" class="btn-register-submit" :disabled="isLoading">
            <span v-if="!isLoading">Activate & Sign In</span>
            <span v-else>Verifying Code...</span>
          </button>

          <div class="login-footer-links">
            <button type="button" class="link-btn" @click="router.push('/login')">
              Already have an account? Sign In
            </button>
          </div>
        </form>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonIcon } from '@ionic/vue';
import { cardOutline, alertCircle } from 'ionicons/icons';
import { useAuth } from '@/composables/useAuth';

const router = useRouter();
const { registerStudent } = useAuth();

const schoolId = ref('');
const activationCode = ref('');
const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const errorMessage = ref('');
const isLoading = ref(false);

async function handleRegister() {
  errorMessage.value = '';

  if (password.value !== confirmPassword.value) {
    errorMessage.value = 'Passwords do not match.';
    return;
  }

  isLoading.value = true;
  try {
    const res = await registerStudent(
      schoolId.value,
      activationCode.value,
      email.value,
      password.value
    );

    if (res.success) {
      router.replace('/initial-sync');
    } else {
      errorMessage.value = res.error || 'Activation failed.';
    }
  } catch (err: unknown) {
    errorMessage.value = (err as Error).message || 'An unexpected error occurred.';
  } finally {
    isLoading.value = false;
  }
}
</script>

<style scoped>
.register-content {
  --background: var(--uni-background, #F8FAFC);
  display: flex;
  align-items: center;
  justify-content: center;
}

.register-card {
  max-width: 440px;
  margin: 30px auto;
  background: #FFFFFF;
  border: 1px solid var(--uni-border, #CBD5E1);
  border-radius: 16px;
  padding: 32px 24px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
}

.brand-block {
  text-align: center;
  margin-bottom: 24px;
}

.brand-icon-wrap {
  width: 56px;
  height: 56px;
  background: #E6FFFA;
  color: var(--uni-primary, #0F766E);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 12px;
}

.brand-icon {
  font-size: 28px;
}

.brand-title {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--uni-ink, #0F172A);
  margin: 0;
}

.brand-subtitle {
  font-size: 0.88rem;
  color: var(--uni-muted, #64748B);
  margin-top: 4px;
}

.form-group {
  margin-bottom: 16px;
}

.form-label {
  display: block;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--uni-ink, #0F172A);
  margin-bottom: 6px;
}

.form-input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--uni-border, #CBD5E1);
  border-radius: 8px;
  font-size: 0.95rem;
  background: #FFFFFF;
  color: #0F172A;
  outline: none;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: var(--uni-primary, #0F766E);
}

.uppercase {
  text-transform: uppercase;
  letter-spacing: 2px;
}

.form-hint {
  display: block;
  font-size: 0.75rem;
  color: var(--uni-muted, #64748B);
  margin-top: 4px;
}

.btn-register-submit {
  width: 100%;
  padding: 14px;
  background: var(--uni-primary, #0F766E);
  color: #FFFFFF;
  border: none;
  border-radius: 8px;
  font-weight: 700;
  font-size: 1rem;
  cursor: pointer;
  margin-top: 8px;
}

.btn-register-submit:disabled {
  opacity: 0.7;
}

.error-box {
  background: #FEF2F2;
  border: 1px solid #FCA5A5;
  color: #991B1B;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.login-footer-links {
  text-align: center;
  margin-top: 20px;
}

.link-btn {
  background: none;
  border: none;
  color: var(--uni-primary, #0F766E);
  font-weight: 600;
  cursor: pointer;
  font-size: 0.85rem;
}
</style>
