import { describe, expect, it } from 'vitest';
import {
  EDITABLE_SESSION_FIELDS,
  MIN_DELETION_REASON_LENGTH,
  buildSessionAdminRpcArgs,
  buildSessionDeletionRpcArgs,
  canManageSessionHistory,
  filterVisibleSessions,
  hasSessionAdminChanges,
  isSessionVisibleInHistory,
  normalizeSessionAdminFields,
  validateDeletionReason,
} from '../physicalCountAdmin';

// O texto real da migration 059. Lido com o mesmo mecanismo já usado por
// intelligence/__tests__/isolation.test.ts (import.meta.glob + ?raw), porque
// tsconfig.app.json cobre todo o `src` sem @types/node — um `node:fs` aqui
// roda no vitest mas não passa no typecheck.
//
// Os testes que dependem disto são estáticos por necessidade: sem um Postgres
// para apontar, a única forma honesta de verificar que a RPC recusa papel
// errado, empresa errada e sessão removida é conferir que as barreiras estão
// escritas na função. Eles não substituem um teste de integração; eles pegam a
// remoção acidental de uma barreira, que é o risco realista aqui.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MIGRATION_059 =
  MIGRATIONS[
    Object.keys(MIGRATIONS).find(p => p.includes('059_physical_count_admin_session_management')) ?? ''
  ] ?? '';

/** Corpo de uma função da migration, do CREATE OR REPLACE até o fim do $fn$. */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start === -1) return '';
  const end = sql.indexOf('$fn$;', start);
  return end === -1 ? '' : sql.slice(start, end);
}

const ROLES = ['owner', 'admin', 'manager', 'lead', 'counter', 'viewer'] as const;

const SESSION = {
  id: 'a1',
  warehouse: 'CD São Paulo',
  area: 'Mezanino',
  observation: 'Contagem trimestral',
  deletedAt: null as string | null,
};

// ── 1/2/3. Quem vê as ações administrativas ──────────────────────────────────

describe('canManageSessionHistory', () => {
  it('owner vê editar e remover', () => {
    expect(canManageSessionHistory('owner')).toBe(true);
  });

  it('admin vê editar e remover', () => {
    expect(canManageSessionHistory('admin')).toBe(true);
  });

  it('manager, lead, counter e viewer não veem essas ações', () => {
    for (const role of ['manager', 'lead', 'counter', 'viewer'] as const) {
      expect(canManageSessionHistory(role)).toBe(false);
    }
  });

  it('sem papel carregado ainda, não libera nada', () => {
    expect(canManageSessionHistory(undefined)).toBe(false);
    expect(canManageSessionHistory(null)).toBe(false);
    expect(canManageSessionHistory('')).toBe(false);
  });

  it('cobre todos os papéis que o sistema tem, sem sobra', () => {
    // Se um papel novo entrar em Profile['role'], este teste continua passando,
    // mas o de baixo (papéis permitidos) fixa a lista curta de propósito.
    expect(ROLES.filter(canManageSessionHistory)).toEqual(['owner', 'admin']);
  });
});

// ── 4/10. A edição envia somente campos permitidos ───────────────────────────

describe('buildSessionAdminRpcArgs', () => {
  const fields = normalizeSessionAdminFields(SESSION);

  it('envia exatamente sessão, depósito, área e observação', () => {
    expect(Object.keys(buildSessionAdminRpcArgs('a1', fields)).sort()).toEqual([
      'p_area',
      'p_observation',
      'p_session_id',
      'p_warehouse',
    ]);
  });

  it('nunca envia empresa, status, faixa, quantidades, datas ou aprovação', () => {
    const args = buildSessionAdminRpcArgs('a1', fields) as Record<string, unknown>;
    for (const forbidden of [
      'p_company_id',
      'company_id',
      'p_status',
      'p_street_from',
      'p_street_to',
      'p_count_number',
      'p_total_items',
      'p_approved_at',
      'p_approved_by',
      'p_deleted_at',
      'p_linked_session_id',
      'p_erp_quantity_snapshot',
    ]) {
      expect(args[forbidden]).toBeUndefined();
    }
  });

  it('a lista de campos editáveis é curta e explícita', () => {
    expect([...EDITABLE_SESSION_FIELDS]).toEqual(['warehouse', 'area', 'observation']);
  });
});

