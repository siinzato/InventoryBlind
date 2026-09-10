// Integration Engine — generic connectivity test.
//
// One function every provider goes through, so "Testar conexão" behaves the same
// everywhere and a new connector inherits the behaviour for free.
//
// It answers four questions, in the order that fails cheapest first:
//   1. is there a credential at all?              (no I/O)
//   2. does the provider accept it?               (one request)
//   3. which account does it belong to?           (same request)
//   4. does it carry the scopes this connection needs? (same request)
//
// No secret is ever returned, logged or included in the outcome. The secret
// enters through ConnectorContext, which only exists server-side.

import { Capability, declaredCapabilities, type CapabilityKey } from './capabilities.ts';
import type { ConnectorContext } from './connector.ts';
import { describeError, IntegrationError } from './errors.ts';
import type { ProviderAdapter } from './adapter.ts';
import type { IntegrationConnection, ProviderCapabilities, SyncDirection } from './types.ts';

export type TestOutcomeStatus =
  | 'ok'
  | 'no_credential'
  | 'auth_failed'
  | 'insufficient_scope'
  | 'account_mismatch'
  | 'provider_error';

export interface ConnectionTestOutcome {
  status: TestOutcomeStatus;
  ok: boolean;
  /** pt-BR, safe to show the user verbatim. */
  message: string;
  externalAccountId: string | null;
  accountName: string | null;
  /** Capabilities this connection needs but the credential cannot exercise. */
  missingScopes: CapabilityKey[];
  /** Whether trying again unchanged could succeed — drives whether the UI offers
   *  "Tentar novamente" or "Corrigir credencial". */
  retryable: boolean;
  /** Patch the caller should apply to integration_connections. Kept as data so
   *  this function stays free of database access and stays testable. */
  connectionPatch: {
    status: IntegrationConnection['status'];
    external_account_id?: string | null;
    last_error: string | null;
    last_error_at: string | null;
  };
}

/** Which capabilities a connection actually needs, given how it is configured.
 *
 *  A connection set to `inbound` does not need write scope, and demanding it
 *  would fail a perfectly good read-only key. */
export function requiredCapabilitiesFor(
  direction: SyncDirection,
  capabilities: ProviderCapabilities
): CapabilityKey[] {
  const required: CapabilityKey[] = [];

  if (direction === 'inbound' || direction === 'bidirectional') {
    if (capabilities.read_products) required.push(Capability.READ_PRODUCTS);
    if (capabilities.read_stock) required.push(Capability.READ_STOCK);
  }

  if (direction === 'outbound' || direction === 'bidirectional') {
    // Any one write capability is enough; the engine picks the least destructive
    // available at push time (see stockOperations.preferredWriteKind).
    const writeCapability =
      (capabilities.write_movement && Capability.WRITE_MOVEMENT) ||
      (capabilities.write_adjustment && Capability.STOCK_ADJUSTMENT) ||
      (capabilities.write_stock && Capability.WRITE_STOCK) ||
      null;
    if (writeCapability) required.push(writeCapability);
  }

  return required;
}

function errorOutcome(
  error: IntegrationError,
  nowIso: string,
  status: TestOutcomeStatus
): ConnectionTestOutcome {
  const message = describeError(error);
  return {
    status,
    ok: false,
    message,
    externalAccountId: null,
    accountName: null,
    missingScopes: [],
    retryable: error.retryable,
    connectionPatch: {
      // A provider outage must not flip a working connection to `error` — that
      // reads as "your credential is broken" and sends the customer looking for a
      // problem they do not have. Transient failures keep the status and only
      // record the message.
      status: error.retryable ? 'active' : 'error',
      last_error: message,
      last_error_at: nowIso,
    },
  };
}

/** Run the test. `adapter` already carries the connector, the capability gate and
 *  the retry policy, so this function is only orchestration and interpretation. */
