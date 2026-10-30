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
import type { PlacementMovement, StockPlacement } from './stockInsights';

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

/**
 * Capacidade do endereço, em caixas. `null` = sem limite declarado.
 *
 * Reduzir abaixo do que já está guardado é recusado pelo banco (trigger da 118), não por
 * uma checagem daqui — a regra precisa valer para qualquer caminho até a tabela, não só
 * para este formulário. A mensagem exibida é a que o banco devolve.
 */
export async function setBinCapacity(id: string, capacityBoxes: number | null): Promise<void> {
  if (capacityBoxes !== null && (!Number.isInteger(capacityBoxes) || capacityBoxes < 1)) {
    throw new Error('A capacidade precisa ser um número inteiro maior que zero, ou vazia para “sem limite”.');
  }
  const { error } = await supabase
    .from('warehouse_storage_bins')
    .update({ capacity_boxes: capacityBoxes })
    .eq('id', id);
  if (error) throw new Error(error.message);
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

const MOVEMENT_COLUMNS =
  'id, movement_type, boxes, units_per_box, reason, created_at,' +
  ' products(sku, name),' +
  ' from_bin:from_bin_id(code),' +
  ' to_bin:to_bin_id(code)';

const movementFromRow = (row: MovementRow): BinMovement => ({
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
});

/** Última movimentação que tocou esta vaga, entrando ou saindo. Consultada sob demanda,
 *  ao abrir o detalhe de uma posição no mapa — nunca em lote para todas, que seria um
 *  N+1 só para preencher um rodapé. */
export async function lastMovementForBin(binId: string): Promise<BinMovement | null> {
  const { data, error } = await supabase
    .from('warehouse_bin_movements')
    .select(MOVEMENT_COLUMNS)
    .or(`from_bin_id.eq.${binId},to_bin_id.eq.${binId}`)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const rows = (data ?? []) as unknown as MovementRow[];
  return rows.length > 0 ? movementFromRow(rows[0]) : null;
}

/** Histórico de uma vaga: entradas, saídas e transferências que a tocaram, do mais
 *  recente para o mais antigo. Consultado só ao abrir o detalhe de uma posição. */
export async function listMovementsForBin(binId: string, limit = 20): Promise<BinMovement[]> {
  const { data, error } = await supabase
    .from('warehouse_bin_movements')
    .select(MOVEMENT_COLUMNS)
    .or(`from_bin_id.eq.${binId},to_bin_id.eq.${binId}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as unknown as MovementRow[]).map(movementFromRow);
}

export async function listMovements(limit = 50): Promise<BinMovement[]> {
  const { data, error } = await supabase
    .from('warehouse_bin_movements')
    .select(MOVEMENT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as unknown as MovementRow[]).map(movementFromRow);
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

/** Uma rua do pulmão — na prática um paredão, um meio de galpão, um bloco de
 *  porta-pallet. Cada uma tem a própria contagem porque estrutura real não é uniforme:
 *  um paredão de 13 módulos com 3 níveis convive com um meio de 7 módulos e 1 nível. */
export interface BinStreetSpec {
  street: string;
  modules: number;
  levels: number;
}

export interface BinCodePattern {
  prefix: string;
  streets: BinStreetSpec[];
}

/**
 * Monta os códigos a partir do padrão. Formato: `PREFIXO-RUA MÓDULO-N NÍVEL`,
 * ex.: `PP-A01-N1`. Módulo e nível com dois e um dígito para a ordenação alfabética
 * coincidir com a ordem física do corredor — é disso que a rota depende.
 */
export function buildBinCodes(pattern: BinCodePattern): string[] {
  const prefix = pattern.prefix.trim().toUpperCase().replace(/-+$/, '');
  const codes: string[] = [];
  for (const spec of pattern.streets) {
    const rua = spec.street.trim().toUpperCase();
    // Rua é só letra: o código separa rua de módulo pela virada de letra para número
    // (`PP-A01-N1`). Um dígito na rua tornaria `PP-113-N1` ambíguo.
    if (!rua || !/^[A-Z]+$/.test(rua)) continue;
    for (let m = 1; m <= spec.modules; m += 1) {
      for (let n = 1; n <= spec.levels; n += 1) {
        codes.push(`${prefix}-${rua}${String(m).padStart(2, '0')}-N${n}`);
      }
    }
  }
  return codes;
}

// ── Fase 3: consulta por SKU, distribuição e permanência ─────────────────────────────

/** Saldo lido da tabela, e não da view `wms_product_stock_v`: a view não expõe `ean`
 *  nem `bin_id`, e os dois são necessários aqui — EAN para a busca, `bin_id` para
 *  cruzar com o histórico. Mesma tabela, mesma RLS; nenhuma fonte nova de saldo. */
const PLACEMENT_COLUMNS =
  'bin_id, product_id, boxes, units_per_box, units, first_stored_at,' +
  ' bin:bin_id(code, blocked, capacity_boxes),' +
  ' product:product_id(sku, name, ean)';

interface PlacementRow {
  bin_id: string;
  product_id: string;
  boxes: number;
  units_per_box: number;
  units: number;
  first_stored_at: string;
  bin: { code: string; blocked: boolean; capacity_boxes: number | null } | null;
  product: { sku: string; name: string; ean: string | null } | null;
}

const placementFromRow = (row: PlacementRow): StockPlacement => ({
  productId: row.product_id,
  sku: row.product?.sku ?? '—',
  productName: row.product?.name ?? '—',
  ean: row.product?.ean ?? null,
  binId: row.bin_id,
  binCode: row.bin?.code ?? '—',
  binBlocked: row.bin?.blocked ?? false,
  binCapacityBoxes: row.bin?.capacity_boxes ?? null,
  boxes: row.boxes,
  unitsPerBox: row.units_per_box,
  units: row.units,
  firstStoredAt: row.first_stored_at,
});

/** Teto de linhas de saldo lidas de uma vez. O pulmão tem dezenas de vagas, não
 *  milhares — se um dia encostar aqui, a tela avisa em vez de mostrar meia verdade. */
const PLACEMENT_LIMIT = 2000;

/** Teto de movimentos. Atingi-lo significa histórico incompleto para o cálculo de
 *  antiguidade, e aí NENHUMA data pode ser anunciada como exata (ver `truncated`). */
const MOVEMENT_SCAN_LIMIT = 5000;

export interface PulmaoStock {
  placements: StockPlacement[];
  movements: PlacementMovement[];
  /** Histórico veio cortado: as datas viram todas limite superior. */
  truncated: boolean;
}

const EMPTY_STOCK: PulmaoStock = { placements: [], movements: [], truncated: false };

/** Movimentos que importam para a antiguidade: só os do período em que as ocupações
 *  ATUAIS começaram. Movimento anterior pertence a uma ocupação já encerrada (a linha
 *  de saldo é apagada ao zerar), então não diz nada sobre o que está guardado hoje. */
async function movementsSince(productIds: string[], since: string): Promise<{ rows: PlacementMovement[]; truncated: boolean }> {
  if (productIds.length === 0) return { rows: [], truncated: false };

  const { data, error } = await supabase
    .from('warehouse_bin_movements')
    .select('product_id, from_bin_id, to_bin_id, created_at')
    .in('product_id', productIds)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(MOVEMENT_SCAN_LIMIT);
  if (error) throw error;

  const rows = (data ?? []) as Array<{ product_id: string; from_bin_id: string | null; to_bin_id: string | null; created_at: string }>;
  return {
    rows: rows.map(r => ({
      productId: r.product_id,
      fromBinId: r.from_bin_id,
      toBinId: r.to_bin_id,
      createdAt: r.created_at,
    })),
    truncated: rows.length >= MOVEMENT_SCAN_LIMIT,
  };
}

const withMovements = async (placements: StockPlacement[]): Promise<PulmaoStock> => {
  if (placements.length === 0) return EMPTY_STOCK;
  const since = placements.reduce((min, p) => (p.firstStoredAt < min ? p.firstStoredAt : min), placements[0].firstStoredAt);
  const ids = [...new Set(placements.map(p => p.productId))];
  const { rows, truncated } = await movementsSince(ids, since);
  return { placements, movements: rows, truncated };
};

/** "Onde está este SKU" — por SKU, nome ou EAN. Duas consultas leves: acha os produtos,
 *  depois o saldo deles. Buscar pelo produto primeiro é o que permite usar o EAN sem
 *  duplicar cadastro nenhum. */
export async function searchPulmaoStock(term: string): Promise<PulmaoStock> {
  const needle = term.trim();
  if (needle.length < 2) return EMPTY_STOCK;

  const { data: produtos, error: erroProdutos } = await supabase
    .from('products')
    .select('id')
    .or(`sku.ilike.%${needle}%,name.ilike.%${needle}%,ean.ilike.%${needle}%`)
    .limit(100);
  if (erroProdutos) throw erroProdutos;

  const ids = (produtos ?? []).map(p => (p as { id: string }).id);
  if (ids.length === 0) return EMPTY_STOCK;

  const { data, error } = await supabase
    .from('warehouse_bin_stock')
    .select(PLACEMENT_COLUMNS)
    .in('product_id', ids)
    .limit(PLACEMENT_LIMIT);
  if (error) throw error;

  return withMovements(((data ?? []) as unknown as PlacementRow[]).map(placementFromRow));
}

/** Todo o saldo do pulmão — a base da visão de permanência. */
export async function listPulmaoStock(): Promise<PulmaoStock> {
  const { data, error } = await supabase
    .from('warehouse_bin_stock')
    .select(PLACEMENT_COLUMNS)
    .order('first_stored_at', { ascending: true })
    .limit(PLACEMENT_LIMIT);
  if (error) throw error;

  return withMovements(((data ?? []) as unknown as PlacementRow[]).map(placementFromRow));
}
