// Turning an approved adjustment into a guarded write.
//
// This is the last thing that happens before the SaaS changes a balance inside the
// customer's ERP, and it is the part that must not be wrong. An overstated balance
// is worse than a failed sync: the marketplace keeps selling units that are not
// there and the orders get cancelled. So every function here is biased in one
// direction — when something is unclear, refuse.
//
// ── Why this is a separate module and not inside the Edge Function ───────────
// Because it has to be testable without a token. The Edge Function does I/O:
// reads rows, calls Tiny, writes results. Everything that *decides* lives here,
// pure, and is covered in __tests__/outboundStockWriter.test.ts.
//
// ── What this module never does ─────────────────────────────────────────────
//   • It never builds an absolute write from a delta, or vice versa. The stored
//     write_kind is obeyed as written; guessing is how a "+5" becomes a "set to 5".
//   • It never reads the balance itself. The verified balance is passed in, so a
//     caller cannot accidentally guard against a value it fetched an hour ago.
//   • It never decides that a refusal is acceptable. That is the operator's call,
//     recorded as an explicit override.

import {
  DEFAULT_WRITE_LIMITS,
  MOVEMENT_REASON_LABEL,
  buildFullWithdrawalTransfer,
  buildReturnWrite,
  buildWithdrawalWrite,
  describeRejection,
  guardStockWrite,
  isOverridable,
  type GuardRejection,
  type MovementReason,
  type WriteGuardLimits,
} from './stockWriteGuard.ts';
import type { StockWrite } from '../stockOperations.ts';

/** An approved adjustment as it comes out of integration_stock_adjustments.
 *  Snake case on purpose: this is the row shape, and renaming it on the way in
 *  would be one more place a field could be mismatched. */
export interface ApprovedAdjustment {
  id: string;
  external_product_id: string | null;
  sku: string | null;
  external_warehouse_id: string | null;
  target_warehouse_id: string | null;
  previous_quantity: number;
  counted_quantity: number;
  delta_quantity: number;
  write_kind: 'absolute' | 'delta' | 'transfer' | 'movement';
  movement_reason: string | null;
  reason: string | null;
  idempotency_key: string;
  approved_at: string | null;
  /** When the balance in previous_quantity was observed. Falls back to approved_at
   *  when absent — an approval timestamp is a real upper bound on how old the
   *  reading can be. */
  observed_at?: string | null;
  /** Where the adjustment came from ('physical_count', 'reverse_logistics', ...).
   *  Optional — only origins that need origin-specific side effects (alerting)
   *  need to select it. */
  origin?: string;
}

/** Why an adjustment could not become a write, before the guard even ran. */
export type PreparationRejection =
  | { code: 'missing_external_product'; message: string }
  | { code: 'unknown_movement_reason'; message: string }
  | { code: 'not_approved'; message: string }
  | { code: 'missing_transfer_target'; message: string }
  | { code: 'zero_quantity'; message: string }
  | { code: 'reason_kind_mismatch'; message: string };

export type PreparedWrite =
  | { ok: true; write: StockWrite; reason: MovementReason }
  | { ok: false; rejection: PreparationRejection };

const MOVEMENT_REASONS: readonly MovementReason[] = [
  'count_adjustment',
  'return',
  'full_withdrawal',
  'withdrawal',
  'loss',
  'found',
  'reconciliation',
];

/** NULL reads as count_adjustment — that is what every row written before the
 *  column existed actually is. An unrecognised value is refused rather than
 *  defaulted: defaulting it would apply count_adjustment's permissive 'either'
 *  direction to a movement whose real direction nobody knows. */
export function readMovementReason(value: string | null): MovementReason | null {
  if (value == null || value === '') return 'count_adjustment';
  return MOVEMENT_REASONS.includes(value as MovementReason) ? (value as MovementReason) : null;
}

/** Which write kinds each reason is allowed to use.
 *
 *  This is a second lock on the same door as MOVEMENT_DIRECTION. That one checks
 *  the balance moves the right way; this one checks the *shape* is right. A Full
 *  withdrawal recorded as a delta would pass the direction rule if the delta were
 *  zero, and still be wrong — the units must move between deposits, not stay put. */
