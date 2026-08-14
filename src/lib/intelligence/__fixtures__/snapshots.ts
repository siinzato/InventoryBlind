// Snapshot fixtures — TESTS ONLY.
//
// ── Why this cannot leak into production ────────────────────────────────────
// Three independent reasons, in order of how much they are worth:
//
//   1. Nothing outside `__tests__` imports it, and that is ENFORCED by a test
//      (isolation.test.ts) that scans the source tree and fails if any
//      non-test file gains an import edge to this folder. Vite bundles from the
//      entry graph, so with no edge there is no way in — and the check means the
//      absence of that edge is verified rather than assumed.
//   2. The Dashboard reaches data through intelligenceService.loadIntelligence,
//      which returns only what the RPC returned. There is no parameter, flag or
//      branch that swaps in a fixture.
//   3. Every fixture is a `RawSnapshot` — the wire shape, not display data. Even
//      if one were somehow rendered it would have to pass the analytics engine's
//      availability gates, which are the only way a number becomes displayable.
//
// Note what is deliberately NOT relied on: there is no tsconfig `exclude` for
// `__tests__` or `__fixtures__` in this project (tsconfig.app.json includes all of
// `src`), so claiming compiler exclusion would be false. An environment flag would
// be weaker still — a flag can be set wrong, while a missing import edge that a
// test asserts cannot silently appear.
//
// ── What these are for ─────────────────────────────────────────────────────
// Reproducing states that are hard to produce on a real ERP: five negative SKUs,
// a two-hour-old sync, a provider without deposits, two connections disagreeing.
// The numbers are deliberately memorable (5 / 342 / 23 / 41) so a failing test
// message points at the scenario without a lookup.

import type { RawConnection, RawSnapshot } from '../contracts';

/** A Tiny-like provider: products, stock, per-deposit, reserved. No orders, no
 *  movements, no webhooks — matching TINY_CAPABILITIES. */
export const FULL_CAPABILITIES: Record<string, boolean> = {
  read_products: true,
  read_stock: true,
  read_stock_by_warehouse: true,
  read_reserved_stock: true,
  write_stock: true,
  write_adjustment: true,
};

/** A provider that reports one total per SKU and nothing else. Exists to prove
 *  deposit metrics disappear rather than reading zero. */
export const TOTAL_ONLY_CAPABILITIES: Record<string, boolean> = {
  read_products: true,
  read_stock: true,
};

/** A provider that also exposes orders. Used to prove that a capability alone does
 *  not make a metric available when InventoryBlind has nowhere to store the data —
 *  the reason has to become `not_stored`, not `capability_missing`. */
export const WITH_ORDERS_CAPABILITIES: Record<string, boolean> = {
  ...FULL_CAPABILITIES,
  read_orders: true,
  read_movements: true,
};

export function connection(overrides: Partial<RawConnection> = {}): RawConnection {
  return {
    id: 'conn-1',
    provider_key: 'tiny',
    display_name: 'Tiny ERP',
    status: 'active',
    sync_direction: 'inbound',
    auto_sync_enabled: true,
    sync_interval_minutes: 15,
    credentials_set_at: '2026-08-01T00:00:00.000Z',
    last_sync_at: '2026-08-15T11:55:00.000Z',
    last_successful_sync_at: '2026-08-15T11:55:00.000Z',
    last_error: null,
    last_error_at: null,
    capabilities: FULL_CAPABILITIES,
    ...overrides,
  };
}

/** The reference "now" every fixture is written against. Exported so tests do not
 *  each pick their own and drift into testing the clock. */
export const NOW = Date.parse('2026-08-15T12:00:00.000Z');

/** A healthy integration: nothing negative, nothing stale, catalogue complete. */
export function healthySnapshot(overrides: Partial<RawSnapshot> = {}): RawSnapshot {
  return {
    company_scoped: true,
    connection_found: true,
    generated_at: '2026-08-15T12:00:00.000Z',
    connections: [connection()],
    catalog: {
      linked_products: 8724,
      without_ean: 0,
      without_sku: 0,
      auto_matched: 120,
      last_linked_at: '2026-08-15T11:55:00.000Z',
    },
    stock: {
      products_with_stock_rows: 8724,
      negative_products: 0,
      zero_products: 342,
      positive_products: 8382,
      products_with_negative_warehouse: 0,
      products_without_warehouse: 0,
      total_units: 154_320,
      total_reserved: 1_204,
      oldest_observed_at: '2026-08-15T11:50:00.000Z',
      newest_observed_at: '2026-08-15T11:55:00.000Z',
    },
    warehouses: { named_count: 9 },
    discrepancies: { open: 0, resolved: 41, oldest_open_at: null, newest_open_at: null },
    sync: {
      total_runs: 96,
      pending: 0,
      running: 0,
      failed_recent: 0,
      partial_recent: 0,
      succeeded_recent: 12,
      last_run_at: '2026-08-15T11:55:00.000Z',
      last_success_at: '2026-08-15T11:55:00.000Z',
      last_duration_ms: 8_400,
      last_records_total: 8724,
    },
    adjustments: {
      pending: 0,
      sent: 0,
      confirmed: 210,
      failed: 0,
      awaiting_approval: 0,
      oldest_pending_at: null,
    },
    alerts: { open: 0, critical: 0, warning: 0 },
    ...overrides,
  };
}

/** The scenario the brief describes: 5 negative, 342 zero, 23 discrepancies, 41
 *  without EAN. */
