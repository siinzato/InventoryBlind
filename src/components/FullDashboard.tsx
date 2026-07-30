import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  LayoutDashboard, Calendar, Plus, Package, CheckSquare,
  Clock, TrendingUp, RefreshCw, AlertTriangle,
} from 'lucide-react';
import type { FullOperation } from '../lib/fullManagerTypes';
import {
  STATUS_LABEL, STATUS_COLOR, STATUS_DOT,
  formatFullDate, MARKETPLACES,
} from '../lib/fullManagerTypes';

// ── Marketplace icon letter ───────────────────────────────────────────────────
const MktIcon: React.FC<{ marketplace: string }> = ({ marketplace }) => {
  const colors: Record<string, string> = {
    'Mercado Livre': 'bg-yellow-400 text-yellow-900',
    'Shopee': 'bg-orange-500 text-white',
    'Amazon FBA': 'bg-amber-600 text-white',
    'Outro': 'bg-zinc-500 text-white',
  };
  const cls = colors[marketplace] || colors['Outro'];
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black flex-shrink-0 ${cls}`}>
      {marketplace.charAt(0)}
    </span>
  );
};

// ── KPI Card ──────────────────────────────────────────────────────────────────
const KpiCard: React.FC<{ label: string; value: number | string; sub?: string; color: string; icon: React.ReactNode }> = ({ label, value, sub, color, icon }) => (
  <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm">
    <div className="flex items-start justify-between mb-3">
      <div className={`p-2 rounded-lg ${color}`}>{icon}</div>
    </div>
    <p className="text-2xl font-black text-zinc-900 leading-none">{value}</p>
    <p className="text-sm font-semibold text-zinc-600 mt-1">{label}</p>
    {sub && <p className="text-xs text-zinc-400 mt-0.5">{sub}</p>}
  </div>
);

// ── Operation row ─────────────────────────────────────────────────────────────
const OpRow: React.FC<{ op: FullOperation; onClick: () => void }> = ({ op, onClick }) => {
  const dotClass = STATUS_DOT[op.status];
  const tagClass = STATUS_COLOR[op.status];
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 cursor-pointer transition border-b border-zinc-100 last:border-0"
    >
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
      <MktIcon marketplace={op.marketplace} />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-zinc-800 text-sm">FULL #{op.full_number}</p>
        <p className="text-xs text-zinc-500 truncate">
          {op.marketplace} · {op.responsible || 'Sem responsável'} · {formatFullDate(op.scheduled_date, op.scheduled_time)}
        </p>
      </div>
      <div className="hidden sm:flex items-center gap-4 text-xs text-zinc-500">
        <span className="font-mono">{op.total_sku} SKU</span>
        <span className="font-mono">{op.total_pieces} pcs</span>
      </div>
      <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${tagClass} flex-shrink-0`}>
        {STATUS_LABEL[op.status]}
      </span>
    </div>
  );
};

// ── Dashboard ─────────────────────────────────────────────────────────────────
interface FullDashboardProps {
  onNavigate: (tab: string, opId?: string) => void;
}

const FullDashboard: React.FC<FullDashboardProps> = ({ onNavigate }) => {
  const [operations, setOperations] = useState<FullOperation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('full_operations')
      .select('id, company_id, full_number, marketplace, responsible, scheduled_date, scheduled_time, status, total_sku, total_pieces, notes, checker, checker_notes, checked_at, completed_at, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(50);
    setOperations((data as FullOperation[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toDateString();
  const kpi = {
    scheduled: operations.filter(o => o.status === 'scheduled').length,
    picking: operations.filter(o => o.status === 'picking').length,
    completedToday: operations.filter(o => o.status === 'completed' && o.completed_at && new Date(o.completed_at).toDateString() === today).length,
    piecesToday: operations
      .filter(o => o.status === 'completed' && o.completed_at && new Date(o.completed_at).toDateString() === today)
      .reduce((s, o) => s + o.total_pieces, 0),
  };

  // top marketplace
  const mktCount: Record<string, number> = {};
  operations.forEach(o => { mktCount[o.marketplace] = (mktCount[o.marketplace] || 0) + 1; });
  const topMkt = Object.entries(mktCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  const active = operations.filter(o => !['completed', 'cancelled'].includes(o.status));
  const recent = operations.filter(o => o.status === 'completed').slice(0, 5);

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="FULLs Agendados" value={kpi.scheduled} color="bg-blue-50" icon={<Calendar size={18} className="text-blue-600" />} />
        <KpiCard label="Em Separação" value={kpi.picking} color="bg-orange-50" icon={<Package size={18} className="text-orange-600" />} />
        <KpiCard label="Finalizados Hoje" value={kpi.completedToday} color="bg-emerald-50" icon={<CheckSquare size={18} className="text-emerald-600" />} />
        <KpiCard label="Peças Separadas Hoje" value={kpi.piecesToday} sub={`Top: ${topMkt}`} color="bg-purple-50" icon={<TrendingUp size={18} className="text-purple-600" />} />
      </div>

      {/* Quick actions */}
      <div className="flex gap-3 flex-wrap">
        <button onClick={() => onNavigate('agenda')}
          className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-sm font-semibold transition">
          <Plus size={16} />Novo Agendamento
        </button>
        <button onClick={() => onNavigate('new-operation')}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition">
          <Package size={16} />Nova Operação
        </button>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2.5 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 rounded-lg text-sm font-medium transition">
          <RefreshCw size={15} />Atualizar
        </button>
      </div>

      {/* Active operations */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
          <h2 className="font-bold text-zinc-800 text-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Operações Ativas ({active.length})
          </h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-zinc-400">
            <RefreshCw size={18} className="animate-spin" /> Carregando...
          </div>
        ) : active.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-300">
            <LayoutDashboard size={36} className="mb-2 opacity-30" />
            <p className="text-sm">Nenhuma operação ativa.</p>
            <p className="text-xs mt-1">Crie um agendamento ou uma nova operação.</p>
          </div>
        ) : (
          active.map(op => (
            <OpRow key={op.id} op={op} onClick={() => {
              if (op.status === 'picking') onNavigate('picking', op.id);
              else if (op.status === 'checking') onNavigate('checking', op.id);
              else onNavigate('agenda');
            }} />
          ))
        )}
      </div>

      {/* Recent completed */}
      {recent.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100">
            <h2 className="font-bold text-zinc-800 text-sm flex items-center gap-2">
              <Clock size={15} className="text-zinc-400" /> Recentemente Finalizados
            </h2>
          </div>
          {recent.map(op => (
            <OpRow key={op.id} op={op} onClick={() => onNavigate('history')} />
          ))}
        </div>
      )}
    </div>
  );
};

export default FullDashboard;
