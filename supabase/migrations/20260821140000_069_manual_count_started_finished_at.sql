/*
  Contagem Manual — início/término explícitos em vez de cronômetro por seleção
  de linha.

  Contexto: o "Painel ao vivo" da Contagem Manual iniciava um cronômetro no
  client no momento em que uma linha/marca era selecionada. Isso mede o tempo
  desde a seleção, não o tempo real da contagem física — o operador pode
  selecionar a linha bem antes (ou depois) de começar a contar. Passa a exigir
  início/término explícitos do operador; a duração é sempre término - início.

  1. inventory_count_records.started_at / finished_at (timestamptz, nullable).
     Registros antigos ficam NULL — nunca inferidos de created_at/updated_at.
  2. CHECK: finished_at >= started_at quando ambos estão preenchidos. Nunca
     duração negativa.
  3. duration_seconds já existia (021_count_management) mas nenhum insert no
     código a preenchia — está sempre NULL hoje. Convertida para coluna GERADA
     a partir de started_at/finished_at, para que o frontend nunca seja fonte
     de verdade da duração (ele só manda os dois timestamps; o banco deriva o
     resto). Como todo valor atual é NULL, a conversão não perde dado nenhum.
     user_productivity_stats_v (023_productivity.sql) lê duration_seconds via
     AVG() — precisa ser recriada porque depende da coluna que estamos
     substituindo; a definição abaixo é idêntica à original, só o dado por
     trás passa a ser real em vez de sempre NULL.
*/

DROP VIEW IF EXISTS user_productivity_stats_v;

ALTER TABLE inventory_count_records
  ADD COLUMN IF NOT EXISTS started_at  timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;

ALTER TABLE inventory_count_records
  DROP CONSTRAINT IF EXISTS inv_count_records_finished_after_started;
ALTER TABLE inventory_count_records
  ADD CONSTRAINT inv_count_records_finished_after_started
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at);

ALTER TABLE inventory_count_records DROP COLUMN IF EXISTS duration_seconds;
ALTER TABLE inventory_count_records ADD COLUMN duration_seconds integer
  GENERATED ALWAYS AS (
    CASE WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
      THEN ROUND(EXTRACT(EPOCH FROM (finished_at - started_at))::numeric)::integer
      ELSE NULL
    END
  ) STORED;

-- Recriação idêntica à de 023_productivity.sql — nenhuma coluna/regra mudou,
-- só precisa ser refeita porque dependia de duration_seconds (dropada acima).
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
