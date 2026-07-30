// NF-e association logic: exact match priority + name similarity (pure).

import type { CatalogProduct, LinkMethod, ParsedNfeItem } from './nfeTypes';
import { normalizeEan } from './nfeEanUtils';

export interface AssociationInput {
  nfeCode: string;
  eanNormalized: string | null;
}

export interface LearnedLookup {
  bySku: Map<string, string>; // match_value -> product_id
  byEan: Map<string, string>;
}

export interface AssociationResult {
  productId: string | null;
  method: LinkMethod;
}

/**
 * Resolves an NF-e item to a catalog product by strict priority:
 * 1. SKU / cProd exact
 * 2. EAN exact (normalized)
 * 3. learned association (company-scoped, fallback only)
 * 4. none (manual pending)
 * Never overrides an exact match with a learned one.
 */
export function resolveAssociation(
  item: AssociationInput,
  productsBySku: Map<string, string>,
  productsByEan: Map<string, string>,
  learned: LearnedLookup,
): AssociationResult {
  const skuKey = item.nfeCode?.trim();
  if (skuKey) {
    const bySku = productsBySku.get(skuKey);
    if (bySku) return { productId: bySku, method: 'sku' };
  }

  if (item.eanNormalized) {
    const byEan = productsByEan.get(item.eanNormalized);
    if (byEan) return { productId: byEan, method: 'ean' };
  }

  if (skuKey) {
    const learnedSku = learned.bySku.get(skuKey);
    if (learnedSku) return { productId: learnedSku, method: 'learned' };
  }
  if (item.eanNormalized) {
    const learnedEan = learned.byEan.get(item.eanNormalized);
    if (learnedEan) return { productId: learnedEan, method: 'learned' };
  }

  return { productId: null, method: 'none' };
}

/** Builds fast lookup maps from a catalog slice. */
export function buildProductLookups(products: CatalogProduct[]): {
  bySku: Map<string, string>;
  byEan: Map<string, string>;
} {
  const bySku = new Map<string, string>();
  const byEan = new Map<string, string>();
  for (const p of products) {
    if (p.sku) {
      const key = p.sku.trim();
      if (key && !bySku.has(key)) bySku.set(key, p.id);
    }
    const en = normalizeEan(p.ean);
    if (en && !byEan.has(en)) byEan.set(en, p.id);
  }
  return { bySku, byEan };
}

// ── Name similarity (Jaccard over normalized word sets) ──────────────────────

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'para', 'a', 'o', 'em']);

export function normalizeNameTokens(name: string): Set<string> {
  const cleaned = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return new Set(tokens);
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export const NAME_SIMILARITY_THRESHOLD = 0.25;

export interface NameSuggestion {
  product: CatalogProduct;
  score: number;
}

/**
 * Returns the single best catalog product whose name is similar enough to the
 * NF-e description to suggest (never auto-confirm). Deterministic ordering:
 * highest score, then product id ascending.
 */
export function suggestByName(
  description: string,
  products: CatalogProduct[],
): NameSuggestion | null {
  const target = normalizeNameTokens(description);
  if (target.size === 0) return null;

  let best: NameSuggestion | null = null;
  for (const p of products) {
    const score = jaccardSimilarity(target, normalizeNameTokens(p.name));
    if (score < NAME_SIMILARITY_THRESHOLD) continue;
    if (
      best === null ||
      score > best.score ||
      (score === best.score && p.id < best.product.id)
    ) {
      best = { product: p, score };
    }
  }
  return best;
}

/** Collects the distinct SKUs and normalized EANs referenced by a note's items. */
export function collectItemCodes(items: ParsedNfeItem[]): {
  skus: string[];
  eans: string[];
} {
  const skus = new Set<string>();
  const eans = new Set<string>();
  for (const it of items) {
    if (it.nfeCode?.trim()) skus.add(it.nfeCode.trim());
    if (it.eanNormalized) eans.add(it.eanNormalized);
  }
  return { skus: [...skus], eans: [...eans] };
}
