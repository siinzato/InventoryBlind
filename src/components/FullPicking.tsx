import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  ArrowRight, Check, X, SkipForward, AlertTriangle,
  ChevronLeft, RefreshCw, Package, MapPin,
} from 'lucide-react';
import type { FullOperation, FullOperationItem } from '../lib/fullManagerTypes';
import { STATUS_LABEL, STATUS_COLOR, ITEM_STATUS_LABEL, ITEM_STATUS_COLOR } from '../lib/fullManagerTypes';

// ── Operation selector ────────────────────────────────────────────────────────

const OpSelector: React.FC<{ operations: FullOperation[]; onSelect: (op: FullOperation) => void; loading: boolean }> = ({ operations, onSelect, loading }) => (
  <div className="space-y-3">
    <p className="text-sm text-zinc-500 font-medium">
      Selecione uma operação para iniciar ou continuar a separação:
    </p>
    {loading ? (
      <div className="flex items-center justify-center py-16 gap-2 text-zinc-400">
        <RefreshCw size={18} className="animate-spin" /> Carregando...
      </div>
    ) : operations.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-16 bg-white rounded-xl border border-zinc-200 text-zinc-300">
        <Package size={40} className="mb-3 opacity-30" />
        <p className="text-sm font-medium">Nenhuma operação em separação.</p>
        <p className="text-xs mt-1">Crie uma nova operação ou mude o status para "Preparando".</p>
      </div>
    ) : (
      operations.map(op => {
        const tagCls = STATUS_COLOR[op.status];
        return (
          <button key={op.id} onClick={() => onSelect(op)}
            className="w-full flex items-center gap-4 p-4 bg-white border border-zinc-200 rounded-xl hover:border-zinc-300 hover:bg-zinc-50 transition text-left shadow-sm">
            <div className="flex-1 min-w-0">
              <p className="font-black text-zinc-900">FULL #{op.full_number}</p>
              <p className="text-sm text-zinc-500">{op.marketplace} · {op.responsible || '—'}</p>
              <div className="flex gap-3 mt-1 text-xs text-zinc-500">
                <span className="font-mono font-bold">{op.total_sku} SKU</span>
                <span className="font-mono font-bold">{op.total_pieces} peças</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${tagCls}`}>
                {STATUS_LABEL[op.status]}
              </span>
              <ArrowRight size={16} className="text-zinc-400" />
            </div>
          </button>
        );
      })
    )}
  </div>
);

// ── Picking card ──────────────────────────────────────────────────────────────

const PickingCard: React.FC<{
  item: FullOperationItem;
  index: number;
  total: number;
  progress: number;
  onAction: (status: 'picked' | 'not_found' | 'picking_error' | 'skipped', qty?: number) => Promise<void>;
}> = ({ item, index, total, progress, onAction }) => {
  const [actioning, setActioning] = useState(false);
  const [qty, setQty] = useState(item.quantity_requested);

  const act = async (s: Parameters<typeof onAction>[0]) => {
    setActioning(true);
    try { await onAction(s, qty); } finally { setActioning(false); }
  };

  return (
    <div className="max-w-sm mx-auto w-full space-y-4">
      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-xs text-zinc-500 mb-1.5">
          <span>Item {index + 1} de {total}</span>
          <span className="font-bold text-zinc-700">{progress}% concluído</span>
        </div>
        <div className="w-full bg-zinc-100 rounded-full h-2">
          <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Main card */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-lg overflow-hidden">
        {/* Location banner */}
        <div className="bg-zinc-900 text-white px-5 py-4 flex items-center gap-3">
          <MapPin size={20} className="text-emerald-400 flex-shrink-0" />
          <div>
            <p className="text-xs text-zinc-400 uppercase font-bold tracking-wider">Localização</p>
            <p className="font-black text-2xl leading-tight">{item.location || '—'}</p>
          </div>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Product name */}
          <p className="font-bold text-zinc-800 text-base leading-snug">{item.product_name || '—'}</p>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-zinc-50 rounded-lg p-3">
              <p className="text-xs text-zinc-400 font-semibold uppercase">SKU</p>
              <p className="font-mono font-bold text-zinc-800 text-sm mt-0.5">{item.sku || '—'}</p>
            </div>
            <div className="bg-zinc-50 rounded-lg p-3">
              <p className="text-xs text-zinc-400 font-semibold uppercase">EAN</p>
              <p className="font-mono font-bold text-zinc-800 text-sm mt-0.5">{item.ean || '—'}</p>
            </div>
          </div>

          {/* Quantity */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-emerald-600 font-bold uppercase">Quantidade Solicitada</p>
              <p className="font-black text-emerald-800 text-3xl leading-none mt-0.5">{item.quantity_requested}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <p className="text-xs text-zinc-500">Qtd coletada:</p>
              <input type="number" min="0" max={item.quantity_requested * 2} value={qty}
                onChange={e => setQty(Number(e.target.value))}
                className="w-20 text-right px-2 py-1 border border-emerald-200 rounded-lg text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button disabled={actioning} onClick={() => act('picked')}
          className="flex items-center justify-center gap-2 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition disabled:opacity-60">
          {actioning ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />}
          Separado
        </button>
        <button disabled={actioning} onClick={() => act('not_found')}
          className="flex items-center justify-center gap-2 py-3.5 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold text-sm transition disabled:opacity-60">
          <X size={16} /> Não encontrado
        </button>
        <button disabled={actioning} onClick={() => act('picking_error')}
          className="flex items-center justify-center gap-2 py-3.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-semibold text-sm transition disabled:opacity-60">
          <AlertTriangle size={16} /> Qtd insuficiente
        </button>
        <button disabled={actioning} onClick={() => act('skipped')}
          className="flex items-center justify-center gap-2 py-3.5 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 rounded-xl font-semibold text-sm transition disabled:opacity-60">
          <SkipForward size={16} /> Pular
        </button>
      </div>
    </div>
  );
};

// ── Summary after picking ─────────────────────────────────────────────────────

const PickingSummary: React.FC<{
  operation: FullOperation;
  items: FullOperationItem[];
  onFinish: () => void;
  onSendToChecking: () => Promise<void>;
}> = ({ operation, items, onFinish, onSendToChecking }) => {
  const [sending, setSending] = useState(false);
  const picked = items.filter(i => i.status === 'picked').length;
  const errors = items.filter(i => ['not_found', 'picking_error', 'skipped'].includes(i.status)).length;

  const send = async () => { setSending(true); try { await onSendToChecking(); } finally { setSending(false); } };

  return (
    <div className="max-w-sm mx-auto space-y-4">
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-lg p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
          <Check size={28} className="text-emerald-600" />
        </div>
        <h3 className="font-black text-zinc-900 text-xl mb-1">Separação Concluída!</h3>
        <p className="text-zinc-500 text-sm">FULL #{operation.full_number}</p>
        <div className="grid grid-cols-2 gap-3 mt-5">
          <div className="bg-emerald-50 rounded-xl p-3">
            <p className="text-2xl font-black text-emerald-700">{picked}</p>
            <p className="text-xs text-emerald-600 font-semibold">Separados</p>
          </div>
          <div className="bg-red-50 rounded-xl p-3">
            <p className="text-2xl font-black text-red-600">{errors}</p>
            <p className="text-xs text-red-500 font-semibold">Com erro</p>
          </div>
        </div>
      </div>
      <button onClick={send} disabled={sending}
        className="w-full flex items-center justify-center gap-2 py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-bold text-sm transition disabled:opacity-60">
        {sending ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} />}
        Enviar para Conferência
      </button>
      <button onClick={onFinish}
        className="w-full py-2.5 border border-zinc-200 text-zinc-600 rounded-xl font-semibold text-sm hover:bg-zinc-50 transition">
        Voltar ao início
      </button>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

interface FullPickingProps {
  initialOperationId?: string;
  onDone: () => void;
}

const FullPicking: React.FC<FullPickingProps> = ({ initialOperationId, onDone }) => {
  const [operations, setOperations] = useState<FullOperation[]>([]);
  const [loadingOps, setLoadingOps] = useState(true);
  const [selectedOp, setSelectedOp] = useState<FullOperation | null>(null);
  const [items, setItems] = useState<FullOperationItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [done, setDone] = useState(false);

  const loadOperations = useCallback(async () => {
    setLoadingOps(true);
    const { data } = await supabase
      .from('full_operations')
      .select('id, company_id, full_number, marketplace, responsible, scheduled_date, scheduled_time, status, total_sku, total_pieces, notes, checker, checker_notes, checked_at, completed_at, created_at, updated_at')
      .in('status', ['preparing', 'picking'])
      .order('created_at', { ascending: false })
      .limit(50);
    const ops = (data as FullOperation[]) || [];
    setOperations(ops);
    setLoadingOps(false);

    if (initialOperationId) {
      const found = ops.find(o => o.id === initialOperationId);
      if (found) loadOperation(found);
    }
  }, [initialOperationId]);

  useEffect(() => { loadOperations(); }, [loadOperations]);

  const loadOperation = async (op: FullOperation) => {
    setSelectedOp(op);
    setLoadingItems(true);
    setDone(false);
    setCurrentIdx(0);

    // Set status to picking
    await supabase.from('full_operations').update({ status: 'picking' }).eq('id', op.id);

    // Load items sorted by location
    const { data } = await supabase
      .from('full_operation_items')
      .select('id, operation_id, company_id, listing_id, product_id, sku, ean, product_name, location, quantity_requested, quantity_picked, status, picker_notes, picked_at, created_at')
      .eq('operation_id', op.id)
      .order('location', { ascending: true, nullsFirst: false });

    const allItems = (data as FullOperationItem[]) || [];
    setItems(allItems);
    setLoadingItems(false);

    // Find first pending item
    const firstPending = allItems.findIndex(i => i.status === 'found' || i.status === 'no_location' || i.status === 'insufficient_stock');
    setCurrentIdx(firstPending >= 0 ? firstPending : 0);
    if (firstPending < 0 && allItems.length > 0) setDone(true);
  };

  const handleAction = async (
    status: 'picked' | 'not_found' | 'picking_error' | 'skipped',
    qty?: number
  ) => {
    const item = pendingItems[currentIdx - doneCount];
    if (!item) return;

    const update: Partial<FullOperationItem> = {
      status,
      quantity_picked: status === 'picked' ? (qty ?? item.quantity_requested) : 0,
      picked_at: new Date().toISOString(),
    };

    await supabase.from('full_operation_items').update(update).eq('id', item.id);
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...update } : i));

    // Check if all done
    const next = items.filter(i =>
      (i.id !== item.id) && (i.status === 'found' || i.status === 'no_location' || i.status === 'insufficient_stock')
    );
    if (next.length === 0) { setDone(true); return; }
    setCurrentIdx(c => c + 1);
  };

  const handleSendToChecking = async () => {
    if (!selectedOp) return;
    await supabase.from('full_operations').update({ status: 'checking' }).eq('id', selectedOp.id);
    onDone();
  };

  // Progress calculation
  const pendingItems = items.filter(i => i.status === 'found' || i.status === 'no_location' || i.status === 'insufficient_stock');
  const doneItems = items.filter(i => ['picked', 'not_found', 'picking_error', 'skipped'].includes(i.status));
  const doneCount = doneItems.length;
  const progress = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  if (!selectedOp) {
    return <OpSelector operations={operations} onSelect={loadOperation} loading={loadingOps} />;
  }

  if (loadingItems) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-zinc-400">
        <RefreshCw size={20} className="animate-spin" /> Carregando itens e ordenando por localização...
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <button onClick={() => { setSelectedOp(null); setDone(false); }}
          className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-800 transition">
          <ChevronLeft size={16} /> Voltar
        </button>
        <PickingSummary
          operation={selectedOp}
          items={items}
          onFinish={onDone}
          onSendToChecking={handleSendToChecking}
        />
      </div>
    );
  }

  const currentItem = pendingItems[0]; // always show first pending
  if (!currentItem) {
    return (
      <div className="text-center py-16 text-zinc-400">
        <p>Nenhum item pendente encontrado.</p>
        <button onClick={() => setSelectedOp(null)} className="mt-4 text-sm text-zinc-600 underline">Voltar</button>
      </div>
    );
  }

  const displayIdx = doneCount;

  return (
    <div className="space-y-4">
      {/* Op header */}
      <div className="flex items-center gap-3">
        <button onClick={() => setSelectedOp(null)} className="text-zinc-400 hover:text-zinc-700">
          <ChevronLeft size={20} />
        </button>
        <div>
          <p className="font-black text-zinc-900">FULL #{selectedOp.full_number}</p>
          <p className="text-xs text-zinc-500">{selectedOp.marketplace} · {selectedOp.responsible || '—'}</p>
        </div>
        <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full border bg-orange-100 text-orange-700 border-orange-200">
          Separando
        </span>
      </div>

      <PickingCard
        item={currentItem}
        index={displayIdx}
        total={items.length}
        progress={progress}
        onAction={handleAction}
      />
    </div>
  );
};

export default FullPicking;
