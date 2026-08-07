import { useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import { Panel, PanelSection, Button, Badge } from '../ui';
import { supabase, BrandData } from '../../lib/supabase';
import {
  CountRow, CountColumnMapping, COUNT_FIELDS,
  parseCountFile, detectCountColumnMappings, suggestCountMapping, applyCountColumnMapping,
  classifyCountRow, findMissingProducts, ClassifiedCountRow, SystemProductLookup,
  calculateCountMetrics, generateCountInsight,
} from '../../lib/countManagementUtils';
import type { LiveCountStats } from './CountSidePanel';
import { useAuth } from '../../lib/auth';
import { recomputeForProducts } from '../../lib/cbcService';
import { recomputeRiskForProducts } from '../../lib/riskService';
import { recomputeAbcXyzForCompany } from '../../lib/abcXyzService';
import { RcaClassificationModal, PendingRcaItem } from '../rca/RcaClassificationModal';

type ImportStep = 'upload' | 'mapping' | 'preview' | 'importing' | 'complete';

interface ImportCountTabProps {
  brandsData: BrandData[];
  companyId: string;
  onBrandsUpdated: (brands: BrandData[]) => void;
  onSaved: () => void;
  onStatsChange: (stats: LiveCountStats) => void;
}

const STEPS: { key: ImportStep; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'mapping', label: 'Mapeamento' },
  { key: 'preview', label: 'Pré-visualização' },
  { key: 'complete', label: 'Concluído' },
];

const STATUS_LABEL: Record<string, string> = { correct: 'Correto', divergent: 'Divergente', missing: 'Faltante', surplus: 'Sobrando' };
const STATUS_BADGE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { correct: 'success', divergent: 'warning', missing: 'danger', surplus: 'danger' };

