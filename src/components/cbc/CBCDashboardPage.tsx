import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, ArrowUpRight, ArrowDownRight, CalendarClock } from 'lucide-react';
import {
  Page, PageHeader, Panel, PanelSection, Button, Table, Thead, Tr, Th, Td, Input, Select,
  Stat, StatRow, StatCell,
} from '../ui';
import {
  getCompanySummary, getBandMigrations, getScoreTrend, listByTab, listLocations, scheduleCount,
  recomputeAllForCompany, getLastRecalculatedAt,
  type CBCTab, type CBCListFilters, type ProductConfidenceRow, type CBCCompanySummaryRow, type BandMigration, type ScoreTrendPoint,
} from '../../lib/cbcService';
import { RISK_LEVEL_LABEL } from '../../lib/cbcAlgorithm';
import { downloadFile } from '../../lib/productImportUtils';
import { ConfidenceDetailDrawer } from './ConfidenceDetailDrawer';
import type { RiskLevel } from '../../lib/supabase';

interface CBCDashboardPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
  onNavigateToCount?: () => void;
}

const TABS: { key: CBCTab; label: string }[] = [
  { key: 'priorities', label: 'Prioridades' },
  { key: 'critical', label: 'Críticos' },
  { key: 'overdue', label: 'Vencidas' },
  { key: 'scheduled', label: 'Programadas' },
  { key: 'all', label: 'Todos' },
];

const RISK_OPTIONS: { value: RiskLevel | 'insuficiente' | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas as faixas' },
  { value: 'critico', label: 'Crítica' },
  { value: 'medio', label: 'Atenção' },
  { value: 'bom', label: 'Estável' },
  { value: 'excelente', label: 'Alta' },
  { value: 'insuficiente', label: 'Sem dados suficientes' },
];

const MOTIVE_OPTIONS = [
  { value: 'all', label: 'Todos os motivos' },
  { value: 'vencida', label: 'Vencida' },
  { value: 'divergência', label: 'Divergências recentes' },
  { value: 'movimentação', label: 'Alta movimentação' },
  { value: 'nunca contado', label: 'Nunca contado' },
  { value: 'consistente', label: 'Saldo consistente' },
];

