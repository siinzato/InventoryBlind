// Integration Engine — mapping engine.
//
// Decides, for each external record, which InventoryBlind row it is. Getting this
// wrong duplicates or merges a customer's catalogue, so the resolution logic is
// pure (matching.ts, exhaustively tested) and this file only does the I/O around
// it.
//
// The contract with the database: integration_entity_links has
// UNIQUE (connection_id, entity_type, external_id), which is what makes running
// the same sync twice a no-op instead of a duplication.

import { supabase } from '../supabase';
import { resolveMatch, type MatchCandidate } from './matching';
import type { EntityLink, EntityType, MatchSource, NormalizedRef } from './types';

const LINK_COLUMNS =
  'id, connection_id, entity_type, internal_id, external_id, external_sku, external_ean, external_name, match_source, last_synced_at';

interface LinkRow {
  id: string;
  connection_id: string;
  entity_type: string;
  internal_id: string | null;
  external_id: string;
  external_sku: string | null;
  external_ean: string | null;
  external_name: string | null;
  match_source: string | null;
  last_synced_at: string | null;
}

function toLink(row: LinkRow): EntityLink {
  return {
    id: row.id,
    connectionId: row.connection_id,
    entityType: row.entity_type as EntityType,
    internalId: row.internal_id,
    externalId: row.external_id,
    externalSku: row.external_sku,
    externalEan: row.external_ean,
    externalName: row.external_name,
    matchSource: row.match_source as MatchSource | null,
    lastSyncedAt: row.last_synced_at,
  };
}

/** Every existing link for a connection + entity type, keyed by external id.
 *
 *  Loaded once per sync rather than queried per record: a 5.000-SKU catalogue
 *  would otherwise be 5.000 round trips, which is the difference between a sync
 *  that takes seconds and one that times out. */
export async function loadLinkIndex(
  connectionId: string,
  entityType: EntityType
): Promise<Map<string, EntityLink>> {
  const index = new Map<string, EntityLink>();
  const PAGE = 1000;
  let from = 0;

  // Paged because PostgREST caps a single response, and a silently truncated
  // index would make already-linked records look new and get re-created.
  for (;;) {
    const { data, error } = await supabase
      .from('integration_entity_links')
      .select(LINK_COLUMNS)
      .eq('connection_id', connectionId)
      .eq('entity_type', entityType)
      .range(from, from + PAGE - 1);

    if (error) throw error;

    const rows = (data as LinkRow[] | null) ?? [];
    for (const row of rows) index.set(row.external_id, toLink(row));

    if (rows.length < PAGE) break;
    from += PAGE;
  }

  return index;
}

export interface ResolutionInput {
  connectionId: string;
  entityType: EntityType;
  normalized: NormalizedRef;
  /** Existing links, from loadLinkIndex. */
  linkIndex: Map<string, EntityLink>;
  /** Internal rows this record could correspond to. The caller decides how wide
   *  to cast this — typically every product of the company, loaded once. */
  candidates: MatchCandidate[];
}

export interface Resolution {
  externalId: string;
  internalId: string | null;
  matchSource: MatchSource | null;
  /** Two internal rows matched equally well. Never auto-linked: it becomes a
   *  manual review row, because guessing merges two products irreversibly. */
  ambiguous: boolean;
  /** No link row existed for this external id yet. */
  isNew: boolean;
}

/** Resolve one record. Pure apart from reading the pre-loaded index. */
export function resolve(input: ResolutionInput): Resolution {
  const existing = input.linkIndex.get(input.normalized.externalId);

  const outcome = resolveMatch(
    input.normalized,
    existing ? [{ externalId: existing.externalId, internalId: existing.internalId }] : [],
    input.candidates
  );

  return {
    externalId: input.normalized.externalId,
    internalId: outcome.internalId,
    matchSource: outcome.source,
    ambiguous: outcome.ambiguous,
    isNew: existing == null,
  };
}

