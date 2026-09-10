-- ─────────────────────────────────────────────────────────────────────────────
-- 048 — Snapshot agregado para a camada de inteligência
--
-- Uma RPC, uma ida ao banco, tudo somado em SQL. A alternativa — buscar
-- integration_stock_levels e contar no navegador — significaria trazer uma linha
-- por SKU por depósito para calcular seis números. Num catálogo de 8 mil SKUs em
-- quatro depósitos são 32 mil linhas atravessando a rede para produzir uma
-- contagem, em cada render do Dashboard.
--
-- ── O que esta função NÃO faz ────────────────────────────────────────────────
-- Ela não interpreta. Não calcula score, não decide o que é crítico, não emite
-- alerta. Devolve contagens cruas e deixa a interpretação para o Analytics/Health
-- Engine em TypeScript, onde é testável sem banco. Regra de negócio dentro de SQL
-- é regra de negócio que ninguém testa.
--
-- ── Por que jsonb e não uma tabela ──────────────────────────────────────────
-- Porque o resultado é um retrato de um instante, não um registro. Persistir isso
-- criaria a obrigação de invalidá-lo, e um número persistido desatualizado é
-- exatamente o que o requisito de "nunca mentir para o usuário" proíbe. Quem
-- quiser histórico usa integration_sync_runs, que já é durável.
--
-- ── Ausência de dado ≠ zero ─────────────────────────────────────────────────
-- Toda contagem vem acompanhada da informação de se havia base para contá-la.
-- `products_with_stock_rows` diz quantos SKUs têm alguma linha de saldo; sem isso
-- o cliente não consegue distinguir "nenhum SKU negativo" de "nenhum SKU
-- sincronizado ainda". As duas coisas contam zero e significam o oposto.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Índices que os agregados abaixo pedem ───────────────────────────────────

-- Negativos e zerados varrem saldo por empresa/conexão. Parcial nos negativos
-- porque é o subconjunto pequeno e o mais consultado — é o card que o operador
-- abre primeiro.
CREATE INDEX IF NOT EXISTS integration_stock_levels_negative_idx
  ON integration_stock_levels (company_id, connection_id)
  WHERE quantity < 0;

-- Frescor do dado. DESC porque a pergunta é sempre "qual a leitura mais recente".
CREATE INDEX IF NOT EXISTS integration_stock_levels_observed_idx
  ON integration_stock_levels (company_id, connection_id, observed_at DESC);

-- Produtos sem EAN. Parcial: só as linhas sem EAN entram, então o índice tem o
-- tamanho do problema e não o tamanho do catálogo.
CREATE INDEX IF NOT EXISTS integration_entity_links_missing_ean_idx
  ON integration_entity_links (company_id, connection_id)
  WHERE entity_type = 'product' AND (external_ean IS NULL OR external_ean = '');

