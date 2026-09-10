// Fonte de Saldo "Tiny — Estoque diário" — camada de I/O.
//
// Reaproveita o pipeline canônico de Fonte de Saldo por inteiro, sem criar
// infraestrutura paralela:
//   leitura do arquivo  -> src/lib/spreadsheet-comparator/fileParser.ts
//   contrato/tipos      -> tinyStockSheetContract.ts (puro)
//   associação          -> src/lib/integrations/matching.ts (via tinyStockSheetPlan)
//   mapeamento          -> src/lib/integrations/mappingEngine.ts (integration_entity_links)
//   saldo (snapshot)    -> createSupabaseSyncRepository().saveStockLevels
//   histórico/auditoria -> integration_sync_runs + integration_sync_items
//
// SNAPSHOT, nunca acumulação: `saveStockLevels` faz upsert em
// UNIQUE (connection_id, entity_link_id, external_warehouse_id) e este arquivo
// sempre grava `external_warehouse_id` vazio (um saldo por produto, que é o que
// o relatório do Tiny traz). Reimportar substitui; nunca soma.
//
// NÃO escreve no cadastro canônico: nada aqui toca `products` (nome, SKU, EAN,
// localização, marca, categoria) nem `products.stock_quantity`, nem contagem,
// nem movimentação. A conciliação do saldo da fonte com o Core é uma decisão
// separada e explícita, exatamente como a migration 042 documenta.
//
// company_id nunca é enviado: toda tabela usa DEFAULT get_my_company_id() e a
// policy de RLS reconfere. O workspace vem do JWT, não de argumento.

import { supabase } from '../../supabase';
import { validateRowCount } from '../../uploadValidationUtils';
import { readSpreadsheetGrid, validateFileBeforeParse } from '../../spreadsheet-comparator/fileParser';
import type { SheetGrid } from '../../spreadsheet-comparator/types';
import { loadLinkIndex, upsertLinks } from '../mappingEngine';
import type { MatchCandidate } from '../matching';
import { createConnection, listSyncRuns, updateConnection } from '../integrationService';
import type { IntegrationConnection } from '../types';
import { createSupabaseSyncRepository } from '../sync/supabaseSyncRepository';
import type { RecordItemInput, StockLevelSnapshot } from '../sync/syncEngine';
import {
  TINY_STOCK_SHEET_PROVIDER_KEY,
  TINY_STOCK_SHEET_SOURCE_NAME,
  parseTinyStockSheetGrid,
} from './tinyStockSheetContract';
import type { TinyStockSheetRecord } from './tinyStockSheetContract';
import { decisionsWithBalance, planStockSheetImport } from './tinyStockSheetPlan';
import type { StockSheetCounters, StockSheetDecision } from './tinyStockSheetPlan';

const CONNECTION_COLUMNS = `
  id, company_id, provider_key, display_name, external_account_id, status,
  fiscal_entity_id, configuration, sync_direction, stock_source_of_truth,
  auto_sync_enabled, sync_interval_minutes, sync_cursor, credentials_set_at,
  credential_hint, last_sync_at, last_successful_sync_at, last_error,
  last_error_at, created_at, updated_at
`;

/** Estado guardado em `integration_connections.configuration`, sob uma chave
 *  própria — mesma técnica que o cursor incremental do sync usa (`syncState`),
 *  para não exigir coluna nova. */
const STOCK_SHEET_STATE_KEY = 'stockSheet';

export interface StockSheetState {
  lastFileName?: string;
  lastImportedAt?: string;
  lastRecordCount?: number;
}

export function readStockSheetState(connection: IntegrationConnection): StockSheetState {
  const stored = connection.configuration[STOCK_SHEET_STATE_KEY];
  return stored != null && typeof stored === 'object' ? (stored as StockSheetState) : {};
}

// ─────────────────────────────────────────────────────────────────────────────
// A fonte (registro persistido)
// ─────────────────────────────────────────────────────────────────────────────

/** A fonte deste workspace, ou null se ainda não foi ativada.
 *
 *  Consulta própria (e não `listConnections()`) porque aquela função devolve de
 *  propósito só as conexões de integração por API — ver sheetSources.ts. */