function Sparkline({ points }: { points: ScoreTrendPoint[] }) {
  if (points.length < 2) {
    return <p className="text-xs text-fg-subtle py-6">O histórico será exibido após novas recalculações.</p>;
  }
  const w = 600;
  const h = 90;
  const max = Math.max(...points.map(p => p.avgScore), 100);
  const min = Math.min(...points.map(p => p.avgScore), 0);
  const range = Math.max(1, max - min);
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p.avgScore - min) / range) * h;
    return { x, y, score: p.avgScore, date: p.date };
  });

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24" preserveAspectRatio="none">
        <polyline points={coords.map(c => `${c.x},${c.y}`).join(' ')} fill="none" className="stroke-accent" strokeWidth="2" />
      </svg>
      <div className="flex justify-between text-xs text-fg-subtle mt-1">
        {coords.map((c, i) => (
          <span key={i} className="tabular-nums">
            {i === 0 || i === coords.length - 1 || i % Math.ceil(coords.length / 5) === 0
              ? `${new Date(c.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
              : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CBCDashboardPage({ companyId, userId, userEmail, onNavigateToCount }: CBCDashboardPageProps) {
  const [summary, setSummary] = useState<CBCCompanySummaryRow | null>(null);
  const [migrations, setMigrations] = useState<BandMigration[]>([]);
  const [trend, setTrend] = useState<ScoreTrendPoint[]>([]);
  const [lastRecalculatedAt, setLastRecalculatedAt] = useState<string | null>(null);
  const [locations, setLocations] = useState<string[]>([]);

  const [tab, setTab] = useState<CBCTab>('priorities');
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskLevel | 'insuficiente' | 'all'>('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [motiveFilter, setMotiveFilter] = useState('all');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<ProductConfidenceRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailRow, setDetailRow] = useState<ProductConfidenceRow | null>(null);

  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMessage, setRecomputeMessage] = useState<string | null>(null);

  const loadOverview = useCallback(() => {
    Promise.all([
      getCompanySummary(companyId),
      getBandMigrations(companyId),
      getScoreTrend(companyId),
      getLastRecalculatedAt(companyId),
      listLocations(companyId),
    ]).then(([s, m, t, last, locs]) => {
      setSummary(s);
      setMigrations(m);
      setTrend(t);
      setLastRecalculatedAt(last);
      setLocations(locs);
    });
  }, [companyId]);

  useEffect(loadOverview, [loadOverview]);

  const filters: CBCListFilters = useMemo(() => ({
    search, riskLevel: riskFilter, location: locationFilter,
  }), [search, riskFilter, locationFilter]);

  const loadRows = useCallback(() => {
    setRowsLoading(true);
    listByTab(companyId, tab, filters, page).then(({ rows: r, totalCount: total }) => {
      const visible = motiveFilter === 'all' ? r : r.filter(row => (row.why_to_count ?? '').toLowerCase().includes(motiveFilter));
      setRows(visible);
      setTotalCount(total);
      setRowsLoading(false);
    });
  }, [companyId, tab, filters, page, motiveFilter]);

  useEffect(loadRows, [loadRows]);
  useEffect(() => { setPage(1); setSelected(new Set()); }, [tab, search, riskFilter, locationFilter, motiveFilter]);

  const handleRecomputeAll = async () => {
    if (recomputing) return;
    setRecomputing(true);
    setRecomputeMessage(null);
    try {
      const { updated, insufficient } = await recomputeAllForCompany(companyId, userId, userEmail);
      setRecomputeMessage(`${updated} SKU-locais atualizados · ${insufficient} sem dados suficientes.`);
      loadOverview();
      loadRows();
    } catch (err) {
      setRecomputeMessage(err instanceof Error ? err.message : 'Erro ao recalcular scores.');
    } finally {
      setRecomputing(false);
    }
  };

  const toggleSelected = (productId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected(prev => prev.size === rows.length ? new Set() : new Set(rows.map(r => r.product_id)));
  };

  const handleBulkSchedule = async () => {
    await Promise.all(Array.from(selected).map(productId => scheduleCount(productId, companyId, userId, true)));
    setSelected(new Set());
    loadRows();
    loadOverview();
  };

  const handleExport = () => {
    const source = selected.size > 0 ? rows.filter(r => selected.has(r.product_id)) : rows;
    const lines = ['Produto;SKU;Localização;Confiança;Prioridade;Por que contar;Última contagem;Próxima ação'];
    for (const r of source) {
      lines.push([
        r.product_name, r.product_sku, r.product_location ?? '—',
        r.confidence_score != null ? `${r.confidence_score}` : 'Sem dados',
        r.priority_score != null ? `${r.priority_score}` : '—',
        r.why_to_count ?? '—',
        r.next_count_date,
        r.next_count_date < new Date().toISOString().slice(0, 10) ? 'Iniciar contagem' : 'Programar',
      ].map(v => String(v).includes(';') ? `"${v}"` : v).join(';'));
    }
    downloadFile(lines.join('\n'), `contagem-por-confianca-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const migratedUp = migrations.filter(m => m.direction === 'up').length;
  const migratedDown = migrations.filter(m => m.direction === 'down').length;
  const totalPages = Math.max(1, Math.ceil(totalCount / 50));

  const coveragePct = summary && summary.total_scored > 0
    ? Math.round(((summary.total_scored - summary.insufficient_count) / summary.total_scored) * 1000) / 10
    : null;

  return (
    <Page>
      <PageHeader
        title="Contagem por Confiança (CBC)"
        description="Priorize contagens por SKU e localização com base na confiabilidade real do saldo."
        actions={
          <>
            <Button variant="secondary" onClick={handleRecomputeAll} disabled={recomputing}>
              <RefreshCw size={15} className={recomputing ? 'animate-spin' : ''} /> {recomputing ? 'Recalculando...' : 'Recalcular scores'}
            </Button>
            <Button onClick={handleBulkSchedule} disabled={selected.size === 0}>
              Programar contagens{selected.size > 0 ? ` (${selected.size})` : ''}
            </Button>
          </>
        }
      />
      <div className="flex items-center justify-end gap-2 text-xs text-fg-subtle -mt-4">
        <CalendarClock size={13} />
        {lastRecalculatedAt ? `Último cálculo ${new Date(lastRecalculatedAt).toLocaleString('pt-BR')}` : 'Ainda não foi calculado'}
      </div>
      {recomputeMessage && (
        <p className="text-sm text-fg-muted">{recomputeMessage}</p>
      )}

      <Panel>
        <PanelSection padding="md">
          <StatRow>
            <StatCell>
              <Stat
                label="Confiança média" icon={<RefreshCw />}
                value={summary?.avg_confidence != null ? Math.round(summary.avg_confidence) : '—'}
              />
            </StatCell>
            <StatCell>
              <Stat
                label="SKU-locais avaliados"
                value={summary ? summary.total_scored.toLocaleString('pt-BR') : '—'}
                context={summary ? `${summary.distinct_locations} local(is)` : undefined}
              />
            </StatCell>
            <StatCell>
              <Stat
                label="Contagens vencidas" value={summary?.overdue_count ?? '—'}
                valueTone={summary && summary.overdue_count > 0 ? 'critical' : 'default'}
                context="Exigem ação"
              />
            </StatCell>
            <StatCell>
              <Stat label="Programadas" value={summary?.scheduled_this_week_count ?? '—'} />
            </StatCell>
          </StatRow>
        </PanelSection>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
        <Panel>
          <PanelSection padding="md">
            <div className="flex items-center justify-between mb-2">
              <p className="text-section">Evolução da confiança</p>
              <div className="flex items-center gap-3 text-xs text-fg-subtle">
                <span className="flex items-center gap-1"><ArrowUpRight size={12} /> {migratedUp} subiram de faixa</span>
                <span className="flex items-center gap-1 text-red-500"><ArrowDownRight size={12} /> {migratedDown} caíram de faixa</span>
              </div>
            </div>
            <p className="text-xs text-fg-subtle mb-2">Média ponderada dos SKU-locais nos últimos 30 dias</p>
            <Sparkline points={trend} />
          </PanelSection>
        </Panel>

        <Panel>
          <PanelSection padding="md">
            <p className="text-section mb-2">Modelo e cobertura</p>
            <p className="text-2xl font-semibold text-fg tabular-nums">{coveragePct != null ? `${coveragePct}%` : '—'}</p>
            <p className="text-xs text-fg-subtle mb-3">dos SKU-locais com dados suficientes</p>
            <div className="h-1.5 w-full rounded-full bg-surface-3 overflow-hidden mb-3">
              <div className="h-full rounded-full bg-accent" style={{ width: `${coveragePct ?? 0}%` }} />
            </div>
            <div className="space-y-1.5 text-sm">
              {['Histórico de acuracidade', 'Recência da última contagem', 'Estabilidade operacional', 'Integridade dos dados'].map(f => (
                <div key={f} className="flex items-center justify-between">
                  <span className="text-fg-muted">{f}</span>
                  <span className="text-xs text-fg-subtle flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" /> Ativo
                  </span>
                </div>
              ))}
            </div>
            {summary && summary.insufficient_count > 0 && (
              <p className="text-xs text-fg-subtle mt-3">{summary.insufficient_count} pares sem dados suficientes</p>
            )}
          </PanelSection>
        </Panel>
      </div>

      <Panel>
        <PanelSection padding="md" className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-section">Prioridades de contagem</p>
              <p className="text-xs text-fg-subtle">Ordenadas por urgência operacional, não apenas pelo score</p>
            </div>
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-fg-subtle">{selected.size} selecionado(s)</span>
                <Button size="sm" onClick={handleBulkSchedule}>Programar contagem</Button>
                <Button size="sm" variant="secondary" onClick={handleExport}>Exportar</Button>
              </div>
            )}
          </div>

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
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Input icon={<Search />} placeholder="Buscar SKU, produto ou localização" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[220px]" />
            <Select value={riskFilter} onChange={e => setRiskFilter(e.target.value as typeof riskFilter)} className="w-auto">
              {RISK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} className="w-auto">
              <option value="all">Todos os locais</option>
              {locations.map(l => <option key={l} value={l}>{l}</option>)}
            </Select>
            <Select value={motiveFilter} onChange={e => setMotiveFilter(e.target.value)} className="w-auto">
              {MOTIVE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            {selected.size === 0 && (
              <Button size="sm" variant="ghost" onClick={handleExport}>Exportar</Button>
            )}
          </div>

          {rowsLoading && <p className="text-sm text-fg-subtle py-6 text-center">Carregando…</p>}
          {!rowsLoading && rows.length === 0 && <p className="text-sm text-fg-subtle py-6 text-center">Nenhum SKU-local para esses filtros.</p>}

          {!rowsLoading && rows.length > 0 && (
            <div className="overflow-x-auto border-t border-edge">
              <Table>
                <Thead>
                  <Tr>
                    <Th><input type="checkbox" checked={selected.size === rows.length} onChange={toggleSelectAll} /></Th>
                    <Th>Produto / SKU</Th>
                    <Th>Localização</Th>
                    <Th>Confiança</Th>
                    <Th className="text-right">Prioridade</Th>
                    <Th>Por que contar</Th>
                    <Th>Última contagem</Th>
                    <Th>Próxima ação</Th>
                    <Th></Th>
                  </Tr>
                </Thead>
                <tbody>
                  {rows.map(r => {
                    const overdue = r.next_count_date < new Date().toISOString().slice(0, 10);
                    return (
                      <Tr key={r.id}>
                        <Td><input type="checkbox" checked={selected.has(r.product_id)} onChange={() => toggleSelected(r.product_id)} /></Td>
                        <Td>
                          <p className="text-fg line-clamp-2">{r.product_name}</p>
                          <p className="text-xs text-fg-subtle font-mono">{r.product_sku}</p>
                        </Td>
                        <Td className="text-fg-subtle whitespace-nowrap">{r.product_location ?? '—'}</Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <span className={`tabular-nums text-sm ${r.risk_level === 'critico' ? 'text-red-600 dark:text-red-400 font-medium' : 'text-fg-muted'}`}>
                              {r.confidence_score != null ? `${r.confidence_score}/100` : '—'}
                            </span>
                            {r.confidence_score != null && (
                              <span className="h-1 w-14 rounded-full bg-surface-3 overflow-hidden">
                                <span className={`block h-full rounded-full ${r.risk_level === 'critico' ? 'bg-red-500' : 'bg-accent'}`} style={{ width: `${r.confidence_score}%` }} />
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-fg-subtle">{r.risk_level ? RISK_LEVEL_LABEL[r.risk_level] : 'Sem dados'}</p>
                        </Td>
                        <Td numeric className="text-fg-muted">{r.priority_score != null ? `${r.priority_score}/100` : '—'}</Td>
                        <Td className={r.risk_level === 'critico' ? 'text-red-600 dark:text-red-400' : 'text-fg-subtle'}>{r.why_to_count ?? '—'}</Td>
                        <Td className="text-xs text-fg-subtle whitespace-nowrap">{new Date(r.next_count_date).toLocaleDateString('pt-BR')}</Td>
                        <Td className="whitespace-nowrap">
                          {overdue || r.risk_level === 'critico' ? (
                            <button onClick={() => onNavigateToCount?.()} className="text-sm font-medium text-accent hover:text-accent-strong">Iniciar contagem</button>
                          ) : !r.is_manually_scheduled ? (
                            <button onClick={() => scheduleCount(r.product_id, companyId, userId, true).then(loadRows)} className="text-sm font-medium text-accent hover:text-accent-strong">Programar</button>
                          ) : (
                            <button onClick={() => setDetailRow(r)} className="text-sm font-medium text-accent hover:text-accent-strong">Ver detalhe</button>
                          )}
                        </Td>
                        <Td>
                          <button onClick={() => setDetailRow(r)} className="text-fg-subtle hover:text-fg text-xs">•••</button>
                        </Td>
                      </Tr>
                    );
                  })}
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
        </PanelSection>
      </Panel>

      <ConfidenceDetailDrawer
        row={detailRow}
        companyId={companyId}
        userId={userId}
        onClose={() => setDetailRow(null)}
        onStartCount={() => { setDetailRow(null); onNavigateToCount?.(); }}
        onScheduled={() => { loadRows(); loadOverview(); setDetailRow(null); }}
      />
    </Page>
  );
}
