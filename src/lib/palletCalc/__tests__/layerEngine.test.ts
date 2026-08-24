import { describe, expect, it } from 'vitest';
import { computeCapacityPerPallet, computeEffectiveLayers, computeMaxLayersByBoxLoad, computeMaxLayersByHeight, computeMaxLayersByWeight, computePalletsNeeded } from '../layerEngine';

describe('computeMaxLayersByHeight (caso de referência do spec §12)', () => {
  it('altura máx 1600, palete 150, caixa 250 -> 5 camadas', () => {
    expect(computeMaxLayersByHeight(1600, 150, 250)).toBe(5);
  });

  it('nunca negativo mesmo se o palete já excede o máximo', () => {
    expect(computeMaxLayersByHeight(100, 150, 250)).toBe(0);
  });
});

describe('computeMaxLayersByWeight', () => {
  it('divide capacidade de carga pelo peso de uma camada', () => {
    expect(computeMaxLayersByWeight(1000, 300)).toBe(3);
  });

  it('sem peso na camada, não limita (Infinity)', () => {
    expect(computeMaxLayersByWeight(1000, 0)).toBe(Infinity);
  });
});

describe('computeMaxLayersByBoxLoad', () => {
  it('(N-1)*peso <= limite -> N = floor(limite/peso)+1', () => {
    // caixa de 10kg, suporta até 50kg em cima -> 5 camadas acima + a própria = 6
    expect(computeMaxLayersByBoxLoad(50, 10)).toBe(6);
  });

  it('sem limite configurado, não restringe', () => {
    expect(computeMaxLayersByBoxLoad(undefined, 10)).toBe(Infinity);
  });
});

describe('computeEffectiveLayers', () => {
  it('caso de referência completo: altura é o fator limitante -> 5 camadas', () => {
    const result = computeEffectiveLayers({
      maxTotalHeightMm: 1600, palletHeightMm: 150, boxHeightMm: 250,
      boxWeightKg: 5, boxesPerLayer: 10, palletMaxLoadKg: 100000,
      stackable: true,
    });
    expect(result.layers).toBe(5);
    expect(result.limitingFactor).toBe('altura');
  });

  it('produto não empilhável força 1 camada', () => {
    const result = computeEffectiveLayers({
      maxTotalHeightMm: 1600, palletHeightMm: 150, boxHeightMm: 250,
      boxWeightKg: 5, boxesPerLayer: 10, palletMaxLoadKg: 100000,
      stackable: false,
    });
    expect(result.layers).toBe(1);
    expect(result.limitingFactor).toBe('empilhamento');
  });

  it('peso vira o fator limitante quando mais restritivo que altura', () => {
    const result = computeEffectiveLayers({
      maxTotalHeightMm: 5000, palletHeightMm: 150, boxHeightMm: 100,
      boxWeightKg: 50, boxesPerLayer: 10, palletMaxLoadKg: 1000, // 500kg/camada -> só 2 camadas
      stackable: true,
    });
    expect(result.layers).toBe(2);
    expect(result.limitingFactor).toBe('peso');
  });

  it('limite operacional do usuário restringe mesmo quando fisicamente caberia mais', () => {
    const result = computeEffectiveLayers({
      maxTotalHeightMm: 1600, palletHeightMm: 150, boxHeightMm: 100,
      boxWeightKg: 1, boxesPerLayer: 10, palletMaxLoadKg: 100000,
      stackable: true, operationalMaxLayers: 3,
    });
    expect(result.layers).toBe(3);
    expect(result.limitingFactor).toBe('limite-operacional');
  });
});

describe('computeCapacityPerPallet', () => {
  it('caso de referência: 10 por camada x 5 camadas = 50', () => {
    expect(computeCapacityPerPallet(10, 5)).toBe(50);
  });
});

describe('computePalletsNeeded (caso de referência: 120 unidades, capacidade 50)', () => {
  it('dois paletes completos de 50 e um parcial de 20', () => {
    const result = computePalletsNeeded(120, 50);
    expect(result.totalPallets).toBe(3);
    expect(result.fullPallets).toBe(2);
    expect(result.lastPalletQty).toBe(20);
  });

  it('quantidade que divide exatamente não gera palete parcial', () => {
    const result = computePalletsNeeded(100, 50);
    expect(result.totalPallets).toBe(2);
    expect(result.fullPallets).toBe(2);
    expect(result.lastPalletQty).toBe(50);
  });

  it('quantidade zero não gera palete nenhum', () => {
    expect(computePalletsNeeded(0, 50)).toEqual({ fullPallets: 0, lastPalletQty: 0, totalPallets: 0 });
  });

  it('capacidade zero (sem solução geométrica) não trava', () => {
    expect(computePalletsNeeded(10, 0).totalPallets).toBe(1);
  });
});
