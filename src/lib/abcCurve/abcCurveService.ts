// Curva ABC — camada de I/O. Nunca lê/escreve tabelas do Inventário (inventory_*,
// physical_count_*) nem products além de leitura para o filtro opcional de vínculo. Publicação é
// transacional por rollback compensatório: se qualquer etapa falhar após criar a análise em
// rascunho, a análise (e tudo que cascateia dela) é apagada antes de propagar o erro.

import { supabase } from '../supabase';
import { logAuditEvent } from '../auditLogService';
import type { SkuSnapshot } from './abcCurveEngine';
import type { Recommendation } from './abcCurveRecommendations';
import { DEFAULT_ABC_POLICY, type AbcCommercialPolicy } from './abcCurvePolicy';
import type { TinyFileValues } from './abcCurveTiny';

export type AbcSourceType = 'file' | 'api';
export type AbcProvider = 'tiny' | 'bling' | 'totvs' | 'sap' | 'custom';
export type AbcFileKind = 'vendas' | 'precos_custos' | 'estoque' | 'abc_tiny';

export interface AbcCurveAnalysis {
  id: string; companyId: string; name: string;
  salesPeriodStart: string; salesPeriodEnd: string;
  pricingSnapshotDate: string; stockSnapshotDate: string | null;
  thresholdA: number; thresholdB: number;
  status: 'draft' | 'published';
  totalSkuCount: number; totalQuantity: number; totalRevenue: number;
  costCoveragePct: number | null; stockCoveragePct: number | null; warningCount: number;
  publishedAt: string | null; createdAt: string;
  /** Política comercial gravada com a análise (migration 109). Análise anterior à Fase 2 traz
   *  os DEFAULTs, que são exatamente os limiares que o código usava antes. */
  policy: AbcCommercialPolicy;
}

export interface AbcCurveImportBatch {
  id: string; analysisId: string; fileKind: AbcFileKind; sourceType: AbcSourceType;
  provider: AbcProvider | null; fileName: string | null; fileHash: string | null;
  rowCount: number; importedCount: number; warningCount: number;
  status: 'completed' | 'failed'; errorMessage: string | null; createdAt: string;
}

interface AnalysisRow {
  id: string; company_id: string; name: string; sales_period_start: string; sales_period_end: string;
  pricing_snapshot_date: string; stock_snapshot_date: string | null; threshold_a: number; threshold_b: number;
  status: 'draft' | 'published'; total_sku_count: number; total_quantity: number; total_revenue: number;
  cost_coverage_pct: number | null; stock_coverage_pct: number | null; warning_count: number;
  published_at: string | null; created_at: string;
  low_coverage_days?: number | null; healthy_coverage_days?: number | null;
  excess_coverage_days?: number | null; low_margin_pct?: number | null; strong_margin_pct?: number | null;
}
interface BatchRow {
  id: string; analysis_id: string; file_kind: AbcFileKind; source_type: AbcSourceType;
  provider: AbcProvider | null; file_name: string | null; file_hash: string | null;
  row_count: number; imported_count: number; warning_count: number;
  status: 'completed' | 'failed'; error_message: string | null; created_at: string;
}

