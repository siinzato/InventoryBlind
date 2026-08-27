// Curva ABC — página de Produtos. Reaproveita os tokens/componentes de ProductBrandsPage
// (mesma família de telas dentro de Produtos): Page/PageHeader/Panel/PanelSection/Table/
// Stat/SegmentedControl/Badge/Button/Select. Nenhum visual novo, nenhuma escrita no Inventário.

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import {
  Page, PageHeader, Panel, PanelSection, Badge, Button, Select,
  Table, Thead, Tr, Th, Td, SegmentedControl, Stat, StatRow, StatCell,
} from '../ui';
import { useAuth } from '../../lib/auth';
import { hasPermission } from '../../lib/permissionService';
import {
  listAnalyses, listSkuSnapshots, listRecommendations, listImportBatches,
  type AbcCurveAnalysis, type SkuSnapshotRow, type AbcCurveImportBatch,
} from '../../lib/abcCurve/abcCurveService';
import { AbcCurveImportWizard } from './AbcCurveImportWizard';

interface AbcCurvePageProps {
  companyId: string;
}

type Tab = 'overview' | 'products' | 'matrix' | 'sources';
type ProductsView = 'summary' | 'commercial' | 'profitability' | 'classification';

type Snapshot = SkuSnapshotRow & { id: string };

interface ProductColumn {
  key: string;
  header: string;
  numeric?: boolean;
  render: (s: Snapshot) => ReactNode;
}

const COST_STATE_LABEL: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  NORMAL: { label: 'OK', variant: 'success' },
  SEM_CUSTO: { label: 'Sem custo', variant: 'warning' },
  PREJUIZO: { label: 'Prejuízo', variant: 'danger' },
};

const RECOMMENDATION_LABEL: Record<string, string> = {
  COMPRA_URGENTE: 'Compra urgente',
  PROTEGER_DISPONIBILIDADE: 'Proteger disponibilidade',
  PROMOVER: 'Promover',
  REVISAR_PRECO_CUSTO: 'Revisar preço/custo',
  RENEGOCIAR_CUSTO_OU_PRECO: 'Renegociar custo/preço',
  REDUZIR_COMPRA_OU_LIQUIDAR: 'Reduzir compra/liquidar',
  ESTOQUE_PARADO: 'Estoque parado',
  CORRIGIR_CUSTO: 'Corrigir custo',
  PREJUIZO: 'Prejuízo',
};

const classBadgeVariant = (cls: string | null): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (cls === 'A') return 'success';
  if (cls === 'B') return 'warning';
  if (cls === 'C') return 'danger';
  return 'neutral';
};

const fmtMoney = (value: number | null) => value === null ? '—' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
const fmtMultiplier = (value: number | null) => value === null ? '—' : `${value.toFixed(2)}x`;
const fmtQty = (value: number | null) => value === null ? '—' : value.toLocaleString('pt-BR');
const fmtCoverage = (value: number | null) => value === null ? '—' : `${value.toFixed(0)}d`;
const costState = (s: Snapshot) => COST_STATE_LABEL[s.cost_state] ?? COST_STATE_LABEL.NORMAL;

const PRODUCT_VIEW_OPTIONS: { value: ProductsView; label: string }[] = [
  { value: 'summary', label: 'Resumo' },
  { value: 'commercial', label: 'Comercial' },
  { value: 'profitability', label: 'Rentabilidade' },
  { value: 'classification', label: 'Classificação' },
];

