// Confidence Based Counting (CBC) — acesso a dados: coleta os fatores brutos por SKU-local,
// chama o motor puro (cbcAlgorithm.ts) e grava o resultado + histórico. Nenhuma lógica de
// pontuação mora aqui — só busca de dados e persistência.
//
// "SKU-local": este app associa no máximo UMA localização por produto (products.location,
// SKU único por empresa — products_company_sku_unique_idx). Por isso o grão
// workspace+SKU+localização já é 1:1 com o grão existente workspace+produto: cada linha de
// product_confidence_scores JÁ É um SKU-local. O que faltava era não misturar o HISTÓRICO de
// contagens de locais antigos — por isso as últimas contagens usadas no cálculo são filtradas
// pela localização atual do produto (quando ele tem uma).

import { supabase, ProductConfidenceScore, RiskLevel } from './supabase';
import { computeConfidenceScore, computePriority, buildWhyToCount, ConfidenceInput, AbcClass } from './cbcAlgorithm';
import { validateProductEan } from './productCatalog/catalogQuality';
import { logAuditEvent } from './auditLogService';

interface RawCountRow {
  count_record_id: string;
  status: string | null;
  saldo_sistema: number | null;
  saldo_contado: number | null;
  local: string | null;
  responsavel: string | null;
  created_at: string;
}