export interface UpsertLinkInput {
  connectionId: string;
  entityType: EntityType;
  externalId: string;
  internalId?: string | null;
  externalSku?: string | null;
  externalEan?: string | null;
  externalName?: string | null;
  externalCode?: string | null;
  externalPayload?: unknown;
  matchSource?: MatchSource | null;
  syncedAt: string;
}

/** Insert or update links in bulk.
 *
 *  `onConflict` targets the uniqueness the migration declared, so a re-run
 *  updates the existing row instead of failing or duplicating. company_id is
 *  omitted deliberately — the column defaults to get_my_company_id() and the RLS
 *  policy re-checks it, so the client never chooses the tenant.
 *
 *  Chunked because a single 5.000-row upsert exceeds what PostgREST will accept
 *  in one statement. */
export async function upsertLinks(inputs: UpsertLinkInput[], chunkSize = 500): Promise<number> {
  if (inputs.length === 0) return 0;

  let written = 0;

  for (let i = 0; i < inputs.length; i += chunkSize) {
    const chunk = inputs.slice(i, i + chunkSize).map(input => ({
      connection_id: input.connectionId,
      entity_type: input.entityType,
      external_id: input.externalId,
      internal_id: input.internalId ?? null,
      external_sku: input.externalSku ?? null,
      external_ean: input.externalEan ?? null,
      external_name: input.externalName ?? null,
      external_code: input.externalCode ?? null,
      external_payload: input.externalPayload ?? null,
      match_source: input.matchSource ?? null,
      last_synced_at: input.syncedAt,
    }));

    const { error, count } = await supabase
      .from('integration_entity_links')
      .upsert(chunk, { onConflict: 'connection_id,entity_type,external_id', count: 'exact' });

    if (error) throw error;
    written += count ?? chunk.length;
  }

  return written;
}

/** Attach an internal row to an external record — the write behind a manual
 *  resolution screen. */
export async function linkManually(
  connectionId: string,
  entityType: EntityType,
  externalId: string,
  internalId: string
): Promise<void> {
  const { error } = await supabase
    .from('integration_entity_links')
    .update({ internal_id: internalId, match_source: 'manual' })
    .eq('connection_id', connectionId)
    .eq('entity_type', entityType)
    .eq('external_id', externalId);

  if (error) throw error;
}

/** Detach without deleting the link.
 *
 *  The row survives so the external record stays known (and re-syncs do not
 *  recreate it as new); only the association is cleared. */
export async function unlink(
  connectionId: string,
  entityType: EntityType,
  externalId: string
): Promise<void> {
  const { error } = await supabase
    .from('integration_entity_links')
    .update({ internal_id: null, match_source: null })
    .eq('connection_id', connectionId)
    .eq('entity_type', entityType)
    .eq('external_id', externalId);

  if (error) throw error;
}

/** Internal id for an external one, or null. Used on the outbound path: we can
 *  only push a SKU the provider already knows about. */
export function toInternalId(index: Map<string, EntityLink>, externalId: string): string | null {
  return index.get(externalId)?.internalId ?? null;
}

/** Reverse lookup, built on demand.
 *
 *  Unlinked rows are skipped, and when two external records point at the same
 *  internal row the first wins — an ambiguity the outbound path should not try to
 *  resolve silently, and which `countAmbiguousReverse` surfaces instead. */
export function buildReverseIndex(index: Map<string, EntityLink>): Map<string, string> {
  const reverse = new Map<string, string>();
  for (const link of index.values()) {
    if (link.internalId == null) continue;
    if (!reverse.has(link.internalId)) reverse.set(link.internalId, link.externalId);
  }
  return reverse;
}

/** How many internal rows are claimed by more than one external record. A
 *  non-zero count means the outbound path has a decision to make and should not
 *  be pushing blind. */
export function countAmbiguousReverse(index: Map<string, EntityLink>): number {
  const seen = new Map<string, number>();
  for (const link of index.values()) {
    if (link.internalId == null) continue;
    seen.set(link.internalId, (seen.get(link.internalId) ?? 0) + 1);
  }
  let ambiguous = 0;
  for (const count of seen.values()) if (count > 1) ambiguous++;
  return ambiguous;
}
