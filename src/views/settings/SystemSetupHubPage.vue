<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  IonSpinner
} from '@ionic/vue';
import {
  pricetagOutline,
  layersOutline,
  gridOutline,
  calendarOutline,
  schoolOutline,
  peopleOutline,
  chevronForwardOutline,
  shieldCheckmarkOutline
} from 'ionicons/icons';
import { UniPageHeader } from '@/components/ui';
import { SystemSetupService } from '@/services/system-setup.service';
import { OfficerManagementService } from '@/services/officer-management.service';
import { haptics } from '@/utilities/haptics';

const router = useRouter();

const isLoading = ref(true);
const categoryCount = ref(0);
const yearLevelCount = ref(0);
const sectionCount = ref(0);
const academicYearCount = ref(0);
const semesterCount = ref(0);
const officerCount = ref(0);

async function loadCounts() {
  isLoading.value = true;
  try {
    const [cats, yls, secs, ays, sems, officers] = await Promise.all([
      SystemSetupService.getEventCategories(true),
      SystemSetupService.getYearLevels(true),
      SystemSetupService.getSections({ includeInactive: true }),
      SystemSetupService.getAcademicYears(),
      SystemSetupService.getSemesters(),
      OfficerManagementService.getOfficers().catch(() => []),
    ]);
    categoryCount.value = cats.length;
    yearLevelCount.value = yls.length;
    sectionCount.value = secs.length;
    academicYearCount.value = ays.length;
    semesterCount.value = sems.length;
    officerCount.value = officers.length;
  } catch (err) {
    console.error('Failed to load system setup statistics:', err);
  } finally {
    isLoading.value = false;
  }
}

function navigateTo(path: string) {
  haptics.light();
  router.push(path);
}

