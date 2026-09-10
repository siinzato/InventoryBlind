import { describe, expect, it, beforeEach } from 'vitest';
import { loadBarcodeLabPrefs, saveBarcodeLabPrefs, BARCODE_LAB_PREFS_KEY } from '../barcodeLabPrefs';
import { DEFAULT_BARCODE_LAB_SETTINGS } from '../barcodeTypes';

// O ambiente de teste roda em Node puro (sem jsdom) — nenhum outro teste do
// projeto usa localStorage, então não há um polyfill global; criamos um só
// para este arquivo, sem alterar a configuração do vitest.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

describe('Preferências do Laboratório de Códigos de Barras', () => {
  beforeEach(() => { localStorage.clear(); });

  it('não existe nada salvo -> retorna null', () => {
    expect(loadBarcodeLabPrefs()).toBeNull();
  });

  it('salva e restaura as preferências corretamente', () => {
    const settings = { ...DEFAULT_BARCODE_LAB_SETTINGS, sizeId: '100x150' as const, showLot: false, copies: 7 };
    saveBarcodeLabPrefs(settings);
    const restored = loadBarcodeLabPrefs();
    expect(restored).toEqual(settings);
  });

  it('usa chave própria — nunca a do Gerador de Etiquetas existente', () => {
    expect(BARCODE_LAB_PREFS_KEY).toBe('ib_barcode_lab_prefs');
    expect(BARCODE_LAB_PREFS_KEY).not.toBe('ib_label_font_prefs');
  });

  it('não quebra quando localStorage tem JSON inválido', () => {
    localStorage.setItem(BARCODE_LAB_PREFS_KEY, '{not valid json');
    expect(loadBarcodeLabPrefs()).toBeNull();
  });
});
