import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Download, RefreshCw, Search } from 'lucide-react';
import {
  Page, PageHeader, Panel, PanelSection, Badge, Button, Modal, Notice,
  Table, Thead, Tr, Th, Td, SegmentedControl, Input, Select,
} from '../ui';
import type { SegmentedOption } from '../ui';
import {
  getAuditsAnalyticsData, getAuditSessionDetail, getAuditsRecurrenceData, buildSessionDivergencesCsv,
  type AuditsAnalyticsData, type AuditSessionSummary, type AuditSessionDetail,
  type AuditsRecurrenceData,
} from '../../lib/analytics/auditsAnalyticsService';
import {
  filterSessions, countNumberLabel, EMPTY_SESSION_FILTERS, toChronological,
  computePerformanceSummary, computeOperatorPerformance,
  computeRecurringSkus, computeRecurringLocations, computeRecurringCauses,
  buildSkuHistory, MIN_RECURRENCE_SESSIONS,
  type SessionFilters,
} from '../../lib/analytics/auditsHistoryEngine';
import { downloadBlob } from '../../lib/pdfCenter/downloadFile';
import { AuditsSessionChart, type SessionMetric } from './AuditsSessionChart';

interface AuditsAnalyticsPageProps {
  companyId: string;
  /** Navegação já existente do App (setActiveTab) — usada só para abrir o RCA a partir de
   *  uma sessão que realmente tem divergências. Sem ela, o CTA simplesmente não aparece. */
  onNavigate?: (tab: string) => void;
}

type Section = 'historico' | 'performance' | 'reincidencia';
type DetailTab = 'resumo' | 'divergencias' | 'validacao' | 'rca';

const SECTIONS: SegmentedOption<Section>[] = [
  { value: 'historico', label: 'Histórico' },
  { value: 'performance', label: 'Performance' },
  { value: 'reincidencia', label: 'Reincidência' },
];

const DIVERGENCE_PAGE_SIZE = 50;

const STATUS_LABEL: Record<string, string> = {
  divergent: 'Divergente', missing: 'Faltante', surplus: 'Sobra', correct: 'Correto',
};

const dateFmt = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const timeFmt = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const pctFmt = (value: number) => `${value.toFixed(1).replace('.', ',')}%`;
const intFmt = (value: number) => value.toLocaleString('pt-BR');

/** Analytics > Auditorias — histórico e performance das auditorias JÁ realizadas. Diferente
 *  de Operações > Auditoria de Estoque, que executa a auditoria cruzada em si; aqui só se
 *  analisa o que já aconteceu (mesmos dados, camada de leitura separada). */
