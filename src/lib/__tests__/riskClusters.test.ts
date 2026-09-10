import { describe, it, expect } from 'vitest';
import { groupIntoClusters } from '../riskService';
import type { ProductRiskRow } from '../riskService';

function row(id: string, location: string | null, riskScore: number): ProductRiskRow {
  return {
    id,
    company_id: 'company-1',
    product_id: id,
    risk_score: riskScore,
    risk_level: riskScore >= 80 ? 'critico' : 'alto',
    risk_reason: 'Divergência recorrente',
    probability: riskScore,
    impact: 100,
    factors: { probability: {}, impact: {} },
    algorithm_version: 'v2-probability-impact',
    last_risk_update: '2026-08-30T00:00:00.000Z',
    created_at: '2026-08-30T00:00:00.000Z',
    updated_at: '2026-08-30T00:00:00.000Z',
    has_sufficient_data: true,
    missing_factors: [],
    product_name: `Produto ${id}`,
    product_sku: `SKU-${id}`,
    product_location: location,
  };
}

describe('groupIntoClusters — agrupamento por proximidade física', () => {
  it('agrupa itens com o mesmo corredor (segmento antes do primeiro hífen)', () => {
    const rows = [row('1', 'A-03-02', 86), row('2', 'A-03-04', 74), row('3', 'B-01-07', 68)];
    const clusters = groupIntoClusters(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].corridor).toBe('A');
    expect(clusters[0].items.map(i => i.id).sort()).toEqual(['1', '2']);
  });

  it('não forma cluster para um corredor com um único item', () => {
    const rows = [row('1', 'A-03-02', 86), row('2', 'B-01-07', 68)];
    expect(groupIntoClusters(rows)).toHaveLength(0);
  });

  it('ignora itens sem localização, sem quebrar o agrupamento dos demais', () => {
    const rows = [row('1', 'A-03-02', 86), row('2', 'A-03-04', 74), row('3', null, 90)];
    const clusters = groupIntoClusters(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].items).toHaveLength(2);
  });

  it('ordena os clusters do maior para o menor número de itens', () => {
    const rows = [
      row('1', 'A-01-01', 80), row('2', 'A-01-02', 80), row('3', 'A-01-03', 80),
      row('4', 'B-01-01', 70), row('5', 'B-01-02', 70),
    ];
    const clusters = groupIntoClusters(rows);
    expect(clusters[0].corridor).toBe('A');
    expect(clusters[0].items).toHaveLength(3);
    expect(clusters[1].corridor).toBe('B');
  });

  it('agrupar por proximidade não altera o risk_score individual de nenhum item', () => {
    const rows = [row('1', 'A-03-02', 86), row('2', 'A-03-04', 74)];
    const clusters = groupIntoClusters(rows);
    const byId = new Map(clusters[0].items.map(i => [i.id, i.risk_score]));
    expect(byId.get('1')).toBe(86);
    expect(byId.get('2')).toBe(74);
  });
});
