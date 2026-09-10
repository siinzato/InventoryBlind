// Integration Engine — pagination.
//
// Providers disagree on how to walk a list: Tiny pages, Mercado Livre offsets,
// modern APIs hand back opaque cursors. The engine supports all three rather than
// picking one and forcing connectors to fake it — a connector faking a cursor over
// a page-based API is how a sync silently skips or repeats a page.
//
// Pure module: no I/O, fully testable.

export type PageStrategy = 'cursor' | 'page' | 'offset';

export type PageRequest =
  | { strategy: 'cursor'; cursor: string | null; limit: number }
  | { strategy: 'page'; page: number; limit: number }
  | { strategy: 'offset'; offset: number; limit: number };

/** What a connector reports after one page. `hasNext` is the authority — the
 *  presence of a cursor is not, because several providers return a cursor on the
 *  final page too, and following it yields the same page forever. */
export interface PageInfo {
  strategy: PageStrategy;
  hasNext: boolean;
  nextCursor?: string | null;
  nextPage?: number | null;
  nextOffset?: number | null;
  limit: number;
  /** Only when the provider reports it; most do not, and inventing it invites a
   *  progress bar that lies. */
  total?: number | null;
}

export const DEFAULT_PAGE_LIMIT = 100;
/** Guard against a provider (or a bug) advertising a page size that turns one
 *  sync into a memory problem. */
export const MAX_PAGE_LIMIT = 500;

export function clampLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.floor(limit), MAX_PAGE_LIMIT);
}

export function firstPage(strategy: PageStrategy, limit?: number): PageRequest {
  const clamped = clampLimit(limit);
  if (strategy === 'cursor') return { strategy: 'cursor', cursor: null, limit: clamped };
  if (strategy === 'page') return { strategy: 'page', page: 1, limit: clamped };
  return { strategy: 'offset', offset: 0, limit: clamped };
}

/** Compute the next request, or null when the walk is done.
 *
 *  Returns null whenever `hasNext` is false, and also when `hasNext` is true but
 *  the provider gave nothing to advance with — a contradictory response that
 *  would otherwise loop on the same page forever. Ending the walk is the safe
 *  reading: a sync that stops early is visible in the counters, a sync that
 *  spins is not. */
export function nextPageRequest(current: PageRequest, info: PageInfo): PageRequest | null {
  if (!info.hasNext) return null;

  if (current.strategy === 'cursor') {
    const cursor = info.nextCursor ?? null;
    // Same cursor back means no progress — treat as the end.
    if (cursor == null || cursor === current.cursor) return null;
    return { strategy: 'cursor', cursor, limit: current.limit };
  }

  if (current.strategy === 'page') {
    const page = info.nextPage ?? current.page + 1;
    if (page <= current.page) return null;
    return { strategy: 'page', page, limit: current.limit };
  }

  const offset = info.nextOffset ?? current.offset + current.limit;
  if (offset <= current.offset) return null;
  return { strategy: 'offset', offset, limit: current.limit };
}

/** Hard stop for a full walk, independent of what the provider claims.
 *
 *  A provider that always answers `hasNext: true` must not be able to run a sync
 *  indefinitely. This is deliberately generous — it is a runaway guard, not a
 *  business limit — and reaching it is worth logging as an anomaly. */
export const MAX_PAGES_PER_RUN = 1000;

export function isRunawayWalk(pagesFetched: number): boolean {
  return pagesFetched >= MAX_PAGES_PER_RUN;
}
