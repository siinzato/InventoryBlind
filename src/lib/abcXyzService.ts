// Classificação ABC+XYZ — acesso a dados. Diferente de cbcService/riskService (que
// recalculam produto a produto), aqui o recálculo é sempre de EMPRESA INTEIRA numa única
// leitura + escrita em lote, porque a classe ABC de um SKU depende do rank dele entre
// todos os outros — não dá pra calcular um produto isolado corretamente.
//
// Fonte de movimento: sales_records (vendas importadas, migration 077) — única fonte real
// de demanda comercial disponível para este workspace (full_operation_items, usado antes,
// está vazio). Nunca soma fontes diferentes para o mesmo período.

import {
  supabase, ProductAbcXyzClassification, AbcClass, XyzClass, AbcXyzCombo,
  AbcXyzPeriod, AbcXyzUnclassifiedReason,
} from './supabase';
export type { AbcXyzPeriod, AbcXyzUnclassifiedReason } from './supabase';
import {
  classifyXYZ, classifyABCBatch, combineAbcXyz, AbcBatchInput, XyzThresholds, DEFAULT_XYZ_THRESHOLDS,
} from './abcXyzAlgorithm';
import { logAuditEvent } from './auditLogService';

export const PERIOD_DAYS: Record<AbcXyzPeriod, number> = { '90d': 90, '6m': 182, '12m': 365 };
export const PERIOD_LABEL: Record<AbcXyzPeriod, string> = { '90d': '90 dias', '6m': '6 meses', '12m': 'Últimos 12 meses' };
const SOURCE = 'sales_records';
export const SOURCE_LABEL: Record<string, string> = { sales_records: 'Vendas importadas' };

interface WeeklyMovement {
  bySku: Map<string, number[]>;
  byProductId: Map<string, number[]>;
  sourceConnected: boolean;
}

/** Constrói uma grade fixa de semanas civis completas (mais antiga primeiro) dentro do
 *  período, e soma a quantidade vendida de cada SKU/product_id em cada semana. Semanas sem
 *  venda entram como 0 — nunca são omitidas (exigência para o coeficiente de variação). */
async function gatherWeeklyMovement(companyId: string, periodDays: number): Promise<WeeklyMovement> {
  const { count: everCount, error: everError } = await supabase
    .from('sales_records').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  if (everError) console.error('[ABC/XYZ] Error checking sales source connection:', everError);
  const sourceConnected = (everCount ?? 0) > 0;

  const weeks = Math.floor(periodDays / 7);
  const since = new Date(Date.now() - weeks * 7 * 86400000);
  const sinceIso = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('sales_records')
    .select('sku, product_id, quantity, sale_date')
    .eq('company_id', companyId)
    .gte('sale_date', sinceIso);
  if (error) console.error('[ABC/XYZ] Error loading sales records:', error);

  const now = Date.now();
  const bySku = new Map<string, number[]>();
  const byProductId = new Map<string, number[]>();
  for (const row of data ?? []) {
    const saleDate = new Date(row.sale_date).getTime();
    const daysAgo = Math.floor((now - saleDate) / 86400000);
    const weekIndex = weeks - 1 - Math.floor(daysAgo / 7);
    if (weekIndex < 0 || weekIndex >= weeks) continue;
    const qty = row.quantity ?? 0;

    if (row.product_id) {
      const arr = byProductId.get(row.product_id) ?? new Array(weeks).fill(0);
      arr[weekIndex] += qty;
      byProductId.set(row.product_id, arr);
    } else if (row.sku) {
      const arr = bySku.get(row.sku) ?? new Array(weeks).fill(0);
      arr[weekIndex] += qty;
      bySku.set(row.sku, arr);
    }
  }
  return { bySku, byProductId, sourceConnected };
}

export interface RecomputeSummary {
  classified: number;
  unclassified: number;
  reasonBreakdown: Record<AbcXyzUnclassifiedReason, number>;
}

function emptyReasonBreakdown(): Record<AbcXyzUnclassifiedReason, number> {
  return { sem_movimento: 0, sem_custo: 0, fonte_desconectada: 0, historico_insuficiente: 0, sku_nao_associado: 0 };
}

