// Inventory Health — "por que o estoque está assim", granular por indicador. Os mesmos 5
// fatores do BlindScore (blindScoreEngine.ts resume em uma nota; aqui cada um vira um cartão
// com status e ponto de aprofundamento), mais "Saúde por localização" e os indicadores que os
// dados do workspace ainda não sustentam — esses ficam explicitamente indisponíveis, nunca um
// 0 fabricado (ver README no topo de analyticsContracts.ts sobre MetricValue).
import type { AnalyticsRawData } from './analyticsDataService';
import {
  computeAccuracyStat, computeDivergenceRateStat, computeAbcXyzRiskStat, computeRecurrenceStat,
} from './analyticsMath';
import { topConcentration } from '../rcaAlgorithm';
import { available, unavailable, type HealthIndicator, type IndicatorStatus } from './analyticsContracts';

function worseWhenHigher(value: number, atencao: number, critico: number): IndicatorStatus {
  if (value >= critico) return 'critico';
  if (value >= atencao) return 'atencao';
  return 'saudavel';
}

function worseWhenLower(value: number, atencao: number, critico: number): IndicatorStatus {
  if (value <= critico) return 'critico';
  if (value <= atencao) return 'atencao';
  return 'saudavel';
}

/** Localização com mínimo de 5 divergências localizadas para uma leitura confiável — abaixo
 *  disso, uma única ocorrência já "concentraria" 100% e a leitura seria ruído, não sinal. */
const MIN_LOCATION_SAMPLE = 5;

