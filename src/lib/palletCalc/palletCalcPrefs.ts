// Preferências e paletes personalizados da Calculadora de Paletização — chave
// própria, nunca a de outra ferramenta (mesmo padrão de
// src/lib/barcode/barcodeLabPrefs.ts e src/lib/pdfCenter/pdfCenterPrefs.ts).
// Guarda só configuração — nunca a lista de produtos/lote do usuário (spec §11).

import type { PalletSpec } from './types';

export const PALLET_CALC_PREFS_KEY = 'ib_pallet_calculator_prefs';

export interface CustomPalletPreset {
  id: string;
  label: string;
  spec: Omit<PalletSpec, 'name'>;
}

export interface PalletCalcPrefs {
  lastPalletPresetId?: string;
  lastLengthUnit?: 'mm' | 'cm' | 'm';
  lastWeightUnit?: 'g' | 'kg';
  customPallets?: CustomPalletPreset[];
}

export function loadPalletCalcPrefs(): PalletCalcPrefs | null {
  try {
    const raw = localStorage.getItem(PALLET_CALC_PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function savePalletCalcPrefs(prefs: PalletCalcPrefs): void {
  try {
    localStorage.setItem(PALLET_CALC_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage indisponível (modo privado, quota) — segue sem persistir.
  }
}
