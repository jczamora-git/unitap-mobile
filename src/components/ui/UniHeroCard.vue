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
  border-radius: var(--uni-radius-hero);
  padding: 22px 20px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-top: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.22);
  color: #F8F9FB;
  box-sizing: border-box;
}

.uni-hero-glow-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  background-image: 
    radial-gradient(circle at 10% 15%, rgba(112, 243, 207, 0.18) 0%, transparent 45%),
    radial-gradient(circle at 90% 85%, rgba(139, 133, 246, 0.15) 0%, transparent 50%);
  mix-blend-mode: screen;
}

/* Gradients */
.hero-grad-primary {
  background: 
    radial-gradient(130% 120% at 95% 5%, rgba(101, 191, 255, 0.22) 0%, transparent 60%),
    radial-gradient(100% 100% at 5% 95%, rgba(112, 243, 207, 0.2) 0%, transparent 65%),
    #13171F;
}

.hero-grad-cool {
  background: 
    radial-gradient(120% 100% at 90% 10%, rgba(139, 133, 246, 0.25) 0%, transparent 60%),
    radial-gradient(100% 100% at 10% 90%, rgba(101, 191, 255, 0.22) 0%, transparent 65%),
    #12151D;
}

.hero-grad-mint {
  background: 
    radial-gradient(120% 100% at 90% 10%, rgba(112, 243, 207, 0.28) 0%, transparent 65%),
    #101515;
}

.hero-grad-dark {
  background: var(--uni-surface);
  border-color: var(--uni-border);
  color: var(--uni-text-primary);
}

.uni-hero-content {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
}
</style>
