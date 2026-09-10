// Ambiente de teste roda em Node puro (sem jsdom) — polyfill local, mesmo
// padrão já usado em src/lib/barcode/__tests__/barcodeLabPrefs.test.ts.
import { beforeEach, describe, expect, it } from 'vitest';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

import { loadPdfCenterPrefs, PDF_CENTER_PREFS_KEY, savePdfCenterPrefs } from '../pdfCenterPrefs';

describe('pdfCenterPrefs', () => {
  beforeEach(() => localStorage.clear());

  it('retorna null quando nada foi salvo', () => {
    expect(loadPdfCenterPrefs()).toBeNull();
  });

  it('salva e recupera só preferências, nunca documentos', () => {
    savePdfCenterPrefs({ lastSizePresetId: '100x150', lastFitMode: 'contain' });
    const loaded = loadPdfCenterPrefs();
    expect(loaded).toEqual({ lastSizePresetId: '100x150', lastFitMode: 'contain' });
  });

  it('usa uma chave própria, isolada de outras ferramentas', () => {
    savePdfCenterPrefs({ lastFitMode: 'fill' });
    expect(localStorage.getItem(PDF_CENTER_PREFS_KEY)).not.toBeNull();
    expect(PDF_CENTER_PREFS_KEY).not.toBe('ib_barcode_lab_prefs');
  });
});
