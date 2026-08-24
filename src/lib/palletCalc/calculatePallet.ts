// Orquestrador único: layout -> camadas -> capacidade -> paletes -> alertas,
// para UMA caixa/palete. Usado tanto pelo cálculo unitário quanto por cada
// linha do lote — nenhuma lógica de UI aqui.

import { centroidOffsetPct } from './geometry';
import { computeMixedShelf, computeUniformGrid, type LayoutPattern } from './layoutEngine';
import { computeCapacityPerPallet, computeEffectiveLayers, computePalletsNeeded, type LayerLimitsResult, type PalletsNeeded } from './layerEngine';
import { computeCargoVolumeM3, computeExternalVolumeM3, computeHeights, computePalletWeights } from './capacityEngine';
import { computeAlerts } from './alerts';
import type { BoxSpec, PalletAlert, PalletSpec } from './types';

export interface PalletCalcAlternative {
  pattern: LayoutPattern;
  layers: LayerLimitsResult;
  capacityPerPallet: number;
  netKg: number;
  tareKg: number;
  grossKg: number;
  cargoHeightMm: number;
  totalHeightMm: number;
  cargoVolumeM3: number;
  externalVolumeM3: number;
  palletsNeeded: PalletsNeeded;
  centerOffsetPct: number;
  requiresTipping: boolean;
  effectiveBoxHeightMm: number;
  alerts: PalletAlert[];
  hasErrors: boolean;
}

export interface PalletCalcResult {
  box: BoxSpec;
  pallet: PalletSpec;
  alternatives: PalletCalcAlternative[];
  recommended: PalletCalcAlternative;
}

interface VerticalChoice {
  heightMm: number;
  footprintLengthMm: number;
  footprintWidthMm: number;
  tipped: boolean;
}

function verticalChoices(box: BoxSpec): VerticalChoice[] {
  const natural: VerticalChoice = { heightMm: box.heightMm, footprintLengthMm: box.lengthMm, footprintWidthMm: box.widthMm, tipped: false };
  if (box.rotation !== 'any') return [natural];
  return [
    natural,
    { heightMm: box.lengthMm, footprintLengthMm: box.widthMm, footprintWidthMm: box.heightMm, tipped: true },
    { heightMm: box.widthMm, footprintLengthMm: box.lengthMm, footprintWidthMm: box.heightMm, tipped: true },
  ];
}

function layoutPatternsFor(pallet: PalletSpec, footprintLengthMm: number, footprintWidthMm: number, rotationAllowed: boolean): LayoutPattern[] {
  const patterns: LayoutPattern[] = [computeUniformGrid(pallet.lengthMm, pallet.widthMm, footprintLengthMm, footprintWidthMm, false, pallet.overhangMm)];
  if (rotationAllowed) {
    patterns.push(computeUniformGrid(pallet.lengthMm, pallet.widthMm, footprintLengthMm, footprintWidthMm, true, pallet.overhangMm));
    const mixed = computeMixedShelf(pallet.lengthMm, pallet.widthMm, footprintLengthMm, footprintWidthMm);
    if (mixed) patterns.push(mixed);
  }
  return patterns.filter(p => p.boxesPerLayer > 0);
}

function buildAlternative(box: BoxSpec, pallet: PalletSpec, pattern: LayoutPattern, vertical: VerticalChoice): PalletCalcAlternative {
  const layers = computeEffectiveLayers({
    maxTotalHeightMm: pallet.maxTotalHeightMm,
    palletHeightMm: pallet.heightMm,
    boxHeightMm: vertical.heightMm,
    boxWeightKg: box.weightKg,
    boxesPerLayer: pattern.boxesPerLayer,
    palletMaxLoadKg: pallet.maxLoadKg,
    stackable: box.stackable,
    userMaxLayers: box.maxLayers,
    operationalMaxLayers: pallet.operationalMaxLayers,
    maxLoadOnBoxKg: box.maxLoadOnBoxKg,
  });

  const capacityPerPallet = computeCapacityPerPallet(pattern.boxesPerLayer, layers.layers);
  const { netKg, tareKg, grossKg } = computePalletWeights(box.weightKg, capacityPerPallet, pallet.tareKg);
  const { cargoHeightMm, totalHeightMm } = computeHeights(pallet.heightMm, vertical.heightMm, layers.layers);
  const cargoVolumeM3 = computeCargoVolumeM3(vertical.footprintLengthMm, vertical.footprintWidthMm, vertical.heightMm, capacityPerPallet);
  const externalVolumeM3 = computeExternalVolumeM3(pallet.lengthMm, pallet.widthMm, totalHeightMm);
  const palletsNeeded = computePalletsNeeded(box.quantity, capacityPerPallet);
  const centerOffsetPct = centroidOffsetPct(pattern.placements, pallet.lengthMm, pallet.widthMm);

  const alerts = computeAlerts({
    box, pallet, boxesPerLayer: pattern.boxesPerLayer, layers,
    occupationPct: pattern.occupationPct, overhangUsedMm: pattern.overhangUsedMm,
    netKg, totalHeightMm, lastPalletQty: palletsNeeded.lastPalletQty, capacityPerPallet,
    centerOffsetPct, requiresTipping: vertical.tipped,
  });

  return {
    pattern, layers, capacityPerPallet, netKg, tareKg, grossKg, cargoHeightMm, totalHeightMm,
    cargoVolumeM3, externalVolumeM3, palletsNeeded, centerOffsetPct, requiresTipping: vertical.tipped,
    effectiveBoxHeightMm: vertical.heightMm, alerts, hasErrors: alerts.some(a => a.severity === 'error'),
  };
}

function rankScore(alt: PalletCalcAlternative): [number, number, number, number, number] {
  return [
    alt.pattern.boxesPerLayer,
    alt.hasErrors ? 0 : 1,
    Math.round(alt.pattern.occupationPct),
    -alt.pattern.overhangUsedMm,
    alt.requiresTipping ? 0 : 1,
  ];
}

function compareAlternatives(a: PalletCalcAlternative, b: PalletCalcAlternative): number {
  const sa = rankScore(a);
  const sb = rankScore(b);
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return sb[i] - sa[i];
  }
  return a.pattern.id === b.pattern.id ? 0 : a.pattern.id < b.pattern.id ? -1 : 1;
}

export function calculatePallet(box: BoxSpec, pallet: PalletSpec): PalletCalcResult {
  const rotationAllowed = box.rotation !== 'none';
  const alternatives: PalletCalcAlternative[] = [];

  for (const vertical of verticalChoices(box)) {
    const patterns = layoutPatternsFor(pallet, vertical.footprintLengthMm, vertical.footprintWidthMm, rotationAllowed);
    for (const pattern of patterns) {
      alternatives.push(buildAlternative(box, pallet, pattern, vertical));
    }
  }

  if (alternatives.length === 0) {
    const empty = buildAlternative(box, pallet, { id: 'uniform-a', label: 'Orientação uniforme A', boxesPerLayer: 0, placements: [], baseAreaMm2: pallet.lengthMm * pallet.widthMm, occupiedAreaMm2: 0, occupationPct: 0, overhangUsedMm: 0 }, verticalChoices(box)[0]);
    return { box, pallet, alternatives: [empty], recommended: empty };
  }

  alternatives.sort(compareAlternatives);
  return { box, pallet, alternatives, recommended: alternatives[0] };
}
