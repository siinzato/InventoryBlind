import { describe, expect, it, beforeEach } from 'vitest';
import { loadComparatorPrefs, saveComparatorPrefs, COMPARATOR_PREFS_KEY } from '../prefs';
import { ComparatorPrefs } from '../types';

// Ambiente de teste roda em Node puro (sem jsdom) — polyfill local, mesmo
// padrão já usado em src/lib/barcode/__tests__/barcodeLabPrefs.test.ts.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

describe('Preferências do Comparador de Planilhas', () => {
  beforeEach(() => { localStorage.clear(); });

  it('sem nada salvo -> null', () => {
    expect(loadComparatorPrefs()).toBeNull();
  });

  it('salva e restaura preferências (nunca dados de planilha)', () => {
    const prefs: ComparatorPrefs = {
      preset: 'erp-vs-wms', defaultCaseSensitive: true, duplicateStrategy: 'row-by-row',
      defaultToleranceAbsolute: 0.01, defaultTolerancePercent: 2, visibleColumns: ['Chave', 'Status'],
    };
    saveComparatorPrefs(prefs);
    expect(loadComparatorPrefs()).toEqual(prefs);
  });

  it('usa chave própria, diferente de outras ferramentas do InventoryBlind', () => {
    expect(COMPARATOR_PREFS_KEY).toBe('ib_spreadsheet_comparator_prefs');
    expect(COMPARATOR_PREFS_KEY).not.toBe('ib_label_font_prefs');
    expect(COMPARATOR_PREFS_KEY).not.toBe('ib_barcode_lab_prefs');
  });
});
