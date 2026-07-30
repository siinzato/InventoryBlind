import React, { useState } from 'react';
import {
  ArrowLeft, LayoutDashboard, Calendar, Plus, Package,
  ClipboardCheck, Clock, ChevronRight, ShieldAlert,
} from 'lucide-react';
import FullDashboard from './FullDashboard';
import FullAgenda from './FullAgenda';
import FullNewOperation from './FullNewOperation';
import FullPicking from './FullPicking';
import FullChecking from './FullChecking';
import FullHistory from './FullHistory';
import FullAdminPanel from './FullAdminPanel';

// ── Types ─────────────────────────────────────────────────────────────────────

type FullTab = 'dashboard' | 'agenda' | 'new-operation' | 'picking' | 'checking' | 'history' | 'admin';

const TABS: { id: FullTab; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
  { id: 'dashboard',     label: 'Dashboard',     icon: <LayoutDashboard size={16} /> },
  { id: 'agenda',        label: 'Agendamentos',   icon: <Calendar size={16} /> },
  { id: 'new-operation', label: 'Nova Operação',  icon: <Plus size={16} /> },
  { id: 'picking',       label: 'Separação',      icon: <Package size={16} /> },
  { id: 'checking',      label: 'Conferência',    icon: <ClipboardCheck size={16} /> },
  { id: 'history',       label: 'Histórico',      icon: <Clock size={16} /> },
  { id: 'admin',         label: 'Administração',  icon: <ShieldAlert size={16} />, adminOnly: true },
];

// ── Breadcrumb ────────────────────────────────────────────────────────────────

const Breadcrumb: React.FC<{ tab: FullTab }> = ({ tab }) => {
  const t = TABS.find(t => t.id === tab);
  return (
    <div className="flex items-center gap-1.5 text-xs text-zinc-400">
      <span>Full Manager</span>
      <ChevronRight size={12} />
      <span className={`font-semibold ${tab === 'admin' ? 'text-red-400' : 'text-zinc-300'}`}>
        {t?.label}
      </span>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────

interface FullManagerPageProps {
  onBack: () => void;
}

const FullManagerPage: React.FC<FullManagerPageProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<FullTab>('dashboard');
  const [pendingPickingOpId, setPendingPickingOpId] = useState<string | undefined>();
  const [pendingCheckingOpId, setPendingCheckingOpId] = useState<string | undefined>();

  const navigate = (tab: FullTab, opId?: string) => {
    if (tab === 'picking' && opId) setPendingPickingOpId(opId);
    if (tab === 'checking' && opId) setPendingCheckingOpId(opId);
    setActiveTab(tab);
  };

  const handleTabClick = (tab: FullTab) => {
    if (tab !== 'picking') setPendingPickingOpId(undefined);
    if (tab !== 'checking') setPendingCheckingOpId(undefined);
    setActiveTab(tab);
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-zinc-950 text-white shadow-xl">
        <div className="max-w-7xl mx-auto px-4 py-4">
          {/* Top row */}
          <div className="flex items-center gap-3 mb-3">
            <button onClick={onBack}
              className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition text-sm font-medium">
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">Voltar</span>
            </button>
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-lg ${activeTab === 'admin' ? 'bg-red-600' : 'bg-emerald-500'} transition`}>
                {activeTab === 'admin' ? <ShieldAlert size={18} className="text-white" /> : <Package size={18} className="text-white" />}
              </div>
              <div>
                <h1 className="font-black text-base leading-tight">Full Manager</h1>
                <Breadcrumb tab={activeTab} />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-0.5">
            {TABS.map(tab => {
              const isAdmin = tab.adminOnly;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabClick(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition flex-shrink-0 ${
                    isActive
                      ? isAdmin
                        ? 'bg-red-600 text-white'
                        : 'bg-emerald-600 text-white'
                      : isAdmin
                        ? 'text-red-400 hover:text-white hover:bg-red-700/50 border border-red-800/40'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'dashboard' && (
          <FullDashboard onNavigate={(tab, opId) => navigate(tab as FullTab, opId)} />
        )}

        {activeTab === 'agenda' && (
          <FullAgenda onNavigateToPicking={opId => navigate('picking', opId)} />
        )}

        {activeTab === 'new-operation' && (
          <FullNewOperation
            onComplete={opId => { navigate('picking', opId); }}
            onCancel={() => setActiveTab('dashboard')}
          />
        )}

        {activeTab === 'picking' && (
          <FullPicking
            key={pendingPickingOpId}
            initialOperationId={pendingPickingOpId}
            onDone={() => setActiveTab('checking')}
          />
        )}

        {activeTab === 'checking' && (
          <FullChecking
            key={pendingCheckingOpId}
            initialOperationId={pendingCheckingOpId}
            onDone={() => setActiveTab('history')}
          />
        )}

        {activeTab === 'history' && <FullHistory />}

        {activeTab === 'admin' && <FullAdminPanel />}
      </div>
    </div>
  );
};

export default FullManagerPage;
