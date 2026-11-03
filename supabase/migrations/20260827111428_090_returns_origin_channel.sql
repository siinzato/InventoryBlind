-- ═══════════════════════════════════════════════════════════════════════════
-- Logística Reversa — canal de origem da devolução (rastreabilidade)
--
-- Reaproveita: integration_connections (já existente, migration 042/087 — é a
-- "conta de canal": provider_key + external_account_id + fiscal_entity_id,
-- já com índice único pensado para várias contas do mesmo provedor por
-- empresa) e fiscal_entities (087). Nenhuma tabela de pedidos/canal nova.
--
-- returns.origin continua existindo como texto livre (compatibilidade com
-- ReturnDetailPage e qualquer relatório já existente) — as duas colunas novas
-- só adicionam rastreabilidade estruturada de qual conta de canal e como foi
-- determinada, calculada no cliente por src/lib/reverseLogistics/
-- originChannelResolver.ts a partir de evidência da própria NF-e
-- (idCadIntTran do intermediador), nunca por nome/produto/texto livre.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. returns ganha 2 colunas nullable, aditivas
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS origin_channel_connection_id uuid
    REFERENCES integration_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origin_source text
    CHECK (origin_source IN ('confirmada','mapeada','manual','ambigua','nao_identificada'));

CREATE INDEX IF NOT EXISTS returns_origin_channel_connection_idx
  ON returns (origin_channel_connection_id) WHERE origin_channel_connection_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Guarda cross-tenant — mesmo padrão de
--    integration_connections_check_fiscal_entity (migration 087). Aplica-se a
--    QUALQUER escrita em returns (RPC returns_create_from_nfe_xml abaixo, e o
--    insert direto de createReturn() via RLS), então a checagem mora em um
--    trigger em vez de duplicada nos dois caminhos.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.returns_check_origin_channel_connection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.origin_channel_connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM integration_connections
    WHERE id = NEW.origin_channel_connection_id AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'A conta de canal informada não pertence a esta empresa.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS returns_origin_channel_guard ON returns;
CREATE TRIGGER returns_origin_channel_guard
  BEFORE INSERT OR UPDATE OF origin_channel_connection_id ON returns
  FOR EACH ROW EXECUTE FUNCTION public.returns_check_origin_channel_connection();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. returns_create_from_nfe_xml (086) ganha 2 parâmetros novos, no final da
--    lista, com DEFAULT NULL — nenhuma chamada existente quebra. Assinatura
--    muda de (text,text,text,uuid,text,text,text,jsonb) para
--    (text,text,text,uuid,text,text,text,uuid,text,jsonb): o Postgres trata
--    isso como uma função DIFERENTE por identidade de parâmetros (não
--    "substitui" a antiga por CREATE OR REPLACE), então a antiga é removida
--    explicitamente primeiro para não deixar duas sobrecargas ambíguas para
--    o PostgREST resolver.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.returns_create_from_nfe_xml(text, text, text, uuid, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.returns_create_from_nfe_xml(
  p_invoice_key text,
  p_xml_hash text,
  p_raw_xml text,
  p_original_nfe_invoice_id uuid DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_origin_channel_connection_id uuid DEFAULT NULL,
  p_origin_source text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
 RETURNS returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company        text;
  v_key            text;
  v_item           jsonb;
  v_declared       numeric;
  v_received       numeric;
  v_line           integer := 0;
  v_result         returns%ROWTYPE;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;

  v_key := regexp_replace(coalesce(p_invoice_key, ''), '\D', '', 'g');
  IF char_length(v_key) <> 44 THEN
    RAISE EXCEPTION 'Chave de acesso inválida — deve ter 44 dígitos.';
  END IF;

  IF jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Nenhum item informado.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM returns
    WHERE company_id::text = v_company
      AND (return_nfe_invoice_key = v_key OR (p_xml_hash IS NOT NULL AND return_nfe_xml_hash = p_xml_hash))
  ) THEN
    RAISE EXCEPTION 'Esta NF-e já foi utilizada em outra devolução.';
  END IF;

  IF p_original_nfe_invoice_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM nfe_invoices WHERE id = p_original_nfe_invoice_id AND company_id::text = v_company
  ) THEN
    RAISE EXCEPTION 'A NF-e original informada não pertence a esta empresa.';
  END IF;

  IF p_origin_channel_connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM integration_connections WHERE id = p_origin_channel_connection_id AND company_id::text = v_company
  ) THEN
    RAISE EXCEPTION 'A conta de canal informada não pertence a esta empresa.';
  END IF;

  -- Valida quantidades ANTES de inserir qualquer coisa — falha de leitura não
  -- pode deixar uma devolução parcialmente criada.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line := v_line + 1;
    v_declared := NULLIF(v_item->>'declaredQuantity', '')::numeric;
    v_received := NULLIF(v_item->>'receivedQuantity', '')::numeric;
    IF v_received IS NULL OR v_received <= 0 THEN
      RAISE EXCEPTION 'Item %: a quantidade recebida deve ser maior que zero.', v_line;
    END IF;
    IF v_declared IS NOT NULL AND v_received > v_declared THEN
      RAISE EXCEPTION 'Item %: a quantidade recebida ultrapassa a quantidade declarada na NF-e.', v_line;
    END IF;
  END LOOP;

  INSERT INTO returns (
    company_id, source_type, reference_value, linked_nfe_invoice_id, unresolved,
    customer_name, origin, origin_channel_connection_id, origin_source, reason,
    return_nfe_invoice_key, return_nfe_raw_xml, return_nfe_xml_hash
  ) VALUES (
    v_company::uuid, 'nfe_xml', v_key, p_original_nfe_invoice_id, (p_original_nfe_invoice_id IS NULL),
    p_customer_name, p_origin, p_origin_channel_connection_id, p_origin_source, p_reason,
    v_key, p_raw_xml, p_xml_hash
  ) RETURNING * INTO v_result;

  v_line := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line := v_line + 1;
    INSERT INTO return_items (
      return_id, company_id, line_number, product_id, sku, ean, description,
      expected_quantity, received_quantity, lot_number, serial_number
    ) VALUES (
      v_result.id, v_company::uuid, v_line,
      NULLIF(v_item->>'productId', '')::uuid, NULLIF(v_item->>'sku', ''), NULLIF(v_item->>'ean', ''),
      coalesce(NULLIF(v_item->>'description', ''), 'Item sem descrição'),
      NULLIF(v_item->>'declaredQuantity', '')::numeric, NULLIF(v_item->>'receivedQuantity', '')::numeric,
      NULLIF(v_item->>'lotNumber', ''), NULLIF(v_item->>'serialNumber', '')
    );
  END LOOP;

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_company::uuid,
    auth.uid(),
    coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'reverse_logistics.nfe_xml_return_created',
    'returns',
    v_result.id::text,
    'Devolução criada a partir de XML de NF-e.',
    jsonb_build_object(
      'invoiceKey', v_key, 'itemCount', v_line, 'originalNfeFound', p_original_nfe_invoice_id IS NOT NULL,
      'originChannelConnectionId', p_origin_channel_connection_id, 'originSource', p_origin_source
    )
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.returns_create_from_nfe_xml(text, text, text, uuid, text, text, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.returns_create_from_nfe_xml(text, text, text, uuid, text, text, text, uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.returns_create_from_nfe_xml(text, text, text, uuid, text, text, text, uuid, text, jsonb) TO authenticated;
