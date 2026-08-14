// Integration Engine — stock operation taxonomy.
//
// The most dangerous ambiguity in any inventory integration is "quantity: 40".
// Does it mean the balance is now 40, or that 40 arrived? Getting it backwards
// does not throw — it silently writes a wrong balance to the customer's ERP and
// nobody notices until a count.
//
// So the two are different types with different field names. `targetQuantity` can
// only be read as an absolute; `deltaQuantity` can only be read as a change. No
// call site can pass one where the other is expected, and no reviewer has to
// remember which a `mode: 'set'` string meant.

/** Read-only lookups are operations too, and naming them keeps a sync run's
 *  `entity_type` honest about what it did. */
export type StockReadKind = 'current' | 'by_location' | 'movements';

export type StockWriteKind = 'absolute' | 'delta' | 'transfer' | 'movement';

interface StockWriteBase {
  productExternalId: string;
  /** Carried end to end. The same key must never post twice, which is what makes
   *  a retry safe against a provider that has no idempotency of its own. */
  idempotencyKey: string;
  /** Free-text reason recorded on the provider side when it supports one
   *  ("Contagem física #128"). Never a credential, never internal ids. */
  reason?: string | null;
}

/** "The balance IS this number." Overwrites whatever the provider held.
 *
 *  Destructive by nature: it discards the provider's own movement history for
 *  that SKU. Prefer a delta or a movement whenever the provider supports one —
 *  see `preferredWriteKind`. */
export interface AbsoluteStockWrite extends StockWriteBase {
  kind: 'absolute';
  locationExternalId: string | null;
  targetQuantity: number;
  /** Balance we believed the provider held when the decision was made. When the
   *  provider supports conditional writes this becomes an optimistic-locking
   *  check; otherwise it is recorded so a later audit can see what we assumed. */
  expectedCurrentQuantity?: number | null;
}

/** "Add this much" / "remove this much." Positive adds, negative removes. */
export interface DeltaStockWrite extends StockWriteBase {
  kind: 'delta';
  locationExternalId: string | null;
  deltaQuantity: number;
}

/** Move stock between two locations. Not two writes: providers that model
 *  transfers atomically must not receive a decrement and an increment that can
 *  half-apply. */
export interface TransferStockWrite extends StockWriteBase {
  kind: 'transfer';
  fromLocationExternalId: string;
  toLocationExternalId: string;
  quantity: number;
}

/** A typed movement document, for providers that model stock as a ledger rather
 *  than a mutable number. Richer than a delta because the movement type carries
 *  accounting meaning on their side. */
export interface MovementStockWrite extends StockWriteBase {
  kind: 'movement';
  locationExternalId: string | null;
  movementType: 'in' | 'out' | 'adjustment' | 'loss' | 'found';
  quantity: number;
  occurredAt?: string | null;
}

export type StockWrite =
  | AbsoluteStockWrite
  | DeltaStockWrite
  | TransferStockWrite
  | MovementStockWrite;

/** Signed effect on the balance, for previewing a batch before sending it and
 *  for reconciling afterwards.
 *
 *  Absolute writes return null rather than 0: their effect depends on the current
 *  balance, which this function does not know, and returning 0 would read as "no
 *  change" — the most misleading answer available. */
export function netEffect(write: StockWrite): number | null {
  switch (write.kind) {
    case 'absolute':
      return write.expectedCurrentQuantity != null
        ? write.targetQuantity - write.expectedCurrentQuantity
        : null;
    case 'delta':
      return write.deltaQuantity;
    case 'transfer':
      // Net zero across the company, which is exactly why a transfer is not two
      // independent adjustments.
      return 0;
    case 'movement':
      if (write.movementType === 'in' || write.movementType === 'found') return write.quantity;
      if (write.movementType === 'out' || write.movementType === 'loss') return -write.quantity;
      return null;
  }
}

/** Convert a counted result into the least destructive write the provider can
 *  accept.
 *
 *  Preference order is deliberate: a movement keeps the reason and the audit
 *  trail on the provider's side, a delta keeps the trail but loses the type, and
 *  an absolute overwrite loses both. A physical count should reach the ERP as a
 *  document, not as a silent overwrite, whenever the ERP allows it. */
export function preferredWriteKind(capabilities: {
  write_movement?: boolean;
  write_adjustment?: boolean;
  write_stock?: boolean;
}): StockWriteKind | null {
  if (capabilities.write_movement) return 'movement';
  if (capabilities.write_adjustment) return 'delta';
  if (capabilities.write_stock) return 'absolute';
  return null;
}

/** Build the write for a counted divergence, in whichever form the provider
 *  supports. Returns null when the provider cannot accept any write, so the
 *  caller reports "not supported" instead of constructing something that will be
 *  rejected. */
export function buildCountAdjustment(params: {
  productExternalId: string;
  locationExternalId: string | null;
  systemQuantity: number;
  countedQuantity: number;
  idempotencyKey: string;
  reason?: string | null;
  kind: StockWriteKind;
}): StockWrite | null {
  const delta = params.countedQuantity - params.systemQuantity;
  const base = {
    productExternalId: params.productExternalId,
    idempotencyKey: params.idempotencyKey,
    reason: params.reason ?? null,
  };

  switch (params.kind) {
    case 'movement':
      return {
        ...base,
        kind: 'movement',
        locationExternalId: params.locationExternalId,
        // A count produces a correction, not a receipt or a shipment, so the
        // movement type is 'adjustment' regardless of the sign.
        movementType: 'adjustment',
        quantity: Math.abs(delta),
      };
    case 'delta':
      return { ...base, kind: 'delta', locationExternalId: params.locationExternalId, deltaQuantity: delta };
    case 'absolute':
      return {
        ...base,
        kind: 'absolute',
        locationExternalId: params.locationExternalId,
        targetQuantity: params.countedQuantity,
        expectedCurrentQuantity: params.systemQuantity,
      };
    case 'transfer':
      // A count is never a transfer: nothing moved between locations, the number
      // was simply wrong.
      return null;
  }
}

/** A write that changes nothing is not worth sending. Filtering these out keeps a
 *  1.000-item count from becoming 1.000 provider calls when only 12 diverged. */
export function isNoOpWrite(write: StockWrite): boolean {
  if (write.kind === 'delta') return write.deltaQuantity === 0;
  if (write.kind === 'movement') return write.quantity === 0;
  if (write.kind === 'transfer') return write.quantity === 0;
  if (write.kind === 'absolute') {
    return (
      write.expectedCurrentQuantity != null &&
      write.expectedCurrentQuantity === write.targetQuantity
    );
  }
  return false;
}
