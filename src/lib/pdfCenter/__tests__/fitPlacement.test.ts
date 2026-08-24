import { describe, expect, it } from 'vitest';
import { computeAlignedPosition, computeFitPlacement } from '../fitPlacement';

describe('computeFitPlacement', () => {
  it('contain: encolhe mantendo proporção, sem sobrar de nenhum lado', () => {
    const r = computeFitPlacement(200, 100, 100, 100, 'contain');
    expect(r.scale).toBeCloseTo(0.5, 6);
    expect(r.placedWidth).toBeCloseTo(100, 6);
    expect(r.placedHeight).toBeCloseTo(50, 6);
    expect(r.clipped).toBe(false);
  });

  it('fill: preenche a área inteira, pode ultrapassar (recorte)', () => {
    const r = computeFitPlacement(200, 100, 100, 100, 'fill');
    expect(r.scale).toBeCloseTo(1, 6);
    expect(r.placedWidth).toBeCloseTo(200, 6);
    expect(r.placedHeight).toBeCloseTo(100, 6);
    expect(r.clipped).toBe(true);
  });

  it('original: nunca redimensiona, mesmo maior que a área', () => {
    const r = computeFitPlacement(200, 100, 50, 50, 'original');
    expect(r.scale).toBe(1);
    expect(r.placedWidth).toBe(200);
    expect(r.placedHeight).toBe(100);
    expect(r.clipped).toBe(true);
  });

  it('nunca deforma: a mesma escala se aplica aos dois eixos em contain e fill', () => {
    for (const mode of ['contain', 'fill'] as const) {
      const r = computeFitPlacement(300, 150, 80, 120, mode);
      expect(r.placedWidth / r.placedHeight).toBeCloseTo(300 / 150, 6);
    }
  });

  it('escala extra do usuário multiplica o resultado', () => {
    const r = computeFitPlacement(100, 100, 100, 100, 'contain', 0.5);
    expect(r.placedWidth).toBeCloseTo(50, 6);
  });
});

describe('computeAlignedPosition', () => {
  it('centraliza nos dois eixos', () => {
    const { x, y } = computeAlignedPosition(50, 20, 100, 100, 'center', 'center');
    expect(x).toBeCloseTo(25, 6);
    expect(y).toBeCloseTo(40, 6);
  });

  it('alinha ao topo (y alto, já que origem PDF é embaixo)', () => {
    const { y } = computeAlignedPosition(50, 20, 100, 100, 'center', 'top');
    expect(y).toBeCloseTo(80, 6);
  });

  it('alinha à esquerda/embaixo em (0,0)', () => {
    const { x, y } = computeAlignedPosition(50, 20, 100, 100, 'left', 'bottom');
    expect(x).toBe(0);
    expect(y).toBe(0);
  });
});
