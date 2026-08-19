// Analytics > IA Insights — complementa (nunca substitui) getBlindAISituations
// (src/lib/blindAIInsightsEngine.ts), que já é a camada real de inteligência do app: sem
// LLM, 100% aritmética sobre dados de Risco/CBC/ABC-XYZ/RCA já calculados, hoje truncada a 6
// cartões no Dashboard. Este arquivo só acrescenta os 2 padrões da lista do pedido que aquele
// motor ainda não cobre (concentração por localização, tendência de acurácia) — no mesmo
// formato de "situação", para a nova página os exibir junto. Não importa nem altera
// blindAIInsightsEngine.ts nem o Dashboard: zero risco para o que já funciona.
import { listRecords as listRcaRecords } from '../rcaService';
import { listCountRecords } from '../auditCrossCheckService';
import { topConcentration } from '../rcaAlgorithm';
import { computeAccuracyStat } from './analyticsMath';
import type { BlindAISituation } from '../supabase';

/** Mesmo formato de BlindAISituation, mas com um destino de navegação a mais
 *  ('analytics-audit', a página nova de Auditorias) que o union original não previa — por
 *  isso um tipo local em vez de alargar o tipo compartilhado usado pelo Dashboard. */
export interface AnalyticsInsight extends Omit<BlindAISituation, 'module'> {
  module: BlindAISituation['module'] | 'analytics-audit';
}

const SINCE_90D = () => new Date(Date.now() - 90 * 86400000).toISOString();

/** ⚠️ Concentração de divergências em uma localização — "Aumento de divergências detectado"
 *  do pedido, na dimensão de localização. Limiar de 30% e amostra mínima de 5 seguem o mesmo
 *  padrão de significância de blindAIInsightsEngine (pctOfTotal >= 25 / topSkusPct >= 30). */
async function getLocationConcentrationInsight(companyId: string): Promise<AnalyticsInsight | null> {
  const records = (await listRcaRecords(companyId, { from: SINCE_90D() })).filter(r => r.location);
  if (records.length < 5) return null;

  const top = topConcentration(records, 'location');
  if (!top || top.pct < 30) return null;

  return {
    id: 'analytics-location-concentration',
    icon: '⚠️',
    severity: top.pct >= 50 ? 'critical' : 'warning',
    title: 'Localização com concentração de divergências',
    evidence: `${top.label} concentra ${Math.round(top.pct)}% das divergências registradas nos últimos 90 dias`,
    reasons: [`${records.length} divergência(s) com localização registrada no período`],
    recommendation: 'Investigar o processo dessa localização antes de agir sobre as demais.',
    module: 'rca',
    actionLabel: 'Ver Root Cause Analysis',
  };
}

/** 📈 / 📦 Deterioração ou melhoria de acurácia — compara a primeira metade das sessões com
 *  acurácia calculada contra a segunda metade (mesmo racional de rcaAlgorithm.computeTrend:
 *  metades, não mês-a-mês, para não depender de meses cheios). Exige pelo menos 4 sessões
 *  para as duas metades terem volume mínimo de leitura. */
async function getAccuracyTrendInsight(companyId: string): Promise<AnalyticsInsight | null> {
  const records = await listCountRecords(companyId);
  const stat = computeAccuracyStat(records);
  if (!stat || stat.series.length < 4) return null;

  const mid = Math.floor(stat.series.length / 2);
  const firstHalf = stat.series.slice(0, mid);
  const secondHalf = stat.series.slice(mid);
  const avg = (points: { value: number }[]) => points.reduce((sum, p) => sum + p.value, 0) / points.length;
  const avgFirst = avg(firstHalf);
  const avgSecond = avg(secondHalf);
  const deltaPoints = avgSecond - avgFirst;

  if (Math.abs(deltaPoints) < 5) return null;

  const improving = deltaPoints > 0;
  return {
    id: 'analytics-accuracy-trend',
    icon: improving ? '📈' : '⚠️',
    severity: improving ? 'info' : Math.abs(deltaPoints) >= 15 ? 'critical' : 'warning',
    title: improving ? 'Melhoria de acurácia detectada' : 'Deterioração de acurácia detectada',
    evidence: `Acurácia média foi de ${avgFirst.toFixed(1)}% para ${avgSecond.toFixed(1)}% entre a primeira e a segunda metade das sessões de contagem registradas`,
    reasons: [`${stat.sessionsConsidered} sessão(ões) de contagem com acurácia calculada`],
    recommendation: improving
      ? 'Manter o processo atual de contagem, que vem melhorando a acurácia.'
      : 'Investigar o que mudou no processo de contagem nas sessões mais recentes.',
    module: 'analytics-audit',
    actionLabel: 'Ver Auditorias (Analytics)',
  };
}

/** Roda os padrões complementares em paralelo e devolve só os que de fato dispararam —
 *  nunca inventa um item para preencher a lista. */
export async function getSupplementalInsights(companyId: string): Promise<AnalyticsInsight[]> {
  const [location, accuracyTrend] = await Promise.all([
    getLocationConcentrationInsight(companyId),
    getAccuracyTrendInsight(companyId),
  ]);
  return [location, accuracyTrend].filter((i): i is AnalyticsInsight => i !== null);
}
