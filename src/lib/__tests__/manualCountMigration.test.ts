import { describe, expect, it } from 'vitest';

// Mesmo mecanismo de advancedSettingsMigrations.test.ts: sem um Postgres para
// apontar, a forma honesta de conferir que a migration não deixa a duração
// virar fonte de verdade do client é ler o SQL e confirmar que a coluna é
// gerada, não uma coluna comum que o insert do frontend poderia sobrescrever.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const path = Object.keys(MIGRATIONS).find(p => p.includes('manual_count_started_finished_at'));
const SQL = path ? MIGRATIONS[path] : '';

describe('migration 069 — início/término da Contagem Manual', () => {
  it('adiciona started_at e finished_at como timestamptz', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS started_at\s+timestamptz/);
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS finished_at\s+timestamptz/);
  });

  it('nunca permite finished_at anterior a started_at', () => {
    expect(SQL).toMatch(/CHECK \(finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at\)/);
  });

  it('duration_seconds é coluna GERADA pelo banco — nunca escrita diretamente pelo insert do client', () => {
    expect(SQL).toMatch(/GENERATED ALWAYS AS/);
    expect(SQL).toMatch(/duration_seconds integer\s*\n\s*GENERATED ALWAYS AS/);
  });

  it('recria user_productivity_stats_v (dependia da coluna substituída), sem alterar sua definição', () => {
    expect(SQL).toMatch(/DROP VIEW IF EXISTS user_productivity_stats_v/);
    expect(SQL).toMatch(/CREATE OR REPLACE VIEW user_productivity_stats_v/);
    expect(SQL).toMatch(/AVG\(duration_seconds\)\s+AS tempo_medio_segundos/);
  });
});
