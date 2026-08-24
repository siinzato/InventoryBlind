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

  // Tags mais longas primeiro: uma tag específica ("Linha Tote Daily GC") não deve
  // perder para uma mais curta e genérica que também bata no mesmo título.
  const lineMatches: { line: ClassifierLine }[] = [];
  for (const line of activeLines) {
    const sortedKeywords = [...line.keywords].sort((a, b) => b.length - a.length);
    if (firstMatch(textNormalized, sortedKeywords)) lineMatches.push({ line });
  }

  if (lineMatches.length === 0) {
    return { status: 'auto', brandId: brand.id, lineId: null, matchedKeyword, brandCandidates: [], lineCandidates: [] };
  }

  if (lineMatches.length > 1) {
    return {
      status: 'needs_review', brandId: brand.id, lineId: null, matchedKeyword,
      brandCandidates: [],
      lineCandidates: lineMatches.map(m => ({ lineId: m.line.id, lineName: m.line.name })),
    };
  }

  return { status: 'auto', brandId: brand.id, lineId: lineMatches[0].line.id, matchedKeyword, brandCandidates: [], lineCandidates: [] };
}
