// Trava em disco as propriedades da migration 115 (hardening de isolamento). Mesmo
// mecanismo dos migrationGuards.test.ts já existentes: não roda SQL — não há Postgres
// local neste projeto —, lê o arquivo e prova que o conteúdo continua sendo o que a
// auditoria concluiu. A prova de comportamento em banco real está em
// crossTenantIsolation.test.ts, que roda quando apontado para um Supabase descartável.

import { describe, expect, it } from 'vitest';

const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const M115 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('115_security_hardening_tenant_isolation')) ?? ''] ?? '';

/** Corpo de uma função dentro da migration, do CREATE OR REPLACE até o fim do bloco. */
const fnBody = (name: string): string => {
  const start = M115.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) return '';
  const end = M115.indexOf('$function$;', start);
  return M115.slice(start, end < 0 ? undefined : end);
};

describe('migration 115 — existe e não é destrutiva', () => {
  it('existe e não está vazia', () => {
    expect(M115.length).toBeGreaterThan(0);
  });

  it('nunca desabilita RLS nem abre policy', () => {
    expect(M115).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(M115).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    expect(M115).not.toMatch(/WITH\s+CHECK\s*\(\s*true\s*\)/i);
  });

  it('não apaga dado nem tabela', () => {
    expect(M115).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(M115).not.toMatch(/\bTRUNCATE\b/i);
    expect(M115).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('não usa GRANT ALL nem alarga privilégio de anon', () => {
    expect(M115).not.toMatch(/GRANT\s+ALL/i);
    expect(M115).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/i);
  });

  it('só remove as policies legadas, e apenas com IF EXISTS', () => {
    const drops = M115.match(/DROP POLICY[^;]*/gi) ?? [];
    expect(drops.length).toBe(6);
    for (const drop of drops) {
      expect(drop).toContain('IF EXISTS');
      expect(drop).toMatch(/anon_(insert|update|delete)_inventory_(kpi|top_vendas)_history/);
    }
  });

  it('preserva as policies estritas — nenhuma delas é tocada', () => {
    for (const strict of ['inv_kpi_hist_insert', 'inv_kpi_hist_update', 'inv_kpi_hist_delete', 'inv_tv_hist_insert']) {
      expect(M115).not.toContain(strict);
    }
  });
});

describe('migration 115 — guardas falham FECHADO (a falha de NULL do update_member_role)', () => {
  const body = fnBody('update_member_role');

  it('reescreve update_member_role', () => {
    expect(body.length).toBeGreaterThan(0);
  });

  it('testa NULL de sessão, empresa e papel ANTES de comparar papel', () => {
    const nullGuard = body.indexOf('v_caller_role IS NULL');
    const roleCheck = body.indexOf("v_caller_role NOT IN ('owner', 'admin')");
    expect(nullGuard).toBeGreaterThan(-1);
    expect(roleCheck).toBeGreaterThan(-1);
    expect(nullGuard).toBeLessThan(roleCheck);
    expect(body).toContain('auth.uid() IS NULL');
    expect(body).toContain('v_caller_company IS NULL');
  });

  it('compara empresas com IS DISTINCT FROM, que não devolve NULL', () => {
    expect(body).toContain('v_target_company::text IS DISTINCT FROM v_caller_company');
    // O operador <> com NULL foi exatamente o que deixava a guarda passar.
    expect(body).not.toMatch(/v_target_company::text\s*<>\s*v_caller_company/);
  });

  it('preserva as regras de negócio existentes de papel', () => {
    expect(body).toContain("v_caller_role = 'admin' AND new_role = 'owner'");
    expect(body).toContain("v_caller_role = 'admin' AND v_target_current_role = 'owner'");
    expect(body).toContain("new_role NOT IN ('owner', 'admin', 'manager', 'counter', 'viewer')");
  });
});

describe('migration 115 — entrar em workspace exige convite', () => {
  const body = fnBody('link_user_to_company');

  it('exige autenticação e convite ou membership', () => {
    expect(body).toContain('auth.uid() IS NULL');
    expect(body).toContain('FROM company_members');
    expect(body).toContain('FROM company_invitations');
    expect(body).toContain("status = 'pending'");
    expect(body).toContain("RAISE EXCEPTION 'No invitation for this company'");
  });

  it('continua impedindo re-vínculo de quem já tem empresa', () => {
    expect(body).toContain("RAISE EXCEPTION 'User already linked to a company'");
  });
});

describe('migration 115 — company_id do cliente deixa de ser confiável', () => {
  const body = fnBody('rca_next_case_number');

  it('valida o argumento contra a empresa da sessão e grava a da sessão', () => {
    expect(body).toContain('v_company := get_my_company_id()');
    expect(body).toContain('p_company_id IS DISTINCT FROM v_company');
    expect(body).toContain('VALUES (v_company, p_year, 1)');
    // O valor do cliente nunca mais chega ao INSERT.
    expect(body).not.toContain('VALUES (p_company_id');
  });

  it('mantém a assinatura, para não quebrar o chamador do front', () => {
    expect(M115).toContain('rca_next_case_number(p_company_id text, p_year integer)');
  });
});

describe('migration 115 — DEFAULT DENY de EXECUTE', () => {
  it('nenhuma das 35 funções antes expostas continua executável por anon', () => {
    const revoked = new Set(
      (M115.match(/REVOKE EXECUTE ON FUNCTION public\.([a-z_]+)\s*\(/gi) ?? [])
        .map(line => line.replace(/REVOKE EXECUTE ON FUNCTION public\./i, '').replace(/\s*\($/, '')),
    );
    const antesExpostas = [
      'automation_on_count_item_counted', 'automation_on_count_session_created',
      'automation_on_count_session_status', 'automation_on_stock_conflict',
      'automation_prune_history', 'automation_reap_stuck_events',
      'create_additional_company', 'create_company_onboarding', 'enforce_user_shortcuts_limit',
      'integration_intelligence_snapshot', 'integration_negative_stock_detail',
      'link_user_to_company', 'nfe_claim_key_fetch', 'nfe_finalize_conference',
      'nfe_guard_archived_invoice', 'nfe_guard_archived_parent', 'nfe_register_count',
      'nfe_reopen_conference', 'nfe_start_conference', 'pc_acknowledge_recount_event',
      'pc_approve_session', 'pc_create_recount_session', 'pc_create_session',
      'pc_evaluate_auto_recount', 'pc_flag_found_elsewhere', 'pc_measure_session_divergence',
      'pc_record_erp_sync_event', 'pc_register_count', 'pc_reopen_session',
      'rca_next_case_number', 'switch_active_company', 'task_assignees_recompute_status',
      'task_log_attachment', 'task_log_comment', 'update_member_role',
    ];
    expect(antesExpostas).toHaveLength(35);
    expect(antesExpostas.filter(fn => !revoked.has(fn))).toEqual([]);
  });

  it('as funções de manutenção sem chamador ficam só com service_role', () => {
    for (const fn of ['automation_prune_history(integer)', 'automation_reap_stuck_events(integer)']) {
      const revoke = M115.split('\n').find(l => l.includes(`REVOKE EXECUTE ON FUNCTION public.${fn}`)) ?? '';
      expect(revoke).toContain('FROM PUBLIC, anon, authenticated;');
      const grant = M115.split('\n').find(l => l.includes(`GRANT  EXECUTE ON FUNCTION public.${fn}`)) ?? '';
      expect(grant).toContain('TO service_role;');
    }
  });

  it('as só-internas também saem de authenticated', () => {
    for (const fn of ['pc_evaluate_auto_recount(uuid)', 'pc_measure_session_divergence(uuid)']) {
      const line = M115.split('\n').find(l => l.includes(`REVOKE EXECUTE ON FUNCTION public.${fn}`)) ?? '';
      expect(line).toContain('authenticated');
    }
  });

  it('as RPCs de negócio continuam disponíveis para authenticated', () => {
    for (const fn of ['pc_register_count', 'nfe_register_count', 'create_company_onboarding', 'update_member_role']) {
      const line = M115.split('\n').find(l => l.includes(`REVOKE EXECUTE ON FUNCTION public.${fn}(`)) ?? '';
      expect(line).toContain('FROM anon;');
      expect(line).not.toContain('authenticated');
    }
  });

  // REVOKE FROM anon NÃO protege função que também tem EXECUTE para PUBLIC: anon herda o
  // privilégio por PUBLIC e continua chamando. Estas duas são as únicas RPCs de negócio
  // nessa situação (`=X/postgres` no proacl do banco vivo) — as duas saem de PUBLIC e
  // recebem GRANT explícito, para o estado final não depender do ACL de origem.
  it('as duas RPCs que também tinham PUBLIC saem de PUBLIC, não só de anon', () => {
    for (const fn of ['rca_next_case_number(text, integer)', 'nfe_claim_key_fetch(text)']) {
      const revoke = M115.split('\n').find(l => l.includes(`REVOKE EXECUTE ON FUNCTION public.${fn}`)) ?? '';
      expect(revoke).toContain('FROM PUBLIC, anon;');
      const grant = M115.split('\n').find(l => l.includes(`GRANT  EXECUTE ON FUNCTION public.${fn}`)) ?? '';
      expect(grant).toContain('TO authenticated;');
    }
  });

  // As 8 funções que retornam `trigger` e ainda tinham EXECUTE para PUBLIC/anon. Não são
  // SECURITY DEFINER — nunca foram escalonamento —, mas não há motivo para anon tê-las.
  it('nenhuma função de trigger continua executável por PUBLIC ou anon', () => {
    for (const fn of [
      'automation_refresh_schedule', 'automation_touch_version',
      'integration_connections_check_fiscal_entity', 'inventory_cycles_block_reopen',
      'inventory_items_block_closed_cycle', 'returns_check_origin_channel_connection',
      'update_full_operations_updated_at', 'update_updated_at_column',
    ]) {
      const line = M115.split('\n').find(l => l.includes(`REVOKE EXECUTE ON FUNCTION public.${fn}()`)) ?? '';
      expect(line).toContain('FROM PUBLIC, anon;');
    }
  });
});

describe('migration 115 — rate limit da public-api', () => {
  const body = fnBody('api_key_consume_rate_limit');

  it('a tabela do contador não tem policy: só a SECURITY DEFINER toca nela', () => {
    expect(M115).toContain('CREATE TABLE IF NOT EXISTS api_key_rate_limits');
    expect(M115).toContain('ALTER TABLE api_key_rate_limits ENABLE ROW LEVEL SECURITY;');
    // Nenhuma policy criada para esta tabela em lugar nenhum da migration.
    expect(M115).not.toMatch(/CREATE POLICY[^;]*api_key_rate_limits/i);
  });

  it('o contador é por chave e some junto com a chave', () => {
    expect(M115).toContain('api_key_id    uuid PRIMARY KEY REFERENCES api_keys(id) ON DELETE CASCADE');
  });

  it('a reserva é atômica — um único comando, sem ler-depois-gravar', () => {
    expect(body).toContain('INSERT INTO api_key_rate_limits AS rl');
    expect(body).toContain('ON CONFLICT (api_key_id) DO UPDATE');
    expect(body).toContain('RETURNING rl.request_count INTO v_count');
    // Nada de SELECT prévio para decidir: seria corrida entre requisições simultâneas.
    expect(body).not.toMatch(/SELECT[^;]*FROM api_key_rate_limits/i);
  });

  it('a janela reinicia quando expira e incrementa quando não', () => {
    expect(body).toContain('rl.window_start < now() - make_interval(secs => p_window_seconds) THEN now()');
    expect(body).toContain('rl.request_count + 1');
  });

  it('falha FECHADO: argumento inválido nega, nunca libera', () => {
    const guard = body.slice(0, body.indexOf('INSERT INTO api_key_rate_limits'));
    expect(guard).toContain('p_api_key_id IS NULL');
    expect(guard).toContain('p_limit < 1');
    expect(guard).toContain('RETURN false;');
  });

  it('o veredito é o teto, não o contador cru', () => {
    expect(body).toContain('RETURN v_count <= p_limit;');
  });

  it('nenhum papel de API executa o contador — só o backend', () => {
    const revoke = M115.split('\n').find(l => l.includes('REVOKE EXECUTE ON FUNCTION public.api_key_consume_rate_limit')) ?? '';
    expect(revoke).toContain('FROM PUBLIC, anon, authenticated;');
    const grant = M115.split('\n').find(l => l.includes('GRANT  EXECUTE ON FUNCTION public.api_key_consume_rate_limit')) ?? '';
    expect(grant).toContain('TO service_role;');
  });
});

describe('public-api — o teto é consumido no lugar certo', () => {
  const SOURCE = import.meta.glob('/supabase/functions/public-api/index.ts', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>;
  const api = Object.values(SOURCE)[0] ?? '';

  it('o arquivo foi encontrado', () => {
    expect(api.length).toBeGreaterThan(0);
  });

  it('consome o teto DEPOIS de validar a chave, e antes de ler produto', () => {
    const revogada = api.indexOf("keyRow.revoked_at");
    const limite = api.indexOf("api_key_consume_rate_limit");
    const produto = api.indexOf("from('products')");
    expect(revogada).toBeGreaterThan(-1);
    expect(limite).toBeGreaterThan(revogada);
    expect(produto).toBeGreaterThan(limite);
  });

  it('responde 429 com Retry-After, sem revelar nada de outras chaves', () => {
    expect(api).toContain("status: 429");
    expect(api).toContain("'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)");
    expect(api).toContain("code: 'rate_limited'");
  });

  it('erro no contador NEGA a requisição — teto que falha aberto não é teto', () => {
    expect(api).toContain("return fail(503, 'rate_limit_unavailable'");
    expect(api).toContain('if (withinLimit !== true)');
  });

  it('a autenticação por SHA-256 e o isolamento por empresa continuam intactos', () => {
    expect(api).toContain('const keyHash = await sha256Hex(presented);');
    expect(api).toContain(".eq('company_id', String(keyRow.company_id))");
    // A chave apresentada nunca é registrada em log.
    expect(api).not.toMatch(/console\.(log|error|warn)\([^)]*presented/);
  });
});

describe('migration 115 — as três auxiliares que ainda alcançavam anon', () => {
  it('is_valid_cnpj e company_webhook_allowed_events saem de todos os papéis de API', () => {
    for (const fn of ['is_valid_cnpj(text)', 'company_webhook_allowed_events()']) {
      const revoke = M115.split('\n').find(l => l.includes(`REVOKE EXECUTE ON FUNCTION public.${fn}`)) ?? '';
      expect(revoke).toContain('FROM PUBLIC, anon, authenticated;');
      // Nenhuma volta a receber grant depois.
      const grants = M115.split('\n').filter(l => l.trimStart().startsWith('GRANT') && l.includes(`public.${fn}`));
      expect(grants).toEqual([]);
    }
  });

  // automation_next_schedule_run é chamada de dentro de automation_refresh_schedule, que
  // é SECURITY INVOKER: ali o usuário efetivo é quem disparou o trigger, então
  // authenticated PRECISA de EXECUTE. Revogar de authenticated quebraria gravar automação.
  it('automation_next_schedule_run perde anon mas mantém authenticated', () => {
    const revoke = M115.split('\n').find(l => l.includes('REVOKE EXECUTE ON FUNCTION public.automation_next_schedule_run')) ?? '';
    expect(revoke).toContain('FROM PUBLIC, anon;');
    expect(revoke).not.toContain('authenticated');
    const grant = M115.split('\n').find(l => l.includes('GRANT  EXECUTE ON FUNCTION public.automation_next_schedule_run')) ?? '';
    expect(grant).toContain('TO authenticated;');
  });

  // Fechamento do contador: as 46 funções que o banco vivo reportava como executáveis por
  // anon precisam TODAS aparecer em alguma linha de REVOKE. Qualquer função nova que
  // apareça executável por anon sem passar por aqui derruba esta guarda.
  it('as 46 funções alcançáveis por anon estão todas cobertas por um REVOKE', () => {
    const revoked = new Set(
      (M115.match(/REVOKE EXECUTE ON FUNCTION public\.([a-z_]+)\s*\(/gi) ?? [])
        .map(l => l.replace(/REVOKE EXECUTE ON FUNCTION public\./i, '').replace(/\s*\($/, '')),
    );
    const alcancaveisPorAnon = [
      // 35 SECURITY DEFINER
      'automation_on_count_item_counted', 'automation_on_count_session_created',
      'automation_on_count_session_status', 'automation_on_stock_conflict',
      'automation_prune_history', 'automation_reap_stuck_events',
      'create_additional_company', 'create_company_onboarding', 'enforce_user_shortcuts_limit',
      'integration_intelligence_snapshot', 'integration_negative_stock_detail',
      'link_user_to_company', 'nfe_claim_key_fetch', 'nfe_finalize_conference',
      'nfe_guard_archived_invoice', 'nfe_guard_archived_parent', 'nfe_register_count',
      'nfe_reopen_conference', 'nfe_start_conference', 'pc_acknowledge_recount_event',
      'pc_approve_session', 'pc_create_recount_session', 'pc_create_session',
      'pc_evaluate_auto_recount', 'pc_flag_found_elsewhere', 'pc_measure_session_divergence',
      'pc_record_erp_sync_event', 'pc_register_count', 'pc_reopen_session',
      'rca_next_case_number', 'switch_active_company', 'task_assignees_recompute_status',
      'task_log_attachment', 'task_log_comment', 'update_member_role',
      // 11 SECURITY INVOKER
      'automation_next_schedule_run', 'automation_refresh_schedule', 'automation_touch_version',
      'company_webhook_allowed_events', 'integration_connections_check_fiscal_entity',
      'inventory_cycles_block_reopen', 'inventory_items_block_closed_cycle', 'is_valid_cnpj',
      'returns_check_origin_channel_connection', 'update_full_operations_updated_at',
      'update_updated_at_column',
    ];
    expect(alcancaveisPorAnon).toHaveLength(46);
    expect(new Set(alcancaveisPorAnon).size).toBe(46);
    expect(alcancaveisPorAnon.filter(fn => !revoked.has(fn))).toEqual([]);
  });

  it('a migration nunca concede nada a anon', () => {
    expect(M115).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/i);
  });
});
