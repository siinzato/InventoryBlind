// Shared, type-only contract for ERP write-back adapters. Imported by both
// the browser (for status/report types) and the erp-sync Edge Function
// (Deno-side implementation lives only there, never in browser code, since
// it holds the real API key) — zero imports, zero I/O, safe under either
// runtime, same "type-only" constraint already documented for the pure
// algorithm files reused by supabase/functions/blindai-agent.

export interface ErpAdjustment {
  itemId: string;
  productId: string;
  sku: string | null;
  ean: string | null;
  previousQuantity: number;
  finalQuantity: number;
  idempotencyKey: string;
}

export interface ErpAdjustmentResult {
  itemId: string;
  success: boolean;
  /** True when the adapter is structurally ready but real credentials aren't configured yet. */
  pending: boolean;
  errorMessage: string | null;
  requestPayload: unknown;
  responsePayload: unknown;
}

export interface ErpAdapter {
  readonly provider: string;
  pushAdjustment(adjustment: ErpAdjustment): Promise<ErpAdjustmentResult>;
}
