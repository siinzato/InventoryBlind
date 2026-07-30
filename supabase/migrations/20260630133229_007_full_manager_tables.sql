/*
# Full Manager — Tabelas Operacionais

## Objetivo
Criar as tabelas necessárias para o módulo Full Manager, que controla operações
de envio Full para marketplaces (Mercado Livre, Shopee, Amazon FBA).

## Tabelas Criadas

### 1. full_operations
Representa uma operação Full completa, desde o agendamento até a finalização.
- id: UUID primário
- company_id: Identificador da empresa (texto, para isolamento multi-tenant)
- full_number: Número do FULL (ex: "803458905")
- marketplace: Nome do marketplace (Mercado Livre, Shopee, Amazon FBA, Outro)
- responsible: Nome do responsável pela operação
- scheduled_date: Data agendada
- scheduled_time: Horário agendado
- status: Estado atual da operação (scheduled, preparing, picking, checking, ready, completed, cancelled)
- total_sku: Quantidade total de SKUs distintos
- total_pieces: Quantidade total de peças
- notes: Observações gerais
- checker: Nome do conferente (preenchido na etapa de conferência)
- checker_notes: Observações do conferente
- checked_at: Timestamp da conferência
- completed_at: Timestamp de finalização
- created_at / updated_at: Controle de tempo

### 2. full_operation_items
Itens individuais de cada operação Full.
- id: UUID primário
- operation_id: FK para full_operations
- company_id: Identificador da empresa
- listing_id: ID do anúncio no marketplace
- product_id: UUID do produto na tabela products (se encontrado)
- sku: Código SKU do produto
- ean: Código EAN/GTIN
- product_name: Nome do produto
- location: Localização no estoque
- quantity_requested: Quantidade solicitada pelo marketplace
- quantity_picked: Quantidade efetivamente separada
- status: Estado do item (found, no_location, insufficient_stock, not_found, picked, skipped, picking_error)
- picker_notes: Observações do separador
- picked_at: Timestamp da separação
- created_at: Controle de tempo

## Índices
- full_operations: company_id, status, scheduled_date, created_at
- full_operation_items: operation_id, company_id, status, location, sku, ean

## Segurança (RLS)
Políticas permissivas (anon + authenticated) pois o app não possui tela de login.
O isolamento por empresa é feito via filtro de company_id na aplicação.
*/

-- ─── full_operations ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS full_operations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      text,
  full_number     text NOT NULL,
  marketplace     text NOT NULL DEFAULT 'Mercado Livre',
  responsible     text,
  scheduled_date  date,
  scheduled_time  text,
  status          text NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','preparing','picking','checking','ready','completed','cancelled')),
  total_sku       integer NOT NULL DEFAULT 0,
  total_pieces    integer NOT NULL DEFAULT 0,
  notes           text,
  checker         text,
  checker_notes   text,
  checked_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS full_operations_company_id_idx    ON full_operations (company_id);
CREATE INDEX IF NOT EXISTS full_operations_status_idx        ON full_operations (status);
CREATE INDEX IF NOT EXISTS full_operations_scheduled_date_idx ON full_operations (scheduled_date DESC);
CREATE INDEX IF NOT EXISTS full_operations_created_at_idx    ON full_operations (created_at DESC);

ALTER TABLE full_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "full_ops_select" ON full_operations;
CREATE POLICY "full_ops_select" ON full_operations FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "full_ops_insert" ON full_operations;
CREATE POLICY "full_ops_insert" ON full_operations FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "full_ops_update" ON full_operations;
CREATE POLICY "full_ops_update" ON full_operations FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "full_ops_delete" ON full_operations;
CREATE POLICY "full_ops_delete" ON full_operations FOR DELETE
  TO anon, authenticated USING (true);

-- ─── full_operation_items ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS full_operation_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id       uuid NOT NULL REFERENCES full_operations(id) ON DELETE CASCADE,
  company_id         text,
  listing_id         text,
  product_id         uuid,
  sku                text,
  ean                text,
  product_name       text,
  location           text,
  quantity_requested integer NOT NULL DEFAULT 1,
  quantity_picked    integer NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'found'
                     CHECK (status IN ('found','no_location','insufficient_stock','not_found','picked','skipped','picking_error')),
  picker_notes       text,
  picked_at          timestamptz,
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS full_items_operation_id_idx ON full_operation_items (operation_id);
CREATE INDEX IF NOT EXISTS full_items_company_id_idx   ON full_operation_items (company_id);
CREATE INDEX IF NOT EXISTS full_items_status_idx       ON full_operation_items (status);
CREATE INDEX IF NOT EXISTS full_items_location_idx     ON full_operation_items (location);
CREATE INDEX IF NOT EXISTS full_items_sku_idx          ON full_operation_items (sku);
CREATE INDEX IF NOT EXISTS full_items_ean_idx          ON full_operation_items (ean);

ALTER TABLE full_operation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "full_items_select" ON full_operation_items;
CREATE POLICY "full_items_select" ON full_operation_items FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "full_items_insert" ON full_operation_items;
CREATE POLICY "full_items_insert" ON full_operation_items FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "full_items_update" ON full_operation_items;
CREATE POLICY "full_items_update" ON full_operation_items FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "full_items_delete" ON full_operation_items;
CREATE POLICY "full_items_delete" ON full_operation_items FOR DELETE
  TO anon, authenticated USING (true);

-- ─── updated_at trigger ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_full_operations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_full_operations_updated_at ON full_operations;
CREATE TRIGGER set_full_operations_updated_at
  BEFORE UPDATE ON full_operations
  FOR EACH ROW EXECUTE FUNCTION update_full_operations_updated_at();
