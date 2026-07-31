// NF-e EAN/GTIN normalization utilities (pure, unit-testable)

import type { NfeInvoiceItem, CatalogProduct } from './nfeTypes';

const INVALID_TOKENS = new Set([
  'SEM GTIN',
  'SEMGTIN',
  'SEM_GTIN',
  'N/A',
  'NA',
  '0',
]);

const VALID_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * Returns the normalized EAN (digits only) when the input is a valid GTIN of
 * length 8/12/13/14, otherwise null. Treats SEM GTIN / 0 / empty / non-numeric
 * as absent. Never mutates the caller's value.
 */
export function normalizeEan(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;

  const upper = trimmed.toUpperCase();
  if (INVALID_TOKENS.has(upper)) return null;

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly === '') return null;
  if (/^0+$/.test(digitsOnly)) return null;
  if (!VALID_LENGTHS.has(digitsOnly.length)) return null;

  return digitsOnly;
}

export function isValidEan(raw: string | null | undefined): boolean {
  return normalizeEan(raw) !== null;
}

/**
 * Chooses the best EAN for an NF-e item: prefer cEAN, fall back to cEANTrib
 * only when cEAN is absent/invalid. Returns both the original valid value
 * (preserved as-is) and its normalized comparison form.
 */
export function resolveItemEan(
  cEAN: string | null | undefined,
  cEANTrib: string | null | undefined,
): { original: string | null; normalized: string | null } {
  const primaryNorm = normalizeEan(cEAN);
  if (primaryNorm) {
    return { original: String(cEAN).trim(), normalized: primaryNorm };
  }
  const tribNorm = normalizeEan(cEANTrib);
  if (tribNorm) {
    return { original: String(cEANTrib).trim(), normalized: tribNorm };
  }
  return { original: null, normalized: null };
}

/**
 * Indexes conference items by scannable EAN. Unlike a plain Map<string, item>,
 * this groups every item that shares the same NF-e EAN (R3: duplicate EAN
 * across lines) so none of them are shadowed/lost when scanning during the
 * blind count. The linked product's catalog EAN is kept as a fallback key
 * only when no NF-e line already claims it, matching prior single-item behavior.
 */
export function buildEanIndex(
  items: NfeInvoiceItem[],
  products: Map<string, CatalogProduct>,
): Map<string, NfeInvoiceItem[]> {
  const idx = new Map<string, NfeInvoiceItem[]>();

  for (const it of items) {
    if (it.nfe_ean_normalized) {
      const list = idx.get(it.nfe_ean_normalized);
      if (list) list.push(it);
      else idx.set(it.nfe_ean_normalized, [it]);
    }

    const prod = it.product_id ? products.get(it.product_id) : null;
    const pen = normalizeEan(prod?.ean);
    if (pen && !idx.has(pen)) idx.set(pen, [it]);
  }

  return idx;
}
