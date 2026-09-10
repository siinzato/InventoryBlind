import { describe, expect, it } from 'vitest';

// Mesmo mecanismo de closingReports/__tests__/migrationGuards.test.ts e
// warehouseTwinMigrationGuard.test.ts: sem um Postgres para apontar, confere que o texto
// da migration continua com a RLS/aditividade esperada — pega remoção acidental da trava,
// não substitui um teste de integração real.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MIGRATION_104 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('104_root_cause_analysis_rework')) ?? ''] ?? '';

describe('migration 104 — reformulação do Root Cause Analysis', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_104.length).toBeGreaterThan(0);
  });

  it('só adiciona colunas/tabelas em cima do que já existe — nunca DROP/TRUNCATE destrutivo', () => {
    expect(MIGRATION_104).toMatch(/ADD COLUMN IF NOT EXISTS/);
    expect(MIGRATION_104).toMatch(/CREATE TABLE IF NOT EXISTS/);
    expect(MIGRATION_104).not.toMatch(/DROP TABLE/i);
    expect(MIGRATION_104).not.toMatch(/TRUNCATE/i);
    expect(MIGRATION_104).not.toMatch(/DELETE FROM/i);
  });

  it('não remove nem substitui rca_five_whys_sessions/rca_five_whys_answers (legado preservado)', () => {
    expect(MIGRATION_104).not.toMatch(/DROP TABLE.*rca_five_whys/i);
    expect(MIGRATION_104).not.toContain('ALTER TABLE rca_five_whys_sessions');
    expect(MIGRATION_104).not.toContain('ALTER TABLE rca_five_whys_answers');
  });

  it('rca_cases/rca_case_actions/rca_case_why_steps têm RLS habilitada', () => {
    expect(MIGRATION_104).toContain('ALTER TABLE rca_cases ENABLE ROW LEVEL SECURITY');
    expect(MIGRATION_104).toContain('ALTER TABLE rca_case_actions ENABLE ROW LEVEL SECURITY');
    expect(MIGRATION_104).toContain('ALTER TABLE rca_case_why_steps ENABLE ROW LEVEL SECURITY');
  });

  it('taxonomia de causa nunca expõe policy de DELETE (preserva histórico, só desativa)', () => {
    expect(MIGRATION_104).not.toMatch(/rca_cause_categories_delete/);
    expect(MIGRATION_104).not.toMatch(/rca_cause_subcauses_delete/);
  });

  it('mudanças sensíveis do caso (status/causa raiz) restritas a owner/admin/manager', () => {
    const casesUpdateBlock = MIGRATION_104.slice(MIGRATION_104.indexOf('"rca_cases_update"'));
    expect(casesUpdateBlock).toContain("get_my_role() = ANY(ARRAY['owner','admin','manager'])");
  });

  it('classificação inicial exige processo+causa a menos que esteja pendente', () => {
    expect(MIGRATION_104).toContain('rca_records_classification_complete');
    expect(MIGRATION_104).toContain("classification_status = 'pending'");
  });
});
