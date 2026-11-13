// Inventário por Risco — acesso a dados. Espelha cbcService.ts: coleta os fatores brutos
// por SKU-local, chama o motor puro (riskAlgorithm.ts) e grava resultado + histórico.
//
// "SKU-local": este app associa no máximo UMA localização por produto (products.location),
// então product_risk_scores já é o grão certo (workspace + SKU + localização). O que
// importa é não misturar o HISTÓRICO de contagens de uma localização antiga — por isso as
// contagens usadas no cálculo são filtradas pelo local atual do produto, igual ao CBC.

import { supabase, ProductRiskScore, RiskBand, CriticalityLevel } from './supabase';
import { fetchAllPages } from './supabasePagination';
import { computeRiskScore, RiskInput, AbcClass } from './riskAlgorithm';
import { logAuditEvent } from './auditLogService';
import { plural } from '../lib/formatPtBr';

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


// ── Coleta EM LOTE ────────────────────────────────────────────────────────────────────
//
// Mesma razão da versão do CBC: a coleta por produto fazia 5 idas ao banco cada, em série,
// e para 4.628 produtos isso media ~1 produto por segundo. Aqui os mesmos dados vêm em
// blocos de 300 e o `RiskInput` montado é idêntico — `computeRiskScore` não foi tocado.
//
// A novidade em relação à versão anterior é a FONTE: além de `inventory_count_import_items`
// (zero linhas nesta base), entram os apontamentos de divergência do fechamento da linha,
// gravados em `inventory_items`. Sem eles o Risco pontua sobre tabela vazia.

const BATCH = 300;

function emBlocos<T>(itens: T[], tamanho = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));
  return out;
}

interface CountLike {
  count_record_id: string;
  status: string | null;
  diferenca: number | null;
  saldo_sistema: number | null;
  saldo_contado: number | null;
  local: string | null;
  created_at: string;
}

