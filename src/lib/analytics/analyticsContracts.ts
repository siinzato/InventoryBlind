// Contratos compartilhados dos 4 recursos de Analytics (BlindScore, Inventory Health,
// IA Insights, Auditorias). Reaproveita a primitiva "métrica honesta" já criada para a
// camada de inteligência de ERP (src/lib/intelligence/contracts.ts) — MetricValue não é
// específico de ERP, é o mecanismo geral que impede renderizar um 0 falso quando o dado
// não existe. O healthEngine/analyticsEngine daquele módulo, esses sim, são específicos de
// conexão ERP (leem integration_intelligence_snapshot) e não servem de base para este score,
// que lê contagens/RCA/ABC-XYZ — por isso um engine novo, não uma extensão daquele.
import { available, unavailable, isAvailable, UNAVAILABLE_COPY } from '../intelligence/contracts';
import type { MetricValue, UnavailableReason } from '../intelligence/contracts';
import type { AbcXyzCombo } from '../domainTypes';

export { available, unavailable, isAvailable, UNAVAILABLE_COPY };
export type { MetricValue, UnavailableReason };

export type AnalyticsFactorKey =
  | 'accuracy'
  | 'divergence_rate'
  | 'reliability'
  | 'abcxyz_risk'
  | 'recurrence';

export const FACTOR_LABEL: Record<AnalyticsFactorKey, string> = {
  accuracy: 'Acuracidade das contagens',
  divergence_rate: 'Taxa de divergências reais',
  reliability: 'Confiabilidade das contagens (reconferência)',
  abcxyz_risk: 'SKUs de risco (ABC/XYZ)',
  recurrence: 'Reincidência de divergências (RCA)',
};

export interface AnalyticsDeduction {
  factor: AnalyticsFactorKey;
  label: string;
  /** Pontos deduzidos de 100. */
  points: number;
  /** Frase que explica o número real por trás da dedução — nunca um julgamento sem evidência. */
  detail: string;
}

export type BlindScoreStatus = 'excelente' | 'bom' | 'atencao' | 'critico' | 'indisponivel';

export const BLIND_SCORE_STATUS_LABEL: Record<BlindScoreStatus, string> = {
  excelente: 'Excelente',
  bom: 'Bom',
  atencao: 'Requer atenção',
  critico: 'Crítico',
  indisponivel: 'Indisponível',
};

export interface BlindScoreResult {
  status: BlindScoreStatus;
  /** 0-100, ou null se nenhum fator pôde ser avaliado. */
  score: number | null;
  deductions: AnalyticsDeduction[];
  evaluatedFactors: AnalyticsFactorKey[];
  skippedFactors: { factor: AnalyticsFactorKey; reason: UnavailableReason }[];
  /** Fatores avaliados com a menor dedução — "principais fatores positivos". */
  positives: AnalyticsDeduction[];
  /** Fatores avaliados com a maior dedução (>0) — "principais fatores negativos". */
  negatives: AnalyticsDeduction[];
  /** Acurácia real por sessão de contagem, em ordem cronológica — a evolução real disponível. */
  accuracyTrend: { period: string; value: number }[];
}

export type IndicatorStatus = 'saudavel' | 'atencao' | 'critico' | 'indisponivel';

export const INDICATOR_STATUS_LABEL: Record<IndicatorStatus, string> = {
  saudavel: 'Saudável',
  atencao: 'Atenção',
  critico: 'Crítico',
  indisponivel: 'Indisponível',
};

export const INDICATOR_STATUS_BADGE: Record<IndicatorStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  saudavel: 'success',
  atencao: 'warning',
  critico: 'danger',
  indisponivel: 'neutral',
};

export type HealthIndicatorDrill =
  | { kind: 'abcxyz_risk'; combos: AbcXyzCombo[] }
  | { kind: 'recurrence' }
  | { kind: 'location'; location: string };

export interface HealthIndicator {
  key: string;
  label: string;
  status: IndicatorStatus;
  metric: MetricValue<number>;
  unit: '%' | 'un';
  detail: string;
  drill?: HealthIndicatorDrill;
}
