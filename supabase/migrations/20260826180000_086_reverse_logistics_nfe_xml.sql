-- ═══════════════════════════════════════════════════════════════════════════
-- Logística Reversa — localizar devolução por XML de NF-e
--
-- Reaproveita: fast-xml-parser + parseNfeXml() (já existente, sem mudança de
-- comportamento — só 2 campos novos opcionais lidos, purposeCode/
-- referencedInvoiceKey), a cascata de vínculo de produto de nfeAssociation.ts
-- (SKU → EAN → nfe_learned_associations → nenhum), a busca de nota original já
-- existente (nfe_invoices/linked_nfe_invoice_id) e o campo returns.unresolved
-- já existente (mesmo significado: recebimento não identificado). Nenhuma
-- tabela de anexo nova — o XML é guardado como texto na própria linha de
-- returns, mesmo padrão de nfe_invoices.raw_xml (migration 018).
--
-- O backend é a autoridade: toda a validação (chave, duplicidade por chave e
-- por hash, limite de quantidade por item) mora nesta RPC, não no cliente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. returns.source_type ganha um valor aditivo + 3 colunas nullable
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE returns DROP CONSTRAINT returns_source_type_check;
ALTER TABLE returns ADD CONSTRAINT returns_source_type_check
  CHECK (source_type IN ('order','nfe','sku','barcode','serial','tracking','external_ref','manual','nfe_xml'));

ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_nfe_invoice_key text;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_nfe_raw_xml text;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_nfe_xml_hash text;

-- Duas garantias independentes de "não reutilizar o mesmo documento": uma pela
-- chave de acesso (o identificador fiscal do documento), outra pelo hash do
-- conteúdo colado (protege mesmo se a chave não puder ser lida por algum
-- motivo, embora isso já seja rejeitado antes de chegar aqui).
CREATE UNIQUE INDEX IF NOT EXISTS returns_nfe_invoice_key_unique_idx
  ON returns (company_id, return_nfe_invoice_key) WHERE return_nfe_invoice_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS returns_nfe_xml_hash_unique_idx
  ON returns (company_id, return_nfe_xml_hash) WHERE return_nfe_xml_hash IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC — cria a devolução + itens a partir do XML já lido e resolvido no
--    cliente (prefill/UX), mas validado e persistido aqui (autoridade).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.returns_create_from_nfe_xml(
  p_invoice_key text,
  p_xml_hash text,
  p_raw_xml text,
  p_original_nfe_invoice_id uuid DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_reason text DEFAULT NULL,
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
    customer_name, origin, reason, return_nfe_invoice_key, return_nfe_raw_xml, return_nfe_xml_hash
  ) VALUES (
    v_company::uuid, 'nfe_xml', v_key, p_original_nfe_invoice_id, (p_original_nfe_invoice_id IS NULL),
    p_customer_name, p_origin, p_reason, v_key, p_raw_xml, p_xml_hash
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
    jsonb_build_object('invoiceKey', v_key, 'itemCount', v_line, 'originalNfeFound', p_original_nfe_invoice_id IS NOT NULL)
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.returns_create_from_nfe_xml(text, text, text, uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.returns_create_from_nfe_xml(text, text, text, uuid, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.returns_create_from_nfe_xml(text, text, text, uuid, text, text, text, jsonb) TO authenticated;
