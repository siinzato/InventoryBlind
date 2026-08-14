// Integration layer — normalised domain models.
//
// This file is the boundary. Everything above it (InventoryBlind Core) speaks
// only these shapes; everything below it (connectors) is responsible for
// translating a provider's payload into them. A Tiny field name, a Mercado Livre
// enum or a SAP code must never appear above this line — that is the whole point
// of the layer, and the reason a new provider is additive rather than invasive.
//
// Type-only module: zero imports, zero I/O, so it is safe under both the browser
// and Deno (Edge Functions), same constraint the pure algorithm files already
// follow for supabase/functions/blindai-agent.

// ─────────────────────────────────────────────────────────────────────────────
// Provider catalogue
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderKind = 'erp' | 'marketplace';

export type ProviderStatus = 'planned' | 'beta' | 'available' | 'deprecated';

/** What a provider can actually do. The UI reads this to decide which actions to
 *  offer, and the sync layer reads it to refuse an unsupported direction before
 *  making a request rather than after failing one. */
/** Wire format is snake_case because integration_providers.capabilities was
 *  seeded that way in migration 042 and the column is the source of truth. Code
 *  refers to these through the `Capability` constants in capabilities.ts, so a
 *  misspelling is a compile error rather than a silently-false flag. */
export interface ProviderCapabilities {
  read_products?: boolean;
  read_stock?: boolean;
  /** Per-warehouse balance, not just a single total. */
  read_stock_by_warehouse?: boolean;
  read_reserved_stock?: boolean;
  read_locations?: boolean;
  read_brands?: boolean;
  read_categories?: boolean;
  read_movements?: boolean;
  read_orders?: boolean;
  /** Overwrite a balance ("it is now 40"). Destructive: discards the provider's
   *  own movement history for that SKU. */
  write_stock?: boolean;
  /** Post a signed adjustment ("add/remove 40") rather than overwrite. */
  write_adjustment?: boolean;
  /** Atomic move between two locations. */
  write_transfer?: boolean;
  /** Typed movement document, for providers modelling stock as a ledger. */
  write_movement?: boolean;
  webhooks?: boolean;
  /** Provider supports several independent stores under one company. */
  multi_store?: boolean;
}

