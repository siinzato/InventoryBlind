// Logística Reversa — indicadores. Função pura sobre dados já carregados no cliente, mesmo
// padrão de src/lib/adminKpis/kpiHealth.ts — sem SQL de agregação, sem biblioteca de gráfico.

import type { ReturnDestination, ReturnItem, ReturnRecord } from './reverseLogisticsTypes';

export interface ReturnKpiPeriod {
  start: string | null;
  end: string | null;
}

export interface ProductValueLookup {
  (productId: string | null): number | null;
}

export interface ReturnKpis {
  receivedCount: number;
  averageProcessingDays: number | null;
  recoveredPct: number | null;
  assistancePct: number | null;
  discardedPct: number | null;
  recoveredValue: number | null;
  estimatedLossValue: number | null;
  topReasons: { reason: string; count: number }[];
  topProducts: { sku: string; count: number }[];
  slaCompliancePct: number | null;
  hasValueData: boolean;
}

const DESTINATIONS_RECOVERED: readonly ReturnDestination[] = ['restock'];
const DESTINATIONS_ASSISTANCE: readonly ReturnDestination[] = ['technical_assistance', 'refurbishment'];
const DESTINATIONS_LOSS: readonly ReturnDestination[] = ['discard', 'damaged_stock'];

/** Todos os percentuais/valores usam só dados reais já persistidos — se o produto não tem preço
 *  cadastrado, o item é excluído do cálculo de valor (hasValueData sinaliza isso à UI, que deve
 *  mostrar a limitação em vez de inventar um número). */
export function computeReturnKpis(
  returns: ReturnRecord[],
  items: ReturnItem[],
  period: ReturnKpiPeriod,
  getProductPrice: ProductValueLookup,
  slaCompliantReturnIds: Set<string>
): ReturnKpis {
  const inPeriod = returns.filter(r => {
    if (period.start && r.receivedAt < period.start) return false;
    if (period.end && r.receivedAt > `${period.end}T23:59:59`) return false;
    return true;
  });
  const periodIds = new Set(inPeriod.map(r => r.id));
  const periodItems = items.filter(i => periodIds.has(i.returnId));

  const finalizedWithDuration = inPeriod.filter(r => r.status === 'finalized' && r.statusChangedAt);
  const averageProcessingDays = finalizedWithDuration.length > 0
    ? finalizedWithDuration.reduce((sum, r) => sum + (new Date(r.statusChangedAt as string).getTime() - new Date(r.receivedAt).getTime()) / 86400000, 0) / finalizedWithDuration.length
    : null;

  const decided = periodItems.filter(i => i.destination !== null);
  const recoveredCount = decided.filter(i => DESTINATIONS_RECOVERED.includes(i.destination as ReturnDestination)).length;
  const assistanceCount = decided.filter(i => DESTINATIONS_ASSISTANCE.includes(i.destination as ReturnDestination)).length;
  const discardedCount = decided.filter(i => i.destination === 'discard').length;

  let recoveredValue: number | null = null;
  let estimatedLossValue: number | null = null;
  let hasValueData = false;
  for (const item of decided) {
    const price = getProductPrice(item.productId);
    if (price == null) continue;
    hasValueData = true;
    const value = price * item.receivedQuantity;
    if (DESTINATIONS_RECOVERED.includes(item.destination as ReturnDestination)) {
      recoveredValue = (recoveredValue ?? 0) + value;
    } else if (DESTINATIONS_LOSS.includes(item.destination as ReturnDestination)) {
      estimatedLossValue = (estimatedLossValue ?? 0) + value;
    }
  }

  const reasonCounts = new Map<string, number>();
  for (const r of inPeriod) {
    if (!r.reason) continue;
    reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1);
  }
  const topReasons = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count }));

  const productCounts = new Map<string, number>();
  for (const item of periodItems) {
    if (!item.sku) continue;
    productCounts.set(item.sku, (productCounts.get(item.sku) ?? 0) + 1);
  }
  const topProducts = Array.from(productCounts.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([sku, count]) => ({ sku, count }));

  const slaCompliancePct = inPeriod.length > 0
    ? (inPeriod.filter(r => slaCompliantReturnIds.has(r.id)).length / inPeriod.length) * 100
    : null;

  return {
    receivedCount: inPeriod.length,
    averageProcessingDays,
    recoveredPct: decided.length > 0 ? (recoveredCount / decided.length) * 100 : null,
    assistancePct: decided.length > 0 ? (assistanceCount / decided.length) * 100 : null,
    discardedPct: decided.length > 0 ? (discardedCount / decided.length) * 100 : null,
    recoveredValue,
    estimatedLossValue,
    topReasons,
    topProducts,
    slaCompliancePct,
    hasValueData,
  };
}
