import { describe, expect, it } from 'vitest';

// Mesmo mecanismo de warehouseTwinMigrationGuard.test.ts: sem um Postgres para apontar,
// confere que o texto da migration continua aditivo e com o Storage fechado para escrita
// pelo cliente — pega remoção acidental da trava, não substitui teste de integração.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MIGRATION_105 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('105_academy_library_ebook_catalog')) ?? ''] ?? '';

describe('migration 105 — Biblioteca preparada para e-books externos', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_105.length).toBeGreaterThan(0);
  });

  it('é puramente aditiva — nada renomeado, removido ou apagado', () => {
    expect(MIGRATION_105).toMatch(/ADD COLUMN IF NOT EXISTS/);
    expect(MIGRATION_105).not.toMatch(/DROP COLUMN/i);
    expect(MIGRATION_105).not.toMatch(/DROP TABLE/i);
    expect(MIGRATION_105).not.toMatch(/RENAME/i);
    expect(MIGRATION_105).not.toMatch(/TRUNCATE/i);
    expect(MIGRATION_105).not.toMatch(/DELETE FROM/i);
  });

  it('adiciona todos os campos do novo catálogo', () => {
    for (const column of [
      'authors', 'source_url', 'storage_path', 'language', 'subcategory', 'level',
      'published_year', 'content_origin', 'license_name', 'license_url', 'rights_note',
    ]) {
      expect(MIGRATION_105).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
  });

  it('content_origin nasce como conteúdo I.B e aceita apenas ib/external', () => {
    expect(MIGRATION_105).toMatch(/content_origin text NOT NULL DEFAULT 'ib'/);
    expect(MIGRATION_105).toMatch(/CHECK \(content_origin IN \('ib', 'external'\)\)/);
  });

  it('não preserva external_url apenas por acidente — nenhuma coluna existente é tocada', () => {
    for (const preserved of ['external_url', 'publisher', 'cover_url', 'themes', 'subject', 'page_count', 'format']) {
      expect(MIGRATION_105).not.toMatch(new RegExp(`DROP COLUMN.*${preserved}`, 'i'));
    }
  });

  it('o bucket dos PDFs é privado, só aceita PDF e tem limite de tamanho', () => {
    expect(MIGRATION_105).toMatch(/INSERT INTO storage\.buckets[\s\S]*'academy-library'[\s\S]*false/);
    expect(MIGRATION_105).toMatch(/ARRAY\['application\/pdf'\]/);
    expect(MIGRATION_105).toMatch(/file_size_limit/);
  });

  it('o Storage tem leitura autenticada e NENHUMA policy de escrita pelo navegador', () => {
    expect(MIGRATION_105).toMatch(/CREATE POLICY "academy_library_bucket_select" ON storage\.objects FOR SELECT/);
    expect(MIGRATION_105).not.toMatch(/ON storage\.objects FOR INSERT/i);
    expect(MIGRATION_105).not.toMatch(/ON storage\.objects FOR UPDATE/i);
    expect(MIGRATION_105).not.toMatch(/ON storage\.objects FOR DELETE/i);
    expect(MIGRATION_105).not.toMatch(/FOR SELECT\s+TO public/i);
  });

  it('não cadastra nenhum e-book novo nesta etapa', () => {
    expect(MIGRATION_105).not.toMatch(/INSERT INTO library_resources/i);
  });
});
