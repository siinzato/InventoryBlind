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
import { fetchAllPages } from './supabasePagination';
import { computeConfidenceScore, computePriority, buildWhyToCount, intervaloEfetivoDias, ConfidenceInput, AbcClass } from './cbcAlgorithm';
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


// ── Coleta EM LOTE ────────────────────────────────────────────────────────────────────
//
// A versão anterior coletava os dados de UM produto por vez: 6 idas ao banco por produto,
// em série. Para os 4.628 produtos desta base isso dava ~30 mil requisições e uma taxa
// MEDIDA de 1,09 produto por segundo — cerca de 70 minutos, com o recálculo rodando no
// NAVEGADOR: fechar a aba no meio deixa metade do catálogo com score novo e metade com
// o antigo, que foi exatamente o que aconteceu numa execução interrompida.
//
// Esta versão busca os mesmos dados em blocos de 300 produtos e monta os mesmos
// `ConfidenceInput`. O algoritmo não foi tocado: `computeConfidenceScore`,
// `computePriority` e `buildWhyToCount` recebem exatamente o que recebiam antes, então os
// scores saem idênticos — muda só o número de requisições.

const BATCH = 300;

function emBlocos<T>(itens: T[], tamanho = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));
  return out;
}

interface GatheredInput {
  input: ConfidenceInput;
  location: string | null;
  lastCountDate: string | null;
}

