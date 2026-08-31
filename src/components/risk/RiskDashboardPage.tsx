import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertOctagon, Gauge, RefreshCw, ArrowUpRight, ArrowDownRight, ListOrdered, MapPin, Search, ExternalLink } from 'lucide-react';
import {
  Page, PageHeader, Panel, PanelSection, Button, Table, Thead, Tr, Th, Td, Input, Select,
  Stat, StatRow, StatCell,
} from '../ui';
import {
  getCompanyRiskSummary, getRiskBandMigrations, getRiskTrend, listByTab, listLocations, listCauses,
  getRiskClusters, recomputeAllRiskForCompany,
  type RiskTab, type RiskListFilters, type ProductRiskRow, type RiskCompanySummaryRow,
  type RiskBandMigration, type RiskTrendPoint, type RiskCluster,
} from '../../lib/riskService';
import type { RiskBand } from '../../lib/supabase';
import { RiskBadge } from './RiskBadge';
import { RiskDetailDrawer } from './RiskDetailDrawer';

interface RiskDashboardPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
  onNavigateToCount?: () => void;
}

const TABS: { key: RiskTab; label: string }[] = [
  { key: 'priorities', label: 'Prioridades' },
  { key: 'critical', label: 'Críticos' },
  { key: 'high', label: 'Alto risco' },
  { key: 'all', label: 'Todos' },
];

const RISK_OPTIONS: { value: RiskBand | 'insuficiente' | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas as faixas' },
  { value: 'critico', label: 'Crítico' },
  { value: 'alto', label: 'Alto' },
  { value: 'medio', label: 'Moderado' },
  { value: 'baixo', label: 'Baixo' },
  { value: 'insuficiente', label: 'Dados insuficientes' },
];

function Sparkline({ points }: { points: RiskTrendPoint[] }) {
  if (points.length < 2) {
    return <p className="text-xs text-fg-subtle py-6">A evolução aparecerá após os próximos recálculos.</p>;
  }
  const w = 600;
  const h = 80;
  const max = Math.max(...points.map(p => p.avgScore), 100);
  const min = Math.min(...points.map(p => p.avgScore), 0);
  const range = Math.max(1, max - min);
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p.avgScore - min) / range) * h;
    return { x, y, point: p };
  });

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
      <polyline points={coords.map(c => `${c.x},${c.y}`).join(' ')} fill="none" className="stroke-fg-muted" strokeWidth="2" />
      {coords.filter(c => c.point.criticalCount > 0).map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={3} className="fill-red-500" />
      ))}
    </svg>
  );
}