const analysisFromRow = (row: AnalysisRow): AbcCurveAnalysis => ({
  id: row.id, companyId: row.company_id, name: row.name,
  salesPeriodStart: row.sales_period_start, salesPeriodEnd: row.sales_period_end,
  pricingSnapshotDate: row.pricing_snapshot_date, stockSnapshotDate: row.stock_snapshot_date,
  thresholdA: row.threshold_a, thresholdB: row.threshold_b, status: row.status,
  totalSkuCount: row.total_sku_count, totalQuantity: row.total_quantity, totalRevenue: row.total_revenue,
  costCoveragePct: row.cost_coverage_pct, stockCoveragePct: row.stock_coverage_pct, warningCount: row.warning_count,
  publishedAt: row.published_at, createdAt: row.created_at,
  // A política LIDA é a da análise, nunca o padrão atual do produto: mudar o default no
  // futuro não pode reescrever o critério de uma análise já publicada. O fallback só cobre
  // banco sem a 109 aplicada, e resolve nos mesmos valores que a regra antiga usava.
  policy: {
    thresholdA: row.threshold_a,
    thresholdB: row.threshold_b,
    lowCoverageDays: row.low_coverage_days ?? DEFAULT_ABC_POLICY.lowCoverageDays,
    healthyCoverageDays: row.healthy_coverage_days ?? DEFAULT_ABC_POLICY.healthyCoverageDays,
    excessCoverageDays: row.excess_coverage_days ?? DEFAULT_ABC_POLICY.excessCoverageDays,
    lowMarginPct: row.low_margin_pct ?? DEFAULT_ABC_POLICY.lowMarginPct,
    strongMarginPct: row.strong_margin_pct ?? DEFAULT_ABC_POLICY.strongMarginPct,
  },
});

const batchFromRow = (row: BatchRow): AbcCurveImportBatch => ({
  id: row.id, analysisId: row.analysis_id, fileKind: row.file_kind, sourceType: row.source_type,
  provider: row.provider, fileName: row.file_name, fileHash: row.file_hash,
  rowCount: row.row_count, importedCount: row.imported_count, warningCount: row.warning_count,
  status: row.status, errorMessage: row.error_message, createdAt: row.created_at,
});

export async function listAnalyses(companyId: string): Promise<AbcCurveAnalysis[]> {
  const { data, error } = await supabase
    .from('abc_curve_analyses').select('*')
    .eq('company_id', companyId).eq('status', 'published')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(analysisFromRow);
}

export async function listImportBatches(companyId: string, analysisId: string): Promise<AbcCurveImportBatch[]> {
  const { data, error } = await supabase
    .from('abc_curve_import_batches').select('*')
    .eq('company_id', companyId).eq('analysis_id', analysisId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(batchFromRow);
}

export async function findBatchesByFileHash(companyId: string, fileHash: string): Promise<AbcCurveImportBatch[]> {
  const { data, error } = await supabase
    .from('abc_curve_import_batches').select('*')
    .eq('company_id', companyId).eq('file_hash', fileHash);
  if (error) throw error;
  return (data ?? []).map(batchFromRow);
}

export interface SkuSnapshotRow {
  sku: string; product_id: string | null; product_name: string | null; quantity: number; revenue: number; freight: number;
  avg_price: number | null; list_price: number | null; promo_price: number | null; cost: number | null;
  cogs: number | null; gross_profit: number | null; gross_margin: number | null; realized_markup: number | null;
  price_realization: number | null; turnover_class: string | null; revenue_class: string | null;
  profit_class: string | null; cost_state: string; stock_available: number | null; stock_reserved: number | null;
  stock_in_transit: number | null; lead_time_days: number | null; safety_stock: number | null;
  daily_demand: number | null; coverage_days: number | null; reorder_point: number | null; suggested_purchase: number | null;
  // Fase 2 (migration 109). Opcionais no tipo porque snapshot gravado antes dela não tem
  // esses campos preenchidos — e nada na leitura pode assumir que tem.
  signal_codes?: string[] | null;
  tiny_quantity?: number | null;
  tiny_value?: number | null;
  tiny_individual_pct?: number | null;
  tiny_cumulative_pct?: number | null;
  tiny_classification?: string | null;
}

// O PostgREST corta a resposta em 1000 linhas por padrão. Uma análise de 1.034 SKUs voltava
// truncada em silêncio, e todo total da tela (lucro observado, Pareto, distribuição A/B/C)
// era calculado sobre um recorte. Paginação em blocos de 1000 — são ceil(n/1000) consultas
// em lote, não uma consulta por SKU. A ordenação leva um critério de desempate estável, senão
// linhas com a mesma métrica podem repetir ou desaparecer na virada de bloco.
const FETCH_PAGE = 1000;

export async function listSkuSnapshots(companyId: string, analysisId: string): Promise<(SkuSnapshotRow & { id: string })[]> {
  const rows: (SkuSnapshotRow & { id: string })[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('abc_curve_sku_snapshots').select('*')
      .eq('company_id', companyId).eq('analysis_id', analysisId)
      .order('revenue', { ascending: false }).order('sku', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as (SkuSnapshotRow & { id: string })[];
    rows.push(...page);
    if (page.length < FETCH_PAGE) return rows;
  }
}

export async function listRecommendations(companyId: string, analysisId: string) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('abc_curve_recommendations').select('*')
      .eq('company_id', companyId).eq('analysis_id', analysisId)
      .order('priority', { ascending: true }).order('sku', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < FETCH_PAGE) return rows;
  }
}

