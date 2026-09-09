// Curva ABC — bloco de comparação com um período anterior. Acrescenta leitura à Visão geral
// sem desmontar a composição da Fase 1: entra DEPOIS do resumo comercial e antes do Pareto.
//
// Duas decisões de honestidade guiam o componente:
//  1. Durações diferentes não são comparáveis em valor absoluto. Quando os períodos divergem,
//     a leitura principal passa a ser por dia e um aviso discreto diz por quê — os absolutos
//     continuam visíveis, marcados como não equivalentes.
//  2. Cobertura de dado varia em PONTOS PERCENTUAIS, e fica num bloco próprio: subir a
//     cobertura de custo é qualidade de cadastro, não crescimento comercial.

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Badge, Button, Modal, Panel, PanelSection, Select, Table, Thead, Tr, Th, Td, SegmentedControl } from '../ui';
import { ABC_METRIC_OPTIONS, ABC_METRIC_LABEL, type AbcMetric, type AbcRow } from '../../lib/abcCurve/abcCurveAnalytics';
import {
  buildAnalysisComparison, buildClassCountDeltas, buildClassTransitions,
  TRANSITION_BUCKET_LABEL, type ComparableAnalysis, type MetricDelta, type TransitionBucket,
} from '../../lib/abcCurve/abcCurveComparison';

interface AbcComparisonPanelProps {
  current: ComparableAnalysis;
  baseline: ComparableAnalysis | null;
  baselineOptions: ComparableAnalysis[];
  baselineId: string;
  onBaselineChange: (id: string) => void;
  currentRows: AbcRow[];
  baselineRows: AbcRow[];
  loading: boolean;
  metric: AbcMetric;
  onMetricChange: (metric: AbcMetric) => void;
}

const fmtMoney = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtInt = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtDecimal = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/** Indicador pequeno ao lado do número — nunca colore o bloco inteiro. Sem base de comparação
 *  (baseline zero), mostra a diferença absoluta em vez de um percentual inventado. */
function DeltaTag({ delta, format }: { delta: MetricDelta; format: (v: number) => string }) {
  const positive = delta.abs > 0;
  const flat = delta.abs === 0;
  const tone = flat ? 'text-fg-subtle' : positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  const sign = positive ? '+' : '';
  return (
    <span className={`text-xs font-medium tabular-nums ${tone}`}>
      {delta.pct !== null ? `${sign}${fmtDecimal(delta.pct)}%` : `${sign}${format(delta.abs)}`}
    </span>
  );
}

function PointsTag({ points }: { points: number | null }) {
  if (points === null) return <span className="text-xs text-fg-subtle">—</span>;
  const tone = points === 0 ? 'text-fg-subtle' : points > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  return (
    <span className={`text-xs font-medium tabular-nums ${tone}`}>
      {points > 0 ? '+' : ''}{fmtDecimal(points)} p.p.
    </span>
  );
}

function ComparedValue({ label, value, delta, format, context }: {
  label: string; value: string; delta: MetricDelta; format: (v: number) => string; context?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-label truncate">{label}</p>
      <p className="mt-0.5 truncate font-display text-lg font-semibold tabular-nums tracking-tight text-fg">{value}</p>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
        <DeltaTag delta={delta} format={format} />
        <span className="text-caption truncate">{context ?? `de ${format(delta.baseline)}`}</span>
      </div>
    </div>
  );
}

