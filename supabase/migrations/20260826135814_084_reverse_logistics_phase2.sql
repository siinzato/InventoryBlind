-- Logística Reversa — Fase 2: checklists configuráveis, grades de condição, sugestão de
-- destinação, aprovações, assistência técnica/recondicionamento, quarentena, operação em lote.
-- Aditiva sobre a migration 083. company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid
-- REFERENCES companies(id) ON DELETE CASCADE em toda tabela nova (convenção operacional).

-- ============================================================================
-- 1. CHECKLISTS CONFIGURÁVEIS
-- ============================================================================

CREATE TABLE return_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  category text,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  reason text,
  min_value numeric,
  max_value numeric,
  inspection_type text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX return_checklist_templates_company_idx ON return_checklist_templates(company_id);
CREATE INDEX return_checklist_templates_company_active_idx ON return_checklist_templates(company_id, active);

ALTER TABLE return_checklist_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY return_checklist_templates_select ON return_checklist_templates
  FOR SELECT TO authenticated USING (company_id::text = get_my_company_id());
CREATE POLICY return_checklist_templates_insert ON return_checklist_templates
  FOR INSERT TO authenticated WITH CHECK (company_id::text = get_my_company_id());
CREATE POLICY return_checklist_templates_update ON return_checklist_templates
  FOR UPDATE TO authenticated USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

CREATE TABLE return_checklist_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES return_checklist_templates(id) ON DELETE CASCADE,
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  order_index integer NOT NULL DEFAULT 0,
  label text NOT NULL,
  response_type text NOT NULL CHECK (response_type IN ('boolean','select','text','number','photo')),
  options jsonb,
  required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX return_checklist_template_items_template_idx ON return_checklist_template_items(template_id);

ALTER TABLE return_checklist_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY return_checklist_template_items_select ON return_checklist_template_items
  FOR SELECT TO authenticated USING (company_id::text = get_my_company_id());
CREATE POLICY return_checklist_template_items_insert ON return_checklist_template_items
  FOR INSERT TO authenticated WITH CHECK (company_id::text = get_my_company_id());
CREATE POLICY return_checklist_template_items_update ON return_checklist_template_items
  FOR UPDATE TO authenticated USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

ALTER TABLE return_items
  ADD COLUMN checklist_template_id uuid REFERENCES return_checklist_templates(id) ON DELETE SET NULL,
  ADD COLUMN checklist_template_version integer,
  ADD COLUMN condition_grade_id uuid,
  ADD COLUMN suggested_destination text,
  ADD COLUMN suggested_destination_rule_id uuid;

-- Respostas do checklist configurável — imutáveis (uma correção grava novas linhas, nunca
-- sobrescreve; a RPC de inspeção sempre insere um novo conjunto vinculado ao inspected_at atual).
CREATE TABLE return_item_checklist_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_item_id uuid NOT NULL REFERENCES return_items(id) ON DELETE CASCADE,
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  template_item_id uuid NOT NULL REFERENCES return_checklist_template_items(id) ON DELETE CASCADE,
  value_boolean boolean,
  value_text text,
  value_number numeric,
  value_select text,
  photo_path text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX return_item_checklist_responses_item_idx ON return_item_checklist_responses(return_item_id);

ALTER TABLE return_item_checklist_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY return_item_checklist_responses_select ON return_item_checklist_responses
  FOR SELECT TO authenticated USING (company_id::text = get_my_company_id());
-- Sem policy de INSERT direta: só a RPC return_items_set_inspection (SECURITY DEFINER) grava,
-- garantindo que cada inspeção grava um conjunto novo e nunca sobrescreve o anterior.

-- ============================================================================
-- 2. GRADES DE CONDIÇÃO CONFIGURÁVEIS
-- ============================================================================

CREATE TABLE return_condition_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  description text,
  criteria text[],
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

