// Inventory Health — diagnóstico executivo da saúde operacional do estoque: quais áreas estão
// saudáveis, quais exigem atenção e por onde começar. Não existe nota geral aqui — a confiança
// consolidada continua sendo do BlindScore (blindScoreEngine.ts); este arquivo só LÊ os
// indicadores que cada módulo já calcula (contagens, cross-check, RCA, Risco, ABC/XYZ) e os
// classifica em domínios, sem recalcular nenhuma fórmula.
//
// Três regras semânticas governam o arquivo inteiro:
//  1. ausência de amostra nunca vira resultado negativo — vira 'nao_avaliado';
//  2. ausência de fonte/configuração vira 'indisponivel', que é diferente de não avaliado;
//  3. dado de priorização (ABC/XYZ) é 'informacao', não recebe julgamento de saúde.
import type {
  AnalyticsRawData, InventoryHealthExtraData, MovementProductRow, CatalogProductRow,
} from './analyticsDataService';
import {
  computeAccuracyStat, computeDivergenceRateStat, computeAbcXyzRiskStat, computeRecurrenceStat,
} from './analyticsMath';
import { topConcentration } from '../rcaAlgorithm';
import type { AbcXyzUnclassifiedReason } from '../supabase';
import { validationQualityFrom } from './blindScoreEngine';
import {
  available, unavailable, isAvailable,
  type HealthIndicator, type HealthSummary, type IndicatorStatus, type ValidationQuality,
  type MovementEvidence, type MovementDrillRow, type SegmentDiagnosis, type SegmentDiagnosisResult,
} from './analyticsContracts';

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

/** A qualidade da validação é a MESMA regra do BlindScore V2 (validationQualityFrom, importada
 *  em vez de reescrita); aqui só é traduzida para o vocabulário de status desta página. */
const VALIDATION_STATUS: Record<ValidationQuality, IndicatorStatus> = {
  alta: 'saudavel',
  moderada: 'atencao',
  baixa: 'critico',
  nao_avaliada: 'nao_avaliado',
};

/** Ordem de leitura de "o que olhar primeiro". Informação e indisponível não competem por
 *  atenção: não descrevem problema. */
const PRIORITY_RANK: Record<IndicatorStatus, number> = {
  critico: 0,
  atencao: 1,
  nao_avaliado: 2,
  saudavel: 3,
  informacao: 4,
  indisponivel: 5,
};

/** Status a partir do risco real já persistido pelo módulo de Inventário por Risco. Os limiares
 *  são os mesmos que blindAIInsightsEngine.ts já usa para "risco crítico concentrado" (3 SKUs
 *  ou 15% para alertar, 30% para crítico) — nenhuma fórmula nova de risco. */
function riskStatus(criticoCount: number, totalScored: number): IndicatorStatus {
  const criticalPct = totalScored > 0 ? (criticoCount / totalScored) * 100 : 0;
  if (criticoCount >= 3 || criticalPct >= 15) return criticalPct >= 30 ? 'critico' : 'atencao';
  return 'saudavel';
}

/** `extra` só é fornecido pela página de Inventory Health (Fase 2): sem ele os diagnósticos
 *  de movimento simplesmente não existem, em vez de aparecerem vazios. */
