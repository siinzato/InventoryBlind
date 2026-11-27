-- 139 — Ondas de separação: o comportamento.
--
-- Montar, reservar, separar, fechar. Toda escrita nas tabelas da 138 passa por aqui —
-- elas só têm policy de SELECT.
--
-- ── O que a 138 deixou aberto ─────────────────────────────────────────────────
-- O REVOKE da 138 nomeou as quatro TABELAS e esqueceu a VIEW criada logo abaixo. Medido:
-- `picking_wave_route_v` ficou com INSERT/UPDATE/DELETE/TRUNCATE para anon e
-- authenticated. Na prática a view não é gravável (tem junção), e a RLS das tabelas de
-- baixo seguraria de qualquer jeito — mas privilégio que ninguém pretendeu conceder não
-- fica de pé esperando virar problema.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON picking_wave_route_v FROM public, anon, authenticated;

-- ── 1. A chave de caminhada ───────────────────────────────────────────────────
--
-- `PP-A01-N1` → `A0001001`. Rua primeiro porque é o corredor; módulo depois porque é a
-- distância dentro dele; nível por último porque subir e descer no mesmo módulo é o
-- movimento mais barato que existe.
--
-- IMMUTABLE para poder entrar em ORDER BY e em índice sem recalcular.
--
-- SERPENTINA: desligada por padrão, por decisão explícita. Ligada, inverte os módulos
-- nas ruas de ordem par, cortando a volta vazia no fim do corredor. A paridade sai da
-- LETRA da rua (A=0, B=1, …), o que supõe ruas sequenciais no alfabeto — é verdade no
-- cadastro atual (A a H), e é suposição declarada, não medida: não existe distância
-- levantada neste galpão para provar o ganho.
CREATE OR REPLACE FUNCTION public.wms_bin_route_key(
  p_code       text,
  p_serpentina boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_partes text[];
  v_rua    text;
  v_modulo integer;
  v_nivel  integer;
BEGIN
  v_partes := regexp_match(btrim(coalesce(p_code, '')), '^.+-([A-Za-z]+)([0-9]+)-N([0-9]+)$');

  -- Código fora do padrão vai para o FIM da rota, nunca para o começo: uma parada que o
  -- sistema não sabe localizar não pode abrir a caminhada do operador.
  IF v_partes IS NULL THEN
    RETURN 'ZZZZ' || btrim(coalesce(p_code, ''));
  END IF;

  v_rua    := upper(v_partes[1]);
  v_modulo := v_partes[2]::integer;
  v_nivel  := v_partes[3]::integer;

  IF p_serpentina AND (ascii(left(v_rua, 1)) - ascii('A')) % 2 = 1 THEN
    v_modulo := 9999 - v_modulo;
  END IF;

  RETURN v_rua || lpad(v_modulo::text, 4, '0') || lpad(v_nivel::text, 3, '0');
END;
$function$;

-- ── 2. Resolver um código bipado em produto ───────────────────────────────────
--
-- Devolve CANDIDATOS, no plural, e isso não é excesso de zelo: foram medidos 199 EANs
-- repetidos entre produtos do cadastro. Bipar um EAN pode casar com dois SKUs, e
-- escolher o primeiro silenciosamente é separar o produto errado com confirmação do
-- sistema. Quem decide o desempate é a tela, dentro do que a onda espera.
CREATE OR REPLACE FUNCTION public.picking_resolve_product(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company text;
  v_codigo  text;
  v_lista   jsonb;
BEGIN
  v_company := wms_require_operator();
  v_codigo  := btrim(coalesce(p_code, ''));

  IF v_codigo = '' THEN
    RETURN jsonb_build_object('codigo', '', 'candidatos', '[]'::jsonb);
  END IF;

  -- SECURITY DEFINER não herda RLS: o filtro por empresa é escrito à mão, sempre.
  SELECT coalesce(jsonb_agg(jsonb_build_object('product_id', id, 'sku', sku, 'name', name, 'ean', ean)), '[]'::jsonb)
  INTO v_lista
  FROM products
  WHERE company_id = v_company
    AND (upper(sku) = upper(v_codigo) OR btrim(coalesce(ean, '')) = v_codigo);

  RETURN jsonb_build_object('codigo', v_codigo, 'candidatos', v_lista);
END;
$function$;

-- ── 3. Montar a onda ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.picking_wave_create(
  p_origin     text DEFAULT 'manual',
  p_origin_ref text DEFAULT NULL,
  p_notes      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company text;
  v_ano     text;
  v_n       integer;
  v_code    text;
  v_id      uuid;
BEGIN
  v_company := wms_require_operator();
  v_ano     := to_char(now(), 'YYYY');

  -- Até cinco tentativas: o código é sequencial por ano e por empresa, e duas pessoas
  -- criando onda no mesmo segundo disputam o mesmo número. Quem resolve a disputa é o
  -- UNIQUE do banco; o laço só lê o próximo livre e tenta de novo.
  FOR i IN 1..5 LOOP
    SELECT coalesce(max(substring(code from '[0-9]+$')::integer), 0) + 1
    INTO v_n
    FROM picking_waves
    WHERE company_id = v_company AND code LIKE 'ONDA-' || v_ano || '-%';

    v_code := 'ONDA-' || v_ano || '-' || lpad(v_n::text, 4, '0');

    BEGIN
      INSERT INTO picking_waves (company_id, code, origin, origin_ref, notes)
      VALUES (v_company, v_code, coalesce(p_origin, 'manual'), p_origin_ref, p_notes)
      RETURNING id INTO v_id;
      RETURN v_id;
    EXCEPTION WHEN unique_violation THEN
      -- Só o código colidiu. Continua o laço e tenta o próximo.
      NULL;
    END;
  END LOOP;

  RAISE EXCEPTION 'Não foi possível gerar o código da onda — tente de novo';
END;
$function$;

CREATE OR REPLACE FUNCTION public.picking_wave_add_item(
  p_wave_id    uuid,
  p_product_id uuid,
  p_boxes      integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company text;
  v_status  text;
  v_sku     text;
  v_id      uuid;
BEGIN
  v_company := wms_require_operator();

  IF p_boxes IS NULL OR p_boxes <= 0 THEN
    RAISE EXCEPTION 'Quantidade de caixas inválida';
  END IF;

  SELECT status INTO v_status FROM picking_waves
  WHERE id = p_wave_id AND company_id = v_company FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Onda não encontrada';
  END IF;
  -- Mexer na demanda depois de reservar deixaria o plano descrevendo um pedido que já
  -- mudou. Para acrescentar item numa onda reservada, reserve de novo depois.
  IF v_status <> 'rascunho' THEN
    RAISE EXCEPTION 'A onda já saiu do rascunho: não dá para alterar a demanda agora';
  END IF;

  SELECT sku INTO v_sku FROM products WHERE id = p_product_id AND company_id = v_company;
  IF v_sku IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado nesta empresa';
  END IF;

  -- O mesmo SKU colado duas vezes soma na linha que já existe: é o que a lista colada
  -- espera, e duas linhas do mesmo produto gerariam duas alocações disputando o mesmo
  -- saldo.
  INSERT INTO picking_wave_items (company_id, wave_id, product_id, sku, boxes_demandadas)
  VALUES (v_company, p_wave_id, p_product_id, v_sku, p_boxes)
  ON CONFLICT (wave_id, product_id) DO UPDATE
    SET boxes_demandadas = picking_wave_items.boxes_demandadas + EXCLUDED.boxes_demandadas,
        updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.picking_wave_remove_item(p_item_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company text;
  v_status  text;
  v_total   integer;
BEGIN
  v_company := wms_require_operator();

  SELECT w.status INTO v_status
  FROM picking_wave_items i JOIN picking_waves w ON w.id = i.wave_id
  WHERE i.id = p_item_id AND i.company_id = v_company
  FOR UPDATE OF w;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Item não encontrado';
  END IF;
  IF v_status <> 'rascunho' THEN
    RAISE EXCEPTION 'A onda já saiu do rascunho: não dá para alterar a demanda agora';
  END IF;

  DELETE FROM picking_wave_items WHERE id = p_item_id AND company_id = v_company;
  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total > 0;
END;
$function$;

-- ── 4. O alocador ─────────────────────────────────────────────────────────────
--
-- Interna: não é RPC, e por isso ninguém a executa de fora. Cobre o que falta de UM item
-- varrendo os endereços com disponível, do lote mais VELHO para o mais novo — o FIFO já
-- era a ordem de consumo do módulo antes da onda existir.
--
-- Aqui mora a distinção que decide se a onda é usável:
--   · faltar saldo no galpão NÃO é erro — aloca o que dá e deixa o descoberto visível;
--   · alguém mexer no saldo no meio da alocação É erro — `wms_reserve_stock` recusa e a
--     transação inteira cai, porque nesse caso o plano foi montado sobre um número que
--     deixou de valer.
CREATE OR REPLACE FUNCTION public.picking_alocar_item(p_item_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company   text;
  v_item      record;
  v_wave_code text;
  v_restante  integer;
  v_alocado   integer := 0;
  v_bin       record;
  v_take      integer;
  v_res       uuid;
BEGIN
  SELECT i.*, w.code AS wave_code
  INTO v_item
  FROM picking_wave_items i JOIN picking_waves w ON w.id = i.wave_id
  WHERE i.id = p_item_id
  FOR UPDATE OF i;

  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Item não encontrado';
  END IF;

  v_company   := v_item.company_id;
  v_wave_code := v_item.wave_code;
  v_restante  := v_item.boxes_demandadas - v_item.boxes_alocadas;

  IF v_restante <= 0 THEN
    RETURN 0;
  END IF;

  -- `wms_bin_availability_v` é security_invoker, e dentro de SECURITY DEFINER o usuário
  -- efetivo é o dono da função — que não sofre RLS. O filtro por empresa é escrito à
  -- mão, sempre. Endereço bloqueado ou desativado fica de fora: bloqueado significa "não
  -- conte com isto", e `wms_reserve_stock` recusaria de qualquer forma.
  FOR v_bin IN
    SELECT b.id AS bin_id, b.code, v.boxes_disponivel, v.first_stored_at
    FROM wms_bin_availability_v v
    JOIN warehouse_storage_bins b ON b.id = v.bin_id
    WHERE v.company_id = v_company
      AND v.product_id = v_item.product_id
      AND v.boxes_disponivel > 0
      AND NOT v.bin_blocked
      AND v.bin_is_active
      AND NOT EXISTS (
        SELECT 1 FROM picking_allocations a
        WHERE a.item_id = p_item_id AND a.bin_id = b.id
      )
    ORDER BY v.first_stored_at, b.code
  LOOP
    EXIT WHEN v_restante <= 0;

    v_take := least(v_restante, v_bin.boxes_disponivel);

    v_res := wms_reserve_stock(
      v_bin.code, v_item.product_id, v_take, 'onda', v_item.wave_id, v_wave_code, NULL
    );

    INSERT INTO picking_allocations
      (company_id, wave_id, item_id, bin_id, reservation_id, boxes)
    VALUES (v_company, v_item.wave_id, p_item_id, v_bin.bin_id, v_res, v_take);

    v_restante := v_restante - v_take;
    v_alocado  := v_alocado + v_take;
  END LOOP;

  UPDATE picking_wave_items
  SET boxes_alocadas = boxes_alocadas + v_alocado,
      status = CASE
        WHEN boxes_separadas >= boxes_demandadas                 THEN 'atendido'
        WHEN boxes_alocadas + v_alocado >= boxes_demandadas      THEN 'alocado'
        WHEN boxes_alocadas + v_alocado > 0                      THEN 'parcial'
        ELSE 'sem_saldo'
      END,
      updated_at = now()
  WHERE id = p_item_id;

  RETURN v_alocado;
END;
$function$;

-- Reordena a caminhada. Chamada depois de alocar e depois de realocar: parada nova que
-- entrasse no fim da lista mandaria o operador voltar ao corredor que ele já passou.
CREATE OR REPLACE FUNCTION public.picking_resequenciar(p_wave_id uuid, p_serpentina boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer;
BEGIN
  WITH ordenado AS (
    SELECT a.id,
           row_number() OVER (
             ORDER BY wms_bin_route_key(b.code, p_serpentina),
                      s.first_stored_at NULLS LAST,
                      a.id
           ) AS seq
    FROM picking_allocations a
    JOIN picking_wave_items  i ON i.id = a.item_id
    JOIN warehouse_storage_bins b ON b.id = a.bin_id
    LEFT JOIN warehouse_bin_stock s
      ON s.company_id = a.company_id AND s.bin_id = a.bin_id AND s.product_id = i.product_id
    WHERE a.wave_id = p_wave_id
      AND a.status IN ('pendente','parcial')
  )
  UPDATE picking_allocations a
  SET sequencia = o.seq
  FROM ordenado o
  WHERE a.id = o.id AND a.sequencia IS DISTINCT FROM o.seq;

  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$function$;

-- ── 5. Reservar a onda ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.picking_wave_reserve(
  p_wave_id    uuid,
  p_serpentina boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company text;
  v_status  text;
  v_item    record;
  v_itens   integer := 0;
BEGIN
  v_company := wms_require_operator();

  SELECT status INTO v_status FROM picking_waves
  WHERE id = p_wave_id AND company_id = v_company FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Onda não encontrada';
  END IF;
  -- `reservada` também entra: reservar de novo é como se cobre o que faltou quando a
  -- mercadoria chegou depois.
  IF v_status NOT IN ('rascunho','reservada') THEN
    RAISE EXCEPTION 'Esta onda já está em separação ou encerrada';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM picking_wave_items WHERE wave_id = p_wave_id) THEN
    RAISE EXCEPTION 'Onda sem itens: nada a reservar';
  END IF;

  FOR v_item IN
    SELECT id FROM picking_wave_items
    WHERE wave_id = p_wave_id AND boxes_alocadas < boxes_demandadas
    ORDER BY sku
  LOOP
    PERFORM picking_alocar_item(v_item.id);
    v_itens := v_itens + 1;
  END LOOP;

  PERFORM picking_resequenciar(p_wave_id, p_serpentina);

  UPDATE picking_waves
  SET status = 'reservada',
      reserved_at = coalesce(reserved_at, now()),
      updated_at = now()
  WHERE id = p_wave_id;

  RETURN (
    SELECT jsonb_build_object(
      'wave_id',           p_wave_id,
      'itens_processados', v_itens,
      'demandado',         coalesce(sum(boxes_demandadas), 0),
      'alocado',           coalesce(sum(boxes_alocadas), 0),
      'descoberto',        coalesce(sum(boxes_demandadas - boxes_alocadas), 0),
      'paradas',           (SELECT count(*) FROM picking_allocations WHERE wave_id = p_wave_id AND status IN ('pendente','parcial'))
    )
    FROM picking_wave_items WHERE wave_id = p_wave_id
  );
END;
$function$;

-- ── 6. Separar uma parada, com identidade cega ────────────────────────────────
--
-- A tela mostra ENDEREÇO e QUANTIDADE, e não mostra qual SKU esperar. O operador bipa o
-- produto e o sistema confere — é isso que impede pegar o vizinho de prateleira e
-- confirmar no automático. Por isso a recusa aqui NUNCA diz qual era o certo.
--
-- `p_boxes = 0` significa "não tem nada aqui": declara ruptura, devolve a reserva e
-- tenta realocar o que faltou em outro endereço.
--
-- Bipar MENOS que o esperado mantém a parada ABERTA, de propósito: tirar o que cabe no
-- carrinho e voltar é o gesto normal da separação. Declarar falta é ação explícita
-- (`p_boxes = 0`), nunca dedução a partir de uma quantidade menor.
CREATE OR REPLACE FUNCTION public.picking_wave_pick(
  p_allocation_id   uuid,
  p_boxes           integer,
  p_scanned_bin     text,
  p_scanned_code    text,
  p_source          text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company   text;
  v_a         record;
  v_anterior  record;
  v_restante  integer;
  v_mov       uuid;
  v_falta     integer;
  v_realocado integer := 0;
  v_ok        boolean;
BEGIN
  v_company := wms_require_operator();

  IF p_source NOT IN ('scanner','camera','manual') THEN
    RAISE EXCEPTION 'Origem de leitura inválida';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Leitura sem chave de idempotência';
  END IF;
  IF p_boxes IS NULL OR p_boxes < 0 THEN
    RAISE EXCEPTION 'Quantidade de caixas inválida';
  END IF;

  -- Idempotência antes de tudo: rede ruim não pode virar caixa a mais.
  SELECT outcome, qty INTO v_anterior
  FROM picking_scan_events WHERE idempotency_key = p_idempotency_key;
  IF v_anterior.outcome IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', v_anterior.outcome, 'qty', v_anterior.qty, 'repetida', true);
  END IF;

  SELECT a.id, a.wave_id, a.item_id, a.bin_id, a.boxes, a.boxes_separadas, a.status,
         a.reservation_id, b.code AS bin_code, i.product_id, w.status AS wave_status
  INTO v_a
  FROM picking_allocations a
  JOIN picking_waves       w ON w.id = a.wave_id
  JOIN picking_wave_items  i ON i.id = a.item_id
  JOIN warehouse_storage_bins b ON b.id = a.bin_id
  WHERE a.id = p_allocation_id AND a.company_id = v_company
  FOR UPDATE OF a, w;

  IF v_a.id IS NULL THEN
    RAISE EXCEPTION 'Parada não encontrada';
  END IF;
  IF v_a.wave_status NOT IN ('reservada','em_separacao') THEN
    RAISE EXCEPTION 'Esta onda não está em separação';
  END IF;
  IF v_a.status NOT IN ('pendente','parcial') THEN
    RAISE EXCEPTION 'Esta parada já foi encerrada';
  END IF;

  -- ── Recusa é RETORNO, não exceção ──────────────────────────────────────────
  --
  -- Isto não é estilo. `RAISE` desfaz a transação inteira, e com ela o INSERT do evento
  -- que acabou de registrar a recusa: o log de divergência nunca chegaria ao banco, que
  -- é justamente o que ele existe para fazer. Bipar o endereço errado é resultado
  -- previsto da operação, não falha de programa — então volta como dado, e só o que é
  -- erro de verdade (parada inexistente, onda encerrada, origem inválida) levanta
  -- exceção.
  IF upper(btrim(coalesce(p_scanned_bin, ''))) <> upper(v_a.bin_code) THEN
    INSERT INTO picking_scan_events
      (company_id, wave_id, allocation_id, scanned_bin, scanned_code, qty, source, outcome, idempotency_key)
    VALUES (v_company, v_a.wave_id, v_a.id, p_scanned_bin, p_scanned_code, p_boxes, p_source, 'endereco_errado', p_idempotency_key);
    RETURN jsonb_build_object(
      'outcome', 'endereco_errado',
      'mensagem', 'O endereço bipado não é o desta parada'
    );
  END IF;

  v_restante := v_a.boxes - v_a.boxes_separadas;

  IF p_boxes > v_restante THEN
    INSERT INTO picking_scan_events
      (company_id, wave_id, allocation_id, scanned_bin, scanned_code, qty, source, outcome, idempotency_key)
    VALUES (v_company, v_a.wave_id, v_a.id, p_scanned_bin, p_scanned_code, p_boxes, p_source, 'quantidade_divergente', p_idempotency_key);
    RETURN jsonb_build_object(
      'outcome', 'quantidade_divergente',
      'maximo', v_restante,
      'mensagem', format('Esta parada espera no máximo %s caixa(s)', v_restante)
    );
  END IF;

  -- ── Ruptura ────────────────────────────────────────────────────────────────
  IF p_boxes = 0 THEN
    v_falta := v_restante;

    IF v_a.reservation_id IS NOT NULL THEN
      PERFORM wms_release_reservation_line(v_a.reservation_id, 'ruptura');
    END IF;

    UPDATE picking_allocations SET status = 'ruptura', updated_at = now() WHERE id = v_a.id;

    -- O que estava prometido aqui deixa de estar alocado, e o item tenta cobrir de novo
    -- em outro endereço. O endereço vazio não volta: ele já tem alocação registrada, e
    -- o alocador pula quem já está na lista do item.
    UPDATE picking_wave_items
    SET boxes_alocadas = greatest(0, boxes_alocadas - v_falta), updated_at = now()
    WHERE id = v_a.item_id;

    v_realocado := picking_alocar_item(v_a.item_id);
    PERFORM picking_resequenciar(v_a.wave_id);

    INSERT INTO picking_scan_events
      (company_id, wave_id, allocation_id, scanned_bin, scanned_code, qty, source, outcome, idempotency_key)
    VALUES (v_company, v_a.wave_id, v_a.id, p_scanned_bin, p_scanned_code, 0, p_source, 'ruptura', p_idempotency_key);

    UPDATE picking_waves
    SET status = 'em_separacao', started_at = coalesce(started_at, now()), updated_at = now()
    WHERE id = v_a.wave_id AND status = 'reservada';

    RETURN jsonb_build_object(
      'outcome', 'ruptura', 'faltou', v_falta, 'realocado', v_realocado
    );
  END IF;

  -- ── Identidade: o produto bipado é o desta parada? ─────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM products p
    WHERE p.id = v_a.product_id AND p.company_id = v_company
      AND (upper(p.sku) = upper(btrim(coalesce(p_scanned_code, '')))
           OR btrim(coalesce(p.ean, '')) = btrim(coalesce(p_scanned_code, '')))
  ) INTO v_ok;

  IF NOT v_ok THEN
    INSERT INTO picking_scan_events
      (company_id, wave_id, allocation_id, scanned_bin, scanned_code, qty, source, outcome, idempotency_key)
    VALUES (v_company, v_a.wave_id, v_a.id, p_scanned_bin, p_scanned_code, p_boxes, p_source, 'produto_errado', p_idempotency_key);
    -- A mensagem não diz qual era o produto certo: é a cegueira de identidade. Dizer
    -- "o esperado era X" transformaria a conferência em jogo de tentativa e erro.
    RETURN jsonb_build_object(
      'outcome', 'produto_errado',
      'mensagem', 'O produto bipado não é o desta parada'
    );
  END IF;

  -- ── A baixa, pelo motor da Etapa 1 ─────────────────────────────────────────
  v_mov := wms_pick_for_wave(v_a.bin_code, v_a.product_id, p_boxes, 'onda', v_a.wave_id, 'separacao');

  UPDATE picking_allocations
  SET boxes_separadas = boxes_separadas + p_boxes,
      movement_id     = v_mov,
      status          = CASE WHEN boxes_separadas + p_boxes >= boxes THEN 'separado' ELSE 'parcial' END,
      updated_at      = now()
  WHERE id = v_a.id;

  UPDATE picking_wave_items
  SET boxes_separadas = boxes_separadas + p_boxes,
      status = CASE
        WHEN boxes_separadas + p_boxes >= boxes_demandadas THEN 'atendido'
        ELSE 'parcial'
      END,
      updated_at = now()
  WHERE id = v_a.item_id;

  UPDATE picking_waves
  SET status = 'em_separacao', started_at = coalesce(started_at, now()), updated_at = now()
  WHERE id = v_a.wave_id AND status = 'reservada';

  INSERT INTO picking_scan_events
    (company_id, wave_id, allocation_id, scanned_bin, scanned_code, resolved_product_id,
     qty, source, outcome, idempotency_key)
  VALUES (v_company, v_a.wave_id, v_a.id, p_scanned_bin, p_scanned_code, v_a.product_id,
          p_boxes, p_source, 'ok', p_idempotency_key);

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'movimento', v_mov,
    'separado_nesta_parada', v_a.boxes_separadas + p_boxes,
    'restante_nesta_parada', v_restante - p_boxes
  );
END;
$function$;

-- ── 7. Fechar e cancelar ──────────────────────────────────────────────────────
--
-- Os dois liberam TODA reserva aberta da onda pelo mesmo caminho da Etapa 1. Reserva
-- aberta não sobrevive ao fechamento: saldo prometido a uma onda que acabou é saldo
-- preso que nenhuma tela explica.
CREATE OR REPLACE FUNCTION public.picking_wave_finish(p_wave_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company   text;
  v_status    text;
  v_liberadas integer;
  v_falta     integer;
  v_novo      text;
BEGIN
  v_company := wms_require_operator();

  SELECT status INTO v_status FROM picking_waves
  WHERE id = p_wave_id AND company_id = v_company FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Onda não encontrada';
  END IF;
  IF v_status NOT IN ('reservada','em_separacao') THEN
    RAISE EXCEPTION 'Esta onda já está encerrada';
  END IF;

  v_liberadas := wms_release_reservation('onda', p_wave_id, 'fechamento da onda');

  UPDATE picking_allocations
  SET status = 'cancelado', updated_at = now()
  WHERE wave_id = p_wave_id AND status = 'pendente';

  SELECT coalesce(sum(boxes_demandadas - boxes_separadas), 0) INTO v_falta
  FROM picking_wave_items WHERE wave_id = p_wave_id;

  v_novo := CASE WHEN v_falta > 0 THEN 'parcial' ELSE 'concluida' END;

  UPDATE picking_waves
  SET status = v_novo, finished_at = now(), updated_at = now()
  WHERE id = p_wave_id;

  RETURN jsonb_build_object(
    'wave_id', p_wave_id, 'status', v_novo,
    'faltou', v_falta, 'reservas_liberadas', v_liberadas
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.picking_wave_cancel(
  p_wave_id uuid,
  p_reason  text DEFAULT 'cancelamento'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company   text;
  v_status    text;
  v_liberadas integer;
BEGIN
  v_company := wms_require_operator();

  SELECT status INTO v_status FROM picking_waves
  WHERE id = p_wave_id AND company_id = v_company FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Onda não encontrada';
  END IF;
  IF v_status IN ('concluida','parcial','cancelada') THEN
    RAISE EXCEPTION 'Esta onda já está encerrada';
  END IF;

  v_liberadas := wms_release_reservation('onda', p_wave_id, p_reason);

  UPDATE picking_allocations
  SET status = 'cancelado', updated_at = now()
  WHERE wave_id = p_wave_id AND status IN ('pendente','parcial');

  UPDATE picking_waves
  SET status = 'cancelada', finished_at = now(), notes = coalesce(notes, p_reason), updated_at = now()
  WHERE id = p_wave_id;

  -- O que já foi separado NÃO volta para a prateleira: a mercadoria saiu de verdade, e
  -- devolvê-la é uma armazenagem nova, com movimento próprio. Cancelar a onda cancela a
  -- promessa, não o que já aconteceu.
  RETURN jsonb_build_object(
    'wave_id', p_wave_id, 'status', 'cancelada', 'reservas_liberadas', v_liberadas
  );
END;
$function$;

-- ── 8. Grants ─────────────────────────────────────────────────────────────────
--
-- Revogar de `public` não basta neste projeto: o ALTER DEFAULT PRIVILEGES do Supabase
-- concede EXECUTE de toda função nova para anon E authenticated. Nomeia-se os três.
REVOKE ALL ON FUNCTION public.wms_bin_route_key(text, boolean)                         FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.picking_alocar_item(uuid)                                FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.picking_resequenciar(uuid, boolean)                      FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.picking_resolve_product(text)                            FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.picking_wave_create(text, text, text)                    FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.picking_wave_add_item(uuid, uuid, integer)               FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.picking_wave_remove_item(uuid)                           FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.picking_wave_reserve(uuid, boolean)                      FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.picking_wave_pick(uuid, integer, text, text, text, uuid)  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.picking_wave_finish(uuid)                                FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.picking_wave_cancel(uuid, text)                          FROM public, anon, authenticated;

-- `wms_bin_route_key`, `picking_alocar_item` e `picking_resequenciar` ficam SEM grant:
-- são peças internas, chamadas de dentro das RPCs. Expor o alocador seria deixar
-- reservar saldo sem onda que responda por ele.
GRANT EXECUTE ON FUNCTION public.picking_resolve_product(text)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.picking_wave_create(text, text, text)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.picking_wave_add_item(uuid, uuid, integer)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.picking_wave_remove_item(uuid)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.picking_wave_reserve(uuid, boolean)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.picking_wave_pick(uuid, integer, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.picking_wave_finish(uuid)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.picking_wave_cancel(uuid, text)                          TO authenticated;
