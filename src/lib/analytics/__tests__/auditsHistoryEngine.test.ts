import { describe, it, expect } from 'vitest';
import {
  toSessionSummary, computeHistorySummary, filterSessions, countNumberLabel,
  isDivergentItem, EMPTY_SESSION_FILTERS, toChronological,
  computePerformanceSummary, computeOperatorPerformance,
  computeRecurringSkus, computeRecurringLocations, computeRecurringCauses, buildSkuHistory,
  type DivergentItemRow, type RcaItemLink,
} from '../auditsHistoryEngine';
import { buildCountChains } from '../../auditCrossCheckAlgorithm';
import type { InventoryCountRecord } from '../../supabase';

const NOW = new Date('2026-09-04T12:00:00.000Z').getTime();

function record(over: Partial<InventoryCountRecord> = {}): InventoryCountRecord {
  return {
    id: 'r1', company_id: 'c1', brand_id: 'b1', count_number: 1, source: 'import',
    linked_count_id: null, operator_1: 'Victor', operator_2: null,
    total_sku: 100, skus_contados: 50, divergencias_encontradas: 10,
    divergencias_recontadas: 0, divergencias_reais: 10, valor_financeiro_divergencias: null,
    accuracy_initial: 80, accuracy_final: null, observacoes: null,
    started_at: null, finished_at: null, duration_seconds: null,
    created_by: 'u1', created_at: '2026-09-01T10:00:00.000Z',
    approved_by: null, approved_at: null,
    ...over,
  };
}

describe('toSessionSummary', () => {
  it('calcula cobertura como contados / previstos', () => {
    const s = toSessionSummary(record({ total_sku: 97, skus_contados: 40 }));
    expect(s.coveragePct).toBeCloseTo((40 / 97) * 100, 6);
  });

  it('não fabrica cobertura quando não existe denominador', () => {
    const s = toSessionSummary(record({ total_sku: 0, skus_contados: 12 }));
    expect(s.coveragePct).toBeNull();
  });

  it('não fabrica taxa de divergência quando nada foi contado', () => {
    const s = toSessionSummary(record({ skus_contados: 0, divergencias_reais: 0 }));
    expect(s.divergenceRatePct).toBeNull();
  });

  it('usa accuracy_final quando existe e accuracy_initial como fallback', () => {
    expect(toSessionSummary(record({ accuracy_final: 91.2 })).accuracy).toBe(91.2);
    expect(toSessionSummary(record({ accuracy_final: null, accuracy_initial: 77 })).accuracy).toBe(77);
    expect(toSessionSummary(record({ accuracy_final: null, accuracy_initial: null })).accuracy).toBeNull();
  });
});

describe('computeHistorySummary', () => {
  it('usa os dados reais das sessões lidas', () => {
    const summary = computeHistorySummary([
      record({ id: 'a', skus_contados: 40, divergencias_reais: 21 }),
      record({ id: 'b', skus_contados: 195, divergencias_reais: 5 }),
    ]);
    expect(summary.sessions).toBe(2);
    expect(summary.totalCounted).toBe(235);
    expect(summary.totalDivergent).toBe(26);
  });

  it('não usa média simples dos percentuais das sessões (bases diferentes)', () => {
    // Sessão pequena com 50% de divergência + sessão grande com 1%: a média simples das
    // taxas daria 25,5% de divergência (74,5% de acurácia); a métrica oficial pondera pela
    // base real e fica em ~1,49% de divergência.
    const summary = computeHistorySummary([
      record({ id: 'a', skus_contados: 10, divergencias_reais: 5 }),
      record({ id: 'b', skus_contados: 1000, divergencias_reais: 10 }),
    ]);
    expect(summary.observedAccuracyPct).toBeCloseTo(100 - (15 / 1010) * 100, 6);
    expect(summary.observedAccuracyPct).not.toBeCloseTo(74.5, 1);
  });

  it('deixa a acurácia observada indisponível quando nada foi contado', () => {
    const summary = computeHistorySummary([record({ skus_contados: 0, divergencias_reais: 0 })]);
    expect(summary.observedAccuracyPct).toBeNull();
    expect(summary.totalCounted).toBe(0);
  });

  it('conta sessões aprovadas sem usar acurácia como proxy de aprovação', () => {
    const summary = computeHistorySummary([
      // Aprovada com acurácia 0: aprovação é validação/encerramento, não qualidade.
      record({ id: 'a', accuracy_initial: 0, accuracy_final: 0, approved_by: 'u9' }),
      // Não aprovada com acurácia alta.
      record({ id: 'b', accuracy_initial: 99, approved_by: null }),
    ]);
    expect(summary.approvedSessions).toBe(1);
  });
});