export function AbcComparisonPanel({
  current, baseline, baselineOptions, baselineId, onBaselineChange,
  currentRows, baselineRows, loading, metric, onMetricChange,
}: AbcComparisonPanelProps) {
  const [openBucket, setOpenBucket] = useState<TransitionBucket | null>(null);

  const comparison = useMemo(
    () => (baseline ? buildAnalysisComparison(current, baseline, currentRows, baselineRows) : null),
    [current, baseline, currentRows, baselineRows],
  );
  const classDeltas = useMemo(
    () => (baseline ? buildClassCountDeltas(currentRows, baselineRows) : []),
    [baseline, currentRows, baselineRows],
  );
  const transitions = useMemo(
    () => (baseline ? buildClassTransitions(currentRows, baselineRows, metric) : null),
    [baseline, currentRows, baselineRows, metric],
  );

  const buckets: { key: TransitionBucket; count: number }[] = transitions
    ? [
        { key: 'upToA', count: transitions.upToA.length },
        { key: 'outOfA', count: transitions.outOfA.length },
        { key: 'newInCurrent', count: transitions.newInCurrent.length },
        { key: 'absentInCurrent', count: transitions.absentInCurrent.length },
      ]
    : [];

  const openRows = openBucket && transitions ? transitions[openBucket] : [];
  const perDay = comparison !== null && !comparison.sameDuration;

  return (
    <Panel>
      <PanelSection padding="md" className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-section">Comparação com período</p>
          <p className="text-caption mt-0.5">
            {baseline
              ? `${baseline.name} — ${baseline.salesPeriodStart} a ${baseline.salesPeriodEnd}`
              : baselineOptions.length === 0
                ? 'Não há análise anterior publicada neste workspace.'
                : 'Escolha uma análise anterior para comparar.'}
          </p>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-label whitespace-nowrap">Comparar com</span>
          <Select value={baselineId} onChange={e => onBaselineChange(e.target.value)} className="max-w-xs" aria-label="Comparar com">
            <option value="">Nenhuma</option>
            {baselineOptions.map(a => (
              <option key={a.id} value={a.id}>{a.name} — {a.salesPeriodStart} a {a.salesPeriodEnd}</option>
            ))}
          </Select>
        </label>
      </PanelSection>

      {baseline && loading && (
        <PanelSection padding="md" className="text-sm text-fg-subtle">Carregando os SKUs da análise comparada...</PanelSection>
      )}

      {baseline && !loading && comparison && (
        <>
          {!comparison.sameDuration && (
            <PanelSection padding="sm" className="text-caption">
              Períodos com durações diferentes ({fmtInt(comparison.currentDays)} dias contra {fmtInt(comparison.baselineDays)}).
              A leitura principal abaixo é por dia; os totais do período continuam visíveis, mas não são diretamente equivalentes.
            </PanelSection>
          )}

          <PanelSection padding="md" className="grid grid-cols-2 gap-x-6 gap-y-5 lg:flex lg:gap-0 lg:divide-x lg:divide-edge">
            {perDay ? (
              <>
                <div className="min-w-0 lg:flex-1 lg:px-5 lg:first:pl-0 lg:last:pr-0">
                  <ComparedValue label="Faturamento/dia" value={fmtMoney(comparison.revenuePerDay.current)} delta={comparison.revenuePerDay} format={fmtMoney} />
                </div>
                <div className="min-w-0 lg:flex-1 lg:px-5 lg:first:pl-0 lg:last:pr-0">
                  <ComparedValue label="Lucro observado/dia" value={fmtMoney(comparison.profitPerDay.current)} delta={comparison.profitPerDay} format={fmtMoney} />
                </div>
                <div className="min-w-0 lg:flex-1 lg:px-5 lg:first:pl-0 lg:last:pr-0">
                  <ComparedValue label="Unidades/dia" value={fmtDecimal(comparison.quantityPerDay.current)} delta={comparison.quantityPerDay} format={fmtDecimal} />
                </div>
              </>
            ) : (
              <>
                <div className="min-w-0 lg:flex-1 lg:px-5 lg:first:pl-0 lg:last:pr-0">
                  <ComparedValue label="Faturamento" value={fmtMoney(comparison.revenue.current)} delta={comparison.revenue} format={fmtMoney} />
                </div>
                <div className="min-w-0 lg:flex-1 lg:px-5 lg:first:pl-0 lg:last:pr-0">
                  <ComparedValue label="Lucro bruto observado" value={fmtMoney(comparison.profit.current)} delta={comparison.profit} format={fmtMoney} />
                </div>
                <div className="min-w-0 lg:flex-1 lg:px-5 lg:first:pl-0 lg:last:pr-0">
                  <ComparedValue label="Unidades vendidas" value={fmtInt(comparison.quantity.current)} delta={comparison.quantity} format={fmtInt} />
                </div>
              </>
            )}
            <div className="min-w-0 lg:flex-1 lg:px-5 lg:first:pl-0 lg:last:pr-0">
              <ComparedValue label="SKUs analisados" value={fmtInt(comparison.skuCount.current)} delta={comparison.skuCount} format={fmtInt} />
            </div>
            <div className="min-w-0 lg:flex-1 lg:px-5 lg:first:pl-0 lg:last:pr-0">
              <ComparedValue label="Classe A por faturamento" value={fmtInt(comparison.classAByRevenue.current)} delta={comparison.classAByRevenue} format={fmtInt} context={`de ${fmtInt(comparison.classAByRevenue.baseline)} SKUs`} />
            </div>
          </PanelSection>

          {perDay && (
            <PanelSection padding="sm" className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
              <span className="text-fg-subtle">Totais do período (durações diferentes):</span>
              <span className="text-fg">Faturamento {fmtMoney(comparison.revenue.current)} <span className="text-fg-subtle">de {fmtMoney(comparison.revenue.baseline)}</span></span>
              <span className="text-fg">Lucro {fmtMoney(comparison.profit.current)} <span className="text-fg-subtle">de {fmtMoney(comparison.profit.baseline)}</span></span>
              <span className="text-fg">Unidades {fmtInt(comparison.quantity.current)} <span className="text-fg-subtle">de {fmtInt(comparison.quantity.baseline)}</span></span>
            </PanelSection>
          )}

          {/* Qualidade do dado, separada do desempenho comercial e em pontos percentuais. */}
          <PanelSection padding="md">
            <p className="text-label mb-2">Qualidade do dado comparada</p>
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-fg-subtle">Cobertura de custo</span>
                <span className="text-sm tabular-nums text-fg">{current.costCoveragePct !== null ? `${fmtDecimal(current.costCoveragePct)}%` : '—'}</span>
                <PointsTag points={comparison.costCoveragePoints} />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-fg-subtle">Cobertura de estoque</span>
                <span className="text-sm tabular-nums text-fg">{current.stockCoveragePct !== null ? `${fmtDecimal(current.stockCoveragePct)}%` : 'Sem snapshot'}</span>
                <PointsTag points={comparison.stockCoveragePoints} />
              </div>
            </div>
          </PanelSection>

          <PanelSection padding="md" className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-section">Mudança na classificação</p>
              <p className="text-caption mt-0.5">Número de SKUs por classe, agora e no período comparado.</p>
            </div>
            <SegmentedControl label="Curva das movimentações" value={metric} onChange={onMetricChange} options={ABC_METRIC_OPTIONS} />
          </PanelSection>
          <div className="overflow-x-auto">
            <Table className="min-w-max">
              <Thead>
                <Tr>
                  <Th className="whitespace-nowrap">Curva</Th>
                  <Th className="whitespace-nowrap">A atual</Th>
                  <Th className="whitespace-nowrap">A anterior</Th>
                  <Th className="whitespace-nowrap">Δ A</Th>
                  <Th className="whitespace-nowrap">B atual</Th>
                  <Th className="whitespace-nowrap">B anterior</Th>
                  <Th className="whitespace-nowrap">Δ B</Th>
                  <Th className="whitespace-nowrap">C atual</Th>
                  <Th className="whitespace-nowrap">C anterior</Th>
                  <Th className="whitespace-nowrap">Δ C</Th>
                </Tr>
              </Thead>
              <tbody>
                {classDeltas.map(row => (
                  <Tr key={row.metric}>
                    <Td className="whitespace-nowrap">{row.label}</Td>
                    <Td numeric>{fmtInt(row.a.current)}</Td>
                    <Td numeric>{fmtInt(row.a.baseline)}</Td>
                    <Td numeric>{row.a.abs > 0 ? '+' : ''}{fmtInt(row.a.abs)}</Td>
                    <Td numeric>{fmtInt(row.b.current)}</Td>
                    <Td numeric>{fmtInt(row.b.baseline)}</Td>
                    <Td numeric>{row.b.abs > 0 ? '+' : ''}{fmtInt(row.b.abs)}</Td>
                    <Td numeric>{fmtInt(row.c.current)}</Td>
                    <Td numeric>{fmtInt(row.c.baseline)}</Td>
                    <Td numeric>{row.c.abs > 0 ? '+' : ''}{fmtInt(row.c.abs)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>

          {transitions && (
            <PanelSection padding="md">
              <p className="text-section">Movimentações relevantes</p>
              <p className="text-caption mt-0.5 mb-3">
                Curva de {ABC_METRIC_LABEL[metric].toLowerCase()}, casando SKU a SKU — {fmtInt(transitions.matchedCount)} SKUs
                aparecem nas duas análises. &quot;Novo&quot; e &quot;ausente&quot; dizem respeito à presença nos arquivos comparados,
                não a cadastro de produto.
              </p>
              <div className="flex flex-wrap gap-2">
                {buckets.map(({ key, count }) => (
                  <Button
                    key={key}
                    variant="secondary"
                    size="sm"
                    disabled={count === 0}
                    onClick={() => setOpenBucket(key)}
                  >
                    {fmtInt(count)} {TRANSITION_BUCKET_LABEL[key].toLowerCase()}
                    {count > 0 && <ChevronRight size={14} />}
                  </Button>
                ))}
              </div>
            </PanelSection>
          )}
        </>
      )}

      {openBucket && transitions && (
        <Modal open onClose={() => setOpenBucket(null)} title={`${TRANSITION_BUCKET_LABEL[openBucket]} — ${ABC_METRIC_LABEL[metric]}`} maxWidth="max-w-3xl">
          <div className="max-h-[60vh] overflow-auto">
            <Table className="min-w-max">
              <Thead>
                <Tr>
                  <Th className="whitespace-nowrap">SKU</Th>
                  <Th className="whitespace-nowrap">Produto</Th>
                  <Th className="whitespace-nowrap">Classe anterior</Th>
                  <Th className="whitespace-nowrap">Classe atual</Th>
                  <Th className="whitespace-nowrap">Valor anterior</Th>
                  <Th className="whitespace-nowrap">Valor atual</Th>
                </Tr>
              </Thead>
              <tbody>
                {openRows.map(row => (
                  <Tr key={row.sku}>
                    <Td className="whitespace-nowrap text-fg-subtle">{row.sku}</Td>
                    <Td className="max-w-xs"><span className="block truncate" title={row.productName ?? undefined}>{row.productName ?? '—'}</span></Td>
                    <Td>{row.fromClass ? <Badge variant="neutral">{row.fromClass}</Badge> : <span className="text-caption">Novo na análise</span>}</Td>
                    <Td>{row.toClass ? <Badge variant="neutral">{row.toClass}</Badge> : <span className="text-caption">Ausente no período atual</span>}</Td>
                    <Td numeric className="whitespace-nowrap">{row.baselineValue !== null ? (metric === 'turnover' ? fmtInt(row.baselineValue) : fmtMoney(row.baselineValue)) : '—'}</Td>
                    <Td numeric className="whitespace-nowrap">{row.currentValue !== null ? (metric === 'turnover' ? fmtInt(row.currentValue) : fmtMoney(row.currentValue)) : '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Modal>
      )}
    </Panel>
  );
}

export default AbcComparisonPanel;
