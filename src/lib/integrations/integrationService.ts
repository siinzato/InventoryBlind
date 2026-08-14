// Integration layer — client-side service.
//
// The only file the app uses to reach integration data. Two rules it enforces so
// callers cannot get them wrong:
//
// 1. No secret is ever selected. Column lists here are explicit, never `*`, and
//    integration_credentials is not reachable from this file at all — it has no
//    policy for `authenticated` and its grants are revoked (migration 042).
//    Saving a credential goes through the write-only RPC below.
// 2. No company_id is ever sent from the client as an authorisation argument.
//    RLS derives the tenant from the JWT; a company_id in a filter here would be
//    a convenience, never the barrier.

import { supabase } from '../supabase';
import type {
  ConnectionStatus,
  EntityLink,
  EntityType,
  IntegrationConnection,
  IntegrationProvider,
  ProviderCapabilities,
  ProviderKind,
  SyncDirection,
  SyncRun,
} from './types';

// Explicit and secret-free. `credentials_set_at`/`credential_hint` say that a
// credential exists and roughly what it looks like; `secret` lives in another
// table this client cannot read.
const CONNECTION_COLUMNS = `
  id, company_id, provider_key, display_name, external_account_id, status,
  configuration, sync_direction, stock_source_of_truth, auto_sync_enabled,
  sync_interval_minutes, sync_cursor, credentials_set_at, credential_hint,
  last_sync_at, last_successful_sync_at, last_error, last_error_at,
  created_at, updated_at
`;

interface ConnectionRow {
  id: string;
  company_id: string;
  provider_key: string;
  display_name: string;
  external_account_id: string | null;
  status: ConnectionStatus;
  configuration: Record<string, unknown> | null;
  sync_direction: SyncDirection;
  stock_source_of_truth: boolean;
  auto_sync_enabled: boolean;
  sync_interval_minutes: number | null;
  sync_cursor: string | null;
  credentials_set_at: string | null;
  credential_hint: string | null;
  last_sync_at: string | null;
  last_successful_sync_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
}

