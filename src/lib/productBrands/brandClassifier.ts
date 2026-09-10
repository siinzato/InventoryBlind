// Classificador local de título de produto -> marca/linha. Puro, sem IA/API externa.
// Mesma técnica de normalização/casamento por limite de palavra de
// closingReports/observationClassifier.ts e nfe/nfeAssociation.ts — reaproveitada
// aqui via normalizeForMatch, não duplicada.

import { normalizeForMatch } from '../closingReports/observationClassifier';

export interface ClassifierLine {
  id: string;
  name: string;
  keywords: string[];
  active: boolean;
  /** Termos que ELIMINAM a linha mesmo com keyword positiva presente (migration 110). */
  excludeKeywords?: string[];
  /** Ordem de avaliação dentro da marca; menor avalia primeiro. Default 100. */
  matchPriority?: number;
}

export interface ClassifierBrand {
  id: string;
  name: string;
  keywords: string[];
  active: boolean;
  lines: ClassifierLine[];
}

export type MatchStatus = 'auto' | 'needs_review' | 'unmatched';

export interface BrandCandidate {
  brandId: string;
  brandName: string;
}

export interface LineCandidate {
  lineId: string;
  lineName: string;
}

export interface ClassificationResult {
  status: MatchStatus;
  brandId: string | null;
  lineId: string | null;
  matchedKeyword: string | null;
  /** Candidatos que geraram ambiguidade — vazio quando status não é 'needs_review'. */
  brandCandidates: BrandCandidate[];
  lineCandidates: LineCandidate[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** true se `phraseNormalized` aparece em `textNormalized` respeitando limites de
 *  palavra — nunca por substring, então termos curtos ("GC", "AZ", "DUX", "ESR")
 *  só casam como palavra/expressão completa, nunca dentro de outra palavra. */
function containsWholeWord(textNormalized: string, phraseNormalized: string): boolean {
  if (!phraseNormalized) return false;
  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(phraseNormalized)}(?:$|\\s)`);
  return pattern.test(` ${textNormalized} `.replace(/\s+/g, ' '));
}

/** Todas as palavras-chave efetivas de uma marca — o nome oficial sempre conta
 *  como palavra-chave automaticamente, além dos aliases cadastrados. */
function effectiveBrandKeywords(brand: ClassifierBrand): string[] {
  return [brand.name, ...brand.keywords];
}

function firstMatch(textNormalized: string, keywords: string[]): string | null {
  for (const keyword of keywords) {
    const normalized = normalizeForMatch(keyword);
    if (normalized && containsWholeWord(textNormalized, normalized)) return keyword;
  }
  return null;
}

/**
 * Classifica um título de produto contra as marcas ativas (e suas linhas ativas)
 * de UM tenant. Nunca escolhe silenciosamente em caso de ambiguidade — mais de uma
 * marca (ou mais de uma linha dentro da marca identificada) batendo vai para
 * 'needs_review' com os candidatos, para confirmação manual.
 */
export function classifyProductTitle(title: string, brands: ClassifierBrand[]): ClassificationResult {
  const textNormalized = normalizeForMatch(title);
  const activeBrands = brands.filter(b => b.active);

  const brandMatches: { brand: ClassifierBrand; matchedKeyword: string }[] = [];
  for (const brand of activeBrands) {
    const matched = firstMatch(textNormalized, effectiveBrandKeywords(brand));
    if (matched) brandMatches.push({ brand, matchedKeyword: matched });
  }

  if (brandMatches.length === 0) {
    return { status: 'unmatched', brandId: null, lineId: null, matchedKeyword: null, brandCandidates: [], lineCandidates: [] };
  }

  if (brandMatches.length > 1) {
    return {
      status: 'needs_review', brandId: null, lineId: null, matchedKeyword: null,
      brandCandidates: brandMatches.map(m => ({ brandId: m.brand.id, brandName: m.brand.name })),
      lineCandidates: [],
    };
  }

  const { brand, matchedKeyword } = brandMatches[0];
  const activeLines = brand.lines.filter(l => l.active);

  // O nome da linha conta como palavra-chave, igual ao que já valia para marca — uma linha
  // chamada "Puffer" deve casar "Capa Puffer" sem exigir alias cadastrado.
  //
  // Tags mais longas primeiro dentro da MESMA linha: uma tag específica ("tote daily") não
  // deve perder para uma mais curta e genérica que também bata no mesmo título.
  const lineMatches: { line: ClassifierLine; keyword: string; priority: number }[] = [];
  for (const line of activeLines) {
    const excluded = firstMatch(textNormalized, line.excludeKeywords ?? []);
    if (excluded) continue;
    const sortedKeywords = [line.name, ...line.keywords].sort((a, b) => b.length - a.length);
    const keyword = firstMatch(textNormalized, sortedKeywords);
    if (keyword) lineMatches.push({ line, keyword, priority: line.matchPriority ?? 100 });
  }

  if (lineMatches.length === 0) {
    return { status: 'auto', brandId: brand.id, lineId: null, matchedKeyword, brandCandidates: [], lineCandidates: [] };
  }

  // Mais de uma linha batendo é o caso normal, não erro: "Lancheira Puffer Rosa" bate em
  // Lancheiras (categoria) e em Puffer (modelo). A prioridade da linha decide — categoria do
  // que o produto É vence o nome que ele TEM. Só quando duas linhas empatam em prioridade E
  // em especificidade do termo é que a ambiguidade é real e vai para revisão manual, em vez
  // de o sistema escolher uma às cegas.
  const sorted = [...lineMatches].sort((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority : b.keyword.length - a.keyword.length
  );
  const best = sorted[0];
  const tied = sorted.filter(m => m.priority === best.priority && m.keyword.length === best.keyword.length);

  if (tied.length > 1) {
    return {
      status: 'needs_review', brandId: brand.id, lineId: null, matchedKeyword,
      brandCandidates: [],
      lineCandidates: tied.map(m => ({ lineId: m.line.id, lineName: m.line.name })),
    };
  }

  return { status: 'auto', brandId: brand.id, lineId: best.line.id, matchedKeyword: best.keyword, brandCandidates: [], lineCandidates: [] };
}