// Só leitura — usada para preencher product_id no snapshot quando o SKU já existe no catálogo.
// Nunca escreve em products.
export async function matchProductIds(companyId: string, skus: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (skus.length === 0) return map;
  for (const group of chunk(skus, 200)) {
    const { data, error } = await supabase.from('products').select('id, sku').eq('company_id', companyId).in('sku', group);
    if (error) throw error;
    (data ?? []).forEach((row: { id: string; sku: string }) => map.set(row.sku, row.id));
  }
  return map;
}

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export interface PublishAnalysisInput {
  companyId: string; userId: string; userEmail: string; name: string;
  salesPeriodStart: string; salesPeriodEnd: string; pricingSnapshotDate: string; stockSnapshotDate: string | null;
  /** Política comercial completa desta análise — vira snapshot histórico junto dela. */
  policy: AbcCommercialPolicy;
  batches: { fileKind: AbcFileKind; sourceType: AbcSourceType; provider: AbcProvider | null; fileName: string | null; fileHash: string | null; rowCount: number; importedCount: number; warningCount: number }[];
  snapshots: SkuSnapshot[];
  productIdBySku: Map<string, string>;
  recommendationsBySku: Map<string, Recommendation>;
  /** Sinais calculados uma vez, na publicação. Não são recalculados na leitura. */
  signalsBySku: Map<string, string[]>;
  /** Dados da referência do Tiny, só para os SKUs com match exato de SKU. */
  tinyBySku: Map<string, TinyFileValues>;
  costCoveragePct: number | null;
  stockCoveragePct: number | null;
  warningCount: number;
}

