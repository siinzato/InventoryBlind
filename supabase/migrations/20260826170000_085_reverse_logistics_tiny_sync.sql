-- ═══════════════════════════════════════════════════════════════════════════
-- Logística Reversa — sincronização de restock com o Olist Tiny
--
-- Reaproveita a infraestrutura de integrações já existente (migrations 042-047):
-- integration_connections/credentials, integration_entity_links (vínculo de
-- produto/depósito), integration_stock_adjustments (fila durável + idempotência
-- via UNIQUE(idempotency_key)), integration_alerts (kinds já cadastrados
-- 'sync_failing'/'unmapped_deposits'), Edge Function integration-stock-write e o
-- TinyConnector. Não cria nenhuma tabela, adapter, fila ou motor de alertas novo
-- — só conecta a Logística Reversa a essas peças.
--
-- Único ponto tocado em return_items_decide_destination (3ª CREATE OR REPLACE
-- sobre essa função, depois da 083 e da 084/Fase 2): dois parâmetros novos com
-- DEFAULT, retrocompatíveis, e um bloco que só executa quando
-- destination='restock' AND p_sync_to_erp — nenhuma mudança de comportamento
-- para quem não usa a sincronização.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. integration_stock_adjustments.origin ganha um valor aditivo
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE integration_stock_adjustments DROP CONSTRAINT integration_stock_adjustments_origin_check;
ALTER TABLE integration_stock_adjustments ADD CONSTRAINT integration_stock_adjustments_origin_check
  CHECK (origin IN ('physical_count','manual','reconciliation','conflict_resolution','reverse_logistics'));
