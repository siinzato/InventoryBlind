import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, Loader2, Upload, XCircle } from 'lucide-react';
import { Badge, Button, Panel, PanelSection, Select, Table, Thead, Tr, Th, Td } from '../ui';
import { readPalletBatchFile, validateFileBeforeParse } from '../../lib/palletCalc/palletBatchFileReader';
import {
  PALLET_BATCH_FIELDS, applyPalletColumnMapping, detectPalletColumnMappings, requiredFieldsMapped, suggestPalletMapping,
  type PalletColumnMapping,
} from '../../lib/palletCalc/batchFields';
import { processBatchRows, type BatchSummary, type SourcedRow } from '../../lib/palletCalc/batchProcessor';
import { downloadBatchWorkbook } from '../../lib/palletCalc/palletExportExcel';
import { buildBatchResultsCsv, downloadCsvText } from '../../lib/palletCalc/palletExportCsv';
import type { CustomPalletPreset } from '../../lib/palletCalc/palletCalcPrefs';

type Step = 'upload' | 'mapping' | 'results';

interface PalletBatchPageProps {
  onBack: () => void;
  toast: (message: string, type?: 'success' | 'error' | 'info') => void;
  customPallets: CustomPalletPreset[];
}

const STATUS_LABEL: Record<string, string> = { ok: 'Processado', 'ok-with-alerts': 'Processado (com alerta)', invalid: 'Inválido', 'no-solution': 'Sem solução' };

