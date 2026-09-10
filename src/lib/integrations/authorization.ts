// Authorization decisions for the integration endpoints.
//
// These are the checks that stand between a request and a customer's ERP. They
// used to live inline inside the Edge Function, where no test could reach them —
// which is the wrong place for the most security-sensitive branching in the
// feature. Here they are pure functions over plain facts, so every denial path
// has a test.
//
// ── What this module is NOT ──────────────────────────────────────────────────
// It is not the security barrier. RLS is. A cross-tenant connection id is not
// "denied" by code here — it arrives as `connection: null` because the row was
// never visible to the caller's JWT in the first place, and we turn that into a
// 404. If this module were bypassed entirely, the database would still refuse.
// It exists to make the *responses* correct and consistent, and to keep the
// ordering of the checks explicit and verifiable.
//
// ── Why four functions instead of one ────────────────────────────────────────
// The order matters and is enforced by the shape: the caller cannot check the
// credential before it has authorised the connection, because it has no
// credential to pass until it has done the connection lookup. A single function
// taking every fact at once would have required fetching the credential before
// knowing whether the caller may touch the connection at all — exactly the
// mistake this split makes impossible.

/** A refusal, ready to become an HTTP response. `code` is stable and meant for
 *  logs and tests; `message` is customer-facing Portuguese. */
export interface AuthorizationDenial {
  status: number;
  code: string;
  message: string;
}

/** Roles allowed to run a sync. A viewer or operator can see integration state
 *  but cannot make the system talk to the ERP. */
export const SYNC_ROLES = ['owner', 'admin', 'manager'] as const;

function deny(status: number, code: string, message: string): AuthorizationDenial {
  return { status, code, message };
}

// ── 1. Caller ───────────────────────────────────────────────────────────────

export interface CallerFacts {
  /** Presence of the Authorization header. Absent means the request never even
   *  claimed an identity. */
  hasAuthHeader: boolean;
  /** Resolved user id, or null when the JWT was missing, malformed or expired.
   *  A non-null value here is the only proof of authentication we accept —
   *  never a user id sent in the body. */
  sessionUserId: string | null;
  /** Role from get_my_role(), or null when the RPC failed or the profile has none. */
  role: string | null;
}

/** Authentication, then authorization. Returns null when the caller may proceed. */
export function authorizeCaller(facts: CallerFacts): AuthorizationDenial | null {
  if (!facts.hasAuthHeader) {
    return deny(401, 'missing_auth_header', 'Não autenticado.');
  }
  if (!facts.sessionUserId) {
    return deny(401, 'invalid_session', 'Sessão inválida ou expirada. Faça login novamente.');
  }
  // A null role is refused rather than defaulted. Defaulting a missing role to
  // anything is how privilege gaps happen; an absent role means we do not know
  // who this is, and not knowing is a denial.
  if (!facts.role || !(SYNC_ROLES as readonly string[]).includes(facts.role)) {
    return deny(403, 'role_not_allowed', 'Apenas owner, admin ou manager podem sincronizar integrações.');
  }
  return null;
}

// ── 2. Request shape ────────────────────────────────────────────────────────

/** A single request's direction. Narrower than the engine-wide `SyncDirection`,
 *  which also has `bidirectional` — a connection can be bidirectional, but one
 *  request always moves data one way. Keeping them distinct types means an
 *  'bidirectional' can never arrive where a concrete direction is required. */
export type SyncRequestDirection = 'inbound' | 'outbound';

export interface ParsedSyncRequest {
  connectionId: string;
  direction: SyncRequestDirection;
  syncType: string;
  dryRun: boolean;
}

const SYNC_TYPES = ['manual', 'full', 'incremental', 'scheduled', 'webhook'] as const;

/** Validate the body before any lookup. Rejecting a malformed request early
 *  means an attacker cannot use a probe with a broken body to learn whether a
 *  connection id exists. */
