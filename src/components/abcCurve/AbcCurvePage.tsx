// Curva ABC — página de Produtos. Reaproveita os tokens/componentes de ProductBrandsPage
// (mesma família de telas dentro de Produtos): Page/PageHeader/Panel/PanelSection/Table/
// Stat/SegmentedControl/Badge/Button/Select. Nenhum visual novo, nenhuma escrita no Inventário.
//
// Toda conta desta tela vem de abcCurveAnalytics.ts (puro, com teste próprio) sobre os
// snapshots já persistidos da análise — a UI nunca reclassifica nem recalcula recomendação.

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react';
import {
  Page, PageHeader, Panel, PanelSection, Badge, Button, Select, Input,
  Table, Thead, Tr, Th, Td, SegmentedControl, Stat, StatRow, StatCell,
} from '../ui';
import { useAuth } from '../../lib/auth';
import { hasPermission } from '../../lib/permissionService';
import {
  listAnalyses, listSkuSnapshots, listRecommendations, listImportBatches,
  type AbcCurveAnalysis, type SkuSnapshotRow, type AbcCurveImportBatch,
} from '../../lib/abcCurve/abcCurveService';
import {
  ABC_METRIC_OPTIONS, ABC_METRIC_LABEL, CLASS_FILTER_OPTIONS, EMPTY_PRODUCT_FILTERS,
  aggregateGroup, buildAbcDistribution, buildCurveComparison, buildPareto,
  filterSnapshots, hasActiveFilters, hasStockData, observedProfit, soldSkuCount,
  type AbcMetric, type ClassFilter, type CostFilter, type ProductFilters, type StockFilter,
} from '../../lib/abcCurve/abcCurveAnalytics';
import { baselineOptions as buildBaselineOptions, findPreviousAnalysis } from '../../lib/abcCurve/abcCurveComparison';
import { countSignals, presentSignals, signalLabel } from '../../lib/abcCurve/abcCurveSignals';
import { hasTinyReference } from '../../lib/abcCurve/abcCurveTiny';
import { AbcParetoChart } from './AbcParetoChart';
import { AbcComparisonPanel } from './AbcComparisonPanel';
import { AbcPolicySummary } from './AbcPolicySummary';
import { AbcTinyTab } from './AbcTinyTab';
import { AbcCurveImportWizard } from './AbcCurveImportWizard';

interface AbcCurvePageProps {
  companyId: string;
}

type Tab = 'overview' | 'products' | 'matrix' | 'tiny' | 'sources';
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

// Descrição fixa da própria regra do motor (abcCurveRecommendations.ts) — texto estático,
// nunca gerado. Serve para o usuário saber por que aquele grupo existe.
const RECOMMENDATION_RULE: Record<string, string> = {
  PREJUIZO: 'Preço médio praticado abaixo do custo cadastrado.',
  CORRIGIR_CUSTO: 'Venda registrada no período sem custo cadastrado.',
  COMPRA_URGENTE: 'Classe A de lucro com ruptura ou baixa cobertura.',
  PROTEGER_DISPONIBILIDADE: 'Classe A de lucro com cobertura saudável.',
  REVISAR_PRECO_CUSTO: 'Giro classe A com lucro em classe B ou C.',
  RENEGOCIAR_CUSTO_OU_PRECO: 'Faturamento classe A com margem baixa.',
  PROMOVER: 'Lucro classe A ou B, margem forte e giro em classe C.',
  REDUZIR_COMPRA_OU_LIQUIDAR: 'Lucro classe C com excesso de cobertura de estoque.',
  ESTOQUE_PARADO: 'Sem venda no período, com saldo disponível em estoque.',
};

// Prioridades destacadas na Visão geral — sempre as mesmas quatro, com contagem real vinda das
// recomendações persistidas (nenhum score, nenhuma ordenação inventada).
const PRIORITY_CODES = ['PREJUIZO', 'CORRIGIR_CUSTO', 'COMPRA_URGENTE', 'ESTOQUE_PARADO'] as const;

const PRIORITY_LABEL: Record<string, string> = {
  PREJUIZO: 'Prejuízo',
  CORRIGIR_CUSTO: 'Sem custo',
  COMPRA_URGENTE: 'Compra urgente',
  ESTOQUE_PARADO: 'Estoque parado',
};

