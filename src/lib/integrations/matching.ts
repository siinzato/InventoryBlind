// Integration layer — identifier normalisation, matching and idempotency.
//
// Pure functions only, no I/O: this is the logic that decides "is the provider's
// record the same thing as ours", and getting it wrong duplicates a customer's
// catalogue. It is kept separate from the service so it can be tested exhaustively
// without a database.

import type { EntityLink, MatchSource, NormalizedRef } from './types.ts';

/** SKUs arrive with inconsistent case and padding across providers, and are
 *  compared, not displayed, after this. Display always uses the original. */
export function normalizeSku(sku: string | null | undefined): string | null {
  if (sku == null) return null;
  const trimmed = sku.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** EANs are digits. Providers pad, hyphenate, or ship them as numbers that lost
 *  a leading zero, so everything non-digit is stripped before comparing.
 *
 *  Length is validated because a truncated EAN is worse than no EAN: it can
 *  collide with a different product. Only the real GTIN lengths are accepted;
 *  anything else is treated as absent rather than trusted. */
export function normalizeEan(ean: string | null | undefined): string | null {
  if (ean == null) return null;
  const digits = ean.replace(/\D/g, '');
  if (digits.length === 0) return null;
  const VALID_GTIN_LENGTHS = [8, 12, 13, 14];
  return VALID_GTIN_LENGTHS.includes(digits.length) ? digits : null;
}

export interface MatchCandidate {
  internalId: string;
  sku?: string | null;
  ean?: string | null;
}

export interface MatchOutcome {
  internalId: string | null;
  source: MatchSource | null;
  /** True when more than one candidate matched at the winning precision. The
   *  caller must not auto-link an ambiguous match — it becomes a manual review
   *  row instead, because guessing here silently merges two products. */
  ambiguous: boolean;
}

/** Resolve a provider record to an internal row.
 *
 *  Precedence is deliberate and strict:
 *    1. an existing link for this external id — the only truly stable key, and
 *       the reason re-running a sync is a no-op instead of a duplicate;
 *    2. SKU, which the customer controls and usually maintains;
 *    3. EAN, which identifies a product but not necessarily *this seller's* row
 *       (two internal rows can legitimately share an EAN).
 *  Names are never used. */
export function resolveMatch(
  normalized: NormalizedRef,
  existingLinks: Pick<EntityLink, 'externalId' | 'internalId'>[],
  candidates: MatchCandidate[]
): MatchOutcome {
  const linked = existingLinks.find(
    link => link.externalId === normalized.externalId && link.internalId != null
  );
  if (linked?.internalId) {
    return { internalId: linked.internalId, source: 'external_id', ambiguous: false };
  }

  const sku = normalizeSku(normalized.sku);
  if (sku) {
    const hits = candidates.filter(c => normalizeSku(c.sku) === sku);
    if (hits.length === 1) return { internalId: hits[0].internalId, source: 'sku', ambiguous: false };
    if (hits.length > 1) return { internalId: null, source: 'sku', ambiguous: true };
  }

  const ean = normalizeEan(normalized.ean);
  if (ean) {
    const hits = candidates.filter(c => normalizeEan(c.ean) === ean);
    if (hits.length === 1) return { internalId: hits[0].internalId, source: 'ean', ambiguous: false };
    if (hits.length > 1) return { internalId: null, source: 'ean', ambiguous: true };
  }

  return { internalId: null, source: null, ambiguous: false };
}

/** Deterministic key for one outbound stock write.
 *
 *  Same inputs must always produce the same key so a retry — a double click, a
 *  cron overlap, a redelivered webhook — resolves to the row that already exists
 *  instead of posting a second movement to the customer's ERP. `scope` is what
 *  makes a *legitimately repeated* write distinct: the same SKU adjusted by two
 *  different count sessions is two events, not a retry of one. */
export function buildStockWriteKey(parts: {
  connectionId: string;
  productExternalId: string;
  warehouseExternalId: string | null;
  scope: string;
}): string {
  return [
    parts.connectionId,
    parts.productExternalId,
    parts.warehouseExternalId ?? '_',
    parts.scope,
  ].join(':');
}

/** Has this provider record changed since we last stored it?
 *
 *  Cheap guard so an unchanged record counts as `skipped` instead of `updated`,
 *  which keeps sync-run counters honest and avoids pointless writes. Compares
 *  only the fields the Core actually persists — a provider bumping an internal
 *  timestamp is not a change we care about. */
export function hasMeaningfulChange(
  previous: { externalSku: string | null; externalEan: string | null; externalName: string | null } | null,
  next: NormalizedRef
): boolean {
  if (previous == null) return true;
  return (
    normalizeSku(previous.externalSku) !== normalizeSku(next.sku) ||
    normalizeEan(previous.externalEan) !== normalizeEan(next.ean) ||
    (previous.externalName ?? '') !== (next.name ?? '')
  );
}
