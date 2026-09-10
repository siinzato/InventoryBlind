/*
# Produtividade — schema

## Summary
Backing schema for the new Produtividade tab (Minha Produtividade + Visão de
Gestor): a 'lead' role, per-user attribution columns for Full Manager (missing
until now — those tables only had free-text responsible/checker/picker_notes),
a label-generation log (LabelGeneratorPage persisted nothing before), the
achievements/incentives tables, and a live stats VIEW instead of a cache table
(no sync step needed — "atualização automática" falls out for free).

## Changes
0. audit_logs.description / audit_logs.user_agent — pre-existing schema drift
   fix. src/lib/auditLogService.ts's logAuditEvent() has always inserted these
   two keys, but audit_logs (008_saas_foundation.sql) never had these columns
   — every call has been silently failing (caught + console.warn'd). Since the
   Produtividade audit-logging requirement depends on this helper actually
   working, adding the two missing columns here (additive, no data loss).
1. Add 'lead' to the role CHECK constraints on profiles/company_members.
   Note: full_operations.assigned_user_id gets `DEFAULT auth.uid()` (same
   pattern as inventory_count_records.created_by) since operations are only
   ever INSERTed once, by whoever creates them — zero code change needed in
   FullNewOperation.tsx. full_operation_items.picked_by_user_id has NO default
   — items are inserted at operation-creation time (before anyone has picked
   them) and only get a real picker on a later UPDATE in FullPicking.tsx, so
   that one small update call is the one necessary code touch (see plan).
2. full_operations.assigned_user_id / full_operation_items.picked_by_user_id —
   nullable uuid, populated going forward by the app (no historical backfill
   possible, there was never a user reference before).
3. label_generation_log — new table, company-scoped RLS.
4. achievement_definitions (seeded) + user_achievements.
5. employee_incentives — INSERT restricted to owner/admin/manager/lead.
6. user_productivity_stats_v — VIEW aggregating the above per (user_id, company_id).
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. audit_logs schema-drift fix (see header)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. 'lead' role
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('owner','admin','manager','lead','counter','viewer'));

ALTER TABLE company_members DROP CONSTRAINT IF EXISTS company_members_role_check;
ALTER TABLE company_members ADD CONSTRAINT company_members_role_check
  CHECK (role IN ('owner','admin','manager','lead','counter','viewer'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Full Manager per-user attribution (previously free-text only)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE full_operations      ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE full_operation_items ADD COLUMN IF NOT EXISTS picked_by_user_id uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS full_operations_assigned_user_idx ON full_operations (assigned_user_id);
CREATE INDEX IF NOT EXISTS full_operation_items_picked_by_idx ON full_operation_items (picked_by_user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. label_generation_log
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS label_generation_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT get_my_company_id(),
  user_id    uuid DEFAULT auth.uid(),
  sku        text,
  label_type text,
  quantity   integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS label_generation_log_company_idx ON label_generation_log (company_id);
CREATE INDEX IF NOT EXISTS label_generation_log_user_idx    ON label_generation_log (user_id);

ALTER TABLE label_generation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "label_generation_log_select" ON label_generation_log;
CREATE POLICY "label_generation_log_select" ON label_generation_log FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "label_generation_log_insert" ON label_generation_log;
CREATE POLICY "label_generation_log_insert" ON label_generation_log FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. achievement_definitions + user_achievements
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS achievement_definitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE NOT NULL,
  category    text NOT NULL,
  level       text NOT NULL CHECK (level IN ('bronze','prata','ouro','diamante')),
  title       text NOT NULL,
  description text NOT NULL,
  goal_metric text NOT NULL,
  goal_value  numeric NOT NULL,
  icon        text NOT NULL DEFAULT 'Award',
  order_index integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE achievement_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "achievement_definitions_select" ON achievement_definitions;
CREATE POLICY "achievement_definitions_select" ON achievement_definitions FOR SELECT
  TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS user_achievements (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id               text NOT NULL DEFAULT get_my_company_id(),
  achievement_definition_id uuid NOT NULL REFERENCES achievement_definitions(id) ON DELETE CASCADE,
  progress_value           numeric NOT NULL DEFAULT 0,
  unlocked                 boolean NOT NULL DEFAULT false,
  unlocked_at              timestamptz,
  updated_at               timestamptz DEFAULT now(),
  UNIQUE (user_id, achievement_definition_id)
);

CREATE INDEX IF NOT EXISTS user_achievements_company_idx ON user_achievements (company_id);
CREATE INDEX IF NOT EXISTS user_achievements_user_idx    ON user_achievements (user_id);

ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_achievements_select" ON user_achievements;
CREATE POLICY "user_achievements_select" ON user_achievements FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "user_achievements_insert" ON user_achievements;
CREATE POLICY "user_achievements_insert" ON user_achievements FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS "user_achievements_update" ON user_achievements;
CREATE POLICY "user_achievements_update" ON user_achievements FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

-- Seed: 8 categories from the brief. "Primeiro Inventário" and "Estoquista Blind"
-- are one-shot/composite achievements (single level); the rest have 4 tiers.
-- Thresholds are a documented starting point, adjustable later without code changes.
INSERT INTO achievement_definitions (key, category, level, title, description, goal_metric, goal_value, icon, order_index) VALUES
  ('primeiro_inventario',      'Primeiro Inventário', 'bronze',   'Primeiro Inventário',     'Concluiu sua primeira contagem.',                    'contagens',              1,     'PartyPopper', 1),

  ('skus_contados_bronze',     'SKUs Contados',       'bronze',   'Contador Iniciante',       'Contou 500 SKUs.',                                    'skus_contados',          500,   'Package',     10),
  ('skus_contados_prata',      'SKUs Contados',       'prata',    'Contador Dedicado',        'Contou 2.000 SKUs.',                                  'skus_contados',          2000,  'Package',     11),
  ('skus_contados_ouro',       'SKUs Contados',       'ouro',     'Contador Experiente',      'Contou 5.000 SKUs.',                                  'skus_contados',          5000,  'Package',     12),
  ('skus_contados_diamante',   'SKUs Contados',       'diamante', 'Mestre da Contagem',       'Contou 15.000 SKUs.',                                 'skus_contados',          15000, 'Package',     13),

  ('precisao_bronze',          'Precisão',            'bronze',   'Olho Atento',              'Acuracidade média de 90%.',                           'acuracidade_media',      90,    'Target',      20),
  ('precisao_prata',           'Precisão',            'prata',    'Precisão Sólida',          'Acuracidade média de 95%.',                           'acuracidade_media',      95,    'Target',      21),
  ('precisao_ouro',            'Precisão',            'ouro',     'Alta Precisão',            'Acuracidade média de 98%.',                           'acuracidade_media',      98,    'Target',      22),
  ('precisao_diamante',        'Precisão',            'diamante', 'Precisão Cirúrgica',       'Acuracidade média de 99,5%.',                          'acuracidade_media',      99.5,  'Target',      23),

  ('recontagens_bronze',       'Recontagens',         'bronze',   'Revisor Iniciante',        'Realizou 10 recontagens.',                            'recontagens',           10,    'RotateCcw',   30),
  ('recontagens_prata',        'Recontagens',         'prata',    'Revisor Constante',        'Realizou 50 recontagens.',                            'recontagens',           50,    'RotateCcw',   31),
  ('recontagens_ouro',         'Recontagens',         'ouro',     'Revisor Experiente',       'Realizou 150 recontagens.',                           'recontagens',           150,   'RotateCcw',   32),
  ('recontagens_diamante',     'Recontagens',         'diamante', 'Mestre da Recontagem',     'Realizou 400 recontagens.',                           'recontagens',           400,   'RotateCcw',   33),

  ('full_manager_bronze',      'Full Manager',        'bronze',   'Separador Iniciante',      'Concluiu 5 operações Full.',                          'fulls_realizados',      5,     'Zap',         40),
  ('full_manager_prata',       'Full Manager',        'prata',    'Separador Ágil',           'Concluiu 20 operações Full.',                         'fulls_realizados',      20,    'Zap',         41),
  ('full_manager_ouro',        'Full Manager',        'ouro',     'Separador Experiente',     'Concluiu 50 operações Full.',                         'fulls_realizados',      50,    'Zap',         42),
  ('full_manager_diamante',    'Full Manager',        'diamante', 'Mestre do Full Manager',   'Concluiu 150 operações Full.',                        'fulls_realizados',      150,   'Zap',         43),

  ('etiquetas_bronze',         'Etiquetas',           'bronze',   'Etiquetador Iniciante',    'Gerou 100 etiquetas.',                                 'etiquetas_geradas',     100,   'Tag',         50),
  ('etiquetas_prata',          'Etiquetas',           'prata',    'Etiquetador Constante',    'Gerou 500 etiquetas.',                                 'etiquetas_geradas',     500,   'Tag',         51),
  ('etiquetas_ouro',           'Etiquetas',           'ouro',     'Etiquetador Experiente',   'Gerou 2.000 etiquetas.',                               'etiquetas_geradas',     2000,  'Tag',         52),
  ('etiquetas_diamante',       'Etiquetas',           'diamante', 'Mestre das Etiquetas',     'Gerou 5.000 etiquetas.',                               'etiquetas_geradas',     5000,  'Tag',         53),

  ('frequencia_bronze',        'Frequência de Uso',   'bronze',   'Presença Iniciante',       'Registrou 20 contagens no total.',                    'contagens',             20,    'Clock',       60),
  ('frequencia_prata',         'Frequência de Uso',   'prata',    'Presença Constante',       'Registrou 100 contagens no total.',                   'contagens',             100,   'Clock',       61),
  ('frequencia_ouro',          'Frequência de Uso',   'ouro',     'Presença Frequente',       'Registrou 300 contagens no total.',                   'contagens',             300,   'Clock',       62),
  ('frequencia_diamante',      'Frequência de Uso',   'diamante', 'Presença Exemplar',        'Registrou 1.000 contagens no total.',                 'contagens',             1000,  'Clock',       63),

  ('estoquista_blind',         'Estoquista Blind',    'diamante', 'Estoquista Blind',         'Combinação de alto volume (10.000+ SKUs) com alta precisão (97%+).', 'composite', 1, 'Trophy', 70)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. employee_incentives
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_incentives (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        text NOT NULL DEFAULT get_my_company_id(),
  employee_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_by           uuid DEFAULT auth.uid(),
  type              text NOT NULL CHECK (type IN (
                      'parabens','agradecimento','meta_atingida','destaque',
                      'evolucao','precisao','full_manager','inventario','personalizado'
                    )),
  subject           text NOT NULL,
  message           text NOT NULL,
  reward_suggestion text,
  cc_manager        boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'simulated' CHECK (status IN ('simulated','sent','failed')),
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_incentives_company_idx  ON employee_incentives (company_id);
CREATE INDEX IF NOT EXISTS employee_incentives_employee_idx ON employee_incentives (employee_user_id);

ALTER TABLE employee_incentives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_incentives_select" ON employee_incentives;
CREATE POLICY "employee_incentives_select" ON employee_incentives FOR SELECT
  TO authenticated USING (
    company_id = get_my_company_id()
    AND (employee_user_id = auth.uid() OR get_my_role() = ANY(ARRAY['owner','admin','manager','lead']))
  );

DROP POLICY IF EXISTS "employee_incentives_insert" ON employee_incentives;
CREATE POLICY "employee_incentives_insert" ON employee_incentives FOR INSERT
  TO authenticated WITH CHECK (
    company_id = get_my_company_id()
    AND get_my_role() = ANY(ARRAY['owner','admin','manager','lead'])
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. user_productivity_stats_v — live view, no cache/sync needed
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW user_productivity_stats_v
WITH (security_invoker = true) AS
SELECT
  p.id                                                     AS user_id,
  p.company_id                                             AS company_id,
  p.name,
  p.role,
  COALESCE(c.skus_contados, 0)                              AS skus_contados,
  COALESCE(c.contagens, 0)                                  AS contagens,
  COALESCE(c.recontagens, 0)                                AS recontagens,
  COALESCE(c.divergencias_encontradas, 0)                   AS divergencias_encontradas,
  COALESCE(c.divergencias_reais, 0)                         AS divergencias_reais,
  c.acuracidade_media,
  c.tempo_medio_segundos,
  COALESCE(f.fulls_realizados, 0)                           AS fulls_realizados,
  COALESCE(fi.itens_separados, 0)                           AS itens_separados,
  COALESCE(l.etiquetas_geradas, 0)                          AS etiquetas_geradas,
  GREATEST(c.ultima_contagem, l.ultima_etiqueta)            AS ultima_atividade
FROM profiles p
LEFT JOIN (
  SELECT
    created_by,
    SUM(skus_contados)                                  AS skus_contados,
    COUNT(*)                                            AS contagens,
    COUNT(*) FILTER (WHERE count_number > 1)            AS recontagens,
    SUM(divergencias_encontradas)                       AS divergencias_encontradas,
    SUM(divergencias_reais)                             AS divergencias_reais,
    AVG(accuracy_final)                                 AS acuracidade_media,
    AVG(duration_seconds)                               AS tempo_medio_segundos,
    MAX(created_at)                                     AS ultima_contagem
  FROM inventory_count_records
  WHERE created_by IS NOT NULL
  GROUP BY created_by
) c ON c.created_by = p.id
LEFT JOIN (
  SELECT assigned_user_id, COUNT(*) AS fulls_realizados
  FROM full_operations
  WHERE assigned_user_id IS NOT NULL AND status = 'completed'
  GROUP BY assigned_user_id
) f ON f.assigned_user_id = p.id
LEFT JOIN (
  SELECT picked_by_user_id, SUM(quantity_picked) AS itens_separados
  FROM full_operation_items
  WHERE picked_by_user_id IS NOT NULL
  GROUP BY picked_by_user_id
) fi ON fi.picked_by_user_id = p.id
LEFT JOIN (
  SELECT user_id, SUM(quantity) AS etiquetas_geradas, MAX(created_at) AS ultima_etiqueta
  FROM label_generation_log
  WHERE user_id IS NOT NULL
  GROUP BY user_id
) l ON l.user_id = p.id;