const classBadgeVariant = (cls: string | null): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (cls === 'A') return 'success';
  if (cls === 'B') return 'warning';
  if (cls === 'C') return 'danger';
  return 'neutral';
};

const fmtMoney = (value: number | null) => value === null ? '—' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
const fmtSharePct = (value: number) => `${value.toFixed(1)}%`;
const fmtMultiplier = (value: number | null) => value === null ? '—' : `${value.toFixed(2)}x`;
const fmtQty = (value: number | null) => value === null ? '—' : value.toLocaleString('pt-BR');
const fmtCoverage = (value: number | null) => value === null ? '—' : `${value.toFixed(0)}d`;
const fmtInt = (value: number) => value.toLocaleString('pt-BR');
const costState = (s: Snapshot) => COST_STATE_LABEL[s.cost_state] ?? COST_STATE_LABEL.NORMAL;

const PRODUCT_VIEW_OPTIONS: { value: ProductsView; label: string }[] = [
  { value: 'summary', label: 'Resumo' },
  { value: 'commercial', label: 'Comercial' },
  { value: 'profitability', label: 'Rentabilidade' },
  { value: 'classification', label: 'Classificação' },
];

const COST_FILTER_OPTIONS: { value: CostFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'NORMAL', label: 'OK' },
  { value: 'SEM_CUSTO', label: 'Sem custo' },
  { value: 'PREJUIZO', label: 'Prejuízo' },
];

const STOCK_FILTER_OPTIONS: { value: StockFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'with', label: 'Com estoque' },
  { value: 'without', label: 'Sem estoque' },
  { value: 'idle', label: 'Estoque parado' },
];

