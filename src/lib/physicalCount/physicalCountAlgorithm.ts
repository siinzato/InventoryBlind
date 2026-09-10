// Pure result/summary math for a physical counting session — no I/O here,
// same three-layer split (algorithm/service/UI) already used by riskAlgorithm.ts,
// cbcAlgorithm.ts, rcaAlgorithm.ts. Reuses shouldRecommendThirdCount's existing
// >10 threshold from countManagementUtils.ts instead of a second copy of the
// same rule.
import { shouldRecommendThirdCount } from '../countManagementUtils';

export type ItemResultStatus = 'ok' | 'missing' | 'surplus';

export interface CountItemLike {
  erpQuantitySnapshot: number;
  /** Quantidade encontrada no local esperado. */
  physicalQuantity: number | null;
  /** Quantidade encontrada num local diferente (ver pc_flag_found_elsewhere) — soma ao total para reconciliar com o ERP. */
  foundElsewhereQuantity?: number;
}

/**
 * Total físico real de um item = local esperado + excedente em outro lugar.
 * null enquanto nenhum dos dois foi contado ainda (item ainda pendente).
 */
export function computeTotalFound(item: CountItemLike): number | null {
  if (item.physicalQuantity === null && !item.foundElsewhereQuantity) return null;
  return (item.physicalQuantity ?? 0) + (item.foundElsewhereQuantity ?? 0);
}

export function computeItemResult(item: CountItemLike): ItemResultStatus | null {
  const total = computeTotalFound(item);
  if (total === null) return null;
  if (total === item.erpQuantitySnapshot) return 'ok';
  return total < item.erpQuantitySnapshot ? 'missing' : 'surplus';
}

export interface SessionSummary {
  totalItems: number;
  countedItems: number;
  okItems: number;
  divergentItems: number;
  /** Sum of shortfalls — negative (e.g. -74), matching the ticket's own example. */
  missingUnits: number;
  /** Sum of surpluses — positive (e.g. +21). */
  surplusUnits: number;
  netAdjustment: number;
  /** % of counted items with no divergence — "precisão da primeira contagem". */
  accuracyPct: number;
}

export function computeSessionSummary(items: CountItemLike[]): SessionSummary {
  const counted = items.filter(i => computeTotalFound(i) !== null);
  let okItems = 0;
  let divergentItems = 0;
  let missingUnits = 0;
  let surplusUnits = 0;

  for (const item of counted) {
    const status = computeItemResult(item);
    if (status === 'ok') {
      okItems++;
      continue;
    }
    divergentItems++;
    const diff = (computeTotalFound(item) as number) - item.erpQuantitySnapshot;
    if (diff < 0) missingUnits += diff;
    else surplusUnits += diff;
  }

  const accuracyPct = counted.length > 0 ? Math.round((okItems / counted.length) * 1000) / 10 : 0;

  return {
    totalItems: items.length,
    countedItems: counted.length,
    okItems,
    divergentItems,
    missingUnits,
    surplusUnits,
    netAdjustment: missingUnits + surplusUnits,
    accuracyPct,
  };
}

export function shouldRecommendRecount(summary: SessionSummary): boolean {
  return summary.divergentItems > 0;
}

/**
 * Distingue os 3 estados que a tela de criação da sessão misturava numa única
 * mensagem ("nenhum produto com localização"): empresa sem nenhum produto
 * (provável sessão/empresa errada no seletor de workspace, não um bug de
 * dados) vs. empresa com produtos mas nenhum com `location` preenchido
 * (estado real, pede cadastro) vs. tudo certo (a faixa escolhida é que pode
 * estar vazia, tratado separadamente pela lista de produtos combinados).
 */
export type ScopeAvailability = 'no_products' | 'no_locations' | 'ok';

export function classifyScopeAvailability(params: { totalProducts: number; locatedProducts: number }): ScopeAvailability {
  if (params.totalProducts === 0) return 'no_products';
  if (params.locatedProducts === 0) return 'no_locations';
  return 'ok';
}

/** Reuses the existing >10 threshold from countManagementUtils — same rule, one definition. */
export function shouldRecommendThirdCountRound(divergentItemsAfterRecount: number): boolean {
  return shouldRecommendThirdCount(divergentItemsAfterRecount);
}

// Seção 27 — Paperless Inventory. Só "folhas evitadas" é calculado: uma
// contagem de quantas folhas de relatório impresso (nº de itens ÷ itens por
// folha) deixaram de ser necessárias. Peso de papel e impacto ambiental NÃO
// são calculados aqui — não há fonte/metodologia definida para esses números
// (ver plano, seção "Pendências explícitas"); a estrutura fica pronta para
// receber esses campos depois, sem inventar um número agora.
const DEFAULT_ITEMS_PER_SHEET = 40;

export function estimateSheetsAvoided(totalItemsCounted: number, itemsPerSheet: number = DEFAULT_ITEMS_PER_SHEET): number {
  if (totalItemsCounted <= 0 || itemsPerSheet <= 0) return 0;
  return Math.ceil(totalItemsCounted / itemsPerSheet);
}
