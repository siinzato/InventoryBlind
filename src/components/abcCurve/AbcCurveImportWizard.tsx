// Curva ABC — assistente de importação: configuração do período → vendas → preços/custos →
// estoque (opcional, com ABC do Tiny opcional embutido) → prévia → publicação transacional.
// Mesmo esqueleto de passos de SalesImportWizard.tsx, generalizado para múltiplos arquivos.

import { useMemo, useState } from 'react';
import { Upload, AlertTriangle, CheckCircle2, ArrowRight, Loader2, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Modal, Button, Select, Badge, Notice } from '../ui';
import {
  detectColumns, suggestMapping, applyMapping, parseTabularFile, computeFileHash, normalizeSku, parseNumber,
  missingRequiredFields, VENDAS_FIELDS, PRECOS_CUSTOS_FIELDS, ESTOQUE_FIELDS, ABC_TINY_FIELDS,
  type ColumnMapping, type RawRow, type FieldDef,
} from '../../lib/abcCurve/abcCurveParsing';
import {
  aggregateVendas, buildPricingMap, buildStockMap, buildSkuSnapshots, type SkuSnapshot,
} from '../../lib/abcCurve/abcCurveEngine';
import { DEFAULT_ABC_POLICY, validateAbcPolicy, type AbcCommercialPolicy } from '../../lib/abcCurve/abcCurvePolicy';
import { evaluateSignals } from '../../lib/abcCurve/abcCurveSignals';
import { normalizeTinyClass, type TinyFileValues } from '../../lib/abcCurve/abcCurveTiny';
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

// Os 7 parâmetros da política, na ordem em que se leem. Rótulos com a unidade explícita, para
// ninguém digitar 0,15 num campo que espera 15.
const POLICY_FIELDS: { key: keyof AbcCommercialPolicy; label: string; max: number; step: number }[] = [
  { key: 'thresholdA', label: 'Classe A até (% acumulado)', max: 100, step: 1 },
  { key: 'thresholdB', label: 'Classe B até (% acumulado)', max: 100, step: 1 },
  { key: 'lowCoverageDays', label: 'Baixa cobertura (dias)', max: 3650, step: 1 },
  { key: 'healthyCoverageDays', label: 'Cobertura saudável (dias)', max: 3650, step: 1 },
  { key: 'excessCoverageDays', label: 'Excesso de cobertura (dias)', max: 3650, step: 1 },
  { key: 'lowMarginPct', label: 'Margem baixa (%)', max: 100, step: 1 },
  { key: 'strongMarginPct', label: 'Margem forte (%)', max: 100, step: 1 },
];

