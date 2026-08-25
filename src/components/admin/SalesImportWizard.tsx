// Assistente de importação de vendas: upload → mapeamento → prévia → confirmação.
// Mesmo esqueleto de passos usado em ImportCountTab/ProductImportPage, adaptado a vendas.

import { useMemo, useState } from 'react';
import { Upload, AlertTriangle, CheckCircle2, ArrowRight, Loader2 } from 'lucide-react';
import { Modal, Button, Select, Badge } from '../ui';
import {
  detectSalesColumnMappings, suggestSalesMapping, applySalesColumnMapping, parseSalesFile,
  computeFileHash, validateAndBuildSalesRows, type SalesColumnMapping, type SalesRow,
} from '../../lib/adminSales/salesImportUtils';
import {
  listImportProfiles, upsertImportProfile, findBatchesByFileHash, importSalesFile,
  type SalesOrigin,
} from '../../lib/adminSales/salesService';

interface SalesImportWizardProps {
  companyId: string;
  userId: string;
  userEmail: string;
  onClose: () => void;
  onImported: () => void;
}

type Step = 'upload' | 'mapping' | 'preview' | 'importing' | 'done';

const ORIGIN_LABEL: Record<SalesOrigin, string> = {
  tiny: 'Tiny ERP', bling: 'Bling', totvs: 'TOTVS', sap: 'SAP', custom: 'Planilha própria',
};

