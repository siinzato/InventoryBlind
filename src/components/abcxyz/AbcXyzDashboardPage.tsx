import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGrid, RefreshCw, ArrowLeftRight, Search, Settings2, ClipboardList } from 'lucide-react';
import {
  Page, PageHeader, Panel, PanelSection, Button, Table, Thead, Tr, Th, Td, Input, Select, Modal,
  Stat, StatRow, StatCell,
} from '../ui';
import {
  getOverview, getMatrixCounts, listByTab, getClassMigrations,
  recomputeAbcXyzForCompany, getLastRecalculatedAt, PERIOD_LABEL, SOURCE_LABEL,
  type AbcXyzTab, type AbcXyzListFilters, type ProductAbcXyzRow, type AbcXyzMigration,
  type AbcXyzPeriod, type AbcXyzOverview,
} from '../../lib/abcXyzService';
import { DEFAULT_XYZ_THRESHOLDS, type XyzThresholds } from '../../lib/abcXyzAlgorithm';
import { ABC_XYZ_STRATEGIES } from '../../lib/abcXyzStrategies';
import { downloadFile } from '../../lib/productImportUtils';
import { ClassificationMatrix } from './ClassificationMatrix';
import { ClassificationBadge } from './ClassificationBadge';
import { AbcXyzDetailDrawer } from './AbcXyzDetailDrawer';
import type { AbcClass, AbcXyzCombo } from '../../lib/supabase';

interface AbcXyzDashboardPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
  onOpenProduct?: () => void;
}

const TABS: { key: AbcXyzTab; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'ax', label: 'AX' },
  { key: 'high_impact', label: 'Alto impacto' },
  { key: 'irregular', label: 'Demanda irregular' },
  { key: 'unclassified', label: 'Sem classificação' },
];

const UNCLASSIFIED_LABEL: Record<string, string> = {
  sem_movimento: 'Sem saídas',
  sem_custo: 'Sem custo',
  fonte_desconectada: 'Fonte desconectada',
  historico_insuficiente: 'Histórico insuficiente',
  sku_nao_associado: 'SKU não associado',
};

