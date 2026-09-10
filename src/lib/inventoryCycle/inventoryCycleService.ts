// Acesso a dados do inventário por SKU (migration 112). Uma classificação, uma fonte de
// verdade: a linha do item vem de product_brand_associations, nunca de regra por título.
//
// O modelo agregado legado (inventory_brands / inventory_count_records) NÃO é lido nem
// escrito aqui — o ciclo em andamento nele continua como está.

import { supabase } from '../supabase';
import type {
  CycleLineSummary, InventoryCycle, InventoryItem,
} from './inventoryCycleModel';

const FETCH_PAGE = 1000;

interface CycleRow {
  id: string;
  company_id: string;
  name: string;
  status: string;
  counting_model: string;
  started_at: string;
  closed_at: string | null;
  notes: string | null;
}

interface ItemRow {
  id: string;
  cycle_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  location: string | null;
  brand_id: string | null;
  brand_name: string | null;
  line_id: string | null;
  line_name: string | null;
  status: string;
  expected_quantity: number | null;
  counted_quantity: number | null;
  counted_at: string | null;
  counted_by_name: string | null;
  observation: string | null;
  divergence: boolean;
}

const cycleFromRow = (row: CycleRow): InventoryCycle => ({
  id: row.id,
  companyId: row.company_id,
  name: row.name,
  status: row.status === 'closed' ? 'closed' : 'active',
  countingModel: 'sku',
  startedAt: row.started_at,
  closedAt: row.closed_at,
  notes: row.notes,
});

const itemFromRow = (row: ItemRow): InventoryItem => ({
  id: row.id,
  cycleId: row.cycle_id,
  productId: row.product_id,
  sku: row.sku,
  productName: row.product_name,
  location: row.location,
  brandId: row.brand_id,
  brandName: row.brand_name,
  lineId: row.line_id,
  lineName: row.line_name,
  status: row.status === 'counted' ? 'counted' : 'pending',
  expectedQuantity: row.expected_quantity,
  countedQuantity: row.counted_quantity,
  countedAt: row.counted_at,
  countedByName: row.counted_by_name,
  observation: row.observation,
  divergence: row.divergence,
});

const CYCLE_COLUMNS = 'id, company_id, name, status, counting_model, started_at, closed_at, notes';
const ITEM_COLUMNS =
  'id, cycle_id, product_id, sku, product_name, location, brand_id, brand_name, line_id, line_name, ' +
  'status, expected_quantity, counted_quantity, counted_at, counted_by_name, observation, divergence';

export async function getActiveCycle(companyId: string): Promise<InventoryCycle | null> {
  const { data, error } = await supabase
    .from('inventory_cycles')
    .select(CYCLE_COLUMNS)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return data ? cycleFromRow(data as CycleRow) : null;
}

/** O inventário ativo é a camada interna do Dashboard: é onde o universo de SKUs e as
 *  pendências existem. Por isso ele não é algo que se abre à mão — se a empresa ainda
 *  não tem um, abre-se aqui. O índice único parcial da 112 recusa um segundo ativo, então
 *  duas abas importando ao mesmo tempo não criam dois inventários. */
