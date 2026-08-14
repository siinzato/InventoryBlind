// Sync Engine — conflict resolution.
//
// The decision this file makes is the one that can destroy a customer's
// inventory: InventoryBlind says 100, the ERP says 80, and something has to
// happen. Nothing here overwrites silently — every outcome is explicit, and
// `manual_review` is the default because for inventory, stopping to ask is
// cheaper than guessing wrong.
//
// Pure module: no I/O, no clock. Every timestamp is passed in, so the same inputs
// always produce the same decision and the tests can cover the whole matrix.

import type { ConflictPolicy, StockObservation } from './syncTypes.ts';
import type { SyncDirection } from '../types.ts';

export type ConflictOutcome =
  /** Values agree (within tolerance) — nothing to do. */
  | { kind: 'in_sync' }
  /** Apply the external value to InventoryBlind. */
  | { kind: 'accept_external'; policy: ConflictPolicy; value: number }
  /** Push the internal value to the provider. */
  | { kind: 'push_internal'; policy: ConflictPolicy; value: number }
  /** Record a conflict and touch nothing. */
  | { kind: 'needs_review'; reason: ConflictReason }
  /** The connection's direction forbids the action the policy chose. */
  | { kind: 'blocked'; reason: 'direction'; wanted: 'inbound' | 'outbound'; direction: SyncDirection };

export type ConflictReason =
  | 'policy_manual_review'
  /** last_write_wins was chosen but at least one side has no timestamp, so
   *  "latest" is unknowable. Guessing here silently picks a winner. */
  | 'missing_timestamps'
  /** Both sides changed at the same instant. Rare, but a coin flip on inventory
   *  is not an acceptable resolution. */
  | 'simultaneous_writes'
  /** The gap is large enough that it is more likely a mapping error than a real
   *  stock difference. See LARGE_DIVERGENCE_RATIO. */
  | 'implausible_divergence';

/** Quantities are numeric in both systems but arrive through float paths, unit
 *  conversions and provider rounding. A difference below this is noise, not a
 *  disagreement worth a review row. */
export const QUANTITY_TOLERANCE = 0.001;

/** A divergence this large is usually the wrong product, not the wrong count.
 *
 *  Ten times the smaller side, and at least 1.000 units of absolute gap, both
 *  have to hold — the ratio alone would flag a legitimate 1-vs-12 discrepancy,
 *  and the absolute floor alone would flag a legitimate large-warehouse variance.
 *  Requiring both keeps this rare, which is the point: it exists to catch a
 *  mismapped SKU before an automatic policy writes it. */
export const LARGE_DIVERGENCE_RATIO = 10;
export const LARGE_DIVERGENCE_FLOOR = 1000;

export function quantitiesAgree(a: number, b: number): boolean {
  return Math.abs(a - b) <= QUANTITY_TOLERANCE;
}

export function isImplausibleDivergence(internal: number, external: number): boolean {
  const gap = Math.abs(internal - external);
  if (gap < LARGE_DIVERGENCE_FLOOR) return false;

  const smaller = Math.min(Math.abs(internal), Math.abs(external));
  // A zero on one side has no ratio; the absolute floor already caught it, and
  // "we have 5.000, they have 0" is a plausible real state (never imported).
  if (smaller === 0) return false;

  return gap / smaller >= LARGE_DIVERGENCE_RATIO;
}

function directionAllows(direction: SyncDirection, flow: 'inbound' | 'outbound'): boolean {
  return direction === 'bidirectional' || direction === flow;
}

export interface ResolveInput {
  policy: ConflictPolicy;
  direction: SyncDirection;
  internal: StockObservation;
  external: StockObservation;
}

/** Decide what to do about one product's balance.
 *
 *  Order of checks is deliberate:
 *    1. agreement — the overwhelmingly common case, cheapest to answer;
 *    2. plausibility — a mismapped SKU must not be "resolved" by any policy;
 *    3. the policy itself;
 *    4. direction — a policy may want to write somewhere this connection cannot.
 *
 *  Putting plausibility ahead of policy is the important one: it means even
 *  `erp_wins` cannot silently replace 5 with 50.000. An automatic policy is a
 *  statement about whose number is more trustworthy, not permission to accept
 *  obviously broken data. */
