<script setup lang="ts">
interface Props {
  gradient?: 'primary' | 'cool' | 'mint' | 'dark';
}

withDefaults(defineProps<Props>(), {
  gradient: 'primary'
});
</script>

<template>
  <div class="uni-hero-card" :class="[`hero-grad-${gradient}`]">
    <div class="uni-hero-glow-layer"></div>
    <div class="uni-hero-content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.uni-hero-card {
  position: relative;
  border-radius: var(--uni-radius-hero, 22px);
  padding: 22px 20px;
  overflow: hidden;
  background: var(--uni-surface, #FFFFFF);
  color: var(--uni-text, #0F172A);
  border: 1px solid var(--uni-border, #E2E8F0);
  box-shadow: var(--uni-shadow-card, 0 4px 18px rgba(0, 0, 0, 0.04));
  box-sizing: border-box;
}

@media (max-width: 380px) {
  .uni-hero-card {
    padding: 16px 14px;
    border-radius: 18px;
  }
}

.uni-hero-glow-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  background-image: 
    radial-gradient(circle at 10% 15%, rgba(15, 118, 110, 0.06) 0%, transparent 45%),
    radial-gradient(circle at 90% 85%, rgba(2, 132, 199, 0.05) 0%, transparent 50%);
  mix-blend-mode: normal;
}

/* Gradients in Light Mode */
.hero-grad-primary {
  background: 
    radial-gradient(130% 120% at 95% 5%, rgba(2, 132, 199, 0.04) 0%, transparent 60%),
    radial-gradient(100% 100% at 5% 95%, rgba(15, 118, 110, 0.06) 0%, transparent 65%),
    var(--uni-surface, #FFFFFF);
}

.hero-grad-cool {
  background: 
    radial-gradient(120% 100% at 90% 10%, rgba(124, 58, 237, 0.04) 0%, transparent 60%),
    radial-gradient(100% 100% at 10% 90%, rgba(2, 132, 199, 0.05) 0%, transparent 65%),
    var(--uni-surface, #FFFFFF);
}

.hero-grad-mint {
  background: 
    radial-gradient(120% 100% at 90% 10%, rgba(15, 118, 110, 0.07) 0%, transparent 65%),
    var(--uni-surface, #FFFFFF);
}

.hero-grad-dark {
  background: var(--uni-surface);
  border-color: var(--uni-border);
  color: var(--uni-text-primary);
}

/* Dark Mode Overrides */
:root.dark .uni-hero-card,
:root.ion-palette-dark .uni-hero-card,
body.dark .uni-hero-card,
body.ion-palette-dark .uni-hero-card {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-top: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  color: #F8F9FB;
}

:root.dark .uni-hero-glow-layer,
:root.ion-palette-dark .uni-hero-glow-layer,
body.dark .uni-hero-glow-layer,
body.ion-palette-dark .uni-hero-glow-layer {
  background-image: 
    radial-gradient(circle at 10% 15%, rgba(112, 243, 207, 0.18) 0%, transparent 45%),
    radial-gradient(circle at 90% 85%, rgba(139, 133, 246, 0.15) 0%, transparent 50%);
  mix-blend-mode: screen;
}

:root.dark .hero-grad-primary,
:root.ion-palette-dark .hero-grad-primary {
  background: 
    radial-gradient(130% 120% at 95% 5%, rgba(101, 191, 255, 0.22) 0%, transparent 60%),
    radial-gradient(100% 100% at 5% 95%, rgba(112, 243, 207, 0.2) 0%, transparent 65%),
    #13171F;
}

:root.dark .hero-grad-cool,
:root.ion-palette-dark .hero-grad-cool {
  background: 
    radial-gradient(120% 100% at 90% 10%, rgba(139, 133, 246, 0.25) 0%, transparent 60%),
    radial-gradient(100% 100% at 10% 90%, rgba(101, 191, 255, 0.22) 0%, transparent 65%),
    #12151D;
}

:root.dark .hero-grad-mint,
:root.ion-palette-dark .hero-grad-mint {
  background: 
    radial-gradient(120% 100% at 90% 10%, rgba(112, 243, 207, 0.28) 0%, transparent 65%),
    #101515;
}

.uni-hero-content {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
}
</style>