export function computeHealthIndicators(
  raw: AnalyticsRawData,
  extra?: InventoryHealthExtraData | null
): HealthIndicator[] {
  const indicators: HealthIndicator[] = [];

  // ---- Confiabilidade física: aderência entre o registrado e o físico ----------------------
  const accuracyStat = computeAccuracyStat(raw.countRecords);
  indicators.push(
    accuracyStat
      ? {
          key: 'accuracy',
          label: 'Acuracidade das contagens',
          domain: 'physical',
          status: worseWhenLower(accuracyStat.averageAccuracy, 95, 85),
          metric: available(Math.round(accuracyStat.averageAccuracy * 10) / 10),
          unit: '%',
          detail: `Média de ${accuracyStat.sessionsConsidered} sessão(ões) de contagem.`,
          navigateTo: 'audit',
          actionLabel: 'Abrir Auditoria',
        }
      : {
          key: 'accuracy',
          label: 'Acuracidade das contagens',
          domain: 'physical',
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
          domain: 'physical',
          status: worseWhenHigher(divergenceStat.ratePct, 5, 15),
          metric: available(Math.round(divergenceStat.ratePct * 10) / 10),
          unit: '%',
          detail: `${divergenceStat.totalDivergent} de ${divergenceStat.totalCounted} SKUs contados apresentaram divergência real.`,
          navigateTo: 'audit',
          actionLabel: 'Abrir Auditoria',
        }
      : {
          key: 'divergence_rate',
          label: 'Divergências reais',
          domain: 'physical',
          status: 'indisponivel',
          metric: unavailable('insufficient_data'),
          unit: '%',
          detail: 'Nenhum SKU contado ainda.',
        }
  );

  // ---- Processo de validação ---------------------------------------------------------------
  // Sem cadeia recontada não existe amostra para julgar independência e qualidade: o índice
  // cairia por AUSÊNCIA de evidência, e chamar isso de "Crítico" era o erro semântico que esta
  // fase corrige. O percentual de aprovações continua aparecendo, mas como contexto.
  const sampleChains = raw.crossCheckSummary.chainsWithRecount;
  const validationQuality = validationQualityFrom(sampleChains, raw.crossCheckSummary.reliabilityIndex);
  indicators.push(
    sampleChains > 0
      ? {
          key: 'reliability',
          label: 'Qualidade da validação',
          domain: 'validation',
          status: VALIDATION_STATUS[validationQuality],
          metric: available(Math.round(raw.crossCheckSummary.reliabilityIndex)),
          unit: '%',
          detail: `${sampleChains} de ${raw.crossCheckSummary.totalChains} contagens com recontagem, ${raw.crossCheckSummary.pctAuditoriasIndependentes.toFixed(0)}% delas independentes.`,
          navigateTo: 'audit',
          actionLabel: 'Abrir Auditoria',
        }
      : {
          key: 'reliability',
          label: 'Qualidade da validação',
          domain: 'validation',
          status: 'nao_avaliado',
          metric: unavailable('insufficient_data'),
          unit: '%',
          detail: raw.crossCheckSummary.totalChains > 0
            ? `Nenhuma das ${raw.crossCheckSummary.totalChains} contagens registradas foi reconferida — sem recontagem não há como avaliar a independência e a qualidade do processo.`
            : 'Nenhuma reconferência disponível para avaliar a independência e a qualidade do processo.',
          navigateTo: 'audit',
          actionLabel: 'Abrir Auditoria',
        }
  );

  indicators.push(
    raw.crossCheckSummary.totalChains > 0
      ? {
          key: 'approvals',
          label: 'Aprovações nas contagens',
          domain: 'validation',
          status: 'informacao',
          metric: available(Math.round(raw.crossCheckSummary.pctAprovadas)),
          unit: '%',
          detail: `${raw.crossCheckSummary.chainsApproved} de ${raw.crossCheckSummary.totalChains} contagens aprovadas.`,
          navigateTo: 'audit',
          actionLabel: 'Abrir Auditoria',
        }
      : {
          key: 'approvals',
          label: 'Aprovações nas contagens',
          domain: 'validation',
          status: 'indisponivel',
          metric: unavailable('insufficient_data'),
          unit: '%',
          detail: 'Nenhuma contagem registrada ainda.',
        }
  );

  // ---- Recorrência e localização ------------------------------------------------------------
  const recurrenceStat = computeRecurrenceStat(
    raw.rcaRecords,
    raw.rcaSettings.recurrence_threshold_count,
    raw.rcaSettings.recurrence_window_days
  );
  indicators.push(
    recurrenceStat
      ? {
          key: 'recurrence',
          label: 'Divergências reincidentes',
          domain: 'recurrence',
          status: worseWhenHigher(recurrenceStat.ratePct, 15, 35),
          metric: available(recurrenceStat.recurringSkus),
          unit: 'un',
          detail: `${recurrenceStat.recurringSkus} de ${recurrenceStat.distinctSkus} SKUs já atingiram ${recurrenceStat.thresholdCount}+ divergências em ${recurrenceStat.windowDays} dias.`,
          drill: { kind: 'recurrence' },
          navigateTo: 'rca',
          actionLabel: 'Ver análise de RCA',
        }
      : {
          key: 'recurrence',
          label: 'Divergências reincidentes',
          domain: 'recurrence',
          status: 'indisponivel',
          metric: unavailable('insufficient_data'),
          unit: 'un',
          detail: 'Nenhuma divergência classificada (RCA) nos últimos 180 dias.',
        }
  );

  // "Concentração de divergências" é o que o cálculo realmente mede (topConcentration por
  // localização) — o rótulo anterior, "Saúde por localização", prometia um diagnóstico por
  // local que este número não entrega.
  const locationRecords = raw.rcaRecords.filter(r => r.location);
  const topLocation = locationRecords.length >= MIN_LOCATION_SAMPLE ? topConcentration(locationRecords, 'location') : null;
  indicators.push(
    topLocation
      ? {
          key: 'location_health',
          label: 'Concentração de divergências',
          domain: 'recurrence',
          status: worseWhenHigher(topLocation.pct, 25, 45),
          metric: available(Math.round(topLocation.pct * 10) / 10),
          unit: '%',
          detail: `${topLocation.label} concentra ${topLocation.pct.toFixed(0)}% das divergências localizadas.`,
          drill: { kind: 'location', location: topLocation.label },
          navigateTo: 'rca',
          actionLabel: 'Ver por localização',
        }
      : {
          key: 'location_health',
          label: 'Concentração de divergências',
          domain: 'recurrence',
          status: 'indisponivel',
          metric: unavailable('insufficient_data'),
          unit: '%',
          detail: `Menos de ${MIN_LOCATION_SAMPLE} divergências com localização registrada — amostra insuficiente para apontar concentração.`,
        }
  );

  // ---- Movimento e disponibilidade (Fase 2) ---------------------------------------------
  if (extra) indicators.push(...movementIndicators(extra, computeMovementEvidence(extra)));

  // ---- Exposição operacional ----------------------------------------------------------------
  // Risco tem severidade porque o módulo de Inventário por Risco calcula uma métrica de risco
  // real, já persistida. Aqui ela é apenas lida de risk_company_summary_v.
  const risk = raw.riskSummary;
  indicators.push(
    risk && risk.total_scored > 0
      ? {
          key: 'risk',
          label: 'Risco dos SKUs',
          domain: 'exposure',
          status: riskStatus(risk.critico_count, risk.total_scored),
          metric: available(risk.critico_count),
          unit: 'un',
          detail: `${risk.critico_count} crítico(s) e ${risk.alto_count} alto(s) entre ${risk.total_scored} SKUs avaliados${
            risk.avg_risk != null ? ` · risco médio da empresa ${Math.round(risk.avg_risk)}` : ''
          }.`,
          navigateTo: 'risk',
          actionLabel: 'Abrir Inventário por Risco',
        }
      : {
          key: 'risk',
          label: 'Risco dos SKUs',
          domain: 'exposure',
          status: 'indisponivel',
          metric: unavailable('not_configured'),
          unit: 'un',
          detail: 'Execute o recompute de Inventário por Risco pelo menos uma vez para habilitar este indicador.',
          navigateTo: 'risk',
          actionLabel: 'Abrir Inventário por Risco',
        }
  );

  // ABC/XYZ mede exposição e prioridade, não evidência de estoque incorreto: por isso entra
  // como 'informacao' e não recebe saudável/atenção/crítico.
  const abcXyzStat = computeAbcXyzRiskStat(raw.abcXyzMatrix);
  indicators.push(
    abcXyzStat
      ? {
          key: 'abcxyz_risk',
          label: 'ABC/XYZ',
          domain: 'exposure',
          status: 'informacao',
          metric: available(abcXyzStat.highRiskCount),
          unit: 'un',
          detail: `${abcXyzStat.highRiskCount} de ${abcXyzStat.totalClassified} SKUs classificados estão em combinações de prioridade máxima/alta (${abcXyzStat.highRiskCombos.join(' · ')}).`,
          drill: { kind: 'abcxyz_risk', combos: abcXyzStat.highRiskCombos },
          navigateTo: 'abcxyz',
          actionLabel: 'Abrir ABC/XYZ',
        }
      : {
          key: 'abcxyz_risk',
          label: 'ABC/XYZ',
          domain: 'exposure',
          status: 'indisponivel',
          metric: unavailable('not_configured'),
          unit: 'un',
          detail: 'Execute o recompute de Classificação ABC/XYZ pelo menos uma vez para habilitar este indicador.',
          navigateTo: 'abcxyz',
          actionLabel: 'Abrir ABC/XYZ',
        }
  );

  // ---- Cobertura: indicadores que os dados do workspace ainda não sustentam ----------------
  // Ruptura e estoque sem movimentação saíram desta lista na Fase 2: agora são diagnósticos
  // reais no domínio de movimento. Excesso continua aqui porque depende de uma política de
  // estoque mínimo/máximo (ou cobertura-alvo) que o workspace não possui — inventar um
  // limiar seria fabricar diagnóstico.
  // Ficam agrupados, nunca um 0 fabricado e nunca misturados aos diagnósticos que têm leitura.
  indicators.push({
    key: 'excess_stock',
    label: 'Excesso de estoque',
    domain: 'pending',
    status: 'indisponivel',
    metric: unavailable('not_configured'),
    unit: 'un',
    detail: 'Exige política de estoque mínimo/máximo por SKU.',
  });
  indicators.push({
    key: 'category_health',
    label: 'Saúde por categoria',
    domain: 'pending',
    status: 'indisponivel',
    metric: unavailable('not_stored'),
    unit: '%',
    detail: 'Produtos ainda não possuem categoria cadastrada.',
  });

  return indicators;
}