describe('filterSessions', () => {
  const sessions = [
    toSessionSummary(record({ id: 'a', created_at: '2026-09-01T10:00:00.000Z', operator_1: 'Victor', count_number: 1, approved_by: 'u1' })),
    toSessionSummary(record({ id: 'b', created_at: '2026-06-01T10:00:00.000Z', operator_1: 'Ana', count_number: 2, approved_by: null })),
    toSessionSummary(record({ id: 'c', created_at: '2026-01-05T10:00:00.000Z', operator_1: 'Victor', count_number: 1, approved_by: null })),
  ];

  it('não altera nem reordena a lista original', () => {
    const before = sessions.map(s => s.id);
    const out = filterSessions(sessions, { ...EMPTY_SESSION_FILTERS, operator: 'Ana' }, NOW);
    expect(out).toHaveLength(1);
    expect(out).not.toBe(sessions);
    expect(sessions.map(s => s.id)).toEqual(before);
  });

  it('sem filtro devolve todas as sessões', () => {
    expect(filterSessions(sessions, EMPTY_SESSION_FILTERS, NOW)).toHaveLength(3);
  });

  it('filtra por período, operador, tipo e aprovação', () => {
    expect(filterSessions(sessions, { ...EMPTY_SESSION_FILTERS, period: '30d' }, NOW).map(s => s.id)).toEqual(['a']);
    expect(filterSessions(sessions, { ...EMPTY_SESSION_FILTERS, period: '90d' }, NOW).map(s => s.id)).toEqual(['a']);
    expect(filterSessions(sessions, { ...EMPTY_SESSION_FILTERS, operator: 'Victor' }, NOW).map(s => s.id)).toEqual(['a', 'c']);
    expect(filterSessions(sessions, { ...EMPTY_SESSION_FILTERS, countNumber: '2' }, NOW).map(s => s.id)).toEqual(['b']);
    expect(filterSessions(sessions, { ...EMPTY_SESSION_FILTERS, approval: 'approved' }, NOW).map(s => s.id)).toEqual(['a']);
    expect(filterSessions(sessions, { ...EMPTY_SESSION_FILTERS, approval: 'pending' }, NOW).map(s => s.id)).toEqual(['b', 'c']);
  });

  it('busca textual usa operador e tipo já carregados', () => {
    expect(filterSessions(sessions, { ...EMPTY_SESSION_FILTERS, search: 'ana' }, NOW).map(s => s.id)).toEqual(['b']);
    expect(filterSessions(sessions, { ...EMPTY_SESSION_FILTERS, search: 'recontagem' }, NOW).map(s => s.id)).toEqual(['b']);
    expect(filterSessions(sessions, { ...EMPTY_SESSION_FILTERS, search: 'inexistente' }, NOW)).toHaveLength(0);
  });
});

describe('isDivergentItem', () => {
  it('considera divergente só o item com status preenchido e diferente de correct', () => {
    expect(isDivergentItem({ status: 'divergent' })).toBe(true);
    expect(isDivergentItem({ status: 'missing' })).toBe(true);
    expect(isDivergentItem({ status: 'surplus' })).toBe(true);
    expect(isDivergentItem({ status: 'correct' })).toBe(false);
    expect(isDivergentItem({ status: null })).toBe(false);
  });
});

describe('validação da sessão (cadeia reutilizada da Auditoria Cruzada)', () => {
  it('sessão sem recontagem fica em estado neutro, não negativo', () => {
    const [chain] = buildCountChains([record({ id: 'root' })]);
    expect(chain.hasRecount).toBe(false);
    expect(chain.recontadorName).toBeNull();
    // Sem amostra, independência não é afirmada nem negada como falha da sessão.
    expect(chain.independent).toBe(false);
    expect(chain.isApproved).toBe(false);
  });

  it('reconhece a recontagem ligada e a aprovação registradas', () => {
    const chains = buildCountChains([
      record({ id: 'root', operator_1: 'Victor', created_by: 'u1', approved_by: 'u3' }),
      record({ id: 'rec', linked_count_id: 'root', count_number: 2, operator_1: 'Ana', created_by: 'u2' }),
    ]);
    expect(chains).toHaveLength(1);
    expect(chains[0].hasRecount).toBe(true);
    expect(chains[0].recontadorName).toBe('Ana');
    expect(chains[0].isApproved).toBe(true);
  });
});

