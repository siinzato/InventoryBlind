// Painel Administrativo — reformulado em áreas próprias (Visão Geral / Vendas e Integrações /
// KPIs / Inventários e Dados / Zona de Perigo). Recebe dados/handlers já carregados por App.tsx
// (brandsData/customKPIs/snapshots/globais) para não duplicar o carregamento existente; a aba de
// Vendas é totalmente nova e autossuficiente (só lê/escreve sales_*, nunca estoque/inventário).

import { useState } from 'react';
import { Edit, Plus, Trash2, History, Eye, Target } from 'lucide-react';
import { Panel, PanelSection, Button, SegmentedControl, Modal } from '../ui';
import type { CustomKPI, InventorySnapshot } from '../../lib/supabase';
import { OverviewTab } from './OverviewTab';
import { SalesTab } from './SalesTab';
import { DangerZoneSection } from './DangerZoneSection';

type AdminTab = 'overview' | 'sales' | 'kpis' | 'inventories';

interface AdminDashboardPageProps {
  role: string | null | undefined;
  companyId: string;
  companyName: string | null;
  companyCreatedAt: string | null;
  userId: string;
  userEmail: string;
  globais: { totalSku: number; totalDone: number; totalDiv: number; acuracidade: number };
  customKPIs: CustomKPI[];
  onAddKPI: (kpi: Omit<CustomKPI, 'id' | 'order_index' | 'created_at' | 'updated_at'>) => Promise<void>;
  onDeleteKPI: (id: string) => Promise<void>;
  snapshots: InventorySnapshot[];
  onViewSnapshot: (snapshot: InventorySnapshot) => void;
  onResetComplete: () => void;
  onAddInventoryLine: () => void;
}

