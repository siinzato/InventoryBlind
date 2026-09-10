// Produtos -> Fonte de Saldo.
//
// Lista as fontes de saldo do workspace ativo e opera a única alimentada por
// planilha: "Tiny — Estoque diário", o relatório completo de estoque exportado
// pelo Tiny, enviado todo dia.
//
// A fonte é PERMANENTE: a configuração fica, e cada arquivo novo é uma leitura
// nova do estoque atual. Cada importação SUBSTITUI o saldo do produto na fonte —
// nunca soma ao snapshot anterior.
//
// O que esta tela NÃO faz: não altera o cadastro de produtos (nome, SKU, EAN,
// localização, marca, categoria), não altera o estoque do InventoryBlind, não
// altera contagem e não cria movimentação. O saldo importado vive na fonte.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  FileSpreadsheet,
  Upload,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Notice,
  Page,
  PageHeader,
  Panel,
  PanelSection,
  Stat,
  StatCell,
  StatRow,
  Table,
  Td,
  Th,
  Thead,
  Tr,
} from '../ui';
import { useAuth } from '../../lib/auth';
import { canSyncIntegrations } from '../../lib/permissionService';
import { countUnlinked, listProviders, listSyncRuns } from '../../lib/integrations/integrationService';
import type { IntegrationConnection, IntegrationProvider, SyncRun } from '../../lib/integrations/types';
import {
  ISSUE_LABEL,
  TINY_STOCK_SHEET_COLUMNS,
  TINY_STOCK_SHEET_PROVIDER_KEY,
  TINY_STOCK_SHEET_SOURCE_NAME,
  countSheetRecords,
} from '../../lib/integrations/stockSheet/tinyStockSheetContract';
import type { TinyStockSheetRecord } from '../../lib/integrations/stockSheet/tinyStockSheetContract';
import {
  activateTinyStockSheetSource,
  countSourceStockLevels,
  findTinyStockSheetSource,
  importTinyStockSheet,
  readStockSheetState,
  readTinyStockSheet,
} from '../../lib/integrations/stockSheet/stockSheetSourceService';
import type { StockSheetImportResult } from '../../lib/integrations/stockSheet/stockSheetSourceService';

const SAMPLE_LIMIT = 8;

interface LoadedSheet {
  fileName: string;
  sheetName: string;
  records: TinyStockSheetRecord[];
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

const RUN_STATUS_LABEL: Record<string, string> = {
  pending: 'Aguardando',
  running: 'Em andamento',
  success: 'Concluída',
  partial: 'Concluída com recusas',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

export function BalanceSourcePage({ onBack }: { onBack: () => void }) {
  const { profile, companyId } = useAuth();
  const canOperate = canSyncIntegrations(profile?.role);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<IntegrationProvider | null>(null);
  const [source, setSource] = useState<IntegrationConnection | null>(null);
  const [levelCount, setLevelCount] = useState<number | null>(null);
  const [unlinkedCount, setUnlinkedCount] = useState<number | null>(null);
  const [runs, setRuns] = useState<SyncRun[]>([]);

  const [activating, setActivating] = useState(false);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sheet, setSheet] = useState<LoadedSheet | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [result, setResult] = useState<StockSheetImportResult | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [providers, connection] = await Promise.all([
        listProviders('erp'),
        findTinyStockSheetSource(),
      ]);
      setProvider(providers.find(p => p.key === TINY_STOCK_SHEET_PROVIDER_KEY) ?? null);
      setSource(connection);

      if (connection) {
        const [levels, unlinked, history] = await Promise.all([
          countSourceStockLevels(connection.id),
          countUnlinked(connection.id, 'product'),
          listSyncRuns(connection.id, 10),
        ]);
        setLevelCount(levels);
        setUnlinkedCount(unlinked);
        setRuns(history);
      } else {
        setLevelCount(null);
        setUnlinkedCount(null);
        setRuns([]);
      }
    } catch (thrown) {
      console.error('[BalanceSource] failed to load:', thrown);
      setError('Não foi possível carregar as fontes de saldo deste workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!companyId) return;
    void load();
  }, [companyId, load]);

  const state = source ? readStockSheetState(source) : {};
  const counts = useMemo(() => (sheet ? countSheetRecords(sheet.records) : null), [sheet]);

