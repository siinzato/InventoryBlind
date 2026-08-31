// Inventário por Risco — acesso a dados. Espelha cbcService.ts: coleta os fatores brutos
// por SKU-local, chama o motor puro (riskAlgorithm.ts) e grava resultado + histórico.
//
// "SKU-local": este app associa no máximo UMA localização por produto (products.location),
// então product_risk_scores já é o grão certo (workspace + SKU + localização). O que
// importa é não misturar o HISTÓRICO de contagens de uma localização antiga — por isso as
// contagens usadas no cálculo são filtradas pelo local atual do produto, igual ao CBC.

import { supabase, ProductRiskScore, RiskBand, CriticalityLevel } from './supabase';
import { computeRiskScore, RiskInput, AbcClass } from './riskAlgorithm';
import { logAuditEvent } from './auditLogService';

export async function getCriticalityLevel(productId: string, companyId: string): Promise<CriticalityLevel> {
  const { data, error } = await supabase
    .from('product_criticality_overrides').select('criticality_level').eq('product_id', productId).eq('company_id', companyId).maybeSingle();
  if (error) { console.error('[Risk] Error loading criticality override:', error); return 'normal'; }
  return (data?.criticality_level as CriticalityLevel) ?? 'normal';
}

interface GatheredInput {
  input: RiskInput;
  location: string | null;
}

