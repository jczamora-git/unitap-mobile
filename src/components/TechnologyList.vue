<script setup lang="ts">
import type { TechInfo } from '@/types/nfc';
import { layersOutline } from 'ionicons/icons';
import { IonIcon } from '@ionic/vue';

defineProps<{
  technologies: TechInfo[];
}>();
</script>

<template>
  <div class="glass-card tech-card">
    <div class="card-header-row">
      <div class="header-title-wrap">
        <ion-icon :icon="layersOutline" class="header-icon" />
        <h3 class="card-title">Technologies</h3>
      </div>
      <span class="count-badge">{{ technologies.length }} reported</span>
    </div>

    <!-- Empty state -->
    <div v-if="technologies.length === 0" class="empty-tech">
      <p>No specific technology identifiers exposed by this tag.</p>
    </div>

    <!-- Tech Badges & Descriptions -->
    <div v-else class="tech-content">
      <!-- Quick Badges Row -->
      <div class="pills-container">
        <span 
          v-for="tech in technologies" 
          :key="tech.name" 
          class="tech-pill"
        >
          {{ tech.name }}
        </span>
      </div>

      <!-- Detailed Breakdown List -->
      <div class="tech-details-list">
        <div 
          v-for="tech in technologies" 
          :key="tech.rawName" 
          class="tech-item"
        >
          <div class="tech-item-header">
            <div class="tech-item-name">{{ tech.name }}</div>
            <span class="tech-standard-tag">{{ tech.standard }}</span>
          </div>
          <div class="tech-description">
            {{ tech.description }}
          </div>
          <div v-if="tech.rawName !== tech.name" class="tech-raw-name font-mono">
            {{ tech.rawName }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tech-card {
  padding: 18px;
  background: var(--app-surface);
}

.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.header-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-icon {
  font-size: 1.25rem;
  color: var(--ion-color-primary);
}

.card-title {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--app-text-primary);
}

.count-badge {
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--app-surface-subtle);
  color: var(--app-text-secondary);
  padding: 3px 8px;
  border-radius: 9999px;
  border: 1px solid var(--app-border);
}

.pills-container {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.tech-details-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tech-item {
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  padding: 12px 14px;
}

.tech-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.tech-item-name {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--ion-color-primary);
}

.tech-standard-tag {
  font-size: 0.72rem;
  font-weight: 600;
  background: var(--app-surface);
  color: var(--app-text-secondary);
  padding: 2px 6px;
  border-radius: 6px;
  border: 1px solid var(--app-border);
}

.tech-description {
  font-size: 0.82rem;
  color: var(--app-text-secondary);
  line-height: 1.4;
}

.tech-raw-name {
  font-size: 0.7rem;
  color: var(--app-text-muted);
  margin-top: 6px;
  word-break: break-all;
}

.empty-tech {
  font-size: 0.85rem;
  color: var(--app-text-secondary);
  padding: 10px 0;
}
</style>
