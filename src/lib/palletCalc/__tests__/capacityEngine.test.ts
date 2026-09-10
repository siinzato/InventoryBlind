import { describe, expect, it } from 'vitest';
import { computeCargoVolumeM3, computeExternalVolumeM3, computeHeights, computePalletWeights } from '../capacityEngine';

describe('computePalletWeights', () => {
  it('líquido + tara = bruto', () => {
    const result = computePalletWeights(5, 50, 25);
    expect(result.netKg).toBe(250);
    expect(result.tareKg).toBe(25);
    expect(result.grossKg).toBe(275);
  });
});

describe('computeHeights', () => {
  it('altura da carga + palete = altura total (caso de referência)', () => {
    const result = computeHeights(150, 250, 5);
    expect(result.cargoHeightMm).toBe(1250);
    expect(result.totalHeightMm).toBe(1400);
  });
});

describe('computeCargoVolumeM3', () => {
  it('converte mm para m e multiplica pela quantidade', () => {
    const volume = computeCargoVolumeM3(400, 300, 250, 50);
    expect(volume).toBeCloseTo(0.4 * 0.3 * 0.25 * 50, 9);
  });
});

describe('computeExternalVolumeM3', () => {
  it('usa a base do PALETE, não a soma das caixas', () => {
    const volume = computeExternalVolumeM3(1200, 1000, 1400);
    expect(volume).toBeCloseTo(1.2 * 1.0 * 1.4, 9);
  });
});