export function ImportCountTab({ brandsData, companyId, onBrandsUpdated, onSaved, onStatsChange }: ImportCountTabProps) {
  const { profile } = useAuth();
  const [step, setStep] = useState<ImportStep>('upload');
  const [brandId, setBrandId] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<CountRow[]>([]);
  const [mapping, setMapping] = useState<CountColumnMapping>({ produto: null, sku: null, ean: null, local: null, saldoContado: null });
  const [rows, setRows] = useState<ClassifiedCountRow[]>([]);
  const [filter, setFilter] = useState<'all' | ClassifiedCountRow['status']>('all');
  const [saving, setSaving] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);
  const [pendingRcaItems, setPendingRcaItems] = useState<PendingRcaItem[]>([]);

  const selectedBrand = brandsData.find(b => b.id === brandId);
  const stepIdx = STEPS.findIndex(s => s.key === step);

  const handleFile = async (file: File) => {
    const { headers: h, rows: r } = await parseCountFile(file);
    if (r.length === 0) {
      alert('Nenhuma linha encontrada no arquivo.');
      return;
    }
    setHeaders(h);
    setRawRows(r);
    setMapping(suggestCountMapping(detectCountColumnMappings(h)));
    setStep('mapping');
  };

  const handleConfirmMapping = async () => {
    const mapped = applyCountColumnMapping(rawRows, mapping);
    const skus = Array.from(new Set(mapped.map(r => String(r.sku ?? '').trim().toUpperCase()).filter(Boolean)));

    const { data: products, error } = await supabase
      .from('products')
      .select('id, sku, name, ean, location, price, stock_quantity')
      .eq('company_id', companyId)
      .in('sku', skus);

    if (error) {
      console.error('Error loading products for comparison:', error);
    }

    const bySku = new Map<string, SystemProductLookup>();
    (products || []).forEach(p => bySku.set(String(p.sku).toUpperCase(), p as SystemProductLookup));

    const classified = mapped.map(row => classifyCountRow(row, bySku.get(String(row.sku ?? '').trim().toUpperCase()), responsavel));
    const missing = findMissingProducts(classified, Array.from(bySku.values()));

    setRows([...classified, ...missing]);
    setStep('preview');
  };

  const filteredRows = filter === 'all' ? rows : rows.filter(r => r.status === filter);
  const summary = {
    total: rows.length,
    correct: rows.filter(r => r.status === 'correct').length,
    divergent: rows.filter(r => r.status === 'divergent').length,
    missing: rows.filter(r => r.status === 'missing').length,
    surplus: rows.filter(r => r.status === 'surplus').length,
  };

  const handleConfirmImport = async () => {
    if (!selectedBrand) return;
    setStep('importing');
    setSaving(true);

    const divergentCount = summary.divergent + summary.missing + summary.surplus;
    const valorFinanceiro = rows
      .filter(r => r.status !== 'correct' && r.diferenca !== null && r.precoUnitario !== null)
      .reduce((sum, r) => sum + Math.abs(r.diferenca ?? 0) * (r.precoUnitario ?? 0), 0);

    const metrics = calculateCountMetrics({
      skusContados: rows.length,
      divergenciasEncontradas: divergentCount,
      divergenciasReais: divergentCount,
    });

    const newDoneSku = Math.min(selectedBrand.total_sku, selectedBrand.done_sku + rows.length);
    const newDivergences = selectedBrand.divergences + divergentCount;

    const { error: brandError } = await supabase
      .from('inventory_brands')
      .update({ done_sku: newDoneSku, divergences: newDivergences, updated_at: new Date().toISOString() })
      .eq('id', selectedBrand.id);

    if (brandError) console.error('Error updating brand from import count:', brandError);

    const { data: recordData, error: recordError } = await supabase
      .from('inventory_count_records')
      .insert({
        company_id: companyId,
        brand_id: selectedBrand.id,
        count_number: 1,
        source: 'import',
        operator_1: responsavel || null,
        total_sku: selectedBrand.total_sku,
        skus_contados: rows.length,
        divergencias_encontradas: divergentCount,
        divergencias_recontadas: 0,
        divergencias_reais: divergentCount,
        valor_financeiro_divergencias: valorFinanceiro || null,
        accuracy_initial: metrics.accuracyInitial,
        accuracy_final: metrics.accuracyFinal,
      })
      .select()
      .single();

    if (recordError) console.error('Error inserting import count record:', recordError);

    if (recordData) {
      const itemRows = rows.map(r => ({
        count_record_id: recordData.id,
        company_id: companyId,
        product_id: r.productId,
        sku: r.sku,
        ean: r.ean,
        produto_nome: r.produto,
        local: r.local,
        saldo_sistema: r.saldoSistema,
        saldo_contado: r.saldoContado,
        diferenca: r.diferenca,
        status: r.status,
        responsavel: r.responsavel,
      }));

      const { data: insertedItems, error: itemsError } = await supabase.from('inventory_count_import_items').insert(itemRows).select();
      if (itemsError) console.error('Error inserting count import items:', itemsError);

      if (insertedItems) {
        const divergent = rows
          .map((r, i) => ({ row: r, id: insertedItems[i]?.id as string | undefined }))
          .filter((entry): entry is { row: typeof rows[number]; id: string } => !!entry.id && entry.row.status !== 'correct');
        setPendingRcaItems(divergent.map(({ row, id }) => ({
          sourceItemId: id,
          productId: row.productId,
          sku: row.sku,
          productName: row.produto,
          location: row.local,
          operatorUserId: profile?.id ?? null,
          operatorName: row.responsavel,
          divergenceQty: row.diferenca ?? 0,
        })));
      }

      // CBC — só a importação grava saldo por SKU, é o único gatilho automático real de
      // recálculo "após inventário" (fire-and-forget, não bloqueia a conclusão da tela).
      const productIds = rows.map(r => r.productId).filter((id): id is string => !!id);
      if (productIds.length > 0) {
        recomputeForProducts(productIds, companyId, profile?.id, profile?.email ?? undefined);
        recomputeRiskForProducts(productIds, companyId, profile?.id, profile?.email ?? undefined);
        // ABC/XYZ é recálculo de empresa inteira (a classe de um SKU depende do rank dele
        // entre todos os outros) — diferente de CBC/Risco, que recalculam só os SKUs afetados.
        recomputeAbcXyzForCompany(companyId, profile?.id, profile?.email ?? undefined);
      }
    }

    onBrandsUpdated(brandsData.map(b => b.id === selectedBrand.id ? { ...b, done_sku: newDoneSku, divergences: newDivergences } : b));
    setInsight(generateCountInsight(metrics, divergentCount, selectedBrand.brand));
    onStatsChange({ linha: selectedBrand.brand, totalSku: selectedBrand.total_sku, contados: rows.length, divergencias: divergentCount, acuracidade: metrics.accuracyFinal, active: true });

    onSaved();
    setSaving(false);
    setStep('complete');
  };

  const handleReset = () => {
    setStep('upload');
    setHeaders([]);
    setRawRows([]);
    setRows([]);
    setInsight(null);
  };

  return (
    <Panel>
      <PanelSection padding="md">
        <div className="flex items-center justify-center gap-2">
          {STEPS.map((s, idx) => (
            <div key={s.key} className="flex items-center">
              {idx > 0 && <div className={`w-10 h-1 mx-1 rounded ${stepIdx >= idx ? 'bg-accent' : 'bg-surface-3'}`} />}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                stepIdx > idx ? 'bg-accent text-white' : stepIdx === idx ? 'bg-accent-strong text-white' : 'bg-surface-3 text-fg-subtle'
              }`}>
                {stepIdx > idx ? '✓' : idx + 1}
              </div>
            </div>
          ))}
        </div>
      </PanelSection>

      {step === 'upload' && (
        <PanelSection padding="lg" className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Linha / Marca</label>
            <select required value={brandId} onChange={e => setBrandId(e.target.value)} className="w-full p-2.5 border border-edge rounded-lg bg-surface text-fg text-sm">
              <option value="">Selecione a linha ou marca...</option>
              {brandsData.map(b => <option key={b.id} value={b.id}>{b.brand}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Responsável</label>
            <input value={responsavel} onChange={e => setResponsavel(e.target.value)} className="w-full p-2.5 border border-edge rounded-lg bg-surface text-fg text-sm" placeholder="Nome do responsável" />
          </div>
          <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed border-edge rounded-xl p-10 text-center transition-colors ${brandId ? 'cursor-pointer hover:border-accent hover:bg-accent/5' : 'opacity-50 cursor-not-allowed'}`}>
            <Upload size={28} className="text-fg-subtle" />
            <p className="text-sm text-fg-muted">Arraste ou clique para enviar XLSX, XLS ou CSV</p>
            <input
              type="file" accept=".xlsx,.xls,.csv" disabled={!brandId} className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </label>
        </PanelSection>
      )}

      {step === 'mapping' && (
        <PanelSection padding="lg" className="space-y-4">
          <p className="text-sm text-fg-muted">Confirme como as colunas do arquivo correspondem aos campos esperados.</p>
          {COUNT_FIELDS.map(field => (
            <div key={field.key} className="grid grid-cols-2 gap-3 items-center">
              <label className="text-sm text-fg">{field.label}{field.required && ' *'}</label>
              <select
                value={(mapping as unknown as Record<string, string | null>)[field.key] ?? ''}
                onChange={e => setMapping(prev => ({ ...prev, [field.key]: e.target.value || null }))}
                className="p-2 border border-edge rounded-lg bg-surface text-fg text-sm"
              >
                <option value="">— Não mapear —</option>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          ))}
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={handleReset}>Cancelar</Button>
            <Button onClick={handleConfirmMapping} disabled={!mapping.sku || !mapping.saldoContado}>Continuar</Button>
          </div>
        </PanelSection>
      )}

      {step === 'preview' && (
        <>
          <PanelSection padding="md" className="grid grid-cols-2 sm:grid-cols-5 divide-y divide-edge sm:divide-y-0 sm:divide-x">
            <div className="text-center px-2"><p className="text-xs text-fg-subtle">Total</p><p className="text-lg font-semibold text-fg">{summary.total}</p></div>
            <div className="text-center px-2"><p className="text-xs text-fg-subtle">Corretos</p><p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{summary.correct}</p></div>
            <div className="text-center px-2"><p className="text-xs text-fg-subtle">Divergentes</p><p className="text-lg font-semibold text-amber-600 dark:text-amber-400">{summary.divergent}</p></div>
            <div className="text-center px-2"><p className="text-xs text-fg-subtle">Faltantes</p><p className="text-lg font-semibold text-red-600 dark:text-red-400">{summary.missing}</p></div>
            <div className="text-center px-2"><p className="text-xs text-fg-subtle">Sobrando</p><p className="text-lg font-semibold text-red-600 dark:text-red-400">{summary.surplus}</p></div>
          </PanelSection>

          <PanelSection padding="sm" className="flex gap-2 flex-wrap">
            {(['all', 'correct', 'divergent', 'missing', 'surplus'] as const).map(f => (
              <button
                key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${filter === f ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge'}`}
              >
                {f === 'all' ? 'Todos' : STATUS_LABEL[f]}
              </button>
            ))}
          </PanelSection>

          <div className="border-t border-edge max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-3 sticky top-0">
                <tr>
                  {['Produto', 'SKU', 'Saldo Sistema', 'Saldo Contado', 'Diferença', 'Status'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 font-medium text-fg-muted text-xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r, i) => (
                  <tr key={i} className="border-b border-edge/60 last:border-0">
                    <td className="px-4 py-2 text-fg">{r.produto || '—'}</td>
                    <td className="px-4 py-2 text-fg font-mono">{r.sku || '—'}</td>
                    <td className="px-4 py-2 text-fg-muted">{r.saldoSistema ?? '—'}</td>
                    <td className="px-4 py-2 text-fg-muted">{r.saldoContado}</td>
                    <td className="px-4 py-2 text-fg-muted">{r.diferenca ?? '—'}</td>
                    <td className="px-4 py-2"><Badge variant={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PanelSection padding="md" className="flex gap-3">
            <Button variant="secondary" onClick={handleReset}>Cancelar</Button>
            <Button onClick={handleConfirmImport} disabled={saving}>{saving ? 'Confirmando...' : 'Confirmar Importação'}</Button>
          </PanelSection>
        </>
      )}

      {step === 'importing' && (
        <PanelSection padding="lg" className="text-center text-fg-muted">
          <FileSpreadsheet size={28} className="mx-auto mb-2 text-fg-subtle" />
          Processando contagem...
        </PanelSection>
      )}

      {step === 'complete' && (
        <PanelSection padding="lg" className="space-y-4">
          <div className="p-3 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-lg flex items-start gap-2 text-sm">
            <CheckCircle2 size={18} className="flex-shrink-0 mt-0.5" />
            <span>{insight}</span>
          </div>
          <Button onClick={handleReset}>Nova Importação</Button>
        </PanelSection>
      )}

      {profile && (
        <RcaClassificationModal
          open={pendingRcaItems.length > 0}
          sourceModule="import_count"
          items={pendingRcaItems}
          companyId={companyId}
          userId={profile.id}
          userEmail={profile.email ?? ''}
          onDone={() => setPendingRcaItems([])}
        />
      )}
    </Panel>
  );
}
