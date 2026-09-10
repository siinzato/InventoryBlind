// Persistência de preferências do Comparador de Planilhas — chave própria,
// nunca a de outra ferramenta. Guarda só preferências de UI, nunca dados de
// planilha (nenhum conteúdo de arquivo passa perto de localStorage).

import { ComparatorPrefs } from './types';

export const COMPARATOR_PREFS_KEY = 'ib_spreadsheet_comparator_prefs';

export function loadComparatorPrefs(): Partial<ComparatorPrefs> | null {
  try {
    const raw = localStorage.getItem(COMPARATOR_PREFS_KEY);
    return raw ? (JSON.parse(raw) as Partial<ComparatorPrefs>) : null;
  } catch {
    return null;
  }
}

export function saveComparatorPrefs(prefs: ComparatorPrefs): void {
  try {
    localStorage.setItem(COMPARATOR_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage indisponível — segue sem persistir.
  }
}
