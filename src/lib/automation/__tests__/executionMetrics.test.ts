import { describe, expect, it } from 'vitest';
import { computeExecutionMetrics, computeResultDistribution } from '../executionMetrics';
import type { AutomationExecution } from '../types';

function exec(overrides: Partial<AutomationExecution> = {}): AutomationExecution {
  return {
    id: 'e1',
    companyId: 'c1',
    automationId: 'a1',
    eventId: null,
    automationVersion: 1,
    triggerType: 'count.item_counted',
    triggerSource: 'event',
    status: 'success',
    dryRun: false,
    context: {},
    errorMessage: null,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1000,
    depth: 0,
    triggeredBy: null,
    ...overrides,
  };
}

describe('computeExecutionMetrics', () => {
  it('calcula média/mínimo/máximo só sobre execuções reais com duração conhecida', () => {
    const metrics = computeExecutionMetrics([
      exec({ durationMs: 1000 }),
      exec({ durationMs: 3000 }),
      exec({ dryRun: true, durationMs: 999999 }), // teste — nunca deve entrar na conta
      exec({ durationMs: null }), // sem duração — ignorado, nunca vira NaN
    ]);
    expect(metrics.avgDurationMs).toBe(2000);
    expect(metrics.minDurationMs).toBe(1000);
    expect(metrics.maxDurationMs).toBe(3000);
  });

  it('taxa de sucesso ignora execuções de teste e conta só sucesso/parcial/erro concluídos', () => {
    const metrics = computeExecutionMetrics([
      exec({ status: 'success' }),
      exec({ status: 'success' }),
      exec({ status: 'failed' }),
      exec({ status: 'running' }), // ainda não concluída — não entra na taxa
      exec({ dryRun: true, status: 'failed' }), // teste — não conta como falha real
    ]);
    expect(metrics.successRate).toBe(67); // 2 de 3 concluídas reais
  });

  it('retorna null em vez de NaN quando não há nenhuma execução real concluída', () => {
    const metrics = computeExecutionMetrics([exec({ dryRun: true })]);
    expect(metrics.successRate).toBeNull();
    expect(metrics.avgDurationMs).toBeNull();
    expect(Number.isNaN(metrics.avgDurationMs)).toBe(false);
  });

  it('conta falhas recentes só nas últimas 24h, e nunca de execuções de teste', () => {
    const now = Date.now();
    const metrics = computeExecutionMetrics([
      exec({ status: 'failed', startedAt: new Date(now - 60_000).toISOString() }),
      exec({ status: 'failed', startedAt: new Date(now - 48 * 60 * 60 * 1000).toISOString() }),
      exec({ status: 'failed', dryRun: true, startedAt: new Date(now - 60_000).toISOString() }),
    ]);
    expect(metrics.recentFailures).toBe(1);
  });
});

describe('computeResultDistribution', () => {
  it('nunca usa um status que o sistema não produz (ex.: "ignorado" não existe em nível de execução)', () => {
    const distribution = computeResultDistribution([exec({ status: 'success' }), exec({ status: 'failed' })]);
    for (const entry of distribution) {
      expect(['success', 'failed', 'partial', 'cancelled', 'running']).toContain(entry.status);
    }
  });

  it('omite buckets sem nenhuma ocorrência em vez de mostrar zero', () => {
    const distribution = computeResultDistribution([exec({ status: 'success' }), exec({ status: 'success' })]);
    expect(distribution).toEqual([{ status: 'success', label: 'Sucesso', count: 2, percent: 100 }]);
  });

  it('array vazio sem execuções — nunca divide por zero', () => {
    expect(computeResultDistribution([])).toEqual([]);
  });
});
