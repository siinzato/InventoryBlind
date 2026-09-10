-- ─────────────────────────────────────────────────────────────────────────────
-- 049 — Geração automática de recontagem por limite de divergência
--
-- Hoje o fluxo existe, mas é manual e com regra fixa: `shouldRecommendRecount`
-- (physicalCountAlgorithm.ts) devolve true para QUALQUER divergência, e alguém
-- precisa clicar. Esta migration adiciona o limite configurável por empresa e faz
-- a criação acontecer sozinha no servidor.
--
-- ── O que NÃO foi criado, de propósito ──────────────────────────────────────
-- Nada de vínculo novo entre contagens. `physical_count_sessions` já tem
-- root_session_id / linked_session_id / count_number desde a 039, e
-- pc_create_recount_session já sabe copiar os itens divergentes preservando o
-- erp_quantity_snapshot do pai. Esta migration REUSA aquela função em vez de
-- reimplementar a criação — duas rotinas criando recontagem seriam duas
-- definições do que é uma recontagem.
--
-- ── Por que substituir pc_finalize_session ─────────────────────────────────
-- É o padrão do próprio projeto: a 041 já substituiu essa mesma função ("mesma
-- função da 039, só troca o cálculo de result_status"). Um trigger em
-- physical_count_sessions funcionaria, mas criar sessões a partir de um trigger
-- invisível é o tipo de coisa que ninguém encontra quando dá problema. Aqui a
-- chamada está escrita onde o desenvolvedor vai olhar.
--
-- Nenhuma migration existente foi alterada.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Configuração por empresa
--
-- Segue rca_settings (company_id como chave + limiares + updated_at), com uma
-- diferença: company_id é uuid, não text, porque esta tabela conversa com
-- physical_count_sessions, que é uuid. O projeto tem as duas convenções; casar com
-- a tabela da própria feature evita um cast em cada join.
--
-- `enabled` nasce FALSE. Quem não configurar nada continua com o fluxo manual de
-- hoje, sem nenhuma mudança de comportamento.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS physical_count_recount_settings (
  company_id uuid PRIMARY KEY DEFAULT get_my_company_id()::uuid
    REFERENCES companies(id) ON DELETE CASCADE,

  enabled boolean NOT NULL DEFAULT false,

  -- Três modos com nome explícito em vez de um par (tipo, valor) ambíguo. O
  -- pedido era "percentual ou valor", e existem duas leituras razoáveis de
  -- percentual — proporção de itens divergentes e desvio de unidades. Deixar isso
  -- implícito seria pedir para alguém configurar 5 achando que é uma coisa e
  -- receber a outra.
  --
  --   divergent_item_percent   itens divergentes ÷ itens contados × 100
  --   unit_deviation_percent   Σ|contado − ERP| ÷ Σ ERP × 100
  --   absolute_unit_deviation  Σ|contado − ERP| em unidades
  threshold_type text NOT NULL DEFAULT 'divergent_item_percent'
    CHECK (threshold_type IN ('divergent_item_percent', 'unit_deviation_percent', 'absolute_unit_deviation')),

  threshold_value numeric NOT NULL DEFAULT 5 CHECK (threshold_value > 0),

  -- Quem recebe o aviso. NULL = o responsável da contagem original, que é o
  -- comportamento esperado na maioria dos casos e evita obrigar a escolher uma
  -- pessoa fixa na configuração.
  notify_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE physical_count_recount_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'physical_count_recount_settings' AND policyname = 'pc_recount_settings_select') THEN
    -- Leitura para a empresa inteira: a tela de contagem precisa saber se a
    -- automação está ligada para explicar o que aconteceu, e não há segredo aqui.
    CREATE POLICY pc_recount_settings_select ON physical_count_recount_settings
      FOR SELECT TO authenticated
      USING ((company_id)::text = get_my_company_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'physical_count_recount_settings' AND policyname = 'pc_recount_settings_insert') THEN
    -- Escrita só para quem manda: a configuração decide quando o sistema cria
    -- trabalho para a equipe sozinho.
    CREATE POLICY pc_recount_settings_insert ON physical_count_recount_settings
      FOR INSERT TO authenticated
      WITH CHECK (
        (company_id)::text = get_my_company_id()
        AND get_my_role() = ANY (ARRAY['owner', 'admin', 'manager'])
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'physical_count_recount_settings' AND policyname = 'pc_recount_settings_update') THEN
    CREATE POLICY pc_recount_settings_update ON physical_count_recount_settings
      FOR UPDATE TO authenticated
      USING (
        (company_id)::text = get_my_company_id()
        AND get_my_role() = ANY (ARRAY['owner', 'admin', 'manager'])
      )
      WITH CHECK (
        (company_id)::text = get_my_company_id()
        AND get_my_role() = ANY (ARRAY['owner', 'admin', 'manager'])
      );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Registro das avaliações
--
-- Uma tabela que faz duas coisas de propósito: é a notificação do gestor e é o
-- rastro de auditoria da automação.
--
-- Grava também o que foi IGNORADO (`skipped`), não só o que gerou recontagem. Um
-- gestor que configurou 5% e não viu recontagem nenhuma precisa poder distinguir
-- "não passou do limite" de "passou e falhou" — sem isso a automação é uma caixa
-- preta que às vezes age.
--
-- Guarda o valor medido junto do limite aplicado, pela mesma razão: a linha se
-- explica sozinha ("12,4% acima do limite de 5%") em vez de exigir refazer a
-- conta à mão.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS physical_count_recount_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT get_my_company_id()::uuid
    REFERENCES companies(id) ON DELETE CASCADE,

  -- A contagem que acabou de ser fechada.
  source_session_id uuid NOT NULL REFERENCES physical_count_sessions(id) ON DELETE CASCADE,
  -- A recontagem criada. NULL quando foi ignorado ou falhou.
  recount_session_id uuid REFERENCES physical_count_sessions(id) ON DELETE SET NULL,

  status text NOT NULL CHECK (status IN ('created', 'skipped', 'failed')),
  -- Preenchido para skipped/failed. Código estável, não texto livre: a UI traduz.
  reason text,

  -- A regra aplicada, congelada no momento da avaliação. Se alguém mudar o limite
  -- amanhã, esta linha continua explicando a decisão que foi tomada ontem.
  threshold_type text NOT NULL,
  threshold_value numeric NOT NULL,
  measured_value numeric NOT NULL,

  -- As três medidas cruas, para a linha ser auditável sem recalcular nada.
  counted_items integer NOT NULL DEFAULT 0,
  divergent_items integer NOT NULL DEFAULT 0,
  absolute_unit_deviation numeric NOT NULL DEFAULT 0,

  -- Destinatário do aviso. NULL quando a contagem não tinha responsável e a
  -- configuração não indicou ninguém — nesse caso o aviso vale para todos os
  -- gestores, tratado na policy de leitura.
  recipient_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Uma avaliação por sessão. A finalização não acontece duas vezes (a própria
-- pc_finalize_session recusa), mas se um dia acontecer, isto impede duas
-- recontagens automáticas para a mesma contagem.
CREATE UNIQUE INDEX IF NOT EXISTS pc_recount_events_source_unique
  ON physical_count_recount_events (source_session_id);

-- O feed: não reconhecidos primeiro, mais recentes no topo. Parcial porque
-- reconhecido nunca volta a aparecer nesse caminho.
CREATE INDEX IF NOT EXISTS pc_recount_events_pending_idx
  ON physical_count_recount_events (company_id, created_at DESC)
  WHERE acknowledged_at IS NULL;

ALTER TABLE physical_count_recount_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'physical_count_recount_events' AND policyname = 'pc_recount_events_select') THEN
    -- Visível para a empresa. Não restringi ao recipient_id: uma recontagem
    -- automática é trabalho que apareceu para a operação, e esconder isso de quem
    -- não é o destinatário nominal só faria a equipe descobrir a sessão nova sem
    -- saber de onde veio.
    CREATE POLICY pc_recount_events_select ON physical_count_recount_events
      FOR SELECT TO authenticated
      USING ((company_id)::text = get_my_company_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'physical_count_recount_events' AND policyname = 'pc_recount_events_update') THEN
    -- Só para dar baixa no aviso. As colunas de decisão não são atualizáveis por
    -- ninguém — a RPC de acknowledge é o único caminho, e ela é SECURITY DEFINER.
    CREATE POLICY pc_recount_events_update ON physical_count_recount_events
      FOR UPDATE TO authenticated
      USING (
        (company_id)::text = get_my_company_id()
        AND get_my_role() = ANY (ARRAY['owner', 'admin', 'manager', 'lead'])
      )
      WITH CHECK ((company_id)::text = get_my_company_id());
  END IF;
