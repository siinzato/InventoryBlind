// Pulmão endereçado (porta-pallet) — migration 116.
//
// Acesso aos endereços de armazenagem, ao saldo por endereço e aos movimentos.
//
// Regra que atravessa este arquivo: SALDO NÃO SE ESCREVE. As tabelas
// `warehouse_bin_stock` e `warehouse_bin_movements` não têm policy de escrita — só as
// RPCs `wms_bin_*` (SECURITY DEFINER) gravam nelas. Por isso aqui não existe nenhum
// `.insert()` ou `.update()` nessas duas tabelas: todo movimento passa por RPC, e é o
// que garante que todo número tenha um documento com autor e horário.
//
// O que este módulo NÃO toca: `products.location` e o campo de local do Tiny continuam
// sendo o vão de picking das capas, e nada aqui lê ou escreve neles.

import { supabase } from '../supabase';

export interface StorageBin {
  id: string;
  code: string;
  binType: 'pulmao' | 'picking';
  capacityBoxes: number | null;
  blocked: boolean;
  blockedReason: string | null;
}

export interface BinStockRow {
  productId: string;
  sku: string;
  productName: string;
  binCode: string;
  binBlocked: boolean;
  boxes: number;
  unitsPerBox: number;
  units: number;
  firstStoredAt: string;
}

export interface BinMovement {
  id: string;
  movementType: 'entrada' | 'saida' | 'transferencia';
  sku: string | null;
  productName: string | null;
  fromCode: string | null;
  toCode: string | null;
  boxes: number;
  unitsPerBox: number;
  reason: string | null;
  createdAt: string;
}

const BIN_COLUMNS = 'id, code, bin_type, capacity_boxes, blocked, blocked_reason';

type BinRow = {
  id: string;
  code: string;
  bin_type: 'pulmao' | 'picking';
  capacity_boxes: number | null;
  blocked: boolean;
  blocked_reason: string | null;
};

const binFromRow = (row: BinRow): StorageBin => ({
  id: row.id,
  code: row.code,
  binType: row.bin_type,
  capacityBoxes: row.capacity_boxes,
  blocked: row.blocked,
  blockedReason: row.blocked_reason,
});

// ── Endereços ─────────────────────────────────────────────────────────────────────────

/** Ordenado pelo código: como ele é hierárquico (rua, módulo, nível), a ordem alfabética
 *  já é a sequência de caminhada pelo corredor. É o que dispensa desenhar planta baixa. */
export async function listBins(): Promise<StorageBin[]> {
  const { data, error } = await supabase
    .from('warehouse_storage_bins')
    .select(BIN_COLUMNS)
    .eq('bin_type', 'pulmao')
    .order('code', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as BinRow[]).map(binFromRow);
}

/**
 * Cria endereços em lote, ignorando os que já existem.
 *
 * `company_id` não vai no payload de propósito: o DEFAULT da coluna é
 * `get_my_company_id()`, que o banco resolve pela sessão. Mandar do cliente seria
 * exatamente o padrão que a auditoria da 115 removeu das RPCs.
 */
