import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import {
  LayoutDashboard, Calendar, Plus, Package, CheckSquare,
  Clock, TrendingUp, RefreshCw, AlertTriangle,
} from 'lucide-react';
import type { FullOperation } from '../lib/fullManagerTypes';
import {
  STATUS_LABEL, STATUS_COLOR, STATUS_DOT,
  formatFullDate,
} from '../lib/fullManagerTypes';
import { Panel, PanelSection, Stat, StatRow, StatCell, type StatProps, Button } from './ui';

// ── Marketplace icon letter ───────────────────────────────────────────────────
const MktIcon: React.FC<{ marketplace: string }> = ({ marketplace }) => {
  const colors: Record<string, string> = {
    'Mercado Livre': 'bg-yellow-400 text-yellow-900',
    'Shopee': 'bg-orange-500 text-white',
    'Amazon FBA': 'bg-amber-600 text-white',
    'Outro': 'bg-fg-subtle text-white',
  };
  const cls = colors[marketplace] || colors['Outro'];
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold flex-shrink-0 ${cls}`}>
      {marketplace.charAt(0)}
    </span>
  );
};

// ── Operation row ─────────────────────────────────────────────────────────────
const OpRow: React.FC<{ op: FullOperation; onClick: () => void }> = ({ op, onClick }) => {
  const dotClass = STATUS_DOT[op.status];
  const tagClass = STATUS_COLOR[op.status];
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 px-5 py-4 hover:bg-surface-3/40 cursor-pointer transition border-b border-edge/60 last:border-0"
    >
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
      <MktIcon marketplace={op.marketplace} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-fg text-sm">FULL #{op.full_number}</p>
        <p className="text-xs text-fg-muted truncate">
          {op.marketplace} · {op.responsible || 'Sem responsável'} · {formatFullDate(op.scheduled_date, op.scheduled_time)}
        </p>
      </div>
      <div className="hidden sm:flex items-center gap-4 text-xs text-fg-muted">
        <span className="font-mono">{op.total_sku} SKU</span>
        <span className="font-mono">{op.total_pieces} pcs</span>
      </div>
      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${tagClass} flex-shrink-0`}>
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
  const { companyId } = useAuth();
  const [operations, setOperations] = useState<FullOperation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const { data } = await supabase
      .from('full_operations')
      .select('id, company_id, full_number, marketplace, responsible, scheduled_date, scheduled_time, status, total_sku, total_pieces, notes, checker, checker_notes, checked_at, completed_at, created_at, updated_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(50);
    setOperations((data as FullOperation[]) || []);
    setLoading(false);
  }, [companyId]);

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
      <Panel>
        <PanelSection padding="lg">
          <StatRow>
            {([
              { label: 'FULLs Agendados', value: kpi.scheduled, icon: <Calendar /> },
              { label: 'Em Separação', value: kpi.picking, icon: <Package /> },
              // Completions today are the one genuinely good-news figure here.
              { label: 'Finalizados Hoje', value: kpi.completedToday, icon: <CheckSquare />, valueTone: 'positive' },
              { label: 'Peças Separadas Hoje', value: kpi.piecesToday, context: `Top: ${topMkt}`, icon: <TrendingUp /> },
            ] satisfies StatProps[]).map(k => (
              <StatCell key={k.label}>
                <Stat {...k} />
              </StatCell>
            ))}
          </StatRow>
        </PanelSection>
      </Panel>

      {/* Quick actions */}
      <div className="flex gap-3 flex-wrap">
        <Button onClick={() => onNavigate('agenda')}>
          <Plus size={16} />Novo Agendamento
        </Button>
        <Button variant="secondary" onClick={() => onNavigate('new-operation')}>
          <Package size={16} />Nova Operação
        </Button>
        <Button variant="secondary" onClick={load}>
          <RefreshCw size={15} />Atualizar
        </Button>
      </div>

      {/* Active operations */}
      <Panel>
        <PanelSection padding="sm">
          <h2 className="text-title flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Operações Ativas ({active.length})
          </h2>
        </PanelSection>
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-fg-subtle">
            <RefreshCw size={18} className="animate-spin" /> Carregando...
          </div>
        ) : active.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-fg-subtle">
            <LayoutDashboard size={32} className="mb-2 opacity-40" />
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
      </Panel>

      {/* Recent completed */}
      {recent.length > 0 && (
        <Panel>
          <PanelSection padding="sm">
            <h2 className="text-title flex items-center gap-2">
              <Clock size={15} className="text-fg-subtle" /> Recentemente Finalizados
            </h2>
          </PanelSection>
          {recent.map(op => (
            <OpRow key={op.id} op={op} onClick={() => onNavigate('history')} />
          ))}
        </Panel>
      )}
    </div>
  );
};

export default FullDashboard;
