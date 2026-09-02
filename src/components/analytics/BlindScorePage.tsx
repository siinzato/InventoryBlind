import { useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, ChevronRight, Gauge, ShieldCheck } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Badge, Button, Stat, ListRow } from '../ui';
import { getAnalyticsRawData } from '../../lib/analytics/analyticsDataService';
import { computeBlindScore } from '../../lib/analytics/blindScoreEngine';
import {
  BLIND_SCORE_STATUS_LABEL, EVIDENCE_LABEL, VALIDATION_QUALITY_LABEL,
  type BlindScoreResult, type RiskSeverity,
} from '../../lib/analytics/analyticsContracts';
import { ScoreGauge, AccuracyTrendChart } from './AnalyticsCharts';

interface BlindScorePageProps {
  companyId: string;
  /** Navega para outra aba do app (mesmo mecanismo de IaInsightsPage) — o BlindScore é uma
   *  camada executiva que direciona aos módulos especialistas, nunca duplica a tela deles. */
  onNavigate: (tab: string) => void;
}

const STATUS_BADGE: Record<BlindScoreResult['status'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  excelente: 'success',
  bom: 'success',
  atencao: 'warning',
  critico: 'danger',
  provisorio: 'warning',
  indisponivel: 'neutral',
};

const EVIDENCE_BADGE = { alta: 'success', moderada: 'warning', baixa: 'danger' } as const;
const VALIDATION_BADGE = { alta: 'success', moderada: 'warning', baixa: 'danger', nao_avaliada: 'neutral' } as const;
const SEVERITY_DOT: Record<RiskSeverity, string> = {
  alta: 'bg-red-500',
  media: 'bg-amber-500',
  baixa: 'bg-fg-subtle',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

function formatTime(iso: string | null): string {
  if (!iso) return 'Confidence Score nunca recalculado';
  return `${new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · Fonte: Confidence Score`;
}

/** Texto da indisponibilidade dos pilares — cada causa real tem a sua, nunca a mesma frase
 *  genérica para situações diferentes (ver PillarsUnavailableReason). */
const PILLARS_UNAVAILABLE_COPY = {
  no_evaluated_products: 'Nenhum produto tem evidência suficiente ainda, então não há base para agregar os pilares de confiança.',
  stale_algorithm: 'Os produtos avaliados foram pontuados por uma versão anterior do Confidence Score e ainda não possuem os fatores detalhados da versão atual. Recalcule o Confidence Score para liberar esta análise.',
} as const;

/** BlindScore — confiança consolidada do estoque, composta a partir da inteligência de confiança
 *  por SKU que o CBC já mantém (blindScoreEngine.ts), nunca uma nota própria por dedução.
 *  Responde: quanto confiar, quantos produtos sustentam a leitura, por que ela ainda é
 *  provisória, o que sustenta/reduz a confiança e o que fazer agora. */
export function BlindScorePage({ companyId, onNavigate }: BlindScorePageProps) {
  const [result, setResult] = useState<BlindScoreResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getAnalyticsRawData(companyId).then(raw => {
      setResult(computeBlindScore(raw));
      setLoading(false);
    });
  }, [companyId]);

  if (loading || !result) {
    return (
      <Page>
        <PageHeader
          eyebrow="Analytics"
          title="BlindScore"
          description="Índice de 0 a 100 que resume a confiabilidade dos saldos de estoque deste workspace."
        />
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Calculando BlindScore...</PanelSection></Panel>
      </Page>
    );
  }

  const { coverage, validation } = result;
  const showCoverageBlock = coverage.gap > 0 || result.staleEvaluation;

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics"
        title="BlindScore"
        description="Índice de 0 a 100 que resume a confiabilidade dos saldos de estoque deste workspace."
      />

      {/* Resumo executivo. Grid explícito com colunas minmax(0,1fr): a coluna da nota pode
          crescer, as três de contexto nunca ultrapassam o container — era daí que vinha o
          corte horizontal de "Última atualização" na versão anterior. */}
      <Panel>
        <PanelSection padding="md">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))] lg:gap-0 lg:divide-x lg:divide-edge">
            <div className="flex min-w-0 items-center gap-4 lg:pr-6">
              <ScoreGauge score={result.score} status={result.status} size={128} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Gauge size={14} className="flex-shrink-0 text-fg-subtle" />
                  <Badge variant={STATUS_BADGE[result.status]}>{BLIND_SCORE_STATUS_LABEL[result.status]}</Badge>
                </div>
                <p className="mt-2 text-sm text-fg-muted">{result.summary}</p>
              </div>
            </div>

            <div className="min-w-0 lg:px-6">
              <Stat
                label="Cobertura da análise"
                value={`${Math.round(coverage.pct)}%`}
                context={`${coverage.evaluated.toLocaleString('pt-BR')} de ${coverage.totalCatalog.toLocaleString('pt-BR')} produtos avaliados`}
              />
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(coverage.pct, coverage.evaluated > 0 ? 1 : 0))}%` }} />
              </div>
              <Badge variant={EVIDENCE_BADGE[coverage.evidence]} className="mt-2">{EVIDENCE_LABEL[coverage.evidence]}</Badge>
            </div>

            <div className="min-w-0 lg:px-6">
              <Stat
                label="Qualidade da validação"
                value={VALIDATION_QUALITY_LABEL[validation.quality]}
                context={validation.sampleChains > 0
                  ? `${Math.round(validation.pctRecontagens)}% com recontagem · ${Math.round(validation.pctIndependentes)}% independentes`
                  : validation.totalChains > 0
                    ? `Nenhuma cadeia de reconferência disponível em ${validation.totalChains} contagem(ns)`
                    : 'Nenhuma contagem registrada ainda'}
              />
              {validation.sampleChains === 0 && (
                <Badge variant={VALIDATION_BADGE.nao_avaliada} className="mt-2">Sem amostra</Badge>
              )}
            </div>

            <div className="min-w-0 lg:pl-6">
              <Stat label="Última leitura" value={formatDate(result.lastRecalculatedAt)} context={formatTime(result.lastRecalculatedAt)} />
            </div>
          </div>
        </PanelSection>
      </Panel>

      {/* Cobertura baixa como bloco útil, não como página vazia. */}
      {showCoverageBlock && (
        <Panel>
          <PanelSection padding="md" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <BarChart3 size={18} className="mt-0.5 flex-shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">
                  {result.status === 'provisorio' ? 'Por que a leitura ainda é provisória' : 'Cobertura da leitura do catálogo'}
                </p>
                <p className="mt-1 text-sm text-fg-muted">
                  {coverage.evaluated.toLocaleString('pt-BR')} produtos possuem evidência suficiente.
                  {coverage.gap > 0 && ` Faltam ${coverage.gap.toLocaleString('pt-BR')} produtos para uma leitura completa do catálogo.`}
                </p>
                {result.staleEvaluation && (
                  <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
                    Os produtos avaliados foram pontuados por uma versão anterior do Confidence Score — recalcule para atualizar a leitura.
                  </p>
                )}
              </div>
            </div>
            <Button variant="secondary" size="sm" className="flex-shrink-0" onClick={() => onNavigate('cbc')}>
              Abrir Confidence Score
            </Button>
          </PanelSection>
        </Panel>
      )}

      {/* O que sustenta a confiança — sempre com a base explícita, nunca dando a entender que
          representa o catálogo inteiro. */}
      <Panel>
        <PanelSection padding="sm" className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-section"><ShieldCheck size={14} className="text-fg-subtle" /> O que sustenta sua confiança</p>
          {result.pillars.length > 0 && (
            <p className="text-caption">
              Base: {result.pillarsBase.toLocaleString('pt-BR')} produtos avaliáveis · {Math.round(coverage.pct)}% do catálogo
            </p>
          )}
        </PanelSection>
        <PanelSection padding="md">
          {result.pillars.length === 0 ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">Pilares ainda indisponíveis</p>
                <p className="mt-1 text-sm text-fg-muted">
                  {result.pillarsUnavailable ? PILLARS_UNAVAILABLE_COPY[result.pillarsUnavailable] : ''}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="flex-shrink-0" onClick={() => onNavigate('cbc')}>
                Abrir Confidence Score
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
              {result.pillars.map(pillar => (
                <div key={pillar.key} className="min-w-0">
                  <p className="text-label truncate">{pillar.label}</p>
                  <p className="mt-1 font-display text-2xl font-semibold tabular-nums tracking-tight text-fg">
                    {pillar.value}<span className="text-sm font-normal text-fg-subtle">/100</span>
                  </p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${pillar.value}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-fg-subtle">{pillar.reading}</p>
                </div>
              ))}
            </div>
          )}
        </PanelSection>
      </Panel>

      {/* Prioridades operacionais: o que fazer (determinístico) + a evidência por trás. */}
      {(result.recommendations.length > 0 || result.reducingFactors.length > 0) && (
        <Panel>
          <PanelSection padding="sm">
            <p className="flex items-center gap-1.5 text-section"><AlertTriangle size={14} className="text-amber-500" /> Prioridades para aumentar a confiança</p>
          </PanelSection>

          {result.recommendations.length > 0 && (
            <PanelSection padding="md" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {result.recommendations.map((rec, index) => (
                <div key={rec.key} className="flex min-w-0 gap-3">
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold tabular-nums text-accent">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{rec.title}</p>
                    <p className="mt-0.5 text-xs text-fg-subtle">{rec.detail}</p>
                    {rec.navigateTo && rec.actionLabel && (
                      <button
                        type="button"
                        onClick={() => onNavigate(rec.navigateTo as string)}
                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                      >
                        {rec.actionLabel}
                        <ChevronRight size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </PanelSection>
          )}

          {result.reducingFactors.length > 0 && (
            <PanelSection padding="sm">
              <p className="text-label mb-1">O que está reduzindo sua confiança</p>
              {result.reducingFactors.map(item => (
                <ListRow
                  key={item.key}
                  value={item.navigateTo ? <ChevronRight size={16} className="text-fg-subtle" /> : undefined}
                  onClick={item.navigateTo ? () => onNavigate(item.navigateTo as string) : undefined}
                  title={item.actionLabel}
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${SEVERITY_DOT[item.severity]}`} />
                    <div className="min-w-0">
                      <p className="text-sm text-fg">
                        <span className="font-semibold tabular-nums">{item.count.toLocaleString('pt-BR')}</span> {item.unit} · {item.label.toLowerCase()}
                      </p>
                      <p className="text-xs text-fg-subtle">{item.detail}</p>
                    </div>
                  </div>
                </ListRow>
              ))}
            </PanelSection>
          )}
        </Panel>
      )}

      {result.abcXyzExposure && (
        <Panel>
          <PanelSection padding="sm">
            <p className="text-section">Exposição operacional relacionada <span className="text-caption font-normal">(contexto, não impacta a pontuação)</span></p>
          </PanelSection>
          <PanelSection padding="sm">
            <ListRow value={<ChevronRight size={16} className="text-fg-subtle" />} onClick={() => onNavigate('abcxyz')}>
              <p className="text-sm text-fg">
                <span className="font-semibold tabular-nums">{result.abcXyzExposure.highRiskCount.toLocaleString('pt-BR')}</span> SKUs de prioridade alta/máxima
              </p>
              <p className="text-xs text-fg-subtle">
                De {result.abcXyzExposure.totalClassified.toLocaleString('pt-BR')} SKUs classificados em ABC/XYZ.
              </p>
            </ListRow>
          </PanelSection>
        </Panel>
      )}

      {/* Evolução + transparência no mesmo Panel: o gráfico tem poucos pontos reais, e um painel
          só para ele deixaria uma área vazia grande. */}
      <Panel>
        <PanelSection padding="md">
          <p className="text-section mb-2">Evolução da acuracidade observada</p>
          <AccuracyTrendChart points={result.accuracyTrend} />
        </PanelSection>
        <PanelSection padding="sm">
          <details>
            <summary className="cursor-pointer select-none text-sm font-medium text-fg">Como o BlindScore funciona</summary>
            <dl className="mt-3 space-y-1.5 text-sm text-fg-muted">
              <div><dt className="inline font-medium text-fg">BlindScore</dt><dd className="inline"> = média consolidada do Confidence Score dos produtos com evidência suficiente.</dd></div>
              <div><dt className="inline font-medium text-fg">Cobertura</dt><dd className="inline"> = parcela do catálogo com dados suficientes para sustentar a leitura.</dd></div>
              <div><dt className="inline font-medium text-fg">Validação</dt><dd className="inline"> = qualidade do processo de reconferência, avaliada somente quando há amostra.</dd></div>
              <div><dt className="inline font-medium text-fg">Riscos relacionados</dt><dd className="inline"> = contexto operacional, nunca deduções aplicadas duas vezes.</dd></div>
            </dl>
          </details>
        </PanelSection>
      </Panel>
    </Page>
  );
}