/** Indicadores na ordem de "o que olhar primeiro" — crítico, atenção, não avaliado, e só
 *  depois o que está saudável. Ordenação estável: entre iguais, a ordem em que o diagnóstico
 *  foi calculado é preservada. */
export function sortByPriority(indicators: HealthIndicator[]): HealthIndicator[] {
  return indicators
    .map((indicator, index) => ({ indicator, index }))
    .sort((a, b) =>
      PRIORITY_RANK[a.indicator.status] - PRIORITY_RANK[b.indicator.status] || a.index - b.index)
    .map(entry => entry.indicator);
}

/** Resumo executivo derivado dos indicadores reais: distribuição de estados, cobertura de
 *  dados e a situação prioritária. Nenhuma nota nova, nenhum valor fixo. */
export function computeHealthSummary(indicators: HealthIndicator[]): HealthSummary {
  const count = (status: IndicatorStatus) => indicators.filter(i => i.status === status).length;
  const prioritized = sortByPriority(indicators).find(i => PRIORITY_RANK[i.status] <= PRIORITY_RANK.nao_avaliado);

  return {
    critico: count('critico'),
    atencao: count('atencao'),
    saudavel: count('saudavel'),
    naoAvaliado: count('nao_avaliado'),
    availableCount: indicators.filter(i => isAvailable(i.metric)).length,
    totalCount: indicators.length,
    priority: prioritized ?? null,
  };
}

