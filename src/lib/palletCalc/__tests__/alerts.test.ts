import { describe, expect, it } from 'vitest';
import { computeAlerts } from '../alerts';
import { computeEffectiveLayers } from '../layerEngine';
import { uniformEdgeMm, type BoxSpec, type PalletSpec } from '../types';

const box: BoxSpec = {
  lengthMm: 400, widthMm: 300, heightMm: 250, weightKg: 5, quantity: 120,
  rotation: 'base90', stackable: true,
};

const pallet: PalletSpec = {
  name: 'PBR', lengthMm: 1200, widthMm: 1000, heightMm: 150, tareKg: 25,
  maxLoadKg: 1000, maxTotalHeightMm: 1600, overhangMm: uniformEdgeMm(0),
};

function baseInput(overrides: Partial<Parameters<typeof computeAlerts>[0]> = {}) {
  const layers = computeEffectiveLayers({
    maxTotalHeightMm: pallet.maxTotalHeightMm, palletHeightMm: pallet.heightMm, boxHeightMm: box.heightMm,
    boxWeightKg: box.weightKg, boxesPerLayer: 10, palletMaxLoadKg: pallet.maxLoadKg, stackable: box.stackable,
  });
  return {
    box, pallet, boxesPerLayer: 10, layers, occupationPct: 100, overhangUsedMm: 0,
    netKg: 250, totalHeightMm: 1400, lastPalletQty: 50, capacityPerPallet: 50, centerOffsetPct: 0,
    ...overrides,
  };
}

describe('computeAlerts', () => {
  it('cenário limpo não gera nenhum alerta', () => {
    expect(computeAlerts(baseInput())).toEqual([]);
  });

  it('caixa maior que o palete', () => {
    const alerts = computeAlerts(baseInput({ boxesPerLayer: 0 }));
    expect(alerts.some(a => a.code === 'caixa-maior-que-palete' && a.severity === 'error')).toBe(true);
  });

  it('peso excedido', () => {
    const alerts = computeAlerts(baseInput({ netKg: 2000 }));
    expect(alerts.some(a => a.code === 'peso-excedido' && a.severity === 'error')).toBe(true);
  });

  it('altura excedida', () => {
    const alerts = computeAlerts(baseInput({ totalHeightMm: 2000 }));
    expect(alerts.some(a => a.code === 'altura-excedida' && a.severity === 'error')).toBe(true);
  });

  it('overhang em uso gera aviso, não erro', () => {
    const alerts = computeAlerts(baseInput({ overhangUsedMm: 30 }));
    const found = alerts.find(a => a.code === 'overhang-em-uso');
    expect(found?.severity).toBe('warning');
  });

  it('não empilhável gera aviso', () => {
    const notStackableBox: BoxSpec = { ...box, stackable: false };
    const alerts = computeAlerts(baseInput({ box: notStackableBox }));
    expect(alerts.some(a => a.code === 'nao-empilhavel')).toBe(true);
  });

  it('apoio insuficiente entre camadas é erro quando abaixo do mínimo configurado', () => {
    const strictPallet: PalletSpec = { ...pallet, minSupportPct: 80 };
    const alerts = computeAlerts(baseInput({ pallet: strictPallet, actualSupportPct: 50 }));
    expect(alerts.some(a => a.code === 'apoio-insuficiente' && a.severity === 'error')).toBe(true);
  });

  it('apoio suficiente não gera alerta', () => {
    const strictPallet: PalletSpec = { ...pallet, minSupportPct: 80 };
    const alerts = computeAlerts(baseInput({ pallet: strictPallet, actualSupportPct: 90 }));
    expect(alerts.some(a => a.code === 'apoio-insuficiente')).toBe(false);
  });

  it('centro de carga desequilibrado', () => {
    const alerts = computeAlerts(baseInput({ centerOffsetPct: 40 }));
    expect(alerts.some(a => a.code === 'centro-desequilibrado')).toBe(true);
  });

  it('ocupação baixa gera aviso', () => {
    const alerts = computeAlerts(baseInput({ occupationPct: 40 }));
    expect(alerts.some(a => a.code === 'ociosidade-alta')).toBe(true);
  });

  it('último palete com baixa ocupação', () => {
    const alerts = computeAlerts(baseInput({ lastPalletQty: 10, capacityPerPallet: 50 }));
    expect(alerts.some(a => a.code === 'ultimo-palete-baixa-ocupacao')).toBe(true);
  });

  it('último palete cheio não gera o alerta de baixa ocupação', () => {
    const alerts = computeAlerts(baseInput({ lastPalletQty: 50, capacityPerPallet: 50 }));
    expect(alerts.some(a => a.code === 'ultimo-palete-baixa-ocupacao')).toBe(false);
  });

  it('tombamento gera aviso explícito de validação física', () => {
    const alerts = computeAlerts(baseInput({ requiresTipping: true }));
    expect(alerts.some(a => a.code === 'tombamento')).toBe(true);
  });

  it('medidas inválidas nunca passam despercebidas', () => {
    const invalidBox: BoxSpec = { ...box, lengthMm: 0 };
    const alerts = computeAlerts(baseInput({ box: invalidBox }));
    expect(alerts.some(a => a.code === 'medidas-invalidas' && a.severity === 'error')).toBe(true);
  });
});
