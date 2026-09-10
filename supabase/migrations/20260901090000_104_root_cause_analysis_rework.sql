/*
# Root Cause Analysis — reformulação (Fase 1)

## Summary
O módulo de RCA (migration 033) existia só como classificação plana de causa
(`rca_records`) + um Q&A de "5 Porquês" fixo em 5 níveis
(`rca_five_whys_sessions`/`rca_five_whys_answers`). As três tabelas estão
vazias em produção (verificado antes desta migration) — não há dado
histórico para preservar/remapear, então o schema evolui livremente.

Esta migration:
1. Torna `rca_records` a "classificação inicial" (leve): separa processo
   afetado de categoria de causa (antes misturados no mesmo enum), adiciona
   severidade, contenção, recorrência conhecida, impacto financeiro e um
   status de classificação pendente (fila de regularização).
2. Adiciona taxonomia de causa configurável por workspace
   (`rca_cause_categories`/`rca_cause_subcauses`), com padrões que ficam no
   client (mesmo espírito de `rca_settings`/`getSettings`) — a tabela só
   guarda desativação de um padrão ou uma categoria/subcausa customizada.
3. Cria o Caso de RCA completo (`rca_cases`), a cadeia de Porquês de
   profundidade variável (`rca_case_why_steps`, substituindo o Q&A fixo de 5
   níveis) e o plano de ação fino (`rca_case_actions`, que aponta para uma
   Tarefa real em `tasks` — reaproveita responsável/prazo/status/anexo/
   notificação já existentes em vez de duplicar um gerenciador).
4. Estende `rca_evidence` para evidência estruturada (tipo/origem/referência
   ao registro original), podendo vincular a um caso ou a uma etapa da
   cadeia, não só a uma classificação.

`rca_five_whys_sessions`/`rca_five_whys_answers` (migration 033) não são
alteradas nem removidas — ficam sem uso na nova UI (papel absorvido por
`rca_case_why_steps`), preservando o objeto caso outra sessão dependa dele.

## Security
Mesmo padrão de 033: leitura/escrita operacional (classificar, responder
Porquê, criar ação, registrar evidência) aberta a qualquer autenticado da
empresa; ações sensíveis (confirmar causa raiz, mudar status do caso,
configurar taxonomia, configurações de escalonamento) restritas a
owner/admin/manager. Nenhuma tabela permite DELETE de categoria/subcausa —
só desativação (`is_active`), preservando histórico.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Taxonomia de causa configurável por workspace
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rca_cause_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  text NOT NULL DEFAULT get_my_company_id(),
  code        text NOT NULL,
  label       text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS rca_cause_categories_company_idx ON rca_cause_categories (company_id);

ALTER TABLE rca_cause_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rca_cause_categories_select" ON rca_cause_categories;
CREATE POLICY "rca_cause_categories_select" ON rca_cause_categories FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_cause_categories_insert" ON rca_cause_categories;
CREATE POLICY "rca_cause_categories_insert" ON rca_cause_categories FOR INSERT
  TO authenticated WITH CHECK (
    company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager'])
  );

DROP POLICY IF EXISTS "rca_cause_categories_update" ON rca_cause_categories;
CREATE POLICY "rca_cause_categories_update" ON rca_cause_categories FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

CREATE TABLE IF NOT EXISTS rca_cause_subcauses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     text NOT NULL DEFAULT get_my_company_id(),
  category_code  text NOT NULL,
  code           text NOT NULL,
  label          text NOT NULL,
  is_default     boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz DEFAULT now(),
  UNIQUE (company_id, category_code, code)
);
CREATE INDEX IF NOT EXISTS rca_cause_subcauses_company_idx ON rca_cause_subcauses (company_id);
CREATE INDEX IF NOT EXISTS rca_cause_subcauses_category_idx ON rca_cause_subcauses (category_code);

ALTER TABLE rca_cause_subcauses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rca_cause_subcauses_select" ON rca_cause_subcauses;
CREATE POLICY "rca_cause_subcauses_select" ON rca_cause_subcauses FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_cause_subcauses_insert" ON rca_cause_subcauses;
CREATE POLICY "rca_cause_subcauses_insert" ON rca_cause_subcauses FOR INSERT
  TO authenticated WITH CHECK (
    company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager'])
  );

DROP POLICY IF EXISTS "rca_cause_subcauses_update" ON rca_cause_subcauses;
CREATE POLICY "rca_cause_subcauses_update" ON rca_cause_subcauses FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. rca_records — classificação inicial: separa processo × causa, adiciona
--    severidade/contenção/recorrência/impacto financeiro/status pendente.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE rca_records
  DROP CONSTRAINT IF EXISTS rca_records_cause_category_check;

ALTER TABLE rca_records
  ALTER COLUMN cause_category DROP NOT NULL;

ALTER TABLE rca_records
  ADD COLUMN IF NOT EXISTS process_area text
    CHECK (process_area IN ('recebimento','armazenagem','picking','separacao',
      'expedicao','inventario','logistica_reversa','cadastro',
      'integracao_sincronizacao','outro')),
  ADD COLUMN IF NOT EXISTS subcause_code text,
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'baixa'
    CHECK (severity IN ('baixa','media','alta','critica')),
  ADD COLUMN IF NOT EXISTS classification_status text NOT NULL DEFAULT 'classified'
    CHECK (classification_status IN ('classified','pending')),
  ADD COLUMN IF NOT EXISTS containment_needed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS known_recurrence boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS financial_impact numeric,
  ADD COLUMN IF NOT EXISTS manual_escalation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rca_case_id uuid;

ALTER TABLE rca_records
  DROP CONSTRAINT IF EXISTS rca_records_classification_complete;
ALTER TABLE rca_records
  ADD CONSTRAINT rca_records_classification_complete CHECK (
    classification_status = 'pending'
    OR (cause_category IS NOT NULL AND process_area IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS rca_records_process_area_idx ON rca_records (process_area);
CREATE INDEX IF NOT EXISTS rca_records_classification_status_idx ON rca_records (classification_status);
CREATE INDEX IF NOT EXISTS rca_records_case_idx ON rca_records (rca_case_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. rca_cases — o caso de RCA completo (substitui o papel de
--    rca_five_whys_sessions para novas investigações).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rca_case_counters (
  company_id  text NOT NULL DEFAULT get_my_company_id(),
  case_year   integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, case_year)
);
ALTER TABLE rca_case_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rca_case_counters_select" ON rca_case_counters;
CREATE POLICY "rca_case_counters_select" ON rca_case_counters FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());
-- Sem policy de INSERT/UPDATE direta: só a função SECURITY DEFINER abaixo escreve.

CREATE OR REPLACE FUNCTION rca_next_case_number(p_company_id text, p_year integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_number integer;
BEGIN
  INSERT INTO rca_case_counters (company_id, case_year, last_number)
  VALUES (p_company_id, p_year, 1)
  ON CONFLICT (company_id, case_year)
  DO UPDATE SET last_number = rca_case_counters.last_number + 1
  RETURNING last_number INTO v_number;
  RETURN v_number;
END;
$$;

CREATE TABLE IF NOT EXISTS rca_cases (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               text NOT NULL DEFAULT get_my_company_id(),
  case_number              integer NOT NULL,
  case_year                integer NOT NULL,
  status                   text NOT NULL DEFAULT 'rascunho' CHECK (status IN (
                             'rascunho','em_investigacao','causa_proposta','plano_em_execucao',
                             'aguardando_verificacao','eficaz','ineficaz_reaberto','encerrado')),
  severity                 text NOT NULL CHECK (severity IN ('baixa','media','alta','critica')),
  process_area             text NOT NULL,
  cause_category           text,
  subcause_code            text,
  problem_what             text NOT NULL,
  problem_where            text,
  problem_when             timestamptz,
  problem_impact_qty       numeric,
  problem_expected_pattern text,
  problem_observed_result  text,
  financial_impact         numeric,
  owner_id                 uuid,
  due_at                   timestamptz,
  root_cause_text          text,
  root_cause_status        text CHECK (root_cause_status IN ('proposta','confirmada')),
  root_cause_confirmed_by  uuid,
  root_cause_confirmed_at  timestamptz,
  root_cause_justification text,
  escalation_reasons       text[] NOT NULL DEFAULT '{}',
  opened_at                timestamptz DEFAULT now(),
  closed_at                timestamptz,
  closed_by                uuid,
  created_by               uuid NOT NULL,
  updated_by               uuid,
  updated_at               timestamptz DEFAULT now(),
  UNIQUE (company_id, case_year, case_number)
);

CREATE INDEX IF NOT EXISTS rca_cases_company_idx ON rca_cases (company_id);
CREATE INDEX IF NOT EXISTS rca_cases_status_idx ON rca_cases (status);
CREATE INDEX IF NOT EXISTS rca_cases_severity_idx ON rca_cases (severity);
CREATE INDEX IF NOT EXISTS rca_cases_owner_idx ON rca_cases (owner_id);
CREATE INDEX IF NOT EXISTS rca_cases_due_idx ON rca_cases (due_at);

ALTER TABLE rca_records
  ADD CONSTRAINT rca_records_case_fk FOREIGN KEY (rca_case_id) REFERENCES rca_cases(id) ON DELETE SET NULL;

ALTER TABLE rca_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rca_cases_select" ON rca_cases;
CREATE POLICY "rca_cases_select" ON rca_cases FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_cases_insert" ON rca_cases;
CREATE POLICY "rca_cases_insert" ON rca_cases FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_cases_update" ON rca_cases;
CREATE POLICY "rca_cases_update" ON rca_cases FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Vínculo N:N caso × classificações agrupadas (recorrência)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rca_case_divergence_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES rca_cases(id) ON DELETE CASCADE,
  rca_record_id  uuid NOT NULL REFERENCES rca_records(id) ON DELETE CASCADE,
  company_id     text NOT NULL DEFAULT get_my_company_id(),
  linked_by      uuid,
  linked_at      timestamptz DEFAULT now(),
  UNIQUE (case_id, rca_record_id)
);
CREATE INDEX IF NOT EXISTS rca_case_divergence_links_case_idx ON rca_case_divergence_links (case_id);
CREATE INDEX IF NOT EXISTS rca_case_divergence_links_record_idx ON rca_case_divergence_links (rca_record_id);

ALTER TABLE rca_case_divergence_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rca_case_divergence_links_select" ON rca_case_divergence_links;
CREATE POLICY "rca_case_divergence_links_select" ON rca_case_divergence_links FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_case_divergence_links_insert" ON rca_case_divergence_links;
CREATE POLICY "rca_case_divergence_links_insert" ON rca_case_divergence_links FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_case_divergence_links_delete" ON rca_case_divergence_links;
CREATE POLICY "rca_case_divergence_links_delete" ON rca_case_divergence_links FOR DELETE
  TO authenticated USING (
    company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager'])
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Cadeia dos Porquês — profundidade variável, com ramificação
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rca_case_why_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES rca_cases(id) ON DELETE CASCADE,
  company_id      text NOT NULL DEFAULT get_my_company_id(),
  parent_step_id  uuid REFERENCES rca_case_why_steps(id) ON DELETE CASCADE,
  order_index     integer NOT NULL,
  question        text NOT NULL DEFAULT 'Por quê?',
  answer          text NOT NULL,
  role            text NOT NULL DEFAULT 'causa_direta' CHECK (role IN (
                    'sintoma','causa_direta','causa_contribuinte','causa_raiz_proposta')),
  author_id       uuid,
  author_email    text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rca_case_why_steps_case_idx ON rca_case_why_steps (case_id);
CREATE INDEX IF NOT EXISTS rca_case_why_steps_parent_idx ON rca_case_why_steps (parent_step_id);

ALTER TABLE rca_case_why_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rca_case_why_steps_select" ON rca_case_why_steps;
CREATE POLICY "rca_case_why_steps_select" ON rca_case_why_steps FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_case_why_steps_insert" ON rca_case_why_steps;
CREATE POLICY "rca_case_why_steps_insert" ON rca_case_why_steps FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_case_why_steps_update" ON rca_case_why_steps;
CREATE POLICY "rca_case_why_steps_update" ON rca_case_why_steps FOR UPDATE
  TO authenticated USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_case_why_steps_delete" ON rca_case_why_steps;
CREATE POLICY "rca_case_why_steps_delete" ON rca_case_why_steps FOR DELETE
  TO authenticated USING (company_id = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. rca_evidence — evidência estruturada (tipo/origem/referência), podendo
--    vincular a um caso ou a uma etapa da cadeia, não só a uma classificação.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE rca_evidence
  ALTER COLUMN rca_record_id DROP NOT NULL,
  ALTER COLUMN file_path DROP NOT NULL;

ALTER TABLE rca_evidence
  ADD COLUMN IF NOT EXISTS rca_case_id uuid REFERENCES rca_cases(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS why_step_id uuid REFERENCES rca_case_why_steps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evidence_type text NOT NULL DEFAULT 'anexo' CHECK (evidence_type IN (
    'divergencia','contagem','movimentacao','picking','sistema','produto',
    'endereco','fornecedor','observacao','anexo')),
  ADD COLUMN IF NOT EXISTS source_table text,
  ADD COLUMN IF NOT EXISTS source_record_id uuid,
  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE rca_evidence
  DROP CONSTRAINT IF EXISTS rca_evidence_owner_check;
ALTER TABLE rca_evidence
  ADD CONSTRAINT rca_evidence_owner_check CHECK (rca_record_id IS NOT NULL OR rca_case_id IS NOT NULL);

ALTER TABLE rca_evidence
  DROP CONSTRAINT IF EXISTS rca_evidence_content_check;
ALTER TABLE rca_evidence
  ADD CONSTRAINT rca_evidence_content_check CHECK (file_path IS NOT NULL OR source_record_id IS NOT NULL OR note IS NOT NULL);

CREATE INDEX IF NOT EXISTS rca_evidence_case_idx ON rca_evidence (rca_case_id);
CREATE INDEX IF NOT EXISTS rca_evidence_why_step_idx ON rca_evidence (why_step_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Plano de ação — fino, aponta pra uma Tarefa real (tasks)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rca_case_actions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                  uuid NOT NULL REFERENCES rca_cases(id) ON DELETE CASCADE,
  company_id               text NOT NULL DEFAULT get_my_company_id(),
  action_type              text NOT NULL CHECK (action_type IN ('contencao','corretiva','preventiva','verificacao')),
  task_id                  uuid REFERENCES tasks(id) ON DELETE SET NULL,
  effectiveness_criteria   text,
  observation_window_days  integer,
  expected_result          text,
  observed_result          text,
  verification_result      text CHECK (verification_result IN ('eficaz','ineficaz')),
  verified_by              uuid,
  verified_at              timestamptz,
  created_by               uuid,
  created_at               timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rca_case_actions_case_idx ON rca_case_actions (case_id);
CREATE INDEX IF NOT EXISTS rca_case_actions_task_idx ON rca_case_actions (task_id);

ALTER TABLE rca_case_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rca_case_actions_select" ON rca_case_actions;
CREATE POLICY "rca_case_actions_select" ON rca_case_actions FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_case_actions_insert" ON rca_case_actions;
CREATE POLICY "rca_case_actions_insert" ON rca_case_actions FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_case_actions_update" ON rca_case_actions;
CREATE POLICY "rca_case_actions_update" ON rca_case_actions FOR UPDATE
  TO authenticated USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. rca_settings — limite de impacto financeiro para escalonamento; janela
--    padrão de recorrência passa a 60 dias (só o DEFAULT de novas linhas).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE rca_settings
  ADD COLUMN IF NOT EXISTS financial_impact_threshold numeric;

ALTER TABLE rca_settings
  ALTER COLUMN recurrence_window_days SET DEFAULT 60;
