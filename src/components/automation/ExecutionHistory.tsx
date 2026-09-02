import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, Timer } from 'lucide-react';
import { Badge, Button, Input, Panel, PanelSection, Select, Stat, StatCell, StatRow, Table, Td, Th, Thead, Tr } from '../ui';
import { countStepsByExecution, listExecutionsPage } from '../../lib/automation/automationService';
import { isKnownTrigger, TRIGGERS } from '../../lib/automation/registry';
import { computeExecutionMetrics, computeResultDistribution } from '../../lib/automation/executionMetrics';
import {
  EXECUTION_STATUS_LABEL,
  type Automation,
  type AutomationExecution,
  type ExecutionStatus,
} from '../../lib/automation/types';
import { AutomationKpiCard } from './AutomationKpiCard';
import { AutomationTestPanel } from './AutomationTestPanel';
import { ExecutionDetailPanel } from './ExecutionDetailPanel';

interface Props {
  automations: Automation[];
  canManage: boolean;
}

const PAGE_SIZE = 10;

const STATUS_VARIANT = {
  success: 'success',
  partial: 'warning',
  failed: 'danger',
  running: 'neutral',
  cancelled: 'neutral',
} as const;

const DIST_DOT: Record<ExecutionStatus, string> = {
  success: 'bg-emerald-500',
  failed: 'bg-red-500',
  partial: 'bg-amber-500',
  cancelled: 'bg-fg-subtle',
  running: 'bg-accent',
};

const EXECUTED_BY_LABEL: Record<AutomationExecution['triggerSource'], string> = {
  manual: 'Manual',
  event: 'Sistema',
  schedule: 'Sistema (agendamento)',
  webhook: 'Sistema (webhook)',
};

type PeriodFilter = 'today' | '7d' | '30d' | 'all';

function fromDateForPeriod(period: PeriodFilter): string | undefined {
  const now = Date.now();
  if (period === 'today') return new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  if (period === '7d') return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (period === '30d') return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  return undefined;
}

