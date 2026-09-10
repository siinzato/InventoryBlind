// Camadas, peso e quantidade (spec §5) — tudo puro, a partir dos números já
// normalizados (mm/kg) e do resultado do motor de layout (boxesPerLayer).

export type LayerLimitingFactor = 'altura' | 'peso' | 'empilhamento' | 'carga-sobre-caixa' | 'limite-operacional' | 'nenhum';

export interface LayerLimitsInput {
  maxTotalHeightMm: number;
  palletHeightMm: number;
  boxHeightMm: number;
  boxWeightKg: number;
  boxesPerLayer: number;
  palletMaxLoadKg: number;
  stackable: boolean;
  userMaxLayers?: number;
  operationalMaxLayers?: number;
  /** Carga máx. suportada SOBRE uma unidade da caixa (kg) — limita quantas
   *  camadas podem ficar em cima dela: (N-1)*peso_caixa <= limite. */
  maxLoadOnBoxKg?: number;
}

export interface LayerLimitsResult {
  layers: number;
  limitingFactor: LayerLimitingFactor;
  byHeight: number;
  byWeight: number;
  byBoxLoad: number;
  byOperational: number;
}

export function computeMaxLayersByHeight(maxTotalHeightMm: number, palletHeightMm: number, boxHeightMm: number): number {
  if (boxHeightMm <= 0) return 0;
  return Math.max(0, Math.floor((maxTotalHeightMm - palletHeightMm) / boxHeightMm));
}

export function computeMaxLayersByWeight(palletMaxLoadKg: number, layerWeightKg: number): number {
  if (layerWeightKg <= 0) return Infinity;
  return Math.max(0, Math.floor(palletMaxLoadKg / layerWeightKg));
}

/** Quantas camadas cabem antes de ultrapassar a carga que UMA caixa da
 *  camada de baixo pode suportar em cima dela — a caixa de baixo não
 *  sustenta o próprio peso, só o das (N-1) camadas acima. */
export function computeMaxLayersByBoxLoad(maxLoadOnBoxKg: number | undefined, boxWeightKg: number): number {
  if (maxLoadOnBoxKg == null) return Infinity;
  if (boxWeightKg <= 0) return Infinity;
  return Math.max(1, Math.floor(maxLoadOnBoxKg / boxWeightKg) + 1);
}

export function computeEffectiveLayers(input: LayerLimitsInput): LayerLimitsResult {
  if (!input.stackable) {
    return { layers: 1, limitingFactor: 'empilhamento', byHeight: computeMaxLayersByHeight(input.maxTotalHeightMm, input.palletHeightMm, input.boxHeightMm), byWeight: Infinity, byBoxLoad: Infinity, byOperational: input.operationalMaxLayers ?? Infinity };
  }

  const layerWeightKg = input.boxesPerLayer * input.boxWeightKg;
  const byHeight = computeMaxLayersByHeight(input.maxTotalHeightMm, input.palletHeightMm, input.boxHeightMm);
  const byWeight = computeMaxLayersByWeight(input.palletMaxLoadKg, layerWeightKg);
  const byBoxLoad = computeMaxLayersByBoxLoad(input.maxLoadOnBoxKg, input.boxWeightKg);
  const byOperational = input.operationalMaxLayers ?? Infinity;
  const byUser = input.userMaxLayers ?? Infinity;

  const candidates: Array<{ value: number; factor: LayerLimitingFactor }> = [
    { value: byHeight, factor: 'altura' },
    { value: byWeight, factor: 'peso' },
    { value: byBoxLoad, factor: 'carga-sobre-caixa' },
    { value: byOperational, factor: 'limite-operacional' },
    { value: byUser, factor: 'limite-operacional' },
  ];

  let winner = { value: Infinity, factor: 'nenhum' as LayerLimitingFactor };
  for (const c of candidates) {
    if (c.value < winner.value) winner = c;
  }

  return { layers: Number.isFinite(winner.value) ? winner.value : 0, limitingFactor: winner.factor, byHeight, byWeight, byBoxLoad, byOperational };
}

export function computeCapacityPerPallet(boxesPerLayer: number, layers: number): number {
  return boxesPerLayer * layers;
}

export interface PalletsNeeded {
  fullPallets: number;
  lastPalletQty: number;
  totalPallets: number;
}

/** spec §5: `quantidade_paletes = ceil(quantidade_total / capacidade_palete)`,
 *  com o último palete tratado separadamente quando parcial. */
export function computePalletsNeeded(totalQuantity: number, capacityPerPallet: number): PalletsNeeded {
  if (capacityPerPallet <= 0 || totalQuantity <= 0) return { fullPallets: 0, lastPalletQty: totalQuantity > 0 ? totalQuantity : 0, totalPallets: totalQuantity > 0 ? 1 : 0 };

  const totalPallets = Math.ceil(totalQuantity / capacityPerPallet);
  const remainder = totalQuantity % capacityPerPallet;
  const lastPalletQty = remainder === 0 ? capacityPerPallet : remainder;
  const fullPallets = remainder === 0 ? totalPallets : totalPallets - 1;

  return { fullPallets, lastPalletQty, totalPallets };
}