const ALLOWED_KINDS: Record<MovementReason, ReadonlyArray<ApprovedAdjustment['write_kind']>> = {
  // A count can set the balance outright or express the difference.
  count_adjustment: ['absolute', 'delta', 'movement'],
  return: ['delta', 'movement'],
  // Transfer only. See buildFullWithdrawalTransfer for why.
  full_withdrawal: ['transfer'],
  withdrawal: ['delta', 'movement'],
  loss: ['delta', 'movement'],
  found: ['delta', 'movement'],
  reconciliation: ['absolute', 'delta', 'movement'],
};

/** Build the write an adjustment describes. Does not guard it — that is the next
 *  step, and it needs the provider's current balance. */
export function prepareWrite(adjustment: ApprovedAdjustment): PreparedWrite {
  if (adjustment.approved_at == null) {
    return {
      ok: false,
      rejection: {
        code: 'not_approved',
        message: 'Este lançamento não foi aprovado. Nada é enviado ao ERP sem aprovação.',
      },
    };
  }

  if (!adjustment.external_product_id) {
    // The SKU alone is not enough: Tiny writes stock by internal id, and looking
    // one up here would mean a write against a product resolved by a different
    // rule than the one the plan used.
    return {
      ok: false,
      rejection: {
        code: 'missing_external_product',
        message: `O produto ${adjustment.sku ?? adjustment.id} não está vinculado a um produto do ERP. Vincule antes de enviar.`,
      },
    };
  }

  const reason = readMovementReason(adjustment.movement_reason);
  if (reason == null) {
    return {
      ok: false,
      rejection: {
        code: 'unknown_movement_reason',
        message: `Tipo de movimento desconhecido: ${adjustment.movement_reason}. Não é possível saber a direção permitida.`,
      },
    };
  }

  if (!ALLOWED_KINDS[reason].includes(adjustment.write_kind)) {
    return {
      ok: false,
      rejection: {
        code: 'reason_kind_mismatch',
        message: `${MOVEMENT_REASON_LABEL[reason]} não pode ser lançada como ${adjustment.write_kind}.`,
      },
    };
  }

  const note = adjustment.reason ?? MOVEMENT_REASON_LABEL[reason];

  switch (adjustment.write_kind) {
    case 'transfer': {
      if (!adjustment.external_warehouse_id || !adjustment.target_warehouse_id) {
        return {
          ok: false,
          rejection: {
            code: 'missing_transfer_target',
            message:
              'Transferência sem depósito de origem ou destino. Verifique o mapeamento de depósitos desta conexão.',
          },
        };
      }
      // Magnitude comes from delta_quantity, whose sign is meaningless for a
      // transfer — direction is carried by from/to. buildFullWithdrawalTransfer
      // takes the absolute value for exactly that reason.
      const quantity = Math.abs(adjustment.delta_quantity);
      if (quantity === 0) {
        return {
          ok: false,
          rejection: { code: 'zero_quantity', message: 'Transferência de zero unidade não tem efeito.' },
        };
      }
      return {
        ok: true,
        reason,
        write: buildFullWithdrawalTransfer({
          productExternalId: adjustment.external_product_id,
          fromFullWarehouseId: adjustment.external_warehouse_id,
          toGeneralWarehouseId: adjustment.target_warehouse_id,
          quantity,
          idempotencyKey: adjustment.idempotency_key,
          note,
        }),
      };
    }

    case 'absolute':
      // counted_quantity, never previous_quantity + delta. The counted value is
      // what a human observed; recomputing it from the delta would reintroduce
      // rounding and, worse, would silently produce a different target if the
      // delta and the count ever disagreed.
      return {
        ok: true,
        reason,
        write: {
          kind: 'absolute',
          productExternalId: adjustment.external_product_id,
          locationExternalId: adjustment.external_warehouse_id,
          targetQuantity: adjustment.counted_quantity,
          idempotencyKey: adjustment.idempotency_key,
          reason: note,
        },
      };

    case 'delta':
    case 'movement': {
      if (adjustment.delta_quantity === 0) {
        return {
          ok: false,
          rejection: { code: 'zero_quantity', message: 'Lançamento de zero unidade não tem efeito.' },
        };
      }

      // The dedicated builders are used where they exist, because each one pins
      // the sign: a return can only add, a withdrawal can only remove. Feeding
      // them Math.abs means a stored −6 on a return cannot remove six units.
      if (reason === 'return' || reason === 'found') {
        return {
          ok: true,
          reason,
          write: buildReturnWrite({
            productExternalId: adjustment.external_product_id,
            locationExternalId: adjustment.external_warehouse_id,
            quantity: adjustment.delta_quantity,
            idempotencyKey: adjustment.idempotency_key,
            note,
          }),
        };
      }

      if (reason === 'withdrawal' || reason === 'loss') {
        return {
          ok: true,
          reason,
          write: buildWithdrawalWrite({
            productExternalId: adjustment.external_product_id,
            locationExternalId: adjustment.external_warehouse_id,
            quantity: adjustment.delta_quantity,
            idempotencyKey: adjustment.idempotency_key,
            note,
          }),
        };
      }

      // count_adjustment and reconciliation genuinely go both ways, so the stored
      // sign is the intent and is passed through untouched.
      return {
        ok: true,
        reason,
        write: {
          kind: 'delta',
          productExternalId: adjustment.external_product_id,
          locationExternalId: adjustment.external_warehouse_id,
          deltaQuantity: adjustment.delta_quantity,
          idempotencyKey: adjustment.idempotency_key,
          reason: note,
        },
      };
    }
  }
}