export function AuditsAnalyticsPage({ companyId, onNavigate }: AuditsAnalyticsPageProps) {
  const [data, setData] = useState<AuditsAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('historico');
  const [filters, setFilters] = useState<SessionFilters>(EMPTY_SESSION_FILTERS);

  const [openSession, setOpenSession] = useState<AuditSessionSummary | null>(null);
  const [detail, setDetail] = useState<AuditSessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('resumo');
  const [itemSearch, setItemSearch] = useState('');
  const [itemPage, setItemPage] = useState(0);

  const [metric, setMetric] = useState<SessionMetric>('accuracy');
  const [skuSearch, setSkuSearch] = useState('');
  const [openSku, setOpenSku] = useState<string | null>(null);
  const [recurrenceData, setRecurrenceData] = useState<AuditsRecurrenceData | null>(null);
  const [recurrenceLoading, setRecurrenceLoading] = useState(false);
  const [recurrenceError, setRecurrenceError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    setRecurrenceData(null);
    getAuditsAnalyticsData(companyId)
      .then(d => {
        setData(d);
        setLoadedAt(new Date().toISOString());
      })
      .catch(err => {
        console.error('[Audits] Error loading analytics data:', err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const sessions = useMemo(() => data?.sessions ?? [], [data]);
  const filtered = useMemo(() => filterSessions(sessions, filters), [sessions, filters]);
  const chronological = useMemo(() => toChronological(sessions), [sessions]);
  const performance = useMemo(() => computePerformanceSummary(sessions), [sessions]);
  const operatorRows = useMemo(() => computeOperatorPerformance(sessions), [sessions]);
  const recountSessions = useMemo(() => sessions.filter(s => s.countNumber > 1).length, [sessions]);
  const sessionById = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);

  // Janela e limiar de recorrência vêm da configuração de RCA do workspace — nenhuma janela
  // nova é inventada aqui.
  const windowDays = data?.rcaSettings.recurrence_window_days ?? null;
  const thresholdCount = data?.rcaSettings.recurrence_threshold_count ?? 0;

  // A leitura item a item da reincidência só acontece quando a aba é aberta: o Histórico e a
  // Performance nunca pagam por ela.
  useEffect(() => {
    if (section !== 'reincidencia' || windowDays === null) return;
    if (recurrenceData || recurrenceLoading) return;
    setRecurrenceLoading(true);
    setRecurrenceError(false);
    getAuditsRecurrenceData(companyId, sessions, windowDays)
      .then(setRecurrenceData)
      .catch(err => {
        console.error('[Audits] Error loading recurrence data:', err);
        setRecurrenceError(true);
      })
      .finally(() => setRecurrenceLoading(false));
  }, [section, windowDays, recurrenceData, recurrenceLoading, companyId, sessions]);

  const recurrence = useMemo(() => {
    if (!recurrenceData) return null;
    return {
      data: recurrenceData,
      skus: computeRecurringSkus(recurrenceData.items, recurrenceData.rcaLinks, thresholdCount),
      locations: computeRecurringLocations(recurrenceData.items),
      causes: computeRecurringCauses(recurrenceData.items, recurrenceData.rcaLinks),
    };
  }, [recurrenceData, thresholdCount]);

  const visibleRecurringSkus = useMemo(() => {
    if (!recurrence) return [];
    const term = skuSearch.trim().toLowerCase();
    if (term.length === 0) return recurrence.skus;
    return recurrence.skus.filter(r =>
      [r.sku, r.productName ?? ''].join(' ').toLowerCase().includes(term)
    );
  }, [recurrence, skuSearch]);

  const skuHistory = useMemo(
    () => (recurrenceData && openSku ? buildSkuHistory(recurrenceData.items, openSku) : []),
    [recurrenceData, openSku]
  );

  const rcaLinkByItem = useMemo(
    () => new Map((recurrenceData?.rcaLinks ?? []).map(l => [l.sourceItemId, l])),
    [recurrenceData]
  );

  function openDetail(session: AuditSessionSummary) {
    setOpenSession(session);
    setDetail(null);
    setDetailError(false);
    setDetailTab('resumo');
    setItemSearch('');
    setItemPage(0);
    setDetailLoading(true);
    getAuditSessionDetail(session.id, companyId)
      .then(setDetail)
      .catch(err => {
        console.error('[Audits] Error loading session detail:', err);
        setDetailError(true);
      })
      .finally(() => setDetailLoading(false));
  }

  const divergences = useMemo(() => detail?.divergences ?? [], [detail]);
  const visibleDivergences = useMemo(() => {
    const term = itemSearch.trim().toLowerCase();
    if (term.length === 0) return divergences;
    return divergences.filter(d =>
      [d.sku ?? '', d.productName ?? '', d.location ?? ''].join(' ').toLowerCase().includes(term)
    );
  }, [divergences, itemSearch]);

  const pageCount = Math.max(1, Math.ceil(visibleDivergences.length / DIVERGENCE_PAGE_SIZE));
  const safePage = Math.min(itemPage, pageCount - 1);
  const pagedDivergences = visibleDivergences.slice(
    safePage * DIVERGENCE_PAGE_SIZE,
    safePage * DIVERGENCE_PAGE_SIZE + DIVERGENCE_PAGE_SIZE
  );

  function exportDivergences() {
    if (!openSession || divergences.length === 0) return;
    const csv = buildSessionDivergencesCsv(divergences);
    const day = openSession.createdAt.slice(0, 10);
    downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `divergencias-${day}.csv`);
  }

  const chain = openSession
    ? data?.chainsByRoot.get(openSession.linkedCountId ?? openSession.id) ?? null
    : null;

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics"
        title="Auditorias"
        description="Histórico, performance e reincidência das auditorias já realizadas neste workspace — não executa uma nova auditoria (isso fica em Operações → Auditoria de Estoque)."
        actions={
          <div className="flex items-center gap-3">
            {loadedAt && (
              <p className="hidden text-caption sm:block">
                Última atualização
                <br />
                {dateFmt(loadedAt)} • {timeFmt(loadedAt)}
              </p>
            )}
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
              Atualizar
            </Button>
          </div>
        }
      />

      {error ? (
        <Notice tone="danger">
          Não foi possível carregar o histórico de auditorias. Verifique a conexão e tente atualizar.
        </Notice>
      ) : loading || !data ? (
        <Panel>
          <PanelSection padding="lg" className="text-center text-fg-subtle">
            Carregando auditorias...
          </PanelSection>
        </Panel>
      ) : (
        <>
          {/* Resumo executivo — só dados reais das sessões já registradas. */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              value={intFmt(data.summary.sessions)}
              label="sessões de contagem"
              caption="Total de auditorias registradas"
            />
            <KpiCard
              value={intFmt(data.summary.totalCounted)}
              label="SKUs contados"
              caption="Somatório das sessões, sem deduplicar SKU"
            />
            <KpiCard
              value={data.summary.observedAccuracyPct !== null ? pctFmt(data.summary.observedAccuracyPct) : '—'}
              label="Acurácia observada"
              caption={
                data.summary.observedAccuracyPct !== null
                  ? `${intFmt(data.summary.totalDivergent)} divergências em ${intFmt(data.summary.totalCounted)} SKUs contados`
                  : 'Nenhum SKU contado ainda'
              }
            />
            <KpiCard
              value={`${intFmt(data.summary.approvedSessions)} de ${intFmt(data.summary.sessions)}`}
              label="Sessões aprovadas"
              caption="Aprovação registrada na Auditoria Cruzada"
            />
          </div>

          {/* Tabs sem painel próprio: antes um Panel inteiro carregava só o seletor. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl label="Seção" options={SECTIONS} value={section} onChange={setSection} />
            {section === 'historico' && sessions.length > 0 && (
              <p className="text-caption">
                {filtered.length === sessions.length
                  ? `${intFmt(sessions.length)} sessão(ões) no histórico`
                  : `${intFmt(filtered.length)} de ${intFmt(sessions.length)} sessões`}
              </p>
            )}
          </div>

          {section === 'historico' ? (
            <Panel>
              <PanelSection padding="sm">
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Período">
                    <Select
                      value={filters.period}
                      onChange={e => setFilters(f => ({ ...f, period: e.target.value as SessionFilters['period'] }))}
                    >
                      <option value="all">Todo o histórico</option>
                      <option value="30d">Últimos 30 dias</option>
                      <option value="90d">Últimos 90 dias</option>
                    </Select>
                  </Field>
                  <Field label="Operador">
                    <Select
                      value={filters.operator}
                      onChange={e => setFilters(f => ({ ...f, operator: e.target.value }))}
                    >
                      <option value="all">Todos</option>
                      {data.operators.map(o => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  </Field>
                  <Field label="Tipo">
                    <Select
                      value={filters.countNumber}
                      onChange={e => setFilters(f => ({ ...f, countNumber: e.target.value as SessionFilters['countNumber'] }))}
                    >
                      <option value="all">Todos</option>
                      <option value="1">1ª contagem</option>
                      <option value="2">Recontagem</option>
                      <option value="3">3ª contagem</option>
                    </Select>
                  </Field>
                  <Field label="Aprovação">
                    <Select
                      value={filters.approval}
                      onChange={e => setFilters(f => ({ ...f, approval: e.target.value as SessionFilters['approval'] }))}
                    >
                      <option value="all">Todas</option>
                      <option value="approved">Aprovadas</option>
                      <option value="pending">Não aprovadas</option>
                    </Select>
                  </Field>
                  <div className="min-w-[13rem] flex-1">
                    <Input
                      icon={<Search />}
                      placeholder="Buscar por operador, tipo ou data..."
                      value={filters.search}
                      onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                      aria-label="Buscar sessões"
                    />
                  </div>
                </div>
              </PanelSection>

              {sessions.length === 0 ? (
                <PanelSection padding="lg" className="text-center text-fg-subtle">
                  Nenhuma sessão de contagem registrada ainda neste workspace.
                </PanelSection>
              ) : filtered.length === 0 ? (
                <PanelSection padding="lg" className="text-center">
                  <p className="text-fg-subtle">Nenhuma sessão corresponde aos filtros aplicados.</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3"
                    onClick={() => setFilters(EMPTY_SESSION_FILTERS)}
                  >
                    Limpar filtros
                  </Button>
                </PanelSection>
              ) : (
                <div className="max-h-[34rem] overflow-x-auto">
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>Data</Th>
                        <Th>Tipo</Th>
                        <Th className="text-right">SKUs contados</Th>
                        <Th className="text-right">Cobertura</Th>
                        <Th className="text-right">Divergências</Th>
                        <Th className="text-right">Acurácia</Th>
                        <Th>Operador</Th>
                        <Th title="A aprovação registra a validação/encerramento da sessão na Auditoria Cruzada — não é uma avaliação da acurácia.">
                          Aprovada
                        </Th>
                        <Th />
                      </Tr>
                    </Thead>
                    <tbody>
                      {filtered.map(s => (
                        <Tr key={s.id} className="cursor-pointer" onClick={() => openDetail(s)}>
                          <Td>
                            {dateFmt(s.createdAt)}
                            <span className="text-fg-subtle"> • {timeFmt(s.createdAt)}</span>
                          </Td>
                          <Td>{countNumberLabel(s.countNumber)}</Td>
                          <Td numeric>
                            {intFmt(s.skusContados)}
                            <span className="text-fg-subtle"> / {intFmt(s.totalSku)}</span>
                          </Td>
                          <Td numeric>
                            {s.coveragePct !== null ? <CoverageBar pct={s.coveragePct} /> : <span className="text-fg-subtle">—</span>}
                          </Td>
                          <Td numeric>
                            <span className={s.divergenciasReais > 0 ? 'text-amber-600 dark:text-amber-400' : undefined}>
                              {intFmt(s.divergenciasReais)}
                            </span>
                            {s.divergenceRatePct !== null && (
                              <span className="block text-xs text-fg-subtle">{pctFmt(s.divergenceRatePct)}</span>
                            )}
                          </Td>
                          <Td numeric>{s.accuracy !== null ? pctFmt(s.accuracy) : '—'}</Td>
                          <Td>{s.operator ?? '—'}</Td>
                          <Td>{s.approved ? <Badge variant="success">Sim</Badge> : <Badge variant="neutral">Não</Badge>}</Td>
                          <Td className="text-right">
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); openDetail(s); }}
                              className="text-fg-subtle transition-colors hover:text-accent"
                              aria-label={`Abrir detalhes da sessão de ${dateFmt(s.createdAt)}`}
                            >
                              <ArrowRight size={16} />
                            </button>
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </Panel>
          ) : section === 'performance' ? (
            <>
              <Panel>
                <PanelSection padding="sm">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4 lg:divide-x lg:divide-edge">
                    <MetricCell
                      value={performance.coverageAvgPct !== null ? pctFmt(performance.coverageAvgPct) : '—'}
                      label="Cobertura média das sessões"
                      caption={
                        performance.sessionsWithCoverage > 0
                          ? `Base: ${intFmt(performance.sessionsWithCoverage)} de ${intFmt(performance.sessions)} sessões com universo previsto`
                          : 'Nenhuma sessão com universo previsto registrado'
                      }
                    />
                    <MetricCell
                      value={performance.divergenceRatePct !== null ? pctFmt(performance.divergenceRatePct) : '—'}
                      label="Taxa de divergência observada"
                      caption={
                        performance.divergenceRatePct !== null
                          ? `${intFmt(performance.totalDivergent)} divergências em ${intFmt(performance.totalCounted)} SKUs contados`
                          : 'Nenhum SKU contado ainda'
                      }
                      className="lg:pl-6"
                    />
                    <MetricCell
                      value={intFmt(recountSessions)}
                      label="Sessões com recontagem"
                      caption="Etapas registradas como recontagem ou 3ª contagem"
                      className="lg:pl-6"
                    />
                    <MetricCell
                      value={`${intFmt(performance.approvedSessions)} de ${intFmt(performance.sessions)}`}
                      label="Sessões aprovadas"
                      caption="Validação/encerramento da sessão, não nota de acurácia"
                      className="lg:pl-6"
                    />
                  </div>
                </PanelSection>
              </Panel>

              <Panel>
                <PanelSection padding="sm">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-section">Evolução das auditorias</p>
                      <p className="text-caption mt-1">
                        {performance.observedAccuracyPct !== null
                          ? `Acurácia observada consolidada: ${pctFmt(performance.observedAccuracyPct)} — base de ${intFmt(performance.totalCounted)} SKUs contados em ${intFmt(performance.sessions)} sessões.`
                          : 'Ainda não há SKUs contados para consolidar a acurácia observada.'}
                      </p>
                    </div>
                    <SegmentedControl
                      label="Métrica da série"
                      options={[
                        { value: 'accuracy', label: 'Acurácia' },
                        { value: 'coverage', label: 'Cobertura' },
                        { value: 'divergence', label: 'Divergência' },
                      ]}
                      value={metric}
                      onChange={setMetric}
                    />
                  </div>
                </PanelSection>
                <PanelSection padding="md">
                  <AuditsSessionChart sessions={chronological} metric={metric} onSelect={openDetail} />
                  {chronological.length > 1 && (
                    <p className="text-caption mt-3">Clique em um ponto para abrir a sessão correspondente.</p>
                  )}
                </PanelSection>
              </Panel>

              <Panel>
                <PanelSection padding="sm">
                  <p className="text-section">Performance das contagens por operador</p>
                  <p className="text-caption mt-1">
                    Evidência operacional das sessões registradas, ordenada por volume contado. Não é avaliação
                    individual: sessões diferentes têm bases diferentes, por isso a amostra aparece em cada linha.
                  </p>
                </PanelSection>
                {operatorRows.length === 0 ? (
                  <PanelSection padding="lg" className="text-center text-fg-subtle">
                    Nenhuma sessão com operador registrado.
                  </PanelSection>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <Thead>
                        <Tr>
                          <Th>Operador</Th>
                          <Th className="text-right">Sessões</Th>
                          <Th className="text-right">SKUs contados</Th>
                          <Th className="text-right">Cobertura média</Th>
                          <Th className="text-right">Acurácia observada</Th>
                          <Th className="text-right">Divergências</Th>
                          <Th className="text-right">Recontagens</Th>
                          <Th className="text-right">Aprovadas</Th>
                        </Tr>
                      </Thead>
                      <tbody>
                        {operatorRows.map(o => (
                          <Tr key={o.operator}>
                            <Td>
                              <span className="block text-fg">{o.operator}</span>
                              <span className="text-caption">
                                {intFmt(o.sessions)} sessão(ões) · {intFmt(o.skusCounted)} SKUs contados
                              </span>
                            </Td>
                            <Td numeric>{intFmt(o.sessions)}</Td>
                            <Td numeric>{intFmt(o.skusCounted)}</Td>
                            <Td numeric>
                              {o.coverageAvgPct !== null ? pctFmt(o.coverageAvgPct) : '—'}
                              <span className="block text-xs text-fg-subtle">
                                {o.sessionsWithCoverage > 0 ? `base ${intFmt(o.sessionsWithCoverage)} sessão(ões)` : 'sem base'}
                              </span>
                            </Td>
                            <Td numeric>{o.observedAccuracyPct !== null ? pctFmt(o.observedAccuracyPct) : '—'}</Td>
                            <Td numeric>{intFmt(o.divergences)}</Td>
                            <Td numeric>{intFmt(o.recountSessions)}</Td>
                            <Td numeric>{intFmt(o.approvedSessions)}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </Panel>

              <Panel>
                <PanelSection padding="sm">
                  <p className="text-section">Sessões com maior taxa de divergência</p>
                  <p className="text-caption mt-1">Ponto de entrada para investigar o que aconteceu dentro da sessão.</p>
                </PanelSection>
                {data.worstSessions.length === 0 ? (
                  <PanelSection padding="lg" className="text-center text-fg-subtle">Nenhuma sessão com SKUs contados ainda.</PanelSection>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <Thead>
                        <Tr>
                          <Th>Data</Th><Th>Tipo</Th>
                          <Th className="text-right">Divergências</Th>
                          <Th className="text-right">SKUs contados</Th>
                          <Th className="text-right">Taxa</Th>
                          <Th />
                        </Tr>
                      </Thead>
                      <tbody>
                        {data.worstSessions.map(s => (
                          <Tr key={s.id} className="cursor-pointer" onClick={() => openDetail(s)}>
                            <Td>{dateFmt(s.createdAt)}</Td>
                            <Td>{countNumberLabel(s.countNumber)}</Td>
                            <Td numeric>{intFmt(s.divergenciasReais)}</Td>
                            <Td numeric>{intFmt(s.skusContados)}</Td>
                            <Td numeric className="text-amber-600 dark:text-amber-400">
                              {s.divergenceRatePct !== null ? pctFmt(s.divergenceRatePct) : '—'}
                            </Td>
                            <Td className="text-right">
                              <ArrowRight size={16} className="inline text-fg-subtle" />
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </Panel>
            </>
          ) : (
            <>
              <Panel>
                <PanelSection padding="sm">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4 lg:divide-x lg:divide-edge">
                    <MetricCell
                      value={recurrence ? intFmt(recurrence.skus.length) : '—'}
                      label="SKUs reincidentes"
                      caption={`Divergiram em ${MIN_RECURRENCE_SESSIONS}+ sessões distintas`}
                    />
                    <MetricCell
                      value={recurrence ? intFmt(recurrence.locations.length) : '—'}
                      label="Localizações recorrentes"
                      caption="Com divergência em sessões distintas"
                      className="lg:pl-6"
                    />
                    <MetricCell
                      value={recurrence ? intFmt(recurrence.causes.length) : '—'}
                      label="Causas RCA recorrentes"
                      caption={
                        recurrence && recurrence.data.rcaLinks.length === 0
                          ? 'Sem divergências classificadas no RCA no período'
                          : 'Classificação real do Root Cause Analysis'
                      }
                      className="lg:pl-6"
                    />
                    <MetricCell
                      value={recurrence ? intFmt(recurrence.data.sessionsAnalyzed) : '—'}
                      label="Sessões analisadas"
                      caption={`Janela de ${intFmt(data.rcaSettings.recurrence_window_days)} dias configurada em RCA`}
                      className="lg:pl-6"
                    />
                  </div>
                </PanelSection>
              </Panel>

              {recurrenceError ? (
                <Notice tone="danger">
                  Não foi possível carregar a análise de reincidência. Tente atualizar a página.
                </Notice>
              ) : recurrenceLoading || !recurrence ? (
                <Panel>
                  <PanelSection padding="lg" className="text-center text-fg-subtle">
                    Analisando divergências das sessões...
                  </PanelSection>
                </Panel>
              ) : (
                <>
                  {recurrence.data.truncated && (
                    <Notice tone="warning">
                      Leitura parcial: a análise considerou as primeiras divergências lidas do período. Reduza a
                      janela em Root Cause Analysis para uma leitura completa.
                    </Notice>
                  )}

                  <Panel>
                    <PanelSection padding="sm">
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-section">SKUs reincidentes</p>
                          <p className="text-caption mt-1">
                            Mesmo SKU com divergência em {MIN_RECURRENCE_SESSIONS} ou mais sessões distintas dentro da
                            janela de {intFmt(data.rcaSettings.recurrence_window_days)} dias. Duas divergências da mesma
                            sessão contam como uma sessão.
                          </p>
                        </div>
                        <div className="min-w-[13rem] flex-1">
                          <Input
                            icon={<Search />}
                            placeholder="Buscar por SKU ou produto..."
                            value={skuSearch}
                            onChange={e => setSkuSearch(e.target.value)}
                            aria-label="Buscar SKUs reincidentes"
                          />
                        </div>
                      </div>
                    </PanelSection>
                    {recurrence.skus.length === 0 ? (
                      <PanelSection padding="lg" className="text-center text-fg-subtle">
                        Nenhuma reincidência identificada no período analisado.
                      </PanelSection>
                    ) : visibleRecurringSkus.length === 0 ? (
                      <PanelSection padding="lg" className="text-center text-fg-subtle">
                        Nenhum SKU corresponde à busca.
                      </PanelSection>
                    ) : (
                      <div className="max-h-[30rem] overflow-x-auto">
                        <Table>
                          <Thead>
                            <Tr>
                              <Th>SKU</Th><Th>Produto</Th>
                              <Th className="text-right">Sessões</Th>
                              <Th className="text-right">Ocorrências</Th>
                              <Th>Última ocorrência</Th>
                              <Th>Última localização</Th>
                              <Th>RCA</Th>
                              <Th />
                            </Tr>
                          </Thead>
                          <tbody>
                            {visibleRecurringSkus.map(r => (
                              <Tr key={r.sku} className="cursor-pointer" onClick={() => setOpenSku(r.sku)}>
                                <Td className="font-mono text-xs">
                                  {r.sku}
                                  {r.reachedRcaThreshold && (
                                    <span className="ml-2 align-middle">
                                      <Badge variant="warning">Limiar RCA</Badge>
                                    </span>
                                  )}
                                </Td>
                                <Td className="max-w-[14rem] truncate">{r.productName ?? '—'}</Td>
                                <Td numeric>{intFmt(r.sessionsWithDivergence)}</Td>
                                <Td numeric>{intFmt(r.occurrences)}</Td>
                                <Td>{dateFmt(r.lastOccurrenceAt)}</Td>
                                <Td className="font-mono text-xs">{r.lastLocation ?? '—'}</Td>
                                <Td className="text-xs text-fg-muted">
                                  {r.causeLabels.length > 0
                                    ? r.causeLabels.join(', ')
                                    : <span className="text-fg-subtle">Não classificado</span>}
                                </Td>
                                <Td className="text-right">
                                  <ArrowRight size={16} className="inline text-fg-subtle" />
                                </Td>
                              </Tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                    )}
                  </Panel>

                  <Panel>
                    <PanelSection padding="sm">
                      <p className="text-section">Localizações recorrentes</p>
                      <p className="text-caption mt-1">
                        Localização registrada na divergência, com ocorrência em sessões distintas. É concentração
                        observada — a causa só vem do RCA.
                      </p>
                    </PanelSection>
                    {recurrence.locations.length === 0 ? (
                      <PanelSection padding="lg" className="text-center text-fg-subtle">
                        Nenhuma localização com divergência em sessões distintas no período.
                      </PanelSection>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <Thead>
                            <Tr>
                              <Th>Localização</Th>
                              <Th className="text-right">Sessões afetadas</Th>
                              <Th className="text-right">SKUs distintos</Th>
                              <Th className="text-right">Ocorrências</Th>
                              <Th>Última ocorrência</Th>
                            </Tr>
                          </Thead>
                          <tbody>
                            {recurrence.locations.slice(0, 15).map(l => (
                              <Tr key={l.location}>
                                <Td className="font-mono text-xs">{l.location}</Td>
                                <Td numeric>{intFmt(l.sessionsAffected)}</Td>
                                <Td numeric>{intFmt(l.distinctSkus)}</Td>
                                <Td numeric>{intFmt(l.occurrences)}</Td>
                                <Td>{dateFmt(l.lastOccurrenceAt)}</Td>
                              </Tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                    )}
                  </Panel>

                  <Panel>
                    <PanelSection padding="sm">
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-section">Causas recorrentes</p>
                          <p className="text-caption mt-1">
                            Somente causas já classificadas no Root Cause Analysis para as divergências destas sessões.
                          </p>
                        </div>
                        {onNavigate && recurrence.data.rcaLinks.length > 0 && (
                          <Button variant="secondary" size="sm" onClick={() => onNavigate('rca')}>
                            Abrir RCA
                            <ArrowRight size={14} />
                          </Button>
                        )}
                      </div>
                    </PanelSection>
                    {recurrence.data.rcaLinks.length === 0 ? (
                      <PanelSection padding="md">
                        <Notice tone="neutral">
                          Não há causas classificadas em RCA suficientes para análise. Ausência de classificação é
                          ausência de evidência — não significa operação saudável.
                        </Notice>
                      </PanelSection>
                    ) : recurrence.causes.length === 0 ? (
                      <PanelSection padding="lg" className="text-center text-fg-subtle">
                        Nenhuma causa classificada apareceu em sessões distintas no período.
                      </PanelSection>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <Thead>
                            <Tr>
                              <Th>Causa</Th>
                              <Th className="text-right">Ocorrências</Th>
                              <Th className="text-right">SKUs</Th>
                              <Th className="text-right">Sessões</Th>
                              <Th>Última ocorrência</Th>
                            </Tr>
                          </Thead>
                          <tbody>
                            {recurrence.causes.map(c => (
                              <Tr key={c.causeKey}>
                                <Td>{c.causeLabel}</Td>
                                <Td numeric>{intFmt(c.occurrences)}</Td>
                                <Td numeric>{intFmt(c.distinctSkus)}</Td>
                                <Td numeric>{intFmt(c.sessionsAffected)}</Td>
                                <Td>{dateFmt(c.lastOccurrenceAt)}</Td>
                              </Tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                    )}
                  </Panel>
                </>
              )}
            </>
          )}
        </>
      )}

      <Modal
        open={!!openSession}
        onClose={() => setOpenSession(null)}
        title={openSession ? `Sessão de ${dateFmt(openSession.createdAt)} • ${timeFmt(openSession.createdAt)}` : undefined}
        maxWidth="max-w-4xl"
      >
        {openSession && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SegmentedControl
                label="Detalhe da sessão"
                options={[
                  { value: 'resumo', label: 'Resumo' },
                  { value: 'divergencias', label: detail ? `Divergências (${intFmt(divergences.length)})` : 'Divergências' },
                  { value: 'validacao', label: 'Validação' },
                  { value: 'rca', label: 'RCA' },
                ]}
                value={detailTab}
                onChange={setDetailTab}
              />
              {openSession.approved
                ? <Badge variant="success">Aprovada</Badge>
                : <Badge variant="neutral">Não aprovada</Badge>}
            </div>

            {detailTab === 'resumo' && (
              <div className="rounded-container border border-edge/60">
                <DetailRow label="Tipo" value={countNumberLabel(openSession.countNumber)} />
                <DetailRow label="Origem" value={openSession.source === 'import' ? 'Importação' : 'Registro manual'} />
                <DetailRow label="Operador" value={openSession.operator ?? '—'} />
                {openSession.operator2 && <DetailRow label="Operador 2" value={openSession.operator2} />}
                <DetailRow label="Registrada em" value={`${dateFmt(openSession.createdAt)} • ${timeFmt(openSession.createdAt)}`} />
                {openSession.finishedAt && (
                  <DetailRow label="Concluída em" value={`${dateFmt(openSession.finishedAt)} • ${timeFmt(openSession.finishedAt)}`} />
                )}
                <DetailRow label="SKUs previstos" value={intFmt(openSession.totalSku)} />
                <DetailRow label="SKUs contados" value={intFmt(openSession.skusContados)} />
                <DetailRow
                  label="Cobertura"
                  value={openSession.coveragePct !== null ? pctFmt(openSession.coveragePct) : 'Sem universo previsto registrado'}
                />
                <DetailRow label="Divergências encontradas" value={intFmt(openSession.divergenciasEncontradas)} />
                <DetailRow label="Divergências recontadas" value={intFmt(openSession.divergenciasRecontadas)} />
                <DetailRow label="Divergências reais" value={intFmt(openSession.divergenciasReais)} />
                <DetailRow
                  label="Taxa de divergência"
                  value={openSession.divergenceRatePct !== null ? pctFmt(openSession.divergenceRatePct) : 'Nenhum SKU contado'}
                />
                <DetailRow label="Acurácia" value={openSession.accuracy !== null ? pctFmt(openSession.accuracy) : '—'} />
                {openSession.approvedAt && (
                  <DetailRow label="Aprovada em" value={`${dateFmt(openSession.approvedAt)} • ${timeFmt(openSession.approvedAt)}`} />
                )}
              </div>
            )}

            {detailTab === 'divergencias' && (
              detailError ? (
                <Notice tone="danger">Não foi possível carregar as divergências desta sessão.</Notice>
              ) : detailLoading || !detail ? (
                <p className="py-8 text-center text-sm text-fg-subtle">Carregando divergências...</p>
              ) : detail.totalItems === 0 ? (
                <Notice tone="neutral">
                  {openSession.divergenciasReais > 0
                    ? `Esta sessão registra ${intFmt(openSession.divergenciasReais)} divergência(s) no total, mas não há detalhamento item a item disponível para ela.`
                    : 'Esta sessão não possui registro item a item.'}
                </Notice>
              ) : divergences.length === 0 ? (
                <Notice tone="success">Nenhum item divergente nesta sessão.</Notice>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-[13rem] flex-1">
                      <Input
                        icon={<Search />}
                        placeholder="Buscar por SKU, produto ou localização..."
                        value={itemSearch}
                        onChange={e => { setItemSearch(e.target.value); setItemPage(0); }}
                        aria-label="Buscar divergências da sessão"
                      />
                    </div>
                    <Button variant="secondary" size="sm" onClick={exportDivergences}>
                      <Download size={14} />
                      Exportar divergências
                    </Button>
                  </div>

                  {visibleDivergences.length === 0 ? (
                    <p className="py-6 text-center text-sm text-fg-subtle">Nenhum item corresponde à busca.</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto rounded-container border border-edge/60">
                        <Table>
                          <Thead>
                            <Tr>
                              <Th>SKU</Th><Th>Produto</Th>
                              <Th className="text-right">Sistema</Th>
                              <Th className="text-right">Contado</Th>
                              <Th className="text-right">Dif.</Th>
                              <Th>Localização</Th><Th>Status</Th><Th>RCA</Th>
                            </Tr>
                          </Thead>
                          <tbody>
                            {pagedDivergences.map(d => (
                              <Tr key={d.itemId}>
                                <Td className="font-mono text-xs">{d.sku ?? '—'}</Td>
                                <Td className="max-w-[14rem] truncate">{d.productName ?? '—'}</Td>
                                <Td numeric>{d.saldoSistema ?? '—'}</Td>
                                <Td numeric>{d.saldoContado ?? '—'}</Td>
                                <Td numeric className={(d.diferenca ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : undefined}>
                                  {d.diferenca ?? '—'}
                                </Td>
                                <Td className="font-mono text-xs">{d.location ?? '—'}</Td>
                                <Td className="text-xs text-fg-muted">{d.status ? STATUS_LABEL[d.status] ?? d.status : '—'}</Td>
                                <Td>{d.classifiedInRca ? <Badge variant="accent">Classificado</Badge> : <span className="text-xs text-fg-subtle">—</span>}</Td>
                              </Tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-caption">
                          Mostrando {intFmt(safePage * DIVERGENCE_PAGE_SIZE + 1)}–
                          {intFmt(safePage * DIVERGENCE_PAGE_SIZE + pagedDivergences.length)} de {intFmt(visibleDivergences.length)}
                        </p>
                        {pageCount > 1 && (
                          <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm" disabled={safePage === 0} onClick={() => setItemPage(safePage - 1)}>
                              <ChevronLeft size={14} />
                            </Button>
                            <span className="text-caption">{safePage + 1} / {pageCount}</span>
                            <Button variant="ghost" size="sm" disabled={safePage >= pageCount - 1} onClick={() => setItemPage(safePage + 1)}>
                              <ChevronRight size={14} />
                            </Button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            )}

            {detailTab === 'validacao' && (
              <div className="space-y-3">
                {!chain ? (
                  <Notice tone="neutral">Sem cadeia de contagem registrada para esta sessão.</Notice>
                ) : (
                  <>
                    {!chain.hasRecount && (
                      <Notice tone="neutral">
                        Sem reconferência registrada. A ausência de recontagem não é um erro da sessão — só significa
                        que ainda não existe amostra para avaliar independência.
                      </Notice>
                    )}
                    <div className="rounded-container border border-edge/60">
                      <DetailRow label="Contagem registrada por" value={chain.contadorName ?? '—'} />
                      <DetailRow label="Reconferência" value={chain.hasRecount ? 'Registrada' : 'Não registrada'} />
                      {chain.hasRecount && <DetailRow label="Reconferida por" value={chain.recontadorName ?? '—'} />}
                      {chain.hasRecount && (
                        <DetailRow
                          label="Independência"
                          value={chain.independent
                            ? 'Contagem, recontagem e aprovação por pessoas diferentes'
                            : 'Há sobreposição de papéis entre contagem, recontagem e aprovação'}
                        />
                      )}
                      <DetailRow label="Aprovação" value={chain.isApproved ? 'Registrada' : 'Pendente'} />
                      {chain.approvedAt && (
                        <DetailRow label="Aprovada em" value={`${dateFmt(chain.approvedAt)} • ${timeFmt(chain.approvedAt)}`} />
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {detailTab === 'rca' && (
              detailError ? (
                <Notice tone="danger">Não foi possível carregar as divergências desta sessão.</Notice>
              ) : detailLoading || !detail ? (
                <p className="py-8 text-center text-sm text-fg-subtle">Carregando vínculo com o RCA...</p>
              ) : divergences.length === 0 ? (
                <Notice tone="neutral">Sem divergências item a item desta sessão para investigar no RCA.</Notice>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-fg-muted">
                    {intFmt(detail.classifiedInRca)} de {intFmt(divergences.length)} divergência(s) desta sessão já
                    têm classificação de causa registrada no Root Cause Analysis.
                  </p>
                  {onNavigate && (
                    <Button variant="secondary" size="sm" onClick={() => { setOpenSession(null); onNavigate('rca'); }}>
                      Investigar no RCA
                      <ArrowRight size={14} />
                    </Button>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </Modal>
      {/* Drill-down do SKU reincidente — mesmo primitivo Modal do detalhe da sessão. */}
      <Modal
        open={!!openSku}
        onClose={() => setOpenSku(null)}
        title={openSku ? `SKU ${openSku} — histórico de divergências` : undefined}
        maxWidth="max-w-3xl"
      >
        {openSku && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              {intFmt(skuHistory.length)} divergência(s) em{' '}
              {intFmt(new Set(skuHistory.map(i => i.sessionId)).size)} sessão(ões) distinta(s) na janela de{' '}
              {intFmt(data?.rcaSettings.recurrence_window_days ?? 0)} dias.
            </p>
            <div className="max-h-[24rem] overflow-x-auto rounded-container border border-edge/60">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Data</Th><Th>Sessão</Th>
                    <Th className="text-right">Sistema</Th>
                    <Th className="text-right">Contado</Th>
                    <Th className="text-right">Dif.</Th>
                    <Th>Localização</Th><Th>RCA</Th><Th />
                  </Tr>
                </Thead>
                <tbody>
                  {skuHistory.map(item => {
                    const session = sessionById.get(item.sessionId) ?? null;
                    const link = rcaLinkByItem.get(item.itemId);
                    return (
                      <Tr
                        key={item.itemId}
                        className={session ? 'cursor-pointer' : undefined}
                        onClick={session ? () => { setOpenSku(null); openDetail(session); } : undefined}
                      >
                        <Td>{item.occurredAt ? dateFmt(item.occurredAt) : '—'}</Td>
                        <Td>{session ? countNumberLabel(session.countNumber) : '—'}</Td>
                        <Td numeric>{item.saldoSistema ?? '—'}</Td>
                        <Td numeric>{item.saldoContado ?? '—'}</Td>
                        <Td numeric className={(item.diferenca ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : undefined}>
                          {item.diferenca ?? '—'}
                        </Td>
                        <Td className="font-mono text-xs">{item.location ?? '—'}</Td>
                        <Td className="text-xs text-fg-muted">
                          {link ? link.causeLabel : <span className="text-fg-subtle">Não classificado</span>}
                        </Td>
                        <Td className="text-right">
                          {session && <ArrowRight size={16} className="inline text-fg-subtle" />}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
            <p className="text-caption">Clique em uma linha para abrir a sessão correspondente.</p>
            {onNavigate && skuHistory.some(i => rcaLinkByItem.has(i.itemId)) && (
              <Button variant="secondary" size="sm" onClick={() => { setOpenSku(null); onNavigate('rca'); }}>
                Investigar no RCA
                <ArrowRight size={14} />
              </Button>
            )}
          </div>
        )}
      </Modal>
    </Page>
  );
}

/** Card do resumo executivo — número em destaque, o que ele é, e a base usada. */
function KpiCard({ value, label, caption }: { value: string; label: string; caption: string }) {
  return (
    <Panel>
      <PanelSection padding="md">
        <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-fg">{value}</p>
        <p className="mt-1 text-sm font-medium text-fg">{label}</p>
        <p className="text-caption mt-0.5">{caption}</p>
      </PanelSection>
    </Panel>
  );
}

/** Célula de métrica dentro de um Panel — o mesmo tratamento tipográfico dos cards do topo,
 *  mas agrupada em um único painel dividido, sem virar quatro caixinhas soltas. */
function MetricCell({ value, label, caption, className = '' }: { value: string; label: string; caption: string; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-fg">{value}</p>
      <p className="mt-1 text-sm font-medium text-fg">{label}</p>
      <p className="text-caption mt-0.5">{caption}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption">{label}</span>
      {children}
    </label>
  );
}

/** Barra de cobertura deliberadamente discreta: o número é o dado, a barra só dá escala. */
function CoverageBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-3">
        <span className="block h-full rounded-full bg-accent/70" style={{ width: `${clamped}%` }} />
      </span>
      <span className="tabular-nums text-xs text-fg-muted">{pctFmt(pct)}</span>
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-edge/60 px-4 py-2.5 last:border-0">
      <span className="text-xs text-fg-subtle">{label}</span>
      <span className="text-sm text-fg tabular-nums text-right">{value}</span>
    </div>
  );
}