function periodLabel(period: PeriodFilter): string {
  if (period === 'today') return 'hoje';
  if (period === '7d') return 'últimos 7 dias';
  if (period === '30d') return 'últimos 30 dias';
  return 'todo o período';
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)}s`;
}

function triggerLabel(triggerType: string): string {
  return isKnownTrigger(triggerType) ? TRIGGERS[triggerType].label : triggerType;
}

const STATUS_OPTIONS: ExecutionStatus[] = ['success', 'failed', 'partial', 'cancelled', 'running'];

/** Aba "Execuções" — histórico paginado + detalhe/trace de uma execução +
 *  teste seguro + métricas, tudo derivado de `automation_executions` /
 *  `automation_node_executions` já existentes (nenhuma tabela nova). */
export function ExecutionHistory({ automations, canManage }: Props) {
  const [search, setSearch] = useState('');
  const [automationFilter, setAutomationFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ExecutionStatus>('all');
  const [period, setPeriod] = useState<PeriodFilter>('7d');
  const [page, setPage] = useState(0);

  const [executions, setExecutions] = useState<AutomationExecution[]>([]);
  const [stepCounts, setStepCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [metricsExecutions, setMetricsExecutions] = useState<AutomationExecution[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(true);

  const fromDate = fromDateForPeriod(period);

  // Busca por nome resolvida contra a lista de automações já carregada pela
  // tela — o serviço filtra só por id, nunca por texto (evita duplicar a
  // lógica de busca em dois lugares).
  const matchingAutomationIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === '') return undefined;
    return automations.filter(a => a.name.toLowerCase().includes(q)).map(a => a.id);
  }, [automations, search]);

  useEffect(() => { setPage(0); }, [search, automationFilter, statusFilter, period]);

  const loadTable = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listExecutionsPage({
        automationId: automationFilter !== 'all' ? automationFilter : undefined,
        automationIds: matchingAutomationIds,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        from: fromDate,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setExecutions(result.executions);
      setTotal(result.total);
      setFailure(null);
      setStepCounts(await countStepsByExecution(result.executions.map(e => e.id)).catch(() => ({})));
    } catch (thrown) {
      setFailure(thrown instanceof Error ? thrown.message : 'Não foi possível carregar o histórico.');
    } finally {
      setLoading(false);
    }
  }, [automationFilter, matchingAutomationIds, statusFilter, fromDate, page]);

  useEffect(() => { void loadTable(); }, [loadTable]);

  // Métricas/distribuição respeitam o período selecionado, mas não os demais
  // filtros da tabela — são o retrato de TODAS as automações naquele período,
  // igual à referência (a faixa de KPIs não filtra por automação/resultado).
  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true);
    try {
      const result = await listExecutionsPage({ from: fromDate, limit: 500, offset: 0 });
      setMetricsExecutions(result.executions);
    } catch {
      setMetricsExecutions([]);
    } finally {
      setMetricsLoading(false);
    }
  }, [fromDate]);

  useEffect(() => { void loadMetrics(); }, [loadMetrics]);

  const metrics = useMemo(() => computeExecutionMetrics(metricsExecutions), [metricsExecutions]);
  const distribution = useMemo(() => computeResultDistribution(metricsExecutions), [metricsExecutions]);

  function automationName(id: string): string {
    return automations.find(a => a.id === id)?.name ?? 'Automação removida';
  }

  function reloadAfterTest(): void {
    void loadTable();
    void loadMetrics();
  }

  const selectedExecution = executions.find(e => e.id === selectedId) ?? null;
  const selectedAutomation = selectedExecution ? automations.find(a => a.id === selectedExecution.automationId) : undefined;

  const hasActiveFilters = search.trim() !== '' || automationFilter !== 'all' || statusFilter !== 'all';
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AutomationKpiCard
          icon={RefreshCw}
          iconClass="bg-accent/10 text-accent"
          title="Execuções"
          value={metricsLoading ? '—' : metrics.count}
          context={periodLabel(period)}
        />
        <AutomationKpiCard
          icon={CheckCircle2}
          iconClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          title="Taxa de sucesso"
          value={metrics.successRate == null ? '—' : `${metrics.successRate}%`}
          context={periodLabel(period)}
        />
        <AutomationKpiCard
          icon={Timer}
          iconClass="bg-violet-500/10 text-violet-600 dark:text-violet-400"
          title="Tempo médio"
          value={formatMs(metrics.avgDurationMs)}
          context={metrics.minDurationMs == null ? 'sem execuções concluídas' : `${formatMs(metrics.minDurationMs)} – ${formatMs(metrics.maxDurationMs)}`}
        />
        <AutomationKpiCard
          icon={AlertTriangle}
          iconClass="bg-red-500/10 text-red-600 dark:text-red-400"
          title="Falhas recentes"
          value={metrics.recentFailures}
          context="últimas 24h"
          tone={metrics.recentFailures > 0 ? 'critical' : 'default'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelSection>
            <h3 className="text-section">Execuções — Histórico</h3>
            <p className="mt-1 text-sm text-fg-muted">Histórico completo das execuções de automações.</p>
          </PanelSection>

          <PanelSection className="flex flex-wrap items-center gap-2">
            <Input icon={<Search size={14} />} placeholder="Buscar execuções…" value={search} onChange={e => setSearch(e.target.value)} className="min-w-[180px] flex-1" />
            <Select value={automationFilter} onChange={e => setAutomationFilter(e.target.value)} className="w-auto">
              <option value="all">Automação: Todas</option>
              {automations.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | ExecutionStatus)} className="w-auto">
              <option value="all">Resultado: Todos</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{EXECUTION_STATUS_LABEL[s]}</option>)}
            </Select>
            <Select value={period} onChange={e => setPeriod(e.target.value as PeriodFilter)} className="w-auto">
              <option value="today">Período: Hoje</option>
              <option value="7d">Período: 7 dias</option>
              <option value="30d">Período: 30 dias</option>
              <option value="all">Período: Tudo</option>
            </Select>
          </PanelSection>

          {loading ? (
            <PanelSection className="flex items-center gap-3 text-sm text-fg-muted">
              <Loader2 size={16} className="animate-spin" />
              Carregando execuções…
            </PanelSection>
          ) : failure != null ? (
            <PanelSection className="text-sm text-red-600 dark:text-red-400">{failure}</PanelSection>
          ) : executions.length === 0 ? (
            <PanelSection className="text-sm leading-relaxed text-fg-muted">
              {hasActiveFilters
                ? 'Nenhuma execução encontrada para esses filtros.'
                : 'Nenhuma execução registrada neste período. Execuções aparecem aqui quando um evento aciona uma automação ativa, quando você testa, ou quando você executa manualmente.'}
            </PanelSection>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Automação</Th>
                      <Th>Evento / Gatilho</Th>
                      <Th>Início</Th>
                      <Th>Duração</Th>
                      <Th>Resultado</Th>
                      <Th>Passos</Th>
                      <Th>Executado por</Th>
                    </Tr>
                  </Thead>
                  <tbody>
                    {executions.map(execution => (
                      <Tr
                        key={execution.id}
                        onClick={() => setSelectedId(execution.id)}
                        className={`cursor-pointer ${selectedId === execution.id ? 'bg-accent/5' : ''}`}
                      >
                        <Td className="text-fg">
                          {automationName(execution.automationId)}
                          {execution.dryRun && <Badge variant="neutral" className="ml-2">Teste</Badge>}
                        </Td>
                        <Td className="text-fg-muted">{triggerLabel(execution.triggerType)}</Td>
                        <Td className="whitespace-nowrap text-fg-muted">
                          {new Date(execution.startedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })}
                        </Td>
                        <Td className="tabular-nums text-fg-muted">{formatMs(execution.durationMs)}</Td>
                        <Td><Badge variant={STATUS_VARIANT[execution.status]}>{EXECUTION_STATUS_LABEL[execution.status]}</Badge></Td>
                        <Td className="tabular-nums text-fg-muted">{stepCounts[execution.id] ?? '—'}</Td>
                        <Td className="text-fg-muted">{EXECUTED_BY_LABEL[execution.triggerSource]}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>

              <PanelSection className="flex items-center justify-between text-xs text-fg-subtle">
                <span>{rangeStart}–{rangeEnd} de {total} execuções</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label="Página anterior">
                    <ChevronLeft size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" disabled={rangeEnd >= total} onClick={() => setPage(p => p + 1)} aria-label="Próxima página">
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </PanelSection>
            </>
          )}
        </Panel>

        {selectedExecution ? (
          <ExecutionDetailPanel
            key={selectedExecution.id}
            execution={selectedExecution}
            automation={selectedAutomation}
            canManage={canManage}
            onRetested={reloadAfterTest}
          />
        ) : (
          <Panel>
            <PanelSection className="text-sm text-fg-muted">Selecione uma execução à esquerda para ver o trace e os detalhes.</PanelSection>
          </Panel>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {canManage ? <AutomationTestPanel automations={automations} canManage={canManage} /> : <div />}

        <Panel>
          <PanelSection>
            <h3 className="text-section">Métricas de desempenho</h3>
            <p className="mt-1 text-sm text-fg-muted">{periodLabel(period)}</p>
          </PanelSection>
          <PanelSection>
            <StatRow className="sm:grid-cols-2">
              <StatCell><Stat label="Tempo médio" value={formatMs(metrics.avgDurationMs)} /></StatCell>
              <StatCell><Stat label="Tempo mínimo" value={formatMs(metrics.minDurationMs)} /></StatCell>
            </StatRow>
            <StatRow className="sm:grid-cols-2 mt-5">
              <StatCell><Stat label="Tempo máximo" value={formatMs(metrics.maxDurationMs)} /></StatCell>
              <StatCell><Stat label="Taxa de sucesso" value={metrics.successRate == null ? '—' : `${metrics.successRate}%`} /></StatCell>
            </StatRow>
          </PanelSection>
          <PanelSection>
            <p className="text-label mb-2">Distribuição de resultados</p>
            {distribution.length === 0 ? (
              <p className="text-sm text-fg-muted">Sem execuções no período.</p>
            ) : (
              <div className="space-y-1.5">
                {distribution.map(d => (
                  <div key={d.status} className="flex items-center gap-2 text-sm">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${DIST_DOT[d.status]}`} />
                    <span className="flex-1 text-fg-muted">{d.label}</span>
                    <span className="tabular-nums text-fg">{d.count} ({d.percent}%)</span>
                  </div>
                ))}
              </div>
            )}
          </PanelSection>
        </Panel>
      </div>
    </div>
  );
}
