import { useEffect, useMemo, useState } from 'react';
import { Panel, PanelSection, Badge, ListRow, StatRow, StatCell, Stat } from '../ui';
import { listRecords } from '../../lib/rcaService';
import { groupByDimension, type DimensionBucket } from '../../lib/rcaAlgorithm';
import { getMatrixCounts } from '../../lib/abcXyzService';
import { getCompanySummary, type CBCCompanySummaryRow } from '../../lib/cbcService';
import { computeOccupancySummary } from '../../lib/warehouseOperationalSummary';
import type { AbcXyzCombo, WarehouseLayout, WarehouseCell, WarehouseZone, LocationLiveStatus } from '../../lib/supabase';
import { ClassificationMatrix } from '../abcxyz/ClassificationMatrix';

interface WarehouseAnalyticsPanelProps {
  companyId: string;
  /** Presentes só quando chamado a partir do Warehouse Digital Twin — habilitam a seção
   *  "Ocupação por zona / cobertura do mapeamento", derivada do que a própria página já
   *  carregou (nenhuma query nova aqui). */
  layout?: WarehouseLayout | null;
  cells?: WarehouseCell[];
  zones?: WarehouseZone[];
  liveData?: Map<string, LocationLiveStatus>;
}

/** Consolida três leituras já existentes (RCA agrupado por endereço, matriz ABC/XYZ,
 *  resumo CBC) numa única aba — nenhuma fórmula nova, só composição de dados já
 *  calculados por outros módulos; exatamente o ponto de integração para o qual o RCA foi
 *  desenhado (getCauseCountsForProducts/groupByDimension). */
export function WarehouseAnalyticsPanel({ companyId, layout, cells = [], zones = [], liveData }: WarehouseAnalyticsPanelProps) {
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

  const twinMetrics = useMemo(() => {
    if (!layout || !liveData) return null;

    const positionCells = cells.filter(c => c.cell_type === 'posicao');
    const linked = positionCells.filter(c => !!c.location_code);
    const coveragePct = positionCells.length > 0 ? (linked.length / positionCells.length) * 100 : 0;
    const withoutActivity = linked.filter(c => (liveData.get(c.location_code as string)?.pickCount ?? 0) === 0).length;

    const byZone = zones.map(zone => {
      const inZone = positionCells.filter(c => c.x >= zone.min_x && c.x <= zone.max_x && c.y >= zone.min_y && c.y <= zone.max_y && !!c.location_code);
      const summary = computeOccupancySummary(inZone, liveData);
      return { zone, occupancyPct: summary?.pct ?? null };
    });

    return { coveragePct, withoutActivity, byZone };
  }, [layout, cells, zones, liveData]);

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
            <StatCell><Stat label="Confidence Médio" value={`${cbcSummary?.avg_confidence != null ? Math.round(cbcSummary.avg_confidence) : 0}%`} /></StatCell>
            <StatCell><Stat label="SKUs Avaliados" value={cbcSummary?.total_scored ?? 0} /></StatCell>
            <StatCell><Stat label="Atrasados" value={cbcSummary?.overdue_count ?? 0} /></StatCell>
            <StatCell><Stat label="Devidos essa semana" value={cbcSummary?.due_this_week_count ?? 0} /></StatCell>
          </StatRow>
        </PanelSection>
      </Panel>

      {twinMetrics && (
        <Panel>
          <PanelSection padding="md">
            <StatRow>
              <StatCell><Stat label="Cobertura do mapeamento" value={`${Math.round(twinMetrics.coveragePct)}%`} context="Posições desenhadas com endereço vinculado" /></StatCell>
              <StatCell><Stat label="Endereços sem atividade" value={twinMetrics.withoutActivity} context="Vinculados, sem nenhum pick no período" /></StatCell>
            </StatRow>
          </PanelSection>
          {twinMetrics.byZone.length > 0 && (
            <PanelSection padding="md">
              <p className="text-section mb-3">Ocupação por zona</p>
              {twinMetrics.byZone.map(({ zone, occupancyPct }) => (
                <ListRow key={zone.id} value={<Badge variant="neutral">{occupancyPct != null ? `${Math.round(occupancyPct)}%` : '—'}</Badge>}>
                  <p className="text-sm text-fg">{zone.name}</p>
                </ListRow>
              ))}
            </PanelSection>
          )}
        </Panel>
      )}
    </div>
  );
}
