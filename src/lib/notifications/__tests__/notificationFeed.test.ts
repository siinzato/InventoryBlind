import { describe, expect, it } from 'vitest';
import { mergeFeed, unreadCount, unreadIdsOf } from '../notificationFeed';
import type { TaskNotification } from '../../tasks/types';
import type { SupportNotification } from '../../support/supportNotificationService';
import type { CycleNotification } from '../../coverage/cycleNotificationService';

const tarefa = (id: string, createdAt: string, readAt: string | null = null): TaskNotification => ({
  id, task_id: 't1', type: 'assigned', title: null, message: `tarefa ${id}`,
  reference_date: null, read_at: readAt, created_at: createdAt,
});

const chamado = (
  id: string, createdAt: string, readAt: string | null = null,
  audience: 'author' | 'answerers' = 'author',
): SupportNotification => ({
  id, ticket_id: 'c1', kind: 'respondido', audience, message: `chamado ${id}`,
  read_at: readAt, created_at: createdAt,
});

describe('um sino só, dois canais', () => {
  // Ordenar por canal e depois por data colocaria um aviso de ontem acima de um
  // de agora — que é exatamente como um canal começa a ser ignorado.
  it('intercala por data, sem agrupar por origem', () => {
    const feed = mergeFeed(
      [tarefa('t-velha', '2026-10-01T00:00:00Z'), tarefa('t-nova', '2026-10-05T00:00:00Z')],
      [chamado('c-meio', '2026-10-03T00:00:00Z')],
    );
    expect(feed.map(i => i.id)).toEqual(['t-nova', 'c-meio', 't-velha']);
  });

  // Os ids vêm de tabelas diferentes e podem coincidir; a chave do React não pode.
  it('a chave separa canais mesmo com id igual', () => {
    const feed = mergeFeed([tarefa('mesmo-id', '2026-10-01T00:00:00Z')], [chamado('mesmo-id', '2026-10-02T00:00:00Z')]);
    expect(new Set(feed.map(i => i.key)).size).toBe(2);
    expect(feed.map(i => i.key)).toContain('support:mesmo-id');
  });

  it('o contador soma os dois canais', () => {
    const feed = mergeFeed(
      [tarefa('a', '2026-10-01T00:00:00Z'), tarefa('b', '2026-10-02T00:00:00Z', '2026-10-03T00:00:00Z')],
      [chamado('c', '2026-10-04T00:00:00Z')],
    );
    expect(unreadCount(feed)).toBe(2);
  });

  // Cada serviço escreve na própria tabela: marcar tudo como lido precisa dos
  // ids separados por canal, não de uma lista misturada.
  it('separa os não lidos por canal', () => {
    const feed = mergeFeed(
      [tarefa('t1', '2026-10-01T00:00:00Z'), tarefa('t2', '2026-10-02T00:00:00Z', '2026-10-03T00:00:00Z')],
      [chamado('c1', '2026-10-04T00:00:00Z')],
    );
    expect(unreadIdsOf(feed, 'task')).toEqual(['t1']);
    expect(unreadIdsOf(feed, 'support')).toEqual(['c1']);
  });

  it('o destino do clique acompanha o aviso do suporte', () => {
    const [item] = mergeFeed([], [chamado('c1', '2026-10-01T00:00:00Z', null, 'answerers')]);
    expect(item.target).toEqual({ kind: 'support', ticketId: 'c1', audience: 'answerers' });
  });

  it('feed vazio não quebra', () => {
    expect(mergeFeed([], [])).toEqual([]);
    expect(unreadCount([])).toBe(0);
    expect(unreadIdsOf([], 'support')).toEqual([]);
  });
});

describe('terceiro canal: ciclagem', () => {
  const ciclagem = (
    id: string, createdAt: string, readAt: string | null = null,
  ): CycleNotification => ({
    id, kind: 'lote_pendente', message: `ciclagem ${id}`,
    reference_date: '2026-11-03', read_at: readAt, created_at: createdAt,
  });

  // O canal é opcional de propósito: uma empresa sem a rotina no banco continua
  // com os dois canais de sempre, sem nenhuma mudança de chamada.
  it('o parâmetro é opcional e não muda o resto do sino', () => {
    const feed = mergeFeed([tarefa('t', '2026-10-01T00:00:00Z')], [chamado('c', '2026-10-02T00:00:00Z')]);
    expect(feed.map(i => i.id)).toEqual(['c', 't']);
  });

  it('entra na mesma ordenação por data, sem agrupar por origem', () => {
    const feed = mergeFeed(
      [tarefa('t', '2026-10-01T00:00:00Z')],
      [chamado('c', '2026-10-03T00:00:00Z')],
      [ciclagem('y', '2026-10-02T00:00:00Z')],
    );
    expect(feed.map(i => i.id)).toEqual(['c', 'y', 't']);
  });

  it('a chave separa o canal e o alvo é a tela do programa', () => {
    const [item] = mergeFeed([], [], [ciclagem('mesmo-id', '2026-10-01T00:00:00Z')]);
    expect(item.key).toBe('cycle:mesmo-id');
    expect(item.source).toBe('cycle');
    expect(item.target).toEqual({ kind: 'cycle' });
  });

  it('conta e separa os não lidos junto dos outros canais', () => {
    const feed = mergeFeed(
      [tarefa('t', '2026-10-01T00:00:00Z')],
      [],
      [ciclagem('y1', '2026-10-02T00:00:00Z'), ciclagem('y2', '2026-10-03T00:00:00Z', '2026-10-04T00:00:00Z')],
    );
    expect(unreadCount(feed)).toBe(2);
    expect(unreadIdsOf(feed, 'cycle')).toEqual(['y1']);
  });
});