describe('countNumberLabel', () => {
  it('mantém a nomenclatura já usada na tabela', () => {
    expect(countNumberLabel(1)).toBe('1ª contagem');
    expect(countNumberLabel(2)).toBe('Recontagem');
    expect(countNumberLabel(3)).toBe('3ª contagem');
  });
});

// ---- Fase 2: Performance + Reincidência ----------------------------------------------------

function item(over: Partial<DivergentItemRow> = {}): DivergentItemRow {
  return {
    itemId: 'i1', sessionId: 's1', sku: 'SKU-1', productName: 'Produto 1',
    location: 'A1-01', saldoSistema: 10, saldoContado: 8, diferenca: -2,
    occurredAt: '2026-09-01T10:00:00.000Z',
    ...over,
  };
}

function link(over: Partial<RcaItemLink> = {}): RcaItemLink {
  return {
    sourceItemId: 'i1', causeKey: 'endereco_incorreto', causeLabel: 'Endereçamento incorreto',
    occurredAt: '2026-09-01T10:00:00.000Z',
    ...over,
  };
}

describe('computePerformanceSummary', () => {
  it('consolida sem média simples das taxas por sessão', () => {
    const sessions = [
      toSessionSummary(record({ id: 'a', skus_contados: 10, divergencias_reais: 5 })),
      toSessionSummary(record({ id: 'b', skus_contados: 1000, divergencias_reais: 10 })),
    ];
    const p = computePerformanceSummary(sessions);
    expect(p.divergenceRatePct).toBeCloseTo((15 / 1010) * 100, 6);
    // A média simples das taxas (50% e 1%) daria 25,5% — o que a base real não sustenta.
    expect(p.divergenceRatePct).not.toBeCloseTo(25.5, 1);
    expect(p.observedAccuracyPct).toBeCloseTo(100 - (15 / 1010) * 100, 6);
    expect(p.totalCounted).toBe(1010);
  });

  it('cobertura média ignora sessões sem universo previsto e informa a amostra', () => {
    const sessions = [
      toSessionSummary(record({ id: 'a', total_sku: 100, skus_contados: 50 })),
      toSessionSummary(record({ id: 'b', total_sku: 0, skus_contados: 20 })),
    ];
    const p = computePerformanceSummary(sessions);
    expect(p.coverageAvgPct).toBeCloseTo(50, 6);
    expect(p.sessionsWithCoverage).toBe(1);
    expect(p.sessions).toBe(2);
  });

  it('sem nenhuma cobertura real, não fabrica um percentual', () => {
    const p = computePerformanceSummary([toSessionSummary(record({ total_sku: 0 }))]);
    expect(p.coverageAvgPct).toBeNull();
    expect(p.sessionsWithCoverage).toBe(0);
  });

  it('aprovação não vira score de qualidade', () => {
    const p = computePerformanceSummary([
      toSessionSummary(record({ id: 'a', accuracy_initial: 0, accuracy_final: 0, approved_by: 'u9' })),
      toSessionSummary(record({ id: 'b', accuracy_initial: 100, approved_by: null })),
    ]);
    expect(p.approvedSessions).toBe(1);
    // A acurácia consolidada continua vindo da divergência real, não da aprovação.
    expect(p.observedAccuracyPct).toBeCloseTo(100 - (20 / 100) * 100, 6);
  });
});

describe('toChronological', () => {
  it('ordena a série do mais antigo para o mais recente sem mutar a entrada', () => {
    const sessions = [
      toSessionSummary(record({ id: 'novo', created_at: '2026-09-01T10:00:00.000Z' })),
      toSessionSummary(record({ id: 'antigo', created_at: '2026-01-01T10:00:00.000Z' })),
    ];
    const out = toChronological(sessions);
    expect(out.map(s => s.id)).toEqual(['antigo', 'novo']);
    expect(sessions.map(s => s.id)).toEqual(['novo', 'antigo']);
  });
});