export function PalletBatchPage({ onBack, toast, customPallets }: PalletBatchPageProps) {
  const [step, setStep] = useState<Step>('upload');
  const [loading, setLoading] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Array<{ sourceRowNumber: number; data: Record<string, unknown> }>>([]);
  const [mapping, setMapping] = useState<PalletColumnMapping | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const handleFile = async (file: File) => {
    const validationError = validateFileBeforeParse(file);
    if (validationError) { toast(validationError, 'error'); return; }

    setLoading(true);
    try {
      const parsed = await readPalletBatchFile(file);
      if (parsed.rows.length === 0) { toast('Nenhuma linha encontrada no arquivo.', 'error'); return; }
      setHeaders(parsed.headers);
      setRawRows(parsed.rows.map(r => ({ sourceRowNumber: r.sourceRowNumber, data: r.data as Record<string, unknown> })));
      const detected = detectPalletColumnMappings(parsed.headers);
      setMapping(suggestPalletMapping(detected));
      setStep('mapping');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível ler o arquivo.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const sampleRows = useMemo(() => rawRows.slice(0, 3), [rawRows]);

  const handleProcess = async () => {
    if (!mapping) return;
    setProcessing(true);
    setProgress({ done: 0, total: rawRows.length });
    try {
      const mappedRows = applyPalletColumnMapping(rawRows.map(r => r.data), mapping);
      const sourced: SourcedRow[] = mappedRows.map((row, i) => ({ sourceRowNumber: rawRows[i].sourceRowNumber, row }));
      const result = await processBatchRows(sourced, customPallets, (done, total) => setProgress({ done, total }));
      setSummary(result);
      setStep('results');
    } finally {
      setProcessing(false);
    }
  };

  const handleExportExcel = async () => {
    if (!summary) return;
    try {
      await downloadBatchWorkbook(summary, 'paletizacao-lote.xlsx');
    } catch {
      toast('Falha ao gerar o Excel.', 'error');
    }
  };

  const handleExportCsv = () => {
    if (!summary) return;
    downloadCsvText(buildBatchResultsCsv(summary), 'paletizacao-lote.csv');
  };

  return (
    <div className="min-h-screen bg-surface-3">
      <div className="sticky top-0 z-50 bg-surface border-b border-edge">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-2 px-3 py-2 text-fg-muted hover:text-fg hover:bg-surface-3 rounded-lg transition text-sm font-medium">
            <ArrowLeft size={16} /><span className="hidden sm:inline">Voltar</span>
          </button>
          <h1 className="text-title leading-tight">Paletização em lote</h1>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {step === 'upload' && (
          <Panel>
            <PanelSection padding="lg" className="space-y-4">
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-edge rounded-xl p-10 text-center cursor-pointer transition-colors hover:border-accent hover:bg-accent/5">
                <Upload size={28} className="text-fg-subtle" />
                <p className="text-sm text-fg-muted">{loading ? 'Lendo arquivo...' : 'Arraste ou clique para enviar XLSX, XLS ou CSV'}</p>
                <input type="file" accept=".xlsx,.xls,.csv" disabled={loading} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </label>
              <p className="text-xs text-fg-subtle">Colunas esperadas: SKU, Descrição, Comprimento*, Largura*, Altura*, Unidade dimensional, Peso*, Unidade de peso, Quantidade*, Tipo de palete, Altura máxima, Peso máximo, Rotação permitida.</p>
            </PanelSection>
          </Panel>
        )}

        {step === 'mapping' && mapping && (
          <Panel>
            <PanelSection padding="lg" className="space-y-4">
              <p className="flex items-center gap-2 text-sm text-fg-muted"><FileSpreadsheet size={16} />Confirme como as colunas do arquivo correspondem aos campos esperados.</p>

              {PALLET_BATCH_FIELDS.map(field => (
                <div key={field.key} className="grid grid-cols-2 gap-3 items-center">
                  <label className="text-sm text-fg">{field.label}{field.required && ' *'}</label>
                  <Select value={mapping[field.key] ?? ''} onChange={e => setMapping(prev => prev && ({ ...prev, [field.key]: e.target.value || null }))}>
                    <option value="">— Não mapear —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </div>
              ))}

              {sampleRows.length > 0 && (
                <div className="overflow-x-auto border border-edge rounded-lg">
                  <Table>
                    <Thead><Tr>{headers.map(h => <Th key={h}>{h}</Th>)}</Tr></Thead>
                    <tbody>
                      {sampleRows.map((row, i) => (
                        <Tr key={i}>{headers.map(h => <Td key={h}>{String(row.data[h] ?? '—')}</Td>)}</Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="secondary" onClick={() => setStep('upload')}>Voltar</Button>
                <Button onClick={handleProcess} disabled={!requiredFieldsMapped(mapping) || processing}>
                  {processing ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                  {processing ? `Processando ${progress.done}/${progress.total}...` : 'Processar lote'}
                </Button>
              </div>
              {!requiredFieldsMapped(mapping) && <Badge variant="warning">Mapeie Comprimento, Largura, Altura, Peso e Quantidade para continuar.</Badge>}
            </PanelSection>
          </Panel>
        )}

        {step === 'results' && summary && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Panel><PanelSection padding="sm"><div className="text-2xl font-bold text-fg">{summary.processed}</div><div className="text-xs text-fg-muted">Processados</div></PanelSection></Panel>
              <Panel><PanelSection padding="sm"><div className="text-2xl font-bold text-amber-600">{summary.processedWithAlerts}</div><div className="text-xs text-fg-muted">Com alerta</div></PanelSection></Panel>
              <Panel><PanelSection padding="sm"><div className="text-2xl font-bold text-fg-subtle">{summary.noSolution}</div><div className="text-xs text-fg-muted">Sem solução</div></PanelSection></Panel>
              <Panel><PanelSection padding="sm"><div className="text-2xl font-bold text-red-600">{summary.invalid}</div><div className="text-xs text-fg-muted">Inválidos</div></PanelSection></Panel>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={handleExportExcel}>Baixar Excel</Button>
              <Button variant="secondary" onClick={handleExportCsv}>Baixar CSV</Button>
              <Button variant="ghost" onClick={() => setStep('upload')}>Novo arquivo</Button>
            </div>

            <Panel>
              <div className="max-h-[28rem] overflow-y-auto">
                <Table>
                  <Thead><Tr><Th>Linha</Th><Th>SKU</Th><Th>Status</Th><Th>Padrão</Th><Th>Caixas/palete</Th><Th>Paletes</Th><Th>Detalhe</Th></Tr></Thead>
                  <tbody>
                    {summary.rows.map(r => (
                      <Tr key={r.rowNumber}>
                        <Td>{r.rowNumber}</Td>
                        <Td>{r.sku ?? '—'}</Td>
                        <Td>
                          <span className="inline-flex items-center gap-1">
                            {r.status === 'ok' && <CheckCircle2 size={13} className="text-emerald-500" />}
                            {r.status === 'invalid' && <XCircle size={13} className="text-red-500" />}
                            {STATUS_LABEL[r.status]}
                          </span>
                        </Td>
                        <Td>{r.result?.recommended.pattern.label ?? '—'}</Td>
                        <Td numeric>{r.result?.recommended.capacityPerPallet ?? '—'}</Td>
                        <Td numeric>{r.result?.recommended.palletsNeeded.totalPallets ?? '—'}</Td>
                        <Td className="text-xs text-fg-subtle">{r.errors.join(' | ') || r.result?.recommended.alerts.map(a => a.message).join(' | ') || '—'}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
