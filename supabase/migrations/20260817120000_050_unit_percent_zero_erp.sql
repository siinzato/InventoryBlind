-- ─────────────────────────────────────────────────────────────────────────────
-- 050 — Corrige o ponto cego do modo `unit_deviation_percent`
--
-- ── O defeito ───────────────────────────────────────────────────────────────
-- A 049 define esse modo como Σ|contado − ERP| ÷ Σ ERP × 100, com a divisão
-- protegida devolvendo 0 quando Σ ERP = 0. Protege contra NaN e erra na
-- substância: com saldo esperado zero, um desvio de qualquer tamanho mede 0% e
-- nunca alcança limite nenhum. A automação ficava cega justamente onde o estoque
-- mais discorda do sistema.
--
-- Não é hipótese. Duas sessões neste banco têm Σ ERP = 0 com desvio real de 800 e
-- de 8.790 unidades. Nas duas, o modo por unidade media 0%.
--
-- ── A correção ──────────────────────────────────────────────────────────────
-- Quando Σ ERP = 0, o denominador passa a ser o total físico encontrado.
--
-- Não é uma regra especial colada por fora: é o mesmo percentual medido contra a
-- única base que existe naquele caso. "Σ ERP = 0 e achamos 8.790" significa que
-- 100% do que foi encontrado era inesperado — e 100% é comparável a um limite,
-- aparece corretamente no relatório e dispensa texto especial na tela. Nos dois
-- casos reais o resultado é exatamente 100%, o mesmo que o modo por item já
-- reportava.
--
-- Alternativas descartadas:
--   • Disparar sempre que Σ ERP = 0 — trata o modo como booleano e grava um
--     measured_value que não se compara com o limite gravado ao lado.
--   • Gravar um número enorme como sentinela — mentira no rastro de auditoria.
--   • Comparar o desvio absoluto contra um limite percentual — 3 unidades contra
--     "5%" é uma comparação sem dimensão, que aprova ou recusa por acidente.
--
-- Onde Σ ERP > 0, NADA muda. A correção só alcança o caso em que a definição
-- anterior era indefinida.
--
-- ── Escopo ──────────────────────────────────────────────────────────────────
-- Os outros dois modos não têm o problema: `divergent_item_percent` divide por
-- itens contados, que só é zero quando o desvio também é, e
-- `absolute_unit_deviation` não divide.
--
-- Nenhuma migration existente foi alterada. `pc_finalize_session` não é tocada
-- aqui — a chamada da avaliação que a 049 inseriu continua valendo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A medida, agora devolvendo também o total físico
--
-- DROP antes de CREATE porque mudar as colunas de saída de uma função que
-- devolve TABLE não é permitido por CREATE OR REPLACE. `pc_evaluate_auto_recount`
-- resolve a chamada em tempo de execução, então o DROP não a invalida — e ela é
-- substituída logo abaixo de qualquer forma.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.pc_measure_session_divergence(uuid);

CREATE FUNCTION public.pc_measure_session_divergence(p_session_id uuid)
RETURNS TABLE (
  counted_items integer,
  divergent_items integer,
  absolute_unit_deviation numeric,
  erp_total numeric,
  -- Novo. Soma do total físico (local esperado + excedente em outro local), a base
  -- alternativa quando o ERP não oferece nenhuma.
  physical_total numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE (coalesce(i.physical_quantity, 0) + coalesce(i.found_elsewhere_quantity, 0))
            <> i.erp_quantity_snapshot
    )::integer,
    coalesce(sum(abs(
      (coalesce(i.physical_quantity, 0) + coalesce(i.found_elsewhere_quantity, 0))
      - i.erp_quantity_snapshot
    )), 0),
    coalesce(sum(i.erp_quantity_snapshot), 0),
    coalesce(sum(
      coalesce(i.physical_quantity, 0) + coalesce(i.found_elsewhere_quantity, 0)
    ), 0)
  FROM physical_count_items i
  WHERE i.session_id = p_session_id
    -- Só itens efetivamente contados. Incluir pendentes trataria "não contado"
    -- como "contado zero", inflando o desvio.
    AND i.physical_quantity IS NOT NULL;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_measure_session_divergence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_measure_session_divergence(uuid) TO authenticated;

COMMENT ON FUNCTION public.pc_measure_session_divergence(uuid) IS
  'Medida crua de divergência de uma sessão. physical_total existe para servir de denominador quando erp_total é zero — ver migration 050.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A avaliação
