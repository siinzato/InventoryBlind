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

// BlindScore V2 — a nota principal vem direto do CBC (cbc_company_summary_v.avg_confidence),
// não de uma dedução própria. Os tipos abaixo descrevem a composição executiva em torno dela
// (cobertura, validação, pilares, riscos), nunca um segundo cálculo de confiança por SKU.

export type EvidenceLevel = 'alta' | 'moderada' | 'baixa';

export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  alta: 'Evidência alta',
  moderada: 'Evidência moderada',
  baixa: 'Evidência baixa',
};

export interface CoverageStat {
  /** Produtos com has_sufficient_data = true (confiança realmente calculável). */
  evaluated: number;
  /** Total real de products do workspace — nunca assumido a partir de product_confidence_scores. */
  totalCatalog: number;
  /** Produtos que ainda não sustentam a leitura (totalCatalog - evaluated, nunca negativo). */
  gap: number;
  pct: number;
  evidence: EvidenceLevel;
}

export type ValidationQuality = 'alta' | 'moderada' | 'baixa' | 'nao_avaliada';

export const VALIDATION_QUALITY_LABEL: Record<ValidationQuality, string> = {
  alta: 'Alta',
  moderada: 'Moderada',
  baixa: 'Baixa',
  nao_avaliada: 'Não avaliada',
};

export interface ValidationStat {
  quality: ValidationQuality;
  totalChains: number;
  /** Cadeias com recontagem — a base real de avaliação. Sem ela, a qualidade do processo não é
   *  "baixa", é "não avaliada": ausência de reconferência não é julgamento negativo. */
  sampleChains: number;
  pctRecontagens: number;
  pctIndependentes: number;
  pctAprovadas: number;
}

export interface PillarScore {
  key: 'accuracyHistory' | 'recency' | 'stability' | 'integrity';
  label: string;
  /** 0-100, já normalizado (score/max do próprio fator do CBC). */
  value: number;
  /** Leitura curta e determinística derivada do próprio valor. */
  reading: string;
}

/** Por que os pilares não pôde ser agregados — estados reais e distinguíveis pelos dados, nunca
 *  a mesma mensagem genérica para causas diferentes. */
export type PillarsUnavailableReason =
  /** Nenhum produto tem evidência suficiente ainda. */
  | 'no_evaluated_products'
  /** Há produtos avaliados, mas os fatores gravados são da versão anterior do Confidence Score
   *  (8 fatores) e precisam ser recalculados para compor os 4 pilares atuais. */
  | 'stale_algorithm';

export type RiskSeverity = 'alta' | 'media' | 'baixa';

export interface RiskFactorItem {
  key: string;
  label: string;
  detail: string;
  count: number;
  /** Unidade contada — "produtos", "SKUs", "contagens". */
  unit: string;
  severity: RiskSeverity;
  /** Tab de destino do drill-down (mesmo id usado por App.tsx/setActiveTab), quando existe navegação real. */
  navigateTo?: string;
  actionLabel?: string;
}

/** Recomendação determinística derivada de condição real — sem IA, sem texto generativo e sem
 *  estimar impacto em pontos. */
export interface Recommendation {
  key: string;
  title: string;
  detail: string;
  navigateTo?: string;
  actionLabel?: string;
}

export interface AbcXyzExposure {
  highRiskCount: number;
  totalClassified: number;
}

export type BlindScoreStatus = 'excelente' | 'bom' | 'atencao' | 'critico' | 'provisorio' | 'indisponivel';

export const BLIND_SCORE_STATUS_LABEL: Record<BlindScoreStatus, string> = {
  excelente: 'Excelente',
  bom: 'Bom',
  atencao: 'Requer atenção',
  critico: 'Crítico',
  provisorio: 'Leitura provisória',
  indisponivel: 'Indisponível',
};

export interface BlindScoreResult {
  /** 0-100, ou null se nenhum SKU tem confiança calculável ainda. */
  score: number | null;
  status: BlindScoreStatus;
  /** Texto curto e honesto derivado do status real — nunca fixo. */
  summary: string;
  coverage: CoverageStat;
  validation: ValidationStat;
  /** Vazio quando nenhum produto avaliado ainda sustenta a agregação por pilar. */
  pillars: PillarScore[];
  /** Produtos que efetivamente sustentam os pilares — a base explícita da seção, que NÃO é o
   *  catálogo inteiro nem necessariamente todos os produtos avaliados. */
  pillarsBase: number;
  /** null quando os pilares foram calculados. */
  pillarsUnavailable: PillarsUnavailableReason | null;
  /** true quando a nota vem de linhas do CBC que a versão atual do algoritmo ainda não
   *  recalculou — o score continua sendo o avg_confidence real, mas a leitura está defasada. */
  staleEvaluation: boolean;
  /** Já ordenado por relevância (maior contagem primeiro), no máximo 6 itens. */
  reducingFactors: RiskFactorItem[];
  /** Ações determinísticas, na ordem em que fazem diferença. */
  recommendations: Recommendation[];
  /** null quando ABC/XYZ ainda não foi configurado/classificado — nunca 0 fabricado. */
  abcXyzExposure: AbcXyzExposure | null;
  /** Acurácia real por sessão de contagem, em ordem cronológica. */
  accuracyTrend: { period: string; value: number }[];
  lastRecalculatedAt: string | null;
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
