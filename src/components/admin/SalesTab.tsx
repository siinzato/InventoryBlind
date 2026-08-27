// Aba "Vendas e Integrações" — Top 10 com dois modos de origem: manual (métrica + período sobre
// vendas importadas, comportamento original preservado) ou automático pela Curva ABC (consome
// somente resultados já calculados e publicados — nunca recalcula faturamento, quantidade, custo,
// CMV, lucro bruto ou classificação). Histórico de importações e assistente de upload inalterados.
// Puramente analítico: nunca altera estoque, inventário ou contagem.

import { useEffect, useMemo, useState } from 'react';
import { Upload, TrendingUp, History, Package, AlertTriangle } from 'lucide-react';
import { Panel, PanelSection, Button, Select, Table, Thead, Tr, Th, Td, SegmentedControl, ListRow } from '../ui';
import { computeTopTen, type TopTenMetric, type TopTenPeriodPreset } from '../../lib/adminSales/salesTopTen';
import { listImportBatches, listSalesRecordsForTopTen, type SalesImportBatch } from '../../lib/adminSales/salesService';
import {
  getTop10Config, upsertTop10Config, listEligibleAbcAnalyses, getAutomaticTopTen,
  type Top10SourceMode, type AdminTopTenConfig,
} from '../../lib/adminSales/top10Config';
import type { AbcRankingMetric, AutomaticTopTenResult } from '../../lib/adminSales/salesTopTen';
import type { AbcCurveAnalysis } from '../../lib/abcCurve/abcCurveService';
import { canAdministerRecords } from '../../lib/admin/recordAdmin';
import { logAuditEvent } from '../../lib/auditLogService';
import { SalesImportWizard } from './SalesImportWizard';

interface SalesTabProps {
  companyId: string;
  userId: string;
  userEmail: string;
  role: string | null | undefined;
}

const PERIOD_OPTIONS: { value: TopTenPeriodPreset; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'mes_atual', label: 'Mês atual' },
];

const RANKING_METRIC_OPTIONS: { value: AbcRankingMetric; label: string }[] = [
  { value: 'revenue', label: 'Faturamento' },
  { value: 'quantity', label: 'Quantidade vendida' },
  { value: 'gross_profit', label: 'Lucro bruto' },
];

const RANKING_METRIC_LABEL: Record<AbcRankingMetric, string> = {
  revenue: 'Faturamento', quantity: 'Quantidade vendida', gross_profit: 'Lucro bruto',
};

interface DisplayEntry { position: number; productName: string; sku: string | null; quantity: number; totalValue: number }