describe('normalizeSessionAdminFields', () => {
  it('texto em branco vira ausência de valor, não string vazia', () => {
    expect(normalizeSessionAdminFields({ warehouse: '   ', area: '', observation: undefined })).toEqual({
      warehouse: null,
      area: null,
      observation: null,
    });
  });

  it('remove espaços das pontas sem alterar o miolo', () => {
    expect(normalizeSessionAdminFields({ warehouse: '  CD  Sul  ' }).warehouse).toBe('CD  Sul');
  });
});

describe('hasSessionAdminChanges', () => {
  const before = normalizeSessionAdminFields(SESSION);

  it('não considera alteração quando só mudou o espaçamento', () => {
    const after = normalizeSessionAdminFields({ ...SESSION, warehouse: '  CD São Paulo  ' });
    expect(hasSessionAdminChanges(before, after)).toBe(false);
  });

  it('detecta a limpeza de um campo', () => {
    expect(hasSessionAdminChanges(before, normalizeSessionAdminFields({ ...SESSION, area: '' }))).toBe(true);
  });

  it('detecta troca de observação', () => {
    expect(
      hasSessionAdminChanges(before, normalizeSessionAdminFields({ ...SESSION, observation: 'Outra' }))
    ).toBe(true);
  });
});

// ── 5. A remoção exige justificativa ─────────────────────────────────────────

describe('validateDeletionReason', () => {
  it('recusa vazio', () => {
    expect(validateDeletionReason('')).not.toBeNull();
    expect(validateDeletionReason('   ')).not.toBeNull();
    expect(validateDeletionReason(null)).not.toBeNull();
  });

  it(`recusa menos de ${MIN_DELETION_REASON_LENGTH} caracteres`, () => {
    expect(validateDeletionReason('erro')).not.toBeNull();
    // Espaço não conta como conteúdo.
    expect(validateDeletionReason('  ab  ')).not.toBeNull();
  });

  it('aceita a partir do mínimo', () => {
    expect(validateDeletionReason('erro!')).toBeNull();
    expect(validateDeletionReason('criada na faixa errada')).toBeNull();
  });

  it('a mesma exigência de tamanho está no banco', () => {
    const body = functionBody(MIGRATION_059, 'pc_admin_delete_session');
    expect(body).toContain(`char_length(v_reason) < ${MIN_DELETION_REASON_LENGTH}`);
  });
});

describe('buildSessionDeletionRpcArgs', () => {
  it('envia só a sessão e o motivo, já sem espaços nas pontas', () => {
    expect(buildSessionDeletionRpcArgs('a1', '  faixa errada  ')).toEqual({
      p_session_id: 'a1',
      p_reason: 'faixa errada',
    });
  });
});

// ── 7. Sessões com deleted_at não aparecem ───────────────────────────────────

describe('visibilidade no histórico', () => {
  it('sessão sem deleted_at aparece', () => {
    expect(isSessionVisibleInHistory({ deletedAt: null })).toBe(true);
  });

  it('sessão com deleted_at não aparece', () => {
    expect(isSessionVisibleInHistory({ deletedAt: '2026-08-20T12:00:00Z' })).toBe(false);
  });

  it('filterVisibleSessions remove as removidas e preserva a ordem do resto', () => {
    const list = [
      { id: 'a', deletedAt: null },
      { id: 'b', deletedAt: '2026-08-20T12:00:00Z' },
      { id: 'c', deletedAt: null },
    ];
    expect(filterVisibleSessions(list).map(s => s.id)).toEqual(['a', 'c']);
  });

  it('a migration cria o índice parcial para a listagem do histórico', () => {
    expect(MIGRATION_059).toContain('CREATE INDEX IF NOT EXISTS pc_sessions_company_active_idx');
    expect(MIGRATION_059).toContain('WHERE deleted_at IS NULL');
  });
});

// ── Regressão: a leitura não pode exigir a coluna nova ───────────────────────
//
// Isto já quebrou a Contagem Física Digital em produção. Um
// `.is('deleted_at', null)` na query de listSessions referencia uma coluna que
// só existe depois de a 059 ser aplicada; num banco sem ela o PostgREST devolve
// erro, listSessions lança, e o Promise.all da tela cai inteiro — levando junto
// a lista de produtos, o que fazia a tela dizer que a empresa não tinha produto
// cadastrado. A leitura tem de funcionar antes e depois da migration.