// =============================================================================================
// Fase 2 — Movimento, disponibilidade e concentração por marca/linha.
//
// A fonte de movimento é a classificação que o ABC/XYZ já persistiu por produto
// (quantity_moved, weeks_without_sale, unclassified_reason, period): nenhuma venda é
// reprocessada aqui, nenhuma janela nova é inventada e nenhuma consulta por produto é feita.
// O engine continua puro — recebe os dados prontos e só interpreta.

/** Motivos de "não classificado" em que a MOVIMENTAÇÃO ainda é conhecida: sem motivo (produto
 *  classificado normalmente), 'sem_movimento' (ausência de venda medida, que é evidência) e
 *  'sem_custo' (a quantidade movimentada existe, só o valor não pôde ser calculado). Os demais
 *  motivos significam que não houve como medir movimento — esses produtos ficam fora da base. */
const MEASURABLE_REASONS: (AbcXyzUnclassifiedReason | null)[] = [null, 'sem_movimento', 'sem_custo'];

/** Abaixo desta cobertura a leitura de movimento é anunciada como parcial — mesmo limiar que o
 *  BlindScore V2 já usa para "leitura provisória", em vez de um número novo. */
const PARTIAL_COVERAGE_PCT = 40;

interface MovementView {
  product: CatalogProductRow;
  movement: MovementProductRow;
  /** Movimentação positiva real na janela classificada. */
  hasDemand: boolean;
}

