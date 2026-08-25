// Curva ABC — assistente de importação: configuração do período → vendas → preços/custos →
// estoque (opcional, com ABC do Tiny opcional embutido) → prévia → publicação transacional.
// Mesmo esqueleto de passos de SalesImportWizard.tsx, generalizado para múltiplos arquivos.

import { useMemo, useState } from 'react';
import { Upload, AlertTriangle, CheckCircle2, ArrowRight, Loader2, X } from 'lucide-react';
import { Modal, Button, Select, Badge } from '../ui';
import {
  detectColumns, suggestMapping, applyMapping, parseTabularFile, computeFileHash, normalizeSku,
  VENDAS_FIELDS, PRECOS_CUSTOS_FIELDS, ESTOQUE_FIELDS,
  type ColumnMapping, type RawRow, type FieldDef,
} from '../../lib/abcCurve/abcCurveParsing';
import {
  aggregateVendas, buildPricingMap, buildStockMap, buildSkuSnapshots, type SkuSnapshot,
} from '../../lib/abcCurve/abcCurveEngine';
import { evaluateRecommendation, type Recommendation } from '../../lib/abcCurve/abcCurveRecommendations';
import { findBatchesByFileHash, matchProductIds, publishAnalysis, type AbcFileKind, type AbcProvider } from '../../lib/abcCurve/abcCurveService';

interface AbcCurveImportWizardProps {
  companyId: string;
  userId: string;
  userEmail: string;
  onClose: () => void;
  onPublished: () => void;
}

type Step = 'config' | 'vendas' | 'precos' | 'estoque' | 'preview' | 'publishing' | 'done';

interface FileSlot {
  file: File | null;
  headers: string[];
  rawRows: RawRow[];
  mapping: ColumnMapping;
  hash: string | null;
  duplicateWarning: string | null;
}

const emptySlot = (fields: FieldDef[]): FileSlot => ({
  file: null, headers: [], rawRows: [], mapping: Object.fromEntries(fields.map(f => [f.key, null])), hash: null, duplicateWarning: null,
});

const ORIGIN_LABEL: Record<AbcProvider, string> = { tiny: 'Tiny ERP', bling: 'Bling', totvs: 'TOTVS', sap: 'SAP', custom: 'Planilha própria' };

