import { describe, expect, it } from 'vitest';

// Mesmo mecanismo de advancedSettingsMigrations.test.ts / manualCountMigration.test.ts:
// sem um Postgres para apontar, a forma honesta de conferir que a migration não
// deixa a barreira só na UI é ler o SQL e confirmar que a validação está na
// função/policy — não substitui um teste de integração, mas pega a remoção
// acidental de uma barreira, que é o risco realista aqui.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const path = Object.keys(MIGRATIONS).find(p => p.includes('task_management'));
const SQL = path ? MIGRATIONS[path] : '';

function functionBody(name: string): string {
  const start = SQL.indexOf(`FUNCTION public.${name}(`);
  if (start === -1) return '';
  const end = SQL.indexOf('$fn$;', start);
  return end === -1 ? '' : SQL.slice(start, end);
}

describe('migration 070 — tabelas do módulo de Tarefas têm company_id', () => {
  it.each(['tasks', 'task_assignees', 'task_checklist_items', 'task_comments', 'task_attachments', 'task_activity_logs', 'task_notifications'])(
    '%s referencia companies(id)', (table) => {
      const start = SQL.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
      const end = SQL.indexOf(');', start);
      const ddl = SQL.slice(start, end);
      expect(ddl).toMatch(/company_id\s+uuid NOT NULL REFERENCES companies\(id\)/);
    }
  );
});

describe('migration 070 — RLS habilitado em todas as tabelas', () => {
  it.each(['tasks', 'task_assignees', 'task_checklist_items', 'task_comments', 'task_attachments', 'task_activity_logs', 'task_notifications'])(
    '%s tem ENABLE ROW LEVEL SECURITY', (table) => {
      expect(SQL).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    }
  );
});

describe('migration 070 — tasks/task_assignees não têm INSERT/UPDATE direto (só RPC)', () => {
  it('tasks não tem policy de INSERT nem UPDATE para authenticated', () => {
    expect(SQL).not.toMatch(/CREATE POLICY "tasks_insert"/);
    expect(SQL).not.toMatch(/CREATE POLICY "tasks_update"/);
  });

  it('task_assignees não tem nenhuma policy de escrita — só SELECT', () => {
    expect(SQL).not.toMatch(/CREATE POLICY "task_assignees_(insert|update|delete)"/);
  });

  it('exclusão direta de tasks é restrita a tarefa pessoal do próprio criador', () => {
    const body = SQL.slice(SQL.indexOf('CREATE POLICY "tasks_delete_own_personal"'), SQL.indexOf('-- ───', SQL.indexOf('CREATE POLICY "tasks_delete_own_personal"')));
    expect(body).toMatch(/type = 'personal'/);
    expect(body).toMatch(/created_by = auth\.uid\(\)/);
  });
});

describe('migration 070 — task_create', () => {
  it('exige owner/admin/manager para tarefa corporativa', () => {
    const body = functionBody('task_create');
    expect(body).toMatch(/v_role NOT IN \('owner', 'admin', 'manager'\)/);
  });

  it('valida que todos os responsáveis pertencem à mesma empresa', () => {
    const body = functionBody('task_create');
    expect(body).toMatch(/WHERE id = ANY\(p_assignee_ids\) AND company_id = v_company/);
    expect(body).toMatch(/v_valid_count <> array_length\(p_assignee_ids, 1\)/);
  });

  it('tarefa pessoal força o único responsável a ser o próprio criador', () => {
    const body = functionBody('task_create');
    expect(body).toMatch(/v_assignees := ARRAY\[v_uid\]/);
  });

  it('company_id nunca vem de parâmetro do cliente', () => {
    const body = functionBody('task_create');
    expect(body).toMatch(/get_my_company_id\(\)/);
    expect(body).not.toMatch(/p_company_id/);
  });
});

