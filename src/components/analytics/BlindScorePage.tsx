import { useEffect, useState } from 'react';
import { Gauge, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Badge } from '../ui';
import { getAnalyticsRawData } from '../../lib/analytics/analyticsDataService';
import { computeBlindScore } from '../../lib/analytics/blindScoreEngine';
import { BLIND_SCORE_STATUS_LABEL, FACTOR_LABEL, UNAVAILABLE_COPY, type BlindScoreResult } from '../../lib/analytics/analyticsContracts';
import { ScoreGauge, AccuracyTrendChart } from './AnalyticsCharts';

interface BlindScorePageProps {
  companyId: string;
}

const STATUS_BADGE: Record<BlindScoreResult['status'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  excelente: 'success',
  bom: 'success',
  atencao: 'warning',
  critico: 'danger',
  indisponivel: 'neutral',
};

/** BlindScore — nota única 0-100 de confiabilidade do estoque, composta só com fatores que
 *  o workspace atual realmente sustenta (ver blindScoreEngine.ts). "Bom nível de
 *  confiabilidade, porém..." do pedido é só um exemplo visual — o texto abaixo é sempre
 *  derivado do score e das deduções reais, nunca fixo. */
export function BlindScorePage({ companyId }: BlindScorePageProps) {
  const [result, setResult] = useState<BlindScoreResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getAnalyticsRawData(companyId).then(raw => {
      setResult(computeBlindScore(raw));
      setLoading(false);
    });
  }, [companyId]);

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics"
        title="BlindScore"
        description="Índice de 0 a 100 que resume a confiabilidade do estoque deste workspace, calculado só a partir de fatores que os dados atuais sustentam."
      />

      {loading || !result ? (
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Calculando BlindScore...</PanelSection></Panel>
      ) : (
        <>
          <Panel>
            <PanelSection padding="lg" className="flex flex-col sm:flex-row items-center gap-6">
              <ScoreGauge score={result.score} status={result.status} />
              <div className="min-w-0 space-y-2 text-center sm:text-left">
                <div className="flex items-center gap-2 justify-center sm:justify-start">
                  <Gauge size={16} className="text-fg-subtle" />
                  <Badge variant={STATUS_BADGE[result.status]}>{BLIND_SCORE_STATUS_LABEL[result.status]}</Badge>
                </div>
                {result.score === null ? (
                  <p className="text-sm text-fg-muted max-w-md">
                    Ainda não há dados suficientes no workspace para calcular o BlindScore. Registre pelo menos uma
                    sessão de contagem para começar.
                  </p>
                ) : (
                  <p className="text-sm text-fg-muted max-w-md">
                    {result.negatives.length > 0
                      ? `Composto a partir de ${result.evaluatedFactors.length} de 5 fatores avaliáveis, com pontos de atenção em ${result.negatives.map(d => d.label.toLowerCase()).join(', ')}.`
                      : `Composto a partir de ${result.evaluatedFactors.length} de 5 fatores avaliáveis, sem pontos de atenção relevantes no momento.`}
                  </p>
                )}
              </div>
            </PanelSection>
          </Panel>

          {(result.positives.length > 0 || result.negatives.length > 0) && (
            <Panel>
              <PanelSection padding="md" className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <p className="flex items-center gap-1.5 text-section mb-2"><ThumbsUp size={14} className="text-emerald-600 dark:text-emerald-400" /> Principais fatores positivos</p>
                  {result.positives.length === 0 ? (
                    <p className="text-xs text-fg-subtle">Nenhum fator avaliado está isento de dedução no momento.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {result.positives.map(d => (
                        <li key={d.factor} className="text-sm text-fg-muted">{d.label} — {d.detail}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="flex items-center gap-1.5 text-section mb-2"><ThumbsDown size={14} className="text-red-600 dark:text-red-400" /> Principais fatores negativos</p>
                  {result.negatives.length === 0 ? (
                    <p className="text-xs text-fg-subtle">Nenhum fator avaliado concentra dedução relevante no momento.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {result.negatives.map(d => (
                        <li key={d.factor} className="text-sm text-fg-muted">{d.label} — {d.detail}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </PanelSection>
            </Panel>
          )}

          <Panel>
            <PanelSection padding="md">
              <p className="text-section mb-2">Evolução da acurácia</p>
              <AccuracyTrendChart points={result.accuracyTrend} />
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection padding="sm">
              <p className="text-section">Como o score foi composto</p>
            </PanelSection>
            <PanelSection padding="md" className="space-y-3">
              {result.deductions.map(d => (
                <div key={d.factor} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{d.label}</p>
                    <p className="text-xs text-fg-subtle">{d.detail}</p>
                  </div>
                  <p className="flex-shrink-0 text-sm font-medium tabular-nums text-red-600 dark:text-red-400">-{d.points.toFixed(1)}</p>
                </div>
              ))}
              {result.skippedFactors.map(s => (
                <div key={s.factor} className="flex items-start justify-between gap-4 opacity-60">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{FACTOR_LABEL[s.factor]}</p>
                    <p className="text-xs text-fg-subtle">{UNAVAILABLE_COPY[s.reason]}</p>
                  </div>
                  <Badge variant="neutral">Não avaliado</Badge>
                </div>
              ))}
            </PanelSection>
          </Panel>
        </>
      )}
    </Page>
  );
}
