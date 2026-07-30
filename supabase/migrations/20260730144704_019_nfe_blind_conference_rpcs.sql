/*
# NF-e Blind Conference — Atomic RPCs (Etapa 1)

## Summary
Server-side transactional functions for the blind conference lifecycle.
All are SECURITY DEFINER and validate the caller's company and role internally;
nothing critical depends on frontend/React state.

## Functions
1. nfe_start_conference(p_invoice_id) — begins real counting.
2. nfe_register_count(...) — idempotent atomic count (increment|set).
3. nfe_finalize_conference(p_invoice_id) — atomic finalization + snapshot.
4. nfe_reopen_conference(p_invoice_id) — manager/admin/owner recount, never erases history.

## Security
- Each function derives the company from get_my_company_id() and rejects
  invoices/items belonging to another company.
- Row locks (FOR UPDATE) prevent races and double finalization.
- Idempotency enforced by unique idempotency_key on nfe_count_events.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- nfe_start_conference
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nfe_start_conference(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company text;
  v_status  text;
  v_inv_company uuid;
  v_unlinked integer;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  SELECT company_id, status INTO v_inv_company, v_status
  FROM nfe_invoices WHERE id = p_invoice_id FOR UPDATE;

  IF v_inv_company IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF v_inv_company::text <> v_company THEN
    RAISE EXCEPTION 'Invoice belongs to another company';
  END IF;
  IF v_status <> 'not_started' THEN
    RAISE EXCEPTION 'Conference already started';
  END IF;

  SELECT count(*) INTO v_unlinked
  FROM nfe_invoice_items
  WHERE invoice_id = p_invoice_id AND product_id IS NULL;

  IF v_unlinked > 0 THEN
    RAISE EXCEPTION 'Cannot start: % item(s) not linked to a product', v_unlinked;
  END IF;

  UPDATE nfe_invoices
  SET status = 'in_progress', started_at = now(), started_by = auth.uid(), updated_at = now()
  WHERE id = p_invoice_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.nfe_start_conference(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nfe_start_conference(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- nfe_register_count — atomic, idempotent
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nfe_register_count(
  p_item_id         uuid,
  p_mode            text,
  p_quantity        numeric,
  p_source          text,
  p_idempotency_key uuid,
  p_ean             text DEFAULT NULL,
  p_sku             text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company     text;
  v_item_company uuid;
  v_invoice_id  uuid;
  v_inv_status  text;
  v_current     numeric;
  v_new         numeric;
  v_delta       numeric;
  v_existing    numeric;
  v_product_id  uuid;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  IF p_mode NOT IN ('increment','set') THEN
    RAISE EXCEPTION 'Invalid mode';
  END IF;
  IF p_source NOT IN ('scanner','manual','camera','voice') THEN
    RAISE EXCEPTION 'Invalid source';
  END IF;

  -- Idempotency: if this key was already recorded, return its result unchanged.
  SELECT resulting_quantity INTO v_existing
  FROM nfe_count_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Lock the item row.
  SELECT company_id, invoice_id, coalesce(physical_quantity, 0), product_id
  INTO v_item_company, v_invoice_id, v_current, v_product_id
  FROM nfe_invoice_items WHERE id = p_item_id FOR UPDATE;

  IF v_item_company IS NULL THEN
    RAISE EXCEPTION 'Item not found';
  END IF;
  IF v_item_company::text <> v_company THEN
    RAISE EXCEPTION 'Item belongs to another company';
  END IF;

  SELECT status INTO v_inv_status FROM nfe_invoices WHERE id = v_invoice_id FOR UPDATE;
  IF v_inv_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Conference is not in progress';
  END IF;

  IF p_mode = 'increment' THEN
    v_new := v_current + p_quantity;
  ELSE
    v_new := p_quantity;
  END IF;

  IF v_new < 0 THEN
    v_new := 0;
  END IF;

  v_delta := v_new - v_current;

  INSERT INTO nfe_count_events (
    company_id, invoice_id, item_id, product_id, sku, ean,
    delta, resulting_quantity, mode, source, idempotency_key, created_by
  ) VALUES (
    v_item_company, v_invoice_id, p_item_id, v_product_id, p_sku, p_ean,
    v_delta, v_new, p_mode, p_source, p_idempotency_key, auth.uid()
  );

  UPDATE nfe_invoice_items
  SET physical_quantity = v_new, updated_at = now()
  WHERE id = p_item_id;

  RETURN v_new;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.nfe_register_count(uuid, text, numeric, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nfe_register_count(uuid, text, numeric, text, uuid, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- nfe_finalize_conference — atomic
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nfe_finalize_conference(p_invoice_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company     text;
  v_inv_company uuid;
  v_status      text;
  v_divergent   integer;
  v_final_status text;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  SELECT company_id, status INTO v_inv_company, v_status
  FROM nfe_invoices WHERE id = p_invoice_id FOR UPDATE;

  IF v_inv_company IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF v_inv_company::text <> v_company THEN
    RAISE EXCEPTION 'Invoice belongs to another company';
  END IF;
  IF v_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Conference is not in progress (cannot finalize twice)';
  END IF;

  -- Compute per-item result + immutable snapshot from the current product catalog.
  UPDATE nfe_invoice_items i
  SET
    result_status = CASE
      WHEN i.product_id IS NULL THEN 'unlinked'
      WHEN i.physical_quantity IS NULL THEN 'pending'
      WHEN i.physical_quantity = i.expected_quantity THEN 'ok'
      WHEN i.physical_quantity < i.expected_quantity THEN 'missing'
      ELSE 'surplus'
    END,
    snapshot_product_name = p.name,
    snapshot_sku          = p.sku,
    snapshot_ean          = p.ean,
    updated_at = now()
  FROM (SELECT id AS iid FROM nfe_invoice_items WHERE invoice_id = p_invoice_id) sub
  LEFT JOIN products p ON p.id = (SELECT product_id FROM nfe_invoice_items WHERE id = sub.iid)
  WHERE i.id = sub.iid;

  SELECT count(*) INTO v_divergent
  FROM nfe_invoice_items
  WHERE invoice_id = p_invoice_id AND result_status <> 'ok';

  IF v_divergent = 0 THEN
    v_final_status := 'completed';
  ELSE
    v_final_status := 'with_divergences';
  END IF;

  UPDATE nfe_invoices
  SET status = v_final_status, finished_at = now(), finished_by = auth.uid(), updated_at = now()
  WHERE id = p_invoice_id;

  RETURN v_final_status;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.nfe_finalize_conference(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nfe_finalize_conference(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- nfe_reopen_conference — manager/admin/owner, keeps prior counts
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
  v_inv_company uuid;
  v_status      text;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;
  IF v_role NOT IN ('owner','admin','manager') THEN
    RAISE EXCEPTION 'Only manager or admin can reopen a conference';
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

  -- Never erase previous counts; only reopen for recount. A new finalize recomputes everything.
  UPDATE nfe_invoices
  SET status = 'in_progress', finished_at = NULL, finished_by = NULL, updated_at = now()
  WHERE id = p_invoice_id;

  UPDATE nfe_invoice_items
  SET result_status = NULL, updated_at = now()
  WHERE invoice_id = p_invoice_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.nfe_reopen_conference(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nfe_reopen_conference(uuid) TO authenticated;