/** Recálculo de empresa inteira para um período — chamado pelo botão "Recalcular", pela
 *  troca de período, e (com a assinatura antiga, período padrão 12m) por
 *  PhysicalCountSessionView.tsx/ImportCountTab.tsx após confirmar importação de contagem.
 *  Nunca deixa valores antigos como se fossem atuais quando a fonte falha: se a leitura de
 *  produtos falhar, propaga o erro em vez de zerar tudo silenciosamente. */
export async function recomputeAbcXyzForCompany(
  companyId: string,
  userId?: string,
  userEmail?: string,
  period: AbcXyzPeriod = '12m',
  thresholds: XyzThresholds = DEFAULT_XYZ_THRESHOLDS
): Promise<RecomputeSummary> {
  const { data: products, error: productsError } = await supabase
    .from('products').select('id, sku, price').eq('company_id', companyId);
  if (productsError) throw new Error('Não foi possível carregar os produtos para recalcular.');
  if (!products || products.length === 0) return { classified: 0, unclassified: 0, reasonBreakdown: emptyReasonBreakdown() };

  const movement = await gatherWeeklyMovement(companyId, PERIOD_DAYS[period]);

  const xyzByProduct = new Map<string, ReturnType<typeof classifyXYZ>>();
  const abcInputs: AbcBatchInput[] = [];

  for (const p of products) {
    const weekly = movement.byProductId.get(p.id) ?? movement.bySku.get(p.sku) ?? new Array(Math.floor(PERIOD_DAYS[period] / 7)).fill(0);
    const quantityMoved = weekly.reduce((a, b) => a + b, 0);
    const unitCost = p.price != null && p.price > 0 ? p.price : null;

    xyzByProduct.set(p.id, classifyXYZ({ weeklyQuantities: weekly, sourceConnected: movement.sourceConnected }, thresholds));
    abcInputs.push({ productId: p.id, quantityMoved, unitCost, sourceConnected: movement.sourceConnected });
  }

  const abcResults = classifyABCBatch(abcInputs);
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  const reasonBreakdown = emptyReasonBreakdown();
  let classified = 0;

  const upsertRows = products.map(p => {
    const abc = abcResults.get(p.id)!;
    const xyz = xyzByProduct.get(p.id)!;
    const hasAbc = abc.abcClass != null;
    const hasXyz = xyz.xyzClass != null;
    const combined = hasAbc && hasXyz ? combineAbcXyz(abc.abcClass as AbcClass, xyz.xyzClass as XyzClass) : null;
    const unclassifiedReason: AbcXyzUnclassifiedReason | null = combined ? null : (abc.unclassifiedReason ?? xyz.unclassifiedReason);
    if (combined) classified += 1;
    else if (unclassifiedReason) reasonBreakdown[unclassifiedReason] += 1;

    const abcInput = abcInputs.find(i => i.productId === p.id)!;
    return {
      company_id: companyId,
      product_id: p.id,
      abc_class: abc.abcClass,
      xyz_class: xyz.xyzClass,
      abc_xyz_class: combined,
      classification_date: today,
      period,
      source: SOURCE,
      value_moved: abc.valueMoved ?? 0,
      quantity_moved: abcInput.quantityMoved,
      unit_cost_used: abcInput.unitCost,
      demand_coefficient_variation: xyz.coefficientOfVariation,
      weeks_with_data: xyz.weeksWithData,
      weeks_without_sale: xyz.weeksWithoutSale,
      unclassified_reason: unclassifiedReason,
      reasons: [abc.detail, xyz.detail],
      updated_at: nowIso,
    };
  });

  const { error: upsertError } = await supabase
    .from('product_abc_xyz_classifications').upsert(upsertRows, { onConflict: 'product_id' });
  if (upsertError) throw new Error('Falha ao salvar a classificação — nenhum valor foi atualizado.');

  const historyRows = upsertRows
    .filter(r => r.abc_xyz_class != null)
    .map(r => ({ company_id: companyId, product_id: r.product_id, abc_xyz_class: r.abc_xyz_class as string, value_moved: r.value_moved, period }));
  if (historyRows.length > 0) {
    const { error: historyError } = await supabase.from('product_abc_xyz_history').insert(historyRows);
    if (historyError) console.error('[ABC/XYZ] Error inserting history:', historyError);
  }

  if (userId && userEmail) {
    await logAuditEvent({ companyId, userId, userEmail, action: 'abcxyz.recompute', metadata: { productCount: products.length, period, classified, unclassified: products.length - classified } });
  }

  return { classified, unclassified: products.length - classified, reasonBreakdown };
}

