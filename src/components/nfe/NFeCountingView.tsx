import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft, Loader2, AlertCircle, Search, ScanLine, Plus, Minus, Check,
  Copy, CheckCheck, Flag, PackageCheck, PackageSearch,
} from 'lucide-react';
import type { NfeInvoice, NfeInvoiceItem, CatalogProduct } from '../../lib/nfe/nfeTypes';
import { getInvoiceItems, registerCount, finalizeConference } from '../../lib/nfe/nfeService';
import { supabase } from '../../lib/supabase';
import { normalizeEan, buildEanIndex } from '../../lib/nfe/nfeEanUtils';
import { formatQty } from './nfeUi';
import { Card, Button, Modal } from '../ui';
import { useAuth } from '../../lib/auth';
import { RcaClassificationModal, PendingRcaItem } from '../rca/RcaClassificationModal';

interface Props {
  invoice: NfeInvoice;
  onFinalized: () => void;
  onBack: () => void;
}

type Filter = 'all' | 'pending' | 'done';

export function NFeCountingView({ invoice, onFinalized, onBack }: Props) {
  const { companyId, profile } = useAuth();
  const [items, setItems] = useState<NfeInvoiceItem[]>([]);
  const [pendingRcaItems, setPendingRcaItems] = useState<PendingRcaItem[]>([]);
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
  const [duplicateCandidates, setDuplicateCandidates] = useState<NfeInvoiceItem[] | null>(null);
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

  const eanIndex = useMemo(() => buildEanIndex(items, products), [items, products]);

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
    const candidates = eanIndex.get(code);
    if (!candidates || candidates.length === 0) {
      setScanFeedback({ type: 'err', msg: `EAN ${code} não pertence a esta nota.` });
      return;
    }
    if (candidates.length > 1) {
      setDuplicateCandidates(candidates);
      return;
    }
    const item = candidates[0];
    const ok = await applyCount(item, 'increment', 1, 'scanner');
    if (ok) setScanFeedback({ type: 'ok', msg: `+1 · ${item.description || item.nfe_code}` });
  }

  async function handleSelectDuplicate(item: NfeInvoiceItem) {
    setDuplicateCandidates(null);
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

      // RCA — recebimento com falta/sobra exige causa antes de fechar a conferência.
      const finalItems = await getInvoiceItems(invoice.id);
      const divergentItems = finalItems.filter((it) => it.result_status === 'missing' || it.result_status === 'surplus');
      if (divergentItems.length > 0) {
        setPendingRcaItems(divergentItems.map((it) => {
          const prod = it.product_id ? products.get(it.product_id) : null;
          return {
            sourceItemId: it.id,
            productId: it.product_id,
            sku: it.snapshot_sku ?? prod?.sku ?? null,
            productName: it.snapshot_product_name ?? it.description ?? prod?.name ?? null,
            location: prod?.location ?? null,
            operatorUserId: null,
            operatorName: null,
            supplierName: invoice.supplier_name,
            supplierCnpj: invoice.supplier_cnpj,
            divergenceQty: (it.physical_quantity ?? 0) - it.expected_quantity,
          };
        }));
        setFinalizing(false);
        return;
      }

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
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-fg-subtle hover:text-fg transition-colors">
        <ArrowLeft size={16} /> Voltar
      </button>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-title">Conferência cega</h2>
            <p className="text-sm text-fg-muted mt-0.5">
              NF {invoice.invoice_number ?? '—'} · {invoice.supplier_name ?? 'Fornecedor não informado'}
            </p>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-surface-3 text-center">
            <p className="text-xl font-bold text-fg">{doneCount}<span className="text-fg-subtle text-sm">/{items.length}</span></p>
            <p className="text-caption">Conferidos</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-fg-subtle bg-surface-3 rounded-lg px-3 py-2">
          As quantidades da nota estão ocultas. Você verá apenas o que registrar fisicamente.
        </p>
      </Card>

      {/* Scanner */}
      <Card>
        <label className="flex items-center gap-2 text-sm font-semibold text-fg mb-2">
          <ScanLine size={16} className="text-accent" /> Leitor de código de barras
        </label>
        <input
          ref={scanRef}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } }}
          placeholder="Foque aqui e escaneie ou digite o EAN, depois Enter"
          className="w-full px-3 py-2.5 rounded-lg border border-edge bg-surface text-fg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          autoFocus
        />
        {scanFeedback && (
          <p className={`mt-2 text-xs font-medium flex items-center gap-1.5 ${scanFeedback.type === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {scanFeedback.type === 'ok' ? <CheckCheck size={14} /> : <AlertCircle size={14} />} {scanFeedback.msg}
          </p>
        )}
      </Card>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 text-red-700 dark:text-red-400">
          <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-surface-3 rounded-lg p-1">
          {([['all', 'Todos'], ['pending', 'Pendentes'], ['done', 'Conferidos']] as [Filter, string][]).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${filter === f ? 'bg-surface-2 text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar item..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-edge bg-surface text-fg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-fg-subtle"><Loader2 size={28} className="animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {visible.map((it) => {
            const prod = it.product_id ? products.get(it.product_id) : null;
            const ean = displayEan(it);
            return (
              <Card key={it.id} padding="sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-fg text-sm flex items-center gap-1.5">
                      {it.physical_quantity != null
                        ? <PackageCheck size={15} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                        : <PackageSearch size={15} className="text-fg-subtle flex-shrink-0" />}
                      {it.description || prod?.name || 'Sem descrição'}
                    </p>
                    <p className="text-xs text-fg-muted mt-0.5">
                      SKU <span className="font-mono">{prod?.sku ?? it.nfe_code ?? '—'}</span>
                      {ean && (
                        <> · EAN <span className="font-mono">{ean}</span>
                          <button onClick={() => copyEan(it)} className="ml-1 inline-flex items-center text-fg-subtle hover:text-accent align-middle">
                            {copiedId === it.id ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="text-center flex-shrink-0">
                    <p className="text-2xl font-bold text-fg leading-none">{it.physical_quantity != null ? formatQty(it.physical_quantity) : '0'}</p>
                    <p className="text-caption mt-0.5">Físico</p>
                  </div>
                </div>
                <CountControls onIncrement={(d) => applyCount(it, 'increment', d, 'manual')} onSet={(v) => applyCount(it, 'set', v, 'manual')} />
              </Card>
            );
          })}
          {visible.length === 0 && <p className="text-center text-sm text-fg-subtle py-10">Nenhum item nesta lista.</p>}
        </div>
      )}

      <div className="sticky bottom-0 bg-gradient-to-t from-surface via-surface to-transparent pt-4 pb-2">
        <Button onClick={() => setShowFinalize(true)} className="w-full">
          <Flag size={18} /> Finalizar Conferência
        </Button>
      </div>

      <Modal open={!!duplicateCandidates} onClose={() => setDuplicateCandidates(null)} title="Este código aparece em mais de um item" maxWidth="max-w-md">
        <p className="text-sm text-fg-muted -mt-2 mb-4">Selecione a linha da nota correspondente ao produto em mãos.</p>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {(duplicateCandidates ?? []).map((it) => {
            const prod = it.product_id ? products.get(it.product_id) : null;
            return (
              <button
                key={it.id}
                onClick={() => handleSelectDuplicate(it)}
                className="w-full text-left p-3 rounded-lg border border-edge hover:border-accent/40 hover:bg-accent/5 transition-colors"
              >
                <p className="font-semibold text-fg text-sm">{it.description || prod?.name || 'Sem descrição'}</p>
                <p className="text-xs text-fg-muted mt-0.5">
                  SKU <span className="font-mono">{prod?.sku ?? it.nfe_code ?? '—'}</span>
                  {it.line_number != null && <> · Linha {it.line_number}</>}
                </p>
              </button>
            );
          })}
        </div>
        <Button variant="secondary" onClick={() => setDuplicateCandidates(null)} className="w-full mt-4">
          Cancelar
        </Button>
      </Modal>

      <Modal open={showFinalize} onClose={() => setShowFinalize(false)} title="Finalizar conferência?" maxWidth="max-w-md">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Mini label="SKUs" value={items.length} />
          <Mini label="Conferidos" value={doneCount} tone="emerald" />
          <Mini label="Não conferidos" value={items.length - doneCount} tone={items.length - doneCount > 0 ? 'amber' : 'neutral'} />
        </div>
        <p className="mt-4 text-sm text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-lg p-3">
          Ao finalizar, as quantidades da nota serão reveladas e comparadas com a contagem física. Esta ação encerra a conferência.
        </p>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => setShowFinalize(false)} className="flex-1">Cancelar</Button>
          <Button disabled={finalizing} onClick={handleFinalize} className="flex-1">
            {finalizing ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Confirmar
          </Button>
        </div>
      </Modal>

      {profile && companyId && (
        <RcaClassificationModal
          open={pendingRcaItems.length > 0}
          sourceModule="nfe_receiving"
          items={pendingRcaItems}
          companyId={companyId}
          userId={profile.id}
          userEmail={profile.email ?? ''}
          onDone={() => { setPendingRcaItems([]); onFinalized(); }}
        />
      )}
    </div>
  );
}

function Mini({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'emerald' | 'amber' }) {
  const color = tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-fg';
  return (
    <div className="px-2 py-2 rounded-lg bg-surface-3">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-caption">{label}</p>
    </div>
  );
}

function CountControls({ onIncrement, onSet }: { onIncrement: (delta: number) => void; onSet: (value: number) => void }) {
  const [manual, setManual] = useState('');
  return (
    <div className="flex items-center gap-2 mt-3">
      <button onClick={() => onIncrement(-1)} className="p-2 rounded-lg border border-edge text-fg-muted hover:bg-surface-3" aria-label="Diminuir">
        <Minus size={16} />
      </button>
      <button onClick={() => onIncrement(1)} className="p-2 rounded-lg bg-accent hover:bg-accent-strong text-white" aria-label="Aumentar">
        <Plus size={16} />
      </button>
      <div className="flex items-center gap-1.5 ml-auto">
        <input
          type="number"
          min={0}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Qtd"
          className="w-20 px-2 py-1.5 rounded-lg border border-edge bg-surface text-fg text-sm text-right focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <button
          onClick={() => { const v = Number(manual); if (Number.isFinite(v) && v >= 0) { onSet(v); setManual(''); } }}
          disabled={manual.trim() === ''}
          className="px-3 py-1.5 rounded-lg bg-surface-3 hover:bg-edge text-fg text-xs font-semibold disabled:opacity-40"
        >
          Confirmar
        </button>
      </div>
    </div>
  );
}
