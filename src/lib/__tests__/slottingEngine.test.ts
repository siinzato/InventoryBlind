import { describe, expect, it } from 'vitest';
import { computeCellSizeFromTwoPoints, planGridResize, GRID_MIN, GRID_MAX, GRID_MAX_CELLS } from '../slottingEngine';
import type { WarehouseCell } from '../supabase';

/** Grade cheia de 'vazio', como `createLayout` monta. */
const grade = (w: number, h: number): Pick<WarehouseCell, 'x' | 'y' | 'cell_type' | 'location_code'>[] => {
  const out = [];
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) out.push({ x, y, cell_type: 'vazio' as const, location_code: null });
  return out;
};

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

describe('planGridResize - redimensionamento da grade do rascunho', () => {
  it('crescer so acrescenta celulas e nao remove nada', () => {
    // 20x15 -> 48x15: as 28 colunas novas entram inteiras, 28 * 15 = 420 celulas.
    const plano = planGridResize(grade(20, 15), 48, 15);
    expect(plano.valido).toBe(true);
    expect(plano.toCreate).toHaveLength(420);
    expect(plano.toRemove).toHaveLength(0);
    expect(plano.desenhoPerdido).toBe(0);
    // Nenhuma celula ja existente aparece como "criar".
    expect(plano.toCreate.every(p => p.x >= 20)).toBe(true);
  });

  it('encolher remove o que fica fora e conta quanto desenho se perde', () => {
    const cells = grade(20, 15);
    // Expedicao na coluna 18 (sai) e um rack na coluna 3 (fica).
    cells.find(c => c.x === 18 && c.y === 2)!.cell_type = 'expedicao';
    cells.find(c => c.x === 3 && c.y === 2)!.cell_type = 'modulo';
    // Uma posicao com endereco vinculado na linha 13 (sai).
    const vinculada = cells.find(c => c.x === 1 && c.y === 13)!;
    vinculada.cell_type = 'posicao';
    vinculada.location_code = 'A-01-1';

    const plano = planGridResize(cells, 10, 11);

    expect(plano.valido).toBe(true);
    expect(plano.toCreate).toHaveLength(0);
    // Fora = x >= 10 OU y >= 11. 10*15 (colunas 10..19) + 10*4 (linhas 11..14 das que ficam).
    expect(plano.toRemove).toHaveLength(190);
    // So a expedicao e a posicao vinculada contam como desenho perdido.
    expect(plano.desenhoPerdido).toBe(2);
  });

  it('completa buraco numa grade incompleta em vez de duplicar celula', () => {
    const cells = grade(4, 4).filter(c => !(c.x === 2 && c.y === 2));
    const plano = planGridResize(cells, 4, 4);
    expect(plano.toCreate).toEqual([{ x: 2, y: 2 }]);
    expect(plano.toRemove).toHaveLength(0);
  });

  it('nao mexe em nada quando o tamanho e o mesmo', () => {
    const plano = planGridResize(grade(20, 15), 20, 15);
    expect(plano.valido).toBe(true);
    expect(plano.toCreate).toHaveLength(0);
    expect(plano.toRemove).toHaveLength(0);
  });

  it('recusa tamanho fora dos limites sem propor remocao nenhuma', () => {
    for (const [w, h] of [[GRID_MIN - 1, 10], [10, GRID_MIN - 1], [GRID_MAX + 1, 10], [10, GRID_MAX + 1], [0, 0]]) {
      const plano = planGridResize(grade(20, 15), w, h);
      expect(plano.valido).toBe(false);
      expect(plano.toRemove).toHaveLength(0);
      expect(plano.toCreate).toHaveLength(0);
    }
  });

  it('recusa numero quebrado', () => {
    expect(planGridResize(grade(20, 15), 20.5, 15).valido).toBe(false);
    expect(planGridResize(grade(20, 15), 20, Number.NaN).valido).toBe(false);
  });
});

describe('planGridResize - limites de tamanho', () => {
  it('aceita a grade do galpao de 45,2 m com celula de 0,50 m', () => {
    // 21 x 90 = 1.890 celulas. Era impossivel com o teto antigo de 60 por lado.
    const plano = planGridResize(grade(20, 15), 21, 90);
    expect(plano.valido).toBe(true);
    expect(plano.motivo).toBeNull();
  });

  it('recusa grade com os dois lados validos mas celulas demais', () => {
    // 80 e 80 estao dentro de 2..100, e 6.400 passa de GRID_MAX_CELLS.
    const plano = planGridResize(grade(20, 15), 80, 80);
    expect(plano.valido).toBe(false);
    expect(plano.motivo).toContain('6.400');
    expect(plano.toCreate).toHaveLength(0);
    expect(plano.toRemove).toHaveLength(0);
  });

  it('aceita exatamente o teto de celulas e recusa uma linha acima', () => {
    expect(planGridResize(grade(20, 15), 100, 40).valido).toBe(true);
    expect(planGridResize(grade(20, 15), 100, 41).valido).toBe(false);
  });

  it('da motivo diferente para lado invalido e para total invalido', () => {
    const lado = planGridResize(grade(20, 15), GRID_MAX + 1, 10);
    const total = planGridResize(grade(20, 15), 90, 90);
    expect(lado.motivo).toContain(String(GRID_MAX));
    expect(total.motivo).toContain('células');
    expect(lado.motivo).not.toEqual(total.motivo);
  });

  it('o teto por lado permite as 90 celulas que 0,50 m exige', () => {
    expect(GRID_MAX).toBeGreaterThanOrEqual(90);
    expect(GRID_MAX_CELLS).toBeGreaterThanOrEqual(21 * 90);
  });
});
