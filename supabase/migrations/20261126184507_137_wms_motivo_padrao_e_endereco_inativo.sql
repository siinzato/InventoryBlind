-- 137 — Motivo padronizado do movimento, e endereço desativado que recusa entrar.
--
-- ── Por que as duas coisas na mesma migration ─────────────────────────────────
-- As duas reescrevem `wms_bin_putaway` e `wms_bin_transfer`. Reescrever uma função de
-- produção duas vezes seguidas dobra a superfície de risco sem ganho nenhum: cada
-- redeclaração é uma chance de perder uma invariante em silêncio. Uma vez só, com as
-- guardas conferindo o resultado.
--
-- ── Por que NÃO um CHECK em `reason` ──────────────────────────────────────────
-- Era o plano, e medir o derrubou: `wms_nfe_putaway` (migration 124) passa
-- `'Recebimento NF-e ' || numero_da_nota` como motivo. Um CHECK com lista fechada em
-- `reason` recusaria TODO recebimento de nota fiscal — o módulo inteiro parado para
-- padronizar um rótulo.
--
-- `reason` é a NOTA HUMANA, e texto livre é o que ela precisa ser: o número da nota
-- importa para quem confere. O motivo padronizado é outro eixo, em coluna própria, com
-- lista fechada. Os dois convivem: um responde "por que isto aconteceu" para a pessoa,
-- o outro responde "que tipo de evento é este" para o relatório.
--
-- ── A lista ───────────────────────────────────────────────────────────────────
-- recebimento · separacao · abastecimento · transferencia · reposicao · devolucao ·
-- ajuste. Os três últimos ainda não têm quem os escreva: entram porque a lista fechada é
-- o contrato dos eventos que a Etapa 2 vai usar, e abrir a lista depois é migration nova
-- em cima de dado já gravado.

-- ── 1. A coluna ───────────────────────────────────────────────────────────────
--
-- Nasce anulável DE PROPÓSITO. NOT NULL com DEFAULT esconderia o movimento que ninguém
-- classificou atrás de um valor plausível; NOT NULL sem default, antes do backfill,
-- recusaria as linhas que já existem. A ordem é: criar, preencher, redeclarar quem
-- escreve, e só então travar.
ALTER TABLE warehouse_bin_movements
  ADD COLUMN IF NOT EXISTS movement_reason text;

COMMENT ON COLUMN warehouse_bin_movements.movement_reason IS
  'Tipo padronizado do evento (lista fechada). `reason` continua sendo a nota humana em texto livre.';

COMMENT ON COLUMN warehouse_bin_movements.reason IS
  'Nota humana em texto livre — carrega número de nota, observação do operador. Não é classificação: para isso existe `movement_reason`.';

-- ── 2. Backfill ───────────────────────────────────────────────────────────────
--
-- Classifica o que já está gravado. O `movement_type` é a base — ele já diz a FORMA do
-- movimento e tem CHECK desde a 116 — e o texto do `reason` refina quando reconhecido.
-- Entrada vira `recebimento` inclusive quando o texto é 'Recebimento NF-e 123': nota
-- fiscal é recebimento, e é justamente o caso que o CHECK em `reason` teria recusado.
UPDATE warehouse_bin_movements
SET movement_reason = CASE
  WHEN movement_type = 'entrada'       AND reason ILIKE 'devolu%'  THEN 'devolucao'
  WHEN movement_type = 'entrada'       AND reason ILIKE 'ajuste%'  THEN 'ajuste'
  WHEN movement_type = 'entrada'                                   THEN 'recebimento'
  WHEN movement_type = 'saida'         AND reason ILIKE 'separa%'  THEN 'separacao'
  WHEN movement_type = 'saida'         AND reason ILIKE 'ajuste%'  THEN 'ajuste'
  WHEN movement_type = 'saida'                                     THEN 'abastecimento'
  WHEN movement_type = 'transferencia' AND reason ILIKE 'reposi%'  THEN 'reposicao'
  ELSE 'transferencia'
END
WHERE movement_reason IS NULL;

-- ── 3. Quem escreve passa a classificar ───────────────────────────────────────
--
-- Os três corpos abaixo partem da definição VIVA do banco, lida por pg_get_functiondef
-- nesta sessão — não de migration antiga. O que muda em cada um está marcado NOVO; todo
-- o resto é idêntico, inclusive comentários.

