import { useEffect, useState } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, resolveInsightIcon } from '../ui';
import { getBlindAISituations } from '../../lib/blindAIInsightsEngine';
import { getSupplementalInsights, type AnalyticsInsight } from '../../lib/analytics/iaInsightsSupplement';
import type { BlindAISituation } from '../../lib/supabase';

interface IaInsightsPageProps {
  companyId: string;
  onNavigate: (tab: string) => void;
}

type Insight = BlindAISituation | AnalyticsInsight;

const SEVERITY_RANK: Record<AnalyticsInsight['severity'], number> = { critical: 0, warning: 1, info: 2 };

/** Marcador de severidade — só um ponto, sem rótulo: o cartão inteiro já diz o que
 *  está acontecendo, e vermelho/âmbar aqui é o único uso de cor de estado na página. */
const SEVERITY_DOT: Record<AnalyticsInsight['severity'], string | null> = {
  critical: 'bg-red-600 dark:bg-red-400',
  warning: 'bg-amber-500 dark:bg-amber-400',
  info: null,
};

/** Módulo de origem → nome do módulo, para o selo de origem e o rodapé do cartão.
 *  É só apresentação: os mesmos destinos que os cartões já usavam, escritos como
 *  nome próprio do módulo em vez de "Ver ...". */
const SOURCE_LABEL: Record<Insight['module'], string> = {
  risk: 'Inventário por Risco',
  cbc: 'Confidence Score',
  abcxyz: 'Curva ABC+XYZ',
  rca: 'Root Cause Analysis',
  'analytics-audit': 'Auditorias (Analytics)',
};

/** IA Insights — camada real de inteligência sobre o workspace: reaproveita
 *  getBlindAISituations (src/lib/blindAIInsightsEngine.ts), o motor já usado no Dashboard,
 *  aqui sem o corte de 6 cartões, e complementa com 1-2 padrões que aquele motor ainda não
 *  cobre (iaInsightsSupplement.ts). 100% aritmética sobre dados reais já calculados por
 *  Risco/CBC/ABC-XYZ/RCA/Contagens — nenhum texto é gerado por um modelo de linguagem, então
 *  não há como um SKU, quantidade ou localização ser inventada: se o padrão não aparece nos
 *  dados, o cartão simplesmente não é criado.
 *
 *  Apresentação: um cartão por padrão, em grade de duas colunas no desktop, com a mesma
 *  ordem de leitura em todos — origem, título, número principal, indicadores, evidência,
 *  ação recomendada, rodapé com o atalho para o módulo. Todo número exibido vem formatado
 *  do motor que o calculou (campos `hero`/`metrics`/`comparison`): esta página não
 *  recalcula, não arredonda e não extrai valor de dentro de frase. Padrão sem esses campos
 *  cai de volta para a frase de evidência, sem cartão vazio nem número inventado. */