// ── Guarding ────────────────────────────────────────────────────────────────

export interface VerifiedBalance {
  /** Total across every deposit, as the provider reports it right now. */
  total: number;
  /** How many deposits hold the product. Drives the absolute-write refusal: an
   *  absolute write on a multi-deposit product would zero the others. */
  warehouseCount: number;
  /** Balance of the source deposit, needed for a transfer. Null when it could not
   *  be read — a transfer is then refused rather than attempted. */
  sourceWarehouseBalance: number | null;
}

export type OutboundDecision =
  | { status: 'send'; adjustmentId: string; write: StockWrite; reason: MovementReason }
  | {
      status: 'refused';
      adjustmentId: string;
      code: string;
      message: string;
      /** Whether an operator is allowed to force it through. Structural refusals
       *  are never overridable. */
      overridable: boolean;
    };

export interface DecideOptions {
  adjustment: ApprovedAdjustment;
  /** Null when the provider balance could not be re-read. Allowed, but then the
   *  staleness rule inside the guard carries the whole burden. */
  verified: VerifiedBalance | null;
  nowMs: number;
  limits?: WriteGuardLimits;
  /** Rejection codes an operator has explicitly accepted for THIS adjustment.
   *  Scoped per adjustment on purpose: a blanket "ignore drift" switch would
   *  outlive the situation that justified it. */
  overriddenCodes?: readonly string[];
}

/** The whole decision for one adjustment: prepare, then guard, then apply any
 *  operator override. Returns what should happen — it does not do it. */
export function decideOutboundWrite(options: DecideOptions): OutboundDecision {
  const { adjustment, verified, nowMs } = options;

  const prepared = prepareWrite(adjustment);
  if (!prepared.ok) {
    // Preparation failures are never overridable. They mean the row does not
    // describe a valid write at all, so there is nothing to force through —
    // forcing an unlinked product or an unknown movement type would just send a
    // write nobody specified.
    return {
      status: 'refused',
      adjustmentId: adjustment.id,
      code: prepared.rejection.code,
      message: prepared.rejection.message,
      overridable: false,
    };
  }

  // A transfer whose source balance could not be read is refused before the
  // guard: moving an unknown quantity out of an unknown balance is how a deposit
  // goes negative, and the guard cannot reason about a null it was not given.
  if (prepared.write.kind === 'transfer' && verified?.sourceWarehouseBalance == null) {
    return {
      status: 'refused',
      adjustmentId: adjustment.id,
      code: 'source_balance_unknown',
      message:
        'Não foi possível ler o saldo do depósito de origem. A transferência não será enviada — mover uma quantidade desconhecida de um saldo desconhecido é o que deixa depósito negativo.',
      overridable: false,
    };
  }

  const verdict = guardStockWrite({
    write: prepared.write,
    reason: prepared.reason,
    assumedCurrent: adjustment.previous_quantity,
    verifiedCurrent: verified?.total ?? null,
    // 1 when unknown: claiming zero deposits would let an absolute write through
    // the multi-deposit refusal, which is the one refusal that cannot be overridden.
    warehouseCount: verified?.warehouseCount ?? 1,
    sourceWarehouseBalance: verified?.sourceWarehouseBalance ?? null,
    observedAt: adjustment.observed_at ?? adjustment.approved_at,
    nowMs,
    limits: options.limits ?? DEFAULT_WRITE_LIMITS,
  });

  if (verdict.allowed) {
    return { status: 'send', adjustmentId: adjustment.id, write: verdict.write, reason: prepared.reason };
  }

  const overridable = isOverridable(verdict.rejection);
  const code = rejectionCode(verdict.rejection);

  // An override only counts when the operator named this exact code AND the
  // refusal is overridable. Checking overridability second means a forged
  // override list cannot get past a structural refusal.
  if (overridable && options.overriddenCodes?.includes(code)) {
    return { status: 'send', adjustmentId: adjustment.id, write: prepared.write, reason: prepared.reason };
  }

  return {
    status: 'refused',
    adjustmentId: adjustment.id,
    code,
    message: describeRejection(verdict.rejection),
    overridable,
  };
}