function toConnection(row: ConnectionRow): IntegrationConnection {
  return {
    id: row.id,
    companyId: row.company_id,
    providerKey: row.provider_key,
    displayName: row.display_name,
    externalAccountId: row.external_account_id,
    status: row.status,
    configuration: row.configuration ?? {},
    syncDirection: row.sync_direction,
    stockSourceOfTruth: row.stock_source_of_truth,
    autoSyncEnabled: row.auto_sync_enabled,
    syncIntervalMinutes: row.sync_interval_minutes,
    syncCursor: row.sync_cursor,
    credentialsSetAt: row.credentials_set_at,
    credentialHint: row.credential_hint,
    lastSyncAt: row.last_sync_at,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Providers
// ─────────────────────────────────────────────────────────────────────────────

/** The catalogue is data, not a union type in the code: a new provider appears
 *  here the moment a migration inserts it, with no frontend release. */
export async function listProviders(kind?: ProviderKind): Promise<IntegrationProvider[]> {
  let query = supabase
    .from('integration_providers')
    .select('key, name, kind, capabilities, status, docs_url')
    .order('kind')
    .order('name');

  if (kind) query = query.eq('kind', kind);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map(row => ({
    key: row.key as string,
    name: row.name as string,
    kind: row.kind as ProviderKind,
    capabilities: (row.capabilities ?? {}) as ProviderCapabilities,
    status: row.status as IntegrationProvider['status'],
    docsUrl: (row.docs_url ?? null) as string | null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Connections
// ─────────────────────────────────────────────────────────────────────────────

export async function listConnections(): Promise<IntegrationConnection[]> {
  const { data, error } = await supabase
    .from('integration_connections')
    .select(CONNECTION_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as ConnectionRow[] | null ?? []).map(toConnection);
}

export interface CreateConnectionInput {
  providerKey: string;
  displayName: string;
  syncDirection?: SyncDirection;
  stockSourceOfTruth?: boolean;
  configuration?: Record<string, unknown>;
}

/** Creates the store/account row. company_id is omitted on purpose — the column
 *  defaults to get_my_company_id() and the INSERT policy re-checks it, so the
 *  client never gets a say in which tenant the row lands in. */
export async function createConnection(input: CreateConnectionInput): Promise<IntegrationConnection> {
  const { data, error } = await supabase
    .from('integration_connections')
    .insert({
      provider_key: input.providerKey,
      display_name: input.displayName,
      sync_direction: input.syncDirection ?? 'inbound',
      stock_source_of_truth: input.stockSourceOfTruth ?? false,
      configuration: input.configuration ?? {},
    })
    .select(CONNECTION_COLUMNS)
    .single();

  if (error) throw error;
  return toConnection(data as ConnectionRow);
}

export interface UpdateConnectionInput {
  displayName?: string;
  status?: ConnectionStatus;
  syncDirection?: SyncDirection;
  stockSourceOfTruth?: boolean;
  autoSyncEnabled?: boolean;
  syncIntervalMinutes?: number | null;
  configuration?: Record<string, unknown>;
}

export async function updateConnection(
  connectionId: string,
  input: UpdateConnectionInput
): Promise<IntegrationConnection> {
  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) patch.display_name = input.displayName;
  if (input.status !== undefined) patch.status = input.status;
  if (input.syncDirection !== undefined) patch.sync_direction = input.syncDirection;
  if (input.stockSourceOfTruth !== undefined) patch.stock_source_of_truth = input.stockSourceOfTruth;
  if (input.autoSyncEnabled !== undefined) patch.auto_sync_enabled = input.autoSyncEnabled;
  if (input.syncIntervalMinutes !== undefined) patch.sync_interval_minutes = input.syncIntervalMinutes;
  if (input.configuration !== undefined) patch.configuration = input.configuration;

  const { data, error } = await supabase
    .from('integration_connections')
    .update(patch)
    .eq('id', connectionId)
    .select(CONNECTION_COLUMNS)
    .single();

  if (error) throw error;
  return toConnection(data as ConnectionRow);
}

export async function deleteConnection(connectionId: string): Promise<void> {
  const { error } = await supabase.from('integration_connections').delete().eq('id', connectionId);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// Credentials — write-only from the client, by construction
// ─────────────────────────────────────────────────────────────────────────────

/** Saves a credential without ever being able to read one back.
 *
 *  There is deliberately no `getCredential` in this file and there must never be
 *  one: the RPC returns void, the table is unreachable through the API, and only
 *  a server-side Edge Function holding service_role resolves the secret when a
 *  connector needs it.
 *
 *  `hint` is for the UI ("••••4821") and must be built by the caller from a
 *  substring — never the full value, and never logged. */
export async function setConnectionCredential(
  connectionId: string,
  secret: string,
  hint?: string | null,
  expiresAt?: string | null
): Promise<void> {
  const { error } = await supabase.rpc('integration_set_credential', {
    p_connection_id: connectionId,
    p_secret: secret,
    p_hint: hint ?? null,
    p_expires_at: expiresAt ?? null,
  });
  if (error) throw error;
}

export async function clearConnectionCredential(connectionId: string): Promise<void> {
  const { error } = await supabase.rpc('integration_clear_credential', {
    p_connection_id: connectionId,
  });
  if (error) throw error;
}

/** Last four characters, for display only. Anything shorter than five characters
 *  is fully masked rather than partially revealed. */
export function buildCredentialHint(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length < 5) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping and observability (read side)
// ─────────────────────────────────────────────────────────────────────────────

export async function listEntityLinks(
  connectionId: string,
  entityType: EntityType
): Promise<EntityLink[]> {
  const { data, error } = await supabase
    .from('integration_entity_links')
    .select('id, connection_id, entity_type, internal_id, external_id, external_sku, external_ean, external_name, match_source, last_synced_at')
    .eq('connection_id', connectionId)
    .eq('entity_type', entityType)
    .order('external_id');

  if (error) throw error;

  return (data ?? []).map(row => ({
    id: row.id as string,
    connectionId: row.connection_id as string,
    entityType: row.entity_type as EntityType,
    internalId: (row.internal_id ?? null) as string | null,
    externalId: row.external_id as string,
    externalSku: (row.external_sku ?? null) as string | null,
    externalEan: (row.external_ean ?? null) as string | null,
    externalName: (row.external_name ?? null) as string | null,
    matchSource: (row.match_source ?? null) as EntityLink['matchSource'],
    lastSyncedAt: (row.last_synced_at ?? null) as string | null,
  }));
}

/** Unlinked provider records — the queue an import review screen works through. */
export async function countUnlinked(connectionId: string, entityType: EntityType): Promise<number> {
  const { count, error } = await supabase
    .from('integration_entity_links')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', connectionId)
    .eq('entity_type', entityType)
    .is('internal_id', null);

  if (error) throw error;
  return count ?? 0;
}

export async function listSyncRuns(connectionId: string, limit = 20): Promise<SyncRun[]> {
  const { data, error } = await supabase
    .from('integration_sync_runs')
    .select('id, connection_id, entity_type, direction, trigger_source, status, processed_count, created_count, updated_count, skipped_count, failed_count, cursor_before, cursor_after, error_message, started_at, finished_at, duration_ms')
    .eq('connection_id', connectionId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map(row => ({
    id: row.id as string,
    connectionId: row.connection_id as string,
    entityType: row.entity_type as SyncRun['entityType'],
    direction: row.direction as SyncRun['direction'],
    triggerSource: row.trigger_source as SyncRun['triggerSource'],
    status: row.status as SyncRun['status'],
    processed: (row.processed_count ?? 0) as number,
    created: (row.created_count ?? 0) as number,
    updated: (row.updated_count ?? 0) as number,
    skipped: (row.skipped_count ?? 0) as number,
    failed: (row.failed_count ?? 0) as number,
    cursorBefore: (row.cursor_before ?? null) as string | null,
    cursorAfter: (row.cursor_after ?? null) as string | null,
    errorMessage: (row.error_message ?? null) as string | null,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at ?? null) as string | null,
    durationMs: (row.duration_ms ?? null) as number | null,
  }));
}