export function computeHealthIndicators(raw: AnalyticsRawData): HealthIndicator[] {
  const indicators: HealthIndicator[] = [];

  const accuracyStat = computeAccuracyStat(raw.countRecords);
  indicators.push(
    accuracyStat
      ? {
          key: 'accuracy',
          label: 'Acuracidade das contagens',
          status: worseWhenLower(accuracyStat.averageAccuracy, 95, 85),
          metric: available(Math.round(accuracyStat.averageAccuracy * 10) / 10),
          unit: '%',
          detail: `Média de ${accuracyStat.sessionsConsidered} sessão(ões) de contagem.`,
        }
      : {
          key: 'accuracy',
          label: 'Acuracidade das contagens',
          status: 'indisponivel',
          metric: unavailable('insufficient_data'),
          unit: '%',
          detail: 'Nenhuma sessão de contagem com acurácia calculada ainda.',
        }
  );

  const divergenceStat = computeDivergenceRateStat(raw.countRecords);
  indicators.push(
    divergenceStat
      ? {
          key: 'divergence_rate',
          label: 'Divergências reais',
          status: worseWhenHigher(divergenceStat.ratePct, 5, 15),
          metric: available(Math.round(divergenceStat.ratePct * 10) / 10),
          unit: '%',
          detail: `${divergenceStat.totalDivergent} de ${divergenceStat.totalCounted} SKUs contados.`,
        }
      : {
          key: 'divergence_rate',
          label: 'Divergências reais',
          status: 'indisponivel',
          metric: unavailable('insufficient_data'),
          unit: '%',
          detail: 'Nenhum SKU contado ainda.',
        }
  );

  indicators.push(
    raw.crossCheckChainCount > 0
      ? {
          key: 'reliability',
          label: 'Confiabilidade das contagens',
          status: worseWhenLower(raw.crossCheckSummary.reliabilityIndex, 70, 40),
          metric: available(Math.round(raw.crossCheckSummary.reliabilityIndex)),
          unit: '%',
          detail: `${raw.crossCheckSummary.pctRecontagens.toFixed(0)}% com recontagem, ${raw.crossCheckSummary.pctAuditoriasIndependentes.toFixed(0)}% independentes, ${raw.crossCheckSummary.pctAprovadas.toFixed(0)}% aprovadas.`,
        }
      : {
          key: 'reliability',
          label: 'Confiabilidade das contagens',
          status: 'indisponivel',
          metric: unavailable('insufficient_data'),
          unit: '%',
          detail: 'Nenhuma sessão de contagem registrada ainda.',
        }
  );

  const riskStat = computeAbcXyzRiskStat(raw.abcXyzMatrix);
  indicators.push(
    riskStat
      ? {
          key: 'abcxyz_risk',
          label: 'SKUs em risco (ABC/XYZ)',
          status: worseWhenHigher(riskStat.ratePct, 20, 40),
          metric: available(riskStat.highRiskCount),
          unit: 'un',
          detail: `${riskStat.highRiskCount} de ${riskStat.totalClassified} SKUs classificados (prioridade máxima/alta).`,
          drill: { kind: 'abcxyz_risk', combos: riskStat.highRiskCombos },
        }
      : {
          key: 'abcxyz_risk',
          label: 'SKUs em risco (ABC/XYZ)',
          status: 'indisponivel',
          metric: unavailable('not_configured'),
          unit: 'un',
          detail: 'Execute o recompute de Classificação ABC/XYZ pelo menos uma vez para habilitar este indicador.',
        }
  );

  const recurrenceStat = computeRecurrenceStat(
    raw.rcaRecords,
    raw.rcaSettings.recurrence_threshold_count,
    raw.rcaSettings.recurrence_window_days
  );
  indicators.push(
    recurrenceStat
      ? {
          key: 'recurrence',
          label: 'Reincidência de divergências',
          status: worseWhenHigher(recurrenceStat.ratePct, 15, 35),
          metric: available(recurrenceStat.recurringSkus),
          unit: 'un',
          detail: `${recurrenceStat.recurringSkus} de ${recurrenceStat.distinctSkus} SKUs já atingiram ${recurrenceStat.thresholdCount}+ divergências em ${recurrenceStat.windowDays} dias.`,
          drill: { kind: 'recurrence' },
        }
      : {
          key: 'recurrence',
          label: 'Reincidência de divergências',
          status: 'indisponivel',
          metric: unavailable('insufficient_data'),
          unit: 'un',
          detail: 'Nenhuma divergência classificada (RCA) nos últimos 180 dias.',
        }
  );

  const locationRecords = raw.rcaRecords.filter(r => r.location);
  const topLocation = locationRecords.length >= MIN_LOCATION_SAMPLE ? topConcentration(locationRecords, 'location') : null;
  indicators.push(
    topLocation
      ? {
          key: 'location_health',
          label: 'Saúde por localização',
          status: worseWhenHigher(topLocation.pct, 25, 45),
          metric: available(Math.round(topLocation.pct * 10) / 10),
          unit: '%',
          detail: `${topLocation.label} concentra ${topLocation.pct.toFixed(0)}% das divergências localizadas.`,
          drill: { kind: 'location', location: topLocation.label },
        }
      : {
          key: 'location_health',
          label: 'Saúde por localização',
          status: 'indisponivel',
          metric: unavailable('insufficient_data'),
          unit: '%',
          detail: 'Divergências classificadas com localização ainda insuficientes para uma leitura confiável.',
        }
  );

  // Indicadores que os dados do workspace ainda não sustentam — nunca um 0 fabricado.
  indicators.push({
    key: 'stockout',
    label: 'Ruptura',
    status: 'indisponivel',
    metric: unavailable('not_stored'),
    unit: 'un',
    detail: 'Não há histórico de movimentações/vendas no InventoryBlind para detectar ruptura real.',
  });
  indicators.push({
    key: 'excess_stock',
    label: 'Excesso de estoque',
    status: 'indisponivel',
    metric: unavailable('not_configured'),
    unit: 'un',
    detail: 'Depende de estoque mínimo/máximo configurado por SKU, ainda não existente no workspace.',
  });
  indicators.push({
    key: 'no_movement',
    label: 'SKUs sem movimentação',
    status: 'indisponivel',
    metric: unavailable('not_stored'),
    unit: 'un',
    detail: 'Não há histórico de movimentações no InventoryBlind para medir SKUs parados.',
  });
  indicators.push({
    key: 'category_health',
    label: 'Saúde por categoria',
    status: 'indisponivel',
    metric: unavailable('not_stored'),
    unit: '%',
    detail: 'Produtos não possuem campo de categoria cadastrado no workspace.',
  });

  return indicators;
}
