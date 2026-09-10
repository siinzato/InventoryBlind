import type { PalletSpec } from './types';
import { uniformEdgeMm } from './types';

export const CUSTOM_PALLET_ID = 'custom';

export interface PalletPreset {
  id: string;
  label: string;
  spec: Omit<PalletSpec, 'name'>;
}

/** Presets são exemplos editáveis (spec §3) — nenhum limite de peso/altura é
 *  amarrado a transportadora nenhuma, só valores de partida plausíveis que o
 *  usuário ajusta livremente. */
export const PALLET_PRESETS: PalletPreset[] = [
  {
    id: 'pbr',
    label: 'PBR (1200 × 1000 mm)',
    spec: { lengthMm: 1200, widthMm: 1000, heightMm: 150, tareKg: 25, maxLoadKg: 1000, maxTotalHeightMm: 1800, overhangMm: uniformEdgeMm(0), operationalMaxLayers: undefined, minSupportPct: 75 },
  },
  {
    id: 'europeu',
    label: 'Europeu (1200 × 800 mm)',
    spec: { lengthMm: 1200, widthMm: 800, heightMm: 150, tareKg: 22, maxLoadKg: 1000, maxTotalHeightMm: 1800, overhangMm: uniformEdgeMm(0), operationalMaxLayers: undefined, minSupportPct: 75 },
  },
];

export function findPalletPreset(id: string): PalletPreset | undefined {
  return PALLET_PRESETS.find(p => p.id === id);
}