const PRODUCT_COLUMNS: Record<ProductsView, ProductColumn[]> = {
  summary: [
    { key: 'qty', header: 'Qtd', numeric: true, render: s => fmtQty(s.quantity) },
    { key: 'revenue', header: 'Faturamento', numeric: true, render: s => fmtMoney(s.revenue) },
    { key: 'profit', header: 'Lucro bruto', numeric: true, render: s => fmtMoney(s.gross_profit) },
    { key: 'margin', header: 'Margem', numeric: true, render: s => fmtPct(s.gross_margin) },
    { key: 'abc', header: 'Classificação ABC', render: s => <Badge variant={classBadgeVariant(s.revenue_class)}>{s.revenue_class ?? '—'}</Badge> },
  ],
  commercial: [
    { key: 'qty', header: 'Qtd', numeric: true, render: s => fmtQty(s.quantity) },
    { key: 'revenue', header: 'Faturamento', numeric: true, render: s => fmtMoney(s.revenue) },
    { key: 'avgPrice', header: 'Preço médio', numeric: true, render: s => fmtMoney(s.avg_price) },
    { key: 'listPrice', header: 'Preço tabela', numeric: true, render: s => fmtMoney(s.list_price) },
    { key: 'realization', header: 'Realização', numeric: true, render: s => fmtPct(s.price_realization) },
  ],
  profitability: [
    { key: 'cost', header: 'Custo unitário', numeric: true, render: s => fmtMoney(s.cost) },
    { key: 'cogs', header: 'CMV', numeric: true, render: s => fmtMoney(s.cogs) },
    { key: 'profit', header: 'Lucro bruto', numeric: true, render: s => fmtMoney(s.gross_profit) },
    { key: 'margin', header: 'Margem', numeric: true, render: s => fmtPct(s.gross_margin) },
    { key: 'markup', header: 'Markup', numeric: true, render: s => fmtMultiplier(s.realized_markup) },
  ],
  classification: [
    { key: 'turnover', header: 'ABC Giro', render: s => <Badge variant={classBadgeVariant(s.turnover_class)}>{s.turnover_class ?? '—'}</Badge> },
    { key: 'revenueClass', header: 'ABC Faturamento', render: s => <Badge variant={classBadgeVariant(s.revenue_class)}>{s.revenue_class ?? '—'}</Badge> },
    { key: 'profitClass', header: 'ABC Lucro', render: s => <Badge variant={classBadgeVariant(s.profit_class)}>{s.profit_class ?? '—'}</Badge> },
    { key: 'status', header: 'Status', render: s => { const state = costState(s); return <Badge variant={state.variant}>{state.label}</Badge>; } },
  ],
};

const PAGE_SIZE = 50;

