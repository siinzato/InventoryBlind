/*
# I.B Academy — conquistas

## Summary
Extends the EXISTING achievement_definitions/user_achievements tables (from
023_productivity.sql) with 7 new Academy-specific achievements, instead of
creating a parallel gamification system. New goal_metric values introduced
here (academy_courses_completed, academy_certificates, academy_hours_studied,
academy_organizacao_specialist, academy_blind_inventory_master,
academy_enderecamento_specialist, academy_instructor) are computed by a new
function in src/lib/academyService.ts (checkAndUnlockAcademyAchievements),
kept separate from achievementService.ts's existing productivity-metric
computation so that logic isn't touched.
*/

INSERT INTO achievement_definitions (key, category, level, title, description, goal_metric, goal_value, icon, order_index) VALUES
  ('academy_primeiro_curso',            'I.B Academy', 'bronze',   'Primeiro Curso',                'Concluiu seu primeiro curso na I.B Academy.',              'academy_courses_completed',        1,   'BookOpen',    80),
  ('academy_primeira_certificacao',     'I.B Academy', 'prata',    'Primeira Certificação',         'Concluiu uma Trilha e recebeu seu primeiro certificado.',  'academy_certificates',             1,   'Award',       81),
  ('academy_100_horas',                 'I.B Academy', 'ouro',     '100 Horas Estudadas',           'Acumulou 100 horas de estudo na I.B Academy.',             'academy_hours_studied',            100, 'Clock',       82),
  ('academy_especialista_organizacao',  'I.B Academy', 'ouro',     'Especialista em Organização',   'Concluiu o curso e o quiz de Fundamentos do Método I.B. (Pilar Organização).', 'academy_organizacao_specialist',   1,   'FolderCheck', 83),
  ('academy_mestre_inventario_cego',    'I.B Academy', 'diamante', 'Mestre do Inventário Cego',     'Concluiu um curso do Pilar Inventário Cego.',              'academy_blind_inventory_master',   1,   'EyeOff',      84),
  ('academy_especialista_enderecamento','I.B Academy', 'ouro',     'Especialista em Endereçamento', 'Concluiu um curso do Pilar Endereçamento.',                'academy_enderecamento_specialist', 1,   'MapPin',      85),
  ('academy_instrutor',                 'I.B Academy', 'diamante', 'Instrutor InventoryBlind',      'Concluiu todas as 4 Trilhas da I.B Academy.',              'academy_instructor',               4,   'GraduationCap', 86)
ON CONFLICT (key) DO NOTHING;
