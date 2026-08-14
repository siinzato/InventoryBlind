// Sync Engine — per-warehouse to per-product aggregation.
//
// Providers report stock per deposit ("CD-SP: 80, CD-RJ: 30"). The Core holds one
// scalar per product (products.stock_quantity). Comparing a single deposit's
// balance against the Core total is the wrong comparison and manufactures
// conflicts that do not exist: 80 vs 110 looks like a divergence when 80 + 30 =
// 110 is in perfect agreement.
//
// So deposits are summed into one observation per product before any conflict
// decision, and the per-deposit detail is kept separately (integration_stock_levels)
// so nothing is lost and a future per-location Core model has its data already.
//
// Pure module: no I/O, no clock.

import type { NormalizedStockLevel } from '../types.ts';
import type { StockObservation } from './syncTypes.ts';

export interface WarehouseBreakdown {
  warehouseExternalId: string | null;
  warehouseName: string | null;
  quantity: number;
  reserved: number | null;
  available: number | null;
  observedAt: string;
}

export interface AggregatedStock {
  productExternalId: string;
  /** Summed across every deposit reported in this pass. */
  total: StockObservation;
  /** Untouched per-deposit rows, for integration_stock_levels. */
  breakdown: WarehouseBreakdown[];
}

/** Sum the deposits of each product into one observation.
 *
 *  Three judgement calls, all deliberate:
 *
 *  `reserved`/`available` are summed only when at least one deposit reports them,
 *  and stay null otherwise. Summing nulls as zero would turn "we don't know" into
 *  "none reserved", which reads as more available stock than exists.
 *
 *  `observedAt` takes the latest of the deposits. The aggregate is only as fresh
 *  as its newest part, and claiming the oldest would make a current balance look
 *  stale enough for `last_write_wins` to discard it.
 *
 *  Deposits reporting the same id twice are summed rather than deduplicated — a
 *  provider paginating mid-deposit legitimately splits one deposit across pages,
 *  and dropping the second half would under-report. */
export function aggregateStockByProduct(levels: NormalizedStockLevel[]): AggregatedStock[] {
  const byProduct = new Map<string, AggregatedStock>();

  for (const level of levels) {
    const existing = byProduct.get(level.productExternalId);

    const row: WarehouseBreakdown = {
      warehouseExternalId: level.warehouseExternalId ?? null,
      warehouseName: level.warehouseName ?? null,
      quantity: level.quantity,
      reserved: level.reserved ?? null,
      available: level.available ?? null,
      observedAt: level.observedAt,
    };

    if (existing == null) {
      byProduct.set(level.productExternalId, {
        productExternalId: level.productExternalId,
        total: {
          quantity: level.quantity,
          reserved: level.reserved ?? null,
          available: level.available ?? null,
          warehouseExternalId: null,
          observedAt: level.observedAt,
        },
        breakdown: [row],
      });
      continue;
    }

    existing.breakdown.push(row);
    existing.total.quantity += level.quantity;

    if (level.reserved != null) {
      existing.total.reserved = (existing.total.reserved ?? 0) + level.reserved;
    }
    if (level.available != null) {
      existing.total.available = (existing.total.available ?? 0) + level.available;
    }
    if (level.observedAt > (existing.total.observedAt ?? '')) {
      existing.total.observedAt = level.observedAt;
    }
  }

  return Array.from(byProduct.values());
}

/** Did this pass see more than one deposit for any product?
 *
 *  Worth knowing before writing a scalar total: with a single deposit the Core's
 *  one number is a faithful representation, and with several it is a sum whose
 *  parts only exist in integration_stock_levels. Surfaced so a sync summary can
 *  say so rather than leaving the operator to assume. */
export function hasMultiWarehouseProducts(aggregated: AggregatedStock[]): boolean {
  return aggregated.some(entry => entry.breakdown.length > 1);
}
