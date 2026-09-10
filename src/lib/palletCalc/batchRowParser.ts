// Converte UMA linha já mapeada (spec §9) em BoxSpec + PalletSpec prontos
// para `calculatePallet`, ou numa lista de erros — nunca lança exceção (um
// erro de linha não pode interromper o lote).

import { toKg, toMm, parsePositiveNumber, type LengthUnit, type WeightUnit } from './units';
import type { BoxSpec, PalletSpec, RotationPolicy } from './types';
import { uniformEdgeMm } from './types';
import type { PalletBatchFieldKey } from './batchFields';
import { findPalletPreset } from './palletPresets';
import type { CustomPalletPreset } from './palletCalcPrefs';

export type BatchMappedRow = Record<PalletBatchFieldKey, unknown>;

export interface BatchRowParseResult {
  ok: boolean;
  box?: BoxSpec;
  pallet?: PalletSpec;
  errors: string[];
}

function toText(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function parseLengthUnit(raw: unknown): LengthUnit {
  const text = toText(raw).toLowerCase();
  if (text === 'cm') return 'cm';
  if (text === 'm') return 'm';
  return 'mm';
}

function parseWeightUnit(raw: unknown): WeightUnit {
  return toText(raw).toLowerCase() === 'g' ? 'g' : 'kg';
}

function parseRotationPolicy(raw: unknown): RotationPolicy {
  const text = toText(raw).toLowerCase();
  if (text.includes('qualquer') || text === 'any') return 'any';
  if (text.includes('90') || text.includes('base')) return 'base90';
  return 'none';
}

function resolvePallet(raw: unknown, customPallets: CustomPalletPreset[]): Omit<PalletSpec, 'name'> {
  const text = toText(raw).toLowerCase();
  const custom = customPallets.find(p => p.label.toLowerCase() === text);
  if (custom) return custom.spec;
  const preset = findPalletPreset(text.includes('euro') ? 'europeu' : 'pbr');
  return preset!.spec;
}

export function parseBatchRow(row: BatchMappedRow, customPallets: CustomPalletPreset[]): BatchRowParseResult {
  const errors: string[] = [];
  const lengthUnit = parseLengthUnit(row.lengthUnit);
  const weightUnit = parseWeightUnit(row.weightUnit);

  const lengthMm = parsePositiveNumber(toText(row.length));
  const widthMm = parsePositiveNumber(toText(row.width));
  const heightMm = parsePositiveNumber(toText(row.height));
  const weightKg = parsePositiveNumber(toText(row.weight));
  const quantity = parsePositiveNumber(toText(row.quantity));

  if (lengthMm == null) errors.push('Comprimento inválido.');
  if (widthMm == null) errors.push('Largura inválida.');
  if (heightMm == null) errors.push('Altura inválida.');
  if (weightKg == null) errors.push('Peso inválido.');
  if (quantity == null) errors.push('Quantidade inválida.');

  if (errors.length > 0) return { ok: false, errors };

  const box: BoxSpec = {
    sku: toText(row.sku) || undefined,
    description: toText(row.description) || undefined,
    lengthMm: toMm(lengthMm!, lengthUnit),
    widthMm: toMm(widthMm!, lengthUnit),
    heightMm: toMm(heightMm!, lengthUnit),
    weightKg: toKg(weightKg!, weightUnit),
    quantity: Math.floor(quantity!),
    rotation: parseRotationPolicy(row.rotation),
    stackable: true,
  };

  const basePallet = resolvePallet(row.palletType, customPallets);
  const maxHeightMm = parsePositiveNumber(toText(row.maxHeight));
  const maxWeightKg = parsePositiveNumber(toText(row.maxWeight));

  const pallet: PalletSpec = {
    name: toText(row.palletType) || 'PBR',
    ...basePallet,
    maxTotalHeightMm: maxHeightMm != null ? toMm(maxHeightMm, lengthUnit) : basePallet.maxTotalHeightMm,
    maxLoadKg: maxWeightKg != null ? toKg(maxWeightKg, weightUnit) : basePallet.maxLoadKg,
    overhangMm: basePallet.overhangMm ?? uniformEdgeMm(0),
  };

  return { ok: true, box, pallet, errors: [] };
}
