import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Badge, resolveInsightIcon, INSIGHT_ICON_TONE } from '../ui';
import { getBlindAISituations } from '../../lib/blindAIInsightsEngine';
import { getSupplementalInsights, type AnalyticsInsight } from '../../lib/analytics/iaInsightsSupplement';
import type { BlindAISituation } from '../../lib/supabase';

interface IaInsightsPageProps {
  companyId: string;
  onNavigate: (tab: string) => void;
}

const SEVERITY_BADGE: Record<AnalyticsInsight['severity'], 'neutral' | 'warning' | 'danger'> = {
  info: 'neutral',
  warning: 'warning',
  critical: 'danger',
};

const SEVERITY_RANK: Record<AnalyticsInsight['severity'], number> = { critical: 0, warning: 1, info: 2 };

/** IA Insights — camada real de inteligência sobre o workspace: reaproveita
 *  getBlindAISituations (src/lib/blindAIInsightsEngine.ts), o motor já usado no Dashboard,
 *  aqui sem o corte de 6 cartões, e complementa com 1-2 padrões que aquele motor ainda não
 *  cobre (iaInsightsSupplement.ts). 100% aritmética sobre dados reais já calculados por
 *  Risco/CBC/ABC-XYZ/RCA/Contagens — nenhum texto é gerado por um modelo de linguagem, então
 *  não há como um SKU, quantidade ou localização ser inventada: se o padrão não aparece nos
 *  dados, o cartão simplesmente não é criado. */
export function IaInsightsPage({ companyId, onNavigate }: IaInsightsPageProps) {
  const [insights, setInsights] = useState<(BlindAISituation | AnalyticsInsight)[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getBlindAISituations(companyId), getSupplementalInsights(companyId)]).then(([base, extra]) => {
      const merged = [...base, ...extra].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
      setInsights(merged);
      setLoading(false);
    });
  }, [companyId]);

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics"
        title="IA Insights"
        description="Padrões detectados a partir de dados reais já calculados pelo sistema — divergências, risco, confiança e reincidência. Sem evidência suficiente, o padrão não aparece."
      />

      <Panel>
        {loading ? (
          <PanelSection padding="lg" className="text-center text-fg-subtle">Analisando a operação...</PanelSection>
        ) : insights.length === 0 ? (
          <PanelSection padding="lg" className="text-center text-fg-subtle">Nenhum padrão relevante identificado nos dados atuais.</PanelSection>
        ) : (
          <div className="divide-y divide-edge">
            {insights.map(s => {
              const Icon = resolveInsightIcon(s.icon, s.severity);
              return (
                <button
                  key={s.id}
                  onClick={() => onNavigate(s.module)}
                  className="w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-surface-3/60 transition-colors"
                >
                  <Icon size={16} className={`flex-shrink-0 mt-0.5 ${INSIGHT_ICON_TONE[s.severity]}`} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-fg">{s.title}</p>
                      <Badge variant={SEVERITY_BADGE[s.severity]}>{s.actionLabel}</Badge>
                    </div>
                    <p className="text-sm text-fg-muted">{s.evidence}</p>
                    <ul className="text-xs text-fg-subtle space-y-0.5">
                      {s.reasons.map((reason, idx) => <li key={idx}>• {reason}</li>)}
                    </ul>
                    <p className="flex items-start gap-1 text-xs text-fg-subtle">
                      <ArrowRight size={12} className="mt-0.5 flex-shrink-0" />
                      {s.recommendation}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Panel>
    </Page>
  );
}
