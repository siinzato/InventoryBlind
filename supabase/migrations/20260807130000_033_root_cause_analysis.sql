/*
# Root Cause Analysis (RCA)

## Summary
Hoje uma divergência (contagem, conferência Full, recebimento NF-e) vira só um
número/status — ninguém registra a causa. Este módulo exige uma classificação
estruturada de causa ao fechar qualquer divergência, abre automaticamente uma
análise "5 Porquês" quando o mesmo SKU ou causa recorre (limiar configurável),
aceita evidências (fotos), e alimenta um dashboard de Pareto/causas.

Não existe uma tabela única de "divergências" hoje — há 3 origens
independentes (inventory_count_import_items, full_operation_items,
nfe_invoice_items), cada uma com seu próprio schema. Em vez de unificá-las
(o que exigiria mexer em 3 fluxos que já funcionam), rca_records referencia a
origem de forma polimórfica (source_module + source_item_id, sem FK) e
denormaliza os campos necessários para os filtros do dashboard.

## Changes
1. rca_records — uma linha por divergência classificada.
2. rca_evidence — fotos/arquivos anexados a uma classificação.
3. rca_five_whys_sessions / rca_five_whys_answers — investigação de causa raiz
   auto-aberta por recorrência.
4. rca_settings — limiar de recorrência configurável por empresa.
5. Bucket de Storage privado 'rca-evidence' com RLS por empresa.

## Security
Classificar uma divergência e responder aos "5 porquês" é tarefa operacional
de quem fecha a operação — leitura/escrita aberta a qualquer autenticado da
empresa. Corrigir/apagar uma classificação, concluir uma análise de causa raiz
e ajustar rca_settings são restritos a owner/admin/manager (mesmo padrão de
product_criticality_overrides / warehouse_layouts).
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. rca_records
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rca_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          text NOT NULL DEFAULT get_my_company_id(),
  source_module       text NOT NULL CHECK (source_module IN ('import_count','full_operation','nfe_receiving')),
  source_item_id      uuid NOT NULL,
  product_id          uuid REFERENCES products(id) ON DELETE SET NULL,
  sku                 text,
  product_name        text,
  location            text,
  operator_user_id    uuid,
  operator_name       text,
  supplier_name       text,
  supplier_cnpj       text,
  divergence_qty      integer NOT NULL DEFAULT 0,
  cause_category      text NOT NULL CHECK (cause_category IN (
                         'recebimento','armazenagem','picking','separacao','expedicao',
                         'inventario','furto_perda','avaria','cadastro','conversao_unidade',
                         'erro_operacional','sistema_integracao','sem_causa_identificada','outro'
                       )),
  custom_cause_label  text,
  notes               text,
  classified_by       uuid,
  classified_by_email text,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rca_records_company_idx ON rca_records (company_id);
CREATE INDEX IF NOT EXISTS rca_records_cause_idx ON rca_records (cause_category);
CREATE INDEX IF NOT EXISTS rca_records_product_idx ON rca_records (product_id);
CREATE INDEX IF NOT EXISTS rca_records_sku_idx ON rca_records (sku);
CREATE INDEX IF NOT EXISTS rca_records_operator_idx ON rca_records (operator_user_id);
CREATE INDEX IF NOT EXISTS rca_records_location_idx ON rca_records (location);
CREATE INDEX IF NOT EXISTS rca_records_supplier_idx ON rca_records (supplier_name);
CREATE INDEX IF NOT EXISTS rca_records_occurred_idx ON rca_records (occurred_at);

ALTER TABLE rca_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rca_records_select" ON rca_records;
CREATE POLICY "rca_records_select" ON rca_records FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_records_insert" ON rca_records;
CREATE POLICY "rca_records_insert" ON rca_records FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_records_update" ON rca_records;
CREATE POLICY "rca_records_update" ON rca_records FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

DROP POLICY IF EXISTS "rca_records_delete" ON rca_records;
CREATE POLICY "rca_records_delete" ON rca_records FOR DELETE
  TO authenticated USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. rca_evidence
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rca_evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rca_record_id uuid NOT NULL REFERENCES rca_records(id) ON DELETE CASCADE,
  company_id    text NOT NULL DEFAULT get_my_company_id(),
  file_path     text NOT NULL,
  file_name     text,
  uploaded_by   uuid,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rca_evidence_record_idx ON rca_evidence (rca_record_id);
CREATE INDEX IF NOT EXISTS rca_evidence_company_idx ON rca_evidence (company_id);

ALTER TABLE rca_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rca_evidence_select" ON rca_evidence;
CREATE POLICY "rca_evidence_select" ON rca_evidence FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_evidence_insert" ON rca_evidence;
CREATE POLICY "rca_evidence_insert" ON rca_evidence FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_evidence_delete" ON rca_evidence;
CREATE POLICY "rca_evidence_delete" ON rca_evidence FOR DELETE
  TO authenticated USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. rca_five_whys_sessions / rca_five_whys_answers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rca_five_whys_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            text NOT NULL DEFAULT get_my_company_id(),
  trigger_type          text NOT NULL CHECK (trigger_type IN ('sku','cause_category')),
  trigger_key           text NOT NULL,
  trigger_rca_record_id uuid REFERENCES rca_records(id) ON DELETE SET NULL,
  occurrence_count      integer NOT NULL DEFAULT 0,
  window_days           integer NOT NULL DEFAULT 30,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  root_cause_summary    text,
  opened_at             timestamptz DEFAULT now(),
  completed_at          timestamptz,
  completed_by          uuid
);

CREATE INDEX IF NOT EXISTS rca_five_whys_sessions_company_idx ON rca_five_whys_sessions (company_id);
CREATE INDEX IF NOT EXISTS rca_five_whys_sessions_status_idx ON rca_five_whys_sessions (status);
CREATE INDEX IF NOT EXISTS rca_five_whys_sessions_trigger_idx ON rca_five_whys_sessions (trigger_type, trigger_key);

ALTER TABLE rca_five_whys_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rca_five_whys_sessions_select" ON rca_five_whys_sessions;
CREATE POLICY "rca_five_whys_sessions_select" ON rca_five_whys_sessions FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_five_whys_sessions_insert" ON rca_five_whys_sessions;
CREATE POLICY "rca_five_whys_sessions_insert" ON rca_five_whys_sessions FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_five_whys_sessions_update" ON rca_five_whys_sessions;
CREATE POLICY "rca_five_whys_sessions_update" ON rca_five_whys_sessions FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

CREATE TABLE IF NOT EXISTS rca_five_whys_answers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES rca_five_whys_sessions(id) ON DELETE CASCADE,
  company_id       text NOT NULL DEFAULT get_my_company_id(),
  level            smallint NOT NULL CHECK (level BETWEEN 1 AND 5),
  question         text NOT NULL DEFAULT 'Por quê?',
  answer           text NOT NULL,
  answered_by      uuid,
  answered_by_email text,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (session_id, level)
);

CREATE INDEX IF NOT EXISTS rca_five_whys_answers_session_idx ON rca_five_whys_answers (session_id);
CREATE INDEX IF NOT EXISTS rca_five_whys_answers_company_idx ON rca_five_whys_answers (company_id);

ALTER TABLE rca_five_whys_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rca_five_whys_answers_select" ON rca_five_whys_answers;
CREATE POLICY "rca_five_whys_answers_select" ON rca_five_whys_answers FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_five_whys_answers_insert" ON rca_five_whys_answers;
CREATE POLICY "rca_five_whys_answers_insert" ON rca_five_whys_answers FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. rca_settings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rca_settings (
  company_id                text PRIMARY KEY DEFAULT get_my_company_id(),
  recurrence_threshold_count integer NOT NULL DEFAULT 3,
  recurrence_window_days     integer NOT NULL DEFAULT 30,
  updated_at                timestamptz DEFAULT now()
);

ALTER TABLE rca_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rca_settings_select" ON rca_settings;
CREATE POLICY "rca_settings_select" ON rca_settings FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "rca_settings_insert" ON rca_settings;
CREATE POLICY "rca_settings_insert" ON rca_settings FOR INSERT
  TO authenticated WITH CHECK (
    company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager'])
  );

DROP POLICY IF EXISTS "rca_settings_update" ON rca_settings;
CREATE POLICY "rca_settings_update" ON rca_settings FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Bucket de Storage para evidências (fotos/arquivos)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('rca-evidence', 'rca-evidence', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "rca_evidence_bucket_select" ON storage.objects;
CREATE POLICY "rca_evidence_bucket_select" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'rca-evidence' AND (storage.foldername(name))[1] = get_my_company_id()
  );

DROP POLICY IF EXISTS "rca_evidence_bucket_insert" ON storage.objects;
CREATE POLICY "rca_evidence_bucket_insert" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'rca-evidence' AND (storage.foldername(name))[1] = get_my_company_id()
  );

DROP POLICY IF EXISTS "rca_evidence_bucket_delete" ON storage.objects;
CREATE POLICY "rca_evidence_bucket_delete" ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id = 'rca-evidence' AND (storage.foldername(name))[1] = get_my_company_id()
    AND get_my_role() = ANY(ARRAY['owner','admin','manager'])
  );
