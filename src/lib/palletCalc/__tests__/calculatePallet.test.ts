import { describe, expect, it } from 'vitest';
import { calculatePallet } from '../calculatePallet';
import { uniformEdgeMm, type BoxSpec, type PalletSpec } from '../types';

// Caso de referência do spec §12:
// Palete PBR 1200x1000, altura 150mm, altura máx. 1600mm.
// Caixa 400x300, altura 250mm, rotação de base permitida.
// -> arranjo misto válido com 10 caixas/camada, 5 camadas por altura,
//    capacidade geométrica 50, quantidade 120 -> 2 paletes de 50 + 1 de 20.
const referenceBox: BoxSpec = {
  lengthMm: 400, widthMm: 300, heightMm: 250, weightKg: 5, quantity: 120,
  rotation: 'base90', stackable: true,
};

const referencePallet: PalletSpec = {
  name: 'PBR', lengthMm: 1200, widthMm: 1000, heightMm: 150, tareKg: 25,
  maxLoadKg: 1_000_000, maxTotalHeightMm: 1600, overhangMm: uniformEdgeMm(0),
};

describe('calculatePallet — caso de referência (spec §12)', () => {
  const result = calculatePallet(referenceBox, referencePallet);

  it('a melhor alternativa é o arranjo misto com 10 caixas por camada', () => {
    expect(result.recommended.pattern.id).toBe('mixed');
    expect(result.recommended.pattern.boxesPerLayer).toBe(10);
  });

  it('5 camadas, limitadas pela altura', () => {
    expect(result.recommended.layers.layers).toBe(5);
    expect(result.recommended.layers.limitingFactor).toBe('altura');
  });

  it('capacidade geométrica de 50 caixas por palete', () => {
    expect(result.recommended.capacityPerPallet).toBe(50);
  });

  it('120 unidades -> 2 paletes completos de 50 e 1 parcial de 20', () => {
    expect(result.recommended.palletsNeeded).toEqual({ fullPallets: 2, lastPalletQty: 20, totalPallets: 3 });
  });

  it('inclui as três alternativas nomeadas (A, B, mista) para comparação (spec §7)', () => {
    const ids = result.alternatives.map(a => a.pattern.id);
    expect(ids).toContain('uniform-a');
    expect(ids).toContain('uniform-b');
    expect(ids).toContain('mixed');
  });

  it('resultado é determinístico entre chamadas repetidas', () => {
    const again = calculatePallet(referenceBox, referencePallet);
    expect(again.recommended.pattern.boxesPerLayer).toBe(result.recommended.pattern.boxesPerLayer);
    expect(again.recommended.layers.layers).toBe(result.recommended.layers.layers);
  });
});

describe('calculatePallet — casos de borda', () => {
  it('sem rotação permitida, só a orientação A é considerada', () => {
    const noRotationBox: BoxSpec = { ...referenceBox, rotation: 'none' };
    const result = calculatePallet(noRotationBox, referencePallet);
    expect(result.alternatives.every(a => a.pattern.id === 'uniform-a')).toBe(true);
  });

  it('caixa maior que o palete: nenhuma alternativa tem caixas, e o erro aparece', () => {
    const hugeBox: BoxSpec = { ...referenceBox, lengthMm: 5000, widthMm: 5000 };
    const result = calculatePallet(hugeBox, referencePallet);
    expect(result.recommended.pattern.boxesPerLayer).toBe(0);
    expect(result.recommended.alerts.some(a => a.code === 'caixa-maior-que-palete')).toBe(true);
  });

  it('rotação "any" pode considerar tombamento e sinaliza o alerta', () => {
    // Caixa bem mais alta que larga/comprida — tombar pode caber mais no layout,
    // mas precisa vir com o aviso de validação física.
    const tallBox: BoxSpec = { ...referenceBox, lengthMm: 200, widthMm: 200, heightMm: 900, rotation: 'any' };
    const result = calculatePallet(tallBox, referencePallet);
    const tippedWinner = result.alternatives.find(a => a.requiresTipping && a.pattern.boxesPerLayer > 0);
    if (tippedWinner) {
      expect(tippedWinner.alerts.some(a => a.code === 'tombamento')).toBe(true);
    }
  });

  it('produto não empilhável nunca recomenda mais de 1 camada', () => {
    const notStackable: BoxSpec = { ...referenceBox, stackable: false };
    const result = calculatePallet(notStackable, referencePallet);
    expect(result.recommended.layers.layers).toBe(1);
  });

  it('peso excedido aparece como erro quando a capacidade do palete é baixa', () => {
    const heavyPallet: PalletSpec = { ...referencePallet, maxLoadKg: 10 };
    const result = calculatePallet(referenceBox, heavyPallet);
    expect(result.recommended.alerts.some(a => a.code === 'peso-excedido')).toBe(true);
  });
});
