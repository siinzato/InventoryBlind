// Integration Engine — normalizers.
//
// Raw provider payload -> normalised model. This is the wall: above it, nothing
// knows what a provider called its fields; below it, nothing knows what
// InventoryBlind is.
//
// Every normalizer validates rather than casts. A provider payload is untrusted
// input — fields go missing during their outages, numbers arrive as strings,
// deleted records come back as nulls. A normalizer that trusts the shape turns a
// provider hiccup into corrupted inventory data, so each one returns an outcome
// the caller must handle instead of throwing or coercing silently.
//
// Pure module: no I/O, no dates from the clock, fully testable.

import { IntegrationError } from './errors.ts';
import { normalizeEan, normalizeSku } from './matching.ts';
import type {
  NormalizedLocation,
  NormalizedOrder,
  NormalizedProduct,
  NormalizedStockLevel,
  NormalizedWarehouse,
} from './types.ts';

export type NormalizeOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: IntegrationError; externalId: string | null };

function reject<T>(message: string, externalId: string | null, details?: Record<string, unknown>): NormalizeOutcome<T> {
  return {
    ok: false,
    externalId,
    error: new IntegrationError({
      kind: 'NORMALIZATION_FAILED',
      message,
      details: details ?? null,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Field readers
//
// Providers are inconsistent in ways that are boring and constant: ids as
// numbers, quantities as strings with commas, booleans as "S"/"N". These absorb
// that so each normalizer reads like a mapping instead of a parser.
// ─────────────────────────────────────────────────────────────────────────────

export function asRecord(payload: unknown): Record<string, unknown> | null {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

/** Trimmed non-empty string, or null. Numbers are accepted because ids and SKUs
 *  routinely arrive numeric from ERPs with typed JSON. */
export function readString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** How a provider writes decimals, when the connector knows.
 *
 *  `auto` guesses (see below). Declaring the real convention removes the guess
 *  entirely and is strongly preferred for any provider whose docs state it —
 *  guessing wrong on a quantity is a 10x or 1000x error in a customer's stock,
 *  and it does not throw. */
export type NumberFormat = 'auto' | 'dot-decimal' | 'comma-decimal';

/** Numeric reader that survives `"1.234,56"`, `"1,234.56"`, `"1.5"` and `"40"`.
 *
 *  When both separators are present there is no ambiguity: the last one is the
 *  decimal separator, so `1.234,56` and `1,234.56` both read as 1234.56.
 *
 *  A lone separator is the hard case, and neither blanket rule is safe: reading
 *  every dot as a decimal turns the pt-BR `1.234` into 1.234, while reading every
 *  dot as thousands turns `1.5` into 15. `auto` therefore uses the group-size
 *  rule every locale-tolerant parser uses — a separator followed by exactly three
 *  digits is a thousands separator, anything else is a decimal point:
 *
 *      "1.234"   -> 1234     (group of 3)
 *      "1.5"     -> 1.5      (group of 1)
 *      "1.23"    -> 1.23     (group of 2)
 *      "1.2345"  -> 1.2345   (group of 4)
 *
 *  One residual ambiguity survives and is worth knowing about: `12.345` could be
 *  twelve thousand or twelve-point-three-four-five. `auto` resolves it as
 *  thousands, because thousands separators are far more common than three-decimal
 *  quantities in ERP exports. A provider that really does send three decimal
 *  places must declare `dot-decimal`, or send JSON numbers instead of strings. */
export function readNumber(
  source: Record<string, unknown>,
  ...keys: string[]
): number | null {
  return readNumberWithFormat(source, 'auto', keys);
}

/** Same reader with an explicit convention. Kept as a separate entry point so the
 *  common call stays short while a connector that knows its provider can be
 *  exact. */
export function readNumberAs(
  source: Record<string, unknown>,
  format: NumberFormat,
  ...keys: string[]
): number | null {
  return readNumberWithFormat(source, format, keys);
}

function parseNumericString(raw: string, format: NumberFormat): number | null {
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  let candidate: string;

  if (lastComma === -1 && lastDot === -1) {
    candidate = raw;
  } else if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the later one is the decimal separator, whichever it is.
    candidate =
      lastComma > lastDot
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(/,/g, '');
  } else {
    const separator = lastComma !== -1 ? ',' : '.';
    const position = lastComma !== -1 ? lastComma : lastDot;
    const groupAfter = raw.slice(position + 1);

    const treatAsThousands =
      format === 'auto'
        ? /^\d{3}$/.test(groupAfter)
        : format === 'dot-decimal'
          ? separator === ','
          : separator === '.';

    candidate = treatAsThousands
      ? raw.split(separator).join('')
      : `${raw.slice(0, position)}.${groupAfter}`;
  }

  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function readNumberWithFormat(
  source: Record<string, unknown>,
  format: NumberFormat,
  keys: string[]
): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number') {
      if (Number.isFinite(value)) return value;
      continue;
    }
    if (typeof value !== 'string') continue;

    const raw = value.trim();
    if (raw.length === 0) continue;

    const parsed = parseNumericString(raw, format);
    if (parsed !== null) return parsed;
  }
  return null;
}

/** Booleans arrive as booleans, as 0/1, and as provider-specific letters. */
export function readBoolean(source: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 's', 'sim', 'yes', 'y', 'ativo', 'active'].includes(normalized)) return true;
      if (['false', '0', 'n', 'nao', 'não', 'no', 'inativo', 'inactive'].includes(normalized)) return false;
    }
  }
  return null;
}

