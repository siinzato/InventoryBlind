-- 136 — Separação ciente de reserva, com consumo parcial.
--
-- ⚠️ NÃO APLICADA. Aguardando confirmação.
--
-- ── A regra, UMA só ───────────────────────────────────────────────────────────
--
--     depois de qualquer baixa:  físico restante >= reservado aberto
--
-- Essa frase sozinha resolve os três problemas de uma vez:
--   · retirada avulsa não leva caixa prometida a uma onda;
--   · separação de onda pode levar a SUA reserva, porque consumi-la a tira da conta
--     antes da baixa;
--   · o endereço não zera deixando reserva aberta para trás — se zerar, o reservado
--     aberto tem de ser 0, senão a regra barra a baixa. O "reservado fantasma" deixa de
--     ser um caso a tratar e passa a ser um estado impossível.
--
-- Duas regras separadas, uma para cada caminho, divergiriam na primeira manutenção.
--
-- ── Por que uma RPC nova e não mais parâmetros no pick ────────────────────────
-- `CREATE OR REPLACE` com número diferente de argumentos NÃO substitui: cria uma
-- sobrecarga. `wms_bin_pick(text,uuid,integer,text)` e um `wms_bin_pick` de 6 argumentos
-- com DEFAULT conviveriam, e toda chamada de 4 argumentos passaria a falhar com
-- "function is not unique" — o módulo inteiro de movimentação parado. Substituir de
-- verdade exigiria DROP + CREATE da função que está em produção agora.
--
-- Em vez disso: o pick mantém assinatura e passa a RECUSAR saldo reservado, e a
-- separação de onda ganha porta própria, que consome a reserva e delega a baixa ao
-- mesmo pick. A baixa e o movimento continuam existindo em UM lugar só.

