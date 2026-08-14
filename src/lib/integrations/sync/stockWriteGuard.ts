// Sync Engine — outbound write guard.
//
// The last thing between InventoryBlind and a customer's ERP balance. Nothing
// reaches a provider without passing every rule here.
//
// ── The asymmetry that drives the whole file ─────────────────────────────────
// Overstating stock and understating it are not equally bad. An inflated balance
// makes the marketplace accept orders that cannot be fulfilled, and the customer
// pays in cancellations, reputation and marketplace penalties. An understated
// balance only stops a sale that could have happened. Both are errors; only one
// is expensive and public.
//
// So increases are held to a stricter standard than decreases, and anything the
// guard is unsure about is refused and sent to review rather than written. A sync
// that stops and asks costs an operator five minutes. A sync that writes a wrong
// balance costs a day of cancelled orders.
//
// ── Why refusals are never silent ───────────────────────────────────────────
// Every rejection returns a reason. A dropped write with no trace would leave the
// two systems disagreeing forever with nothing to show for it, which is worse
// than either writing or failing loudly.
//
// Pure module: no I/O, no clock. Fully testable.

import type { StockWrite } from '../stockOperations.ts';

/** Why a stock movement is happening. Reaches the provider as the movement note
 *  and is stored on the adjustment row, so an ERP audit months later can tell a
 *  count correction from a customer return. */
export type MovementReason =
  | 'count_adjustment'
  /** Devolução — goods came back from a customer, company stock goes up. */
  | 'return'
  /** Retirada de Full — stock leaves the marketplace fulfilment deposit and
   *  returns to the general deposit, both inside the ERP.
   *
   *  This is a TRANSFER, not a decrease: the company still owns the goods, they
   *  simply moved. Modelling it as a decrease would subtract stock that still
   *  exists and never credit the general deposit — wrong in both directions at
   *  once, and the understated general deposit would then block real sales. */
  | 'full_withdrawal'
  /** Stock genuinely leaving the company (sample, internal consumption). */
  | 'withdrawal'
  | 'loss'
  | 'found'
  | 'reconciliation';

export const MOVEMENT_REASON_LABEL: Record<MovementReason, string> = {
  count_adjustment: 'Ajuste de contagem física',
  return: 'Devolução',
  full_withdrawal: 'Retirada de Full',
  withdrawal: 'Retirada (baixa de estoque)',
  loss: 'Perda / avaria',
  found: 'Sobra encontrada',
  reconciliation: 'Reconciliação de saldo',
};

/** Which way a movement may move the company's total balance.
 *
 *  Encoded because a sign mistake in the caller is otherwise invisible: a
 *  "devolução" arriving as −6 would remove stock the customer just got back, and
 *  nothing downstream would question it.
 *
 *  `neutral` is its own case, not a synonym for `either`: a Full withdrawal must
 *  leave the total untouched, so a version of it that changed the total is a bug
 *  to catch, not a variation to permit. */
export const MOVEMENT_DIRECTION: Record<
  MovementReason,
  'increase' | 'decrease' | 'either' | 'neutral'
> = {
  count_adjustment: 'either',
  return: 'increase',
  full_withdrawal: 'neutral',
  withdrawal: 'decrease',
  loss: 'decrease',
  found: 'increase',
  reconciliation: 'either',
};

export interface WriteGuardLimits {
  /** Largest increase allowed as a fraction of the current balance. 0.5 means a
   *  write may raise 100 to at most 150 before needing review. */
  maxIncreaseRatio: number;
  /** Largest increase in absolute units, applied alongside the ratio so a product
   *  currently at 2 units cannot jump to 20.000 just because the ratio is
   *  meaningless at small numbers. */
  maxIncreaseAbsolute: number;
  /** Decreases get a looser leash: understating costs a lost sale, not a
   *  cancellation. Still capped, because zeroing a warehouse by accident is its
   *  own incident. */
  maxDecreaseRatio: number;
  maxDecreaseAbsolute: number;
  /** A balance read this long before the write is considered stale, because the
   *  ERP may have sold in the meantime and a delta computed against an old number
   *  compounds the error. Milliseconds. */
  maxObservationAgeMs: number;
}

