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
import { Card, Badge, Button } from '../ui';

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
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-fg-subtle hover:text-fg transition-colors">
        <ArrowLeft size={16} /> Voltar
      </button>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h2 className="text-title">Preparação da conferência</h2>
            <p className="text-sm text-fg-muted mt-1">
              NF {invoice.invoice_number ?? '—'} · Série {invoice.invoice_series ?? '—'} · {invoice.supplier_name ?? 'Fornecedor não informado'}
            </p>
            <p className="text-caption mt-1">Emissão {formatDate(invoice.issue_date)} · Chave {invoice.invoice_key}</p>
          </div>
          <div className="flex divide-x divide-edge">
            <Stat label="Itens" value={items.length} />
            <Stat label="Vinculados" value={linked} tone="success" />
            <Stat label="Pendentes" value={pending.length} tone={pending.length > 0 ? 'danger' : 'neutral'} />
          </div>
        </div>
      </Card>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400">
          <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-fg-subtle"><Loader2 size={28} className="animate-spin" /></div>
      ) : (
        <>
          {allLinked ? (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400">
              <Check size={20} /> <p className="text-sm font-semibold">Todos os itens estão vinculados. Você já pode iniciar a conferência.</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400">
              <AlertCircle size={20} />
              <p className="text-sm font-medium">
                Existem {pending.length} item(ns) não vinculados. Vincule todos os itens a um produto antes de iniciar.
              </p>
            </div>
          )}

          <div className="space-y-4">
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
            <div className="sticky bottom-0 bg-gradient-to-t from-surface via-surface to-transparent pt-4 pb-2">
              <Button
                disabled={!allLinked || starting}
                onClick={handleStart}
                className="w-full"
              >
                {starting ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
                Iniciar Conferência
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'success' | 'danger' }) {
  const color = tone === 'success' ? 'text-emerald-700 dark:text-emerald-400' : tone === 'danger' ? 'text-red-700 dark:text-red-400' : '';
  return (
    <div className="px-4 first:pl-0 last:pr-0 text-center">
      <p className={`text-display ${color}`}>{value}</p>
      <p className="text-caption mt-0.5">{label}</p>
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
    <Card>
      <div className="mb-4">
        <p className="font-semibold text-fg text-sm">{item.description || 'Sem descrição'}</p>
        <p className="text-xs text-fg-muted mt-0.5">
          Código NF: <span className="font-mono">{item.nfe_code || '—'}</span>
          {item.nfe_ean && <> · EAN: <span className="font-mono">{item.nfe_ean}</span></>}
        </p>
      </div>

      {suggestion && (
        <div className="flex flex-wrap items-center gap-2 mb-4 p-4 rounded-lg bg-accent/10 border border-accent/20">
          <Sparkles size={16} className="text-accent flex-shrink-0" />
          <p className="text-sm text-fg flex-1 min-w-[160px]">
            Esse produto é <span className="font-semibold">{suggestion.product.name}</span>?
            <span className="text-fg-muted"> (SKU {suggestion.product.sku})</span>
          </p>
          <Button size="sm" disabled={linking} onClick={() => doLink(suggestion.product)}>
            <Check size={13} /> Sim, vincular
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setRejectedSuggestion(true)}>
            <X size={13} /> Não, buscar manualmente
          </Button>
        </div>
      )}

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar produto por nome, SKU ou EAN..."
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-edge bg-surface text-fg text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </div>

      <div className="mt-2">
        {state === 'searching' && (
          <p className="flex items-center gap-2 text-xs text-fg-subtle py-2"><Loader2 size={13} className="animate-spin" /> Buscando...</p>
        )}
        {state === 'empty' && <p className="text-xs text-fg-subtle py-2">Nenhum resultado encontrado.</p>}
        {state === 'error' && (
          <button onClick={() => setTerm((t) => t + ' ')} className="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 py-2">
            <RefreshCw size={13} /> Erro na busca. Tentar novamente
          </button>
        )}
        {state === 'idle' && results.length > 0 && (
          <div className="divide-y divide-edge/60 border border-edge rounded-lg overflow-hidden">
            {results.map((p) => (
              <div key={p.id} className="flex items-center gap-2 p-3 hover:bg-surface-3/40 transition-colors">
                <Package size={16} className="text-fg-subtle flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">{p.name}</p>
                  <p className="text-xs text-fg-muted">
                    SKU {p.sku}{p.ean ? ` · EAN ${p.ean}` : ''}
                  </p>
                </div>
                {exactSkuMatch(p) && <Badge variant="success" className="text-[10px] px-1.5 py-0.5 flex-shrink-0">SKU exato</Badge>}
                {!exactSkuMatch(p) && exactEanMatch(p) && <Badge variant="success" className="text-[10px] px-1.5 py-0.5 flex-shrink-0">EAN exato</Badge>}
                <Button
                  size="sm"
                  disabled={linking}
                  onClick={() => doLink(p)}
                  className="flex-shrink-0"
                >
                  <Link2 size={12} /> Vincular
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 mt-4 text-xs text-fg-muted cursor-pointer select-none">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="rounded border-edge text-accent focus:ring-accent/40" />
        Memorizar associação para as próximas notas
      </label>
    </Card>
  );
}
