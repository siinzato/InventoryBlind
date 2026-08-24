import { describe, expect, it } from 'vitest';

// Mesmo mecanismo de physicalCount/__tests__/physicalCountAdmin.test.ts e
// closingReports/__tests__/migrationGuards.test.ts: sem um Postgres para apontar,
// a forma honesta de proteger as garantias críticas desta migration (idempotência
// de vínculo/De-Para, isolamento por empresa, nunca cascatear para NF-e/produto) é
// conferir que elas continuam escritas no SQL. Não substitui um teste de
// integração; pega a remoção acidental de uma trava, que é o risco realista aqui.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MIGRATION_074 =
  MIGRATIONS[
    Object.keys(MIGRATIONS).find(p => p.includes('074_purchase_orders')) ?? ''
  ] ?? '';

describe('migration 074 — purchase orders', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_074.length).toBeGreaterThan(0);
  });

  it('mantém o índice único parcial que impede vínculo OC×NF-e ativo duplicado', () => {
    expect(MIGRATION_074).toContain('CREATE UNIQUE INDEX IF NOT EXISTS po_nfe_links_active_pair_idx');
    expect(MIGRATION_074).toContain('WHERE unlinked_at IS NULL');
  });

  it('mantém o índice único parcial que isola o De/Para por empresa+fornecedor+origem', () => {
    expect(MIGRATION_074).toContain('CREATE UNIQUE INDEX IF NOT EXISTS po_deto_para_active_key_idx');
    expect(MIGRATION_074).toContain('(company_id, supplier_key, origin, match_type, match_value)');
  });

  it('nenhuma FK desta migration cascateia de volta para nfe_invoices/nfe_invoice_items/products', () => {
    // As únicas referências a essas tabelas devem ser "aponta para" (this table -> nfe/products),
    // nunca o inverso — não deve existir nenhuma FK NAS tabelas de NF-e/produto apontando para cá.
    expect(MIGRATION_074).not.toMatch(/ALTER TABLE nfe_invoices/);
    expect(MIGRATION_074).not.toMatch(/ALTER TABLE nfe_invoice_items/);
    expect(MIGRATION_074).not.toMatch(/ALTER TABLE products/);
    expect(MIGRATION_074).not.toMatch(/ALTER TABLE inventory_brands/);
    expect(MIGRATION_074).not.toMatch(/ALTER TABLE inventory_count_records/);
  });

  it('não expõe DELETE em po_nfe_links/po_allocations/po_deto_para (histórico imutável ou desativação)', () => {
    expect(MIGRATION_074).not.toMatch(/CREATE POLICY "po_nfe_links_delete"/);
    expect(MIGRATION_074).not.toMatch(/CREATE POLICY "po_deto_para_delete"/);
  });

  it('não executa DROP/TRUNCATE/DELETE em massa', () => {
    expect(MIGRATION_074).not.toMatch(/DROP TABLE/i);
    expect(MIGRATION_074).not.toMatch(/TRUNCATE/i);
    expect(MIGRATION_074).not.toMatch(/DELETE FROM/i);
  });

  it('purchase_orders usa a convenção uuid+FK companies (não a text legada)', () => {
    expect(MIGRATION_074).toContain('uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id)');
  });
});