// Métrica que mais importa em cada grupo da Matriz, para a linha do SKU mostrar o número certo.
const GROUP_METRIC: Record<string, { header: string; render: (s: Snapshot) => string }> = {
  PREJUIZO: { header: 'Lucro bruto', render: s => fmtMoney(s.gross_profit) },
  CORRIGIR_CUSTO: { header: 'Faturamento', render: s => fmtMoney(s.revenue) },
  COMPRA_URGENTE: { header: 'Cobertura', render: s => fmtCoverage(s.coverage_days) },
  PROTEGER_DISPONIBILIDADE: { header: 'Cobertura', render: s => fmtCoverage(s.coverage_days) },
  REVISAR_PRECO_CUSTO: { header: 'Margem', render: s => fmtPct(s.gross_margin) },
  RENEGOCIAR_CUSTO_OU_PRECO: { header: 'Margem', render: s => fmtPct(s.gross_margin) },
  PROMOVER: { header: 'Margem', render: s => fmtPct(s.gross_margin) },
  REDUZIR_COMPRA_OU_LIQUIDAR: { header: 'Cobertura', render: s => fmtCoverage(s.coverage_days) },
  ESTOQUE_PARADO: { header: 'Estoque', render: s => fmtQty(s.stock_available) },
};

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
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [recommendations, setRecommendations] = useState<{ sku: string; code: string; priority: number; justification: string }[]>([]);
  const [batches, setBatches] = useState<AbcCurveImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [productsView, setProductsView] = useState<ProductsView>('summary');
  const [expandedSnapshotId, setExpandedSnapshotId] = useState<string | null>(null);
  const [paretoMetric, setParetoMetric] = useState<AbcMetric>('revenue');
  const [filters, setFilters] = useState<ProductFilters>(EMPTY_PRODUCT_FILTERS);
  // Comparação histórica: o baseline é escolhido pelo usuário; '' = Nenhuma. Os snapshots do
  // baseline são carregados SOB DEMANDA, só da análise escolhida — nunca de todas de uma vez.
  const [baselineId, setBaselineId] = useState('');
  const [baselineRows, setBaselineRows] = useState<Snapshot[]>([]);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [transitionMetric, setTransitionMetric] = useState<AbcMetric>('revenue');

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

  // Troca de workspace: nada da empresa anterior pode sobrar em tela enquanto a nova carrega.
  useEffect(() => {
    setAnalyses([]);
    setSelectedId(null);
    setSnapshots([]);
    setRecommendations([]);
    setBatches([]);
    setFilters(EMPTY_PRODUCT_FILTERS);
    setPage(0);
    setExpandedGroup(null);
    setExpandedSnapshotId(null);
    setBaselineId('');
    setBaselineRows([]);
    setTab('overview');
    loadAnalyses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => {
    if (!selectedId) { setSnapshots([]); setRecommendations([]); setBatches([]); return; }
    setPage(0);
    setExpandedSnapshotId(null);
    setExpandedGroup(null);
    setFilters(EMPTY_PRODUCT_FILTERS);
    setBaselineRows([]);
    setDetailLoading(true);
    let cancelled = false;
    Promise.all([
      listSkuSnapshots(companyId, selectedId),
      listRecommendations(companyId, selectedId),
      listImportBatches(companyId, selectedId),
    ]).then(([s, r, b]) => {
      if (cancelled) return;
      setSnapshots(s);
      setRecommendations(r as typeof recommendations);
      setBatches(b);
    }).finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, selectedId]);

  const selected = analyses.find(a => a.id === selectedId) ?? null;

  // Só análises ANTERIORES à selecionada, e `analyses` já vem filtrada por company_id pelo
  // serviço — nenhuma candidata de outro workspace pode entrar aqui.
  const comparisonOptions = useMemo(() => buildBaselineOptions(analyses, selected), [analyses, selected]);

  // Por padrão, a análise imediatamente anterior; se o usuário escolher outra (ou "Nenhuma"),
  // a escolha manda até trocar de análise.
  useEffect(() => {
    if (!selected) { setBaselineId(''); return; }
    setBaselineId(findPreviousAnalysis(analyses, selected)?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, analyses.length]);

  const baseline = comparisonOptions.find(a => a.id === baselineId) ?? null;

  // Carrega os snapshots APENAS do baseline escolhido, quando escolhido.
  useEffect(() => {
    if (!baselineId) { setBaselineRows([]); return; }
    let cancelled = false;
    setBaselineLoading(true);
    listSkuSnapshots(companyId, baselineId)
      .then(rows => { if (!cancelled) setBaselineRows(rows); })
      .finally(() => { if (!cancelled) setBaselineLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, baselineId]);

  const recommendationBySku = useMemo(() => new Map(recommendations.map(r => [r.sku, r])), [recommendations]);

  const groupedRecommendations = useMemo(() => {
    const groups = new Map<string, { sku: string; justification: string }[]>();
    recommendations.forEach(r => {
      if (!groups.has(r.code)) groups.set(r.code, []);
      groups.get(r.code)!.push({ sku: r.sku, justification: r.justification });
    });
    return groups;
  }, [recommendations]);

  const snapshotBySku = useMemo(() => new Map(snapshots.map(s => [s.sku, s])), [snapshots]);

  const profit = useMemo(() => observedProfit(snapshots), [snapshots]);
  const soldCount = useMemo(() => soldSkuCount(snapshots), [snapshots]);
  const pareto = useMemo(() => buildPareto(snapshots, paretoMetric), [snapshots, paretoMetric]);
  const distribution = useMemo(() => buildAbcDistribution(snapshots, paretoMetric), [snapshots, paretoMetric]);
  const comparison = useMemo(() => buildCurveComparison(snapshots), [snapshots]);
  const stockAvailable = useMemo(() => hasStockData(snapshots), [snapshots]);

  const presentCodes = useMemo(() => {
    const codes = new Set(recommendations.map(r => r.code));
    return Array.from(codes).sort((a, b) => (RECOMMENDATION_LABEL[a] ?? a).localeCompare(RECOMMENDATION_LABEL[b] ?? b));
  }, [recommendations]);

  // Só sinais realmente gravados nesta análise entram no filtro.
  const availableSignals = useMemo(() => presentSignals(snapshots), [snapshots]);
  const tinyAvailable = useMemo(() => hasTinyReference(snapshots), [snapshots]);
  const tinyBatch = useMemo(() => batches.find(b => b.fileKind === 'abc_tiny') ?? null, [batches]);

  const priorityCounts = useMemo(
    () => PRIORITY_CODES.map(code => ({ code, count: groupedRecommendations.get(code)?.length ?? 0 })),
    [groupedRecommendations],
  );

  const filtered = useMemo(
    () => filterSnapshots(snapshots, filters, recommendationBySku),
    [snapshots, filters, recommendationBySku],
  );
  const filtersActive = hasActiveFilters(filters);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedSnapshots = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const productColumns = PRODUCT_COLUMNS[productsView];

  const updateFilter = <K extends keyof ProductFilters>(key: K, value: ProductFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(0);
    setExpandedSnapshotId(null);
  };

  const openPriority = (code: string) => {
    setFilters({ ...EMPTY_PRODUCT_FILTERS, recommendation: code });
    setPage(0);
    setExpandedSnapshotId(null);
    setTab('products');
  };

  const changeProductsView = (view: ProductsView) => {
    setProductsView(view);
    setExpandedSnapshotId(null);
  };

  const changePage = (next: number) => {
    setPage(next);
    setExpandedSnapshotId(null);
  };

  const thresholdA = selected?.thresholdA ?? 80;
  const thresholdB = selected?.thresholdB ?? 95;

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
                // A aba do Tiny só existe quando a análise realmente tem referência
                // comparável — nunca uma aba morta.
                options={[
                  { value: 'overview' as Tab, label: 'Visão geral' },
                  { value: 'products' as Tab, label: 'Produtos' },
                  { value: 'matrix' as Tab, label: 'Matriz de decisão' },
                  ...(tinyAvailable ? [{ value: 'tiny' as Tab, label: 'Comparativo Tiny' }] : []),
                  { value: 'sources' as Tab, label: 'Fontes de dados' },
                ]}
              />
            </PanelSection>
          </Panel>

          {tab === 'overview' && (
            <>
              {/* Resultados comerciais primeiro, indicadores de qualidade do dado em seguida —
                  4 + 3 em vez de 6 apertados numa linha, que cortava o Faturamento. */}
              <Panel>
                <PanelSection padding="md">
                  <StatRow>
                    <StatCell><Stat label="Faturamento" value={fmtMoney(selected.totalRevenue)} context={`${selected.salesPeriodStart} a ${selected.salesPeriodEnd}`} /></StatCell>
                    <StatCell>
                      <Stat
                        label="Lucro bruto observado"
                        value={detailLoading ? '—' : fmtMoney(profit.total)}
                        context={detailLoading || profit.coveragePct === null ? undefined : `calculado sobre ${fmtSharePct(profit.coveragePct)} dos SKUs`}
                      />
                    </StatCell>
                    <StatCell><Stat label="Unidades vendidas" value={fmtInt(selected.totalQuantity)} /></StatCell>
                    <StatCell>
                      <Stat
                        label="SKUs analisados"
                        value={fmtInt(selected.totalSkuCount)}
                        context={!detailLoading && soldCount < snapshots.length ? `${fmtInt(soldCount)} com venda no período` : undefined}
                      />
                    </StatCell>
                  </StatRow>
                </PanelSection>
                <PanelSection padding="md">
                  <p className="text-label mb-4">Qualidade dos dados desta análise</p>
                  <StatRow>
                    <StatCell><Stat label="Cobertura de custo da análise" value={selected.costCoveragePct !== null ? fmtSharePct(selected.costCoveragePct) : '—'} context="SKUs com custo na planilha importada" /></StatCell>
                    <StatCell><Stat label="Cobertura do snapshot de estoque" value={selected.stockCoveragePct !== null ? fmtSharePct(selected.stockCoveragePct) : 'Sem snapshot'} context={selected.stockCoveragePct !== null ? 'SKUs com saldo informado nesta análise' : 'Reposição não calculada'} /></StatCell>
                    <StatCell><Stat label="Avisos de importação" value={fmtInt(selected.warningCount)} valueTone={selected.warningCount > 0 ? 'warning' : 'default'} context="detalhados em Fontes de dados" /></StatCell>
                  </StatRow>
                </PanelSection>
              </Panel>

              {/* Comparação histórica entra DEPOIS do resumo comercial, sem substituir nada
                  da composição existente. */}
              {!detailLoading && (
                <AbcComparisonPanel
                  current={selected}
                  baseline={baseline}
                  baselineOptions={comparisonOptions}
                  baselineId={baselineId}
                  onBaselineChange={setBaselineId}
                  currentRows={snapshots}
                  baselineRows={baselineRows}
                  loading={baselineLoading}
                  metric={transitionMetric}
                  onMetricChange={setTransitionMetric}
                />
              )}

              <Panel>
                <PanelSection padding="md" className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-section">Concentração ABC</p>
                    <p className="text-caption mt-0.5">{ABC_METRIC_LABEL[paretoMetric]} por SKU em ordem decrescente, com o acumulado percentual.</p>
                  </div>
                  <SegmentedControl label="Curva" value={paretoMetric} onChange={setParetoMetric} options={ABC_METRIC_OPTIONS} />
                </PanelSection>
                <PanelSection padding="md">
                  {detailLoading
                    ? <p className="text-sm text-fg-subtle">Carregando os SKUs desta análise...</p>
                    : <AbcParetoChart data={pareto} metric={paretoMetric} thresholdA={thresholdA} thresholdB={thresholdB} />}
                </PanelSection>
                {!detailLoading && distribution.eligibleCount > 0 && (
                  <>
                    <Table>
                      <Thead>
                        <Tr>
                          <Th>Classe</Th>
                          <Th>SKUs</Th>
                          <Th>% dos SKUs elegíveis</Th>
                          <Th>Participação em {ABC_METRIC_LABEL[paretoMetric].toLowerCase()}</Th>
                        </Tr>
                      </Thead>
                      <tbody>
                        {distribution.classes.map(c => (
                          <Tr key={c.cls}>
                            <Td><Badge variant={classBadgeVariant(c.cls)}>{c.cls}</Badge></Td>
                            <Td numeric>{fmtInt(c.skuCount)}</Td>
                            <Td numeric>{fmtSharePct(c.skuPct)}</Td>
                            <Td numeric>{fmtSharePct(c.metricShare)}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                    {distribution.ineligibleCount > 0 && (
                      <PanelSection padding="sm" className="text-caption">
                        {fmtInt(distribution.ineligibleCount)} SKUs não elegíveis nesta curva (sem valor na métrica) — ficam fora da distribuição em vez de entrar como classe C.
                      </PanelSection>
                    )}
                  </>
                )}
              </Panel>

              {!detailLoading && snapshots.length > 0 && (
                <Panel>
                  <PanelSection padding="md">
                    <p className="text-section">Giro × Faturamento × Lucro</p>
                    <p className="text-caption mt-0.5">As três curvas são independentes: o mesmo SKU pode ter classe diferente em cada uma.</p>
                  </PanelSection>
                  <Table>
                    <Thead><Tr><Th>Curva</Th><Th>SKUs A</Th><Th>SKUs B</Th><Th>SKUs C</Th><Th>Participação da classe A</Th></Tr></Thead>
                    <tbody>
                      {comparison.map(row => (
                        <Tr key={row.metric}>
                          <Td>{row.label}</Td>
                          <Td numeric>{fmtInt(row.a)}</Td>
                          <Td numeric>{fmtInt(row.b)}</Td>
                          <Td numeric>{fmtInt(row.c)}</Td>
                          <Td numeric>{row.eligible > 0 ? fmtSharePct(row.aShare) : '—'}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </Panel>
              )}

              {!detailLoading && (
                <Panel>
                  <PanelSection padding="md">
                    <p className="text-section">Prioridades da análise</p>
                    <p className="text-caption mt-0.5">Contagens das recomendações já registradas nesta análise. Abrir leva para Produtos filtrado.</p>
                  </PanelSection>
                  <PanelSection padding="md" className="grid grid-cols-2 gap-x-6 gap-y-4 lg:flex lg:gap-0 lg:divide-x lg:divide-edge">
                    {priorityCounts.map(({ code, count }) => (
                      <div key={code} className="min-w-0 lg:flex-1 lg:px-5 lg:first:pl-0 lg:last:pr-0">
                        <Stat
                          label={PRIORITY_LABEL[code]}
                          value={fmtInt(count)}
                          valueTone={count === 0 ? 'default' : code === 'PREJUIZO' ? 'critical' : 'warning'}
                          context={`${count === 1 ? 'SKU' : 'SKUs'} nesta análise`}
                        />
                        {count > 0 && (
                          <button
                            type="button"
                            onClick={() => openPriority(code)}
                            className="mt-1.5 rounded-control text-xs font-medium text-accent underline decoration-dotted underline-offset-2 transition-colors hover:text-accent-strong"
                          >
                            Ver em Produtos
                          </button>
                        )}
                      </div>
                    ))}
                  </PanelSection>
                </Panel>
              )}

              {/* Bloco secundário e compacto: os parâmetros que produziram as recomendações
                  DESTA análise. Somente leitura — política publicada é histórico. */}
              <Panel>
                <PanelSection padding="md" className="space-y-2">
                  <div>
                    <p className="text-label">Política desta análise</p>
                    <p className="text-caption mt-0.5">Parâmetros registrados na publicação. Recomendações e sinais desta análise foram gerados com eles.</p>
                  </div>
                  <AbcPolicySummary policy={selected.policy} />
                </PanelSection>
              </Panel>
            </>
          )}

          {tab === 'products' && (
            <Panel>
              <PanelSection padding="md" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="w-full max-w-sm">
                    <Input
                      icon={<Search size={14} />}
                      value={filters.search}
                      onChange={e => updateFilter('search', e.target.value)}
                      placeholder="Buscar SKU ou produto"
                      aria-label="Buscar SKU ou produto"
                    />
                  </div>
                  <SegmentedControl
                    label="Visão"
                    value={productsView}
                    onChange={changeProductsView}
                    options={PRODUCT_VIEW_OPTIONS}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  <div>
                    <label className="text-label mb-1 block" htmlFor="abc-filter-turnover">ABC Giro</label>
                    <Select id="abc-filter-turnover" value={filters.turnover} onChange={e => updateFilter('turnover', e.target.value as ClassFilter)}>
                      {CLASS_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-label mb-1 block" htmlFor="abc-filter-revenue">ABC Faturamento</label>
                    <Select id="abc-filter-revenue" value={filters.revenue} onChange={e => updateFilter('revenue', e.target.value as ClassFilter)}>
                      {CLASS_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-label mb-1 block" htmlFor="abc-filter-profit">ABC Lucro</label>
                    <Select id="abc-filter-profit" value={filters.profit} onChange={e => updateFilter('profit', e.target.value as ClassFilter)}>
                      {CLASS_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-label mb-1 block" htmlFor="abc-filter-cost">Status de custo</label>
                    <Select id="abc-filter-cost" value={filters.cost} onChange={e => updateFilter('cost', e.target.value as CostFilter)}>
                      {COST_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-label mb-1 block" htmlFor="abc-filter-recommendation">Recomendação</label>
                    <Select id="abc-filter-recommendation" value={filters.recommendation} onChange={e => updateFilter('recommendation', e.target.value)}>
                      <option value="all">Todas</option>
                      {presentCodes.map(code => <option key={code} value={code}>{RECOMMENDATION_LABEL[code] ?? code}</option>)}
                    </Select>
                  </div>
                  {/* Sinais só entram no filtro se a análise realmente os gravou (Fase 2) —
                      análise anterior a isso não oferece o recorte. */}
                  {availableSignals.length > 0 && (
                    <div>
                      <label className="text-label mb-1 block" htmlFor="abc-filter-signal">Sinal</label>
                      <Select id="abc-filter-signal" value={filters.signal} onChange={e => updateFilter('signal', e.target.value)}>
                        <option value="all">Todos</option>
                        {availableSignals.map(code => <option key={code} value={code}>{signalLabel(code)}</option>)}
                      </Select>
                    </div>
                  )}
                  {/* Só aparece quando a análise tem snapshot de estoque — sem ele, "sem
                      estoque" seria invenção, não informação. */}
                  {stockAvailable && (
                    <div>
                      <label className="text-label mb-1 block" htmlFor="abc-filter-stock">Estoque</label>
                      <Select id="abc-filter-stock" value={filters.stock} onChange={e => updateFilter('stock', e.target.value as StockFilter)}>
                        {STOCK_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-caption">
                    {filtersActive
                      ? `${fmtInt(filtered.length)} de ${fmtInt(snapshots.length)} SKUs`
                      : `${fmtInt(snapshots.length)} SKUs`}
                  </p>
                  {filtersActive && (
                    <Button variant="ghost" size="sm" onClick={() => { setFilters(EMPTY_PRODUCT_FILTERS); setPage(0); setExpandedSnapshotId(null); }}>
                      Limpar filtros
                    </Button>
                  )}
                </div>
              </PanelSection>

              {filtered.length === 0 ? (
                <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">
                  {detailLoading ? 'Carregando os SKUs desta análise...' : 'Nenhum SKU atende aos filtros aplicados.'}
                </PanelSection>
              ) : (
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
                                  {/* Sinais só no detalhe: na tabela principal virariam ruído.
                                      A recomendação continua sendo uma; os sinais são os outros
                                      fatos do mesmo SKU. */}
                                  {(s.signal_codes ?? []).length > 0 && (
                                    <div className="border-t border-edge/60 pt-3">
                                      <p className="text-xs font-medium text-fg-subtle mb-1.5">Sinais observados</p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {(s.signal_codes ?? []).map(code => (
                                          <Badge key={code} variant="neutral">{signalLabel(code)}</Badge>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </Td>
                              </Tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              )}
              {filtered.length > 0 && (
                <PanelSection padding="sm" className="flex items-center justify-between text-sm text-fg-muted">
                  <span>página {safePage + 1} de {totalPages}</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" disabled={safePage === 0} onClick={() => changePage(safePage - 1)}>Anterior</Button>
                    <Button variant="ghost" size="sm" disabled={safePage >= totalPages - 1} onClick={() => changePage(safePage + 1)}>Próxima</Button>
                  </div>
                </PanelSection>
              )}
            </Panel>
          )}

          {tab === 'matrix' && (
            <Panel>
              {groupedRecommendations.size === 0 && (
                <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Nenhuma recomendação gerada para esta análise.</PanelSection>
              )}
              {Array.from(groupedRecommendations.entries()).map(([code, items]) => {
                const isOpen = expandedGroup === code;
                const rows = items.map(i => snapshotBySku.get(i.sku)).filter((s): s is Snapshot => s !== undefined);
                const totals = aggregateGroup(rows);
                const groupSignals = countSignals(rows);
                const metric = GROUP_METRIC[code];
                return (
                  <div key={code} className="border-t border-edge first:border-t-0">
                    <PanelSection padding="md" className="space-y-2">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        className="flex w-full items-center gap-2 text-left"
                        onClick={() => setExpandedGroup(isOpen ? null : code)}
                      >
                        {isOpen ? <ChevronDown size={16} className="flex-shrink-0 text-fg-subtle" /> : <ChevronRight size={16} className="flex-shrink-0 text-fg-subtle" />}
                        <span className="font-medium text-fg">{RECOMMENDATION_LABEL[code] ?? code}</span>
                        <Badge variant="neutral">{items.length} {items.length === 1 ? 'SKU' : 'SKUs'}</Badge>
                      </button>
                      {RECOMMENDATION_RULE[code] && <p className="pl-6 text-caption">{RECOMMENDATION_RULE[code]}</p>}
                      {/* Valores observados nesta análise para os SKUs deste grupo — nunca
                          projeção de impacto financeiro. */}
                      <dl className="flex flex-wrap gap-x-6 gap-y-1 pl-6 text-xs">
                        <div className="flex gap-1.5"><dt className="text-fg-subtle">Faturamento observado</dt><dd className="tabular-nums text-fg">{fmtMoney(totals.revenue)}</dd></div>
                        <div className="flex gap-1.5">
                          <dt className="text-fg-subtle">Lucro observado</dt>
                          <dd className="tabular-nums text-fg">{totals.profitCoveredSkus > 0 ? fmtMoney(totals.profit) : '—'}</dd>
                        </div>
                        <div className="flex gap-1.5">
                          <dt className="text-fg-subtle">Estoque atual</dt>
                          <dd className="tabular-nums text-fg">{totals.stock !== null ? `${fmtInt(totals.stock)} un.` : '—'}</dd>
                        </div>
                      </dl>
                      {/* Contagem de sinais dos SKUs DESTE grupo — nenhum score composto. */}
                      {groupSignals.length > 0 && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6 text-xs">
                          {groupSignals.map(({ code, count }) => (
                            <span key={code} className="text-fg-muted">
                              <span className="tabular-nums text-fg">{fmtInt(count)}</span> {signalLabel(code).toLowerCase()}
                            </span>
                          ))}
                        </div>
                      )}
                    </PanelSection>
                    {isOpen && (
                      <div className="overflow-x-auto">
                        <Table className="min-w-max">
                          <Thead>
                            <Tr>
                              <Th className="whitespace-nowrap">SKU</Th>
                              <Th className="whitespace-nowrap">Produto</Th>
                              <Th className="whitespace-nowrap">{metric?.header ?? 'Faturamento'}</Th>
                              <Th>Justificativa</Th>
                              <Th className="whitespace-nowrap">Sinais associados</Th>
                            </Tr>
                          </Thead>
                          <tbody>
                            {items.map(item => {
                              const snap = snapshotBySku.get(item.sku);
                              const signals = snap?.signal_codes ?? [];
                              return (
                                <Tr key={item.sku}>
                                  <Td className="whitespace-nowrap text-fg-subtle">{item.sku}</Td>
                                  <Td className="max-w-xs"><span className="block truncate" title={snap?.product_name ?? undefined}>{snap?.product_name ?? '—'}</span></Td>
                                  <Td numeric className="whitespace-nowrap">{snap && metric ? metric.render(snap) : snap ? fmtMoney(snap.revenue) : '—'}</Td>
                                  <Td className="text-fg-muted">{item.justification}</Td>
                                  <Td>
                                    {signals.length === 0 ? <span className="text-caption">—</span> : (
                                      <span className="flex flex-wrap gap-1">
                                        {signals.map(code => <Badge key={code} variant="neutral">{signalLabel(code)}</Badge>)}
                                      </span>
                                    )}
                                  </Td>
                                </Tr>
                              );
                            })}
                          </tbody>
                        </Table>
                      </div>
                    )}
                  </div>
                );
              })}
            </Panel>
          )}

          {tab === 'tiny' && (
            <AbcTinyTab
              rows={snapshots}
              fileRows={tinyBatch?.rowCount ?? null}
              fileMatched={tinyBatch?.importedCount ?? null}
              fileUnmatched={tinyBatch?.warningCount ?? null}
            />
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
              <div className="overflow-x-auto">
                <Table className="min-w-max">
                  <Thead>
                    <Tr>
                      <Th className="whitespace-nowrap">Arquivo</Th>
                      <Th className="whitespace-nowrap">Origem</Th>
                      <Th className="whitespace-nowrap">Linhas recebidas</Th>
                      <Th className="whitespace-nowrap">Linhas válidas</Th>
                      <Th className="whitespace-nowrap">Ignoradas / Avisos</Th>
                      <Th className="whitespace-nowrap">Status</Th>
                    </Tr>
                  </Thead>
                  <tbody>
                    {batches.map(b => {
                      const ignored = Math.max(0, b.rowCount - b.importedCount);
                      return (
                        <Tr key={b.id}>
                          <Td>{b.fileName ?? '—'} <span className="text-fg-subtle">({b.fileKind})</span></Td>
                          <Td>{b.sourceType === 'api' ? `API (${b.provider ?? '—'})` : 'Planilha'}</Td>
                          <Td numeric>{fmtInt(b.rowCount)}</Td>
                          <Td numeric>{fmtInt(b.importedCount)}</Td>
                          <Td numeric>{fmtInt(ignored)} / {fmtInt(b.warningCount)}</Td>
                          <Td><Badge variant={b.status === 'completed' ? 'success' : 'danger'}>{b.status === 'completed' ? 'Concluído' : 'Falhou'}</Badge></Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
              {/* O arquivo do Tiny nunca entra no cálculo da curva. O que muda na Fase 2 é
                  saber se ele virou comparativo de verdade — e dizer quando não virou, em vez
                  de deixar a linha na tabela sugerindo que foi aproveitado. */}
              {tinyBatch && (
                <PanelSection padding="md" className="space-y-0.5">
                  <p className="text-sm font-medium text-fg">
                    {tinyAvailable ? 'Curva ABC do Tiny — referência utilizada no comparativo' : 'Curva ABC do Tiny — referência sem dados comparáveis'}
                  </p>
                  <p className="text-caption">
                    {tinyAvailable
                      ? `Não participa do cálculo desta análise. ${fmtInt(tinyBatch.importedCount)} de ${fmtInt(tinyBatch.rowCount)} SKUs do arquivo têm correspondência aqui — veja em Comparativo Tiny.`
                      : 'Não participa do cálculo desta análise e nenhum SKU do arquivo teve correspondência, então não há comparativo.'}
                  </p>
                </PanelSection>
              )}

              {/* Parâmetros da política publicada — auditoria e reprodutibilidade da análise. */}
              <PanelSection padding="md" className="space-y-2">
                <p className="text-sm font-medium text-fg">Parâmetros utilizados</p>
                <AbcPolicySummary policy={selected.policy} />
              </PanelSection>
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
