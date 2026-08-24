// Classificador local de observações de fechamento — puro, sem rede/IA. Casa o
// texto normalizado da observação contra as palavras-chave normalizadas de cada
// categoria ativa, por limite de palavra (nunca substring, para evitar falso
// positivo tipo "faltou" casando dentro de outra palavra maior).

import type { ClosingCategory, ClosingCategoryMatch } from './closingReportTypes';

/** minúsculas, sem acento (só para comparação), pontuação->espaço, espaços colapsados. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** true se `keywordNormalized` (uma ou mais palavras) aparece em `textNormalized` respeitando limites de palavra. */
function matchesKeyword(textNormalized: string, keywordNormalized: string): boolean {
  if (!keywordNormalized) return false;
  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(keywordNormalized)}(?:$|\\s)`);
  return pattern.test(` ${textNormalized} `.replace(/\s+/g, ' '));
}

/**
 * Classifica uma observação contra as categorias ativas. Observação vazia/whitespace
 * retorna nenhuma categoria e `isUnclassified: false` — o chamador deve simplesmente
 * ignorá-la (não conta como "não classificada", só não participa da classificação).
 * Várias palavras-chave da mesma categoria batendo contam como 1 única ocorrência.
 */
export function classifyObservation(rawText: string, categories: ClosingCategory[]): ClosingCategoryMatch {
  const trimmed = rawText.trim();
  if (!trimmed) return { categoryIds: [], isUnclassified: false };

  const textNormalized = normalizeForMatch(trimmed);
  const categoryIds: string[] = [];

  for (const category of categories) {
    if (!category.active) continue;
    const matched = category.keywords.some(keyword => matchesKeyword(textNormalized, normalizeForMatch(keyword)));
    if (matched) categoryIds.push(category.id);
  }

  return { categoryIds, isUnclassified: categoryIds.length === 0 };
}