/** Defaults chosen to be boring rather than clever.
 *
 *  +50% / +1.000 units passes without review, which covers a normal restock, and
 *  stops a decimal-place or unit-of-measure mistake (10x, 100x, 1000x) dead —
 *  those are the mistakes that actually happen and the ones that cause
 *  overselling.
 *
 *  Fifteen minutes of staleness is generous for a manual sync and tight enough
 *  that a scheduled hourly job cannot write against an hour-old balance. */
export const DEFAULT_WRITE_LIMITS: WriteGuardLimits = {
  maxIncreaseRatio: 0.5,
  maxIncreaseAbsolute: 1000,
  maxDecreaseRatio: 1,
  maxDecreaseAbsolute: 5000,
  maxObservationAgeMs: 15 * 60 * 1000,
};

export type GuardRejection =
  /** An absolute write on a product spread across deposits, with no deposit
   *  named. The provider would apply the summed total to one deposit and the
   *  others would be wrong. The most destructive case in this file. */
  | { code: 'absolute_multi_warehouse'; warehouses: number }
  /** An absolute write with no belief about the current balance, so drift cannot
   *  be detected and the write is unverifiable. */
  | { code: 'absolute_without_expected' }
  /** The provider's balance moved between planning and writing. A delta computed
   *  against the old number would be wrong by exactly the drift. */
  | { code: 'stale_balance'; assumed: number; actual: number }
  /** The read the decision rests on is too old to trust. */
  | { code: 'observation_too_old'; ageMs: number }
  | { code: 'increase_too_large'; from: number; to: number; limit: number }
  | { code: 'decrease_too_large'; from: number; to: number; limit: number }
  /** Resulting balance below zero. No ERP state makes this correct. */
  | { code: 'negative_result'; result: number }
  /** A movement whose sign contradicts its reason. */
  | { code: 'wrong_direction'; reason: MovementReason; expected: 'increase' | 'decrease' | 'neutral' }
  /** A transfer asking to move more than the source deposit holds. The ERP would
   *  either refuse it or drive the source negative; neither is acceptable, and a
   *  Full withdrawal of more than the Full deposit contains is the likely shape of
   *  a mapping mistake. */
  | { code: 'insufficient_source_balance'; available: number; requested: number }
  /** Source and destination are the same deposit. A no-op dressed as a movement,
   *  which would leave a misleading movement record in the ERP. */
  | { code: 'same_warehouse_transfer'; warehouse: string }
  | { code: 'no_op' };

export type GuardVerdict =
  | { allowed: true; write: StockWrite }
  | { allowed: false; rejection: GuardRejection };

export interface GuardInput {
  write: StockWrite;
  reason: MovementReason;
  /** Balance the plan was built against. */
  assumedCurrent: number;
  /** Provider's balance re-read immediately before writing, when available.
   *  Null means no verification was possible — allowed, but then the staleness
   *  rule carries the whole burden. */
  verifiedCurrent: number | null;
  /** How many deposits hold this product, from the aggregation step. */
  warehouseCount: number;
  /** Balance of the SOURCE deposit, required for a transfer. Null means it could
   *  not be read — a transfer is then refused rather than attempted, because
   *  moving an unknown quantity out of an unknown balance is exactly how a
   *  deposit goes negative. */
  sourceWarehouseBalance?: number | null;
  /** When `assumedCurrent` was observed, ISO. */
  observedAt: string | null;
  nowMs: number;
  limits?: WriteGuardLimits;
}

/** Resulting balance a write would produce, or null when it cannot be known. */
export function projectedBalance(write: StockWrite, current: number): number | null {
  switch (write.kind) {
    case 'absolute':
      return write.targetQuantity;
    case 'delta':
      return current + write.deltaQuantity;
    case 'movement':
      if (write.movementType === 'in' || write.movementType === 'found') return current + write.quantity;
      if (write.movementType === 'out' || write.movementType === 'loss') return current - write.quantity;
      // A typed 'adjustment' movement carries a magnitude without a direction, so
      // the result genuinely cannot be projected.
      return null;
    case 'transfer':
      // Net zero for the company; per-deposit effects are the provider's business.
      return current;
  }
}

/** Signed change a write intends. */
function intendedChange(write: StockWrite, current: number): number | null {
  const projected = projectedBalance(write, current);
  return projected == null ? null : projected - current;
}

