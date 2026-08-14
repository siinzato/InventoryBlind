import { describe, expect, it } from 'vitest';
import {
  authorizeCaller,
  authorizeConnection,
  authorizeCredential,
  parseSyncRequest,
  SYNC_ROLES,
  type ConnectionFacts,
} from '../authorization';

const NOW = Date.parse('2026-08-14T12:00:00.000Z');

function connection(overrides: Partial<ConnectionFacts> = {}): ConnectionFacts {
  return {
    id: 'conn-1',
    status: 'active',
    sync_direction: 'bidirectional',
    credentials_set_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('authorizeCaller', () => {
  it('refuses a request with no Authorization header', () => {
    const denial = authorizeCaller({ hasAuthHeader: false, sessionUserId: null, role: 'owner' });
    expect(denial).toMatchObject({ status: 401, code: 'missing_auth_header' });
  });

  it('refuses an invalid or expired token', () => {
    // Header present, but the JWT did not resolve to a user — the shape of an
    // expired session or a forged token.
    const denial = authorizeCaller({ hasAuthHeader: true, sessionUserId: null, role: 'owner' });
    expect(denial).toMatchObject({ status: 401, code: 'invalid_session' });
  });

  it('does not accept a role sent without a session', () => {
    // The whole point: claiming 'owner' proves nothing without a valid JWT.
    expect(authorizeCaller({ hasAuthHeader: true, sessionUserId: null, role: 'owner' })?.status).toBe(401);
  });

  it('refuses a null role instead of defaulting it', () => {
    const denial = authorizeCaller({ hasAuthHeader: true, sessionUserId: 'u1', role: null });
    expect(denial).toMatchObject({ status: 403, code: 'role_not_allowed' });
  });

  it.each(['viewer', 'operator', 'counter', '', 'OWNER', 'owner ', 'admin;'])(
    'refuses role %j',
    role => {
      expect(authorizeCaller({ hasAuthHeader: true, sessionUserId: 'u1', role })?.status).toBe(403);
    }
  );

  it.each([...SYNC_ROLES])('allows role %s', role => {
    expect(authorizeCaller({ hasAuthHeader: true, sessionUserId: 'u1', role })).toBeNull();
  });

  it('checks authentication before authorization', () => {
    // A missing header with a disallowed role must report 401, not 403: answering
    // 403 would confirm that the endpoint evaluated a role for an anonymous caller.
    const denial = authorizeCaller({ hasAuthHeader: false, sessionUserId: null, role: 'viewer' });
    expect(denial?.status).toBe(401);
  });
});

describe('parseSyncRequest', () => {
  it('requires a connectionId', () => {
    expect(parseSyncRequest({})).toMatchObject({ status: 400, code: 'missing_connection_id' });
  });

  it('treats a whitespace-only connectionId as missing', () => {
    expect(parseSyncRequest({ connectionId: '   ' })).toMatchObject({ code: 'missing_connection_id' });
  });

  it('survives a null body', () => {
    // req.json() returns null on an unparseable body; that must be a 400, not a throw.
    expect(parseSyncRequest(null)).toMatchObject({ status: 400 });
  });

  it('defaults direction to inbound', () => {
    expect(parseSyncRequest({ connectionId: 'c1' })).toMatchObject({ direction: 'inbound' });
  });

  it('refuses an unknown direction', () => {
    expect(parseSyncRequest({ connectionId: 'c1', direction: 'both' })).toMatchObject({
      status: 400,
      code: 'invalid_direction',
    });
  });

  it('refuses an unknown syncType', () => {
    expect(parseSyncRequest({ connectionId: 'c1', syncType: 'nightly' })).toMatchObject({
      code: 'invalid_sync_type',
    });
  });

  it('reads dryRun only from a literal true', () => {
    // 'false' and 1 are both truthy. Reading either as "dry run" would silently
    // skip a real sync the customer asked for.
    expect(parseSyncRequest({ connectionId: 'c1', dryRun: 'false' })).toMatchObject({ dryRun: false });
    expect(parseSyncRequest({ connectionId: 'c1', dryRun: 1 })).toMatchObject({ dryRun: false });
    expect(parseSyncRequest({ connectionId: 'c1', dryRun: true })).toMatchObject({ dryRun: true });
  });

  it('ignores unknown fields rather than trusting them', () => {
    const parsed = parseSyncRequest({ connectionId: 'c1', companyId: 'other-tenant', role: 'owner' });
    expect(parsed).toEqual({ connectionId: 'c1', direction: 'inbound', syncType: 'manual', dryRun: false });
  });
});

describe('authorizeConnection — tenant isolation', () => {
  it('answers 404 for a connection the caller cannot see', () => {
    // A connection belonging to another company is invisible under RLS, so it
    // arrives here as null. 404 and not 403: a 403 would confirm the id exists.
    const denial = authorizeConnection({ connection: null, direction: 'inbound', connectorAvailable: true });
    expect(denial).toMatchObject({ status: 404, code: 'connection_not_found' });
  });

  it('gives a cross-tenant id and a nonexistent id the same answer', () => {
    const crossTenant = authorizeConnection({ connection: null, direction: 'inbound', connectorAvailable: true });
    const nonexistent = authorizeConnection({ connection: null, direction: 'outbound', connectorAvailable: false });
    expect(crossTenant?.status).toBe(nonexistent?.status);
    expect(crossTenant?.code).toBe(nonexistent?.code);
  });

  it('does not leak the provider name for an invisible connection', () => {
    const denial = authorizeConnection({ connection: null, direction: 'inbound', connectorAvailable: false });
    expect(denial?.code).toBe('connection_not_found');
  });
});

describe('authorizeConnection — connection state', () => {
  it('allows a healthy connection', () => {
    expect(
      authorizeConnection({ connection: connection(), direction: 'inbound', connectorAvailable: true })
    ).toBeNull();
  });

  it('refuses a revoked connection', () => {
    const denial = authorizeConnection({
      connection: connection({ status: 'revoked' }),
      direction: 'inbound',
      connectorAvailable: true,
    });
    expect(denial).toMatchObject({ status: 409, code: 'connection_revoked' });
  });

  it('refuses a connection whose credential was never set', () => {
    const denial = authorizeConnection({
      connection: connection({ credentials_set_at: null }),
      direction: 'inbound',
      connectorAvailable: true,
    });
    expect(denial).toMatchObject({ code: 'credential_not_set' });
  });

  it('refuses an outbound sync on a read-only connection', () => {
    // The barrier that protects a customer ERP balance from a mistaken write.
    const denial = authorizeConnection({
      connection: connection({ sync_direction: 'inbound' }),
      direction: 'outbound',
      connectorAvailable: true,
    });
    expect(denial).toMatchObject({ status: 409, code: 'connection_read_only' });
  });

  it('allows inbound on a read-only connection', () => {
    expect(
      authorizeConnection({
        connection: connection({ sync_direction: 'inbound' }),
        direction: 'inbound',
        connectorAvailable: true,
      })
    ).toBeNull();
  });

  it.each(['bidirectional', 'outbound'])('allows outbound when sync_direction is %s', sync_direction => {
    expect(
      authorizeConnection({
        connection: connection({ sync_direction }),
        direction: 'outbound',
        connectorAvailable: true,
      })
    ).toBeNull();
  });

  it('refuses a provider with no connector', () => {
    const denial = authorizeConnection({
      connection: connection(),
      direction: 'inbound',
      connectorAvailable: false,
    });
    expect(denial).toMatchObject({ status: 501, code: 'connector_not_implemented' });
  });

  it('checks revocation before the connector registry', () => {
    // A revoked connection on an unimplemented provider must report the revocation:
    // 501 reads as "we are building it" and hides the real state.
    const denial = authorizeConnection({
      connection: connection({ status: 'revoked' }),
      direction: 'inbound',
      connectorAvailable: false,
    });
    expect(denial?.code).toBe('connection_revoked');
  });
});

describe('authorizeCredential', () => {
  it('refuses a missing credential row', () => {
    expect(authorizeCredential(null, NOW)).toMatchObject({ status: 409, code: 'credential_missing' });
  });

  it('refuses an empty secret', () => {
    expect(authorizeCredential({ hasSecret: false, expiresAt: null }, NOW)).toMatchObject({
      code: 'credential_missing',
    });
  });

  it('allows a credential with no expiry', () => {
    // Tiny v2 tokens do not expire; a null expiry is normal, not suspicious.
    expect(authorizeCredential({ hasSecret: true, expiresAt: null }, NOW)).toBeNull();
  });

  it('allows a credential expiring in the future', () => {
    expect(
      authorizeCredential({ hasSecret: true, expiresAt: '2026-08-14T12:00:01.000Z' }, NOW)
    ).toBeNull();
  });

  it('refuses a credential that expired one millisecond ago', () => {
    expect(
      authorizeCredential({ hasSecret: true, expiresAt: '2026-08-14T11:59:59.999Z' }, NOW)
    ).toMatchObject({ code: 'credential_expired' });
  });

  it('allows a credential expiring exactly now', () => {
    // Boundary pinned deliberately: `<` not `<=`, so a token valid through this
    // instant is not rejected a millisecond early.
    expect(authorizeCredential({ hasSecret: true, expiresAt: '2026-08-14T12:00:00.000Z' }, NOW)).toBeNull();
  });

  it('treats an unparseable expiry as expired', () => {
    // Using a secret whose validity we failed to parse is the one outcome worse
    // than a needless reconnect.
    expect(authorizeCredential({ hasSecret: true, expiresAt: 'nunca' }, NOW)).toMatchObject({
      code: 'credential_expired',
    });
  });
});

describe('denial responses', () => {
  it('never carries secret-shaped fields', () => {
    const denials = [
      authorizeCaller({ hasAuthHeader: false, sessionUserId: null, role: null }),
      authorizeConnection({ connection: null, direction: 'inbound', connectorAvailable: true }),
      authorizeCredential({ hasSecret: true, expiresAt: '2020-01-01T00:00:00.000Z' }, NOW),
    ];

    for (const denial of denials) {
      expect(Object.keys(denial!).sort()).toEqual(['code', 'message', 'status']);
      expect(JSON.stringify(denial)).not.toMatch(/token|secret|password|bearer/i);
    }
  });

  it('uses stable codes so alerting does not depend on message text', () => {
    const codes = new Set([
      authorizeCaller({ hasAuthHeader: false, sessionUserId: null, role: null })!.code,
      authorizeCaller({ hasAuthHeader: true, sessionUserId: null, role: null })!.code,
      authorizeCaller({ hasAuthHeader: true, sessionUserId: 'u', role: 'viewer' })!.code,
      authorizeConnection({ connection: null, direction: 'inbound', connectorAvailable: true })!.code,
      authorizeCredential(null, NOW)!.code,
    ]);
    expect(codes.size).toBe(5);
  });
});