-- 3.1 Armazenar: classifica como `recebimento` e recusa endereço DESATIVADO.
CREATE OR REPLACE FUNCTION public.wms_bin_putaway(
  p_bin_code      text,
  p_product_id    uuid,
  p_boxes         integer,
  p_units_per_box integer,
  p_reason        text DEFAULT 'recebimento'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company   text;
  v_bin       uuid;
  v_capacity  integer;
  v_ocupado   integer;
  v_movement  uuid;
BEGIN
  v_company := wms_require_operator();

  IF p_boxes IS NULL OR p_boxes <= 0 THEN
    RAISE EXCEPTION 'Quantidade de caixas inválida';
  END IF;
  IF p_units_per_box IS NULL OR p_units_per_box <= 0 THEN
    RAISE EXCEPTION 'Quantidade por caixa inválida';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Produto não encontrado nesta empresa';
  END IF;

  v_bin := wms_resolve_bin(v_company, p_bin_code, true);

  -- NOVO: endereço desativado recusa ENTRAR. A regra é a mesma do bloqueio, e o motivo é
  -- operacional: guardar mercadoria num endereço que a equipe tirou do mapa é criar
  -- saldo onde ninguém vai procurar. Sair continua liberado — ver o pick e a ORIGEM da
  -- transferência, que de propósito NÃO têm esta checagem: travar a saída prenderia o
  -- saldo residual dentro do endereço desativado, o oposto do que desativar significa.
  IF NOT EXISTS (SELECT 1 FROM warehouse_storage_bins WHERE id = v_bin AND is_active) THEN
    RAISE EXCEPTION 'Endereço desativado: %', p_bin_code;
  END IF;

  -- Capacidade só é cobrada quando foi declarada.
  SELECT capacity_boxes INTO v_capacity FROM warehouse_storage_bins WHERE id = v_bin;
  IF v_capacity IS NOT NULL THEN
    SELECT coalesce(sum(boxes), 0) INTO v_ocupado FROM warehouse_bin_stock WHERE bin_id = v_bin;
    IF v_ocupado + p_boxes > v_capacity THEN
      RAISE EXCEPTION 'Capacidade do endereço % excedida: % de % caixas ocupadas', p_bin_code, v_ocupado, v_capacity;
    END IF;
  END IF;

  -- Pack diferente do que já está no endereço é conflito real, não detalhe: somar as
  -- caixas sob um único `units_per_box` faria o saldo em unidades mentir para um dos dois
  -- lotes. Recusa explícita — o operador usa outro endereço, e tratar caixa de pack misto
  -- no mesmo saldo fica como decisão futura, não como arredondamento silencioso.
  IF EXISTS (
    SELECT 1 FROM warehouse_bin_stock
    WHERE company_id = v_company AND bin_id = v_bin AND product_id = p_product_id
      AND units_per_box IS DISTINCT FROM p_units_per_box
  ) THEN
    RAISE EXCEPTION 'Este endereço já tem este produto com outra quantidade por caixa';
  END IF;

  INSERT INTO warehouse_bin_stock (company_id, bin_id, product_id, boxes, units_per_box)
  VALUES (v_company, v_bin, p_product_id, p_boxes, p_units_per_box)
  ON CONFLICT (company_id, bin_id, product_id) DO UPDATE
    SET boxes      = warehouse_bin_stock.boxes + EXCLUDED.boxes,
        updated_at = now();
  -- `first_stored_at` fica de fora do DO UPDATE de propósito: o saldo mantém a idade da
  -- entrada mais antiga, para a separação por FIFO continuar correta.

  -- NOVO: `movement_reason`. Armazenagem é sempre recebimento — inclusive a da nota
  -- fiscal, cujo `reason` carrega o número da nota em texto livre.
  INSERT INTO warehouse_bin_movements
    (company_id, movement_type, movement_reason, product_id, to_bin_id, boxes, units_per_box, reason, created_by)
  VALUES (v_company, 'entrada', 'recebimento', p_product_id, v_bin, p_boxes, p_units_per_box, p_reason, auth.uid())
  RETURNING id INTO v_movement;

  RETURN v_movement;
END;
$function$;

-- 3.2 Retirar: classifica como `abastecimento`. Mantém TUDO que a 136 trouxe.
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

  -- A regra (136): o que sobra na prateleira tem de cobrir o que já foi prometido.
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

  -- NOVO: `movement_reason`. A retirada avulsa é abastecimento; a separação de onda
  -- reclassifica o movimento em `wms_pick_for_wave`, que é quem SABE que é onda.
  -- Classificar pelo texto de `p_reason` seria deixar a estatística depender de como o
  -- operador escreveu a observação.
  INSERT INTO warehouse_bin_movements
    (company_id, movement_type, movement_reason, product_id, from_bin_id, boxes, units_per_box, reason, created_by)
  VALUES (v_company, 'saida', 'abastecimento', p_product_id, v_bin, p_boxes, v_upb, p_reason, auth.uid())
  RETURNING id INTO v_movement;

  RETURN v_movement;
END;
$function$;

-- 3.3 Transferir: classifica como `transferencia` e recusa DESTINO desativado.
CREATE OR REPLACE FUNCTION public.wms_bin_transfer(
  p_from_bin_code text,
  p_to_bin_code   text,
  p_product_id    uuid,
  p_boxes         integer,
  p_reason        text DEFAULT 'transferencia'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company  text;
  v_from     uuid;
  v_to       uuid;
  v_boxes    integer;
  v_upb      integer;
  v_since    timestamptz;
  v_capacity integer;
  v_ocupado  integer;
  v_movement uuid;
BEGIN
  v_company := wms_require_operator();

  IF p_boxes IS NULL OR p_boxes <= 0 THEN
    RAISE EXCEPTION 'Quantidade de caixas inválida';
  END IF;

  v_from := wms_resolve_bin(v_company, p_from_bin_code, false);
  v_to   := wms_resolve_bin(v_company, p_to_bin_code, true);

  IF v_from IS NOT DISTINCT FROM v_to THEN
    RAISE EXCEPTION 'Origem e destino são o mesmo endereço';
  END IF;

  -- NOVO: só o DESTINO precisa estar ativo. A ORIGEM de propósito não: esvaziar um
  -- endereço desativado é exatamente o caminho de limpeza que precisa continuar aberto.
  IF NOT EXISTS (SELECT 1 FROM warehouse_storage_bins WHERE id = v_to AND is_active) THEN
    RAISE EXCEPTION 'Endereço desativado: %', p_to_bin_code;
  END IF;

  SELECT boxes, units_per_box, first_stored_at INTO v_boxes, v_upb, v_since
  FROM warehouse_bin_stock
  WHERE company_id = v_company AND bin_id = v_from AND product_id = p_product_id
  FOR UPDATE;

  IF v_boxes IS NULL THEN
    RAISE EXCEPTION 'Este produto não tem saldo no endereço %', p_from_bin_code;
  END IF;
  IF p_boxes > v_boxes THEN
    RAISE EXCEPTION 'Saldo insuficiente em %: % caixa(s) disponível(is)', p_from_bin_code, v_boxes;
  END IF;

  -- NOVO: a regra da 136 vale para a transferência também. Sem isto, mover a mercadoria
  -- de endereço seria o caminho aberto para esvaziar o que uma onda já prometeu — a
  -- reserva aponta para um endereço, e a caixa simplesmente sairia dele por outra porta.
  IF v_boxes - p_boxes < (
    SELECT COALESCE(sum(boxes), 0) FROM warehouse_stock_reservations
    WHERE company_id = v_company AND bin_id = v_from
      AND product_id = p_product_id AND status = 'aberta'
  ) THEN
    RAISE EXCEPTION
      'Saldo reservado em %: libere a reserva antes de transferir', p_from_bin_code;
  END IF;

  SELECT capacity_boxes INTO v_capacity FROM warehouse_storage_bins WHERE id = v_to;
  IF v_capacity IS NOT NULL THEN
    SELECT coalesce(sum(boxes), 0) INTO v_ocupado FROM warehouse_bin_stock WHERE bin_id = v_to;
    IF v_ocupado + p_boxes > v_capacity THEN
      RAISE EXCEPTION 'Capacidade do endereço % excedida', p_to_bin_code;
    END IF;
  END IF;

  -- Mesma recusa da armazenagem: o destino não pode somar caixas de pack diferente.
  IF EXISTS (
    SELECT 1 FROM warehouse_bin_stock
    WHERE company_id = v_company AND bin_id = v_to AND product_id = p_product_id
      AND units_per_box IS DISTINCT FROM v_upb
  ) THEN
    RAISE EXCEPTION 'O endereço % já tem este produto com outra quantidade por caixa', p_to_bin_code;
  END IF;

  IF p_boxes = v_boxes THEN
    DELETE FROM warehouse_bin_stock
    WHERE company_id = v_company AND bin_id = v_from AND product_id = p_product_id;
  ELSE
    UPDATE warehouse_bin_stock
    SET boxes = boxes - p_boxes, updated_at = now()
    WHERE company_id = v_company AND bin_id = v_from AND product_id = p_product_id;
  END IF;

  -- A idade viaja junto com a mercadoria: mudar de endereço não rejuvenesce estoque.
  INSERT INTO warehouse_bin_stock (company_id, bin_id, product_id, boxes, units_per_box, first_stored_at)
  VALUES (v_company, v_to, p_product_id, p_boxes, v_upb, v_since)
  ON CONFLICT (company_id, bin_id, product_id) DO UPDATE
    SET boxes           = warehouse_bin_stock.boxes + EXCLUDED.boxes,
        first_stored_at = LEAST(warehouse_bin_stock.first_stored_at, EXCLUDED.first_stored_at),
        updated_at      = now();

  INSERT INTO warehouse_bin_movements
    (company_id, movement_type, movement_reason, product_id, from_bin_id, to_bin_id, boxes, units_per_box, reason, created_by)
  VALUES (v_company, 'transferencia', 'transferencia', p_product_id, v_from, v_to, p_boxes, v_upb, p_reason, auth.uid())
  RETURNING id INTO v_movement;

  RETURN v_movement;
END;
$function$;

-- 3.4 Separação de onda: reclassifica o movimento que o pick acabou de gravar.
--
-- Quem sabe que é onda é esta função, não o texto da observação. O UPDATE é de uma linha
-- recém-criada na mesma transação — se a baixa falhar, não há movimento para reclassificar
-- porque não há transação que sobreviva.
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
  -- deadlock entre quem reserva e quem separa.
  SELECT boxes INTO v_saldo
  FROM warehouse_bin_stock
  WHERE company_id = v_company AND bin_id = v_bin AND product_id = p_product_id
  FOR UPDATE;

  IF v_saldo IS NULL THEN
    RAISE EXCEPTION 'Este produto não tem saldo no endereço %', p_bin_code;
  END IF;

  -- Consumo da reserva PRÓPRIA, mais antiga primeiro. Bipar menos caixas do que a
  -- reserva aberta é o caso NORMAL: por isso o consumo parcial divide a linha em vez de
  -- marcar a reserva inteira como consumida.
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

  -- A baixa e o movimento continuam existindo em UM lugar só.
  v_movement := wms_bin_pick(p_bin_code, p_product_id, p_boxes, p_reason);

  -- NOVO: reclassifica. O pick grava `abastecimento` porque é o que ele é sozinho.
  UPDATE warehouse_bin_movements
  SET movement_reason = 'separacao'
  WHERE id = v_movement AND company_id = v_company;

  -- Guarda de impossibilidade: pela regra, zerar o endereço com reserva aberta sobrando
  -- não acontece. Se acontecer, a transação cai em vez de deixar reserva órfã.
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

-- ── 4. Só agora a coluna trava ────────────────────────────────────────────────
--
-- Depois do backfill e depois de quem escreve passar a preencher. Sem DEFAULT: um
-- INSERT que esqueça de classificar tem de FALHAR, não herdar um motivo plausível.
ALTER TABLE warehouse_bin_movements
  ALTER COLUMN movement_reason SET NOT NULL;

ALTER TABLE warehouse_bin_movements
  DROP CONSTRAINT IF EXISTS warehouse_bin_movements_reason_check;

ALTER TABLE warehouse_bin_movements
  ADD CONSTRAINT warehouse_bin_movements_reason_check
  CHECK (movement_reason IN (
    'recebimento', 'separacao', 'abastecimento',
    'transferencia', 'reposicao', 'devolucao', 'ajuste'
  ));

-- O motivo tem de combinar com a FORMA do movimento. Sem isto, nada impediria uma
-- `entrada` classificada como `separacao` — e o relatório por motivo passaria a somar
-- caixa que entrou dentro do que saiu.
ALTER TABLE warehouse_bin_movements
  DROP CONSTRAINT IF EXISTS warehouse_bin_movements_reason_shape;

ALTER TABLE warehouse_bin_movements
  ADD CONSTRAINT warehouse_bin_movements_reason_shape
  CHECK (
    (movement_type = 'entrada'       AND movement_reason IN ('recebimento','devolucao','ajuste'))
    OR (movement_type = 'saida'      AND movement_reason IN ('separacao','abastecimento','ajuste'))
    OR (movement_type = 'transferencia' AND movement_reason IN ('transferencia','reposicao'))
  );

-- Relatório por motivo é a leitura que justifica a coluna existir.
CREATE INDEX IF NOT EXISTS warehouse_bin_movements_motivo_idx
  ON warehouse_bin_movements (company_id, movement_reason, created_at DESC);
