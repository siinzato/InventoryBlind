import { describe, expect, it } from 'vitest';
import {
  evaluateEscalation, buildRecurrenceSignature, groupByRecurrenceSignature, countRecurrenceForRecord,
  computeCaseConfidence, sortPriorityCases, hasMultipleOperators, canConfirmRootCause, canCloseCase,
  computeParetoBuckets, groupByDimension, type RecurrenceRecordShape, type ActionCloseCheck,
} from '../rcaAlgorithm';
import type { RcaRecord } from '../domainTypes';

function record(overrides: Partial<RcaRecord> = {}): RcaRecord {
  return {
    id: 'r1', company_id: 'co1', source_module: 'import_count', source_item_id: 's1',
    product_id: null, sku: 'SKU-1', product_name: 'Produto', location: 'A-01-01',
    operator_user_id: 'u1', operator_name: 'Operador 1', supplier_name: null, supplier_cnpj: null,
    divergence_qty: -3, process_area: 'inventario', cause_category: 'metodo_procedimento', subcause_code: null,
    custom_cause_label: null, notes: null, severity: 'baixa', classification_status: 'classified',
    containment_needed: false, known_recurrence: false, financial_impact: null, manual_escalation: false,
    rca_case_id: null, classified_by: 'u1', classified_by_email: 'u1@x.com', occurred_at: '2026-08-01T10:00:00Z',
    created_at: '2026-08-01T10:00:00Z',
    ...overrides,
  };
}

const NOW = new Date('2026-08-30T00:00:00Z').getTime();