export interface IntegrationProvider {
  key: string;
  name: string;
  kind: ProviderKind;
  capabilities: ProviderCapabilities;
  status: ProviderStatus;
  docsUrl: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connections — a connection IS a store/account
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'pending' | 'active' | 'inactive' | 'error' | 'revoked';

/** Per connection, because the source of truth is not universal: one company's
 *  ERP owns stock and only pushes to marketplaces, another's marketplace is
 *  authoritative for its own listings. */
export type SyncDirection = 'inbound' | 'outbound' | 'bidirectional';

/** Never carries a secret. `credentialsSetAt`/`credentialHint` describe that a
 *  credential exists and roughly what it looks like — nothing more. The secret
 *  itself is unreachable from the client by construction (see migration 042). */
export interface IntegrationConnection {
  id: string;
  companyId: string;
  providerKey: string;
  displayName: string;
  externalAccountId: string | null;
  status: ConnectionStatus;
  configuration: Record<string, unknown>;
  syncDirection: SyncDirection;
  stockSourceOfTruth: boolean;
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number | null;
  syncCursor: string | null;
  credentialsSetAt: string | null;
  credentialHint: string | null;
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalised entities
//
// Naming follows the doc's ExternalX -> NormalizedX -> Core X chain. The
// Normalized* shapes below are the middle link: provider-agnostic, but not yet
// InventoryBlind rows (no internal ids, no company_id — the integration layer
// adds those when it persists).
// ─────────────────────────────────────────────────────────────────────────────

export type EntityType =
  | 'product'
  | 'variant'
  | 'location'
  | 'warehouse'
  | 'brand'
  | 'category'
  | 'order';

/** Every normalised entity carries the identifiers needed to match it, in
 *  priority order: a stable external id first, then SKU, then EAN. Names are
 *  captured for display and manual resolution, never used as a match key —
 *  provider display names change without notice. */
export interface NormalizedRef {
  /** Provider's stable identifier. Required: a connector that cannot produce one
   *  has nothing idempotent to key on. */
  externalId: string;
  sku?: string | null;
  ean?: string | null;
  /** Provider's own human code, when distinct from SKU. */
  code?: string | null;
  name?: string | null;
}

export interface NormalizedProduct extends NormalizedRef {
  /** Present when the provider models variants under a parent product. */
  parentExternalId?: string | null;
  brand?: string | null;
  category?: string | null;
  unitPrice?: number | null;
  active?: boolean | null;
  /** Untouched provider record, stored for debugging a bad mapping and for
   *  re-normalising without another API round trip. */
  raw?: unknown;
}

export interface NormalizedWarehouse extends NormalizedRef {
  /** Provider's notion of a default/primary deposit, when it has one. */
  isDefault?: boolean | null;
  raw?: unknown;
}

export interface NormalizedLocation extends NormalizedRef {
  warehouseExternalId?: string | null;
  raw?: unknown;
}

/** A balance for one product in one warehouse at one moment. `reserved` and
 *  `available` are optional and nullable on purpose: many ERPs expose neither,
 *  and defaulting them to 0 would assert something false. */
export interface NormalizedStockLevel {
  productExternalId: string;
  warehouseExternalId: string | null;
  warehouseName?: string | null;
  quantity: number;
  reserved?: number | null;
  available?: number | null;
  observedAt: string;
  raw?: unknown;
}

// Outbound stock changes live in stockOperations.ts as a discriminated union
// (AbsoluteStockWrite / DeltaStockWrite / TransferStockWrite / MovementStockWrite).
// They are deliberately not a single shape with a `mode` string: the field name
// itself has to make "the balance is now 40" impossible to read as "40 arrived",
// because that mistake writes a wrong balance to a customer's ERP without
// throwing anything.

export interface NormalizedOrderItem {
  productExternalId: string;
  sku?: string | null;
  quantity: number;
  unitPrice?: number | null;
}

export interface NormalizedOrder extends NormalizedRef {
  status?: string | null;
  placedAt?: string | null;
  items: NormalizedOrderItem[];
  raw?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping
// ─────────────────────────────────────────────────────────────────────────────

export type MatchSource = 'external_id' | 'sku' | 'ean' | 'manual' | 'created';

/** A resolved (or deliberately unresolved) link between a provider record and an
 *  InventoryBlind row. `internalId === null` is a valid, meaningful state: the
 *  provider has it, we have not linked it yet — which is exactly what an import
 *  review screen lists. */
export interface EntityLink {
  id: string;
  connectionId: string;
  entityType: EntityType;
  internalId: string | null;
  externalId: string;
  externalSku: string | null;
  externalEan: string | null;
  externalName: string | null;
  matchSource: MatchSource | null;
  lastSyncedAt: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync observability
// ─────────────────────────────────────────────────────────────────────────────

export type SyncFlow = 'inbound' | 'outbound';
export type SyncTrigger = 'manual' | 'schedule' | 'webhook' | 'system';
export type SyncStatus = 'running' | 'success' | 'partial' | 'failed' | 'cancelled';

export type SyncEntity = EntityType | 'stock' | 'adjustment';

export interface SyncCounters {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface SyncRun extends SyncCounters {
  id: string;
  connectionId: string;
  entityType: SyncEntity;
  direction: SyncFlow;
  triggerSource: SyncTrigger;
  status: SyncStatus;
  cursorBefore: string | null;
  cursorAfter: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

/** What a connector hands back from one pass. The integration layer turns this
 *  into an integration_sync_runs row; the connector never writes to the database
 *  itself, which keeps connectors pure and testable. */
export interface SyncResult<T> {
  items: T[];
  /** Opaque provider cursor to resume from. `null` means the pass reached the end. */
  cursorAfter: string | null;
  /** Per-record failures that did not abort the pass. Redacted by the connector
   *  before it gets here — never a token, never a raw authenticated request. */
  errors: SyncItemError[];
}

export interface SyncItemError {
  externalId: string | null;
  message: string;
  /** Whether retrying this same record could plausibly succeed (429/5xx yes,
   *  malformed record no). Drives retry policy instead of blind re-attempts. */
  retryable: boolean;
}
