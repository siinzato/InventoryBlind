// Integration Engine — error taxonomy.
//
// A provider's error shape never reaches the Core. Everything becomes an
// IntegrationError with a kind the engine can reason about, because the only
// question the engine ever asks is "is it worth trying this again", and an HTTP
// status string cannot answer that.
//
// The default for anything unrecognised is PERMANENT. Retrying a failure we do
// not understand is how a bad request becomes a thousand bad requests and an
// account gets rate-limited or suspended.

export type IntegrationErrorKind =
  // ── Permanent: the same request will fail the same way ────────────────────
  | 'AUTH_INVALID'          // wrong/revoked credential — a human must fix it
  | 'AUTH_EXPIRED'          // token expired; retry only AFTER a refresh
  | 'PERMISSION_DENIED'     // credential is valid but lacks the scope
  | 'NOT_FOUND'             // the external record does not exist
  | 'VALIDATION'            // provider rejected the payload (400/422)
  | 'CONFLICT'              // provider state disallows it (409)
  | 'UNSUPPORTED_OPERATION' // capability gate, or provider dropped the endpoint
  | 'NORMALIZATION_FAILED'  // provider payload could not be trusted
  | 'MAPPING_AMBIGUOUS'     // two internal rows matched; a human must decide
  | 'CONFIGURATION'         // connection is misconfigured (no credential, etc.)
  // ── Temporary: the same request may succeed later ─────────────────────────
  | 'RATE_LIMITED'          // 429
  | 'PROVIDER_UNAVAILABLE'  // 500/502/503/504
  | 'TIMEOUT'
  | 'NETWORK'
  // ── Unknown: treated as permanent on purpose ──────────────────────────────
  | 'UNKNOWN';

const TEMPORARY_KINDS: ReadonlySet<IntegrationErrorKind> = new Set([
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT',
  'NETWORK',
]);

export interface IntegrationErrorInit {
  kind: IntegrationErrorKind;
  message: string;
  /** Provider's own code/status, kept for support tickets. Never a credential. */
  providerCode?: string | null;
  /** Provider's request id, when it returns one — the single most useful thing
   *  to quote when asking their support what happened. */
  externalRequestId?: string | null;
  /** From a 429/503 `Retry-After`. Honoured by the retry policy instead of the
   *  computed backoff, because the provider's number is authoritative. */
  retryAfterMs?: number | null;
  /** Safe, non-sensitive context. Connectors must redact before populating. */
  details?: Record<string, unknown> | null;
  cause?: unknown;
}

export class IntegrationError extends Error {
  readonly kind: IntegrationErrorKind;
  readonly providerCode: string | null;
  readonly externalRequestId: string | null;
  readonly retryAfterMs: number | null;
  readonly details: Record<string, unknown> | null;
  /** Stored as `underlying` rather than `cause`.
   *
   *  `cause` collides with the standard Error.cause: Deno's lib declares it and
   *  requires an `override` modifier, while the browser build targets lib ES2020
   *  where it does not exist and `override` would then be an error. Shadowing a
   *  standard member to satisfy one runtime and break the other is not worth the
   *  familiar name — the constructor still accepts `cause`, so callers read the
   *  same. This only surfaced under `deno check`, which is why that runs before
   *  every function deploy. */
  readonly underlying?: unknown;

  constructor(init: IntegrationErrorInit) {
    super(init.message);
    this.name = 'IntegrationError';
    this.kind = init.kind;
    this.providerCode = init.providerCode ?? null;
    this.externalRequestId = init.externalRequestId ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.details = init.details ?? null;
    this.underlying = init.cause;
  }

  /** Whether trying the identical request again could plausibly succeed. */
  get retryable(): boolean {
    return TEMPORARY_KINDS.has(this.kind);
  }

  /** Retryable, but only after refreshing the credential first — a plain retry
   *  would fail identically. Kept separate from `retryable` so the retry loop
   *  cannot accidentally spin on an expired token. */
  get needsCredentialRefresh(): boolean {
    return this.kind === 'AUTH_EXPIRED';
  }

  /** Shape written to integration_sync_runs.error_message and shown to the user.
   *  Deliberately excludes `cause` and `details`, which may carry request context
   *  a connector forgot to redact. */
  toSafeLog(): { kind: IntegrationErrorKind; message: string; providerCode: string | null; externalRequestId: string | null } {
    return {
      kind: this.kind,
      message: this.message,
      providerCode: this.providerCode,
      externalRequestId: this.externalRequestId,
    };
  }
}

export function isIntegrationError(value: unknown): value is IntegrationError {
  return value instanceof IntegrationError;
}

/** HTTP status to error kind.
 *
 *  401 vs 403 is a real distinction and gets one: 401 means the credential is
 *  wrong, 403 means it is right but not permitted. Telling a customer to
 *  re-enter a working token because we collapsed the two wastes their time. */
