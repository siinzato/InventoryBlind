// "Prioridades agora" — lista compacta derivada exclusivamente de `globais`
// (já carregado pelo Dashboard a partir de inventory_brands) e do estado de
// conexão ERP (já carregado pelo Dashboard para a seção de Saúde e integrações
// — recebido aqui, nenhuma consulta própria). Nenhum item é inventado: cada
// linha só aparece quando a condição real que ela descreve é verdadeira.

import { AlertTriangle, Plug, PlayCircle, ArrowRight } from 'lucide-react';
import { Panel, PanelSection, Button } from '../ui';
import type { GlobalStats } from '../../lib/blindAIAgentAlgorithm';

interface DashboardPrioritiesProps {
  globais: GlobalStats;
  /** null enquanto a checagem de conexões ainda não terminou (ou usuário sem
   *  permissão de sincronizar integrações) — nesse caso o item nunca aparece. */
  erpDisconnected: boolean | null;
  onRecount: () => void;
  onContinueCounting: () => void;
  onConnectErp: () => void;
  onViewAll: () => void;
}

interface PriorityRow {
  key: string;
  icon: typeof AlertTriangle;
  tone: 'critical' | 'default';
  title: string;
  context: string;
  actionLabel: string;
  onAction: () => void;
}

export function DashboardPriorities({
  globais,
  erpDisconnected,
  onRecount,
  onContinueCounting,
  onConnectErp,
  onViewAll,
}: DashboardPrioritiesProps) {
  const rows: PriorityRow[] = [];

  if (globais.totalDiv > 0) {
    const worst = [...globais.tabela]
      .filter(b => b.divergences > 0)
      .sort((a, b) => b.divergences - a.divergences)[0];
    rows.push({
      key: 'divergences',
      icon: AlertTriangle,
      tone: 'critical',
      title: `${globais.totalDiv.toLocaleString('pt-BR')} divergências aguardam recontagem`,
      context: worst ? `Maior concentração: ${worst.brand} · ${worst.divergences} unidades` : 'Aguardando recontagem',
      actionLabel: 'Recontar',
      onAction: onRecount,
    });
  }

  const inProgress = globais.tabela.find(b => b.status === 'ANDAMENTO');
  if (inProgress) {
    rows.push({
      key: 'continue',
      icon: PlayCircle,
      tone: 'default',
      title: `Continuar contagem da linha ${inProgress.brand}`,
      context: `${inProgress.doneSku} de ${inProgress.totalSku} SKUs · ${inProgress.progress.toFixed(1)}%`,
      actionLabel: 'Continuar',
      onAction: onContinueCounting,
    });
  }

  if (erpDisconnected) {
    rows.push({
      key: 'erp',
      icon: Plug,
      tone: 'default',
      title: 'Conectar o estoque do ERP',
      context: 'Indicadores de saúde ainda indisponíveis',
      actionLabel: 'Configurar',
      onAction: onConnectErp,
    });
  }

  return (
    <Panel>
      <PanelSection padding="sm" className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-title">Prioridades agora</h3>
          <p className="text-caption mt-0.5">O que exige ação da operação</p>
        </div>
        <Button variant="ghost" size="sm" className="flex-shrink-0" onClick={onViewAll}>
          Ver Meu Trabalho <ArrowRight size={13} />
        </Button>
      </PanelSection>

      {rows.length === 0 ? (
        <PanelSection padding="sm">
          <p className="text-sm text-fg-subtle">Nenhuma prioridade pendente no momento.</p>
        </PanelSection>
      ) : (
        <div className="divide-y divide-edge">
          {rows.map(row => (
            <div key={row.key} className="flex items-center gap-3 px-6 py-3">
              <row.icon
                size={16}
                className={`flex-shrink-0 ${row.tone === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-fg-subtle'}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg truncate">{row.title}</p>
                <p className="text-xs text-fg-subtle truncate">{row.context}</p>
              </div>
              <Button variant="ghost" size="sm" className="flex-shrink-0" onClick={row.onAction}>
                {row.actionLabel} <ArrowRight size={13} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