export function SalesTab({ companyId, userId, userEmail, role }: SalesTabProps) {
  const canWrite = canAdministerRecords(role);

  const [metric, setMetric] = useState<TopTenMetric>('quantidade');
  const [period, setPeriod] = useState<TopTenPeriodPreset>('30d');
  const [records, setRecords] = useState<Awaited<ReturnType<typeof listSalesRecordsForTopTen>>>([]);
  const [batches, setBatches] = useState<SalesImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);

  const [config, setConfig] = useState<AdminTopTenConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [sourceMode, setSourceMode] = useState<Top10SourceMode>('manual');
  const [analyses, setAnalyses] = useState<AbcCurveAnalysis[]>([]);
  const [abcAnalysisId, setAbcAnalysisId] = useState<string | null>(null);
  const [rankingMetric, setRankingMetric] = useState<AbcRankingMetric | null>(null);
  const [automaticResult, setAutomaticResult] = useState<AutomaticTopTenResult | null>(null);
  const [automaticLoading, setAutomaticLoading] = useState(false);
  const [automaticError, setAutomaticError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [r, b] = await Promise.all([
        listSalesRecordsForTopTen(companyId),
        listImportBatches(companyId),
      ]);
      setRecords(r);
      setBatches(b);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    listEligibleAbcAnalyses(companyId).then(setAnalyses).catch(() => setAnalyses([]));
    getTop10Config(companyId).then(cfg => {
      setConfig(cfg);
      setConfigLoaded(true);
      if (cfg) {
        setEnabled(cfg.enabled);
        setSourceMode(cfg.sourceMode);
        setMetric(cfg.manualMetric);
        setPeriod(cfg.manualPeriodPreset);
        setAbcAnalysisId(cfg.abcAnalysisId);
        setRankingMetric(cfg.rankingMetric);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => {
    if (sourceMode !== 'automatic_abc' || !abcAnalysisId || !rankingMetric) { setAutomaticResult(null); setAutomaticError(null); return; }
    setAutomaticLoading(true);
    setAutomaticError(null);
    getAutomaticTopTen(companyId, abcAnalysisId, rankingMetric)
      .then(setAutomaticResult)
      .catch(() => setAutomaticError('Não foi possível carregar o ranking automático desta análise.'))
      .finally(() => setAutomaticLoading(false));
  }, [companyId, sourceMode, abcAnalysisId, rankingMetric]);

  const topTen = useMemo(
    () => computeTopTen(records, metric, { preset: period }, new Date()),
    [records, metric, period]
  );

  const selectedAnalysis = analyses.find(a => a.id === abcAnalysisId) ?? null;
  // Referência salva que não está mais entre as análises publicadas da empresa — não seleciona
  // outra sozinho, só avisa (a config em si permanece intacta até uma ação administrativa).
  const savedAnalysisMissing = configLoaded && config?.sourceMode === 'automatic_abc' && !!config.abcAnalysisId
    && !analyses.some(a => a.id === config.abcAnalysisId);

  const displayEntries: DisplayEntry[] = sourceMode === 'automatic_abc'
    ? (automaticResult?.entries.map(e => ({ position: e.position, productName: e.productName, sku: e.sku, quantity: e.quantity, totalValue: e.revenue })) ?? [])
    : topTen;

  const canSave = sourceMode === 'manual' || (!!abcAnalysisId && !!rankingMetric);

  const handleSave = async () => {
    if (!canWrite || !canSave) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const saved = await upsertTop10Config(companyId, {
        enabled, sourceMode, manualMetric: metric, manualPeriodPreset: period,
        manualPeriodFrom: null, manualPeriodTo: null, abcAnalysisId, rankingMetric,
      });
      setConfig(saved);
      await logAuditEvent({
        companyId, userId, userEmail, action: 'top10_config.updated',
        resourceType: 'admin_top10_config', resourceId: companyId,
        description: `Top 10 configurado: ${sourceMode === 'automatic_abc' ? 'automático pela Curva ABC' : 'manual'}${enabled ? '' : ' (desativado)'}`,
        metadata: { enabled, sourceMode, abcAnalysisId, rankingMetric },
      });
      setSaveMessage('Configuração salva.');
    } catch {
      setSaveMessage('Não foi possível salvar a configuração. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const hideBlock = configLoaded && !enabled && !canWrite;

  return (
    <div className="space-y-6">
      {!hideBlock && (
        <Panel>
          <PanelSection padding="sm" className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-title flex items-center gap-2"><TrendingUp size={16} className="text-fg-subtle" /> Top 10 de Vendas</h3>
            <Button size="sm" onClick={() => setShowWizard(true)}><Upload size={14} /> Importar Vendas</Button>
          </PanelSection>

          {canWrite ? (
            <PanelSection className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-fg cursor-pointer">
                <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
                Ativar bloco Top 10
              </label>
              {enabled && (
                <>
                  <SegmentedControl
                    label="Origem do Top 10"
                    value={sourceMode}
                    onChange={setSourceMode}
                    options={[{ value: 'manual', label: 'Seleção manual' }, { value: 'automatic_abc', label: 'Automático pela Curva ABC' }]}
                  />

                  {sourceMode === 'manual' && (
                    <div className="flex flex-wrap items-center gap-3">
                      <SegmentedControl
                        label="Métrica"
                        value={metric}
                        onChange={setMetric}
                        options={[{ value: 'quantidade', label: 'Quantidade vendida' }, { value: 'faturamento', label: 'Faturamento' }]}
                      />
                      <SegmentedControl label="Período" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
                    </div>
                  )}

                  {sourceMode === 'automatic_abc' && (
                    <div className="space-y-3">
                      {analyses.length === 0 ? (
                        <p className="text-sm text-fg-subtle">Nenhuma análise concluída da Curva ABC disponível. Publique uma análise em Produtos → Curva ABC para usar o modo automático.</p>
                      ) : (
                        <div className="flex flex-wrap items-center gap-3">
                          <Select value={abcAnalysisId ?? ''} onChange={e => setAbcAnalysisId(e.target.value || null)} className="max-w-sm">
                            <option value="">Selecione uma análise…</option>
                            {analyses.map(a => (
                              <option key={a.id} value={a.id}>{a.name} — {a.salesPeriodStart} a {a.salesPeriodEnd}</option>
                            ))}
                          </Select>
                          <SegmentedControl
                            label="Critério do ranking"
                            value={rankingMetric}
                            onChange={setRankingMetric}
                            options={RANKING_METRIC_OPTIONS}
                          />
                        </div>
                      )}
                      {selectedAnalysis && (
                        <p className="text-xs text-fg-subtle">
                          {selectedAnalysis.name} · Período: {selectedAnalysis.salesPeriodStart} a {selectedAnalysis.salesPeriodEnd}
                          {selectedAnalysis.publishedAt && ` · Processada em ${new Date(selectedAnalysis.publishedAt).toLocaleDateString('pt-BR')}`}
                        </p>
                      )}
                      {automaticError && <p className="text-xs text-red-600 dark:text-red-400">{automaticError}</p>}
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <Button size="sm" onClick={handleSave} disabled={saving || !canSave}>{saving ? 'Salvando…' : 'Salvar configuração'}</Button>
                    {saveMessage && <p className="text-xs text-fg-muted">{saveMessage}</p>}
                  </div>
                </>
              )}
            </PanelSection>
          ) : (
            configLoaded && enabled && (
              <PanelSection padding="sm">
                <p className="text-xs text-fg-subtle">
                  Origem: {sourceMode === 'automatic_abc' ? 'Automático pela Curva ABC' : 'Seleção manual'}
                  {sourceMode === 'automatic_abc' && selectedAnalysis && ` · ${selectedAnalysis.name} · Critério: ${rankingMetric ? RANKING_METRIC_LABEL[rankingMetric] : '—'}`}
                </p>
              </PanelSection>
            )
          )}

          {savedAnalysisMissing && (
            <PanelSection padding="sm" className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle size={14} className="flex-shrink-0" />
              <p className="text-xs">A análise configurada para o Top 10 automático não está mais disponível. Selecione outra análise publicada.</p>
            </PanelSection>
          )}

          {enabled && (
            <PanelSection className="overflow-x-auto">
              {sourceMode === 'automatic_abc' ? (
                automaticLoading ? (
                  <p className="text-sm text-fg-subtle text-center py-6">Carregando ranking automático...</p>
                ) : !abcAnalysisId ? (
                  <p className="text-sm text-fg-subtle text-center py-6">Selecione uma análise da Curva ABC para ver a prévia.</p>
                ) : displayEntries.length === 0 ? (
                  <p className="text-sm text-fg-subtle text-center py-6">Nenhum produto elegível encontrado nesta análise.</p>
                ) : (
                  <>
                    <Table>
                      <Thead>
                        <Tr>
                          <Th>#</Th><Th>Produto</Th><Th>SKU</Th>
                          <Th className="text-right">Quantidade</Th><Th className="text-right">Faturamento</Th>
                        </Tr>
                      </Thead>
                      <tbody>
                        {displayEntries.map(entry => (
                          <Tr key={`${entry.sku}-${entry.productName}`}>
                            <Td>{entry.position}</Td>
                            <Td>{entry.productName}</Td>
                            <Td className="font-mono text-xs">{entry.sku ?? '—'}</Td>
                            <Td numeric>{entry.quantity}</Td>
                            <Td numeric>{entry.totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                    {automaticResult && (automaticResult.ignoredForNoCatalogMatch > 0 || automaticResult.ignoredForMissingMetric > 0) && (
                      <p className="text-xs text-fg-subtle mt-2">
                        {automaticResult.ignoredForNoCatalogMatch > 0 && `${automaticResult.ignoredForNoCatalogMatch} produto(s) sem correspondência no catálogo foram ignorados. `}
                        {automaticResult.ignoredForMissingMetric > 0 && `${automaticResult.ignoredForMissingMetric} produto(s) sem o critério selecionado foram ignorados.`}
                      </p>
                    )}
                  </>
                )
              ) : loading ? (
                <p className="text-sm text-fg-subtle text-center py-6">Carregando...</p>
              ) : records.length === 0 ? (
                <div className="text-center py-8">
                  <Package size={28} className="mx-auto text-fg-subtle mb-2" />
                  <p className="text-sm text-fg-muted">Nenhuma venda importada ainda. Use "Importar Vendas" para começar.</p>
                </div>
              ) : topTen.length === 0 ? (
                <p className="text-sm text-fg-subtle text-center py-6">Nenhuma venda no período selecionado.</p>
              ) : (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>#</Th><Th>Produto</Th><Th>SKU</Th>
                      <Th className="text-right">Quantidade</Th><Th className="text-right">Faturamento</Th>
                    </Tr>
                  </Thead>
                  <tbody>
                    {topTen.map(entry => (
                      <Tr key={`${entry.sku}-${entry.productName}`}>
                        <Td>{entry.position}</Td>
                        <Td>{entry.productName}</Td>
                        <Td className="font-mono text-xs">{entry.sku ?? '—'}</Td>
                        <Td numeric>{entry.quantity}</Td>
                        <Td numeric>{entry.totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </PanelSection>
          )}
        </Panel>
      )}

      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title flex items-center gap-2"><History size={16} className="text-fg-subtle" /> Histórico de Importações</h3>
        </PanelSection>
        <PanelSection>
          {batches.length === 0 ? (
            <p className="text-sm text-fg-subtle text-center py-4">Nenhuma importação registrada ainda.</p>
          ) : (
            <div>
              {batches.map(b => (
                <ListRow
                  key={b.id}
                  value={
                    <div className="text-right">
                      <p>{b.rowCount} linhas</p>
                      {b.unmatchedCount > 0 && <p className="text-amber-600 dark:text-amber-400">{b.unmatchedCount} não associadas</p>}
                    </div>
                  }
                >
                  <p className="font-medium text-fg truncate">{b.fileName}</p>
                  <p className="text-caption mt-0.5">{new Date(b.createdAt).toLocaleString('pt-BR')} · {b.status === 'completed' ? 'Concluída' : 'Falhou'}</p>
                </ListRow>
              ))}
            </div>
          )}
        </PanelSection>
      </Panel>

      {showWizard && (
        <SalesImportWizard
          companyId={companyId} userId={userId} userEmail={userEmail}
          onClose={() => setShowWizard(false)}
          onImported={load}
        />
      )}
    </div>
  );
}