describe('migration 070 — task_update', () => {
  it('bloqueia edição de tarefa pessoal por quem não é o criador', () => {
    const body = functionBody('task_update');
    expect(body).toMatch(/v_task\.created_by <> v_uid THEN RAISE EXCEPTION/);
  });

  it('bloqueia edição de tarefa corporativa por quem não é gestão', () => {
    const body = functionBody('task_update');
    expect(body).toMatch(/v_role NOT IN \('owner', 'admin', 'manager'\) THEN RAISE EXCEPTION 'Somente gestores podem editar/);
  });

  it('recusa editar tarefa cancelada', () => {
    const body = functionBody('task_update');
    expect(body).toMatch(/v_task\.status = 'cancelled' THEN RAISE EXCEPTION/);
  });

  it('reatribuição revalida que os novos responsáveis são da mesma empresa', () => {
    const body = functionBody('task_update');
    expect(body).toMatch(/WHERE id = ANY\(p_assignee_ids\) AND company_id = v_company/);
  });
});

describe('migration 070 — task_set_my_status (responsável só altera a própria linha)', () => {
  it('exige uma linha em task_assignees para o próprio usuário', () => {
    const body = functionBody('task_set_my_status');
    expect(body).toMatch(/WHERE task_id = p_task_id AND user_id = v_uid/);
    expect(body).toMatch(/Você não é responsável por esta tarefa/);
  });

  it('o UPDATE é sempre filtrado por user_id = v_uid — nunca em nome de outro responsável', () => {
    const body = functionBody('task_set_my_status');
    const updateStart = body.indexOf('UPDATE task_assignees SET');
    const updateBlock = body.slice(updateStart, body.indexOf(';', updateStart));
    expect(updateBlock).toMatch(/WHERE task_id = p_task_id AND user_id = v_uid/);
  });

  it('recusa alterar status de tarefa cancelada', () => {
    const body = functionBody('task_set_my_status');
    expect(body).toMatch(/v_task_status = 'cancelled' THEN RAISE EXCEPTION/);
  });
});

describe('migration 070 — task_cancel', () => {
  it('exige owner/admin/manager', () => {
    const body = functionBody('task_cancel');
    expect(body).toMatch(/v_role NOT IN \('owner', 'admin', 'manager'\)/);
  });

  it('só cancela tarefa corporativa, não pessoal', () => {
    const body = functionBody('task_cancel');
    expect(body).toMatch(/v_task_type <> 'corporate' THEN RAISE EXCEPTION/);
  });
});

describe('migration 070 — helper de visibilidade evita recursão de RLS', () => {
  it('task_is_visible_to_me é STABLE SECURITY DEFINER', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.task_is_visible_to_me\(p_task_id uuid\)\nRETURNS boolean\nLANGUAGE sql STABLE SECURITY DEFINER/);
  });

  it('as policies de SELECT das tabelas satélite usam o helper, não subquery cruzada direta', () => {
    expect(SQL).toMatch(/CREATE POLICY "task_comments_select".*\n.*USING \(task_is_visible_to_me\(task_id\)\)/);
    expect(SQL).toMatch(/CREATE POLICY "task_attachments_select".*\n.*USING \(task_is_visible_to_me\(task_id\)\)/);
    expect(SQL).toMatch(/CREATE POLICY "task_activity_logs_select".*\n.*USING \(task_is_visible_to_me\(task_id\)\)/);
  });
});

describe('migration 070 — trigger de status nunca sobrescreve tarefa cancelada', () => {
  it('recompute retorna sem alterar quando o status atual já é cancelled', () => {
    const body = functionBody('task_assignees_recompute_status');
    expect(body).toMatch(/v_current_status = 'cancelled' THEN\s*\n\s*RETURN NULL/);
  });
});

describe('migration 070 — bucket de anexos isolado por empresa (mesmo padrão de rca-evidence)', () => {
  it('policy de storage.objects filtra pela pasta da empresa', () => {
    expect(SQL).toMatch(/bucket_id = 'task-attachments' AND \(storage\.foldername\(name\)\)\[1\] = get_my_company_id\(\)/);
  });

  it('bucket já nasce com mime type e tamanho limitados', () => {
    expect(SQL).toMatch(/allowed_mime_types, file_size_limit\)\nVALUES \('task-attachments', 'task-attachments', false,/);
  });
});

describe('migration 070 — nenhuma função concede execução a service_role/anon', () => {
  it('toda GRANT EXECUTE das RPCs deste módulo é só para authenticated', () => {
    const grants = SQL.match(/GRANT EXECUTE ON FUNCTION public\.task_\w+\([^)]*\) TO \w+/g) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    grants.forEach(g => expect(g).toMatch(/TO authenticated$/));
  });
});
