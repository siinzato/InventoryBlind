// Resultados por Linha — histórico consultável dos fechamentos de linha/marca. Três
// escopos (ciclo atual, concluídos, arquivados), cada um lendo a fonte real que já
// existe; ver closingResultsScope.ts para a montagem/filtragem pura.
//
// Visualizar é READ-ONLY: um fechamento já gravado abre com o próprio relatório
// persistido, sem chamar generateClosingReport, sem recalcular acuracidade e sem gerar
// nova versão. A única exceção é o legado — linha concluída deste ciclo que nunca teve
// relatório — que é materializada uma única vez, sem `force`.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, FileBarChart2, RefreshCw, Search } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Table, Thead, Tr, Th, Td, Badge, Button, Input, Select, SegmentedControl, Modal } from '../ui';
import type { BrandData } from '../../lib/supabase';
import {
  generateClosingReport,
  getObservationsForReport,
  listArchivedInventoryClosings,
  listClosingReportsHistory,
  listCurrentReportsForCycle,
  type ArchivedInventoryData,
} from '../../lib/closingReports/closingReportService';
import type { ClosingReport, ClosingReportObservation } from '../../lib/closingReports/closingReportTypes';
import {
  brandNameOptions,
  buildArchivedScopeRows,
  buildCompletedScopeRows,
  buildCurrentScopeRows,
  filterClosingRows,
  inventoryOptions,
  CLOSING_PERIOD_OPTIONS,
  CLOSING_SCOPE_OPTIONS,
  EMPTY_CLOSING_FILTERS,
  type ClosingListFilters,
  type ClosingListRow,
  type ClosingPeriod,
  type ClosingScope,
} from '../../lib/closingReports/closingResultsScope';
import { loadLineLogoUrlMap } from '../../lib/brandLogos/brandLogoService';
import { lineLogoUrl } from '../../lib/brandLogos/brandLogoAlgorithm';
import { BrandMark } from '../brandLogos/BrandMark';
import { ClosingSummaryModal } from './closing/ClosingSummaryModal';

interface ClosingResultsPageProps {
  companyId: string;
  brandsData: BrandData[];
  userId: string;
  userEmail: string | null;
}

const formatDateTime = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
};

const formatAccuracy = (value: number | null): string => (value !== null ? `${value.toFixed(1)}%` : '—');