async function gatherInputForProduct(productId: string, companyId: string): Promise<{
  input: ConfidenceInput;
  location: string | null;
  lastCountDate: string | null;
  rawCounts: RawCountRow[];
} | null> {
  const [{ data: product, error: productError }, { data: assoc }, { data: abcRow }] = await Promise.all([
    supabase.from('products').select('sku, ean, stock_quantity, location').eq('id', productId).eq('company_id', companyId).maybeSingle(),
    supabase.from('product_brand_associations').select('brand_id, line_id').eq('product_id', productId).eq('company_id', companyId).maybeSingle(),
    supabase.from('product_abc_xyz_classifications').select('abc_class').eq('product_id', productId).eq('company_id', companyId).maybeSingle(),
  ]);
  if (productError || !product) {
    if (productError) console.error('[CBC] Error loading product:', productError);
    return null;
  }

  const location = product.location && product.location.trim() ? product.location.trim() : null;

  let countQuery = supabase
    .from('inventory_count_import_items')
    .select('count_record_id, status, saldo_sistema, saldo_contado, local, responsavel, created_at')
    .eq('product_id', productId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(20); // buffer extra para o filtro por local; só as 5 mais recentes entram no cálculo

  // Não misturar históricos de localizações diferentes: se o produto tem uma localização
  // cadastrada hoje, só contam as contagens registradas NAQUELE local.
  if (location) countQuery = countQuery.eq('local', location);

  const { data: countRows, error: countError } = await countQuery;
  if (countError) console.error('[CBC] Error loading count items:', countError);

  const rawCounts = (countRows ?? []) as RawCountRow[];
  const relevantCounts = rawCounts.slice(0, 5);

  const now = Date.now();
  const daysSince = (iso: string) => Math.floor((now - new Date(iso).getTime()) / 86400000);

  const recentCounts = relevantCounts.map(r => ({
    daysAgo: daysSince(r.created_at),
    systemQty: r.saldo_sistema,
    physicalQty: r.saldo_contado,
  }));

  const divergentAmongRecent = relevantCounts.filter(r => r.status && r.status !== 'correct');
  const repeatOffenseCount = new Set(divergentAmongRecent.map(r => r.count_record_id)).size;

  const sixtyDaysAgo = new Date(now - 60 * 86400000).toISOString();
  const { data: picks, error: picksError } = await supabase
    .from('full_operation_items')
    .select('quantity_picked, picked_at')
    .eq('company_id', companyId)
    .eq('sku', product.sku)
    .gte('picked_at', sixtyDaysAgo);
  if (picksError) console.error('[CBC] Error loading Full Manager picks:', picksError);

  const picksPerMonth = (picks ?? []).length / 2; // janela de 60 dias = 2 meses

  const abcClass = (abcRow?.abc_class as AbcClass | undefined) ?? null;
  const eanCheck = validateProductEan(product.ean);

  const input: ConfidenceInput = {
    abcClass,
    recentCounts,
    repeatOffenseCount,
    currentStockQuantity: product.stock_quantity ?? 0,
    picksPerMonth,
    hasBrandOrLine: !!(assoc?.brand_id || assoc?.line_id),
    hasLocation: !!location,
    eanValid: eanCheck.present ? eanCheck.ok : null,
  };

  return { input, location, lastCountDate: relevantCounts[0]?.created_at ?? null, rawCounts };
}

// Guarda simples contra clique duplo em "Recalcular scores" — um recálculo por empresa
// por vez (fire-and-forget dos triggers individuais continuam livres, o que se evita
// duplicar é o botão "Recalcular Tudo" do dashboard).
const recomputingCompanies = new Set<string>();

export interface RecomputeSummary {
  updated: number;
  insufficient: number;
}

/** Recalcula e grava o score de um lote de produtos — chamada de forma "fire-and-forget"
 *  (não bloqueia a UI) a partir dos pontos de gatilho: import de contagem e conclusão de
 *  operação Full Manager, além do botão manual "Recalcular scores" do dashboard CBC. */
export async function recomputeForProducts(
  productIds: string[],
  companyId: string,
  userId?: string,
  userEmail?: string
): Promise<RecomputeSummary> {
  const uniqueIds = Array.from(new Set(productIds));
  let updated = 0;
  let insufficient = 0;

  for (const productId of uniqueIds) {
    const gathered = await gatherInputForProduct(productId, companyId);
    if (!gathered) continue;
    const { input, lastCountDate } = gathered;

    const confidence = computeConfidenceScore(input);
    const priority = computePriority(input, confidence);
    const whyToCount = buildWhyToCount(input, confidence);
    const nowIso = new Date().toISOString();

    const nextCountDate = lastCountDate
      ? new Date(new Date(lastCountDate).getTime() + confidence.targetIntervalDays * 86400000)
      : new Date(); // nunca contado — precisa de uma primeira contagem já

    const { error: upsertError } = await supabase.from('product_confidence_scores').upsert(
      {
        company_id: companyId,
        product_id: productId,
        confidence_score: confidence.confidenceScore,
        risk_level: confidence.riskLevel,
        has_sufficient_data: confidence.hasSufficientData,
        missing_factors: confidence.missingFactors,
        next_count_date: nextCountDate.toISOString().slice(0, 10),
        factors: confidence.factors,
        top_reasons: confidence.hasSufficientData
          ? Object.entries(confidence.factors)
              .filter(([, f]) => f.score < f.max)
              .sort((a, b) => (b[1].max - b[1].score) - (a[1].max - a[1].score))
              .slice(0, 3)
              .map(([, f]) => f.detail)
          : ['Sem dados suficientes para calcular a confiança'],
        priority_score: priority.priorityScore,
        why_to_count: whyToCount,
        last_algorithm_run: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'product_id' }
    );
    if (upsertError) { console.error('[CBC] Error upserting confidence score:', upsertError); continue; }

    updated += 1;
    if (!confidence.hasSufficientData) insufficient += 1;

    if (confidence.hasSufficientData && confidence.confidenceScore != null && confidence.riskLevel) {
      const { error: historyError } = await supabase.from('product_confidence_history').insert({
        company_id: companyId,
        product_id: productId,
        confidence_score: confidence.confidenceScore,
        risk_level: confidence.riskLevel,
      });
      if (historyError) console.error('[CBC] Error inserting confidence history:', historyError);
    }
  }

  if (userId && userEmail && uniqueIds.length > 0) {
    await logAuditEvent({ companyId, userId, userEmail, action: 'cbc.recompute', metadata: { productCount: uniqueIds.length, updated, insufficient } });
  }

  return { updated, insufficient };
}

export async function recomputeAllForCompany(companyId: string, userId: string, userEmail: string): Promise<RecomputeSummary> {
  if (recomputingCompanies.has(companyId)) {
    throw new Error('Recálculo já em andamento para este workspace.');
  }
  recomputingCompanies.add(companyId);
  try {
    const { data, error } = await supabase.from('products').select('id').eq('company_id', companyId);
    if (error || !data) { console.error('[CBC] Error loading products for full recompute:', error); return { updated: 0, insufficient: 0 }; }
    return await recomputeForProducts(data.map(p => p.id), companyId, userId, userEmail);
  } finally {
    recomputingCompanies.delete(companyId);
  }
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
  avg_confidence: number | null;
  total_scored: number;
  distinct_locations: number;
  excelente_count: number;
  bom_count: number;
  medio_count: number;
  critico_count: number;
  insufficient_count: number;
  overdue_count: number;
  due_this_week_count: number;
  scheduled_this_week_count: number;
}

export async function getLastRecalculatedAt(companyId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('product_confidence_scores')
    .select('last_algorithm_run')
    .eq('company_id', companyId)
    .order('last_algorithm_run', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.error('[CBC] Error loading last recalculation time:', error); return null; }
  return data?.last_algorithm_run ?? null;
}

export async function getCompanySummary(companyId: string): Promise<CBCCompanySummaryRow | null> {
  const { data, error } = await supabase.from('cbc_company_summary_v').select('*').eq('company_id', companyId).maybeSingle();
  if (error) { console.error('[CBC] Error loading CBC summary:', error); return null; }
  return data as CBCCompanySummaryRow | null;
}

export type CBCTab = 'priorities' | 'critical' | 'overdue' | 'scheduled' | 'all';

export interface CBCListFilters {
  search?: string;
  riskLevel?: RiskLevel | 'insuficiente' | 'all';
  location?: string | 'all';
}

export interface ProductConfidenceRow extends ProductConfidenceScore {
  product_name: string;
  product_sku: string;
  product_location: string | null;
}

const PAGE_SIZE = 50;

export interface CBCListResult {
  rows: ProductConfidenceRow[];
  totalCount: number;
}

/** Lista paginada por aba — Prioridades ordena por priority_score, as demais têm seu
 *  próprio recorte real (nunca um "todos com filtro cosmético"). */
export async function listByTab(
  companyId: string,
  tab: CBCTab,
  filters: CBCListFilters,
  page: number
): Promise<CBCListResult> {
  let query = supabase
    .from('product_confidence_scores')
    .select('*, products!inner(name, sku, location)', { count: 'exact' })
    .eq('company_id', companyId);

  const today = new Date().toISOString().slice(0, 10);

  if (tab === 'critical') query = query.eq('risk_level', 'critico');
  if (tab === 'overdue') query = query.lt('next_count_date', today);
  if (tab === 'scheduled') query = query.eq('is_manually_scheduled', true);

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

  // "Vencidas" ordena pelas mais atrasadas primeiro; as demais abas ordenam por
  // urgência operacional (prioridade), não pelo score de confiança sozinho.
  query = tab === 'overdue'
    ? query.order('next_count_date', { ascending: true })
    : query.order('priority_score', { ascending: false, nullsFirst: false });

  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) { console.error('[CBC] Error listing confidence scores:', error); return { rows: [], totalCount: 0 }; }

  const rows = (data ?? []).map((row) => {
    const r = row as ProductConfidenceScore & { products: { name: string; sku: string; location: string | null } | null };
    return { ...r, product_name: r.products?.name ?? '—', product_sku: r.products?.sku ?? '—', product_location: r.products?.location ?? null };
  });

  return { rows, totalCount: count ?? 0 };
}

