import { describe, expect, it } from 'vitest';
import { computeCellSizeFromTwoPoints } from '../slottingEngine';

describe('computeCellSizeFromTwoPoints — calibração visual de escala', () => {
  it('calcula metros por célula a partir de dois pontos e uma distância real em metros', () => {
    // 100px de distância, pitch de 20px/célula => 5 células. 10 metros reais / 5 células = 2m/célula.
    const result = computeCellSizeFromTwoPoints({
      pointA: { x: 0, y: 0 },
      pointB: { x: 100, y: 0 },
      pixelsPerCell: 20,
      realDistance: 10,
      unit: 'm',
    });
    expect(result).toBeCloseTo(2, 5);
  });

  it('converte centímetros para metros antes de calcular', () => {
    const result = computeCellSizeFromTwoPoints({
      pointA: { x: 0, y: 0 },
      pointB: { x: 40, y: 0 },
      pixelsPerCell: 20,
      realDistance: 400,
      unit: 'cm',
    });
    // 2 células, 4 metros reais => 2m/célula
    expect(result).toBeCloseTo(2, 5);
  });

  it('funciona com pontos na diagonal (distância euclidiana)', () => {
    const result = computeCellSizeFromTwoPoints({
      pointA: { x: 0, y: 0 },
      pointB: { x: 30, y: 40 },
      pixelsPerCell: 10,
      realDistance: 25,
      unit: 'm',
    });
    // distância em px = 50 => 5 células; 25m / 5 = 5m/célula
    expect(result).toBeCloseTo(5, 5);
  });

  it('retorna null para pontos iguais, distância real <= 0 ou pitch <= 0 — nunca NaN/Infinity', () => {
    expect(computeCellSizeFromTwoPoints({ pointA: { x: 5, y: 5 }, pointB: { x: 5, y: 5 }, pixelsPerCell: 20, realDistance: 10, unit: 'm' })).toBeNull();
    expect(computeCellSizeFromTwoPoints({ pointA: { x: 0, y: 0 }, pointB: { x: 10, y: 0 }, pixelsPerCell: 20, realDistance: 0, unit: 'm' })).toBeNull();
    expect(computeCellSizeFromTwoPoints({ pointA: { x: 0, y: 0 }, pointB: { x: 10, y: 0 }, pixelsPerCell: 0, realDistance: 10, unit: 'm' })).toBeNull();
  });
});
