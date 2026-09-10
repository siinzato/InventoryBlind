// Progresso informativo da OC — puro, sempre recalculado ao vivo (nunca
// persistido, nunca fecha a OC sozinho). O status operacional (draft/open/closed/
// closed_with_differences/cancelled) é decisão do operador, gravado à parte.

import type { PoItemComparisonStatus, PoProgressStatus } from './poTypes';

export interface PoProgressInput {
  hasActiveLinks: boolean;
  itemStatuses: PoItemComparisonStatus[];
}

const DIVERGENT_STATUSES = new Set<PoItemComparisonStatus>(['quantity_less', 'quantity_greater', 'price_divergent', 'unit_divergent']);

export function computePoProgress(input: PoProgressInput): PoProgressStatus {
  if (!input.hasActiveLinks) return 'no_invoice';

  const hasDivergence = input.itemStatuses.some(s => DIVERGENT_STATUSES.has(s));
  if (hasDivergence) return 'divergent';

  const hasUnresolved = input.itemStatuses.some(s => s === 'po_item_not_found' || s === 'awaiting_manual_link');
  if (hasUnresolved) return 'partial';

  const allOk = input.itemStatuses.length > 0 && input.itemStatuses.every(s => s === 'ok');
  return allOk ? 'apparently_complete' : 'partial';
}