ALTER TABLE return_items
  ADD CONSTRAINT return_items_condition_grade_fk FOREIGN KEY (condition_grade_id)
    REFERENCES return_condition_grades(id) ON DELETE SET NULL;

ALTER TABLE return_condition_grades ENABLE ROW LEVEL SECURITY;

CREATE POLICY return_condition_grades_select ON return_condition_grades
  FOR SELECT TO authenticated USING (company_id::text = get_my_company_id());
CREATE POLICY return_condition_grades_insert ON return_condition_grades
  FOR INSERT TO authenticated WITH CHECK (company_id::text = get_my_company_id());
CREATE POLICY return_condition_grades_update ON return_condition_grades
  FOR UPDATE TO authenticated USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- ============================================================================
-- 3. REGRAS DE SUGESTÃO DE DESTINAÇÃO (só sugerem — decisão final continua manual/auditável)
-- ============================================================================

CREATE TABLE return_destination_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  condition_grade_id uuid REFERENCES return_condition_grades(id) ON DELETE SET NULL,
  category text,
  reason text,
  min_value numeric,
  max_value numeric,
  requires_warranty boolean,
  requires_accessories boolean,
  defect_reported text,
  suggested_destination text NOT NULL CHECK (suggested_destination IN
    ('restock','quarantine','damaged_stock','technical_assistance','refurbishment','return_to_supplier','discard')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX return_destination_rules_company_idx ON return_destination_rules(company_id, active, priority);

ALTER TABLE return_items
  ADD CONSTRAINT return_items_suggested_destination_rule_fk FOREIGN KEY (suggested_destination_rule_id)
    REFERENCES return_destination_rules(id) ON DELETE SET NULL,
  ADD CONSTRAINT return_items_suggested_destination_check CHECK (suggested_destination IS NULL OR suggested_destination IN
    ('restock','quarantine','damaged_stock','technical_assistance','refurbishment','return_to_supplier','discard'));

ALTER TABLE return_destination_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY return_destination_rules_select ON return_destination_rules
  FOR SELECT TO authenticated USING (company_id::text = get_my_company_id());
CREATE POLICY return_destination_rules_insert ON return_destination_rules
  FOR INSERT TO authenticated WITH CHECK (company_id::text = get_my_company_id());
CREATE POLICY return_destination_rules_update ON return_destination_rules
  FOR UPDATE TO authenticated USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- Registro da sugestão calculada no cliente é um UPDATE comum (não é decisão, só rastro) — só
-- os dois campos suggested_* podem mudar por essa via, a decisão real continua exclusiva da RPC
-- return_items_decide_destination. Reaproveita a policy de UPDATE já existente em return_items
-- (migration 083), sem necessidade de nova policy.

-- ============================================================================
-- 4. APROVAÇÕES CONFIGURÁVEIS (restritas à logística reversa)
-- ============================================================================

CREATE TABLE return_approval_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  require_approval_discard boolean NOT NULL DEFAULT false,
  require_approval_restock boolean NOT NULL DEFAULT false,
  high_value_threshold numeric,
  require_approval_high_value boolean NOT NULL DEFAULT false,
  require_approval_serial_mismatch boolean NOT NULL DEFAULT false,
  require_approval_checklist_exception boolean NOT NULL DEFAULT false,
  require_approval_destination_change boolean NOT NULL DEFAULT false,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE return_approval_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY return_approval_settings_select ON return_approval_settings
  FOR SELECT TO authenticated USING (company_id::text = get_my_company_id());
CREATE POLICY return_approval_settings_insert ON return_approval_settings
  FOR INSERT TO authenticated WITH CHECK (company_id::text = get_my_company_id());
CREATE POLICY return_approval_settings_update ON return_approval_settings
  FOR UPDATE TO authenticated USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

CREATE TABLE return_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  return_item_id uuid NOT NULL REFERENCES return_items(id) ON DELETE CASCADE,
  approval_type text NOT NULL CHECK (approval_type IN
    ('discard','high_value','restock','serial_mismatch','checklist_exception','destination_change')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by uuid DEFAULT auth.uid(),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  notes text
);

CREATE UNIQUE INDEX return_approval_requests_pending_idx
  ON return_approval_requests(return_item_id, approval_type) WHERE status = 'pending';
CREATE INDEX return_approval_requests_company_idx ON return_approval_requests(company_id, status);

ALTER TABLE return_approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY return_approval_requests_select ON return_approval_requests
  FOR SELECT TO authenticated USING (company_id::text = get_my_company_id());
-- Sem policy de INSERT/UPDATE: só as RPCs return_items_request_approval /
-- return_items_decide_approval escrevem (garante o índice único parcial e o gate de papel).

-- ============================================================================
-- 5. ASSISTÊNCIA TÉCNICA / RECONDICIONAMENTO
-- ============================================================================

CREATE TABLE return_service_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  return_item_id uuid NOT NULL REFERENCES return_items(id) ON DELETE CASCADE,
  service_type text NOT NULL CHECK (service_type IN ('technical_assistance','refurbishment')),
  responsible text,
  location_internal text,
  external_provider text,
  defect_identified text,
  parts_services_expected text,
  estimated_cost numeric,
  deadline date,
  status text NOT NULL DEFAULT 'awaiting_analysis' CHECK (status IN
    ('awaiting_analysis','in_service','awaiting_part','completed','no_repair','cancelled')),
  result_notes text,
  status_changed_by uuid,
  status_changed_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX return_service_orders_item_idx ON return_service_orders(return_item_id);
CREATE INDEX return_service_orders_company_status_idx ON return_service_orders(company_id, status);

ALTER TABLE return_service_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY return_service_orders_select ON return_service_orders
  FOR SELECT TO authenticated USING (company_id::text = get_my_company_id());
CREATE POLICY return_service_orders_insert ON return_service_orders
  FOR INSERT TO authenticated WITH CHECK (company_id::text = get_my_company_id());
-- UPDATE só via RPC return_service_orders_transition_status (trava de estado + auditoria).

-- ============================================================================
-- 6. QUARENTENA
-- ============================================================================

CREATE TABLE return_quarantine_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  return_item_id uuid NOT NULL REFERENCES return_items(id) ON DELETE CASCADE,
  location text,
  block_reason text NOT NULL,
  responsible text,
  review_deadline date,
  pending_notes text,
  released_at timestamptz,
  released_by uuid,
  released_reason text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX return_quarantine_holds_open_idx
  ON return_quarantine_holds(return_item_id) WHERE released_at IS NULL;
CREATE INDEX return_quarantine_holds_company_idx ON return_quarantine_holds(company_id);

ALTER TABLE return_quarantine_holds ENABLE ROW LEVEL SECURITY;

CREATE POLICY return_quarantine_holds_select ON return_quarantine_holds
  FOR SELECT TO authenticated USING (company_id::text = get_my_company_id());
CREATE POLICY return_quarantine_holds_insert ON return_quarantine_holds
  FOR INSERT TO authenticated WITH CHECK (company_id::text = get_my_company_id());
-- Liberação (released_*) só via RPC return_items_release_quarantine.

-- ============================================================================
-- 7. LEDGER: permitir 1 movimentação transitória (assistência/recondicionamento) além da final
-- ============================================================================

ALTER TABLE return_stock_movements ADD COLUMN is_transitional boolean NOT NULL DEFAULT false;

DROP INDEX IF EXISTS return_stock_movements_item_idx;
CREATE UNIQUE INDEX return_stock_movements_final_item_idx
  ON return_stock_movements(return_item_id) WHERE NOT is_transitional;

-- destination_status ganha o valor 'in_treatment' (item saiu para assistência/recondicionamento
-- e ainda não tem destinação final).
ALTER TABLE return_items DROP CONSTRAINT IF EXISTS return_items_destination_status_check;
ALTER TABLE return_items ADD CONSTRAINT return_items_destination_status_check
  CHECK (destination_status IN ('pending','moved','in_treatment'));

-- ============================================================================
-- RPCs
-- ============================================================================

-- return_items_set_inspection: mesmo comportamento da Fase 1, com 1 parâmetro novo opcional
-- (retrocompatível — chamadas antigas sem p_condition_grade_id continuam funcionando).
CREATE OR REPLACE FUNCTION return_items_set_inspection(
  p_item_id uuid,
  p_checklist_correct_product boolean,
  p_checklist_packaging_intact boolean,
  p_checklist_no_visible_damage boolean,
  p_checklist_apparently_functional boolean,
  p_checklist_accessories_complete boolean,
  p_checklist_signs_of_use boolean,
  p_checklist_serial_matches boolean,
  p_classification text,
  p_reason text DEFAULT NULL,
  p_condition_grade_id uuid DEFAULT NULL
)
RETURNS return_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company           text;
  v_role              text;
  v_item_company      uuid;
  v_return_id         uuid;
  v_ret_status        text;
  v_already_inspected boolean;
  v_reason            text;
  v_result            return_items%ROWTYPE;
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

  IF p_condition_grade_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM return_condition_grades WHERE id = p_condition_grade_id AND company_id::text = v_company
  ) THEN
    RAISE EXCEPTION 'Grade de condição inválida.';
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
    condition_grade_id              = p_condition_grade_id,
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
    jsonb_build_object('itemId', p_item_id, 'classification', p_classification, 'conditionGradeId', p_condition_grade_id, 'correction', v_already_inspected, 'reason', NULLIF(v_reason, ''))
  );

  RETURN v_result;
