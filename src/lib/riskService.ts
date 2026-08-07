// Inventário por Risco — acesso a dados. Espelha cbcService.ts: coleta os fatores brutos
// por produto, chama o motor puro (riskAlgorithm.ts) e grava resultado + histórico.

import { supabase, ProductRiskScore, RiskBand, CriticalityLevel } from './supabase';
import { computeRiskScore, RiskInput } from './riskAlgorithm';
import { logAuditEvent } from './auditLogService';

export async function getCriticalityLevel(productId: string, companyId: string): Promise<CriticalityLevel> {
  const { data, error } = await supabase
    .from('product_criticality_overrides').select('criticality_level').eq('product_id', productId).eq('company_id', companyId).maybeSingle();
  if (error) { console.error('[Risk] Error loading criticality override:', error); return 'normal'; }
  return (data?.criticality_level as CriticalityLevel) ?? 'normal';
}

async function gatherInputForProduct(productId: string, companyId: string): Promise<RiskInput | null> {
  const { data: product, error: productError } = await supabase
    .from('products').select('sku, price, stock_quantity').eq('id', productId).eq('company_id', companyId).maybeSingle();
  if (productError || !product) {
    if (productError) console.error('[Risk] Error loading product:', productError);
    return null;
  }

  const { data: countItems, error: countError } = await supabase
    .from('inventory_count_import_items')
    .select('count_record_id, status, diferenca, saldo_sistema, saldo_contado, created_at')
    .eq('product_id', productId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (countError) console.error('[Risk] Error loading count items:', countError);

  const items = countItems ?? [];
  const divergentItems = items.filter(i => i.status && i.status !== 'correct');
  const repeatOffenseCount = new Set(divergentItems.map(i => i.count_record_id)).size;
  const adjustmentCount = items.filter(i => (i.diferenca ?? 0) !== 0).length;
  const stockoutCount = items.filter(i => (i.saldo_sistema ?? 1) <= 0 || (i.saldo_contado ?? 1) <= 0).length;

  const now = Date.now();
  const daysSinceLastCount = items.length > 0 ? Math.floor((now - new Date(items[0].created_at).getTime()) / 86400000) : null;

  const sixtyDaysAgo = new Date(now - 60 * 86400000).toISOString();
  const { data: picks, error: picksError } = await supabase
    .from('full_operation_items')
    .select('quantity_picked, picked_at')
    .eq('company_id', companyId)
    .eq('sku', product.sku)
    .gte('picked_at', sixtyDaysAgo);
  if (picksError) console.error('[Risk] Error loading Full Manager picks:', picksError);

  const pickRows = picks ?? [];
  const picksPerMonth = pickRows.length / 2;
  const quantityMovedPerMonth = pickRows.reduce((sum, p) => sum + (p.quantity_picked ?? 0), 0) / 2;

  const criticalityLevel = await getCriticalityLevel(productId, companyId);

  return {
    totalCounts: items.length,
    divergentCounts: divergentItems.length,
    repeatOffenseCount,
    daysSinceLastCount,
    picksPerMonth,
    quantityMovedPerMonth,
    currentStockQuantity: product.stock_quantity ?? 0,
    stockoutCount,
    adjustmentCount,
    unitPrice: product.price ?? 0,
    criticalityLevel,
  };
}

export async function recomputeRiskForProducts(
  productIds: string[],
  companyId: string,
  userId?: string,
  userEmail?: string
): Promise<void> {
  const uniqueIds = Array.from(new Set(productIds));

  for (const productId of uniqueIds) {
    const input = await gatherInputForProduct(productId, companyId);
    if (!input) continue;

    const result = computeRiskScore(input);
    const nowIso = new Date().toISOString();

    const { error: upsertError } = await supabase.from('product_risk_scores').upsert(
      {
        company_id: companyId,
        product_id: productId,
        risk_score: result.riskScore,
        risk_level: result.riskLevel,
        risk_reason: result.riskReason,
        factors: result.factors,
        last_risk_update: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'product_id' }
    );
    if (upsertError) { console.error('[Risk] Error upserting risk score:', upsertError); continue; }

    const { error: historyError } = await supabase.from('product_risk_history').insert({
      company_id: companyId,
      product_id: productId,
      risk_score: result.riskScore,
      risk_level: result.riskLevel,
    });
    if (historyError) console.error('[Risk] Error inserting risk history:', historyError);
  }

  if (userId && userEmail && uniqueIds.length > 0) {
    await logAuditEvent({ companyId, userId, userEmail, action: 'risk.recompute', metadata: { productCount: uniqueIds.length } });
  }
}

export async function recomputeAllRiskForCompany(companyId: string, userId: string, userEmail: string): Promise<number> {
  const { data, error } = await supabase.from('products').select('id').eq('company_id', companyId);
  if (error || !data) { console.error('[Risk] Error loading products for full recompute:', error); return 0; }
  await recomputeRiskForProducts(data.map(p => p.id), companyId, userId, userEmail);
  return data.length;
}

export async function getProductRisk(productId: string, companyId: string): Promise<ProductRiskScore | null> {
  const { data, error } = await supabase
    .from('product_risk_scores').select('*').eq('product_id', productId).eq('company_id', companyId).maybeSingle();
  if (error) { console.error('[Risk] Error loading product risk:', error); return null; }
  return data as ProductRiskScore | null;
}

export async function getRiskForProducts(productIds: string[], companyId: string): Promise<Map<string, ProductRiskScore>> {
  if (productIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('product_risk_scores').select('*').eq('company_id', companyId).in('product_id', productIds);
  if (error) { console.error('[Risk] Error bulk-loading risk scores:', error); return new Map(); }
  return new Map((data as ProductRiskScore[]).map(row => [row.product_id, row]));
}

export interface RiskCompanySummaryRow {
  company_id: string;
  avg_risk: number;
  total_scored: number;
  critico_count: number;
  alto_count: number;
  medio_count: number;
  baixo_count: number;
}

export async function getCompanyRiskSummary(companyId: string): Promise<RiskCompanySummaryRow | null> {
  const { data, error } = await supabase.from('risk_company_summary_v').select('*').eq('company_id', companyId).maybeSingle();
  if (error) { console.error('[Risk] Error loading risk summary:', error); return null; }
  return data as RiskCompanySummaryRow | null;
}

export type RiskFilter = 'all' | 'critico' | 'alto' | 'medio' | 'baixo' | 'priority_queue';

export interface ProductRiskRow extends ProductRiskScore {
  product_name: string;
  product_sku: string;
  product_location: string | null;
}

async function listRiskRows(companyId: string): Promise<ProductRiskRow[]> {
  const { data, error } = await supabase
    .from('product_risk_scores')
    .select('*, products(name, sku, location)')
    .eq('company_id', companyId)
    .order('risk_score', { ascending: false })
    .limit(500);
  if (error) { console.error('[Risk] Error listing risk scores:', error); return []; }

  return (data ?? []).map((row) => {
    const r = row as ProductRiskScore & { products: { name: string; sku: string; location: string | null } | null };
    return {
      ...r,
      product_name: r.products?.name ?? '—',
      product_sku: r.products?.sku ?? '—',
      product_location: r.products?.location ?? null,
    };
  });
}

export async function listRiskWithFilter(companyId: string, filter: RiskFilter): Promise<ProductRiskRow[]> {
  const rows = await listRiskRows(companyId);
  if (filter === 'all') return rows;
  if (filter === 'priority_queue') return generateSmartCountQueue(rows, 50);
  return rows.filter(r => r.risk_level === filter);
}

export async function getTop50Critical(companyId: string): Promise<ProductRiskRow[]> {
  const rows = await listRiskRows(companyId);
  return rows.slice(0, 50);
}

/** Fila inteligente de contagem: prioriza por faixa de risco e, DENTRO de cada faixa,
 *  agrupa por localização (string, ordem alfabética) para reduzir deslocamento físico —
 *  heurística de agrupamento por zona, não roteamento real (não há coordenadas de planta
 *  baixa neste app). */
const BAND_ORDER: Record<RiskBand, number> = { critico: 0, alto: 1, medio: 2, baixo: 3 };

export function generateSmartCountQueue(rows: ProductRiskRow[], limit = 50): ProductRiskRow[] {
  return [...rows]
    .sort((a, b) => {
      const bandDiff = BAND_ORDER[a.risk_level] - BAND_ORDER[b.risk_level];
      if (bandDiff !== 0) return bandDiff;
      return (a.product_location ?? '').localeCompare(b.product_location ?? '');
    })
    .slice(0, limit);
}

export interface RiskBandMigration {
  productId: string;
  from: RiskBand;
  to: RiskBand;
  direction: 'up' | 'down';
}

export async function getRiskBandMigrations(companyId: string): Promise<RiskBandMigration[]> {
  const { data, error } = await supabase
    .from('product_risk_history')
    .select('product_id, risk_level, recorded_at')
    .eq('company_id', companyId)
    .order('recorded_at', { ascending: false })
    .limit(2000);
  if (error) { console.error('[Risk] Error loading risk history:', error); return []; }

  const byProduct = new Map<string, { risk_level: RiskBand; recorded_at: string }[]>();
  for (const row of data ?? []) {
    const list = byProduct.get(row.product_id) ?? [];
    if (list.length < 2) list.push({ risk_level: row.risk_level as RiskBand, recorded_at: row.recorded_at });
    byProduct.set(row.product_id, list);
  }

  const migrations: RiskBandMigration[] = [];
  for (const [productId, entries] of byProduct) {
    if (entries.length < 2) continue;
    const [latest, previous] = entries;
    if (latest.risk_level !== previous.risk_level) {
      migrations.push({
        productId,
        from: previous.risk_level,
        to: latest.risk_level,
        // Ordem inversa da do CBC: aqui "subir" de faixa (rumo a crítico) é piora, não melhora.
        direction: BAND_ORDER[latest.risk_level] < BAND_ORDER[previous.risk_level] ? 'up' : 'down',
      });
    }
  }
  return migrations;
}

export interface RiskTrendPoint {
  date: string;
  avgScore: number;
}

export async function getRiskTrend(companyId: string, days = 30): Promise<RiskTrendPoint[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('product_risk_history')
    .select('risk_score, recorded_at')
    .eq('company_id', companyId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: true });
  if (error) { console.error('[Risk] Error loading risk trend:', error); return []; }

  const byDay = new Map<string, number[]>();
  for (const row of data ?? []) {
    const day = row.recorded_at.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(row.risk_score);
    byDay.set(day, list);
  }
  return Array.from(byDay.entries()).map(([date, scores]) => ({
    date,
    avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
  }));
}

export async function setCriticalityOverride(
  productId: string,
  companyId: string,
  level: CriticalityLevel,
  userId: string,
  userEmail: string
): Promise<boolean> {
  const { error } = await supabase.from('product_criticality_overrides').upsert(
    { company_id: companyId, product_id: productId, criticality_level: level, set_by: userId, updated_at: new Date().toISOString() },
    { onConflict: 'product_id' }
  );
  if (error) { console.error('[Risk] Error setting criticality override:', error); return false; }

  await logAuditEvent({ companyId, userId, userEmail, action: 'risk.criticality_override', resourceType: 'product', resourceId: productId, metadata: { level } });
  await recomputeRiskForProducts([productId], companyId, userId, userEmail);
  return true;
}
