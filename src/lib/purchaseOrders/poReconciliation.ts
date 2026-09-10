// Comparação informativa OC × NF-e — puro, determinístico. Nunca bloqueia vínculo,
// recebimento ou encerramento: só classifica. Compara apenas o valor do PRODUTO
// (unit_value/total_value da NF-e) — frete, imposto e despesas acessórias nunca
// entram nesta conta, porque não fazem parte de nfe_invoice_items (são campos de
// totais da nota, de outro nível), então já ficam naturalmente fora.

import type { PoItemComparison, PoItemComparisonStatus } from './poTypes';

/** Tolerância monetária: não há tolerância configurada em nenhum outro módulo do
 *  projeto para este tipo de comparação, então adoto o mínimo coerente com
 *  centavos de Real — R$0,01 absoluto ou 0,5% do valor unitário, o que for maior.
 *  Documentado aqui por ser uma escolha do projeto, não um dado descoberto. */
export function priceTolerance(unitPriceOrdered: number): number {
  return Math.max(0.01, Math.abs(unitPriceOrdered) * 0.005);
}

/** Tolerância de quantidade: comparação exata (quantidade é um número discreto no
 *  contexto de pedido/recebimento) — qualquer diferença, por menor que seja, é
 *  informativa e deve aparecer. */
const QUANTITY_EPSILON = 1e-9;

export interface PoItemReconciliationInput {
  poItemId: string;
  orderedQuantity: number;
  unitPriceOrdered: number | null;
  unit: string | null;
  /** true quando o item não teve nenhum candidato de NF-e encontrado pelo matcher (nem sugestão). */
  hasNoCandidates: boolean;
  /** true quando há candidato(s) mas nenhuma alocação foi confirmada ainda. */
  hasUnresolvedCandidates: boolean;
  allocatedQuantity: number;
  /** média ponderada do unit_value dos itens de NF-e alocados, ou null se nada alocado. */
  weightedUnitPriceInvoiced: number | null;
  invoicedUnit: string | null;
}

export function classifyPoItem(input: PoItemReconciliationInput): PoItemComparison {
  let status: PoItemComparisonStatus;

  if (input.allocatedQuantity <= 0) {
    status = input.hasNoCandidates && !input.hasUnresolvedCandidates ? 'po_item_not_found' : 'awaiting_manual_link';
  } else if (Math.abs(input.allocatedQuantity - input.orderedQuantity) <= QUANTITY_EPSILON) {
    status = evaluatePriceAndUnit(input) ?? 'ok';
  } else if (input.allocatedQuantity < input.orderedQuantity) {
    status = 'quantity_less';
  } else {
    status = 'quantity_greater';
  }

  return {
    poItemId: input.poItemId,
    status,
    orderedQuantity: input.orderedQuantity,
    allocatedQuantity: input.allocatedQuantity,
    unitPriceOrdered: input.unitPriceOrdered,
    unitPriceInvoiced: input.weightedUnitPriceInvoiced,
  };
}

/** Quando a quantidade confere, ainda pode haver divergência de preço ou unidade —
 *  devolve o status correspondente, ou null quando também está tudo ok. */
function evaluatePriceAndUnit(input: PoItemReconciliationInput): PoItemComparisonStatus | null {
  if (input.unit && input.invoicedUnit && normalizeUnit(input.unit) !== normalizeUnit(input.invoicedUnit)) {
    return 'unit_divergent';
  }
  if (input.unitPriceOrdered !== null && input.weightedUnitPriceInvoiced !== null) {
    const diff = Math.abs(input.unitPriceOrdered - input.weightedUnitPriceInvoiced);
    if (diff > priceTolerance(input.unitPriceOrdered)) return 'price_divergent';
  }
  return null;
}

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase();
}

export interface ReconciliationSummary {
  total: number;
  ok: number;
  divergent: number;
  notFound: number;
  awaitingManualLink: number;
  notPredictedInPos: number;
}

export function summarizeReconciliation(
  poComparisons: PoItemComparison[],
  nfeItemsNotPredictedCount: number
): ReconciliationSummary {
  const divergentStatuses = new Set<PoItemComparisonStatus>(['quantity_less', 'quantity_greater', 'price_divergent', 'unit_divergent']);
  return {
    total: poComparisons.length,
    ok: poComparisons.filter(c => c.status === 'ok').length,
    divergent: poComparisons.filter(c => divergentStatuses.has(c.status)).length,
    notFound: poComparisons.filter(c => c.status === 'po_item_not_found').length,
    awaitingManualLink: poComparisons.filter(c => c.status === 'awaiting_manual_link').length,
    notPredictedInPos: nfeItemsNotPredictedCount,
  };
}