export function AbcCurvePage({ companyId }: AbcCurvePageProps) {
  const { profile } = useAuth();
  const canWrite = hasPermission(profile?.role, 'products.write');

  const [tab, setTab] = useState<Tab>('overview');
  const [analyses, setAnalyses] = useState<AbcCurveAnalysis[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<(SkuSnapshotRow & { id: string })[]>([]);
  const [recommendations, setRecommendations] = useState<{ sku: string; code: string; priority: number; justification: string }[]>([]);
  const [batches, setBatches] = useState<AbcCurveImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [productsView, setProductsView] = useState<ProductsView>('summary');
  const [expandedSnapshotId, setExpandedSnapshotId] = useState<string | null>(null);

  const loadAnalyses = async () => {
    setLoading(true);
    try {
      const list = await listAnalyses(companyId);
      setAnalyses(list);
      setSelectedId(prev => prev && list.some(a => a.id === prev) ? prev : (list[0]?.id ?? null));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAnalyses(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId]);

  useEffect(() => {
    if (!selectedId) { setSnapshots([]); setRecommendations([]); setBatches([]); return; }
    setPage(0);
    setExpandedSnapshotId(null);
    Promise.all([
      listSkuSnapshots(companyId, selectedId),
      listRecommendations(companyId, selectedId),
      listImportBatches(companyId, selectedId),
    ]).then(([s, r, b]) => {
      setSnapshots(s);
      setRecommendations(r as typeof recommendations);
      setBatches(b);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, selectedId]);

  const selected = analyses.find(a => a.id === selectedId) ?? null;
  const recommendationBySku = useMemo(() => new Map(recommendations.map(r => [r.sku, r])), [recommendations]);
  const groupedRecommendations = useMemo(() => {
    const groups = new Map<string, { sku: string; justification: string }[]>();
    recommendations.forEach(r => {
      if (!groups.has(r.code)) groups.set(r.code, []);
      groups.get(r.code)!.push({ sku: r.sku, justification: r.justification });
    });
    return groups;
  }, [recommendations]);

  const totalPages = Math.max(1, Math.ceil(snapshots.length / PAGE_SIZE));
  const pagedSnapshots = snapshots.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const productColumns = PRODUCT_COLUMNS[productsView];

  const changeProductsView = (view: ProductsView) => {
    setProductsView(view);
    setExpandedSnapshotId(null);
  };

  const changePage = (next: number) => {
    setPage(next);
    setExpandedSnapshotId(null);
  };

  if (loading) {
    return <Page><PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Carregando...</PanelSection></Page>;
  }

  return (
    <Page>
      <PageHeader
        title="Curva ABC"
        description="Giro, faturamento e lucro bruto calculados a partir de planilhas de vendas, preços/custos e estoque importadas."
        actions={canWrite ? (
          <Button onClick={() => setShowWizard(true)}><Plus size={16} /> Nova análise</Button>
        ) : undefined}
      />

      {analyses.length === 0 && (
        <Panel>
          <PanelSection padding="lg" className="text-center space-y-3">
            <p className="text-sm text-fg-subtle">Nenhuma análise publicada ainda.</p>
            {canWrite && <Button onClick={() => setShowWizard(true)}><Plus size={16} /> Importar primeira análise</Button>}
          </PanelSection>
        </Panel>
      )}

      {selected && (
        <>
          <Panel>
            <PanelSection padding="md" className="flex flex-wrap items-center justify-between gap-3">
              <Select value={selectedId ?? ''} onChange={e => setSelectedId(e.target.value)} className="max-w-sm">
                {analyses.map(a => (
                  <option key={a.id} value={a.id}>{a.name} — {a.salesPeriodStart} a {a.salesPeriodEnd}</option>
                ))}
              </Select>
              <SegmentedControl
                label="Área"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'overview', label: 'Visão geral' },
                  { value: 'products', label: 'Produtos' },
                  { value: 'matrix', label: 'Matriz de decisão' },
                  { value: 'sources', label: 'Fontes de dados' },
                ]}
              />
            </PanelSection>
          </Panel>

          {tab === 'overview' && (
            <Panel>
              <PanelSection padding="md">
                <StatRow>
                  <StatCell><Stat label="Faturamento" value={fmtMoney(selected.totalRevenue)} /></StatCell>
                  <StatCell><Stat label="Unidades vendidas" value={selected.totalQuantity.toLocaleString('pt-BR')} /></StatCell>
                  <StatCell><Stat label="SKUs analisados" value={selected.totalSkuCount} /></StatCell>
                  <StatCell><Stat label="Cobertura de custo" value={selected.costCoveragePct !== null ? `${selected.costCoveragePct.toFixed(1)}%` : '—'} context="SKUs com custo cadastrado" /></StatCell>
                  <StatCell><Stat label="Cobertura de estoque" value={selected.stockCoveragePct !== null ? `${selected.stockCoveragePct.toFixed(1)}%` : 'Sem snapshot'} /></StatCell>
                  <StatCell><Stat label="Avisos na importação" value={selected.warningCount} valueTone={selected.warningCount > 0 ? 'warning' : 'default'} /></StatCell>
                </StatRow>
              </PanelSection>
            </Panel>
          )}

          {tab === 'products' && (
            <Panel>
              <PanelSection padding="md" className="flex justify-end">
                <SegmentedControl
                  label="Visão"
                  value={productsView}
                  onChange={changeProductsView}
                  options={PRODUCT_VIEW_OPTIONS}
                />
              </PanelSection>
              <div className="overflow-x-auto">
                <Table className="min-w-max">
                  <Thead>
                    <Tr>
                      <Th className="whitespace-nowrap">Produto</Th>
                      {productColumns.map(col => (
                        <Th key={col.key} className="whitespace-nowrap">{col.header}</Th>
                      ))}
                      <Th className="w-10"><span className="sr-only">Detalhes</span></Th>
                    </Tr>
                  </Thead>
                  <tbody>
                    {pagedSnapshots.map(s => {
                      const rec = recommendationBySku.get(s.sku);
                      const state = costState(s);
                      const isExpanded = expandedSnapshotId === s.id;
                      const detailId = `abc-curve-product-detail-${s.id}`;
                      return (
                        <Fragment key={s.id}>
                          <Tr>
                            <Td className="max-w-xs">
                              <span className="block min-w-0">
                                <span className="block truncate font-medium text-fg" title={s.product_name ?? undefined}>{s.product_name ?? '—'}</span>
                                <span className="block truncate text-xs text-fg-subtle">{s.sku}</span>
                              </span>
                            </Td>
                            {productColumns.map(col => (
                              <Td key={col.key} numeric={col.numeric} className="whitespace-nowrap">{col.render(s)}</Td>
                            ))}
                            <Td className="whitespace-nowrap text-right">
                              <button
                                type="button"
                                aria-expanded={isExpanded}
                                aria-controls={detailId}
                                onClick={() => setExpandedSnapshotId(isExpanded ? null : s.id)}
                                className="inline-flex items-center justify-center rounded-control p-1 text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg"
                              >
                                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                <span className="sr-only">{isExpanded ? 'Recolher detalhes' : 'Expandir detalhes'}</span>
                              </button>
                            </Td>
                          </Tr>
                          {isExpanded && (
                            <Tr id={detailId} className="bg-surface-3/40">
                              <Td colSpan={productColumns.length + 2} className="space-y-3">
                                <div className="grid gap-4 sm:grid-cols-3">
                                  <div className="space-y-1.5">
                                    <p className="text-xs font-medium text-fg-subtle">Comercial</p>
                                    <dl className="space-y-1 text-sm">
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">Qtd</dt><dd className="font-mono tabular-nums text-fg">{fmtQty(s.quantity)}</dd></div>
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">Faturamento</dt><dd className="font-mono tabular-nums text-fg">{fmtMoney(s.revenue)}</dd></div>
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">Preço médio</dt><dd className="font-mono tabular-nums text-fg">{fmtMoney(s.avg_price)}</dd></div>
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">Preço tabela</dt><dd className="font-mono tabular-nums text-fg">{fmtMoney(s.list_price)}</dd></div>
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">Realização</dt><dd className="font-mono tabular-nums text-fg">{fmtPct(s.price_realization)}</dd></div>
                                    </dl>
                                  </div>
                                  <div className="space-y-1.5 sm:border-l sm:border-edge/60 sm:pl-4">
                                    <p className="text-xs font-medium text-fg-subtle">Rentabilidade</p>
                                    <dl className="space-y-1 text-sm">
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">Custo unitário</dt><dd className="font-mono tabular-nums text-fg">{fmtMoney(s.cost)}</dd></div>
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">CMV</dt><dd className="font-mono tabular-nums text-fg">{fmtMoney(s.cogs)}</dd></div>
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">Lucro bruto</dt><dd className="font-mono tabular-nums text-fg">{fmtMoney(s.gross_profit)}</dd></div>
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">Margem</dt><dd className="font-mono tabular-nums text-fg">{fmtPct(s.gross_margin)}</dd></div>
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">Markup</dt><dd className="font-mono tabular-nums text-fg">{fmtMultiplier(s.realized_markup)}</dd></div>
                                    </dl>
                                  </div>
                                  <div className="space-y-1.5 sm:border-l sm:border-edge/60 sm:pl-4">
                                    <p className="text-xs font-medium text-fg-subtle">Classificação</p>
                                    <dl className="space-y-1 text-sm">
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">ABC Giro</dt><dd><Badge variant={classBadgeVariant(s.turnover_class)}>{s.turnover_class ?? '—'}</Badge></dd></div>
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">ABC Faturamento</dt><dd><Badge variant={classBadgeVariant(s.revenue_class)}>{s.revenue_class ?? '—'}</Badge></dd></div>
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">ABC Lucro</dt><dd><Badge variant={classBadgeVariant(s.profit_class)}>{s.profit_class ?? '—'}</Badge></dd></div>
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">Status</dt><dd><Badge variant={state.variant}>{state.label}</Badge></dd></div>
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">Recomendação</dt><dd className="text-right text-fg">{rec ? RECOMMENDATION_LABEL[rec.code] : '—'}</dd></div>
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">Estoque</dt><dd className="font-mono tabular-nums text-fg">{s.stock_available ?? '—'}</dd></div>
                                      <div className="flex items-center justify-between gap-3"><dt className="text-fg-muted">Cobertura</dt><dd className="font-mono tabular-nums text-fg">{fmtCoverage(s.coverage_days)}</dd></div>
                                    </dl>
                                  </div>
                                </div>
                              </Td>
                            </Tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
              <PanelSection padding="sm" className="flex items-center justify-between text-sm text-fg-muted">
                <span>{snapshots.length} SKUs — página {page + 1} de {totalPages}</span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => changePage(page - 1)}>Anterior</Button>
                  <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => changePage(page + 1)}>Próxima</Button>
                </div>
              </PanelSection>
            </Panel>
          )}

          {tab === 'matrix' && (
            <Panel>
              {groupedRecommendations.size === 0 && (
                <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Nenhuma recomendação gerada para esta análise.</PanelSection>
              )}
              {Array.from(groupedRecommendations.entries()).map(([code, items]) => {
                const isOpen = expandedGroup === code;
                return (
                  <div key={code} className="border-t border-edge first:border-t-0">
                    <PanelSection padding="md" className="flex items-center justify-between">
                      <button type="button" className="flex items-center gap-2 text-left" onClick={() => setExpandedGroup(isOpen ? null : code)}>
                        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <span className="font-medium text-fg">{RECOMMENDATION_LABEL[code] ?? code}</span>
                        <Badge variant="neutral">{items.length}</Badge>
                      </button>
                    </PanelSection>
                    {isOpen && items.map(item => (
                      <PanelSection key={item.sku} padding="sm" className="pl-8 flex items-center justify-between gap-3 text-sm">
                        <span className="text-fg-subtle">{item.sku}</span>
                        <span className="text-fg-muted truncate">{item.justification}</span>
                      </PanelSection>
                    ))}
                  </div>
                );
              })}
            </Panel>
          )}

          {tab === 'sources' && (
            <Panel>
              <PanelSection padding="md" className="space-y-1">
                <p className="text-title">Fontes de dados</p>
                <p className="text-sm text-fg-subtle">
                  Período de vendas: {selected.salesPeriodStart} a {selected.salesPeriodEnd} · Preços/custos em {selected.pricingSnapshotDate}
                  {selected.stockSnapshotDate && ` · Estoque em ${selected.stockSnapshotDate}`}
                </p>
              </PanelSection>
              <Table>
                <Thead><Tr><Th>Arquivo</Th><Th>Origem</Th><Th>Linhas</Th><Th>Importadas</Th><Th>Avisos</Th><Th>Status</Th></Tr></Thead>
                <tbody>
                  {batches.map(b => (
                    <Tr key={b.id}>
                      <Td>{b.fileName ?? '—'} <span className="text-fg-subtle">({b.fileKind})</span></Td>
                      <Td>{b.sourceType === 'api' ? `API (${b.provider ?? '—'})` : 'Planilha'}</Td>
                      <Td numeric>{b.rowCount}</Td>
                      <Td numeric>{b.importedCount}</Td>
                      <Td numeric>{b.warningCount}</Td>
                      <Td><Badge variant={b.status === 'completed' ? 'success' : 'danger'}>{b.status === 'completed' ? 'Concluído' : 'Falhou'}</Badge></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          )}
        </>
      )}

      {showWizard && (
        <AbcCurveImportWizard
          companyId={companyId}
          userId={profile?.id ?? ''}
          userEmail={profile?.email ?? ''}
          onClose={() => setShowWizard(false)}
          onPublished={() => { setShowWizard(false); loadAnalyses(); }}
        />
      )}
    </Page>
  );
}