export function SalesImportWizard({ companyId, userId, userEmail, onClose, onImported }: SalesImportWizardProps) {
  const [step, setStep] = useState<Step>('upload');
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<SalesOrigin>('custom');
  const [file, setFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<SalesRow[]>([]);
  const [mapping, setMapping] = useState<SalesColumnMapping>({ data: null, sku: null, produto: null, quantidade: null, precoUnitario: null, faturamento: null });
  const [referenceDate, setReferenceDate] = useState('');
  const [saveProfileName, setSaveProfileName] = useState('');
  const [result, setResult] = useState<{ imported: number; unmatched: number } | null>(null);

  const preview = useMemo(() => {
    if (step !== 'preview' && step !== 'importing' && step !== 'done') return null;
    const mapped = applySalesColumnMapping(rawRows, mapping);
    return validateAndBuildSalesRows(mapped, mapping.data ? null : referenceDate);
  }, [step, rawRows, mapping, referenceDate]);

  const handleFileSelected = async (selected: File) => {
    setError(null);
    const ext = selected.name.split('.').pop()?.toLowerCase();
    if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
      setError('Formato não suportado. Use .csv, .xls ou .xlsx.');
      return;
    }

    setFile(selected);
    setReferenceDate('');
    const hash = await computeFileHash(selected);
    setFileHash(hash);

    const existingBatches = await findBatchesByFileHash(companyId, hash).catch(() => []);
    if (existingBatches.length > 0) {
      setDuplicateWarning(`Este arquivo já foi importado antes (${existingBatches.length}x). Deseja importar novamente mesmo assim?`);
    } else {
      setDuplicateWarning(null);
    }

    const { headers: h, rows } = await parseSalesFile(selected);
    setHeaders(h);
    setRawRows(rows);

    const detected = detectSalesColumnMappings(h);
    setMapping(suggestSalesMapping(detected));

    const profiles = await listImportProfiles(companyId, origin).catch(() => []);
    if (profiles.length > 0) {
      const latest = profiles[0];
      setMapping(prev => ({ ...prev, ...latest.columnMapping }));
    }

    setStep('mapping');
  };

  const handleConfirmImport = async () => {
    if (!file || !fileHash || !preview) return;
    setStep('importing');
    setError(null);
    try {
      if (saveProfileName.trim()) {
        await upsertImportProfile(companyId, origin, saveProfileName.trim(), mapping as unknown as Record<string, string | null>);
      }
      const batch = await importSalesFile({
        companyId, userId, userEmail, origin, profileId: null,
        fileName: file.name, fileHash, rows: preview.valid,
      });
      setResult({ imported: batch.importedCount, unmatched: batch.unmatchedCount });
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar o arquivo.');
      setStep('preview');
    }
  };

  return (
    <Modal open onClose={onClose} title="Importar Vendas" maxWidth="max-w-3xl">
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
            <AlertTriangle size={16} /> {error}
          </div>
        )}

        {step === 'upload' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Origem</label>
              <Select value={origin} onChange={e => setOrigin(e.target.value as SalesOrigin)}>
                {(Object.keys(ORIGIN_LABEL) as SalesOrigin[]).map(o => (
                  <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>
                ))}
              </Select>
              <p className="text-caption mt-1">Hoje só planilha; a origem fica salva para quando o ERP alimentar direto.</p>
            </div>
            <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-edge p-10 text-center cursor-pointer hover:bg-surface-3/40 transition-colors">
              <Upload size={28} className="text-fg-subtle" />
              <span className="text-sm text-fg-muted">Clique para selecionar um arquivo .csv, .xls ou .xlsx</span>
              <input
                type="file" accept=".csv,.xls,.xlsx" className="hidden"
                onChange={e => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
              />
            </label>
          </div>
        )}

        {step === 'mapping' && (
          <div className="space-y-4">
            {duplicateWarning && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle size={16} /> {duplicateWarning}
              </div>
            )}
            <p className="text-sm text-fg-muted">{headers.length} colunas detectadas, {rawRows.length} linhas. Confirme ou ajuste o mapeamento:</p>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(mapping) as (keyof SalesColumnMapping)[]).map(field => (
                <div key={field}>
                  <label className="block text-xs font-medium text-fg-subtle uppercase tracking-wide mb-1">{field}</label>
                  <Select value={mapping[field] ?? ''} onChange={e => setMapping(prev => ({ ...prev, [field]: e.target.value || null }))}>
                    <option value="">— não mapear —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </div>
              ))}
            </div>
            {!mapping.data && (
              <div className="space-y-2 rounded-lg bg-amber-500/10 p-3">
                <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle size={16} />
                  Nenhuma coluna de data foi encontrada (comum no relatório de vendas do Tiny, que soma
                  o período por produto sem data por linha). Informe a data de referência deste relatório:
                </div>
                <input
                  type="date" value={referenceDate} onChange={e => setReferenceDate(e.target.value)}
                  className="w-48 p-2 border border-edge rounded-lg bg-surface text-fg text-sm"
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => setStep('preview')} disabled={!mapping.data && !referenceDate}>
                Ver prévia <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-400">
                <p className="font-semibold text-lg">{preview.valid.length}</p><p>Linhas válidas</p>
              </div>
              <div className="rounded-lg bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
                <p className="font-semibold text-lg">{preview.warnings.length}</p><p>Avisos</p>
              </div>
              <div className="rounded-lg bg-red-500/10 p-3 text-red-700 dark:text-red-400">
                <p className="font-semibold text-lg">{preview.errors.length}</p><p>Erros</p>
              </div>
            </div>
            {preview.errors.length > 0 && (
              <div className="max-h-32 overflow-y-auto text-xs text-red-700 dark:text-red-400 space-y-0.5">
                {preview.errors.slice(0, 20).map((e, i) => <p key={i}>Linha {e.rowIndex + 1}: {e.message}</p>)}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Salvar este mapeamento (opcional)</label>
              <input
                type="text" value={saveProfileName} onChange={e => setSaveProfileName(e.target.value)}
                placeholder="Ex: Planilha padrão Tiny"
                className="w-full p-2.5 border border-edge rounded-lg bg-surface text-fg text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setStep('mapping')}>Voltar</Button>
              <Button onClick={handleConfirmImport} disabled={preview.valid.length === 0}>
                Confirmar importação ({preview.valid.length} linhas)
              </Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="flex flex-col items-center gap-3 py-10 text-fg-muted">
            <Loader2 className="animate-spin" size={28} /> Importando...
          </div>
        )}

        {step === 'done' && result && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 size={32} className="text-emerald-500" />
            <p className="text-fg font-medium">{result.imported} vendas importadas.</p>
            {result.unmatched > 0 && (
              <Badge variant="warning">{result.unmatched} sem produto associado — corrija depois no catálogo.</Badge>
            )}
            <Button onClick={() => { onImported(); onClose(); }}>Concluir</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
