import { describe, expect, it } from 'vitest';

// Mesmo mecanismo de taskMigration.test.ts: sem um Postgres para apontar, a
// forma honesta de conferir que a barreira não ficou só na UI é ler o SQL e
// confirmar que a validação/dedup está na função — não substitui um teste de
// integração, mas pega a remoção acidental de uma guarda.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const SQL_070 = MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('task_management')) ?? ''] ?? '';
const SQL_071 = MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('task_notifications_channel')) ?? ''] ?? '';

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  if (start === -1) return '';
  const end = sql.indexOf('$fn$;', start);
  return end === -1 ? '' : sql.slice(start, end);
}

describe('migration 071 — colunas novas de task_notifications', () => {
  it('adiciona title e reference_date', () => {
    expect(SQL_071).toMatch(/ADD COLUMN IF NOT EXISTS title text/);
    expect(SQL_071).toMatch(/ADD COLUMN IF NOT EXISTS reference_date timestamptz/);
  });

  it('type ganha o valor overdue sem remover os anteriores', () => {
    expect(SQL_071).toMatch(/CHECK \(type IN \('assigned', 'due_date_changed', 'commented', 'due_soon', 'overdue'\)\)/);
  });

  it('task_id passa a ON DELETE SET NULL — a notificação sobrevive à tarefa excluída', () => {
    expect(SQL_071).toMatch(/FOREIGN KEY \(task_id\) REFERENCES tasks\(id\) ON DELETE SET NULL/);
  });

  it('não abre policy de INSERT para authenticated — segue só RPC/trigger', () => {
    expect(SQL_071).not.toMatch(/CREATE POLICY "task_notifications_insert"/);
  });
});

describe('migration 070 — SELECT/UPDATE de task_notifications seguem restritos ao próprio usuário (sem bypass de gestão)', () => {
  it('task_notifications_select não concede acesso a owner/admin/manager sobre notificação de outro usuário', () => {
    const start = SQL_070.indexOf('CREATE POLICY "task_notifications_select"');
    const block = SQL_070.slice(start, SQL_070.indexOf('CREATE POLICY "task_notifications_update"', start));
    expect(block).toMatch(/user_id = auth\.uid\(\)/);
    expect(block).not.toMatch(/'owner'|'admin'|'manager'/);
  });

  it('task_notifications_update só permite marcar como lida a própria notificação', () => {
    const start = SQL_070.indexOf('CREATE POLICY "task_notifications_update"');
    const block = SQL_070.slice(start, SQL_070.indexOf('-- ───', start));
    expect(block).toMatch(/USING \(user_id = auth\.uid\(\)\) WITH CHECK \(user_id = auth\.uid\(\)\)/);
  });
});

describe('migration 071 — task_create/task_update notificam cada responsável, nunca quem não foi atribuído', () => {
  it('task_create insere uma notificação "assigned" por responsável novo, exceto o próprio criador', () => {
    const body = functionBody(SQL_071, 'task_create');
    expect(body).toMatch(/INSERT INTO task_notifications \(company_id, user_id, task_id, type, title, message\)/);
    expect(body).toMatch(/FROM unnest\(v_assignees\) AS u WHERE u <> v_uid/);
  });

  it('task_update só notifica quem foi de fato adicionado (v_added), não os já existentes', () => {
    const body = functionBody(SQL_071, 'task_update');
    expect(body).toMatch(/FROM unnest\(v_added\) AS u WHERE u <> v_uid/);
  });

  it('task_update inclui reference_date no aviso de prazo alterado', () => {
    const body = functionBody(SQL_071, 'task_update');
    expect(body).toMatch(/'due_date_changed', btrim\(p_title\)/);
    expect(body).toMatch(/v_new_reference/);
  });
});

describe('migration 071 — due_soon/overdue não duplicam e respeitam o novo prazo', () => {
  it('due_soon dedup por (task_id, user_id, type, reference_date) — não por janela de 24h corrida', () => {
    const body = functionBody(SQL_071, 'task_generate_due_soon_notifications');
    expect(body).toMatch(/n\.reference_date = \(t\.due_date \+ COALESCE\(t\.due_time, '23:59:59'::time\)\) AT TIME ZONE 'utc'/);
    expect(body).not.toMatch(/created_at > now\(\) - interval/);
  });

  it('due_soon e overdue ignoram tarefa concluída/cancelada e responsável que já concluiu', () => {
    for (const name of ['task_generate_due_soon_notifications', 'task_generate_overdue_notifications']) {
      const body = functionBody(SQL_071, name);
      expect(body).toMatch(/t\.status NOT IN \('done', 'cancelled'\)/);
      expect(body).toMatch(/ta\.status <> 'done'/);
    }
  });

  it('overdue só dispara depois do prazo (reference_date < agora) e também dedup por reference_date', () => {
    const body = functionBody(SQL_071, 'task_generate_overdue_notifications');
    expect(body).toMatch(/AT TIME ZONE 'utc' < v_now/);
    expect(body).toMatch(/n\.reference_date = \(t\.due_date \+ COALESCE\(t\.due_time, '23:59:59'::time\)\) AT TIME ZONE 'utc'/);
  });

  it('task_generate_overdue_notifications é cron-only — revogado até de authenticated', () => {
    expect(SQL_071).toMatch(/REVOKE ALL ON FUNCTION public\.task_generate_overdue_notifications\(\) FROM PUBLIC, anon, authenticated/);
  });

  it('cron agenda o job de atraso ao lado do de vencimento próximo', () => {
    expect(SQL_071).toMatch(/cron\.schedule\('task-overdue-notifications', '0 \* \* \* \*'/);
  });
});

describe('migration 071 — Realtime', () => {
  it('adiciona task_notifications à publicação de forma idempotente (checa antes de alterar)', () => {
    expect(SQL_071).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.task_notifications/);
    expect(SQL_071).toMatch(/NOT EXISTS[\s\S]*pg_publication_tables[\s\S]*pubname = 'supabase_realtime'[\s\S]*tablename = 'task_notifications'/);
  });
});
