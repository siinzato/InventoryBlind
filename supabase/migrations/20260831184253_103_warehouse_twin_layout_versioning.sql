/*
# Warehouse Digital Twin — versionamento de planta (rascunho/publicada) + zonas

## Summary
Evolução aditiva do modelo de grade já existente (migrations 031/032), para
suportar o fluxo "editar em rascunho → publicar" pedido para o configurador
visual de planta, e o conceito de "zona" (agrupamento retangular de células,
ex.: ZONA A/B/C) usado pelo mapa operacional e pelas análises por zona.

Nenhuma tabela existente é destruída ou tem dado apagado. `warehouse_layouts`
existentes recebem `status='published'` (comportamento idêntico ao atual,
onde só existe uma planta "ativa"). Uma planta em edição passa a ser
literalmente outra linha desta mesma tabela (`status='draft'`), clonada da
publicada pelo app antes de editar — nenhuma tela operacional lê rascunho.

## Changes
1. warehouse_layouts — `status` (draft/published/archived), `version`,
   `published_at`, `scale_confirmed`. Backfill: linhas existentes (sempre
   `is_active=true` até hoje) viram `status='published'`; `cell_size_meters`
   já tinha um valor (padrão 1.5m, nunca confirmado visualmente por ninguém
   até esta feature existir), então `scale_confirmed` nasce `false` para
   todo mundo — a UI passa a mostrar "Indisponível" em vez de estimar
   distância/tempo até o usuário calibrar pela primeira vez pelo fluxo de
   dois pontos.
2. warehouse_zones — agrupamento retangular de células por zona/área/
   obstáculo, referenciando warehouse_layouts. RLS espelha exatamente
   warehouse_cells (mesma tabela irmã, mesmo modelo de permissão).
3. warehouse_cells.capacity — opcional; quando preenchida, a ocupação da
   posição passa a ser calculada por capacidade em vez de por saldo>0.

## Security
Mesmo modelo das migrations 031/032: leitura company-scoped para
autenticados, escrita restrita a owner/admin/manager.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Versionamento de warehouse_layouts
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE warehouse_layouts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published', 'archived')),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS scale_confirmed boolean NOT NULL DEFAULT false;

UPDATE warehouse_layouts
SET published_at = created_at
WHERE status = 'published' AND published_at IS NULL;

CREATE INDEX IF NOT EXISTS warehouse_layouts_status_idx ON warehouse_layouts (company_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. warehouse_zones
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_zones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layout_id   uuid NOT NULL REFERENCES warehouse_layouts(id) ON DELETE CASCADE,
  company_id  text NOT NULL DEFAULT get_my_company_id(),
  code        text NOT NULL,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'zona' CHECK (kind IN ('zona', 'area', 'obstaculo')),
  min_x       integer NOT NULL,
  min_y       integer NOT NULL,
  max_x       integer NOT NULL,
  max_y       integer NOT NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  CHECK (min_x <= max_x AND min_y <= max_y),
  UNIQUE (layout_id, code)
);

CREATE INDEX IF NOT EXISTS warehouse_zones_layout_idx ON warehouse_zones (layout_id);
CREATE INDEX IF NOT EXISTS warehouse_zones_company_idx ON warehouse_zones (company_id);

ALTER TABLE warehouse_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_zones_select" ON warehouse_zones;
CREATE POLICY "warehouse_zones_select" ON warehouse_zones FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "warehouse_zones_insert" ON warehouse_zones;
CREATE POLICY "warehouse_zones_insert" ON warehouse_zones FOR INSERT
  TO authenticated WITH CHECK (
    company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager'])
  );

DROP POLICY IF EXISTS "warehouse_zones_update" ON warehouse_zones;
CREATE POLICY "warehouse_zones_update" ON warehouse_zones FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

DROP POLICY IF EXISTS "warehouse_zones_delete" ON warehouse_zones;
CREATE POLICY "warehouse_zones_delete" ON warehouse_zones FOR DELETE
  TO authenticated USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Capacidade opcional por célula (base real para "ocupação por capacidade")
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE warehouse_cells ADD COLUMN IF NOT EXISTS capacity integer CHECK (capacity IS NULL OR capacity > 0);