END;
$$;

-- return_items_decide_destination: mesmo comportamento da Fase 1 para o caminho default (nenhuma
-- config de aprovação ativa, nenhum hold aberto, destino final comum) — acrescenta: bloqueio por
-- aprovação pendente configurada, bloqueio por quarentena aberta, e o caminho transitório de
-- assistência/recondicionamento (destination_status='in_treatment' em vez de 'moved', permitindo
-- 1 nova decisão após o tratamento).
CREATE OR REPLACE FUNCTION return_items_decide_destination(
  p_item_id uuid,
  p_destination text,
  p_reason text DEFAULT NULL
)
RETURNS return_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    UPDATE products SET stock_quantity = stock_quantity + v_item.received_quantity, updated_at = now()
    WHERE id = v_item.product_id;
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
    jsonb_build_object('itemId', p_item_id, 'destination', p_destination, 'reason', NULLIF(v_reason, ''), 'transitional', v_is_transitional)
  );

  RETURN v_result;
END;
$$;

-- return_items_request_approval
CREATE OR REPLACE FUNCTION return_items_request_approval(
  p_item_id uuid,
  p_approval_type text,
  p_notes text DEFAULT NULL
)
RETURNS return_approval_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company     text;
  v_role        text;
  v_item_company uuid;
  v_result      return_approval_requests%ROWTYPE;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','lead','counter') THEN
    RAISE EXCEPTION 'Seu papel não permite solicitar aprovação.';
  END IF;
  IF p_approval_type NOT IN ('discard','high_value','restock','serial_mismatch','checklist_exception','destination_change') THEN
    RAISE EXCEPTION 'Tipo de aprovação inválido: %', p_approval_type;
  END IF;

  SELECT company_id INTO v_item_company FROM return_items WHERE id = p_item_id;
  IF v_item_company IS NULL THEN
    RAISE EXCEPTION 'Item de devolução não encontrado.';
  END IF;
  IF v_item_company::text <> v_company THEN
    RAISE EXCEPTION 'Item pertence a outra empresa.';
  END IF;

  INSERT INTO return_approval_requests (company_id, return_item_id, approval_type, notes)
  VALUES (v_item_company, p_item_id, p_approval_type, p_notes)
  RETURNING * INTO v_result;

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_item_company, auth.uid(), coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'reverse_logistics.approval_requested', 'return_items', p_item_id::text,
    'Aprovação solicitada para item de devolução.',
    jsonb_build_object('itemId', p_item_id, 'approvalType', p_approval_type)
  );

  RETURN v_result;
