// Conversões e parsing numérico da Calculadora de Paletização — tudo
// normalizado internamente para mm e kg (spec §3).
//
// O parsing de número aceitando vírgula/ponto (inclusive milhar BR/
// internacional) já existe, testado, em spreadsheet-comparator — reaproveita
// direto em vez de duplicar a mesma heurística.

import { parseFlexibleNumber } from '../spreadsheet-comparator/normalization';

export type LengthUnit = 'mm' | 'cm' | 'm';
export type WeightUnit = 'g' | 'kg';

const MM_PER_UNIT: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000 };
const KG_PER_UNIT: Record<WeightUnit, number> = { g: 0.001, kg: 1 };

export function toMm(value: number, unit: LengthUnit): number {
  return value * MM_PER_UNIT[unit];
}

export function toKg(value: number, unit: WeightUnit): number {
  return value * KG_PER_UNIT[unit];
}

/** Aceita vírgula OU ponto como separador decimal, inclusive milhar BR
 *  ("1.234,56") ou internacional ("1,234.56") — spec §3. Só aceita valores
 *  positivos (dimensão/peso nunca são negativos ou zero aqui); `null` para
 *  entrada inválida, nunca `NaN` silencioso. */
export function parsePositiveNumber(input: string): number | null {
  const result = parseFlexibleNumber(input);
  if (!result.ok || result.value === null || result.value <= 0) return null;
  return result.value;
}
