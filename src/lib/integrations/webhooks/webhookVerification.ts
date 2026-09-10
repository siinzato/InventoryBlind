// Webhooks — verification, replay protection and safe logging.
//
// Pure module: every input is passed in, including the clock and the digest
// function, so the whole security surface is unit-testable without a server.
//
// ── The three checks, and why all three are needed ───────────────────────────
//   signature  proves the sender holds the shared secret
//   freshness  proves the request is not a captured one being replayed later —
//              a valid signature stays valid forever, so signature alone does not
//              stop replay
//   uniqueness proves we have not already processed this exact event
//
// Dropping any one of them leaves a real hole. Signature without freshness lets an
// attacker who captured one request repeat it indefinitely; freshness without
// uniqueness lets a provider's own retry double-apply a stock change.

import { IntegrationError } from '../errors.ts';

export type WebhookRejectionCode =
  | 'missing_signature'
  | 'invalid_signature'
  | 'missing_timestamp'
  | 'stale_timestamp'
  | 'future_timestamp'
  | 'unknown_connection'
  | 'no_secret_configured'
  | 'duplicate_event'
  | 'unsupported_topic'
  | 'malformed_body';

export interface WebhookRejection {
  code: WebhookRejectionCode;
  message: string;
  /** HTTP status to answer with.
   *
   *  A rejected-but-understood event answers 200 so the provider stops retrying
   *  something we will never accept; an authentication failure answers 401 so it is
   *  visible as such in their dashboard. Answering 500 to a bad signature would
   *  make a provider retry an attack for us. */
  status: number;
}

/** How long a signed request stays acceptable.
 *
 *  Five minutes is the common industry window (Stripe, Shopify, Slack all sit at or
 *  near it). Long enough to absorb clock skew and network delay, short enough that a
 *  captured request is useless by the time it could be replayed by hand. */
export const WEBHOOK_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/** Tolerance for a provider clock that runs ahead of ours. Without it a provider a
 *  few seconds fast would have every delivery rejected as "from the future". */
export const WEBHOOK_FUTURE_TOLERANCE_MS = 60 * 1000;

/** Constant-time string comparison.
 *
 *  A plain `===` on a signature leaks how many leading characters matched through
 *  timing, which is enough to forge a signature byte by byte given enough attempts.
 *  The length check leaks only length, which is not secret. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Normalise the signature a provider sends.
 *
 *  Providers wrap it differently: bare hex, `sha256=<hex>`, base64, upper or lower
 *  case. Comparison happens on lowercase hex, and anything unrecognised returns null
 *  rather than being coerced into something that might accidentally match. */
export function normalizeSignature(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const withoutPrefix = trimmed.includes('=')
    ? trimmed.slice(trimmed.lastIndexOf('=') + 1).trim()
    : trimmed;

  if (withoutPrefix.length === 0) return null;
  if (!/^[A-Fa-f0-9]+$/.test(withoutPrefix)) return null;

  return withoutPrefix.toLowerCase();
}

/** Parse a provider timestamp header: unix seconds, unix millis, or ISO-8601.
 *
 *  Seconds and millis are told apart by magnitude — anything below 1e11 is seconds,
 *  which stays correct until the year 5138. */
