import { useEffect, useState } from 'react';
import {
  ArrowRight, ChevronRight, Activity, ShieldCheck, MapPin, BarChart3, FileText, AlertTriangle, Boxes, Tags,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Page, PageHeader, Panel, PanelSection, Badge, Notice, Modal, Table, Thead, Tr, Th, Td, SegmentedControl,
} from '../ui';
import {
  getAnalyticsRawData, getInventoryHealthExtraData, type InventoryHealthExtraData,
} from '../../lib/analytics/analyticsDataService';
import {
  computeHealthIndicators, computeHealthSummary, sortByPriority,
  computeMovementEvidence, buildMovementDrillRows, computeSegmentDiagnosis,
} from '../../lib/analytics/inventoryHealthEngine';
import {
  INDICATOR_STATUS_LABEL, INDICATOR_STATUS_BADGE, HEALTH_DOMAIN_LABEL, HEALTH_DOMAIN_DESCRIPTION,
  isAvailable,
  type HealthIndicator, type HealthIndicatorDrill, type HealthDomain, type HealthSummary,
  type MovementEvidence, type MovementDrillRow, type SegmentDiagnosis, type SegmentDiagnosisResult,
} from '../../lib/analytics/analyticsContracts';
import { listRecords as listRcaRecords } from '../../lib/rcaService';
import { groupByDimension, type DimensionBucket } from '../../lib/rcaAlgorithm';
import { listWithFilter, type ProductAbcXyzRow } from '../../lib/abcXyzService';

interface InventoryHealthPageProps {
  companyId: string;
  /** Mesma navegação do resto do app (setActiveTab) — os CTAs só existem para destinos reais. */
  onNavigate?: (tab: string) => void;
}

type DrillState =
  | { open: false }
  | { open: true; title: string; loading: true }
  | { open: true; title: string; loading: false; kind: 'dimension'; rows: DimensionBucket[] }
  | { open: true; title: string; loading: false; kind: 'abcxyz'; rows: ProductAbcXyzRow[] }
  | { open: true; title: string; loading: false; kind: 'movement'; view: 'stockout' | 'idle'; rows: MovementDrillRow[] }
  | { open: true; title: string; loading: false; kind: 'segment'; rows: ProductAbcXyzRow[] };

/** Teto de linhas exibidas em um drill — o Modal é leitura de investigação, não exportação. */
const DRILL_LIMIT = 200;

async function loadDrill(companyId: string, indicator: HealthIndicator, drill: HealthIndicatorDrill): Promise<DrillState> {
  if (drill.kind === 'recurrence') {
    const records = await listRcaRecords(companyId, { recurringOnly: true });
    return { open: true, title: 'SKUs reincidentes', loading: false, kind: 'dimension', rows: groupByDimension(records, 'sku') };
  }
  if (drill.kind === 'location') {
    const records = await listRcaRecords(companyId, { location: drill.location });
    return { open: true, title: `SKUs mais afetados em ${drill.location}`, loading: false, kind: 'dimension', rows: groupByDimension(records, 'sku') };
  }
  if (drill.kind === 'movement') {
    // Movimento é resolvido em openDrill a partir dos dados já carregados: não chega aqui.
    return { open: true, title: indicator.label, loading: false, kind: 'movement', view: drill.view, rows: [] };
  }
  // abcxyz_risk
  const rows = (await Promise.all(drill.combos.map(combo => listWithFilter(companyId, `combo:${combo}`)))).flat();
  rows.sort((a, b) => b.value_moved - a.value_moved);
  return { open: true, title: indicator.label, loading: false, kind: 'abcxyz', rows: rows.slice(0, 100) };
}

const DOMAIN_ICON: Record<HealthDomain, LucideIcon> = {
  physical: Activity,
  validation: ShieldCheck,
  recurrence: MapPin,
  movement: Boxes,
  exposure: BarChart3,
  pending: FileText,
};

/** Domínios de saúde exibidos na linha de três colunas. `movement` tem bloco próprio (dois
 *  indicadores lado a lado com drill), `exposure` e `pending` fecham a página. */
const HEALTH_DOMAINS: HealthDomain[] = ['physical', 'validation', 'recurrence'];

const MOVEMENT_DRILL_TITLE: Record<'stockout' | 'idle', string> = {
  stockout: 'SKUs em ruptura com demanda',
  idle: 'Produtos com estoque sem movimentação',
};

