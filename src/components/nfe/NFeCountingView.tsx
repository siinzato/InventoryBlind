import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft, Loader2, AlertCircle, Search, ScanLine, Plus, Minus, Check,
  Copy, CheckCheck, Flag, PackageCheck, PackageSearch,
} from 'lucide-react';
import type { NfeInvoice, NfeInvoiceItem, CatalogProduct } from '../../lib/nfe/nfeTypes';
import { getInvoiceItems, registerCount, finalizeConference } from '../../lib/nfe/nfeService';
import { supabase } from '../../lib/supabase';
import { normalizeEan } from '../../lib/nfe/nfeEanUtils';
import { formatQty } from './nfeUi';

interface Props {
  invoice: NfeInvoice;
  onFinalized: () => void;
  onBack: () => void;
}

type Filter = 'all' | 'pending' | 'done';

export function NFeCountingView({ invoice, onFinalized, onBack }: Props) {
  const [items, setItems] = useState<NfeInvoiceItem[]>([]);
  const [products, setProducts] = useState<Map<string, CatalogProduct>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState('');
  const [scanFeedback, setScanFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showFinalize, setShowFinalize] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getInvoiceItems(invoice.id);
      setItems(rows);
      const ids = [...new Set(rows.map((r) => r.product_id).filter((x): x is string => !!x))];
      if (ids.length > 0) {
        const { data } = await supabase.from('products').select('id, name, sku, ean, location').in('id', ids);
        const map = new Map<string, CatalogProduct>();
        for (const p of (data ?? []) as CatalogProduct[]) map.set(p.id, p);
        setProducts(map);
      }
    } catch {
      setError('Não foi possível carregar os itens.');
    } finally {
      setLoading(false);
    }
  }, [invoice.id]);

  useEffect(() => { load(); }, [load]);

  const eanIndex = useMemo(() => {
    const idx = new Map<string, NfeInvoiceItem>();
    for (const it of items) {
      if (it.nfe_ean_normalized) idx.set(it.nfe_ean_normalized, it);
      const prod = it.product_id ? products.get(it.product_id) : null;
      const pen = normalizeEan(prod?.ean);
      if (pen && !idx.has(pen)) idx.set(pen, it);
    }
    return idx;
  }, [items, products]);

  function displayEan(it: NfeInvoiceItem): string | null {
    if (it.nfe_ean) return it.nfe_ean;
    const prod = it.product_id ? products.get(it.product_id) : null;
    return prod?.ean ?? null;
  }

  async function applyCount(item: NfeInvoiceItem, mode: 'increment' | 'set', quantity: number, source: 'scanner' | 'manual') {
    const key = crypto.randomUUID();
    const prod = item.product_id ? products.get(item.product_id) : null;
    try {
      const newQty = await registerCount({
        itemId: item.id,
        mode,
        quantity,
        source,
        idempotencyKey: key,
        ean: displayEan(item),
        sku: prod?.sku ?? item.nfe_code,
      });
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, physical_quantity: newQty } : i)));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao registrar contagem.');
      return false;
    }
  }

  async function handleScan() {
    const code = normalizeEan(scan);
    setScan('');
    if (!code) {
      setScanFeedback({ type: 'err', msg: 'Código inválido.' });
      return;
    }
    const item = eanIndex.get(code);
    if (!item) {
      setScanFeedback({ type: 'err', msg: `EAN ${code} não pertence a esta nota.` });
      return;
    }
    const ok = await applyCount(item, 'increment', 1, 'scanner');
    if (ok) setScanFeedback({ type: 'ok', msg: `+1 · ${item.description || item.nfe_code}` });
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (filter === 'pending' && it.physical_quantity != null) return false;
      if (filter === 'done' && it.physical_quantity == null) return false;
      if (q === '') return true;
      const prod = it.product_id ? products.get(it.product_id) : null;
      return (
        (it.description ?? '').toLowerCase().includes(q) ||
        (it.nfe_code ?? '').toLowerCase().includes(q) ||
        (displayEan(it) ?? '').toLowerCase().includes(q) ||
        (prod?.sku ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, filter, search, products]);

  const doneCount = items.filter((i) => i.physical_quantity != null).length;

  async function handleFinalize() {
    setFinalizing(true);
    setError(null);
    try {
      await finalizeConference(invoice.id);
      onFinalized();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível finalizar.');
      setFinalizing(false);
    }
  }

  function copyEan(it: NfeInvoiceItem) {
    const ean = displayEan(it);
    if (!ean) return;
    navigator.clipboard?.writeText(ean).then(() => {
      setCopiedId(it.id);
      setTimeout(() => setCopiedId((c) => (c === it.id ? null : c)), 1500);
    }).catch(() => {});
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 transition-colors">
        <ArrowLeft size={16} /> Voltar
      </button>

      <div className="bg-white rounded-2xl border border-zinc-200 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">Conferência cega</h2>
            <p className="text-sm text-zinc-500 mt-0.5">
              NF {invoice.invoice_number ?? '—'} · {invoice.supplier_name ?? 'Fornecedor não informado'}
            </p>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-zinc-50 border border-zinc-100 text-center">
            <p className="text-xl font-bold text-zinc-800">{doneCount}<span className="text-zinc-400 text-sm">/{items.length}</span></p>
            <p className="text-[10px] uppercase tracking-wide text-zinc-400 font-semibold">Conferidos</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-400 bg-zinc-50 rounded-lg px-3 py-2 border border-zinc-100">
          As quantidades da nota estão ocultas. Você verá apenas o que registrar fisicamente.
        </p>
      </div>

      {/* Scanner */}
      <div className="bg-white rounded-2xl border border-zinc-200 p-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-2">
          <ScanLine size={16} className="text-emerald-600" /> Leitor de código de barras
        </label>
        <input
          ref={scanRef}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } }}
          placeholder="Foque aqui e escaneie ou digite o EAN, depois Enter"
          className="w-full px-3 py-2.5 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          autoFocus
        />
        {scanFeedback && (
          <p className={`mt-2 text-xs font-medium flex items-center gap-1.5 ${scanFeedback.type === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
            {scanFeedback.type === 'ok' ? <CheckCheck size={14} /> : <AlertCircle size={14} />} {scanFeedback.msg}
          </p>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
          <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-zinc-100 rounded-lg p-1">
          {([['all', 'Todos'], ['pending', 'Pendentes'], ['done', 'Conferidos']] as [Filter, string][]).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${filter === f ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar item..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-400"><Loader2 size={28} className="animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {visible.map((it) => {
            const prod = it.product_id ? products.get(it.product_id) : null;
            const ean = displayEan(it);
            return (
              <div key={it.id} className="bg-white rounded-xl border border-zinc-200 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-zinc-900 text-sm flex items-center gap-1.5">
                      {it.physical_quantity != null
                        ? <PackageCheck size={15} className="text-emerald-500 flex-shrink-0" />
                        : <PackageSearch size={15} className="text-zinc-300 flex-shrink-0" />}
                      {it.description || prod?.name || 'Sem descrição'}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      SKU <span className="font-mono">{prod?.sku ?? it.nfe_code ?? '—'}</span>
                      {ean && (
                        <> · EAN <span className="font-mono">{ean}</span>
                          <button onClick={() => copyEan(it)} className="ml-1 inline-flex items-center text-zinc-400 hover:text-emerald-600 align-middle">
                            {copiedId === it.id ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="text-center flex-shrink-0">
                    <p className="text-2xl font-bold text-zinc-900 leading-none">{it.physical_quantity != null ? formatQty(it.physical_quantity) : '0'}</p>
                    <p className="text-[10px] uppercase tracking-wide text-zinc-400 font-semibold mt-0.5">Físico</p>
                  </div>
                </div>
                <CountControls onIncrement={(d) => applyCount(it, 'increment', d, 'manual')} onSet={(v) => applyCount(it, 'set', v, 'manual')} />
              </div>
            );
          })}
          {visible.length === 0 && <p className="text-center text-sm text-zinc-400 py-10">Nenhum item nesta lista.</p>}
        </div>
      )}

      <div className="sticky bottom-0 bg-gradient-to-t from-zinc-50 via-zinc-50 to-transparent pt-4 pb-2">
        <button
          onClick={() => setShowFinalize(true)}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-semibold transition-colors"
        >
          <Flag size={18} /> Finalizar Conferência
        </button>
      </div>

      {showFinalize && (
        <div className="fixed inset-0 z-[950] bg-zinc-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5">
            <h3 className="text-lg font-bold text-zinc-900">Finalizar conferência?</h3>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Mini label="SKUs" value={items.length} />
              <Mini label="Conferidos" value={doneCount} tone="emerald" />
              <Mini label="Não conferidos" value={items.length - doneCount} tone={items.length - doneCount > 0 ? 'amber' : 'zinc'} />
            </div>
            <p className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Ao finalizar, as quantidades da nota serão reveladas e comparadas com a contagem física. Esta ação encerra a conferência.
            </p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowFinalize(false)} className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-200 text-zinc-700 font-semibold hover:bg-zinc-50">Cancelar</button>
              <button
                disabled={finalizing}
                onClick={handleFinalize}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-50"
              >
                {finalizing ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, tone = 'zinc' }: { label: string; value: number; tone?: 'zinc' | 'emerald' | 'amber' }) {
  const color = tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-zinc-800';
  return (
    <div className="px-2 py-2 rounded-lg bg-zinc-50 border border-zinc-100">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-zinc-400 font-semibold">{label}</p>
    </div>
  );
}

function CountControls({ onIncrement, onSet }: { onIncrement: (delta: number) => void; onSet: (value: number) => void }) {
  const [manual, setManual] = useState('');
  return (
    <div className="flex items-center gap-2 mt-3">
      <button onClick={() => onIncrement(-1)} className="p-2 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 active:bg-zinc-100" aria-label="Diminuir">
        <Minus size={16} />
      </button>
      <button onClick={() => onIncrement(1)} className="p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white active:bg-emerald-700" aria-label="Aumentar">
        <Plus size={16} />
      </button>
      <div className="flex items-center gap-1.5 ml-auto">
        <input
          type="number"
          min={0}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Qtd"
          className="w-20 px-2 py-1.5 rounded-lg border border-zinc-200 text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          onClick={() => { const v = Number(manual); if (Number.isFinite(v) && v >= 0) { onSet(v); setManual(''); } }}
          disabled={manual.trim() === ''}
          className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold disabled:opacity-40"
        >
          Confirmar
        </button>
      </div>
    </div>
  );
}