export function parseWebhookTimestamp(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return null;
    return value < 1e11 ? value * 1000 : value;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export interface FreshnessResult {
  ok: boolean;
  code?: 'missing_timestamp' | 'stale_timestamp' | 'future_timestamp';
  ageMs?: number;
}

export function checkFreshness(
  timestampMs: number | null,
  nowMs: number,
  windowMs = WEBHOOK_FRESHNESS_WINDOW_MS
): FreshnessResult {
  if (timestampMs == null) return { ok: false, code: 'missing_timestamp' };

  const ageMs = nowMs - timestampMs;

  // Negative age means the provider's clock is ahead. Tolerated up to a minute;
  // beyond that the timestamp is not trustworthy as a replay defence.
  if (ageMs < -WEBHOOK_FUTURE_TOLERANCE_MS) {
    return { ok: false, code: 'future_timestamp', ageMs };
  }
  if (ageMs > windowMs) {
    return { ok: false, code: 'stale_timestamp', ageMs };
  }

  return { ok: true, ageMs };
}

/** The bytes a signature is computed over.
 *
 *  Timestamp and body are joined with a separator that cannot appear in the
 *  timestamp, so `12.3` + `4body` and `12` + `34body` cannot produce the same input.
 *  Without a separator that ambiguity is a real forgery path. */
export function signaturePayload(timestampRaw: string, rawBody: string): string {
  return `${timestampRaw}.${rawBody}`;
}

export interface VerifyInput {
  rawBody: string;
  signatureHeader: string | null | undefined;
  timestampHeader: string | null | undefined;
  /** HMAC-SHA256 of (payload, secret) as lowercase hex. Injected because the
   *  implementation differs between runtimes (WebCrypto in Deno) and because a pure
   *  function is testable with a stub. */
  computeHmac: (payload: string, secret: string) => string;
  secret: string | null;
  nowMs: number;
  freshnessWindowMs?: number;
}

export type VerifyResult =
  | { ok: true; timestampMs: number }
  | { ok: false; rejection: WebhookRejection };

function reject(code: WebhookRejectionCode, message: string, status: number): VerifyResult {
  return { ok: false, rejection: { code, message, status } };
}

/** Verify signature and freshness.
 *
 *  Order is deliberate: the secret and signature are checked before the timestamp,
 *  so an unauthenticated caller learns nothing about our freshness window. */
export function verifyWebhook(input: VerifyInput): VerifyResult {
  if (input.secret == null || input.secret.length === 0) {
    // Not the sender's fault, but processing an unverifiable event is worse than
    // refusing it: a webhook that changes stock must be proven authentic.
    return reject('no_secret_configured', 'Webhook não configurado para esta conexão.', 401);
  }

  const provided = normalizeSignature(input.signatureHeader);
  if (provided == null) {
    return reject('missing_signature', 'Assinatura ausente ou em formato inesperado.', 401);
  }

  const timestampRaw = (input.timestampHeader ?? '').trim();
  const expected = input.computeHmac(signaturePayload(timestampRaw, input.rawBody), input.secret);

  if (!timingSafeEqual(provided, expected.toLowerCase())) {
    return reject('invalid_signature', 'Assinatura inválida.', 401);
  }

  const timestampMs = parseWebhookTimestamp(timestampRaw);
  const freshness = checkFreshness(timestampMs, input.nowMs, input.freshnessWindowMs);

  if (!freshness.ok) {
    const message =
      freshness.code === 'missing_timestamp'
        ? 'Timestamp ausente: não é possível descartar reenvio.'
        : freshness.code === 'future_timestamp'
          ? 'Timestamp no futuro além da tolerância de relógio.'
          : 'Requisição fora da janela de validade (possível reenvio).';
    // 400, not 401: the signature was valid, so this is a malformed or replayed
    // request rather than an authentication failure.
    return reject(freshness.code!, message, 400);
  }

  return { ok: true, timestampMs: timestampMs! };
}

// ─────────────────────────────────────────────────────────────────────────────
// Event identity
// ─────────────────────────────────────────────────────────────────────────────

/** Stable identity for an event, used as the replay key.
 *
 *  A provider-supplied event id is preferred: it survives payload changes and is
 *  what the provider itself deduplicates on. When absent, the body hash stands in —
 *  weaker, because two genuinely distinct events with identical bodies would collide,
 *  but far better than processing every redelivery. The prefix records which was
 *  used so the ambiguity is visible in the data rather than hidden. */
export function eventIdentity(params: {
  providerEventId: string | null | undefined;
  payloadHash: string;
}): { externalEventId: string; source: 'provider' | 'hash' } {
  const provided = params.providerEventId?.trim();
  if (provided != null && provided.length > 0) {
    return { externalEventId: provided, source: 'provider' };
  }
  return { externalEventId: `hash:${params.payloadHash}`, source: 'hash' };
}

/** Is this Postgres error the replay guard firing?
 *
 *  23505 is unique_violation. Catching it is how replay protection is actually
 *  enforced: the insert races with a concurrent redelivery and the loser is told to
 *  stop, which is correct and must not be reported as a failure. */
export function isDuplicateEventError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe logging
// ─────────────────────────────────────────────────────────────────────────────

/** Keys whose values must never reach a log or a database row.
 *
 *  Matched as substrings and case-insensitively, because providers name them
 *  inconsistently (`access_token`, `accessToken`, `X-Api-Key`) and an exact-match
 *  list would miss the next variant. */
const SENSITIVE_KEY_PATTERNS = [
  'authorization',
  'token',
  'secret',
  'password',
  'senha',
  'apikey',
  'api_key',
  'api-key',
  'credential',
  'signature',
  'cookie',
  'set-cookie',
  'bearer',
  'client_id',
  'client_secret',
  'refresh',
];

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some(pattern => lower.includes(pattern));
}

export const REDACTED = '[redigido]';

/** Recursively strip sensitive values.
 *
 *  Redacts rather than deletes so a log still shows that the field was present —
 *  "we received an authorization header" is useful; its value never is.
 *
 *  Depth-limited because a provider payload can contain a cycle, and an unbounded
 *  walk in a logging path would take down the request it was trying to describe. */