export async function getProductClassification(productId: string, companyId: string): Promise<ProductAbcXyzClassification | null> {
  const { data, error } = await supabase
    .from('product_abc_xyz_classifications').select('*').eq('product_id', productId).eq('company_id', companyId).maybeSingle();
  if (error) { console.error('[ABC/XYZ] Error loading classification:', error); return null; }
  return data as ProductAbcXyzClassification | null;
}

export async function getClassificationsForProducts(productIds: string[], companyId: string): Promise<Map<string, ProductAbcXyzClassification>> {
  if (productIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('product_abc_xyz_classifications').select('*').eq('company_id', companyId).in('product_id', productIds);
  if (error) { console.error('[ABC/XYZ] Error bulk-loading classifications:', error); return new Map(); }
  return new Map((data as ProductAbcXyzClassification[]).map(row => [row.product_id, row]));
}

export interface AbcXyzCompanySummaryRow {
  company_id: string;
  abc_xyz_class: AbcXyzCombo;
  sku_count: number;
  total_value_moved: number;
}

export async function getCompanySummary(companyId: string): Promise<AbcXyzCompanySummaryRow[]> {
  const { data, error } = await supabase.from('abc_xyz_company_summary_v').select('*').eq('company_id', companyId);
  if (error) { console.error('[ABC/XYZ] Error loading company summary:', error); return []; }
  return (data ?? []) as AbcXyzCompanySummaryRow[];
}

export async function getMatrixCounts(companyId: string): Promise<Record<AbcXyzCombo, { count: number; value: number }>> {
  const rows = await getCompanySummary(companyId);
  const combos: AbcXyzCombo[] = ['AX', 'AY', 'AZ', 'BX', 'BY', 'BZ', 'CX', 'CY', 'CZ'];
  const matrix = Object.fromEntries(combos.map(c => [c, { count: 0, value: 0 }])) as Record<AbcXyzCombo, { count: number; value: number }>;
  for (const row of rows) {
    matrix[row.abc_xyz_class] = { count: row.sku_count, value: row.total_value_moved };
  }
  return matrix;
}

export interface AbcXyzOverview {
  totalSkus: number;
  totalValueMoved: number;
  classACount: number;
  classAValuePct: number;
  predictableCount: number;
  predictablePct: number;
  unclassifiedCount: number;
}

export async function getOverview(companyId: string): Promise<AbcXyzOverview> {
  const { count: totalSkus } = await supabase.from('products').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  const { count: unclassifiedCount } = await supabase
    .from('product_abc_xyz_classifications').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).is('abc_xyz_class', null);
  const { count: classACount } = await supabase
    .from('product_abc_xyz_classifications').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('abc_class', 'A');
  const { count: predictableCount } = await supabase
    .from('product_abc_xyz_classifications').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('xyz_class', 'X');

  const matrix = await getMatrixCounts(companyId);
  const totalValueMoved = Object.values(matrix).reduce((s, c) => s + c.value, 0);
  const classAValue = (matrix.AX.value + matrix.AY.value + matrix.AZ.value);
  const classified = (totalSkus ?? 0) - (unclassifiedCount ?? 0);

  return {
    totalSkus: totalSkus ?? 0,
    totalValueMoved,
    classACount: classACount ?? 0,
    classAValuePct: totalValueMoved > 0 ? Math.round((classAValue / totalValueMoved) * 1000) / 10 : 0,
    predictableCount: predictableCount ?? 0,
    predictablePct: classified > 0 ? Math.round(((predictableCount ?? 0) / classified) * 1000) / 10 : 0,
    unclassifiedCount: unclassifiedCount ?? 0,
  };
}