/** Junta catálogo × movimentação por product_id em memória (um Map, não N consultas) e mantém
 *  só os produtos cuja movimentação é mensurável. */
function movementViews(extra: InventoryHealthExtraData): MovementView[] {
  const productById = new Map(extra.catalogProducts.map(p => [p.id, p]));
  const views: MovementView[] = [];
  for (const movement of extra.movementRows) {
    if (!MEASURABLE_REASONS.includes(movement.unclassifiedReason)) continue;
    const product = productById.get(movement.productId);
    if (!product) continue;
    views.push({ product, movement, hasDemand: movement.quantityMoved > 0 });
  }
  return views;
}

export function computeMovementEvidence(extra: InventoryHealthExtraData): MovementEvidence {
  const views = movementViews(extra);
  const totalCatalog = extra.catalogProductsTotal;
  const coveragePct = totalCatalog > 0 ? Math.round((views.length / totalCatalog) * 1000) / 10 : 0;

  const latest = extra.movementRows.reduce<MovementProductRow | null>(
    (acc, row) => (!acc || row.classificationDate > acc.classificationDate ? row : acc), null);

  if (!extra.movementSourceExists && extra.movementRows.length === 0) {
    return {
      state: 'missing', period: null, productsEvaluated: 0, totalCatalog, coveragePct: 0,
      lastClassifiedAt: null,
      note: 'Nenhum registro de movimentação/venda disponível no workspace.',
    };
  }

  if (views.length === 0) {
    return {
      state: 'insufficient', period: latest?.period ?? null, productsEvaluated: 0, totalCatalog,
      coveragePct: 0, lastClassifiedAt: latest?.classificationDate ?? null,
      note: 'Existem registros de venda, mas nenhum produto tem movimentação mensurável na janela já classificada.',
    };
  }

  const partial = coveragePct < PARTIAL_COVERAGE_PCT;
  return {
    state: 'available',
    period: latest?.period ?? null,
    productsEvaluated: views.length,
    totalCatalog,
    coveragePct,
    lastClassifiedAt: latest?.classificationDate ?? null,
    note: `${views.length} de ${totalCatalog} produtos com movimentação mensurável${
      latest ? ` na janela ${latest.period}` : ''}.${
      partial ? ' Cobertura parcial: a leitura representa apenas essa fração do catálogo.' : ''}`,
  };
}

/** Linhas do drill-down de movimento, a partir dos dados já carregados — sem nova consulta.
 *  Ruptura vem ordenada por gravidade de risco e depois por movimentação; estoque parado, pelo
 *  maior tempo sem venda. */
export function buildMovementDrillRows(
  extra: InventoryHealthExtraData,
  view: 'stockout' | 'idle'
): MovementDrillRow[] {
  const riskByProduct = new Map(extra.riskLevelByProduct);
  const rows = movementViews(extra)
    .filter(v => (view === 'stockout'
      ? v.product.stockQuantity <= 0 && v.hasDemand
      : v.product.stockQuantity > 0 && !v.hasDemand))
    .map<MovementDrillRow>(v => ({
      productId: v.product.id,
      sku: v.product.sku,
      name: v.product.name,
      location: v.product.location,
      stockQuantity: v.product.stockQuantity,
      quantityMoved: v.movement.quantityMoved,
      weeksWithoutSale: v.movement.weeksWithoutSale > 0 ? v.movement.weeksWithoutSale : null,
      riskLevel: riskByProduct.get(v.product.id) ?? null,
    }));

  const riskRank = (level: string | null) => (level === 'critico' ? 0 : level === 'alto' ? 1 : 2);
  if (view === 'stockout') {
    rows.sort((a, b) => riskRank(a.riskLevel) - riskRank(b.riskLevel) || b.quantityMoved - a.quantityMoved);
  } else {
    rows.sort((a, b) => (b.weeksWithoutSale ?? 0) - (a.weeksWithoutSale ?? 0) || b.stockQuantity - a.stockQuantity);
  }
  return rows;
}

/** Os dois diagnósticos de movimento. Ausência de base nunca vira saúde: sem fonte é
 *  'indisponivel', fonte sem base mensurável é 'nao_avaliado'. */