  const clearSheet = () => {
    setSheet(null);
    setSheetError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFile = async (file: File) => {
    setSheetError(null);
    setResult(null);
    setSheet(null);
    setReading(true);
    try {
      const read = await readTinyStockSheet(file);
      if (!read.ok) {
        setSheetError(read.error);
        return;
      }
      setSheet({ fileName: file.name, sheetName: read.sheetName, records: read.records });
    } finally {
      setReading(false);
    }
  };

  const activate = async () => {
    setActivating(true);
    setError(null);
    try {
      const connection = await activateTinyStockSheetSource();
      setSource(connection);
      await load();
    } catch (thrown) {
      console.error('[BalanceSource] failed to activate source:', thrown);
      setError('Não foi possível ativar a fonte. Verifique se o seu papel permite configurar fontes.');
    } finally {
      setActivating(false);
    }
  };

  const runImport = async () => {
    if (!source || !sheet) return;
    setImporting(true);
    setError(null);
    try {
      const outcome = await importTinyStockSheet({
        connection: source,
        fileName: sheet.fileName,
        records: sheet.records,
      });
      setResult(outcome);
      clearSheet();
      await load();
    } catch (thrown) {
      console.error('[BalanceSource] failed to import sheet:', thrown);
      setError('Não foi possível concluir a importação. Nenhum saldo parcial foi considerado válido — revise o arquivo e tente novamente.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Produtos"
        title="Fonte de Saldo"
        description="Fontes que informam o saldo de estoque deste workspace. O saldo da fonte é referência de conferência: não altera o cadastro de produtos, o estoque, as contagens nem cria movimentação."
        actions={
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} />
            Voltar
          </Button>
        }
      />

      {error && <Notice tone="danger">{error}</Notice>}

      {loading ? (
        <Panel>
          <PanelSection>
            <p className="text-sm text-fg-muted">Carregando fontes de saldo...</p>
          </PanelSection>
        </Panel>
      ) : provider == null ? (
        <Notice tone="warning">
          A fonte <strong>{TINY_STOCK_SHEET_SOURCE_NAME}</strong> ainda não está liberada neste
          ambiente. Fale com quem administra o InventoryBlind para habilitá-la.
        </Notice>
      ) : (
        <>
          <Panel>
            <PanelSection>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <FileSpreadsheet size={20} className="mt-0.5 flex-shrink-0 text-fg-subtle" />
                  <div>
                    <h2 className="text-base font-semibold text-fg">{provider.name}</h2>
                    <p className="mt-1 max-w-2xl text-sm text-fg-muted">
                      Relatório completo de estoque exportado pelo Tiny, enviado como planilha.
                      Cada envio é uma leitura nova do estoque atual: substitui o saldo anterior
                      da fonte e nunca soma ao snapshot do dia anterior.
                    </p>
                  </div>
                </div>
                <Badge variant={source ? 'success' : 'neutral'}>
                  {source ? 'Ativa' : 'Não ativada'}
                </Badge>
              </div>
            </PanelSection>

            {source && (
              <PanelSection>
                <StatRow>
                  <StatCell>
                    <Stat
                      label="Produtos com saldo na fonte"
                      value={levelCount == null ? '—' : levelCount.toLocaleString('pt-BR')}
                    />
                  </StatCell>
                  <StatCell>
                    <Stat
                      label="Registros sem produto associado"
                      value={unlinkedCount == null ? '—' : unlinkedCount.toLocaleString('pt-BR')}
                      context="aguardando associação por SKU ou EAN"
                    />
                  </StatCell>
                  <StatCell>
                    <Stat label="Último arquivo" value={state.lastFileName ?? '—'} />
                  </StatCell>
                  <StatCell>
                    <Stat label="Última importação" value={formatDateTime(state.lastImportedAt)} />
                  </StatCell>
                </StatRow>
              </PanelSection>
            )}

            {!source ? (
              <PanelSection>
                {canOperate ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={() => void activate()} disabled={activating}>
                      {activating ? 'Ativando...' : 'Ativar fonte neste workspace'}
                    </Button>
                    <span className="text-xs text-fg-subtle">
                      A fonte fica registrada no workspace ativo e passa a receber os arquivos diários.
                    </span>
                  </div>
                ) : (
                  <Notice tone="neutral">
                    Somente proprietário, administrador ou gerente pode ativar uma fonte de saldo.
                  </Notice>
                )}
              </PanelSection>
            ) : (
              <PanelSection>
                <h3 className="text-sm font-semibold text-fg">Enviar relatório de estoque</h3>
                <p className="mt-1 text-sm text-fg-muted">
                  Envie o arquivo exportado pelo Tiny sem editar nada. Colunas esperadas, nesta
                  ordem: <span className="font-mono text-xs">{TINY_STOCK_SHEET_COLUMNS.join(' | ')}</span>
                </p>

                <input
                  ref={inputRef}
                  type="file"
                  accept=".xls,.xlsx"
                  className="hidden"
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />

                <div
                  onClick={() => { if (canOperate && !reading) inputRef.current?.click(); }}
                  onDragOver={event => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={event => { event.preventDefault(); setDragging(false); }}
                  onDrop={event => {
                    event.preventDefault();
                    setDragging(false);
                    if (!canOperate || reading) return;
                    const file = event.dataTransfer.files?.[0];
                    if (file) void handleFile(file);
                  }}
                  className={`mt-4 rounded-container border border-dashed px-6 py-8 text-center transition-colors ${
                    dragging ? 'border-accent bg-accent/5' : 'border-edge hover:border-fg-subtle'
                  } ${canOperate && !reading ? 'cursor-pointer' : 'pointer-events-none opacity-60'}`}
                >
                  <Upload size={24} className="mx-auto text-fg-subtle" />
                  <p className="mt-2 text-sm font-medium text-fg">
                    {reading
                      ? 'Lendo e validando a planilha...'
                      : dragging
                        ? 'Solte o arquivo aqui'
                        : 'Arraste o arquivo do Tiny ou clique para selecionar'}
                  </p>
                  <p className="mt-1 text-xs text-fg-subtle">.xls ou .xlsx</p>
                </div>

                {!canOperate && (
                  <div className="mt-3">
                    <Notice tone="neutral">
                      Somente proprietário, administrador ou gerente pode importar um novo saldo.
                    </Notice>
                  </div>
                )}

                {sheetError && (
                  <div className="mt-3">
                    <Notice tone="danger">{sheetError}</Notice>
                  </div>
                )}
              </PanelSection>
            )}
          </Panel>

          {sheet && counts && (
            <Panel>
              <PanelSection>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-fg">Validação do arquivo</h3>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                      <span className="font-medium text-fg">{sheet.fileName}</span>
                      <span className="text-xs text-fg-subtle">aba “{sheet.sheetName}”</span>
                      <Badge variant="success">Formato do Tiny reconhecido</Badge>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearSheet}
                    className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
                  >
                    <X size={14} /> Descartar
                  </button>
                </div>

                <StatRow className="mt-5">
                  <StatCell>
                    <Stat label="Linhas no arquivo" value={counts.total.toLocaleString('pt-BR')} />
                  </StatCell>
                  <StatCell>
                    <Stat
                      label="Com saldo para importar"
                      value={counts.usable.toLocaleString('pt-BR')}
                    />
                  </StatCell>
                  <StatCell>
                    <Stat
                      label="Saldo em branco"
                      value={counts.missingBalance.toLocaleString('pt-BR')}
                      context="não vira zero: a linha é ignorada"
                    />
                  </StatCell>
                  <StatCell>
                    <Stat
                      label="Linhas recusadas"
                      value={counts.rejected.toLocaleString('pt-BR')}
                      valueTone={counts.rejected > 0 ? 'warning' : 'default'}
                      context="sem ID, ID repetido ou saldo inválido"
                    />
                  </StatCell>
                </StatRow>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => void runImport()}
                    disabled={!canOperate || importing || counts.usable === 0}
                  >
                    {importing ? 'Importando...' : 'Importar como saldo atual da fonte'}
                  </Button>
                  {counts.usable === 0 && (
                    <span className="text-xs text-fg-subtle">
                      Nenhuma linha do arquivo tem saldo utilizável.
                    </span>
                  )}
                </div>
              </PanelSection>

              <PanelSection padding="sm">
                <p className="text-label mb-3">
                  Primeiras {Math.min(SAMPLE_LIMIT, sheet.records.length)} linhas lidas
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <Thead>
                      <tr>
                        <Th>ID (Tiny)</Th>
                        <Th>Produto</Th>
                        <Th>SKU</Th>
                        <Th>GTIN/EAN</Th>
                        <Th>Localização</Th>
                        <Th>Saldo</Th>
                      </tr>
                    </Thead>
                    <tbody>
                      {sheet.records.slice(0, SAMPLE_LIMIT).map(record => (
                        <Tr key={`${record.sourceRowNumber}`}>
                          <Td className="font-mono text-xs">{record.externalId || '—'}</Td>
                          <Td className="max-w-[22rem] truncate">{record.name || '—'}</Td>
                          <Td className="font-mono text-xs">{record.sku || '—'}</Td>
                          <Td className="font-mono text-xs">{record.ean || '—'}</Td>
                          <Td>{record.location || '—'}</Td>
                          <Td className="font-mono tabular-nums">
                            {record.issue ? (
                              <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                                <AlertTriangle size={12} />
                                {ISSUE_LABEL[record.issue]}
                              </span>
                            ) : (
                              record.quantity
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                <p className="mt-3 text-xs text-fg-subtle">
                  SKU e GTIN/EAN são lidos como texto — zeros à esquerda preservados, nunca
                  notação científica. A associação é sempre por código exato: ID do Tiny já
                  mapeado, depois SKU, depois EAN. Nome de produto nunca associa, e empate nunca
                  associa.
                </p>
              </PanelSection>
            </Panel>
          )}

          {result && (
            <Panel>
              <PanelSection>
                <h3 className="text-sm font-semibold text-fg">Importação concluída</h3>
                <StatRow className="mt-5">
                  <StatCell>
                    <Stat
                      label="Linhas processadas"
                      value={result.counters.processed.toLocaleString('pt-BR')}
                    />
                  </StatCell>
                  <StatCell>
                    <Stat
                      label="Produtos associados"
                      value={result.counters.linked.toLocaleString('pt-BR')}
                    />
                  </StatCell>
                  <StatCell>
                    <Stat
                      label="Não associados"
                      value={result.counters.unlinked.toLocaleString('pt-BR')}
                    />
                  </StatCell>
                  <StatCell>
                    <Stat
                      label="Ambíguos"
                      value={result.counters.ambiguous.toLocaleString('pt-BR')}
                      valueTone={result.counters.ambiguous > 0 ? 'warning' : 'default'}
                    />
                  </StatCell>
                  <StatCell>
                    <Stat
                      label="Ignoradas / recusadas"
                      value={`${result.counters.skipped.toLocaleString('pt-BR')} / ${result.counters.failed.toLocaleString('pt-BR')}`}
                      context="sem saldo / erro de leitura"
                    />
                  </StatCell>
                </StatRow>
                <p className="mt-4 text-xs text-fg-subtle">
                  O saldo ficou registrado nesta fonte. O cadastro dos produtos, o estoque do
                  InventoryBlind, as contagens e as movimentações não foram alterados.
                </p>
              </PanelSection>
            </Panel>
          )}

          {source && runs.length > 0 && (
            <Panel>
              <PanelSection>
                <h3 className="text-sm font-semibold text-fg">Histórico de importações</h3>
                <p className="mt-1 text-sm text-fg-muted">
                  Cada linha é um envio de arquivo — a leitura do estoque naquele momento.
                </p>
              </PanelSection>
              <PanelSection padding="sm">
                <div className="overflow-x-auto">
                  <Table>
                    <Thead>
                      <tr>
                        <Th>Quando</Th>
                        <Th>Situação</Th>
                        <Th>Linhas</Th>
                        <Th>Novos na fonte</Th>
                        <Th>Reescritos</Th>
                        <Th>Sem saldo</Th>
                        <Th>Recusadas</Th>
                      </tr>
                    </Thead>
                    <tbody>
                      {runs.map(run => (
                        <Tr key={run.id}>
                          <Td>{formatDateTime(run.startedAt)}</Td>
                          <Td>{RUN_STATUS_LABEL[run.status] ?? run.status}</Td>
                          <Td className="font-mono tabular-nums">{run.processed}</Td>
                          <Td className="font-mono tabular-nums">{run.created}</Td>
                          <Td className="font-mono tabular-nums">{run.updated}</Td>
                          <Td className="font-mono tabular-nums">{run.skipped}</Td>
                          <Td className="font-mono tabular-nums">{run.failed}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </PanelSection>
            </Panel>
          )}
        </>
      )}
    </Page>
  );
}