END;
$$;

-- return_items_decide_approval
CREATE OR REPLACE FUNCTION return_items_decide_approval(
  p_request_id uuid,
  p_approved boolean,
  p_reason text DEFAULT NULL
)
RETURNS return_approval_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company  text;
  v_role     text;
  v_req      return_approval_requests%ROWTYPE;
  v_reason   text;
  v_result   return_approval_requests%ROWTYPE;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager') THEN
    RAISE EXCEPTION 'Apenas owner, admin ou manager podem decidir uma aprovação.';
  END IF;

  SELECT * INTO v_req FROM return_approval_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Pedido de aprovação não encontrado.';
  END IF;
  IF v_req.company_id::text <> v_company THEN
    RAISE EXCEPTION 'Pedido pertence a outra empresa.';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Este pedido já foi decidido.';
  END IF;

  v_reason := btrim(coalesce(p_reason, ''));
  IF NOT p_approved AND char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Rejeitar um pedido exige justificativa com pelo menos 5 caracteres.';
  END IF;

  UPDATE return_approval_requests SET
    status         = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
    decided_by     = auth.uid(),
    decided_at     = now(),
    decision_reason = NULLIF(v_reason, '')
  WHERE id = p_request_id
  RETURNING * INTO v_result;

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_req.company_id, auth.uid(), coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    CASE WHEN p_approved THEN 'reverse_logistics.approval_approved' ELSE 'reverse_logistics.approval_rejected' END,
    'return_items', v_req.return_item_id::text,
    'Decisão de aprovação registrada.',
    jsonb_build_object('requestId', p_request_id, 'approvalType', v_req.approval_type, 'approved', p_approved, 'reason', NULLIF(v_reason, ''))
  );

  RETURN v_result;