END $$;

-- Sem policy de INSERT para `authenticated`: as linhas nascem só da avaliação
-- automática, que roda como SECURITY DEFINER. Um cliente que pudesse inserir aqui
-- poderia fabricar um rastro de auditoria.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A medida
--
-- Separada da decisão para poder ser conferida sozinha, e usando a MESMA regra
-- que a 041 usa em pc_finalize_session: total físico = physical_quantity +
-- found_elsewhere_quantity. Se esta função medisse só physical_quantity, um item
-- achado em outro lugar contaria como divergência aqui e como 'ok' lá, e a
-- automação dispararia por um problema que a tela diz não existir.
--
-- Σ|diff| e não Σdiff: +50 numa peça e −50 em outra somam zero, e um estoque com
-- cem unidades no lugar errado não é um estoque correto. O desvio líquido tem uso
-- (é o ajuste financeiro), mas como gatilho de recontagem ele apaga exatamente o
-- caso que mais pede recontagem.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_measure_session_divergence(p_session_id uuid)
RETURNS TABLE (
  counted_items integer,
  divergent_items integer,
  absolute_unit_deviation numeric,
  erp_total numeric
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
    coalesce(sum(i.erp_quantity_snapshot), 0)
  FROM physical_count_items i
  WHERE i.session_id = p_session_id
    -- Só itens efetivamente contados. Incluir pendentes trataria "não contado"
    -- como "contado zero", inflando o desvio.
    AND i.physical_quantity IS NOT NULL;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_measure_session_divergence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_measure_session_divergence(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. A avaliação
--
-- Decide e age. Nunca levanta exceção para o chamador: quem chama é a
-- finalização da contagem, e uma configuração ruim ou um limite de rodadas
-- atingido não pode impedir alguém de fechar uma contagem que já terminou. Todo
-- caminho termina gravando uma linha em physical_count_recount_events.
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
    -- Divisão protegida: sessão sem item contado mede zero, não erro.
    WHEN 'divergent_item_percent' THEN
      CASE WHEN v_m.counted_items > 0
        THEN (v_m.divergent_items::numeric / v_m.counted_items) * 100
        ELSE 0 END
    WHEN 'unit_deviation_percent' THEN
      CASE WHEN v_m.erp_total > 0
        THEN (v_m.absolute_unit_deviation / v_m.erp_total) * 100
        ELSE 0 END
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

  -- Passou do limite. As duas condições que impedem a criação são checadas aqui
  -- para render um motivo legível, em vez de deixar pc_create_recount_session
  -- levantar exceção e virar 'failed' com mensagem de banco.
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
    -- Só alcançável com absolute_unit_deviation, e mesmo assim não deveria: sem
    -- item divergente o desvio é zero. Tratado porque pc_create_recount_session
    -- recusa uma recontagem sem itens, e um 'failed' aqui seria enganoso.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Dar baixa no aviso
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_acknowledge_recount_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company text;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  UPDATE physical_count_recount_events
  SET acknowledged_at = now(), acknowledged_by = auth.uid()
  WHERE id = p_event_id
    -- O filtro por empresa é a barreira: SECURITY DEFINER ignora RLS, então sem
    -- esta cláusula um id de outra empresa seria reconhecido com sucesso.
    AND (company_id)::text = v_company
    AND acknowledged_at IS NULL;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_acknowledge_recount_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_acknowledge_recount_event(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. pc_finalize_session — mesma função da 041, com a avaliação no fim
--
-- Idêntica à versão da 041 (inclusive o cálculo por total físico) mais UMA
-- chamada antes do RETURN. Envolvida em bloco de exceção própria: se a avaliação
-- explodir por qualquer motivo, a contagem ainda fecha. Fechar contagem é o
-- fluxo crítico; gerar recontagem é conveniência.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pc_finalize_session(p_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company      text;
  v_sess_company uuid;
  v_status       text;
  v_pending      integer;
  v_divergent    integer;
  v_final_status text;
BEGIN
  v_company := get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active company';
  END IF;

  SELECT company_id, status INTO v_sess_company, v_status
  FROM physical_count_sessions WHERE id = p_session_id FOR UPDATE;

  IF v_sess_company IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_sess_company::text <> v_company THEN
    RAISE EXCEPTION 'Session belongs to another company';
  END IF;
  IF v_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Session is not in progress (cannot finalize twice)';
  END IF;

  SELECT count(*) INTO v_pending
  FROM physical_count_items WHERE session_id = p_session_id AND physical_quantity IS NULL;

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'Cannot finalize: % item(s) not yet counted', v_pending;
  END IF;

  UPDATE physical_count_items i
  SET
    result_status = CASE
      WHEN (i.physical_quantity + i.found_elsewhere_quantity) = i.erp_quantity_snapshot THEN 'ok'
      WHEN (i.physical_quantity + i.found_elsewhere_quantity) < i.erp_quantity_snapshot THEN 'missing'
      ELSE 'surplus'
    END,
    snapshot_product_name = p.name,
    snapshot_sku          = p.sku,
    snapshot_ean           = p.ean,
    updated_at = now()
  FROM products p
  WHERE i.session_id = p_session_id AND i.product_id = p.id;

  SELECT count(*) INTO v_divergent
  FROM physical_count_items
  WHERE session_id = p_session_id AND result_status <> 'ok';

  v_final_status := CASE WHEN v_divergent = 0 THEN 'completed' ELSE 'with_divergences' END;

  UPDATE physical_count_sessions
  SET status = v_final_status, finished_at = now(), finished_by = auth.uid(), updated_at = now()
  WHERE id = p_session_id;

  -- Novo na 049.
  BEGIN
    PERFORM pc_evaluate_auto_recount(p_session_id);
  EXCEPTION WHEN OTHERS THEN
    -- Engolido de propósito. A contagem está fechada e gravada; perder a
    -- recontagem automática é aceitável, perder o fechamento não é.
    NULL;
  END;

  RETURN v_final_status;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pc_finalize_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_finalize_session(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. updated_at
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS pc_recount_settings_updated_at ON physical_count_recount_settings;
    CREATE TRIGGER pc_recount_settings_updated_at
      BEFORE UPDATE ON physical_count_recount_settings
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMENT ON TABLE physical_count_recount_settings IS
  'Limite de divergência por empresa para recontagem automática. enabled=false por padrão: quem não configurar mantém o fluxo manual.';
COMMENT ON TABLE physical_count_recount_events IS
  'Rastro e notificação de cada avaliação automática de recontagem, incluindo as que não geraram recontagem e o motivo.';