export function IaInsightsPage({ companyId, onNavigate }: IaInsightsPageProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
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
    <Page width="wide">
      <PageHeader
        eyebrow="Analytics"
        title="IA Insights"
        description="Evidências que merecem atenção na sua operação."
      />

      <p className="text-caption">Padrões identificados nos dados já calculados pelo InventoryBlind.</p>

      {loading ? (
        <Panel>
          <PanelSection padding="lg" className="text-center text-fg-subtle">Analisando a operação...</PanelSection>
        </Panel>
      ) : insights.length === 0 ? (
        <Panel>
          <PanelSection padding="lg" className="text-center text-fg-subtle">
            Nenhum padrão relevante identificado nos dados atuais.
          </PanelSection>
        </Panel>
      ) : (
        <>
          {/* Divisor editorial: nomeia a seção e diz quantos padrões dispararam de fato. */}
          <div className="flex items-center gap-4">
            <p className="text-overline flex-shrink-0">Padrões identificados</p>
            <span className="h-px flex-1 bg-edge" aria-hidden="true" />
            <p className="text-caption flex-shrink-0 tabular-nums">
              {String(insights.length).padStart(2, '0')} {insights.length === 1 ? 'insight' : 'insights'}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {insights.map(s => {
              const Icon = resolveInsightIcon(s.icon, s.severity);
              const dot = SEVERITY_DOT[s.severity];
              const source = SOURCE_LABEL[s.module];
              const metrics = s.metrics ?? [];
              const comparison = s.comparison ?? [];
              return (
                <Panel key={s.id} className="flex flex-col">
                  <PanelSection padding="md" className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon size={14} className="flex-shrink-0 text-fg-subtle" />
                        <p className="text-overline truncate">{source}</p>
                      </div>
                      {dot && (
                        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                      )}
                    </div>

                    <h2 className="text-title">{s.title}</h2>

                    {s.hero ? (
                      <div>
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <p className="font-display text-5xl font-semibold tabular-nums tracking-tight text-fg">
                            {s.hero.value}
                          </p>
                          {s.hero.delta && (
                            <span
                              className={`text-sm font-medium tabular-nums ${
                                s.hero.delta.intent === 'negative'
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-fg-muted'
                              }`}
                            >
                              {s.hero.delta.value}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-fg-muted">{s.hero.caption}</p>
                      </div>
                    ) : (
                      /* Padrão sem recorte numérico: a frase do motor é o destaque. */
                      <p className="text-base leading-relaxed text-fg">{s.evidence}</p>
                    )}
                  </PanelSection>

                  {metrics.length > 0 && (
                    <PanelSection padding="md">
                      <div className="grid grid-cols-2 divide-x divide-edge">
                        {metrics.map(metric => (
                          <div key={metric.label} className="min-w-0 px-5 first:pl-0 last:pr-0">
                            <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-fg">
                              {metric.value}
                            </p>
                            <p className="text-caption mt-0.5">{metric.label}</p>
                          </div>
                        ))}
                      </div>
                    </PanelSection>
                  )}

                  {comparison.length > 0 && (
                    <PanelSection padding="md" className="space-y-3">
                      {comparison.map((row, idx) => (
                        <div key={row.label} className="flex items-center gap-3">
                          <p className="w-32 flex-shrink-0 text-sm text-fg-muted">{row.label}</p>
                          <p className="w-16 flex-shrink-0 text-sm font-medium tabular-nums text-fg">{row.value}</p>
                          {/* Escala fixa 0–100% nas duas barras: o comprimento é o próprio
                              valor, nunca normalizado pelo maior da série. */}
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                            <div
                              className={`h-full rounded-full ${idx === 0 ? 'bg-fg/75' : 'bg-accent/70'}`}
                              style={{ width: `${Math.max(0, Math.min(100, row.pct))}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </PanelSection>
                  )}

                  <PanelSection padding="md" className="space-y-2.5">
                    <p className="text-overline">Evidência</p>
                    <p className="text-sm leading-relaxed text-fg-muted">{s.evidence}</p>
                    {/* Os fatores só aparecem aqui quando não viraram indicadores acima —
                        assim o mesmo número nunca é dito duas vezes no cartão. */}
                    {metrics.length === 0 && s.reasons.length > 0 && (
                      <ul className="space-y-1">
                        {s.reasons.map((reason, idx) => (
                          <li key={idx} className="text-caption leading-relaxed">{reason}</li>
                        ))}
                      </ul>
                    )}
                  </PanelSection>

                  <PanelSection padding="md" className="space-y-2.5">
                    <p className="text-overline">Ação recomendada</p>
                    <p className="text-sm leading-relaxed text-fg-muted">{s.recommendation}</p>
                  </PanelSection>

                  {/* mt-auto alinha os rodapés dos cartões da linha sem impor altura fixa. */}
                  <PanelSection
                    padding="sm"
                    className="mt-auto flex flex-wrap items-center justify-between gap-3"
                  >
                    <p className="text-caption">Origem: {source}</p>
                    <button
                      onClick={() => onNavigate(s.module)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-colors hover:text-accent-strong"
                    >
                      {s.actionLabel}
                      <ArrowRight size={14} className="flex-shrink-0" />
                    </button>
                  </PanelSection>
                </Panel>
              );
            })}
          </div>

          <p className="flex items-center justify-center gap-2 text-caption">
            <ShieldCheck size={14} className="flex-shrink-0" />
            Sem evidência suficiente, o padrão não é exibido.
          </p>
        </>
      )}
    </Page>
  );
}