export function troubledSnapshot(overrides: Partial<RawSnapshot> = {}): RawSnapshot {
  const base = healthySnapshot();
  return {
    ...base,
    catalog: { ...base.catalog!, without_ean: 41 },
    stock: {
      ...base.stock!,
      negative_products: 5,
      zero_products: 342,
      positive_products: 8377,
      products_with_negative_warehouse: 12,
      products_without_warehouse: 126,
    },
    discrepancies: {
      open: 23,
      resolved: 41,
      oldest_open_at: '2026-08-14T09:00:00.000Z',
      newest_open_at: '2026-08-15T10:00:00.000Z',
    },
    ...overrides,
  };
}

/** No integration at all. The onboarding state. */
export function noConnectionSnapshot(): RawSnapshot {
  return { company_scoped: true, connection_found: true, connections: [], generated_at: '2026-08-15T12:00:00.000Z' };
}

/** A connection created but never authenticated. */
export function noCredentialSnapshot(): RawSnapshot {
  return {
    ...noConnectionSnapshot(),
    connections: [
      connection({
        status: 'pending',
        credentials_set_at: null,
        last_sync_at: null,
        last_successful_sync_at: null,
      }),
    ],
  };
}

/** Credentialed, never synced. Distinct from the above: the customer has finished
 *  setup and is waiting for the first run. */
export function neverSyncedSnapshot(): RawSnapshot {
  const base = healthySnapshot();
  return {
    ...base,
    connections: [connection({ last_sync_at: null, last_successful_sync_at: null })],
    catalog: { linked_products: 0, without_ean: 0, without_sku: 0, auto_matched: 0, last_linked_at: null },
    stock: {
      products_with_stock_rows: 0,
      negative_products: 0,
      zero_products: 0,
      positive_products: 0,
      products_with_negative_warehouse: 0,
      products_without_warehouse: 0,
      total_units: 0,
      total_reserved: 0,
      oldest_observed_at: null,
      newest_observed_at: null,
    },
    sync: {
      total_runs: 0,
      pending: 0,
      running: 0,
      failed_recent: 0,
      partial_recent: 0,
      succeeded_recent: 0,
      last_run_at: null,
      last_success_at: null,
      last_duration_ms: null,
      last_records_total: null,
    },
  };
}

/** Last successful read two hours ago, against a 15-minute interval. */
export function staleSnapshot(): RawSnapshot {
  const base = healthySnapshot();
  const twoHoursAgo = '2026-08-15T10:00:00.000Z';
  return {
    ...base,
    connections: [connection({ last_sync_at: twoHoursAgo, last_successful_sync_at: twoHoursAgo })],
    stock: { ...base.stock!, newest_observed_at: twoHoursAgo, oldest_observed_at: twoHoursAgo },
    sync: { ...base.sync!, last_run_at: twoHoursAgo, last_success_at: twoHoursAgo },
  };
}

/** Eight hours old — past the very-stale threshold. */
export function veryStaleSnapshot(): RawSnapshot {
  const base = healthySnapshot();
  const eightHoursAgo = '2026-08-15T04:00:00.000Z';
  return {
    ...base,
    connections: [connection({ last_sync_at: eightHoursAgo, last_successful_sync_at: eightHoursAgo })],
    stock: { ...base.stock!, newest_observed_at: eightHoursAgo, oldest_observed_at: eightHoursAgo },
    sync: { ...base.sync!, last_run_at: eightHoursAgo, last_success_at: eightHoursAgo },
  };
}

/** Sync failing right now. */
export function failingSyncSnapshot(): RawSnapshot {
  const base = healthySnapshot();
  return {
    ...base,
    connections: [
      connection({ status: 'error', last_error: 'Token inválido.', last_error_at: '2026-08-15T11:58:00.000Z' }),
    ],
    sync: { ...base.sync!, failed_recent: 3, succeeded_recent: 0 },
  };
}

/** A provider reporting one total per SKU. Deposit metrics must vanish. */
export function totalOnlySnapshot(): RawSnapshot {
  const base = troubledSnapshot();
  return {
    ...base,
    connections: [
      connection({ provider_key: 'generico', display_name: 'ERP genérico', capabilities: TOTAL_ONLY_CAPABILITIES }),
    ],
  };
}

/** Two connections, one healthy ERP and one marketplace with fewer capabilities.
 *  Exists to exercise the consolidated view and the connection filter. */
export function twoConnectionsSnapshot(): RawSnapshot {
  const base = troubledSnapshot();
  return {
    ...base,
    connections: [
      connection(),
      connection({
        id: 'conn-2',
        provider_key: 'mercado_livre',
        display_name: 'Mercado Livre',
        capabilities: TOTAL_ONLY_CAPABILITIES,
        sync_interval_minutes: 60,
      }),
    ],
  };
}

/** A provider that exposes orders and movements. Both metrics must still be
 *  unavailable, with `not_stored` rather than `capability_missing`. */
export function providerWithOrdersSnapshot(): RawSnapshot {
  const base = healthySnapshot();
  return {
    ...base,
    connections: [connection({ capabilities: WITH_ORDERS_CAPABILITIES })],
  };
}

/** Adjustments stuck: some waiting, some failed. */
export function stuckAdjustmentsSnapshot(): RawSnapshot {
  const base = healthySnapshot();
  return {
    ...base,
    adjustments: {
      pending: 7,
      sent: 2,
      confirmed: 210,
      failed: 3,
      awaiting_approval: 4,
      oldest_pending_at: '2026-08-14T08:00:00.000Z',
    },
  };
}