export function AbcXyzDashboardPage({ companyId, userId, userEmail, onOpenProduct }: AbcXyzDashboardPageProps) {
  const [period, setPeriod] = useState<AbcXyzPeriod>('12m');
  const [thresholds, setThresholds] = useState<XyzThresholds>(DEFAULT_XYZ_THRESHOLDS);
  const [draftThresholds, setDraftThresholds] = useState<XyzThresholds>(DEFAULT_XYZ_THRESHOLDS);

  const [overview, setOverview] = useState<AbcXyzOverview | null>(null);
  const [matrix, setMatrix] = useState<Record<AbcXyzCombo, { count: number; value: number }> | null>(null);
  const [migrations, setMigrations] = useState<AbcXyzMigration[]>([]);
  const [lastRecalculatedAt, setLastRecalculatedAt] = useState<string | null>(null);
  const [selectedCombo, setSelectedCombo] = useState<AbcXyzCombo | null>(null);

  const [tab, setTab] = useState<AbcXyzTab>('all');
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<AbcClass | 'all'>('all');
  const [coverageFilter, setCoverageFilter] = useState<'all' | 'sem_dados' | 'ok'>('all');
  const [rows, setRows] = useState<ProductAbcXyzRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [detailRow, setDetailRow] = useState<ProductAbcXyzRow | null>(null);

  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeError, setRecomputeError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showActionPlan, setShowActionPlan] = useState(false);

  const loadOverview = useCallback(() => {
    setLoading(true);
    Promise.all([
      getOverview(companyId), getMatrixCounts(companyId), getClassMigrations(companyId, period),
      getLastRecalculatedAt(companyId),
    ]).then(([o, m, mig, last]) => {
      setOverview(o);
      setMatrix(m);
      setMigrations(mig);
      setLastRecalculatedAt(last);
      setLoading(false);
    });
  }, [companyId, period]);

  const filters: AbcXyzListFilters = useMemo(() => ({
    search, classFilter, coverageFilter,
  }), [search, classFilter, coverageFilter]);

  const loadRows = useCallback(() => {
    setRowsLoading(true);
    const activeTab = selectedCombo ? 'all' : tab;
    listByTab(companyId, activeTab, filters).then(r => {
      const visible = selectedCombo ? r.filter(row => row.abc_xyz_class === selectedCombo) : r;
      setRows(visible);
      setRowsLoading(false);
    });
  }, [companyId, tab, filters, selectedCombo]);

  const handleRecompute = useCallback(async (nextPeriod: AbcXyzPeriod = period, nextThresholds: XyzThresholds = thresholds) => {
    if (recomputing) return;
    setRecomputing(true);
    setRecomputeError(null);
    try {
      await recomputeAbcXyzForCompany(companyId, userId, userEmail, nextPeriod, nextThresholds);
    } catch (err) {
      setRecomputeError(err instanceof Error ? err.message : 'Erro ao recalcular a classificação.');
    } finally {
      setRecomputing(false);
    }
  }, [companyId, userId, userEmail, period, thresholds, recomputing]);

  // Primeira carga: só lê o que já existe (nunca recalcula sozinho ao abrir a tela).
  useEffect(loadOverview, [loadOverview]);
  useEffect(loadRows, [loadRows]);

  const handlePeriodChange = async (next: AbcXyzPeriod) => {
    setPeriod(next);
    await handleRecompute(next, thresholds);
    loadOverview();
    loadRows();
  };

  const handleManualRecompute = async () => {
    await handleRecompute(period, thresholds);
    loadOverview();
    loadRows();
  };

  const handleSaveConfig = async () => {
    setThresholds(draftThresholds);
    setShowConfig(false);
    await handleRecompute(period, draftThresholds);
    loadOverview();
    loadRows();
  };

  const strategy = selectedCombo ? ABC_XYZ_STRATEGIES[selectedCombo] : null;
  const selectedCell = selectedCombo && matrix ? matrix[selectedCombo] : null;
  const totalValueMoved = overview?.totalValueMoved ?? 0;

  const actionPlan = useMemo(() => {
    if (!matrix || !overview) return [];
    const items: { label: string; count: number }[] = [];
    if (matrix.AZ.count > 0) items.push({ label: 'Revisar estoque de segurança dos AZ', count: matrix.AZ.count });
    if (overview.classACount > 0) items.push({ label: 'Priorizar contagem dos itens A', count: overview.classACount });
    if (matrix.CX.count > 0) items.push({ label: 'Revisar excesso dos CX', count: matrix.CX.count });
    if (matrix.CZ.count > 0) items.push({ label: 'Avaliar obsolescência dos CZ', count: matrix.CZ.count });
    if (overview.unclassifiedCount > 0) items.push({ label: 'Corrigir dados dos produtos sem classificação', count: overview.unclassifiedCount });
    return items;
  }, [matrix, overview]);

  const handleExportActionPlan = () => {
    const lines = ['Ação;Itens afetados', ...actionPlan.map(a => `${a.label};${a.count}`)];
    downloadFile(lines.join('\n'), `plano-de-acao-abc-xyz-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <Page>
      <PageHeader
        title="Classificação ABC+XYZ"
        description="Segmente o estoque por impacto financeiro e previsibilidade da demanda."
        actions={
          <>
            <Select value={period} onChange={e => handlePeriodChange(e.target.value as AbcXyzPeriod)} className="w-auto" disabled={recomputing}>
              {(Object.keys(PERIOD_LABEL) as AbcXyzPeriod[]).map(p => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
            </Select>
            <Button variant="secondary" onClick={() => { setDraftThresholds(thresholds); setShowConfig(true); }}>
              <Settings2 size={15} /> Configurar análise
            </Button>
            <Button variant="secondary" onClick={handleManualRecompute} disabled={recomputing}>
              <RefreshCw size={15} className={recomputing ? 'animate-spin' : ''} /> {recomputing ? 'Recalculando...' : 'Recalcular'}
            </Button>
            <Button onClick={() => setShowActionPlan(true)} disabled={actionPlan.length === 0}>
              <ClipboardList size={15} /> Gerar plano de ação
            </Button>
          </>
        }
      />
      <p className="text-xs text-fg-subtle -mt-4">
        Fonte: {SOURCE_LABEL.sales_records} · {lastRecalculatedAt ? `Atualizado em ${new Date(lastRecalculatedAt).toLocaleString('pt-BR')}` : 'Ainda não foi calculado'}
      </p>
      {recomputeError && <p className="text-sm text-red-600 dark:text-red-400">{recomputeError}</p>}

      {loading || !matrix || !overview ? (
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando classificação...</PanelSection></Panel>
      ) : (
        <>
          <Panel>
            <PanelSection padding="md">
              <StatRow>
                <StatCell><Stat label="SKUs analisados" value={overview.totalSkus.toLocaleString('pt-BR')} icon={<LayoutGrid />} /></StatCell>
                <StatCell><Stat label="Valor movimentado" value={`R$ ${totalValueMoved.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`} icon={<LayoutGrid />} /></StatCell>
                <StatCell><Stat label="Classe A" value={overview.classACount.toLocaleString('pt-BR')} context={`${overview.classAValuePct}% do valor`} icon={<LayoutGrid />} /></StatCell>
                <StatCell><Stat label="Demanda previsível" value={`${overview.predictablePct}%`} icon={<LayoutGrid />} /></StatCell>
                <StatCell>
                  <Stat
                    label="Dados insuficientes" value={overview.unclassifiedCount.toLocaleString('pt-BR')}
                    valueTone={overview.unclassifiedCount > 0 ? 'critical' : 'default'} icon={<ArrowLeftRight />}
                  />
                </StatCell>
              </StatRow>
            </PanelSection>
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
            <Panel>
              <PanelSection padding="md">
                <p className="text-section mb-3">Matriz ABC × XYZ</p>
                <ClassificationMatrix counts={matrix} selected={selectedCombo} onSelect={setSelectedCombo} />
              </PanelSection>
            </Panel>

            <Panel>
              <PanelSection padding="md">
                <p className="text-section mb-2">Leitura estratégica</p>
                {strategy ? (
                  <>
                    <p className="text-2xl font-semibold text-fg">{selectedCombo}</p>
                    <p className="text-xs text-fg-subtle mb-3">{strategy.title}</p>
                    <p className="text-sm font-medium text-fg">Política recomendada</p>
                    <p className="text-sm text-fg-muted mb-3">{strategy.countingGuidance}</p>
                    <div className="space-y-1.5 text-sm border-t border-edge pt-3">
                      <div className="flex items-center justify-between">
                        <span className="text-fg-muted">Participação no valor</span>
                        <span className="text-fg tabular-nums">{selectedCell && totalValueMoved > 0 ? `${Math.round((selectedCell.value / totalValueMoved) * 1000) / 10}%` : '—'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-fg-muted">SKUs na célula</span>
                        <span className="text-fg tabular-nums">{selectedCell?.count ?? 0}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-fg-subtle">Selecione uma célula da matriz para ver a política recomendada.</p>
                )}
              </PanelSection>
            </Panel>
          </div>

          <Panel>
            <PanelSection padding="md" className="space-y-3">
              <p className="text-section">Produtos classificados</p>

              <div className="flex items-center gap-3 flex-wrap">
                {TABS.map(t => (
                  <button
                    key={t.key}
                    onClick={() => { setSelectedCombo(null); setTab(t.key); }}
                    className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                      !selectedCombo && tab === t.key ? 'text-accent border-accent' : 'text-fg-muted border-transparent hover:text-fg'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Input icon={<Search />} placeholder="Buscar produto ou SKU" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[220px]" />
                <Select value={classFilter} onChange={e => setClassFilter(e.target.value as typeof classFilter)} className="w-auto">
                  <option value="all">Todas as classes</option>
                  <option value="A">Classe A</option>
                  <option value="B">Classe B</option>
                  <option value="C">Classe C</option>
                </Select>
                <Select value="sales_records" disabled className="w-auto">
                  <option value="sales_records">{SOURCE_LABEL.sales_records}</option>
                </Select>
                <Select value={coverageFilter} onChange={e => setCoverageFilter(e.target.value as typeof coverageFilter)} className="w-auto">
                  <option value="all">Toda cobertura</option>
                  <option value="ok">Com dados suficientes</option>
                  <option value="sem_dados">Sem dados</option>
                </Select>
              </div>

              {rowsLoading && <p className="text-sm text-fg-subtle py-6 text-center">Carregando…</p>}
              {!rowsLoading && rows.length === 0 && <p className="text-sm text-fg-subtle py-6 text-center">Nenhum produto para esses filtros.</p>}

              {!rowsLoading && rows.length > 0 && (
                <div className="overflow-x-auto border-t border-edge">
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>Produto / SKU</Th>
                        <Th>Classe</Th>
                        <Th className="text-right">Valor movimentado</Th>
                        <Th className="text-right">Participação</Th>
                        <Th className="text-right">Demanda média</Th>
                        <Th className="text-right">Variabilidade</Th>
                        <Th className="text-right">Cobertura</Th>
                        <Th>Recomendação</Th>
                        <Th>Ação</Th>
                      </Tr>
                    </Thead>
                    <tbody>
                      {rows.map(row => {
                        const strat = row.abc_xyz_class ? ABC_XYZ_STRATEGIES[row.abc_xyz_class] : null;
                        const cv = row.demand_coefficient_variation;
                        const pct = totalValueMoved > 0 ? Math.round((row.value_moved / totalValueMoved) * 1000) / 10 : 0;
                        return (
                          <Tr key={row.id}>
                            <Td>
                              <p className="text-fg line-clamp-2">{row.product_name}</p>
                              <p className="text-xs text-fg-subtle font-mono">{row.product_sku}</p>
                            </Td>
                            <Td><ClassificationBadge combo={row.abc_xyz_class} /></Td>
                            <Td numeric className="tabular-nums">
                              {row.abc_class ? `R$ ${row.value_moved.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}` : (
                                <span className="text-fg-subtle">Sem dados</span>
                              )}
                            </Td>
                            <Td numeric className="text-fg-muted tabular-nums">{row.abc_class ? `${pct}%` : '—'}</Td>
                            <Td numeric className="text-fg-muted tabular-nums">{row.xyz_class ? `${(row.quantity_moved / Math.max(row.weeks_with_data, 1)).toFixed(1)} un./sem.` : '—'}</Td>
                            <Td numeric className="text-fg-muted tabular-nums">{cv != null ? cv.toFixed(2) : '—'}</Td>
                            <Td numeric className="text-fg-muted tabular-nums">{row.weeks_with_data > 0 ? `${row.weeks_with_data - row.weeks_without_sale}/${row.weeks_with_data} sem.` : '—'}</Td>
                            <Td className="text-fg-subtle">
                              {strat ? strat.countingGuidance.split(',')[0] : (
                                <span>{row.unclassified_reason ? UNCLASSIFIED_LABEL[row.unclassified_reason] : '—'}</span>
                              )}
                            </Td>
                            <Td>
                              <button onClick={() => setDetailRow(row)} className="text-sm font-medium text-accent hover:text-accent-strong">Ver</button>
                            </Td>
                          </Tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              )}

              {overview.unclassifiedCount > 0 && tab !== 'unclassified' && !selectedCombo && (
                <p className="text-xs text-fg-subtle pt-2 border-t border-edge">
                  {overview.unclassifiedCount} produto(s) não foram classificados por ausência de dado suficiente ·{' '}
                  <button onClick={() => setTab('unclassified')} className="text-accent hover:text-accent-strong font-medium">Revisar dados</button>
                </p>
              )}
            </PanelSection>
          </Panel>
        </>
      )}

      <Modal open={showConfig} onClose={() => setShowConfig(false)} title="Configurar análise" maxWidth="max-w-md">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-fg mb-1">Fonte de demanda</p>
            <p className="text-sm text-fg-muted">{SOURCE_LABEL.sales_records} — única fonte de vendas configurada para este workspace.</p>
          </div>
          <div>
            <p className="text-sm font-medium text-fg mb-2">Limiares de coeficiente de variação (XYZ)</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-fg-subtle">
                X até
                <Input type="number" step="0.01" min="0" max="1" value={draftThresholds.x}
                  onChange={e => setDraftThresholds(t => ({ ...t, x: Number(e.target.value) }))} />
              </label>
              <label className="text-xs text-fg-subtle">
                Y até
                <Input type="number" step="0.01" min="0" max="1" value={draftThresholds.y}
                  onChange={e => setDraftThresholds(t => ({ ...t, y: Number(e.target.value) }))} />
              </label>
            </div>
            <p className="text-xs text-fg-subtle mt-1">Padrão: X até 0,25 · Y até 0,50 · acima disso é Z.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowConfig(false)}>Cancelar</Button>
            <Button onClick={handleSaveConfig}>Salvar e recalcular</Button>
          </div>
        </div>
      </Modal>

      <Modal open={showActionPlan} onClose={() => setShowActionPlan(false)} title="Plano de ação" maxWidth="max-w-lg">
        <div className="space-y-3">
          {actionPlan.length === 0 ? (
            <p className="text-sm text-fg-subtle">Nenhuma ação recomendada no momento.</p>
          ) : (
            <ul className="space-y-2">
              {actionPlan.map((a, i) => (
                <li key={i} className="flex items-center justify-between text-sm border-b border-edge/60 pb-2 last:border-0">
                  <span className="text-fg">{a.label}</span>
                  <span className="text-fg-subtle tabular-nums">{a.count} item(ns)</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={handleExportActionPlan} disabled={actionPlan.length === 0}>Exportar CSV</Button>
            <Button onClick={() => setShowActionPlan(false)}>Fechar</Button>
          </div>
        </div>
      </Modal>

      <AbcXyzDetailDrawer
        row={detailRow}
        companyId={companyId}
        period={period}
        migrations={migrations}
        onClose={() => setDetailRow(null)}
        onOpenProduct={() => { setDetailRow(null); onOpenProduct?.(); }}
      />
    </Page>
  );
}
