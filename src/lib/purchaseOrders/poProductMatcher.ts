// Correspondência entre item de OC e item(ns) de NF-e vinculada(s) — cascata
// determinística, espelhando nfe/nfeAssociation.ts (mesma ordem de confiança:
// vínculo já existente > código exato > EAN exato > De/Para aprendido > sugestão
// por descrição, nunca auto-confirmada). Puro — nenhuma chamada de rede/IA.

import { normalizeNameTokens, jaccardSimilarity, NAME_SIMILARITY_THRESHOLD } from '../nfe/nfeAssociation';

export type PoMatchMethod = 'product_id' | 'code' | 'ean' | 'learned' | 'none';

export interface PoMatchableItem {
  id: string;
  originCode: string | null;
  eanNormalized: string | null;
  productId: string | null;
  description: string;
}

export interface NfeMatchableItem {
  id: string;
  nfeCode: string | null;
  nfeEanNormalized: string | null;
  productId: string | null;
  description: string;
}

export interface PoDetoParaLookup {
  /** match_type 'code' -> match_value (origin_code normalizado) -> product_id */
  byCode: Map<string, string>;
  /** match_type 'ean' -> match_value (ean normalizado) -> product_id */
  byEan: Map<string, string>;
}

export interface PoMatchCandidate {
  nfeItemId: string;
  method: PoMatchMethod;
}

export interface PoMatchResult {
  poItemId: string;
  candidates: PoMatchCandidate[];
  /** true quando há mais de um candidato pela MESMA chave (mesmo método) — exige escolha manual. */
  ambiguous: boolean;
  /** Sugestão por descrição (nunca confirma sozinha), só preenchida quando não há candidato por chave. */
  nameSuggestion: { nfeItemId: string; score: number } | null;
}

function normalizeCode(code: string | null): string | null {
  const trimmed = code?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolve, para um item de OC, os itens de NF-e (dentre as notas vinculadas) que
 * podem corresponder a ele. Nunca escolhe sozinho quando mais de um item bate na
 * mesma chave — isso vira `ambiguous: true` e exige confirmação manual.
 */
export function matchPoItem(
  poItem: PoMatchableItem,
  nfeItems: NfeMatchableItem[],
  learned: PoDetoParaLookup
): PoMatchResult {
  const originCode = normalizeCode(poItem.originCode);
  const ean = poItem.eanNormalized;

  // 1. produto interno já associado ao item da OC, casado com itens de NF-e já
  //    resolvidos para o mesmo produto.
  if (poItem.productId) {
    const byProduct = nfeItems.filter(n => n.productId === poItem.productId);
    if (byProduct.length > 0) {
      return {
        poItemId: poItem.id,
        candidates: byProduct.map(n => ({ nfeItemId: n.id, method: 'product_id' as const })),
        ambiguous: false, // várias NF-es podem legitimamente atender o mesmo produto — não é ambiguidade de identidade
        nameSuggestion: null,
      };
    }
  }

  // 2. código/SKU exatamente igual ao cProd da NF-e.
  if (originCode) {
    const byCode = nfeItems.filter(n => normalizeCode(n.nfeCode) === originCode);
    if (byCode.length > 0) {
      return {
        poItemId: poItem.id,
        candidates: byCode.map(n => ({ nfeItemId: n.id, method: 'code' as const })),
        ambiguous: false,
        nameSuggestion: null,
      };
    }
  }

  // 3. EAN/GTIN exatamente igual.
  if (ean) {
    const byEan = nfeItems.filter(n => n.nfeEanNormalized === ean);
    if (byEan.length > 0) {
      return {
        poItemId: poItem.id,
        candidates: byEan.map(n => ({ nfeItemId: n.id, method: 'ean' as const })),
        ambiguous: false,
        nameSuggestion: null,
      };
    }
  }

  // 4. De/Para previamente confirmado (empresa+fornecedor+origem já aplicados pelo chamador ao montar `learned`).
  const learnedProductId = (originCode && learned.byCode.get(originCode)) || (ean && learned.byEan.get(ean)) || null;
  if (learnedProductId) {
    const byLearned = nfeItems.filter(n => n.productId === learnedProductId);
    if (byLearned.length > 0) {
      return {
        poItemId: poItem.id,
        candidates: byLearned.map(n => ({ nfeItemId: n.id, method: 'learned' as const })),
        ambiguous: false,
        nameSuggestion: null,
      };
    }
  }

  // 5. Sugestão por descrição — nunca confirma sozinha.
  const target = normalizeNameTokens(poItem.description);
  let best: { nfeItemId: string; score: number } | null = null;
  if (target.size > 0) {
    for (const n of nfeItems) {
      const score = jaccardSimilarity(target, normalizeNameTokens(n.description));
      if (score < NAME_SIMILARITY_THRESHOLD) continue;
      if (best === null || score > best.score || (score === best.score && n.id < best.nfeItemId)) {
        best = { nfeItemId: n.id, score };
      }
    }
  }

  return { poItemId: poItem.id, candidates: [], ambiguous: false, nameSuggestion: best };
}

export function buildDetoParaLookup(rows: { matchType: 'code' | 'ean'; matchValue: string; productId: string }[]): PoDetoParaLookup {
  const byCode = new Map<string, string>();
  const byEan = new Map<string, string>();
  for (const row of rows) {
    const map = row.matchType === 'code' ? byCode : byEan;
    if (!map.has(row.matchValue)) map.set(row.matchValue, row.productId);
  }
  return { byCode, byEan };
}
