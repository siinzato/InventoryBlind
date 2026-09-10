import { describe, expect, it } from 'vitest';

const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MIGRATION_093 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('093_admin_session_management')) ?? ''] ?? '';

describe('migration 093 — gerenciamento administrativo de sessões', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_093.length).toBeGreaterThan(0);
  });

  it('não cria nenhuma tabela nova — só as 5 funções', () => {
    expect(MIGRATION_093).not.toMatch(/CREATE TABLE/i);
  });

  it('não faz DROP/TRUNCATE/DELETE FROM em nenhuma tabela de aplicação (só DELETE FROM auth.sessions, intencional)', () => {
    expect(MIGRATION_093).not.toMatch(/DROP TABLE|TRUNCATE/i);
    const deletes = [...MIGRATION_093.matchAll(/DELETE FROM (\w+(?:\.\w+)?)/g)].map(m => m[1]);
    expect(deletes.length).toBeGreaterThan(0);
    for (const target of deletes) {
      expect(target).toBe('auth.sessions');
    }
  });

  it('cria exatamente as 5 funções esperadas', () => {
    for (const fn of [
      'admin_list_company_sessions',
      'admin_revoke_session',
      'admin_revoke_user_sessions',
      'owner_revoke_company_sessions',
      'admin_get_session_ips',
    ]) {
      expect(MIGRATION_093).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    }
  });

  it('todas as 5 funções são SECURITY DEFINER com search_path fixo', () => {
    const defs = MIGRATION_093.split('CREATE OR REPLACE FUNCTION public.').slice(1);
    expect(defs.length).toBe(5);
    for (const def of defs) {
      expect(def).toContain('SECURITY DEFINER');
      expect(def).toContain("SET search_path TO 'public'");
    }
  });

  it('todas checam owner/admin (ou owner-only na ação de emergência) antes de qualquer leitura/escrita', () => {
    const ownerAdminChecks = [...MIGRATION_093.matchAll(/v_role NOT IN \('owner', 'admin'\)/g)];
    // list, revoke_session, revoke_user_sessions, get_session_ips
    expect(ownerAdminChecks.length).toBe(4);
    expect(MIGRATION_093).toContain("v_role <> 'owner'");
  });

  it('nenhuma função usa SQL dinâmico (EXECUTE)', () => {
    expect(MIGRATION_093).not.toMatch(/\bEXECUTE\s+(format|'|")/i);
  });

  it('admin_list_company_sessions nunca seleciona colunas de token — só as colunas declaradas de auth.sessions', () => {
    const start = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_list_company_sessions(');
    const end = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_revoke_session(');
    const body = MIGRATION_093.slice(start, end);
    expect(body).not.toMatch(/access_token|refresh_token/i);
  });

  it('admin_list_company_sessions isola por empresa (profiles.company_id = v_company) e nunca por company_members diretamente', () => {
    const start = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_list_company_sessions(');
    const end = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_revoke_session(');
    const body = MIGRATION_093.slice(start, end);
    expect(body).toContain('WHERE p.company_id = v_company');
  });

  it('admin_list_company_sessions expõe is_multi_company calculado sobre company_members, nunca a lista de outras empresas', () => {
    const start = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_list_company_sessions(');
    const end = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_revoke_session(');
    const body = MIGRATION_093.slice(start, end);
    expect(body).toContain('FROM company_members cm WHERE cm.user_id = s.user_id) <> 1');
    expect(body).not.toMatch(/SELECT\s+company_id\s+FROM\s+company_members/i);
  });

  it('admin_list_company_sessions usa auth.jwt() ->> session_id para achar a sessão atual, sem parâmetro do client', () => {
    const start = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_list_company_sessions(');
    const end = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_revoke_session(');
    const body = MIGRATION_093.slice(start, end);
    expect(body).toContain(`auth.jwt() ->> 'session_id'`);
  });

  it('admin_revoke_session impede revogar a própria sessão atual antes de qualquer DELETE', () => {
    const start = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_revoke_session(');
    const end = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(');
    const body = MIGRATION_093.slice(start, end);
    const guardIdx = body.indexOf('Não é possível encerrar a sua própria sessão atual');
    const deleteIdx = body.indexOf('DELETE FROM auth.sessions');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(guardIdx);
  });

  it('admin_revoke_session confere a empresa da sessão-alvo e o vínculo monoempresa antes do DELETE', () => {
    const start = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_revoke_session(');
    const end = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(');
    const body = MIGRATION_093.slice(start, end);
    const companyCheckIdx = body.indexOf('Esta sessão não pertence a esta empresa.');
    const multiCompanyCheckIdx = body.indexOf('v_membership_count <> 1');
    const deleteIdx = body.indexOf('DELETE FROM auth.sessions');
    expect(companyCheckIdx).toBeGreaterThan(-1);
    expect(multiCompanyCheckIdx).toBeGreaterThan(-1);
    expect(companyCheckIdx).toBeLessThan(deleteIdx);
    expect(multiCompanyCheckIdx).toBeLessThan(deleteIdx);
  });

  it('admin_revoke_session grava em audit_logs E security_logs com a mesma ação, sem token no metadata', () => {
    const start = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_revoke_session(');
    const end = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(');
    const body = MIGRATION_093.slice(start, end);
    expect(body).toContain("'security.session_revoked'");
    expect((body.match(/INSERT INTO audit_logs/g) ?? []).length).toBe(1);
    expect((body.match(/INSERT INTO security_logs/g) ?? []).length).toBe(1);
    expect(body).not.toMatch(/access_token|refresh_token/i);
  });

  it('admin_revoke_user_sessions preserva a sessão atual do operador mesmo quando o alvo é ele mesmo', () => {
    const start = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(');
    const end = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.owner_revoke_company_sessions(');
    const body = MIGRATION_093.slice(start, end);
    expect(body).toContain('AND (v_current_session IS NULL OR id <> v_current_session)');
  });

  it('admin_revoke_user_sessions confere empresa e vínculo monoempresa do alvo antes de deletar', () => {
    const start = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(');
    const end = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.owner_revoke_company_sessions(');
    const body = MIGRATION_093.slice(start, end);
    const companyCheckIdx = body.indexOf('Usuário não pertence a esta empresa.');
    const multiCheckIdx = body.indexOf('v_membership_count <> 1');
    const deleteIdx = body.indexOf('WITH deleted AS');
    expect(companyCheckIdx).toBeGreaterThan(-1);
    expect(multiCheckIdx).toBeGreaterThan(-1);
    expect(companyCheckIdx).toBeLessThan(deleteIdx);
    expect(multiCheckIdx).toBeLessThan(deleteIdx);
  });

  it('admin_revoke_user_sessions retorna a quantidade revogada (RETURNS integer)', () => {
    expect(MIGRATION_093).toContain('CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(\n  p_user_id uuid,\n  p_reason  text DEFAULT NULL\n)\nRETURNS integer');
  });

  it('owner_revoke_company_sessions é owner-only, nunca aceita admin', () => {
    const start = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.owner_revoke_company_sessions(');
    const end = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_get_session_ips(');
    const body = MIGRATION_093.slice(start, end);
    expect(body).toContain("v_role <> 'owner'");
    expect(body).not.toMatch(/v_role NOT IN \('owner', ?'admin'\)/);
  });

  it('owner_revoke_company_sessions exige a confirmação exata "ENCERRAR SESSÕES" antes de qualquer DELETE', () => {
    const start = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.owner_revoke_company_sessions(');
    const end = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_get_session_ips(');
    const body = MIGRATION_093.slice(start, end);
    const confirmIdx = body.indexOf("p_confirmation IS DISTINCT FROM 'ENCERRAR SESSÕES'");
    const deleteIdx = body.indexOf('DELETE FROM auth.sessions');
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeLessThan(deleteIdx);
  });

  it('owner_revoke_company_sessions preserva a sessão atual e pula usuários multiempresa (só afeta membership_count = 1)', () => {
    const start = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.owner_revoke_company_sessions(');
    const end = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_get_session_ips(');
    const body = MIGRATION_093.slice(start, end);
    expect(body).toContain('AND (v_current_session IS NULL OR s.id <> v_current_session)');
    expect(body).toContain('WHERE cm.user_id = p.id) = 1');
  });

  it('owner_revoke_company_sessions retorna revoked_count e skipped_count', () => {
    expect(MIGRATION_093).toContain('RETURNS TABLE (revoked_count integer, skipped_count integer)');
  });

  it('admin_get_session_ips nunca aceita IP do client — só devolve o IP já armazenado em auth.sessions, filtrado por empresa', () => {
    const start = MIGRATION_093.indexOf('CREATE OR REPLACE FUNCTION public.admin_get_session_ips(');
    const body = MIGRATION_093.slice(start);
    expect(body).toContain('p_session_ids uuid[]');
    expect(body).not.toMatch(/p_ip/i);
    expect(body).toContain('WHERE p.company_id = v_company');
  });

  it('todas as 5 funções são revogadas de PUBLIC/anon e liberadas só para authenticated', () => {
    for (const sig of [
      'admin_list_company_sessions(text, text, text, integer, integer)',
      'admin_revoke_session(uuid, text)',
      'admin_revoke_user_sessions(uuid, text)',
      'owner_revoke_company_sessions(text, text)',
      'admin_get_session_ips(uuid[])',
    ]) {
      expect(MIGRATION_093).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC`);
      expect(MIGRATION_093).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM anon`);
      expect(MIGRATION_093).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO authenticated`);
    }
  });

  it('as 3 ações de auditoria novas usadas aqui existem no union AuditAction', () => {
    for (const action of ['security.session_revoked', 'security.user_sessions_revoked', 'security.company_sessions_revoked']) {
      expect(MIGRATION_093).toContain(`'${action}'`);
    }
  });
});