export function redact(value: unknown, depth = 0): unknown {
  const MAX_DEPTH = 6;
  if (depth > MAX_DEPTH) return '[profundidade máxima]';

  if (value == null) return value;
  if (Array.isArray(value)) return value.map(item => redact(item, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redact(inner, depth + 1);
    }
    return out;
  }

  return value;
}

/** Mask a token for display: enough to recognise, not enough to use. */
export function maskSecret(secret: string | null | undefined): string {
  if (secret == null) return REDACTED;
  const trimmed = secret.trim();
  if (trimmed.length < 8) return REDACTED;
  return `${trimmed.slice(0, 2)}…${trimmed.slice(-4)}`;
}

/** One structured, safe log line.
 *
 *  Everything goes through here so no call site has to remember what is sensitive.
 *  `context` is redacted on the way in rather than trusted. */
export interface SafeLogEntry {
  event: string;
  connectionId?: string | null;
  provider?: string | null;
  jobId?: string | null;
  status?: string | number | null;
  durationMs?: number | null;
  errorKind?: string | null;
  message?: string | null;
  context?: Record<string, unknown> | null;
}

export function buildSafeLog(entry: SafeLogEntry): Record<string, unknown> {
  return {
    event: entry.event,
    connectionId: entry.connectionId ?? null,
    provider: entry.provider ?? null,
    jobId: entry.jobId ?? null,
    status: entry.status ?? null,
    durationMs: entry.durationMs ?? null,
    errorKind: entry.errorKind ?? null,
    message: entry.message ?? null,
    context: entry.context == null ? null : (redact(entry.context) as Record<string, unknown>),
  };
}

/** Turn a rejection into the error the engine speaks, so a webhook failure lands in
 *  the same taxonomy as everything else. */
export function rejectionToError(rejection: WebhookRejection): IntegrationError {
  const kind =
    rejection.code === 'invalid_signature' ||
    rejection.code === 'missing_signature' ||
    rejection.code === 'no_secret_configured'
      ? 'AUTH_INVALID'
      : rejection.code === 'duplicate_event'
        ? 'CONFLICT'
        : 'VALIDATION';

  return new IntegrationError({ kind, message: rejection.message, providerCode: rejection.code });
}

// ── Path parsing ────────────────────────────────────────────────────────────
//
// The delivery URL is .../integration-webhook/:providerKey/:connectionId, and the
// connection is resolved from it before anything in the body is trusted. Getting
// this parse wrong is not cosmetic: reading the last two segments blindly means
// a URL missing the connection id yields providerKey='integration-webhook' and
// connectionId='tiny', which reaches the database as a uuid comparison, fails on
// a cast error, and answers 500. A 500 tells the provider "our fault, retry" and
// raises an alert — for what is only a malformed URL. Every bad shape must be a
// 404 here instead.

const FUNCTION_SEGMENT = 'integration-webhook';

/** Matches the canonical 8-4-4-4-12 form. Deliberately strict: the value goes
 *  into a uuid comparison, and rejecting a non-uuid here is what keeps a cast
 *  error from becoming a 500. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WebhookPath {
  providerKey: string;
  connectionId: string;
}

/** Returns null for any shape we cannot serve. The caller answers 404 for null —
 *  one status for "malformed" and "unknown connection" alike, so probing the
 *  endpoint reveals nothing about which connection ids exist. */
export function parseWebhookPath(pathname: string): WebhookPath | null {
  const segments = pathname.split('/').filter(Boolean);

  // Anchor on the function segment rather than counting from the end: the
  // platform may or may not include a /functions/v1 prefix, and anchoring makes
  // the parse independent of that.
  const anchor = segments.lastIndexOf(FUNCTION_SEGMENT);
  if (anchor === -1) return null;

  const providerKey = segments[anchor + 1];
  const connectionId = segments[anchor + 2];

  // Exactly two segments after the anchor. A trailing extra segment means the
  // URL is not one we issued, and guessing which part is the id would be how a
  // delivery lands on the wrong connection.
  if (segments.length !== anchor + 3) return null;
  if (!providerKey || !connectionId) return null;
  if (!UUID_PATTERN.test(connectionId)) return null;

  // Provider keys are lower-case snake in integration_providers. Normalising the
  // case here would let /TINY/ and /tiny/ both resolve; they should not, because
  // the URL is one we generated and a differing case means it was hand-edited.
  if (!/^[a-z0-9_]+$/.test(providerKey)) return null;

  return { providerKey, connectionId };
}
