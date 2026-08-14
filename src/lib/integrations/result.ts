// Integration Engine — the standard result object.
//
// Every connector operation returns one of these. It is a discriminated union
// rather than `{ success, data?, error? }` on purpose: with the union, reading
// `result.data` without first checking `result.success` does not compile. The
// optional-fields version compiles and then crashes at 3am on a provider outage.

import type { IntegrationError } from './errors.ts';
import type { PageInfo } from './pagination.ts';

/** What the provider says about our remaining budget.
 *
 *  All fields optional because most providers report some and none report all.
 *  The engine treats a missing field as "unknown", never as "unlimited" — the
 *  distinction matters when deciding whether to keep walking pages. */
export interface RateLimitInfo {
  /** Requests left in the current window. */
  remaining?: number | null;
  /** Provider's stated ceiling for the window. */
  limit?: number | null;
  /** When the window resets, epoch ms. */
  resetAt?: number | null;
  /** From `Retry-After`, already in ms. Authoritative over computed backoff. */
  retryAfterMs?: number | null;
}

export interface ResultMeta {
  provider: string;
  operation: string;
  /** Provider's request id — the thing to quote to their support. */
  externalRequestId?: string | null;
  rateLimit?: RateLimitInfo | null;
  /** Present on list operations only. */
  pagination?: PageInfo | null;
  /** Wall-clock duration of the provider call, for the sync run record. */
  durationMs?: number | null;
  /** Free-form, non-sensitive. Connectors must not put credentials here. */
  metadata?: Record<string, unknown> | null;
}

export interface OperationSuccess<T> extends ResultMeta {
  success: true;
  data: T;
}

export interface OperationFailure extends ResultMeta {
  success: false;
  error: IntegrationError;
}

export type OperationResult<T> = OperationSuccess<T> | OperationFailure;

export function ok<T>(data: T, meta: ResultMeta): OperationSuccess<T> {
  return { success: true, data, ...meta };
}

export function fail(error: IntegrationError, meta: ResultMeta): OperationFailure {
  return { success: false, error, ...meta };
}

export function isOk<T>(result: OperationResult<T>): result is OperationSuccess<T> {
  return result.success;
}

/** Unwrap or throw. For call sites that genuinely cannot proceed without the
 *  data — a sync step, not a UI render. UI should branch on `success` so it can
 *  show the user a message instead of an exception. */
export function unwrap<T>(result: OperationResult<T>): T {
  if (result.success) return result.data;
  throw result.error;
}

/** Should we pause before the next request even though nothing failed?
 *
 *  A provider that says "3 requests left" has not failed yet, and walking into
 *  the 429 anyway costs a retry cycle and pollutes the run with an error that was
 *  entirely predictable. Pausing until the window resets is cheaper and quieter. */
export function shouldThrottle(rateLimit: RateLimitInfo | null | undefined, threshold = 5): boolean {
  if (rateLimit?.remaining == null) return false;
  return rateLimit.remaining <= threshold;
}

/** How long to wait before the next request, given what the provider reported.
 *  Prefers an explicit Retry-After, then the reset time, then nothing. */
export function throttleDelayMs(
  rateLimit: RateLimitInfo | null | undefined,
  nowMs: number
): number {
  if (rateLimit?.retryAfterMs != null && rateLimit.retryAfterMs > 0) return rateLimit.retryAfterMs;
  if (rateLimit?.resetAt != null) return Math.max(0, rateLimit.resetAt - nowMs);
  return 0;
}
