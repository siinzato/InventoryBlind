// Preferências de exibição do Catálogo de Produtos (colunas visíveis) — chave
// própria em localStorage, mesmo padrão já usado pelo Comparador de Planilhas
// (ib_spreadsheet_comparator_prefs). Guarda só preferência de UI, nunca dado de produto.

export const CATALOG_OPTIONAL_COLUMNS = [
  { key: 'ean', label: 'EAN' },
  { key: 'brandLine', label: 'Marca / Linha' },
  { key: 'location', label: 'Local' },
  { key: 'price', label: 'Preço' },
  { key: 'quality', label: 'Qualidade cadastral' },
  { key: 'abcXyz', label: 'ABC / XYZ' },
  { key: 'updatedAt', label: 'Atualização' },
] as const;

export type CatalogColumnKey = typeof CATALOG_OPTIONAL_COLUMNS[number]['key'];

const DEFAULT_VISIBLE_COLUMNS: CatalogColumnKey[] = ['ean', 'brandLine', 'location', 'price', 'quality', 'abcXyz', 'updatedAt'];

export interface CatalogPrefs {
  visibleColumns: CatalogColumnKey[];
}

const CATALOG_PREFS_KEY = 'ib_product_catalog_prefs';

export function loadCatalogPrefs(): CatalogPrefs {
  try {
    const raw = localStorage.getItem(CATALOG_PREFS_KEY);
    if (!raw) return { visibleColumns: DEFAULT_VISIBLE_COLUMNS };
    const parsed = JSON.parse(raw) as Partial<CatalogPrefs>;
    const known = new Set(CATALOG_OPTIONAL_COLUMNS.map(c => c.key));
    const visibleColumns = (parsed.visibleColumns ?? DEFAULT_VISIBLE_COLUMNS).filter(k => known.has(k));
    return { visibleColumns: visibleColumns.length > 0 ? visibleColumns : DEFAULT_VISIBLE_COLUMNS };
  } catch {
    return { visibleColumns: DEFAULT_VISIBLE_COLUMNS };
  }
}

export function saveCatalogPrefs(prefs: CatalogPrefs): void {
  try {
    localStorage.setItem(CATALOG_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage indisponível — segue sem persistir.
  }
}