/** The rejection's discriminant. Extracted so an override list is matched against
 *  a stable code rather than against a translated message. */
export function rejectionCode(rejection: GuardRejection): GuardRejection['code'] {
  return rejection.code;
}

/** Split decisions for the caller. Kept as a function so the counting rule lives
 *  in one place: `sent + refused` must always equal the number of adjustments, and
 *  a decision silently belonging to neither bucket is how a lançamento disappears. */
export function partitionDecisions(decisions: readonly OutboundDecision[]): {
  toSend: Extract<OutboundDecision, { status: 'send' }>[];
  refused: Extract<OutboundDecision, { status: 'refused' }>[];
} {
  const toSend: Extract<OutboundDecision, { status: 'send' }>[] = [];
  const refused: Extract<OutboundDecision, { status: 'refused' }>[] = [];

  for (const decision of decisions) {
    if (decision.status === 'send') toSend.push(decision);
    else refused.push(decision);
  }

  return { toSend, refused };
}

/** Group writes by the connector method that must carry them.
 *
 *  Transfers cannot travel with balance writes: Tiny has no atomic transfer, so a
 *  transfer becomes two movements and needs its own call sequence. Mixing them
 *  into updateStock would send a transfer as a balance change — the exact
 *  confusion between absolute and delta this whole design refuses to permit. */
export function groupWritesByOperation(writes: readonly StockWrite[]): {
  balanceWrites: StockWrite[];
  transfers: StockWrite[];
} {
  const balanceWrites: StockWrite[] = [];
  const transfers: StockWrite[] = [];

  for (const write of writes) {
    if (write.kind === 'transfer') transfers.push(write);
    else balanceWrites.push(write);
  }

  return { balanceWrites, transfers };
}

// ── Reading the provider's current balance ──────────────────────────────────

/** Turn the provider's per-deposit rows into the facts the guard needs.
 *
 *  Pure so the aggregation is testable: this is the number every magnitude rule
 *  compares against, and getting it wrong makes every downstream check wrong in
 *  the same direction at once.
 *
 *  `sourceWarehouseId` names the deposit a transfer would draw from. It is matched
 *  case- and whitespace-insensitively because Tiny v2 has no deposit id — the name
 *  IS the identifier, and a deposit stored as 'AZ ML FULLFILMENT' must still match
 *  a row that comes back as 'Az Ml Fullfilment'. Passing null (no transfer)
 *  leaves sourceWarehouseBalance null, which the transfer path then refuses. */
