import { useEffect, useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Modal, Panel, PanelSection, Button, Select, Input } from '../ui';
import { useAuth } from '../../lib/auth';
import {
  parsePoImportFile, detectPoColumnMappings, suggestPoColumnMapping, applyPoColumnMapping, classifyPoImportRow,
} from '../../lib/purchaseOrders/poImportParsing';
import { hashFileContent, findBatchesWithHash, importPurchaseOrder, listImportProfiles, upsertImportProfile } from '../../lib/purchaseOrders/poService';
import { findPossibleDuplicatePos } from '../../lib/purchaseOrders/poNumberUtils';
import type { PoColumnMapping, PoImportRow, ClassifiedPoImportRow, PoImportProfile, PoImportOrigin, PurchaseOrder } from '../../lib/purchaseOrders/poTypes';

interface PoImportWizardProps {
  companyId: string;
  existingOrders: PurchaseOrder[];
  onClose: () => void;
  onImported: () => void;
}

type Step = 'upload' | 'mapping' | 'preview' | 'importing' | 'complete';

const ORIGIN_OPTIONS: { value: PoImportOrigin; label: string }[] = [
  { value: 'tiny', label: 'Tiny' }, { value: 'bling', label: 'Bling' }, { value: 'totvs', label: 'TOTVS' },
  { value: 'sap', label: 'SAP' }, { value: 'custom', label: 'Personalizado' },
];

const EMPTY_MAPPING: PoColumnMapping = { poNumber: null, supplierName: null, code: null, ean: null, description: null, unit: null, quantity: null, unitPrice: null, total: null };

