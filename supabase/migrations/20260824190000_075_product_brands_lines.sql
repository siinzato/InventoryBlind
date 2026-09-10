/*
# Linhas e Marcas — Produtos

## Summary
Nova seção "Linhas e Marcas" em Produtos: catálogo de marcas e linhas por empresa, com responsáveis,
tags/aliases e associação automática de produtos por título (classificador local, sem IA). Aditivo e
isolado — products.company_id/sku/ean/price não mudam; a associação vive numa tabela própria.

1. New Tables
- product_brands — marca. company_id uuid (padrão recente: nfe_invoices/purchase_orders), name, code
  opcional, keywords text[] (aliases — o nome oficial NÃO precisa estar aqui, o classificador sempre o
  inclui implicitamente), primary_responsible_id/additional_responsible_ids (profiles), active. Sem
  policy de DELETE: desativar é a única forma de "remover" — nunca apaga marca já vinculada a produto.
- product_lines — linha, sempre de uma marca (brand_id FK, cascade — é filha própria da marca). Mesmos
  campos de responsável (own, sobrepõe o da marca quando setado) e keywords/tags. Sem DELETE.
- product_brand_associations — 1 linha por produto (UNIQUE product_id), nunca duplica. match_status
  distingue auto/manual/needs_review; candidate_matches (jsonb) guarda os candidatos ambíguos para a
  fila de revisão. product_id referencia products(id) ON DELETE CASCADE (remove só a ASSOCIAÇÃO quando o
  produto é excluído — nunca o inverso).

2. Security
- company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE.
- RLS: SELECT/INSERT/UPDATE company-scoped em todas; sem DELETE (marca/linha só desativam; associação é
  substituída via UPSERT, nunca precisa ser apagada — reclassificar atualiza a mesma linha).

3. Seed (só empresa AZ, id real 00000000-0000-0000-0000-000000000001 — nunca por nome parcial)
- As 8 marcas oficiais (Nillkin, Ringke, GoCase, AZ, X-Level, Dexnor, DUX, ESR) e as 7 linhas de GoCase,
  inseridas de forma idempotente (ON CONFLICT DO NOTHING) só dentro do tenant AZ. Nenhuma outra empresa —
  nova ou existente — recebe este seed; o classificador em si não tem lista fixa, lê só as marcas ativas
  do tenant chamador.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. product_brands
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_brands (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  name                      text NOT NULL,
  code                      text,
  keywords                  text[] NOT NULL DEFAULT '{}',
  primary_responsible_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  additional_responsible_ids uuid[] NOT NULL DEFAULT '{}',
  active                    boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS product_brands_company_idx ON product_brands (company_id);

ALTER TABLE product_brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_brands_select" ON product_brands;
CREATE POLICY "product_brands_select" ON product_brands FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "product_brands_insert" ON product_brands;
CREATE POLICY "product_brands_insert" ON product_brands FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "product_brands_update" ON product_brands;
CREATE POLICY "product_brands_update" ON product_brands FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. product_lines
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_lines (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  brand_id                  uuid NOT NULL REFERENCES product_brands(id) ON DELETE CASCADE,
  name                      text NOT NULL,
  keywords                  text[] NOT NULL DEFAULT '{}',
  primary_responsible_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  additional_responsible_ids uuid[] NOT NULL DEFAULT '{}',
  active                    boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, name)
);

CREATE INDEX IF NOT EXISTS product_lines_company_idx ON product_lines (company_id);
CREATE INDEX IF NOT EXISTS product_lines_brand_idx   ON product_lines (brand_id);

ALTER TABLE product_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_lines_select" ON product_lines;
CREATE POLICY "product_lines_select" ON product_lines FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "product_lines_insert" ON product_lines;
CREATE POLICY "product_lines_insert" ON product_lines FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "product_lines_update" ON product_lines;
CREATE POLICY "product_lines_update" ON product_lines FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. product_brand_associations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_brand_associations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  product_id         uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  brand_id           uuid REFERENCES product_brands(id) ON DELETE SET NULL,
  line_id            uuid REFERENCES product_lines(id) ON DELETE SET NULL,
  match_status       text NOT NULL DEFAULT 'needs_review' CHECK (match_status IN ('auto','manual','needs_review','unmatched')),
  matched_keyword    text,
  candidate_matches  jsonb NOT NULL DEFAULT '[]',
  confirmed_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  confirmed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id)
);

CREATE INDEX IF NOT EXISTS product_brand_assoc_company_idx ON product_brand_associations (company_id);
CREATE INDEX IF NOT EXISTS product_brand_assoc_brand_idx   ON product_brand_associations (brand_id);
CREATE INDEX IF NOT EXISTS product_brand_assoc_line_idx    ON product_brand_associations (line_id);
CREATE INDEX IF NOT EXISTS product_brand_assoc_status_idx  ON product_brand_associations (company_id, match_status);

ALTER TABLE product_brand_associations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_brand_assoc_select" ON product_brand_associations;
CREATE POLICY "product_brand_assoc_select" ON product_brand_associations FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "product_brand_assoc_insert" ON product_brand_associations;
CREATE POLICY "product_brand_assoc_insert" ON product_brand_associations FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "product_brand_assoc_update" ON product_brand_associations;
CREATE POLICY "product_brand_assoc_update" ON product_brand_associations FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Seed — exclusivo do tenant AZ (id real, nunca por nome/slug)
-- ─────────────────────────────────────────────────────────────────────────────
DO $seed$
DECLARE
  az_company_id uuid := '00000000-0000-0000-0000-000000000001';
  brand_nillkin  uuid;
  brand_ringke   uuid;
  brand_gocase   uuid;
  brand_az       uuid;
  brand_xlevel   uuid;
  brand_dexnor   uuid;
  brand_dux      uuid;
  brand_esr      uuid;
BEGIN
  -- Só executa se o tenant AZ existir de fato (nunca cria a empresa aqui).
  IF EXISTS (SELECT 1 FROM companies WHERE id = az_company_id) THEN

    INSERT INTO product_brands (company_id, name, keywords) VALUES (az_company_id, 'Nillkin', '{}')
      ON CONFLICT (company_id, name) DO NOTHING;
    INSERT INTO product_brands (company_id, name, keywords) VALUES (az_company_id, 'Ringke', '{}')
      ON CONFLICT (company_id, name) DO NOTHING;
    INSERT INTO product_brands (company_id, name, code, keywords) VALUES (az_company_id, 'GoCase', 'GC', '{}')
      ON CONFLICT (company_id, name) DO NOTHING;
    INSERT INTO product_brands (company_id, name, keywords) VALUES (az_company_id, 'AZ', '{}')
      ON CONFLICT (company_id, name) DO NOTHING;
    INSERT INTO product_brands (company_id, name, keywords) VALUES (az_company_id, 'X-Level', '{}')
      ON CONFLICT (company_id, name) DO NOTHING;
    INSERT INTO product_brands (company_id, name, keywords) VALUES (az_company_id, 'Dexnor', '{}')
      ON CONFLICT (company_id, name) DO NOTHING;
    INSERT INTO product_brands (company_id, name, keywords) VALUES (az_company_id, 'DUX', '{}')
      ON CONFLICT (company_id, name) DO NOTHING;
    INSERT INTO product_brands (company_id, name, keywords) VALUES (az_company_id, 'ESR', '{}')
      ON CONFLICT (company_id, name) DO NOTHING;

    SELECT id INTO brand_nillkin FROM product_brands WHERE company_id = az_company_id AND name = 'Nillkin';
    SELECT id INTO brand_ringke  FROM product_brands WHERE company_id = az_company_id AND name = 'Ringke';
    SELECT id INTO brand_gocase  FROM product_brands WHERE company_id = az_company_id AND name = 'GoCase';
    SELECT id INTO brand_az      FROM product_brands WHERE company_id = az_company_id AND name = 'AZ';
    SELECT id INTO brand_xlevel  FROM product_brands WHERE company_id = az_company_id AND name = 'X-Level';
    SELECT id INTO brand_dexnor  FROM product_brands WHERE company_id = az_company_id AND name = 'Dexnor';
    SELECT id INTO brand_dux     FROM product_brands WHERE company_id = az_company_id AND name = 'DUX';
    SELECT id INTO brand_esr     FROM product_brands WHERE company_id = az_company_id AND name = 'ESR';

    -- Linhas iniciais de GoCase — mantidas para referência do valor atual usado na operação.
    INSERT INTO product_lines (company_id, brand_id, name, keywords) VALUES
      (az_company_id, brand_gocase, 'Capas',                    ARRAY['GoCase Capas']),
      (az_company_id, brand_gocase, 'Lancheiras e Necessários',  ARRAY['Lancheiras e Necessários GC']),
      (az_company_id, brand_gocase, 'Térmicos',                 ARRAY['Térmicos GC']),
      (az_company_id, brand_gocase, 'Joy',                       ARRAY['Linha Joy GC']),
      (az_company_id, brand_gocase, 'Puffer',                    ARRAY['Linha Puffer GC']),
      (az_company_id, brand_gocase, 'Bases',                     ARRAY['Linha de Bases GC']),
      (az_company_id, brand_gocase, 'Mochilas e Tote Daily',     ARRAY['Linha de Mochilas GC', 'Linha Tote Daily GC'])
    ON CONFLICT (brand_id, name) DO NOTHING;

  END IF;
END $seed$;