-- ── 1. Retirada avulsa não invade reserva ─────────────────────────────────────
--
-- Corpo partido da definição VIVA do banco (conferida por pg_get_functiondef nesta
-- sessão), não de migration antiga. O que mudou está marcado NOVO; o resto é idêntico.
CREATE OR REPLACE FUNCTION public.wms_bin_pick(
  p_bin_code   text,
  p_product_id uuid,
  p_boxes      integer,
  p_reason     text DEFAULT 'abastecimento'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company  text;
  v_bin      uuid;
  v_boxes    integer;
  v_upb      integer;
  v_abertas  integer;
  v_movement uuid;
BEGIN
  v_company := wms_require_operator();

  IF p_boxes IS NULL OR p_boxes <= 0 THEN
    RAISE EXCEPTION 'Quantidade de caixas inválida';
  END IF;

  -- Endereço bloqueado ainda permite RETIRAR: bloqueio impede guardar mais, nunca
  -- impede esvaziar o que já está lá. Vale também para endereço desativado — desativar
  -- não pode prender o saldo que sobrou dentro dele.
  v_bin := wms_resolve_bin(v_company, p_bin_code, false);

  SELECT boxes, units_per_box INTO v_boxes, v_upb
  FROM warehouse_bin_stock
  WHERE company_id = v_company AND bin_id = v_bin AND product_id = p_product_id
  FOR UPDATE;

  IF v_boxes IS NULL THEN
    RAISE EXCEPTION 'Este produto não tem saldo no endereço %', p_bin_code;
  END IF;
  IF p_boxes > v_boxes THEN
    RAISE EXCEPTION 'Saldo insuficiente em %: % caixa(s) disponível(is)', p_bin_code, v_boxes;
  END IF;

  -- NOVO: a regra. O que sobra na prateleira tem de cobrir o que já foi prometido.
  -- Sem isto a reserva era decorativa: a onda A reservava 10 caixas e o operador da
  -- onda B bipava e levava.
  SELECT COALESCE(sum(boxes), 0) INTO v_abertas
  FROM warehouse_stock_reservations
  WHERE company_id = v_company AND bin_id = v_bin
    AND product_id = p_product_id AND status = 'aberta';

  IF v_boxes - p_boxes < v_abertas THEN
    RAISE EXCEPTION
      'Saldo reservado em %: % caixa(s) no endereço, % reservada(s) para separação. Libere a reserva antes de retirar avulso.',
      p_bin_code, v_boxes, v_abertas;
  END IF;

  IF p_boxes = v_boxes THEN
    DELETE FROM warehouse_bin_stock
    WHERE company_id = v_company AND bin_id = v_bin AND product_id = p_product_id;
  ELSE
    UPDATE warehouse_bin_stock
    SET boxes = boxes - p_boxes, updated_at = now()
    WHERE company_id = v_company AND bin_id = v_bin AND product_id = p_product_id;
  END IF;

  INSERT INTO warehouse_bin_movements
    (company_id, movement_type, product_id, from_bin_id, boxes, units_per_box, reason, created_by)
  VALUES (v_company, 'saida', p_product_id, v_bin, p_boxes, v_upb, p_reason, auth.uid())
  RETURNING id INTO v_movement;

  RETURN v_movement;
END;
$function$;

-- ── 2. Separação de onda: consome a reserva e delega a baixa ──────────────────
CREATE OR REPLACE FUNCTION public.wms_pick_for_wave(
  p_bin_code   text,
  p_product_id uuid,
  p_boxes      integer,
  p_owner_kind text,
  p_owner_id   uuid,
  p_reason     text DEFAULT 'separacao'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company  text;
  v_bin      uuid;
  v_saldo    integer;
  v_restante integer;
  v_res      record;
  v_sobrando integer;
  v_movement uuid;
BEGIN
  v_company := wms_require_operator();

  IF p_boxes IS NULL OR p_boxes <= 0 THEN
    RAISE EXCEPTION 'Quantidade de caixas inválida';
  END IF;
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'Separação de onda precisa do dono da reserva';
  END IF;

  v_bin := wms_resolve_bin(v_company, p_bin_code, false);

  -- Trava o SALDO primeiro e as reservas depois. Ordem fixa de lock é o que evita
  -- deadlock entre quem reserva e quem separa — `wms_reserve_stock` trava na mesma
  -- ordem, e inverter aqui bastaria para travar as duas no primeiro pico de uso.
  SELECT boxes INTO v_saldo
  FROM warehouse_bin_stock
  WHERE company_id = v_company AND bin_id = v_bin AND product_id = p_product_id
  FOR UPDATE;

  IF v_saldo IS NULL THEN
    RAISE EXCEPTION 'Este produto não tem saldo no endereço %', p_bin_code;
  END IF;

  -- ── Consumo da reserva PRÓPRIA, mais antiga primeiro ───────────────────────
  --
  -- Bipar menos caixas do que a reserva aberta é o caso NORMAL, não a exceção: a onda
  -- reserva o pedido inteiro e o operador tira o que cabe no carrinho. Por isso o
  -- consumo parcial divide a linha em vez de marcar a reserva inteira como consumida —
  -- marcar tudo devolveria à disponibilidade caixas que a onda ainda vai buscar.
  v_restante := p_boxes;

  FOR v_res IN
    SELECT id, boxes
    FROM warehouse_stock_reservations
    WHERE company_id = v_company AND bin_id = v_bin AND product_id = p_product_id
      AND status = 'aberta' AND owner_kind = p_owner_kind AND owner_id = p_owner_id
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_restante <= 0;

    IF v_res.boxes <= v_restante THEN
      UPDATE warehouse_stock_reservations
      SET status = 'consumida', settled_at = now(), settled_by = auth.uid()
      WHERE id = v_res.id;
      v_restante := v_restante - v_res.boxes;
    ELSE
      -- Divisão: a linha aberta encolhe e nasce uma irmã já liquidada com o que saiu.
      -- Assim `reservado = soma das abertas` continua valendo sem exceção, e o
      -- histórico guarda quanto daquela reserva virou separação de verdade. Uma coluna
      -- `boxes_consumidas` obrigaria toda consulta de disponibilidade a subtrair — e é
      -- aí que uma tela esquece e diverge da outra.
      INSERT INTO warehouse_stock_reservations
        (company_id, bin_id, product_id, boxes, units_per_box, status,
         owner_kind, owner_id, owner_ref, created_by, created_at, settled_at, settled_by)
      SELECT company_id, bin_id, product_id, v_restante, units_per_box, 'consumida',
             owner_kind, owner_id, owner_ref, created_by, created_at, now(), auth.uid()
      FROM warehouse_stock_reservations WHERE id = v_res.id;

      UPDATE warehouse_stock_reservations
      SET boxes = boxes - v_restante
      WHERE id = v_res.id;

      v_restante := 0;
    END IF;
  END LOOP;

  -- Bipar MAIS do que se reservou é permitido: o excedente simplesmente sai do saldo
  -- livre. Quem barra o excesso é a regra única lá embaixo, dentro do pick — o que não
  -- pode é esse excedente comer a reserva de outra onda.

  -- ── A baixa, no mesmo lugar de sempre ──────────────────────────────────────
  -- Delegar em vez de repetir: duplicar aqui o DELETE/UPDATE do saldo e o INSERT do
  -- movimento criaria dois caminhos de baixa para manter em sincronia. O pick revalida
  -- a regra com as reservas já consumidas, então a própria reserva da onda não barra a
  -- onda. A linha de saldo já está travada por esta transação.
  v_movement := wms_bin_pick(p_bin_code, p_product_id, p_boxes, p_reason);

  -- ── Guarda de impossibilidade ──────────────────────────────────────────────
  -- Pela regra, zerar o endereço com reserva aberta sobrando não acontece: o pick teria
  -- recusado. Esta checagem existe para que, se algum dia acontecer, a transação caia
  -- em vez de deixar reserva apontando para saldo que não existe mais — reserva órfã
  -- some da view de disponibilidade (que parte do saldo) e vira saldo preso invisível.
  IF NOT EXISTS (
    SELECT 1 FROM warehouse_bin_stock
    WHERE company_id = v_company AND bin_id = v_bin AND product_id = p_product_id
  ) THEN
    SELECT COALESCE(sum(boxes), 0) INTO v_sobrando
    FROM warehouse_stock_reservations
    WHERE company_id = v_company AND bin_id = v_bin
      AND product_id = p_product_id AND status = 'aberta';

    IF v_sobrando > 0 THEN
      RAISE EXCEPTION
        'Endereço % zerou com % caixa(s) ainda reservada(s) — estado inconsistente, operação desfeita',
        p_bin_code, v_sobrando;
    END IF;
  END IF;

  RETURN v_movement;
END;
$function$;

-- ── 3. Grants ─────────────────────────────────────────────────────────────────
--
-- Lição da 135: neste projeto o `ALTER DEFAULT PRIVILEGES` concede EXECUTE de toda
-- função nova para anon e authenticated. Revogar de `public` não basta — tem de nomear
-- os dois.
REVOKE ALL ON FUNCTION public.wms_pick_for_wave(text, uuid, integer, text, uuid, text) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.wms_pick_for_wave(text, uuid, integer, text, uuid, text) TO authenticated;
-- wms_bin_pick mantém o grant que já tinha: CREATE OR REPLACE preserva a ACL.

-- A regra de `is_active` em putaway e no destino da transferência fica para a 137: são
-- mais duas funções de produção redeclaradas, e cada redeclaração merece a própria
-- medição antes e depois.
