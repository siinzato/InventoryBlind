import { describe, expect, it } from 'vitest';

// Mesmo mecanismo de physicalCount/__tests__/physicalCountAdmin.test.ts: sem um
// Postgres para apontar, a forma honesta de proteger a garantia de idempotência
// (um único relatório "atual" por linha/ciclo, mesmo sob clique duplo/concorrência)
// é conferir que o índice único parcial continua escrito na migration. Isso não
// substitui um teste de integração; pega a remoção acidental da trava, que é o
// risco realista aqui.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MIGRATION_073 =
  MIGRATIONS[
    Object.keys(MIGRATIONS).find(p => p.includes('073_inventory_closing_reports')) ?? ''
  ] ?? '';

describe('migration 073 — inventory_closing_reports', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_073.length).toBeGreaterThan(0);
  });

  it('mantém o índice único parcial que garante um único relatório atual por linha/ciclo', () => {
    expect(MIGRATION_073).toContain('CREATE UNIQUE INDEX IF NOT EXISTS inv_closing_reports_current_idx');
    expect(MIGRATION_073).toContain('WHERE is_current');
    // COALESCE cobre o ciclo "desde sempre" (cycle_start null) — sem isso, dois
    // relatórios com cycle_start null não colidiriam (NULL <> NULL em índice único comum).
    expect(MIGRATION_073).toContain("COALESCE(cycle_start, 'epoch'::timestamptz)");
  });

  it('não cria nenhuma policy de DELETE para categorias/relatórios (histórico imutável, categoria só desativa)', () => {
    expect(MIGRATION_073).not.toMatch(/FOR DELETE/);
  });

  it('não altera nenhuma tabela existente (só CREATE TABLE IF NOT EXISTS novas)', () => {
    expect(MIGRATION_073).not.toMatch(/ALTER TABLE inventory_brands/);
    expect(MIGRATION_073).not.toMatch(/ALTER TABLE inventory_count_records/);
    expect(MIGRATION_073).not.toMatch(/DROP TABLE/i);
    expect(MIGRATION_073).not.toMatch(/TRUNCATE/i);
    expect(MIGRATION_073).not.toMatch(/DELETE FROM/i);
  });
});
