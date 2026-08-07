// Classificação ABC+XYZ — acesso a dados. Diferente de cbcService/riskService (que
// recalculam produto a produto), aqui o recálculo é sempre de EMPRESA INTEIRA numa única
// leitura + escrita em lote, porque a classe ABC de um SKU depende do rank dele entre
// todos os outros — não dá pra calcular um produto isolado corretamente.

import { supabase, ProductAbcXyzClassification, AbcClass, XyzClass, AbcXyzCombo } from './supabase';
import { classifyXYZ, classifyABCBatch, combineAbcXyz, AbcBatchInput } from './abcXyzAlgorithm';
import { logAuditEvent } from './auditLogService';

async function gatherMonthlyMovementBySku(companyId: string): Promise<Map<string, number[]>> {
  const twelveMonthsAgo = new Date(Date.now() - 365 * 86400000).toISOString();
  const { data, error } = await supabase
    .from('full_operation_items')
    .select('sku, quantity_picked, picked_at')
    .eq('company_id', companyId)
    .gte('picked_at', twelveMonthsAgo);
  if (error) { console.error('[ABC/XYZ] Error loading movement data:', error); return new Map(); }

  const now = new Date();
  const bySku = new Map<string, number[]>();
  for (const row of data ?? []) {
    if (!row.sku || !row.picked_at) continue;
    const pickedDate = new Date(row.picked_at);
    const monthsAgo = (now.getFullYear() - pickedDate.getFullYear()) * 12 + (now.getMonth() - pickedDate.getMonth());
    if (monthsAgo < 0 || monthsAgo >= 12) continue;
    const bucket = 11 - monthsAgo;
    const arr = bySku.get(row.sku) ?? new Array(12).fill(0);
    arr[bucket] += row.quantity_picked ?? 0;
    bySku.set(row.sku, arr);
  }
  return bySku;
}

/** Recálculo de empresa inteira — chamado após confirmar importação de contagem e pelo
 *  botão "Recalcular Tudo" do dashboard. Não é acionado por operação Full individual
 *  (recalcular o ranking ABC da empresa inteira a cada picking seria desproporcional à
 *  natureza lenta desta classificação). */
export async function recomputeAbcXyzForCompany(companyId: string, userId?: string, userEmail?: string): Promise<number> {
  const { data: products, error: productsError } = await supabase
    .from('products').select('id, sku, price').eq('company_id', companyId);
  if (productsError || !products || products.length === 0) {
    if (productsError) console.error('[ABC/XYZ] Error loading products:', productsError);
    return 0;
  }

  const movementBySku = await gatherMonthlyMovementBySku(companyId);

  const valueByProduct = new Map<string, number>();
  const xyzByProduct = new Map<string, ReturnType<typeof classifyXYZ>>();
  const abcInputs: AbcBatchInput[] = [];

  for (const p of products) {
    const monthly = movementBySku.get(p.sku) ?? new Array(12).fill(0);
    const totalQty = monthly.reduce((a, b) => a + b, 0);
    const valueMoved = totalQty * (p.price ?? 0);
    valueByProduct.set(p.id, valueMoved);
    xyzByProduct.set(p.id, classifyXYZ(monthly));
    abcInputs.push({ productId: p.id, valueMovedAnnual: valueMoved });
  }

  const abcResults = classifyABCBatch(abcInputs);
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  const upsertRows = products.map(p => {
    const abc = abcResults.get(p.id)!;
    const xyz = xyzByProduct.get(p.id)!;
    const abcXyzClass = combineAbcXyz(abc.abcClass, xyz.xyzClass);
    return {
      company_id: companyId,
      product_id: p.id,
      abc_class: abc.abcClass,
      xyz_class: xyz.xyzClass,
      abc_xyz_class: abcXyzClass,
      classification_date: today,
      value_moved: valueByProduct.get(p.id) ?? 0,
      demand_coefficient_variation: xyz.coefficientOfVariation,
      reasons: [abc.detail, xyz.detail],
      updated_at: nowIso,
    };
  });

  const { error: upsertError } = await supabase
    .from('product_abc_xyz_classifications').upsert(upsertRows, { onConflict: 'product_id' });
  if (upsertError) { console.error('[ABC/XYZ] Error upserting classifications:', upsertError); return 0; }

  const historyRows = upsertRows.map(r => ({
    company_id: companyId, product_id: r.product_id, abc_xyz_class: r.abc_xyz_class, value_moved: r.value_moved,
  }));
  const { error: historyError } = await supabase.from('product_abc_xyz_history').insert(historyRows);
  if (historyError) console.error('[ABC/XYZ] Error inserting history:', historyError);

  if (userId && userEmail) {
    await logAuditEvent({ companyId, userId, userEmail, action: 'abcxyz.recompute', metadata: { productCount: products.length } });
  }

  return products.length;
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

export type AbcXyzFilter = 'all' | `abc:${AbcClass}` | `xyz:${XyzClass}` | `combo:${AbcXyzCombo}`;

export interface ProductAbcXyzRow extends ProductAbcXyzClassification {
  product_name: string;
  product_sku: string;
}

export async function listWithFilter(companyId: string, filter: AbcXyzFilter): Promise<ProductAbcXyzRow[]> {
  let query = supabase
    .from('product_abc_xyz_classifications')
    .select('*, products(name, sku)')
    .eq('company_id', companyId);

  if (filter.startsWith('abc:')) query = query.eq('abc_class', filter.slice(4));
  if (filter.startsWith('xyz:')) query = query.eq('xyz_class', filter.slice(4));
  if (filter.startsWith('combo:')) query = query.eq('abc_xyz_class', filter.slice(6));

  const { data, error } = await query.order('value_moved', { ascending: false }).limit(500);
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

export async function getClassMigrations(companyId: string): Promise<AbcXyzMigration[]> {
  const { data, error } = await supabase
    .from('product_abc_xyz_history')
    .select('product_id, abc_xyz_class, recorded_at')
    .eq('company_id', companyId)
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
