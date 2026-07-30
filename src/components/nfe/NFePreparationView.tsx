import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft, Loader2, AlertCircle, Search, Check, Link2, Sparkles, Play,
  Package, X, RefreshCw,
} from 'lucide-react';
import type { NfeInvoice, NfeInvoiceItem, CatalogProduct } from '../../lib/nfe/nfeTypes';
import {
  getInvoiceItems, searchCatalog, linkItemToProduct, rememberAssociation,
  startConference, fetchFullCatalog,
} from '../../lib/nfe/nfeService';
import { suggestByName, type NameSuggestion } from '../../lib/nfe/nfeAssociation';
import { formatDate } from './nfeUi';

interface Props {
  invoice: NfeInvoice;
  onStarted: () => void;
  onBack: () => void;
}

export function NFePreparationView({ invoice, onStarted, onBack }: Props) {
  const [items, setItems] = useState<NfeInvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getInvoiceItems(invoice.id);
      setItems(rows);
    } catch {
      setError('Não foi possível carregar os itens da NF-e.');
    } finally {
      setLoading(false);
    }
  }, [invoice.id]);

  useEffect(() => { load(); }, [load]);

  // Fetch the full catalog ONCE for name suggestions across all pending items.
  useEffect(() => {
    let active = true;
    fetchFullCatalog().then((c) => { if (active) setCatalog(c); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const pending = items.filter((i) => i.product_id == null);
  const linked = items.length - pending.length;
  const allLinked = items.length > 0 && pending.length === 0;

  async function handleLink(item: NfeInvoiceItem, product: CatalogProduct, remember: boolean) {
    await linkItemToProduct(item.id, product.id, 'manual');
    if (remember) {
      if (item.nfe_code?.trim()) {
        await rememberAssociation('sku', item.nfe_code.trim(), product.id).catch(() => {});
      } else if (item.nfe_ean_normalized) {
        await rememberAssociation('ean', item.nfe_ean_normalized, product.id).catch(() => {});
      }
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, product_id: product.id, link_method: 'manual' } : i)));
  }

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      await startConference(invoice.id);
      onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível iniciar a conferência.');
      setStarting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 transition-colors">
        <ArrowLeft size={16} /> Voltar
      </button>

      <div className="bg-white rounded-2xl border border-zinc-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">Preparação da conferência</h2>
            <p className="text-sm text-zinc-500 mt-0.5">
              NF {invoice.invoice_number ?? '—'} · Série {invoice.invoice_series ?? '—'} · {invoice.supplier_name ?? 'Fornecedor não informado'}
            </p>
            <p className="text-xs text-zinc-400 mt-0.5">Emissão {formatDate(invoice.issue_date)} · Chave {invoice.invoice_key}</p>
          </div>
          <div className="flex gap-2 text-center">
            <Stat label="Itens" value={items.length} />
            <Stat label="Vinculados" value={linked} tone="emerald" />
            <Stat label="Pendentes" value={pending.length} tone={pending.length > 0 ? 'red' : 'zinc'} />
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
          <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-400"><Loader2 size={28} className="animate-spin" /></div>
      ) : (
        <>
          {allLinked ? (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800">
              <Check size={20} /> <p className="text-sm font-semibold">Todos os itens estão vinculados. Você já pode iniciar a conferência.</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
              <AlertCircle size={20} />
              <p className="text-sm font-medium">
                Existem {pending.length} item(ns) não vinculados. Vincule todos os itens a um produto antes de iniciar.
              </p>
            </div>
          )}

          <div className="space-y-3">
            {pending.map((item) => (
              <PendingItemRow
                key={item.id}
                item={item}
                catalog={catalog}
                onLink={handleLink}
              />
            ))}
          </div>

          {items.length > 0 && (
            <div className="sticky bottom-0 bg-gradient-to-t from-zinc-50 via-zinc-50 to-transparent pt-4 pb-2">
              <button
                disabled={!allLinked || starting}
                onClick={handleStart}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {starting ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
                Iniciar Conferência
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'zinc' }: { label: string; value: number; tone?: 'zinc' | 'emerald' | 'red' }) {
  const color = tone === 'emerald' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : 'text-zinc-800';
  return (
    <div className="px-3 py-1.5 rounded-lg bg-zinc-50 border border-zinc-100 min-w-[72px]">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-zinc-400 font-semibold">{label}</p>
    </div>
  );
}

// ── Pending item association row ─────────────────────────────────────────────

interface RowProps {
  item: NfeInvoiceItem;
  catalog: CatalogProduct[] | null;
  onLink: (item: NfeInvoiceItem, product: CatalogProduct, remember: boolean) => Promise<void>;
}

function PendingItemRow({ item, catalog, onLink }: RowProps) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [state, setState] = useState<'idle' | 'searching' | 'empty' | 'error'>('idle');
  const [remember, setRemember] = useState(true);
  const [linking, setLinking] = useState(false);
  const [rejectedSuggestion, setRejectedSuggestion] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const reqRef = useRef(0);

  const suggestion: NameSuggestion | null = useMemo(() => {
    if (!catalog || rejectedSuggestion) return null;
    return suggestByName(item.description ?? '', catalog);
  }, [catalog, item.description, rejectedSuggestion]);

  useEffect(() => {
    if (term.trim() === '') { setResults([]); setState('idle'); return; }
    setState('searching');
    const id = ++reqRef.current;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const rows = await searchCatalog(term, 15);
        if (id !== reqRef.current) return; // a newer search superseded this one
        setResults(rows);
        setState(rows.length === 0 ? 'empty' : 'idle');
      } catch {
        if (id !== reqRef.current) return;
        setState('error');
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [term]);

  async function doLink(product: CatalogProduct) {
    setLinking(true);
    try {
      await onLink(item, product, remember);
    } finally {
      setLinking(false);
    }
  }

  const exactSkuMatch = (p: CatalogProduct) => item.nfe_code && p.sku && p.sku.trim() === item.nfe_code.trim();
  const exactEanMatch = (p: CatalogProduct) => item.nfe_ean_normalized && p.ean && p.ean.replace(/\D/g, '') === item.nfe_ean_normalized;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="font-semibold text-zinc-900 text-sm">{item.description || 'Sem descrição'}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Código NF: <span className="font-mono">{item.nfe_code || '—'}</span>
            {item.nfe_ean && <> · EAN: <span className="font-mono">{item.nfe_ean}</span></>}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200">
          Não vinculado
        </span>
      </div>

      {suggestion && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
          <Sparkles size={16} className="text-blue-600 flex-shrink-0" />
          <p className="text-xs text-blue-800 flex-1 min-w-[160px]">
            Esse produto é <span className="font-semibold">{suggestion.product.name}</span>?
            <span className="text-blue-500"> (SKU {suggestion.product.sku})</span>
          </p>
          <button
            disabled={linking}
            onClick={() => doLink(suggestion.product)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold disabled:opacity-50"
          >
            <Check size={13} /> Sim, vincular
          </button>
          <button
            onClick={() => setRejectedSuggestion(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-blue-200 text-blue-700 hover:bg-blue-100 text-xs font-semibold"
          >
            <X size={13} /> Não, buscar manualmente
          </button>
        </div>
      )}

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar produto por nome, SKU ou EAN..."
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      <div className="mt-2">
        {state === 'searching' && (
          <p className="flex items-center gap-2 text-xs text-zinc-400 py-2"><Loader2 size={13} className="animate-spin" /> Buscando...</p>
        )}
        {state === 'empty' && <p className="text-xs text-zinc-400 py-2">Nenhum resultado encontrado.</p>}
        {state === 'error' && (
          <button onClick={() => setTerm((t) => t + ' ')} className="inline-flex items-center gap-1.5 text-xs text-red-600 py-2">
            <RefreshCw size={13} /> Erro na busca. Tentar novamente
          </button>
        )}
        {state === 'idle' && results.length > 0 && (
          <div className="divide-y divide-zinc-100 border border-zinc-100 rounded-lg overflow-hidden">
            {results.map((p) => (
              <div key={p.id} className="flex items-center gap-2 p-2.5 hover:bg-zinc-50">
                <Package size={16} className="text-zinc-400 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-800 truncate">{p.name}</p>
                  <p className="text-xs text-zinc-500">
                    SKU {p.sku}{p.ean ? ` · EAN ${p.ean}` : ''}
                  </p>
                </div>
                {exactSkuMatch(p) && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">SKU exato</span>}
                {!exactSkuMatch(p) && exactEanMatch(p) && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">EAN exato</span>}
                <button
                  disabled={linking}
                  onClick={() => doLink(p)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex-shrink-0 disabled:opacity-50"
                >
                  <Link2 size={12} /> Vincular
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 mt-3 text-xs text-zinc-600 cursor-pointer select-none">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500" />
        Memorizar associação para as próximas notas
      </label>
    </div>
  );
}