END;
$$;

-- return_service_orders_transition_status
CREATE OR REPLACE FUNCTION return_service_orders_transition_status(
  p_order_id uuid,
  p_to_status text,
  p_reason text DEFAULT NULL
)
RETURNS return_service_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company text;
  v_role    text;
  v_order   return_service_orders%ROWTYPE;
  v_reason  text;
  v_valid   boolean;
  v_result  return_service_orders%ROWTYPE;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','lead','counter') THEN
    RAISE EXCEPTION 'Seu papel não permite atualizar ordens de assistência/recondicionamento.';
  END IF;

  IF p_to_status NOT IN ('awaiting_analysis','in_service','awaiting_part','completed','no_repair','cancelled') THEN
    RAISE EXCEPTION 'Status inválido: %', p_to_status;
  END IF;

  SELECT * INTO v_order FROM return_service_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Ordem de serviço não encontrada.';
  END IF;
  IF v_order.company_id::text <> v_company THEN
    RAISE EXCEPTION 'Ordem pertence a outra empresa.';
  END IF;
  IF v_order.status IN ('completed','no_repair','cancelled') THEN
    RAISE EXCEPTION 'Esta ordem já está encerrada (status atual: %).', v_order.status;
  END IF;

  v_valid := CASE v_order.status
    WHEN 'awaiting_analysis' THEN p_to_status IN ('in_service','no_repair','cancelled')
    WHEN 'in_service'        THEN p_to_status IN ('awaiting_part','completed','no_repair','cancelled')
    WHEN 'awaiting_part'     THEN p_to_status IN ('in_service','completed','no_repair','cancelled')
    ELSE false
  END;
  IF NOT v_valid THEN
    RAISE EXCEPTION 'Transição inválida: % → %.', v_order.status, p_to_status;
  END IF;

  v_reason := btrim(coalesce(p_reason, ''));
  IF p_to_status IN ('no_repair','cancelled') AND char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Encerrar sem reparo ou cancelar exige justificativa com pelo menos 5 caracteres.';
  END IF;

  UPDATE return_service_orders SET
    status             = p_to_status,
    result_notes       = CASE WHEN p_to_status IN ('completed','no_repair') THEN NULLIF(v_reason, '') ELSE result_notes END,
    status_changed_by  = auth.uid(),
    status_changed_at  = now(),
    updated_at          = now()
  WHERE id = p_order_id
  RETURNING * INTO v_result;

  -- Assistência/recondicionamento concluído (com ou sem reparo): libera o item para nova
  -- decisão de destinação, limpando a sugestão anterior (será recalculada no cliente).
  IF p_to_status IN ('completed','no_repair') THEN
    UPDATE return_items SET
      destination_status            = 'pending',
      suggested_destination         = NULL,
      suggested_destination_rule_id = NULL,
      updated_at                     = now()
    WHERE id = v_order.return_item_id;
  END IF;

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_order.company_id, auth.uid(), coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'reverse_logistics.service_order_status_changed', 'return_items', v_order.return_item_id::text,
    'Status de ordem de assistência/recondicionamento atualizado.',
    jsonb_build_object('orderId', p_order_id, 'from', v_order.status, 'to', p_to_status, 'reason', NULLIF(v_reason, ''))
  );

  RETURN v_result;
