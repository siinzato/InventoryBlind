import { useEffect, useState, useCallback } from 'react';
import { GitBranch, ListOrdered, AlertOctagon } from 'lucide-react';
import { Page,
  PageHeader, Panel, PanelSection, Table, Thead, Tr, Th, Td, Stat, StatRow, StatCell,
  ListRow, SegmentedControl, type StatProps, type SegmentedOption,
} from '../ui';
import {
  listRecords, getParetoSummary, getCauseBreakdown, getTrend, RcaFilters,
} from '../../lib/rcaService';
import { CAUSE_LABEL, type RcaDimension, type ParetoBucket, type DimensionBucket } from '../../lib/rcaAlgorithm';
import type { RcaRecord } from '../../lib/supabase';
import { CauseBadge } from './CauseBadge';
import { ParetoChart } from './ParetoChart';
import { RcaFilterBar } from './RcaFilterBar';
import { FiveWhysPanel } from './FiveWhysPanel';

interface RcaDashboardPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
  role: string;
}

const DIMENSIONS: SegmentedOption<RcaDimension>[] = [
  { value: 'operator', label: 'Operador' },
  { value: 'location', label: 'Endereço' },
  { value: 'sku', label: 'SKU' },
  { value: 'supplier', label: 'Fornecedor' },
  { value: 'period', label: 'Período' },
];

function TrendSparkline({ points }: { points: { period: string; count: number }[] }) {
  if (points.length < 2) return <p className="text-xs text-fg-subtle">Dados insuficientes para exibir a tendência ainda.</p>;
  const w = 600, h = 80;
  const max = Math.max(...points.map(p => p.count), 1);
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - (p.count / max) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
      <polyline points={coords} fill="none" className="stroke-accent" strokeWidth="2" />
    </svg>
  );
}

/** Dashboard central do módulo de Root Cause Analysis — transforma as classificações
 *  obrigatórias (RcaClassificationModal, disparado em ImportCountTab/FullChecking/
 *  NFeCountingView) em Pareto de causas, quebras por dimensão e fila de "5 Porquês". */
export function RcaDashboardPage({ companyId, userId, userEmail, role }: RcaDashboardPageProps) {
  const canManage = role === 'owner' || role === 'admin' || role === 'manager';

  const [filters, setFilters] = useState<RcaFilters>({});
  const [records, setRecords] = useState<RcaRecord[]>([]);
  const [pareto, setPareto] = useState<ParetoBucket[]>([]);
  const [trend, setTrend] = useState<{ period: string; count: number }[]>([]);
  const [dimension, setDimension] = useState<RcaDimension>('operator');
  const [breakdown, setBreakdown] = useState<DimensionBucket[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      listRecords(companyId, filters),
      getParetoSummary(companyId, filters),
      getTrend(companyId),
    ]).then(([r, p, t]) => {
      setRecords(r);
      setPareto(p);
      setTrend(t);
      setLoading(false);
    });
  }, [companyId, filters]);

  useEffect(load, [load]);

  useEffect(() => {
    getCauseBreakdown(companyId, dimension, filters).then(setBreakdown);
  }, [companyId, dimension, filters]);

  const distinctSkus = new Set(records.map(r => r.sku).filter(Boolean)).size;
  const topCause = pareto[0] ? CAUSE_LABEL[pareto[0].category] : '—';

  const cards: StatProps[] = [
    { label: 'Divergências Classificadas', value: records.length, icon: <ListOrdered /> },
    {
      label: 'SKUs Afetados',
      value: distinctSkus,
      icon: <AlertOctagon />,
      context: records.length ? `em ${records.length} divergências` : undefined,
    },
    { label: 'Causa Mais Frequente', value: topCause, icon: <GitBranch /> },
  ];

  return (
    <Page>
      <PageHeader
        title="Root Cause Analysis"
        description="Toda divergência fechada vira causa classificada — Pareto de causas, recorrência e 5 Porquês para prevenir, não só registrar."
      />

      <Panel>
        <PanelSection padding="md">
          <RcaFilterBar filters={filters} onChange={setFilters} />
        </PanelSection>
      </Panel>

      {loading ? (
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando Root Cause Analysis...</PanelSection></Panel>
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
              <p className="text-section mb-3">Pareto de Causas (80/20)</p>
              <ParetoChart buckets={pareto} />
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection padding="md">
              <p className="text-section mb-2">Tendência (90 dias)</p>
              <TrendSparkline points={trend} />
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection padding="md" className="space-y-3">
              <div>
                <p className="text-section mb-2">Causas por</p>
                <SegmentedControl
                  label="Dimensão da quebra de causas"
                  options={DIMENSIONS}
                  value={dimension}
                  onChange={setDimension}
                />
              </div>
              <div>
                {breakdown.length === 0 ? (
                  <p className="text-xs text-fg-subtle">Sem dados para essa quebra ainda.</p>
                ) : (
                  breakdown.slice(0, 15).map(b => (
                    <ListRow key={b.key} value={b.count}>
                      <p className="truncate text-sm text-fg">{b.label}</p>
                    </ListRow>
                  ))
                )}
              </div>
            </PanelSection>
          </Panel>

          <FiveWhysPanel companyId={companyId} userId={userId} userEmail={userEmail} canManage={canManage} />

          <Panel>
            <PanelSection padding="sm">
              <p className="text-section">Classificações Recentes ({records.length})</p>
            </PanelSection>
            <div className="overflow-x-auto max-h-96">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Data</Th>
                    <Th>SKU</Th>
                    <Th>Local</Th>
                    <Th>Qtd.</Th>
                    <Th>Causa</Th>
                    <Th>Operador</Th>
                  </Tr>
                </Thead>
                <tbody>
                  {records.slice(0, 100).map(r => (
                    <Tr key={r.id}>
                      <Td>{new Date(r.occurred_at).toLocaleDateString('pt-BR')}</Td>
                      <Td numeric>{r.sku ?? '—'}</Td>
                      <Td numeric>{r.location ?? '—'}</Td>
                      <Td numeric className={r.divergence_qty < 0 ? 'text-red-500' : 'text-amber-500'}>{r.divergence_qty}</Td>
                      <Td><CauseBadge cause={r.cause_category} customLabel={r.custom_cause_label} /></Td>
                      <Td>{r.operator_name ?? '—'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Panel>
        </>
      )}
    </Page>
  );
}
