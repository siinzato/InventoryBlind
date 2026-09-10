// Inventory Intelligence — the only layer here that touches the network.
//
// Everything else in this folder is pure. This file fetches the aggregate snapshot
// and hands it to the engines. It contains no arithmetic and no judgement, so the
// interesting logic stays testable without a database.
//
// ── Where the tenant comes from ─────────────────────────────────────────────
// Not from here. The RPC derives the company from get_my_company_id() inside the
// database. There is deliberately no companyId parameter to pass — a client-supplied
// tenant id is the vector this design removes rather than validates.

import { supabase } from '../supabase';
import { buildInventoryMetrics } from './analyticsEngine';
import { buildInventoryAlerts } from './alertEngine';
import { computeHealthScore } from './healthEngine';
import type { InventoryAlert, InventoryMetrics, HealthScore, RawSnapshot } from './contracts';

export interface IntelligenceResult {
  metrics: InventoryMetrics;
  health: HealthScore;
  alerts: InventoryAlert[];
}

/** Compose the three engines over one snapshot.
 *
 *  Exported separately from the fetch so tests — and, later, a server-rendered or
 *  cached path — can run the whole intelligence pipeline on a snapshot from any
 *  source. This is the function that proves a hypothetical provider can feed the
 *  engines through the normalized contract without touching the engines. */
export function analyzeSnapshot(
  snapshot: RawSnapshot,
  options: { connectionId?: string | null; nowMs?: number } = {}
): IntelligenceResult {
  const metrics = buildInventoryMetrics({
    snapshot,
    connectionId: options.connectionId ?? null,
    nowMs: options.nowMs ?? Date.now(),
  });

  return {
    metrics,
    health: computeHealthScore(metrics),
    alerts: buildInventoryAlerts(metrics),
  };
}

/** Fetch and analyse.
 *
 *  One round trip. The aggregation happens in SQL because the alternative — pulling
 *  a row per SKU per deposit to count six numbers in the browser — is 32.000 rows
 *  crossing the network on every Dashboard render for a mid-size catalogue. */
export async function loadIntelligence(
  connectionId: string | null = null
): Promise<IntelligenceResult> {
  const { data, error } = await supabase.rpc('integration_intelligence_snapshot', {
    p_connection_id: connectionId,
  });

  if (error) throw error;

  // An empty response is treated as "no company context", which the analytics layer
  // turns into the onboarding state. Not as an error: a brand-new account with no
  // integration is the expected first experience, not a failure.
  const snapshot = (data ?? { company_scoped: false }) as RawSnapshot;

  return analyzeSnapshot(snapshot, { connectionId });
}

// ─────────────────────────────────────────────────────────────────────────────
// Drill-down
// ─────────────────────────────────────────────────────────────────────────────

export interface NegativeStockRow {
  entityLinkId: string;
  connectionId: string;
  internalProductId: string | null;
  externalId: string;
  sku: string | null;
  ean: string | null;
  productName: string | null;
  totalQuantity: number;
  worstWarehouse: string | null;
  worstWarehouseQuantity: number | null;
  observedAt: string | null;
}

/** The negative-stock list behind the card.
 *
 *  A separate RPC rather than part of the snapshot: the snapshot runs on every
 *  Dashboard load and this list only when somebody clicks, so embedding the rows
 *  would make every session pay for a query most never open. */
export async function loadNegativeStock(
  connectionId: string | null = null,
  limit = 100
): Promise<NegativeStockRow[]> {
  const { data, error } = await supabase.rpc('integration_negative_stock_detail', {
    p_connection_id: connectionId,
    p_limit: limit,
  });

  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map(row => ({
    entityLinkId: row.entity_link_id as string,
    connectionId: row.connection_id as string,
    internalProductId: (row.internal_product_id as string | null) ?? null,
    externalId: row.external_id as string,
    sku: (row.sku as string | null) ?? null,
    ean: (row.ean as string | null) ?? null,
    productName: (row.product_name as string | null) ?? null,
    totalQuantity: Number(row.total_quantity ?? 0),
    worstWarehouse: (row.worst_warehouse as string | null) ?? null,
    worstWarehouseQuantity:
      row.worst_warehouse_quantity == null ? null : Number(row.worst_warehouse_quantity),
    observedAt: (row.observed_at as string | null) ?? null,
  }));
}