--
-- Igual à da 049 em tudo, exceto o denominador de `unit_deviation_percent`.
-- Reescrita inteira porque é plpgsql: não há como substituir só a expressão.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_evaluate_auto_recount(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_session    physical_count_sessions%ROWTYPE;
  v_settings   physical_count_recount_settings%ROWTYPE;
  v_m          RECORD;
  v_base       numeric;
  v_measured   numeric;
  v_recipient  uuid;
  v_recount_id uuid;
BEGIN
  SELECT * INTO v_session FROM physical_count_sessions WHERE id = p_session_id;
  IF v_session.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_settings
  FROM physical_count_recount_settings
  WHERE company_id = v_session.company_id;

  -- Desligado ou nunca configurado: silêncio total, nem linha de evento. Registrar
  -- um "skipped" por empresa que não usa a função encheria a tabela de ruído sobre
  -- uma decisão que ninguém tomou.
  IF v_settings.company_id IS NULL OR v_settings.enabled = false THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_m FROM pc_measure_session_divergence(p_session_id);

  v_measured := CASE v_settings.threshold_type
    -- Denominador = itens contados. Zero só quando o desvio também é zero, então
    -- não há caso indefinido a tratar aqui.
    WHEN 'divergent_item_percent' THEN
      CASE WHEN v_m.counted_items > 0
        THEN (v_m.divergent_items::numeric / v_m.counted_items) * 100
        ELSE 0 END

    -- ── A correção da 050 ───────────────────────────────────────────────────
    -- Denominador = saldo do ERP; na falta dele, o total físico encontrado. Com
    -- Σ ERP = 0 e algo encontrado, o resultado é 100% — todo o encontrado era
    -- inesperado. Com as duas bases em zero o desvio também é zero, e o CASE
    -- externo devolve 0 corretamente.
    WHEN 'unit_deviation_percent' THEN
      (SELECT CASE WHEN base > 0
                THEN (v_m.absolute_unit_deviation / base) * 100
                ELSE 0 END
         FROM (SELECT CASE WHEN v_m.erp_total > 0
                        THEN v_m.erp_total
                        ELSE v_m.physical_total END AS base) b)

    ELSE v_m.absolute_unit_deviation
  END;

  v_recipient := coalesce(v_settings.notify_user_id, v_session.responsible_id);

  -- Abaixo do limite: nada a fazer, mas registrado. É o que permite ao gestor
  -- confirmar que a automação olhou e decidiu não agir.
  IF v_measured < v_settings.threshold_value THEN
    INSERT INTO physical_count_recount_events (
      company_id, source_session_id, status, reason,
      threshold_type, threshold_value, measured_value,
      counted_items, divergent_items, absolute_unit_deviation, recipient_id,
      -- Já reconhecido: não é aviso, é registro. Aparecer no feed como pendência
      -- transformaria "está tudo bem" em uma notificação para dispensar.
      acknowledged_at
    ) VALUES (
      v_session.company_id, p_session_id, 'skipped', 'below_threshold',
      v_settings.threshold_type, v_settings.threshold_value, v_measured,
      v_m.counted_items, v_m.divergent_items, v_m.absolute_unit_deviation, v_recipient,
      now()
    )
    ON CONFLICT (source_session_id) DO NOTHING;

    RETURN NULL;
  END IF;

  IF v_session.count_number >= 3 THEN
    INSERT INTO physical_count_recount_events (
      company_id, source_session_id, status, reason,
      threshold_type, threshold_value, measured_value,
      counted_items, divergent_items, absolute_unit_deviation, recipient_id
    ) VALUES (
      v_session.company_id, p_session_id, 'skipped', 'max_rounds_reached',
      v_settings.threshold_type, v_settings.threshold_value, v_measured,
      v_m.counted_items, v_m.divergent_items, v_m.absolute_unit_deviation, v_recipient
    )
    ON CONFLICT (source_session_id) DO NOTHING;

    RETURN NULL;
  END IF;

  IF v_m.divergent_items = 0 THEN
    -- Inalcançável enquanto o CHECK exigir threshold_value > 0: desvio zero nunca
    -- alcança limite positivo, e o caso cai em below_threshold acima. Mantido
    -- porque pc_create_recount_session recusa recontagem sem item, e um 'failed'
    -- aqui seria enganoso.
    INSERT INTO physical_count_recount_events (
      company_id, source_session_id, status, reason,
      threshold_type, threshold_value, measured_value,
      counted_items, divergent_items, absolute_unit_deviation, recipient_id, acknowledged_at
    ) VALUES (
      v_session.company_id, p_session_id, 'skipped', 'no_divergent_items',
      v_settings.threshold_type, v_settings.threshold_value, v_measured,
      v_m.counted_items, v_m.divergent_items, v_m.absolute_unit_deviation, v_recipient, now()
    )
    ON CONFLICT (source_session_id) DO NOTHING;

    RETURN NULL;
  END IF;

  BEGIN
    -- Reusa a função da 039. Ela copia os itens divergentes, preserva o
    -- erp_quantity_snapshot do pai e já nasce in_progress.
    v_recount_id := pc_create_recount_session(p_session_id, v_settings.notify_user_id);

    INSERT INTO physical_count_recount_events (
      company_id, source_session_id, recount_session_id, status,
      threshold_type, threshold_value, measured_value,
      counted_items, divergent_items, absolute_unit_deviation, recipient_id
    ) VALUES (
      v_session.company_id, p_session_id, v_recount_id, 'created',
      v_settings.threshold_type, v_settings.threshold_value, v_measured,
      v_m.counted_items, v_m.divergent_items, v_m.absolute_unit_deviation, v_recipient
    )
    ON CONFLICT (source_session_id) DO NOTHING;

    RETURN v_recount_id;

  EXCEPTION WHEN OTHERS THEN
    -- A recontagem falhou; a finalização não pode falhar junto. A mensagem do
    -- banco é guardada para diagnóstico e o gestor vê que algo deveria ter sido
    -- criado e não foi — silêncio aqui seria a pior saída, porque a equipe ficaria
    -- esperando uma recontagem que nunca chegou.
    INSERT INTO physical_count_recount_events (
      company_id, source_session_id, status, reason,
      threshold_type, threshold_value, measured_value,
      counted_items, divergent_items, absolute_unit_deviation, recipient_id
    ) VALUES (
      v_session.company_id, p_session_id, 'failed', left(SQLERRM, 300),
      v_settings.threshold_type, v_settings.threshold_value, v_measured,
      v_m.counted_items, v_m.divergent_items, v_m.absolute_unit_deviation, v_recipient
    )
    ON CONFLICT (source_session_id) DO NOTHING;

    RETURN NULL;
  END;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_evaluate_auto_recount(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_evaluate_auto_recount(uuid) TO authenticated;
