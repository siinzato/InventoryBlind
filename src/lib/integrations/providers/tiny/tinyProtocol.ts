// Tiny ERP (Olist) — protocol layer.
//
// Everything about talking to Tiny that does NOT require network access: the
// response envelope, the error taxonomy, pagination, and the field maps. Kept
// pure and in src/ so it is unit-testable without credentials; the fetch half
// lives server-side in supabase/functions and imports this.
//
// ── The one thing that matters most about this API ───────────────────────────
// Tiny API v2 answers HTTP 200 even when the request failed. The real outcome is
// inside `retorno.status`, which is "OK" or "Erro". Any code that trusts
// `response.ok` will report a rejected stock adjustment as confirmed — which is
// exactly the bug in the previous tinyAdapter stub, and the most expensive one
// available here: the operator believes the ERP was corrected when it was not.
//
// ── What must be verified against live docs before going to production ──────
// Marked VERIFY below. I am confident about the envelope shape, the `token` +
// `formato=json` auth, and page-based pagination via `pagina`/`numero_paginas`.
// The exact endpoint filenames and the stock-update payload are the parts most
// likely to have drifted, so they are isolated in ONE config block: correcting
// them is a few lines, not a rewrite.

// Import discipline for Deno compatibility (this file is imported by an Edge
// Function): every cross-file reference is `import type`, which the Deno compiler
// erases and therefore never has to resolve. The one runtime dependency —
// IntegrationError — carries an explicit `.ts` extension because Deno requires it,
// and `allowImportingTsExtensions` in tsconfig.app.json lets the browser build
// accept the same specifier. errors.ts is itself import-free, so the chain stops
// there. Adding a new runtime import here without checking that will break the
// function deploy, not the browser build, so it fails late.
import type { ProductFieldMap, StockFieldMap } from '../../normalizers';
import { IntegrationError, type IntegrationErrorKind } from '../../errors.ts';
import type { PageInfo } from '../../pagination';
import type { ProviderCapabilities } from '../../types';

export const TINY_API_BASE = 'https://api.tiny.com.br/api2';

/** VERIFY these filenames against the current Tiny API v2 reference before the
 *  first production run. Everything else in this file is independent of them. */
export const TINY_ENDPOINTS = {
  listProducts: 'produtos.pesquisa.php',
  getProduct: 'produto.obter.php',
  /** Returns the per-deposit breakdown for one product. */
  getProductStock: 'produto.obter.estoque.php',
  /** VERIFY: v2 has historically exposed both `produto.atualizar.estoque.php`
   *  and `estoque.atualizar.php`. The payload differs between them. */
  updateStock: 'produto.atualizar.estoque.php',
  listDeposits: 'depositos.pesquisa.php',
} as const;

/** What Tiny v2 can actually do, as declared to the capability gate.
 *
 *  `write_stock` (absolute) and `write_adjustment` (delta) are both true because
 *  the stock endpoint accepts a movement type: 'B' for balanço (set the balance)
 *  and 'E'/'S' for entrada/saída (add/remove). That distinction is the whole
 *  reason the engine separates absolute from delta.
 *
 *  `webhooks` is false: v2 has no webhook registration API. Incremental sync
 *  therefore relies on polling with a date filter, not on push. */