export async function runConnectionTest(params: {
  adapter: ProviderAdapter;
  ctx: ConnectorContext;
  connection: Pick<IntegrationConnection, 'credentialsSetAt' | 'syncDirection' | 'externalAccountId'>;
  capabilities: ProviderCapabilities;
  nowIso: string;
}): Promise<ConnectionTestOutcome> {
  const { adapter, ctx, connection, capabilities, nowIso } = params;

  // 1. Cheapest possible failure: nothing to test with.
  if (connection.credentialsSetAt == null) {
    return {
      status: 'no_credential',
      ok: false,
      message: 'Nenhuma credencial configurada para esta conexão.',
      externalAccountId: null,
      accountName: null,
      missingScopes: [],
      retryable: false,
      connectionPatch: {
        status: 'pending',
        last_error: 'Credencial não configurada.',
        last_error_at: nowIso,
      },
    };
  }

  const result = await adapter.testConnection(ctx);

  if (!result.success) {
    const kind = result.error.kind;
    const status: TestOutcomeStatus =
      kind === 'AUTH_INVALID' || kind === 'AUTH_EXPIRED'
        ? 'auth_failed'
        : kind === 'PERMISSION_DENIED'
          ? 'insufficient_scope'
          : 'provider_error';
    return errorOutcome(result.error, nowIso, status);
  }

  const test = result.data;

  if (!test.ok) {
    return errorOutcome(
      new IntegrationError({ kind: 'AUTH_INVALID', message: test.message }),
      nowIso,
      'auth_failed'
    );
  }

  // 3. Account identity. A connection that already knows its account must not
  // silently start pointing at a different one — that would cross two stores'
  // data under one mapping table, and every existing link would now be wrong.
  if (
    connection.externalAccountId != null &&
    test.externalAccountId != null &&
    connection.externalAccountId !== test.externalAccountId
  ) {
    return {
      status: 'account_mismatch',
      ok: false,
      message:
        'A credencial pertence a outra conta do provedor. Crie uma nova conexão para essa loja em vez de trocar a credencial desta.',
      externalAccountId: test.externalAccountId,
      accountName: test.accountName ?? null,
      missingScopes: [],
      retryable: false,
      connectionPatch: {
        status: 'error',
        last_error: 'Credencial pertence a outra conta do provedor.',
        last_error_at: nowIso,
      },
    };
  }

  // 4. Scopes. Only checked when the provider reports them; a provider that says
  // nothing is given the benefit of the doubt rather than blocked.
  const missingScopes: CapabilityKey[] = [];
  if (test.grantedScopes != null) {
    const granted = new Set(test.grantedScopes);
    const needed = requiredCapabilitiesFor(connection.syncDirection, capabilities);
    for (const capability of needed) {
      if (!granted.has(capability)) missingScopes.push(capability);
    }
  }

  if (missingScopes.length > 0) {
    return {
      status: 'insufficient_scope',
      ok: false,
      message: `A credencial não possui as permissões necessárias: ${missingScopes.join(', ')}. Ajuste os escopos no provedor e salve novamente.`,
      externalAccountId: test.externalAccountId,
      accountName: test.accountName ?? null,
      missingScopes,
      retryable: false,
      connectionPatch: {
        status: 'error',
        external_account_id: test.externalAccountId,
        last_error: 'Credencial sem as permissões necessárias.',
        last_error_at: nowIso,
      },
    };
  }

  return {
    status: 'ok',
    ok: true,
    message: test.accountName
      ? `Conexão validada com ${test.accountName}.`
      : 'Conexão validada.',
    externalAccountId: test.externalAccountId,
    accountName: test.accountName ?? null,
    missingScopes: [],
    retryable: false,
    connectionPatch: {
      status: 'active',
      external_account_id: test.externalAccountId,
      // Clearing the previous error on success matters: a stale message next to a
      // working connection is worse than no message.
      last_error: null,
      last_error_at: null,
    },
  };
}

/** Human-readable capability list for the connection detail screen. */
export function describeCapabilities(capabilities: ProviderCapabilities): string[] {
  const LABELS: Record<CapabilityKey, string> = {
    read_products: 'Ler produtos',
    read_stock: 'Ler saldo',
    read_stock_by_warehouse: 'Ler saldo por depósito',
    read_reserved_stock: 'Ler saldo reservado',
    read_locations: 'Ler endereços',
    read_brands: 'Ler marcas',
    read_categories: 'Ler categorias',
    read_movements: 'Ler movimentações',
    read_orders: 'Ler pedidos',
    write_stock: 'Definir saldo',
    write_adjustment: 'Lançar ajuste',
    write_transfer: 'Transferir entre depósitos',
    write_movement: 'Lançar movimentação',
    webhooks: 'Webhooks',
    multi_store: 'Múltiplas lojas',
  };

  return declaredCapabilities(capabilities).map(key => LABELS[key]);
}