async function gatherRiskInputsForProducts(
  productIds: string[],
  companyId: string
): Promise<Map<string, GatheredInput>> {
  const resultado = new Map<string, GatheredInput>();
  if (productIds.length === 0) return resultado;

  const produtos = new Map<string, { sku: string; price: number | null; stock_quantity: number | null; location: string | null }>();
  const abc = new Map<string, AbcClass | null>();
  const criticidade = new Map<string, CriticalityLevel>();
  const contagens = new Map<string, CountLike[]>();
  const movimentoPorSku = new Map<string, number>();

  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();

  for (const bloco of emBlocos(productIds)) {
    const [prodRes, abcRes, critRes, countRes, apontRes] = await Promise.all([
      supabase.from('products').select('id, sku, price, stock_quantity, location').eq('company_id', companyId).in('id', bloco),
      supabase.from('product_abc_xyz_classifications').select('product_id, abc_class').eq('company_id', companyId).in('product_id', bloco),
      supabase.from('product_criticality_overrides').select('product_id, criticality_level').eq('company_id', companyId).in('product_id', bloco),
      supabase.from('inventory_count_import_items')
        .select('product_id, count_record_id, status, diferenca, saldo_sistema, saldo_contado, local, created_at')
        .eq('company_id', companyId).in('product_id', bloco).order('created_at', { ascending: false }),
      supabase.from('inventory_items')
        .select('id, product_id, expected_quantity, counted_quantity, location, updated_at')
        .eq('company_id', companyId).in('product_id', bloco)
        .not('counted_quantity', 'is', null).order('updated_at', { ascending: false }),
    ]);
    if (prodRes.error) { console.error('[Risk] Error loading products batch:', prodRes.error); continue; }
    for (const p of prodRes.data ?? []) produtos.set(p.id as string, p as never);
    for (const c of abcRes.data ?? []) abc.set(c.product_id as string, (c.abc_class as AbcClass | null) ?? null);
    for (const c of critRes.data ?? []) criticidade.set(c.product_id as string, (c.criticality_level as CriticalityLevel) ?? 'normal');
    for (const row of (countRes.data ?? []) as (CountLike & { product_id: string })[]) {
      const lista = contagens.get(row.product_id);
      if (lista) lista.push(row); else contagens.set(row.product_id, [row]);
    }
    for (const row of (apontRes.data ?? []) as Record<string, unknown>[]) {
      const esperado = row.expected_quantity === null ? null : Number(row.expected_quantity);
      const contado = row.counted_quantity === null ? null : Number(row.counted_quantity);
      const diferenca = contado !== null && esperado !== null ? contado - esperado : 0;
      const normalizado: CountLike = {
        count_record_id: row.id as string,
        status: diferenca !== 0 ? 'divergent' : 'correct',
        diferenca,
        saldo_sistema: esperado,
        saldo_contado: contado,
        local: (row.location as string | null) ?? null,
        created_at: (row.updated_at as string) ?? new Date().toISOString(),
      };
      const pid = row.product_id as string;
      const lista = contagens.get(pid);
      if (lista) lista.push(normalizado); else contagens.set(pid, [normalizado]);
    }
  }

  const skus = Array.from(new Set(Array.from(produtos.values()).map(p => p.sku).filter(Boolean)));
  for (const bloco of emBlocos(skus)) {
    const { data, error } = await supabase
      .from('full_operation_items').select('sku, quantity_picked')
      .eq('company_id', companyId).in('sku', bloco).gte('picked_at', sixtyDaysAgo);
    if (error) { console.error('[Risk] Error loading Full Manager picks batch:', error); continue; }
    for (const row of (data ?? []) as { sku: string; quantity_picked: number | null }[]) {
      movimentoPorSku.set(row.sku, (movimentoPorSku.get(row.sku) ?? 0) + (row.quantity_picked ?? 0));
    }
  }

  const now = Date.now();
  for (const productId of productIds) {
    const product = produtos.get(productId);
    if (!product) continue;
    const location = product.location && product.location.trim() ? product.location.trim() : null;

    // Mesmo recorte de antes: só o mesmo local quando o produto tem local cadastrado,
    // para nunca misturar o histórico de uma localização anterior.
    const todas = (contagens.get(productId) ?? [])
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    const items = location ? todas.filter(i => i.local === location) : todas;

    const divergentItems = items.filter(i => i.status && i.status !== 'correct');

    resultado.set(productId, {
      location,
      input: {
        totalCounts: items.length,
        divergentCounts: divergentItems.length,
        repeatOffenseCount: new Set(divergentItems.map(i => i.count_record_id)).size,
        daysSinceLastCount: items.length > 0 ? Math.floor((now - new Date(items[0].created_at).getTime()) / 86400000) : null,
        stockoutCount: items.filter(i => (i.saldo_sistema ?? 1) <= 0 || (i.saldo_contado ?? 1) <= 0).length,
        adjustmentCount: items.filter(i => (i.diferenca ?? 0) !== 0).length,
        abcClass: abc.get(productId) ?? null,
        unitPrice: product.price ?? 0,
        currentStockQuantity: product.stock_quantity ?? 0,
        quantityMovedPerMonth: (movimentoPorSku.get(product.sku) ?? 0) / 2,
        criticalityLevel: criticidade.get(productId) ?? 'normal',
      },
    });
  }

  return resultado;
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

  // Uma coleta em lote no lugar de 5 consultas por produto.
  const coletados = await gatherRiskInputsForProducts(uniqueIds, companyId);
  const paraGravar = [];
  const paraHistorico = [];

  for (const productId of uniqueIds) {
    const gathered = coletados.get(productId);
    if (!gathered) continue;

    const result = computeRiskScore(gathered.input);
    if (!result.hasSufficientData) insufficient += 1;
    const nowIso = new Date().toISOString();

    paraGravar.push({
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
    });

    // Histórico só grava snapshots com dado real — nunca um valor fabricado para
    // "preencher" a evolução (regra explícita do escopo desta tarefa).
    if (result.hasSufficientData && result.riskScore != null && result.riskLevel) {
      paraHistorico.push({
        company_id: companyId,
        product_id: productId,
        risk_score: result.riskScore,
        risk_level: result.riskLevel,
      });
    }
  }

  for (const bloco of emBlocos(paraGravar, 500)) {
    const { error } = await supabase.from('product_risk_scores').upsert(bloco, { onConflict: 'product_id' });
    if (error) console.error('[Risk] Error upserting risk scores batch:', error);
  }
  for (const bloco of emBlocos(paraHistorico, 500)) {
    const { error } = await supabase.from('product_risk_history').insert(bloco);
    if (error) console.error('[Risk] Error inserting risk history batch:', error);
  }

  if (userId && userEmail && uniqueIds.length > 0) {
    await logAuditEvent({ companyId, userId, userEmail, action: 'risk.recompute', metadata: { productCount: uniqueIds.length, insufficient } });
  }

  return { updated: uniqueIds.length - insufficient, insufficient };
}

