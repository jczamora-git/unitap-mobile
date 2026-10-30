<script setup lang="ts">
import type { NormalizedNfcTag } from '@/types/nfc';
import { 
  IonHeader, 
  IonToolbar, 
  IonTitle, 
  IonButtons, 
  IonButton, 
  IonContent, 
  IonIcon 
} from '@ionic/vue';
import { closeOutline, copyOutline } from 'ionicons/icons';
import TagOverviewCard from './TagOverviewCard.vue';
import TechnologyList from './TechnologyList.vue';
import NdefRecords from './NdefRecords.vue';
import TagCapabilities from './TagCapabilities.vue';
import RawDiagnostics from './RawDiagnostics.vue';
import { useToast } from '@/composables/useToast';

const props = defineProps<{
  tag: NormalizedNfcTag;
}>();

const emit = defineEmits<{
  (e: 'dismiss'): void;
}>();

const { copyToClipboard } = useToast();

function handleCopyAll() {
  copyToClipboard(props.tag.id, 'UID');
}
</script>

<template>
  <ion-header class="ion-no-border modal-header">
    <ion-toolbar>
      <ion-title>Scan Details</ion-title>
      <ion-buttons slot="end">
        <ion-button @click="handleCopyAll">
          <ion-icon :icon="copyOutline" />
        </ion-button>
        <ion-button @click="emit('dismiss')">
          <ion-icon :icon="closeOutline" />
        </ion-button>
      </ion-buttons>
    </ion-toolbar>
  </ion-header>

  <ion-content class="ion-padding safe-content">
    <div class="modal-body">
      <!-- Tag Overview Card -->
      <TagOverviewCard :tag="tag" />

      <!-- Technologies Card -->
      <TechnologyList :technologies="tag.technologies" />

      <!-- NDEF Records Card -->
      <NdefRecords :records="tag.ndefRecords" :has-ndef="tag.hasNdef" />

      <!-- Capabilities Card -->
      <TagCapabilities :tag="tag" />

      <!-- Raw Diagnostics Card -->
      <RawDiagnostics :raw="tag.raw" />
    </div>
  </ion-content>
</template>

<style scoped>
.modal-header ion-toolbar {
  --background: var(--app-surface);
  --border-color: var(--app-border);
}

.modal-body {
  max-width: 600px;
  margin: 0 auto;
  padding-bottom: 24px;
}
</style>