export async function ensureActiveCycle(companyId: string, userId: string | null = null): Promise<InventoryCycle> {
  const existing = await getActiveCycle(companyId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from('inventory_cycles')
    .insert({ company_id: companyId, name: 'Inventário atual', created_by: userId, status: 'active', counting_model: 'sku' })
    .select(CYCLE_COLUMNS)
    .single();
  // Corrida com outra aba: o índice único devolve conflito e o ciclo do vencedor serve.
  if (error) {
    const raced = await getActiveCycle(companyId);
    if (raced) return raced;
    throw error;
  }
  return cycleFromRow(data as CycleRow);
}

export async function listCycles(companyId: string): Promise<InventoryCycle[]> {
  const { data, error } = await supabase
    .from('inventory_cycles')
    .select(CYCLE_COLUMNS)
    .eq('company_id', companyId)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(row => cycleFromRow(row as CycleRow));
}

/** Agrupamento por linha vindo da view — o Dashboard nunca soma item no navegador. */
export async function listCycleLineSummaries(companyId: string, cycleId: string): Promise<CycleLineSummary[]> {
  const { data, error } = await supabase
    .from('inventory_cycle_line_summary_v')
    .select('group_key, line_id, brand_id, group_label, total_sku, done_sku, divergences')
    .eq('company_id', companyId)
    .eq('cycle_id', cycleId);
  if (error) throw error;
  return (data ?? []).map(row => ({
    groupKey: row.group_key as string,
    lineId: (row.line_id as string | null) ?? null,
    brandId: (row.brand_id as string | null) ?? null,
    label: row.group_label as string,
    totalSku: Number(row.total_sku ?? 0),
    doneSku: Number(row.done_sku ?? 0),
    divergences: Number(row.divergences ?? 0),
  }));
}

/** Fonte ÚNICA do Dashboard principal: o universo do inventário ativo, agrupado pela linha
 *  persistida de cada produto. Uma requisição, uma linha por grupo — o navegador não soma
 *  item nem reclassifica nada. Sem inventário ativo o universo é vazio, e nunca o
 *  agrupamento antigo de contagem: o Dashboard não tem uma segunda taxonomia para exibir. */
export async function listLineUniverse(companyId: string): Promise<CycleLineSummary[]> {
  const cycle = await getActiveCycle(companyId);
  if (!cycle) return [];
  return listCycleLineSummaries(companyId, cycle.id);
}

/** Itens do ciclo. Paginado no PostgREST porque o padrão do servidor corta em 1000. */
export async function listCycleItems(cycleId: string): Promise<InventoryItem[]> {
  const rows: ItemRow[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select(ITEM_COLUMNS)
      .eq('cycle_id', cycleId)
      .order('sku', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as ItemRow[];
    rows.push(...page);
    if (page.length < FETCH_PAGE) break;
  }
  return rows.map(itemFromRow);
}

// ── Reconciliação: catálogo -> itens do ciclo ativo ────────────────────────────────────

interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  location: string | null;
  stock_quantity: number | null;
}

interface Classification {
  brandId: string | null;
  brandName: string | null;
  lineId: string | null;
  lineName: string | null;
}

async function fetchCatalog(companyId: string): Promise<CatalogProduct[]> {
  const rows: CatalogProduct[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, name, location, stock_quantity')
      .eq('company_id', companyId)
      .order('id', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as CatalogProduct[];
    rows.push(...page);
    if (page.length < FETCH_PAGE) break;
  }
  return rows;
}

/** Classificação persistida por produto. Nome da marca/linha vem junto para ser gravado no
 *  item: é o que preserva o histórico se a linha for renomeada depois. */
async function fetchClassifications(companyId: string): Promise<Map<string, Classification>> {
  const map = new Map<string, Classification>();
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('product_brand_associations')
      .select('product_id, brand_id, line_id, product_brands(name), product_lines(name)')
      .eq('company_id', companyId)
      .order('product_id', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    for (const row of page as unknown as {
      product_id: string;
      brand_id: string | null;
      line_id: string | null;
      product_brands: { name: string } | null;
      product_lines: { name: string } | null;
    }[]) {
      map.set(row.product_id, {
        brandId: row.brand_id ?? null,
        brandName: row.product_brands?.name ?? null,
        lineId: row.line_id ?? null,
        lineName: row.product_lines?.name ?? null,
      });
    }
    if (page.length < FETCH_PAGE) break;
  }
  return map;
}

interface ExistingItem {
  id: string;
  product_id: string;
  brand_id: string | null;
  line_id: string | null;
  line_name: string | null;
  brand_name: string | null;
}

async function fetchExistingItems(cycleId: string): Promise<ExistingItem[]> {
  const rows: ExistingItem[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, product_id, brand_id, line_id, line_name, brand_name')
      .eq('cycle_id', cycleId)
      .order('product_id', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as ExistingItem[];
    rows.push(...page);
    if (page.length < FETCH_PAGE) break;
  }
  return rows;
}

export interface SyncCycleResult {
  inserted: number;
  reclassified: number;
  cycleId: string;
}

/**
 * Alinha os itens do ciclo ATIVO ao catálogo:
 *
 *  - SKU novo entra como `pending`, com `expected_quantity` = saldo do produto;
 *  - item existente tem só a CLASSIFICAÇÃO atualizada (marca/linha e seus nomes);
 *  - `status`, `counted_quantity`, `counted_at`, `counted_by` e `observation` nunca são
 *    tocados aqui — nenhuma contagem é perdida ou zerada;
 *  - item de produto que saiu do catálogo permanece, porque foi contado;
 *  - ciclo `closed` é ignorado: histórico não se reescreve.
 *
 * Idempotente: `unique (cycle_id, product_id)` mais o diff em memória garantem que rodar
 * duas vezes não duplica SKU nem regrava o que já está igual.
 */
export async function syncActiveCycleItems(companyId: string, userId: string | null = null): Promise<SyncCycleResult> {
  const cycle = await ensureActiveCycle(companyId, userId);

  const [catalog, classifications, existing] = await Promise.all([
    fetchCatalog(companyId),
    fetchClassifications(companyId),
    fetchExistingItems(cycle.id),
  ]);

  const existingByProduct = new Map(existing.map(item => [item.product_id, item]));

  const toInsert = catalog
    .filter(product => !existingByProduct.has(product.id))
    .map(product => {
      const c = classifications.get(product.id);
      return {
        company_id: companyId,
        cycle_id: cycle.id,
        product_id: product.id,
        sku: product.sku,
        product_name: product.name,
        location: product.location,
        brand_id: c?.brandId ?? null,
        brand_name: c?.brandName ?? null,
        line_id: c?.lineId ?? null,
        line_name: c?.lineName ?? null,
        status: 'pending',
        expected_quantity: product.stock_quantity,
      };
    });

  for (let i = 0; i < toInsert.length; i += FETCH_PAGE) {
    const { error } = await supabase.from('inventory_items').insert(toInsert.slice(i, i + FETCH_PAGE));
    if (error) throw error;
  }

  // Reclassificação agrupada por destino: uma chamada por combinação de marca/linha, não
  // uma por item. Só entram os itens cuja classificação realmente mudou.
  const buckets = new Map<string, { ids: string[]; patch: Record<string, string | null> }>();
  for (const item of existing) {
    const c = classifications.get(item.product_id);
    const nextBrandId = c?.brandId ?? null;
    const nextLineId = c?.lineId ?? null;
    const nextBrandName = c?.brandName ?? null;
    const nextLineName = c?.lineName ?? null;
    const unchanged = item.brand_id === nextBrandId && item.line_id === nextLineId
      && item.brand_name === nextBrandName && item.line_name === nextLineName;
    if (unchanged) continue;

    const key = `${nextBrandId ?? ''}|${nextLineId ?? ''}|${nextBrandName ?? ''}|${nextLineName ?? ''}`;
    const bucket = buckets.get(key) ?? {
      ids: [],
      patch: { brand_id: nextBrandId, brand_name: nextBrandName, line_id: nextLineId, line_name: nextLineName },
    };
    bucket.ids.push(item.id);
    buckets.set(key, bucket);
  }

  let reclassified = 0;
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.ids.length; i += FETCH_PAGE) {
      const slice = bucket.ids.slice(i, i + FETCH_PAGE);
      const { error } = await supabase
        .from('inventory_items')
        .update({ ...bucket.patch, updated_at: new Date().toISOString() })
        .in('id', slice);
      if (error) throw error;
      reclassified += slice.length;
    }
  }

  return { inserted: toInsert.length, reclassified, cycleId: cycle.id };
}

// ── Ciclo ────────────────────────────────────────────────────────────────────────────────

/** Abre um ciclo e o popula com o catálogo classificado. O índice único parcial da
 *  migration 112 recusa um segundo ciclo ativo, então isto é seguro em duas abas. */
export async function createCycle(companyId: string, name: string, userId: string | null): Promise<InventoryCycle> {
  const { data, error } = await supabase
    .from('inventory_cycles')
    .insert({ company_id: companyId, name, created_by: userId, status: 'active', counting_model: 'sku' })
    .select(CYCLE_COLUMNS)
    .single();
  if (error) throw error;

  const cycle = cycleFromRow(data as CycleRow);
  await syncActiveCycleItems(companyId);
  return cycle;
}

/** Encerra o ciclo. A classificação já gravada em cada item passa a ser o histórico
 *  daquele inventário — nenhuma alteração futura de linha o alcança. */
export async function closeCycle(cycleId: string, userId: string | null): Promise<void> {
  const { error } = await supabase
    .from('inventory_cycles')
    .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: userId, updated_at: new Date().toISOString() })
    .eq('id', cycleId)
    .eq('status', 'active');
  if (error) throw error;
}

export interface CountItemInput {
  itemId: string;
  countedQuantity: number;
  userId: string | null;
  userName: string | null;
  observation?: string | null;
}

/** Registra a contagem de UM item. O gatilho da migration 113 recusa a escrita se o ciclo
 *  estiver encerrado, então nem UI nem serviço podem alterar histórico por engano. */
export async function countItem(input: CountItemInput): Promise<InventoryItem> {
  const { data, error } = await supabase
    .from('inventory_items')
    .update({
      status: 'counted',
      counted_quantity: input.countedQuantity,
      counted_at: new Date().toISOString(),
      counted_by: input.userId,
      counted_by_name: input.userName,
      observation: input.observation ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.itemId)
    .select(ITEM_COLUMNS)
    .single();
  if (error) throw error;
  return itemFromRow(data as unknown as ItemRow);
}
