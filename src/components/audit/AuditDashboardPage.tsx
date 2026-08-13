import { useState } from 'react';
import { Calculator, GitCompareArrows, Sigma, TrendingUp } from 'lucide-react';
import { Page, PageHeader, SegmentedControl, type SegmentedOption } from '../ui';
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

const SUBMODULES: SegmentedOption<AuditSubModule>[] = [
  { value: 'simulacao', label: 'Simulação de Inventário', icon: Calculator },
  { value: 'cruzada', label: 'Auditoria Cruzada', icon: GitCompareArrows },
  { value: 'estatistica', label: 'Auditoria Estatística', icon: Sigma },
  { value: 'tendencia', label: 'Análise de Tendência', icon: TrendingUp },
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
    <Page>
      <PageHeader
        title="Auditoria de Estoque"
        description="Ferramentas avançadas de planejamento, rastreabilidade e análise estatística sobre as contagens e divergências já registradas."
      />

      <SegmentedControl
        label="Submódulo de auditoria"
        options={SUBMODULES}
        value={submodule}
        onChange={setSubmodule}
      />

      {submodule === 'simulacao' && <InventorySimulationPanel companyId={companyId} />}
      {submodule === 'cruzada' && <CrossCheckPanel companyId={companyId} userId={userId} userEmail={userEmail} canEdit={canEdit} />}
      {submodule === 'estatistica' && <StatisticalAuditPanel companyId={companyId} userId={userId} userEmail={userEmail} />}
      {submodule === 'tendencia' && <TrendAnalysisPanel companyId={companyId} />}
    </Page>
  );
}
