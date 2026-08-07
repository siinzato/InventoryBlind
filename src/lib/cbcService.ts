// Confidence Based Counting (CBC) — acesso a dados: coleta os fatores brutos por produto,
// chama o motor puro (cbcAlgorithm.ts) e grava o resultado + histórico. Nenhuma lógica de
// pontuação mora aqui — só busca de dados e persistência.

import { supabase, ProductConfidenceScore, RiskLevel } from './supabase';
import { computeConfidenceScore, ConfidenceInput } from './cbcAlgorithm';
import { logAuditEvent } from './auditLogService';

async function gatherInputForProduct(productId: string, companyId: string): Promise<ConfidenceInput | null> {
  const { data: product, error: productError } = await supabase
    .from('products').select('sku, stock_quantity').eq('id', productId).eq('company_id', companyId).maybeSingle();
  if (productError || !product) {
    if (productError) console.error('[CBC] Error loading product:', productError);
    return null;
  }

  const { data: countItems, error: countError } = await supabase
    .from('inventory_count_import_items')
    .select('count_record_id, status, diferenca, created_at')
    .eq('product_id', productId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (countError) console.error('[CBC] Error loading count items:', countError);

  const items = countItems ?? [];
  const divergentItems = items.filter(i => i.status && i.status !== 'correct');
  const repeatOffenseCount = new Set(divergentItems.map(i => i.count_record_id)).size;

  const now = Date.now();
  const daysSince = (iso: string) => Math.floor((now - new Date(iso).getTime()) / 86400000);

  const daysSinceLastCount = items.length > 0 ? daysSince(items[0].created_at) : null;
  const daysSinceLastDivergence = divergentItems.length > 0 ? daysSince(divergentItems[0].created_at) : null;

  const adjustmentMagnitudes = items.map(i => Math.abs(i.diferenca ?? 0));
  const avgAdjustmentMagnitude = adjustmentMagnitudes.length > 0
    ? adjustmentMagnitudes.reduce((a, b) => a + b, 0) / adjustmentMagnitudes.length
    : 0;

  const sixtyDaysAgo = new Date(now - 60 * 86400000).toISOString();
  const { data: picks, error: picksError } = await supabase
    .from('full_operation_items')
    .select('quantity_picked, picked_at')
    .eq('company_id', companyId)
    .eq('sku', product.sku)
    .gte('picked_at', sixtyDaysAgo);
  if (picksError) console.error('[CBC] Error loading Full Manager picks:', picksError);

  const pickRows = picks ?? [];
  const picksPerMonth = pickRows.length / 2; // janela de 60 dias = 2 meses
  const quantityMovedPerMonth = pickRows.reduce((sum, p) => sum + (p.quantity_picked ?? 0), 0) / 2;

  return {
    totalCounts: items.length,
    divergentCounts: divergentItems.length,
    repeatOffenseCount,
    daysSinceLastDivergence,
    daysSinceLastCount,
    picksPerMonth,
    quantityMovedPerMonth,
    avgAdjustmentMagnitude,
    currentStockQuantity: product.stock_quantity ?? 0,
  };
}

/** Recalcula e grava o score de um lote de produtos — chamada de forma "fire-and-forget"
 *  (não bloqueia a UI) a partir dos pontos de gatilho: import de contagem e conclusão de
 *  operação Full Manager, além do botão manual "Recalcular Tudo" do dashboard CBC. */
export async function recomputeForProducts(
  productIds: string[],
  companyId: string,
  userId?: string,
  userEmail?: string
): Promise<void> {
  const uniqueIds = Array.from(new Set(productIds));

  for (const productId of uniqueIds) {
    const input = await gatherInputForProduct(productId, companyId);
    if (!input) continue;

    const result = computeConfidenceScore(input);
    const nowIso = new Date().toISOString();

    const { error: upsertError } = await supabase.from('product_confidence_scores').upsert(
      {
        company_id: companyId,
        product_id: productId,
        confidence_score: result.confidenceScore,
        risk_level: result.riskLevel,
        next_count_date: result.nextCountDate,
        factors: result.factors,
        top_reasons: result.topReasons,
        last_algorithm_run: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'product_id' }
    );
    if (upsertError) { console.error('[CBC] Error upserting confidence score:', upsertError); continue; }

    const { error: historyError } = await supabase.from('product_confidence_history').insert({
      company_id: companyId,
      product_id: productId,
      confidence_score: result.confidenceScore,
      risk_level: result.riskLevel,
    });
    if (historyError) console.error('[CBC] Error inserting confidence history:', historyError);
  }

  if (userId && userEmail && uniqueIds.length > 0) {
    await logAuditEvent({ companyId, userId, userEmail, action: 'cbc.recompute', metadata: { productCount: uniqueIds.length } });
  }
}

export async function recomputeAllForCompany(companyId: string, userId: string, userEmail: string): Promise<number> {
  const { data, error } = await supabase.from('products').select('id').eq('company_id', companyId);
  if (error || !data) { console.error('[CBC] Error loading products for full recompute:', error); return 0; }
  await recomputeForProducts(data.map(p => p.id), companyId, userId, userEmail);
  return data.length;
}

/** Bulk lookup for list views (e.g. ImportedProductsPage) — one query for a page of SKUs
 *  instead of N individual getProductConfidence calls. */
export async function getConfidenceForProducts(productIds: string[], companyId: string): Promise<Map<string, ProductConfidenceScore>> {
  if (productIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('product_confidence_scores').select('*').eq('company_id', companyId).in('product_id', productIds);
  if (error) { console.error('[CBC] Error bulk-loading confidence scores:', error); return new Map(); }
  return new Map((data as ProductConfidenceScore[]).map(row => [row.product_id, row]));
}

export async function getProductConfidence(productId: string, companyId: string): Promise<ProductConfidenceScore | null> {
  const { data, error } = await supabase
    .from('product_confidence_scores').select('*').eq('product_id', productId).eq('company_id', companyId).maybeSingle();
  if (error) { console.error('[CBC] Error loading product confidence:', error); return null; }
  return data as ProductConfidenceScore | null;
}

export interface CBCCompanySummaryRow {
  company_id: string;
  avg_confidence: number;
  total_scored: number;
  excelente_count: number;
  bom_count: number;
  medio_count: number;
  critico_count: number;
  overdue_count: number;
  due_this_week_count: number;
}

export async function getCompanySummary(companyId: string): Promise<CBCCompanySummaryRow | null> {
  const { data, error } = await supabase.from('cbc_company_summary_v').select('*').eq('company_id', companyId).maybeSingle();
  if (error) { console.error('[CBC] Error loading CBC summary:', error); return null; }
  return data as CBCCompanySummaryRow | null;
}

export type CBCFilter = 'all' | 'critical' | 'high_confidence' | 'overdue' | 'due_this_week';

export interface ProductConfidenceRow extends ProductConfidenceScore {
  product_name: string;
  product_sku: string;
}

export async function listWithFilter(companyId: string, filter: CBCFilter): Promise<ProductConfidenceRow[]> {
  let query = supabase
    .from('product_confidence_scores')
    .select('*, products(name, sku)')
    .eq('company_id', companyId);

  const today = new Date().toISOString().slice(0, 10);
  const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  if (filter === 'critical') query = query.eq('risk_level', 'critico');
  if (filter === 'high_confidence') query = query.in('risk_level', ['excelente', 'bom']);
  if (filter === 'overdue') query = query.lt('next_count_date', today);
  if (filter === 'due_this_week') query = query.gte('next_count_date', today).lt('next_count_date', weekFromNow);

  const { data, error } = await query.order('confidence_score', { ascending: filter !== 'high_confidence' }).limit(200);
  if (error) { console.error('[CBC] Error listing confidence scores:', error); return []; }

  return (data ?? []).map((row) => {
    const r = row as ProductConfidenceScore & { products: { name: string; sku: string } | null };
    return { ...r, product_name: r.products?.name ?? '—', product_sku: r.products?.sku ?? '—' };
  });
}

export async function getCriticalProducts(companyId: string, limit = 10): Promise<ProductConfidenceRow[]> {
  const rows = await listWithFilter(companyId, 'critical');
  return rows.slice(0, limit);
}

export async function getMostReliableProducts(companyId: string, limit = 10): Promise<ProductConfidenceRow[]> {
  const rows = await listWithFilter(companyId, 'high_confidence');
  return [...rows].sort((a, b) => b.confidence_score - a.confidence_score).slice(0, limit);
}

export interface BandMigration {
  productId: string;
  from: RiskLevel;
  to: RiskLevel;
  direction: 'up' | 'down';
}

const BAND_RANK: Record<RiskLevel, number> = { critico: 0, medio: 1, bom: 2, excelente: 3 };

/** Compara as duas últimas linhas de histórico de cada produto para contar quantos
 *  migraram de faixa — mais simples e legível que uma window function SQL neste volume. */
export async function getBandMigrations(companyId: string): Promise<BandMigration[]> {
  const { data, error } = await supabase
    .from('product_confidence_history')
    .select('product_id, risk_level, recorded_at')
    .eq('company_id', companyId)
    .order('recorded_at', { ascending: false })
    .limit(2000);
  if (error) { console.error('[CBC] Error loading confidence history:', error); return []; }

  const byProduct = new Map<string, { risk_level: RiskLevel; recorded_at: string }[]>();
  for (const row of data ?? []) {
    const list = byProduct.get(row.product_id) ?? [];
    if (list.length < 2) list.push({ risk_level: row.risk_level as RiskLevel, recorded_at: row.recorded_at });
    byProduct.set(row.product_id, list);
  }

  const migrations: BandMigration[] = [];
  for (const [productId, rows] of byProduct) {
    if (rows.length < 2) continue;
    const [latest, previous] = rows;
    if (latest.risk_level !== previous.risk_level) {
      migrations.push({
        productId,
        from: previous.risk_level,
        to: latest.risk_level,
        direction: BAND_RANK[latest.risk_level] > BAND_RANK[previous.risk_level] ? 'up' : 'down',
      });
    }
  }
  return migrations;
}

export interface ScoreTrendPoint {
  date: string;
  avgScore: number;
}

export async function getScoreTrend(companyId: string, days = 30): Promise<ScoreTrendPoint[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('product_confidence_history')
    .select('confidence_score, recorded_at')
    .eq('company_id', companyId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: true });
  if (error) { console.error('[CBC] Error loading score trend:', error); return []; }

  const byDay = new Map<string, number[]>();
  for (const row of data ?? []) {
    const day = row.recorded_at.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(row.confidence_score);
    byDay.set(day, list);
  }
  return Array.from(byDay.entries()).map(([date, scores]) => ({
    date,
    avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
  }));
}