const SERVICE_SOURCES = import.meta.glob('/src/lib/physicalCount/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Código sem comentários. Necessário porque o comentário que explica esta
 *  armadilha cita o próprio trecho proibido — e casaria com a asserção. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('listSessions / getSession — compatibilidade com banco sem a 059', () => {
  const source = SERVICE_SOURCES['/src/lib/physicalCount/physicalCountService.ts'] ?? '';
  const code = stripComments(source);

  it('nenhuma leitura de sessão filtra deleted_at na query', () => {
    expect(source).not.toBe('');
    expect(code).not.toContain(".is('deleted_at'");
    expect(code).not.toContain('.eq(\'deleted_at\'');
  });

  it('o filtro de visibilidade é aplicado no resultado', () => {
    expect(source).toContain('filterVisibleSessions(');
    expect(source).toContain('isSessionVisibleInHistory(');
  });

  it('uma linha sem a coluna deleted_at é tratada como visível', () => {
    // É o que mapSession produz quando a coluna não existe: `?? null`.
    expect(isSessionVisibleInHistory({ deletedAt: null })).toBe(true);
  });
});

// ── 8/9/10. As barreiras que só o banco pode garantir ────────────────────────

describe('migration 059 — pc_admin_update_session', () => {
  const body = functionBody(MIGRATION_059, 'pc_admin_update_session');

  it('existe, é SECURITY DEFINER e fixa o search_path', () => {
    expect(body).not.toBe('');
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain("SET search_path TO 'public'");
  });

  it('recusa usuário não autenticado', () => {
    expect(body).toContain('IF auth.uid() IS NULL THEN');
  });

  it('recusa papel sem permissão', () => {
    expect(body).toContain("v_role NOT IN ('owner','admin')");
  });

  it('recusa sessão de outra empresa, usando a empresa do usuário autenticado', () => {
    expect(body).toContain('v_company := get_my_company_id();');
    expect(body).toContain('v_before.company_id::text <> v_company');
  });

  it('recusa sessão já removida', () => {
    expect(body).toContain('v_before.deleted_at IS NOT NULL');
  });

  it('não aceita company_id vindo do cliente', () => {
    const signature = body.slice(0, body.indexOf('RETURNS void'));
    expect(signature).not.toContain('company');
  });

  it('o UPDATE toca apenas os três campos administrativos', () => {
    const update = body.slice(body.indexOf('UPDATE physical_count_sessions'), body.indexOf('WHERE id = p_session_id;'));
    for (const allowed of ['warehouse', 'area', 'observation', 'updated_at']) {
      expect(update).toContain(`${allowed} `);
    }
    for (const protected_ of [
      'status',
      'street_from',
      'street_to',
      'count_number',
      'total_items',
      'approved_by',
      'approved_at',
      'company_id',
      'deleted_at',
      'linked_session_id',
      'root_session_id',
      'started_at',
      'finished_at',
    ]) {
      expect(update).not.toContain(`${protected_} =`);
    }
  });

  it('grava a auditoria com valores anteriores e novos na mesma transação', () => {
    expect(body).toContain("'physical_count.session_updated'");
    expect(body).toContain('INSERT INTO audit_logs');
    expect(body).toContain("'before'");
    expect(body).toContain("'after'");
  });

  it('é revogada de PUBLIC e de anon, e liberada só para authenticated', () => {
    expect(MIGRATION_059).toContain(
      'REVOKE EXECUTE ON FUNCTION public.pc_admin_update_session(uuid, text, text, text) FROM PUBLIC;'
    );
    // `anon` precisa de revogação própria — ver o comentário na migration.
    expect(MIGRATION_059).toContain(
      'REVOKE EXECUTE ON FUNCTION public.pc_admin_update_session(uuid, text, text, text) FROM anon;'
    );
    expect(MIGRATION_059).toContain(
      'GRANT  EXECUTE ON FUNCTION public.pc_admin_update_session(uuid, text, text, text) TO authenticated;'
    );
  });
});

describe('migration 059 — pc_admin_delete_session', () => {
  const body = functionBody(MIGRATION_059, 'pc_admin_delete_session');

  it('existe, é SECURITY DEFINER e fixa o search_path', () => {
    expect(body).not.toBe('');
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain("SET search_path TO 'public'");
  });

  it('recusa usuário não autenticado, papel sem permissão e empresa diferente', () => {
    expect(body).toContain('IF auth.uid() IS NULL THEN');
    expect(body).toContain("v_role NOT IN ('owner','admin')");
    expect(body).toContain('v_before.company_id::text <> v_company');
  });

  it('recusa sessão já removida', () => {
    expect(body).toContain('v_before.deleted_at IS NOT NULL');
  });

  it('é exclusão lógica: nenhum DELETE em tabela alguma', () => {
    expect(body).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(body).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('preenche autor, data e justificativa no mesmo UPDATE', () => {
    const update = body.slice(body.indexOf('UPDATE physical_count_sessions'));
    expect(update).toContain('deleted_at      = now()');
    expect(update).toContain('deleted_by      = auth.uid()');
    expect(update).toContain('deletion_reason = v_reason');
  });

  it('registra faixa, status, total de itens e justificativa na auditoria', () => {
    expect(body).toContain("'physical_count.session_deleted'");
    expect(body).toContain('INSERT INTO audit_logs');
    for (const key of ["'range'", "'status'", "'totalItems'", "'reason'", "'deletedBy'", "'deletedAt'"]) {
      expect(body).toContain(key);
    }
  });

  it('não apaga itens, eventos de contagem, eventos de ERP nem recontagens', () => {
    for (const table of [
      'physical_count_items',
      'physical_count_events',
      'erp_sync_events',
      'physical_count_recount_events',
    ]) {
      expect(body).not.toContain(table);
    }
  });

  it('é revogada de PUBLIC e de anon, e liberada só para authenticated', () => {
    expect(MIGRATION_059).toContain(
      'REVOKE EXECUTE ON FUNCTION public.pc_admin_delete_session(uuid, text) FROM PUBLIC;'
    );
    expect(MIGRATION_059).toContain(
      'REVOKE EXECUTE ON FUNCTION public.pc_admin_delete_session(uuid, text) FROM anon;'
    );
    expect(MIGRATION_059).toContain(
      'GRANT  EXECUTE ON FUNCTION public.pc_admin_delete_session(uuid, text) TO authenticated;'
    );
  });
});

describe('migration 059 — fechamento do hard delete e da escrita direta', () => {
  it('remove a policy de DELETE direto (que valia até para manager)', () => {
    expect(MIGRATION_059).toContain('DROP POLICY IF EXISTS "pc_sessions_delete" ON physical_count_sessions;');
    // E não recria nenhuma.
    expect(MIGRATION_059).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/i);
  });

  it('remove a policy de UPDATE direto', () => {
    expect(MIGRATION_059).toContain('DROP POLICY IF EXISTS "pc_sessions_update" ON physical_count_sessions;');
    expect(MIGRATION_059).not.toMatch(/CREATE POLICY[^;]*FOR UPDATE/i);
  });

  it('as RPCs operacionais que recebem uma sessão recusam sessão removida', () => {
    for (const fn of [
      'pc_start_session',
      'pc_register_count',
      'pc_flag_found_elsewhere',
      'pc_finalize_session',
      'pc_create_recount_session',
      'pc_reopen_session',
      'pc_approve_session',
      'pc_record_erp_sync_event',
    ]) {
      const body = functionBody(MIGRATION_059, fn);
      expect(body, `${fn} deveria estar na migration`).not.toBe('');
      expect(body, `${fn} deveria recusar sessão removida`).toContain(
        "RAISE EXCEPTION 'Esta contagem foi removida do histórico.'"
      );
    }
  });

  it('as três colunas de exclusão lógica são adicionadas', () => {
    for (const column of ['deleted_at', 'deleted_by', 'deletion_reason']) {
      expect(MIGRATION_059).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
  });
});

// ── 6. A tabela é atualizada depois de editar ou remover ─────────────────────
//
// Verificação estrutural: o projeto não tem @testing-library/react nem jsdom
// (nenhum teste renderiza componente), e trazer as duas coisas só para este
// caso seria acrescentar dependência e configuração ao build de um SaaS em
// produção. O que dá para garantir sem isso é que o caminho de recarga existe e
// continua ligado — que é exatamente o que quebraria por descuido.

const SOURCES = import.meta.glob('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('PhysicalCountSessionsTab', () => {
  const source = SOURCES['/src/components/counting/PhysicalCountSessionsTab.tsx'] ?? '';

  it('recarrega a lista e mostra a confirmação quando uma ação administrativa termina', () => {
    expect(source).not.toBe('');
    const handler = source.slice(source.indexOf('onDone={message =>'), source.indexOf('}}\n                        />'));
    expect(handler).toContain('setAdminNotice(message)');
    expect(handler).toContain('refresh()');
  });

  it('o menu administrativo só é montado para quem pode gerenciar o histórico', () => {
    expect(source).toContain('canManageHistory && (');
    expect(source).toContain('canManageSessionHistory(profile?.role)');
  });

  it('preserva os botões Continuar e Ver', () => {
    expect(source).toContain('Continuar');
    expect(source).toContain('Ver');
  });
});