async function gatherInputsForProducts(
  productIds: string[],
  companyId: string
): Promise<Map<string, GatheredInput>> {
  const resultado = new Map<string, GatheredInput>();
  if (productIds.length === 0) return resultado;

  const produtos = new Map<string, { sku: string; ean: string | null; stock_quantity: number | null; location: string | null }>();
  const assoc = new Map<string, boolean>();
  const abc = new Map<string, AbcClass | null>();
  const contagens = new Map<string, RawCountRow[]>();
  const picksPorSku = new Map<string, number>();
  // Apontamentos de divergência da contagem MANUAL, normalizados para o mesmo formato das
  // contagens importadas. Sem isto o CBC fica inerte nesta base: `inventory_count_import_items`
  // tem zero linhas porque todas as contagens são manuais, e o recálculo completo devolveu
  // "sem dados suficientes" para os 4.628 produtos.
  const apontamentos = new Map<string, RawCountRow[]>();

  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();

  for (const bloco of emBlocos(productIds)) {
    const [prodRes, assocRes, abcRes, countRes] = await Promise.all([
      supabase.from('products').select('id, sku, ean, stock_quantity, location').eq('company_id', companyId).in('id', bloco),
      supabase.from('product_brand_associations').select('product_id, brand_id, line_id').eq('company_id', companyId).in('product_id', bloco),
      supabase.from('product_abc_xyz_classifications').select('product_id, abc_class').eq('company_id', companyId).in('product_id', bloco),
      supabase.from('inventory_count_import_items')
        .select('product_id, count_record_id, status, saldo_sistema, saldo_contado, local, responsavel, created_at')
        .eq('company_id', companyId).in('product_id', bloco)
        .order('created_at', { ascending: false }),
    ]);
    if (prodRes.error) { console.error('[CBC] Error loading products batch:', prodRes.error); continue; }
    for (const p of prodRes.data ?? []) produtos.set(p.id as string, p as never);
    for (const a of assocRes.data ?? []) assoc.set(a.product_id as string, !!(a.brand_id || a.line_id));
    for (const c of abcRes.data ?? []) abc.set(c.product_id as string, (c.abc_class as AbcClass | null) ?? null);
    // Já vem ordenado do mais recente para o mais antigo, como a consulta por produto vinha.
    for (const row of (countRes.data ?? []) as (RawCountRow & { product_id: string })[]) {
      const lista = contagens.get(row.product_id);
      if (lista) lista.push(row); else contagens.set(row.product_id, [row]);
    }

    // Apontamentos do fechamento da linha. `status` é derivado: o algoritmo só distingue
    // 'correct' de qualquer outra coisa, e aqui divergente é contado <> esperado.
    const { data: apontRows, error: apontErro } = await supabase
      .from('inventory_items')
      .select('id, product_id, expected_quantity, counted_quantity, location, counted_by_name, updated_at')
      .eq('company_id', companyId).in('product_id', bloco)
      .not('counted_quantity', 'is', null)
      .order('updated_at', { ascending: false });
    if (apontErro) { console.error('[CBC] Error loading manual divergence batch:', apontErro); }
    for (const row of (apontRows ?? []) as Record<string, unknown>[]) {
      const esperado = row.expected_quantity === null ? null : Number(row.expected_quantity);
      const contado = row.counted_quantity === null ? null : Number(row.counted_quantity);
      const normalizado: RawCountRow = {
        // O id do item faz o papel de `count_record_id` na contagem de reincidência:
        // um apontamento por produto por ciclo, que é a mesma granularidade.
        count_record_id: row.id as string,
        status: contado !== null && contado !== esperado ? 'divergent' : 'correct',
        saldo_sistema: esperado,
        saldo_contado: contado,
        local: (row.location as string | null) ?? null,
        responsavel: (row.counted_by_name as string | null) ?? null,
        created_at: (row.updated_at as string) ?? new Date().toISOString(),
      };
      const pid = row.product_id as string;
      const lista = apontamentos.get(pid);
      if (lista) lista.push(normalizado); else apontamentos.set(pid, [normalizado]);
    }
  }

  // Picks do Full Manager, por SKU — uma consulta por bloco de SKUs em vez de por produto.
  const skus = Array.from(new Set(Array.from(produtos.values()).map(p => p.sku).filter(Boolean)));
  for (const bloco of emBlocos(skus)) {
    const { data, error } = await supabase
      .from('full_operation_items').select('sku')
      .eq('company_id', companyId).in('sku', bloco).gte('picked_at', sixtyDaysAgo);
    if (error) { console.error('[CBC] Error loading Full Manager picks batch:', error); continue; }
    for (const row of (data ?? []) as { sku: string }[]) {
      picksPorSku.set(row.sku, (picksPorSku.get(row.sku) ?? 0) + 1);
    }
  }

  for (const productId of productIds) {
    const product = produtos.get(productId);
    if (!product) continue;

    const location = product.location && product.location.trim() ? product.location.trim() : null;

    // Mesmo recorte da versão por produto: só o mesmo local quando o produto tem local,
    // 20 de buffer e as 5 mais recentes entrando no cálculo.
    // Contagem importada e apontamento manual entram na MESMA linha do tempo, ordenados
    // por data: o algoritmo pergunta "as 5 últimas vezes que este SKU foi conferido",
    // e a origem da conferência não muda a resposta.
    const todas = [...(contagens.get(productId) ?? []), ...(apontamentos.get(productId) ?? [])]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    const rawCounts = (location ? todas.filter(r => r.local === location) : todas).slice(0, 20);
    const relevantCounts = rawCounts.slice(0, 5);

    const now = Date.now();
    const daysSince = (iso: string) => Math.floor((now - new Date(iso).getTime()) / 86400000);

    const divergentAmongRecent = relevantCounts.filter(r => r.status && r.status !== 'correct');
    const eanCheck = validateProductEan(product.ean);

    resultado.set(productId, {
      location,
      lastCountDate: relevantCounts[0]?.created_at ?? null,
      input: {
        abcClass: abc.get(productId) ?? null,
        recentCounts: relevantCounts.map(r => ({
          daysAgo: daysSince(r.created_at),
          systemQty: r.saldo_sistema,
          physicalQty: r.saldo_contado,
        })),
        repeatOffenseCount: new Set(divergentAmongRecent.map(r => r.count_record_id)).size,
        currentStockQuantity: product.stock_quantity ?? 0,
        picksPerMonth: (picksPorSku.get(product.sku) ?? 0) / 2, // janela de 60 dias = 2 meses
        hasBrandOrLine: assoc.get(productId) ?? false,
        hasLocation: !!location,
        eanValid: eanCheck.present ? eanCheck.ok : null,
      },
    });
  }

  return resultado;
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

  // Uma coleta em lote para todos, no lugar de 6 consultas por produto.
  const coletados = await gatherInputsForProducts(uniqueIds, companyId);

  // As gravações também vão em bloco: um upsert por produto eram outras 4.628 requisições.
  const paraGravar: Record<string, unknown>[] = [];
  const paraHistorico: Record<string, unknown>[] = [];

  for (const productId of uniqueIds) {
    const gathered = coletados.get(productId);
    if (!gathered) continue;
    const { input, lastCountDate } = gathered;

    const confidence = computeConfidenceScore(input);
    const priority = computePriority(input, confidence);
    const whyToCount = buildWhyToCount(input, confidence);
    const nowIso = new Date().toISOString();

    // O intervalo sai de intervaloEfetivoDias, não direto da classe ABC: confiança baixa
    // antecipa a próxima contagem em vez de esperar o prazo cheio da classe.
    const nextCountDate = lastCountDate
      ? new Date(new Date(lastCountDate).getTime() + intervaloEfetivoDias(confidence) * 86400000)
      : new Date(); // nunca contado — precisa de uma primeira contagem já

    paraGravar.push({
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
    });

    updated += 1;
    if (!confidence.hasSufficientData) insufficient += 1;

    // Mesma regra de antes: histórico só recebe snapshot com dado real.
    if (confidence.hasSufficientData && confidence.confidenceScore != null && confidence.riskLevel) {
      paraHistorico.push({
        company_id: companyId,
        product_id: productId,
        confidence_score: confidence.confidenceScore,
        risk_level: confidence.riskLevel,
      });
    }
  }

  for (const bloco of emBlocos(paraGravar, 500)) {
    const { error } = await supabase.from('product_confidence_scores').upsert(bloco, { onConflict: 'product_id' });
    // Bloco que falha não derruba o recálculo inteiro, mas também não é contado como
    // sucesso silencioso: o erro aparece e o total gravado é corrigido.
    if (error) { console.error('[CBC] Error upserting confidence scores batch:', error); updated -= bloco.length; }
  }
  for (const bloco of emBlocos(paraHistorico, 500)) {
    const { error } = await supabase.from('product_confidence_history').insert(bloco);
    if (error) console.error('[CBC] Error inserting confidence history batch:', error);
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
    // Paginado: sem `.range()` esta leitura voltava 1.000 dos 4.628 produtos sem
    // erro nenhum, e o recálculo GRAVAVA só esses — por isso
    // `product_confidence_scores` tinha exatamente 1.000 linhas.
    // Congelado fica fora do recálculo e, portanto, do reagendamento: produto
    // que saiu de circulação não deve voltar sozinho para a fila de contagem.
    const { rows, error } = await fetchAllPages<{ id: string }>('CBC/products', (from, to) =>
      supabase.from('products').select('id').eq('company_id', companyId).is('frozen_at', null).order('id').range(from, to));
    if (error) { console.error('[CBC] Error loading products for full recompute:', error); return { updated: 0, insufficient: 0 }; }
    return await recomputeForProducts(rows.map(p => p.id), companyId, userId, userEmail);
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
    .select('*, products!inner(name, sku, location, frozen_at)', { count: 'exact' })
    .eq('company_id', companyId)
    // Mesma postura do risco: a nota continua gravada, o produto é que sai da
    // fila enquanto estiver congelado.
    .is('products.frozen_at', null);

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
  // O filtro de endereço precisa listar TODOS os endereços do catálogo: cortado
  // em 1.000 produtos, corredores inteiros nunca apareciam na lista.
  const { rows, error } = await fetchAllPages<{ location: string | null }>('CBC/locations', (from, to) =>
    supabase.from('products').select('location').eq('company_id', companyId)
      .not('location', 'is', null).order('id').range(from, to));
  if (error) { console.error('[CBC] Error listing locations:', error); return []; }
  const set = new Set(rows.map(r => r.location).filter((l): l is string => !!l && l.trim() !== ''));
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
