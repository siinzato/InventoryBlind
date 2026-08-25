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
