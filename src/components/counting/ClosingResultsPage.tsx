// Resultados por Linha — consulta dos fechamentos individuais de cada linha/marca
// concluída no ciclo atual. Reaproveita o mesmo serviço/modal já usados pelo
// fluxo de contagem (closingReportService.ts, ClosingSummaryModal) — não duplica
// query nem fórmula de acuracidade.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileBarChart2, RefreshCw, Search } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Table, Thead, Tr, Th, Td, Badge, Button, Input } from '../ui';
import type { BrandData } from '../../lib/supabase';
import {
  generateClosingReport,
  listCurrentReportsForCycle,
  buildClosingResults,
  type ClosingResultRow,
} from '../../lib/closingReports/closingReportService';
import type { ClosingReport, ClosingReportObservation } from '../../lib/closingReports/closingReportTypes';
import { ClosingSummaryModal } from './closing/ClosingSummaryModal';
import { ClosingCategoriesModal } from './closing/ClosingCategoriesModal';

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

export function ClosingResultsPage({ companyId, brandsData, userId, userEmail }: ClosingResultsPageProps) {
  const [reports, setReports] = useState<ClosingReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busyBrandId, setBusyBrandId] = useState<string | null>(null);

  const [closingReport, setClosingReport] = useState<ClosingReport | null>(null);
  const [closingObservations, setClosingObservations] = useState<ClosingReportObservation[]>([]);
  const [closingBrandName, setClosingBrandName] = useState('');
  const [reprocessing, setReprocessing] = useState(false);
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setReports(await listCurrentReportsForCycle(companyId));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os resultados.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const upsertReport = (report: ClosingReport) => {
    setReports(prev => {
      const idx = prev.findIndex(r => r.brandId === report.brandId);
      if (idx === -1) return [...prev, report];
      const next = [...prev];
      next[idx] = report;
      return next;
    });
  };

  const rows = useMemo(() => {
    const all = buildClosingResults(brandsData, reports);
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(r => r.brandName.toLowerCase().includes(q));
  }, [brandsData, reports, search]);

  const handleOpen = async (row: ClosingResultRow) => {
    setBusyBrandId(row.brandId);
    const result = await generateClosingReport(companyId, row.brandId, { userId, userEmail });
    if (result.status === 'generated' || result.status === 'already_current') {
      upsertReport(result.report);
      setClosingBrandName(row.brandName);
      setClosingReport(result.report);
      setClosingObservations(result.observations);
    } else if (result.status === 'error') {
      console.error('Error opening closing report:', result.message);
    }
    setBusyBrandId(null);
  };

  const handleReprocess = async () => {
    if (!closingReport) return;
    setReprocessing(true);
    const result = await generateClosingReport(companyId, closingReport.brandId, {
      force: true, userId, userEmail,
    });
    if (result.status === 'generated' || result.status === 'already_current') {
      upsertReport(result.report);
      setClosingReport(result.report);
      setClosingObservations(result.observations);
    } else if (result.status === 'error') {
      console.error('Error reprocessing closing report:', result.message);
    }
    setReprocessing(false);
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Dashboard"
        title="Resultados por Linha"
        description="Fechamentos individuais de cada linha/marca concluída neste ciclo — SKUs contados, divergências reais e acuracidade final."
      />

      <Panel>
        <PanelSection padding="sm" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-section">Linhas concluídas ({rows.length})</p>
          <Input
            icon={<Search />}
            placeholder="Buscar linha ou marca"
            aria-label="Buscar linha ou marca"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="sm:w-64"
          />
        </PanelSection>

        {loading ? (
          <PanelSection padding="lg" className="flex items-center justify-center text-fg-subtle text-sm gap-2">
            <RefreshCw size={14} className="animate-spin" /> Carregando...
          </PanelSection>
        ) : loadError ? (
          <PanelSection padding="lg" className="text-center">
            <p className="text-sm text-red-600 dark:text-red-400 mb-3">{loadError}</p>
            <Button size="sm" variant="secondary" onClick={load}>Tentar de novo</Button>
          </PanelSection>
        ) : rows.length === 0 ? (
          <PanelSection padding="lg" className="text-center text-fg-subtle flex flex-col items-center gap-2">
            <FileBarChart2 size={22} className="text-fg-subtle" />
            {brandsData.length === 0 || search
              ? 'Nenhuma linha concluída encontrada.'
              : 'Nenhuma linha foi concluída ainda neste ciclo.'}
          </PanelSection>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Linha/Marca</Th>
                  <Th>Data do fechamento</Th>
                  <Th>SKUs contados</Th>
                  <Th>Divergências reais</Th>
                  <Th>Acuracidade final</Th>
                  <Th>Status</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <tbody>
                {rows.map(row => (
                  <Tr key={row.brandId}>
                    <Td className="font-medium text-fg">{row.brandName}</Td>
                    <Td className="text-fg-muted whitespace-nowrap">{formatDateTime(row.report?.generatedAt ?? null)}</Td>
                    <Td className="text-fg-muted">{row.report ? row.report.skusContados : '—'}</Td>
                    <Td className="text-fg-muted">{row.report ? row.report.divergenciasReais : '—'}</Td>
                    <Td className="text-fg-muted">
                      {row.report && row.report.accuracyFinal !== null ? `${row.report.accuracyFinal.toFixed(1)}%` : '—'}
                    </Td>
                    <Td>
                      <Badge variant={row.report ? 'success' : 'neutral'}>
                        {row.report ? 'Gerado' : 'Resumo ainda não gerado'}
                      </Badge>
                    </Td>
                    <Td>
                      <Button size="sm" variant="ghost" disabled={busyBrandId === row.brandId} onClick={() => handleOpen(row)}>
                        {busyBrandId === row.brandId ? 'Carregando...' : row.report ? 'Ver resultado' : 'Gerar resumo'}
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
        open={!!closingReport}
        onClose={() => setClosingReport(null)}
        brandName={closingBrandName}
        report={closingReport}
        observations={closingObservations}
        reprocessing={reprocessing}
        onReprocess={handleReprocess}
        onManageCategories={() => setManageCategoriesOpen(true)}
      />
      <ClosingCategoriesModal
        open={manageCategoriesOpen}
        onClose={() => setManageCategoriesOpen(false)}
        companyId={companyId}
        onChanged={() => {}}
      />
    </Page>
  );
}

export default ClosingResultsPage;
