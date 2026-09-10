import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  WEBHOOK_FRESHNESS_WINDOW_MS,
  buildSafeLog,
  checkFreshness,
  eventIdentity,
  isDuplicateEventError,
  isSensitiveKey,
  maskSecret,
  normalizeSignature,
  parseWebhookPath,
  parseWebhookTimestamp,
  redact,
  rejectionToError,
  signaturePayload,
  timingSafeEqual,
  verifyWebhook,
} from '../webhookVerification';
import {
  ALERT_THRESHOLDS,
  RATE_LIMIT_RESERVE,
  alertsToResolve,
  checkRateLimitGate,
  detectAlerts,
  mergeRateLimit,
  type AlertInput,
  type RateLimitRow,
} from '../../observability/rateLimitState';

const SECRET = 'whsec_super_secreto_1234';
const NOW = Date.parse('2026-08-14T12:00:00.000Z');

/** Real HMAC-SHA256 via WebCrypto, so the tests exercise actual verification rather
 *  than a stub that agrees with itself. WebCrypto rather than node:crypto because it
 *  is what the Edge Function uses — the test therefore mirrors production, and the
 *  app's tsconfig (lib DOM, no node types) can type-check it. */
async function hmacHex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Precompute the digest, then hand verifyWebhook a synchronous accessor — exactly
 *  the shape the Edge Function uses, since WebCrypto is async and verifyWebhook is
 *  not. */
async function signedRequest(over: Partial<{ body: string; timestampMs: number; secret: string }> = {}) {
  const body = over.body ?? JSON.stringify({ topic: 'stock.updated', id: 'evt_1' });
  const timestampMs = over.timestampMs ?? NOW - 1000;
  const timestampRaw = String(Math.floor(timestampMs / 1000));
  const signature = await hmacHex(signaturePayload(timestampRaw, body), over.secret ?? SECRET);
  return { body, timestampRaw, signature };
}