export async function recomputeAllRiskForCompany(companyId: string, userId: string, userEmail: string): Promise<RecomputeSummary> {
  // Paginado: sem `.range()` vinham 1.000 dos 4.628 produtos, sem erro, e o
  // recálculo GRAVAVA só esses — daí `product_risk_scores` ter exatamente 1.000.
  // Congelado fica de fora do recálculo: pontuar risco de produto que saiu de
  // circulação gasta cálculo e, pior, disputa as primeiras posições da lista com
  // produto que ainda está em uso. O score anterior dele não é apagado.
  const { rows, error } = await fetchAllPages<{ id: string }>('Risk/products', (from, to) =>
    supabase.from('products').select('id').eq('company_id', companyId).is('frozen_at', null).order('id').range(from, to));
  if (error) { console.error('[Risk] Error loading products for full recompute:', error); return { updated: 0, insufficient: 0 }; }
  return recomputeRiskForProducts(rows.map(p => p.id), companyId, userId, userEmail);
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
    .select('*, products!inner(name, sku, location, frozen_at)', { count: 'exact' })
    .eq('company_id', companyId)
    // O score de quem foi congelado continua gravado; o que ele não faz mais é
    // aparecer na lista. Descongelar devolve o produto sem recalcular nada.
    .is('products.frozen_at', null);

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
  // Cortado em 1.000 produtos, corredores inteiros ficavam fora do filtro.
  const { rows, error } = await fetchAllPages<{ location: string | null }>('Risk/locations', (from, to) =>
    supabase.from('products').select('location').eq('company_id', companyId)
      .not('location', 'is', null).order('id').range(from, to));
  if (error) { console.error('[Risk] Error listing locations:', error); return []; }
  const set = new Set(rows.map(r => r.location).filter((l): l is string => !!l && l.trim() !== ''));
  return Array.from(set).sort();
}

export async function listCauses(companyId: string): Promise<string[]> {
  // Esta tabela tinha exatamente 1.000 linhas por causa do bug acima; depois de
  // paginar o recálculo ela passa dos 4.000, e esta leitura também precisa ir até o fim.
  const { rows, error } = await fetchAllPages<{ risk_reason: string | null }>('Risk/causes', (from, to) =>
    supabase.from('product_risk_scores').select('risk_reason').eq('company_id', companyId)
      .eq('has_sufficient_data', true).order('product_id').range(from, to));
  if (error) { console.error('[Risk] Error listing causes:', error); return []; }
  const set = new Set(rows.map(r => r.risk_reason).filter((c): c is string => !!c && c.trim() !== ''));
  return Array.from(set).sort();
}

/** Todas as linhas com dado suficiente, sem paginação — usado para montar clusters
 *  de inspeção (precisa enxergar tudo para agrupar por corredor). */
async function listAllScoredRows(companyId: string): Promise<ProductRiskRow[]> {
  // O teto de 2.000 era intenção, não efeito: o servidor cortava em 1.000 antes
  // de o `.limit()` valer. Paginado, os 2.000 passam a ser 2.000 de verdade.
  // O desempate por `product_id` é obrigatório — sem ele, linhas com o mesmo
  // `risk_score` repetem ou somem na virada do bloco.
  const { rows: data, error } = await fetchAllPages<ProductRiskScore & { products: { name: string; sku: string; location: string | null } | null }>(
    'Risk/clusters',
    (from, to) => supabase
      .from('product_risk_scores')
      .select('*, products!inner(name, sku, location)')
      .eq('company_id', companyId)
      .eq('has_sufficient_data', true)
      .in('risk_level', ['critico', 'alto'])
      .order('risk_score', { ascending: false })
      .order('product_id', { ascending: true })
      .range(from, to),
    2000
  );
  if (error) { console.error('[Risk] Error loading rows for clustering:', error); return []; }
  return data.map((row) => {
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
      return { date: r.created_at, label: 'Divergência de contagem', detail: `Diferença de ${diff > 0 ? '+' : ''}${diff} ${plural(diff, 'unidade', 'unidades')}` };
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