export function kindFromHttpStatus(status: number): IntegrationErrorKind {
  if (status === 401) return 'AUTH_INVALID';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 408) return 'TIMEOUT';
  if (status === 409) return 'CONFLICT';
  if (status === 422 || status === 400) return 'VALIDATION';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 501) return 'UNSUPPORTED_OPERATION';
  if (status >= 500) return 'PROVIDER_UNAVAILABLE';
  if (status >= 400) return 'VALIDATION';
  return 'UNKNOWN';
}

/** Parse a `Retry-After` header. Accepts both forms the spec allows: seconds, or
 *  an HTTP date. A malformed value yields null so the caller falls back to
 *  computed backoff rather than waiting forever or not at all. */
export function parseRetryAfter(header: string | null | undefined, nowMs: number): number | null {
  if (header == null) return null;
  const raw = header.trim();
  if (raw.length === 0) return null;

  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }

  const asDate = Date.parse(raw);
  if (Number.isNaN(asDate)) return null;
  // A date already in the past means "you may retry now", not a negative wait.
  return Math.max(0, asDate - nowMs);
}

export function errorFromHttp(params: {
  status: number;
  message?: string;
  providerCode?: string | null;
  externalRequestId?: string | null;
  retryAfterHeader?: string | null;
  nowMs?: number;
}): IntegrationError {
  const kind = kindFromHttpStatus(params.status);
  return new IntegrationError({
    kind,
    message: params.message ?? `Provider respondeu HTTP ${params.status}.`,
    providerCode: params.providerCode ?? String(params.status),
    externalRequestId: params.externalRequestId ?? null,
    retryAfterMs: parseRetryAfter(params.retryAfterHeader, params.nowMs ?? 0),
  });
}

/** Last-resort conversion for anything thrown that is not already an
 *  IntegrationError — a fetch rejection, a TypeError in a connector, a string.
 *  Network-ish failures are classified as NETWORK (temporary); everything else
 *  lands on UNKNOWN and therefore will not be retried. */
export function toIntegrationError(thrown: unknown): IntegrationError {
  if (isIntegrationError(thrown)) return thrown;

  if (thrown instanceof Error) {
    const name = thrown.name.toLowerCase();
    const message = thrown.message.toLowerCase();

    if (name === 'aborterror' || message.includes('timeout') || message.includes('timed out')) {
      return new IntegrationError({ kind: 'TIMEOUT', message: thrown.message, cause: thrown });
    }
    if (
      name === 'typeerror' && (message.includes('fetch') || message.includes('network')) ||
      message.includes('econnreset') ||
      message.includes('enotfound') ||
      message.includes('socket hang up')
    ) {
      return new IntegrationError({ kind: 'NETWORK', message: thrown.message, cause: thrown });
    }
    return new IntegrationError({ kind: 'UNKNOWN', message: thrown.message, cause: thrown });
  }

  return new IntegrationError({
    kind: 'UNKNOWN',
    message: typeof thrown === 'string' ? thrown : 'Erro desconhecido na integração.',
    cause: thrown,
  });
}

/** User-facing message in pt-BR. The engine's kinds are internal; this is what a
 *  warehouse manager reads, and each one says what to do rather than what broke. */
export function describeError(error: IntegrationError): string {
  switch (error.kind) {
    case 'AUTH_INVALID':
      return 'Credencial inválida ou revogada. Gere uma nova chave no provedor e salve novamente.';
    case 'AUTH_EXPIRED':
      return 'A autorização expirou. Reconecte esta loja para renovar o acesso.';
    case 'PERMISSION_DENIED':
      return 'A credencial é válida, mas não tem permissão para esta operação. Verifique os escopos no provedor.';
    case 'NOT_FOUND':
      return 'O registro não existe mais no provedor.';
    case 'VALIDATION':
      return 'O provedor recusou os dados enviados. Confira o mapeamento desta conexão.';
    case 'CONFLICT':
      return 'O provedor recusou a operação pelo estado atual do registro.';
    case 'UNSUPPORTED_OPERATION':
      return 'Esta operação não é suportada por este provedor.';
    case 'NORMALIZATION_FAILED':
      return 'O provedor devolveu um registro incompleto e ele foi ignorado.';
    case 'MAPPING_AMBIGUOUS':
      return 'Mais de um produto interno corresponde a este registro. Resolva o vínculo manualmente.';
    case 'CONFIGURATION':
      return 'Conexão incompleta. Configure a credencial antes de sincronizar.';
    case 'RATE_LIMITED':
      return 'Limite de requisições do provedor atingido. A sincronização será retomada automaticamente.';
    case 'PROVIDER_UNAVAILABLE':
      return 'O provedor está indisponível no momento. Nova tentativa em instantes.';
    case 'TIMEOUT':
      return 'O provedor não respondeu no tempo esperado. Nova tentativa em instantes.';
    case 'NETWORK':
      return 'Falha de rede ao contatar o provedor. Nova tentativa em instantes.';
    case 'UNKNOWN':
      return 'Falha inesperada na integração. O erro foi registrado para análise.';
  }
}