export function AbcCurveImportWizard({ companyId, userId, userEmail, onClose, onPublished }: AbcCurveImportWizardProps) {
  const [step, setStep] = useState<Step>('config');
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<AbcProvider>('tiny');

  const [name, setName] = useState('');
  const [salesPeriodStart, setSalesPeriodStart] = useState('');
  const [salesPeriodEnd, setSalesPeriodEnd] = useState('');
  const [pricingSnapshotDate, setPricingSnapshotDate] = useState('');
  const [stockSnapshotDate, setStockSnapshotDate] = useState('');
  const [thresholdA, setThresholdA] = useState(80);
  const [thresholdB, setThresholdB] = useState(95);

  const [vendas, setVendas] = useState<FileSlot>(emptySlot(VENDAS_FIELDS));
  const [precos, setPrecos] = useState<FileSlot>(emptySlot(PRECOS_CUSTOS_FIELDS));
  const [estoque, setEstoque] = useState<FileSlot>(emptySlot(ESTOQUE_FIELDS));
  const [abcTiny, setAbcTiny] = useState<{ file: File | null; rowCount: number }>({ file: null, rowCount: 0 });
  const [publishing, setPublishing] = useState(false);

  const loadFile = async (file: File, fields: FieldDef[], setSlot: (slot: FileSlot) => void) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['csv', 'xls', 'xlsx'].includes(ext)) {
      setError('Formato não suportado. Use .csv, .xls ou .xlsx.');
      return;
    }
    setError(null);
    const hash = await computeFileHash(file);
    const existing = await findBatchesByFileHash(companyId, hash).catch(() => []);
    const { headers, rows } = await parseTabularFile(file);
    const detected = detectColumns(headers, fields);
    setSlot({
      file, headers, rawRows: rows, mapping: suggestMapping(detected, fields), hash,
      duplicateWarning: existing.length > 0 ? `Este arquivo já foi importado antes (${existing.length}x). Você pode continuar mesmo assim.` : null,
    });
  };

  const preview = useMemo(() => {
    if (step !== 'preview' && step !== 'publishing' && step !== 'done') return null;
    if (!salesPeriodStart || !salesPeriodEnd || salesPeriodStart > salesPeriodEnd) {
      return { blocked: true, message: 'Período de vendas inválido.' } as const;
    }

    const mappedVendas = applyMapping(vendas.rawRows, vendas.mapping);
    const { aggregated, errors: vendasErrors } = aggregateVendas(mappedVendas);
    if (aggregated.length === 0) {
      return { blocked: true, message: 'Nenhuma linha válida de vendas para analisar.' } as const;
    }

    const rawSkuCount = new Map<string, number>();
    mappedVendas.forEach(r => {
      const sku = normalizeSku(r.sku);
      if (sku) rawSkuCount.set(sku, (rawSkuCount.get(sku) ?? 0) + 1);
    });
    const warnings: string[] = [];
    rawSkuCount.forEach((count, sku) => { if (count > 1) warnings.push(`SKU "${sku}" apareceu ${count}x nas vendas — quantidades somadas.`); });

    const mappedPrecos = applyMapping(precos.rawRows, precos.mapping);
    const { map: pricingMap, warnings: pricingWarnings } = buildPricingMap(mappedPrecos);
    warnings.push(...pricingWarnings);

    const hasStockFile = estoque.file !== null;
    const stockMap = hasStockFile ? buildStockMap(applyMapping(estoque.rawRows, estoque.mapping)) : null;

    const periodDays = Math.max(1, Math.round((new Date(salesPeriodEnd).getTime() - new Date(salesPeriodStart).getTime()) / 86400000) + 1);
    const snapshots = buildSkuSnapshots({ vendas: aggregated, pricing: pricingMap, stock: stockMap, periodDays, thresholdA, thresholdB });

    const recommendationsBySku = new Map<string, Recommendation>();
    snapshots.forEach(s => { const rec = evaluateRecommendation(s); if (rec) recommendationsBySku.set(s.sku, rec); });

    const withCost = snapshots.filter(s => s.cost !== null).length;
    const withStock = hasStockFile ? snapshots.filter(s => s.stockAvailable !== null).length : 0;
    if (pricingSnapshotDate && (pricingSnapshotDate < salesPeriodStart || pricingSnapshotDate > salesPeriodEnd)) {
      warnings.push('Data do snapshot de preços/custos fora do período de vendas — cobertura pode ficar parcial.');
    }

    return {
      blocked: false as const,
      vendasErrors, warnings, snapshots, recommendationsBySku,
      costCoveragePct: snapshots.length > 0 ? (withCost / snapshots.length) * 100 : null,
      stockCoveragePct: hasStockFile && snapshots.length > 0 ? (withStock / snapshots.length) * 100 : null,
      hasStockFile,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, vendas, precos, estoque, salesPeriodStart, salesPeriodEnd, pricingSnapshotDate, thresholdA, thresholdB]);

  const canGoToPreview = vendas.file !== null && precos.file !== null && !!name.trim() && !!salesPeriodStart && !!salesPeriodEnd && !!pricingSnapshotDate;

  const handlePublish = async () => {
    if (!preview || preview.blocked) return;
    setPublishing(true);
    setStep('publishing');
    setError(null);
    try {
      const skus = preview.snapshots.map((s: SkuSnapshot) => s.sku);
      const productIdBySku = await matchProductIds(companyId, skus);

      const batches = [
        { fileKind: 'vendas' as AbcFileKind, sourceType: 'file' as const, provider: origin, fileName: vendas.file?.name ?? null, fileHash: vendas.hash, rowCount: vendas.rawRows.length, importedCount: preview.snapshots.length, warningCount: preview.vendasErrors.length },
        { fileKind: 'precos_custos' as AbcFileKind, sourceType: 'file' as const, provider: origin, fileName: precos.file?.name ?? null, fileHash: precos.hash, rowCount: precos.rawRows.length, importedCount: precos.rawRows.length, warningCount: 0 },
      ];
      if (estoque.file) {
        batches.push({ fileKind: 'estoque' as AbcFileKind, sourceType: 'file' as const, provider: origin, fileName: estoque.file.name, fileHash: estoque.hash, rowCount: estoque.rawRows.length, importedCount: estoque.rawRows.length, warningCount: 0 });
      }
      if (abcTiny.file) {
        batches.push({ fileKind: 'abc_tiny' as AbcFileKind, sourceType: 'file' as const, provider: origin, fileName: abcTiny.file.name, fileHash: null, rowCount: abcTiny.rowCount, importedCount: abcTiny.rowCount, warningCount: 0 });
      }

      await publishAnalysis({
        companyId, userId, userEmail, name: name.trim(),
        salesPeriodStart, salesPeriodEnd, pricingSnapshotDate, stockSnapshotDate: stockSnapshotDate || null,
        thresholdA, thresholdB, batches, snapshots: preview.snapshots, productIdBySku,
        recommendationsBySku: preview.recommendationsBySku,
        costCoveragePct: preview.costCoveragePct, stockCoveragePct: preview.stockCoveragePct,
        warningCount: preview.warnings.length,
      });
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao publicar a análise. Nada foi salvo.');
      setStep('preview');
    } finally {
      setPublishing(false);
    }
  };

  const renderUploadStep = (
    label: string, fields: FieldDef[], slot: FileSlot, setSlot: (slot: FileSlot) => void,
  ) => (
    <div className="space-y-4">
      {!slot.file && (
        <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-edge p-10 text-center cursor-pointer hover:bg-surface-3/40 transition-colors">
          <Upload size={28} className="text-fg-subtle" />
          <span className="text-sm text-fg-muted">Clique para selecionar o arquivo de {label} (.csv, .xls ou .xlsx)</span>
          <input type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={e => e.target.files?.[0] && loadFile(e.target.files[0], fields, setSlot)} />
        </label>
      )}
      {slot.file && (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="text-fg">{slot.file.name} — {slot.headers.length} colunas, {slot.rawRows.length} linhas</span>
            <Button variant="ghost" size="sm" onClick={() => setSlot(emptySlot(fields))}><X size={14} /> Trocar arquivo</Button>
          </div>
          {slot.duplicateWarning && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle size={16} /> {slot.duplicateWarning}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {fields.map(field => (
              <div key={field.key}>
                <label className="block text-xs font-medium text-fg-subtle uppercase tracking-wide mb-1">
                  {field.label}{field.required && ' *'}
                </label>
                <Select value={slot.mapping[field.key] ?? ''} onChange={e => setSlot({ ...slot, mapping: { ...slot.mapping, [field.key]: e.target.value || null } })}>
                  <option value="">— não mapear —</option>
                  {slot.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </Select>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );

  return (
    <Modal open onClose={onClose} title="Nova Análise — Curva ABC" maxWidth="max-w-3xl">
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
            <AlertTriangle size={16} /> {error}
          </div>
        )}

        {step === 'config' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Fonte de dados</label>
                <div className="flex gap-2">
                  <div className="flex flex-1 items-center justify-between gap-2 rounded-lg border border-edge bg-surface-3 px-3 py-2 text-sm text-fg">
                    Importar arquivos <Badge variant="success">Ativo</Badge>
                  </div>
                  <div className="flex flex-1 items-center justify-between gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-fg-subtle opacity-70" title="Em breve">
                    Conectar ERP via API <Badge variant="neutral">Em breve</Badge>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Empresa/ERP de origem</label>
                <Select value={origin} onChange={e => setOrigin(e.target.value as AbcProvider)}>
                  {(Object.keys(ORIGIN_LABEL) as AbcProvider[]).map(o => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}
                </Select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Nome da análise</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Curva ABC — Agosto/2026"
                className="w-full p-2.5 border border-edge rounded-lg bg-surface text-fg text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Período de vendas — início</label>
                <input type="date" value={salesPeriodStart} onChange={e => setSalesPeriodStart(e.target.value)} className="w-full p-2 border border-edge rounded-lg bg-surface text-fg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Período de vendas — fim</label>
                <input type="date" value={salesPeriodEnd} onChange={e => setSalesPeriodEnd(e.target.value)} className="w-full p-2 border border-edge rounded-lg bg-surface text-fg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Data do snapshot de preços/custos</label>
                <input type="date" value={pricingSnapshotDate} onChange={e => setPricingSnapshotDate(e.target.value)} className="w-full p-2 border border-edge rounded-lg bg-surface text-fg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Data do snapshot de estoque (opcional)</label>
                <input type="date" value={stockSnapshotDate} onChange={e => setStockSnapshotDate(e.target.value)} className="w-full p-2 border border-edge rounded-lg bg-surface text-fg text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Limite classe A (% acumulado)</label>
                <input type="number" min={1} max={99} value={thresholdA} onChange={e => setThresholdA(Number(e.target.value))} className="w-full p-2 border border-edge rounded-lg bg-surface text-fg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Limite classe B (% acumulado)</label>
                <input type="number" min={1} max={99} value={thresholdB} onChange={e => setThresholdB(Number(e.target.value))} className="w-full p-2 border border-edge rounded-lg bg-surface text-fg text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => setStep('vendas')} disabled={!name.trim() || !salesPeriodStart || !salesPeriodEnd || !pricingSnapshotDate}>
                Continuar <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        )}

        {step === 'vendas' && (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">Vendas do período (obrigatório).</p>
            {renderUploadStep('vendas', VENDAS_FIELDS, vendas, setVendas)}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setStep('config')}>Voltar</Button>
              <Button onClick={() => setStep('precos')} disabled={!vendas.file}>Continuar <ArrowRight size={14} /></Button>
            </div>
          </div>
        )}

        {step === 'precos' && (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">Preços e custos (obrigatório para calcular rentabilidade).</p>
            {renderUploadStep('preços e custos', PRECOS_CUSTOS_FIELDS, precos, setPrecos)}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setStep('vendas')}>Voltar</Button>
              <Button onClick={() => setStep('estoque')} disabled={!precos.file}>Continuar <ArrowRight size={14} /></Button>
            </div>
          </div>
        )}

        {step === 'estoque' && (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">Estoque (opcional — sem ele, a análise comercial funciona normalmente e a reposição não é calculada).</p>
            {renderUploadStep('estoque', ESTOQUE_FIELDS, estoque, setEstoque)}
            <div className="border-t border-edge pt-3">
              <p className="text-sm text-fg-muted mb-2">Curva ABC do Tiny (opcional — referência informativa, não substitui o cálculo desta análise).</p>
              {!abcTiny.file ? (
                <label className="flex items-center gap-2 text-xs text-fg-subtle underline decoration-dotted cursor-pointer">
                  Anexar planilha de Curva ABC do Tiny
                  <input type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={async e => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const { rows } = await parseTabularFile(f);
                    setAbcTiny({ file: f, rowCount: rows.length });
                  }} />
                </label>
              ) : (
                <div className="flex items-center justify-between text-sm">
                  <span>{abcTiny.file.name} — {abcTiny.rowCount} linhas</span>
                  <Button variant="ghost" size="sm" onClick={() => setAbcTiny({ file: null, rowCount: 0 })}><X size={14} /></Button>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setStep('precos')}>Voltar</Button>
              <Button onClick={() => setStep('preview')} disabled={!canGoToPreview}>Ver prévia <ArrowRight size={14} /></Button>
            </div>
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="space-y-4">
            {preview.blocked ? (
              <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
                <AlertTriangle size={16} /> {preview.message}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-lg bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-400">
                    <p className="font-semibold text-lg">{preview.snapshots.length}</p><p>SKUs analisados</p>
                  </div>
                  <div className="rounded-lg bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
                    <p className="font-semibold text-lg">{preview.warnings.length}</p><p>Avisos</p>
                  </div>
                  <div className="rounded-lg bg-red-500/10 p-3 text-red-700 dark:text-red-400">
                    <p className="font-semibold text-lg">{preview.vendasErrors.length}</p><p>Linhas de vendas rejeitadas</p>
                  </div>
                </div>
                <p className="text-sm text-fg-muted">
                  Cobertura de custo: {preview.costCoveragePct?.toFixed(1)}%
                  {preview.hasStockFile && ` · Cobertura de estoque: ${preview.stockCoveragePct?.toFixed(1)}%`}
                  {!preview.hasStockFile && ' · Sem snapshot de estoque — reposição não calculada.'}
                </p>
                {preview.warnings.length > 0 && (
                  <div className="max-h-32 overflow-y-auto text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                    {preview.warnings.slice(0, 20).map((w: string, i: number) => <p key={i}>{w}</p>)}
                  </div>
                )}
                {preview.vendasErrors.length > 0 && (
                  <div className="max-h-32 overflow-y-auto text-xs text-red-700 dark:text-red-400 space-y-0.5">
                    {preview.vendasErrors.slice(0, 20).map((e: { rowIndex: number; message: string }, i: number) => <p key={i}>Linha {e.rowIndex + 1}: {e.message}</p>)}
                  </div>
                )}
              </>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setStep('estoque')}>Voltar</Button>
              <Button onClick={handlePublish} disabled={preview.blocked || publishing}>Publicar análise</Button>
            </div>
          </div>
        )}

        {step === 'publishing' && (
          <div className="flex flex-col items-center gap-3 py-10 text-fg-muted">
            <Loader2 className="animate-spin" size={28} /> Publicando análise...
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 size={32} className="text-emerald-500" />
            <p className="text-fg font-medium">Análise publicada.</p>
            {preview && !preview.blocked && preview.warnings.length > 0 && (
              <Badge variant="warning">{preview.warnings.length} avisos — confira em Fontes de dados.</Badge>
            )}
            <Button onClick={onPublished}>Concluir</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
