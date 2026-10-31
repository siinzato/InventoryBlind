// Une os dois canais de aviso pessoal — tarefas e suporte — numa lista só.
//
// Por que um sino e não dois: o usuário não pensa "fui avisado por qual
// subsistema", ele pensa "tem coisa me esperando". Dois sinos lado a lado
// obrigam a conferir os dois, e é assim que um deles passa a ser ignorado.
//
// Os canais continuam separados onde importa: tabelas, policies e serviços
// distintos. O que se junta é só a apresentação.

import type { TaskNotification } from '../tasks/types';
import type { SupportNotification } from '../support/supportNotificationService';

export type FeedSource = 'task' | 'support';

export type FeedTarget =
  | { kind: 'task'; taskId: string | null }
  | { kind: 'support'; ticketId: string | null; audience: 'author' | 'answerers' };

export interface FeedItem {
  /** Único entre os canais: os ids são de tabelas diferentes e poderiam colidir. */
  key: string;
  source: FeedSource;
  id: string;
  /** Tipo dentro do canal — só para escolher o ícone. */
  kind: string;
  message: string;
  createdAt: string;
  readAt: string | null;
  target: FeedTarget;
}

export function fromTask(n: TaskNotification): FeedItem {
  return {
    key: `task:${n.id}`, source: 'task', id: n.id, kind: n.type,
    message: n.message, createdAt: n.created_at, readAt: n.read_at,
    target: { kind: 'task', taskId: n.task_id },
  };
}

export function fromSupport(n: SupportNotification): FeedItem {
  return {
    key: `support:${n.id}`, source: 'support', id: n.id, kind: n.kind,
    message: n.message, createdAt: n.created_at, readAt: n.read_at,
    target: { kind: 'support', ticketId: n.ticket_id, audience: n.audience },
  };
}

/** Mais recente primeiro, sem olhar de que canal veio: ordenar por canal e
 *  depois por data faria um aviso de ontem aparecer acima de um de agora. */
export function mergeFeed(tasks: TaskNotification[], support: SupportNotification[]): FeedItem[] {
  return [...tasks.map(fromTask), ...support.map(fromSupport)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function unreadCount(items: FeedItem[]): number {
  return items.filter(i => !i.readAt).length;
}

/** Ids não lidos de um canal — é o que cada serviço precisa para marcar como
 *  lido, já que cada um escreve na própria tabela. */
export function unreadIdsOf(items: FeedItem[], source: FeedSource): string[] {
  return items.filter(i => i.source === source && !i.readAt).map(i => i.id);
}