export function AbcCurveImportWizard({ companyId, userId, userEmail, onClose, onPublished }: AbcCurveImportWizardProps) {
  const [step, setStep] = useState<Step>('config');
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<AbcProvider>('tiny');

  const [name, setName] = useState('');
  const [salesPeriodStart, setSalesPeriodStart] = useState('');
  const [salesPeriodEnd, setSalesPeriodEnd] = useState('');
  const [pricingSnapshotDate, setPricingSnapshotDate] = useState('');
  const [stockSnapshotDate, setStockSnapshotDate] = useState('');
  // Política comercial desta análise. Começa nos mesmos valores que estavam fixos no código,
  // então quem não abrir a seção publica exatamente o comportamento anterior.
  const [policy, setPolicy] = useState<AbcCommercialPolicy>(DEFAULT_ABC_POLICY);
  const [policyOpen, setPolicyOpen] = useState(false);
  const setPolicyField = (key: keyof AbcCommercialPolicy, value: number) =>
    setPolicy(prev => ({ ...prev, [key]: value }));

  const [vendas, setVendas] = useState<FileSlot>(emptySlot(VENDAS_FIELDS));
  const [precos, setPrecos] = useState<FileSlot>(emptySlot(PRECOS_CUSTOS_FIELDS));
  const [estoque, setEstoque] = useState<FileSlot>(emptySlot(ESTOQUE_FIELDS));
  const [abcTiny, setAbcTiny] = useState<FileSlot>(emptySlot(ABC_TINY_FIELDS));
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

  // Campos obrigatórios sem coluna escolhida — bloqueiam o avanço do próprio passo, com o
  // nome do campo na tela, em vez de virar análise silenciosamente incompleta.
  const vendasMissing = vendas.file ? missingRequiredFields(VENDAS_FIELDS, vendas.mapping) : [];
  const precosMissing = precos.file ? missingRequiredFields(PRECOS_CUSTOS_FIELDS, precos.mapping) : [];
  const estoqueMissing = estoque.file ? missingRequiredFields(ESTOQUE_FIELDS, estoque.mapping) : [];
  const tinyMissing = abcTiny.file ? missingRequiredFields(ABC_TINY_FIELDS, abcTiny.mapping) : [];
  const thresholdError = validateAbcPolicy(policy);

  const preview = useMemo(() => {
    if (step !== 'preview' && step !== 'publishing' && step !== 'done') return null;
    const invalidPolicy = validateAbcPolicy(policy);
    if (invalidPolicy) return { blocked: true, message: invalidPolicy } as const;
    if (!salesPeriodStart || !salesPeriodEnd || salesPeriodStart > salesPeriodEnd) {
      return { blocked: true, message: 'Período de vendas inválido.' } as const;
    }

    const missing = [
      ...missingRequiredFields(VENDAS_FIELDS, vendas.mapping).map(l => `Vendas → ${l}`),
      ...missingRequiredFields(PRECOS_CUSTOS_FIELDS, precos.mapping).map(l => `Preços/custos → ${l}`),
      ...(estoque.file ? missingRequiredFields(ESTOQUE_FIELDS, estoque.mapping).map(l => `Estoque → ${l}`) : []),
      ...(abcTiny.file ? missingRequiredFields(ABC_TINY_FIELDS, abcTiny.mapping).map(l => `Curva ABC do Tiny → ${l}`) : []),
    ];
    if (missing.length > 0) {
      return { blocked: true, message: `Mapeie os campos obrigatórios antes de gerar a prévia: ${missing.join(', ')}.` } as const;
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
    const mappedEstoque = hasStockFile ? applyMapping(estoque.rawRows, estoque.mapping) : [];
    const stockResult = hasStockFile ? buildStockMap(mappedEstoque) : null;
    const stockMap = stockResult?.map ?? null;
    if (stockResult) warnings.push(...stockResult.warnings);

    const periodDays = Math.max(1, Math.round((new Date(salesPeriodEnd).getTime() - new Date(salesPeriodStart).getTime()) / 86400000) + 1);
    const snapshots = buildSkuSnapshots({ vendas: aggregated, pricing: pricingMap, stock: stockMap, periodDays, thresholdA: policy.thresholdA, thresholdB: policy.thresholdB });

    // Recomendação principal (uma por SKU) e sinais associados (vários) usam a MESMA política
    // desta análise, calculados aqui uma única vez — depois de publicados, nunca são reavaliados.
    const recommendationsBySku = new Map<string, Recommendation>();
    const signalsBySku = new Map<string, string[]>();
    snapshots.forEach(s => {
      const rec = evaluateRecommendation(s, policy);
      if (rec) recommendationsBySku.set(s.sku, rec);
      const signals = evaluateSignals(s, policy);
      if (signals.length > 0) signalsBySku.set(s.sku, signals);
    });

    // Referência do Tiny: casada SOMENTE por SKU normalizado exato. Nada de fuzzy, nada de
    // match por nome de produto — e SKU do Tiny que não existe na análise não cria produto.
    const tinyBySku = new Map<string, TinyFileValues>();
    let tinyFileRows = 0;
    let tinyUnmatched = 0;
    if (abcTiny.file) {
      const mappedTiny = applyMapping(abcTiny.rawRows, abcTiny.mapping);
      const snapshotSkus = new Set(snapshots.map(s => s.sku));
      for (const row of mappedTiny) {
        const sku = normalizeSku(row.sku);
        if (!sku) continue;
        tinyFileRows += 1;
        if (!snapshotSkus.has(sku)) { tinyUnmatched += 1; continue; }
        tinyBySku.set(sku, {
          quantity: parseNumber(row.quantidade),
          value: parseNumber(row.valor),
          individualPct: parseNumber(row.percentualIndividual),
          cumulativePct: parseNumber(row.percentualAcumulado),
          classification: normalizeTinyClass(row.classificacao !== undefined ? String(row.classificacao) : null),
        });
      }
      if (tinyUnmatched > 0) {
        warnings.push(`Curva ABC do Tiny: ${tinyUnmatched} SKUs do arquivo não existem nesta análise — ficam de fora do comparativo.`);
      }
    }

    const withCost = snapshots.filter(s => s.cost !== null).length;
    const withStock = hasStockFile ? snapshots.filter(s => s.stockAvailable !== null).length : 0;
    if (pricingSnapshotDate && (pricingSnapshotDate < salesPeriodStart || pricingSnapshotDate > salesPeriodEnd)) {
      warnings.push('Data do snapshot de preços/custos fora do período de vendas — cobertura pode ficar parcial.');
    }

    // Linhas VÁLIDAS por arquivo (não o total recebido): é isso que vai para importedCount, e
    // é isso que a aba Fontes de dados precisa mostrar para "recebidas ≠ válidas" fazer sentido.
    const validRows = {
      vendas: Math.max(0, mappedVendas.length - vendasErrors.length),
      precos: mappedPrecos.filter(r => normalizeSku(r.sku) !== null).length,
      estoque: hasStockFile ? mappedEstoque.filter(r => normalizeSku(r.sku) !== null).length : 0,
    };

    const revenueClassCounts = { A: 0, B: 0, C: 0 };
    snapshots.forEach(s => { if (s.revenueClass) revenueClassCounts[s.revenueClass] += 1; });

    return {
      blocked: false as const,
      vendasErrors, warnings, snapshots, recommendationsBySku, signalsBySku, validRows, revenueClassCounts,
      tinyBySku, tinyFileRows, tinyMatched: tinyBySku.size, tinyUnmatched,
      signalCount: signalsBySku.size,
      pricingWarningCount: pricingWarnings.length,
      stockWarningCount: stockResult?.warnings.length ?? 0,
      costCoveragePct: snapshots.length > 0 ? (withCost / snapshots.length) * 100 : null,
      stockCoveragePct: hasStockFile && snapshots.length > 0 ? (withStock / snapshots.length) * 100 : null,
      hasStockFile,
    };
  }, [step, vendas, precos, estoque, abcTiny, salesPeriodStart, salesPeriodEnd, pricingSnapshotDate, policy]);

  const canGoToPreview = vendas.file !== null && precos.file !== null && !!name.trim()
    && !!salesPeriodStart && !!salesPeriodEnd && !!pricingSnapshotDate
    && vendasMissing.length === 0 && precosMissing.length === 0 && estoqueMissing.length === 0
    && tinyMissing.length === 0
    && thresholdError === null;

  const handlePublish = async () => {
    if (!preview || preview.blocked) return;
    setPublishing(true);
    setStep('publishing');
    setError(null);
    try {
      const skus = preview.snapshots.map((s: SkuSnapshot) => s.sku);
      const productIdBySku = await matchProductIds(companyId, skus);

      const batches = [
        { fileKind: 'vendas' as AbcFileKind, sourceType: 'file' as const, provider: origin, fileName: vendas.file?.name ?? null, fileHash: vendas.hash, rowCount: vendas.rawRows.length, importedCount: preview.validRows.vendas, warningCount: preview.vendasErrors.length },
        { fileKind: 'precos_custos' as AbcFileKind, sourceType: 'file' as const, provider: origin, fileName: precos.file?.name ?? null, fileHash: precos.hash, rowCount: precos.rawRows.length, importedCount: preview.validRows.precos, warningCount: preview.pricingWarningCount },
      ];
      if (estoque.file) {
        batches.push({ fileKind: 'estoque' as AbcFileKind, sourceType: 'file' as const, provider: origin, fileName: estoque.file.name, fileHash: estoque.hash, rowCount: estoque.rawRows.length, importedCount: preview.validRows.estoque, warningCount: preview.stockWarningCount });
      }
      if (abcTiny.file) {
        // A referência não entra no cálculo da curva, mas agora alimenta o comparativo: as
        // contagens do lado do Tiny (linhas com SKU, correspondentes, sem correspondência)
        // cabem nas colunas que o batch já tem — nenhuma estrutura nova.
        batches.push({ fileKind: 'abc_tiny' as AbcFileKind, sourceType: 'file' as const, provider: origin, fileName: abcTiny.file.name, fileHash: abcTiny.hash, rowCount: preview.tinyFileRows, importedCount: preview.tinyMatched, warningCount: preview.tinyUnmatched });
      }

      await publishAnalysis({
        companyId, userId, userEmail, name: name.trim(),
        salesPeriodStart, salesPeriodEnd, pricingSnapshotDate, stockSnapshotDate: stockSnapshotDate || null,
        policy, batches, snapshots: preview.snapshots, productIdBySku,
        recommendationsBySku: preview.recommendationsBySku,
        signalsBySku: preview.signalsBySku,
        tinyBySku: preview.tinyBySku,
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
    label: string, fields: FieldDef[], slot: FileSlot, setSlot: (slot: FileSlot) => void, missing: string[] = [],
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
          {missing.length > 0 && (
            <Notice tone="warning">
              Campos obrigatórios sem coluna escolhida: {missing.join(', ')}. Escolha a coluna correspondente para continuar.
            </Notice>
          )}
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
            {/* Política comercial: fechada por padrão, com os mesmos valores que eram fixos no
                código. Quem não abrir publica exatamente o comportamento anterior. */}
            <div className="rounded-container border border-edge">
              <button
                type="button"
                aria-expanded={policyOpen}
                onClick={() => setPolicyOpen(open => !open)}
                className="flex w-full items-center justify-between gap-2 p-3 text-left"
              >
                <span className="text-sm font-medium text-fg">Política comercial</span>
                <span className="flex items-center gap-2 text-xs text-fg-subtle">
                  {!policyOpen && `A ${policy.thresholdA}% · B ${policy.thresholdB}% · ${policy.lowCoverageDays}/${policy.healthyCoverageDays}/${policy.excessCoverageDays}d · ${policy.lowMarginPct}%/${policy.strongMarginPct}%`}
                  {policyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </span>
              </button>
              {policyOpen && (
                <div className="space-y-3 border-t border-edge p-3">
                  <p className="text-xs text-fg-subtle">
                    Estes parâmetros afetam recomendações desta análise e ficam registrados no histórico.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {POLICY_FIELDS.map(field => (
                      <div key={field.key}>
                        <label className="block text-sm font-medium text-fg mb-1" htmlFor={`abc-policy-${field.key}`}>{field.label}</label>
                        <input
                          id={`abc-policy-${field.key}`}
                          type="number"
                          min={0}
                          max={field.max}
                          step={field.step}
                          value={policy[field.key]}
                          onChange={e => setPolicyField(field.key, Number(e.target.value))}
                          className="w-full p-2 border border-edge rounded-lg bg-surface text-fg text-sm"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* Política incoerente (95/80, margem baixa acima da forte, cobertura saudável
                acima do excesso...) produziria recomendação sem significado — bloqueio antes
                de importar qualquer arquivo. */}
            {thresholdError && <Notice tone="danger">{thresholdError}</Notice>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => setStep('vendas')} disabled={!name.trim() || !salesPeriodStart || !salesPeriodEnd || !pricingSnapshotDate || thresholdError !== null}>
                Continuar <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        )}

        {step === 'vendas' && (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">Vendas do período (obrigatório).</p>
            {renderUploadStep('vendas', VENDAS_FIELDS, vendas, setVendas, vendasMissing)}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setStep('config')}>Voltar</Button>
              <Button onClick={() => setStep('precos')} disabled={!vendas.file || vendasMissing.length > 0}>Continuar <ArrowRight size={14} /></Button>
            </div>
          </div>
        )}

        {step === 'precos' && (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">Preços e custos (obrigatório para calcular rentabilidade).</p>
            {renderUploadStep('preços e custos', PRECOS_CUSTOS_FIELDS, precos, setPrecos, precosMissing)}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setStep('vendas')}>Voltar</Button>
              <Button onClick={() => setStep('estoque')} disabled={!precos.file || precosMissing.length > 0}>Continuar <ArrowRight size={14} /></Button>
            </div>
          </div>
        )}

        {step === 'estoque' && (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">Estoque (opcional — sem ele, a análise comercial funciona normalmente e a reposição não é calculada).</p>
            {renderUploadStep('estoque', ESTOQUE_FIELDS, estoque, setEstoque, estoqueMissing)}
            {/* A referência do Tiny passa pelo MESMO fluxo de mapeamento dos outros arquivos
                (detectColumns/suggestMapping/applyMapping) — nenhum parser paralelo. Ela não
                entra no cálculo da curva; alimenta o comparativo, casada por SKU exato. */}
            <div className="border-t border-edge pt-3">
              <p className="text-sm text-fg-muted mb-2">Curva ABC do Tiny (opcional — referência para comparação, não entra no cálculo desta análise).</p>
              {renderUploadStep('Curva ABC do Tiny', ABC_TINY_FIELDS, abcTiny, setAbcTiny, tinyMissing)}
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
              <Notice tone="danger">{preview.message}</Notice>
            ) : (
              <>
                {/* Superfície clara, borda fina, cor só no badge de status — a prévia é uma
                    conferência, não um painel colorido. */}
                <div className="rounded-container border border-edge divide-y divide-edge">
                  <dl className="grid grid-cols-3 divide-x divide-edge">
                    <div className="p-3">
                      <dt className="text-label">SKUs analisados</dt>
                      <dd className="font-display text-xl font-semibold tabular-nums text-fg mt-0.5">{preview.snapshots.length.toLocaleString('pt-BR')}</dd>
                    </div>
                    <div className="p-3">
                      <dt className="text-label">Avisos</dt>
                      <dd className={`font-display text-xl font-semibold tabular-nums mt-0.5 ${preview.warnings.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-fg'}`}>{preview.warnings.length.toLocaleString('pt-BR')}</dd>
                    </div>
                    <div className="p-3">
                      <dt className="text-label">Linhas rejeitadas</dt>
                      <dd className={`font-display text-xl font-semibold tabular-nums mt-0.5 ${preview.vendasErrors.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-fg'}`}>{preview.vendasErrors.length.toLocaleString('pt-BR')}</dd>
                    </div>
                  </dl>
                  <dl className="grid grid-cols-2 divide-x divide-edge">
                    <div className="p-3">
                      <dt className="text-label">Cobertura de custo</dt>
                      <dd className="text-sm tabular-nums text-fg mt-0.5">{preview.costCoveragePct !== null ? `${preview.costCoveragePct.toFixed(1)}%` : '—'}</dd>
                    </div>
                    <div className="p-3">
                      <dt className="text-label">Cobertura de estoque</dt>
                      <dd className="text-sm text-fg mt-0.5">
                        {preview.hasStockFile
                          ? `${preview.stockCoveragePct?.toFixed(1) ?? '—'}%`
                          : 'Sem snapshot — reposição não calculada'}
                      </dd>
                    </div>
                  </dl>
                  <div className="p-3">
                    <p className="text-label mb-1.5">Classificação por faturamento</p>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-fg">
                      <Badge variant="success">A</Badge> {preview.revenueClassCounts.A.toLocaleString('pt-BR')}
                      <Badge variant="warning">B</Badge> {preview.revenueClassCounts.B.toLocaleString('pt-BR')}
                      <Badge variant="danger">C</Badge> {preview.revenueClassCounts.C.toLocaleString('pt-BR')}
                    </div>
                  </div>
                  {abcTiny.file && (
                    <dl className="grid grid-cols-3 divide-x divide-edge">
                      <div className="p-3">
                        <dt className="text-label">SKUs no arquivo do Tiny</dt>
                        <dd className="text-sm tabular-nums text-fg mt-0.5">{preview.tinyFileRows.toLocaleString('pt-BR')}</dd>
                      </div>
                      <div className="p-3">
                        <dt className="text-label">Correspondentes</dt>
                        <dd className="text-sm tabular-nums text-fg mt-0.5">{preview.tinyMatched.toLocaleString('pt-BR')}</dd>
                      </div>
                      <div className="p-3">
                        <dt className="text-label">Sem correspondência</dt>
                        <dd className="text-sm tabular-nums text-fg mt-0.5">{preview.tinyUnmatched.toLocaleString('pt-BR')}</dd>
                      </div>
                    </dl>
                  )}
                </div>

                {/* Contagem primeiro, lista limitada e rolável depois: 260 avisos não podem
                    empurrar o botão de publicar para fora da tela. */}
                {preview.warnings.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm text-fg-muted">
                      {preview.warnings.length.toLocaleString('pt-BR')} {preview.warnings.length === 1 ? 'aviso' : 'avisos'}
                      {preview.warnings.length > 20 && ' — mostrando os 20 primeiros'}
                    </p>
                    <div className="max-h-32 overflow-y-auto rounded-control border border-edge p-2 text-xs text-fg-muted space-y-0.5">
                      {preview.warnings.slice(0, 20).map((w: string, i: number) => <p key={i}>{w}</p>)}
                    </div>
                  </div>
                )}
                {preview.vendasErrors.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm text-fg-muted">
                      {preview.vendasErrors.length.toLocaleString('pt-BR')} {preview.vendasErrors.length === 1 ? 'linha rejeitada' : 'linhas rejeitadas'} no arquivo de vendas
                      {preview.vendasErrors.length > 20 && ' — mostrando as 20 primeiras'}
                    </p>
                    <div className="max-h-32 overflow-y-auto rounded-control border border-edge p-2 text-xs text-fg-muted space-y-0.5">
                      {preview.vendasErrors.slice(0, 20).map((e: { rowIndex: number; message: string }, i: number) => <p key={i}>Linha {e.rowIndex + 1}: {e.message}</p>)}
                    </div>
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
