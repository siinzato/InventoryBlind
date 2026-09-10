/*
# Logo da linha/marca de contagem — escopo por workspace

## Summary
"Resultados por Linha" passa a exibir o logo da linha/marca ao lado do nome. O logo é
propriedade da LINHA DE CONTAGEM do workspace (inventory_brands), nunca um catálogo global
do front-end: cada workspace só vê e só grava os logos das próprias linhas.

1. Changes
- inventory_brands.logo_path (text, aditivo, nullable) — CAMINHO no Storage, não URL. Mesmo
  padrão de companies.logo_path (migration 101) e warehouse_layouts.background_image_path
  (032): bucket privado, URL assinada gerada sob demanda no cliente. Nenhuma coluna
  existente muda; nenhum default novo; linha sem logo continua válida (fallback de iniciais
  na UI).

2. New Storage bucket
- brand-logos (privado), pasta por empresa: (storage.foldername(name))[1] = company_id.
  É o que impede o vazamento entre workspaces — o caminho carrega o company_id, então um
  objeto de outra empresa não é sequer selecionável, mesmo que alguém guarde o path errado
  na coluna.

3. Security
- SELECT: qualquer membro autenticado do workspace ATIVO (get_my_company_id()). Mais
  restrito de propósito que workspace-logos (migration 102, que abriu para todos os
  workspaces do usuário porque o seletor de workspace precisa mostrar os logos de todos);
  aqui a linha de contagem só é lida dentro do próprio workspace ativo.
- INSERT/UPDATE/DELETE: workspace ativo + owner/admin (get_my_role()), igual ao logo do
  workspace. Operador não troca identidade visual.
- Sem alteração de RLS de inventory_brands, de policy existente ou de qualquer RPC.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. inventory_brands.logo_path (aditivo)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE inventory_brands ADD COLUMN IF NOT EXISTS logo_path text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Bucket de Storage do logo da linha/marca
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-logos', 'brand-logos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "brand_logos_select" ON storage.objects;
CREATE POLICY "brand_logos_select" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'brand-logos' AND (storage.foldername(name))[1] = get_my_company_id()
  );

DROP POLICY IF EXISTS "brand_logos_insert" ON storage.objects;
CREATE POLICY "brand_logos_insert" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'brand-logos'
    AND (storage.foldername(name))[1] = get_my_company_id()
    AND get_my_role() = ANY(ARRAY['owner','admin'])
  );

DROP POLICY IF EXISTS "brand_logos_update" ON storage.objects;
CREATE POLICY "brand_logos_update" ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'brand-logos' AND (storage.foldername(name))[1] = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']))
  WITH CHECK (bucket_id = 'brand-logos' AND (storage.foldername(name))[1] = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin']));

DROP POLICY IF EXISTS "brand_logos_delete" ON storage.objects;
CREATE POLICY "brand_logos_delete" ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id = 'brand-logos'
    AND (storage.foldername(name))[1] = get_my_company_id()
    AND get_my_role() = ANY(ARRAY['owner','admin'])
  );