export async function listLocations(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('products').select('location').eq('company_id', companyId).not('location', 'is', null);
  if (error) { console.error('[CBC] Error listing locations:', error); return []; }
  const set = new Set((data ?? []).map(r => r.location).filter((l): l is string => !!l && l.trim() !== ''));
  return Array.from(set).sort();
}

export async function scheduleCount(productId: string, companyId: string, userId: string, scheduled: boolean): Promise<void> {
  const { error } = await supabase
    .from('product_confidence_scores')
    .update({ is_manually_scheduled: scheduled, scheduled_by: scheduled ? userId : null, scheduled_at: scheduled ? new Date().toISOString() : null })
    .eq('product_id', productId)
    .eq('company_id', companyId);
  if (error) console.error('[CBC] Error scheduling count:', error);
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

/** Só devolve pontos quando há histórico real o bastante — nunca fabrica uma série
 *  retroativa. O chamador mostra "o histórico será exibido após novas recalculações"
 *  quando o array vier com menos de 2 pontos. */
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

export interface ProductCountHistoryRow {
  date: string;
  systemQty: number | null;
  physicalQty: number | null;
  divergence: number | null;
  responsavel: string | null;
}

/** Histórico real de contagens do SKU-local (para a aba "Histórico" do drawer de detalhe). */
export async function getCountHistoryForProduct(productId: string, companyId: string, location: string | null): Promise<ProductCountHistoryRow[]> {
  let query = supabase
    .from('inventory_count_import_items')
    .select('saldo_sistema, saldo_contado, diferenca, responsavel, created_at')
    .eq('product_id', productId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (location) query = query.eq('local', location);

  const { data, error } = await query;
  if (error) { console.error('[CBC] Error loading count history:', error); return []; }
  return (data ?? []).map(r => ({
    date: r.created_at,
    systemQty: r.saldo_sistema,
    physicalQty: r.saldo_contado,
    divergence: r.diferenca,
    responsavel: r.responsavel,
  }));
}
