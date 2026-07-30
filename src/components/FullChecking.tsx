import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  RefreshCw, Check, ChevronLeft, AlertTriangle, ClipboardCheck, User,
} from 'lucide-react';
import type { FullOperation, FullOperationItem } from '../lib/fullManagerTypes';
import { STATUS_LABEL, STATUS_COLOR, ITEM_STATUS_LABEL, ITEM_STATUS_COLOR } from '../lib/fullManagerTypes';

// ── Operation selector ────────────────────────────────────────────────────────

const CheckingSelector: React.FC<{
  operations: FullOperation[];
  loading: boolean;
  onSelect: (op: FullOperation) => void;
}> = ({ operations, loading, onSelect }) => (
  <div className="space-y-3">
    <p className="text-sm text-zinc-500 font-medium">
      Selecione uma operação para conferência:
    </p>
    {loading ? (
      <div className="flex items-center justify-center py-16 gap-2 text-zinc-400">
        <RefreshCw size={18} className="animate-spin" /> Carregando...
      </div>
    ) : operations.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-16 bg-white rounded-xl border border-zinc-200 text-zinc-300">
        <ClipboardCheck size={40} className="mb-3 opacity-30" />
        <p className="text-sm font-medium">Nenhuma operação aguardando conferência.</p>
        <p className="text-xs mt-1">Operações precisam estar no status "Conferência".</p>
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
                <span>{op.total_sku} SKU · {op.total_pieces} peças</span>
              </div>
            </div>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full border flex-shrink-0 ${tagCls}`}>
              {STATUS_LABEL[op.status]}
            </span>
          </button>
        );
      })
    )}
  </div>
);

// ── Checking form ─────────────────────────────────────────────────────────────

const CheckingForm: React.FC<{
  operation: FullOperation;
  items: FullOperationItem[];
  onBack: () => void;
  onComplete: () => void;
}> = ({ operation, items, onBack, onComplete }) => {
  const [checker, setChecker] = useState('');
  const [notes, setNotes] = useState('');
  const [divergences, setDivergences] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const picked = items.filter(i => i.status === 'picked');
  const errors = items.filter(i => ['not_found', 'picking_error', 'skipped'].includes(i.status));
  const totalPicked = picked.reduce((s, i) => s + i.quantity_picked, 0);
  const totalRequested = items.reduce((s, i) => s + i.quantity_requested, 0);
  const accuracy = totalRequested > 0 ? Math.round((totalPicked / totalRequested) * 100) : 0;

  const handleSave = async (status: 'completed' | 'checking') => {
    if (status === 'completed' && !checker.trim()) {
      setError('Informe o nome do conferente.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const update: Partial<FullOperation> = {
        status,
        checker: checker.trim() || null,
        checker_notes: notes.trim() || null,
        checked_at: new Date().toISOString(),
      };
      if (status === 'completed') update.completed_at = new Date().toISOString();
      const { error: err } = await supabase.from('full_operations').update(update).eq('id', operation.id);
      if (err) throw err;
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Op header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-zinc-400 hover:text-zinc-700">
          <ChevronLeft size={20} />
        </button>
        <div>
          <p className="font-black text-zinc-900">FULL #{operation.full_number}</p>
          <p className="text-xs text-zinc-500">{operation.marketplace} · {operation.responsible || '—'}</p>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { l: 'Separados', v: picked.length, cls: 'bg-emerald-50 text-emerald-700' },
          { l: 'Com erro', v: errors.length, cls: 'bg-red-50 text-red-700' },
          { l: 'Peças coletadas', v: totalPicked, cls: 'bg-blue-50 text-blue-700' },
          { l: 'Acurácia', v: `${accuracy}%`, cls: accuracy >= 90 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700' },
        ].map(({ l, v, cls }) => (
          <div key={l} className={`rounded-xl p-3 ${cls}`}>
            <p className="text-2xl font-black leading-none">{v}</p>
            <p className="text-xs font-semibold mt-1">{l}</p>
          </div>
        ))}
      </div>

      {/* Items table */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100">
          <h3 className="font-bold text-zinc-800 text-sm">Itens da Operação ({items.length})</h3>
        </div>
        <div className="overflow-x-auto max-h-64">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200 sticky top-0">
              <tr>
                {['Status', 'Nome', 'SKU', 'Local', 'Solicitado', 'Coletado'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-bold text-zinc-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ITEM_STATUS_COLOR[item.status]}`}>
                      {ITEM_STATUS_LABEL[item.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-medium text-zinc-800 max-w-[180px] truncate">{item.product_name || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-600">{item.sku || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-600">{item.location || '—'}</td>
                  <td className="px-4 py-2 font-mono font-bold text-zinc-700">{item.quantity_requested}</td>
                  <td className="px-4 py-2 font-mono font-bold">
                    <span className={item.quantity_picked >= item.quantity_requested ? 'text-emerald-600' : 'text-red-600'}>
                      {item.quantity_picked}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Checking form */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5 space-y-4">
        <h3 className="font-bold text-zinc-800 text-sm flex items-center gap-2">
          <User size={15} className="text-zinc-400" /> Conferente
        </h3>
        <div>
          <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Nome do Conferente *</label>
          <input value={checker} onChange={e => setChecker(e.target.value)} placeholder="Nome do conferente"
            className="w-full px-4 py-2.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400" />
        </div>
        <div>
          <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Divergências</label>
          <textarea rows={2} value={divergences} onChange={e => setDivergences(e.target.value)}
            placeholder="Descreva divergências encontradas..."
            className="w-full px-4 py-2.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 resize-none" />
        </div>
        <div>
          <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5">Observações</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            className="w-full px-4 py-2.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 resize-none" />
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertTriangle size={16} />{error}
          </div>
        )}

        <div className="flex gap-3 flex-wrap">
          <button onClick={() => handleSave('completed')} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold transition disabled:opacity-60">
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
            Finalizar Operação
          </button>
          <button onClick={() => handleSave('checking')} disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 border border-zinc-200 text-zinc-700 rounded-lg text-sm font-semibold hover:bg-zinc-50 transition disabled:opacity-60">
            Salvar rascunho
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

interface FullCheckingProps {
  initialOperationId?: string;
  onDone: () => void;
}

const FullChecking: React.FC<FullCheckingProps> = ({ initialOperationId, onDone }) => {
  const [operations, setOperations] = useState<FullOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOp, setSelectedOp] = useState<FullOperation | null>(null);
  const [items, setItems] = useState<FullOperationItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const loadOps = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('full_operations').select('id, company_id, full_number, marketplace, responsible, scheduled_date, scheduled_time, status, total_sku, total_pieces, notes, checker, checker_notes, checked_at, completed_at, created_at, updated_at')
      .in('status', ['checking', 'ready'])
      .order('updated_at', { ascending: false })
      .limit(50);
    const ops = (data as FullOperation[]) || [];
    setOperations(ops);
    setLoading(false);
    if (initialOperationId) {
      const found = ops.find(o => o.id === initialOperationId);
      if (found) selectOp(found);
    }
  }, [initialOperationId]);

  useEffect(() => { loadOps(); }, [loadOps]);

  const selectOp = async (op: FullOperation) => {
    setSelectedOp(op);
    setLoadingItems(true);
    const { data } = await supabase.from('full_operation_items').select('id, operation_id, company_id, listing_id, product_id, sku, ean, product_name, location, quantity_requested, quantity_picked, status, picker_notes, picked_at, created_at').eq('operation_id', op.id).order('location');
    setItems((data as FullOperationItem[]) || []);
    setLoadingItems(false);
  };

  if (loadingItems) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-zinc-400">
        <RefreshCw size={20} className="animate-spin" />Carregando itens...
      </div>
    );
  }

  if (selectedOp) {
    return (
      <CheckingForm
        operation={selectedOp}
        items={items}
        onBack={() => setSelectedOp(null)}
        onComplete={() => { setSelectedOp(null); onDone(); loadOps(); }}
      />
    );
  }

  return <CheckingSelector operations={operations} loading={loading} onSelect={selectOp} />;
};

export default FullChecking;