-- movement_reason já aceita 'return' desde a migration 044 — nenhuma mudança ali.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. return_items ganha o rastro da sincronização (nullable — item sem sync
--    nunca teve essa coluna preenchida, comportamento idêntico a hoje)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS erp_sync_adjustment_id uuid
  REFERENCES integration_stock_adjustments(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. return_items_decide_destination — CREATE OR REPLACE aditivo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.return_items_decide_destination(
  p_item_id uuid, p_destination text, p_reason text DEFAULT NULL::text,
  p_sync_to_erp boolean DEFAULT false, p_connection_id uuid DEFAULT NULL::uuid
)
 RETURNS return_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company          text;
  v_role             text;
  v_item             return_items%ROWTYPE;
  v_ret_status       text;
  v_reason           text;
  v_dest_location    text;
  v_is_transitional  boolean;
  v_new_dest_status  text;
  v_settings         return_approval_settings%ROWTYPE;
  v_item_value       numeric;
  v_checklist_exception boolean;
  v_required_type    text;
  v_result           return_items%ROWTYPE;
  v_stock_before        numeric;
  v_erp_connection_company text;
  v_erp_product_external   text;
  v_erp_warehouse_external text;
  v_erp_adjustment_id      uuid;
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
  IF v_item.destination_status IN ('moved','in_treatment') THEN
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

  IF p_destination = 'restock' AND EXISTS (
    SELECT 1 FROM return_quarantine_holds WHERE return_item_id = p_item_id AND released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Item em quarentena aberta — libere a quarentena antes de retornar ao estoque vendável.';
  END IF;

  -- Aprovações configuráveis: bloqueia se a empresa exige aprovação para este caso e não existe
  -- pedido aprovado ainda para este item+tipo.
  SELECT * INTO v_settings FROM return_approval_settings WHERE company_id::text = v_company;
  IF v_settings.company_id IS NOT NULL THEN
    IF p_destination = 'discard' AND v_settings.require_approval_discard THEN
      v_required_type := 'discard';
    ELSIF p_destination = 'restock' AND v_settings.require_approval_restock THEN
      v_required_type := 'restock';
    END IF;
    IF v_required_type IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM return_approval_requests
      WHERE return_item_id = p_item_id AND approval_type = v_required_type AND status = 'approved'
    ) THEN
      RAISE EXCEPTION 'Esta destinação exige aprovação prévia (tipo: %) antes de ser processada.', v_required_type;
    END IF;
    v_required_type := NULL;

    IF v_settings.require_approval_high_value AND v_settings.high_value_threshold IS NOT NULL THEN
      SELECT p.price * v_item.received_quantity INTO v_item_value FROM products p WHERE p.id = v_item.product_id;
      IF v_item_value IS NOT NULL AND v_item_value >= v_settings.high_value_threshold THEN
        IF NOT EXISTS (
          SELECT 1 FROM return_approval_requests
          WHERE return_item_id = p_item_id AND approval_type = 'high_value' AND status = 'approved'
        ) THEN
          RAISE EXCEPTION 'Item de alto valor — exige aprovação prévia (tipo: high_value) antes de ser processado.';
        END IF;
      END IF;
    END IF;

    IF v_settings.require_approval_serial_mismatch AND v_item.checklist_serial_matches = false THEN
      IF NOT EXISTS (
        SELECT 1 FROM return_approval_requests
        WHERE return_item_id = p_item_id AND approval_type = 'serial_mismatch' AND status = 'approved'
      ) THEN
        RAISE EXCEPTION 'Divergência de serial identificada — exige aprovação prévia (tipo: serial_mismatch) antes de ser processada.';
      END IF;
    END IF;

    IF v_settings.require_approval_checklist_exception THEN
      v_checklist_exception := (
        v_item.checklist_correct_product = false OR v_item.checklist_packaging_intact = false OR
        v_item.checklist_no_visible_damage = false OR v_item.checklist_apparently_functional = false OR
        v_item.checklist_accessories_complete = false OR v_item.checklist_serial_matches = false
      );
      IF v_checklist_exception AND NOT EXISTS (
        SELECT 1 FROM return_approval_requests
        WHERE return_item_id = p_item_id AND approval_type = 'checklist_exception' AND status = 'approved'
      ) THEN
        RAISE EXCEPTION 'Exceção de checklist identificada — exige aprovação prévia (tipo: checklist_exception) antes de ser processada.';
      END IF;
    END IF;

    IF v_settings.require_approval_destination_change AND v_item.suggested_destination IS NOT NULL
       AND v_item.suggested_destination <> p_destination THEN
      IF NOT EXISTS (
        SELECT 1 FROM return_approval_requests
        WHERE return_item_id = p_item_id AND approval_type = 'destination_change' AND status = 'approved'
      ) THEN
        RAISE EXCEPTION 'Destinação diverge da sugestão — exige aprovação prévia (tipo: destination_change) antes de ser processada.';
      END IF;
    END IF;
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
    SELECT stock_quantity INTO v_stock_before FROM products WHERE id = v_item.product_id;
    UPDATE products SET stock_quantity = stock_quantity + v_item.received_quantity, updated_at = now()
    WHERE id = v_item.product_id;

    -- Sincronização com ERP (opcional, só para restock): nunca bloqueia a
    -- destinação interna. Sem vínculo de produto/depósito no Tiny, só avisa
    -- ("Requer atenção") e segue — não envia requisição incompleta ao ERP.
    IF p_sync_to_erp AND p_connection_id IS NOT NULL THEN
      SELECT company_id::text INTO v_erp_connection_company FROM integration_connections WHERE id = p_connection_id;
      IF v_erp_connection_company = v_company THEN
        SELECT external_id INTO v_erp_product_external FROM integration_entity_links
          WHERE connection_id = p_connection_id AND entity_type = 'product' AND internal_id = v_item.product_id
          LIMIT 1;
        SELECT external_id INTO v_erp_warehouse_external FROM integration_entity_links
          WHERE connection_id = p_connection_id AND entity_type = 'warehouse'
          ORDER BY created_at ASC LIMIT 1;

        IF v_erp_product_external IS NULL OR v_erp_warehouse_external IS NULL THEN
          PERFORM integration_raise_alert(
            v_item.company_id, p_connection_id, 'unmapped_deposits', 'warning',
            'Produto ou depósito da Logística Reversa sem vínculo com o Tiny — entrada de estoque não enviada.',
            jsonb_build_object('returnItemId', v_item.id, 'returnId', v_item.return_id, 'sku', v_item.sku, 'productId', v_item.product_id)
          );
        ELSE
          INSERT INTO integration_stock_adjustments (
            company_id, connection_id, product_id, external_product_id, sku, external_warehouse_id,
            origin, previous_quantity, counted_quantity, delta_quantity, write_kind, reason,
            movement_reason, approved_by, approved_at, requested_by, sync_status, idempotency_key
          ) VALUES (
            v_item.company_id, p_connection_id, v_item.product_id, v_erp_product_external, v_item.sku, v_erp_warehouse_external,
            'reverse_logistics', coalesce(v_stock_before, 0), coalesce(v_stock_before, 0) + v_item.received_quantity,
            v_item.received_quantity, 'delta', NULLIF(v_reason, ''),
            'return', auth.uid(), now(), auth.uid(), 'pending', 'return_item:' || v_item.id::text
          )
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id INTO v_erp_adjustment_id;
        END IF;
      END IF;
    END IF;
  END IF;

  v_is_transitional := p_destination IN ('technical_assistance','refurbishment');
  v_new_dest_status := CASE WHEN v_is_transitional THEN 'in_treatment' ELSE 'moved' END;

  INSERT INTO return_stock_movements (
    return_id, return_item_id, company_id, product_id, movement_type,
    origin_location, destination_location, quantity, lot_number, serial_number, reason, performed_by,
    is_transitional
  ) VALUES (
    v_item.return_id, v_item.id, v_item.company_id, v_item.product_id, p_destination,
    v_item.current_location, v_dest_location, v_item.received_quantity, v_item.lot_number, v_item.serial_number,
    NULLIF(v_reason, ''), auth.uid(), v_is_transitional
  );

  UPDATE return_items SET
    destination             = p_destination,
    destination_reason      = NULLIF(v_reason, ''),
    destination_status      = v_new_dest_status,
    destination_decided_by  = auth.uid(),
    destination_decided_at  = now(),
    current_location        = v_dest_location,
    erp_sync_adjustment_id  = v_erp_adjustment_id,
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
    jsonb_build_object(
      'itemId', p_item_id, 'destination', p_destination, 'reason', NULLIF(v_reason, ''),
      'transitional', v_is_transitional, 'erpSyncAdjustmentId', v_erp_adjustment_id
    )
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.return_items_decide_destination(uuid, text, text, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.return_items_decide_destination(uuid, text, text, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.return_items_decide_destination(uuid, text, text, boolean, uuid) TO authenticated;