export function AdminDashboardPage({
  role, companyId, companyName, companyCreatedAt, userId, userEmail, globais,
  customKPIs, onAddKPI, onDeleteKPI, snapshots, onViewSnapshot, onResetComplete, onAddInventoryLine,
}: AdminDashboardPageProps) {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [showAddKPIModal, setShowAddKPIModal] = useState(false);
  const [newKPI, setNewKPI] = useState<Omit<CustomKPI, 'id' | 'order_index' | 'created_at' | 'updated_at'>>({
    titulo: '', valor: '', unidade: '', variacao: '', tipo_variacao: 'up', cor_icone: 'blue',
  });

  const latestSnapshot = snapshots.length > 0
    ? [...snapshots].sort((a, b) => new Date(b.end_date).getTime() - new Date(a.end_date).getTime())[0]
    : null;

  const handleAddKPISubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKPI.titulo || !newKPI.valor) return;
    await onAddKPI(newKPI);
    setNewKPI({ titulo: '', valor: '', unidade: '', variacao: '', tipo_variacao: 'up', cor_icone: 'blue' });
    setShowAddKPIModal(false);
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
      <div>
        <h2 className="text-title flex items-center gap-2">
          <Edit size={18} className="text-fg-subtle" /> Painel Administrativo
        </h2>
        <p className="text-caption mt-1">Visão geral, vendas, indicadores e dados do seu workspace.</p>
      </div>

      <SegmentedControl
        label="Seção do painel"
        width="full"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Visão Geral' },
          { value: 'sales', label: 'Vendas e Integrações' },
          { value: 'kpis', label: 'KPIs e Indicadores' },
          { value: 'inventories', label: 'Inventários e Dados' },
        ]}
      />

      {tab === 'overview' && (
        <OverviewTab companyId={companyId} companyName={companyName} companyCreatedAt={companyCreatedAt} globais={globais} latestSnapshot={latestSnapshot} />
      )}

      {tab === 'sales' && (
        <SalesTab companyId={companyId} userId={userId} userEmail={userEmail} />
      )}

      {tab === 'kpis' && (
        <Panel>
          <PanelSection padding="sm">
            <h3 className="text-title flex items-center gap-2"><Target size={16} className="text-fg-subtle" /> KPIs e Indicadores Personalizados</h3>
          </PanelSection>
          <PanelSection>
            <div className="divide-y divide-edge mb-4">
              {customKPIs.map(kpi => (
                <div key={kpi.id} className="flex items-center justify-between gap-3 py-3 group">
                  <div className="min-w-0">
                    <p className="text-caption uppercase">{kpi.titulo}</p>
                    <p className="text-lg font-semibold text-fg mt-1">{kpi.valor} <span className="text-sm font-normal text-fg-muted">{kpi.unidade}</span></p>
                    <p className="text-caption mt-1 truncate">{kpi.variacao}</p>
                  </div>
                  <button
                    onClick={() => onDeleteKPI(kpi.id)}
                    aria-label={`Excluir KPI ${kpi.titulo}`}
                    className="text-fg-subtle hover:text-red-600 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex-shrink-0"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {customKPIs.length === 0 && <p className="text-sm text-fg-subtle py-4 text-center">Nenhum KPI personalizado cadastrado.</p>}
            </div>
            <Button onClick={() => setShowAddKPIModal(true)} className="w-full"><Plus size={16} /> Adicionar Novo KPI</Button>
          </PanelSection>
        </Panel>
      )}

      {tab === 'inventories' && (
        <div className="space-y-6">
          <Panel>
            <PanelSection padding="sm" className="flex items-center justify-between gap-3">
              <h3 className="text-title flex items-center gap-2"><History size={16} className="text-fg-subtle" /> Inventários Recentes</h3>
              <Button size="sm" variant="secondary" onClick={onAddInventoryLine}>Nova Linha de Contagem</Button>
            </PanelSection>
            <PanelSection className="overflow-y-auto" style={{ maxHeight: '420px' }}>
              {snapshots.length === 0 ? (
                <p className="text-sm text-fg-subtle text-center py-4">Nenhum inventário arquivado ainda.</p>
              ) : (
                <div className="space-y-2">
                  {[...snapshots]
                    .sort((a, b) => new Date(b.end_date).getTime() - new Date(a.end_date).getTime())
                    .map(snapshot => (
                      <div key={snapshot.id} className="bg-surface-3 rounded-lg p-3 hover:bg-edge/60 transition cursor-pointer" onClick={() => onViewSnapshot(snapshot)}>
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-semibold text-fg text-sm">{snapshot.name}</p>
                            <p className="text-caption mt-1">{new Date(snapshot.end_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
                          </div>
                          <span className="text-accent text-xs font-medium flex items-center gap-1"><Eye size={14} /> Ver</span>
                        </div>
                        <div className="flex gap-4 mt-2 text-xs text-fg-muted">
                          <span>Progresso: <span className="font-semibold text-fg">{snapshot.progress.toFixed(1)}%</span></span>
                          <span>Acuracidade: <span className="font-semibold text-fg">{snapshot.accuracy.toFixed(1)}%</span></span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </PanelSection>
          </Panel>

          <DangerZoneSection
            role={role}
            totalSku={globais.totalSku}
            totalDone={globais.totalDone}
            totalDivergences={globais.totalDiv}
            accuracy={globais.acuracidade}
            onResetComplete={onResetComplete}
          />
        </div>
      )}

      {showAddKPIModal && (
        <KpiFormModal
          value={newKPI}
          onChange={setNewKPI}
          onSubmit={handleAddKPISubmit}
          onClose={() => setShowAddKPIModal(false)}
        />
      )}
    </div>
  );
}

interface KpiFormModalProps {
  value: Omit<CustomKPI, 'id' | 'order_index' | 'created_at' | 'updated_at'>;
  onChange: (kpi: Omit<CustomKPI, 'id' | 'order_index' | 'created_at' | 'updated_at'>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

function KpiFormModal({ value, onChange, onSubmit, onClose }: KpiFormModalProps) {
  return (
    <Modal open onClose={onClose} title="Novo KPI / Indicador" maxWidth="max-w-md">
      <div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="kpi-titulo" className="block text-sm font-medium text-fg mb-1">Título do KPI</label>
            <input
              id="kpi-titulo" type="text" required value={value.titulo}
              onChange={e => onChange({ ...value, titulo: e.target.value })}
              className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
              placeholder="Ex: Taxa de Aprovação"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="kpi-valor" className="block text-sm font-medium text-fg mb-1">Valor</label>
              <input
                id="kpi-valor" type="text" required value={value.valor}
                onChange={e => onChange({ ...value, valor: e.target.value })}
                className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
                placeholder="Ex: 95.5"
              />
            </div>
            <div>
              <label htmlFor="kpi-unidade" className="block text-sm font-medium text-fg mb-1">Unidade</label>
              <input
                id="kpi-unidade" type="text" value={value.unidade}
                onChange={e => onChange({ ...value, unidade: e.target.value })}
                className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
                placeholder="Ex: %"
              />
            </div>
          </div>
          <div>
            <label htmlFor="kpi-variacao" className="block text-sm font-medium text-fg mb-1">Variação / Descrição</label>
            <input
              id="kpi-variacao" type="text" value={value.variacao}
              onChange={e => onChange({ ...value, variacao: e.target.value })}
              className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
              placeholder="Ex: +5% vs mês anterior"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="kpi-tipo" className="block text-sm font-medium text-fg mb-1">Tipo de Variação</label>
              <select
                id="kpi-tipo" value={value.tipo_variacao}
                onChange={e => onChange({ ...value, tipo_variacao: e.target.value as 'up' | 'down' | 'neutral' })}
                className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
              >
                <option value="up">Subiu (↑)</option>
                <option value="down">Caiu (↓)</option>
                <option value="neutral">Neutro</option>
              </select>
            </div>
            <div>
              <label htmlFor="kpi-cor" className="block text-sm font-medium text-fg mb-1">Cor do Ícone</label>
              <select
                id="kpi-cor" value={value.cor_icone}
                onChange={e => onChange({ ...value, cor_icone: e.target.value as 'blue' | 'red' | 'amber' | 'emerald' })}
                className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
              >
                <option value="blue">Azul</option>
                <option value="red">Vermelho</option>
                <option value="amber">Âmbar</option>
                <option value="emerald">Verde</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-lg border border-edge text-fg text-sm font-medium hover:bg-surface-3">Cancelar</button>
            <button type="submit" className="bg-accent text-white font-semibold py-2.5 px-4 rounded-lg hover:bg-accent-strong transition flex items-center justify-center gap-2">
              <Plus size={18} /> Cadastrar KPI
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
