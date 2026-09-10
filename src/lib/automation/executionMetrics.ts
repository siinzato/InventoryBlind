// Métricas do histórico de execuções — cálculo puro sobre o que já foi
// carregado da página atual (AutomationExecution[]), sem endpoint analítico
// novo. Execuções de teste (dryRun) não contam para taxa de sucesso nem para
// falhas recentes — não representam o comportamento real da automação.

import { EXECUTION_STATUS_LABEL, type AutomationExecution, type ExecutionStatus } from './types';

export interface ExecutionMetrics {
  count: number;
  avgDurationMs: number | null;
  minDurationMs: number | null;
  maxDurationMs: number | null;
  /** % sobre execuções reais (não-dryRun) já concluídas (sucesso/parcial/erro). */
  successRate: number | null;
  /** Falhas reais nas últimas 24h, relativas a agora. */
  recentFailures: number;
}

export function computeExecutionMetrics(executions: AutomationExecution[]): ExecutionMetrics {
  const real = executions.filter(e => !e.dryRun);
  const durations = real.map(e => e.durationMs).filter((d): d is number => d != null);

  const finished = real.filter(e => e.status === 'success' || e.status === 'failed' || e.status === 'partial');
  const successRate = finished.length === 0
    ? null
    : Math.round((finished.filter(e => e.status === 'success').length / finished.length) * 100);

  const last24h = Date.now() - 24 * 60 * 60 * 1000;
  const recentFailures = real.filter(e => e.status === 'failed' && new Date(e.startedAt).getTime() >= last24h).length;

  return {
    count: executions.length,
    avgDurationMs: durations.length === 0 ? null : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    minDurationMs: durations.length === 0 ? null : Math.min(...durations),
    maxDurationMs: durations.length === 0 ? null : Math.max(...durations),
    successRate,
    recentFailures,
  };
}

export interface ResultDistributionEntry {
  status: ExecutionStatus;
  label: string;
  count: number;
  percent: number;
}

/** Só os status que o sistema realmente produz (`ExecutionStatus` — nunca um
 *  rótulo como "Ignorado" que não existe em nível de execução). Buckets sem
 *  nenhuma ocorrência não aparecem, para não gerar linhas de "0" sem sentido
 *  quando a automação nunca teve, por exemplo, uma execução cancelada. */
export function computeResultDistribution(executions: AutomationExecution[]): ResultDistributionEntry[] {
  const total = executions.length;
  if (total === 0) return [];

  const order: ExecutionStatus[] = ['success', 'failed', 'partial', 'cancelled', 'running'];
  const counts = new Map<ExecutionStatus, number>();
  for (const e of executions) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);

  return order
    .filter(status => (counts.get(status) ?? 0) > 0)
    .map(status => {
      const count = counts.get(status) ?? 0;
      return { status, label: EXECUTION_STATUS_LABEL[status], count, percent: Math.round((count / total) * 1000) / 10 };
    });
}
