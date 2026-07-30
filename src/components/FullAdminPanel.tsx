/**
 * FullAdminPanel — Painel Administrativo do Full Manager
 *
 * Permite ao administrador:
 * - Visualizar TODAS as operações (qualquer status)
 * - Alterar status manualmente (forçar transição)
 * - Editar campos: full_number, marketplace, responsible, scheduled_date, scheduled_time, notes
 * - Cancelar operações (com confirmação)
 * - Reabrir operações canceladas
 * - Excluir operações permanentemente (com confirmação dupla)
 * - Visualizar e editar itens de cada operação
 * - Alterar status de itens individualmente
 * - Filtros: status, marketplace, busca por número/responsável
 * - Exportar lista como CSV
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  ShieldAlert, RefreshCw, Search, Filter, ChevronDown, ChevronUp,
  Edit2, Trash2, XCircle, RotateCcw, Check, X, Download,
  AlertTriangle, Package, User, Calendar, Clock, ArrowUpDown,
  ChevronRight, Save, Ban, PlayCircle, CheckCircle2,
} from 'lucide-react';
import type { FullOperation, FullOperationItem, FullStatus } from '../lib/fullManagerTypes';
import {
  STATUS_LABEL, STATUS_COLOR, STATUS_DOT, ITEM_STATUS_LABEL, ITEM_STATUS_COLOR,
  ALL_STATUSES, MARKETPLACES, formatFullDate,
} from '../lib/fullManagerTypes';

// ── Types ─────────────────────────────────────────────────────────────────────

type SortField = 'created_at' | 'scheduled_date' | 'status' | 'full_number';
type SortDir = 'asc' | 'desc';

interface EditState {
  full_number: string;
  marketplace: string;
  responsible: string;
  scheduled_date: string;
  scheduled_time: string;
  notes: string;
  status: FullStatus;
}

// ── Status transition map — admin can force any status ───────────────────────

const NEXT_STATUS: Record<FullStatus, FullStatus[]> = {
  scheduled:  ['preparing', 'picking', 'checking', 'ready', 'completed', 'cancelled'],
  preparing:  ['picking', 'checking', 'ready', 'completed', 'scheduled', 'cancelled'],
  picking:    ['checking', 'ready', 'completed', 'preparing', 'scheduled', 'cancelled'],
  checking:   ['ready', 'completed', 'picking', 'scheduled', 'cancelled'],
  ready:      ['completed', 'checking', 'picking', 'scheduled', 'cancelled'],
  completed:  ['scheduled', 'picking', 'checking', 'cancelled'],
  cancelled:  ['scheduled', 'preparing'],
};

// ── Confirm dialog ────────────────────────────────────────────────────────────

const ConfirmDialog: React.FC<{
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ title, message, confirmLabel = 'Confirmar', danger, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
    <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
      <div className="flex items-start gap-3 mb-4">
        <div className={`flex-shrink-0 p-2 rounded-xl ${danger ? 'bg-red-100' : 'bg-amber-100'}`}>
          <AlertTriangle size={20} className={danger ? 'text-red-600' : 'text-amber-600'} />
        </div>
        <div>
          <h3 className="font-bold text-zinc-900 text-base">{title}</h3>
          <p className="text-sm text-zinc-600 mt-1">{message}</p>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel}
          className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg text-sm font-semibold transition">
          Cancelar
        </button>
        <button onClick={onConfirm}
          className={`px-4 py-2 rounded-lg text-sm font-bold text-white transition ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'}`}>
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

// ── Status selector dropdown ──────────────────────────────────────────────────

const StatusSelector: React.FC<{
  current: FullStatus;
  options: FullStatus[];
  onSelect: (s: FullStatus) => void;
  loading?: boolean;
}> = ({ current, options, onSelect, loading }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        disabled={loading}
        className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border transition cursor-pointer hover:opacity-80 ${STATUS_COLOR[current]}`}
      >
        {loading ? <RefreshCw size={11} className="animate-spin" /> : <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[current]}`} />}
        {STATUS_LABEL[current]}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-zinc-200 rounded-xl shadow-xl min-w-[160px] py-1 overflow-hidden">
          {options.map(s => (
            <button
              key={s}
              onClick={() => { onSelect(s); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-zinc-50 transition text-left ${s === current ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[s]}`} />
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Edit form ─────────────────────────────────────────────────────────────────

const EditOperationForm: React.FC<{
  op: FullOperation;
  onSave: (data: Partial<FullOperation>) => Promise<void>;
  onClose: () => void;
}> = ({ op, onSave, onClose }) => {
  const [form, setForm] = useState<EditState>({
    full_number: op.full_number,
    marketplace: op.marketplace,
    responsible: op.responsible || '',
    scheduled_date: op.scheduled_date || '',
    scheduled_time: op.scheduled_time || '',
    notes: op.notes || '',
    status: op.status,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      full_number: form.full_number.trim(),
      marketplace: form.marketplace,
      responsible: form.responsible.trim() || null,
      scheduled_date: form.scheduled_date || null,
      scheduled_time: form.scheduled_time || null,
      notes: form.notes.trim() || null,
      status: form.status,
    });
    setSaving(false);
    onClose();
  };

  const field = (label: string, key: keyof EditState, type = 'text', opts?: { options?: string[] }) => (
    <div key={key}>
      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">{label}</label>
      {opts?.options ? (
        <select value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white">
          {opts.options.map(o => <option key={o} value={o}>{key === 'status' ? STATUS_LABEL[o as FullStatus] : o}</option>)}
        </select>
      ) : (
        <input type={type} value={form[key]}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
        />
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-black text-zinc-900 text-lg">Editar Operação</h3>
            <p className="text-xs text-zinc-400 mt-0.5">FULL #{op.full_number}</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 p-1.5 rounded-lg hover:bg-zinc-100">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3">
          {field('Número Full', 'full_number')}
          {field('Marketplace', 'marketplace', 'text', { options: [...MARKETPLACES] })}
          {field('Responsável', 'responsible')}
          {field('Data Agendada', 'scheduled_date', 'date')}
          {field('Horário Agendado', 'scheduled_time', 'time')}
          {field('Status', 'status', 'text', { options: ALL_STATUSES })}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Observações</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
              className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 resize-none" />
          </div>
        </div>
        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg text-sm font-semibold transition">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !form.full_number.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-sm font-bold transition disabled:opacity-60">
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Items panel ───────────────────────────────────────────────────────────────

const ItemsPanel: React.FC<{
  op: FullOperation;
  onClose: () => void;
  onItemUpdated: () => void;
}> = ({ op, onClose, onItemUpdated }) => {
  const [items, setItems] = useState<FullOperationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('full_operation_items').select('id, operation_id, company_id, listing_id, product_id, sku, ean, product_name, location, quantity_requested, quantity_picked, status, picker_notes, picked_at, created_at')
      .eq('operation_id', op.id).order('location');
    setItems((data as FullOperationItem[]) || []);
    setLoading(false);
  }, [op.id]);

  useEffect(() => { load(); }, [load]);

  const updateItemStatus = async (itemId: string, status: string) => {
    setUpdatingId(itemId);
    await supabase.from('full_operation_items').update({ status }).eq('id', itemId);
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, status: status as typeof i.status } : i));
    setUpdatingId(null);
    onItemUpdated();
  };

  const updateQty = async (itemId: string, qty: number) => {
    await supabase.from('full_operation_items').update({ quantity_picked: qty }).eq('id', itemId);
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, quantity_picked: qty } : i));
  };

  const ITEM_STATUSES = ['found', 'picked', 'skipped', 'no_location', 'insufficient_stock', 'not_found', 'picking_error'] as const;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 flex-shrink-0">
          <div>
            <h3 className="font-black text-zinc-900">Itens — FULL #{op.full_number}</h3>
            <p className="text-xs text-zinc-400">{items.length} item(ns) · {op.marketplace}</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 p-1.5 rounded-lg hover:bg-zinc-100">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-zinc-400">
              <RefreshCw size={18} className="animate-spin" />Carregando itens...
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-300">
              <Package size={40} className="mb-2 opacity-30" />
              <p className="text-sm">Nenhum item nesta operação.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200 sticky top-0">
                <tr>
                  {['Produto', 'SKU', 'Local', 'Req.', 'Sep.', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-zinc-50 transition">
                    <td className="px-4 py-2.5 max-w-[180px]">
                      <p className="font-medium text-zinc-800 text-xs truncate">{item.product_name || '—'}</p>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 whitespace-nowrap">{item.sku || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-zinc-600 whitespace-nowrap">{item.location || '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="font-mono font-bold text-zinc-700 text-xs">{item.quantity_requested}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        type="number" min="0" max={item.quantity_requested + 999}
                        value={item.quantity_picked}
                        onChange={e => updateQty(item.id, Number(e.target.value))}
                        onBlur={e => supabase.from('full_operation_items').update({ quantity_picked: Number(e.target.value) }).eq('id', item.id)}
                        className="w-14 text-center px-1 py-1 border border-zinc-200 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-zinc-400"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={item.status}
                        disabled={updatingId === item.id}
                        onChange={e => updateItemStatus(item.id, e.target.value)}
                        className="text-xs border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-zinc-400 bg-white cursor-pointer"
                      >
                        {ITEM_STATUSES.map(s => (
                          <option key={s} value={s}>{ITEM_STATUS_LABEL[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      {updatingId === item.id && <RefreshCw size={13} className="animate-spin text-zinc-400" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-4 border-t border-zinc-100 flex justify-between items-center flex-shrink-0">
          <div className="flex gap-3 text-xs text-zinc-500">
            {['picked', 'skipped', 'not_found', 'no_location', 'insufficient_stock'].map(s => {
              const count = items.filter(i => i.status === s).length;
              if (!count) return null;
              return (
                <span key={s} className={`px-2 py-0.5 rounded-full font-semibold ${ITEM_STATUS_COLOR[s as keyof typeof ITEM_STATUS_COLOR]}`}>
                  {ITEM_STATUS_LABEL[s as keyof typeof ITEM_STATUS_LABEL]}: {count}
                </span>
              );
            })}
          </div>
          <button onClick={onClose}
            className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-sm font-semibold transition">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Admin Panel ─────────────────────────────────────────────────────────

const FullAdminPanel: React.FC = () => {
  const [operations, setOperations] = useState<FullOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FullStatus | 'all'>('all');
  const [filterMarketplace, setFilterMarketplace] = useState('all');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Modals
  const [editingOp, setEditingOp] = useState<FullOperation | null>(null);
  const [viewingItemsOp, setViewingItemsOp] = useState<FullOperation | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void;
  } | null>(null);

  // Inline status update loading
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('full_operations').select('id, company_id, full_number, marketplace, responsible, scheduled_date, scheduled_time, status, total_sku, total_pieces, notes, checker, checker_notes, checked_at, completed_at, created_at, updated_at')
      .order(sortField, { ascending: sortDir === 'asc' })
      .limit(100);
    if (error) console.error('[FullAdmin] Load error:', error);
    setOperations((data as FullOperation[]) || []);
    setLoading(false);
  }, [sortField, sortDir, refreshKey]);

  useEffect(() => { load(); }, [load]);

  // ── Filter ──────────────────────────────────────────────────────────────────
  const filtered = operations.filter(op => {
    if (filterStatus !== 'all' && op.status !== filterStatus) return false;
    if (filterMarketplace !== 'all' && op.marketplace !== filterMarketplace) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!op.full_number.toLowerCase().includes(q) &&
          !(op.responsible || '').toLowerCase().includes(q) &&
          !(op.marketplace || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // ── Actions ─────────────────────────────────────────────────────────────────

  const updateStatus = async (op: FullOperation, newStatus: FullStatus) => {
    setUpdatingStatusId(op.id);
    const extra: Partial<FullOperation> = {};
    if (newStatus === 'completed') extra.completed_at = new Date().toISOString();
    if (newStatus === 'cancelled') extra.completed_at = null;
    await supabase.from('full_operations').update({ status: newStatus, ...extra }).eq('id', op.id);
    setOperations(prev => prev.map(o => o.id === op.id ? { ...o, status: newStatus, ...extra } : o));
    setUpdatingStatusId(null);
  };

  const saveEdit = async (id: string, data: Partial<FullOperation>) => {
    await supabase.from('full_operations').update(data).eq('id', id);
    setOperations(prev => prev.map(o => o.id === id ? { ...o, ...data } : o));
  };

  const cancelOperation = (op: FullOperation) => {
    setConfirmDialog({
      title: 'Cancelar Operação',
      message: `Deseja cancelar o FULL #${op.full_number}? O status será alterado para "Cancelado". Os itens são mantidos.`,
      confirmLabel: 'Cancelar Operação',
      onConfirm: async () => {
        await updateStatus(op, 'cancelled');
        setConfirmDialog(null);
      },
    });
  };

  const reopenOperation = (op: FullOperation) => {
    setConfirmDialog({
      title: 'Reabrir Operação',
      message: `Deseja reabrir o FULL #${op.full_number}? O status voltará para "Agendado".`,
      confirmLabel: 'Reabrir',
      onConfirm: async () => {
        await updateStatus(op, 'scheduled');
        setConfirmDialog(null);
      },
    });
  };

  const deleteOperation = (op: FullOperation) => {
    setConfirmDialog({
      title: 'Excluir Permanentemente',
      message: `Atenção: isso removerá o FULL #${op.full_number} e todos os seus ${op.total_sku} itens do banco de dados. Esta ação é irreversível.`,
      confirmLabel: 'Excluir Definitivamente',
      danger: true,
      onConfirm: async () => {
        await supabase.from('full_operations').delete().eq('id', op.id);
        setOperations(prev => prev.filter(o => o.id !== op.id));
        setConfirmDialog(null);
      },
    });
  };

  // ── Sort toggle ─────────────────────────────────────────────────────────────
  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  // ── CSV Export ──────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = [
      ['FULL #', 'Marketplace', 'Responsável', 'Data', 'Status', 'SKUs', 'Peças', 'Criado em'],
      ...filtered.map(op => [
        op.full_number, op.marketplace, op.responsible || '',
        op.scheduled_date || '', STATUS_LABEL[op.status],
        op.total_sku, op.total_pieces,
        new Date(op.created_at).toLocaleDateString('pt-BR'),
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `full_operacoes_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = {
    total: operations.length,
    active: operations.filter(o => !['completed', 'cancelled'].includes(o.status)).length,
    completed: operations.filter(o => o.status === 'completed').length,
    cancelled: operations.filter(o => o.status === 'cancelled').length,
  };

  const SortIcon: React.FC<{ field: SortField }> = ({ field }) =>
    sortField === field
      ? <ArrowUpDown size={12} className="text-emerald-400" />
      : <ArrowUpDown size={12} className="text-zinc-500 opacity-40" />;

  return (
    <div className="space-y-5">
      {/* Modals */}
      {editingOp && (
        <EditOperationForm
          op={editingOp}
          onSave={data => saveEdit(editingOp.id, data)}
          onClose={() => setEditingOp(null)}
        />
      )}
      {viewingItemsOp && (
        <ItemsPanel
          op={viewingItemsOp}
          onClose={() => setViewingItemsOp(null)}
          onItemUpdated={() => setRefreshKey(k => k + 1)}
        />
      )}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          danger={confirmDialog.danger}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* Header banner */}
      <div className="bg-gradient-to-r from-zinc-900 to-zinc-800 rounded-2xl p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-red-500/20 rounded-xl">
            <ShieldAlert size={22} className="text-red-400" />
          </div>
          <div>
            <h2 className="font-black text-white text-lg">Painel Administrativo</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Gestão completa das operações Full — edite, cancele ou exclua qualquer registro.
            </p>
          </div>
        </div>
        <button onClick={() => setRefreshKey(k => k + 1)} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg text-sm font-semibold transition">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Atualizar</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total de Operações', value: stats.total, icon: <Package size={18} />, color: 'text-zinc-700 bg-zinc-100' },
          { label: 'Operações Ativas', value: stats.active, icon: <PlayCircle size={18} />, color: 'text-emerald-700 bg-emerald-100' },
          { label: 'Finalizadas', value: stats.completed, icon: <CheckCircle2 size={18} />, color: 'text-blue-700 bg-blue-100' },
          { label: 'Canceladas', value: stats.cancelled, icon: <Ban size={18} />, color: 'text-red-700 bg-red-100' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 ${s.color}`}>{s.icon}</div>
            <p className="text-2xl font-black text-zinc-900">{s.value}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1.5">Buscar</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Número FULL, responsável, marketplace..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
              />
            </div>
          </div>
          {/* Status filter */}
          <div className="w-40">
            <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1.5">Status</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as FullStatus | 'all')}
              className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white">
              <option value="all">Todos</option>
              {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          {/* Marketplace filter */}
          <div className="w-44">
            <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1.5">Marketplace</label>
            <select value={filterMarketplace} onChange={e => setFilterMarketplace(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white">
              <option value="all">Todos</option>
              {MARKETPLACES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {/* Export */}
          <button onClick={exportCSV}
            className="flex items-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-sm font-semibold transition">
            <Download size={14} />
            <span className="hidden sm:inline">Exportar CSV</span>
          </button>
        </div>
        {(searchQuery || filterStatus !== 'all' || filterMarketplace !== 'all') && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-zinc-500">{filtered.length} de {operations.length} operações</span>
            <button onClick={() => { setSearchQuery(''); setFilterStatus('all'); setFilterMarketplace('all'); }}
              className="text-xs text-zinc-500 hover:text-zinc-800 flex items-center gap-1 underline underline-offset-2">
              <X size={10} />Limpar filtros
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="px-4 py-3 text-left">
                  <button onClick={() => toggleSort('full_number')} className="flex items-center gap-1 text-xs font-semibold text-zinc-500 uppercase hover:text-zinc-800 transition">
                    FULL # <SortIcon field="full_number" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase">Marketplace</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase">Responsável</th>
                <th className="px-4 py-3 text-left">
                  <button onClick={() => toggleSort('scheduled_date')} className="flex items-center gap-1 text-xs font-semibold text-zinc-500 uppercase hover:text-zinc-800 transition">
                    Data <SortIcon field="scheduled_date" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button onClick={() => toggleSort('status')} className="flex items-center gap-1 text-xs font-semibold text-zinc-500 uppercase hover:text-zinc-800 transition">
                    Status <SortIcon field="status" />
                  </button>
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 uppercase">SKU / Pcs</th>
                <th className="px-4 py-3 text-left">
                  <button onClick={() => toggleSort('created_at')} className="flex items-center gap-1 text-xs font-semibold text-zinc-500 uppercase hover:text-zinc-800 transition">
                    Criado <SortIcon field="created_at" />
                  </button>
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 uppercase">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="flex items-center justify-center gap-2 text-zinc-400">
                      <RefreshCw size={18} className="animate-spin" />Carregando operações...
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-zinc-400 text-sm">
                    Nenhuma operação encontrada.
                  </td>
                </tr>
              ) : filtered.map(op => (
                <tr key={op.id} className="hover:bg-zinc-50 transition">
                  {/* FULL # */}
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-black text-zinc-900 text-sm">{op.full_number}</p>
                      {op.notes && (
                        <p className="text-xs text-zinc-400 mt-0.5 max-w-[120px] truncate" title={op.notes}>{op.notes}</p>
                      )}
                    </div>
                  </td>
                  {/* Marketplace */}
                  <td className="px-4 py-3 text-zinc-700 text-xs font-medium">{op.marketplace}</td>
                  {/* Responsible */}
                  <td className="px-4 py-3 text-zinc-600 text-xs">{op.responsible || '—'}</td>
                  {/* Date */}
                  <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">{formatFullDate(op.scheduled_date, op.scheduled_time)}</td>
                  {/* Status — inline change */}
                  <td className="px-4 py-3">
                    <StatusSelector
                      current={op.status}
                      options={NEXT_STATUS[op.status]}
                      loading={updatingStatusId === op.id}
                      onSelect={s => updateStatus(op, s)}
                    />
                  </td>
                  {/* SKU / Pieces */}
                  <td className="px-4 py-3 text-center">
                    <span className="font-mono text-xs text-zinc-700">{op.total_sku} / {op.total_pieces}</span>
                  </td>
                  {/* Created */}
                  <td className="px-4 py-3 text-xs text-zinc-400 whitespace-nowrap">
                    {new Date(op.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {/* View items */}
                      <button
                        onClick={() => setViewingItemsOp(op)}
                        title="Ver / editar itens"
                        className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition"
                      >
                        <Package size={15} />
                      </button>
                      {/* Edit */}
                      <button
                        onClick={() => setEditingOp(op)}
                        title="Editar operação"
                        className="p-1.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                      >
                        <Edit2 size={15} />
                      </button>
                      {/* Cancel / Reopen */}
                      {op.status !== 'cancelled' ? (
                        <button
                          onClick={() => cancelOperation(op)}
                          title="Cancelar operação"
                          className="p-1.5 text-zinc-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition"
                        >
                          <XCircle size={15} />
                        </button>
                      ) : (
                        <button
                          onClick={() => reopenOperation(op)}
                          title="Reabrir operação"
                          className="p-1.5 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}
                      {/* Delete */}
                      <button
                        onClick={() => deleteOperation(op)}
                        title="Excluir permanentemente"
                        className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-zinc-100 bg-zinc-50 flex items-center justify-between text-xs text-zinc-500">
            <span>{filtered.length} operação(ões) exibida(s)</span>
            <span>
              {filtered.reduce((s, o) => s + o.total_sku, 0)} SKUs ·{' '}
              {filtered.reduce((s, o) => s + o.total_pieces, 0)} peças no total
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default FullAdminPanel;
