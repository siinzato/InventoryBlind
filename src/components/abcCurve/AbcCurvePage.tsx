// Curva ABC — página de Produtos. Reaproveita os tokens/componentes de ProductBrandsPage
// (mesma família de telas dentro de Produtos): Page/PageHeader/Panel/PanelSection/Table/
// Stat/SegmentedControl/Badge/Button/Select. Nenhum visual novo, nenhuma escrita no Inventário.

import { useEffect, useMemo, useState } from 'react';
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
              <div className="overflow-x-auto">
                <Table className="min-w-max">
                  <Thead>
                    <Tr>
                      <Th className="whitespace-nowrap">SKU</Th><Th className="whitespace-nowrap">Produto</Th>
                      <Th className="whitespace-nowrap">Qtd</Th><Th className="whitespace-nowrap">Faturamento</Th>
                      <Th className="whitespace-nowrap">Preço médio</Th><Th className="whitespace-nowrap">Preço tabela</Th>
                      <Th className="whitespace-nowrap">Custo</Th><Th className="whitespace-nowrap">CMV</Th>
                      <Th className="whitespace-nowrap">Lucro</Th><Th className="whitespace-nowrap">Margem</Th>
                      <Th className="whitespace-nowrap">Giro</Th><Th className="whitespace-nowrap">Fat.</Th>
                      <Th className="whitespace-nowrap">Lucro (classe)</Th><Th className="whitespace-nowrap">Estoque</Th>
                      <Th className="whitespace-nowrap">Cobertura</Th><Th className="whitespace-nowrap">Recomendação</Th>
                      <Th className="whitespace-nowrap">Qualidade</Th>
                    </Tr>
                  </Thead>
                  <tbody>
                    {pagedSnapshots.map(s => {
                      const rec = recommendationBySku.get(s.sku);
                      const state = COST_STATE_LABEL[s.cost_state] ?? COST_STATE_LABEL.NORMAL;
                      return (
                        <Tr key={s.id}>
                          <Td className="whitespace-nowrap">{s.sku}</Td>
                          <Td className="max-w-xs truncate">{s.product_name ?? '—'}</Td>
                          <Td numeric className="whitespace-nowrap">{s.quantity.toLocaleString('pt-BR')}</Td>
                          <Td numeric className="whitespace-nowrap">{fmtMoney(s.revenue)}</Td>
                          <Td numeric className="whitespace-nowrap">{fmtMoney(s.avg_price)}</Td>
                          <Td numeric className="whitespace-nowrap">{fmtMoney(s.list_price)}</Td>
                          <Td numeric className="whitespace-nowrap">{fmtMoney(s.cost)}</Td>
                          <Td numeric className="whitespace-nowrap">{fmtMoney(s.cogs)}</Td>
                          <Td numeric className="whitespace-nowrap">{fmtMoney(s.gross_profit)}</Td>
                          <Td numeric className="whitespace-nowrap">{fmtPct(s.gross_margin)}</Td>
                          <Td className="whitespace-nowrap"><Badge variant={classBadgeVariant(s.turnover_class)}>{s.turnover_class ?? '—'}</Badge></Td>
                          <Td className="whitespace-nowrap"><Badge variant={classBadgeVariant(s.revenue_class)}>{s.revenue_class ?? '—'}</Badge></Td>
                          <Td className="whitespace-nowrap"><Badge variant={classBadgeVariant(s.profit_class)}>{s.profit_class ?? '—'}</Badge></Td>
                          <Td numeric className="whitespace-nowrap">{s.stock_available ?? '—'}</Td>
                          <Td numeric className="whitespace-nowrap">{s.coverage_days !== null ? `${s.coverage_days.toFixed(0)}d` : '—'}</Td>
                          <Td className="whitespace-nowrap">{rec ? RECOMMENDATION_LABEL[rec.code] : '—'}</Td>
                          <Td className="whitespace-nowrap"><Badge variant={state.variant}>{state.label}</Badge></Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
              <PanelSection padding="sm" className="flex items-center justify-between text-sm text-fg-muted">
                <span>{snapshots.length} SKUs — página {page + 1} de {totalPages}</span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
                  <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Próxima</Button>
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
