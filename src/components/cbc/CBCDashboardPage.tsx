import { useEffect, useState, useCallback } from 'react';
import { Gauge, TrendingUp, AlertTriangle, ShieldCheck, RefreshCw, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { PageHeader, Panel, PanelSection, Button } from '../ui';
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

const FILTERS: { id: CBCFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'critical', label: 'Apenas Críticos' },
  { id: 'high_confidence', label: 'Alta Confiança' },
  { id: 'overdue', label: 'Contagem Vencida' },
  { id: 'due_this_week', label: 'Programada Esta Semana' },
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

  const cards = summary ? [
    { label: 'Média Geral', value: summary.avg_confidence, icon: Gauge },
    { label: 'SKUs Avaliados', value: summary.total_scored, icon: ShieldCheck },
    { label: 'Contagem Vencida', value: summary.overdue_count, icon: AlertTriangle },
    { label: 'Programada Esta Semana', value: summary.due_this_week_count, icon: TrendingUp },
  ] : [];

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
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
            <PanelSection padding="md" className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {cards.map(card => (
                <div key={card.label} className="flex items-start gap-2.5">
                  <card.icon size={16} className="text-fg-subtle mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-fg-subtle truncate">{card.label}</p>
                    <p className="text-sm font-semibold text-fg truncate">{card.value}</p>
                  </div>
                </div>
              ))}
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel>
              <PanelSection padding="md">
                <p className="text-section mb-3 flex items-center gap-1.5"><AlertTriangle size={14} className="text-red-500" /> SKUs Mais Críticos</p>
                <div className="space-y-1.5">
                  {critical.length === 0 && <p className="text-xs text-fg-subtle">Nenhum SKU crítico no momento.</p>}
                  {critical.map(row => (
                    <div key={row.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-edge last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-fg truncate">{row.product_name}</p>
                        <p className="text-xs text-fg-subtle">{row.product_sku}</p>
                      </div>
                      <ConfidenceBadge riskLevel={row.risk_level} score={row.confidence_score} />
                    </div>
                  ))}
                </div>
              </PanelSection>
            </Panel>

            <Panel>
              <PanelSection padding="md">
                <p className="text-section mb-3 flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-500" /> SKUs Mais Confiáveis</p>
                <div className="space-y-1.5">
                  {reliable.length === 0 && <p className="text-xs text-fg-subtle">Ainda sem SKUs de alta confiança.</p>}
                  {reliable.map(row => (
                    <div key={row.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-edge last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-fg truncate">{row.product_name}</p>
                        <p className="text-xs text-fg-subtle">{row.product_sku}</p>
                      </div>
                      <ConfidenceBadge riskLevel={row.risk_level} score={row.confidence_score} />
                    </div>
                  ))}
                </div>
              </PanelSection>
            </Panel>
          </div>

          <Panel>
            <PanelSection padding="md">
              <div className="flex flex-wrap gap-2 mb-4">
                {FILTERS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      filter === f.id ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                {filteredRows.length === 0 && <p className="text-xs text-fg-subtle">Nenhum SKU nesse filtro.</p>}
                {filteredRows.map(row => (
                  <div key={row.id} className="flex items-center justify-between gap-3 py-2 border-b border-edge last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg truncate">{row.product_name}</p>
                      <p className="text-xs text-fg-subtle">
                        {row.product_sku} · próxima contagem {new Date(row.next_count_date).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <ConfidenceBadge riskLevel={row.risk_level} score={row.confidence_score} />
                  </div>
                ))}
              </div>
            </PanelSection>
          </Panel>
        </>
      )}
    </div>
  );
}
