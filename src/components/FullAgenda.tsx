import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { SafeDropdown } from './SafeDropdown';
import {
  Plus, Calendar, RefreshCw, X, Check, Pencil, AlertTriangle,
  Package, User, Clock,
} from 'lucide-react';
import type { FullOperation, FullStatus } from '../lib/fullManagerTypes';
import {
  STATUS_LABEL, STATUS_COLOR, ALL_STATUSES, MARKETPLACES, formatFullDate,
} from '../lib/fullManagerTypes';

// ── Form state ────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  full_number: '',
  marketplace: 'Mercado Livre' as string,
  responsible: '',
  scheduled_date: '',
  scheduled_time: '',
  total_sku: '',
  total_pieces: '',
  notes: '',
  status: 'scheduled' as FullStatus,
};

type FormState = typeof EMPTY_FORM;

// ── Agenda card ───────────────────────────────────────────────────────────────
const AgendaCard: React.FC<{
  op: FullOperation;
  onEdit: () => void;
  onStatusChange: (s: FullStatus) => void;
  onNavigate: (opId: string) => void;
}> = ({ op, onEdit, onStatusChange, onNavigate }) => {
  const tagCls = STATUS_COLOR[op.status];

  return (
    <div className="bg-surface-2 rounded-xl border border-edge overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-edge">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-bold text-fg text-base leading-tight">
              FULL #{op.full_number}
            </p>
            <p className="text-xs text-fg-subtle mt-0.5 font-semibold">{op.marketplace}</p>
          </div>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border flex-shrink-0 ${tagCls}`}>
            {STATUS_LABEL[op.status]}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 flex-1 space-y-1.5">
        <div className="flex items-center gap-2 text-sm">
          <Calendar size={14} className="text-fg-subtle" />
          <span className="text-fg-muted font-medium">{formatFullDate(op.scheduled_date, op.scheduled_time)}</span>
        </div>
        {op.responsible && (
          <div className="flex items-center gap-2 text-sm">
            <User size={14} className="text-fg-subtle" />
            <span className="text-fg-muted">{op.responsible}</span>
          </div>
        )}
        <div className="flex items-center gap-4 text-xs text-fg-subtle pt-1">
          <span className="font-mono font-bold text-fg-muted">{op.total_sku} SKU</span>
          <span className="font-mono font-bold text-fg-muted">{op.total_pieces} peças</span>
        </div>
        {op.notes && <p className="text-xs text-fg-subtle italic">{op.notes}</p>}
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 flex gap-2 flex-wrap">
        {/* Status change */}
        <SafeDropdown
          trigger={
            <button className="flex items-center gap-1.5 px-3 py-1.5 border border-edge bg-surface-3 hover:bg-edge rounded-lg text-xs font-semibold text-fg-muted transition">
              <Clock size={12} /> Status
            </button>
          }
          items={ALL_STATUSES.map(s => ({
            id: s,
            label: STATUS_LABEL[s],
            active: op.status === s,
            onClick: () => onStatusChange(s),
          }))}
        />

        <button onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-edge bg-surface-3 hover:bg-edge rounded-lg text-xs font-semibold text-fg-muted transition">
          <Pencil size={12} /> Editar
        </button>

        {(op.status === 'preparing' || op.status === 'picking') && (
          <button onClick={() => onNavigate(op.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-strong text-white rounded-lg text-xs font-semibold transition">
            <Package size={12} /> Separar
          </button>
        )}
      </div>
    </div>
  );
};

// ── Modal form ────────────────────────────────────────────────────────────────
const AgendaModal: React.FC<{
  initial: FormState | null;
  onSave: (f: FormState) => Promise<void>;
  onClose: () => void;
}> = ({ initial, onSave, onClose }) => {
  const [form, setForm] = useState<FormState>(initial ?? { ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_number.trim()) return;
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface-2 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-edge flex items-center justify-between">
          <h2 className="font-bold text-fg text-lg">{initial ? 'Editar Agendamento' : 'Novo Agendamento'}</h2>
          <button onClick={onClose} className="text-fg-subtle hover:text-fg-muted"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-bold text-fg-subtle uppercase mb-1.5">Número do FULL *</label>
              <input value={form.full_number} onChange={e => set('full_number', e.target.value)} required
                placeholder="Ex: 803458905"
                className="w-full px-4 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 font-mono" />
            </div>
            <div>
              <label className="block text-xs font-bold text-fg-subtle uppercase mb-1.5">Marketplace</label>
              <select value={form.marketplace} onChange={e => set('marketplace', e.target.value)}
                className="w-full px-3 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface-2">
                {MARKETPLACES.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-fg-subtle uppercase mb-1.5">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value as FullStatus)}
                className="w-full px-3 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface-2">
                {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-fg-subtle uppercase mb-1.5">Data</label>
              <input type="date" value={form.scheduled_date} onChange={e => set('scheduled_date', e.target.value)}
                className="w-full px-3 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </div>
            <div>
              <label className="block text-xs font-bold text-fg-subtle uppercase mb-1.5">Horário</label>
              <input type="time" value={form.scheduled_time} onChange={e => set('scheduled_time', e.target.value)}
                className="w-full px-3 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-bold text-fg-subtle uppercase mb-1.5">Responsável</label>
              <input value={form.responsible} onChange={e => set('responsible', e.target.value)}
                placeholder="Nome do responsável"
                className="w-full px-4 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </div>
            <div>
              <label className="block text-xs font-bold text-fg-subtle uppercase mb-1.5">SKUs previstos</label>
              <input type="number" min="0" value={form.total_sku} onChange={e => set('total_sku', e.target.value)}
                className="w-full px-3 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 font-mono" />
            </div>
            <div>
              <label className="block text-xs font-bold text-fg-subtle uppercase mb-1.5">Peças previstas</label>
              <input type="number" min="0" value={form.total_pieces} onChange={e => set('total_pieces', e.target.value)}
                className="w-full px-3 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 font-mono" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-bold text-fg-subtle uppercase mb-1.5">Observações</label>
              <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
                className="w-full px-4 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-accent hover:bg-accent-strong text-white rounded-lg text-sm font-bold transition disabled:opacity-60">
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
              {initial ? 'Salvar alterações' : 'Criar agendamento'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 border border-edge text-fg-muted rounded-lg text-sm font-semibold hover:bg-surface-3 transition">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
interface FullAgendaProps {
  onNavigateToPicking: (opId: string) => void;
}

const FullAgenda: React.FC<FullAgendaProps> = ({ onNavigateToPicking }) => {
  const { companyId } = useAuth();
  const [operations, setOperations] = useState<FullOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; editing: FullOperation | null }>({ open: false, editing: null });
  const [statusFilter, setStatusFilter] = useState<FullStatus | 'all'>('all');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const { data } = await supabase
      .from('full_operations').select('id, company_id, full_number, marketplace, responsible, scheduled_date, scheduled_time, status, total_sku, total_pieces, notes, checker, checker_notes, checked_at, completed_at, created_at, updated_at')
      .eq('company_id', companyId)
      .order('scheduled_date', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(100);
    setOperations((data as FullOperation[]) || []);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form: typeof EMPTY_FORM) => {
    setError('');
    const payload = {
      full_number: form.full_number.trim(),
      marketplace: form.marketplace,
      responsible: form.responsible.trim() || null,
      scheduled_date: form.scheduled_date || null,
      scheduled_time: form.scheduled_time || null,
      status: form.status,
      total_sku: Number(form.total_sku) || 0,
      total_pieces: Number(form.total_pieces) || 0,
      notes: form.notes.trim() || null,
    };

    let err;
    if (modal.editing) {
      ({ error: err } = await supabase.from('full_operations').update(payload).eq('id', modal.editing.id));
    } else {
      ({ error: err } = await supabase.from('full_operations').insert(payload));
    }
    if (err) { setError(err.message); return; }
    setModal({ open: false, editing: null });
    load();
  };

  const handleStatusChange = async (op: FullOperation, status: FullStatus) => {
    const update: Partial<FullOperation> = { status };
    if (status === 'completed') update.completed_at = new Date().toISOString();
    await supabase.from('full_operations').update(update).eq('id', op.id);
    load();
  };

  const filtered = statusFilter === 'all' ? operations : operations.filter(o => o.status === statusFilter);
  const active = ALL_STATUSES.filter(s => s !== 'completed' && s !== 'cancelled');

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border ${statusFilter === 'all' ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge hover:bg-surface-3'}`}>
            Todos ({operations.length})
          </button>
          {active.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border ${statusFilter === s ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge hover:bg-surface-3'}`}>
              {STATUS_LABEL[s]} ({operations.filter(o => o.status === s).length})
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 border border-edge rounded-lg text-fg-subtle hover:bg-surface-3 transition">
            <RefreshCw size={15} />
          </button>
          <button onClick={() => setModal({ open: true, editing: null })}
            className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-lg text-sm font-semibold transition">
            <Plus size={16} /> Novo Agendamento
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 rounded-lg text-sm text-red-700 dark:text-red-400">
          <AlertTriangle size={16} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-fg-subtle">
          <RefreshCw size={20} className="animate-spin" />Carregando agendamentos...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-fg-subtle bg-surface-2 rounded-xl border border-edge">
          <Calendar size={48} className="mb-3 opacity-20" />
          <p className="text-sm font-medium">Nenhum agendamento encontrado.</p>
          <button onClick={() => setModal({ open: true, editing: null })}
            className="mt-4 flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-semibold hover:bg-accent-strong transition">
            <Plus size={14} /> Criar primeiro agendamento
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(op => (
            <AgendaCard key={op.id} op={op}
              onEdit={() => setModal({ open: true, editing: op })}
              onStatusChange={s => handleStatusChange(op, s)}
              onNavigate={onNavigateToPicking}
            />
          ))}
        </div>
      )}

      {modal.open && (
        <AgendaModal
          initial={modal.editing ? {
            full_number: modal.editing.full_number,
            marketplace: modal.editing.marketplace,
            responsible: modal.editing.responsible || '',
            scheduled_date: modal.editing.scheduled_date || '',
            scheduled_time: modal.editing.scheduled_time || '',
            total_sku: String(modal.editing.total_sku),
            total_pieces: String(modal.editing.total_pieces),
            notes: modal.editing.notes || '',
            status: modal.editing.status,
          } : null}
          onSave={handleSave}
          onClose={() => setModal({ open: false, editing: null })}
        />
      )}
    </div>
  );
};

export default FullAgenda;