const MOVEMENT_DRILL_ACTION: Record<'stockout' | 'idle', string> = {
  stockout: 'Ver SKUs',
  idle: 'Ver produtos',
};

const RISK_LEVEL_LABEL: Record<string, string> = {
  critico: 'Crítico', alto: 'Alto', medio: 'Médio', baixo: 'Baixo',
};

function formatValue(indicator: HealthIndicator): string {
  if (!isAvailable(indicator.metric)) return '—';
  return `${indicator.metric.value.toLocaleString('pt-BR')}${indicator.unit === '%' ? '%' : ''}`;
}

const formatCount = (value: number | null) => (value == null ? '—' : value.toLocaleString('pt-BR'));

/** Frase da situação prioritária — derivada do status do indicador de maior severidade, sem
 *  texto generativo e sem prometer impacto financeiro que o app não calcula. */
function priorityMessage(indicator: HealthIndicator): string {
  if (indicator.status === 'critico') return `${indicator.label} está em nível crítico e deve ser tratado primeiro.`;
  if (indicator.status === 'atencao') return `${indicator.label} requer atenção.`;
  return `${indicator.label} ainda não pode ser avaliado — sem essa evidência o diagnóstico fica incompleto.`;
}

function IndicatorCta({ indicator, onNavigate }: { indicator: HealthIndicator; onNavigate?: (tab: string) => void }) {
  if (!indicator.navigateTo || !onNavigate) return null;
  const target = indicator.navigateTo;
  return (
    <button
      onClick={() => onNavigate(target)}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-colors hover:text-accent-strong"
    >
      {indicator.actionLabel ?? 'Abrir módulo'}
      <ArrowRight size={14} className="flex-shrink-0" />
    </button>
  );
}

function DrillLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-colors hover:text-accent-strong"
    >
      {label}
      <ArrowRight size={14} className="flex-shrink-0" />
    </button>
  );
}

/** Inventory Health — diagnóstico executivo: em que estado está cada área da operação, qual
 *  problema vem primeiro, em que dado a conclusão se apoia e onde clicar para investigar.
 *  Não existe nota consolidada aqui (isso é o BlindScore): a página só apresenta os
 *  indicadores que computeHealthIndicators lê dos módulos que já os calculam. */