// Insere análise (rascunho) → batches → snapshots → recomendações → marca publicada. Qualquer
// falha apaga a análise em rascunho (cascade remove filhas), preservando "tudo ou nada".
export async function publishAnalysis(input: PublishAnalysisInput): Promise<AbcCurveAnalysis> {
  const { data: analysisData, error: analysisError } = await supabase
    .from('abc_curve_analyses')
    .insert({
      company_id: input.companyId, name: input.name,
      sales_period_start: input.salesPeriodStart, sales_period_end: input.salesPeriodEnd,
      pricing_snapshot_date: input.pricingSnapshotDate, stock_snapshot_date: input.stockSnapshotDate,
      threshold_a: input.policy.thresholdA, threshold_b: input.policy.thresholdB,
      low_coverage_days: input.policy.lowCoverageDays,
      healthy_coverage_days: input.policy.healthyCoverageDays,
      excess_coverage_days: input.policy.excessCoverageDays,
      low_margin_pct: input.policy.lowMarginPct,
      strong_margin_pct: input.policy.strongMarginPct,
      status: 'draft',
      total_sku_count: input.snapshots.length,
      total_quantity: input.snapshots.reduce((s, r) => s + r.quantity, 0),
      total_revenue: input.snapshots.reduce((s, r) => s + r.revenue, 0),
      cost_coverage_pct: input.costCoveragePct, stock_coverage_pct: input.stockCoveragePct,
      warning_count: input.warningCount,
    })
    .select().single();
  if (analysisError) throw analysisError;
  const analysisId = analysisData.id as string;

  try {
    if (input.batches.length > 0) {
      const { error } = await supabase.from('abc_curve_import_batches').insert(
        input.batches.map(b => ({
          company_id: input.companyId, analysis_id: analysisId, file_kind: b.fileKind,
          source_type: b.sourceType, provider: b.provider, file_name: b.fileName, file_hash: b.fileHash,
          row_count: b.rowCount, imported_count: b.importedCount, warning_count: b.warningCount,
          status: 'completed', created_by: input.userId,
        }))
      );
      if (error) throw error;
    }

    const snapshotIdBySku = new Map<string, string>();
    for (const group of chunk(input.snapshots, 500)) {
      const { data, error } = await supabase.from('abc_curve_sku_snapshots').insert(
        group.map(s => {
          const tiny = input.tinyBySku.get(s.sku) ?? null;
          return {
          company_id: input.companyId, analysis_id: analysisId, sku: s.sku,
          product_id: input.productIdBySku.get(s.sku) ?? null, product_name: s.productName,
          quantity: s.quantity, revenue: s.revenue, freight: s.freight, avg_price: s.avgPrice,
          list_price: s.listPrice, promo_price: s.promoPrice, cost: s.cost, cogs: s.cogs,
          gross_profit: s.grossProfit, gross_margin: s.grossMargin, realized_markup: s.realizedMarkup,
          price_realization: s.priceRealization, turnover_class: s.turnoverClass, revenue_class: s.revenueClass,
          profit_class: s.profitClass, cost_state: s.costState, stock_available: s.stockAvailable,
          stock_reserved: s.stockReserved, stock_in_transit: s.stockInTransit, lead_time_days: s.leadTimeDays,
          safety_stock: s.safetyStock, daily_demand: s.dailyDemand, coverage_days: s.coverageDays,
          reorder_point: s.reorderPoint, suggested_purchase: s.suggestedPurchase,
          signal_codes: input.signalsBySku.get(s.sku) ?? [],
          // Nulos quando o SKU não tem correspondência exata no arquivo do Tiny — nunca zero,
          // que significaria "o Tiny disse zero".
          tiny_quantity: tiny?.quantity ?? null,
          tiny_value: tiny?.value ?? null,
          tiny_individual_pct: tiny?.individualPct ?? null,
          tiny_cumulative_pct: tiny?.cumulativePct ?? null,
          tiny_classification: tiny?.classification ?? null,
          };
        })
      ).select('id, sku');
      if (error) throw error;
      (data ?? []).forEach((row: { id: string; sku: string }) => snapshotIdBySku.set(row.sku, row.id));
    }

    const recommendationRows = Array.from(input.recommendationsBySku.entries())
      .map(([sku, rec]) => {
        const snapshotId = snapshotIdBySku.get(sku);
        if (!snapshotId) return null;
        return {
          company_id: input.companyId, analysis_id: analysisId, sku_snapshot_id: snapshotId, sku,
          code: rec.code, priority: rec.priority, rule_applied: rec.ruleApplied, justification: rec.justification,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    for (const group of chunk(recommendationRows, 500)) {
      const { error } = await supabase.from('abc_curve_recommendations').insert(group);
      if (error) throw error;
    }

    const { data: published, error: publishError } = await supabase
      .from('abc_curve_analyses')
      .update({ status: 'published', published_by: input.userId, published_at: new Date().toISOString() })
      .eq('id', analysisId).select().single();
    if (publishError) throw publishError;

    await logAuditEvent({
      companyId: input.companyId, userId: input.userId, userEmail: input.userEmail,
      action: 'abc_curve.published', resourceType: 'abc_curve_analysis', resourceId: analysisId,
      metadata: { name: input.name, skuCount: input.snapshots.length },
    });

    return analysisFromRow(published as AnalysisRow);
  } catch (err) {
    await supabase.from('abc_curve_analyses').delete().eq('id', analysisId);
    throw err;
  }
}
