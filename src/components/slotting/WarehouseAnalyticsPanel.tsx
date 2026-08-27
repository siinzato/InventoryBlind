import { useEffect, useState } from 'react';
import { Panel, PanelSection, Badge, ListRow, StatRow, StatCell, Stat } from '../ui';
import { listRecords } from '../../lib/rcaService';
import { groupByDimension, type DimensionBucket } from '../../lib/rcaAlgorithm';
import { getMatrixCounts } from '../../lib/abcXyzService';
import { getCompanySummary, type CBCCompanySummaryRow } from '../../lib/cbcService';
import type { AbcXyzCombo } from '../../lib/supabase';
import { ClassificationMatrix } from '../abcxyz/ClassificationMatrix';

interface WarehouseAnalyticsPanelProps {
  companyId: string;
}

/** Consolida três leituras já existentes (RCA agrupado por endereço, matriz ABC/XYZ,
 *  resumo CBC) numa única aba — nenhuma fórmula nova, só composição de dados já
 *  calculados por outros módulos; exatamente o ponto de integração para o qual o RCA foi
 *  desenhado (getCauseCountsForProducts/groupByDimension). */
export function WarehouseAnalyticsPanel({ companyId }: WarehouseAnalyticsPanelProps) {
  const [byLocation, setByLocation] = useState<DimensionBucket[]>([]);
  const [matrix, setMatrix] = useState<Record<AbcXyzCombo, { count: number; value: number }> | null>(null);
  const [cbcSummary, setCbcSummary] = useState<CBCCompanySummaryRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      listRecords(companyId).then(records => groupByDimension(records, 'location')),
      getMatrixCounts(companyId),
      getCompanySummary(companyId),
    ]).then(([locations, matrixCounts, summary]) => {
      setByLocation(locations);
      setMatrix(matrixCounts);
      setCbcSummary(summary);
      setLoading(false);
    });
  }, [companyId]);

  if (loading) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando analytics...</PanelSection></Panel>;
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelSection padding="md">
          <p className="text-section mb-3">Divergências por Endereço</p>
          <div>
            {byLocation.length === 0 && <p className="text-xs text-fg-subtle">Nenhuma divergência classificada ainda.</p>}
            {byLocation.slice(0, 10).map(b => (
              <ListRow key={b.key} value={<Badge variant="neutral">{b.count}</Badge>}>
                <p className="truncate text-sm text-fg">{b.label}</p>
              </ListRow>
            ))}
          </div>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md">
          <p className="text-section mb-3">Matriz ABC/XYZ</p>
          {matrix && <ClassificationMatrix counts={matrix} selected={null} onSelect={() => {}} />}
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md">
          <StatRow>
            <StatCell><Stat label="Confidence Médio" value={`${cbcSummary ? Math.round(cbcSummary.avg_confidence) : 0}%`} /></StatCell>
            <StatCell><Stat label="SKUs Avaliados" value={cbcSummary?.total_scored ?? 0} /></StatCell>
            <StatCell><Stat label="Atrasados" value={cbcSummary?.overdue_count ?? 0} /></StatCell>
            <StatCell><Stat label="Devidos essa semana" value={cbcSummary?.due_this_week_count ?? 0} /></StatCell>
          </StatRow>
        </PanelSection>
      </Panel>
    </div>
  );
}
