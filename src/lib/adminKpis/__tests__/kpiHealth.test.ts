import { describe, expect, it } from 'vitest';
import {
  computeAccuracyTrend, classifyAccuracyByTarget, isKpiStale, computeOperationalSummary, buildPriorityAlerts,
  ACCURACY_TARGET_PCT, ACCURACY_WARNING_FLOOR_PCT, CRITICAL_ACCURACY_DROP_POINTS, STALE_KPI_DAYS,
  type AccuracyPoint, type AccuracyTrend,
} from '../kpiHealth';

describe('classifyAccuracyByTarget — mesma meta de 95%/80% já usada em App.tsx', () => {
  it('null (nenhum inventário fechado) é "insuficiente", nunca dentro da meta por omissão', () => {
    expect(classifyAccuracyByTarget(null)).toBe('insuficiente');
  });

  it('>= meta é saudável', () => {
    expect(classifyAccuracyByTarget(ACCURACY_TARGET_PCT)).toBe('saudavel');
    expect(classifyAccuracyByTarget(99)).toBe('saudavel');
  });

  it('entre o piso e a meta é atenção', () => {
    expect(classifyAccuracyByTarget(ACCURACY_WARNING_FLOOR_PCT)).toBe('atencao');
    expect(classifyAccuracyByTarget(90)).toBe('atencao');
  });

  it('abaixo do piso é crítico', () => {
    expect(classifyAccuracyByTarget(ACCURACY_WARNING_FLOOR_PCT - 0.1)).toBe('critico');
  });
});

describe('computeAccuracyTrend', () => {
  it('menos de dois pontos é sempre "insuficiente", nunca estável por omissão', () => {
    expect(computeAccuracyTrend([]).trend).toBe('insuficiente');
    expect(computeAccuracyTrend([{ date: '2026-08-01', accuracy: 95 }]).trend).toBe('insuficiente');
  });

  it('queda >= limite crítico é "piora_relevante"', () => {
    const points: AccuracyPoint[] = [
      { date: '2026-07-01', accuracy: 98 },
      { date: '2026-08-01', accuracy: 98 - CRITICAL_ACCURACY_DROP_POINTS },
    ];
    const trend = computeAccuracyTrend(points);
    expect(trend.trend).toBe('piora_relevante');
    expect(trend.deltaPoints).toBe(-CRITICAL_ACCURACY_DROP_POINTS);
  });

  it('queda pequena (menor que o limite crítico) é "piora_leve"', () => {
    const points: AccuracyPoint[] = [
      { date: '2026-07-01', accuracy: 98 },
      { date: '2026-08-01', accuracy: 96 },
    ];
    expect(computeAccuracyTrend(points).trend).toBe('piora_leve');
  });

  it('acuracidade melhor é "melhora"; igual é "estavel"', () => {
    expect(computeAccuracyTrend([{ date: '2026-07-01', accuracy: 96 }, { date: '2026-08-01', accuracy: 98 }]).trend).toBe('melhora');
    expect(computeAccuracyTrend([{ date: '2026-07-01', accuracy: 96 }, { date: '2026-08-01', accuracy: 96 }]).trend).toBe('estavel');
  });

  it('ordena por data mesmo se os pontos chegarem fora de ordem', () => {
    const points: AccuracyPoint[] = [
      { date: '2026-08-01', accuracy: 90 },
      { date: '2026-07-01', accuracy: 99 },
    ];
    const trend = computeAccuracyTrend(points);
    expect(trend.latest?.date).toBe('2026-08-01');
    expect(trend.previous?.date).toBe('2026-07-01');
  });
});

