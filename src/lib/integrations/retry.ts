// Integration Engine — retry policy.
//
// Two hard rules, both learned the expensive way by everyone who ships
// integrations:
//   1. Never retry a permanent error. A malformed payload retried five times is
//      five identical rejections and five entries in the provider's abuse log.
//   2. Never retry without a ceiling. There is no error worth an unbounded loop.
//
// Jitter comes from an injected `random` so a test can pin it; production passes
// Math.random. Delays are computed, never slept, so the loop that consumes them
// controls the clock — that keeps this module pure and the tests instant.

import type { IntegrationError } from './errors.ts';

export interface RetryPolicy {
  /** Total attempts including the first. 3 means one try plus two retries. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Fraction of the computed delay to randomise, 0..1. Spreads a fleet of
   *  connections off the same reset boundary so they do not all wake together
   *  and re-trigger the limit they were waiting out. */
  jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitterRatio: 0.2,
};

/** Rate limits deserve more patience than outages: the provider told us exactly
 *  when to come back, and giving up on a 429 wastes work that would have
 *  succeeded a minute later. */
export const RATE_LIMIT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 2000,
  maxDelayMs: 120_000,
  jitterRatio: 0.2,
};

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  /** Why we stopped, for the log. */
  reason: 'permanent' | 'exhausted' | 'needs_refresh' | 'retryable';
}

/** Decide whether attempt N should be followed by attempt N+1.
 *
 *  `attempt` is 1-based: the first call is attempt 1.
 *
 *  An explicit Retry-After from the provider always wins over exponential
 *  backoff, and is still clamped to maxDelayMs — a provider asking us to wait an
 *  hour should surface as a failed run the operator can see, not a worker parked
 *  invisibly for an hour. */
export function decideRetry(
  error: IntegrationError,
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random
): RetryDecision {
  if (error.needsCredentialRefresh) {
    // Retrying the identical request cannot work; the caller must refresh first.
    return { retry: false, delayMs: 0, reason: 'needs_refresh' };
  }

  if (!error.retryable) {
    return { retry: false, delayMs: 0, reason: 'permanent' };
  }

  if (attempt >= policy.maxAttempts) {
    return { retry: false, delayMs: 0, reason: 'exhausted' };
  }

  const base =
    error.retryAfterMs != null && error.retryAfterMs > 0
      ? error.retryAfterMs
      : policy.baseDelayMs * Math.pow(2, attempt - 1);

  const capped = Math.min(base, policy.maxDelayMs);
  const jitter = capped * policy.jitterRatio * random();

  return { retry: true, delayMs: Math.round(capped + jitter), reason: 'retryable' };
}

/** Pick the policy that suits the failure. Kept here so callers do not have to
 *  remember that 429 gets a longer leash. */
export function policyFor(error: IntegrationError): RetryPolicy {
  return error.kind === 'RATE_LIMITED' ? RATE_LIMIT_RETRY_POLICY : DEFAULT_RETRY_POLICY;
}

/** Total worst-case wait for a policy, ignoring jitter and Retry-After. Useful
 *  for asserting a sync cannot exceed a scheduling window. */
export function worstCaseTotalDelayMs(policy: RetryPolicy): number {
  let total = 0;
  for (let attempt = 1; attempt < policy.maxAttempts; attempt++) {
    total += Math.min(policy.baseDelayMs * Math.pow(2, attempt - 1), policy.maxDelayMs);
  }
  return total;
}
