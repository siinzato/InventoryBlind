import { Panel, PanelSection, Badge } from '../ui';
import type { WarehouseInsight } from '../../lib/supabase';

interface WarehouseInsightsStripProps {
  insights: WarehouseInsight[];
  /** Quando presente, cards com um endereço exato viram clicáveis: clicar leva a câmera do
   *  mapa até lá (zoom + destaque) e abre o painel de posição — "detectou problema, clique
   *  e vá até ele". */
  onFocus?: (locationCode: string) => void;
}

const SEVERITY_TEXT: Record<WarehouseInsight['severity'], string> = {
  info: 'text-fg',
  warning: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
};

const SEVERITY_BADGE: Record<WarehouseInsight['severity'], 'neutral' | 'warning' | 'danger'> = {
  info: 'neutral',
  warning: 'warning',
  critical: 'danger',
};

/** Um único Panel com linhas divididas (não N cards separados) — regra de linguagem
 *  visual do app: agrupar informação relacionada num bloco só, com divisores discretos.
 *  Cada linha responde às 3 perguntas do Intelligence Panel: o que está acontecendo
 *  (título/impacto), onde (badge de localização) e o que fazer (recomendação). */
export function WarehouseInsightsStrip({ insights, onFocus }: WarehouseInsightsStripProps) {
  if (insights.length === 0) {
    return (
      <Panel>
        <PanelSection padding="md" className="text-sm text-fg-subtle">
          Sem insights automáticos ainda — volte após mais operações registradas.
        </PanelSection>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelSection padding="sm" className="divide-y divide-edge">
        {insights.map(insight => {
          const clickable = !!onFocus && !!insight.focusLocationCode;
          return (
            <div
              key={insight.id}
              onClick={clickable ? () => onFocus!(insight.focusLocationCode!) : undefined}
              className={`flex items-start gap-3 py-3 first:pt-0 last:pb-0 -mx-1 px-1 rounded-lg transition-colors ${clickable ? 'cursor-pointer hover:bg-surface-3/60' : ''}`}
              title={clickable ? 'Ver no mapa' : undefined}
            >
              <span className="text-lg leading-none flex-shrink-0 mt-0.5">{insight.icon}</span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-sm font-semibold ${SEVERITY_TEXT[insight.severity]}`}>{insight.title}</p>
                  {insight.location && <Badge variant={SEVERITY_BADGE[insight.severity]}>{insight.location}</Badge>}
                </div>
                <p className="text-sm text-fg-muted">{insight.impact}</p>
                <p className="text-xs text-fg-subtle">→ {insight.recommendation}</p>
              </div>
            </div>
          );
        })}
      </PanelSection>
    </Panel>
  );
}
