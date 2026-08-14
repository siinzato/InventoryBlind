// Minimum offline floor for the blind-count tablet screen (ticket seção 33):
// a momentary connection drop must not silently lose a count already taken.
// Not a full offline-first architecture (no IndexedDB) — a small localStorage
// queue, same fail-silently-in-private-browsing pattern as workspacePrefs.ts/
// cookieConsent.ts. Every entry carries the same idempotency_key the caller
// already generated, so a retry after reconnecting is always safe — the RPC
// itself is idempotent (pc_register_count).

const KEY = 'inventoryblind_pc_offline_queue';

export interface QueuedCount {
  itemId: string;
  mode: 'increment' | 'set';
  quantity: number;
  source: 'scanner' | 'manual';
  idempotencyKey: string;
  queuedAt: number;
}

function readQueue(): QueuedCount[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedCount[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // localStorage unavailable (private browsing, etc.) — queue just won't
    // survive a reload; the in-memory optimistic UI still worked for this session.
  }
}

export function enqueue(entry: QueuedCount): void {
  const queue = readQueue();
  queue.push(entry);
  writeQueue(queue);
}

export function dequeue(idempotencyKey: string): void {
  writeQueue(readQueue().filter(q => q.idempotencyKey !== idempotencyKey));
}

export function listPending(): QueuedCount[] {
  return readQueue();
}

export function pendingCount(): number {
  return readQueue().length;
}
