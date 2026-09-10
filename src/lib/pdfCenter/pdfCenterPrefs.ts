// Preferências da Central de PDFs — chave própria, NUNCA a de outra
// ferramenta (mesma regra de src/lib/barcode/barcodeLabPrefs.ts). Guarda só
// tamanhos/margens/qualidade/nomenclatura — nunca o conteúdo de um documento
// (spec §12: "Salvar apenas preferências").

import type { FitMode } from './types';

export const PDF_CENTER_PREFS_KEY = 'ib_pdf_center_prefs';

export interface PdfCenterPrefs {
  lastSizePresetId?: string;
  lastCustomWidthMm?: number;
  lastCustomHeightMm?: number;
  lastMarginMm?: number;
  lastFitMode?: FitMode;
  lastNupRows?: number;
  lastNupCols?: number;
  lastOptimizeQuality?: 'alta' | 'media' | 'compacta';
  lastNamingPrefix?: string;
  lastNamingSuffix?: string;
}

export function loadPdfCenterPrefs(): PdfCenterPrefs | null {
  try {
    const raw = localStorage.getItem(PDF_CENTER_PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function savePdfCenterPrefs(prefs: PdfCenterPrefs): void {
  try {
    localStorage.setItem(PDF_CENTER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage indisponível (modo privado, quota) — segue sem persistir.
  }
}
