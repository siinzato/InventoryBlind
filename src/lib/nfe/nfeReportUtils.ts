// NF-e report statistics (pure, unit-testable).

import type { ItemResultStatus, NfeInvoiceItem } from './nfeTypes';

export interface ReportStats {
  skuCount: number;        // total SKUs on the note
  conferredCount: number;  // items with a physical count registered
  okCount: number;
  missingCount: number;
  surplusCount: number;
  uncountedCount: number;  // pending (linked, never counted)
  unlinkedCount: number;
  totalNfQty: number;
  totalPhysicalQty: number;
  conformityPct: number;   // OK / conferred items (NOT a net-sum)
}

export function computeItemStatus(item: {
  product_id: string | null;
  physical_quantity: number | null;
  expected_quantity: number;
}): ItemResultStatus {
  if (item.product_id == null) return 'unlinked';
  if (item.physical_quantity == null) return 'pending';
  if (item.physical_quantity === item.expected_quantity) return 'ok';
  if (item.physical_quantity < item.expected_quantity) return 'missing';
  return 'surplus';
}

export function computeReportStats(items: NfeInvoiceItem[]): ReportStats {
  let okCount = 0;
  let missingCount = 0;
  let surplusCount = 0;
  let uncountedCount = 0;
  let unlinkedCount = 0;
  let conferredCount = 0;
  let totalNfQty = 0;
  let totalPhysicalQty = 0;

  for (const it of items) {
    totalNfQty += it.expected_quantity ?? 0;
    if (it.physical_quantity != null) {
      totalPhysicalQty += it.physical_quantity;
      conferredCount += 1;
    }
    const status = it.result_status ?? computeItemStatus(it);
    switch (status) {
      case 'ok': okCount += 1; break;
      case 'missing': missingCount += 1; break;
      case 'surplus': surplusCount += 1; break;
      case 'pending': uncountedCount += 1; break;
      case 'unlinked': unlinkedCount += 1; break;
    }
  }

  // Conformity is based on conferred items only; a −10 and a +10 are TWO
  // divergences, never a net zero.
  const conformityPct = conferredCount === 0
    ? 0
    : Math.round((okCount / conferredCount) * 1000) / 10;

  return {
    skuCount: items.length,
    conferredCount,
    okCount,
    missingCount,
    surplusCount,
    uncountedCount,
    unlinkedCount,
    totalNfQty,
    totalPhysicalQty,
    conformityPct,
  };
}