/** ISO-8601 output, or null. An unparseable date is dropped rather than replaced
 *  with "now": a fabricated timestamp on a stock observation makes a stale balance
 *  look fresh, which is worse than having no timestamp. */
export function readIsoDate(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const parsed = new Date(value).getTime();
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field maps
//
// A connector supplies one of these instead of a whole normalizer: the mapping
// is the only provider-specific part, and keeping it declarative means a new
// provider is a config object rather than another parser to review.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductFieldMap {
  externalId: string[];
  sku?: string[];
  ean?: string[];
  name?: string[];
  code?: string[];
  brand?: string[];
  category?: string[];
  unitPrice?: string[];
  active?: string[];
  parentExternalId?: string[];
}

export interface StockFieldMap {
  productExternalId: string[];
  warehouseExternalId?: string[];
  warehouseName?: string[];
  quantity: string[];
  reserved?: string[];
  available?: string[];
  observedAt?: string[];
}

export interface LocationFieldMap {
  externalId: string[];
  name?: string[];
  code?: string[];
  warehouseExternalId?: string[];
  isDefault?: string[];
}

export interface OrderFieldMap {
  externalId: string[];
  code?: string[];
  status?: string[];
  placedAt?: string[];
  items: string[];
  itemProductExternalId: string[];
  itemSku?: string[];
  itemQuantity: string[];
  itemUnitPrice?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalizers
// ─────────────────────────────────────────────────────────────────────────────

/** ExternalProduct -> NormalizedProduct.
 *
 *  Only `externalId` is mandatory: it is the idempotency anchor, and a record
 *  without one cannot be linked, deduplicated or re-synced. Everything else is
 *  allowed to be absent — a product with no EAN is normal, a product with no
 *  stable id is unusable. */
export function normalizeProduct(
  payload: unknown,
  map: ProductFieldMap
): NormalizeOutcome<NormalizedProduct> {
  const source = asRecord(payload);
  if (source == null) return reject('Payload de produto não é um objeto.', null);

  const externalId = readString(source, ...map.externalId);
  if (externalId == null) {
    return reject('Produto sem identificador externo estável.', null, { expectedKeys: map.externalId });
  }

  const price = map.unitPrice ? readNumber(source, ...map.unitPrice) : null;

  return {
    ok: true,
    value: {
      externalId,
      sku: map.sku ? readString(source, ...map.sku) : null,
      ean: map.ean ? normalizeEan(readString(source, ...map.ean)) : null,
      code: map.code ? readString(source, ...map.code) : null,
      name: map.name ? readString(source, ...map.name) : null,
      parentExternalId: map.parentExternalId ? readString(source, ...map.parentExternalId) : null,
      brand: map.brand ? readString(source, ...map.brand) : null,
      category: map.category ? readString(source, ...map.category) : null,
      // A negative price is a provider bug, not a discount — drop it rather than
      // propagate a value that would corrupt a valuation report.
      unitPrice: price != null && price >= 0 ? price : null,
      active: map.active ? readBoolean(source, ...map.active) : null,
      raw: payload,
    },
  };
}

/** ExternalStock -> NormalizedStockLevel.
 *
 *  `quantity` is mandatory and must be a real number: a stock record whose
 *  quantity failed to parse is the single most dangerous thing to guess at, since
 *  defaulting to 0 reads as "we have none of this" and can drive a purchase.
 *
 *  `reserved`/`available` stay null when absent — most ERPs expose neither, and 0
 *  would assert something false. */
export function normalizeStockLevel(
  payload: unknown,
  map: StockFieldMap,
  fallbackObservedAt: string
): NormalizeOutcome<NormalizedStockLevel> {
  const source = asRecord(payload);
  if (source == null) return reject('Payload de estoque não é um objeto.', null);

  const productExternalId = readString(source, ...map.productExternalId);
  if (productExternalId == null) {
    return reject('Saldo sem identificador de produto.', null, { expectedKeys: map.productExternalId });
  }

  const quantity = readNumber(source, ...map.quantity);
  if (quantity == null) {
    return reject('Saldo sem quantidade legível.', productExternalId, { expectedKeys: map.quantity });
  }

  const reserved = map.reserved ? readNumber(source, ...map.reserved) : null;
  const available = map.available ? readNumber(source, ...map.available) : null;

  return {
    ok: true,
    value: {
      productExternalId,
      warehouseExternalId: map.warehouseExternalId
        ? readString(source, ...map.warehouseExternalId)
        : null,
      warehouseName: map.warehouseName ? readString(source, ...map.warehouseName) : null,
      quantity,
      reserved,
      // Derived only when the provider gave neither: available = on hand minus
      // reserved. Never invented when reserved is unknown.
      available: available ?? (reserved != null ? quantity - reserved : null),
      observedAt: (map.observedAt ? readIsoDate(source, ...map.observedAt) : null) ?? fallbackObservedAt,
      raw: payload,
    },
  };
}

/** ExternalLocation -> NormalizedWarehouse. A warehouse is a top-level deposit. */
export function normalizeWarehouse(
  payload: unknown,
  map: LocationFieldMap
): NormalizeOutcome<NormalizedWarehouse> {
  const source = asRecord(payload);
  if (source == null) return reject('Payload de depósito não é um objeto.', null);

  const externalId = readString(source, ...map.externalId);
  if (externalId == null) return reject('Depósito sem identificador externo.', null);

  return {
    ok: true,
    value: {
      externalId,
      name: map.name ? readString(source, ...map.name) : null,
      code: map.code ? readString(source, ...map.code) : null,
      isDefault: map.isDefault ? readBoolean(source, ...map.isDefault) : null,
      raw: payload,
    },
  };
}

/** ExternalLocation -> NormalizedLocation. A location sits inside a warehouse
 *  (a street/shelf/bin), which is why it carries `warehouseExternalId`. */
export function normalizeLocation(
  payload: unknown,
  map: LocationFieldMap
): NormalizeOutcome<NormalizedLocation> {
  const source = asRecord(payload);
  if (source == null) return reject('Payload de endereço não é um objeto.', null);

  const externalId = readString(source, ...map.externalId);
  if (externalId == null) return reject('Endereço sem identificador externo.', null);

  return {
    ok: true,
    value: {
      externalId,
      name: map.name ? readString(source, ...map.name) : null,
      code: map.code ? readString(source, ...map.code) : null,
      warehouseExternalId: map.warehouseExternalId
        ? readString(source, ...map.warehouseExternalId)
        : null,
      raw: payload,
    },
  };
}

/** ExternalOrder -> NormalizedOrder.
 *
 *  An order with zero readable items is rejected: it would count as processed
 *  while carrying no information, which quietly inflates a sync run's success
 *  counter. Individual unreadable items are dropped, and dropping all of them
 *  fails the order. */
export function normalizeOrder(
  payload: unknown,
  map: OrderFieldMap
): NormalizeOutcome<NormalizedOrder> {
  const source = asRecord(payload);
  if (source == null) return reject('Payload de pedido não é um objeto.', null);

  const externalId = readString(source, ...map.externalId);
  if (externalId == null) return reject('Pedido sem identificador externo.', null);

  const rawItems = map.items.map(key => source[key]).find(Array.isArray) as unknown[] | undefined;
  if (rawItems == null) {
    return reject('Pedido sem lista de itens.', externalId, { expectedKeys: map.items });
  }

  const items = rawItems
    .map(item => {
      const itemSource = asRecord(item);
      if (itemSource == null) return null;
      const productExternalId = readString(itemSource, ...map.itemProductExternalId);
      const quantity = readNumber(itemSource, ...map.itemQuantity);
      if (productExternalId == null || quantity == null) return null;
      return {
        productExternalId,
        sku: map.itemSku ? normalizeSku(readString(itemSource, ...map.itemSku)) : null,
        quantity,
        unitPrice: map.itemUnitPrice ? readNumber(itemSource, ...map.itemUnitPrice) : null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (items.length === 0) {
    return reject('Pedido sem nenhum item legível.', externalId);
  }

  return {
    ok: true,
    value: {
      externalId,
      code: map.code ? readString(source, ...map.code) : null,
      status: map.status ? readString(source, ...map.status) : null,
      placedAt: map.placedAt ? readIsoDate(source, ...map.placedAt) : null,
      items,
      raw: payload,
    },
  };
}

/** Normalise a batch, keeping successes and failures side by side.
 *
 *  One bad record must not abort a 5.000-record page: the good ones are imported
 *  and the failures land in the run's `failed` counter, which is what makes a
 *  `partial` outcome meaningful. */
export function normalizeBatch<T>(
  payloads: unknown[],
  normalize: (payload: unknown) => NormalizeOutcome<T>
): { values: T[]; failures: { externalId: string | null; error: IntegrationError }[] } {
  const values: T[] = [];
  const failures: { externalId: string | null; error: IntegrationError }[] = [];

  for (const payload of payloads) {
    const outcome = normalize(payload);
    if (outcome.ok) values.push(outcome.value);
    else failures.push({ externalId: outcome.externalId, error: outcome.error });
  }

  return { values, failures };
}