export function resolveStockConflict(input: ResolveInput): ConflictOutcome {
  const { policy, direction, internal, external } = input;

  if (quantitiesAgree(internal.quantity, external.quantity)) {
    return { kind: 'in_sync' };
  }

  if (isImplausibleDivergence(internal.quantity, external.quantity)) {
    return { kind: 'needs_review', reason: 'implausible_divergence' };
  }

  switch (policy) {
    case 'manual_review':
      return { kind: 'needs_review', reason: 'policy_manual_review' };

    case 'erp_wins':
      return directionAllows(direction, 'inbound')
        ? { kind: 'accept_external', policy, value: external.quantity }
        : { kind: 'blocked', reason: 'direction', wanted: 'inbound', direction };

    case 'inventoryblind_wins':
      return directionAllows(direction, 'outbound')
        ? { kind: 'push_internal', policy, value: internal.quantity }
        : { kind: 'blocked', reason: 'direction', wanted: 'outbound', direction };

    case 'last_write_wins': {
      if (internal.observedAt == null || external.observedAt == null) {
        return { kind: 'needs_review', reason: 'missing_timestamps' };
      }

      const internalAt = Date.parse(internal.observedAt);
      const externalAt = Date.parse(external.observedAt);

      if (Number.isNaN(internalAt) || Number.isNaN(externalAt)) {
        return { kind: 'needs_review', reason: 'missing_timestamps' };
      }
      if (internalAt === externalAt) {
        return { kind: 'needs_review', reason: 'simultaneous_writes' };
      }

      if (externalAt > internalAt) {
        return directionAllows(direction, 'inbound')
          ? { kind: 'accept_external', policy, value: external.quantity }
          : { kind: 'blocked', reason: 'direction', wanted: 'inbound', direction };
      }
      return directionAllows(direction, 'outbound')
        ? { kind: 'push_internal', policy, value: internal.quantity }
        : { kind: 'blocked', reason: 'direction', wanted: 'outbound', direction };
    }
  }
}

/** Map an outcome to the `resolution` value stored on a conflict row, or null
 *  when the outcome does not resolve anything. */
export function resolutionFor(outcome: ConflictOutcome): ConflictPolicy | null {
  if (outcome.kind === 'accept_external' || outcome.kind === 'push_internal') return outcome.policy;
  return null;
}

/** Does this outcome need a human to look at it? Drives the pending-conflict
 *  badge and blocks an automatic scheduled sync from claiming success. */
export function requiresReview(outcome: ConflictOutcome): boolean {
  return outcome.kind === 'needs_review' || outcome.kind === 'blocked';
}

/** pt-BR explanation for the review screen. Each says what happened and what the
 *  operator can do, rather than naming an internal enum. */
export function describeOutcome(outcome: ConflictOutcome): string {
  switch (outcome.kind) {
    case 'in_sync':
      return 'Saldos coincidem.';
    case 'accept_external':
      return `Saldo do provedor aceito (${outcome.value}).`;
    case 'push_internal':
      return `Saldo do InventoryBlind enviado ao provedor (${outcome.value}).`;
    case 'blocked':
      return outcome.wanted === 'outbound'
        ? 'A política escolheu enviar o saldo ao provedor, mas esta conexão é somente de leitura. Habilite a escrita ou mude a política.'
        : 'A política escolheu aceitar o saldo do provedor, mas esta conexão é somente de escrita. Habilite a leitura ou mude a política.';
    case 'needs_review':
      switch (outcome.reason) {
        case 'policy_manual_review':
          return 'Divergência registrada para revisão manual, conforme a política desta conexão.';
        case 'missing_timestamps':
          return 'Não foi possível determinar qual lado é mais recente: um dos saldos não tem data de observação.';
        case 'simultaneous_writes':
          return 'Os dois lados foram alterados no mesmo instante. Escolha manualmente qual saldo vale.';
        case 'implausible_divergence':
          return 'A diferença é grande demais para ser aplicada automaticamente — verifique se o produto está mapeado corretamente antes de resolver.';
      }
  }
}
