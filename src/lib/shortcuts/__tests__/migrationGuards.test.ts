import { describe, expect, it } from 'vitest';

// Mesmo mecanismo já usado em closingReports/purchaseOrders/productBrands: sem
// Postgres para apontar, confere que a trava de limite (5 atalhos) e o
// isolamento por usuário+workspace continuam escritos na migration.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MIGRATION_076 =
  MIGRATIONS[
    Object.keys(MIGRATIONS).find(p => p.includes('076_user_shortcuts')) ?? ''
  ] ?? '';

describe('migration 076 — user_shortcuts', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_076.length).toBeGreaterThan(0);
  });

  it('aplica o limite de 5 atalhos no banco, não só na tela', () => {
    expect(MIGRATION_076).toContain('>= 5');
    expect(MIGRATION_076).toContain('enforce_user_shortcuts_limit');
  });

  it('isola por usuário E por workspace em todas as policies', () => {
    const policyBlocks = MIGRATION_076.match(/CREATE POLICY[^;]+;/g) ?? [];
    expect(policyBlocks.length).toBeGreaterThan(0);
    for (const block of policyBlocks) {
      expect(block).toContain('user_id = auth.uid()');
      expect(block).toContain("company_id::text = get_my_company_id()");
    }
  });

  it('não altera nenhuma tabela de plano/permissão/produto/inventário existente', () => {
    expect(MIGRATION_076).not.toMatch(/ALTER TABLE products/);
    expect(MIGRATION_076).not.toMatch(/ALTER TABLE companies/);
    expect(MIGRATION_076).not.toMatch(/ALTER TABLE inventory_/);
    expect(MIGRATION_076).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });
});
