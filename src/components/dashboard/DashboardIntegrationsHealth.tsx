// "Saúde e integrações" — versão condensada, para a coluna direita do
// Dashboard. Reaproveita `IntegrationConnection` (já carregado pelo Dashboard
// via listConnections(), a mesma consulta usada em IntegrationsPage.tsx) sem
// nenhuma lógica nova de integração. O detalhamento completo (saldo negativo,
// divergências, saúde por fator etc.) continua existindo em
// ErpIntelligenceSection — este card só resume o essencial quando não há
// nenhuma conexão, como pede a referência visual.

import { Plug } from 'lucide-react';
import { Panel, PanelSection, Button } from '../ui';
import type { IntegrationConnection } from '../../lib/integrations/types';

/** Quantidade de indicadores de saúde do estoque que dependem de uma conexão
 *  ERP — mesma contagem dos StatCell renderizados em ErpIntelligenceSection
 *  (3 StatRows de 4 + a saúde do estoque). Atualizar aqui se aquele arquivo
 *  ganhar ou perder indicadores. */
const TRACKED_HEALTH_INDICATORS = 13;

interface DashboardIntegrationsHealthProps {
  /** null enquanto a lista ainda não carregou. */
  connections: IntegrationConnection[] | null;
  onConnect: () => void;
  onViewIntegrations: () => void;
}

export function DashboardIntegrationsHealth({ connections, onConnect, onViewIntegrations }: DashboardIntegrationsHealthProps) {
  if (connections == null) {
    return (
      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title">Saúde e integrações</h3>
          <p className="mt-2 text-sm text-fg-subtle">Carregando…</p>
        </PanelSection>
      </Panel>
    );
  }

  if (connections.length > 0) {
    const connected = connections.filter(c => c.status === 'active').length;
    return (
      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title">Saúde e integrações</h3>
          <p className="mt-2 text-sm text-fg-muted">
            {connections.length === 1
              ? connections[0].displayName
              : `${connections.length} integrações · ${connected} ativas`}
          </p>
          <button
            onClick={onViewIntegrations}
            className="mt-3 text-sm font-medium text-accent hover:text-accent-strong transition-colors"
          >
            Ver integrações
          </button>
        </PanelSection>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelSection padding="sm">
        <div className="flex items-start gap-3">
          <Plug size={18} className="mt-0.5 flex-shrink-0 text-fg-subtle" />
          <div className="min-w-0 flex-1">
            <h3 className="text-title">Saúde e integrações</h3>
            <p className="mt-1 text-sm font-medium text-fg-muted">Desconectado</p>
          </div>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          Conecte o estoque do seu ERP para calcular saldo negativo, rupturas e movimentações.
        </p>

        <p className="mt-2 text-xs text-fg-subtle">
          {TRACKED_HEALTH_INDICATORS} indicadores aguardando dados
        </p>

        <div className="mt-4 flex items-center gap-4">
          <Button size="sm" onClick={onConnect}>Conectar</Button>
          <button
            onClick={onViewIntegrations}
            className="text-sm font-medium text-accent hover:text-accent-strong transition-colors"
          >
            Ver integrações
          </button>
        </div>
      </PanelSection>
    </Panel>
  );
}
