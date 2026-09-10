import { describe, expect, it } from 'vitest';
import { anyOverlap, rectWithinBounds } from '../geometry';
import { computeMixedShelf, computeUniformGrid } from '../layoutEngine';
import { uniformEdgeMm } from '../types';

const noOverhang = uniformEdgeMm(0);

function expectValidGeometry(placements: Array<{ x: number; y: number; w: number; h: number }>, palletLengthMm: number, palletWidthMm: number, overhangMm = noOverhang) {
  expect(anyOverlap(placements)).toBe(false);
  for (const p of placements) {
    expect(rectWithinBounds(p, palletLengthMm, palletWidthMm, overhangMm)).toBe(true);
  }
}

describe('computeUniformGrid', () => {
  it('caso de referência: PBR 1200x1000, caixa 400x300, orientação A = 9 caixas', () => {
    const pattern = computeUniformGrid(1200, 1000, 400, 300, false, noOverhang);
    expect(pattern.boxesPerLayer).toBe(9);
    expectValidGeometry(pattern.placements, 1200, 1000);
  });

  it('caso de referência: mesma caixa girada (orientação B) = 8 caixas', () => {
    const pattern = computeUniformGrid(1200, 1000, 400, 300, true, noOverhang);
    expect(pattern.boxesPerLayer).toBe(8);
    expectValidGeometry(pattern.placements, 1200, 1000);
  });

  it('caixa maior que o palete em qualquer orientação -> 0 caixas', () => {
    const pattern = computeUniformGrid(1000, 800, 1200, 1200, false, noOverhang);
    expect(pattern.boxesPerLayer).toBe(0);
  });

  it('overhang configurado permite mais caixas do que o palete "puro" comportaria', () => {
    const semOverhang = computeUniformGrid(1000, 1000, 300, 300, false, noOverhang);
    const comOverhang = computeUniformGrid(1000, 1000, 300, 300, false, uniformEdgeMm(150));
    expect(comOverhang.boxesPerLayer).toBeGreaterThan(semOverhang.boxesPerLayer);
    expectValidGeometry(comOverhang.placements, 1000, 1000, uniformEdgeMm(150));
  });

  it('ocupação e área batem com o número de caixas', () => {
    const pattern = computeUniformGrid(1200, 1000, 400, 300, false, noOverhang);
    expect(pattern.occupiedAreaMm2).toBe(9 * 400 * 300);
    expect(pattern.baseAreaMm2).toBe(1200 * 1000);
    expect(pattern.occupationPct).toBeCloseTo((9 * 400 * 300) / (1200 * 1000) * 100, 6);
  });
});

describe('computeMixedShelf', () => {
  it('caso de referência: PBR 1200x1000, caixa 400x300 -> arranjo misto com 10 caixas', () => {
    const pattern = computeMixedShelf(1200, 1000, 400, 300);
    expect(pattern).not.toBeNull();
    expect(pattern!.boxesPerLayer).toBe(10);
    expectValidGeometry(pattern!.placements, 1200, 1000);
  });

  it('geometria sempre válida mesmo em paletes/caixas variados', () => {
    const cases: Array<[number, number, number, number]> = [
      [1200, 800, 400, 300], [1000, 1000, 333, 250], [1200, 1000, 250, 250], [800, 600, 199, 199],
    ];
    for (const [pl, pw, bl, bw] of cases) {
      const pattern = computeMixedShelf(pl, pw, bl, bw);
      if (pattern) expectValidGeometry(pattern.placements, pl, pw);
    }
  });

  it('nunca pior que a melhor grade uniforme', () => {
    const a = computeUniformGrid(1200, 1000, 400, 300, false, noOverhang);
    const b = computeUniformGrid(1200, 1000, 400, 300, true, noOverhang);
    const mixed = computeMixedShelf(1200, 1000, 400, 300);
    expect(mixed!.boxesPerLayer).toBeGreaterThanOrEqual(Math.max(a.boxesPerLayer, b.boxesPerLayer));
  });

  it('retorna null quando nenhuma combinação encaixa nenhuma caixa', () => {
    expect(computeMixedShelf(100, 100, 1200, 1200)).toBeNull();
  });
});

describe('determinismo (mesmos dados -> mesmo resultado, spec §4)', () => {
  it('chamadas repetidas produzem exatamente o mesmo resultado', () => {
    const a = computeMixedShelf(1200, 1000, 400, 300);
    const b = computeMixedShelf(1200, 1000, 400, 300);
    expect(a).toEqual(b);
  });
});