export function ClosingResultsPage({ companyId, brandsData, userId, userEmail }: ClosingResultsPageProps) {
  const [scope, setScope] = useState<ClosingScope>('current');
  const [filters, setFilters] = useState<ClosingListFilters>(EMPTY_CLOSING_FILTERS);

  const [currentReports, setCurrentReports] = useState<ClosingReport[]>([]);
  const [historyReports, setHistoryReports] = useState<ClosingReport[] | null>(null);
  const [archived, setArchived] = useState<ArchivedInventoryData | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  /** nome canônico da marca -> URL do logo, só do workspace atual. */
  const [logoByKey, setLogoByKey] = useState<Record<string, string>>({});

  const [openReport, setOpenReport] = useState<ClosingReport | null>(null);
  const [openObservations, setOpenObservations] = useState<ClosingReportObservation[]>([]);
  const [openBrandName, setOpenBrandName] = useState('');
  const [openArchived, setOpenArchived] = useState<ClosingListRow | null>(null);

  // Troca de workspace: tudo que estava em memória pertencia ao workspace anterior —
  // resultados, histórico, filtros e logos são descartados antes de recarregar.
  useEffect(() => {
    setScope('current');
    setFilters(EMPTY_CLOSING_FILTERS);
    setCurrentReports([]);
    setHistoryReports(null);
    setArchived(null);
    setLogoByKey({});
    setOpenReport(null);
    setOpenArchived(null);
  }, [companyId]);

  const loadCurrent = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [reports, logos] = await Promise.all([
        listCurrentReportsForCycle(companyId),
        loadLineLogoUrlMap(companyId).catch(() => ({} as Record<string, string>)),
      ]);
      setCurrentReports(reports);
      setLogoByKey(logos);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os resultados.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { loadCurrent(); }, [loadCurrent]);

  // Histórico e arquivados só são buscados quando o escopo é aberto.
  useEffect(() => {
    if (scope !== 'completed' || historyReports !== null) return;
    let cancelled = false;
    setLoading(true);
    listClosingReportsHistory(companyId)
      .then(rows => { if (!cancelled) setHistoryReports(rows); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, historyReports, companyId]);

  useEffect(() => {
    if (scope !== 'archived' || archived !== null) return;
    let cancelled = false;
    setLoading(true);
    listArchivedInventoryClosings(companyId)
      .then(rows => { if (!cancelled) setArchived(rows); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, archived, companyId]);

  const brandNameById = useMemo(() => new Map(brandsData.map(b => [b.id, b.brand])), [brandsData]);

  const scopeRows = useMemo(() => {
    if (scope === 'current') return buildCurrentScopeRows(brandsData, currentReports);
    if (scope === 'completed') return buildCompletedScopeRows(historyReports ?? [], brandNameById);
    return buildArchivedScopeRows(archived?.lines ?? []);
  }, [scope, brandsData, currentReports, historyReports, archived, brandNameById]);

  const rows = useMemo(() => filterClosingRows(scopeRows, filters), [scopeRows, filters]);
  const inventories = useMemo(() => inventoryOptions(scopeRows), [scopeRows]);
  const brandNames = useMemo(() => brandNameOptions(scopeRows), [scopeRows]);

  const patchFilters = (patch: Partial<ClosingListFilters>) => setFilters(prev => ({ ...prev, ...patch }));

  const handleScopeChange = (next: ClosingScope) => {
    setScope(next);
    // Filtro de um escopo não faz sentido no outro (inventário/marca são listas próprias).
    setFilters(EMPTY_CLOSING_FILTERS);
  };

  /** Abre um fechamento. Com relatório persistido, lê só as observações dele. */
  const handleOpen = async (row: ClosingListRow) => {
    if (row.scope === 'archived') { setOpenArchived(row); return; }

    setBusyKey(row.key);
    try {
      if (row.report) {
        const observations = await getObservationsForReport(row.report.id);
        setOpenBrandName(row.brandName);
        setOpenReport(row.report);
        setOpenObservations(observations);
      } else if (row.brandId) {
        // Legado: linha concluída que nunca teve relatório. Materializa uma única vez,
        // sem `force` — a chamada é idempotente e devolve o existente se houver corrida.
        const result = await generateClosingReport(companyId, row.brandId, { userId, userEmail });
        if (result.status === 'generated' || result.status === 'already_current') {
          setCurrentReports(prev => {
            const idx = prev.findIndex(r => r.brandId === result.report.brandId);
            if (idx === -1) return [...prev, result.report];
            const next = [...prev];
            next[idx] = result.report;
            return next;
          });
          setOpenBrandName(row.brandName);
          setOpenReport(result.report);
          setOpenObservations(result.observations);
        } else if (result.status === 'error') {
          console.error('Error materializing closing report:', result.message);
          setLoadError('Não foi possível abrir este fechamento.');
        }
      }
    } finally {
      setBusyKey(null);
    }
  };

  const showInventoryFilter = scope !== 'current' && inventories.length > 1;

  return (
    <Page>
      <PageHeader
        eyebrow="Dashboard"
        title="Resultados por Linha"
        description="Fechamentos individuais de cada linha/marca concluída neste ciclo — SKUs contados, divergências reais e acuracidade final."
      />

      <SegmentedControl
        label="Escopo dos fechamentos"
        value={scope}
        onChange={handleScopeChange}
        options={CLOSING_SCOPE_OPTIONS}
      />

      {/* Inventários arquivados: o cabeçalho do snapshot existe mesmo quando ele não tem
          detalhamento por linha gravado. Listar aqui responde "quais inventários foram
          arquivados" sem fabricar linhas que o histórico não tem. */}
      {scope === 'archived' && (archived?.inventories.length ?? 0) > 0 && (
        <Panel>
          <PanelSection padding="sm">
            <p className="text-section">Inventários arquivados ({archived?.inventories.length})</p>
          </PanelSection>
          {archived?.inventories.map(inv => (
            <PanelSection key={inv.id} padding="sm" className="border-t border-edge flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg truncate">{inv.name}</p>
                <p className="text-caption">
                  {inv.startDate ? new Date(inv.startDate).toLocaleDateString('pt-BR') : '—'}
                  {' → '}
                  {inv.endDate ? new Date(inv.endDate).toLocaleDateString('pt-BR') : '—'}
                </p>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <span className="text-fg-muted">SKUs contados <span className="font-semibold text-fg">{inv.totalDone ?? '—'}</span></span>
                <span className="text-fg-muted">Divergências <span className="font-semibold text-fg">{inv.totalDivergences ?? '—'}</span></span>
                <span className="text-fg-muted">Acuracidade <span className="font-semibold text-fg">{formatAccuracy(inv.accuracy)}</span></span>
              </div>
            </PanelSection>
          ))}
        </Panel>
      )}

      <Panel>
        <PanelSection padding="sm" className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="flex flex-wrap items-end gap-3 flex-1">
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Período</label>
              <Select
                value={filters.period}
                onChange={e => patchFilters({ period: e.target.value as ClosingPeriod })}
                className="w-40"
                aria-label="Período"
              >
                {CLOSING_PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>

            {showInventoryFilter && (
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">Inventário / Ciclo</label>
                <Select
                  value={filters.inventoryId}
                  onChange={e => patchFilters({ inventoryId: e.target.value })}
                  className="w-56"
                  aria-label="Inventário ou ciclo"
                >
                  <option value="all">Todos</option>
                  {inventories.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </div>
            )}

            {brandNames.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">Linha/Marca</label>
                <Select
                  value={filters.brandName}
                  onChange={e => patchFilters({ brandName: e.target.value })}
                  className="w-48"
                  aria-label="Linha ou marca"
                >
                  <option value="all">Todas</option>
                  {brandNames.map(name => <option key={name} value={name}>{name}</option>)}
                </Select>
              </div>
            )}
          </div>

          <div className="flex items-end gap-3">
            <Input
              icon={<Search />}
              placeholder="Buscar linha ou marca"
              aria-label="Buscar linha ou marca"
              value={filters.search}
              onChange={e => patchFilters({ search: e.target.value })}
              className="lg:w-64"
            />
            <Button size="sm" variant="ghost" onClick={loadCurrent} aria-label="Atualizar">
              <RefreshCw size={14} />
            </Button>
          </div>
        </PanelSection>

        <PanelSection padding="sm" className="flex items-center justify-between gap-3">
          <p className="text-section">
            {scope === 'current' ? 'Linhas concluídas neste ciclo' : scope === 'completed' ? 'Fechamentos realizados' : 'Linhas do histórico arquivado'} ({rows.length})
          </p>
        </PanelSection>

        {loading ? (
          <PanelSection padding="lg" className="flex items-center justify-center text-fg-subtle text-sm gap-2">
            <RefreshCw size={14} className="animate-spin" /> Carregando...
          </PanelSection>
        ) : loadError ? (
          <PanelSection padding="lg" className="text-center">
            <p className="text-sm text-red-600 dark:text-red-400 mb-3">{loadError}</p>
            <Button size="sm" variant="secondary" onClick={loadCurrent}>Tentar de novo</Button>
          </PanelSection>
        ) : rows.length === 0 ? (
          <PanelSection padding="lg" className="text-center text-fg-subtle flex flex-col items-center gap-2">
            <FileBarChart2 size={22} className="text-fg-subtle" />
            {scope === 'current'
              ? 'Nenhuma linha foi concluída ainda neste ciclo.'
              : scope === 'completed'
                ? 'Nenhum fechamento registrado no escopo selecionado.'
                : (archived?.inventories.length ?? 0) > 0
                  ? 'Os inventários arquivados acima não têm detalhamento por linha gravado no histórico.'
                  : 'Nenhum inventário arquivado no escopo selecionado.'}
          </PanelSection>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Linha/Marca</Th>
                  <Th>{scope === 'archived' ? 'Inventário' : 'Data do fechamento'}</Th>
                  <Th>SKUs contados</Th>
                  <Th>Divergências reais</Th>
                  <Th>Acuracidade final</Th>
                  <Th>Ação</Th>
                </Tr>
              </Thead>
              <tbody>
                {rows.map(row => (
                  <Tr key={row.key}>
                    <Td className="font-medium text-fg">
                      <span className="flex items-center gap-2.5 min-w-0">
                        <BrandMark name={row.brandName} url={lineLogoUrl(row.brandName, logoByKey)} />
                        <span className="truncate">{row.brandName}</span>
                        {row.contextLabel && <Badge variant="neutral">{row.contextLabel}</Badge>}
                      </span>
                    </Td>
                    <Td className="text-fg-muted whitespace-nowrap">
                      {scope === 'archived' ? (
                        <span className="flex flex-col">
                          <span>{row.inventoryLabel}</span>
                          <span className="text-caption">{formatDateTime(row.closedAt)}</span>
                        </span>
                      ) : (
                        formatDateTime(row.closedAt)
                      )}
                    </Td>
                    <Td className="text-fg-muted">{row.skusContados ?? '—'}</Td>
                    <Td className="text-fg-muted">{row.divergenciasReais ?? '—'}</Td>
                    <Td className="text-fg-muted">{formatAccuracy(row.accuracyFinal)}</Td>
                    <Td>
                      <Button size="sm" variant="ghost" disabled={busyKey === row.key} onClick={() => handleOpen(row)}>
                        {busyKey === row.key ? 'Abrindo...' : 'Visualizar fechamento'}
                        <ArrowRight size={14} />
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>

      <ClosingSummaryModal
        open={!!openReport}
        onClose={() => setOpenReport(null)}
        brandName={openBrandName}
        brandLogoUrl={lineLogoUrl(openBrandName, logoByKey)}
        report={openReport}
        observations={openObservations}
      />

      {/* Inventário arquivado: só o que o histórico gravou. Sem relatório de fechamento
          associado, nada de categorias ou observações inventadas. */}
      <Modal
        open={!!openArchived}
        onClose={() => setOpenArchived(null)}
        title={
          openArchived ? (
            <span className="flex items-center gap-3 min-w-0">
              {lineLogoUrl(openArchived.brandName, logoByKey) && (
                <BrandMark name={openArchived.brandName} url={lineLogoUrl(openArchived.brandName, logoByKey)} size="md" />
              )}
              <span className="min-w-0">
                <span className="block truncate">Fechamento arquivado — {openArchived.brandName}</span>
                <span className="block text-xs font-normal text-fg-subtle">{openArchived.inventoryLabel}</span>
              </span>
            </span>
          ) : undefined
        }
        maxWidth="max-w-lg"
      >
        {openArchived && (
          <div className="space-y-4">
            <Panel>
              <PanelSection padding="md" className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-fg-subtle">SKUs contados</p>
                  <p className="text-base font-semibold text-fg">{openArchived.skusContados ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-fg-subtle">Divergências</p>
                  <p className="text-base font-semibold text-fg">{openArchived.divergenciasReais ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-fg-subtle">Acuracidade final</p>
                  <p className="text-base font-semibold text-fg">{formatAccuracy(openArchived.accuracyFinal)}</p>
                </div>
                <div>
                  <p className="text-xs text-fg-subtle">Arquivado em</p>
                  <p className="text-base font-semibold text-fg">{formatDateTime(openArchived.closedAt)}</p>
                </div>
              </PanelSection>
            </Panel>
            <p className="text-caption">
              Registro histórico deste inventário. Não há resumo de fechamento com categorias e observações
              associado a ele.
            </p>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setOpenArchived(null)}>Fechar</Button>
            </div>
          </div>
        )}
      </Modal>
    </Page>
  );
}

export default ClosingResultsPage;
