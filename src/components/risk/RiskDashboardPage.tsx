import { useEffect, useState, useCallback } from 'react';
import { AlertOctagon, Gauge, RefreshCw, ArrowUpRight, ArrowDownRight, ListOrdered, MapPin } from 'lucide-react';
import { Page,
  PageHeader, Panel, PanelSection, Button, Stat, StatRow, StatCell, SegmentedControl,
  type StatProps, type SegmentedOption,
} from '../ui';
import {
  getCompanyRiskSummary, getTop50Critical, getRiskBandMigrations, getRiskTrend,
  listRiskWithFilter, recomputeAllRiskForCompany, RiskFilter, ProductRiskRow, RiskCompanySummaryRow, RiskBandMigration, RiskTrendPoint,
} from '../../lib/riskService';
import { RiskBadge } from './RiskBadge';

interface RiskDashboardPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
}

const FILTERS: SegmentedOption<RiskFilter>[] = [
  { value: 'all', label: 'Todos' },
  { value: 'critico', label: 'Risco Crítico' },
  { value: 'alto', label: 'Alto Risco' },
  { value: 'medio', label: 'Médio' },
  { value: 'baixo', label: 'Baixo' },
  { value: 'priority_queue', label: 'Contagem Prioritária' },
];

function Sparkline({ points }: { points: RiskTrendPoint[] }) {
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
      <polyline points={coords} fill="none" className="stroke-red-500" strokeWidth="2" />
    </svg>
  );
}

export function RiskDashboardPage({ companyId, userId, userEmail }: RiskDashboardPageProps) {
  const [summary, setSummary] = useState<RiskCompanySummaryRow | null>(null);
  const [top50, setTop50] = useState<ProductRiskRow[]>([]);
  const [migrations, setMigrations] = useState<RiskBandMigration[]>([]);
  const [trend, setTrend] = useState<RiskTrendPoint[]>([]);
  const [filter, setFilter] = useState<RiskFilter>('all');
  const [filteredRows, setFilteredRows] = useState<ProductRiskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  const loadOverview = useCallback(() => {
    setLoading(true);
    Promise.all([
      getCompanyRiskSummary(companyId),
      getTop50Critical(companyId),
      getRiskBandMigrations(companyId),
      getRiskTrend(companyId),
    ]).then(([s, top, m, t]) => {
      setSummary(s);
      setTop50(top);
      setMigrations(m);
      setTrend(t);
      setLoading(false);
    });
  }, [companyId]);

  useEffect(loadOverview, [loadOverview]);

  useEffect(() => {
    listRiskWithFilter(companyId, filter).then(setFilteredRows);
  }, [companyId, filter]);

  const handleRecomputeAll = async () => {
    setRecomputing(true);
    await recomputeAllRiskForCompany(companyId, userId, userEmail);
    loadOverview();
    listRiskWithFilter(companyId, filter).then(setFilteredRows);
    setRecomputing(false);
  };

  const worsened = migrations.filter(m => m.direction === 'up').length;
  const improved = migrations.filter(m => m.direction === 'down').length;

  const cards: StatProps[] = summary ? [
    { label: 'Risco Médio', value: summary.avg_risk, icon: <Gauge />, context: 'score 0–100' },
    { label: 'SKUs Avaliados', value: summary.total_scored, icon: <ListOrdered /> },
    {
      label: 'Risco Crítico',
      value: summary.critico_count,
      icon: <AlertOctagon />,
      context: summary.total_scored ? `de ${summary.total_scored} SKUs` : undefined,
    },
    {
      label: 'Alto Risco',
      value: summary.alto_count,
      icon: <AlertOctagon />,
      context: summary.total_scored ? `de ${summary.total_scored} SKUs` : undefined,
    },
  ] : [];

  return (
    <Page>
      <PageHeader
        title="Inventário por Risco"
        description="Prioriza a contagem de cada SKU por um Risk Score, combinando risco e proximidade física em vez de só endereço."
        actions={
          <Button variant="secondary" onClick={handleRecomputeAll} disabled={recomputing}>
            <RefreshCw size={15} className={recomputing ? 'animate-spin' : ''} /> {recomputing ? 'Recalculando...' : 'Recalcular Tudo'}
          </Button>
        }
      />

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

          <Panel>
            <PanelSection padding="md">
              <div className="flex items-center justify-between mb-2">
                <p className="text-section">Evolução do Risco (30 dias)</p>
                <div className="flex items-center gap-3 text-xs text-fg-subtle">
                  <span className="flex items-center gap-1 text-red-500"><ArrowUpRight size={12} /> {worsened} pioraram de faixa</span>
                  <span className="flex items-center gap-1 text-emerald-500"><ArrowDownRight size={12} /> {improved} melhoraram de faixa</span>
                </div>
              </div>
              <Sparkline points={trend} />
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection padding="md">
              <p className="text-section mb-3 flex items-center gap-1.5"><AlertOctagon size={14} className="text-red-500" /> Ranking dos 50 SKUs Mais Críticos</p>
              <div className="space-y-1">
                {top50.length === 0 && <p className="text-xs text-fg-subtle">Nenhum SKU avaliado ainda.</p>}
                {top50.map((row, i) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-edge last:border-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-xs text-fg-subtle w-6 flex-shrink-0">{i + 1}º</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-fg truncate">{row.product_name}</p>
                        <p className="text-xs text-fg-subtle">{row.product_sku}</p>
                      </div>
                    </div>
                    <RiskBadge riskLevel={row.risk_level} score={row.risk_score} />
                  </div>
                ))}
              </div>
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection padding="md">
              <div className="mb-4">
                <SegmentedControl
                  label="Filtro de risco"
                  options={FILTERS}
                  value={filter}
                  onChange={setFilter}
                />
              </div>
              {filter === 'priority_queue' && (
                <p className="text-xs text-fg-subtle mb-3">
                  Fila inteligente: prioriza por faixa de risco e agrupa por localização dentro de cada faixa, para reduzir deslocamento.
                </p>
              )}
              <div className="space-y-1">
                {filteredRows.length === 0 && <p className="text-xs text-fg-subtle">Nenhum SKU nesse filtro.</p>}
                {filteredRows.map((row, i) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 py-2 border-b border-edge last:border-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {filter === 'priority_queue' && <span className="text-xs text-fg-subtle w-6 flex-shrink-0">{i + 1}º</span>}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-fg truncate">{row.product_name}</p>
                        <p className="text-xs text-fg-subtle flex items-center gap-1">
                          {row.product_sku}
                          {row.product_location && (
                            <span className="flex items-center gap-0.5"><MapPin size={10} /> {row.product_location}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <RiskBadge riskLevel={row.risk_level} score={row.risk_score} />
                  </div>
                ))}
              </div>
            </PanelSection>
          </Panel>
        </>
      )}
    </Page>
  );
}
