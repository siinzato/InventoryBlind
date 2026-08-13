import { ArrowRight } from 'lucide-react';
import { Panel, PanelSection, Badge, resolveInsightIcon, INSIGHT_ICON_TONE } from '../ui';
import type { WarehouseInsight } from '../../lib/supabase';

interface WarehouseInsightsStripProps {
  insights: WarehouseInsight[];
  /** Quando presente, cards com um endereço exato viram clicáveis: clicar leva a câmera do
   *  mapa até lá (zoom + destaque) e abre o painel de posição — "detectou problema, clique
   *  e vá até ele". */
  onFocus?: (locationCode: string) => void;
}

const SEVERITY_BADGE: Record<WarehouseInsight['severity'], 'neutral' | 'warning' | 'danger'> = {
  info: 'neutral',
  warning: 'warning',
  critical: 'danger',
};

/** Um único Panel com linhas divididas (não N cards separados) — regra de linguagem
 *  visual do app: agrupar informação relacionada num bloco só, com divisores discretos.
 *  Cada linha responde às 3 perguntas do Intelligence Panel: o que está acontecendo
 *  (título/impacto), onde (badge de localização) e o que fazer (recomendação).
 *
 *  O título fica sempre em `text-fg`: a severidade já é carregada pelo ícone e pelo
 *  Badge, e colorir os três ao mesmo tempo repetia o sinal três vezes. */
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
      <PanelSection padding="sm" className="divide-y divide-edge/60">
        {insights.map(insight => {
          const clickable = !!onFocus && !!insight.focusLocationCode;
          const Icon = resolveInsightIcon(insight.icon, insight.severity);

          const body = (
            <>
              <Icon size={15} className={`mt-0.5 flex-shrink-0 ${INSIGHT_ICON_TONE[insight.severity]}`} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-fg">{insight.title}</p>
                  {insight.location && <Badge variant={SEVERITY_BADGE[insight.severity]}>{insight.location}</Badge>}
                </div>
                <p className="text-sm text-fg-muted">{insight.impact}</p>
                <p className="flex items-start gap-1 text-xs text-fg-subtle">
                  <ArrowRight size={12} className="mt-0.5 flex-shrink-0" />
                  {insight.recommendation}
                </p>
              </div>
            </>
          );

          // A real <button> when actionable: the previous clickable <div> was
          // unreachable by keyboard and announced as plain text.
          if (!clickable) {
            return (
              <div key={insight.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                {body}
              </div>
            );
          }

          return (
            <button
              key={insight.id}
              type="button"
              onClick={() => onFocus!(insight.focusLocationCode!)}
              title="Ver no mapa"
              className="-mx-1 flex w-full items-start gap-3 rounded-control px-1 py-3 text-left transition-colors first:pt-0 last:pb-0 hover:bg-surface-3/60"
            >
              {body}
            </button>
          );
        })}
      </PanelSection>
    </Panel>
  );
}