export async function getLastRecalculatedAt(companyId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('product_abc_xyz_classifications')
    .select('updated_at')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.error('[ABC/XYZ] Error loading last recalculation time:', error); return null; }
  return data?.updated_at ?? null;
}

export type AbcXyzTab = 'all' | 'ax' | 'high_impact' | 'irregular' | 'unclassified';

export interface AbcXyzListFilters {
  search?: string;
  classFilter?: AbcClass | 'all';
  sourceFilter?: string | 'all';
  coverageFilter?: 'all' | 'sem_dados' | 'ok';
}

export interface ProductAbcXyzRow extends ProductAbcXyzClassification {
  product_name: string;
  product_sku: string;
}

export async function listByTab(companyId: string, tab: AbcXyzTab, filters: AbcXyzListFilters = {}): Promise<ProductAbcXyzRow[]> {
  let query = supabase
    .from('product_abc_xyz_classifications')
    .select('*, products!inner(name, sku)')
    .eq('company_id', companyId);

  if (tab === 'ax') query = query.eq('abc_xyz_class', 'AX');
  if (tab === 'high_impact') query = query.eq('abc_class', 'A');
  if (tab === 'irregular') query = query.eq('xyz_class', 'Z');
  if (tab === 'unclassified') query = query.is('abc_xyz_class', null);

  if (filters.classFilter && filters.classFilter !== 'all') query = query.eq('abc_class', filters.classFilter);
  if (filters.sourceFilter && filters.sourceFilter !== 'all') query = query.eq('source', filters.sourceFilter);
  if (filters.coverageFilter === 'sem_dados') query = query.not('unclassified_reason', 'is', null);
  if (filters.coverageFilter === 'ok') query = query.is('unclassified_reason', null);
  if (filters.search?.trim()) {
    const term = filters.search.trim();
    query = query.or(`sku.ilike.%${term}%,name.ilike.%${term}%`, { referencedTable: 'products' });
  }

  const { data, error } = await query.order('value_moved', { ascending: false, nullsFirst: false }).limit(500);
  if (error) { console.error('[ABC/XYZ] Error listing classifications:', error); return []; }

  return (data ?? []).map((row) => {
    const r = row as ProductAbcXyzClassification & { products: { name: string; sku: string } | null };
    return { ...r, product_name: r.products?.name ?? '—', product_sku: r.products?.sku ?? '—' };
  });
}

// ── Compatibilidade: contrato antigo usado fora desta página (Analytics/Saúde do
// Estoque, InventoryHealthPage.tsx) — preservado sem alteração de assinatura. ──
export type AbcXyzFilter = 'all' | `abc:${AbcClass}` | `xyz:${XyzClass}` | `combo:${AbcXyzCombo}`;

export async function listWithFilter(companyId: string, filter: AbcXyzFilter): Promise<ProductAbcXyzRow[]> {
  let query = supabase
    .from('product_abc_xyz_classifications')
    .select('*, products(name, sku)')
    .eq('company_id', companyId);

  if (filter.startsWith('abc:')) query = query.eq('abc_class', filter.slice(4));
  if (filter.startsWith('xyz:')) query = query.eq('xyz_class', filter.slice(4));
  if (filter.startsWith('combo:')) query = query.eq('abc_xyz_class', filter.slice(6));

  const { data, error } = await query.order('value_moved', { ascending: false, nullsFirst: false }).limit(500);
  if (error) { console.error('[ABC/XYZ] Error listing classifications:', error); return []; }

  return (data ?? []).map((row) => {
    const r = row as ProductAbcXyzClassification & { products: { name: string; sku: string } | null };
    return { ...r, product_name: r.products?.name ?? '—', product_sku: r.products?.sku ?? '—' };
  });
}

export interface AbcXyzMigration {
  productId: string;
  from: AbcXyzCombo;
  to: AbcXyzCombo;
}