/** Digest for whatever body/timestamp the test is actually sending. */
async function hmacFor(timestampRaw: string, body: string, secret = SECRET) {
  const digest = await hmacHex(signaturePayload(timestampRaw, body), secret);
  return () => digest;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature
// ─────────────────────────────────────────────────────────────────────────────

describe('signature verification', () => {
  it('accepts a correctly signed, fresh request', async () => {
    const { body, timestampRaw, signature } = await signedRequest();
    const result = verifyWebhook({
      rawBody: body, signatureHeader: signature, timestampHeader: timestampRaw,
      computeHmac: await hmacFor(timestampRaw, body), secret: SECRET, nowMs: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const { body, timestampRaw, signature } = await signedRequest();
    const tampered = JSON.stringify({ topic: 'stock.updated', id: 'evt_1', quantity: 99999 });
    const result = verifyWebhook({
      rawBody: tampered,
      signatureHeader: signature, timestampHeader: timestampRaw,
      // Digest of what actually arrived, which is how the endpoint computes it.
      computeHmac: await hmacFor(timestampRaw, tampered), secret: SECRET, nowMs: NOW,
    });
    expect(body).not.toBe(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('invalid_signature');
    expect(result.rejection.status).toBe(401);
  });

  it('rejects a signature made with the wrong secret', async () => {
    const { body, timestampRaw, signature } = await signedRequest({ secret: 'outro_segredo' });
    const result = verifyWebhook({
      rawBody: body, signatureHeader: signature, timestampHeader: timestampRaw,
      computeHmac: await hmacFor(timestampRaw, body, SECRET), secret: SECRET, nowMs: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('invalid_signature');
  });

  it('refuses to process anything when no secret is configured', async () => {
    // Processing an unverifiable event that changes stock is worse than refusing it.
    const { body, timestampRaw, signature } = await signedRequest();
    const result = verifyWebhook({
      rawBody: body, signatureHeader: signature, timestampHeader: timestampRaw,
      computeHmac: () => '', secret: null, nowMs: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('no_secret_configured');
  });

  it('rejects a missing signature before looking at the timestamp', () => {
    // An unauthenticated caller must learn nothing about our freshness window.
    const result = verifyWebhook({
      rawBody: '{}', signatureHeader: null, timestampHeader: 'lixo',
      computeHmac: () => 'deadbeef', secret: SECRET, nowMs: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('missing_signature');
  });

  it('accepts the prefixed formats providers actually send', () => {
    expect(normalizeSignature('sha256=ABCDEF')).toBe('abcdef');
    expect(normalizeSignature('  abcdef  ')).toBe('abcdef');
    expect(normalizeSignature('v1=abc123')).toBe('abc123');
  });

  it('refuses a non-hex signature rather than coercing it', () => {
    expect(normalizeSignature('not-hex!!')).toBeNull();
    expect(normalizeSignature('')).toBeNull();
    expect(normalizeSignature(null)).toBeNull();
    expect(normalizeSignature('sha256=')).toBeNull();
  });

  it('compares in constant time', () => {
    // A plain === leaks how many leading characters matched, which is enough to
    // forge a signature byte by byte.
    expect(timingSafeEqual('abcdef', 'abcdef')).toBe(true);
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
    expect(timingSafeEqual('abc', 'abcdef')).toBe(false);
  });

  it('separates timestamp from body so two inputs cannot collide', () => {
    // Without a separator, ("12.3","4body") and ("12","34body") would hash the same
    // and one signature would validate both.
    expect(signaturePayload('12.3', '4body')).not.toBe(signaturePayload('12', '34body'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Replay
// ─────────────────────────────────────────────────────────────────────────────

describe('replay protection', () => {
  it('rejects a captured request replayed after the window', async () => {
    // A valid signature stays valid forever, so signature alone does not stop replay.
    const { body, timestampRaw, signature } = await signedRequest({
      timestampMs: NOW - WEBHOOK_FRESHNESS_WINDOW_MS - 60_000,
    });
    const result = verifyWebhook({
      rawBody: body, signatureHeader: signature, timestampHeader: timestampRaw,
      computeHmac: await hmacFor(timestampRaw, body), secret: SECRET, nowMs: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('stale_timestamp');
    // 400, not 401: the signature was valid; the request is replayed.
    expect(result.rejection.status).toBe(400);
  });

  it('rejects a request with no timestamp, which cannot be replay-checked', async () => {
    const body = '{}';
    const signature = await hmacHex(signaturePayload('', body), SECRET);
    const result = verifyWebhook({
      rawBody: body, signatureHeader: signature, timestampHeader: '',
      computeHmac: await hmacFor('', body), secret: SECRET, nowMs: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe('missing_timestamp');
  });

  it('tolerates a provider clock slightly ahead', () => {
    expect(checkFreshness(NOW + 30_000, NOW).ok).toBe(true);
  });

  it('rejects a timestamp far in the future', () => {
    expect(checkFreshness(NOW + 10 * 60_000, NOW)).toMatchObject({ code: 'future_timestamp' });
  });

  it('accepts a request at the edge of the window', () => {
    expect(checkFreshness(NOW - WEBHOOK_FRESHNESS_WINDOW_MS, NOW).ok).toBe(true);
    expect(checkFreshness(NOW - WEBHOOK_FRESHNESS_WINDOW_MS - 1, NOW).ok).toBe(false);
  });

  it('parses the timestamp formats providers send', () => {
    expect(parseWebhookTimestamp('1755172800')).toBe(1755172800000);
    expect(parseWebhookTimestamp('1755172800000')).toBe(1755172800000);
    expect(parseWebhookTimestamp('2026-08-14T12:00:00Z')).toBe(NOW);
    expect(parseWebhookTimestamp('amanhã')).toBeNull();
    expect(parseWebhookTimestamp(null)).toBeNull();
  });
});

describe('event identity', () => {
  it('prefers the provider event id, which survives payload changes', () => {
    expect(eventIdentity({ providerEventId: 'evt_99', payloadHash: 'abc' })).toEqual({
      externalEventId: 'evt_99', source: 'provider',
    });
  });

  it('falls back to the body hash, and marks that it did', () => {
    // Weaker — two distinct events with identical bodies would collide — so the
    // ambiguity is visible in the data rather than hidden.
    expect(eventIdentity({ providerEventId: null, payloadHash: 'abc' })).toEqual({
      externalEventId: 'hash:abc', source: 'hash',
    });
    expect(eventIdentity({ providerEventId: '   ', payloadHash: 'abc' }).source).toBe('hash');
  });

  it('recognises the unique-violation that enforces replay protection', () => {
    // The insert racing a concurrent redelivery is correct behaviour, not a failure.
    expect(isDuplicateEventError({ code: '23505' })).toBe(true);
    expect(isDuplicateEventError({ code: '23503' })).toBe(false);
    expect(isDuplicateEventError(null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Safe logging
// ─────────────────────────────────────────────────────────────────────────────

describe('safe logging', () => {
  it('recognises the many names providers give secrets', () => {
    for (const key of [
      'authorization', 'Authorization', 'access_token', 'accessToken', 'X-Api-Key',
      'apikey', 'client_secret', 'refresh_token', 'Cookie', 'senha', 'signature',
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
    expect(isSensitiveKey('quantity')).toBe(false);
    expect(isSensitiveKey('sku')).toBe(false);
  });

  it('redacts nested secrets while keeping the shape', () => {
    const redacted = redact({
      sku: 'ABC-1',
      headers: { authorization: 'Bearer abc.def', 'content-type': 'application/json' },
      auth: { access_token: 'tok_123', refresh_token: 'ref_456' },
    }) as Record<string, unknown>;

    expect(JSON.stringify(redacted)).not.toContain('Bearer');
    expect(JSON.stringify(redacted)).not.toContain('tok_123');
    expect(JSON.stringify(redacted)).not.toContain('ref_456');
    // Presence is useful; the value never is.
    expect((redacted.headers as Record<string, unknown>).authorization).toBe(REDACTED);
    expect((redacted.headers as Record<string, unknown>)['content-type']).toBe('application/json');
    expect(redacted.sku).toBe('ABC-1');
  });

  it('redacts inside arrays', () => {
    const redacted = redact([{ token: 'a' }, { sku: 'b' }]) as Record<string, unknown>[];
    expect(redacted[0].token).toBe(REDACTED);
    expect(redacted[1].sku).toBe('b');
  });

  it('survives a deeply nested or cyclic payload', () => {
    // An unbounded walk in a logging path would take down the request it was
    // describing.
    const cyclic: Record<string, unknown> = { sku: 'A' };
    cyclic.self = cyclic;
    expect(() => JSON.stringify(redact(cyclic))).not.toThrow();
  });

  it('masks a token to something recognisable but useless', () => {
    expect(maskSecret('whsec_super_secreto_1234')).toBe('wh…1234');
    expect(maskSecret('short')).toBe(REDACTED);
    expect(maskSecret(null)).toBe(REDACTED);
  });

  it('never lets a secret through buildSafeLog', () => {
    const log = buildSafeLog({
      event: 'webhook.received',
      connectionId: 'conn-1',
      context: { headers: { authorization: 'Bearer leaked' }, apiKey: 'sk_live_leaked' },
    });
    const serialised = JSON.stringify(log);
    expect(serialised).not.toContain('leaked');
    expect(serialised).toContain('webhook.received');
  });

  it('maps a rejection into the engine error taxonomy', () => {
    expect(rejectionToError({ code: 'invalid_signature', message: 'x', status: 401 }).kind).toBe('AUTH_INVALID');
    expect(rejectionToError({ code: 'duplicate_event', message: 'x', status: 200 }).kind).toBe('CONFLICT');
    expect(rejectionToError({ code: 'stale_timestamp', message: 'x', status: 400 }).kind).toBe('VALIDATION');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting
// ─────────────────────────────────────────────────────────────────────────────

describe('rate limit gate', () => {
  const row = (over: Partial<RateLimitRow> = {}): RateLimitRow => ({
    connectionId: 'c1', operation: '*', remaining: 100, limitValue: 100,
    resetAt: new Date(NOW + 60_000).toISOString(), retryAfterUntil: null,
    observedAt: new Date(NOW).toISOString(), ...over,
  });

  it('proceeds with no stored state', () => {
    expect(checkRateLimitGate(null, NOW)).toEqual({ proceed: true });
  });

  it('proceeds with budget to spare', () => {
    expect(checkRateLimitGate(row(), NOW).proceed).toBe(true);
  });

  it('holds when the budget is nearly gone, keeping a reserve for retries', () => {
    const decision = checkRateLimitGate(row({ remaining: RATE_LIMIT_RESERVE }), NOW);
    expect(decision.proceed).toBe(false);
    if (decision.proceed) return;
    expect(decision.reason).toBe('budget_exhausted');
    expect(decision.waitMs).toBe(60_000);
  });

  it('obeys an explicit back-off instruction above everything else', () => {
    const decision = checkRateLimitGate(
      row({ remaining: 100, retryAfterUntil: new Date(NOW + 30_000).toISOString() }),
      NOW
    );
    expect(decision).toEqual({ proceed: false, reason: 'retry_after', waitMs: 30_000 });
  });

  it('ignores a back-off that has already elapsed', () => {
    expect(
      checkRateLimitGate(row({ retryAfterUntil: new Date(NOW - 1000).toISOString() }), NOW).proceed
    ).toBe(true);
  });

  it('ignores a remaining count from an expired window', () => {
    // Refusing to call because of a number from a window that already reset would
    // stall the integration for no reason.
    expect(
      checkRateLimitGate(row({ remaining: 0, resetAt: new Date(NOW - 1000).toISOString() }), NOW).proceed
    ).toBe(true);
  });

  it('proceeds when the budget is spent but no reset time is known', () => {
    // A 429 is recoverable; an integration frozen forever on a stale count is not.
    expect(checkRateLimitGate(row({ remaining: 0, resetAt: null }), NOW).proceed).toBe(true);
  });
});

describe('mergeRateLimit', () => {
  it('records what the provider reported', () => {
    const merged = mergeRateLimit(null, { remaining: 42, limit: 60, resetAt: NOW + 30_000 }, {
      connectionId: 'c1', operation: '*', nowMs: NOW,
    });
    expect(merged).toMatchObject({ remaining: 42, limitValue: 60 });
    expect(merged.resetAt).toBe(new Date(NOW + 30_000).toISOString());
  });

  it('lets a window reset raise the remaining count', () => {
    // Keeping the minimum would leave the connection throttled by its worst moment.
    const previous: RateLimitRow = {
      connectionId: 'c1', operation: '*', remaining: 1, limitValue: 60,
      resetAt: null, retryAfterUntil: null, observedAt: new Date(NOW - 60_000).toISOString(),
    };
    expect(mergeRateLimit(previous, { remaining: 60 }, { connectionId: 'c1', operation: '*', nowMs: NOW }).remaining)
      .toBe(60);
  });

  it('converts a Retry-After into an absolute instant', () => {
    const merged = mergeRateLimit(null, { retryAfterMs: 45_000 }, {
      connectionId: 'c1', operation: '*', nowMs: NOW,
    });
    expect(merged.retryAfterUntil).toBe(new Date(NOW + 45_000).toISOString());
  });

  it('keeps prior state when the provider reported nothing', () => {
    const previous: RateLimitRow = {
      connectionId: 'c1', operation: '*', remaining: 5, limitValue: 60,
      resetAt: null, retryAfterUntil: null, observedAt: new Date(NOW).toISOString(),
    };
    expect(mergeRateLimit(previous, null, { connectionId: 'c1', operation: '*', nowMs: NOW }))
      .toEqual(previous);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Alerts
// ─────────────────────────────────────────────────────────────────────────────

describe('alert detection', () => {
  const healthy: AlertInput = {
    connectionId: 'c1', status: 'active', autoSyncEnabled: true, syncIntervalMinutes: 60,
    lastSuccessfulSyncAt: new Date(NOW - 30 * 60_000).toISOString(),
    credentialExpiresAt: null, consecutiveFailures: 0, lastErrorKind: null,
    pendingConflicts: 0, unprocessedWebhooks: 0, unmappedDeposits: [],
    rateLimit: null, nowMs: NOW,
  };

  it('says nothing about a healthy integration', () => {
    expect(detectAlerts(healthy)).toEqual([]);
  });

  it('does not alert on a single failure', () => {
    // Alerting on the first failure trains people to ignore alerts.
    expect(detectAlerts({ ...healthy, consecutiveFailures: 1 })).toEqual([]);
  });

  it('warns after three consecutive failures and escalates at six', () => {
    const warning = detectAlerts({ ...healthy, consecutiveFailures: ALERT_THRESHOLDS.consecutiveFailures });
    expect(warning[0]).toMatchObject({ kind: 'sync_failing', severity: 'warning' });

    const critical = detectAlerts({ ...healthy, consecutiveFailures: ALERT_THRESHOLDS.criticalConsecutiveFailures });
    expect(critical[0]).toMatchObject({ kind: 'sync_failing', severity: 'critical' });
  });

  it('flags an expired credential as critical', () => {
    const alerts = detectAlerts({ ...healthy, credentialExpiresAt: new Date(NOW - 1000).toISOString() });
    expect(alerts).toContainEqual(expect.objectContaining({ kind: 'credential_expired', severity: 'critical' }));
  });

  it('does not flag a credential that is still valid', () => {
    expect(detectAlerts({ ...healthy, credentialExpiresAt: new Date(NOW + 86_400_000).toISOString() }))
      .toEqual([]);
  });

  it('flags a quietly dead auto-sync', () => {
    // Worse than one that fails loudly, because nobody notices.
    const alerts = detectAlerts({
      ...healthy,
      lastSuccessfulSyncAt: new Date(NOW - 10 * 60 * 60_000).toISOString(),
    });
    expect(alerts).toContainEqual(expect.objectContaining({ kind: 'stale_sync' }));
  });

  it('does not flag staleness on a manual connection', () => {
    // Not syncing is a choice there, not a fault.
    expect(
      detectAlerts({ ...healthy, autoSyncEnabled: false, lastSuccessfulSyncAt: null })
    ).toEqual([]);
  });

  it('flags an auto-sync that never once succeeded', () => {
    const alerts = detectAlerts({ ...healthy, lastSuccessfulSyncAt: null });
    expect(alerts).toContainEqual(expect.objectContaining({ kind: 'stale_sync' }));
  });

  it('reports every condition at once, not just the first', () => {
    // An integration can be rate-limited AND have a review queue.
    const alerts = detectAlerts({
      ...healthy,
      status: 'error',
      consecutiveFailures: 8,
      pendingConflicts: 50,
      unprocessedWebhooks: 9,
      unmappedDeposits: ['AZ CD NOVO'],
      rateLimit: {
        connectionId: 'c1', operation: '*', remaining: 0,
        limitValue: 60, resetAt: new Date(NOW + 60_000).toISOString(),
        retryAfterUntil: null, observedAt: new Date(NOW).toISOString(),
      },
    });
    const kinds = alerts.map(alert => alert.kind).sort();
    expect(kinds).toEqual([
      'integration_offline', 'pending_conflicts', 'rate_limited',
      'sync_failing', 'unmapped_deposits', 'webhook_broken',
    ]);
  });

  it('names the unmapped deposits, which is what makes the alert actionable', () => {
    const alerts = detectAlerts({ ...healthy, unmappedDeposits: ['AZ CD NOVO', 'GOCASE X'] });
    const alert = alerts.find(a => a.kind === 'unmapped_deposits');
    expect(alert?.context.deposits).toEqual(['AZ CD NOVO', 'GOCASE X']);
  });

  it('never puts a payload or credential in alert context', () => {
    const alerts = detectAlerts({ ...healthy, consecutiveFailures: 5, lastErrorKind: 'AUTH_INVALID' });
    expect(JSON.stringify(alerts)).not.toMatch(/token|secret|password/i);
  });
});

describe('alertsToResolve', () => {
  it('resolves an alert once the condition clears', () => {
    // An alert that stays open after the fix teaches people that alerts are noise.
    expect(alertsToResolve(['sync_failing', 'rate_limited'], [
      { kind: 'rate_limited', severity: 'warning', message: '', context: {} },
    ])).toEqual(['sync_failing']);
  });

  it('resolves everything when nothing is detected', () => {
    expect(alertsToResolve(['sync_failing'], [])).toEqual(['sync_failing']);
  });

  it('resolves nothing when everything is still true', () => {
    expect(alertsToResolve(['sync_failing'], [
      { kind: 'sync_failing', severity: 'critical', message: '', context: {} },
    ])).toEqual([]);
  });
});

describe('webhook path parsing', () => {
  const UUID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

  it('parses the canonical delivery URL', () => {
    expect(parseWebhookPath(`/integration-webhook/tiny/${UUID}`)).toEqual({
      providerKey: 'tiny',
      connectionId: UUID,
    });
  });

  it('parses the URL with the platform prefix', () => {
    // The runtime may or may not include /functions/v1; anchoring on the function
    // segment makes the parse independent of that.
    expect(parseWebhookPath(`/functions/v1/integration-webhook/tiny/${UUID}`)).toEqual({
      providerKey: 'tiny',
      connectionId: UUID,
    });
  });

  it('tolerates a trailing slash', () => {
    expect(parseWebhookPath(`/integration-webhook/tiny/${UUID}/`)).toEqual({
      providerKey: 'tiny',
      connectionId: UUID,
    });
  });

  it('rejects a URL with no connection id', () => {
    // The regression this parser exists for: reading the last two segments made
    // this providerKey='integration-webhook', connectionId='tiny', which reached
    // the database as a uuid comparison and answered 500.
    expect(parseWebhookPath('/integration-webhook/tiny')).toBeNull();
  });

  it('rejects the bare function path', () => {
    expect(parseWebhookPath('/integration-webhook')).toBeNull();
    expect(parseWebhookPath('/functions/v1/integration-webhook')).toBeNull();
  });

  it('rejects a connection id that is not a uuid', () => {
    // Strict on purpose: this value goes into a uuid comparison, and rejecting it
    // here is what keeps a cast error from becoming a 500 the provider retries.
    expect(parseWebhookPath('/integration-webhook/tiny/nao-e-uuid')).toBeNull();
    expect(parseWebhookPath('/integration-webhook/tiny/123')).toBeNull();
    expect(parseWebhookPath(`/integration-webhook/tiny/${UUID}x`)).toBeNull();
  });

  it('rejects an extra trailing segment', () => {
    // Guessing which part is the id is how a delivery lands on the wrong connection.
    expect(parseWebhookPath(`/integration-webhook/tiny/${UUID}/extra`)).toBeNull();
  });

  it('rejects a path that never names the function', () => {
    expect(parseWebhookPath(`/outra-funcao/tiny/${UUID}`)).toBeNull();
    expect(parseWebhookPath('/')).toBeNull();
    expect(parseWebhookPath('')).toBeNull();
  });

  it('rejects a provider key that is not lower snake case', () => {
    // The URL is one we generated; a differing case means it was hand-edited.
    expect(parseWebhookPath(`/integration-webhook/TINY/${UUID}`)).toBeNull();
    expect(parseWebhookPath(`/integration-webhook/ti-ny/${UUID}`)).toBeNull();
    expect(parseWebhookPath(`/integration-webhook/../${UUID}`)).toBeNull();
  });

  it('accepts an underscored provider key', () => {
    expect(parseWebhookPath(`/integration-webhook/mercado_livre/${UUID}`)?.providerKey).toBe(
      'mercado_livre'
    );
  });

  it('accepts an uppercase uuid without changing it', () => {
    // Postgres compares uuids by value, so case does not matter for the lookup —
    // but the value is passed through unmodified rather than normalised, so what
    // gets logged is what arrived.
    const upper = UUID.toUpperCase();
    expect(parseWebhookPath(`/integration-webhook/tiny/${upper}`)?.connectionId).toBe(upper);
  });

  it('anchors on the last occurrence of the function segment', () => {
    // A provider that echoes our path inside its own must not shift the parse.
    expect(
      parseWebhookPath(`/integration-webhook/integration-webhook/tiny/${UUID}`)
    ).toEqual({ providerKey: 'tiny', connectionId: UUID });
  });
});
