import { describe, expect, it } from 'vitest';
import { computeSplitGroups } from '../splitGroups';

describe('computeSplitGroups', () => {
  it('extract: um único arquivo com as páginas selecionadas, na ordem dada', () => {
    const result = computeSplitGroups(10, 'extract', { selectedIndices: [0, 2, 4] });
    expect(result.groups).toEqual([[0, 2, 4]]);
  });

  it('removeSelection: um único arquivo com o restante', () => {
    const result = computeSplitGroups(5, 'removeSelection', { selectedIndices: [1, 3] });
    expect(result.groups).toEqual([[0, 2, 4]]);
  });

  it('removeSelection sem nada selecionado avisa e mantém tudo', () => {
    const result = computeSplitGroups(3, 'removeSelection', {});
    expect(result.groups).toEqual([[0, 1, 2]]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('removeSelection removendo tudo resulta em nenhuma página', () => {
    const result = computeSplitGroups(2, 'removeSelection', { selectedIndices: [0, 1] });
    expect(result.groups).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('onePerFile: um arquivo por página', () => {
    const result = computeSplitGroups(3, 'onePerFile', {});
    expect(result.groups).toEqual([[0], [1], [2]]);
  });

  it('everyN: divide a cada N páginas', () => {
    const result = computeSplitGroups(7, 'everyN', { everyN: 3 });
    expect(result.groups).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
  });

  it('oddEven: separa ímpares e pares', () => {
    const result = computeSplitGroups(5, 'oddEven', {});
    // 0-based par (0,2,4) = páginas ímpares (1ª,3ª,5ª) na numeração do usuário
    expect(result.groups).toEqual([[0, 2, 4], [1, 3]]);
  });

  it('documento sem páginas retorna vazio com aviso', () => {
    const result = computeSplitGroups(0, 'onePerFile', {});
    expect(result.groups).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
