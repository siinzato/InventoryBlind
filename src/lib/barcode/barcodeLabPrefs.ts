// Persistência de preferências do Laboratório de Códigos de Barras.
// Chave própria — NUNCA a mesma do Gerador de Etiquetas ('ib_label_font_prefs').

import { BarcodeLabSettings } from './barcodeTypes';

export const BARCODE_LAB_PREFS_KEY = 'ib_barcode_lab_prefs';

export function loadBarcodeLabPrefs(): Partial<BarcodeLabSettings> | null {
  try {
    const raw = localStorage.getItem(BARCODE_LAB_PREFS_KEY);
    return raw ? (JSON.parse(raw) as Partial<BarcodeLabSettings>) : null;
  } catch {
    return null;
  }
}

export function saveBarcodeLabPrefs(settings: BarcodeLabSettings): void {
  try {
    localStorage.setItem(BARCODE_LAB_PREFS_KEY, JSON.stringify(settings));
  } catch {
    // storage indisponível (modo privado, quota) — segue sem persistir.
  }
}