async function gatherInputForProduct(productId: string, companyId: string): Promise<GatheredInput | null> {
  const [{ data: product, error: productError }, { data: abcRow }] = await Promise.all([
    supabase.from('products').select('sku, price, stock_quantity, location').eq('id', productId).eq('company_id', companyId).maybeSingle(),
    supabase.from('product_abc_xyz_classifications').select('abc_class').eq('product_id', productId).eq('company_id', companyId).maybeSingle(),
  ]);
  if (productError || !product) {
    if (productError) console.error('[Risk] Error loading product:', productError);
    return null;
  }

  const location = product.location && product.location.trim() ? product.location.trim() : null;
  const abcClass = (abcRow?.abc_class as AbcClass | undefined) ?? null;

  // Só entram na conta as contagens registradas NAQUELE local, para nunca misturar
  // o histórico de uma localização anterior do produto.
  let countQuery = supabase
    .from('inventory_count_import_items')
    .select('count_record_id, status, diferenca, saldo_sistema, saldo_contado, local, created_at')
    .eq('product_id', productId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (location) countQuery = countQuery.eq('local', location);

  const { data: countItems, error: countError } = await countQuery;
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
  const quantityMovedPerMonth = pickRows.reduce((sum, p) => sum + (p.quantity_picked ?? 0), 0) / 2;

  const criticalityLevel = await getCriticalityLevel(productId, companyId);

  return {
    location,
    input: {
      totalCounts: items.length,
      divergentCounts: divergentItems.length,
      repeatOffenseCount,
      daysSinceLastCount,
      stockoutCount,
      adjustmentCount,
      abcClass,
      unitPrice: product.price ?? 0,
      currentStockQuantity: product.stock_quantity ?? 0,
      quantityMovedPerMonth,
      criticalityLevel,
    },
  };
}

export interface RecomputeSummary {
  updated: number;
  insufficient: number;
}

export async function recomputeRiskForProducts(
  productIds: string[],
  companyId: string,
  userId?: string,
  userEmail?: string
): Promise<RecomputeSummary> {
  const uniqueIds = Array.from(new Set(productIds));
  let insufficient = 0;

  for (const productId of uniqueIds) {
    const gathered = await gatherInputForProduct(productId, companyId);
    if (!gathered) continue;

    const result = computeRiskScore(gathered.input);
    if (!result.hasSufficientData) insufficient += 1;
    const nowIso = new Date().toISOString();

    const { error: upsertError } = await supabase.from('product_risk_scores').upsert(
      {
        company_id: companyId,
        product_id: productId,
        risk_score: result.riskScore,
        risk_level: result.riskLevel,
        risk_reason: result.dominantCause,
        probability: result.probability,
        impact: result.impact,
        has_sufficient_data: result.hasSufficientData,
        missing_factors: result.missingFactors,
        factors: { probability: result.probabilityFactors, impact: result.impactFactors },
        last_risk_update: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'product_id' }
    );
    if (upsertError) { console.error('[Risk] Error upserting risk score:', upsertError); continue; }

    // Histórico só grava snapshots com dado real — nunca um valor fabricado para
    // "preencher" a evolução (regra explícita do escopo desta tarefa).
    if (result.hasSufficientData && result.riskScore != null && result.riskLevel) {
      const { error: historyError } = await supabase.from('product_risk_history').insert({
        company_id: companyId,
        product_id: productId,
        risk_score: result.riskScore,
        risk_level: result.riskLevel,
      });
      if (historyError) console.error('[Risk] Error inserting risk history:', historyError);
    }
  }

  if (userId && userEmail && uniqueIds.length > 0) {
    await logAuditEvent({ companyId, userId, userEmail, action: 'risk.recompute', metadata: { productCount: uniqueIds.length, insufficient } });
  }

  return { updated: uniqueIds.length - insufficient, insufficient };
}

export async function recomputeAllRiskForCompany(companyId: string, userId: string, userEmail: string): Promise<RecomputeSummary> {
  const { data, error } = await supabase.from('products').select('id').eq('company_id', companyId);
  if (error || !data) { console.error('[Risk] Error loading products for full recompute:', error); return { updated: 0, insufficient: 0 }; }
  return recomputeRiskForProducts(data.map(p => p.id), companyId, userId, userEmail);
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
  avg_risk: number | null;
  total_scored: number;
  critico_count: number;
  alto_count: number;
  medio_count: number;
  baixo_count: number;
  insufficient_count: number;
}

export async function getCompanyRiskSummary(companyId: string): Promise<RiskCompanySummaryRow | null> {
  const { data, error } = await supabase.from('risk_company_summary_v').select('*').eq('company_id', companyId).maybeSingle();
  if (error) { console.error('[Risk] Error loading risk summary:', error); return null; }
  return data as RiskCompanySummaryRow | null;
}

export async function getLastRecalculatedAt(companyId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('product_risk_scores')
    .select('last_risk_update')
    .eq('company_id', companyId)
    .order('last_risk_update', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.error('[Risk] Error loading last recalculation time:', error); return null; }
  return data?.last_risk_update ?? null;
}

export type RiskTab = 'priorities' | 'critical' | 'high' | 'all';

export interface RiskListFilters {
  search?: string;
  riskLevel?: RiskBand | 'insuficiente' | 'all';
  location?: string | 'all';
  cause?: string | 'all';
}

export interface ProductRiskRow extends ProductRiskScore {
  product_name: string;
  product_sku: string;
  product_location: string | null;
}

const PAGE_SIZE = 50;

export interface RiskListResult {
  rows: ProductRiskRow[];
  totalCount: number;
}

/** Lista paginada por aba. "Prioridades" ordena pelo maior Risk Score (dados
 *  insuficientes ficam por último, nunca no topo por um score fabricado). */
export async function listByTab(
  companyId: string,
  tab: RiskTab,
  filters: RiskListFilters,
  page: number
): Promise<RiskListResult> {
  let query = supabase
    .from('product_risk_scores')
    .select('*, products!inner(name, sku, location)', { count: 'exact' })
    .eq('company_id', companyId);

  if (tab === 'critical') query = query.eq('risk_level', 'critico');
  if (tab === 'high') query = query.eq('risk_level', 'alto');

  if (filters.search?.trim()) {
    const term = filters.search.trim();
    query = query.or(`sku.ilike.%${term}%,name.ilike.%${term}%,location.ilike.%${term}%`, { referencedTable: 'products' });
  }
  if (filters.riskLevel && filters.riskLevel !== 'all') {
    if (filters.riskLevel === 'insuficiente') query = query.eq('has_sufficient_data', false);
    else query = query.eq('risk_level', filters.riskLevel);
  }
  if (filters.location && filters.location !== 'all') {
    query = query.eq('products.location', filters.location);
  }
  if (filters.cause && filters.cause !== 'all') {
    query = query.eq('risk_reason', filters.cause);
  }

  query = query
    .order('has_sufficient_data', { ascending: false })
    .order('risk_score', { ascending: false, nullsFirst: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const { data, error, count } = await query;
  if (error) { console.error('[Risk] Error listing risk scores:', error); return { rows: [], totalCount: 0 }; }

  const rows = (data ?? []).map((row) => {
    const r = row as ProductRiskScore & { products: { name: string; sku: string; location: string | null } | null };
    return {
      ...r,
      product_name: r.products?.name ?? '—',
      product_sku: r.products?.sku ?? '—',
      product_location: r.products?.location ?? null,
    };
  });

  return { rows, totalCount: count ?? rows.length };
}

export async function listLocations(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('products').select('location').eq('company_id', companyId).not('location', 'is', null);
  if (error) { console.error('[Risk] Error listing locations:', error); return []; }
  const set = new Set((data ?? []).map(r => r.location).filter((l): l is string => !!l && l.trim() !== ''));
  return Array.from(set).sort();
}

export async function listCauses(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('product_risk_scores').select('risk_reason').eq('company_id', companyId).eq('has_sufficient_data', true);
  if (error) { console.error('[Risk] Error listing causes:', error); return []; }
  const set = new Set((data ?? []).map(r => r.risk_reason).filter((c): c is string => !!c && c.trim() !== ''));
  return Array.from(set).sort();
}

/** Todas as linhas com dado suficiente, sem paginação — usado para montar clusters
 *  de inspeção (precisa enxergar tudo para agrupar por corredor). */
async function listAllScoredRows(companyId: string): Promise<ProductRiskRow[]> {
  const { data, error } = await supabase
    .from('product_risk_scores')
    .select('*, products!inner(name, sku, location)')
    .eq('company_id', companyId)
    .eq('has_sufficient_data', true)
    .in('risk_level', ['critico', 'alto'])
    .order('risk_score', { ascending: false })
    .limit(2000);
  if (error) { console.error('[Risk] Error loading rows for clustering:', error); return []; }
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

export interface RiskCluster {
  /** Primeiro segmento do endereço (ex.: "A" em "A-03-02"), ou o endereço inteiro
   *  quando não há separador — heurística de agrupamento por zona, não roteamento
   *  real (não há coordenadas de planta baixa neste app). */
  corridor: string;
  items: ProductRiskRow[];
}

function corridorOf(location: string): string {
  const dash = location.indexOf('-');
  return dash > 0 ? location.slice(0, dash) : location;
}

/** Pura e exportada para teste direto: agrupa SKU-locais de risco alto/crítico
 *  por proximidade física, DEPOIS de o risco intrínseco já estar calculado — a
 *  proximidade nunca entra na conta do Risk Score, só decide como agrupar a
 *  rota de inspeção. Só forma cluster com 2+ itens no mesmo corredor. */
export function groupIntoClusters(rows: ProductRiskRow[]): RiskCluster[] {
  const byCorridor = new Map<string, ProductRiskRow[]>();
  for (const row of rows) {
    if (!row.product_location) continue;
    const corridor = corridorOf(row.product_location);
    const list = byCorridor.get(corridor) ?? [];
    list.push(row);
    byCorridor.set(corridor, list);
  }
  return Array.from(byCorridor.entries())
    .map(([corridor, items]) => ({ corridor, items }))
    .filter(c => c.items.length >= 2)
    .sort((a, b) => b.items.length - a.items.length);
}

export async function getRiskClusters(companyId: string): Promise<RiskCluster[]> {
  const rows = await listAllScoredRows(companyId);
  return groupIntoClusters(rows);
}

export interface RiskBandMigration {
  productId: string;
  from: RiskBand;
  to: RiskBand;
  direction: 'up' | 'down';
}

const BAND_ORDER: Record<RiskBand, number> = { critico: 0, alto: 1, medio: 2, baixo: 3 };

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
  criticalCount: number;
}

export async function getRiskTrend(companyId: string, days = 30): Promise<RiskTrendPoint[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('product_risk_history')
    .select('risk_score, risk_level, recorded_at')
    .eq('company_id', companyId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: true });
  if (error) { console.error('[Risk] Error loading risk trend:', error); return []; }

  const byDay = new Map<string, { scores: number[]; critical: number }>();
  for (const row of data ?? []) {
    const day = row.recorded_at.slice(0, 10);
    const bucket = byDay.get(day) ?? { scores: [], critical: 0 };
    bucket.scores.push(row.risk_score);
    if (row.risk_level === 'critico') bucket.critical += 1;
    byDay.set(day, bucket);
  }
  return Array.from(byDay.entries()).map(([date, bucket]) => ({
    date,
    avgScore: Math.round(bucket.scores.reduce((a, b) => a + b, 0) / bucket.scores.length),
    criticalCount: bucket.critical,
  }));
}

export interface RiskEvidenceEvent {
  date: string;
  label: string;
  detail: string;
}

/** Timeline de eventos reais para a seção "Evidências recentes" do painel lateral —
 *  nunca texto ou número fictício, só o que está de fato registrado. */
export async function getRecentEvidenceForProduct(productId: string, companyId: string, location: string | null): Promise<RiskEvidenceEvent[]> {
  let query = supabase
    .from('inventory_count_import_items')
    .select('saldo_sistema, saldo_contado, diferenca, status, created_at')
    .eq('product_id', productId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(5);
  if (location) query = query.eq('local', location);

  const { data, error } = await query;
  if (error) { console.error('[Risk] Error loading evidence timeline:', error); return []; }

  return (data ?? []).map(r => {
    const diff = r.diferenca ?? 0;
    const isStockout = (r.saldo_sistema ?? 1) <= 0 || (r.saldo_contado ?? 1) <= 0;
    if (isStockout) {
      return { date: r.created_at, label: 'Ruptura de estoque', detail: `Saldo sistema ${r.saldo_sistema ?? '—'} · contado ${r.saldo_contado ?? '—'}` };
    }
    if (diff !== 0) {
      return { date: r.created_at, label: 'Divergência de contagem', detail: `Diferença de ${diff > 0 ? '+' : ''}${diff} unidade(s)` };
    }
    return { date: r.created_at, label: 'Contagem sem divergência', detail: `Saldo confirmado em ${r.saldo_contado ?? r.saldo_sistema ?? '—'}` };
  });
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
