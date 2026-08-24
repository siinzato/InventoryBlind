import { describe, expect, it } from 'vitest';
import { renderClosingSummary, type ClosingSummaryInput } from '../closingSummaryTemplate';

function input(overrides: Partial<ClosingSummaryInput> = {}): ClosingSummaryInput {
  return {
    brandName: 'Nillkin',
    totalSku: 195,
    skusContados: 195,
    divergenciasEncontradas: 14,
    divergenciasRecontadas: 11,
    divergenciasReais: 0,
    accuracyFinal: 100,
    categoryCounts: [
      { categoryId: 'a', key: 'saldo_excesso', name: 'Saldo em excesso', count: 3 },
      { categoryId: 'b', key: 'organizacao_vao', name: 'organização de vão', count: 2 },
      { categoryId: 'c', key: 'vao_duplicado', name: 'Vãos duplicados', count: 1 },
      { categoryId: 'd', key: 'divergencia_recontagem', name: 'Divergências resolvidas na recontagem', count: 11 },
    ],
    unclassifiedCount: 1,
    ...overrides,
  };
}

describe('renderClosingSummary', () => {
  it('é determinístico — mesma entrada gera exatamente a mesma string', () => {
    expect(renderClosingSummary(input())).toBe(renderClosingSummary(input()));
  });

  it('reproduz o formato do exemplo pedido', () => {
    const text = renderClosingSummary(input());
    expect(text).toContain('Resumo de fechamento — Nillkin');
    expect(text).toContain('Foram concluídos 195 SKUs.');
    expect(text).toContain('Problemas com saldo em excesso — 3 registros');
    expect(text).toContain('Problemas com divergências resolvidas na recontagem — 11 registros');
    expect(text).toContain('Observações não classificadas — 1');
    expect(text).toContain('Divergências reais confirmadas: 0.');
    expect(text).toContain('Acuracidade final: 100%.');
  });

  it('usa singular quando a contagem é 1', () => {
    const text = renderClosingSummary(input({ categoryCounts: [{ categoryId: 'c', key: 'vao_duplicado', name: 'Vão duplicado', count: 1 }], unclassifiedCount: 0 }));
    expect(text).toContain('1 registro\n');
    expect(text).not.toContain('1 registros');
  });

  it('sem categorias e sem não classificadas mostra mensagem neutra', () => {
    const text = renderClosingSummary(input({ categoryCounts: [], unclassifiedCount: 0 }));
    expect(text).toContain('Nenhuma observação registrada nas contagens deste ciclo.');
  });

  it('omite acuracidade quando indisponível', () => {
    const text = renderClosingSummary(input({ accuracyFinal: null }));
    expect(text).toContain('Acuracidade final: —.');
  });
});