/** Run every rule. Order matters: the destructive structural checks come first,
 *  so a multi-deposit absolute write is refused before anyone reasons about its
 *  magnitude. */
export function guardStockWrite(input: GuardInput): GuardVerdict {
  const limits = input.limits ?? DEFAULT_WRITE_LIMITS;
  const { write } = input;

  // ── 0. Transfers take their own path ─────────────────────────────────────
  // A transfer leaves the company total untouched, so the magnitude rules below
  // — which all reason about a changing total — do not apply. It gets the two
  // rules that do matter for it instead.
  if (write.kind === 'transfer') {
    const expected = MOVEMENT_DIRECTION[input.reason];
    if (expected !== 'neutral' && expected !== 'either') {
      return { allowed: false, rejection: { code: 'wrong_direction', reason: input.reason, expected } };
    }

    if (write.fromLocationExternalId === write.toLocationExternalId) {
      return {
        allowed: false,
        rejection: { code: 'same_warehouse_transfer', warehouse: write.fromLocationExternalId },
      };
    }

    if (write.quantity <= 0) {
      return { allowed: false, rejection: { code: 'no_op' } };
    }

    // Cannot move more than the source holds. An unreadable source balance is
    // treated as zero available: refusing is safer than moving blind.
    const available = input.sourceWarehouseBalance ?? null;
    if (available == null || write.quantity > available) {
      return {
        allowed: false,
        rejection: {
          code: 'insufficient_source_balance',
          available: available ?? 0,
          requested: write.quantity,
        },
      };
    }

    return { allowed: true, write };
  }

  // ── 1. Structural: absolute writes and multiple deposits do not mix ───────
  if (write.kind === 'absolute') {
    if (input.warehouseCount > 1 && write.locationExternalId == null) {
      return { allowed: false, rejection: { code: 'absolute_multi_warehouse', warehouses: input.warehouseCount } };
    }
    if (write.expectedCurrentQuantity == null) {
      return { allowed: false, rejection: { code: 'absolute_without_expected' } };
    }
  }

  // ── 2. Drift: has the provider moved since we planned? ───────────────────
  // Checked before magnitude because a stale base makes every magnitude
  // judgement meaningless.
  if (input.verifiedCurrent != null && input.verifiedCurrent !== input.assumedCurrent) {
    return {
      allowed: false,
      rejection: { code: 'stale_balance', assumed: input.assumedCurrent, actual: input.verifiedCurrent },
    };
  }

  // ── 3. Staleness of the read the decision rests on ───────────────────────
  if (input.observedAt != null) {
    const observedMs = Date.parse(input.observedAt);
    if (!Number.isNaN(observedMs)) {
      const ageMs = input.nowMs - observedMs;
      if (ageMs > limits.maxObservationAgeMs) {
        return { allowed: false, rejection: { code: 'observation_too_old', ageMs } };
      }
    }
  }

  const current = input.verifiedCurrent ?? input.assumedCurrent;
  const change = intendedChange(write, current);

  // ── 4. Sign must match the stated reason ─────────────────────────────────
  if (change != null && change !== 0) {
    const expected = MOVEMENT_DIRECTION[input.reason];
    if (expected === 'increase' && change < 0) {
      return { allowed: false, rejection: { code: 'wrong_direction', reason: input.reason, expected } };
    }
    if (expected === 'decrease' && change > 0) {
      return { allowed: false, rejection: { code: 'wrong_direction', reason: input.reason, expected } };
    }
    // A reason declared neutral must not arrive as anything that moves the total.
    // Reaching here with a non-transfer write means the caller built the wrong
    // shape — a Full withdrawal as a plain delta, most likely — and that would
    // subtract stock the company still owns.
    if (expected === 'neutral') {
      return { allowed: false, rejection: { code: 'wrong_direction', reason: input.reason, expected } };
    }
  }

  // ── 5. Nothing to do ─────────────────────────────────────────────────────
  if (change === 0) {
    return { allowed: false, rejection: { code: 'no_op' } };
  }

  const projected = projectedBalance(write, current);

  // ── 6. Never below zero ──────────────────────────────────────────────────
  if (projected != null && projected < 0) {
    return { allowed: false, rejection: { code: 'negative_result', result: projected } };
  }

  // ── 7. Magnitude, asymmetric by direction ────────────────────────────────
  if (change != null && projected != null) {
    if (change > 0) {
      // Both limits must be satisfied. The ratio catches a large product jumping
      // implausibly; the absolute floor catches a tiny product doing the same,
      // where a ratio is meaningless.
      const ratioLimit = Math.abs(current) * limits.maxIncreaseRatio;
      const allowedIncrease = Math.max(ratioLimit, 0) + 0;
      if (change > limits.maxIncreaseAbsolute || (current !== 0 && change > allowedIncrease)) {
        return {
          allowed: false,
          rejection: {
            code: 'increase_too_large',
            from: current,
            to: projected,
            limit: current === 0 ? limits.maxIncreaseAbsolute : Math.min(limits.maxIncreaseAbsolute, allowedIncrease),
          },
        };
      }
    } else {
      const magnitude = Math.abs(change);
      const ratioLimit = Math.abs(current) * limits.maxDecreaseRatio;
      if (magnitude > limits.maxDecreaseAbsolute || (current !== 0 && magnitude > ratioLimit)) {
        return {
          allowed: false,
          rejection: {
            code: 'decrease_too_large',
            from: current,
            to: projected,
            limit: current === 0 ? limits.maxDecreaseAbsolute : Math.min(limits.maxDecreaseAbsolute, ratioLimit),
          },
        };
      }
    }
  }

  return { allowed: true, write };
}

