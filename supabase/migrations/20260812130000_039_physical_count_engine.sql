/*
# Contagem Física Digital — Motor de Contagem (Etapa 1: schema + RPCs)

## Summary
Generaliza o padrão de contagem cega já existente no módulo NF-e Blind Conference
(nfe_invoices/nfe_invoice_items/nfe_count_events + nfe_start/register/finalize/
reopen_conference, migrations 018/019) para faixas de localização física em vez
de itens de nota fiscal. Adiciona a cadeia contagem→recontagem→3ª contagem
(mesmo espírito de inventory_count_records.count_number/linked_count_id) e o
log imutável de sincronização ERP.

## New Tables
1. physical_count_sessions — cabeçalho da sessão (depósito/área/faixa de rua/
   responsável/tipo via count_number/status/aprovação). root_session_id agrupa
   as 3 rodadas possíveis de uma mesma contagem para o resultado final.
2. physical_count_items — um item por produto incluído na sessão.
   erp_quantity_snapshot é congelado no start (1ª contagem) ou copiado do pai
   (recontagem/3ª contagem) — nunca relido do saldo "atual" depois de iniciado.
3. physical_count_events — log imutável de cada ação de contagem, idempotente.
4. erp_sync_events — log imutável de cada tentativa de sincronização com o ERP.

## Atomic RPCs (SECURITY DEFINER, empresa + status validados internamente)
- pc_create_session: cria sessão (count_number=1) + itens a partir de produtos
  já resolvidos pelo cliente (faixa de rua → lista de product_id).
- pc_start_session: congela o snapshot do saldo ERP e inicia a contagem cega.
  Só pode ser chamada em sessões count_number=1 (recontagem/3ª já nascem
  in_progress com snapshot copiado do pai).
- pc_register_count: idêntico em forma a nfe_register_count.
- pc_finalize_session: bloqueia finalização com itens pendentes (seção 13 do
  ticket), calcula result_status, grava snapshot imutável do produto.
- pc_create_recount_session: cria a próxima rodada (2ª/3ª contagem) só com os
  itens divergentes do pai, copiando o snapshot do pai (nunca relendo o ERP).
- pc_reopen_session: manager/admin/owner, nunca apaga contagens.
- pc_approve_session: manager/admin/owner, aprovação humana antes do sync ERP.
- pc_record_erp_sync_event: chamada pela Edge Function erp-sync (nunca pelo
  browser diretamente) para registrar cada resultado de sincronização.

## Security (RLS)
Convenção B (a mais nova, usada quando a tabela referencia products(id)
diretamente): company_id uuid DEFAULT get_my_company_id()::uuid REFERENCES
companies(id), policies company_id::text = get_my_company_id() — igual às
tabelas nfe_*. physical_count_events e erp_sync_events são imutáveis (só
SELECT+INSERT).
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. physical_count_sessions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS physical_count_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  root_session_id   uuid REFERENCES physical_count_sessions(id) ON DELETE CASCADE,
  linked_session_id uuid REFERENCES physical_count_sessions(id) ON DELETE SET NULL,
  count_number      smallint NOT NULL DEFAULT 1 CHECK (count_number IN (1,2,3)),
  warehouse         text,
  area              text,
  street_from       text NOT NULL,
  street_to         text NOT NULL,
  responsible_id    uuid,
  observation       text,
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','in_progress','completed','with_divergences')),
  total_items       integer NOT NULL DEFAULT 0,
  approved_by       uuid,
  approved_at       timestamptz,
  created_by        uuid DEFAULT auth.uid(),
  started_at        timestamptz,
  started_by        uuid,
  finished_at       timestamptz,
  finished_by       uuid,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pc_sessions_company_idx        ON physical_count_sessions (company_id);
CREATE INDEX IF NOT EXISTS pc_sessions_company_status_idx ON physical_count_sessions (company_id, status);
CREATE INDEX IF NOT EXISTS pc_sessions_root_idx            ON physical_count_sessions (root_session_id);
CREATE INDEX IF NOT EXISTS pc_sessions_company_created_idx ON physical_count_sessions (company_id, created_at DESC);

ALTER TABLE physical_count_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pc_sessions_select" ON physical_count_sessions;
CREATE POLICY "pc_sessions_select" ON physical_count_sessions FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "pc_sessions_insert" ON physical_count_sessions;
CREATE POLICY "pc_sessions_insert" ON physical_count_sessions FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "pc_sessions_update" ON physical_count_sessions;
CREATE POLICY "pc_sessions_update" ON physical_count_sessions FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "pc_sessions_delete" ON physical_count_sessions;
CREATE POLICY "pc_sessions_delete" ON physical_count_sessions FOR DELETE
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin','manager'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. physical_count_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS physical_count_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id             uuid NOT NULL REFERENCES physical_count_sessions(id) ON DELETE CASCADE,
  company_id             uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  product_id             uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku                    text,
  ean                    text,
  location               text,
  erp_quantity_snapshot  numeric,
  erp_source             text NOT NULL DEFAULT 'tiny',
  erp_sync_ref           text,
  physical_quantity      numeric,
  result_status          text CHECK (result_status IS NULL OR result_status IN ('ok','missing','surplus')),
  snapshot_product_name  text,
  snapshot_sku           text,
  snapshot_ean           text,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pc_items_session_idx ON physical_count_items (session_id);
CREATE INDEX IF NOT EXISTS pc_items_company_idx ON physical_count_items (company_id);
CREATE INDEX IF NOT EXISTS pc_items_product_idx ON physical_count_items (product_id);
CREATE INDEX IF NOT EXISTS pc_items_sku_idx     ON physical_count_items (company_id, sku);

ALTER TABLE physical_count_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pc_items_select" ON physical_count_items;
CREATE POLICY "pc_items_select" ON physical_count_items FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "pc_items_insert" ON physical_count_items;
CREATE POLICY "pc_items_insert" ON physical_count_items FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "pc_items_update" ON physical_count_items;
CREATE POLICY "pc_items_update" ON physical_count_items FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "pc_items_delete" ON physical_count_items;
CREATE POLICY "pc_items_delete" ON physical_count_items FOR DELETE
  TO authenticated
  USING (company_id::text = get_my_company_id() AND get_my_role() IN ('owner','admin','manager'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. physical_count_events (immutable)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS physical_count_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  session_id         uuid NOT NULL REFERENCES physical_count_sessions(id) ON DELETE CASCADE,
  item_id            uuid NOT NULL REFERENCES physical_count_items(id) ON DELETE CASCADE,
  product_id         uuid,
  sku                text,
  ean                text,
  delta              numeric NOT NULL,
  resulting_quantity numeric NOT NULL,
  mode               text NOT NULL CHECK (mode IN ('increment','set')),
  source             text NOT NULL DEFAULT 'manual' CHECK (source IN ('scanner','manual')),
  idempotency_key    uuid NOT NULL,
  created_by         uuid DEFAULT auth.uid(),
  created_at         timestamptz DEFAULT now(),
  CONSTRAINT physical_count_events_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS pc_events_item_idx    ON physical_count_events (item_id, created_at);
CREATE INDEX IF NOT EXISTS pc_events_session_idx ON physical_count_events (session_id);
CREATE INDEX IF NOT EXISTS pc_events_company_idx ON physical_count_events (company_id);

ALTER TABLE physical_count_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pc_events_select" ON physical_count_events;
CREATE POLICY "pc_events_select" ON physical_count_events FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "pc_events_insert" ON physical_count_events;
CREATE POLICY "pc_events_insert" ON physical_count_events FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. erp_sync_events (immutable)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_sync_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  session_id        uuid NOT NULL REFERENCES physical_count_sessions(id) ON DELETE CASCADE,
  item_id           uuid REFERENCES physical_count_items(id) ON DELETE SET NULL,
  product_id        uuid,
  sku               text,
  provider          text NOT NULL DEFAULT 'tiny',
  previous_quantity numeric,
  final_quantity    numeric,
  adjustment        numeric,
  request_payload   jsonb,
  response_payload  jsonb,
  success           boolean NOT NULL,
  pending           boolean NOT NULL DEFAULT false,
  error_message     text,
  idempotency_key    uuid NOT NULL,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz DEFAULT now(),
  CONSTRAINT erp_sync_events_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS erp_sync_events_session_idx ON erp_sync_events (session_id);
CREATE INDEX IF NOT EXISTS erp_sync_events_company_idx ON erp_sync_events (company_id);

ALTER TABLE erp_sync_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "erp_sync_events_select" ON erp_sync_events;
CREATE POLICY "erp_sync_events_select" ON erp_sync_events FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "erp_sync_events_insert" ON erp_sync_events;
CREATE POLICY "erp_sync_events_insert" ON erp_sync_events FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers (reuse existing update_updated_at_column())
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS pc_sessions_updated_at ON physical_count_sessions;
CREATE TRIGGER pc_sessions_updated_at
  BEFORE UPDATE ON physical_count_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS pc_items_updated_at ON physical_count_items;
CREATE TRIGGER pc_items_updated_at
  BEFORE UPDATE ON physical_count_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- pc_create_session — 1ª contagem (sempre cega), a partir de produtos já
-- resolvidos pelo cliente (faixa de rua → lista de product_id via
-- src/lib/physicalCount/locationAddressing.ts, para não duplicar a lógica de
-- parsing de endereço em SQL e TS).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_create_session(
  p_warehouse      text,
  p_area           text,
  p_street_from    text,
  p_street_to      text,
  p_responsible_id uuid,
  p_observation    text,
  p_product_ids    uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company    text;
  v_session_id uuid;
  v_inserted   integer;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No products selected for this session';
  END IF;

  INSERT INTO physical_count_sessions (
    company_id, warehouse, area, street_from, street_to, responsible_id, observation, count_number
  ) VALUES (
    v_company::uuid, p_warehouse, p_area, p_street_from, p_street_to, p_responsible_id, p_observation, 1
  )
  RETURNING id INTO v_session_id;

  UPDATE physical_count_sessions SET root_session_id = id WHERE id = v_session_id;

  INSERT INTO physical_count_items (session_id, company_id, product_id, sku, ean, location, erp_source)
  SELECT v_session_id, v_company::uuid, p.id, p.sku, p.ean, p.location, 'tiny'
  FROM products p
  WHERE p.id = ANY(p_product_ids) AND p.company_id = v_company;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RAISE EXCEPTION 'None of the selected products belong to the active company';
  END IF;

  UPDATE physical_count_sessions SET total_items = v_inserted, updated_at = now() WHERE id = v_session_id;

  RETURN v_session_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_create_session(text, text, text, text, uuid, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_create_session(text, text, text, text, uuid, text, uuid[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- pc_start_session — congela o snapshot do saldo ERP (products.stock_quantity
-- NESTE MOMENTO) e inicia a contagem cega. Só para count_number = 1: uma
-- recontagem/3ª contagem já nasce in_progress com snapshot copiado do pai
-- (pc_create_recount_session), nunca relendo o saldo depois de a contagem
-- original ter começado (seção 6 do ticket).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_start_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company     text;
  v_sess_company uuid;
  v_status      text;
  v_count_number smallint;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  SELECT company_id, status, count_number INTO v_sess_company, v_status, v_count_number
  FROM physical_count_sessions WHERE id = p_session_id FOR UPDATE;

  IF v_sess_company IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_sess_company::text <> v_company THEN
    RAISE EXCEPTION 'Session belongs to another company';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Session already started';
  END IF;
  IF v_count_number <> 1 THEN
    RAISE EXCEPTION 'Only the first count is started this way — recount sessions start already in_progress';
  END IF;

  UPDATE physical_count_items i
  SET erp_quantity_snapshot = p.stock_quantity, updated_at = now()
  FROM products p
  WHERE i.session_id = p_session_id AND i.product_id = p.id;

  UPDATE physical_count_sessions
  SET status = 'in_progress', started_at = now(), started_by = auth.uid(), updated_at = now()
  WHERE id = p_session_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_start_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_start_session(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- pc_register_count — atomic, idempotent (mesma forma de nfe_register_count)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_register_count(
  p_item_id         uuid,
  p_mode            text,
  p_quantity        numeric,
  p_source          text,
  p_idempotency_key uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_item_company uuid;
  v_session_id   uuid;
  v_sess_status  text;
  v_current      numeric;
  v_new          numeric;
  v_delta        numeric;
  v_existing     numeric;
  v_product_id   uuid;
  v_sku          text;
  v_ean          text;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  IF p_mode NOT IN ('increment','set') THEN
    RAISE EXCEPTION 'Invalid mode';
  END IF;
  IF p_source NOT IN ('scanner','manual') THEN
    RAISE EXCEPTION 'Invalid source';
  END IF;

  SELECT resulting_quantity INTO v_existing
  FROM physical_count_events WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT company_id, session_id, coalesce(physical_quantity, 0), product_id, sku, ean
  INTO v_item_company, v_session_id, v_current, v_product_id, v_sku, v_ean
  FROM physical_count_items WHERE id = p_item_id FOR UPDATE;

  IF v_item_company IS NULL THEN
    RAISE EXCEPTION 'Item not found';
  END IF;
  IF v_item_company::text <> v_company THEN
    RAISE EXCEPTION 'Item belongs to another company';
  END IF;

  SELECT status INTO v_sess_status FROM physical_count_sessions WHERE id = v_session_id FOR UPDATE;
  IF v_sess_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Session is not in progress';
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

  INSERT INTO physical_count_events (
    company_id, session_id, item_id, product_id, sku, ean,
    delta, resulting_quantity, mode, source, idempotency_key, created_by
  ) VALUES (
    v_item_company, v_session_id, p_item_id, v_product_id, v_sku, v_ean,
    v_delta, v_new, p_mode, p_source, p_idempotency_key, auth.uid()
  );

  UPDATE physical_count_items
  SET physical_quantity = v_new, updated_at = now()
  WHERE id = p_item_id;

  RETURN v_new;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_register_count(uuid, text, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_register_count(uuid, text, numeric, text, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- pc_finalize_session — bloqueia itens pendentes (seção 13), calcula
-- resultado, grava snapshot imutável do produto.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_finalize_session(p_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_sess_company uuid;
  v_status       text;
  v_pending      integer;
  v_divergent    integer;
  v_final_status text;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  SELECT company_id, status INTO v_sess_company, v_status
  FROM physical_count_sessions WHERE id = p_session_id FOR UPDATE;

  IF v_sess_company IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_sess_company::text <> v_company THEN
    RAISE EXCEPTION 'Session belongs to another company';
  END IF;
  IF v_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Session is not in progress (cannot finalize twice)';
  END IF;

  SELECT count(*) INTO v_pending
  FROM physical_count_items WHERE session_id = p_session_id AND physical_quantity IS NULL;

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'Cannot finalize: % item(s) not yet counted', v_pending;
  END IF;

  UPDATE physical_count_items i
  SET
    result_status = CASE
      WHEN i.physical_quantity = i.erp_quantity_snapshot THEN 'ok'
      WHEN i.physical_quantity < i.erp_quantity_snapshot THEN 'missing'
      ELSE 'surplus'
    END,
    snapshot_product_name = p.name,
    snapshot_sku          = p.sku,
    snapshot_ean           = p.ean,
    updated_at = now()
  FROM products p
  WHERE i.session_id = p_session_id AND i.product_id = p.id;

  SELECT count(*) INTO v_divergent
  FROM physical_count_items
  WHERE session_id = p_session_id AND result_status <> 'ok';

  v_final_status := CASE WHEN v_divergent = 0 THEN 'completed' ELSE 'with_divergences' END;

  UPDATE physical_count_sessions
  SET status = v_final_status, finished_at = now(), finished_by = auth.uid(), updated_at = now()
  WHERE id = p_session_id;

  RETURN v_final_status;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_finalize_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_finalize_session(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- pc_create_recount_session — próxima rodada (2ª/3ª contagem), só com os
-- itens divergentes do pai. Copia erp_quantity_snapshot do pai (nunca relê o
-- ERP) e nasce já in_progress (a rodada em si é cega desde o início).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_create_recount_session(
  p_parent_session_id uuid,
  p_responsible_id     uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company        text;
  v_parent          physical_count_sessions%ROWTYPE;
  v_new_session_id  uuid;
  v_inserted        integer;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  SELECT * INTO v_parent FROM physical_count_sessions WHERE id = p_parent_session_id FOR UPDATE;

  IF v_parent.id IS NULL THEN
    RAISE EXCEPTION 'Parent session not found';
  END IF;
  IF v_parent.company_id::text <> v_company THEN
    RAISE EXCEPTION 'Parent session belongs to another company';
  END IF;
  IF v_parent.status NOT IN ('completed','with_divergences') THEN
    RAISE EXCEPTION 'Parent session must be finalized before creating a recount';
  END IF;
  IF v_parent.count_number >= 3 THEN
    RAISE EXCEPTION 'Maximum of 3 counting rounds reached';
  END IF;

  INSERT INTO physical_count_sessions (
    company_id, root_session_id, linked_session_id, count_number,
    warehouse, area, street_from, street_to, responsible_id, observation, status,
    started_at, started_by
  ) VALUES (
    v_parent.company_id, v_parent.root_session_id, v_parent.id, v_parent.count_number + 1,
    v_parent.warehouse, v_parent.area, v_parent.street_from, v_parent.street_to,
    coalesce(p_responsible_id, v_parent.responsible_id), v_parent.observation, 'in_progress',
    now(), auth.uid()
  )
  RETURNING id INTO v_new_session_id;

  INSERT INTO physical_count_items (
    session_id, company_id, product_id, sku, ean, location,
    erp_quantity_snapshot, erp_source, erp_sync_ref
  )
  SELECT v_new_session_id, company_id, product_id, sku, ean, location,
         erp_quantity_snapshot, erp_source, erp_sync_ref
  FROM physical_count_items
  WHERE session_id = p_parent_session_id AND result_status <> 'ok';

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RAISE EXCEPTION 'Parent session has no divergent items to recount';
  END IF;

  UPDATE physical_count_sessions SET total_items = v_inserted, updated_at = now() WHERE id = v_new_session_id;

  RETURN v_new_session_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_create_recount_session(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_create_recount_session(uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- pc_reopen_session — manager/admin/owner, nunca apaga contagens (igual a
-- nfe_reopen_conference).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_reopen_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_role         text;
  v_sess_company uuid;
  v_status       text;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;
  IF v_role NOT IN ('owner','admin','manager') THEN
    RAISE EXCEPTION 'Only manager or admin can reopen a session';
  END IF;

  SELECT company_id, status INTO v_sess_company, v_status
  FROM physical_count_sessions WHERE id = p_session_id FOR UPDATE;

  IF v_sess_company IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_sess_company::text <> v_company THEN
    RAISE EXCEPTION 'Session belongs to another company';
  END IF;
  IF v_status NOT IN ('completed','with_divergences') THEN
    RAISE EXCEPTION 'Only a finalized session can be reopened';
  END IF;

  UPDATE physical_count_sessions
  SET status = 'in_progress', finished_at = NULL, finished_by = NULL, updated_at = now()
  WHERE id = p_session_id;

  UPDATE physical_count_items
  SET result_status = NULL, updated_at = now()
  WHERE session_id = p_session_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_reopen_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_reopen_session(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- pc_approve_session — manager/admin/owner, aprovação humana antes do sync
-- ERP (igual ao padrão de CrossCheckPanel/inventory_count_records).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_approve_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_role         text;
  v_sess_company uuid;
  v_status       text;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;
  IF v_role NOT IN ('owner','admin','manager') THEN
    RAISE EXCEPTION 'Only manager or admin can approve a session';
  END IF;

  SELECT company_id, status INTO v_sess_company, v_status
  FROM physical_count_sessions WHERE id = p_session_id FOR UPDATE;

  IF v_sess_company IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_sess_company::text <> v_company THEN
    RAISE EXCEPTION 'Session belongs to another company';
  END IF;
  IF v_status NOT IN ('completed','with_divergences') THEN
    RAISE EXCEPTION 'Only a finalized session can be approved';
  END IF;

  UPDATE physical_count_sessions
  SET approved_by = auth.uid(), approved_at = now(), updated_at = now()
  WHERE id = p_session_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_approve_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_approve_session(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- pc_record_erp_sync_event — chamada pela Edge Function erp-sync (JWT do
-- usuário, nunca service_role). Revalida role + aprovação no servidor, nunca
-- confia apenas na checagem da Edge Function.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_record_erp_sync_event(
  p_session_id        uuid,
  p_item_id           uuid,
  p_product_id        uuid,
  p_sku               text,
  p_provider          text,
  p_previous_quantity numeric,
  p_final_quantity    numeric,
  p_adjustment        numeric,
  p_request_payload   jsonb,
  p_response_payload  jsonb,
  p_success           boolean,
  p_pending           boolean,
  p_error_message     text,
  p_idempotency_key   uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_role         text;
  v_sess_company uuid;
  v_approved_at  timestamptz;
  v_event_id     uuid;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Only owner or admin can record an ERP sync event';
  END IF;

  SELECT company_id, approved_at INTO v_sess_company, v_approved_at
  FROM physical_count_sessions WHERE id = p_session_id;

  IF v_sess_company IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_sess_company::text <> v_company THEN
    RAISE EXCEPTION 'Session belongs to another company';
  END IF;
  IF v_approved_at IS NULL THEN
    RAISE EXCEPTION 'Session must be approved before syncing to ERP';
  END IF;

  INSERT INTO erp_sync_events (
    company_id, session_id, item_id, product_id, sku, provider,
    previous_quantity, final_quantity, adjustment,
    request_payload, response_payload, success, pending, error_message,
    idempotency_key, created_by
  ) VALUES (
    v_sess_company, p_session_id, p_item_id, p_product_id, p_sku, p_provider,
    p_previous_quantity, p_final_quantity, p_adjustment,
    p_request_payload, p_response_payload, p_success, p_pending, p_error_message,
    p_idempotency_key, auth.uid()
  )
  ON CONFLICT (idempotency_key) DO UPDATE SET id = erp_sync_events.id
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_record_erp_sync_event(
  uuid, uuid, uuid, text, text, numeric, numeric, numeric, jsonb, jsonb, boolean, boolean, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_record_erp_sync_event(
  uuid, uuid, uuid, text, text, numeric, numeric, numeric, jsonb, jsonb, boolean, boolean, text, uuid
) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- physical_count_final_result_v — pivot por SKU das até 3 rodadas de uma
-- mesma contagem (seção 18). A derivação de "quantidade final/diferença/
-- status final" fica no algoritmo puro do frontend (physicalCountAlgorithm.ts),
-- não aqui, para não duplicar regra de negócio em duas linguagens.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW physical_count_final_result_v
WITH (security_invoker = true) AS
SELECT
  s.root_session_id,
  MAX(s.company_id::text)                                              AS company_id,
  i.product_id,
  MAX(i.sku)                                                            AS sku,
  MAX(i.ean)                                                            AS ean,
  MAX(i.location)                                                      AS location,
  MAX(i.erp_quantity_snapshot)                                          AS erp_quantity_snapshot,
  MAX(CASE WHEN s.count_number = 1 THEN i.physical_quantity END)        AS count_1,
  MAX(CASE WHEN s.count_number = 2 THEN i.physical_quantity END)        AS count_2,
  MAX(CASE WHEN s.count_number = 3 THEN i.physical_quantity END)        AS count_3,
  MAX(CASE WHEN s.count_number = 1 THEN s.approved_at END) IS NOT NULL
    OR MAX(CASE WHEN s.count_number = 2 THEN s.approved_at END) IS NOT NULL
    OR MAX(CASE WHEN s.count_number = 3 THEN s.approved_at END) IS NOT NULL AS any_round_approved
FROM physical_count_items i
JOIN physical_count_sessions s ON s.id = i.session_id
GROUP BY s.root_session_id, i.product_id;
