/*
# I.B Academy — PDI (Plano de Desenvolvimento Individual) e Biblioteca

## Summary
Two independent additions to the I.B Academy module:
1. PDI: manager-authored, per-employee development plans with an ordered
   checklist of steps (optionally linked to a real academy_courses row).
   Modeled as its own tables (not achievement_definitions/user_achievements)
   because a PDI step is manager-authored free text or a course link, not a
   global gamification definition.
2. Biblioteca: downloadable resource metadata (POPs/checklists/templates).
   No file-storage/upload pipeline exists in this repo, so this is metadata +
   external_url (nullable) rather than any generated/uploaded blob — same
   "no upload pipeline invented" constraint as everywhere else in this app.
   Treated as global catalog (no company_id) since these are InventoryBlind's
   own reference documents, not tenant-authored content — same model as
   academy_tracks/courses (023's achievement_definitions precedent).

No table for Central de Conhecimento (FAQ/Glossário/Boas práticas/Artigos/
Estudos de Caso) — that content has no per-user tracking requirement, so it
stays 100% static (src/lib/academyContent.ts), avoiding an unnecessary table.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PDI — pdi_plans + pdi_steps (manager-authored, role-gated writes)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pdi_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        text NOT NULL DEFAULT get_my_company_id(),
  employee_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by        uuid DEFAULT auth.uid(),
  goal_title        text NOT NULL,
  goal_description  text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pdi_plans_company_idx  ON pdi_plans (company_id);
CREATE INDEX IF NOT EXISTS pdi_plans_employee_idx ON pdi_plans (employee_user_id);

ALTER TABLE pdi_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pdi_plans_select" ON pdi_plans;
CREATE POLICY "pdi_plans_select" ON pdi_plans FOR SELECT
  TO authenticated USING (
    company_id = get_my_company_id()
    AND (employee_user_id = auth.uid() OR get_my_role() = ANY(ARRAY['owner','admin','manager','lead']))
  );

DROP POLICY IF EXISTS "pdi_plans_insert" ON pdi_plans;
CREATE POLICY "pdi_plans_insert" ON pdi_plans FOR INSERT
  TO authenticated WITH CHECK (
    company_id = get_my_company_id()
    AND get_my_role() = ANY(ARRAY['owner','admin','manager','lead'])
  );

DROP POLICY IF EXISTS "pdi_plans_update" ON pdi_plans;
CREATE POLICY "pdi_plans_update" ON pdi_plans FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager','lead']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager','lead']));

CREATE TABLE IF NOT EXISTS pdi_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   text NOT NULL DEFAULT get_my_company_id(),
  pdi_plan_id  uuid NOT NULL REFERENCES pdi_plans(id) ON DELETE CASCADE,
  title        text NOT NULL,
  course_id    uuid REFERENCES academy_courses(id),
  order_index  integer NOT NULL DEFAULT 0,
  completed    boolean NOT NULL DEFAULT false,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS pdi_steps_plan_idx ON pdi_steps (pdi_plan_id);

ALTER TABLE pdi_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pdi_steps_select" ON pdi_steps;
CREATE POLICY "pdi_steps_select" ON pdi_steps FOR SELECT
  TO authenticated USING (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM pdi_plans pp WHERE pp.id = pdi_steps.pdi_plan_id
        AND (pp.employee_user_id = auth.uid() OR get_my_role() = ANY(ARRAY['owner','admin','manager','lead']))
    )
  );

DROP POLICY IF EXISTS "pdi_steps_insert" ON pdi_steps;
CREATE POLICY "pdi_steps_insert" ON pdi_steps FOR INSERT
  TO authenticated WITH CHECK (
    company_id = get_my_company_id()
    AND get_my_role() = ANY(ARRAY['owner','admin','manager','lead'])
  );

-- Update allowed to the employee themself (checking off their own step) AND management roles.
DROP POLICY IF EXISTS "pdi_steps_update" ON pdi_steps;
CREATE POLICY "pdi_steps_update" ON pdi_steps FOR UPDATE
  TO authenticated
  USING (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM pdi_plans pp WHERE pp.id = pdi_steps.pdi_plan_id
        AND (pp.employee_user_id = auth.uid() OR get_my_role() = ANY(ARRAY['owner','admin','manager','lead']))
    )
  )
  WITH CHECK (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM pdi_plans pp WHERE pp.id = pdi_steps.pdi_plan_id
        AND (pp.employee_user_id = auth.uid() OR get_my_role() = ANY(ARRAY['owner','admin','manager','lead']))
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Biblioteca — global catalog, metadata + external_url (no upload pipeline)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS library_resources (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text UNIQUE NOT NULL,
  description    text,
  category       text NOT NULL CHECK (category IN ('pdf','checklist','pop','template')),
  external_url   text,
  is_placeholder boolean NOT NULL DEFAULT false,
  order_index    integer NOT NULL DEFAULT 0,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE library_resources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "library_resources_select" ON library_resources;
CREATE POLICY "library_resources_select" ON library_resources FOR SELECT TO authenticated USING (true);

INSERT INTO library_resources (title, description, category, external_url, is_placeholder, order_index) VALUES
  ('Checklist de Organização — Pilar 1', 'Checklist prático para avaliar a organização física e visual do estoque antes de qualquer contagem.', 'checklist', null, true, 1),
  ('Checklist de Preparação para Inventário — Pilar 4', 'Os 10 itens de preparação do Método I.B.® antes de iniciar um inventário cego.', 'checklist', null, true, 2),
  ('POP — Endereçamento de Estoque', 'Procedimento operacional padrão para endereçamento inteligente por ruas, corredores e vãos.', 'pop', null, true, 3),
  ('Template — Plano de Ação Pós-Inventário', 'Modelo para estruturar ações corretivas após divergências reais identificadas.', 'template', null, true, 4),
  ('Guia — Padronização de Etiquetas', 'Boas práticas de padronização de etiquetas de vão e excesso.', 'template', null, true, 5)
ON CONFLICT (title) DO NOTHING;
