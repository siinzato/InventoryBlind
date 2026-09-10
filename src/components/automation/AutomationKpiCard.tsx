import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Panel, PanelSection } from '../ui';

interface AutomationKpiCardProps {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  value: ReactNode;
  context: string;
  tone?: 'default' | 'critical';
}

/** Mesmo padrão de card individual do KpisIndicadoresPage.tsx (título → valor →
 *  contexto, cada indicador seu próprio Panel) — aqui com o selo de ícone que a
 *  referência do módulo pede. Compartilhado entre a visão geral de Automações e
 *  a aba Execuções — mesma composição visual, indicadores diferentes. */
export function AutomationKpiCard({ icon: Icon, iconClass, title, value, context, tone = 'default' }: AutomationKpiCardProps) {
  return (
    <Panel>
      <PanelSection padding="md" className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${iconClass}`}>
            <Icon size={14} />
          </span>
          <p className="text-label">{title}</p>
        </div>
        <p className={`font-display text-2xl font-semibold tabular-nums tracking-tight ${tone === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-fg'}`}>
          {value}
        </p>
        <p className="text-caption">{context}</p>
      </PanelSection>
    </Panel>
  );
}
