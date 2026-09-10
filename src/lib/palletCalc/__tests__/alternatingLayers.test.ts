import { describe, expect, it } from 'vitest';
import { checkAlternatingLayers, pickAlternatingPair } from '../alternatingLayers';
import { computeUniformGrid } from '../layoutEngine';
import { uniformEdgeMm } from '../types';

const noOverhang = uniformEdgeMm(0);

describe('checkAlternatingLayers', () => {
  it('100% de apoio quando a camada de cima repete exatamente a de baixo', () => {
    const layer = computeUniformGrid(1200, 1000, 400, 300, false, noOverhang).placements;
    const result = checkAlternatingLayers(layer, layer, 75);
    expect(result.ok).toBe(true);
    expect(result.minSupportPct).toBe(100);
  });

  it('reprova quando o apoio de alguma caixa fica abaixo do mínimo', () => {
    // 400x350 num palete 1200x900: a orientação A cobre até y=700 (2 linhas
    // de 350); a B tem linhas de 400 e cobre até y=800 — uma caixa da B
    // entre y=400 e y=800 só encontra apoio até y=700, dando 75% (300/400).
    const lower = computeUniformGrid(1200, 900, 400, 350, false, noOverhang).placements;
    const upper = computeUniformGrid(1200, 900, 400, 350, true, noOverhang).placements;
    const result = checkAlternatingLayers(lower, upper, 90);
    expect(result.minSupportPct).toBeCloseTo(75, 6);
    expect(result.ok).toBe(false);
  });

  it('camada de cima vazia sempre passa (nada para apoiar)', () => {
    expect(checkAlternatingLayers([{ x: 0, y: 0, w: 10, h: 10, rotated: false, index: 0 }], [], 100).ok).toBe(true);
  });
});

describe('pickAlternatingPair', () => {
  it('escolhe uniform-a e uniform-b quando ambos existem', () => {
    const alts = [
      { pattern: { id: 'uniform-a', placements: [] } },
      { pattern: { id: 'mixed', placements: [] } },
      { pattern: { id: 'uniform-b', placements: [] } },
    ];
    const pair = pickAlternatingPair(alts);
    expect(pair?.[0].pattern.id).toBe('uniform-a');
    expect(pair?.[1].pattern.id).toBe('uniform-b');
  });

  it('null quando só existe uma orientação', () => {
    const alts = [{ pattern: { id: 'uniform-a', placements: [] } }];
    expect(pickAlternatingPair(alts)).toBeNull();
  });
});