/** pt-BR explanation for the review queue. Says what was refused and what to do,
 *  because the operator reading it did not write the code. */
export function describeRejection(rejection: GuardRejection): string {
  switch (rejection.code) {
    case 'absolute_multi_warehouse':
      return `Este produto tem saldo em ${rejection.warehouses} depósitos. Definir um saldo único sobrescreveria os outros — envie o ajuste por depósito.`;
    case 'absolute_without_expected':
      return 'Não sabemos qual saldo o ERP tinha antes deste ajuste, então não é possível conferir o resultado. Sincronize o saldo antes de enviar.';
    case 'stale_balance':
      return `O saldo no ERP mudou de ${rejection.assumed} para ${rejection.actual} enquanto o envio era preparado. O ajuste foi cancelado para não gravar um número errado — refaça a sincronização.`;
    case 'observation_too_old':
      return `A leitura do saldo tem ${Math.round(rejection.ageMs / 60000)} minutos e pode estar desatualizada. Sincronize novamente antes de enviar.`;
    case 'increase_too_large':
      return `O ajuste aumentaria o saldo de ${rejection.from} para ${rejection.to}, acima do limite de segurança (+${rejection.limit}). Aumento indevido de saldo gera pedidos que não podem ser atendidos, então este envio precisa de confirmação manual.`;
    case 'decrease_too_large':
      return `O ajuste reduziria o saldo de ${rejection.from} para ${rejection.to}, além do limite de segurança (−${rejection.limit}). Confirme manualmente.`;
    case 'negative_result':
      return `O ajuste deixaria o saldo em ${rejection.result}, o que não é um estado válido no ERP.`;
    case 'wrong_direction': {
      const label = MOVEMENT_REASON_LABEL[rejection.reason].toLowerCase();
      if (rejection.expected === 'neutral') {
        return `Uma ${label} não altera o estoque total: ela transfere o produto entre depósitos. Este lançamento mudaria o saldo total, o que indica que foi montado como baixa em vez de transferência.`;
      }
      return `Uma ${label} deve ${rejection.expected === 'increase' ? 'aumentar' : 'reduzir'} o saldo, e este lançamento faz o contrário. Verifique o sinal da quantidade.`;
    }
    case 'insufficient_source_balance':
      return `A transferência pede ${rejection.requested} unidades, mas o depósito de origem tem ${rejection.available}. Sincronize o saldo e confirme se o depósito de Full está mapeado corretamente.`;
    case 'same_warehouse_transfer':
      return `Origem e destino são o mesmo depósito (${rejection.warehouse}). Verifique o mapeamento dos depósitos desta conexão.`;
    case 'no_op':
      return 'O saldo já está correto no ERP — nada a enviar.';
  }
}

/** Is this rejection something a human can approve past, or is it structurally
 *  impossible?
 *
 *  Drives the UI: an overridable rejection gets a "confirmar mesmo assim" path,
 *  while a structural one must be fixed, not waved through. Approving a
 *  multi-deposit absolute write would still destroy the other deposits. */
