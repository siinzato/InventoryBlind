import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Badge, Modal, Table, Thead, Tr, Th, Td } from '../ui';
import { getAnalyticsRawData } from '../../lib/analytics/analyticsDataService';
import { computeHealthIndicators } from '../../lib/analytics/inventoryHealthEngine';
import {
  INDICATOR_STATUS_LABEL, INDICATOR_STATUS_BADGE, isAvailable,
  type HealthIndicator, type HealthIndicatorDrill,
} from '../../lib/analytics/analyticsContracts';
import { listRecords as listRcaRecords } from '../../lib/rcaService';
import { groupByDimension, type DimensionBucket } from '../../lib/rcaAlgorithm';
import { listWithFilter, type ProductAbcXyzRow } from '../../lib/abcXyzService';

interface InventoryHealthPageProps {
  companyId: string;
}

type DrillState =
  | { open: false }
  | { open: true; title: string; loading: true }
  | { open: true; title: string; loading: false; kind: 'dimension'; rows: DimensionBucket[] }
  | { open: true; title: string; loading: false; kind: 'abcxyz'; rows: ProductAbcXyzRow[] };

async function loadDrill(companyId: string, indicator: HealthIndicator, drill: HealthIndicatorDrill): Promise<DrillState> {
  if (drill.kind === 'recurrence') {
    const records = await listRcaRecords(companyId, { recurringOnly: true });
    return { open: true, title: 'SKUs reincidentes', loading: false, kind: 'dimension', rows: groupByDimension(records, 'sku') };
  }
  if (drill.kind === 'location') {
    const records = await listRcaRecords(companyId, { location: drill.location });
    return { open: true, title: `SKUs mais afetados em ${drill.location}`, loading: false, kind: 'dimension', rows: groupByDimension(records, 'sku') };
  }
  // abcxyz_risk
  const rows = (await Promise.all(drill.combos.map(combo => listWithFilter(companyId, `combo:${combo}`)))).flat();
  rows.sort((a, b) => b.value_moved - a.value_moved);
  return { open: true, title: indicator.label, loading: false, kind: 'abcxyz', rows: rows.slice(0, 100) };
}

/** Inventory Health — "por que o estoque está nessa situação", granular por indicador
 *  (computeHealthIndicators, mesmos fatores do BlindScore). Indicadores clicáveis abrem o
 *  drill-down real (SKUs/localizações por trás do número), nunca um placeholder. */
export function InventoryHealthPage({ companyId }: InventoryHealthPageProps) {
  const [indicators, setIndicators] = useState<HealthIndicator[]>([]);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<DrillState>({ open: false });

  useEffect(() => {
    setLoading(true);
    getAnalyticsRawData(companyId).then(raw => {
      setIndicators(computeHealthIndicators(raw));
      setLoading(false);
    });
  }, [companyId]);

  function openDrill(indicator: HealthIndicator) {
    if (!indicator.drill) return;
    setDrill({ open: true, title: indicator.label, loading: true });
    loadDrill(companyId, indicator, indicator.drill).then(setDrill);
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics"
        title="Inventory Health"
        description="Diagnóstico detalhado da saúde do estoque — cada indicador mostra o dado real por trás dele, ou o motivo pelo qual ainda não pode ser calculado."
      />

      {loading ? (
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando indicadores...</PanelSection></Panel>
      ) : (
        <Panel>
          <div className="divide-y divide-edge">
            {indicators.map(ind => {
              const clickable = !!ind.drill;
              const Wrapper = clickable ? 'button' : 'div';
              return (
                <Wrapper
                  key={ind.key}
                  onClick={clickable ? () => openDrill(ind) : undefined}
                  className={`w-full flex items-center justify-between gap-4 px-5 py-4 text-left ${clickable ? 'hover:bg-surface-3/60 transition-colors' : ''}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{ind.label}</p>
                    <p className="text-xs text-fg-subtle mt-0.5">{ind.detail}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <p className="font-display text-lg font-semibold tabular-nums text-fg">
                      {isAvailable(ind.metric) ? `${ind.metric.value}${ind.unit === '%' ? '%' : ''}` : '—'}
                    </p>
                    <Badge variant={INDICATOR_STATUS_BADGE[ind.status]}>{INDICATOR_STATUS_LABEL[ind.status]}</Badge>
                    {clickable && <ChevronRight size={16} className="text-fg-subtle" />}
                  </div>
                </Wrapper>
              );
            })}
          </div>
        </Panel>
      )}

      <Modal open={drill.open} onClose={() => setDrill({ open: false })} title={drill.open ? drill.title : undefined} maxWidth="max-w-2xl">
        {drill.open && drill.loading && <p className="text-sm text-fg-subtle">Carregando...</p>}
        {drill.open && !drill.loading && drill.kind === 'dimension' && (
          drill.rows.length === 0 ? (
            <p className="text-sm text-fg-subtle">Nenhum registro encontrado.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <Thead><Tr><Th>SKU</Th><Th>Ocorrências</Th></Tr></Thead>
                <tbody>
                  {drill.rows.slice(0, 100).map(r => (
                    <Tr key={r.key}><Td className="font-mono text-xs">{r.label}</Td><Td>{r.count}</Td></Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )
        )}
        {drill.open && !drill.loading && drill.kind === 'abcxyz' && (
          drill.rows.length === 0 ? (
            <p className="text-sm text-fg-subtle">Nenhum SKU encontrado nessas combinações.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <Thead><Tr><Th>SKU</Th><Th>Produto</Th><Th>Classe</Th><Th>Valor Movimentado</Th></Tr></Thead>
                <tbody>
                  {drill.rows.map(r => (
                    <Tr key={r.product_id}>
                      <Td className="font-mono text-xs">{r.product_sku}</Td>
                      <Td className="truncate max-w-[220px]">{r.product_name}</Td>
                      <Td>{r.abc_xyz_class}</Td>
                      <Td className="tabular-nums">{r.value_moved.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )
        )}
      </Modal>
    </Page>
  );
}