export function RiskDashboardPage({ companyId, userId, userEmail, onNavigateToCount }: RiskDashboardPageProps) {
  const [summary, setSummary] = useState<RiskCompanySummaryRow | null>(null);
  const [migrations, setMigrations] = useState<RiskBandMigration[]>([]);
  const [trend, setTrend] = useState<RiskTrendPoint[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [causes, setCauses] = useState<string[]>([]);
  const [clusters, setClusters] = useState<RiskCluster[]>([]);

  const [tab, setTab] = useState<RiskTab>('priorities');
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskBand | 'insuficiente' | 'all'>('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [causeFilter, setCauseFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [showClusters, setShowClusters] = useState(false);

  const [rows, setRows] = useState<ProductRiskRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<ProductRiskRow | null>(null);
  const [routeSelection, setRouteSelection] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMessage, setRecomputeMessage] = useState<string | null>(null);

  const loadOverview = useCallback(() => {
    setLoading(true);
    Promise.all([
      getCompanyRiskSummary(companyId),
      getRiskBandMigrations(companyId),
      getRiskTrend(companyId),
      listLocations(companyId),
      listCauses(companyId),
      getRiskClusters(companyId),
    ]).then(([s, m, t, locs, cs, cl]) => {
      setSummary(s);
      setMigrations(m);
      setTrend(t);
      setLocations(locs);
      setCauses(cs);
      setClusters(cl);
      setLoading(false);
    });
  }, [companyId]);

  useEffect(loadOverview, [loadOverview]);

  const filters: RiskListFilters = useMemo(() => ({
    search, riskLevel: riskFilter, location: locationFilter, cause: causeFilter,
  }), [search, riskFilter, locationFilter, causeFilter]);

  const loadRows = useCallback(() => {
    setRowsLoading(true);
    setRowsError(null);
    listByTab(companyId, tab, filters, page)
      .then(({ rows: r, totalCount: total }) => {
        setRows(r);
        setTotalCount(total);
        setRowsLoading(false);
      })
      .catch(err => {
        setRowsError(err instanceof Error ? err.message : 'Erro ao carregar o Inventário por Risco.');
        setRowsLoading(false);
      });
  }, [companyId, tab, filters, page]);

  useEffect(() => { if (!showClusters) loadRows(); }, [loadRows, showClusters]);
  useEffect(() => { setPage(1); }, [tab, search, riskFilter, locationFilter, causeFilter]);

  const handleRecomputeAll = async () => {
    if (recomputing) return;
    setRecomputing(true);
    setRecomputeMessage(null);
    try {
      const { updated, insufficient } = await recomputeAllRiskForCompany(companyId, userId, userEmail);
      setRecomputeMessage(`${updated} SKU-locais recalculados · ${insufficient} sem dados suficientes.`);
      loadOverview();
      if (!showClusters) loadRows();
    } catch (err) {
      setRecomputeMessage(err instanceof Error ? err.message : 'Erro ao recalcular riscos.');
    } finally {
      setRecomputing(false);
    }
  };

  const toggleRoute = (productId: string) => {
    setRouteSelection(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      return next;
    });
  };

  const worsened = migrations.filter(m => m.direction === 'up').length;
  const improved = migrations.filter(m => m.direction === 'down').length;
  const totalPages = Math.max(1, Math.ceil(totalCount / 50));
  const topCluster = clusters[0] ?? null;

  const cards = summary ? [
    { label: 'Risco médio', value: summary.avg_risk != null ? Math.round(summary.avg_risk) : '—', icon: <Gauge />, context: 'de 0–100' },
    { label: 'SKU-locais avaliados', value: summary.total_scored.toLocaleString('pt-BR'), icon: <ListOrdered /> },
    {
      label: 'Críticos', value: summary.critico_count, icon: <AlertOctagon />,
      valueTone: summary.critico_count > 0 ? 'critical' as const : 'default' as const,
      context: summary.total_scored ? `de ${summary.total_scored} (${Math.round((summary.critico_count / summary.total_scored) * 1000) / 10}%)` : undefined,
    },
    {
      label: 'Alto risco', value: summary.alto_count, icon: <AlertOctagon />,
      context: summary.total_scored ? `de ${summary.total_scored} (${Math.round((summary.alto_count / summary.total_scored) * 1000) / 10}%)` : undefined,
    },
  ] : [];

  return (
    <Page>
      <PageHeader
        title="Inventário por Risco"
        description="Identifique onde falhas de estoque podem gerar maior impacto e organize inspeções por localização."
        actions={
          <>
            <Button variant="secondary" onClick={handleRecomputeAll} disabled={recomputing}>
              <RefreshCw size={15} className={recomputing ? 'animate-spin' : ''} /> {recomputing ? 'Recalculando...' : 'Recalcular riscos'}
            </Button>
            <Button onClick={() => setShowClusters(true)} disabled={clusters.length === 0}>
              Planejar inspeção{routeSelection.size > 0 ? ` (${routeSelection.size})` : ''}
            </Button>
          </>
        }
      />
      {recomputeMessage && <p className="text-sm text-fg-muted">{recomputeMessage}</p>}

      {loading ? (
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando Inventário por Risco...</PanelSection></Panel>
      ) : (
        <>
          <Panel>
            <PanelSection padding="md">
              <StatRow>
                {cards.map(card => (
                  <StatCell key={card.label}>
                    <Stat {...card} />
                  </StatCell>
                ))}
              </StatRow>
            </PanelSection>
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
            <Panel>
              <PanelSection padding="md">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-section">Evolução do risco</p>
                  <div className="flex items-center gap-3 text-xs text-fg-subtle">
                    <span className="flex items-center gap-1 text-red-600 dark:text-red-400"><ArrowUpRight size={12} /> {worsened} pioraram de faixa</span>
                    <span className="flex items-center gap-1"><ArrowDownRight size={12} /> {improved} melhoraram de faixa</span>
                  </div>
                </div>
                <Sparkline points={trend} />
              </PanelSection>
            </Panel>

            <Panel>
              <PanelSection padding="md">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-section">Composição do risco</p>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-fg-muted">Probabilidade</span>
                      <span className="text-fg tabular-nums">{summary?.avg_risk != null ? Math.round(summary.avg_risk) : '—'}/100</span>
                    </div>
                    <p className="text-xs text-fg-subtle mb-1">Chance de ocorrência de uma falha de estoque.</p>
                    <div className="h-1.5 w-full rounded-full bg-surface-3 overflow-hidden">
                      <div className="h-full rounded-full bg-fg-muted" style={{ width: `${summary?.avg_risk ?? 0}%` }} />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-fg-subtle mt-3 pt-3 border-t border-edge">
                  Risco intrínseco = Probabilidade × Impacto / 100. A proximidade física é usada só para agrupar itens em rotas de inspeção — nunca para reduzir o risco.
                </p>
              </PanelSection>
            </Panel>
          </div>

          {topCluster && (
            <Panel>
              <PanelSection padding="sm" className="flex items-center justify-between gap-3">
                <p className="text-sm text-fg-muted">
                  <MapPin size={13} className="inline mr-1 -mt-0.5" />
                  Existem {topCluster.items.length} itens de risco no corredor {topCluster.corridor}. Inclua-os na mesma inspeção para reduzir deslocamento.
                </p>
                <button onClick={() => setShowClusters(true)} className="text-sm font-medium text-accent hover:text-accent-strong whitespace-nowrap">
                  Ver clusters
                </button>
              </PanelSection>
            </Panel>
          )}

          <Panel>
            <PanelSection padding="md" className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-section">Prioridades de risco</p>
                {showClusters && (
                  <button onClick={() => setShowClusters(false)} className="text-sm font-medium text-accent hover:text-accent-strong">
                    Voltar à lista
                  </button>
                )}
              </div>

              {!showClusters && (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    {TABS.map(t => (
                      <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                          tab === t.key ? 'text-accent border-accent' : 'text-fg-muted border-transparent hover:text-fg'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                    <button
                      onClick={() => setShowClusters(true)}
                      className="pb-2 text-sm font-medium border-b-2 border-transparent text-fg-muted hover:text-fg transition-colors"
                    >
                      Clusters
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Input icon={<Search />} placeholder="Buscar produto, SKU ou localização" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[220px]" />
                    <Select value={causeFilter} onChange={e => setCauseFilter(e.target.value)} className="w-auto">
                      <option value="all">Todas as causas</option>
                      {causes.map(c => <option key={c} value={c}>{c}</option>)}
                    </Select>
                    <Select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} className="w-auto">
                      <option value="all">Todos os locais</option>
                      {locations.map(l => <option key={l} value={l}>{l}</option>)}
                    </Select>
                    <Select value={riskFilter} onChange={e => setRiskFilter(e.target.value as typeof riskFilter)} className="w-auto">
                      {RISK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </div>

                  {rowsLoading && <p className="text-sm text-fg-subtle py-6 text-center">Carregando…</p>}
                  {rowsError && <p className="text-sm text-red-600 dark:text-red-400 py-6 text-center">{rowsError}</p>}

                  {!rowsLoading && !rowsError && rows.length === 0 && (
                    <div className="text-center py-8 space-y-2">
                      <p className="text-sm text-fg-subtle">
                        {(tab === 'critical' || tab === 'high')
                          ? 'Nenhum SKU-local nessa faixa de risco no momento.'
                          : 'Nenhum SKU-local para esses filtros.'}
                      </p>
                      {(tab === 'critical' || tab === 'high') && (
                        <button onClick={() => setTab('all')} className="text-sm font-medium text-accent hover:text-accent-strong">
                          Ver riscos moderados e baixos
                        </button>
                      )}
                    </div>
                  )}

                  {!rowsLoading && !rowsError && rows.length > 0 && (
                    <div className="overflow-x-auto border-t border-edge">
                      <Table>
                        <Thead>
                          <Tr>
                            <Th>Produto / SKU</Th>
                            <Th>Localização</Th>
                            <Th className="text-right">Risco</Th>
                            <Th className="text-right">Probabilidade</Th>
                            <Th className="text-right">Impacto</Th>
                            <Th>Causa dominante</Th>
                            <Th>Último evento</Th>
                            <Th>Ação</Th>
                          </Tr>
                        </Thead>
                        <tbody>
                          {rows.map(row => (
                            <Tr key={row.id}>
                              <Td>
                                <p className="text-fg line-clamp-2">{row.product_name}</p>
                                <p className="text-xs text-fg-subtle font-mono">{row.product_sku}</p>
                              </Td>
                              <Td className="text-fg-subtle whitespace-nowrap">{row.product_location ?? '—'}</Td>
                              <Td numeric>
                                <RiskBadge riskLevel={row.risk_level} score={row.risk_score} />
                              </Td>
                              <Td numeric className="text-fg-muted tabular-nums">{row.probability != null ? row.probability : '—'}</Td>
                              <Td numeric className="text-fg-muted tabular-nums">{row.impact != null ? row.impact : '—'}</Td>
                              <Td className={row.risk_level === 'critico' ? 'text-red-600 dark:text-red-400' : 'text-fg-subtle'}>{row.risk_reason}</Td>
                              <Td className="text-xs text-fg-subtle whitespace-nowrap">{new Date(row.last_risk_update).toLocaleDateString('pt-BR')}</Td>
                              <Td className="whitespace-nowrap">
                                <button onClick={() => setDetailRow(row)} className="text-sm font-medium text-accent hover:text-accent-strong">Inspecionar</button>
                              </Td>
                            </Tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  )}

                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                      <p className="text-xs text-fg-subtle">Página {page} de {totalPages} · {totalCount.toLocaleString('pt-BR')} SKU-locais</p>
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Anterior</Button>
                        <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Próxima</Button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {showClusters && (
                <div className="space-y-4">
                  <p className="text-xs text-fg-subtle">
                    Agrupamento por corredor entre itens de risco crítico e alto — a proximidade física não altera o Risk Score individual, só decide como agrupar a inspeção.
                  </p>
                  {clusters.length === 0 && <p className="text-sm text-fg-subtle py-6 text-center">Nenhum cluster de risco identificado no momento.</p>}
                  {clusters.map(cluster => (
                    <div key={cluster.corridor} className="border border-edge rounded-md">
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-edge bg-surface-2">
                        <p className="text-sm font-medium text-fg flex items-center gap-1.5"><MapPin size={13} /> Corredor {cluster.corridor} · {cluster.items.length} itens</p>
                        <button
                          onClick={() => setRouteSelection(prev => {
                            const next = new Set(prev);
                            cluster.items.forEach(i => next.add(i.product_id));
                            return next;
                          })}
                          className="text-sm font-medium text-accent hover:text-accent-strong"
                        >
                          Adicionar todos à rota
                        </button>
                      </div>
                      <div className="divide-y divide-edge/60">
                        {cluster.items.map(item => (
                          <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <label className="flex items-center gap-2.5 min-w-0 cursor-pointer">
                              <input type="checkbox" checked={routeSelection.has(item.product_id)} onChange={() => toggleRoute(item.product_id)} />
                              <div className="min-w-0">
                                <p className="text-sm text-fg truncate">{item.product_name}</p>
                                <p className="text-xs text-fg-subtle">{item.product_sku} · {item.product_location}</p>
                              </div>
                            </label>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <RiskBadge riskLevel={item.risk_level} score={item.risk_score} />
                              <button onClick={() => setDetailRow(item)} className="text-fg-subtle hover:text-fg">
                                <ExternalLink size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {routeSelection.size > 0 && (
                    <div className="flex items-center justify-between pt-2 border-t border-edge">
                      <p className="text-sm text-fg-muted">{routeSelection.size} item(ns) selecionado(s) para a inspeção</p>
                      <Button onClick={() => onNavigateToCount?.()}>Iniciar contagem da rota</Button>
                    </div>
                  )}
                </div>
              )}
            </PanelSection>
          </Panel>
        </>
      )}

      <RiskDetailDrawer
        row={detailRow}
        companyId={companyId}
        onClose={() => setDetailRow(null)}
        onStartCount={() => { setDetailRow(null); onNavigateToCount?.(); }}
        onAddToRoute={toggleRoute}
        isInRoute={detailRow ? routeSelection.has(detailRow.product_id) : false}
      />
    </Page>
  );
}
