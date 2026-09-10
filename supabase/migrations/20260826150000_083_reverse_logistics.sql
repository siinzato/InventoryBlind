/*
# Logística Reversa — Fase 1 (recebimento → conferência → inspeção → destinação)

## Summary
Novo módulo em Operações: recebimento de devolução (por pedido/NF-e/SKU/código de barras/número
de série/código de rastreio/referência externa, ou avulso), conferência item a item, checklist de
inspeção, e decisão de destinação por item. Fases posteriores (solicitação do cliente, coleta,
reembolso, fiscal) ficam de fora — nada aqui é criado para isso.

Aditivo e isolado: nenhuma tabela de produtos, vendas, NF-e ou ordem de compra é alterada — todas
são só referenciadas por FK opcional (`ON DELETE SET NULL`), mesmo padrão de
`purchase_order_items.product_id` (074) e `nfe_invoice_items.product_id` (018).

Não existe, no schema atual, tabela de número de série, código de rastreio ou referência externa
— por isso `source_type IN ('serial','tracking','external_ref')` grava só `reference_value` como
texto livre para identificação manual, sem inventar uma tabela ou integração que não existe.
"Pedido" também não tem cabeçalho formal de venda no schema — só `sales_records` (linha de venda
importada) — então `source_type = 'order'` resolve contra `sales_records`, não contra um "Pedido".

## New Tables
- returns — cabeçalho da devolução. status é uma máquina de estados travada pela RPC
  `returns_transition_status`, nunca por UPDATE direto do cliente (RLS de UPDATE cobre só os
  campos de cadastro/observação, mas a validação de transição de estado vive inteiramente na RPC).
- return_items — item da devolução: conferência (quantidade/lote/serial/embalagem/acessórios),
  inspeção (checklist + classificação) e destinação, tudo na mesma linha (mirror de
  nfe_invoice_items, que também acumula expected/physical/result no mesmo registro).
- return_attachments — fotos/anexos por devolução ou por item (mirror de task_attachments).
- return_stock_movements — ledger de movimentação gerado pela destinação aprovada. Cada item só
  pode gerar uma linha aqui na vida inteira (UNIQUE(return_item_id)) — é isso que impede
  duplicação da movimentação de estoque.

## Security
- company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE
  CASCADE em todas as 4 tabelas — mesma convenção de purchase_orders/nfe_invoices (não a
  convenção text legada de products), porque estas tabelas referenciam products/sales_records/
  nfe_invoices/purchase_orders diretamente.
- RLS: SELECT/INSERT/UPDATE company-scoped em returns/return_items/return_attachments. Nenhuma
  policy de DELETE em nenhuma das 4 tabelas — cancelamento é sempre `status = 'cancelled'`, nunca
  uma exclusão. return_stock_movements só tem SELECT para authenticated — a escrita é exclusiva
  das RPCs SECURITY DEFINER (mesmo padrão de nfe_count_events/physical_count_events).
- Três RPCs SECURITY DEFINER cobrem tudo que precisa de trava/atomicidade real: transição de
  status, registro de inspeção (com justificativa obrigatória em correção pós-inspeção) e decisão
  de destinação (com a movimentação de estoque na mesma transação — nunca uma destinação
  parcialmente concluída). Cadastro e edição de campos de conferência ficam como INSERT/UPDATE
  comuns sob RLS, mesmo nível de exigência que purchase_order_items hoje.
- products.stock_quantity só é escrito dentro de return_items_decide_destination, só no branch
  'restock', só quando returns.status já é 'awaiting_destination' — é assim que "nenhum item
  devolvido retorna ao estoque vendável antes da aprovação da inspeção" é garantido no banco.

## Storage
- Bucket privado `return-attachments` (mesmo padrão de rca-evidence/po-attachments): path
  prefixado por company_id, RLS por pasta.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. returns
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS returns (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  code                   text NOT NULL DEFAULT (
                           'DEV-' || to_char(now(), 'YYYYMMDD') || '-' ||
                           upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5))
                         ),
  status                 text NOT NULL DEFAULT 'received'
                           CHECK (status IN ('received','in_conference','in_inspection','awaiting_destination','finalized','cancelled')),
  source_type            text NOT NULL
                           CHECK (source_type IN ('order','nfe','sku','barcode','serial','tracking','external_ref','manual')),
  reference_value        text,
  linked_sale_id          uuid REFERENCES sales_records(id) ON DELETE SET NULL,
  linked_nfe_invoice_id   uuid REFERENCES nfe_invoices(id) ON DELETE SET NULL,
  linked_purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  unresolved              boolean NOT NULL DEFAULT false,
  customer_name           text,
  origin                  text,
  reason                  text,
  expected_quantity       numeric,
  received_at             timestamptz NOT NULL DEFAULT now(),
  received_by             uuid DEFAULT auth.uid(),
  notes                   text,
  status_changed_by       uuid,
  status_changed_at       timestamptz,
  cancellation_reason     text,
  created_by              uuid DEFAULT auth.uid(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS returns_company_code_idx  ON returns (company_id, code);
CREATE INDEX IF NOT EXISTS returns_company_idx              ON returns (company_id);
CREATE INDEX IF NOT EXISTS returns_company_status_idx        ON returns (company_id, status);
CREATE INDEX IF NOT EXISTS returns_company_received_idx      ON returns (company_id, received_at);

ALTER TABLE returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "returns_select" ON returns;
CREATE POLICY "returns_select" ON returns FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "returns_insert" ON returns;
CREATE POLICY "returns_insert" ON returns FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "returns_update" ON returns;
CREATE POLICY "returns_update" ON returns FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- Sem policy de DELETE: "não faça exclusões definitivas" — cancelamento é sempre status='cancelled'.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. return_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS return_items (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id                   uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  company_id                  uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  line_number                 integer NOT NULL DEFAULT 0,
  product_id                  uuid REFERENCES products(id) ON DELETE SET NULL,
  sku                         text,
  ean                         text,
  description                 text NOT NULL DEFAULT '',
  expected_quantity           numeric,
  received_quantity           numeric NOT NULL DEFAULT 0,
  lot_number                  text,
  serial_number                text,
  original_packaging           boolean,
  accessories_received         text,
  item_notes                   text,
  -- Inspeção
  checklist_correct_product        boolean,
  checklist_packaging_intact       boolean,
  checklist_no_visible_damage      boolean,
  checklist_apparently_functional  boolean,
  checklist_accessories_complete   boolean,
  checklist_signs_of_use           boolean,
  checklist_serial_matches         boolean,
  classification                text
                                   CHECK (classification IN ('new_sealed','good_condition','light_damage','heavy_damage','functional_defect','incomplete','unidentified')),
  inspected_by                   uuid,
  inspected_at                   timestamptz,
  -- Destinação
  destination                    text
                                   CHECK (destination IN ('restock','quarantine','damaged_stock','technical_assistance','refurbishment','return_to_supplier','discard')),
  destination_reason             text,
  destination_status             text NOT NULL DEFAULT 'pending' CHECK (destination_status IN ('pending','moved')),
  destination_decided_by         uuid,
  destination_decided_at         timestamptz,
  current_location                text NOT NULL DEFAULT 'Quarentena - Devoluções',
  created_at                       timestamptz NOT NULL DEFAULT now(),
  updated_at                       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS return_items_return_idx      ON return_items (return_id);
CREATE INDEX IF NOT EXISTS return_items_company_idx     ON return_items (company_id);
CREATE INDEX IF NOT EXISTS return_items_product_idx     ON return_items (company_id, product_id);
CREATE INDEX IF NOT EXISTS return_items_sku_idx         ON return_items (company_id, sku);
CREATE INDEX IF NOT EXISTS return_items_destination_idx ON return_items (company_id, destination);

ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "return_items_select" ON return_items;
CREATE POLICY "return_items_select" ON return_items FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "return_items_insert" ON return_items;
CREATE POLICY "return_items_insert" ON return_items FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "return_items_update" ON return_items;
CREATE POLICY "return_items_update" ON return_items FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- Sem policy de DELETE.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. return_attachments
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS return_attachments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id      uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  return_item_id uuid REFERENCES return_items(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  file_path      text NOT NULL,
  file_name      text NOT NULL,
  uploaded_by    uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS return_attachments_return_idx ON return_attachments (return_id);
CREATE INDEX IF NOT EXISTS return_attachments_item_idx   ON return_attachments (return_item_id);
CREATE INDEX IF NOT EXISTS return_attachments_company_idx ON return_attachments (company_id);

ALTER TABLE return_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "return_attachments_select" ON return_attachments;
CREATE POLICY "return_attachments_select" ON return_attachments FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "return_attachments_insert" ON return_attachments;
CREATE POLICY "return_attachments_insert" ON return_attachments FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

-- Sem policy de UPDATE/DELETE: anexo, uma vez enviado, é histórico imutável.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. return_stock_movements — ledger, escrita só via RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS return_stock_movements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id            uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  return_item_id       uuid NOT NULL REFERENCES return_items(id) ON DELETE CASCADE,
  company_id           uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  product_id           uuid REFERENCES products(id) ON DELETE SET NULL,
  movement_type        text NOT NULL
                         CHECK (movement_type IN ('restock','quarantine','damaged_stock','technical_assistance','refurbishment','return_to_supplier','discard')),
  origin_location      text NOT NULL,
  destination_location text NOT NULL,
  quantity             numeric NOT NULL,
  lot_number           text,
  serial_number        text,
  reason               text,
  performed_by         uuid DEFAULT auth.uid(),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Cada item só pode gerar UMA movimentação na vida inteira — é isso que impede duplicação.
CREATE UNIQUE INDEX IF NOT EXISTS return_stock_movements_item_idx ON return_stock_movements (return_item_id);
CREATE INDEX IF NOT EXISTS return_stock_movements_return_idx  ON return_stock_movements (return_id);
CREATE INDEX IF NOT EXISTS return_stock_movements_company_idx ON return_stock_movements (company_id);

ALTER TABLE return_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "return_stock_movements_select" ON return_stock_movements;
CREATE POLICY "return_stock_movements_select" ON return_stock_movements FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

-- Nenhuma policy de INSERT/UPDATE/DELETE para authenticated: só a RPC SECURITY DEFINER escreve
-- aqui (roda como dono da tabela, ignora RLS), mesmo padrão de nfe_count_events/
-- physical_count_events.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Storage — bucket return-attachments
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('return-attachments', 'return-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "return_attachments_storage_select" ON storage.objects;
CREATE POLICY "return_attachments_storage_select" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'return-attachments' AND (storage.foldername(name))[1] = get_my_company_id()
  );

DROP POLICY IF EXISTS "return_attachments_storage_insert" ON storage.objects;
CREATE POLICY "return_attachments_storage_insert" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'return-attachments' AND (storage.foldername(name))[1] = get_my_company_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. returns_transition_status — máquina de estados travada
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.returns_transition_status(
  p_return_id uuid,
  p_to_status text,
  p_reason    text DEFAULT NULL
)
RETURNS returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company        text;
  v_role           text;
  v_ret_company    uuid;
  v_status         text;
  v_reason         text;
  v_pending_items  integer;
  v_result         returns%ROWTYPE;
  v_action         text;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;

  SELECT company_id, status INTO v_ret_company, v_status
  FROM returns WHERE id = p_return_id FOR UPDATE;

  IF v_ret_company IS NULL THEN
    RAISE EXCEPTION 'Devolução não encontrada.';
  END IF;
  IF v_ret_company::text <> v_company THEN
    RAISE EXCEPTION 'Devolução pertence a outra empresa.';
  END IF;

  IF p_to_status NOT IN ('received','in_conference','in_inspection','awaiting_destination','finalized','cancelled') THEN
    RAISE EXCEPTION 'Status inválido: %', p_to_status;
  END IF;

  IF v_status IN ('finalized','cancelled') THEN
    RAISE EXCEPTION 'Esta devolução já está em estado final (%) e não aceita novas transições.', v_status;
  END IF;

  IF p_to_status = 'cancelled' THEN
    IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager') THEN
      RAISE EXCEPTION 'Apenas owner, admin ou manager podem cancelar uma devolução.';
    END IF;
  ELSIF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','lead','counter') THEN
    RAISE EXCEPTION 'Seu papel não permite alterar o status desta devolução.';
  END IF;

  -- Mapa de transições válidas — qualquer estado não-terminal pode cancelar; fora isso, só avança
  -- um passo por vez.
  IF NOT (
    p_to_status = 'cancelled'
    OR (v_status = 'received' AND p_to_status = 'in_conference')
    OR (v_status = 'in_conference' AND p_to_status = 'in_inspection')
    OR (v_status = 'in_inspection' AND p_to_status = 'awaiting_destination')
    OR (v_status = 'awaiting_destination' AND p_to_status = 'finalized')
  ) THEN
    RAISE EXCEPTION 'Transição inválida: % → %.', v_status, p_to_status;
  END IF;

  v_reason := btrim(coalesce(p_reason, ''));
  IF p_to_status = 'cancelled' AND char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Cancelar exige uma justificativa com pelo menos 5 caracteres.';
  END IF;

  IF p_to_status = 'finalized' THEN
    SELECT count(*) INTO v_pending_items
    FROM return_items
    WHERE return_id = p_return_id AND destination_status <> 'moved';

    IF v_pending_items > 0 THEN
      RAISE EXCEPTION 'Ainda há % item(ns) sem destinação concluída — não é possível finalizar.', v_pending_items;
    END IF;
  END IF;

  UPDATE returns
  SET status = p_to_status,
      status_changed_by = auth.uid(),
      status_changed_at = now(),
      cancellation_reason = CASE WHEN p_to_status = 'cancelled' THEN v_reason ELSE cancellation_reason END,
      updated_at = now()
  WHERE id = p_return_id
  RETURNING * INTO v_result;

  v_action := CASE WHEN p_to_status = 'cancelled' THEN 'reverse_logistics.cancelled' ELSE 'reverse_logistics.status_changed' END;

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_ret_company,
    auth.uid(),
    coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    v_action,
    'returns',
    p_return_id::text,
    'Status da devolução alterado.',
    jsonb_build_object('from', v_status, 'to', p_to_status, 'reason', NULLIF(v_reason, ''))
  );

  RETURN v_result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.returns_transition_status(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.returns_transition_status(uuid, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.returns_transition_status(uuid, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. return_items_set_inspection
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.return_items_set_inspection(
  p_item_id                          uuid,
  p_checklist_correct_product        boolean,
  p_checklist_packaging_intact       boolean,
  p_checklist_no_visible_damage      boolean,
  p_checklist_apparently_functional  boolean,
  p_checklist_accessories_complete   boolean,
  p_checklist_signs_of_use           boolean,
  p_checklist_serial_matches         boolean,
  p_classification                   text,
  p_reason                           text DEFAULT NULL
)
RETURNS return_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company         text;
  v_role            text;
  v_item_company    uuid;
  v_return_id       uuid;
  v_ret_status      text;
  v_already_inspected boolean;
  v_reason          text;
  v_result          return_items%ROWTYPE;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','lead','counter') THEN
    RAISE EXCEPTION 'Seu papel não permite registrar inspeção.';
  END IF;

  IF p_classification NOT IN ('new_sealed','good_condition','light_damage','heavy_damage','functional_defect','incomplete','unidentified') THEN
    RAISE EXCEPTION 'Classificação inválida: %', p_classification;
  END IF;

  SELECT ri.company_id, ri.return_id, (ri.inspected_at IS NOT NULL)
  INTO v_item_company, v_return_id, v_already_inspected
  FROM return_items ri WHERE ri.id = p_item_id FOR UPDATE;

  IF v_item_company IS NULL THEN
    RAISE EXCEPTION 'Item de devolução não encontrado.';
  END IF;
  IF v_item_company::text <> v_company THEN
    RAISE EXCEPTION 'Item pertence a outra empresa.';
  END IF;

  SELECT status INTO v_ret_status FROM returns WHERE id = v_return_id;
  IF v_ret_status <> 'in_inspection' THEN
    RAISE EXCEPTION 'A devolução precisa estar em inspeção para registrar o checklist (status atual: %).', v_ret_status;
  END IF;

  v_reason := btrim(coalesce(p_reason, ''));
  IF v_already_inspected AND char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Alterar uma inspeção já registrada exige justificativa com pelo menos 5 caracteres.';
  END IF;

  UPDATE return_items SET
    checklist_correct_product       = p_checklist_correct_product,
    checklist_packaging_intact      = p_checklist_packaging_intact,
    checklist_no_visible_damage     = p_checklist_no_visible_damage,
    checklist_apparently_functional = p_checklist_apparently_functional,
    checklist_accessories_complete  = p_checklist_accessories_complete,
    checklist_signs_of_use          = p_checklist_signs_of_use,
    checklist_serial_matches        = p_checklist_serial_matches,
    classification                  = p_classification,
    inspected_by                    = auth.uid(),
    inspected_at                    = now(),
    updated_at                      = now()
  WHERE id = p_item_id
  RETURNING * INTO v_result;

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_item_company,
    auth.uid(),
    coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'reverse_logistics.item_inspected',
    'returns',
    v_return_id::text,
    'Item de devolução inspecionado.',
    jsonb_build_object('itemId', p_item_id, 'classification', p_classification, 'correction', v_already_inspected, 'reason', NULLIF(v_reason, ''))
  );

  RETURN v_result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.return_items_set_inspection(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.return_items_set_inspection(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.return_items_set_inspection(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. return_items_decide_destination — decisão + movimentação, tudo atômico
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.return_items_decide_destination(
  p_item_id     uuid,
  p_destination text,
  p_reason      text DEFAULT NULL
)
RETURNS return_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company         text;
  v_role            text;
  v_item            return_items%ROWTYPE;
  v_ret_status      text;
  v_reason          text;
  v_dest_location   text;
  v_result          return_items%ROWTYPE;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;

  IF p_destination NOT IN ('restock','quarantine','damaged_stock','technical_assistance','refurbishment','return_to_supplier','discard') THEN
    RAISE EXCEPTION 'Destinação inválida: %', p_destination;
  END IF;

  SELECT * INTO v_item FROM return_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Item de devolução não encontrado.';
  END IF;
  IF v_item.company_id::text <> v_company THEN
    RAISE EXCEPTION 'Item pertence a outra empresa.';
  END IF;
  IF v_item.destination_status = 'moved' THEN
    RAISE EXCEPTION 'Este item já teve a destinação processada — não é possível repetir.';
  END IF;

  SELECT status INTO v_ret_status FROM returns WHERE id = v_item.return_id;
  IF v_ret_status <> 'awaiting_destination' THEN
    RAISE EXCEPTION 'A devolução precisa estar aguardando destinação (status atual: %).', v_ret_status;
  END IF;

  IF p_destination IN ('restock','discard') THEN
    IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager') THEN
      RAISE EXCEPTION 'Apenas owner, admin ou manager podem aprovar esta destinação.';
    END IF;
  ELSIF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','lead','counter') THEN
    RAISE EXCEPTION 'Seu papel não permite definir a destinação deste item.';
  END IF;

  v_reason := btrim(coalesce(p_reason, ''));
  IF p_destination IN ('discard','technical_assistance','return_to_supplier') AND char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Esta destinação exige justificativa com pelo menos 5 caracteres.';
  END IF;

  IF p_destination = 'restock' AND v_item.product_id IS NULL THEN
    RAISE EXCEPTION 'Não é possível retornar ao estoque vendável um item sem produto identificado.';
  END IF;

  v_dest_location := CASE p_destination
    WHEN 'restock'              THEN 'Estoque Vendável'
    WHEN 'quarantine'           THEN 'Quarentena - Devoluções'
    WHEN 'damaged_stock'        THEN 'Estoque de Avariados'
    WHEN 'technical_assistance' THEN 'Assistência Técnica'
    WHEN 'refurbishment'        THEN 'Recondicionamento'
    WHEN 'return_to_supplier'   THEN 'Devolução ao Fornecedor'
    WHEN 'discard'              THEN 'Descarte'
  END;

  IF p_destination = 'restock' THEN
    UPDATE products SET stock_quantity = stock_quantity + v_item.received_quantity, updated_at = now()
    WHERE id = v_item.product_id;
  END IF;

  INSERT INTO return_stock_movements (
    return_id, return_item_id, company_id, product_id, movement_type,
    origin_location, destination_location, quantity, lot_number, serial_number, reason, performed_by
  ) VALUES (
    v_item.return_id, v_item.id, v_item.company_id, v_item.product_id, p_destination,
    v_item.current_location, v_dest_location, v_item.received_quantity, v_item.lot_number, v_item.serial_number,
    NULLIF(v_reason, ''), auth.uid()
  );

  UPDATE return_items SET
    destination             = p_destination,
    destination_reason      = NULLIF(v_reason, ''),
    destination_status      = 'moved',
    destination_decided_by  = auth.uid(),
    destination_decided_at  = now(),
    current_location        = v_dest_location,
    updated_at               = now()
  WHERE id = p_item_id
  RETURNING * INTO v_result;

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_item.company_id,
    auth.uid(),
    coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'reverse_logistics.destination_decided',
    'returns',
    v_item.return_id::text,
    'Destinação definida para item de devolução.',
    jsonb_build_object('itemId', p_item_id, 'destination', p_destination, 'reason', NULLIF(v_reason, ''))
  );

  RETURN v_result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.return_items_decide_destination(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.return_items_decide_destination(uuid, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.return_items_decide_destination(uuid, text, text) TO authenticated;
