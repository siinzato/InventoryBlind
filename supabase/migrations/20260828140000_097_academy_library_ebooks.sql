-- Biblioteca da I.B Academy — suporte ao tipo "ebook" e metadados
-- editoriais (publicador, páginas, formato, temas) usados pelo card de
-- e-book. Puramente aditivo: os tipos existentes (checklist/pop/template)
-- e as linhas já cadastradas continuam exatamente como estão.

ALTER TABLE library_resources DROP CONSTRAINT IF EXISTS library_resources_category_check;
ALTER TABLE library_resources ADD CONSTRAINT library_resources_category_check
  CHECK (category IN ('pdf', 'checklist', 'pop', 'template', 'ebook'));

ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS publisher text;
ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS page_count integer;
ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS format text;
ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS cover_url text;
ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS themes text[];
ALTER TABLE library_resources ADD COLUMN IF NOT EXISTS subject text;

INSERT INTO library_resources (
  title, description, category, external_url, is_placeholder, order_index,
  publisher, page_count, format, cover_url, themes, subject
) VALUES (
  'Gestão de entregas inteligente: como otimizar sua logística de ponta a ponta',
  'Um guia sobre planejamento, roteirização, torre de controle, rastreamento de pedidos e integração de soluções logísticas.',
  'ebook',
  '/library/gestao-de-entregas-inteligente.pdf',
  false,
  0,
  'Senior',
  41,
  'PDF',
  '/library/gestao-entregas-inteligente-cover.png',
  ARRAY['Otimização logística', 'Planejamento e roteirização', 'Torre de controle', 'Tracking de pedidos', 'Integração de soluções'],
  'Logística'
)
ON CONFLICT (title) DO NOTHING;