export function isOverridable(rejection: GuardRejection): boolean {
  switch (rejection.code) {
    case 'increase_too_large':
    case 'decrease_too_large':
      return true;
    case 'absolute_multi_warehouse':
    case 'absolute_without_expected':
    case 'stale_balance':
    case 'observation_too_old':
    case 'negative_result':
    case 'wrong_direction':
    // Not overridable on purpose: approving a transfer larger than the source
    // holds would drive the Full deposit negative, and the likely cause is a
    // mismapped deposit — a data problem to fix, not a judgement to confirm.
    case 'insufficient_source_balance':
    case 'same_warehouse_transfer':
    case 'no_op':
      return false;
  }
}

/** Run the guard over a batch, splitting what may be sent from what must not.
 *
 *  Refusing one item never blocks the rest: 12 safe adjustments should reach the
 *  ERP even when the 13th looks wrong. */
export function guardBatch(
  inputs: GuardInput[]
): { allowed: StockWrite[]; rejected: { write: StockWrite; rejection: GuardRejection }[] } {
  const allowed: StockWrite[] = [];
  const rejected: { write: StockWrite; rejection: GuardRejection }[] = [];

  for (const input of inputs) {
    const verdict = guardStockWrite(input);
    if (verdict.allowed) allowed.push(verdict.write);
    else rejected.push({ write: input.write, rejection: verdict.rejection });
  }

  return { allowed, rejected };
}

/** Build a return (devolução): goods came back, stock rises.
 *
 *  Always a delta, never an absolute: a return is a known change of a known size,
 *  and expressing it as "the balance is now X" would discard that fact and risk
 *  overwriting whatever else moved in between. */
export function buildReturnWrite(params: {
  productExternalId: string;
  locationExternalId: string | null;
  quantity: number;
  idempotencyKey: string;
  note?: string | null;
}): StockWrite {
  return {
    kind: 'delta',
    productExternalId: params.productExternalId,
    locationExternalId: params.locationExternalId,
    // Math.abs so a caller passing −5 for "5 returned" cannot remove stock. The
    // guard would catch it, but not depending on the guard is better.
    deltaQuantity: Math.abs(params.quantity),
    idempotencyKey: params.idempotencyKey,
    reason: params.note ?? MOVEMENT_REASON_LABEL.return,
  };
}

/** Build a Full withdrawal: stock moves from the marketplace fulfilment deposit
 *  back to the general deposit, both inside the ERP.
 *
 *  A transfer, never a delta. The company still owns the goods — subtracting them
 *  would understate total stock AND leave the general deposit uncredited, so the
 *  units would be invisible to picking even though they are physically on the
 *  shelf. */
export function buildFullWithdrawalTransfer(params: {
  productExternalId: string;
  /** The Full/FBA deposit the goods are leaving. */
  fromFullWarehouseId: string;
  /** The general deposit receiving them. */
  toGeneralWarehouseId: string;
  quantity: number;
  idempotencyKey: string;
  note?: string | null;
}): StockWrite {
  return {
    kind: 'transfer',
    productExternalId: params.productExternalId,
    fromLocationExternalId: params.fromFullWarehouseId,
    toLocationExternalId: params.toGeneralWarehouseId,
    // Always positive: direction is carried by from/to, and a negative quantity
    // here would read as a reverse transfer nobody asked for.
    quantity: Math.abs(params.quantity),
    idempotencyKey: params.idempotencyKey,
    reason: params.note ?? MOVEMENT_REASON_LABEL.full_withdrawal,
  };
}

/** Build a genuine stock write-off: goods left the company for good (sample,
 *  internal consumption, disposal). Reduces the total, unlike a Full withdrawal. */
export function buildWithdrawalWrite(params: {
  productExternalId: string;
  locationExternalId: string | null;
  quantity: number;
  idempotencyKey: string;
  note?: string | null;
}): StockWrite {
  return {
    kind: 'delta',
    productExternalId: params.productExternalId,
    locationExternalId: params.locationExternalId,
    deltaQuantity: -Math.abs(params.quantity),
    idempotencyKey: params.idempotencyKey,
    reason: params.note ?? MOVEMENT_REASON_LABEL.withdrawal,
  };
}
