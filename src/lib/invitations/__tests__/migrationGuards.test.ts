import { describe, expect, it } from 'vitest';

// Mesmo mecanismo já usado em nfe/adminSales/purchaseOrders/migrationGuards.test.ts: sem Postgres
// para apontar, confere que as garantias de segurança do convite continuam escritas na migration —
// em especial que accept_pending_invitations() nunca aceita um company_id vindo do cliente (só usa
// o do próprio convite pendente, resolvido por e-mail), e que create_company_invitation() nunca cria
// um convite de 'owner'.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MIGRATION_080 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('080_company_invitations')) ?? ''] ?? '';

describe('migration 080 — convite de funcionário', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_080.length).toBeGreaterThan(0);
  });

  it('cria as duas RPCs que o fluxo de convite usa', () => {
    expect(MIGRATION_080).toContain('CREATE OR REPLACE FUNCTION public.create_company_invitation(');
    expect(MIGRATION_080).toContain('CREATE OR REPLACE FUNCTION public.accept_pending_invitations()');
  });

  it('accept_pending_invitations não recebe nenhum parâmetro — nunca um company_id vindo do cliente', () => {
    expect(MIGRATION_080).toContain('CREATE OR REPLACE FUNCTION public.accept_pending_invitations()\nRETURNS TABLE');
  });

  it('o e-mail do aceite vem sempre de auth.users pelo auth.uid(), nunca de parâmetro', () => {
    expect(MIGRATION_080).toContain('FROM auth.users WHERE id = v_uid');
  });

  it('create_company_invitation nunca aceita role=owner', () => {
    expect(MIGRATION_080).toContain("IF p_role NOT IN ('admin','manager','counter','viewer') THEN");
  });

  it('create_company_invitation exige owner/admin do chamador', () => {
    expect(MIGRATION_080).toContain("v_role NOT IN ('owner','admin')");
  });

  it('índice único parcial impede convite pendente duplicado por empresa/e-mail', () => {
    expect(MIGRATION_080).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS company_invitations_pending_idx\s+ON company_invitations \(company_id, email_normalized\)\s+WHERE status = 'pending'/
    );
  });

  it('reivindicação do convite é atômica — só transiciona quem ainda está pending (proteção contra corrida)', () => {
    const claimBlocks = MIGRATION_080.match(/UPDATE company_invitations\s+SET status = 'accepted'[^;]+;/g) ?? [];
    expect(claimBlocks.length).toBe(1);
    expect(claimBlocks[0]).toContain("WHERE id = v_inv.id AND status = 'pending'");
  });

  it('convite expirado é marcado e pulado, nunca concede acesso', () => {
    expect(MIGRATION_080).toContain("SET status = 'expired'");
    expect(MIGRATION_080).toContain('IF v_inv.expires_at < now() THEN');
  });

  it('profiles.company_id só é ativado quando o chamador ainda não tinha nenhuma empresa — nunca troca uma empresa ativa por outra', () => {
    expect(MIGRATION_080).toContain('IF v_current_company IS NULL THEN');
  });

  it('company_members nunca reduz/eleva uma role já existente por esta via (ON CONFLICT DO NOTHING)', () => {
    expect(MIGRATION_080).toMatch(/INSERT INTO company_members \(user_id, company_id, role\)[\s\S]{0,80}ON CONFLICT \(user_id, company_id\) DO NOTHING/);
  });

  it('company_invitations não tem nenhuma policy de INSERT/UPDATE/DELETE para o cliente', () => {
    expect(MIGRATION_080).not.toMatch(/CREATE POLICY[^;]*company_invitations[^;]*FOR (INSERT|UPDATE|DELETE)/);
  });

  it('SELECT de company_invitations é restrito a owner/admin da própria empresa', () => {
    expect(MIGRATION_080).toContain('CREATE POLICY "company_invitations_select" ON company_invitations FOR SELECT');
    expect(MIGRATION_080).toContain("company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin')");
  });

  it('as duas RPCs são revogadas de anon/PUBLIC e liberadas só para authenticated', () => {
    for (const fn of ['create_company_invitation(text, text, text)', 'accept_pending_invitations()']) {
      expect(MIGRATION_080).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC`);
      expect(MIGRATION_080).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM anon`);
      expect(MIGRATION_080).toContain(`GRANT  EXECUTE ON FUNCTION public.${fn} TO authenticated`);
    }
  });

  it('gera auditoria ao criar e ao aceitar um convite', () => {
    expect(MIGRATION_080).toContain("'user.invite'");
    expect(MIGRATION_080).toContain("'user.invite_accepted'");
  });

  it('não faz DROP/TRUNCATE/DELETE FROM em nenhuma tabela', () => {
    expect(MIGRATION_080).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });

  it('não altera nenhuma tabela existente fora do necessário para ativar a membership (sem ALTER TABLE em tabelas legadas)', () => {
    expect(MIGRATION_080).not.toMatch(/ALTER TABLE (companies|custom_kpis|top_vendas)/i);
  });
});
