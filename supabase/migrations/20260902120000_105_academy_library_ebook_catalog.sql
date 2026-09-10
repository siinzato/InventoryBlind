/*
# I.B Academy — Biblioteca preparada para catálogo de e-books externos

## Objetivo
Deixar `library_resources` e o Storage prontos para receber e-books de terceiros
(universidades, organismos internacionais, empresas) hospedados pelo
InventoryBlind, com autoria e créditos explícitos. Esta migration NÃO cadastra
nenhum e-book novo e NÃO altera nenhum recurso existente além de marcar a
origem do conteúdo.

## Por que campos novos em vez de reaproveitar external_url
Hoje "Ler e-book" e "Baixar PDF" apontam os dois para `external_url`, que também
seria o único lugar para guardar a origem oficial da obra. São três coisas
diferentes e passam a ter campos próprios:

- `storage_path`  → o PDF hospedado pelo InventoryBlind (bucket academy-library);
- `source_url`    → a publicação/site oficial do autor ou instituição;
- `external_url`  → PRESERVADO para os recursos antigos (o e-book já cadastrado
                    aponta para /library/...), sem nenhuma reescrita silenciosa.

## Mudanças
1. Colunas aditivas de catálogo, autoria, licença e origem. Nada renomeado,
   nada removido — `external_url`, `publisher`, `cover_url`, `themes`,
   `subject`, `page_count` e `format` continuam como estão.
2. `content_origin` ('ib' | 'external') com DEFAULT 'ib': os recursos atuais
   (checklists, POPs, templates) são produção do I.B Academy e ficam 'ib' pelo
   próprio default. O e-book já existente é material de terceiro apenas curado
   pela Academy, então é marcado como 'external'.
3. Bucket privado `academy-library` para os PDFs, com leitura para usuários
   autenticados e NENHUMA policy de escrita — o navegador não sobe arquivo
   (a ingestão em lote é feita fora do cliente, por service_role).

## O que esta migration deliberadamente NÃO faz
- Não cria os ~45 registros do catálogo (etapa de ingestão, separada).
- Não sobe PDFs nem capas.
- Não converte "material gratuito" em licença (Creative Commons/domínio
  público): `license_name`/`license_url` só são preenchidos quando a licença
  real for conhecida, caso a caso.
- Não mexe em cursos, aulas, quizzes, certificados, PDI ou achievements.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Catálogo: autoria, origem e metadados editoriais
-- ─────────────────────────────────────────────────────────────────────────────

-- Autoria pode ter mais de uma pessoa ("John J. Bartholdi, Steven T. Hackman"),
-- por isso array e não texto único. Quando não há pessoa identificada, a
-- referência editorial continua sendo `publisher` (NATO, World Bank, PwC...).
ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS authors text[];

-- Origem oficial da publicação — NUNCA preenchida automaticamente a partir de
-- external_url, que aponta para o arquivo local dos recursos antigos.
ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS source_url text;

-- Caminho do PDF dentro do bucket academy-library, ex.:
-- 'ebooks/logistica/warehouse-distribution-science.pdf'.
ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS storage_path text;

ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS language text;
ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS subcategory text;
ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS level text;
ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS published_year integer;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Origem do conteúdo e direitos
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS content_origin text NOT NULL DEFAULT 'ib';

ALTER TABLE library_resources DROP CONSTRAINT IF EXISTS library_resources_content_origin_check;
ALTER TABLE library_resources ADD CONSTRAINT library_resources_content_origin_check
  CHECK (content_origin IN ('ib', 'external'));

ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS license_name text;
ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS license_url text;
ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS rights_note text;

-- O e-book já cadastrado (migration 097) é obra de terceiro disponibilizada
-- pela curadoria da Academy. O arquivo e a linha continuam onde estão — só a
-- origem passa a ficar explícita, para que os créditos apareçam corretamente.
UPDATE library_resources
SET content_origin = 'external'
WHERE category = 'ebook' AND content_origin = 'ib';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Storage dos PDFs — bucket privado, leitura autenticada, sem escrita pelo cliente
-- ─────────────────────────────────────────────────────────────────────────────
-- Mesmo padrão dos buckets existentes (rca-evidence, warehouse-floorplans):
-- private + signed URL + mime/size aplicados no servidor (migration 037).
-- Diferença justificada: a Biblioteca é um catálogo GLOBAL — library_resources
-- tem SELECT "TO authenticated USING (true)" e nenhuma coluna company_id — então
-- não existe pasta por empresa para escopar, e a leitura segue a mesma regra da
-- tabela. Escrita não recebe policy nenhuma de propósito: sem policy, o cliente
-- autenticado não consegue INSERT/UPDATE/DELETE de objeto (RLS nega por padrão).

INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES ('academy-library', 'academy-library', false, ARRAY['application/pdf'], 52428800)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "academy_library_bucket_select" ON storage.objects;
CREATE POLICY "academy_library_bucket_select" ON storage.objects FOR SELECT
  TO authenticated USING (bucket_id = 'academy-library');
