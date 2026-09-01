import { describe, expect, it } from 'vitest';

// Mesmo mecanismo de closingReports/__tests__/migrationGuards.test.ts: sem um Postgres
// para apontar, confere que o texto da migration continua com a RLS/aditividade esperada —
// pega remoção acidental da trava, não substitui um teste de integração real.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MIGRATION_103 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('103_warehouse_twin_layout_versioning')) ?? ''] ?? '';

describe('migration 103 — warehouse_zones + versionamento de warehouse_layouts', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_103.length).toBeGreaterThan(0);
  });

  it('só adiciona colunas em tabelas existentes — nunca DROP/ALTER destrutivo', () => {
    expect(MIGRATION_103).toMatch(/ADD COLUMN IF NOT EXISTS/);
    expect(MIGRATION_103).not.toMatch(/DROP COLUMN/);
    expect(MIGRATION_103).not.toMatch(/DROP TABLE/i);
    expect(MIGRATION_103).not.toMatch(/TRUNCATE/i);
    expect(MIGRATION_103).not.toMatch(/DELETE FROM/i);
  });

  it('warehouse_zones tem RLS habilitada e escrita restrita a owner/admin/manager', () => {
    expect(MIGRATION_103).toContain('ALTER TABLE warehouse_zones ENABLE ROW LEVEL SECURITY');
    expect(MIGRATION_103).toContain("get_my_role() = ANY(ARRAY['owner','admin','manager'])");
  });

  it('warehouse_zones permite SELECT para qualquer autenticado da mesma empresa', () => {
    expect(MIGRATION_103).toContain('"warehouse_zones_select"');
    expect(MIGRATION_103).toContain('company_id = get_my_company_id()');
  });

  it('backfill de status=published não sobrescreve published_at já preenchido', () => {
    expect(MIGRATION_103).toContain("WHERE status = 'published' AND published_at IS NULL");
  });
});
