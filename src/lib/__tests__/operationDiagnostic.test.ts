import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTIC_STEPS,
  DIAGNOSTIC_UNKNOWN_VALUE,
  isStepComplete,
  recommendPlan,
  type DiagnosticAnswers,
} from '../operationDiagnostic';
import { PLAN_ORDER } from '../plans';

/** Operação pequena: uma loja, poucos SKUs, tudo sob controle. */
const SMALL: DiagnosticAnswers = {
  segmento: ['varejo'],
  locais: ['1'],
  area: ['ate-500'],
  skus: ['ate-500'],
  funcionarios: ['ate-5'],
  operadores: ['ate-3'],
  frequencia: ['anual'],
  erp: ['nenhum'],
  wms: ['nao'],
  canais: [],
  metodo: ['erp'],
  confianca: ['muito_boa'],
  divergencias: ['rara'],
  recontagens: ['pouca'],
  prazo: ['nao'],
  cadastro: ['poucos'],
  objetivos: ['indicadores'],
};

/** Operação grande: vários locais, muito SKU, ERP, divergência constante. */
const LARGE: DiagnosticAnswers = {
  segmento: ['distribuicao'],
  locais: ['10+'],
  area: ['10000+'],
  skus: ['20000+'],
  funcionarios: ['50+'],
  operadores: ['30+'],
  frequencia: ['semanal'],
  erp: ['sap'],
  wms: ['sim'],
  canais: ['mercado_livre', 'shopee', 'amazon'],
  metodo: ['papel'],
  confianca: ['critica'],
  divergencias: ['constante'],
  recontagens: ['muita'],
  prazo: ['sempre'],
  cadastro: ['maioria'],
  objetivos: ['auditorias', 'erp', 'causas', 'multiplos_locais'],
};

function planIndex(key: string): number {
  return PLAN_ORDER.indexOf(key as (typeof PLAN_ORDER)[number]);
}

describe('recommendPlan', () => {
  it('recomenda Free para uma operação pequena e sob controle', () => {
    expect(recommendPlan(SMALL).plan.key).toBe('free');
  });

  it('sobe de plano conforme a operação cresce', () => {
    expect(planIndex(recommendPlan(LARGE).plan.key)).toBeGreaterThan(planIndex(recommendPlan(SMALL).plan.key));
  });

  it('só recomenda planos reais do catálogo', () => {
    for (const answers of [SMALL, LARGE, {}]) {
      expect(PLAN_ORDER).toContain(recommendPlan(answers).plan.key);
    }
  });

  it('sem nenhuma resposta fica no Free', () => {
    const result = recommendPlan({});
    expect(result.plan.key).toBe('free');
    expect(result.reasons).toHaveLength(0);
  });

  it('uma única resposta extrema não decide o plano', () => {
    // Só o SKU no topo, todo o resto igual à operação pequena.
    const oneSignal: DiagnosticAnswers = { ...SMALL, skus: ['20000+'] };
    const result = recommendPlan(oneSignal);
    // Sobe no máximo um degrau em relação ao Free — nunca vai para o topo.
    expect(planIndex(result.plan.key)).toBeLessThanOrEqual(1);
  });

  it('"não sei" é neutro: não empurra o plano para cima', () => {
    const unknownEverywhere: DiagnosticAnswers = Object.fromEntries(
      DIAGNOSTIC_STEPS.flatMap(s => s.questions).map(q => [
        q.id,
        q.options.some(o => o.value === DIAGNOSTIC_UNKNOWN_VALUE) ? [DIAGNOSTIC_UNKNOWN_VALUE] : [],
      ])
    );
    expect(recommendPlan(unknownEverywhere).plan.key).toBe('free');
  });

  it('marcar todos os objetivos não leva sozinho ao topo', () => {
    const objetivos = DIAGNOSTIC_STEPS.flatMap(s => s.questions).find(q => q.id === 'objetivos');
    const allGoals: DiagnosticAnswers = { ...SMALL, objetivos: objetivos!.options.map(o => o.value) };
    expect(planIndex(recommendPlan(allGoals).plan.key)).toBeLessThanOrEqual(1);
  });

  it('devolve no máximo três razões', () => {
    expect(recommendPlan(LARGE).reasons.length).toBeLessThanOrEqual(3);
  });

  it('é determinística — mesma entrada, mesma saída', () => {
    const a = recommendPlan(LARGE);
    const b = recommendPlan(LARGE);
    expect(a.plan.key).toBe(b.plan.key);
    expect(a.reasons).toEqual(b.reasons);
    expect(a.score).toBe(b.score);
  });

  it('conta as perguntas sem resposta definida', () => {
    expect(recommendPlan({}).unknownCount).toBeGreaterThan(0);
    expect(recommendPlan(LARGE).unknownCount).toBe(0);
  });

  it('o plano recomendado sempre traz o plano inferior, exceto no Free', () => {
    const free = recommendPlan(SMALL);
    expect(free.previous).toBeNull();
    const large = recommendPlan(LARGE);
    if (large.plan.key !== 'free') expect(large.previous).not.toBeNull();
  });
});

describe('isStepComplete', () => {
  it('exige resposta nas perguntas obrigatórias', () => {
    const step = DIAGNOSTIC_STEPS[0];
    expect(isStepComplete(step, {})).toBe(false);
    expect(isStepComplete(step, SMALL)).toBe(true);
  });

  it('não exige resposta em pergunta opcional', () => {
    const sistemas = DIAGNOSTIC_STEPS.find(s => s.id === 'sistemas')!;
    const semCanais: DiagnosticAnswers = { erp: ['nenhum'], wms: ['nao'], metodo: ['erp'] };
    expect(isStepComplete(sistemas, semCanais)).toBe(true);
  });
});

describe('configuração', () => {
  it('tem cinco etapas', () => {
    expect(DIAGNOSTIC_STEPS).toHaveLength(5);
  });

  it('não usa ids de pergunta duplicados', () => {
    const ids = DIAGNOSTIC_STEPS.flatMap(s => s.questions).map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('nenhuma opção de desconhecimento carrega peso', () => {
    for (const question of DIAGNOSTIC_STEPS.flatMap(s => s.questions)) {
      const unknown = question.options.find(o => o.value === DIAGNOSTIC_UNKNOWN_VALUE);
      if (unknown) expect(unknown.weight ?? 0).toBe(0);
    }
  });
});
