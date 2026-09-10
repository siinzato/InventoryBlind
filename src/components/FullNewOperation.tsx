import React, { useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import {
  Upload, ChevronRight, ChevronLeft, AlertTriangle, Check,
  RefreshCw, X, Package, FileSpreadsheet, Download,
} from 'lucide-react';
import type { FullItemStatus } from '../lib/fullManagerTypes';
import { ITEM_STATUS_LABEL, ITEM_STATUS_COLOR, MARKETPLACES } from '../lib/fullManagerTypes';
import { Panel, PanelSection, Button, PhaseRail } from './ui';
import type { PhaseRailStep } from './ui';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedRow {
  listing_id: string;
  sku: string;
  ean: string;
  name: string;
  quantity: number;
  // filled after DB lookup:
  product_id?: string;
  location?: string;
  stock?: number;
  status: FullItemStatus;
}

interface Step1Form {
  full_number: string;
  marketplace: string;
  responsible: string;
  notes: string;
}

// ── Column aliases ────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function headerMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const aliases: Record<string, string[]> = {
    name: ['nome', 'produto', 'descricao', 'description', 'item', 'title', 'titulo'],
    sku: ['sku', 'codigo', 'code', 'codprod', 'ref', 'referencia', 'skucode'],
    ean: ['ean', 'gtin', 'barcode', 'codigodebarras', 'barras', 'eancode'],
    listing_id: ['idanuncio', 'listingid', 'anuncio', 'mlbid', 'id', 'idproduto'],
    quantity: ['quantidade', 'qtd', 'qty', 'quantity', 'qtde', 'quant', 'units', 'unidades'],
  };
  headers.forEach((h, i) => {
    const n = normalize(h);
    for (const [key, vals] of Object.entries(aliases)) {
      if (!map[key] && vals.some(v => n.includes(v))) map[key] = i;
    }
  });
  return map;
}

// ── Step 1: metadata ──────────────────────────────────────────────────────────