END;
$$;

-- return_items_release_quarantine
CREATE OR REPLACE FUNCTION return_items_release_quarantine(
  p_hold_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS return_quarantine_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company text;
  v_role    text;
  v_hold    return_quarantine_holds%ROWTYPE;
  v_reason  text;
  v_result  return_quarantine_holds%ROWTYPE;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager') THEN
    RAISE EXCEPTION 'Apenas owner, admin ou manager podem liberar quarentena.';
  END IF;

  SELECT * INTO v_hold FROM return_quarantine_holds WHERE id = p_hold_id FOR UPDATE;
  IF v_hold.id IS NULL THEN
    RAISE EXCEPTION 'Hold de quarentena não encontrado.';
  END IF;
  IF v_hold.company_id::text <> v_company THEN
    RAISE EXCEPTION 'Hold pertence a outra empresa.';
  END IF;
  IF v_hold.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este hold já foi liberado.';
  END IF;

  v_reason := btrim(coalesce(p_reason, ''));
  IF char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Liberar quarentena exige justificativa com pelo menos 5 caracteres.';
  END IF;

  UPDATE return_quarantine_holds SET
    released_at     = now(),
    released_by     = auth.uid(),
    released_reason = v_reason
  WHERE id = p_hold_id
  RETURNING * INTO v_result;

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_hold.company_id, auth.uid(), coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'reverse_logistics.quarantine_released', 'return_items', v_hold.return_item_id::text,
    'Hold de quarentena liberado.',
    jsonb_build_object('holdId', p_hold_id, 'reason', v_reason)
  );

  RETURN v_result;
END;
$$;