export function PoImportWizard({ companyId, existingOrders, onClose, onImported }: PoImportWizardProps) {
  const { profile } = useAuth();
  const [step, setStep] = useState<Step>('upload');
  const [origin, setOrigin] = useState<PoImportOrigin>('tiny');
  const [profiles, setProfiles] = useState<PoImportProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [duplicateBatchInfo, setDuplicateBatchInfo] = useState<string | null>(null);
  const [confirmReimport, setConfirmReimport] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<PoImportRow[]>([]);
  const [mapping, setMapping] = useState<PoColumnMapping>(EMPTY_MAPPING);
  const [saveProfileName, setSaveProfileName] = useState('');
  const [classifiedRows, setClassifiedRows] = useState<ClassifiedPoImportRow[]>([]);
  const [supplierName, setSupplierName] = useState('');
  const [poNumberOverride, setPoNumberOverride] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { listImportProfiles(companyId).then(setProfiles); }, [companyId]);

  const profilesForOrigin = profiles.filter(p => p.origin === origin);

  const handleFile = async (selected: File) => {
    setError(null);
    try {
      const hash = await hashFileContent(selected);
      const existingBatches = await findBatchesWithHash(companyId, hash);
      if (existingBatches.length > 0) {
        setDuplicateBatchInfo(`Este arquivo já foi importado em ${new Date(existingBatches[0].createdAt).toLocaleString('pt-BR')}.`);
        setConfirmReimport(false);
      } else {
        setDuplicateBatchInfo(null);
        setConfirmReimport(true);
      }

      const { headers: h, rows: r } = await parsePoImportFile(selected);
      if (r.length === 0) { setError('Nenhuma linha encontrada no arquivo.'); return; }

      setFile(selected);
      setFileHash(hash);
      setHeaders(h);
      setRawRows(r);

      const chosenProfile = profilesForOrigin.find(p => p.id === selectedProfileId);
      const initialMapping = chosenProfile ? chosenProfile.columnMapping : suggestPoColumnMapping(detectPoColumnMappings(h));
      setMapping(initialMapping);
      setStep('mapping');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao ler o arquivo.');
    }
  };

  const handleConfirmMapping = () => {
    const mapped = applyPoColumnMapping(rawRows, mapping);
    const classified = mapped.map((row, idx) => classifyPoImportRow(row, idx + 1));
    setClassifiedRows(classified);

    const firstSupplier = mapping.supplierName ? String(rawRows[0]?.[mapping.supplierName] ?? '') : '';
    setSupplierName(firstSupplier);
    setPoNumberOverride(classified[0]?.poNumber ?? '');
    setStep('preview');
  };

  const validRows = classifiedRows.filter(r => r.errors.length === 0);
  const invalidRows = classifiedRows.filter(r => r.errors.length > 0);

  const duplicatePoWarning = poNumberOverride.trim() && supplierName.trim()
    ? findPossibleDuplicatePos(existingOrders, poNumberOverride, supplierName)
    : [];

  const handleConfirmImport = async () => {
    if (saving || !file || !fileHash) return;
    if (invalidRows.length > 0) { setError(`${invalidRows.length} linha(s) inválida(s) — corrija o mapeamento ou os dados antes de importar.`); return; }
    if (!supplierName.trim()) { setError('Informe o fornecedor.'); return; }
    if (!poNumberOverride.trim()) { setError('Informe o número da OC.'); return; }
    if (duplicateBatchInfo && !confirmReimport) { setError('Confirme a reimportação para prosseguir.'); return; }

    setSaving(true);
    setStep('importing');
    setError(null);
    try {
      if (saveProfileName.trim()) {
        await upsertImportProfile(companyId, { origin, name: saveProfileName.trim(), columnMapping: mapping }, profile?.id ?? '', profile?.email ?? '');
      }

      await importPurchaseOrder(
        companyId,
        {
          origin, profileId: selectedProfileId || null, fileName: file.name, fileHash,
          header: { poNumber: poNumberOverride.trim(), origin, supplierName: supplierName.trim() },
          rows: validRows,
        },
        profile?.id ?? '', profile?.email ?? ''
      );
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao importar.');
      setStep('preview');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Importar Ordem de Compra" maxWidth="max-w-3xl">
      <div className="space-y-4">
        {step === 'upload' && (
          <>
            <div>
              <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Origem</label>
              <Select value={origin} onChange={e => setOrigin(e.target.value as PoImportOrigin)}>
                {ORIGIN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
            {profilesForOrigin.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Perfil de mapeamento salvo</label>
                <Select value={selectedProfileId} onChange={e => setSelectedProfileId(e.target.value)}>
                  <option value="">Detectar automaticamente</option>
                  {profilesForOrigin.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>
            )}
            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-edge rounded-xl p-10 text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-colors">
              <Upload size={28} className="text-fg-subtle" />
              <p className="text-sm text-fg-muted">Arraste ou clique para enviar XLSX ou CSV</p>
              <input type="file" accept=".xlsx,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </label>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          </>
        )}

        {step === 'mapping' && (
          <>
            <p className="text-sm text-fg-muted">Confirme como as colunas do arquivo correspondem aos campos esperados.</p>
            {[
              { key: 'poNumber', label: 'Número da OC' }, { key: 'supplierName', label: 'Fornecedor' },
              { key: 'code', label: 'SKU/Código' }, { key: 'ean', label: 'EAN/GTIN' },
              { key: 'description', label: 'Descrição' }, { key: 'unit', label: 'Unidade' },
              { key: 'quantity', label: 'Quantidade' }, { key: 'unitPrice', label: 'Preço Unitário' }, { key: 'total', label: 'Total' },
            ].map(field => (
              <div key={field.key} className="grid grid-cols-2 gap-3 items-center">
                <label className="text-sm text-fg">{field.label}</label>
                <Select
                  value={(mapping as unknown as Record<string, string | null>)[field.key] ?? ''}
                  onChange={e => setMapping(prev => ({ ...prev, [field.key]: e.target.value || null }))}
                >
                  <option value="">— Não mapear —</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </Select>
              </div>
            ))}
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={() => setStep('upload')}>Voltar</Button>
              <Button onClick={handleConfirmMapping} disabled={!mapping.description || !mapping.quantity}>Continuar</Button>
            </div>
          </>
        )}

        {step === 'preview' && (
          <>
            {duplicateBatchInfo && (
              <div className="p-3 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg flex items-start gap-2 text-sm">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p>{duplicateBatchInfo}</p>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={confirmReimport} onChange={e => setConfirmReimport(e.target.checked)} />
                    Importar mesmo assim
                  </label>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Número da OC</label>
                <Input value={poNumberOverride} onChange={e => setPoNumberOverride(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Fornecedor</label>
                <Input value={supplierName} onChange={e => setSupplierName(e.target.value)} />
              </div>
            </div>

            {duplicatePoWarning.length > 0 && (
              <div className="p-3 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg flex items-start gap-2 text-sm">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <span>Já existe uma OC com este número para este fornecedor.</span>
              </div>
            )}

            <Panel>
              <PanelSection padding="md" className="grid grid-cols-3 divide-x divide-edge">
                <div className="text-center px-2"><p className="text-xs text-fg-subtle">Total</p><p className="text-lg font-semibold text-fg">{classifiedRows.length}</p></div>
                <div className="text-center px-2"><p className="text-xs text-fg-subtle">Válidas</p><p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{validRows.length}</p></div>
                <div className="text-center px-2"><p className="text-xs text-fg-subtle">Com erro</p><p className="text-lg font-semibold text-red-600 dark:text-red-400">{invalidRows.length}</p></div>
              </PanelSection>
            </Panel>

            {invalidRows.length > 0 && (
              <div className="max-h-40 overflow-auto border border-edge rounded-lg p-2 space-y-1">
                {invalidRows.map(r => (
                  <p key={r.lineNumber} className="text-xs text-red-600 dark:text-red-400">Linha {r.lineNumber}: {r.errors.join(' ')}</p>
                ))}
              </div>
            )}

            <div className="max-h-64 overflow-auto border border-edge rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-surface-3 sticky top-0"><tr>
                  {['Linha', 'Código', 'Descrição', 'Qtd', 'Preço'].map(h => <th key={h} className="text-left px-3 py-2">{h}</th>)}
                </tr></thead>
                <tbody>
                  {classifiedRows.slice(0, 100).map(r => (
                    <tr key={r.lineNumber} className={r.errors.length > 0 ? 'bg-red-500/5' : ''}>
                      <td className="px-3 py-1.5">{r.lineNumber}</td>
                      <td className="px-3 py-1.5">{r.originCode ?? '—'}</td>
                      <td className="px-3 py-1.5">{r.description || '—'}</td>
                      <td className="px-3 py-1.5">{r.quantity}</td>
                      <td className="px-3 py-1.5">{r.unitPrice ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Salvar este mapeamento como perfil (opcional)</label>
              <Input value={saveProfileName} onChange={e => setSaveProfileName(e.target.value)} placeholder={`Ex: ${origin} — padrão`} />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={() => setStep('mapping')}>Voltar</Button>
              <Button onClick={handleConfirmImport} disabled={saving || invalidRows.length > 0}>Confirmar Importação</Button>
            </div>
          </>
        )}

        {step === 'importing' && (
          <div className="text-center text-fg-muted py-8">
            <FileSpreadsheet size={28} className="mx-auto mb-2 text-fg-subtle" />
            Importando...
          </div>
        )}

        {step === 'complete' && (
          <div className="space-y-4">
            <div className="p-3 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-lg flex items-start gap-2 text-sm">
              <CheckCircle2 size={18} className="flex-shrink-0 mt-0.5" />
              <span>OC importada com sucesso.</span>
            </div>
            <div className="flex justify-end">
              <Button onClick={onImported}>Concluir</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
