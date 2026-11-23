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
  it('aceita a grade do galpao de 45,2 m na resolucao maxima que o banco permite', () => {
    // 14 x 60 = 840 celulas, a 0,753 m => 10,5 x 45,2 m.
    const plano = planGridResize(grade(20, 15), 14, 60);
    expect(plano.valido).toBe(true);
    expect(plano.motivo).toBeNull();
  });

  it('recusa as 90 celulas que 0,50 m exigiria, porque o banco limita a 60', () => {
    // Guarda de regressao: o CHECK de warehouse_layouts e grid_width/height BETWEEN 2 AND 60.
    // Se GRID_MAX subir sem a migration que afrouxa o CHECK, a gravacao falha DEPOIS de as
    // celulas ja terem sido criadas, e a grade fica incoerente. Aconteceu em 23/11/2026.
    const plano = planGridResize(grade(20, 15), 21, 90);
    expect(plano.valido).toBe(false);
    expect(plano.motivo).toContain('60');
  });

  it('a maior grade que o lado permite cabe no teto de celulas', () => {
    // Com GRID_MAX em 60, a maior grade possivel e 3.600 celulas, abaixo das 4.000. Ou
    // seja: hoje a regra de total NAO e alcancavel, e e proposital -- ela so volta a
    // morder se o lado subir junto com o CHECK do banco. O teste existe para que subir
    // GRID_MAX sem rever GRID_MAX_CELLS quebre aqui, e nao em producao.
    const maior = planGridResize(grade(2, 2), GRID_MAX, GRID_MAX);
    expect(maior.valido).toBe(true);
    expect(GRID_MAX * GRID_MAX).toBeLessThanOrEqual(GRID_MAX_CELLS);
  });

  it('qualquer grade acima do limite e recusada sem propor mudanca nenhuma', () => {
    for (const [w, h] of [[80, 80], [GRID_MAX + 1, 2], [2, GRID_MAX + 1]]) {
      const plano = planGridResize(grade(2, 2), w, h);
      expect(plano.valido).toBe(false);
      expect(plano.toCreate).toHaveLength(0);
      expect(plano.toRemove).toHaveLength(0);
    }
  });

  it('o motivo diz qual regra barrou', () => {
    // Com o lado limitado a 60, as duas mensagens que o usuario pode ver sao a de limite
    // e a de numero quebrado. A de total de celulas e inalcancavel hoje: 60 x 60 = 3.600
    // fica abaixo das 4.000, e qualquer lado maior ja e barrado antes.
    const lado = planGridResize(grade(20, 15), GRID_MAX + 1, 10);
    const quebrado = planGridResize(grade(20, 15), 20.5, 10);
    expect(lado.motivo).toContain(String(GRID_MAX));
    expect(quebrado.motivo).toContain('inteiros');
    expect(lado.motivo).not.toEqual(quebrado.motivo);
  });

  it('o teto por lado concorda com o CHECK do banco', () => {
    // Nao e preferencia: warehouse_layouts recusa acima de 60 por lado. Mudar este
    // numero sem mudar o CHECK quebra a gravacao da dimensao.
    expect(GRID_MAX).toBe(60);
    // O teto de celulas tem que caber a maior grade possivel, senao vira regra morta.
    expect(GRID_MAX_CELLS).toBeGreaterThanOrEqual(GRID_MAX * GRID_MAX);
  });
});
