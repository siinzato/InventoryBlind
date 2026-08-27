// Painel Administrativo — reformulado em áreas próprias (Visão Geral / Vendas e Integrações /
// KPIs / Inventários e Dados / Zona de Perigo). Recebe dados/handlers já carregados por App.tsx
// (brandsData/customKPIs/snapshots/globais) para não duplicar o carregamento existente; a aba de
// Vendas é totalmente nova e autossuficiente (só lê/escreve sales_*, nunca estoque/inventário).

import { useState } from 'react';
import { Edit, History, Eye } from 'lucide-react';
import { Panel, PanelSection, Button, SegmentedControl, ListRow } from '../ui';
import type { CustomKPI, InventorySnapshot } from '../../lib/supabase';
import { OverviewTab } from './OverviewTab';
import { SalesTab } from './SalesTab';
import { KpisTab } from './KpisTab';
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

  const latestSnapshot = snapshots.length > 0
    ? [...snapshots].sort((a, b) => new Date(b.end_date).getTime() - new Date(a.end_date).getTime())[0]
    : null;

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
        <SalesTab companyId={companyId} userId={userId} userEmail={userEmail} role={role} />
      )}

      {tab === 'kpis' && (
        <KpisTab
          customKPIs={customKPIs}
          onAddKPI={onAddKPI}
          onDeleteKPI={onDeleteKPI}
          snapshots={snapshots}
          onNavigateToInventories={() => setTab('inventories')}
        />
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
                <div>
                  {[...snapshots]
                    .sort((a, b) => new Date(b.end_date).getTime() - new Date(a.end_date).getTime())
                    .map(snapshot => (
                      <ListRow
                        key={snapshot.id}
                        onClick={() => onViewSnapshot(snapshot)}
                        title={snapshot.name}
                        value={<span className="flex items-center gap-1 text-accent"><Eye size={14} /> Ver</span>}
                      >
                        <p className="font-semibold text-fg text-sm">{snapshot.name}</p>
                        <p className="text-caption mt-1">{new Date(snapshot.end_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
                        <div className="flex gap-4 mt-1 text-xs text-fg-muted">
                          <span>Progresso: <span className="font-semibold text-fg">{snapshot.progress.toFixed(1)}%</span></span>
                          <span>Acuracidade: <span className="font-semibold text-fg">{snapshot.accuracy.toFixed(1)}%</span></span>
                        </div>
                      </ListRow>
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

    </div>
  );
}
