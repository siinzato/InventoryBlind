/*
# NF-e / Entradas — controles administrativos

## Summary
Mesmo desenho da 059/061, adaptado ao fato de que a NF-e é imutável: a nota, o
XML e os eventos de contagem NUNCA são reescritos. Uma correção de quantidade
depois do fechamento gera um evento NOVO, com valor anterior, valor novo, motivo
e usuário — nada é sobrescrito no lugar.

1. `deleted_at`/`deleted_by`/`deletion_reason` em nfe_invoices (arquivamento).
2. `nfe_admin_archive_invoice` / `nfe_admin_restore_invoice`.
3. `nfe_admin_hard_delete_draft_invoice` — só nota `not_started`, sem nenhum
   evento de contagem e sem nenhum item já conferido.
4. `nfe_admin_correct_count` — correção auditável de quantidade em nota já
   finalizada, por evento novo.
5. Guarda contra escrita em nota arquivada, por TRIGGER.

## Por que TRIGGER e não guarda dentro das 4 RPCs (diferente da 059)
Na 059 eu reescrevi as RPCs porque tinha conferido a definição viva de cada uma
contra o banco. Aqui a guarda por trigger é a escolha melhor, não a mais curta:
`linkItemToProduct` (nfeService.ts) grava em nfe_invoice_items DIRETO pela RLS,
sem passar por RPC nenhuma. Uma guarda só nas RPCs deixaria esse caminho aberto —
seria possível revincular produtos de uma nota arquivada. O trigger cobre todo
caminho de escrita, atual e futuro, sem reescrever a lógica de nenhuma função.

## Policies revistas
- `nfe_invoices_update`: REMOVIDA. Verificado que ninguém depende dela: o
  frontend só faz SELECT e INSERT em nfe_invoices (nfeService.ts:
  findInvoiceByKey/listInvoices/getInvoice/importNfeXml); todo o ciclo de vida é
  RPC SECURITY DEFINER (nfe_start_conference, nfe_register_count,
  nfe_finalize_conference, nfe_reopen_conference — 019); e a Edge Function
  nfe-fetch-by-key, que roda com o JWT do usuário, apenas lê e chama RPC (nenhum
  insert/update/upsert/delete no arquivo).
- `nfe_invoices_delete`: REMOVIDA (valia para owner/admin/manager). Um DELETE
  direto levava itens e eventos por CASCADE — apagava a prova da conferência.
- `nfe_items_delete`: REMOVIDA. Nada no projeto apaga itens diretamente, e itens
  de nota são registro fiscal.
- `nfe_items_update`: MANTIDA. É a policy que `linkItemToProduct` usa para
  vincular produto ao item na etapa de preparação — remover quebraria o fluxo.
  A imutabilidade dessa tabela passa a ser garantida pelo trigger (nota
  arquivada) e pelas RPCs (nota fechada), não pela ausência da policy.

## MUDANÇA DE PERMISSÃO — manager perde a reabertura
`nfe_reopen_conference` passa a exigir owner/admin, igual a pc_reopen_session na
061. Reabrir desfaz o fechamento de uma conferência.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Arquivamento
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE nfe_invoices
  ADD COLUMN IF NOT EXISTS deleted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by      uuid,
  ADD COLUMN IF NOT EXISTS deletion_reason text;

CREATE INDEX IF NOT EXISTS nfe_invoices_company_active_idx
  ON nfe_invoices (company_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Marca de correção administrativa no log de eventos, que continua append-only.
ALTER TABLE nfe_count_events
  ADD COLUMN IF NOT EXISTS is_admin_correction boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_reason        text,
  ADD COLUMN IF NOT EXISTS previous_quantity   numeric;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fechar a escrita direta (ver o cabeçalho para a análise)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "nfe_invoices_update" ON nfe_invoices;
DROP POLICY IF EXISTS "nfe_invoices_delete" ON nfe_invoices;
DROP POLICY IF EXISTS "nfe_items_delete"    ON nfe_invoice_items;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Guarda: nota arquivada não aceita escrita nenhuma
--
-- Em nfe_invoices a única transição permitida é a própria mudança de
-- deleted_at (arquivar/restaurar). Qualquer outro UPDATE numa nota arquivada é
-- recusado — o que cobre nfe_start_conference, nfe_finalize_conference e
-- nfe_reopen_conference sem tocar no corpo delas.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nfe_guard_archived_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'Esta nota foi removida do histórico e não pode ser alterada.';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS nfe_invoices_guard_archived ON nfe_invoices;
CREATE TRIGGER nfe_invoices_guard_archived
  BEFORE UPDATE ON nfe_invoices
  FOR EACH ROW EXECUTE FUNCTION public.nfe_guard_archived_invoice();

-- Itens e eventos: consulta a nota-mãe. Cobre tanto as RPCs quanto o UPDATE
-- direto de linkItemToProduct.
CREATE OR REPLACE FUNCTION public.nfe_guard_archived_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_deleted_at timestamptz;
  v_invoice_id uuid;
BEGIN
  v_invoice_id := NEW.invoice_id;
  SELECT deleted_at INTO v_deleted_at FROM nfe_invoices WHERE id = v_invoice_id;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta nota foi removida do histórico e não pode ser alterada.';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS nfe_items_guard_archived ON nfe_invoice_items;
CREATE TRIGGER nfe_items_guard_archived
  BEFORE INSERT OR UPDATE ON nfe_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.nfe_guard_archived_parent();

DROP TRIGGER IF EXISTS nfe_events_guard_archived ON nfe_count_events;
CREATE TRIGGER nfe_events_guard_archived
  BEFORE INSERT ON nfe_count_events
  FOR EACH ROW EXECUTE FUNCTION public.nfe_guard_archived_parent();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. nfe_admin_archive_invoice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nfe_admin_archive_invoice(
  p_invoice_id uuid,
  p_reason     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company text;
  v_role    text;
  v_email   text;
  v_reason  text;
  v_before  nfe_invoices%ROWTYPE;
  v_counted integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuário autenticado nesta requisição.';
  END IF;

  v_company := get_my_company_id();
  v_role    := get_my_role();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem remover uma nota do histórico.';
  END IF;

  v_reason := btrim(coalesce(p_reason, ''));
  IF char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'A justificativa precisa ter pelo menos 5 caracteres.';
  END IF;

  SELECT * INTO v_before FROM nfe_invoices WHERE id = p_invoice_id FOR UPDATE;

  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'Nota não encontrada.';
  END IF;
  IF v_before.company_id::text <> v_company THEN
    RAISE EXCEPTION 'Esta nota pertence a outra empresa.';
  END IF;
  IF v_before.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta nota já foi removida do histórico.';
  END IF;

  SELECT count(*) INTO v_counted FROM nfe_count_events WHERE invoice_id = p_invoice_id;

  UPDATE nfe_invoices
  SET deleted_at      = now(),
      deleted_by      = auth.uid(),
      deletion_reason = v_reason,
      updated_at      = now()
  WHERE id = p_invoice_id;

  SELECT email INTO v_email FROM profiles WHERE id = auth.uid();

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_before.company_id,
    auth.uid(),
    coalesce(v_email, ''),
    'nfe.invoice_archived',
    'nfe_invoice',
    p_invoice_id::text,
    'Conferência de NF-e removida do histórico visível.',
    jsonb_build_object(
      'invoiceId',     p_invoice_id,
      -- Chave completa: é o identificador fiscal da nota, e sem ele o registro
      -- de auditoria não permite reencontrá-la.
      'invoiceKey',    v_before.invoice_key,
      'invoiceNumber', v_before.invoice_number,
      'invoiceSeries', v_before.invoice_series,
      'supplierName',  v_before.supplier_name,
      'supplierCnpj',  v_before.supplier_cnpj,
      'status',        v_before.status,
      'totalItems',    v_before.total_items,
      'countEvents',   v_counted,
      'reason',        v_reason,
      'archivedBy',    auth.uid(),
      'archivedAt',    now()
    )
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.nfe_admin_archive_invoice(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.nfe_admin_archive_invoice(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.nfe_admin_archive_invoice(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. nfe_admin_restore_invoice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nfe_admin_restore_invoice(
  p_invoice_id uuid,
  p_reason     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company text;
  v_role    text;
  v_email   text;
  v_reason  text;
  v_before  nfe_invoices%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuário autenticado nesta requisição.';
  END IF;

  v_company := get_my_company_id();
  v_role    := get_my_role();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem restaurar uma nota.';
  END IF;

  v_reason := btrim(coalesce(p_reason, ''));
  IF char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'A justificativa precisa ter pelo menos 5 caracteres.';
  END IF;

  SELECT * INTO v_before FROM nfe_invoices WHERE id = p_invoice_id FOR UPDATE;

  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'Nota não encontrada.';
  END IF;
  IF v_before.company_id::text <> v_company THEN
    RAISE EXCEPTION 'Esta nota pertence a outra empresa.';
  END IF;
  IF v_before.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Esta nota não está arquivada.';
  END IF;

  UPDATE nfe_invoices
  SET deleted_at      = NULL,
      deleted_by      = NULL,
      deletion_reason = NULL,
      updated_at      = now()
  WHERE id = p_invoice_id;

  SELECT email INTO v_email FROM profiles WHERE id = auth.uid();

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_before.company_id,
    auth.uid(),
    coalesce(v_email, ''),
    'nfe.invoice_restored',
    'nfe_invoice',
    p_invoice_id::text,
    'Conferência de NF-e restaurada ao histórico visível.',
    jsonb_build_object(
      'invoiceId',               p_invoice_id,
      'invoiceKey',              v_before.invoice_key,
      'invoiceNumber',           v_before.invoice_number,
      'status',                  v_before.status,
      'previousDeletedAt',       v_before.deleted_at,
      'previousDeletedBy',       v_before.deleted_by,
      'previousDeletionReason',  v_before.deletion_reason,
      'reason',                  v_reason,
      'restoredBy',              auth.uid(),
      'restoredAt',              now()
    )
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.nfe_admin_restore_invoice(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.nfe_admin_restore_invoice(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.nfe_admin_restore_invoice(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. nfe_admin_hard_delete_draft_invoice
--
-- Só nota que nunca foi conferida: status not_started, zero eventos de contagem
-- e zero itens com quantidade registrada. O XML vai junto — é exatamente por
-- isso que a condição é tão estreita.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nfe_admin_hard_delete_draft_invoice(
  p_invoice_id uuid,
  p_reason     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company text;
  v_role    text;
  v_email   text;
  v_reason  text;
  v_before  nfe_invoices%ROWTYPE;
  v_events  integer;
  v_counted integer;
  v_items   integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuário autenticado nesta requisição.';
  END IF;

  v_company := get_my_company_id();
  v_role    := get_my_role();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem excluir definitivamente uma nota.';
  END IF;

  v_reason := btrim(coalesce(p_reason, ''));
  IF char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'A justificativa precisa ter pelo menos 5 caracteres.';
  END IF;

  SELECT * INTO v_before FROM nfe_invoices WHERE id = p_invoice_id FOR UPDATE;

  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'Nota não encontrada.';
  END IF;
  IF v_before.company_id::text <> v_company THEN
    RAISE EXCEPTION 'Esta nota pertence a outra empresa.';
  END IF;
  IF v_before.status <> 'not_started' THEN
    RAISE EXCEPTION 'Só uma nota que nunca foi conferida pode ser excluída definitivamente. Use a remoção do histórico.';
  END IF;

  SELECT count(*) INTO v_events FROM nfe_count_events WHERE invoice_id = p_invoice_id;
  IF v_events > 0 THEN
    RAISE EXCEPTION 'Esta nota já tem % registro(s) de contagem e não pode ser excluída definitivamente.', v_events;
  END IF;

  SELECT count(*) INTO v_counted
  FROM nfe_invoice_items
  WHERE invoice_id = p_invoice_id AND physical_quantity IS NOT NULL;
  IF v_counted > 0 THEN
    RAISE EXCEPTION 'Esta nota tem % item(ns) já conferido(s) e não pode ser excluída definitivamente.', v_counted;
  END IF;

  SELECT count(*) INTO v_items FROM nfe_invoice_items WHERE invoice_id = p_invoice_id;

  SELECT email INTO v_email FROM profiles WHERE id = auth.uid();

  -- Auditoria antes do DELETE, na mesma transação.
  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_before.company_id,
    auth.uid(),
    coalesce(v_email, ''),
    'nfe.invoice_hard_deleted',
    'nfe_invoice',
    p_invoice_id::text,
    'Nota nunca conferida excluída definitivamente.',
    jsonb_build_object(
      'invoiceId',     p_invoice_id,
      'invoiceKey',    v_before.invoice_key,
      'invoiceNumber', v_before.invoice_number,
      'invoiceSeries', v_before.invoice_series,
      'issueDate',     v_before.issue_date,
      'supplierName',  v_before.supplier_name,
      'supplierCnpj',  v_before.supplier_cnpj,
      'status',        v_before.status,
      'totalItems',    v_before.total_items,
      'cascadedItems', v_items,
      -- O XML em si NÃO é copiado para o log: é documento fiscal inteiro dentro
      -- de um campo de auditoria, e audit_logs é legível por todo owner/admin.
      -- Registra-se apenas que existia.
      'hadRawXml',     v_before.raw_xml IS NOT NULL,
      'createdAt',     v_before.created_at,
      'createdBy',     v_before.created_by,
      'reason',        v_reason,
      'deletedBy',     auth.uid(),
      'deletedAt',     now()
    )
  );

  DELETE FROM nfe_invoices WHERE id = p_invoice_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.nfe_admin_hard_delete_draft_invoice(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.nfe_admin_hard_delete_draft_invoice(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.nfe_admin_hard_delete_draft_invoice(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. nfe_admin_correct_count — correção por evento novo
--
-- O caso de uso: a conferência fechou com um número errado (item digitado
-- errado, contagem refeita no chão) e a nota já está finalizada. Reabrir apagaria
-- o result_status de TODOS os itens; corrigir aqui altera um item só e deixa
-- rastro do valor anterior.
--
-- Nada é sobrescrito no log: entra uma linha nova em nfe_count_events com
-- previous_quantity, resulting_quantity, motivo e autor. O evento antigo
-- permanece. `physical_quantity` do item é o valor corrente derivado desse log,
-- e é recalculado o result_status do item e o status da nota.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nfe_admin_correct_count(
  p_item_id  uuid,
  p_quantity numeric,
  p_reason   text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company    text;
  v_role       text;
  v_email      text;
  v_reason     text;
  v_item       nfe_invoice_items%ROWTYPE;
  v_invoice    nfe_invoices%ROWTYPE;
  v_previous   numeric;
  v_divergent  integer;
  v_new_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuário autenticado nesta requisição.';
  END IF;

  v_company := get_my_company_id();
  v_role    := get_my_role();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem corrigir uma quantidade conferida.';
  END IF;

  v_reason := btrim(coalesce(p_reason, ''));
  IF char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'A justificativa precisa ter pelo menos 5 caracteres.';
  END IF;

  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'A quantidade corrigida precisa ser zero ou um número positivo.';
  END IF;

  SELECT * INTO v_item FROM nfe_invoice_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Item não encontrado.';
  END IF;
  IF v_item.company_id::text <> v_company THEN
    RAISE EXCEPTION 'Este item pertence a outra empresa.';
  END IF;

  SELECT * INTO v_invoice FROM nfe_invoices WHERE id = v_item.invoice_id FOR UPDATE;
  IF v_invoice.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta nota foi removida do histórico e não pode ser corrigida.';
  END IF;
  IF v_invoice.status NOT IN ('completed','with_divergences') THEN
    RAISE EXCEPTION 'A correção administrativa é para nota já finalizada. Esta nota ainda está em conferência — use a contagem normal.';
  END IF;

  v_previous := v_item.physical_quantity;

  INSERT INTO nfe_count_events (
    company_id, invoice_id, item_id, product_id, sku, ean,
    delta, resulting_quantity, mode, source,
    is_admin_correction, admin_reason, previous_quantity,
    idempotency_key, created_by
  ) VALUES (
    v_item.company_id, v_item.invoice_id, p_item_id, v_item.product_id,
    v_item.snapshot_sku, v_item.nfe_ean,
    p_quantity - coalesce(v_previous, 0), p_quantity, 'set', 'manual',
    true, v_reason, v_previous,
    gen_random_uuid(), auth.uid()
  );

  UPDATE nfe_invoice_items
  SET physical_quantity = p_quantity,
      result_status = CASE
        WHEN product_id IS NULL              THEN 'unlinked'
        WHEN p_quantity = expected_quantity  THEN 'ok'
        WHEN p_quantity < expected_quantity  THEN 'missing'
        ELSE 'surplus'
      END,
      updated_at = now()
  WHERE id = p_item_id;

  -- O status da nota é derivado dos itens, então precisa acompanhar a correção:
  -- corrigir o último item divergente tem de deixar a nota como 'completed'.
  SELECT count(*) INTO v_divergent
  FROM nfe_invoice_items
  WHERE invoice_id = v_item.invoice_id
    AND (result_status IS NULL OR result_status <> 'ok');

  v_new_status := CASE WHEN v_divergent = 0 THEN 'completed' ELSE 'with_divergences' END;

  UPDATE nfe_invoices
  SET status = v_new_status, updated_at = now()
  WHERE id = v_item.invoice_id;

  SELECT email INTO v_email FROM profiles WHERE id = auth.uid();

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_item.company_id,
    auth.uid(),
    coalesce(v_email, ''),
    'nfe.count_corrected',
    'nfe_invoice_item',
    p_item_id::text,
    'Quantidade conferida corrigida por ação administrativa.',
    jsonb_build_object(
      'itemId',           p_item_id,
      'invoiceId',        v_item.invoice_id,
      'invoiceKey',       v_invoice.invoice_key,
      'invoiceNumber',    v_invoice.invoice_number,
      'description',      v_item.description,
      'nfeCode',          v_item.nfe_code,
      'expectedQuantity', v_item.expected_quantity,
      'previousQuantity', v_previous,
      'newQuantity',      p_quantity,
      'previousInvoiceStatus', v_invoice.status,
      'newInvoiceStatus',      v_new_status,
      'reason',           v_reason,
      'correctedBy',      auth.uid(),
      'correctedAt',      now()
    )
  );

  RETURN p_quantity;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.nfe_admin_correct_count(uuid, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.nfe_admin_correct_count(uuid, numeric, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.nfe_admin_correct_count(uuid, numeric, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. nfe_reopen_conference — owner/admin, e agora auditada
--
-- Corpo idêntico ao da 019 (linhas 243+), com o papel restrito e o INSERT de
-- auditoria. A guarda de nota arquivada vem do trigger, não daqui.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nfe_reopen_conference(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company     text;
  v_role        text;
  v_email       text;
  v_inv_company uuid;
  v_status      text;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem reabrir uma conferência.';
  END IF;

  SELECT company_id, status INTO v_inv_company, v_status
  FROM nfe_invoices WHERE id = p_invoice_id FOR UPDATE;

  IF v_inv_company IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF v_inv_company::text <> v_company THEN
    RAISE EXCEPTION 'Invoice belongs to another company';
  END IF;
  IF v_status NOT IN ('completed','with_divergences') THEN
    RAISE EXCEPTION 'Only a finalized conference can be reopened';
  END IF;

  UPDATE nfe_invoices
  SET status = 'in_progress', finished_at = NULL, finished_by = NULL, updated_at = now()
  WHERE id = p_invoice_id;

  UPDATE nfe_invoice_items
  SET result_status = NULL, updated_at = now()
  WHERE invoice_id = p_invoice_id;

  SELECT email INTO v_email FROM profiles WHERE id = auth.uid();

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_inv_company,
    auth.uid(),
    coalesce(v_email, ''),
    'nfe.conference_reopened',
    'nfe_invoice',
    p_invoice_id::text,
    'Conferência de NF-e reaberta — o resultado anterior foi desfeito.',
    jsonb_build_object(
      'invoiceId',      p_invoice_id,
      'previousStatus', v_status,
      'reopenedBy',     auth.uid(),
      'reopenedAt',     now()
    )
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.nfe_reopen_conference(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.nfe_reopen_conference(uuid) TO authenticated;
