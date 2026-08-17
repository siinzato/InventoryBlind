// Physical Count Engine — data service (Supabase access + RPC wrappers),
// same shape as nfeService.ts's RPC-wrapper convention.

import { supabase } from '../supabase';
import { listDistinctLocations, resolveProductsInLocationRange } from './locationAddressing';
import { dequeue, enqueue, listPending, type QueuedCount } from './offlineQueue';
import { DEFAULT_RECOUNT_SETTINGS, type RecountSettings, type RecountThresholdType } from './recountPolicy';
import type {
  CountMode,
  CountSource,
  ErpSyncReport,
  PhysicalCountCandidateProduct,
  PhysicalCountFinalResultRow,
  PhysicalCountItem,
  PhysicalCountSession,
  RecountEvent,
} from './physicalCountTypes';

function mapSession(row: Record<string, unknown>): PhysicalCountSession {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    rootSessionId: row.root_session_id as string,
    linkedSessionId: (row.linked_session_id as string | null) ?? null,
    countNumber: row.count_number as 1 | 2 | 3,
    warehouse: (row.warehouse as string | null) ?? null,
    area: (row.area as string | null) ?? null,
    streetFrom: row.street_from as string,
    streetTo: row.street_to as string,
    responsibleId: (row.responsible_id as string | null) ?? null,
    observation: (row.observation as string | null) ?? null,
    status: row.status as PhysicalCountSession['status'],
    totalItems: row.total_items as number,
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedAt: (row.approved_at as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    startedBy: (row.started_by as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    finishedBy: (row.finished_by as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapItem(row: Record<string, unknown>): PhysicalCountItem {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    companyId: row.company_id as string,
    productId: row.product_id as string,
    sku: (row.sku as string | null) ?? null,
    ean: (row.ean as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    erpQuantitySnapshot: (row.erp_quantity_snapshot as number | null) ?? null,
    erpSource: row.erp_source as string,
    erpSyncRef: (row.erp_sync_ref as string | null) ?? null,
    physicalQuantity: (row.physical_quantity as number | null) ?? null,
    foundLocation: (row.found_location as string | null) ?? null,
    foundElsewhereQuantity: (row.found_elsewhere_quantity as number | null) ?? 0,
    resultStatus: (row.result_status as PhysicalCountItem['resultStatus']) ?? null,
    snapshotProductName: (row.snapshot_product_name as string | null) ?? null,
    snapshotSku: (row.snapshot_sku as string | null) ?? null,
    snapshotEan: (row.snapshot_ean as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ── Product resolution (faixa de rua → produtos) ────────────────────────────

const PRODUCTS_PAGE_SIZE = 1000;

/**
 * Busca todas as linhas de uma tabela paginando com .range() — um único
 * .select() sem paginação é silenciosamente cortado (limite padrão do
 * PostgREST/Supabase, tipicamente 1000 linhas), o que já causou produtos
 * reais "sumirem" tanto aqui quanto na importação de planilha.
 */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await page(from, from + PRODUCTS_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PRODUCTS_PAGE_SIZE) break;
    from += PRODUCTS_PAGE_SIZE;
  }
  return rows;
}

/**
 * Todos os produtos da empresa (com localização ou não) — a mesma tabela/
 * colunas/company_id scoping que warehouseTwinService.getCompanyProductLocationIndex()
 * já usa no módulo de Slotting (padrão comprovado, ver locationAddressing.ts).
 * Sem filtro de localização aqui de propósito: a UI precisa distinguir
 * "empresa sem nenhum produto" de "empresa com produtos mas sem localização
 * preenchida" — ver physicalCountAlgorithm.ts::classifyScopeAvailability.
 * Paginado (ver fetchAllPages) — empresas com mais de ~1000 produtos tinham
 * a cauda do catálogo inteira invisível para a contagem física.
 */
export async function fetchCompanyProducts(companyId: string): Promise<PhysicalCountCandidateProduct[]> {
  const data = await fetchAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from('products')
      .select('id, name, sku, ean, location, stock_quantity')
      .eq('company_id', companyId)
      .order('id', { ascending: true })
      .range(from, to)
  );
  const products = (data ?? []).map(p => ({
    id: p.id as string,
    name: p.name as string,
    sku: p.sku as string,
    ean: (p.ean as string | null) ?? null,
    location: (p.location as string | null) ?? null,
    stockQuantity: (p.stock_quantity as number | null) ?? 0,
    brand: null as string | null,
  }));

  const brandByProduct = await getBrandByProductId(companyId, products.map(p => p.id));
  return products.map(p => ({ ...p, brand: brandByProduct.get(p.id) ?? null }));
}

/**
 * Marca por produto — best-effort, NÃO é uma classificação oficial. Não existe
 * brand_id (nem coluna de texto) em `products` — confirmado lendo o schema
 * real, nenhuma migration jamais adicionou isso. A única ligação produto→marca
 * que existe de fato é o rastro histórico deixado pela Contagem Manual antiga:
 * quando alguém escolhe uma marca (inventory_brands) e importa uma planilha de
 * SKUs contra ela (ImportCountTab.tsx), cada linha casada com um produto real
 * grava product_id + o count_record (que carrega o brand_id) em
 * inventory_count_import_items. Isso é um log de eventos, não uma tabela de
 * cadastro: um produto nunca contado dessa forma não tem marca derivável — e
 * fica como tal (null), nunca aproximado por nome/SKU. Quando há mais de um
 * registro histórico para o mesmo produto, usa o mais recente.
 */
export async function getBrandByProductId(companyId: string, productIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (productIds.length === 0) return result;

  // Em lotes: um .in() com milhares de IDs de uma vez arrisca estourar o
  // limite de tamanho de URL do PostgREST; cada lote também é paginado
  // (fetchAllPages) pelo mesmo motivo do fetchCompanyProducts acima.
  const CHUNK_SIZE = 200;
  for (let i = 0; i < productIds.length; i += CHUNK_SIZE) {
    const chunk = productIds.slice(i, i + CHUNK_SIZE);
    try {
      const data = await fetchAllPages<Record<string, unknown>>((from, to) =>
        supabase
          .from('inventory_count_import_items')
          .select('product_id, created_at, inventory_count_records(inventory_brands(brand))')
          .eq('company_id', companyId)
          .in('product_id', chunk)
          .order('created_at', { ascending: true })
          .range(from, to)
      );
      for (const row of data) {
        const productId = row.product_id as string | null;
        if (!productId) continue;
        const record = row.inventory_count_records as unknown as { inventory_brands: { brand: string } | null } | null;
        const brand = record?.inventory_brands?.brand;
        if (brand) result.set(productId, brand);
      }
    } catch (error) {
      // Enriquecimento best-effort — uma falha aqui (ex.: embed do PostgREST)
      // nunca deve impedir a contagem de funcionar, só deixa de mostrar a marca
      // para esse lote de produtos.
      console.error('getBrandByProductId failed (non-fatal, brand enrichment only):', error);
    }
  }
  return result;
}

/** `locationFrom`/`locationTo` must be real values already present in `products` — see locationAddressing.ts. */
export function resolveProductsInRange(
  products: PhysicalCountCandidateProduct[],
  locationFrom: string,
  locationTo: string
): PhysicalCountCandidateProduct[] {
  const sortedLocations = listDistinctLocations(products);
  return resolveProductsInLocationRange(products, sortedLocations, locationFrom, locationTo);
}

// ── Session lifecycle ────────────────────────────────────────────────────────

export async function createSession(params: {
  warehouse: string | null;
  area: string | null;
  streetFrom: string;
  streetTo: string;
  responsibleId: string | null;
  observation: string | null;
  productIds: string[];
}): Promise<string> {
  const { data, error } = await supabase.rpc('pc_create_session', {
    p_warehouse: params.warehouse,
    p_area: params.area,
    p_street_from: params.streetFrom,
    p_street_to: params.streetTo,
    p_responsible_id: params.responsibleId,
    p_observation: params.observation,
    p_product_ids: params.productIds,
  });
  if (error) throw error;
  return String(data);
}

export async function startSession(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('pc_start_session', { p_session_id: sessionId });
  if (error) throw error;
}

export async function registerCount(params: {
  itemId: string;
  mode: CountMode;
  quantity: number;
  source: CountSource;
  idempotencyKey: string;
}): Promise<number> {
  const entry: QueuedCount = {
    itemId: params.itemId,
    mode: params.mode,
    quantity: params.quantity,
    source: params.source,
    idempotencyKey: params.idempotencyKey,
    queuedAt: Date.now(),
  };
  enqueue(entry);
  try {
    const { data, error } = await supabase.rpc('pc_register_count', {
      p_item_id: params.itemId,
      p_mode: params.mode,
      p_quantity: params.quantity,
      p_source: params.source,
      p_idempotency_key: params.idempotencyKey,
    });
    if (error) throw error;
    dequeue(params.idempotencyKey);
    return Number(data);
  } catch (err) {
    // Kept in the offline queue on purpose — flushPendingCounts() retries it
    // later with the SAME idempotency key, which pc_register_count treats as
    // a no-op replay if it already landed. The caller already applied the
    // count optimistically in local UI state.
    throw err;
  }
}

/**
 * Registra "esperado aqui, encontrado fisicamente em outro lugar" (seção 10)
 * sem alterar o cadastro oficial (`products.location`) — mover um SKU de
 * verdade continua sendo uma ação separada do módulo de Slotting. Não entra
 * na fila offline: é uma anotação de auditoria, não uma quantidade contada,
 * então não há perda funcional se falhar e o operador tentar de novo.
 */
export async function flagFoundElsewhere(params: { itemId: string; foundLocation: string; quantity: number; idempotencyKey: string }): Promise<void> {
  const { error } = await supabase.rpc('pc_flag_found_elsewhere', {
    p_item_id: params.itemId,
    p_found_location: params.foundLocation,
    p_quantity: params.quantity,
    p_idempotency_key: params.idempotencyKey,
  });
  if (error) throw error;
}

/** Retries every locally-queued count with its original idempotency key. Call on reconnect. */
export async function flushPendingCounts(): Promise<{ flushed: number; stillPending: number }> {
  const pending = listPending();
  let flushed = 0;
  for (const entry of pending) {
    try {
      const { error } = await supabase.rpc('pc_register_count', {
        p_item_id: entry.itemId,
        p_mode: entry.mode,
        p_quantity: entry.quantity,
        p_source: entry.source,
        p_idempotency_key: entry.idempotencyKey,
      });
      if (error) throw error;
      dequeue(entry.idempotencyKey);
      flushed++;
    } catch {
      // Still offline or a real error — leave it queued, try again next flush.
    }
  }
  return { flushed, stillPending: listPending().length };
}

export async function finalizeSession(sessionId: string): Promise<string> {
  const { data, error } = await supabase.rpc('pc_finalize_session', { p_session_id: sessionId });
  if (error) throw error;
  return String(data);
}

export async function createRecountSession(parentSessionId: string, responsibleId?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('pc_create_recount_session', {
    p_parent_session_id: parentSessionId,
    p_responsible_id: responsibleId ?? null,
  });
  if (error) throw error;
  return String(data);
}

export async function reopenSession(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('pc_reopen_session', { p_session_id: sessionId });
  if (error) throw error;
}

export async function approveSession(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('pc_approve_session', { p_session_id: sessionId });
  if (error) throw error;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function listSessions(companyId: string): Promise<PhysicalCountSession[]> {
  const { data, error } = await supabase
    .from('physical_count_sessions')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapSession);
}

export async function getSession(sessionId: string): Promise<PhysicalCountSession | null> {
  const { data, error } = await supabase
    .from('physical_count_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapSession(data) : null;
}

/** Items for the active tablet counting screen — does NOT include erp_quantity_snapshot
 *  in the selected columns while a session is still in_progress, keeping the blind
 *  count blind at the query level (same limitation NF-e already accepts: UI/query-level
 *  hiding, not a column-level cryptographic guarantee). Embeds products(name) — the
 *  operator needs the product name to identify it, not just SKU/EAN — this is a
 *  read-only display join, it never touches the hidden ERP quantity. */
export async function getBlindItems(
  sessionId: string
): Promise<Array<Pick<PhysicalCountItem, 'id' | 'sessionId' | 'productId' | 'sku' | 'ean' | 'location' | 'physicalQuantity' | 'foundLocation' | 'foundElsewhereQuantity'> & { productName: string | null }>> {
  const { data, error } = await supabase
    .from('physical_count_items')
    .select('id, session_id, product_id, sku, ean, location, physical_quantity, found_location, found_elsewhere_quantity, products(name)')
    .eq('session_id', sessionId)
    .order('location', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map(row => ({
    id: row.id as string,
    sessionId: row.session_id as string,
    productId: row.product_id as string,
    sku: (row.sku as string | null) ?? null,
    ean: (row.ean as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    physicalQuantity: (row.physical_quantity as number | null) ?? null,
    foundLocation: (row.found_location as string | null) ?? null,
    foundElsewhereQuantity: (row.found_elsewhere_quantity as number | null) ?? 0,
    productName: (row.products as unknown as { name: string } | null)?.name ?? null,
  }));
}

/** Full item rows including erp_quantity_snapshot — for the result/comparison panel, after finalize. */
export async function getSessionItems(sessionId: string): Promise<PhysicalCountItem[]> {
  const { data, error } = await supabase
    .from('physical_count_items')
    .select('*')
    .eq('session_id', sessionId)
    .order('location', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map(mapItem);
}

export async function getFinalResult(rootSessionId: string): Promise<PhysicalCountFinalResultRow[]> {
  const { data, error } = await supabase
    .from('physical_count_final_result_v')
    .select('*')
    .eq('root_session_id', rootSessionId);
  if (error) throw error;
  return (data ?? []).map(row => ({
    rootSessionId: row.root_session_id as string,
    companyId: row.company_id as string,
    productId: row.product_id as string,
    sku: (row.sku as string | null) ?? null,
    ean: (row.ean as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    erpQuantitySnapshot: (row.erp_quantity_snapshot as number | null) ?? null,
    count1: (row.count_1 as number | null) ?? null,
    count2: (row.count_2 as number | null) ?? null,
    count3: (row.count_3 as number | null) ?? null,
    anyRoundApproved: Boolean(row.any_round_approved),
  }));
}

// ── ERP sync ─────────────────────────────────────────────────────────────────

export async function callErpSync(sessionId: string): Promise<ErpSyncReport> {
  const { data, error } = await supabase.functions.invoke('erp-sync', {
    body: { sessionId },
  });
  if (error) throw error;
  return data as ErpSyncReport;
}

// ── Recontagem automática por limite de divergência (migration 049) ──────────
//
// A decisão em si não passa por aqui: pc_evaluate_auto_recount roda dentro de
// pc_finalize_session, no servidor. Estas funções só leem a configuração, gravam a
// configuração e leem o rastro — o cliente não dispara a automação nem pode
// contorná-la.

/** Configuração da empresa. Ausente = nunca configurado, e nesse caso vale o
 *  default com `enabled: false`, mantendo o fluxo manual de hoje. */
export async function getRecountSettings(): Promise<RecountSettings> {
  const { data, error } = await supabase
    .from('physical_count_recount_settings')
    .select('enabled, threshold_type, threshold_value, notify_user_id')
    .maybeSingle();

  if (error) throw error;
  if (!data) return DEFAULT_RECOUNT_SETTINGS;

  return {
    enabled: Boolean(data.enabled),
    thresholdType: data.threshold_type as RecountThresholdType,
    thresholdValue: Number(data.threshold_value),
    notifyUserId: (data.notify_user_id as string | null) ?? null,
  };
}

/** Grava a configuração.
 *
 *  Upsert porque a linha pode não existir: company_id tem
 *  `DEFAULT get_my_company_id()::uuid`, então a empresa não é enviada pelo cliente
 *  nem em insert nem em update — quem define o tenant é o banco, e a policy de
 *  INSERT exige que o valor resultante bata com a empresa do JWT. */
export async function saveRecountSettings(settings: RecountSettings): Promise<void> {
  const { data: companyId, error: companyError } = await supabase.rpc('get_my_company_id');
  if (companyError) throw companyError;
  if (!companyId) throw new Error('Nenhuma empresa ativa na sessão.');

  const { error } = await supabase.from('physical_count_recount_settings').upsert(
    {
      company_id: companyId as string,
      enabled: settings.enabled,
      threshold_type: settings.thresholdType,
      threshold_value: settings.thresholdValue,
      notify_user_id: settings.notifyUserId,
    },
    { onConflict: 'company_id' }
  );

  if (error) throw error;
}

function mapRecountEvent(row: Record<string, unknown>): RecountEvent {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    sourceSessionId: row.source_session_id as string,
    recountSessionId: (row.recount_session_id as string | null) ?? null,
    status: row.status as RecountEvent['status'],
    reason: (row.reason as string | null) ?? null,
    thresholdType: row.threshold_type as string,
    thresholdValue: Number(row.threshold_value),
    measuredValue: Number(row.measured_value),
    countedItems: Number(row.counted_items ?? 0),
    divergentItems: Number(row.divergent_items ?? 0),
    absoluteUnitDeviation: Number(row.absolute_unit_deviation ?? 0),
    recipientId: (row.recipient_id as string | null) ?? null,
    acknowledgedAt: (row.acknowledged_at as string | null) ?? null,
    acknowledgedBy: (row.acknowledged_by as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

const RECOUNT_EVENT_COLUMNS =
  'id, company_id, source_session_id, recount_session_id, status, reason, threshold_type, ' +
  'threshold_value, measured_value, counted_items, divergent_items, absolute_unit_deviation, ' +
  'recipient_id, acknowledged_at, acknowledged_by, created_at';

/** O feed de avisos: avaliações que geraram recontagem ou falharam e ninguém
 *  reconheceu ainda.
 *
 *  Os `skipped` por limite não aparecem — a 049 já os grava com
 *  `acknowledged_at` preenchido, porque "não passou do limite" é registro, não
 *  aviso. Transformar isso em pendência daria ao gestor uma notificação para
 *  dispensar a cada contagem correta. */
export async function listPendingRecountEvents(): Promise<RecountEvent[]> {
  const { data, error } = await supabase
    .from('physical_count_recount_events')
    .select(RECOUNT_EVENT_COLUMNS)
    .is('acknowledged_at', null)
    .order('created_at', { ascending: false })
    .limit(20)
    // A lista de colunas vem de uma constante, e o client tipado só consegue
    // inferir a partir de literal. `.returns` recupera o tipo sem obrigar a trocar
    // por `select('*')`.
    .returns<Record<string, unknown>[]>();

  if (error) throw error;
  return (data ?? []).map(mapRecountEvent);
}

/** A avaliação de uma sessão específica, para o painel de resultado explicar o que
 *  a automação fez quando aquela contagem foi fechada. */
export async function getRecountEventForSession(sessionId: string): Promise<RecountEvent | null> {
  const { data, error } = await supabase
    .from('physical_count_recount_events')
    .select(RECOUNT_EVENT_COLUMNS)
    .eq('source_session_id', sessionId)
    .maybeSingle<Record<string, unknown>>();

  if (error) throw error;
  return data ? mapRecountEvent(data) : null;
}

/** Dá baixa no aviso via RPC, que registra quem reconheceu. Um UPDATE direto
 *  passaria pela policy mas não gravaria o autor. */
export async function acknowledgeRecountEvent(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('pc_acknowledge_recount_event', { p_event_id: eventId });
  if (error) throw error;
}