export function summarizeProviderStock(
  levels: readonly { warehouseExternalId: string | null; quantity: number }[],
  sourceWarehouseId: string | null
): VerifiedBalance {
  // Summed, never taken from the first row. Comparing one deposit's balance
  // against a company-wide expectation is how a false conflict gets manufactured.
  let total = 0;
  let sourceWarehouseBalance: number | null = null;

  const wanted = sourceWarehouseId == null ? null : normalizeWarehouseKey(sourceWarehouseId);

  for (const level of levels) {
    total += level.quantity;

    if (wanted != null && level.warehouseExternalId != null) {
      if (normalizeWarehouseKey(level.warehouseExternalId) === wanted) {
        // Accumulated rather than assigned: a provider that splits one deposit
        // across rows would otherwise report only the last one.
        sourceWarehouseBalance = (sourceWarehouseBalance ?? 0) + level.quantity;
      }
    }
  }

  return {
    total,
    // Distinct named deposits. An unnamed row is still a deposit for counting
    // purposes — under-counting is what would let an absolute write through the
    // multi-deposit refusal.
    warehouseCount: countDistinctWarehouses(levels),
    sourceWarehouseBalance,
  };
}

function normalizeWarehouseKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function countDistinctWarehouses(
  levels: readonly { warehouseExternalId: string | null }[]
): number {
  if (levels.length === 0) return 0;

  const keys = new Set<string>();
  let unnamed = 0;

  for (const level of levels) {
    if (level.warehouseExternalId == null || level.warehouseExternalId.trim() === '') unnamed += 1;
    else keys.add(normalizeWarehouseKey(level.warehouseExternalId));
  }

  // Unnamed rows cannot be deduplicated, so each counts. Tiny emits a single
  // unnamed row for a product with no per-deposit breakdown, which correctly
  // yields 1.
  return keys.size + unnamed;
}

// ── One adjustment per product, per run ─────────────────────────────────────

/** Split a batch into what may be sent now and what must wait for the next run.
 *
 *  Two adjustments on the same product cannot both be sent in one pass. The
 *  second one's `previous_quantity` was observed BEFORE the first one was applied,
 *  so guarding it against the balance we read at the start of the run compares a
 *  stale assumption against a balance that is about to change. The guard would
 *  either wave it through — compounding both changes — or refuse it as drift.
 *  Neither is right, and "compounding both changes" is the one that overstates a
 *  balance.
 *
 *  So: the oldest approved adjustment per product goes now, the rest are deferred
 *  and picked up on the next run against a freshly read balance. Deferring is not
 *  losing — the rows stay pending, and the caller reports the count.
 *
 *  Oldest first because approval order is the order the operator intended, and
 *  applying a later correction before an earlier one can leave the ERP briefly
 *  holding a balance nobody ever approved. */
export function selectOneAdjustmentPerProduct<T extends ApprovedAdjustment>(
  adjustments: readonly T[]
): { selected: T[]; deferred: T[] } {
  const byProduct = new Map<string, T>();
  const deferred: T[] = [];

  for (const adjustment of adjustments) {
    // A row with no external product is kept in the selected set so it reaches the
    // guard and gets its refusal recorded. Silently deferring it forever would
    // leave the operator waiting on a lançamento that can never be sent.
    const key = adjustment.external_product_id;
    if (key == null || key === '') {
      deferred.push(adjustment);
      continue;
    }

    const incumbent = byProduct.get(key);
    if (incumbent == null) {
      byProduct.set(key, adjustment);
      continue;
    }

    if (isOlder(adjustment, incumbent)) {
      deferred.push(incumbent);
      byProduct.set(key, adjustment);
    } else {
      deferred.push(adjustment);
    }
  }

  // Unlinked rows are added back so they are decided (and refused) this run.
  const unlinked = deferred.filter(a => a.external_product_id == null || a.external_product_id === '');
  const realDeferred = deferred.filter(a => a.external_product_id != null && a.external_product_id !== '');

  return { selected: [...byProduct.values(), ...unlinked], deferred: realDeferred };
}

function isOlder(candidate: ApprovedAdjustment, incumbent: ApprovedAdjustment): boolean {
  const a = candidate.approved_at == null ? null : Date.parse(candidate.approved_at);
  const b = incumbent.approved_at == null ? null : Date.parse(incumbent.approved_at);

  // An unparseable or missing timestamp never wins the slot: it would be decided
  // against an ordering we cannot establish. It is deferred, and the not_approved
  // refusal catches the missing case on a later run.
  if (a == null || Number.isNaN(a)) return false;
  if (b == null || Number.isNaN(b)) return true;

  return a < b;
}
