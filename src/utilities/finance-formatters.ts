/**
 * Utility functions for Philippine Peso and financial conversions.
 * UniTap stores all financial values internally as integer centavos to avoid float inaccuracies.
 */

export function formatPeso(centavos: number): string {
  const safeCentavos = Math.round(Number.isFinite(centavos) ? centavos : 0);
  const pesos = safeCentavos / 100;
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(pesos);
}

export function formatCentavosToPesos(centavos: number): string {
  return formatPeso(centavos);
}

export function pesoToCentavos(pesos: number): number {
  if (isNaN(pesos) || !Number.isFinite(pesos)) return 0;
  return Math.round(pesos * 100);
}

export function centavosToPeso(centavos: number): number {
  if (isNaN(centavos) || !Number.isFinite(centavos)) return 0;
  return centavos / 100;
}

export function generateReferenceNumber(prefix: string = 'TXN'): string {
  const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
  const timestamp = Date.now().toString().slice(-4);
  return `${prefix}-${timestamp}${randomStr}`;
}