-- return_items_batch_apply: só ações seguras (nunca discard/restock — não aceitos em p_action).
CREATE OR REPLACE FUNCTION return_items_batch_apply(
  p_item_ids uuid[],
  p_action text,
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company  text;
  v_role     text;
  v_item_id  uuid;
  v_count    integer := 0;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','lead','counter') THEN
    RAISE EXCEPTION 'Seu papel não permite ações em lote.';
  END IF;
  IF p_action NOT IN ('assign_responsible','move_to_conference','apply_checklist','send_to_quarantine') THEN
    RAISE EXCEPTION 'Ação em lote inválida ou não permitida: %', p_action;
  END IF;
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Nenhum item selecionado.';
  END IF;

  FOREACH v_item_id IN ARRAY p_item_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM return_items WHERE id = v_item_id AND company_id::text = v_company) THEN
      RAISE EXCEPTION 'Item % não encontrado ou pertence a outra empresa.', v_item_id;
    END IF;

    IF p_action = 'assign_responsible' THEN
      UPDATE return_items SET item_notes = coalesce(item_notes || E'\n', '') ||
        'Responsável atribuído em lote: ' || coalesce(p_params->>'responsible', ''), updated_at = now()
      WHERE id = v_item_id;

    ELSIF p_action = 'move_to_conference' THEN
      UPDATE returns SET status = 'in_conference', status_changed_by = auth.uid(), status_changed_at = now(), updated_at = now()
      WHERE id = (SELECT return_id FROM return_items WHERE id = v_item_id) AND status = 'received';

    ELSIF p_action = 'apply_checklist' THEN
      IF NOT EXISTS (SELECT 1 FROM return_checklist_templates WHERE id = (p_params->>'templateId')::uuid AND company_id::text = v_company) THEN
        RAISE EXCEPTION 'Template de checklist inválido.';
      END IF;
      UPDATE return_items SET
        checklist_template_id = (p_params->>'templateId')::uuid,
        checklist_template_version = (SELECT version FROM return_checklist_templates WHERE id = (p_params->>'templateId')::uuid),
        updated_at = now()
      WHERE id = v_item_id;

    ELSIF p_action = 'send_to_quarantine' THEN
      IF NOT EXISTS (SELECT 1 FROM return_quarantine_holds WHERE return_item_id = v_item_id AND released_at IS NULL) THEN
        INSERT INTO return_quarantine_holds (company_id, return_item_id, location, block_reason, responsible, review_deadline)
        VALUES (v_company::uuid, v_item_id, coalesce(p_params->>'location', 'Quarentena - Devoluções'),
                coalesce(p_params->>'reason', 'Enviado à quarentena em lote'), p_params->>'responsible',
                NULLIF(p_params->>'reviewDeadline', '')::date);
      END IF;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  INSERT INTO audit_logs (
    company_id, user_id, user_email, action, resource_type, resource_id, description, metadata
  ) VALUES (
    v_company::uuid, auth.uid(), coalesce((SELECT email FROM profiles WHERE id = auth.uid()), ''),
    'reverse_logistics.batch_action_applied', 'return_items', NULL,
    'Ação em lote aplicada a itens de devolução.',
    jsonb_build_object('action', p_action, 'itemIds', p_item_ids, 'count', v_count)
  );

  RETURN v_count;
END;
$$;

-- ============================================================================
-- REVOKE / GRANT
-- ============================================================================

REVOKE ALL ON FUNCTION return_items_set_inspection(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION return_items_set_inspection(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION return_items_set_inspection(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION return_items_decide_destination(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION return_items_decide_destination(uuid,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION return_items_decide_destination(uuid,text,text) TO authenticated;

REVOKE ALL ON FUNCTION return_items_request_approval(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION return_items_request_approval(uuid,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION return_items_request_approval(uuid,text,text) TO authenticated;

REVOKE ALL ON FUNCTION return_items_decide_approval(uuid,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION return_items_decide_approval(uuid,boolean,text) FROM anon;
GRANT EXECUTE ON FUNCTION return_items_decide_approval(uuid,boolean,text) TO authenticated;

REVOKE ALL ON FUNCTION return_service_orders_transition_status(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION return_service_orders_transition_status(uuid,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION return_service_orders_transition_status(uuid,text,text) TO authenticated;

REVOKE ALL ON FUNCTION return_items_release_quarantine(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION return_items_release_quarantine(uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION return_items_release_quarantine(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION return_items_batch_apply(uuid[],text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION return_items_batch_apply(uuid[],text,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION return_items_batch_apply(uuid[],text,jsonb) TO authenticated;
