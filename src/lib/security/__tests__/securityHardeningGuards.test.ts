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
});
