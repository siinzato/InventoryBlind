import { useEffect, useState, useCallback } from 'react';
import { Gauge, TrendingUp, AlertTriangle, ShieldCheck, RefreshCw, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Page,
  PageHeader, Panel, PanelSection, Button, Stat, StatRow, StatCell, ListRow,
  SegmentedControl, type StatProps, type SegmentedOption,
} from '../ui';
import {
  getCompanySummary, getCriticalProducts, getMostReliableProducts, getBandMigrations, getScoreTrend,
  listWithFilter, recomputeAllForCompany, CBCFilter, ProductConfidenceRow, CBCCompanySummaryRow, BandMigration, ScoreTrendPoint,
} from '../../lib/cbcService';
import { ConfidenceBadge } from './ConfidenceBadge';

interface CBCDashboardPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
}

const FILTERS: SegmentedOption<CBCFilter>[] = [
  { value: 'all', label: 'Todos' },
  { value: 'critical', label: 'Apenas Críticos' },
  { value: 'high_confidence', label: 'Alta Confiança' },
  { value: 'overdue', label: 'Contagem Vencida' },
  { value: 'due_this_week', label: 'Programada Esta Semana' },
];

function Sparkline({ points }: { points: ScoreTrendPoint[] }) {
  if (points.length < 2) {
    return <p className="text-xs text-fg-subtle">Dados insuficientes para exibir a evolução ainda.</p>;
  }
  const w = 600;
  const h = 80;
  const max = Math.max(...points.map(p => p.avgScore), 100);
  const min = Math.min(...points.map(p => p.avgScore), 0);
  const range = Math.max(1, max - min);
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p.avgScore - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
      <polyline points={coords} fill="none" className="stroke-accent" strokeWidth="2" />
    </svg>
  );
}