-- ─────────────────────────────────────────────────────────────────────────────
-- integration_intelligence_snapshot
--
-- p_connection_id NULL = todas as conexões da empresa (visão consolidada).
-- Preenchido = uma conexão só (filtro de conexão do Dashboard).
--
-- SECURITY DEFINER com filtro explícito por company_id em TODA subconsulta. O
-- SECURITY DEFINER ignora RLS, então o isolamento aqui é responsabilidade destas
-- cláusulas WHERE — não há segunda barreira. Por isso a empresa vem de
-- get_my_company_id() e nunca de argumento: um company_id parametrizado seria
-- exatamente o vetor de vazamento entre tenants.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION integration_intelligence_snapshot(
  p_connection_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_result jsonb;
BEGIN
  -- get_my_company_id() devolve text; o cast é o mesmo usado nas policies desde a
  -- migration 039.
  v_company := NULLIF(get_my_company_id(), '')::uuid;

  IF v_company IS NULL THEN
    -- Sem empresa no JWT não há nada a agregar. Objeto vazio em vez de erro: o
    -- Dashboard trata isto como "sem contexto" e mostra o estado de onboarding.
    RETURN jsonb_build_object('company_scoped', false);
  END IF;

  -- Se um connection_id foi pedido, ele tem de pertencer à empresa. Sem esta
  -- verificação, um id de outra empresa produziria agregados daquela empresa,
  -- porque o SECURITY DEFINER não recusaria a leitura.
  IF p_connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM integration_connections
     WHERE id = p_connection_id AND company_id = v_company
  ) THEN
    -- Mesma resposta de "conexão inexistente". Diferenciar confirmaria que o id
    -- existe em outra empresa.
    RETURN jsonb_build_object('company_scoped', true, 'connection_found', false);
  END IF;

  SELECT jsonb_build_object(
    'company_scoped', true,
    'connection_found', true,
    'generated_at', now(),

    -- ── Conexões ───────────────────────────────────────────────────────────
    -- Sempre no escopo da empresa inteira, mesmo com filtro de conexão: o
    -- Dashboard precisa saber quantas existem para decidir se mostra o filtro.
    'connections', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'provider_key', c.provider_key,
        'display_name', c.display_name,
        'status', c.status,
        'sync_direction', c.sync_direction,
        'auto_sync_enabled', c.auto_sync_enabled,
        'sync_interval_minutes', c.sync_interval_minutes,
        'credentials_set_at', c.credentials_set_at,
        'last_sync_at', c.last_sync_at,
        'last_successful_sync_at', c.last_successful_sync_at,
        'last_error', c.last_error,
        'last_error_at', c.last_error_at,
        -- As capabilities vêm do catálogo de providers, não da conexão. É isso que
        -- permite ao Dashboard esconder uma métrica que o provedor não fornece sem
        -- precisar saber o nome do provedor.
        'capabilities', coalesce(p.capabilities, '{}'::jsonb)
      ) ORDER BY c.created_at), '[]'::jsonb)
        FROM integration_connections c
        LEFT JOIN integration_providers p ON p.key = c.provider_key
       WHERE c.company_id = v_company
    ),

    -- ── Catálogo sincronizado ──────────────────────────────────────────────
    'catalog', (
      SELECT jsonb_build_object(
        'linked_products', count(*),
        'without_ean', count(*) FILTER (WHERE l.external_ean IS NULL OR l.external_ean = ''),
        'without_sku', count(*) FILTER (WHERE l.external_sku IS NULL OR l.external_sku = ''),
        -- Vínculos criados por regra automática, não confirmados por ninguém. Não é
        -- erro, mas é a origem mais provável de um saldo escrito no produto errado.
        'auto_matched', count(*) FILTER (WHERE l.match_source IS DISTINCT FROM 'manual'),
        'last_linked_at', max(l.last_synced_at)
      )
        FROM integration_entity_links l
       WHERE l.company_id = v_company
         AND l.entity_type = 'product'
         AND (p_connection_id IS NULL OR l.connection_id = p_connection_id)
    ),

    -- ── Saldo ──────────────────────────────────────────────────────────────
    -- Agregado por produto (entity_link_id) e não por linha: um SKU com saldo −2
    -- no geral e +10 no Full não é "um SKU negativo", é um SKU cujo total é +8 com
    -- um depósito negativo. Contar linhas somaria as duas coisas num número que
    -- não responde a pergunta nenhuma.
    'stock', (
      SELECT jsonb_build_object(
        'products_with_stock_rows', count(*),
        'negative_products', count(*) FILTER (WHERE totals.total_quantity < 0),
        'zero_products', count(*) FILTER (WHERE totals.total_quantity = 0),
        'positive_products', count(*) FILTER (WHERE totals.total_quantity > 0),
        -- Depósito individual negativo com total positivo. Não é ruptura, é erro de
        -- lançamento — e some de qualquer visão que só olhe o total.
        'products_with_negative_warehouse', count(*) FILTER (
          WHERE totals.min_warehouse_quantity < 0 AND totals.total_quantity >= 0
        ),
        'products_without_warehouse', count(*) FILTER (WHERE totals.named_warehouses = 0),
        'total_units', coalesce(sum(totals.total_quantity), 0),
        'total_reserved', coalesce(sum(totals.total_reserved), 0),
        'oldest_observed_at', min(totals.oldest_observed_at),
        'newest_observed_at', max(totals.newest_observed_at)
      )
        FROM (
          SELECT s.entity_link_id,
                 sum(s.quantity) AS total_quantity,
                 min(s.quantity) AS min_warehouse_quantity,
                 sum(coalesce(s.reserved_quantity, 0)) AS total_reserved,
                 count(*) FILTER (
                   WHERE s.external_warehouse_id IS NOT NULL AND s.external_warehouse_id <> ''
                 ) AS named_warehouses,
                 min(s.observed_at) AS oldest_observed_at,
                 max(s.observed_at) AS newest_observed_at
            FROM integration_stock_levels s
           WHERE s.company_id = v_company
             AND (p_connection_id IS NULL OR s.connection_id = p_connection_id)
           GROUP BY s.entity_link_id
        ) totals
    ),

    -- ── Depósitos ──────────────────────────────────────────────────────────
    -- Distintos, para o Dashboard saber se vale mostrar qualquer coisa por
    -- depósito. Um provedor sem read_stock_by_warehouse devolve uma linha sem nome
    -- e este número fica em zero, que é a resposta honesta.
    'warehouses', (
      SELECT jsonb_build_object(
        'named_count', count(DISTINCT s.external_warehouse_id) FILTER (
          WHERE s.external_warehouse_id IS NOT NULL AND s.external_warehouse_id <> ''
        )
      )
        FROM integration_stock_levels s
       WHERE s.company_id = v_company
         AND (p_connection_id IS NULL OR s.connection_id = p_connection_id)
    ),

    -- ── Divergências ───────────────────────────────────────────────────────
    'discrepancies', (
      SELECT jsonb_build_object(
        'open', count(*) FILTER (WHERE k.status = 'open'),
        'resolved', count(*) FILTER (WHERE k.status = 'resolved'),
        'oldest_open_at', min(k.detected_at) FILTER (WHERE k.status = 'open'),
        'newest_open_at', max(k.detected_at) FILTER (WHERE k.status = 'open')
      )
        FROM integration_sync_conflicts k
       WHERE k.company_id = v_company
         AND (p_connection_id IS NULL OR k.connection_id = p_connection_id)
    ),

    -- ── Sincronização ──────────────────────────────────────────────────────
    'sync', (
      SELECT jsonb_build_object(
        'total_runs', count(*),
        'pending', count(*) FILTER (WHERE r.status = 'pending'),
        'running', count(*) FILTER (WHERE r.status = 'running'),
        -- Últimas 24 h: um erro de ontem já corrigido não deve pesar como se a
        -- integração estivesse quebrada agora.
        'failed_recent', count(*) FILTER (
          WHERE r.status = 'failed' AND r.started_at > now() - interval '24 hours'
        ),
        'partial_recent', count(*) FILTER (
          WHERE r.status = 'partial' AND r.started_at > now() - interval '24 hours'
        ),
        'succeeded_recent', count(*) FILTER (
          WHERE r.status = 'success' AND r.started_at > now() - interval '24 hours'
        ),
        'last_run_at', max(r.started_at),
        'last_success_at', max(r.finished_at) FILTER (WHERE r.status = 'success'),
        'last_duration_ms', (
          SELECT r2.duration_ms
            FROM integration_sync_runs r2
           WHERE r2.company_id = v_company
             AND (p_connection_id IS NULL OR r2.connection_id = p_connection_id)
             AND r2.finished_at IS NOT NULL
           ORDER BY r2.finished_at DESC
           LIMIT 1
        ),
        'last_records_total', (
          SELECT r3.records_total
            FROM integration_sync_runs r3
           WHERE r3.company_id = v_company
             AND (p_connection_id IS NULL OR r3.connection_id = p_connection_id)
             AND r3.finished_at IS NOT NULL
           ORDER BY r3.finished_at DESC
           LIMIT 1
        )
      )
        FROM integration_sync_runs r
       WHERE r.company_id = v_company
         AND (p_connection_id IS NULL OR r.connection_id = p_connection_id)
    ),

    -- ── Ajustes a caminho do ERP ───────────────────────────────────────────
    'adjustments', (
      SELECT jsonb_build_object(
        'pending', count(*) FILTER (WHERE a.sync_status = 'pending'),
        'sent', count(*) FILTER (WHERE a.sync_status = 'sent'),
        'confirmed', count(*) FILTER (WHERE a.sync_status = 'confirmed'),
        'failed', count(*) FILTER (WHERE a.sync_status = 'failed'),
        'awaiting_approval', count(*) FILTER (WHERE a.approved_at IS NULL),
        'oldest_pending_at', min(a.approved_at) FILTER (WHERE a.sync_status = 'pending')
      )
        FROM integration_stock_adjustments a
       WHERE a.company_id = v_company
         AND (p_connection_id IS NULL OR a.connection_id = p_connection_id)
    ),

    -- ── Alertas abertos ────────────────────────────────────────────────────
    'alerts', (
      SELECT jsonb_build_object(
        'open', count(*) FILTER (WHERE al.status IN ('open', 'acknowledged')),
        'critical', count(*) FILTER (
          WHERE al.status IN ('open', 'acknowledged') AND al.severity = 'critical'
        ),
        'warning', count(*) FILTER (
          WHERE al.status IN ('open', 'acknowledged') AND al.severity = 'warning'
        )
      )
        FROM integration_alerts al
       WHERE al.company_id = v_company
         AND (p_connection_id IS NULL OR al.connection_id = p_connection_id)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION integration_intelligence_snapshot(uuid) IS
  'Contagens cruas para o Analytics Engine. Não interpreta e não pontua — isso é feito em TypeScript, onde é testável. Empresa vem de get_my_company_id(), nunca de argumento.';

-- Só quem está autenticado. `anon` não tem empresa, então a função devolveria
-- company_scoped: false de qualquer forma, mas negar o EXECUTE é mais direto do
-- que depender disso.
REVOKE ALL ON FUNCTION integration_intelligence_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_intelligence_snapshot(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- integration_negative_stock_detail
--
-- O drill-down do card de negativos. Separado do snapshot porque o snapshot é
-- chamado em todo carregamento do Dashboard e esta lista só quando alguém clica —
-- embutir as linhas no snapshot faria todo mundo pagar por uma consulta que a
-- maioria não abre.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION integration_negative_stock_detail(
  p_connection_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  entity_link_id uuid,
  connection_id uuid,
  internal_product_id uuid,
  external_id text,
  sku text,
  ean text,
  product_name text,
  total_quantity numeric,
  worst_warehouse text,
  worst_warehouse_quantity numeric,
  observed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
BEGIN
  v_company := NULLIF(get_my_company_id(), '')::uuid;
  IF v_company IS NULL THEN RETURN; END IF;

  IF p_connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM integration_connections
     WHERE id = p_connection_id AND company_id = v_company
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH totals AS (
    SELECT s.entity_link_id,
           s.connection_id,
           sum(s.quantity) AS total_quantity,
           max(s.observed_at) AS observed_at
      FROM integration_stock_levels s
     WHERE s.company_id = v_company
       AND (p_connection_id IS NULL OR s.connection_id = p_connection_id)
     GROUP BY s.entity_link_id, s.connection_id
    HAVING sum(s.quantity) < 0
  ),
  worst AS (
    -- O depósito mais negativo de cada produto. DISTINCT ON evita uma window
    -- function sobre a tabela toda: para um produto em quatro depósitos, só
    -- interessa aquele em que o problema está.
    SELECT DISTINCT ON (s.entity_link_id)
           s.entity_link_id,
           s.external_warehouse_name,
           s.external_warehouse_id,
           s.quantity
      FROM integration_stock_levels s
      JOIN totals t ON t.entity_link_id = s.entity_link_id
     WHERE s.company_id = v_company
     ORDER BY s.entity_link_id, s.quantity ASC
  )
  SELECT t.entity_link_id,
         t.connection_id,
         l.internal_id,
         l.external_id,
         l.external_sku,
         l.external_ean,
         l.external_name,
         t.total_quantity,
         coalesce(w.external_warehouse_name, w.external_warehouse_id),
         w.quantity,
         t.observed_at
    FROM totals t
    JOIN integration_entity_links l ON l.id = t.entity_link_id
    LEFT JOIN worst w ON w.entity_link_id = t.entity_link_id
   WHERE l.company_id = v_company
   -- Pior primeiro: quem abre esta lista quer saber onde o buraco é maior.
   ORDER BY t.total_quantity ASC
   LIMIT greatest(1, least(coalesce(p_limit, 100), 500));
END;
$$;

COMMENT ON FUNCTION integration_negative_stock_detail(uuid, integer) IS
  'Drill-down do card de estoque negativo. Um produto por linha, com o depósito mais negativo identificado.';

REVOKE ALL ON FUNCTION integration_negative_stock_detail(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_negative_stock_detail(uuid, integer) TO authenticated;