export const TINY_CAPABILITIES: ProviderCapabilities = {
  read_products: true,
  read_stock: true,
  read_stock_by_warehouse: true,
  read_reserved_stock: true,
  read_locations: true,
  read_categories: true,
  read_orders: true,
  write_stock: true,
  write_adjustment: true,
  // Declared true even though v2 has no atomic transfer endpoint: the connector
  // implements it as two ordered movements (see buildTinyTransferLegs). The
  // capability describes what InventoryBlind can achieve through this provider,
  // not how many HTTP calls it takes.
  write_transfer: true,
  webhooks: false,
  multi_store: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Envelope
// ─────────────────────────────────────────────────────────────────────────────

export interface TinyEnvelope {
  status_processamento?: string | number;
  status?: string;
  codigo_erro?: string | number;
  erros?: unknown;
  [key: string]: unknown;
}

export interface TinyParsed {
  ok: boolean;
  /** `retorno`, unwrapped. */
  retorno: TinyEnvelope;
  error: IntegrationError | null;
}

/** Tiny's numeric error codes, mapped onto the engine's taxonomy.
 *
 *  The mapping matters because it decides retry behaviour: code 1 (invalid token)
 *  must never be retried, while 20 (rate limit) must be, and treating them alike
 *  either hammers a dead credential or gives up on a recoverable throttle.
 *
 *  VERIFY the numbers against the current docs; the kinds they map to are the
 *  judgement, and those hold regardless of renumbering. */
const TINY_ERROR_KIND: Record<string, IntegrationErrorKind> = {
  '1': 'AUTH_INVALID',            // token não informado / inválido
  '2': 'AUTH_INVALID',            // token inválido
  '3': 'PERMISSION_DENIED',       // módulo/permissão indisponível
  '4': 'VALIDATION',              // erro de validação nos parâmetros
  '6': 'NOT_FOUND',               // registro não encontrado
  '20': 'RATE_LIMITED',           // limite de requisições
  '21': 'RATE_LIMITED',
  '30': 'PERMISSION_DENIED',      // conta bloqueada
  '31': 'PERMISSION_DENIED',
};

/** Human-readable message out of Tiny's `erros`, which arrives in several
 *  shapes: a string, an array of strings, or an array of `{erro: "..."}`.
 *  Falling back to a generic message is better than printing `[object Object]`
 *  into a sync log an operator has to read. */
export function extractTinyErrorMessage(erros: unknown): string {
  if (typeof erros === 'string' && erros.trim().length > 0) return erros.trim();

  if (Array.isArray(erros)) {
    const parts = erros
      .map(item => {
        if (typeof item === 'string') return item;
        if (item != null && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          const value = record.erro ?? record.mensagem ?? record.message;
          if (typeof value === 'string') return value;
        }
        return null;
      })
      .filter((part): part is string => part != null && part.trim().length > 0);

    if (parts.length > 0) return parts.join('; ');
  }

  if (erros != null && typeof erros === 'object') {
    const record = erros as Record<string, unknown>;
    const value = record.erro ?? record.mensagem;
    if (typeof value === 'string') return value;
  }

  return 'O Tiny recusou a requisição sem detalhar o motivo.';
}

/** Parse a Tiny response body.
 *
 *  `httpStatus` is accepted but only used when the body is unusable: a genuine
 *  5xx with an HTML error page is a provider outage, while a 200 with
 *  `status: "Erro"` is an application-level rejection. Both must be reported, and
 *  they are not the same kind of problem. */
export function parseTinyResponse(body: unknown, httpStatus: number): TinyParsed {
  const root = body != null && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const retorno = root?.retorno;

  if (retorno == null || typeof retorno !== 'object') {
    // No envelope at all: either a transport failure or Tiny returned HTML.
    const kind: IntegrationErrorKind = httpStatus >= 500 ? 'PROVIDER_UNAVAILABLE' : 'UNKNOWN';
    return {
      ok: false,
      retorno: {},
      error: new IntegrationError({
        kind,
        message: `Resposta do Tiny em formato inesperado (HTTP ${httpStatus}).`,
        providerCode: String(httpStatus),
      }),
    };
  }

  const envelope = retorno as TinyEnvelope;
  const status = String(envelope.status ?? '').trim().toLowerCase();

  // "OK" is the only success value. Anything else — including an absent status —
  // is treated as failure rather than assumed fine.
  if (status === 'ok') {
    return { ok: true, retorno: envelope, error: null };
  }

  const code = envelope.codigo_erro != null ? String(envelope.codigo_erro) : null;
  const kind = (code != null ? TINY_ERROR_KIND[code] : undefined) ?? 'VALIDATION';

  return {
    ok: false,
    retorno: envelope,
    error: new IntegrationError({
      kind,
      message: extractTinyErrorMessage(envelope.erros),
      providerCode: code,
      // Tiny does not send Retry-After; the engine's backoff handles the wait.
      retryAfterMs: null,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────────────────────────────────────

/** Tiny pages with `pagina` (1-based) and reports `numero_paginas`.
 *
 *  When `numero_paginas` is missing, `hasNext` falls back to "the page came back
 *  full" — inferring the end from an empty page instead, which is the safe read:
 *  it stops one page late rather than truncating. */
export function tinyPageInfo(
  retorno: TinyEnvelope,
  currentPage: number,
  limit: number,
  receivedCount: number
): PageInfo {
  const totalPages = Number(retorno.numero_paginas ?? Number.NaN);

  const hasNext = Number.isFinite(totalPages) && totalPages > 0
    ? currentPage < totalPages
    : receivedCount > 0;

  return {
    strategy: 'page',
    hasNext,
    nextPage: hasNext ? currentPage + 1 : null,
    limit,
    total: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Record extraction
// ─────────────────────────────────────────────────────────────────────────────

/** Tiny wraps every list item in a single-key object: `produtos: [{produto: {...}}]`.
 *  Unwrapping here keeps that quirk out of the field maps. */
export function unwrapTinyList(retorno: TinyEnvelope, listKey: string, itemKey: string): unknown[] {
  const list = retorno[listKey];
  if (!Array.isArray(list)) return [];

  return list
    .map(entry => {
      if (entry != null && typeof entry === 'object' && itemKey in (entry as Record<string, unknown>)) {
        return (entry as Record<string, unknown>)[itemKey];
      }
      // Already unwrapped — tolerated rather than dropped, since the shape has
      // varied between endpoints.
      return entry;
    })
    .filter(item => item != null && typeof item === 'object');
}

/** Flatten one product's deposit list into per-deposit stock rows.
 *
 *  Tiny returns `retorno.produto.depositos: [{deposito: {nome, saldo, empenho, desconsiderar}}]`.
 *  `desconsiderar: "S"` means the deposit is excluded from the sellable balance,
 *  so it is skipped — including it would overstate stock, which is the direction
 *  of error that causes overselling.
 *
 *  There is no deposit id in v2, only `nome`. The name is therefore used as the
 *  external warehouse id, which is why it must not be treated as a display-only
 *  field. VERIFY whether the current API exposes a stable id.
 */
export function extractTinyStockRows(
  retorno: TinyEnvelope,
  productExternalId: string
): Record<string, unknown>[] {
  const produto = retorno.produto;
  if (produto == null || typeof produto !== 'object') return [];

  const depositos = (produto as Record<string, unknown>).depositos;
  if (!Array.isArray(depositos)) {
    // Some responses carry only a flat `saldo`. Emitting a single unnamed deposit
    // keeps the aggregation path identical rather than special-casing upstream.
    const saldo = (produto as Record<string, unknown>).saldo;
    if (saldo == null) return [];
    return [{ produto_id: productExternalId, deposito: '', saldo, empenho: null }];
  }

  const rows: Record<string, unknown>[] = [];

  for (const entry of depositos) {
    const source =
      entry != null && typeof entry === 'object' && 'deposito' in (entry as Record<string, unknown>)
        ? (entry as Record<string, unknown>).deposito
        : entry;

    if (source == null || typeof source !== 'object') continue;

    const deposito = source as Record<string, unknown>;
    if (String(deposito.desconsiderar ?? '').trim().toUpperCase() === 'S') continue;

    rows.push({
      produto_id: productExternalId,
      deposito: deposito.nome ?? '',
      deposito_nome: deposito.nome ?? null,
      saldo: deposito.saldo ?? 0,
      empenho: deposito.empenho ?? null,
    });
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field maps — the only provider-specific vocabulary the Core ever sees
// ─────────────────────────────────────────────────────────────────────────────

export const TINY_PRODUCT_FIELD_MAP: ProductFieldMap = {
  externalId: ['id'],
  sku: ['codigo'],
  ean: ['gtin', 'ean'],
  name: ['nome', 'descricao'],
  unitPrice: ['preco', 'preco_custo'],
  // Reads the translated key from prepareTinyProduct, not `situacao` directly.
  active: ['ativo'],
  category: ['categoria'],
  brand: ['marca'],
};

/** Translate Tiny's `situacao` letter codes before the generic normalizer sees
 *  the record.
 *
 *  Tiny writes 'A' for Ativo and 'I' for Inativo. The generic readBoolean does
 *  not accept single letters on purpose: 'A' and 'I' are Tiny vocabulary, and
 *  teaching the shared reader to guess at them would make it guess wrong for the
 *  next provider that uses those letters for something else. Provider dialect
 *  gets translated in the provider's own file — that is what this layer is for. */
export function prepareTinyProduct(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return raw;

  const record = raw as Record<string, unknown>;
  const situacao = String(record.situacao ?? '').trim().toUpperCase();

  // Anything unrecognised stays undefined rather than defaulting to active: a
  // product wrongly marked active is one that keeps being counted and sold.
  const ativo = situacao === 'A' ? true : situacao === 'I' ? false : undefined;

  return ativo === undefined ? record : { ...record, ativo };
}

/** Reads the rows produced by extractTinyStockRows.
 *
 *  `empenho` is Tiny's word for committed/reserved stock, which is why it maps to
 *  `reserved` — the engine then derives `available` as saldo - empenho. */
export const TINY_STOCK_FIELD_MAP: StockFieldMap = {
  productExternalId: ['produto_id'],
  warehouseExternalId: ['deposito'],
  warehouseName: ['deposito_nome'],
  quantity: ['saldo'],
  reserved: ['empenho'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Stock write payload
// ─────────────────────────────────────────────────────────────────────────────

/** Tiny's movement type for each of our write shapes.
 *
 *  'B' (balanço) sets the balance; 'E'/'S' add or remove. Mapping our absolute
 *  write to 'B' and our delta to 'E'/'S' by sign is the whole absolute-vs-delta
 *  contract landing on the wire — and the reason a count can reach Tiny as a
 *  movement that preserves history rather than as an overwrite. */
/** Tiny movement types.
 *
 *  'DV' is devolução, a distinct type rather than a plain entrada: Tiny records it
 *  as a return, and using 'E' instead would put the units back on the balance while
 *  losing the reason — which is precisely the field an accountant looks for when
 *  reconciling returns. */
export type TinyMovementType = 'B' | 'E' | 'S' | 'DV';

export function tinyMovementType(
  write: { kind: string; deltaQuantity?: number },
  /** When the caller knows the business reason, it wins: a return is 'DV' even
   *  though it is mechanically a positive delta. */
  isReturn = false
): TinyMovementType {
  if (write.kind === 'absolute') return 'B';
  if (write.kind === 'delta') {
    const delta = write.deltaQuantity ?? 0;
    if (delta >= 0) return isReturn ? 'DV' : 'E';
    return 'S';
  }
  // Transfers are decomposed by buildTinyTransferLegs and never reach here; typed
  // movement documents are not a declared capability. Defaulting to entrada would
  // silently invent stock, so balanço is the safest fallback.
  return 'B';
}

export interface TinyStockPayload {
  sequencia: number;
  /** Tiny identifies the product by its own id, not by SKU, whenever we have it. */
  id_produto?: string;
  codigo?: string;
  deposito?: string;
  tipo: TinyMovementType;
  quantidade: number;
  observacoes?: string;
  data?: string;
}

/** Build one stock-update entry.
 *
 *  VERIFY the wrapper this goes into (`estoque` param, JSON vs XML) against the
 *  current docs. The per-item fields below are the stable part.
 *
 *  Quantity is always sent positive: direction is carried by `tipo`, and sending
 *  a negative quantity alongside tipo 'S' would double the sign and remove twice
 *  what was intended. */
/** Decompose a transfer into the two movements Tiny v2 actually accepts.
 *
 *  VERIFY whether the current API exposes an atomic transfer; if it does, prefer
 *  it and delete this. Until then a transfer is a saída plus an entrada, and the
 *  ORDER is a safety decision, not a style one:
 *
 *    1. saída from the source deposit   (Full)
 *    2. entrada into the destination    (geral)
 *
 *  If the second leg fails, the goods are briefly missing from both deposits —
 *  total stock is UNDERSTATED. The reverse order would leave them counted twice —
 *  OVERSTATED — and an overstated balance is what makes a marketplace accept
 *  orders that cannot be fulfilled. Understating costs a lost sale; overstating
 *  costs cancellations, and the customer has been explicit that the second is the
 *  one to avoid.
 *
 *  The caller must treat a half-applied transfer as a failure and surface it: both
 *  legs carry the same `transferKey` so an incomplete pair is detectable rather
 *  than invisible. */
export function buildTinyTransferLegs(write: {
  productExternalId: string;
  fromLocationExternalId: string;
  toLocationExternalId: string;
  quantity: number;
  idempotencyKey: string;
  reason?: string | null;
}): { legs: TinyStockPayload[]; transferKey: string } {
  const quantidade = Math.abs(write.quantity);
  const note = write.reason ?? 'Transferência entre depósitos';

  return {
    transferKey: write.idempotencyKey,
    legs: [
      {
        sequencia: 1,
        id_produto: write.productExternalId,
        deposito: write.fromLocationExternalId,
        tipo: 'S',
        quantidade,
        observacoes: `${note} (saída ${write.fromLocationExternalId})`,
      },
      {
        sequencia: 2,
        id_produto: write.productExternalId,
        deposito: write.toLocationExternalId,
        tipo: 'E',
        quantidade,
        observacoes: `${note} (entrada ${write.toLocationExternalId})`,
      },
    ],
  };
}

export function buildTinyStockPayload(
  write: {
    kind: string;
    productExternalId: string;
    locationExternalId?: string | null;
    targetQuantity?: number;
    deltaQuantity?: number;
    reason?: string | null;
  },
  sequencia = 1,
  /** Set for a customer return so the movement is recorded as 'DV'. */
  isReturn = false
): TinyStockPayload {
  const tipo = tinyMovementType(write, isReturn);
  const quantidade =
    write.kind === 'absolute'
      ? (write.targetQuantity ?? 0)
      : Math.abs(write.deltaQuantity ?? 0);

  return {
    sequencia,
    id_produto: write.productExternalId,
    deposito: write.locationExternalId ?? undefined,
    tipo,
    quantidade,
    observacoes: write.reason ?? undefined,
  };
}