export async function createBins(codes: string[], capacityBoxes: number | null): Promise<number> {
  const unique = [...new Set(codes.map(code => code.trim()).filter(Boolean))];
  if (unique.length === 0) return 0;

  const { data, error } = await supabase
    .from('warehouse_storage_bins')
    .upsert(
      unique.map(code => ({ code, bin_type: 'pulmao', capacity_boxes: capacityBoxes })),
      { onConflict: 'company_id,code', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}

/**
 * Remove endereços criados por engano.
 *
 * Não há verificação de saldo aqui de propósito: as FKs de `warehouse_bin_stock` e
 * `warehouse_bin_movements` são ON DELETE RESTRICT, então o próprio banco recusa apagar
 * endereço que já recebeu mercadoria. Checar no cliente seria uma segunda verdade que
 * pode divergir — a garantia fica onde não dá para contornar.
 */
export async function deleteBins(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('warehouse_storage_bins').delete().in('id', ids);
  if (error) {
    // 23503 = violação de chave estrangeira: o endereço tem histórico.
    if (error.code === '23503') {
      throw new Error('Este endereço já tem movimentação registrada e não pode ser apagado. Bloqueie-o em vez disso.');
    }
    throw new Error(error.message);
  }
}

export async function setBinBlocked(id: string, blocked: boolean, reason: string | null): Promise<void> {
  const { error } = await supabase
    .from('warehouse_storage_bins')
    .update({ blocked, blocked_reason: blocked ? reason : null })
    .eq('id', id);
  if (error) throw error;
}

// ── Saldo ─────────────────────────────────────────────────────────────────────────────

type StockRow = {
  product_id: string;
  sku: string;
  product_name: string;
  bin_code: string;
  bin_blocked: boolean;
  boxes: number;
  units_per_box: number;
  units: number;
  first_stored_at: string;
};

const stockFromRow = (row: StockRow): BinStockRow => ({
  productId: row.product_id,
  sku: row.sku,
  productName: row.product_name,
  binCode: row.bin_code,
  binBlocked: row.bin_blocked,
  boxes: row.boxes,
  unitsPerBox: row.units_per_box,
  units: row.units,
  firstStoredAt: row.first_stored_at,
});

const STOCK_COLUMNS = 'product_id, sku, product_name, bin_code, bin_blocked, boxes, units_per_box, units, first_stored_at';

/** "Onde está o excesso deste SKU" — a pergunta que hoje custa procurar no olho.
 *  Mais antigo primeiro: é a ordem em que o estoque deve ser consumido. */
export async function searchStock(term: string): Promise<BinStockRow[]> {
  const needle = term.trim();
  if (!needle) return [];

  const { data, error } = await supabase
    .from('wms_product_stock_v')
    .select(STOCK_COLUMNS)
    .or(`sku.ilike.%${needle}%,product_name.ilike.%${needle}%`)
    .order('first_stored_at', { ascending: true })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as StockRow[]).map(stockFromRow);
}

/** O que está guardado num endereço. Endereço misturado devolve várias linhas — é assim
 *  que a mistura deixa de ser bagunça e vira dado. */
export async function listBinContents(binCode: string): Promise<BinStockRow[]> {
  const { data, error } = await supabase
    .from('wms_product_stock_v')
    .select(STOCK_COLUMNS)
    .eq('bin_code', binCode)
    .order('first_stored_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as StockRow[]).map(stockFromRow);
}

/** Quantas caixas há em cada endereço — alimenta a ocupação da lista de endereços sem
 *  precisar de uma consulta por linha. */
export async function boxesByBin(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('wms_product_stock_v').select('bin_code, boxes');
  if (error) throw error;
  const map = new Map<string, number>();
  for (const row of (data ?? []) as { bin_code: string; boxes: number }[]) {
    map.set(row.bin_code, (map.get(row.bin_code) ?? 0) + row.boxes);
  }
  return map;
}

/**
 * Última quantidade por caixa conhecida para o SKU.
 *
 * A caixa fechada tem pack padronizado, então o operador informa isso UMA vez e o
 * sistema não pergunta de novo. A fonte é o histórico de movimentos — que nunca é
 * apagado —, e não `products`: assim o cadastro de produto continua intocado.
 */
export async function lastKnownPackSize(productId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('warehouse_bin_movements')
    .select('units_per_box')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { units_per_box: number } | null)?.units_per_box ?? null;
}

export interface ProductOption {
  id: string;
  sku: string;
  name: string;
}

/** Busca de produto para a tela de guardar. Lê só o cadastro — não toca em
 *  `products.location`, que é do fluxo de picking das capas. */
export async function searchProducts(term: string): Promise<ProductOption[]> {
  const needle = term.trim();
  if (needle.length < 2) return [];

  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name')
    .or(`sku.ilike.%${needle}%,name.ilike.%${needle}%,ean.ilike.%${needle}%`)
    .order('sku', { ascending: true })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as ProductOption[];
}

// ── Movimentos ────────────────────────────────────────────────────────────────────────

type MovementRow = {
  id: string;
  movement_type: 'entrada' | 'saida' | 'transferencia';
  boxes: number;
  units_per_box: number;
  reason: string | null;
  created_at: string;
  products: { sku: string; name: string } | null;
  from_bin: { code: string } | null;
  to_bin: { code: string } | null;
};

export async function listMovements(limit = 50): Promise<BinMovement[]> {
  const { data, error } = await supabase
    .from('warehouse_bin_movements')
    .select(
      'id, movement_type, boxes, units_per_box, reason, created_at,' +
        ' products(sku, name),' +
        ' from_bin:from_bin_id(code),' +
        ' to_bin:to_bin_id(code)',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as unknown as MovementRow[]).map(row => ({
    id: row.id,
    movementType: row.movement_type,
    sku: row.products?.sku ?? null,
    productName: row.products?.name ?? null,
    fromCode: row.from_bin?.code ?? null,
    toCode: row.to_bin?.code ?? null,
    boxes: row.boxes,
    unitsPerBox: row.units_per_box,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

// ── Operações (sempre por RPC) ────────────────────────────────────────────────────────

export async function putaway(params: {
  binCode: string;
  productId: string;
  boxes: number;
  unitsPerBox: number;
  reason?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('wms_bin_putaway', {
    p_bin_code: params.binCode,
    p_product_id: params.productId,
    p_boxes: params.boxes,
    p_units_per_box: params.unitsPerBox,
    p_reason: params.reason ?? 'recebimento',
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function pick(params: {
  binCode: string;
  productId: string;
  boxes: number;
  reason?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('wms_bin_pick', {
    p_bin_code: params.binCode,
    p_product_id: params.productId,
    p_boxes: params.boxes,
    p_reason: params.reason ?? 'abastecimento',
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function transfer(params: {
  fromBinCode: string;
  toBinCode: string;
  productId: string;
  boxes: number;
  reason?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('wms_bin_transfer', {
    p_from_bin_code: params.fromBinCode,
    p_to_bin_code: params.toBinCode,
    p_product_id: params.productId,
    p_boxes: params.boxes,
    p_reason: params.reason ?? 'transferencia',
  });
  if (error) throw new Error(error.message);
  return data as string;
}

// ── Geração de códigos ────────────────────────────────────────────────────────────────

export interface BinCodePattern {
  prefix: string;
  streets: string[];
  modulesPerStreet: number;
  levelsPerModule: number;
}

/**
 * Monta os códigos a partir do padrão. Formato: `PREFIXO-RUA MÓDULO-N NÍVEL`,
 * ex.: `PP-A01-N1`. Módulo e nível com dois e um dígito para a ordenação alfabética
 * coincidir com a ordem física do corredor — é disso que a rota depende.
 */
export function buildBinCodes(pattern: BinCodePattern): string[] {
  const prefix = pattern.prefix.trim().toUpperCase().replace(/-+$/, '');
  const codes: string[] = [];
  for (const street of pattern.streets) {
    const rua = street.trim().toUpperCase();
    if (!rua) continue;
    for (let m = 1; m <= pattern.modulesPerStreet; m += 1) {
      for (let n = 1; n <= pattern.levelsPerModule; n += 1) {
        codes.push(`${prefix}-${rua}${String(m).padStart(2, '0')}-N${n}`);
      }
    }
  }
  return codes;
}
