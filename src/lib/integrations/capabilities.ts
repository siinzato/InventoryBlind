// Integration Engine — capability declaration and gating.
//
// A capability is the answer to "can this provider actually do this", and it is
// checked before a request is made, never discovered by failing one. Two things
// must agree before any operation runs: the provider declares the capability,
// and the connection is configured to allow that direction.
//
// Naming note: the wire format is snake_case because migration 042 already
// seeded `integration_providers.capabilities` that way and the column is the
// source of truth. The UPPER_CASE constants below are the names the rest of the
// codebase uses, so a typo is a compile error instead of a silently-false flag —
// `capabilities.read_prodcuts` reads as `undefined` and would quietly disable a
// feature, which is exactly the failure mode this indirection removes.

import type { ProviderCapabilities, SyncDirection } from './types.ts';

export const Capability = {
  READ_PRODUCTS: 'read_products',
  READ_STOCK: 'read_stock',
  READ_STOCK_BY_LOCATION: 'read_stock_by_warehouse',
  READ_RESERVED_STOCK: 'read_reserved_stock',
  READ_LOCATIONS: 'read_locations',
  READ_BRANDS: 'read_brands',
  READ_CATEGORIES: 'read_categories',
  READ_MOVEMENTS: 'read_movements',
  ORDERS: 'read_orders',
  WRITE_STOCK: 'write_stock',
  STOCK_ADJUSTMENT: 'write_adjustment',
  STOCK_TRANSFER: 'write_transfer',
  WRITE_MOVEMENT: 'write_movement',
  WEBHOOKS: 'webhooks',
  MULTI_STORE: 'multi_store',
} as const;

export type CapabilityKey = (typeof Capability)[keyof typeof Capability];

/** Which capability each connector operation requires. The adapter consults this
 *  instead of every call site remembering the pairing — one table, one place to
 *  get it wrong. */
export const OPERATION_CAPABILITY = {
  authenticate: null,
  testConnection: null,
  getProducts: Capability.READ_PRODUCTS,
  getProduct: Capability.READ_PRODUCTS,
  getStock: Capability.READ_STOCK,
  getStockByLocation: Capability.READ_STOCK_BY_LOCATION,
  getLocations: Capability.READ_LOCATIONS,
  getBrands: Capability.READ_BRANDS,
  getCategories: Capability.READ_CATEGORIES,
  getOrders: Capability.ORDERS,
  getMovements: Capability.READ_MOVEMENTS,
  updateStock: Capability.WRITE_STOCK,
  createStockAdjustment: Capability.STOCK_ADJUSTMENT,
  createStockTransfer: Capability.STOCK_TRANSFER,
  createMovement: Capability.WRITE_MOVEMENT,
  createWebhook: Capability.WEBHOOKS,
  removeWebhook: Capability.WEBHOOKS,
} as const;

export type OperationName = keyof typeof OPERATION_CAPABILITY;

/** Reads as false for an absent key, which is the safe default: an undeclared
 *  capability is treated as unsupported rather than assumed. */
export function hasCapability(capabilities: ProviderCapabilities, key: CapabilityKey): boolean {
  return capabilities[key] === true;
}

/** Every capability the provider declares, for display and for logging what a
 *  connection is actually allowed to do. */
export function declaredCapabilities(capabilities: ProviderCapabilities): CapabilityKey[] {
  return Object.values(Capability).filter(key => hasCapability(capabilities, key));
}

/** Does an operation write to the provider? Drives the direction gate below, and
 *  keeps "which of these is a mutation" out of every call site. */
export function isWriteOperation(operation: OperationName): boolean {
  return (
    operation === 'updateStock' ||
    operation === 'createStockAdjustment' ||
    operation === 'createStockTransfer' ||
    operation === 'createMovement' ||
    operation === 'createWebhook' ||
    operation === 'removeWebhook'
  );
}

export type OperationGate =
  | { allowed: true }
  | { allowed: false; reason: 'capability'; missing: CapabilityKey }
  | { allowed: false; reason: 'direction'; direction: SyncDirection };

/** The single gate every operation passes through.
 *
 *  Order matters: capability first, because "this provider cannot do it" is a
 *  permanent fact worth reporting precisely, while "this connection is not
 *  configured for it" is a setting the customer can change.
 *
 *  Reads are never blocked by an `outbound` connection — pulling a catalogue to
 *  resolve mappings is a prerequisite for pushing anything, so a write-only
 *  connection still has to be able to look. Only writes are gated on direction. */
export function checkOperation(
  operation: OperationName,
  capabilities: ProviderCapabilities,
  direction: SyncDirection
): OperationGate {
  const required = OPERATION_CAPABILITY[operation];

  if (required !== null && !hasCapability(capabilities, required)) {
    return { allowed: false, reason: 'capability', missing: required };
  }

  if (isWriteOperation(operation) && direction === 'inbound') {
    return { allowed: false, reason: 'direction', direction };
  }

  return { allowed: true };
}