export async function getClassMigrations(companyId: string, period: AbcXyzPeriod): Promise<AbcXyzMigration[]> {
  const { data, error } = await supabase
    .from('product_abc_xyz_history')
    .select('product_id, abc_xyz_class, recorded_at')
    .eq('company_id', companyId)
    .eq('period', period)
    .order('recorded_at', { ascending: false })
    .limit(2000);
  if (error) { console.error('[ABC/XYZ] Error loading history:', error); return []; }

  const byProduct = new Map<string, { abc_xyz_class: AbcXyzCombo; recorded_at: string }[]>();
  for (const row of data ?? []) {
    const list = byProduct.get(row.product_id) ?? [];
    if (list.length < 2) list.push({ abc_xyz_class: row.abc_xyz_class as AbcXyzCombo, recorded_at: row.recorded_at });
    byProduct.set(row.product_id, list);
  }

  const migrations: AbcXyzMigration[] = [];
  for (const [productId, entries] of byProduct) {
    if (entries.length < 2) continue;
    const [latest, previous] = entries;
    if (latest.abc_xyz_class !== previous.abc_xyz_class) {
      migrations.push({ productId, from: previous.abc_xyz_class, to: latest.abc_xyz_class });
    }
  }
  return migrations;
}

/** true quando ainda não há um segundo snapshot do mesmo período para comparar —
 *  "Primeira classificação deste período", nunca um histórico fabricado. */
export async function hasComparableHistory(companyId: string, period: AbcXyzPeriod): Promise<boolean> {
  const { count, error } = await supabase
    .from('product_abc_xyz_history')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('period', period);
  if (error) { console.error('[ABC/XYZ] Error checking history:', error); return false; }
  return (count ?? 0) > 0;
}

export interface WeeklyDemandPoint {
  weekIndex: number;
  quantity: number;
}

/** Série semanal real de um produto (mesma fonte/janela usadas no cálculo) — alimenta o
 *  gráfico "Comportamento da demanda" do painel lateral, nunca dados fictícios. */
export async function getWeeklySeriesForProduct(productId: string, sku: string, companyId: string, period: AbcXyzPeriod): Promise<WeeklyDemandPoint[]> {
  const movement = await gatherWeeklyMovement(companyId, PERIOD_DAYS[period]);
  const weekly = movement.byProductId.get(productId) ?? movement.bySku.get(sku) ?? [];
  return weekly.map((quantity, weekIndex) => ({ weekIndex, quantity }));
}

export interface SalesMovementRow {
  saleDate: string;
  quantity: number;
  totalValue: number;
}

/** "Ver movimentações" — mesma fonte que sustentou o cálculo, sem re-derivar nada. */
export async function getMovementsForProduct(productId: string, companyId: string, period: AbcXyzPeriod): Promise<SalesMovementRow[]> {
  const since = new Date(Date.now() - PERIOD_DAYS[period] * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('sales_records')
    .select('sale_date, quantity, total_value')
    .eq('company_id', companyId)
    .eq('product_id', productId)
    .gte('sale_date', since)
    .order('sale_date', { ascending: false })
    .limit(50);
  if (error) { console.error('[ABC/XYZ] Error loading movements:', error); return []; }
  return (data ?? []).map(r => ({ saleDate: r.sale_date, quantity: Number(r.quantity), totalValue: Number(r.total_value) }));
}

export interface OperationalReadout {
  stockQuantity: number | null;
  ruptureCount: number;
  lastCountDate: string | null;
}

/** "Leitura operacional" do painel lateral — só campos já existentes no domínio
 *  (estoque atual, rupturas registradas em contagem, última contagem real). */
export async function getOperationalReadout(productId: string, companyId: string): Promise<OperationalReadout> {
  const [{ data: product }, { data: counts }] = await Promise.all([
    supabase.from('products').select('stock_quantity').eq('id', productId).eq('company_id', companyId).maybeSingle(),
    supabase.from('inventory_count_import_items')
      .select('saldo_sistema, saldo_contado, created_at')
      .eq('product_id', productId).eq('company_id', companyId)
      .order('created_at', { ascending: false }).limit(20),
  ]);
  const rows = counts ?? [];
  const ruptureCount = rows.filter(r => (r.saldo_sistema ?? 1) <= 0 || (r.saldo_contado ?? 1) <= 0).length;
  return {
    stockQuantity: product?.stock_quantity ?? null,
    ruptureCount,
    lastCountDate: rows[0]?.created_at ?? null,
  };
}