describe('computeOperatorPerformance', () => {
  it('preserva o tamanho da amostra e ordena por volume contado', () => {
    const rows = computeOperatorPerformance([
      toSessionSummary(record({ id: 'a', operator_1: 'Ana', skus_contados: 20, divergencias_reais: 10, total_sku: 40 })),
      toSessionSummary(record({ id: 'b', operator_1: 'Victor', skus_contados: 100, divergencias_reais: 5, total_sku: 200 })),
      toSessionSummary(record({ id: 'c', operator_1: 'Victor', skus_contados: 100, divergencias_reais: 5, total_sku: 0, count_number: 2, approved_by: 'u2' })),
    ]);
    expect(rows.map(r => r.operator)).toEqual(['Victor', 'Ana']);
    const victor = rows[0];
    expect(victor.sessions).toBe(2);
    expect(victor.skusCounted).toBe(200);
    expect(victor.divergences).toBe(10);
    expect(victor.recountSessions).toBe(1);
    expect(victor.approvedSessions).toBe(1);
    // Só uma das duas sessões tem universo previsto — a amostra da cobertura fica explícita.
    expect(victor.sessionsWithCoverage).toBe(1);
    expect(victor.coverageAvgPct).toBeCloseTo(50, 6);
    // Ana tem taxa muito pior, mas não é promovida no topo da lista.
    expect(rows[1].divergenceRatePct).toBeCloseTo(50, 6);
  });

  it('ignora sessões sem operador registrado em vez de criar um balde "Não informado"', () => {
    const rows = computeOperatorPerformance([
      toSessionSummary(record({ id: 'a', operator_1: null })),
      toSessionSummary(record({ id: 'b', operator_1: '   ' })),
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe('computeRecurringSkus', () => {
  it('SKU com divergência em duas sessões distintas entra como reincidente', () => {
    const rows = computeRecurringSkus(
      [
        item({ itemId: 'i1', sessionId: 's1', sku: 'SKU-1' }),
        item({ itemId: 'i2', sessionId: 's2', sku: 'SKU-1', occurredAt: '2026-09-03T10:00:00.000Z', location: 'B2-02' }),
      ],
      [],
      3
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionsWithDivergence).toBe(2);
    expect(rows[0].occurrences).toBe(2);
    expect(rows[0].lastOccurrenceAt).toBe('2026-09-03T10:00:00.000Z');
    // Última localização REGISTRADA, não o cadastro atual do produto.
    expect(rows[0].lastLocation).toBe('B2-02');
  });

  it('duas divergências da MESMA sessão não são reincidência entre auditorias', () => {
    const rows = computeRecurringSkus(
      [
        item({ itemId: 'i1', sessionId: 's1', sku: 'SKU-1' }),
        item({ itemId: 'i2', sessionId: 's1', sku: 'SKU-1' }),
      ],
      [],
      3
    );
    expect(rows).toHaveLength(0);
  });

  it('só marca o limiar do RCA quando a contagem configurada é atingida', () => {
    const items = [
      item({ itemId: 'i1', sessionId: 's1' }),
      item({ itemId: 'i2', sessionId: 's2' }),
      item({ itemId: 'i3', sessionId: 's3' }),
    ];
    expect(computeRecurringSkus(items, [], 3)[0].reachedRcaThreshold).toBe(true);
    expect(computeRecurringSkus(items, [], 5)[0].reachedRcaThreshold).toBe(false);
  });

  it('RCA só entra quando existe vínculo real por item', () => {
    const items = [item({ itemId: 'i1', sessionId: 's1' }), item({ itemId: 'i2', sessionId: 's2' })];
    const semVinculo = computeRecurringSkus(items, [link({ sourceItemId: 'outro-item' })], 3)[0];
    expect(semVinculo.rcaClassified).toBe(0);
    expect(semVinculo.causeLabels).toEqual([]);

    const comVinculo = computeRecurringSkus(items, [link({ sourceItemId: 'i2' })], 3)[0];
    expect(comVinculo.rcaClassified).toBe(1);
    expect(comVinculo.causeLabels).toEqual(['Endereçamento incorreto']);
  });

  it('ausência de RCA não vira ausência de reincidência nem sinal de saúde', () => {
    const rows = computeRecurringSkus(
      [item({ itemId: 'i1', sessionId: 's1' }), item({ itemId: 'i2', sessionId: 's2' })],
      [],
      3
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rcaClassified).toBe(0);
  });
});

describe('buildSkuHistory', () => {
  it('devolve só as divergências do SKU, mais recentes primeiro', () => {
    const items = [
      item({ itemId: 'i1', sessionId: 's1', sku: 'SKU-1', occurredAt: '2026-08-01T10:00:00.000Z' }),
      item({ itemId: 'i2', sessionId: 's2', sku: 'SKU-1', occurredAt: '2026-09-01T10:00:00.000Z' }),
      item({ itemId: 'i3', sessionId: 's2', sku: 'SKU-2' }),
    ];
    const history = buildSkuHistory(items, 'SKU-1');
    expect(history.map(h => h.itemId)).toEqual(['i2', 'i1']);
  });
});

describe('computeRecurringLocations', () => {
  it('usa sessões distintas e conta SKUs distintos', () => {
    const rows = computeRecurringLocations([
      item({ itemId: 'i1', sessionId: 's1', location: 'A1-01', sku: 'SKU-1' }),
      item({ itemId: 'i2', sessionId: 's2', location: 'A1-01', sku: 'SKU-2' }),
      item({ itemId: 'i3', sessionId: 's2', location: 'A1-01', sku: 'SKU-2' }),
      // Localização vista em uma única sessão não é recorrente.
      item({ itemId: 'i4', sessionId: 's1', location: 'C3-03', sku: 'SKU-9' }),
      // Item sem localização real não entra.
      item({ itemId: 'i5', sessionId: 's2', location: null, sku: 'SKU-9' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].location).toBe('A1-01');
    expect(rows[0].sessionsAffected).toBe(2);
    expect(rows[0].distinctSkus).toBe(2);
    expect(rows[0].occurrences).toBe(3);
  });
});

describe('computeRecurringCauses', () => {
  it('agrega a classificação real do RCA por sessões distintas', () => {
    const items = [
      item({ itemId: 'i1', sessionId: 's1', sku: 'SKU-1' }),
      item({ itemId: 'i2', sessionId: 's2', sku: 'SKU-2' }),
    ];
    const rows = computeRecurringCauses(items, [
      link({ sourceItemId: 'i1', occurredAt: '2026-08-01T10:00:00.000Z' }),
      link({ sourceItemId: 'i2', occurredAt: '2026-09-01T10:00:00.000Z' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].causeLabel).toBe('Endereçamento incorreto');
    expect(rows[0].occurrences).toBe(2);
    expect(rows[0].distinctSkus).toBe(2);
    expect(rows[0].sessionsAffected).toBe(2);
    expect(rows[0].lastOccurrenceAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('sem vínculo real, nenhuma causa é inferida', () => {
    const rows = computeRecurringCauses([item({ itemId: 'i1' })], [link({ sourceItemId: 'desconhecido' })]);
    expect(rows).toHaveLength(0);
  });

  it('causa vista em uma única sessão não é recorrente', () => {
    const rows = computeRecurringCauses(
      [item({ itemId: 'i1', sessionId: 's1' }), item({ itemId: 'i2', sessionId: 's1' })],
      [link({ sourceItemId: 'i1' }), link({ sourceItemId: 'i2' })]
    );
    expect(rows).toHaveLength(0);
  });
});

describe('Fase 1 preservada', () => {
  it('histórico continua consolidando e filtrando como antes', () => {
    const records = [
      record({ id: 'a', created_at: '2026-09-01T10:00:00.000Z', skus_contados: 40, divergencias_reais: 21, approved_by: 'u1' }),
      record({ id: 'b', created_at: '2026-06-01T10:00:00.000Z', skus_contados: 195, divergencias_reais: 5 }),
    ];
    const summary = computeHistorySummary(records);
    expect(summary.totalCounted).toBe(235);
    expect(summary.approvedSessions).toBe(1);
    expect(summary.observedAccuracyPct).toBeCloseTo(100 - (26 / 235) * 100, 6);

    const sessions = records.map(toSessionSummary);
    expect(filterSessions(sessions, EMPTY_SESSION_FILTERS, NOW)).toHaveLength(2);
    expect(filterSessions(sessions, { ...EMPTY_SESSION_FILTERS, period: '30d' }, NOW).map(s => s.id)).toEqual(['a']);
    expect(sessions[0].coveragePct).toBeCloseTo(40, 6);
  });
});
