import { describe, expect, it } from 'vitest';

// Mesmo mecanismo já usado em closingReports/purchaseOrders/productBrands/shortcuts: sem
// Postgres para apontar, confere que a RLS por empresa, a barreira de papel do reset e a
// ausência de qualquer escrita em estoque/inventário/contagem continuam escritas na migration.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MIGRATION_077 =
  MIGRATIONS[
    Object.keys(MIGRATIONS).find(p => p.includes('077_admin_sales_and_danger_zone')) ?? ''
  ] ?? '';

describe('migration 077 — vendas e zona de perigo', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_077.length).toBeGreaterThan(0);
  });

  it('isola sales_import_profiles/batches/records por empresa em todas as policies', () => {
    const policyBlocks = MIGRATION_077.match(/CREATE POLICY[^;]+;/g) ?? [];
    const salesPolicies = policyBlocks.filter(b => b.includes('sales_'));
    expect(salesPolicies.length).toBeGreaterThan(0);
    for (const block of salesPolicies) {
      expect(block).toContain("company_id::text = get_my_company_id()");
    }
  });

  it('nenhuma tabela de vendas tem policy de DELETE — histórico de importação é append-only', () => {
    expect(MIGRATION_077).not.toMatch(/CREATE POLICY[^;]*sales_[^;]*FOR DELETE/);
  });

  it('admin_reset_inventory exige owner/admin e justificativa mínima de 5 caracteres', () => {
    expect(MIGRATION_077).toContain("v_role NOT IN ('owner', 'admin')");
    expect(MIGRATION_077).toContain('char_length(v_reason) < 5');
  });

  it('admin_reset_inventory é a única RPC exposta — REVOKE de anon/PUBLIC, GRANT só authenticated', () => {
    expect(MIGRATION_077).toContain('REVOKE EXECUTE ON FUNCTION public.admin_reset_inventory(text, text, text) FROM PUBLIC');
    expect(MIGRATION_077).toContain('REVOKE EXECUTE ON FUNCTION public.admin_reset_inventory(text, text, text) FROM anon');
    expect(MIGRATION_077).toContain('GRANT  EXECUTE ON FUNCTION public.admin_reset_inventory(text, text, text) TO authenticated');
  });

  it('vendas são só analíticas: nenhuma escrita em products/estoque/contagem física', () => {
    expect(MIGRATION_077).not.toMatch(/UPDATE products/i);
    expect(MIGRATION_077).not.toMatch(/ALTER TABLE products/i);
    expect(MIGRATION_077).not.toMatch(/physical_count_/i);
  });

  it('não altera schema de nenhuma tabela existente fora do próprio reset (sem ALTER TABLE em tabelas legadas)', () => {
    expect(MIGRATION_077).not.toMatch(/ALTER TABLE (top_vendas|custom_kpis|companies|profiles)/i);
  });

  it('não faz DROP/TRUNCATE/DELETE FROM em nenhuma tabela', () => {
    expect(MIGRATION_077).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });
});

const MIGRATION_079 =
  MIGRATIONS[
    Object.keys(MIGRATIONS).find(p => p.includes('079_admin_top10_config')) ?? ''
  ] ?? '';

describe('migration 079 — configuração do Top 10', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_079.length).toBeGreaterThan(0);
  });

  it('isola admin_top10_config por empresa em todas as policies', () => {
    const policyBlocks = MIGRATION_079.match(/CREATE POLICY[^;]+;/g) ?? [];
    expect(policyBlocks.length).toBeGreaterThan(0);
    for (const block of policyBlocks) {
      expect(block).toContain('company_id::text = get_my_company_id()');
    }
  });

  it('uma linha por empresa — UNIQUE(company_id)', () => {
    expect(MIGRATION_079).toMatch(/UNIQUE\s*\(company_id\)/);
  });

  it('abc_analysis_id impede exclusão silenciosa da análise em uso (ON DELETE RESTRICT)', () => {
    expect(MIGRATION_079).toMatch(/abc_analysis_id uuid REFERENCES abc_curve_analyses\(id\) ON DELETE RESTRICT/);
  });

  it('critério do ranking automático não inclui margem percentual', () => {
    const rankingCheck = MIGRATION_079.match(/ranking_metric text CHECK \(([^)]+)\)/);
    expect(rankingCheck).not.toBeNull();
    expect(rankingCheck?.[1]).not.toMatch(/margin|margem/i);
  });

  it('não escreve nem altera tabelas do Inventário ou da Curva ABC', () => {
    expect(MIGRATION_079).not.toMatch(/UPDATE (products|inventory_\w+|physical_count_\w+|abc_curve_\w+)/i);
    expect(MIGRATION_079).not.toMatch(/ALTER TABLE (products|inventory_\w+|physical_count_\w+|abc_curve_\w+)/i);
    expect(MIGRATION_079).not.toMatch(/INSERT INTO (products|inventory_\w+|physical_count_\w+|abc_curve_\w+)/i);
  });

  it('não faz DROP/TRUNCATE/DELETE FROM em nenhuma tabela', () => {
    expect(MIGRATION_079).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });
});
