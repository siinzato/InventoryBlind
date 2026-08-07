import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import { Panel, PanelSection, Badge } from '../ui';
import { listRecords } from '../../lib/rcaService';
import { groupByDimension, computeTrend, topConcentration, type RcaDimension, type TrendDirection } from '../../lib/rcaAlgorithm';
import type { RcaRecord } from '../../lib/supabase';

interface TrendAnalysisPanelProps {
  companyId: string;
}

const DIMENSIONS: { value: RcaDimension; label: string }[] = [
  { value: 'location', label: 'Rua / Corredor' },
  { value: 'operator', label: 'Operador' },
  { value: 'cause_category', label: 'Categoria' },
  { value: 'sku', label: 'SKU' },
];

const DIRECTION_META: Record<TrendDirection, { label: string; icon: typeof TrendingUp; variant: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  crescimento: { label: 'Crescimento', icon: TrendingUp, variant: 'warning' },
  estabilidade: { label: 'Estabilidade', icon: Minus, variant: 'neutral' },
  reducao: { label: 'Redução', icon: TrendingDown, variant: 'success' },
  alerta_critico: { label: 'Alerta crítico', icon: AlertTriangle, variant: 'danger' },
};

function Sparkbars({ series }: { series: { period: string; count: number }[] }) {
  if (series.length === 0) return <p className="text-xs text-fg-subtle">Sem série suficiente para o gráfico.</p>;
  const max = Math.max(...series.map(s => s.count), 1);
  return (
    <div className="flex items-end gap-1.5 h-20">
      {series.map(s => (
        <div key={s.period} className="flex flex-col items-center gap-1 flex-1 min-w-0">
          <div className="w-full bg-accent/60 rounded-t" style={{ height: `${(s.count / max) * 100}%`, minHeight: 2 }} title={`${s.period}: ${s.count}`} />
          <p className="text-[10px] text-fg-subtle truncate w-full text-center">{s.period.slice(2)}</p>
        </div>
      ))}
    </div>
  );
}

/** Inteligência histórica: agrupa RcaRecord (já carregado pelo módulo RCA) por dimensão e,
 *  para o bucket selecionado, classifica a tendência comparando a primeira metade da janela
 *  contra a segunda (computeTrend, em rcaAlgorithm.ts) — mesmo dado, nenhuma tabela nova. */
export function TrendAnalysisPanel({ companyId }: TrendAnalysisPanelProps) {
  const [records, setRecords] = useState<RcaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dimension, setDimension] = useState<RcaDimension>('location');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    listRecords(companyId).then(rows => { setRecords(rows); setLoading(false); });
  }, [companyId]);

  const buckets = useMemo(() => groupByDimension(records, dimension).slice(0, 8), [records, dimension]);
  const concentration = useMemo(() => topConcentration(records, dimension), [records, dimension]);

  useEffect(() => { setSelectedKey(buckets[0]?.key ?? null); }, [dimension, buckets.length]);

  const selectedBucket = buckets.find(b => b.key === selectedKey) ?? null;
  const trend = useMemo(
    () => selectedBucket ? computeTrend(records, dimension, selectedBucket.key, selectedBucket.label) : null,
    [records, dimension, selectedBucket]
  );

  if (loading) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando análise de tendência...</PanelSection></Panel>;
  }

  if (records.length === 0) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Nenhuma divergência classificada ainda — a análise de tendência usa o histórico do módulo Root Cause Analysis.</PanelSection></Panel>;
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelSection padding="md">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {DIMENSIONS.map(d => (
              <button
                key={d.value}
                onClick={() => setDimension(d.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  dimension === d.value ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge hover:bg-surface-3'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          {concentration && (
            <p className="text-sm text-fg-muted mb-3">
              <span className="font-medium text-fg">{concentration.label}</span> concentra {concentration.pct.toFixed(0)}% das divergências classificadas.
            </p>
          )}
          <div className="space-y-1">
            {buckets.map(b => (
              <button
                key={b.key}
                onClick={() => setSelectedKey(b.key)}
                className={`w-full flex items-center justify-between gap-3 py-1.5 px-2 rounded-lg text-left border-b border-edge last:border-0 transition-colors ${
                  selectedKey === b.key ? 'bg-surface-3' : 'hover:bg-surface-3/60'
                }`}
              >
                <p className="text-sm text-fg truncate">{b.label}</p>
                <Badge variant="neutral">{b.count}</Badge>
              </button>
            ))}
          </div>
        </PanelSection>
      </Panel>

      {trend && selectedBucket && (
        <Panel>
          <PanelSection padding="md">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-section">{selectedBucket.label}</p>
              <Badge variant={DIRECTION_META[trend.direction].variant}>
                {(() => { const Icon = DIRECTION_META[trend.direction].icon; return <Icon size={12} className="inline mr-1" />; })()}
                {DIRECTION_META[trend.direction].label}
              </Badge>
            </div>
            <Sparkbars series={trend.series} />
            <p className="text-sm text-fg-muted mt-3">{trend.summary}</p>
          </PanelSection>
        </Panel>
      )}
    </div>
  );
}