export function parseSyncRequest(body: unknown): AuthorizationDenial | ParsedSyncRequest {
  const raw = (body ?? {}) as Record<string, unknown>;

  const connectionId = typeof raw.connectionId === 'string' ? raw.connectionId.trim() : '';
  if (!connectionId) {
    return deny(400, 'missing_connection_id', 'connectionId é obrigatório.');
  }

  const direction = typeof raw.direction === 'string' ? raw.direction : 'inbound';
  if (direction !== 'inbound' && direction !== 'outbound') {
    return deny(400, 'invalid_direction', 'direction deve ser inbound ou outbound.');
  }

  const syncType = typeof raw.syncType === 'string' ? raw.syncType : 'manual';
  if (!(SYNC_TYPES as readonly string[]).includes(syncType)) {
    return deny(400, 'invalid_sync_type', `syncType inválido: ${syncType}.`);
  }

  // Strict equality, not truthiness: `dryRun: "false"` is a string and truthy,
  // and reading it as "yes, dry run" would silently skip a real sync the customer
  // asked for. Anything that is not literally true means write for real.
  return { connectionId, direction, syncType, dryRun: raw.dryRun === true };
}

// ── 3. Connection ───────────────────────────────────────────────────────────

export interface ConnectionFacts {
  id: string;
  status: string;
  sync_direction: string;
  credentials_set_at: string | null;
}

export interface ConnectionAuthorizationInput {
  /** The row as fetched under the caller's RLS. **null means either "no such
   *  connection" or "belongs to another tenant"** — the two are indistinguishable
   *  from here, which is exactly right: telling them apart would confirm the
   *  existence of another tenant's connection id. */
  connection: ConnectionFacts | null;
  direction: SyncRequestDirection;
  /** Whether a connector is registered for this provider. */
  connectorAvailable: boolean;
}

export function authorizeConnection(input: ConnectionAuthorizationInput): AuthorizationDenial | null {
  const { connection } = input;

  if (!connection) {
    return deny(404, 'connection_not_found', 'Conexão não encontrada.');
  }
  if (connection.status === 'revoked') {
    return deny(409, 'connection_revoked', 'Esta conexão foi revogada. Reconecte antes de sincronizar.');
  }
  if (connection.credentials_set_at == null) {
    return deny(409, 'credential_not_set', 'Configure a credencial desta conexão antes de sincronizar.');
  }

  // The write barrier. The capability gate in the adapter refuses this too, and
  // the redundancy is deliberate: this is the check that protects a customer's
  // ERP balance from a mistaken outbound call, so it does not rely on a single
  // layer being correct.
  if (input.direction === 'outbound' && connection.sync_direction === 'inbound') {
    return deny(
      409,
      'connection_read_only',
      'Esta conexão é somente de leitura. Habilite a escrita antes de enviar dados ao provedor.'
    );
  }

  if (!input.connectorAvailable) {
    return deny(501, 'connector_not_implemented', 'Este provedor ainda não tem conector implementado.');
  }

  return null;
}

// ── 4. Credential ───────────────────────────────────────────────────────────

export interface CredentialFacts {
  /** Whether a non-empty secret came back. The secret itself is never passed to
   *  this module — there is no reason for a decision function to hold it, and
   *  not holding it means it cannot end up in a thrown error or a log line. */
  hasSecret: boolean;
  expiresAt: string | null;
}

/** `nowMs` is injected rather than read from the clock so expiry is testable at
 *  an exact boundary. */
export function authorizeCredential(
  credential: CredentialFacts | null,
  nowMs: number
): AuthorizationDenial | null {
  if (!credential?.hasSecret) {
    return deny(409, 'credential_missing', 'Credencial não encontrada. Configure-a novamente.');
  }

  if (credential.expiresAt != null) {
    const expiresAtMs = Date.parse(credential.expiresAt);
    // An unparseable expiry is treated as expired. The alternative — ignoring it
    // and using the secret — trusts a value we failed to understand, and the cost
    // of a needless reconnect is far below the cost of calling an ERP with a
    // credential whose validity we cannot establish.
    if (Number.isNaN(expiresAtMs) || expiresAtMs < nowMs) {
      return deny(409, 'credential_expired', 'A credencial desta conexão expirou. Reconecte para renovar.');
    }
  }

  return null;
}