export async function findTinyStockSheetSource(): Promise<IntegrationConnection | null> {
  const { data, error } = await supabase
    .from('integration_connections')
    .select(CONNECTION_COLUMNS)
    .eq('provider_key', TINY_STOCK_SHEET_PROVIDER_KEY)
    .order('created_at')
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (data == null) return null;

  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    providerKey: row.provider_key as string,
    displayName: row.display_name as string,
    externalAccountId: (row.external_account_id ?? null) as string | null,
    status: row.status as IntegrationConnection['status'],
    fiscalEntityId: (row.fiscal_entity_id ?? null) as string | null,
    configuration: (row.configuration ?? {}) as Record<string, unknown>,
    syncDirection: row.sync_direction as IntegrationConnection['syncDirection'],
    stockSourceOfTruth: row.stock_source_of_truth as boolean,
    autoSyncEnabled: row.auto_sync_enabled as boolean,
    syncIntervalMinutes: (row.sync_interval_minutes ?? null) as number | null,
    syncCursor: (row.sync_cursor ?? null) as string | null,
    credentialsSetAt: (row.credentials_set_at ?? null) as string | null,
    credentialHint: (row.credential_hint ?? null) as string | null,
    lastSyncAt: (row.last_sync_at ?? null) as string | null,
    lastSuccessfulSyncAt: (row.last_successful_sync_at ?? null) as string | null,
    lastError: (row.last_error ?? null) as string | null,
    lastErrorAt: (row.last_error_at ?? null) as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Ativa a fonte no workspace ativo. Idempotente: se já existir, devolve a que
 * existe em vez de criar uma segunda.
 *
 * `status: 'active'` porque uma fonte por upload não tem credencial a aguardar —
 * o padrão 'pending' apareceria na tela como "Aguardando credencial", o que
 * seria falso aqui. `auto_sync_enabled` fica false: não há nada a agendar.
 */
export async function activateTinyStockSheetSource(): Promise<IntegrationConnection> {
  const existing = await findTinyStockSheetSource();
  if (existing) return existing;

  const created = await createConnection({
    providerKey: TINY_STOCK_SHEET_PROVIDER_KEY,
    displayName: TINY_STOCK_SHEET_SOURCE_NAME,
    syncDirection: 'inbound',
    stockSourceOfTruth: false,
    configuration: { ingestion: 'spreadsheet_upload' },
  });

  return updateConnection(created.id, { status: 'active' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Leitura do arquivo (nenhuma escrita)
// ─────────────────────────────────────────────────────────────────────────────

export type StockSheetRead =
  | { ok: false; error: string }
  | { ok: true; sheetName: string; records: TinyStockSheetRecord[] };

const SHEET_EXTENSIONS = ['.xls', '.xlsx'];

/**
 * Valida e lê o arquivo inteiro na memória do navegador. Nenhuma escrita
 * acontece nesta função — é o que garante o critério "arquivo estruturalmente
 * inválido não altera nenhum saldo".
 *
 * Múltiplas abas: usa SOMENTE a aba cujo cabeçalho bate com o contrato, e
 * nunca mistura registros de abas diferentes.
 */
export async function readTinyStockSheet(file: File): Promise<StockSheetRead> {
  const lower = file.name.toLowerCase();
  if (!SHEET_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    return { ok: false, error: 'Envie o arquivo do Tiny em .xls ou .xlsx.' };
  }

  const invalid = validateFileBeforeParse(file);
  if (invalid) return { ok: false, error: invalid };

  let first: SheetGrid;
  try {
    first = await readSpreadsheetGrid(file);
  } catch (thrown) {
    return {
      ok: false,
      error: thrown instanceof Error ? thrown.message : 'Não foi possível ler a planilha.',
    };
  }

  const attempts: { name: string; grid: unknown[][] }[] = [
    { name: first.activeSheet, grid: first.grid },
  ];

  for (const name of first.sheetNames) {
    if (name === first.activeSheet) continue;
    try {
      const other = await readSpreadsheetGrid(file, name);
      attempts.push({ name, grid: other.grid });
    } catch {
      // Aba ilegível não invalida o arquivo: o contrato pode estar em outra.
    }
  }

  let firstError = '';
  for (const attempt of attempts) {
    const parsed = parseTinyStockSheetGrid(attempt.grid);
    if (parsed.ok) {
      const rowLimit = validateRowCount(parsed.records.length);
      if (!rowLimit.valid) return { ok: false, error: rowLimit.error ?? 'Planilha muito grande.' };
      if (parsed.records.length === 0) {
        return { ok: false, error: 'A planilha não tem linhas de dados abaixo do cabeçalho.' };
      }
      return { ok: true, sheetName: attempt.name, records: parsed.records };
    }
    if (firstError === '') firstError = parsed.error;
  }

  return { ok: false, error: firstError || 'Cabeçalho da planilha não reconhecido.' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Produtos candidatos (escopados por RLS)
// ─────────────────────────────────────────────────────────────────────────────

const PRODUCT_PAGE = 1000;

/** Produtos do workspace ativo, para a associação por SKU/EAN.
 *
 *  Carregado UMA vez por importação, paginado: uma consulta por linha da
 *  planilha seria milhares de round trips. `.order('id')` é obrigatório porque
 *  `.range()` sem ordenação não tem paginação estável. */
export async function loadProductCandidates(): Promise<MatchCandidate[]> {
  const candidates: MatchCandidate[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, ean')
      .order('id')
      .range(from, from + PRODUCT_PAGE - 1);

    if (error) throw error;
    const rows = (data ?? []) as { id: string; sku: string | null; ean: string | null }[];
    for (const row of rows) candidates.push({ internalId: row.id, sku: row.sku, ean: row.ean });

    if (rows.length < PRODUCT_PAGE) break;
    from += PRODUCT_PAGE;
  }

  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// Importação
// ─────────────────────────────────────────────────────────────────────────────

export interface StockSheetImportResult {
  runId: string;
  counters: StockSheetCounters;
  decisions: StockSheetDecision[];
}

/**
 * Grava o snapshot da fonte.
 *
 * Ordem: abre o registro no histórico, mapeia (integration_entity_links),
 * grava o saldo (integration_stock_levels, upsert = substituição), registra
 * linha por linha (integration_sync_items) e fecha o histórico com os
 * contadores.
 *
 * Os contadores do histórico descrevem o ARQUIVO (linhas lidas, registros novos
 * na fonte, reescritos, sem saldo, recusados). O status de cada item descreve a
 * ASSOCIAÇÃO daquela linha: success = associado, skipped = sem produto
 * correspondente, conflict = ambíguo, failed = linha recusada.
 */
export async function importTinyStockSheet(params: {
  connection: IntegrationConnection;
  fileName: string;
  records: TinyStockSheetRecord[];
}): Promise<StockSheetImportResult> {
  const { connection, fileName, records } = params;
  const connectionId = connection.id;
  const repository = createSupabaseSyncRepository(connectionId);
  const startedAt = Date.now();
  const observedAt = new Date().toISOString();

  const [existingLinks, candidates] = await Promise.all([
    loadLinkIndex(connectionId, 'product'),
    loadProductCandidates(),
  ]);

  const plan = planStockSheetImport({ records, existingLinks, candidates });

  const job = await repository.createJob({
    connectionId,
    syncType: 'manual',
    direction: 'inbound',
    entityType: 'stock',
    triggerSource: 'manual',
    idempotencyKey: crypto.randomUUID(),
  });

  try {
    await repository.updateJob(job.id, { status: 'running', recordsTotal: records.length });

    const usable = decisionsWithBalance(plan.decisions);

    // Mapeamento primeiro: `saveStockLevels` pendura o saldo no link, e um
    // registro sem link ficaria de fora do snapshot.
    await upsertLinks(
      usable.map(decision => ({
        connectionId,
        entityType: 'product' as const,
        externalId: decision.record.externalId,
        internalId: decision.internalId,
        externalSku: decision.record.sku || null,
        externalEan: decision.record.ean || null,
        externalName: decision.record.name || null,
        // Localização vem da fonte e fica como metadado dela. NÃO sobrescreve
        // products.location — o endereço do InventoryBlind é do inventário.
        externalPayload: {
          id: decision.record.externalId,
          produto: decision.record.name,
          sku: decision.record.sku,
          ean: decision.record.ean,
          localizacao: decision.record.location,
          saldo: decision.record.quantity,
          arquivo: fileName,
        },
        matchSource: decision.matchSource,
        syncedAt: observedAt,
      }))
    );

    const levels: StockLevelSnapshot[] = usable.map(decision => ({
      externalProductId: decision.record.externalId,
      // Um saldo por produto: o relatório do Tiny não separa por depósito.
      // Manter vazio é o que faz a reimportação substituir em vez de somar.
      warehouseExternalId: null,
      warehouseName: null,
      quantity: decision.record.quantity as number,
      reserved: null,
      available: null,
      observedAt,
    }));
    await repository.saveStockLevels(levels);

    const items: RecordItemInput[] = plan.decisions.map(decision => ({
      jobId: job.id,
      connectionId,
      entityType: 'stock',
      internalId: decision.internalId,
      externalId: decision.record.externalId || null,
      operation:
        decision.outcome === 'skipped' || decision.outcome === 'rejected'
          ? 'skip'
          : decision.isNewLink
            ? 'create'
            : 'update',
      status:
        decision.outcome === 'linked'
          ? 'success'
          : decision.outcome === 'ambiguous'
            ? 'conflict'
            : decision.outcome === 'rejected'
              ? 'failed'
              : 'skipped',
      newValue:
        decision.record.quantity === null
          ? null
          : { quantity: decision.record.quantity, sku: decision.record.sku, ean: decision.record.ean },
      errorKind: decision.outcome === 'linked' ? null : decision.outcome,
      errorMessage: decision.reason,
      processedAt: observedAt,
    }));
    await repository.recordItems(items);

    await repository.updateJob(job.id, {
      status: plan.counters.failed > 0 ? 'partial' : 'success',
      processed: plan.counters.processed,
      created: plan.counters.created,
      updated: plan.counters.updated,
      skipped: plan.counters.skipped,
      failed: plan.counters.failed,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    });

    const state: StockSheetState = {
      lastFileName: fileName,
      lastImportedAt: observedAt,
      lastRecordCount: usable.length,
    };
    // Metadado de exibição ("qual arquivo produziu o snapshot atual"), e a
    // policy de UPDATE de integration_connections é owner/admin. Um manager
    // pode importar (as tabelas do snapshot são só company-scoped), então uma
    // recusa aqui não pode desfazer nem invalidar a importação que já gravou.
    await updateConnection(connectionId, {
      configuration: { ...connection.configuration, [STOCK_SHEET_STATE_KEY]: state },
    }).catch(() => undefined);

    return { runId: job.id, counters: plan.counters, decisions: plan.decisions };
  } catch (thrown) {
    // O histórico não fica pendurado em 'running' quando algo falha no meio.
    await repository
      .updateJob(job.id, {
        status: 'failed',
        errorSummary: thrown instanceof Error ? thrown.message : 'Falha na importação da planilha.',
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
      })
      .catch(() => undefined);
    throw thrown;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado da fonte (leitura)
// ─────────────────────────────────────────────────────────────────────────────

export interface StockSheetSnapshot {
  connection: IntegrationConnection;
  /** Fim da última importação CONCLUÍDA (success ou partial). `null` = a fonte
   *  está configurada mas nunca recebeu arquivo aceito. */
  lastImportAt: string | null;
  /** Produtos com saldo no snapshot atual (um head count, não uma varredura). */
  productsWithBalance: number;
}

/**
 * Estado do snapshot vigente da fonte deste workspace.
 *
 * "Último snapshot" não é uma linha versionada: `integration_stock_levels` é
 * upsert em `UNIQUE (connection_id, entity_link_id, external_warehouse_id)`, ou
 * seja o conteúdo da tabela É sempre a leitura mais recente — e é por isso que
 * um novo arquivo passa a valer sozinho, sem a ferramenta de relatório guardar
 * cópia de nada.
 *
 * `lastImportAt` sai da última execução com status concluído em
 * `integration_sync_runs` (lida pelo `listSyncRuns` que já existe). Execução
 * pendente, em andamento ou com erro nunca é promovida a snapshot: ela não
 * aparece como concluída, e enquanto não houver nenhuma concluída a fonte se
 * apresenta como "sem saldo importado".
 */
export async function loadTinyStockSheetSnapshot(): Promise<StockSheetSnapshot | null> {
  const connection = await findTinyStockSheetSource();
  if (connection == null) return null;

  const [runs, productsWithBalance] = await Promise.all([
    listSyncRuns(connection.id, 5),
    countSourceStockLevels(connection.id),
  ]);

  const concluded = runs.find(run => run.status === 'success' || run.status === 'partial');

  return {
    connection,
    lastImportAt: concluded ? (concluded.finishedAt ?? concluded.startedAt) : null,
    productsWithBalance,
  };
}

export interface SourceBalance {
  quantity: number;
  /** O produto está ligado a mais de um registro da fonte: o saldo dele não é
   *  decidível, e adivinhar seria atribuir número de um registro a outro. */
  ambiguous: boolean;
}

const BALANCE_BATCH = 300;

function batches<T>(items: T[], size = BALANCE_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Saldo da fonte para os produtos pedidos — EM LOTE, nunca uma consulta por
 * produto: 300 produtos são duas requisições, não 300.
 *
 * A associação NÃO é recalculada aqui. Ela foi resolvida e persistida na
 * importação, em `integration_entity_links.internal_id` (pela regra canônica
 * `resolveMatch`), e este caminho apenas segue o vínculo já gravado:
 *   product_id -> entity_link -> integration_stock_levels.quantity
 * Registro da fonte sem produto associado simplesmente não entra no mapa.
 */
export async function loadTinyStockSheetBalances(
  connectionId: string,
  productIds: string[]
): Promise<Map<string, SourceBalance>> {
  const result = new Map<string, SourceBalance>();
  if (productIds.length === 0) return result;

  // 1. product_id -> link(s) já gravados pela importação.
  const productByLink = new Map<string, string>();

  for (const batch of batches([...new Set(productIds)])) {
    const { data, error } = await supabase
      .from('integration_entity_links')
      .select('id, internal_id')
      .eq('connection_id', connectionId)
      .eq('entity_type', 'product')
      .in('internal_id', batch);

    if (error) throw error;
    for (const row of (data ?? []) as { id: string; internal_id: string | null }[]) {
      if (row.internal_id == null) continue;
      productByLink.set(row.id, row.internal_id);
    }
  }

  if (productByLink.size === 0) return result;

  // 2. saldo do snapshot vigente para esses links.
  const quantitiesByProduct = new Map<string, number[]>();

  for (const batch of batches([...productByLink.keys()])) {
    const { data, error } = await supabase
      .from('integration_stock_levels')
      .select('entity_link_id, quantity')
      .eq('connection_id', connectionId)
      .in('entity_link_id', batch);

    if (error) throw error;

    for (const row of (data ?? []) as { entity_link_id: string; quantity: number | string }[]) {
      const productId = productByLink.get(row.entity_link_id);
      if (productId == null) continue;
      const quantity = Number(row.quantity);
      if (!Number.isFinite(quantity)) continue;
      const bucket = quantitiesByProduct.get(productId);
      if (bucket) bucket.push(quantity);
      else quantitiesByProduct.set(productId, [quantity]);
    }
  }

  for (const [productId, quantities] of quantitiesByProduct) {
    // Mais de um registro da fonte apontando para o mesmo produto: ambíguo,
    // mesmo que os números coincidam — não há como saber de quem é o saldo.
    result.set(productId, { quantity: quantities[0], ambiguous: quantities.length > 1 });
  }

  return result;
}

/** Quantos produtos a fonte tem com saldo no snapshot atual. */
export async function countSourceStockLevels(connectionId: string): Promise<number> {
  const { count, error } = await supabase
    .from('integration_stock_levels')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', connectionId);

  if (error) throw error;
  return count ?? 0;
}
