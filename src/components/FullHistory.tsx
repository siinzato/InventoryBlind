import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { RefreshCw, ChevronDown, ChevronUp, Clock, Package, User, ClipboardCheck } from 'lucide-react';
import type { FullOperation, FullOperationItem } from '../lib/fullManagerTypes';
import { STATUS_LABEL, STATUS_COLOR, ITEM_STATUS_LABEL, ITEM_STATUS_COLOR, formatFullDate } from '../lib/fullManagerTypes';

// ── History row ───────────────────────────────────────────────────────────────

const HistoryRow: React.FC<{ op: FullOperation }> = ({ op }) => {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<FullOperationItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const tagCls = STATUS_COLOR[op.status];

  const loadItems = async () => {
    if (items.length > 0) { setExpanded(v => !v); return; }
    setLoadingItems(true);
    const { data } = await supabase
      .from('full_operation_items').select('id, operation_id, company_id, listing_id, product_id, sku, ean, product_name, location, quantity_requested, quantity_picked, status, picker_notes, picked_at, created_at').eq('operation_id', op.id).order('location');
    setItems((data as FullOperationItem[]) || []);
    setLoadingItems(false);
    setExpanded(true);
  };

  const duration = op.completed_at && op.created_at
    ? (() => {
      const diff = new Date(op.completed_at).getTime() - new Date(op.created_at).getTime();
      const m = Math.round(diff / 60000);
      return m < 60 ? `${m}min` : `${Math.floor(m / 60)}h ${m % 60}min`;
    })()
    : null;

  const pickedItems = items.filter(i => i.status === 'picked');
  const totalPicked = pickedItems.reduce((s, i) => s + i.quantity_picked, 0);
  const totalReq = items.reduce((s, i) => s + i.quantity_requested, 0);
  const accuracy = totalReq > 0 ? Math.round((totalPicked / totalReq) * 100) : null;

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
      <button
        onClick={loadItems}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 transition text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="font-black text-zinc-900">FULL #{op.full_number}</p>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${tagCls}`}>
              {STATUS_LABEL[op.status]}
            </span>
          </div>
          <div className="flex gap-4 mt-1 text-xs text-zinc-500 flex-wrap">
            <span>{op.marketplace}</span>
            {op.responsible && <span className="flex items-center gap-1"><User size={11} />{op.responsible}</span>}
            <span className="flex items-center gap-1"><Clock size={11} />{formatFullDate(op.scheduled_date)}</span>
            {duration && <span>Duração: {duration}</span>}
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-4 text-xs text-zinc-500">
          <span className="font-mono font-bold">{op.total_sku} SKU</span>
          <span className="font-mono font-bold">{op.total_pieces} pcs</span>
          {accuracy !== null && (
            <span className={`font-bold ${accuracy >= 90 ? 'text-emerald-600' : 'text-amber-600'}`}>
              {accuracy}%
            </span>
          )}
        </div>
        <div className="flex-shrink-0 text-zinc-400">
          {loadingItems ? <RefreshCw size={16} className="animate-spin" /> : expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded && items.length > 0 && (
        <div className="border-t border-zinc-100">
          {/* Meta */}
          <div className="px-5 py-3 bg-zinc-50 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {[
              { l: 'Separador', v: op.responsible || '—' },
              { l: 'Conferente', v: op.checker || '—' },
              { l: 'Conferido em', v: op.checked_at ? new Date(op.checked_at).toLocaleDateString('pt-BR') : '—' },
              { l: 'Finalizado', v: op.completed_at ? new Date(op.completed_at).toLocaleDateString('pt-BR') : '—' },
            ].map(({ l, v }) => (
              <div key={l}>
                <p className="text-zinc-400 font-semibold uppercase">{l}</p>
                <p className="font-bold text-zinc-700 mt-0.5">{v}</p>
              </div>
            ))}
            {op.checker_notes && (
              <div className="col-span-2 sm:col-span-4">
                <p className="text-zinc-400 font-semibold uppercase">Observações do Conferente</p>
                <p className="text-zinc-700 mt-0.5">{op.checker_notes}</p>
              </div>
            )}
          </div>

          {/* Items table */}
          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200">
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
                      <span className={item.quantity_picked >= item.quantity_requested ? 'text-emerald-600' : item.quantity_picked > 0 ? 'text-amber-600' : 'text-zinc-400'}>
                        {item.quantity_picked}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────

const FullHistory: React.FC = () => {
  const [operations, setOperations] = useState<FullOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [mktFilter, setMktFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('full_operations').select('id, company_id, full_number, marketplace, responsible, scheduled_date, scheduled_time, status, total_sku, total_pieces, notes, checker, checker_notes, checked_at, completed_at, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(100);
    setOperations((data as FullOperation[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const mkts = [...new Set(operations.map(o => o.marketplace))];

  const filtered = operations.filter(op => {
    const q = search.toLowerCase();
    const matchSearch = !q || op.full_number.toLowerCase().includes(q) || (op.responsible || '').toLowerCase().includes(q);
    const matchMkt = !mktFilter || op.marketplace === mktFilter;
    return matchSearch && matchMkt;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por número ou responsável..."
          className="flex-1 min-w-0 px-4 py-2.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white" />
        <select value={mktFilter} onChange={e => setMktFilter(e.target.value)}
          className="px-3 py-2.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white">
          <option value="">Todos os marketplaces</option>
          {mkts.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={load} className="p-2.5 border border-zinc-200 rounded-lg text-zinc-500 hover:bg-zinc-50 transition">
          <RefreshCw size={15} />
        </button>
      </div>

      <p className="text-xs text-zinc-400 font-medium">{filtered.length} operação(ões) encontrada(s)</p>

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-zinc-400">
          <RefreshCw size={20} className="animate-spin" />Carregando histórico...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-white rounded-xl border border-zinc-200 text-zinc-300">
          <Package size={40} className="mb-3 opacity-30" />
          <p className="text-sm">Nenhuma operação encontrada.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(op => <HistoryRow key={op.id} op={op} />)}
        </div>
      )}
    </div>
  );
};

export default FullHistory;