export function InventoryHealthPage({ companyId, onNavigate }: InventoryHealthPageProps) {
  const [indicators, setIndicators] = useState<HealthIndicator[]>([]);
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [extra, setExtra] = useState<InventoryHealthExtraData | null>(null);
  const [movement, setMovement] = useState<MovementEvidence | null>(null);
  const [segments, setSegments] = useState<SegmentDiagnosisResult | null>(null);
  const [segmentTab, setSegmentTab] = useState<'brands' | 'lines'>('brands');
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<DrillState>({ open: false });

  useEffect(() => {
    setLoading(true);
    // Duas levas independentes em paralelo: a compartilhada com BlindScore/Auditorias e a de
    // movimento/marca, que só esta página consome.
    Promise.all([getAnalyticsRawData(companyId), getInventoryHealthExtraData(companyId)]).then(([raw, extraData]) => {
      const computed = computeHealthIndicators(raw, extraData);
      setIndicators(computed);
      setSummary(computeHealthSummary(computed));
      setExtra(extraData);
      setMovement(computeMovementEvidence(extraData));
      setSegments(computeSegmentDiagnosis(raw, extraData));
      setLoading(false);
    });
  }, [companyId]);

  function openDrill(indicator: HealthIndicator) {
    if (!indicator.drill) return;
    // Movimento não abre consulta nova: as linhas vêm dos dados já carregados.
    if (indicator.drill.kind === 'movement') {
      if (!extra) return;
      const view = indicator.drill.view;
      setDrill({
        open: true, title: MOVEMENT_DRILL_TITLE[view], loading: false, kind: 'movement', view,
        rows: buildMovementDrillRows(extra, view).slice(0, DRILL_LIMIT),
      });
      return;
    }
    setDrill({ open: true, title: indicator.label, loading: true });
    loadDrill(companyId, indicator, indicator.drill).then(setDrill);
  }

  // "O que olhar primeiro": só o que de fato exige ação ou está sem avaliação — nunca
  // preenchido com indicadores saudáveis para fechar uma grade de 4.
  const priorities = sortByPriority(indicators)
    .filter(i => i.status === 'critico' || i.status === 'atencao' || i.status === 'nao_avaliado')
    .slice(0, 4);
  const pending = indicators.filter(i => i.domain === 'pending');
  const movementIndicators = indicators.filter(i => i.domain === 'movement');
  const segmentRows: SegmentDiagnosis[] = (segmentTab === 'brands' ? segments?.brands : segments?.lines) ?? [];

  return (
    <Page width="wide">
      <PageHeader
        eyebrow="Analytics"
        title="Inventory Health"
        description="Diagnóstico operacional da saúde do estoque. Entenda onde estão os problemas, o que está saudável e onde agir primeiro."
      />

      {loading || !summary ? (
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando indicadores...</PanelSection></Panel>
      ) : (
        <>
          {/* ---- A. Resumo executivo: distribuição real dos estados + situação prioritária ---- */}
          <Panel>
            <PanelSection padding="md" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div>
                <p className="text-section mb-4">Resumo executivo</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                  <SummaryCount value={summary.critico} label="áreas críticas" tone="text-red-600 dark:text-red-400" />
                  <SummaryCount value={summary.atencao} label="em atenção" tone="text-amber-600 dark:text-amber-400" />
                  <SummaryCount value={summary.saudavel} label="estáveis" tone="text-emerald-600 dark:text-emerald-400" />
                  <div className="min-w-0">
                    <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-fg">
                      {summary.availableCount}
                      <span className="text-base font-medium text-fg-subtle"> de {summary.totalCount}</span>
                    </p>
                    <p className="text-caption mt-0.5">diagnósticos com dados suficientes</p>
                  </div>
                </div>
              </div>

              <div className="min-w-0">
                {summary.priority ? (
                  <Notice tone={summary.priority.status === 'critico' ? 'danger' : summary.priority.status === 'atencao' ? 'warning' : 'neutral'}>
                    <span className="flex items-start gap-2.5">
                      <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-overline mb-1">Situação prioritária</span>
                        <span className="block font-medium">{priorityMessage(summary.priority)}</span>
                        <span className="block text-fg-muted mt-1">{summary.priority.detail}</span>
                      </span>
                    </span>
                  </Notice>
                ) : (
                  <Notice tone="success">
                    Nenhum indicador com dados suficientes aponta problema no momento.
                  </Notice>
                )}
              </div>
            </PanelSection>
          </Panel>

          {/* ---- B. Prioridades agora ---- */}
          {priorities.length > 0 && (
            <Panel>
              <PanelSection padding="md">
                <p className="text-section">Prioridades agora</p>
                <p className="text-caption mt-0.5">Principais pontos que exigem atenção no momento.</p>
              </PanelSection>
              <PanelSection padding="md" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {priorities.map((indicator, idx) => (
                  <div
                    key={indicator.key}
                    className="flex min-w-0 flex-col gap-3 rounded-container border border-edge/60 p-4"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-caption tabular-nums">{idx + 1}</span>
                      <Badge variant={INDICATOR_STATUS_BADGE[indicator.status]}>
                        {INDICATOR_STATUS_LABEL[indicator.status]}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-headline">{indicator.label}</p>
                      <p
                        className={`font-display text-3xl font-semibold tabular-nums tracking-tight mt-1 ${
                          indicator.status === 'critico' ? 'text-red-600 dark:text-red-400' : 'text-fg'
                        }`}
                      >
                        {isAvailable(indicator.metric) ? formatValue(indicator) : INDICATOR_STATUS_LABEL[indicator.status]}
                      </p>
                    </div>
                    <p className="text-caption leading-relaxed">{indicator.detail}</p>
                    <div className="mt-auto">
                      {indicator.drill?.kind === 'movement' ? (
                        <DrillLink
                          label={MOVEMENT_DRILL_ACTION[indicator.drill.view]}
                          onClick={() => openDrill(indicator)}
                        />
                      ) : (
                        <IndicatorCta indicator={indicator} onNavigate={onNavigate} />
                      )}
                    </div>
                  </div>
                ))}
              </PanelSection>
            </Panel>
          )}

          {/* ---- Movimento e disponibilidade (Fase 2) ---- */}
          {movementIndicators.length > 0 && (
            <Panel>
              <PanelSection padding="md" className="flex items-start gap-2.5">
                <Boxes size={16} className="mt-0.5 flex-shrink-0 text-fg-subtle" />
                <div className="min-w-0">
                  <p className="text-section">{HEALTH_DOMAIN_LABEL.movement}</p>
                  <p className="text-caption mt-0.5">{HEALTH_DOMAIN_DESCRIPTION.movement}</p>
                </div>
              </PanelSection>
              <PanelSection padding="md" className="grid gap-6 sm:grid-cols-2">
                {movementIndicators.map(indicator => (
                  <div key={indicator.key} className="min-w-0 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-headline">{indicator.label}</p>
                      <Badge variant={INDICATOR_STATUS_BADGE[indicator.status]}>
                        {INDICATOR_STATUS_LABEL[indicator.status]}
                      </Badge>
                    </div>
                    <p
                      className={`font-display text-3xl font-semibold tabular-nums tracking-tight ${
                        indicator.status === 'critico' ? 'text-red-600 dark:text-red-400' : 'text-fg'
                      }`}
                    >
                      {isAvailable(indicator.metric)
                        ? `${indicator.metric.value.toLocaleString('pt-BR')} SKUs`
                        : '—'}
                    </p>
                    <p className="text-caption leading-relaxed">{indicator.detail}</p>
                    {indicator.drill?.kind === 'movement' && isAvailable(indicator.metric) && (
                      <DrillLink
                        label={MOVEMENT_DRILL_ACTION[indicator.drill.view]}
                        onClick={() => openDrill(indicator)}
                      />
                    )}
                  </div>
                ))}
              </PanelSection>
            </Panel>
          )}

          {/* ---- C/D/E. Domínios de saúde ---- */}
          <div className="grid gap-5 lg:grid-cols-3">
            {HEALTH_DOMAINS.map(domain => {
              const rows = indicators.filter(i => i.domain === domain);
              if (rows.length === 0) return null;
              const DomainIcon = DOMAIN_ICON[domain];
              const cta = rows.find(i => i.navigateTo);
              return (
                <Panel key={domain} className="flex flex-col">
                  <PanelSection padding="md" className="flex items-start gap-2.5">
                    <DomainIcon size={16} className="mt-0.5 flex-shrink-0 text-fg-subtle" />
                    <div className="min-w-0">
                      <p className="text-section">{HEALTH_DOMAIN_LABEL[domain]}</p>
                      <p className="text-caption mt-0.5">{HEALTH_DOMAIN_DESCRIPTION[domain]}</p>
                    </div>
                  </PanelSection>
                  <PanelSection padding="md" className="space-y-4">
                    {rows.map(indicator => (
                      <IndicatorBlock key={indicator.key} indicator={indicator} onDrill={openDrill} />
                    ))}
                  </PanelSection>
                  {cta && (
                    <PanelSection padding="sm" className="mt-auto">
                      <IndicatorCta indicator={cta} onNavigate={onNavigate} />
                    </PanelSection>
                  )}
                </Panel>
              );
            })}
          </div>

          {/* ---- Concentração por marca e linha (Fase 2) ---- */}
          {segments && (segments.brands.length > 0 || segments.lines.length > 0) && (
            <Panel>
              <PanelSection padding="md" className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-2.5">
                  <Tags size={16} className="mt-0.5 flex-shrink-0 text-fg-subtle" />
                  <div className="min-w-0">
                    <p className="text-section">Concentração por marca e linha</p>
                    <p className="text-caption mt-0.5">
                      {segments.associatedProducts.toLocaleString('pt-BR')} de {segments.totalCatalog.toLocaleString('pt-BR')} produtos
                      possuem marca associada ({segments.coveragePct}% do catálogo)
                      {segments.coveragePct < 100 ? ' — o quadro abaixo cobre apenas esses produtos.' : '.'}
                    </p>
                  </div>
                </div>
                <SegmentedControl
                  label="Segmentação"
                  width="auto"
                  value={segmentTab}
                  onChange={setSegmentTab}
                  options={[{ value: 'brands', label: 'Marcas' }, { value: 'lines', label: 'Linhas' }]}
                />
              </PanelSection>
              <PanelSection padding="sm">
                {segmentRows.length === 0 ? (
                  <p className="text-sm text-fg-subtle">
                    Nenhuma {segmentTab === 'brands' ? 'marca' : 'linha'} com produtos associados.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <Thead>
                        <Tr>
                          <Th>{segmentTab === 'brands' ? 'Marca' : 'Linha'}</Th>
                          <Th>Produtos</Th>
                          <Th>Divergência</Th>
                          <Th>Risco crítico</Th>
                          <Th>Ruptura</Th>
                          <Th>Sem movimento</Th>
                          <Th>Principal sinal</Th>
                        </Tr>
                      </Thead>
                      <tbody>
                        {segmentRows.slice(0, 12).map(segment => (
                          <Tr key={segment.key}>
                            <Td>
                              {segment.name}
                              {segment.parentName && <span className="block text-caption">{segment.parentName}</span>}
                            </Td>
                            <Td numeric>{formatCount(segment.products)}</Td>
                            <Td numeric>{formatCount(segment.divergentProducts)}</Td>
                            <Td numeric>{formatCount(segment.riskCritical)}</Td>
                            <Td numeric>{formatCount(segment.stockoutWithDemand)}</Td>
                            <Td numeric>{formatCount(segment.noMovement)}</Td>
                            <Td>
                              {segment.mainSignal
                                ? `${segment.mainSignal.count.toLocaleString('pt-BR')} ${segment.mainSignal.label}`
                                : '—'}
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                    {segmentRows.length > 12 && (
                      <p className="text-caption mt-3">
                        Mostrando as 12 primeiras de {segmentRows.length.toLocaleString('pt-BR')}, na ordem de gravidade do principal sinal.
                      </p>
                    )}
                  </div>
                )}
              </PanelSection>
            </Panel>
          )}

          {/* ---- F. Exposição operacional + cobertura ---- */}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Panel className="flex flex-col">
              <PanelSection padding="md" className="flex items-start gap-2.5">
                <BarChart3 size={16} className="mt-0.5 flex-shrink-0 text-fg-subtle" />
                <div className="min-w-0">
                  <p className="text-section">{HEALTH_DOMAIN_LABEL.exposure}</p>
                  <p className="text-caption mt-0.5">{HEALTH_DOMAIN_DESCRIPTION.exposure}</p>
                </div>
              </PanelSection>
              <PanelSection padding="md" className="grid gap-6 sm:grid-cols-2">
                {indicators.filter(i => i.domain === 'exposure').map(indicator => (
                  <div key={indicator.key} className="min-w-0 space-y-3">
                    <IndicatorBlock indicator={indicator} onDrill={openDrill} />
                    <IndicatorCta indicator={indicator} onNavigate={onNavigate} />
                  </div>
                ))}
              </PanelSection>
            </Panel>

            <Panel className="flex flex-col">
              <PanelSection padding="md" className="flex items-start gap-2.5">
                <FileText size={16} className="mt-0.5 flex-shrink-0 text-fg-subtle" />
                <div className="min-w-0">
                  <p className="text-section">{HEALTH_DOMAIN_LABEL.pending}</p>
                  <p className="text-caption mt-0.5">{HEALTH_DOMAIN_DESCRIPTION.pending}</p>
                </div>
              </PanelSection>
              <PanelSection padding="md" className="space-y-4">
                <div>
                  <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-fg">
                    {summary.availableCount}
                    <span className="text-base font-medium text-fg-subtle"> de {summary.totalCount}</span>
                  </p>
                  <p className="text-caption mt-0.5">indicadores com dados suficientes</p>
                </div>

                {movement && (
                  <div>
                    <p className="text-overline">Dados de movimento</p>
                    <p className="text-caption mt-1 leading-relaxed">{movement.note}</p>
                  </div>
                )}

                {segments && (
                  <div>
                    <p className="text-overline">Associação de marca</p>
                    <p className="text-caption mt-1 leading-relaxed">
                      {segments.associatedProducts.toLocaleString('pt-BR')} de {segments.totalCatalog.toLocaleString('pt-BR')} produtos
                      com marca associada ({segments.coveragePct}%).
                    </p>
                  </div>
                )}

                {pending.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-overline">Ainda precisamos de dados para</p>
                    <ul className="space-y-1.5">
                      {pending.map(indicator => (
                        <li key={indicator.key} className="text-sm text-fg-muted">
                          {indicator.label}
                          <span className="block text-caption">{indicator.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </PanelSection>
            </Panel>
          </div>
        </>
      )}

      <Modal open={drill.open} onClose={() => setDrill({ open: false })} title={drill.open ? drill.title : undefined} maxWidth="max-w-3xl">
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
                    <Tr key={r.key}><Td numeric>{r.label}</Td><Td numeric>{r.count}</Td></Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )
        )}
        {drill.open && !drill.loading && drill.kind === 'movement' && (
          drill.rows.length === 0 ? (
            <p className="text-sm text-fg-subtle">Nenhum produto nesta condição.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>SKU</Th><Th>Produto</Th><Th>Localização</Th><Th>Estoque</Th>
                    {drill.view === 'stockout' ? <Th>Movimentado</Th> : <Th>Sem movimento</Th>}
                    {drill.view === 'stockout' ? <Th>Risco</Th> : <Th>Estoque parado</Th>}
                  </Tr>
                </Thead>
                <tbody>
                  {drill.rows.map(row => (
                    <Tr key={row.productId}>
                      <Td numeric>{row.sku}</Td>
                      <Td className="truncate max-w-[200px]">{row.name}</Td>
                      <Td>{row.location ?? '—'}</Td>
                      <Td numeric>{row.stockQuantity.toLocaleString('pt-BR')}</Td>
                      {drill.view === 'stockout' ? (
                        <Td numeric>{row.quantityMoved.toLocaleString('pt-BR')}</Td>
                      ) : (
                        <Td>
                          {row.weeksWithoutSale != null
                            ? `${row.weeksWithoutSale} semana(s)`
                            : 'Sem movimentação no período'}
                        </Td>
                      )}
                      {drill.view === 'stockout' ? (
                        <Td>{row.riskLevel ? (RISK_LEVEL_LABEL[row.riskLevel] ?? row.riskLevel) : '—'}</Td>
                      ) : (
                        <Td numeric>{row.stockQuantity.toLocaleString('pt-BR')}</Td>
                      )}
                    </Tr>
                  ))}
                </tbody>
              </Table>
              {drill.rows.length >= DRILL_LIMIT && (
                <p className="text-caption mt-3">Mostrando os {DRILL_LIMIT} primeiros da ordenação.</p>
              )}
            </div>
          )
        )}
        {drill.open && !drill.loading && (drill.kind === 'abcxyz' || drill.kind === 'segment') && (
          drill.rows.length === 0 ? (
            <p className="text-sm text-fg-subtle">Nenhum SKU encontrado nessas combinações.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <Thead><Tr><Th>SKU</Th><Th>Produto</Th><Th>Classe</Th><Th>Valor Movimentado</Th></Tr></Thead>
                <tbody>
                  {drill.rows.map(r => (
                    <Tr key={r.product_id}>
                      <Td numeric>{r.product_sku}</Td>
                      <Td className="truncate max-w-[220px]">{r.product_name}</Td>
                      <Td>{r.abc_xyz_class}</Td>
                      <Td numeric>{r.value_moved.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</Td>
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

function SummaryCount({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="min-w-0">
      <p className={`font-display text-3xl font-semibold tabular-nums tracking-tight ${value > 0 ? tone : 'text-fg-subtle'}`}>
        {value}
      </p>
      <p className="text-caption mt-0.5">{label}</p>
    </div>
  );
}

/** Um indicador dentro do seu domínio: rótulo, valor, status e a base usada. Continua sendo o
 *  ponto de entrada do drill-down real quando o indicador tem um. */
function IndicatorBlock({ indicator, onDrill }: { indicator: HealthIndicator; onDrill: (indicator: HealthIndicator) => void }) {
  const clickable = !!indicator.drill;
  const Wrapper = clickable ? 'button' : 'div';
  return (
    <Wrapper
      onClick={clickable ? () => onDrill(indicator) : undefined}
      className={`block w-full min-w-0 text-left ${clickable ? 'group' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium text-fg">
          {indicator.label}
          {clickable && <ChevronRight size={14} className="ml-1 inline-block align-[-2px] text-fg-subtle" />}
        </p>
        <div className="flex flex-shrink-0 items-center gap-2">
          <p className="font-display text-sm font-semibold tabular-nums text-fg">{formatValue(indicator)}</p>
          <Badge variant={INDICATOR_STATUS_BADGE[indicator.status]}>{INDICATOR_STATUS_LABEL[indicator.status]}</Badge>
        </div>
      </div>
      <p className="text-caption mt-1 leading-relaxed">{indicator.detail}</p>
    </Wrapper>
  );
}
