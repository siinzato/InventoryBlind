// Curva ABC — camada de I/O. Nunca lê/escreve tabelas do Inventário (inventory_*,
// physical_count_*) nem products além de leitura para o filtro opcional de vínculo. Publicação é
// transacional por rollback compensatório: se qualquer etapa falhar após criar a análise em
// rascunho, a análise (e tudo que cascateia dela) é apagada antes de propagar o erro.

import { supabase } from '../supabase';
import { logAuditEvent } from '../auditLogService';
import type { SkuSnapshot } from './abcCurveEngine';
import type { Recommendation } from './abcCurveRecommendations';

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
}

export async function listSkuSnapshots(companyId: string, analysisId: string): Promise<(SkuSnapshotRow & { id: string })[]> {
  const { data, error } = await supabase
    .from('abc_curve_sku_snapshots').select('*')
    .eq('company_id', companyId).eq('analysis_id', analysisId)
    .order('revenue', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listRecommendations(companyId: string, analysisId: string) {
  const { data, error } = await supabase
    .from('abc_curve_recommendations').select('*')
    .eq('company_id', companyId).eq('analysis_id', analysisId)
    .order('priority', { ascending: true });
  if (error) throw error;
  return data ?? [];
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
  thresholdA: number; thresholdB: number;
  batches: { fileKind: AbcFileKind; sourceType: AbcSourceType; provider: AbcProvider | null; fileName: string | null; fileHash: string | null; rowCount: number; importedCount: number; warningCount: number }[];
  snapshots: SkuSnapshot[];
  productIdBySku: Map<string, string>;
  recommendationsBySku: Map<string, Recommendation>;
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
      threshold_a: input.thresholdA, threshold_b: input.thresholdB, status: 'draft',
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
        group.map(s => ({
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
        }))
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
