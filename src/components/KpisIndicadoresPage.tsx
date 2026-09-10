import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Users, RefreshCw, AlertTriangle, TrendingDown } from 'lucide-react';
import { supabase, type UserProductivityStats } from '../lib/supabase';
import type { GlobalStats } from '../lib/blindAIAgentAlgorithm';
import { Panel, PanelSection, Select } from './ui';
import { resolvePeriodRange, type ReportPeriod } from '../lib/productivityService';
import { getParetoSummary } from '../lib/rcaService';
import { CAUSE_LABEL } from '../lib/rcaAlgorithm';
import {
  groupDailyProduction, averageDailyProduction, pendingRecount, forecastBusinessDays,
  groupOperatorPeriodStats, buildOperationalAlerts, type CountRecordForKpis,
} from '../lib/kpisIndicadores/executiveKpis';

interface KpisIndicadoresPageProps {
  companyId: string;
  globais: GlobalStats;
  operatorStats: UserProductivityStats[];
}

const ACCURACY_TARGET = 95;

const PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'this_month', label: 'Este mês' },
];

function formatRelativeUpdate(atMs: number, nowMs: number): string {
  const minutes = Math.floor((nowMs - atMs) / 60000);
  if (minutes < 1) return 'Atualizado agora mesmo';
  if (minutes === 1) return 'Atualizado há 1 min';
  if (minutes < 60) return `Atualizado há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `Atualizado há ${hours}h`;
}

/**
 * "KPIs e Indicadores" — visão executiva do inventário em andamento. Reutiliza
 * `computeGlobalStats` (globais, já calculado em App.tsx a partir de
 * inventory_brands — fonte oficial de progresso/acuracidade) e
 * `getParetoSummary` (rcaService.ts, já usado em RcaDashboardPage.tsx) como
 * únicas fontes de verdade; a única consulta nova aqui é inventory_count_records
 * por período, para o ritmo diário e o desempenho por operador — mesma tabela
 * já lida em productivityService.ts, só que agregada por dia/operador em vez de
 * por usuário único.
 *
 * Não existe campo de prazo/data-alvo para o inventário no schema atual, então
 * não há "ritmo necessário" nem "atraso" — só o ritmo real e a previsão de
 * dias, como pedido explicitamente quando não há data-alvo.
 */
export function KpisIndicadoresPage({ companyId, globais, operatorStats }: KpisIndicadoresPageProps) {
  const [period, setPeriod] = useState<ReportPeriod>('30d');
  const [operatorId, setOperatorId] = useState<string>('all');
  const [records, setRecords] = useState<CountRecordForKpis[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<number>(Date.now());
  const [nowTick, setNowTick] = useState(Date.now());
  const [paretoRecords, setParetoRecords] = useState<{ category: string; count: number; pctOfTotal: number; cumulativePct: number }[]>([]);

  const { from, to } = useMemo(() => resolvePeriodRange(period), [period]);
  const periodDays = useMemo(() => Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1), [from, to]);

  const selectedOperator = operatorId === 'all' ? null : operatorStats.find(o => o.user_id === operatorId) ?? null;

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      let query = supabase
        .from('inventory_count_records')
        .select('created_at, skus_contados, divergencias_encontradas, divergencias_recontadas, divergencias_reais, accuracy_final, created_by')
        .eq('company_id', companyId)
        .gte('created_at', from)
        .lte('created_at', to);
      if (operatorId !== 'all') query = query.eq('created_by', operatorId);

      const [recordsRes, pareto] = await Promise.all([
        query,
        getParetoSummary(companyId, { from, to, operatorName: selectedOperator?.name ?? undefined }),
      ]);

      if (cancelled) return;
      if (!recordsRes.error) setRecords((recordsRes.data ?? []) as CountRecordForKpis[]);
      setParetoRecords(pareto);
      setLastLoadedAt(Date.now());
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, from, to, operatorId]);

  const dailyProduction = useMemo(() => groupDailyProduction(records, from.slice(0, 10), to.slice(0, 10)), [records, from, to]);
  const ritmoAtual = useMemo(() => averageDailyProduction(dailyProduction), [dailyProduction]);
  const divergenciasPendentes = useMemo(() => pendingRecount(records), [records]);
  const pendentesGlobal = Math.max(0, globais.totalSku - globais.totalDone);
  const previsaoDias = useMemo(() => forecastBusinessDays(pendentesGlobal, ritmoAtual), [pendentesGlobal, ritmoAtual]);

  const nameByUserId = useMemo(() => new Map(operatorStats.map(o => [o.user_id, o.name])), [operatorStats]);
  const operatorPeriodStats = useMemo(() => groupOperatorPeriodStats(records, nameByUserId, periodDays), [records, nameByUserId, periodDays]);

  const alerts = useMemo(() => buildOperationalAlerts({
    ritmoAtual,
    ritmoNecessario: null, // sem data-alvo no schema atual — ver nota acima
    acuracidade: globais.acuracidade,
    metaAcuracidade: ACCURACY_TARGET,
    divergenciasPendentes,
  }), [ritmoAtual, globais.acuracidade, divergenciasPendentes]);

  const maxDaily = Math.max(1, ...dailyProduction.map(p => p.skus));
  const hasEnoughDailyData = dailyProduction.some(p => p.skus > 0);

  const paretoTotal = paretoRecords.reduce((s, b) => s + b.count, 0);
  const maxParetoCount = Math.max(1, ...paretoRecords.map(b => b.count));

  return (
    <div className="max-w-[1600px] mx-auto p-4 md:p-6 lg:p-8 space-y-6">
      {/* Cabeçalho */}
      <div>
        <h1 className="text-title">KPIs e Indicadores</h1>
        <p className="text-sm text-fg-muted mt-1">Visão operacional do inventário</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-2 text-sm text-fg-muted px-3 py-2 rounded-control border border-edge bg-surface-2">
          <CalendarDays size={15} className="text-fg-subtle" />Inventário atual
        </span>

        <Select value={period} onChange={e => setPeriod(e.target.value as ReportPeriod)}>
          {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>

        <Select value={operatorId} onChange={e => setOperatorId(e.target.value)}>
          <option value="all">Todos os operadores</option>
          {operatorStats.filter(o => o.contagens > 0).map(o => (
            <option key={o.user_id} value={o.user_id}>{o.name ?? 'Sem nome'}</option>
          ))}
        </Select>

        <span className="ml-auto flex items-center gap-1.5 text-xs text-fg-subtle">
          {loading ? <RefreshCw size={12} className="animate-spin" /> : null}
          {formatRelativeUpdate(lastLoadedAt, nowTick)}
        </span>
      </div>

      {/* Linha 1 — KPIs executivos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Progresso do Inventário"
          value={`${globais.progresso.toFixed(1)}%`}
          context={`${globais.totalDone.toLocaleString('pt-BR')} de ${globais.totalSku.toLocaleString('pt-BR')} SKUs`}
          trackPct={Math.min(100, globais.progresso)}
        />
        <KpiCard
          title="Ritmo Atual"
          value={<>{ritmoAtual.toFixed(1)}<span className="ml-1 text-sm font-normal text-fg-muted">SKUs/dia</span></>}
          context={`Produtividade média no período (${periodDays} dias)`}
        />
        <KpiCard
          title="Acuracidade"
          value={`${globais.acuracidade.toFixed(1)}%`}
          context={`Meta: ${ACCURACY_TARGET}%`}
          trackPct={Math.min(100, (globais.acuracidade / ACCURACY_TARGET) * 100)}
          targetPct={100}
          critical={globais.acuracidade < ACCURACY_TARGET}
          badge={globais.acuracidade < ACCURACY_TARGET ? 'Abaixo da meta' : undefined}
        />
        <KpiCard
          title="Previsão de Conclusão"
          value={previsaoDias === null ? '—' : <>{previsaoDias}<span className="ml-1 text-sm font-normal text-fg-muted">dias úteis</span></>}
          context={previsaoDias === null ? 'Sem ritmo suficiente no período para estimar' : `${pendentesGlobal.toLocaleString('pt-BR')} SKUs pendentes no ritmo atual`}
        />
      </div>

      {/* Linha 2 — Produção diária + Alertas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <Panel className="lg:col-span-2">
          <PanelSection padding="sm">
            <h3 className="text-title">Produção Diária vs Meta</h3>
          </PanelSection>
          <PanelSection>
            {!hasEnoughDailyData ? (
              <p className="text-sm text-fg-subtle py-10 text-center">Sem contagens suficientes no período selecionado.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex items-end gap-2 h-40 min-w-[480px]">
                  {dailyProduction.map(p => (
                    <div key={p.dateISO} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                      <div className="w-full rounded-t-sm bg-accent" style={{ height: `${(p.skus / maxDaily) * 100}%`, minHeight: p.skus > 0 ? 2 : 0 }} title={`${p.skus} SKUs`} />
                      <span className="text-[10px] text-fg-subtle whitespace-nowrap">{p.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-3 text-xs text-fg-subtle">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-accent inline-block" />Realizado</span>
                  <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-fg-subtle inline-block" />Meta diária ({ritmoAtual.toFixed(0)} SKUs/dia)</span>
                </div>
              </div>
            )}
          </PanelSection>
        </Panel>

        <Panel>
          <PanelSection padding="sm">
            <h3 className="text-title">Alertas Operacionais</h3>
          </PanelSection>
          <PanelSection className="space-y-3">
            {alerts.length === 0 ? (
              <p className="text-sm text-fg-subtle">Nenhum alerta no momento.</p>
            ) : alerts.map(a => (
              <div key={a.id} className={`flex items-start gap-3 pl-3 border-l-2 ${a.severity === 'critical' ? 'border-red-500' : 'border-edge'}`}>
                {a.severity === 'critical'
                  ? <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                  : <TrendingDown size={15} className="text-fg-subtle flex-shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${a.severity === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-fg'}`}>{a.title}</p>
                  <p className="text-xs text-fg-muted mt-0.5">{a.detail}</p>
                </div>
              </div>
            ))}
          </PanelSection>
        </Panel>
      </div>

      {/* Linha 3 — Pareto de divergências + Desempenho por operador */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <Panel>
          <PanelSection padding="sm" className="flex items-center justify-between">
            <h3 className="text-title">Qualidade e Divergências</h3>
            {paretoRecords.length > 0 && (
              <span className="text-xs text-fg-subtle">
                {paretoRecords.slice(0, 2).reduce((s, b) => s + b.pctOfTotal, 0).toFixed(0)}% das divergências vêm de {Math.min(2, paretoRecords.length)} causas
              </span>
            )}
          </PanelSection>
          <PanelSection className="space-y-2.5">
            {paretoRecords.length === 0 ? (
              <p className="text-sm text-fg-subtle py-6 text-center">Nenhuma divergência classificada por causa no período selecionado.</p>
            ) : paretoRecords.map((b, i) => (
              <div key={b.category} className="flex items-center gap-3">
                <span className="w-32 flex-shrink-0 text-xs text-fg-muted truncate">{CAUSE_LABEL[b.category as keyof typeof CAUSE_LABEL] ?? b.category}</span>
                <div className="flex-1 h-3 bg-edge/50 rounded-sm overflow-hidden">
                  <div className={`h-full rounded-sm ${i === 0 ? 'bg-red-500' : 'bg-accent'}`} style={{ width: `${(b.count / maxParetoCount) * 100}%` }} />
                </div>
                <span className="w-6 flex-shrink-0 text-xs font-semibold text-fg text-right">{b.count}</span>
              </div>
            ))}
            {paretoTotal > 0 && <p className="text-xs text-fg-subtle pt-1">{paretoTotal} divergências classificadas no período.</p>}
          </PanelSection>
        </Panel>

        <Panel>
          <PanelSection padding="sm">
            <h3 className="text-title flex items-center gap-2"><Users size={16} className="text-fg-subtle" />Desempenho por Operador</h3>
          </PanelSection>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge">
                  <th className="p-3 text-left font-medium text-fg-subtle text-xs uppercase tracking-wide">Operador</th>
                  <th className="p-3 text-center font-medium text-fg-subtle text-xs uppercase tracking-wide">SKUs</th>
                  <th className="p-3 text-center font-medium text-fg-subtle text-xs uppercase tracking-wide">Ritmo</th>
                  <th className="p-3 text-center font-medium text-fg-subtle text-xs uppercase tracking-wide">Acuracidade</th>
                  <th className="p-3 text-center font-medium text-fg-subtle text-xs uppercase tracking-wide">Divergências</th>
                </tr>
              </thead>
              <tbody>
                {operatorPeriodStats.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-fg-subtle text-sm">Nenhuma contagem no período selecionado.</td></tr>
                ) : operatorPeriodStats.map(op => (
                  <tr key={op.userId} className="border-b border-edge/60 last:border-0 hover:bg-surface-3/40 transition-colors">
                    <td className="p-3 font-medium text-fg">{op.name ?? '—'}</td>
                    <td className="p-3 text-center font-semibold text-fg">{op.skus}</td>
                    <td className="p-3 text-center text-fg-muted">{op.ritmoPerDay.toFixed(1)}/dia</td>
                    <td className="p-3 text-center">
                      <span className={`font-semibold ${op.accuracy === null ? 'text-fg-subtle' : op.accuracy < ACCURACY_TARGET ? 'text-red-600 dark:text-red-400' : 'text-fg'}`}>
                        {op.accuracy !== null ? `${op.accuracy.toFixed(1)}%` : '—'}
                      </span>
                    </td>
                    <td className="p-3 text-center text-fg-muted">{op.divergencias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

interface KpiCardProps {
  title: string;
  value: React.ReactNode;
  context: string;
  trackPct?: number;
  targetPct?: number;
  critical?: boolean;
  badge?: string;
}

/** Card executivo com trilho fino + marca de meta — a única peça visual desta
 *  página sem equivalente em ui/Stat.tsx (que agrupa em painel único, sem
 *  trilho); mantido local a esta página, não promovido a componente
 *  compartilhado por não ter outro consumidor ainda. */
function KpiCard({ title, value, context, trackPct, targetPct, critical, badge }: KpiCardProps) {
  return (
    <Panel>
      <PanelSection padding="md" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-label">{title}</p>
          {badge && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
              <AlertTriangle size={11} />{badge}
            </span>
          )}
        </div>
        <p className={`font-display text-3xl font-semibold tabular-nums tracking-tight ${critical ? 'text-red-600 dark:text-red-400' : 'text-fg'}`}>
          {value}
        </p>
        <p className="text-caption">{context}</p>
        {trackPct !== undefined && (
          <div className="relative h-1 bg-edge rounded-full overflow-hidden mt-1">
            <div className={`h-full rounded-full ${critical ? 'bg-red-500' : 'bg-accent'}`} style={{ width: `${Math.min(100, Math.max(0, trackPct))}%` }} />
            {targetPct !== undefined && (
              <div className="absolute top-1/2 -translate-y-1/2 w-[2px] h-2.5 bg-fg-subtle" style={{ left: `${Math.min(100, targetPct)}%` }} />
            )}
          </div>
        )}
      </PanelSection>
    </Panel>
  );
}

export default KpisIndicadoresPage;
