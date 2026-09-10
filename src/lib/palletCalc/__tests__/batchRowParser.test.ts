import { describe, expect, it } from 'vitest';
import { parseBatchRow } from '../batchRowParser';

const validRow = {
  sku: 'ABC123', description: 'Caixa teste', length: '40', width: '30', height: '25',
  lengthUnit: 'cm', weight: '5', weightUnit: 'kg', quantity: '120',
  palletType: 'PBR', maxHeight: undefined, maxWeight: undefined, rotation: '90',
};

describe('parseBatchRow', () => {
  it('converte cm -> mm e monta BoxSpec/PalletSpec corretamente', () => {
    const result = parseBatchRow(validRow, []);
    expect(result.ok).toBe(true);
    expect(result.box?.lengthMm).toBe(400);
    expect(result.box?.widthMm).toBe(300);
    expect(result.box?.heightMm).toBe(250);
    expect(result.box?.weightKg).toBe(5);
    expect(result.box?.quantity).toBe(120);
    expect(result.box?.rotation).toBe('base90');
    expect(result.pallet?.lengthMm).toBe(1200);
  });

  it('aceita decimal com vírgula (spec §9/§12)', () => {
    const row = { ...validRow, length: '40,5' };
    const result = parseBatchRow(row, []);
    expect(result.ok).toBe(true);
    expect(result.box?.lengthMm).toBeCloseTo(405, 6);
  });

  it('linha inválida retorna erros específicos, sem lançar exceção', () => {
    const row = { ...validRow, length: 'abc', weight: '' };
    const result = parseBatchRow(row, []);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('Comprimento'))).toBe(true);
    expect(result.errors.some(e => e.includes('Peso'))).toBe(true);
  });

  it('sem unidade informada assume mm/kg', () => {
    const row = { ...validRow, lengthUnit: undefined, weightUnit: undefined, length: '400', weight: '5' };
    const result = parseBatchRow(row, []);
    expect(result.box?.lengthMm).toBe(400);
    expect(result.box?.weightKg).toBe(5);
  });

  it('rotação "qualquer" mapeia para "any", texto desconhecido cai em "none"', () => {
    expect(parseBatchRow({ ...validRow, rotation: 'qualquer' }, []).box?.rotation).toBe('any');
    expect(parseBatchRow({ ...validRow, rotation: 'xpto' }, []).box?.rotation).toBe('none');
  });

  it('tipo de palete europeu resolve para as dimensões corretas', () => {
    const result = parseBatchRow({ ...validRow, palletType: 'Europeu' }, []);
    expect(result.pallet?.widthMm).toBe(800);
  });

  it('altura/peso máximos da linha sobrepõem o preset do palete', () => {
    const result = parseBatchRow({ ...validRow, lengthUnit: 'm', maxHeight: '2', maxWeight: '500' }, []); // 2m
    expect(result.pallet?.maxTotalHeightMm).toBe(2000);
    expect(result.pallet?.maxLoadKg).toBe(500);
  });
});
