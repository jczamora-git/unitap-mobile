<script setup lang="ts">
import { ref, computed } from 'vue';
import { 
  terminalOutline, 
  copyOutline, 
  chevronDownOutline, 
  chevronUpOutline 
} from 'ionicons/icons';
import { IonIcon, IonButton } from '@ionic/vue';
import { safeJsonStringify } from '@/utilities/nfc-formatters';
import { useToast } from '@/composables/useToast';

const props = defineProps<{
  raw: unknown;
}>();

const { copyToClipboard } = useToast();
const isExpanded = ref(false);

const formattedJson = computed(() => {
  return safeJsonStringify(props.raw, 2);
});

function toggleExpanded() {
  isExpanded.value = !isExpanded.value;
}

function handleCopy() {
  copyToClipboard(formattedJson.value, 'Diagnostics JSON');
}
</script>

<template>
  <div class="glass-card raw-card">
    <div class="card-header-row" @click="toggleExpanded">
      <div class="header-title-wrap">
        <ion-icon :icon="terminalOutline" class="header-icon" />
        <h3 class="card-title">Raw Diagnostics</h3>
      </div>
      <div class="header-actions">
        <ion-button 
          v-if="isExpanded" 
          fill="clear" 
          size="small" 
          class="copy-btn" 
          @click.stop="handleCopy"
        >
          <ion-icon :icon="copyOutline" slot="start" />
          Copy
        </ion-button>
        <ion-icon :icon="isExpanded ? chevronUpOutline : chevronDownOutline" class="toggle-icon" />
      </div>
    </div>

    <div v-if="isExpanded" class="raw-content-panel">
      <pre class="json-code-block font-mono"><code>{{ formattedJson }}</code></pre>
    </div>
  </div>
</template>

<style scoped>
.raw-card {
  padding: 16px 18px;
  background: var(--app-surface);
}

.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.header-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-icon {
  font-size: 1.25rem;
  color: var(--app-text-secondary);
}

.card-title {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--app-text-primary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.copy-btn {
  --color: var(--ion-color-primary);
  font-size: 0.78rem;
  height: 26px;
  margin: 0;
}

.toggle-icon {
  font-size: 1.1rem;
  color: var(--app-text-muted);
}

.raw-content-panel {
  margin-top: 14px;
}

.json-code-block {
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  border-radius: 10px;
  padding: 12px;
  font-size: 0.76rem;
  color: var(--app-text-primary);
  line-height: 1.45;
  overflow-x: auto;
  max-height: 260px;
  user-select: all;
  margin: 0;
}
</style>