function movementIndicators(extra: InventoryHealthExtraData, evidence: MovementEvidence): HealthIndicator[] {
  const base = (key: string, label: string): HealthIndicator => ({
    key,
    label,
    domain: 'movement',
    unit: 'un',
    status: evidence.state === 'missing' ? 'indisponivel' : 'nao_avaliado',
    metric: unavailable(evidence.state === 'missing' ? 'not_stored' : 'insufficient_data'),
    detail: evidence.note,
  });

  if (evidence.state !== 'available') {
    return [base('stockout', 'Ruptura com demanda'), base('no_movement', 'Estoque sem movimentação')];
  }

  const views = movementViews(extra);
  const withDemand = views.filter(v => v.hasDemand);
  const withStock = views.filter(v => v.product.stockQuantity > 0);
  const stockout = withDemand.filter(v => v.product.stockQuantity <= 0);
  const idle = withStock.filter(v => !v.hasDemand);

  // Estimativa de capital parado: só itens com preço cadastrado, e anunciada como estimativa.
  const priced = idle.filter(v => v.product.price != null && v.product.price > 0);
  const idleValue = priced.reduce((sum, v) => sum + v.product.stockQuantity * (v.product.price ?? 0), 0);
  const janela = evidence.period ? ` (janela ${evidence.period})` : '';

  return [
    {
      key: 'stockout',
      label: 'Ruptura com demanda',
      domain: 'movement',
      // Crítico porque há demanda observada E saldo indisponível — diferente de saldo zero sem
      // demanda, que não entra nesta conta.
      status: stockout.length > 0 ? 'critico' : 'saudavel',
      metric: available(stockout.length),
      unit: 'un',
      detail: `${stockout.length} de ${withDemand.length} produtos com demanda observada estão sem saldo atual${janela}.`,
      drill: { kind: 'movement', view: 'stockout' },
    },
    {
      key: 'no_movement',
      label: 'Estoque sem movimentação',
      domain: 'movement',
      // Atenção, nunca crítico: estoque parado é questão operacional, não prova de saldo errado.
      status: idle.length > 0 ? 'atencao' : 'saudavel',
      metric: available(idle.length),
      unit: 'un',
      detail: `${idle.length} de ${withStock.length} produtos com saldo positivo não registraram venda${janela}.${
        priced.length > 0
          ? ` Valor estimado em estoque parado: ${idleValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })} (estimativa por preço de venda, ${priced.length} de ${idle.length} itens com preço cadastrado).`
          : ''}`,
      drill: { kind: 'movement', view: 'idle' },
    },
  ];
}

const SIGNAL_ORDER = [
  { key: 'stockout', label: 'rupturas com demanda', pick: (s: SegmentDiagnosis) => s.stockoutWithDemand },
  { key: 'risk_critical', label: 'SKUs em risco crítico', pick: (s: SegmentDiagnosis) => s.riskCritical },
  { key: 'divergence', label: 'SKUs com divergência', pick: (s: SegmentDiagnosis) => s.divergentProducts },
  { key: 'risk_high', label: 'SKUs em risco alto', pick: (s: SegmentDiagnosis) => s.riskHigh },
  { key: 'no_movement', label: 'SKUs sem movimento', pick: (s: SegmentDiagnosis) => s.noMovement },
] as const;

/** Principal sinal: o PRIMEIRO da ordem fixa de gravidade com contagem maior que zero. Não é
 *  soma, média nem score composto — a marca não recebe nota. */
function mainSignalOf(segment: SegmentDiagnosis): SegmentDiagnosis['mainSignal'] {
  for (const signal of SIGNAL_ORDER) {
    const count = signal.pick(segment);
    if (count != null && count > 0) return { key: signal.key, label: signal.label, count };
  }
  return null;
}

function signalRank(segment: SegmentDiagnosis): number {
  const index = SIGNAL_ORDER.findIndex(s => s.key === segment.mainSignal?.key);
  return index === -1 ? SIGNAL_ORDER.length : index;
}

/** Concentração dos problemas por marca e linha, agregando SOMENTE produtos com associação já
 *  existente em product_brand_associations — nada é inferido pelo nome do produto. Cada sinal
 *  que não é avaliável fica `null`, nunca 0. */