describe('isKpiStale', () => {
  const ref = new Date('2026-08-25T12:00:00Z');

  it('dentro do limite não é parado', () => {
    expect(isKpiStale('2026-08-01T00:00:00Z', ref)).toBe(false);
  });

  it('exatamente no limite já conta como parado', () => {
    const exactlyStale = new Date(ref.getTime() - STALE_KPI_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(isKpiStale(exactlyStale, ref)).toBe(true);
  });

  it('data inválida nunca vira alarme falso', () => {
    expect(isKpiStale('não-é-uma-data', ref)).toBe(false);
  });
});

const NO_TREND: AccuracyTrend = { trend: 'insuficiente', latest: null, previous: null, deltaPoints: null };

describe('computeOperationalSummary', () => {
  it('crítico quando a acuracidade está abaixo do piso', () => {
    const summary = computeOperationalSummary({ customKpiCount: 4, accuracyStatus: 'critico', staleKpiNames: [] });
    expect(summary.status).toBe('critico');
    expect(summary.destaque).toBe('Acuracidade do inventário');
    expect(summary.semMeta).toBe(4); // nenhum custom KPI tem meta hoje
  });

  it('saudável e sem indicador parado: destaque é null, não inventado', () => {
    const summary = computeOperationalSummary({ customKpiCount: 2, accuracyStatus: 'saudavel', staleKpiNames: [] });
    expect(summary.status).toBe('saudavel');
    expect(summary.destaque).toBeNull();
  });

  it('sem inventário fechado, resumo é "insuficiente" (não "saudavel" por omissão)', () => {
    const summary = computeOperationalSummary({ customKpiCount: 0, accuracyStatus: 'insuficiente', staleKpiNames: [] });
    expect(summary.status).toBe('insuficiente');
  });

  it('indicador parado vira destaque quando a acuracidade está saudável', () => {
    const summary = computeOperationalSummary({ customKpiCount: 3, accuracyStatus: 'saudavel', staleKpiNames: ['Taxa de Erro'] });
    expect(summary.destaque).toBe('Taxa de Erro');
  });
});

describe('buildPriorityAlerts', () => {
  it('nunca retorna mais de 3 alertas', () => {
    const alerts = buildPriorityAlerts({
      accuracyStatus: 'critico',
      accuracyTrend: { trend: 'piora_relevante', latest: { date: '2026-08-20', accuracy: 70 }, previous: { date: '2026-07-20', accuracy: 90 }, deltaPoints: -20 },
      staleKpiNames: ['A', 'B'],
      semMetaCount: 5,
    });
    expect(alerts.length).toBeLessThanOrEqual(3);
  });

  it('acuracidade abaixo da meta gera só UM alerta (não também o de piora), mesmo que ambos se apliquem', () => {
    const alerts = buildPriorityAlerts({
      accuracyStatus: 'critico',
      accuracyTrend: { trend: 'piora_relevante', latest: { date: '2026-08-20', accuracy: 70 }, previous: { date: '2026-07-20', accuracy: 90 }, deltaPoints: -20 },
      staleKpiNames: [],
      semMetaCount: 0,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('accuracy-below-target');
  });

  it('dentro da meta mas piorando gera o alerta de piora (sinal distinto do de meta)', () => {
    const alerts = buildPriorityAlerts({
      accuracyStatus: 'saudavel',
      accuracyTrend: { trend: 'piora_leve', latest: { date: '2026-08-20', accuracy: 96 }, previous: { date: '2026-07-20', accuracy: 99 }, deltaPoints: -3 },
      staleKpiNames: [],
      semMetaCount: 0,
    });
    expect(alerts[0].id).toBe('accuracy-worsening');
  });

  it('prioriza meta/tendência antes de indicadores parados e sem meta', () => {
    const alerts = buildPriorityAlerts({
      accuracyStatus: 'critico',
      accuracyTrend: { trend: 'piora_relevante', latest: { date: '2026-08-20', accuracy: 70 }, previous: { date: '2026-07-20', accuracy: 90 }, deltaPoints: -20 },
      staleKpiNames: ['X'],
      semMetaCount: 2,
    });
    expect(alerts[0].id).toBe('accuracy-below-target');
  });

  it('sem nenhum sinal aplicável, não inventa alerta', () => {
    const alerts = buildPriorityAlerts({
      accuracyStatus: 'saudavel',
      accuracyTrend: { trend: 'estavel', latest: { date: '2026-08-20', accuracy: 97 }, previous: { date: '2026-07-20', accuracy: 97 }, deltaPoints: 0 },
      staleKpiNames: [],
      semMetaCount: 0,
    });
    expect(alerts).toHaveLength(0);
  });

  it('histórico insuficiente gera alerta informativo, não crítico', () => {
    const alerts = buildPriorityAlerts({ accuracyStatus: 'insuficiente', accuracyTrend: NO_TREND, staleKpiNames: [], semMetaCount: 0 });
    expect(alerts[0].severity).toBe('info');
  });
});