export function CBCDashboardPage({ companyId, userId, userEmail }: CBCDashboardPageProps) {
  const [summary, setSummary] = useState<CBCCompanySummaryRow | null>(null);
  const [critical, setCritical] = useState<ProductConfidenceRow[]>([]);
  const [reliable, setReliable] = useState<ProductConfidenceRow[]>([]);
  const [migrations, setMigrations] = useState<BandMigration[]>([]);
  const [trend, setTrend] = useState<ScoreTrendPoint[]>([]);
  const [filter, setFilter] = useState<CBCFilter>('all');
  const [filteredRows, setFilteredRows] = useState<ProductConfidenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  const loadOverview = useCallback(() => {
    setLoading(true);
    Promise.all([
      getCompanySummary(companyId),
      getCriticalProducts(companyId),
      getMostReliableProducts(companyId),
      getBandMigrations(companyId),
      getScoreTrend(companyId),
    ]).then(([s, c, r, m, t]) => {
      setSummary(s);
      setCritical(c);
      setReliable(r);
      setMigrations(m);
      setTrend(t);
      setLoading(false);
    });
  }, [companyId]);

  useEffect(loadOverview, [loadOverview]);

  useEffect(() => {
    listWithFilter(companyId, filter).then(setFilteredRows);
  }, [companyId, filter]);

  const handleRecomputeAll = async () => {
    setRecomputing(true);
    await recomputeAllForCompany(companyId, userId, userEmail);
    loadOverview();
    listWithFilter(companyId, filter).then(setFilteredRows);
    setRecomputing(false);
  };

  const migratedUp = migrations.filter(m => m.direction === 'up').length;
  const migratedDown = migrations.filter(m => m.direction === 'down').length;

  const cards: StatProps[] = summary ? [
    { label: 'Média Geral', value: summary.avg_confidence, icon: <Gauge />, context: 'confidence score' },
    { label: 'SKUs Avaliados', value: summary.total_scored, icon: <ShieldCheck /> },
    {
      label: 'Contagem Vencida',
      value: summary.overdue_count,
      icon: <AlertTriangle />,
      context: summary.total_scored ? `de ${summary.total_scored} SKUs` : undefined,
    },
    { label: 'Programada Esta Semana', value: summary.due_this_week_count, icon: <TrendingUp /> },
  ] : [];

  return (
    <Page>
      <PageHeader
        title="Confidence Based Counting (CBC)"
        description="Prioriza a próxima contagem de cada SKU por um Confidence Score, em vez de ciclos fixos."
        actions={
          <Button variant="secondary" onClick={handleRecomputeAll} disabled={recomputing}>
            <RefreshCw size={15} className={recomputing ? 'animate-spin' : ''} /> {recomputing ? 'Recalculando...' : 'Recalcular Tudo'}
          </Button>
        }
      />

      {loading ? (
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando CBC...</PanelSection></Panel>
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

          <Panel>
            <PanelSection padding="md">
              <div className="flex items-center justify-between mb-2">
                <p className="text-section">Evolução do Score (30 dias)</p>
                <div className="flex items-center gap-3 text-xs text-fg-subtle">
                  <span className="flex items-center gap-1 text-emerald-500"><ArrowUpRight size={12} /> {migratedUp} subiram de faixa</span>
                  <span className="flex items-center gap-1 text-red-500"><ArrowDownRight size={12} /> {migratedDown} caíram de faixa</span>
                </div>
              </div>
              <Sparkline points={trend} />
            </PanelSection>
          </Panel>

          {/* Two related rankings read as ONE grouped surface split by a hairline,
              not as two bordered cards sitting next to each other. */}
          <Panel>
            <PanelSection padding="md" className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-0 lg:divide-x lg:divide-edge">
              <div className="lg:pr-6">
                <p className="text-section mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={13} className="text-red-500" /> SKUs Mais Críticos
                </p>
                {critical.length === 0 ? (
                  <p className="text-xs text-fg-subtle">Nenhum SKU crítico no momento.</p>
                ) : (
                  critical.map(row => (
                    <ListRow
                      key={row.id}
                      value={<ConfidenceBadge riskLevel={row.risk_level} score={row.confidence_score} />}
                    >
                      <p className="truncate text-sm font-medium text-fg">{row.product_name}</p>
                      <p className="text-caption">{row.product_sku}</p>
                    </ListRow>
                  ))
                )}
              </div>

              <div className="lg:pl-6">
                <p className="text-section mb-2 flex items-center gap-1.5">
                  <ShieldCheck size={13} className="text-emerald-500" /> SKUs Mais Confiáveis
                </p>
                {reliable.length === 0 ? (
                  <p className="text-xs text-fg-subtle">Ainda sem SKUs de alta confiança.</p>
                ) : (
                  reliable.map(row => (
                    <ListRow
                      key={row.id}
                      value={<ConfidenceBadge riskLevel={row.risk_level} score={row.confidence_score} />}
                    >
                      <p className="truncate text-sm font-medium text-fg">{row.product_name}</p>
                      <p className="text-caption">{row.product_sku}</p>
                    </ListRow>
                  ))
                )}
              </div>
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection padding="md">
              <div className="mb-4">
                <SegmentedControl label="Filtro de SKUs" options={FILTERS} value={filter} onChange={setFilter} />
              </div>
              {filteredRows.length === 0 ? (
                <p className="text-xs text-fg-subtle">Nenhum SKU nesse filtro.</p>
              ) : (
                filteredRows.map(row => (
                  <ListRow
                    key={row.id}
                    value={<ConfidenceBadge riskLevel={row.risk_level} score={row.confidence_score} />}
                  >
                    <p className="truncate text-sm font-medium text-fg">{row.product_name}</p>
                    <p className="text-caption">
                      {row.product_sku} · próxima contagem {new Date(row.next_count_date).toLocaleDateString('pt-BR')}
                    </p>
                  </ListRow>
                ))
              )}
            </PanelSection>
          </Panel>
        </>
      )}
    </Page>
  );
}
