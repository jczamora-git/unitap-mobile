<script setup lang="ts">
export interface KpiCardItem {
  id: string;
  label: string;
  value: string;
  meta?: string;
  variant?: 'default' | 'success' | 'danger';
}

interface Props {
  items: KpiCardItem[];
}

defineProps<Props>();
</script>

<template>
  <div class="uni-kpi-container">
    <div class="report-kpi-track" role="region" aria-label="Financial KPI Summary">
      <div
        v-for="card in items"
        :key="card.id"
        class="report-kpi-card"
        :class="`variant-${card.variant || 'default'}`"
      >
        <span class="card-label">{{ card.label }}</span>
        <span class="card-amount" :class="`amount-${card.variant || 'default'}`">
          {{ card.value }}
        </span>
        <span v-if="card.meta" class="card-meta">{{ card.meta }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.uni-kpi-container {
  width: 100%;
}

.report-kpi-track {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding: 4px 2px 14px 2px;
}

.report-kpi-track::-webkit-scrollbar {
  display: none;
}

.report-kpi-card {
  flex: 0 0 78%;
  min-width: 0;
  max-width: 340px;
  scroll-snap-align: start;
  background: var(--uni-surface);
  border: 1px solid var(--uni-border);
  border-radius: var(--uni-radius-card, 16px);
  box-shadow: var(--uni-shadow-card);
  padding: 18px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-sizing: border-box;
  min-height: 120px;
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

@media (max-width: 380px) {
  .report-kpi-card {
    flex: 0 0 82%;
    padding: 14px;
    min-height: 110px;
  }
}

/* Desktop: conventional 3-card grid */
@media (min-width: 768px) {
  .report-kpi-track {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    overflow-x: visible;
    scroll-snap-type: none;
    padding-bottom: 4px;
    gap: 16px;
  }

  .report-kpi-card {
    flex: none;
    max-width: none;
  }
}

.card-label {
  display: block;
  font-size: 11px;
  font-weight: 800;
  color: var(--uni-text-secondary, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.card-amount {
  display: block;
  font-size: clamp(20px, 5.5vw, 26px);
  font-weight: 850;
  color: var(--uni-text, #0f172a);
  margin: 6px 0;
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}

.amount-success {
  color: var(--uni-success, #059669);
}

.amount-danger {
  color: var(--uni-danger, #dc2626);
}

.card-meta {
  font-size: 11.5px;
  color: var(--uni-text-secondary, #64748b);
}

.variant-success {
  border-left: 4px solid var(--uni-success, #059669);
}

.variant-danger {
  border-left: 4px solid var(--uni-danger, #dc2626);
}

:root.dark .report-kpi-card,
:root.ion-palette-dark .report-kpi-card,
body.dark .report-kpi-card,
body.ion-palette-dark .report-kpi-card,
:global(.dark) .report-kpi-card,
:global(.ion-palette-dark) .report-kpi-card {
  background: var(--uni-surface, #1B1D23);
  border-color: var(--uni-border, #30343D);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
}

:root.dark .card-amount,
:root.ion-palette-dark .card-amount,
body.dark .card-amount,
body.ion-palette-dark .card-amount,
:global(.dark) .card-amount,
:global(.ion-palette-dark) .card-amount {
  color: var(--uni-text, #F8FAFC);
}

:root.dark .amount-success,
:root.ion-palette-dark .amount-success,
body.dark .amount-success,
body.ion-palette-dark .amount-success,
:global(.dark) .amount-success,
:global(.ion-palette-dark) .amount-success {
  color: var(--uni-success, #34d399);
}

:root.dark .amount-danger,
:root.ion-palette-dark .amount-danger,
body.dark .amount-danger,
body.ion-palette-dark .amount-danger,
:global(.dark) .amount-danger,
:global(.ion-palette-dark) .amount-danger {
  color: var(--uni-danger, #f87171);
}
</style>
