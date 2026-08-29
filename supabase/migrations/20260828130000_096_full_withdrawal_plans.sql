/*
# Retiradas Full — planejamento e acompanhamento (Logística Reversa)

## Summary
Nova área "Retiradas Full" dentro de Logística Reversa: planeja no InventoryBlind a retirada de
estoque parado no centro de fulfillment de um marketplace (hoje só Mercado Livre é oferecido na
tela), acompanha o status até a conferência física do recebimento.

Não existe hoje nenhum conector real da API do Mercado Livre neste projeto (o provider
'mercado_livre' em integration_providers está com status 'planned' desde a migration 042, sem
OAuth, sem client de API, sem consulta de estoque Full) — construir isso é integração externa nova,
fora do escopo desta tarefa. Por isso:
- Não existe coluna de "estoque disponível no Full" nem "antiguidade": esse dado não existe em
  lugar nenhum do banco. A tela mostra o catálogo real de produtos (nome/SKU/EAN/local) e deixa
  claro na interface que o saldo Full ainda depende de confirmação manual.
- A confirmação da retirada acontece no painel do Mercado Livre, nunca aqui — por isso o plano
  entra em 'awaiting_confirmation' e só avança para 'reserved' quando um humano informa o
  identificador real da retirada (full_withdrawal_link_ml), nunca automaticamente.

## New Tables
- full_withdrawal_plans — cabeçalho do plano. Máquina de estados travada por
  full_withdrawal_advance_status (avanço sequencial) e full_withdrawal_link_ml (o único caminho
  para 'reserved', porque exige o identificador real do Mercado Livre).
- full_withdrawal_items — item do plano (produto/SKU + quantidade planejada/confirmada pelo
  Full/recebida). "Confirmada pelo Full" e custo só chegam via full_withdrawal_link_ml/edição
  manual — nunca inventados.
- full_withdrawal_events — linha do tempo/movimentações, só escrita pelas RPCs (mesmo padrão de
  nfe_count_events/return_stock_movements): nenhuma etapa avança só por ação visual do frontend.

## Security
Mesma convenção de returns/return_items (migration 083): company_id uuid + FK companies, RLS
company-scoped SELECT/INSERT/UPDATE para plans/items (edição livre enquanto o plano ainda não
avançou — a disciplina de estado fica no client/RPC, mesmo modelo de confiança já usado em
returns_update). full_withdrawal_events só tem SELECT para authenticated; toda escrita é das RPCs
SECURITY DEFINER.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. full_withdrawal_plans
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS full_withdrawal_plans (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  code                   text NOT NULL DEFAULT (
                           'RFL-' || to_char(now(), 'YYYYMMDD') || '-' ||
                           upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5))
                         ),
  status                 text NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','awaiting_confirmation','reserved','preparing','shipped','received','conferred','cancelled','with_divergence')),
  reason                 text CHECK (reason IN ('low_turnover','excess_stock','discontinued','operational_correction','quality_damage','other')),
  method                 text NOT NULL DEFAULT 'withdraw_and_receive' CHECK (method IN ('withdraw_and_receive','discard')),
  destination_label      text,
  destination_address    text,
  -- Dados que só existem depois de o humano confirmar no painel do Mercado Livre e informar aqui.
  ml_reference           text,
  cost                   numeric,
  cost_note              text,
  expected_delivery_date date,
  notes                  text,
  ml_confirmed_at        timestamptz,
  reserved_at            timestamptz,
  preparing_at           timestamptz,
  shipped_at             timestamptz,
  received_at            timestamptz,
  conferred_at           timestamptz,
  cancellation_reason    text,
  status_changed_by      uuid,
  status_changed_at      timestamptz,
  created_by             uuid DEFAULT auth.uid(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS full_withdrawal_plans_company_code_idx ON full_withdrawal_plans (company_id, code);
CREATE INDEX IF NOT EXISTS full_withdrawal_plans_company_idx             ON full_withdrawal_plans (company_id);
CREATE INDEX IF NOT EXISTS full_withdrawal_plans_company_status_idx      ON full_withdrawal_plans (company_id, status);
CREATE INDEX IF NOT EXISTS full_withdrawal_plans_company_created_idx     ON full_withdrawal_plans (company_id, created_at DESC);

ALTER TABLE full_withdrawal_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "full_withdrawal_plans_select" ON full_withdrawal_plans;
CREATE POLICY "full_withdrawal_plans_select" ON full_withdrawal_plans FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "full_withdrawal_plans_insert" ON full_withdrawal_plans;
CREATE POLICY "full_withdrawal_plans_insert" ON full_withdrawal_plans FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "full_withdrawal_plans_update" ON full_withdrawal_plans;
CREATE POLICY "full_withdrawal_plans_update" ON full_withdrawal_plans FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- Sem policy de DELETE: cancelamento é sempre status='cancelled'.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. full_withdrawal_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS full_withdrawal_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id               uuid NOT NULL REFERENCES full_withdrawal_plans(id) ON DELETE CASCADE,
  company_id            uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  product_id            uuid REFERENCES products(id) ON DELETE SET NULL,
  sku                   text,
  description           text NOT NULL DEFAULT '',
  planned_quantity      numeric NOT NULL CHECK (planned_quantity > 0),
  confirmed_quantity    numeric CHECK (confirmed_quantity IS NULL OR confirmed_quantity >= 0),
  received_quantity     numeric CHECK (received_quantity IS NULL OR received_quantity >= 0),
  situation             text NOT NULL DEFAULT 'pending' CHECK (situation IN ('pending','awaiting_receipt','ok','divergent')),
  divergence_note       text,
  divergence_noted_by   uuid,
  divergence_noted_at   timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS full_withdrawal_items_plan_idx    ON full_withdrawal_items (plan_id);
CREATE INDEX IF NOT EXISTS full_withdrawal_items_company_idx ON full_withdrawal_items (company_id);
CREATE INDEX IF NOT EXISTS full_withdrawal_items_product_idx ON full_withdrawal_items (company_id, product_id);

ALTER TABLE full_withdrawal_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "full_withdrawal_items_select" ON full_withdrawal_items;
CREATE POLICY "full_withdrawal_items_select" ON full_withdrawal_items FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "full_withdrawal_items_insert" ON full_withdrawal_items;
CREATE POLICY "full_withdrawal_items_insert" ON full_withdrawal_items FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "full_withdrawal_items_update" ON full_withdrawal_items;
CREATE POLICY "full_withdrawal_items_update" ON full_withdrawal_items FOR UPDATE
  TO authenticated
  USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. full_withdrawal_events (imutável, só as RPCs escrevem)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS full_withdrawal_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      uuid NOT NULL REFERENCES full_withdrawal_plans(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  event_type   text NOT NULL CHECK (event_type IN (
                 'plan_created','reservation_registered','preparation_started','dispatched',
                 'delivered','conference_completed','cancelled','discarded',
                 'divergence_registered','divergence_justified'
               )),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_by   uuid DEFAULT auth.uid(),
  note         text
);

CREATE INDEX IF NOT EXISTS full_withdrawal_events_plan_idx    ON full_withdrawal_events (plan_id, occurred_at);
CREATE INDEX IF NOT EXISTS full_withdrawal_events_company_idx ON full_withdrawal_events (company_id);

ALTER TABLE full_withdrawal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "full_withdrawal_events_select" ON full_withdrawal_events;
CREATE POLICY "full_withdrawal_events_select" ON full_withdrawal_events FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers (reaproveita update_updated_at_column(), já usada em todo o projeto)
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS full_withdrawal_plans_updated_at ON full_withdrawal_plans;
CREATE TRIGGER full_withdrawal_plans_updated_at
  BEFORE UPDATE ON full_withdrawal_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS full_withdrawal_items_updated_at ON full_withdrawal_items;
CREATE TRIGGER full_withdrawal_items_updated_at
  BEFORE UPDATE ON full_withdrawal_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. full_withdrawal_advance_status — máquina de estados travada
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.full_withdrawal_advance_status(
  p_plan_id   uuid,
  p_to_status text,
  p_note      text DEFAULT NULL
)
RETURNS full_withdrawal_plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company       text;
  v_role          text;
  v_plan_company  uuid;
  v_status        text;
  v_method        text;
  v_reason        text;
  v_pending_items integer;
  v_result        full_withdrawal_plans%ROWTYPE;
  v_event         text;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;

  SELECT company_id, status, method INTO v_plan_company, v_status, v_method
  FROM full_withdrawal_plans WHERE id = p_plan_id FOR UPDATE;

  IF v_plan_company IS NULL THEN
    RAISE EXCEPTION 'Plano de retirada não encontrado.';
  END IF;
  IF v_plan_company::text <> v_company THEN
    RAISE EXCEPTION 'Plano pertence a outra empresa.';
  END IF;

  IF p_to_status NOT IN ('draft','awaiting_confirmation','preparing','shipped','received','conferred','cancelled') THEN
    RAISE EXCEPTION 'Status inválido para esta transição: %', p_to_status;
  END IF;

  IF v_status IN ('conferred','cancelled') THEN
    RAISE EXCEPTION 'Este plano já está em estado final (%) e não aceita novas transições.', v_status;
  END IF;

  IF p_to_status = 'cancelled' THEN
    IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager') THEN
      RAISE EXCEPTION 'Apenas owner, admin ou manager podem cancelar um plano.';
    END IF;
  ELSIF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','lead','counter') THEN
    RAISE EXCEPTION 'Seu papel não permite alterar o status deste plano.';
  END IF;

  -- 'reserved' só é alcançado por full_withdrawal_link_ml (exige o identificador real do ML).
  IF NOT (
    p_to_status = 'cancelled'
    OR (v_status = 'draft' AND p_to_status = 'awaiting_confirmation')
    OR (v_status = 'reserved' AND p_to_status = 'preparing')
    OR (v_status = 'preparing' AND p_to_status = 'shipped')
    OR (v_status = 'shipped' AND p_to_status = 'received')
    OR (v_status IN ('received','with_divergence') AND p_to_status = 'conferred')
  ) THEN
    RAISE EXCEPTION 'Transição inválida: % → %.', v_status, p_to_status;
  END IF;

  v_reason := btrim(coalesce(p_note, ''));
  IF p_to_status = 'cancelled' AND char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Cancelar exige uma justificativa com pelo menos 5 caracteres.';
  END IF;

  IF p_to_status = 'conferred' THEN
    SELECT count(*) INTO v_pending_items
    FROM full_withdrawal_items
    WHERE plan_id = p_plan_id AND situation = 'divergent' AND divergence_note IS NULL;

    IF v_pending_items > 0 THEN
      RAISE EXCEPTION 'Ainda há % item(ns) com divergência sem justificativa — não é possível concluir a conferência.', v_pending_items;
    END IF;
  END IF;

  UPDATE full_withdrawal_plans
  SET status = p_to_status,
      status_changed_by = auth.uid(),
      status_changed_at = now(),
      preparing_at = CASE WHEN p_to_status = 'preparing' THEN now() ELSE preparing_at END,
      shipped_at   = CASE WHEN p_to_status = 'shipped'   THEN now() ELSE shipped_at   END,
      received_at  = CASE WHEN p_to_status = 'received'  THEN now() ELSE received_at  END,
      conferred_at = CASE WHEN p_to_status = 'conferred' THEN now() ELSE conferred_at END,
      cancellation_reason = CASE WHEN p_to_status = 'cancelled' THEN v_reason ELSE cancellation_reason END,
      updated_at = now()
  WHERE id = p_plan_id
  RETURNING * INTO v_result;

  v_event := CASE p_to_status
    WHEN 'preparing' THEN 'preparation_started'
    WHEN 'shipped'    THEN 'dispatched'
    WHEN 'received'   THEN 'delivered'
    WHEN 'conferred'  THEN CASE WHEN v_method = 'discard' THEN 'discarded' ELSE 'conference_completed' END
    WHEN 'cancelled'  THEN 'cancelled'
    ELSE NULL
  END;

  IF v_event IS NOT NULL THEN
    INSERT INTO full_withdrawal_events (plan_id, company_id, event_type, created_by, note)
    VALUES (p_plan_id, v_plan_company, v_event, auth.uid(), NULLIF(v_reason, ''));
  END IF;

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_plan_company,
    auth.uid(),
    coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'reverse_logistics.full_withdrawal_status_changed',
    'full_withdrawal_plans',
    p_plan_id::text,
    'Status do plano de retirada Full alterado.',
    jsonb_build_object('from', v_status, 'to', p_to_status, 'note', NULLIF(v_reason, ''))
  );

  RETURN v_result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.full_withdrawal_advance_status(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.full_withdrawal_advance_status(uuid, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.full_withdrawal_advance_status(uuid, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. full_withdrawal_link_ml — o único caminho para 'reserved'
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.full_withdrawal_link_ml(
  p_plan_id               uuid,
  p_ml_reference          text,
  p_cost                  numeric DEFAULT NULL,
  p_expected_delivery_date date DEFAULT NULL
)
RETURNS full_withdrawal_plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_role         text;
  v_plan_company uuid;
  v_status       text;
  v_reference    text;
  v_first_link   boolean;
  v_result       full_withdrawal_plans%ROWTYPE;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','lead','counter') THEN
    RAISE EXCEPTION 'Seu papel não permite vincular a retirada do Mercado Livre.';
  END IF;

  v_reference := btrim(coalesce(p_ml_reference, ''));
  IF char_length(v_reference) < 3 THEN
    RAISE EXCEPTION 'Informe o identificador real da retirada no Mercado Livre.';
  END IF;

  SELECT company_id, status INTO v_plan_company, v_status
  FROM full_withdrawal_plans WHERE id = p_plan_id FOR UPDATE;

  IF v_plan_company IS NULL THEN
    RAISE EXCEPTION 'Plano de retirada não encontrado.';
  END IF;
  IF v_plan_company::text <> v_company THEN
    RAISE EXCEPTION 'Plano pertence a outra empresa.';
  END IF;
  IF v_status NOT IN ('awaiting_confirmation','reserved') THEN
    RAISE EXCEPTION 'Só é possível vincular a retirada do Mercado Livre a partir de "Aguardando confirmação".';
  END IF;

  v_first_link := (v_status = 'awaiting_confirmation');

  UPDATE full_withdrawal_plans
  SET status = 'reserved',
      ml_reference = v_reference,
      ml_confirmed_at = coalesce(ml_confirmed_at, now()),
      reserved_at = coalesce(reserved_at, now()),
      cost = coalesce(p_cost, cost),
      expected_delivery_date = coalesce(p_expected_delivery_date, expected_delivery_date),
      status_changed_by = auth.uid(),
      status_changed_at = now(),
      updated_at = now()
  WHERE id = p_plan_id
  RETURNING * INTO v_result;

  IF v_first_link THEN
    INSERT INTO full_withdrawal_events (plan_id, company_id, event_type, created_by, note)
    VALUES (p_plan_id, v_plan_company, 'reservation_registered', auth.uid(), v_reference);
  END IF;

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_plan_company, auth.uid(), coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'reverse_logistics.full_withdrawal_linked_ml', 'full_withdrawal_plans', p_plan_id::text,
    'Retirada do Mercado Livre vinculada ao plano.',
    jsonb_build_object('mlReference', v_reference)
  );

  RETURN v_result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.full_withdrawal_link_ml(uuid, text, numeric, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.full_withdrawal_link_ml(uuid, text, numeric, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.full_withdrawal_link_ml(uuid, text, numeric, date) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. full_withdrawal_conference_item — registra a contagem física (nunca pré-preenchida)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.full_withdrawal_conference_item(
  p_item_id           uuid,
  p_received_quantity numeric,
  p_note              text DEFAULT NULL
)
RETURNS full_withdrawal_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company        text;
  v_role           text;
  v_item_company   uuid;
  v_plan_id        uuid;
  v_plan_status    text;
  v_planned        numeric;
  v_confirmed      numeric;
  v_reference_qty  numeric;
  v_situation      text;
  v_result         full_withdrawal_items%ROWTYPE;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','lead','counter') THEN
    RAISE EXCEPTION 'Seu papel não permite registrar a conferência.';
  END IF;
  IF p_received_quantity < 0 THEN
    RAISE EXCEPTION 'Quantidade recebida não pode ser negativa.';
  END IF;

  SELECT company_id, plan_id, planned_quantity, confirmed_quantity INTO v_item_company, v_plan_id, v_planned, v_confirmed
  FROM full_withdrawal_items WHERE id = p_item_id FOR UPDATE;

  IF v_item_company IS NULL THEN
    RAISE EXCEPTION 'Item do plano não encontrado.';
  END IF;
  IF v_item_company::text <> v_company THEN
    RAISE EXCEPTION 'Item pertence a outra empresa.';
  END IF;

  SELECT status INTO v_plan_status FROM full_withdrawal_plans WHERE id = v_plan_id FOR UPDATE;
  IF v_plan_status NOT IN ('received','with_divergence') THEN
    RAISE EXCEPTION 'A conferência só pode ser registrada depois que a retirada estiver marcada como recebida.';
  END IF;

  v_reference_qty := coalesce(v_confirmed, v_planned);
  v_situation := CASE WHEN p_received_quantity = v_reference_qty THEN 'ok' ELSE 'divergent' END;

  UPDATE full_withdrawal_items
  SET received_quantity = p_received_quantity,
      situation = v_situation,
      divergence_note = CASE WHEN v_situation = 'divergent' THEN NULL ELSE divergence_note END,
      divergence_noted_by = CASE WHEN v_situation = 'divergent' THEN NULL ELSE divergence_noted_by END,
      divergence_noted_at = CASE WHEN v_situation = 'divergent' THEN NULL ELSE divergence_noted_at END,
      updated_at = now()
  WHERE id = p_item_id
  RETURNING * INTO v_result;

  IF v_situation = 'divergent' THEN
    UPDATE full_withdrawal_plans SET status = 'with_divergence', updated_at = now()
    WHERE id = v_plan_id AND status <> 'with_divergence';

    INSERT INTO full_withdrawal_events (plan_id, company_id, event_type, created_by, note)
    VALUES (v_plan_id, v_item_company, 'divergence_registered', auth.uid(),
            coalesce(NULLIF(btrim(coalesce(p_note, '')), ''),
                     format('Planejado/confirmado %s, recebido %s', v_reference_qty, p_received_quantity)));
  END IF;

  RETURN v_result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.full_withdrawal_conference_item(uuid, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.full_withdrawal_conference_item(uuid, numeric, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.full_withdrawal_conference_item(uuid, numeric, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. full_withdrawal_justify_divergence — desbloqueia a conclusão da conferência
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.full_withdrawal_justify_divergence(
  p_item_id uuid,
  p_note    text
)
RETURNS full_withdrawal_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_role         text;
  v_item_company uuid;
  v_plan_id      uuid;
  v_situation    text;
  v_note         text;
  v_result       full_withdrawal_items%ROWTYPE;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','lead','counter') THEN
    RAISE EXCEPTION 'Seu papel não permite justificar esta divergência.';
  END IF;

  v_note := btrim(coalesce(p_note, ''));
  IF char_length(v_note) < 5 THEN
    RAISE EXCEPTION 'A justificativa precisa ter pelo menos 5 caracteres.';
  END IF;

  SELECT company_id, plan_id, situation INTO v_item_company, v_plan_id, v_situation
  FROM full_withdrawal_items WHERE id = p_item_id FOR UPDATE;

  IF v_item_company IS NULL THEN
    RAISE EXCEPTION 'Item do plano não encontrado.';
  END IF;
  IF v_item_company::text <> v_company THEN
    RAISE EXCEPTION 'Item pertence a outra empresa.';
  END IF;
  IF v_situation <> 'divergent' THEN
    RAISE EXCEPTION 'Este item não está com divergência registrada.';
  END IF;

  UPDATE full_withdrawal_items
  SET divergence_note = v_note, divergence_noted_by = auth.uid(), divergence_noted_at = now(), updated_at = now()
  WHERE id = p_item_id
  RETURNING * INTO v_result;

  INSERT INTO full_withdrawal_events (plan_id, company_id, event_type, created_by, note)
  VALUES (v_plan_id, v_item_company, 'divergence_justified', auth.uid(), v_note);

  RETURN v_result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.full_withdrawal_justify_divergence(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.full_withdrawal_justify_divergence(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.full_withdrawal_justify_divergence(uuid, text) TO authenticated;