export function computeSegmentDiagnosis(
  raw: AnalyticsRawData,
  extra: InventoryHealthExtraData
): SegmentDiagnosisResult {
  const evidence = computeMovementEvidence(extra);
  const movementAvailable = evidence.state === 'available';
  const riskEvaluable = !!raw.riskSummary && raw.riskSummary.total_scored > 0;
  const divergenceEvaluable = raw.rcaRecords.length > 0;

  const productById = new Map(extra.catalogProducts.map(p => [p.id, p]));
  const movementByProduct = new Map(movementViews(extra).map(v => [v.product.id, v]));
  const riskByProduct = new Map(extra.riskLevelByProduct);

  const skuToProductId = new Map(extra.catalogProducts.map(p => [p.sku, p.id]));
  const divergentProductIds = new Set<string>();
  for (const record of raw.rcaRecords) {
    const productId = record.sku ? skuToProductId.get(record.sku) : undefined;
    if (productId) divergentProductIds.add(productId);
  }

  const brandNames = new Map(extra.brands.map(b => [b.id, b.name]));
  const lineNames = new Map(extra.lines.map(l => [l.id, l.name]));
  const lineBrand = new Map(extra.lines.map(l => [l.id, brandNames.get(l.brandId) ?? null]));

  interface Bucket { products: string[] }
  const brandBuckets = new Map<string, Bucket>();
  const lineBuckets = new Map<string, Bucket>();
  const associatedProducts = new Set<string>();

  for (const association of extra.brandAssociations) {
    if (!productById.has(association.productId)) continue;
    if (association.brandId) {
      associatedProducts.add(association.productId);
      const bucket = brandBuckets.get(association.brandId) ?? { products: [] };
      bucket.products.push(association.productId);
      brandBuckets.set(association.brandId, bucket);
    }
    if (association.lineId) {
      const bucket = lineBuckets.get(association.lineId) ?? { products: [] };
      bucket.products.push(association.productId);
      lineBuckets.set(association.lineId, bucket);
    }
  }

  const build = (id: string, name: string, parentName: string | null, bucket: Bucket): SegmentDiagnosis => {
    const countBy = (predicate: (productId: string) => boolean) => bucket.products.filter(predicate).length;
    const segment: SegmentDiagnosis = {
      key: id,
      name,
      parentName,
      products: bucket.products.length,
      divergentProducts: divergenceEvaluable ? countBy(p => divergentProductIds.has(p)) : null,
      riskCritical: riskEvaluable ? countBy(p => riskByProduct.get(p) === 'critico') : null,
      riskHigh: riskEvaluable ? countBy(p => riskByProduct.get(p) === 'alto') : null,
      stockoutWithDemand: movementAvailable
        ? countBy(p => {
            const view = movementByProduct.get(p);
            return !!view && view.hasDemand && view.product.stockQuantity <= 0;
          })
        : null,
      noMovement: movementAvailable
        ? countBy(p => {
            const view = movementByProduct.get(p);
            return !!view && !view.hasDemand && view.product.stockQuantity > 0;
          })
        : null,
      mainSignal: null,
    };
    segment.mainSignal = mainSignalOf(segment);
    return segment;
  };

  const sort = (segments: SegmentDiagnosis[]) =>
    segments.sort((a, b) =>
      signalRank(a) - signalRank(b) ||
      (b.mainSignal?.count ?? 0) - (a.mainSignal?.count ?? 0) ||
      b.products - a.products ||
      a.name.localeCompare(b.name, 'pt-BR'));

  const brands = sort(Array.from(brandBuckets.entries())
    .map(([id, bucket]) => build(id, brandNames.get(id) ?? 'Marca sem nome', null, bucket)));
  const lines = sort(Array.from(lineBuckets.entries())
    .map(([id, bucket]) => build(id, lineNames.get(id) ?? 'Linha sem nome', lineBrand.get(id) ?? null, bucket)));

  const totalCatalog = extra.catalogProductsTotal;
  return {
    brands,
    lines,
    associatedProducts: associatedProducts.size,
    totalCatalog,
    coveragePct: totalCatalog > 0 ? Math.round((associatedProducts.size / totalCatalog) * 1000) / 10 : 0,
  };
}
