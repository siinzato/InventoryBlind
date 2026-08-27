import { describe, expect, it } from 'vitest';

const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MIGRATION_082 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('082_company_invite_codes')) ?? ''] ?? '';

describe('migration 082 — código de convite da empresa', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_082.length).toBeGreaterThan(0);
  });

  it('cria as duas RPCs', () => {
    expect(MIGRATION_082).toContain('CREATE OR REPLACE FUNCTION public.get_or_create_daily_invite_code()');
    expect(MIGRATION_082).toContain('CREATE OR REPLACE FUNCTION public.join_company_by_invite_code(p_code text)');
  });

  it('no máximo um código por empresa por dia', () => {
    expect(MIGRATION_082).toContain('CREATE UNIQUE INDEX IF NOT EXISTS company_invite_codes_company_day_idx');
    expect(MIGRATION_082).toContain('ON company_invite_codes (company_id, valid_date)');
  });

  it('código é globalmente único — a validação de entrada não depende de saber a empresa antes', () => {
    expect(MIGRATION_082).toContain('CREATE UNIQUE INDEX IF NOT EXISTS company_invite_codes_code_idx');
    expect(MIGRATION_082).toContain('ON company_invite_codes (code)');
  });

  it('gerar código exige owner/admin', () => {
    expect(MIGRATION_082).toContain("v_role NOT IN ('owner','admin')");
  });

  it('reabrir a tela no mesmo dia reaproveita o código — não invalida um que já foi compartilhado', () => {
    expect(MIGRATION_082).toContain('WHERE company_id = v_company::uuid AND valid_date = CURRENT_DATE');
    expect(MIGRATION_082).toContain('IF FOUND THEN\n    RETURN v_result;');
  });

  it('rotação diária é validada no servidor: código de outro dia é rejeitado mesmo existindo', () => {
    expect(MIGRATION_082).toContain('IF v_row.valid_date <> CURRENT_DATE THEN');
    expect(MIGRATION_082).toContain('expirou');
  });

  it('quem entra por código nunca vira owner/admin automaticamente — sempre viewer', () => {
    expect(MIGRATION_082).toMatch(/VALUES \(v_uid, v_row\.company_id, 'viewer'\)/);
    expect(MIGRATION_082).toMatch(/SET company_id = v_row\.company_id, role = 'viewer'/);
  });

  it('nunca troca uma empresa ativa por outra — só ativa quando profiles.company_id era nulo', () => {
    expect(MIGRATION_082).toContain('IF v_current_company IS NULL THEN');
  });

  it('company_invite_codes não tem nenhuma policy de INSERT/UPDATE/DELETE para o cliente', () => {
    expect(MIGRATION_082).not.toMatch(/CREATE POLICY[^;]*company_invite_codes[^;]*FOR (INSERT|UPDATE|DELETE)/);
  });

  it('SELECT restrito a owner/admin da própria empresa', () => {
    expect(MIGRATION_082).toContain('CREATE POLICY "company_invite_codes_select" ON company_invite_codes FOR SELECT');
    expect(MIGRATION_082).toContain("company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin')");
  });

  it('o código completo nunca é gravado em audit_logs — só mascarado', () => {
    expect(MIGRATION_082).toContain("'codeMasked'");
    expect(MIGRATION_082).not.toMatch(/'code',\s*v_code/);
  });

  it('as duas RPCs são revogadas de anon/PUBLIC e liberadas só para authenticated', () => {
    for (const fn of ['get_or_create_daily_invite_code()', 'join_company_by_invite_code(text)']) {
      expect(MIGRATION_082).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC`);
      expect(MIGRATION_082).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM anon`);
      expect(MIGRATION_082).toContain(`GRANT  EXECUTE ON FUNCTION public.${fn} TO authenticated`);
    }
  });

  it('gera auditoria ao gerar e ao usar um código', () => {
    expect(MIGRATION_082).toContain("'company.invite_code_generated'");
    expect(MIGRATION_082).toContain("'company.invite_code_joined'");
  });

  it('não faz DROP/TRUNCATE/DELETE FROM em nenhuma tabela', () => {
    expect(MIGRATION_082).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });
});
