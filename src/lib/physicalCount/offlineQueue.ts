// Minimum offline floor for the blind-count tablet screen (ticket seção 33):
// a momentary connection drop must not silently lose a count already taken.
// Not a full offline-first architecture (no IndexedDB) — a small localStorage
// queue, same fail-silently-in-private-browsing pattern as workspacePrefs.ts/
// cookieConsent.ts. Every entry carries the same idempotency_key the caller
// already generated, so a retry after reconnecting is always safe — the RPC
// itself is idempotent (pc_register_count).

const KEY = 'inventoryblind_pc_offline_queue';

export interface QueuedCount {
  /** Workspace dono da contagem.
   *
   *  A fila era uma chave única global, sem empresa nem usuário: uma contagem enfileirada
   *  na empresa A ficava no aparelho e era retentada depois de trocar para a empresa B.
   *  O RLS recusava (o item é de outra empresa), então não gravava no lugar errado — mas
   *  a entrada ficava presa para sempre, falhando em silêncio a cada flush, e o contador
   *  de pendentes da tela mostrava contagens que não eram daquele workspace. */
  companyId: string;
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

/** Só o que pertence ao workspace ativo.
 *
 *  Entradas gravadas antes deste campo existir não têm `companyId`. São tratadas como do
 *  workspace atual em vez de descartadas: uma contagem já feita e ainda não sincronizada
 *  é exatamente o que esta fila existe para não perder, e o RLS recusa se ela for de
 *  outra empresa — o pior caso é uma retentativa que falha, não um dado gravado errado. */
export function listPending(companyId: string): QueuedCount[] {
  return readQueue().filter(q => q.companyId == null || q.companyId === companyId);
}

export function pendingCount(companyId: string): number {
  return listPending(companyId).length;
}
