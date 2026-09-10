/*
# Slotting Intelligence — Mapa Inteligente do Armazém (evolução)

## Summary
Evolução do editor manual de grade (Fase 1, migração 031) rumo ao "Mapa
Inteligente" pedido: planta real como camada de fundo visual (upload de
imagem — PDF/CAD com parsing automático continua fora de escopo, mesma
decisão documentada na 031), dois novos tipos de célula (porta/doca), e a
base para simulação de movimentação de SKU (que usa products.location, já
existente — nenhuma tabela nova necessária para isso). Operadores em tempo
real (GoScan) continuam fora de escopo — sem tabela nova para isso.

## Changes
1. warehouse_cells.cell_type — adiciona 'porta' e 'doca' ao CHECK.
2. warehouse_layouts — colunas de calibração da imagem de fundo
   (background_image_path/offset_x/offset_y/scale/opacity).
3. Bucket de Storage privado 'warehouse-floorplans' com RLS por empresa
   (path convention: <company_id>/<arquivo>), leitura/escrita restrita a
   owner/admin/manager na escrita, leitura para qualquer autenticado da
   mesma empresa — mesmo padrão de permissão já usado nas tabelas do
   módulo.

## Security
Mesmo modelo de RLS da 031: leitura company-scoped para autenticados,
escrita restrita a owner/admin/manager.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Novos tipos de célula: porta, doca
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE warehouse_cells DROP CONSTRAINT IF EXISTS warehouse_cells_cell_type_check;
ALTER TABLE warehouse_cells ADD CONSTRAINT warehouse_cells_cell_type_check
  CHECK (cell_type IN ('rua','modulo','posicao','expedicao','vazio','porta','doca'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Calibração da planta de fundo
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE warehouse_layouts ADD COLUMN IF NOT EXISTS background_image_path text;
ALTER TABLE warehouse_layouts ADD COLUMN IF NOT EXISTS background_offset_x numeric NOT NULL DEFAULT 0;
ALTER TABLE warehouse_layouts ADD COLUMN IF NOT EXISTS background_offset_y numeric NOT NULL DEFAULT 0;
ALTER TABLE warehouse_layouts ADD COLUMN IF NOT EXISTS background_scale numeric NOT NULL DEFAULT 1;
ALTER TABLE warehouse_layouts ADD COLUMN IF NOT EXISTS background_opacity numeric NOT NULL DEFAULT 0.5;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Bucket de Storage para a planta do armazém
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('warehouse-floorplans', 'warehouse-floorplans', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "warehouse_floorplans_select" ON storage.objects;
CREATE POLICY "warehouse_floorplans_select" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'warehouse-floorplans' AND (storage.foldername(name))[1] = get_my_company_id()
  );

DROP POLICY IF EXISTS "warehouse_floorplans_insert" ON storage.objects;
CREATE POLICY "warehouse_floorplans_insert" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'warehouse-floorplans'
    AND (storage.foldername(name))[1] = get_my_company_id()
    AND get_my_role() = ANY(ARRAY['owner','admin','manager'])
  );

DROP POLICY IF EXISTS "warehouse_floorplans_update" ON storage.objects;
CREATE POLICY "warehouse_floorplans_update" ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'warehouse-floorplans' AND (storage.foldername(name))[1] = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']))
  WITH CHECK (bucket_id = 'warehouse-floorplans' AND (storage.foldername(name))[1] = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

DROP POLICY IF EXISTS "warehouse_floorplans_delete" ON storage.objects;
CREATE POLICY "warehouse_floorplans_delete" ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id = 'warehouse-floorplans' AND (storage.foldername(name))[1] = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager'])
  );