onMounted(loadCounts);
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="System Setup"
      subtitle="Academic structure & event configuration"
      :back-button="true"
      default-back-href="/settings"
    />

    <ion-content class="system-setup-content">
      <div class="page-container">
        <!-- Security Header Banner -->
        <div class="security-banner minimal-card">
          <div class="banner-icon-col">
            <ion-icon :icon="shieldCheckmarkOutline" class="shield-icon" />
          </div>
          <div class="banner-text-col">
            <div class="banner-tag font-mono">DEVADMIN AUTHORIZED</div>
            <p class="banner-desc">
              Changes made here update central institution configurations and synchronize to all operational terminals.
            </p>
          </div>
        </div>

        <!-- Setup Modules List -->
        <div class="setup-modules-grid">
          <!-- 1. Event Categories -->
          <div class="module-card minimal-card" @click="navigateTo('/settings/system-setup/event-categories')">
            <div class="module-icon-wrap">
              <ion-icon :icon="pricetagOutline" />
            </div>
            <div class="module-info">
              <div class="module-title-row">
                <span class="module-title">Event Categories</span>
                <span class="module-badge font-mono">{{ categoryCount }} items</span>
              </div>
              <p class="module-desc">Dynamic event types, classification codes, and reporting groups.</p>
            </div>
            <ion-icon :icon="chevronForwardOutline" class="module-arrow" />
          </div>

          <!-- 2. Year Levels -->
          <div class="module-card minimal-card" @click="navigateTo('/settings/system-setup/year-levels')">
            <div class="module-icon-wrap">
              <ion-icon :icon="layersOutline" />
            </div>
            <div class="module-info">
              <div class="module-title-row">
                <span class="module-title">Year Levels</span>
                <span class="module-badge font-mono">{{ yearLevelCount }} levels</span>
              </div>
              <p class="module-desc">Student academic progression levels (1st Year to 4th Year).</p>
            </div>
            <ion-icon :icon="chevronForwardOutline" class="module-arrow" />
          </div>

          <!-- 3. Sections -->
          <div class="module-card minimal-card" @click="navigateTo('/settings/system-setup/sections')">
            <div class="module-icon-wrap">
              <ion-icon :icon="gridOutline" />
            </div>
            <div class="module-info">
              <div class="module-title-row">
                <span class="module-title">Sections</span>
                <span class="module-badge font-mono">{{ sectionCount }} sections</span>
              </div>
              <p class="module-desc">One-to-many section offerings linked to year levels and programs.</p>
            </div>
            <ion-icon :icon="chevronForwardOutline" class="module-arrow" />
          </div>

          <!-- 4. Academic Years -->
          <div class="module-card minimal-card" @click="navigateTo('/settings/system-setup/academic-years')">
            <div class="module-icon-wrap">
              <ion-icon :icon="calendarOutline" />
            </div>
            <div class="module-info">
              <div class="module-title-row">
                <span class="module-title">Academic Years</span>
                <span class="module-badge font-mono">{{ academicYearCount }} years</span>
              </div>
              <p class="module-desc">School calendar periods, date spans, and lifecycle status.</p>
            </div>
            <ion-icon :icon="chevronForwardOutline" class="module-arrow" />
          </div>

          <!-- 5. Semesters -->
          <div class="module-card minimal-card" @click="navigateTo('/settings/system-setup/semesters')">
            <div class="module-icon-wrap">
              <ion-icon :icon="schoolOutline" />
            </div>
            <div class="module-info">
              <div class="module-title-row">
                <span class="module-title">Semesters</span>
                <span class="module-badge font-mono">{{ semesterCount }} terms</span>
              </div>
              <p class="module-desc">Active term control, single-active constraint, and enrollment scopes.</p>
            </div>
            <ion-icon :icon="chevronForwardOutline" class="module-arrow" />
          </div>

          <!-- 6. Officer Management -->
          <div class="module-card minimal-card" @click="navigateTo('/settings/system-setup/officers')">
            <div class="module-icon-wrap">
              <ion-icon :icon="peopleOutline" />
            </div>
            <div class="module-info">
              <div class="module-title-row">
                <span class="module-title">Officer Management</span>
                <span class="module-badge font-mono">{{ officerCount }} officers</span>
              </div>
              <p class="module-desc">DevAdmin officer appointments, permission presets, and account assignments.</p>
            </div>
            <ion-icon :icon="chevronForwardOutline" class="module-arrow" />
          </div>
        </div>

        <div v-if="isLoading" class="loading-state">
          <ion-spinner name="crescent" />
          <span>Loading configuration summary...</span>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.system-setup-content {
  --background: var(--uni-background, #f8fafc);
}

.page-container {
  max-width: 600px;
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

.security-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  background: var(--uni-surface, #ffffff);
  border-left: 3px solid var(--uni-primary, #10b981);
}

.banner-icon-col {
  padding-top: 2px;
}

.shield-icon {
  font-size: 20px;
  color: var(--uni-primary, #10b981);
}

.banner-tag {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--uni-primary, #10b981);
  margin-bottom: 2px;
}

.banner-desc {
  font-size: 13px;
  color: var(--uni-text-secondary, #64748b);
  line-height: 1.4;
  margin: 0;
}

.setup-modules-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.module-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
}

.module-card:active {
  transform: scale(0.99);
  background: var(--uni-surface-secondary, #f1f5f9);
}

.module-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--uni-text, #0f172a);
  flex-shrink: 0;
}

.module-icon-wrap ion-icon {
  font-size: 22px;
}

.module-info {
  flex: 1;
  min-width: 0;
}

.module-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 3px;
}

.module-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--uni-text, #0f172a);
}

.module-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--uni-surface-secondary, #f1f5f9);
  color: var(--uni-text-secondary, #64748b);
  border: 1px solid var(--uni-border, #e2e8f0);
}

.module-desc {
  font-size: 12.5px;
  color: var(--uni-text-secondary, #64748b);
  line-height: 1.35;
  margin: 0;
}

.module-arrow {
  font-size: 18px;
  color: var(--uni-text-muted, #94a3b8);
  flex-shrink: 0;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  font-size: 13px;
  color: var(--uni-text-muted, #94a3b8);
}
</style>