describe('evaluateEscalation', () => {
  const settings = { recurrenceThresholdCount: 3, financialImpactThreshold: 1000 };

  it('não escalona quando nenhum critério é atingido', () => {
    const result = evaluateEscalation({ severity: 'baixa', financialImpact: null, controlFailure: false, manualEscalation: false, recurrenceCount: 1 }, settings);
    expect(result.shouldEscalate).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('escalona por severidade alta ou crítica', () => {
    expect(evaluateEscalation({ severity: 'alta', financialImpact: null, controlFailure: false, manualEscalation: false, recurrenceCount: 1 }, settings).shouldEscalate).toBe(true);
    expect(evaluateEscalation({ severity: 'critica', financialImpact: null, controlFailure: false, manualEscalation: false, recurrenceCount: 1 }, settings).reasons).toContain('severidade_alta_critica');
  });

  it('escalona por recorrência >= limiar', () => {
    const result = evaluateEscalation({ severity: 'baixa', financialImpact: null, controlFailure: false, manualEscalation: false, recurrenceCount: 3 }, settings);
    expect(result.shouldEscalate).toBe(true);
    expect(result.reasons).toContain('recorrencia');
  });

  it('escalona por impacto financeiro acima do limite do workspace', () => {
    const result = evaluateEscalation({ severity: 'baixa', financialImpact: 1500, controlFailure: false, manualEscalation: false, recurrenceCount: 1 }, settings);
    expect(result.reasons).toContain('impacto_financeiro');
  });

  it('não escalona por impacto financeiro sem limite configurado', () => {
    const result = evaluateEscalation({ severity: 'baixa', financialImpact: 999999, controlFailure: false, manualEscalation: false, recurrenceCount: 1 }, { recurrenceThresholdCount: 3, financialImpactThreshold: null });
    expect(result.reasons).not.toContain('impacto_financeiro');
  });

  it('escalona por falha de controle (categoria Controle/Governança)', () => {
    const result = evaluateEscalation({ severity: 'baixa', financialImpact: null, controlFailure: true, manualEscalation: false, recurrenceCount: 1 }, settings);
    expect(result.reasons).toEqual(['falha_controle']);
  });

  it('escalona por escalonamento manual do gestor', () => {
    const result = evaluateEscalation({ severity: 'baixa', financialImpact: null, controlFailure: false, manualEscalation: true, recurrenceCount: 1 }, settings);
    expect(result.reasons).toEqual(['escalonamento_manual']);
  });
});

describe('recorrência por assinatura (categoria+subcausa+contexto, não só processo)', () => {
  it('dois registros do mesmo processo mas causas diferentes não são recorrentes', () => {
    const a: RecurrenceRecordShape = { cause_category: 'sistema', subcause_code: null, sku: 'A', location: null, supplier_name: null, process_area: 'picking', occurred_at: '2026-08-20T00:00:00Z', classification_status: 'classified' };
    const b: RecurrenceRecordShape = { cause_category: 'metodo_procedimento', subcause_code: null, sku: 'A', location: null, supplier_name: null, process_area: 'picking', occurred_at: '2026-08-21T00:00:00Z', classification_status: 'classified' };
    expect(buildRecurrenceSignature(a)).not.toBe(buildRecurrenceSignature(b));
  });

  it('agrupa registros com mesma categoria/subcausa/contexto dentro da janela', () => {
    const records: RecurrenceRecordShape[] = [
      { cause_category: 'sistema', subcause_code: 'bug_sistema', sku: 'A', location: null, supplier_name: null, process_area: 'picking', occurred_at: '2026-08-20T00:00:00Z', classification_status: 'classified' },
      { cause_category: 'sistema', subcause_code: 'bug_sistema', sku: 'A', location: null, supplier_name: null, process_area: 'picking', occurred_at: '2026-08-22T00:00:00Z', classification_status: 'classified' },
      { cause_category: 'sistema', subcause_code: 'bug_sistema', sku: 'B', location: null, supplier_name: null, process_area: 'picking', occurred_at: '2026-08-22T00:00:00Z', classification_status: 'classified' },
    ];
    const groups = groupByRecurrenceSignature(records, 60, NOW);
    expect(groups.size).toBe(2);
    expect(Array.from(groups.values()).find(g => g.length === 2)).toBeDefined();
  });

  it('ignora classificações pendentes e fora da janela', () => {
    const records: RecurrenceRecordShape[] = [
      { cause_category: 'sistema', subcause_code: null, sku: 'A', location: null, supplier_name: null, process_area: 'picking', occurred_at: '2026-08-20T00:00:00Z', classification_status: 'pending' },
      { cause_category: 'sistema', subcause_code: null, sku: 'A', location: null, supplier_name: null, process_area: 'picking', occurred_at: '2025-01-01T00:00:00Z', classification_status: 'classified' },
    ];
    const groups = groupByRecurrenceSignature(records, 60, NOW);
    expect(groups.size).toBe(0);
  });

  it('countRecurrenceForRecord conta a própria ocorrência dentro do grupo', () => {
    const target: RecurrenceRecordShape = { cause_category: 'sistema', subcause_code: null, sku: 'A', location: null, supplier_name: null, process_area: 'picking', occurred_at: '2026-08-25T00:00:00Z', classification_status: 'classified' };
    const recent: RecurrenceRecordShape[] = [
      target,
      { ...target, occurred_at: '2026-08-24T00:00:00Z' },
      { ...target, occurred_at: '2026-08-23T00:00:00Z' },
    ];
    expect(countRecurrenceForRecord(target, recent, 60, NOW)).toBe(3);
  });
});

describe('computeCaseConfidence', () => {
  it('0% quando nada está preenchido', () => {
    expect(computeCaseConfidence({ hasProblemDefined: false, evidenceCount: 0, hasSustainedCause: false, hasActionPlan: false, hasEffectivenessCriteria: false })).toBe(0);
  });
  it('100% quando todos os critérios são atendidos', () => {
    expect(computeCaseConfidence({ hasProblemDefined: true, evidenceCount: 2, hasSustainedCause: true, hasActionPlan: true, hasEffectivenessCriteria: true })).toBe(100);
  });
  it('é proporcional aos critérios atendidos', () => {
    expect(computeCaseConfidence({ hasProblemDefined: true, evidenceCount: 1, hasSustainedCause: false, hasActionPlan: false, hasEffectivenessCriteria: false })).toBe(40);
  });
});

describe('sortPriorityCases', () => {
  it('ordena por severidade, depois recorrência, impacto e prazo', () => {
    const cases = [
      { key: 'baixa-sem-prazo', severity: 'baixa' as const, recurrenceCount: 10, financialImpact: 999, dueAt: null },
      { key: 'critica', severity: 'critica' as const, recurrenceCount: 1, financialImpact: null, dueAt: null },
      { key: 'alta-recorrente', severity: 'alta' as const, recurrenceCount: 5, financialImpact: null, dueAt: null },
      { key: 'alta-menos-recorrente', severity: 'alta' as const, recurrenceCount: 1, financialImpact: null, dueAt: '2026-09-01T00:00:00Z' },
    ];
    const sorted = sortPriorityCases(cases).map(c => c.key);
    expect(sorted).toEqual(['critica', 'alta-recorrente', 'alta-menos-recorrente', 'baixa-sem-prazo']);
  });
});

describe('hasMultipleOperators — proteção contra culpa automática', () => {
  it('falso quando é sempre o mesmo operador', () => {
    expect(hasMultipleOperators([{ operator_user_id: 'u1' }, { operator_user_id: 'u1' }])).toBe(false);
  });
  it('verdadeiro quando há operadores diferentes (sinal de padrão sistêmico)', () => {
    expect(hasMultipleOperators([{ operator_user_id: 'u1' }, { operator_user_id: 'u2' }])).toBe(true);
  });
});

describe('canConfirmRootCause', () => {
  it('exige texto e ao menos uma evidência', () => {
    expect(canConfirmRootCause('', 1)).toBe(false);
    expect(canConfirmRootCause('causa raiz', 0)).toBe(false);
    expect(canConfirmRootCause('causa raiz', 1)).toBe(true);
  });
});

describe('canCloseCase', () => {
  const doneAction = (type: ActionCloseCheck['actionType'], verified: ActionCloseCheck['verificationResult'] = 'eficaz'): ActionCloseCheck => ({
    actionType: type, taskDone: true, taskBlocked: false, verificationResult: verified,
  });

  it('bloqueia sem causa raiz confirmada', () => {
    const result = canCloseCase('proposta', [doneAction('corretiva')]);
    expect(result.canClose).toBe(false);
    expect(result.blockers).toContain('causa_raiz_nao_confirmada');
  });

  it('bloqueia sem nenhuma ação corretiva', () => {
    const result = canCloseCase('confirmada', [doneAction('contencao')]);
    expect(result.blockers).toContain('sem_acao_corretiva');
  });

  it('contenção sozinha nunca encerra o caso', () => {
    const result = canCloseCase('confirmada', [{ actionType: 'contencao', taskDone: false, taskBlocked: false, verificationResult: null }]);
    expect(result.canClose).toBe(false);
    expect(result.blockers).toContain('sem_acao_corretiva');
  });

  it('bloqueia com ação pendente (não concluída)', () => {
    const result = canCloseCase('confirmada', [{ actionType: 'corretiva', taskDone: false, taskBlocked: false, verificationResult: null }]);
    expect(result.blockers).toContain('acoes_pendentes');
  });

  it('bloqueia sem verificação de eficácia', () => {
    const result = canCloseCase('confirmada', [doneAction('corretiva', null)]);
    expect(result.blockers).toContain('eficacia_nao_verificada');
  });

  it('bloqueia com ação bloqueada', () => {
    const result = canCloseCase('confirmada', [doneAction('corretiva'), { actionType: 'preventiva', taskDone: false, taskBlocked: true, verificationResult: null }]);
    expect(result.blockers).toContain('bloqueio_ativo');
  });

  it('permite encerrar quando todos os critérios são atendidos', () => {
    const result = canCloseCase('confirmada', [doneAction('corretiva')]);
    expect(result.canClose).toBe(true);
    expect(result.blockers).toEqual([]);
  });
});

describe('computeParetoBuckets — ordena e calcula percentual acumulado', () => {
  it('ordena por frequência desc e acumula corretamente', () => {
    const records = [
      record({ id: '1', cause_category: 'sistema' }),
      record({ id: '2', cause_category: 'sistema' }),
      record({ id: '3', cause_category: 'sistema' }),
      record({ id: '4', cause_category: 'fornecedor' }),
    ];
    const buckets = computeParetoBuckets(records);
    expect(buckets[0].category).toBe('sistema');
    expect(buckets[0].count).toBe(3);
    expect(buckets[0].pctOfTotal).toBeCloseTo(75);
    expect(buckets[1].cumulativePct).toBeCloseTo(100);
  });

  it('ignora registros sem causa (pendentes)', () => {
    const records = [record({ id: '1', cause_category: null }), record({ id: '2', cause_category: 'sistema' })];
    const buckets = computeParetoBuckets(records);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].category).toBe('sistema');
  });
});

describe('groupByDimension — cobertura real, processo separado de categoria', () => {
  it('agrupa por categoria de causa sem misturar com o processo afetado', () => {
    const records = [
      record({ id: '1', process_area: 'picking', cause_category: 'metodo_procedimento' }),
      record({ id: '2', process_area: 'recebimento', cause_category: 'metodo_procedimento' }),
    ];
    const buckets = groupByDimension(records, 'cause_category');
    expect(buckets).toHaveLength(1);
    expect(buckets[0].count).toBe(2);
  });

  it('nunca usa nome de operador como categoria de causa — agrupa por operador só na dimensão "operator"', () => {
    const records = [record({ operator_user_id: 'u1', operator_name: 'Victor' }), record({ operator_user_id: 'u2', operator_name: 'Marina' })];
    const buckets = groupByDimension(records, 'operator');
    expect(buckets.map(b => b.label).sort()).toEqual(['Marina', 'Victor']);
  });
});