const Step1: React.FC<{ form: Step1Form; onChange: (f: Step1Form) => void; onNext: () => void }> = ({ form, onChange, onNext }) => {
  const set = (k: keyof Step1Form, v: string) => onChange({ ...form, [k]: v });
  const valid = form.full_number.trim().length > 0;

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-surface-2 rounded-xl border border-edge p-6 space-y-4">
        <div>
          <label className="block text-xs font-bold text-fg-subtle uppercase mb-1.5">Número do FULL *</label>
          <div className="flex">
            <span className="flex items-center px-3 bg-surface-3 border border-r-0 border-edge rounded-l-lg text-sm font-semibold text-fg-subtle">FULL #</span>
            <input value={form.full_number} onChange={e => set('full_number', e.target.value)}
              placeholder="803458905" required
              className="flex-1 px-4 py-2.5 border border-edge rounded-r-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 font-mono" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-bold text-fg-subtle uppercase mb-1.5">Marketplace</label>
          <select value={form.marketplace} onChange={e => set('marketplace', e.target.value)}
            className="w-full px-3 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface-2">
            {MARKETPLACES.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-fg-subtle uppercase mb-1.5">Responsável</label>
          <input value={form.responsible} onChange={e => set('responsible', e.target.value)}
            placeholder="Nome do responsável"
            className="w-full px-4 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40" />
        </div>
        <div>
          <label className="block text-xs font-bold text-fg-subtle uppercase mb-1.5">Observações</label>
          <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
            className="w-full px-4 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none" />
        </div>
        <button onClick={onNext} disabled={!valid}
          className="w-full flex items-center justify-center gap-2 py-3 bg-accent hover:bg-accent-strong text-white rounded-lg text-sm font-bold transition disabled:opacity-50">
          Próximo — Upload da planilha <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};

// ── Step 2: upload ────────────────────────────────────────────────────────────

const Step2: React.FC<{
  form: Step1Form;
  onBack: () => void;
  onParsed: (rows: ParsedRow[]) => void;
}> = ({ form, onBack, onParsed }) => {
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setError('');
    setProcessing(true);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (raw.length < 2) { setError('Planilha vazia ou sem dados.'); return; }

      const headers = (raw[0] as string[]).map(String);
      const idx = headerMap(headers);

      const rows: ParsedRow[] = [];
      for (let r = 1; r < raw.length; r++) {
        const row = raw[r] as string[];
        const qty = Number(row[idx.quantity] ?? 1);
        if (!qty) continue;
        const sku = String(row[idx.sku] ?? '').trim();
        const ean = String(row[idx.ean] ?? '').trim();
        if (!sku && !ean) continue;
        rows.push({
          listing_id: String(row[idx.listing_id] ?? '').trim(),
          sku,
          ean,
          name: String(row[idx.name] ?? '').trim(),
          quantity: qty || 1,
          status: 'found',
        });
      }

      if (!rows.length) { setError('Nenhuma linha válida encontrada na planilha.'); return; }

      // DB lookup: SKU first, then EAN
      const skus = rows.map(r => r.sku).filter(Boolean);
      const eans = rows.map(r => r.ean).filter(Boolean);

      const { data: products } = await supabase
        .from('products')
        .select('id, name, sku, ean, location')
        .or(skus.map(s => `sku.ilike.${s}`).concat(eans.map(e => `ean.ilike.${e}`)).join(','))
        .limit(2000);

      const bySkuMap = new Map<string, typeof products extends (infer T)[] | null ? T : never>();
      const byEanMap = new Map<string, typeof products extends (infer T)[] | null ? T : never>();
      (products || []).forEach(p => {
        if (p.sku) bySkuMap.set(p.sku.toLowerCase(), p);
        if (p.ean) byEanMap.set(p.ean.toLowerCase(), p);
      });

      const enriched: ParsedRow[] = rows.map(row => {
        const match = (row.sku && bySkuMap.get(row.sku.toLowerCase())) ||
                      (row.ean && byEanMap.get(row.ean.toLowerCase()));
        if (!match) return { ...row, status: 'not_found' as FullItemStatus };
        if (!match.location) return { ...row, name: match.name, product_id: match.id, status: 'no_location' as FullItemStatus };
        return {
          ...row,
          name: match.name,
          product_id: match.id,
          location: match.location,
          status: 'found' as FullItemStatus,
        };
      });

      onParsed(enriched);
    } catch (err) {
      console.error('[FullImport]', err);
      setError('Erro ao processar planilha. Verifique o formato do arquivo.');
    } finally {
      setProcessing(false);
    }
  }, [onParsed]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="bg-surface-2 rounded-xl border border-edge p-4 text-sm">
        <p className="font-bold text-fg-muted">FULL #{form.full_number} · {form.marketplace}</p>
        {form.responsible && <p className="text-fg-subtle">{form.responsible}</p>}
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition ${dragging ? 'border-accent bg-surface-3' : 'border-edge hover:border-fg-subtle hover:bg-surface-3'}`}
      >
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileInput} />
        {processing ? (
          <div className="flex flex-col items-center gap-3">
            <RefreshCw size={32} className="text-fg-subtle animate-spin" />
            <p className="text-sm font-medium text-fg-muted">Processando planilha e consultando estoque...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <FileSpreadsheet size={36} className="text-fg-subtle" />
            <p className="font-semibold text-fg-muted">Arraste ou clique para carregar a planilha</p>
            <p className="text-xs text-fg-subtle">Formatos aceitos: .xlsx, .xls, .csv</p>
            <p className="text-xs text-fg-subtle">Colunas: Nome, SKU, EAN, ID Anúncio, Quantidade</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 rounded-lg text-sm text-red-700 dark:text-red-400">
          <AlertTriangle size={16} />{error}
        </div>
      )}

      <button onClick={onBack} className="flex items-center gap-2 text-sm text-fg-subtle hover:text-fg transition">
        <ChevronLeft size={16} /> Voltar
      </button>
    </div>
  );
};

// ── Step 3: preview ───────────────────────────────────────────────────────────

const Step3: React.FC<{
  form: Step1Form;
  rows: ParsedRow[];
  onBack: () => void;
  onConfirm: () => Promise<void>;
}> = ({ form, rows, onBack, onConfirm }) => {
  const [saving, setSaving] = useState(false);

  const counts = {
    found: rows.filter(r => r.status === 'found').length,
    not_found: rows.filter(r => r.status === 'not_found').length,
    no_location: rows.filter(r => r.status === 'no_location').length,
    insufficient_stock: rows.filter(r => r.status === 'insufficient_stock').length,
    total_sku: rows.length,
    total_pieces: rows.reduce((s, r) => s + r.quantity, 0),
  };

  const exportErrors = () => {
    const errors = rows.filter(r => r.status !== 'found');
    const ws = XLSX.utils.json_to_sheet(errors.map(r => ({
      SKU: r.sku, EAN: r.ean, Nome: r.name, Quantidade: r.quantity,
      Status: ITEM_STATUS_LABEL[r.status],
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Erros');
    XLSX.writeFile(wb, `full-${form.full_number}-erros.xlsx`);
  };

  const handleConfirm = async () => {
    setSaving(true);
    try { await onConfirm(); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-surface-2 rounded-xl border border-edge p-4 flex flex-wrap gap-4 items-center justify-between">
        <div>
          <p className="font-bold text-fg">FULL #{form.full_number} · {form.marketplace}</p>
          {form.responsible && <p className="text-sm text-fg-subtle">{form.responsible}</p>}
        </div>
        <div className="flex gap-4 text-sm">
          <span><span className="font-bold text-fg">{counts.total_sku}</span> <span className="text-fg-subtle">SKU</span></span>
          <span><span className="font-bold text-fg">{counts.total_pieces}</span> <span className="text-fg-subtle">peças</span></span>
        </div>
      </div>

      {/* Status summary */}
      <Panel>
        <PanelSection>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y divide-edge sm:divide-y-0 sm:divide-x">
            {[
              { l: 'Encontrados', v: counts.found, cls: 'text-emerald-700 dark:text-emerald-400' },
              { l: 'Não encontrados', v: counts.not_found, cls: counts.not_found > 0 ? 'text-red-700 dark:text-red-400' : '' },
              { l: 'Sem localização', v: counts.no_location, cls: counts.no_location > 0 ? 'text-amber-700 dark:text-amber-400' : '' },
              { l: 'Saldo insuficiente', v: counts.insufficient_stock, cls: counts.insufficient_stock > 0 ? 'text-orange-700 dark:text-orange-400' : '' },
            ].map(({ l, v, cls }, i) => (
              <div key={l} className={`px-0 sm:px-4 py-2 sm:py-0 ${i === 0 ? 'sm:pl-0' : ''}`}>
                <p className={`text-2xl font-bold leading-none ${cls}`}>{v}</p>
                <p className="text-caption mt-1">{l}</p>
              </div>
            ))}
          </div>
        </PanelSection>
      </Panel>

      {/* Table */}
      <div className="bg-surface-2 rounded-xl border border-edge overflow-hidden">
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-sm">
            <thead className="border-b border-edge sticky top-0 bg-surface-2">
              <tr>
                {['Status', 'Nome', 'SKU', 'EAN', 'ID Anúncio', 'Qtd', 'Local'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-bold text-fg-subtle uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/60">
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-surface-3">
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ITEM_STATUS_COLOR[row.status]}`}>
                      {ITEM_STATUS_LABEL[row.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium text-fg max-w-[200px] truncate">{row.name || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">{row.sku || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-fg-subtle">{row.ean || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-fg-subtle">{row.listing_id || '—'}</td>
                  <td className="px-4 py-2.5 font-mono font-bold text-fg-muted">{row.quantity}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">{row.location || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        <Button onClick={handleConfirm} disabled={saving}>
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
          Confirmar Operação
        </Button>
        <Button variant="secondary" onClick={onBack}>
          <ChevronLeft size={14} /> Voltar
        </Button>
        {rows.some(r => r.status !== 'found') && (
          <Button variant="secondary" onClick={exportErrors}>
            <Download size={14} /> Exportar erros
          </Button>
        )}
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

interface FullNewOperationProps {
  onComplete: (operationId: string) => void;
  onCancel: () => void;
}

const FULL_OPERATION_PHASES: PhaseRailStep[] = [
  { key: '1', label: 'Identificação' },
  { key: '2', label: 'Upload' },
  { key: '3', label: 'Pré-visualização' },
];

const FullNewOperation: React.FC<FullNewOperationProps> = ({ onComplete, onCancel }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<Step1Form>({ full_number: '', marketplace: 'Mercado Livre', responsible: '', notes: '' });
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    setError('');
    try {
      const totalSku = rows.length;
      const totalPieces = rows.reduce((s, r) => s + r.quantity, 0);

      const { data: op, error: opErr } = await supabase
        .from('full_operations')
        .insert({
          full_number: form.full_number.trim(),
          marketplace: form.marketplace,
          responsible: form.responsible.trim() || null,
          notes: form.notes.trim() || null,
          status: 'preparing',
          total_sku: totalSku,
          total_pieces: totalPieces,
        })
        .select('id')
        .single();

      if (opErr || !op) throw opErr ?? new Error('Failed to create operation');

      // Insert items
      const items = rows.map(r => ({
        operation_id: op.id,
        listing_id: r.listing_id || null,
        product_id: r.product_id || null,
        sku: r.sku || null,
        ean: r.ean || null,
        product_name: r.name || null,
        location: r.location || null,
        quantity_requested: r.quantity,
        quantity_picked: 0,
        status: r.status,
      }));

      const { error: itemsErr } = await supabase.from('full_operation_items').insert(items);
      if (itemsErr) throw itemsErr;

      onComplete(op.id);
    } catch (err) {
      console.error('[FullNewOperation] confirm error:', err);
      setError(err instanceof Error ? err.message : 'Erro ao criar operação.');
    }
  };

  return (
    <div className="space-y-6">
      <PhaseRail label="Progresso da operação" steps={FULL_OPERATION_PHASES} currentKey={String(step)} />

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 rounded-lg text-sm text-red-700 dark:text-red-400">
          <AlertTriangle size={16} />{error}
          <button className="ml-auto" onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      {step === 1 && <Step1 form={form} onChange={setForm} onNext={() => setStep(2)} />}
      {step === 2 && <Step2 form={form} onBack={() => setStep(1)} onParsed={r => { setRows(r); setStep(3); }} />}
      {step === 3 && <Step3 form={form} rows={rows} onBack={() => setStep(2)} onConfirm={handleConfirm} />}

      <button onClick={onCancel} className="flex items-center gap-1.5 text-xs text-fg-subtle hover:text-fg-muted transition">
        <X size={13} /> Cancelar operação
      </button>
    </div>
  );
};

export default FullNewOperation;
