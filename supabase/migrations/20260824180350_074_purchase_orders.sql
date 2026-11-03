/*
# Ordens de Compra — Operações

## Summary
Nova seção "Ordens de compra" em Operações: cadastro manual/importação de OCs, vínculo N:N com NF-es já
recebidas, De/Para de produtos aprendido por empresa+fornecedor+origem, alocação item-a-item e
conciliação informativa (nunca bloqueia vínculo, recebimento ou encerramento). Tudo aditivo e isolado —
nenhuma tabela de NF-e, produto, inventário ou contagem é alterada; NF-e e produtos são só referenciados
por FK para leitura/associação.

1. New Tables
- purchase_orders — cabeçalho da OC. status (draft/open/closed/closed_with_differences/cancelled) é
  decisão do operador; progresso é sempre calculado no cliente (poProgress.ts), nunca persistido aqui.
  Sem UNIQUE em (company_id, po_number, supplier_name): duplicidade de número é só aviso na aplicação,
  nunca bloqueio de banco nem sobrescrita automática.
- purchase_order_items — itens da OC. quantity/unit_price/total_value em numeric, mesma convenção de
  nfe_invoice_items. product_id é vínculo opcional e best-effort (ON DELETE SET NULL).
- po_import_profiles — perfil de mapeamento de colunas reutilizável por empresa+origem+nome. Guarda só o
  mapeamento (jsonb), nunca dado de planilha.
- po_import_batches — uma linha por execução de importação, para auditoria e para detectar reimportação
  (file_hash). Nunca guarda o conteúdo do arquivo. Sem índice único sobre file_hash: reimportar o mesmo
  arquivo é permitido mediante confirmação explícita da aplicação, não um bloqueio de banco.
- po_nfe_links — vínculo N:N entre OC e NF-e. Nunca é um DELETE: desvincular grava unlinked_at/by/reason,
  preservando o histórico completo de vínculo/desvínculo. Índice único parcial garante um único vínculo
  ativo por par (OC, NF-e), mesmo sob clique duplo/concorrência, sem impedir revincular depois de
  desvincular.
- po_deto_para — De/Para aprendido, escopado por empresa+fornecedor+origem+código (mais estrito que
  nfe_learned_associations, que só usa company_id) — um vínculo aprendido por um fornecedor nunca
  aparece para outro. Corrigir = desativar a linha antiga (active=false) + inserir uma nova; nunca
  sobrescreve uma correspondência já usada.
- po_allocations — aloca quantidade entre um item de OC e um item de NF-e. Nunca altera
  purchase_order_items.quantity nem nfe_invoice_items.expected_quantity — só registra a distribuição.

2. Security
- company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  mesma convenção de nfe_invoices/physical_count_sessions (não a convenção text legada de
  inventory_brands), porque estas tabelas referenciam nfe_invoices/nfe_invoice_items diretamente.
- RLS: SELECT/INSERT/UPDATE company-scoped (company_id::text = get_my_company_id()) em todas. DELETE só
  em purchase_orders, restrito a owner/admin — usado apenas para excluir um rascunho sem nenhum vínculo
  (a aplicação só oferece o botão quando não há po_nfe_links para aquela OC). As demais tabelas nunca
  expõem DELETE: histórico imutável (links/alocações) ou desativação (De/Para).
- Nenhuma FK desta migration usa ON DELETE CASCADE que possa apagar nfe_invoices/nfe_invoice_items/
  products/inventory_*: a cascata em invoice_id/nfe_item_id só remove a LINHA DE VÍNCULO/ALOCAÇÃO desta
  migration quando a OC é excluída (nunca o inverso — excluir uma OC nunca é propagado para a NF-e).

3. Storage
- Bucket privado `po-attachments` (mesmo padrão de rca-evidence, 033_root_cause_analysis.sql): path
  prefixado por company_id, nunca lido como fonte de dados — só anexo de referência opcional.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. purchase_orders
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  po_number         text NOT NULL,
  origin            text NOT NULL DEFAULT 'manual',
  supplier_name     text NOT NULL,
  supplier_cnpj     text,
  issue_date        date,
  notes             text,
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','open','closed','closed_with_differences','cancelled')),
  closed_reason     text,
  closed_by         uuid,
  closed_at         timestamptz,
  attachment_path   text,
  attachment_name   text,
  import_batch_id   uuid,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_orders_company_idx        ON purchase_orders (company_id);
CREATE INDEX IF NOT EXISTS purchase_orders_company_status_idx ON purchase_orders (company_id, status);
CREATE INDEX IF NOT EXISTS purchase_orders_company_number_idx ON purchase_orders (company_id, po_number);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_orders_select" ON purchase_orders;
CREATE POLICY "purchase_orders_select" ON purchase_orders FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "purchase_orders_insert" ON purchase_orders;
CREATE POLICY "purchase_orders_insert" ON purchase_orders FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "purchase_orders_update" ON purchase_orders;
CREATE POLICY "purchase_orders_update" ON purchase_orders FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- Só usado para excluir um rascunho sem nenhum vínculo — a aplicação verifica isso
-- antes de oferecer o botão (canHardDelete, mesmo padrão de nfe/physical_count).
DROP POLICY IF EXISTS "purchase_orders_delete" ON purchase_orders;
CREATE POLICY "purchase_orders_delete" ON purchase_orders FOR DELETE
  TO authenticated USING (
    company_id::text = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin'])
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. purchase_order_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id   uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  line_number         integer NOT NULL DEFAULT 0,
  origin_code         text,
  product_id          uuid REFERENCES products(id) ON DELETE SET NULL,
  ean                 text,
  ean_normalized      text,
  description         text NOT NULL DEFAULT '',
  unit                text,
  quantity            numeric NOT NULL DEFAULT 0,
  unit_price          numeric,
  total_value         numeric,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS po_items_order_idx   ON purchase_order_items (purchase_order_id);
CREATE INDEX IF NOT EXISTS po_items_company_idx ON purchase_order_items (company_id);
CREATE INDEX IF NOT EXISTS po_items_code_idx    ON purchase_order_items (company_id, origin_code);
CREATE INDEX IF NOT EXISTS po_items_ean_idx     ON purchase_order_items (company_id, ean_normalized);

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_items_select" ON purchase_order_items;
CREATE POLICY "po_items_select" ON purchase_order_items FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "po_items_insert" ON purchase_order_items;
CREATE POLICY "po_items_insert" ON purchase_order_items FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "po_items_update" ON purchase_order_items;
CREATE POLICY "po_items_update" ON purchase_order_items FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "po_items_delete" ON purchase_order_items;
CREATE POLICY "po_items_delete" ON purchase_order_items FOR DELETE
  TO authenticated USING (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. po_import_profiles
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS po_import_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  origin          text NOT NULL CHECK (origin IN ('tiny','bling','totvs','sap','custom')),
  name            text NOT NULL,
  column_mapping  jsonb NOT NULL DEFAULT '{}',
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, origin, name)
);

CREATE INDEX IF NOT EXISTS po_import_profiles_company_idx ON po_import_profiles (company_id);

ALTER TABLE po_import_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_import_profiles_select" ON po_import_profiles;
CREATE POLICY "po_import_profiles_select" ON po_import_profiles FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "po_import_profiles_insert" ON po_import_profiles;
CREATE POLICY "po_import_profiles_insert" ON po_import_profiles FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "po_import_profiles_update" ON po_import_profiles;
CREATE POLICY "po_import_profiles_update" ON po_import_profiles FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. po_import_batches
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS po_import_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  origin         text NOT NULL,
  profile_id     uuid REFERENCES po_import_profiles(id) ON DELETE SET NULL,
  file_name      text NOT NULL,
  file_hash      text NOT NULL,
  row_count      integer NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','failed')),
  error_message  text,
  created_by     uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS po_import_batches_company_idx ON po_import_batches (company_id);
CREATE INDEX IF NOT EXISTS po_import_batches_hash_idx    ON po_import_batches (company_id, file_hash);

ALTER TABLE po_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_import_batches_select" ON po_import_batches;
CREATE POLICY "po_import_batches_select" ON po_import_batches FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "po_import_batches_insert" ON po_import_batches;
CREATE POLICY "po_import_batches_insert" ON po_import_batches FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

-- Referência tardia: purchase_orders.import_batch_id -> po_import_batches(id).
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_import_batch_fkey
  FOREIGN KEY (import_batch_id) REFERENCES po_import_batches(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. po_nfe_links
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS po_nfe_links (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  purchase_order_id       uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  invoice_id              uuid NOT NULL REFERENCES nfe_invoices(id) ON DELETE CASCADE,
  linked_by               uuid DEFAULT auth.uid(),
  linked_at               timestamptz NOT NULL DEFAULT now(),
  unlinked_at             timestamptz,
  unlinked_by             uuid,
  unlink_reason           text,
  reconciliation_status   text NOT NULL DEFAULT 'pending' CHECK (reconciliation_status IN ('pending','ok','failed')),
  reconciled_at           timestamptz,
  reconciliation_error    text
);

CREATE INDEX IF NOT EXISTS po_nfe_links_company_idx ON po_nfe_links (company_id);
CREATE INDEX IF NOT EXISTS po_nfe_links_po_idx      ON po_nfe_links (purchase_order_id);
CREATE INDEX IF NOT EXISTS po_nfe_links_invoice_idx ON po_nfe_links (invoice_id);

-- Impede o mesmo par (OC, NF-e) ativo duplicado por clique/requisição repetida,
-- sem impedir revincular depois de uma desvinculação (unlinked_at passa a não-null).
CREATE UNIQUE INDEX IF NOT EXISTS po_nfe_links_active_pair_idx
  ON po_nfe_links (purchase_order_id, invoice_id)
  WHERE unlinked_at IS NULL;

ALTER TABLE po_nfe_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_nfe_links_select" ON po_nfe_links;
CREATE POLICY "po_nfe_links_select" ON po_nfe_links FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "po_nfe_links_insert" ON po_nfe_links;
CREATE POLICY "po_nfe_links_insert" ON po_nfe_links FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

-- UPDATE só é usado para desvincular (unlinked_at/by/reason) e para gravar o
-- resultado da conciliação (reconciliation_status/reconciled_at/error) — nunca
-- para alterar purchase_order_id/invoice_id de um vínculo já criado.
DROP POLICY IF EXISTS "po_nfe_links_update" ON po_nfe_links;
CREATE POLICY "po_nfe_links_update" ON po_nfe_links FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. po_deto_para
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS po_deto_para (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  supplier_key  text NOT NULL,
  origin        text NOT NULL,
  match_type    text NOT NULL CHECK (match_type IN ('code','ean')),
  match_value   text NOT NULL,
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS po_deto_para_company_idx ON po_deto_para (company_id);

-- Só uma correspondência ATIVA por (empresa, fornecedor, origem, tipo, valor) — um
-- vínculo aprendido por um fornecedor nunca aparece para outro. Corrigir desativa
-- a linha antiga e insere uma nova, preservando o histórico completo.
CREATE UNIQUE INDEX IF NOT EXISTS po_deto_para_active_key_idx
  ON po_deto_para (company_id, supplier_key, origin, match_type, match_value)
  WHERE active;

ALTER TABLE po_deto_para ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_deto_para_select" ON po_deto_para;
CREATE POLICY "po_deto_para_select" ON po_deto_para FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "po_deto_para_insert" ON po_deto_para;
CREATE POLICY "po_deto_para_insert" ON po_deto_para FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

-- UPDATE só é usado para active=false (desativar) — nunca para reescrever
-- match_value/product_id de uma correspondência já usada.
DROP POLICY IF EXISTS "po_deto_para_update" ON po_deto_para;
CREATE POLICY "po_deto_para_update" ON po_deto_para FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. po_allocations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS po_allocations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  po_link_id          uuid NOT NULL REFERENCES po_nfe_links(id) ON DELETE CASCADE,
  po_item_id          uuid NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  nfe_item_id         uuid NOT NULL REFERENCES nfe_invoice_items(id) ON DELETE CASCADE,
  allocated_quantity  numeric NOT NULL CHECK (allocated_quantity > 0),
  match_method        text NOT NULL CHECK (match_method IN ('product_id','code','ean','learned','manual')),
  source              text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
  created_by          uuid DEFAULT auth.uid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS po_allocations_company_idx  ON po_allocations (company_id);
CREATE INDEX IF NOT EXISTS po_allocations_link_idx     ON po_allocations (po_link_id);
CREATE INDEX IF NOT EXISTS po_allocations_po_item_idx  ON po_allocations (po_item_id);
CREATE INDEX IF NOT EXISTS po_allocations_nfe_item_idx ON po_allocations (nfe_item_id);

ALTER TABLE po_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_allocations_select" ON po_allocations;
CREATE POLICY "po_allocations_select" ON po_allocations FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "po_allocations_insert" ON po_allocations;
CREATE POLICY "po_allocations_insert" ON po_allocations FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "po_allocations_update" ON po_allocations;
CREATE POLICY "po_allocations_update" ON po_allocations FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "po_allocations_delete" ON po_allocations;
CREATE POLICY "po_allocations_delete" ON po_allocations FOR DELETE
  TO authenticated USING (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Storage — anexo opcional da OC (nunca lido como fonte de dados)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('po-attachments', 'po-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "po_attachments_select" ON storage.objects;
CREATE POLICY "po_attachments_select" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'po-attachments' AND (storage.foldername(name))[1] = get_my_company_id()
  );

DROP POLICY IF EXISTS "po_attachments_insert" ON storage.objects;
CREATE POLICY "po_attachments_insert" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'po-attachments' AND (storage.foldername(name))[1] = get_my_company_id()
  );

DROP POLICY IF EXISTS "po_attachments_delete" ON storage.objects;
CREATE POLICY "po_attachments_delete" ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id = 'po-attachments' AND (storage.foldername(name))[1] = get_my_company_id()
    AND get_my_role() = ANY(ARRAY['owner','admin','manager'])
  );
