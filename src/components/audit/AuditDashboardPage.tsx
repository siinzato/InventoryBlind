import { useState } from 'react';
import { PageHeader } from '../ui';
import { InventorySimulationPanel } from './InventorySimulationPanel';
import { CrossCheckPanel } from './CrossCheckPanel';
import { StatisticalAuditPanel } from './StatisticalAuditPanel';
import { TrendAnalysisPanel } from './TrendAnalysisPanel';

interface AuditDashboardPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
  role?: string;
}

type AuditSubModule = 'simulacao' | 'cruzada' | 'estatistica' | 'tendencia';

const SUBMODULES: { id: AuditSubModule; label: string; icon: string }[] = [
  { id: 'simulacao', label: 'Simulação de Inventário', icon: '🧮' },
  { id: 'cruzada', label: 'Auditoria Cruzada', icon: '🔍' },
  { id: 'estatistica', label: 'Auditoria Estatística', icon: '📐' },
  { id: 'tendencia', label: 'Análise de Tendência', icon: '📈' },
];

/** Composição raiz de "Auditoria de Estoque" — não toca em nenhum arquivo de contagem/RCA
 *  existente; cada aba lê dados já produzidos por esses módulos (inventory_count_records,
 *  user_productivity_stats_v, rca_records) através de serviços novos e isolados
 *  (auditSimulation, auditCrossCheck, statisticalAudit), no mesmo padrão de composição do
 *  Warehouse Digital Twin. */
export function AuditDashboardPage({ companyId, userId, userEmail, role }: AuditDashboardPageProps) {
  const canEdit = role === 'owner' || role === 'admin' || role === 'manager';
  const [submodule, setSubmodule] = useState<AuditSubModule>('simulacao');

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Auditoria de Estoque"
        description="Ferramentas avançadas de planejamento, rastreabilidade e análise estatística sobre as contagens e divergências já registradas."
      />

      <div className="flex flex-wrap gap-1.5">
        {SUBMODULES.map(s => (
          <button
            key={s.id}
            onClick={() => setSubmodule(s.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              submodule === s.id ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge hover:bg-surface-3'
            }`}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {submodule === 'simulacao' && <InventorySimulationPanel companyId={companyId} />}
      {submodule === 'cruzada' && <CrossCheckPanel companyId={companyId} userId={userId} userEmail={userEmail} canEdit={canEdit} />}
      {submodule === 'estatistica' && <StatisticalAuditPanel companyId={companyId} userId={userId} userEmail={userEmail} />}
      {submodule === 'tendencia' && <TrendAnalysisPanel companyId={companyId} />}
    </div>
  );
}
