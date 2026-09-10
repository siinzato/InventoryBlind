/*
# I.B Academy — schema núcleo (trilhas, cursos, aulas, quiz, progresso, certificados)

## Summary
Backing schema for the new "I.B Academy" module (Método I.B.®): a training/LMS
layer teaching InventoryBlind's own stock-organization methodology. Tracks/
courses/lessons/quizzes are global catalog data (same tenant model as
achievement_definitions — the methodology doesn't vary per company), while
enrollment/progress/quiz-attempt/certificate rows are per-user, per-company
instance data with the same RLS shape as every other Produtividade table.

## Changes
1. Catalog tables (RLS: SELECT true, no client insert/update — seeded here):
   academy_tracks, academy_courses, academy_lessons, academy_quizzes,
   academy_quiz_questions.
2. Progress/instance tables (RLS: company_id = get_my_company_id(), self
   insert/update, self-or-manager-role select):
   academy_enrollments, academy_course_progress, academy_lesson_progress,
   academy_quiz_attempts, academy_certificates, pilar_checklist_progress
   (the last one backs Pilar 4 "Preparação"'s interactive checklist — the
   pilar content itself is static TS, only the checkbox state is a DB row).
3. Views (security_invoker, same pattern as user_productivity_stats_v):
   academy_track_progress_v, academy_team_summary_v.
4. Seed: 4 trilhas (Operador de Estoque, Líder Operacional, Gestor, Owner);
   each gets 1 real course ("Fundamentos do Método I.B." only in Operador de
   Estoque, 5 lessons + 8-question quiz) plus 2 placeholder courses
   (is_placeholder=true) so TrackDetailPage has something to render — full
   content for the remaining tracks/courses is a later phase, per the
   confirmed scoping decision (see plan).
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Catalog tables — global reference data, same tenant model as achievement_definitions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_tracks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE NOT NULL,
  title       text NOT NULL,
  description text NOT NULL,
  icon        text NOT NULL DEFAULT 'GraduationCap',
  order_index integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE academy_tracks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "academy_tracks_select" ON academy_tracks;
CREATE POLICY "academy_tracks_select" ON academy_tracks FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS academy_courses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id       uuid NOT NULL REFERENCES academy_tracks(id) ON DELETE CASCADE,
  key            text UNIQUE NOT NULL,
  title          text NOT NULL,
  objectives     text NOT NULL,
  workload_hours numeric NOT NULL DEFAULT 1,
  order_index    integer NOT NULL DEFAULT 0,
  is_placeholder boolean NOT NULL DEFAULT false,
  pilar_tag      text,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS academy_courses_track_idx ON academy_courses (track_id);

ALTER TABLE academy_courses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "academy_courses_select" ON academy_courses;
CREATE POLICY "academy_courses_select" ON academy_courses FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS academy_lessons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  title         text NOT NULL,
  body_richtext text NOT NULL,
  video_url     text,
  attachments   jsonb NOT NULL DEFAULT '[]',
  order_index   integer NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS academy_lessons_course_idx ON academy_lessons (course_id);

ALTER TABLE academy_lessons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "academy_lessons_select" ON academy_lessons;
CREATE POLICY "academy_lessons_select" ON academy_lessons FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS academy_quizzes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid UNIQUE NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  min_pass_pct numeric NOT NULL DEFAULT 80,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE academy_quizzes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "academy_quizzes_select" ON academy_quizzes;
CREATE POLICY "academy_quizzes_select" ON academy_quizzes FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS academy_quiz_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id       uuid NOT NULL REFERENCES academy_quizzes(id) ON DELETE CASCADE,
  question      text NOT NULL,
  options       jsonb NOT NULL,
  correct_index integer NOT NULL,
  order_index   integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS academy_quiz_questions_quiz_idx ON academy_quiz_questions (quiz_id);

ALTER TABLE academy_quiz_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "academy_quiz_questions_select" ON academy_quiz_questions;
CREATE POLICY "academy_quiz_questions_select" ON academy_quiz_questions FOR SELECT TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Progress/instance tables — company + user scoped, same 023 RLS shape
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_enrollments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   text NOT NULL DEFAULT get_my_company_id(),
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id     uuid NOT NULL REFERENCES academy_tracks(id) ON DELETE CASCADE,
  started_at   timestamptz DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (user_id, track_id)
);

CREATE INDEX IF NOT EXISTS academy_enrollments_company_idx ON academy_enrollments (company_id);

ALTER TABLE academy_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "academy_enrollments_select" ON academy_enrollments;
CREATE POLICY "academy_enrollments_select" ON academy_enrollments FOR SELECT
  TO authenticated USING (
    company_id = get_my_company_id()
    AND (user_id = auth.uid() OR get_my_role() = ANY(ARRAY['owner','admin','manager','lead']))
  );

DROP POLICY IF EXISTS "academy_enrollments_insert" ON academy_enrollments;
CREATE POLICY "academy_enrollments_insert" ON academy_enrollments FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "academy_enrollments_update" ON academy_enrollments;
CREATE POLICY "academy_enrollments_update" ON academy_enrollments FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND user_id = auth.uid())
  WITH CHECK (company_id = get_my_company_id() AND user_id = auth.uid());

CREATE TABLE IF NOT EXISTS academy_course_progress (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   text NOT NULL DEFAULT get_my_company_id(),
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id    uuid NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed')),
  started_at   timestamptz,
  completed_at timestamptz,
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS academy_course_progress_company_idx ON academy_course_progress (company_id);

ALTER TABLE academy_course_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "academy_course_progress_select" ON academy_course_progress;
CREATE POLICY "academy_course_progress_select" ON academy_course_progress FOR SELECT
  TO authenticated USING (
    company_id = get_my_company_id()
    AND (user_id = auth.uid() OR get_my_role() = ANY(ARRAY['owner','admin','manager','lead']))
  );

DROP POLICY IF EXISTS "academy_course_progress_insert" ON academy_course_progress;
CREATE POLICY "academy_course_progress_insert" ON academy_course_progress FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "academy_course_progress_update" ON academy_course_progress;
CREATE POLICY "academy_course_progress_update" ON academy_course_progress FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND user_id = auth.uid())
  WITH CHECK (company_id = get_my_company_id() AND user_id = auth.uid());

CREATE TABLE IF NOT EXISTS academy_lesson_progress (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   text NOT NULL DEFAULT get_my_company_id(),
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id    uuid NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
  completed    boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  UNIQUE (user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS academy_lesson_progress_company_idx ON academy_lesson_progress (company_id);

ALTER TABLE academy_lesson_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "academy_lesson_progress_select" ON academy_lesson_progress;
CREATE POLICY "academy_lesson_progress_select" ON academy_lesson_progress FOR SELECT
  TO authenticated USING (
    company_id = get_my_company_id()
    AND (user_id = auth.uid() OR get_my_role() = ANY(ARRAY['owner','admin','manager','lead']))
  );

DROP POLICY IF EXISTS "academy_lesson_progress_insert" ON academy_lesson_progress;
CREATE POLICY "academy_lesson_progress_insert" ON academy_lesson_progress FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "academy_lesson_progress_update" ON academy_lesson_progress;
CREATE POLICY "academy_lesson_progress_update" ON academy_lesson_progress FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND user_id = auth.uid())
  WITH CHECK (company_id = get_my_company_id() AND user_id = auth.uid());

CREATE TABLE IF NOT EXISTS academy_quiz_attempts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT get_my_company_id(),
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  quiz_id    uuid NOT NULL REFERENCES academy_quizzes(id) ON DELETE CASCADE,
  answers    jsonb NOT NULL,
  score_pct  numeric NOT NULL,
  passed     boolean NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS academy_quiz_attempts_company_idx ON academy_quiz_attempts (company_id);
CREATE INDEX IF NOT EXISTS academy_quiz_attempts_user_idx ON academy_quiz_attempts (user_id);

ALTER TABLE academy_quiz_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "academy_quiz_attempts_select" ON academy_quiz_attempts;
CREATE POLICY "academy_quiz_attempts_select" ON academy_quiz_attempts FOR SELECT
  TO authenticated USING (
    company_id = get_my_company_id()
    AND (user_id = auth.uid() OR get_my_role() = ANY(ARRAY['owner','admin','manager','lead']))
  );

DROP POLICY IF EXISTS "academy_quiz_attempts_insert" ON academy_quiz_attempts;
CREATE POLICY "academy_quiz_attempts_insert" ON academy_quiz_attempts FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id() AND user_id = auth.uid());

CREATE TABLE IF NOT EXISTS academy_certificates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           text NOT NULL DEFAULT get_my_company_id(),
  user_id              uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id             uuid NOT NULL REFERENCES academy_tracks(id) ON DELETE CASCADE,
  learner_name         text NOT NULL,
  total_workload_hours numeric NOT NULL,
  issued_at            timestamptz DEFAULT now(),
  UNIQUE (user_id, track_id)
);

CREATE INDEX IF NOT EXISTS academy_certificates_company_idx ON academy_certificates (company_id);

ALTER TABLE academy_certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "academy_certificates_select" ON academy_certificates;
CREATE POLICY "academy_certificates_select" ON academy_certificates FOR SELECT
  TO authenticated USING (
    company_id = get_my_company_id()
    AND (user_id = auth.uid() OR get_my_role() = ANY(ARRAY['owner','admin','manager','lead']))
  );

DROP POLICY IF EXISTS "academy_certificates_insert" ON academy_certificates;
CREATE POLICY "academy_certificates_insert" ON academy_certificates FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id() AND user_id = auth.uid());

CREATE TABLE IF NOT EXISTS pilar_checklist_progress (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT get_my_company_id(),
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  item_key   text NOT NULL,
  checked    boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, item_key)
);

CREATE INDEX IF NOT EXISTS pilar_checklist_progress_company_idx ON pilar_checklist_progress (company_id);

ALTER TABLE pilar_checklist_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pilar_checklist_progress_select" ON pilar_checklist_progress;
CREATE POLICY "pilar_checklist_progress_select" ON pilar_checklist_progress FOR SELECT
  TO authenticated USING (company_id = get_my_company_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "pilar_checklist_progress_insert" ON pilar_checklist_progress;
CREATE POLICY "pilar_checklist_progress_insert" ON pilar_checklist_progress FOR INSERT
  TO authenticated WITH CHECK (company_id = get_my_company_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "pilar_checklist_progress_update" ON pilar_checklist_progress;
CREATE POLICY "pilar_checklist_progress_update" ON pilar_checklist_progress FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND user_id = auth.uid())
  WITH CHECK (company_id = get_my_company_id() AND user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Views
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW academy_track_progress_v
WITH (security_invoker = true) AS
SELECT
  e.user_id,
  e.company_id,
  t.id                                                    AS track_id,
  t.title                                                  AS track_title,
  COUNT(c.id)                                              AS courses_total,
  COUNT(cp.id) FILTER (WHERE cp.status = 'completed')      AS courses_completed,
  CASE WHEN COUNT(c.id) = 0 THEN 0
       ELSE ROUND(100.0 * COUNT(cp.id) FILTER (WHERE cp.status = 'completed') / COUNT(c.id))
  END                                                       AS pct_complete,
  COALESCE(SUM(c.workload_hours) FILTER (WHERE cp.status = 'completed'), 0) AS hours_studied,
  (cert.id IS NOT NULL)                                    AS has_certificate
FROM academy_enrollments e
JOIN academy_tracks t ON t.id = e.track_id
LEFT JOIN academy_courses c ON c.track_id = t.id
LEFT JOIN academy_course_progress cp ON cp.course_id = c.id AND cp.user_id = e.user_id
LEFT JOIN academy_certificates cert ON cert.track_id = t.id AND cert.user_id = e.user_id
GROUP BY e.user_id, e.company_id, t.id, t.title, cert.id;

CREATE OR REPLACE VIEW academy_team_summary_v
WITH (security_invoker = true) AS
SELECT
  p.id                                       AS user_id,
  p.company_id,
  p.name,
  p.role,
  COALESCE(cp.courses_completed, 0)          AS courses_completed,
  COALESCE(cert.certificates_count, 0)       AS certificates_count,
  COALESCE(cp.hours_studied, 0)               AS hours_studied,
  GREATEST(cp.last_progress_at, lp.last_lesson_at) AS last_activity_at,
  (cp.last_progress_at IS NULL AND lp.last_lesson_at IS NULL) AS never_accessed
FROM profiles p
LEFT JOIN (
  SELECT
    acp.user_id,
    COUNT(*) FILTER (WHERE acp.status = 'completed')              AS courses_completed,
    SUM(ac.workload_hours) FILTER (WHERE acp.status = 'completed') AS hours_studied,
    MAX(acp.updated_at)                                            AS last_progress_at
  FROM academy_course_progress acp
  JOIN academy_courses ac ON ac.id = acp.course_id
  GROUP BY acp.user_id
) cp ON cp.user_id = p.id
LEFT JOIN (
  SELECT user_id, COUNT(*) AS certificates_count
  FROM academy_certificates
  GROUP BY user_id
) cert ON cert.user_id = p.id
LEFT JOIN (
  SELECT user_id, MAX(completed_at) AS last_lesson_at
  FROM academy_lesson_progress
  WHERE completed_at IS NOT NULL
  GROUP BY user_id
) lp ON lp.user_id = p.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Seed — 4 trilhas, courses per track (1 real in Operador de Estoque, rest placeholder)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO academy_tracks (key, title, description, icon, order_index) VALUES
  ('operador_estoque',  'Operador de Estoque', 'Método I.B., organização, endereçamento, preparação, inventário cego, recontagem, conferência, etiquetagem e Full Manager — a base operacional do dia a dia.', 'Boxes',         1),
  ('lider_operacional', 'Líder Operacional',   'Gestão de equipes, distribuição de inventários, KPIs, HeatMap, plano de ação, produtividade e feedback.',                                                     'Users',         2),
  ('gestor',            'Gestor',              'Gestão estratégica, Dashboard Financeiro, indicadores, ROI do inventário, custos, perdas e auditoria.',                                                      'LineChart',     3),
  ('owner',             'Owner',               'Implantação do InventoryBlind, segurança, multiempresa, permissões, integrações ERP, auditoria e gestão completa da plataforma.',                             'Crown',         4)
ON CONFLICT (key) DO NOTHING;

-- Curso real: Fundamentos do Método I.B. (Operador de Estoque)
INSERT INTO academy_courses (track_id, key, title, objectives, workload_hours, order_index, is_placeholder, pilar_tag)
SELECT t.id, 'fundamentos_metodo_ib', 'Fundamentos do Método I.B.',
  'Entender por que um inventário perfeito começa na organização, não na contagem, e dominar o Pilar 1 (Organização) do Método I.B.®: organização física e visual, layout, setorização, identificação e boas práticas que eliminam divergências antes da primeira contagem.',
  2, 1, false, 'organizacao'
FROM academy_tracks t WHERE t.key = 'operador_estoque'
ON CONFLICT (key) DO NOTHING;

-- Placeholders (2 por trilha, incluindo mais 2 em Operador de Estoque)
INSERT INTO academy_courses (track_id, key, title, objectives, workload_hours, order_index, is_placeholder, pilar_tag)
SELECT t.id, v.key, v.title, 'Conteúdo completo em breve.', 1, v.order_index, true, v.pilar_tag
FROM academy_tracks t
JOIN (VALUES
  ('operador_estoque',  'operador_enderecamento_placeholder', 'Endereçamento Inteligente', 2, 'enderecamento'),
  ('operador_estoque',  'operador_inventario_cego_placeholder', 'Inventário Cego na Prática', 3, 'inventario_cego'),
  ('lider_operacional', 'lider_gestao_equipes_placeholder', 'Gestão de Equipes e KPIs', 1, NULL),
  ('lider_operacional', 'lider_heatmap_placeholder', 'HeatMap e Plano de Ação', 2, NULL),
  ('gestor',            'gestor_dashboard_financeiro_placeholder', 'Dashboard Financeiro e ROI', 1, NULL),
  ('gestor',            'gestor_auditoria_placeholder', 'Auditoria e Indicadores', 2, NULL),
  ('owner',             'owner_implantacao_placeholder', 'Implantação e Segurança', 1, NULL),
  ('owner',             'owner_multiempresa_placeholder', 'Multiempresa e Integrações ERP', 2, NULL)
) AS v(track_key, key, title, order_index, pilar_tag) ON v.track_key = t.key
ON CONFLICT (key) DO NOTHING;

-- Aulas do curso real
INSERT INTO academy_lessons (course_id, title, body_richtext, order_index)
SELECT c.id, v.title, v.body, v.order_index
FROM academy_courses c
JOIN (VALUES
  (1, 'Por que a organização vem antes da contagem', 'Um inventário perfeito não começa na contagem. Ele começa na organização. Antes de qualquer contagem, o estoque precisa estar fisicamente organizado: produtos no lugar certo, identificados, sem misturas. Organização reduz erros antes mesmo da primeira contagem — é a base sobre a qual todo o Método I.B.® é construído.'),
  (2, 'Organização física e visual', 'Organização física significa produtos guardados de forma consistente, sem misturar SKUs diferentes no mesmo espaço, sem caixas abertas espalhadas, sem produtos avariados misturados aos saudáveis. Organização visual significa que qualquer pessoa — não só quem trabalha ali todo dia — consegue olhar para uma posição e entender o que deveria estar ali.'),
  (3, 'Layout e setorização', 'Um layout bem definido separa o estoque em setores lógicos (por categoria, por giro, por linha) e mantém corredores e vãos livres de obstrução. Setorização clara reduz o tempo de busca, reduz erro de picking e facilita auditoria visual rápida.'),
  (4, 'Identificação e boas práticas', 'Toda posição, prateleira e caixa deve ter identificação clara — etiqueta legível, padronizada, no lugar certo. Produtos fora do endereço correto e caixas abertas sem identificação são as duas causas mais comuns de divergência silenciosa (aquela que só aparece na contagem, quando já é tarde).'),
  (5, 'Um estoque organizado vale mais que um inventário bem executado', 'Um estoque organizado vale mais do que um inventário bem executado — porque um inventário bem executado em cima de um estoque desorganizado só revela o problema, não o resolve. A organização é preventiva; a contagem é apenas diagnóstica. Dominar esse princípio é o primeiro passo do Método I.B.®.')
) AS v(order_index, title, body) ON true
WHERE c.key = 'fundamentos_metodo_ib';

-- Quiz do curso real (80% de aprovação = 7/8)
INSERT INTO academy_quizzes (course_id, min_pass_pct)
SELECT c.id, 80 FROM academy_courses c WHERE c.key = 'fundamentos_metodo_ib'
ON CONFLICT (course_id) DO NOTHING;

INSERT INTO academy_quiz_questions (quiz_id, question, options, correct_index, order_index)
SELECT q.id, v.question, v.options::jsonb, v.correct_index, v.order_index
FROM academy_quizzes q
JOIN academy_courses c ON c.id = q.course_id
JOIN (VALUES
  (1, 'Segundo o Método I.B.®, o inventário perfeito começa em quê?', '["Na contagem", "Na organização", "No ERP", "Na auditoria"]', 1),
  (2, 'Organização física do estoque significa principalmente:', '["Contar rápido", "Produtos no lugar certo, identificados, sem misturas", "Usar leitor de código de barras", "Reduzir o quadro de operadores"]', 1),
  (3, 'O que é organização visual?', '["Qualquer pessoa entender o que deveria estar em cada posição", "Ter câmeras no estoque", "Pintar as prateleiras", "Trocar o sistema de gestão"]', 0),
  (4, 'Um bom layout de estoque busca principalmente:', '["Reduzir o número de corredores", "Separar setores logicamente e manter corredores livres", "Eliminar a necessidade de etiquetas", "Aumentar o estoque de segurança"]', 1),
  (5, 'Qual das opções abaixo é uma das duas causas mais comuns de divergência silenciosa?', '["Excesso de etiquetas", "Produtos fora do endereço correto", "Auditoria frequente", "Treinamento excessivo"]', 1),
  (6, 'Por que "um estoque organizado vale mais que um inventário bem executado"?', '["Porque a organização é preventiva e a contagem é apenas diagnóstica", "Porque contagem não é importante", "Porque inventário é caro", "Porque auditoria substitui organização"]', 0),
  (7, 'Caixas abertas e sem identificação no estoque geralmente causam:', '["Melhoria da acuracidade", "Divergência silenciosa, só percebida na contagem", "Redução de custos", "Aumento do giro"]', 1),
  (8, 'O Pilar 1 do Método I.B.® trata principalmente de:', '["Inventário Cego", "Organização", "Inteligência de dados", "Validação"]', 1)
) AS v(order_index, question, options, correct_index) ON true
WHERE c.key = 'fundamentos_metodo_ib';
