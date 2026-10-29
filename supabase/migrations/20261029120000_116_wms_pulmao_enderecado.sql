/*
  # 116 — WMS: pulmão endereçado (porta-pallet)

  Controle de excesso de mercadoria no porta-pallet, no modelo de armazenagem do SAP:
  endereço (storage bin) → saldo por endereço (quant) → movimento como documento.

  ## O problema que isto resolve

  O excesso de têxtil e térmico vive no porta-pallet sem local fixo, porque a rotatividade
  é alta. Hoje achar o excesso de um SKU é procurar no olho, e `products.location` não
  comporta o caso: é UM campo de texto por produto, e no pulmão o mesmo SKU está em várias
  posições ao mesmo tempo. Não é falta de dado, é formato errado — por isso nasce um
  registro de OCUPAÇÃO em vez de mais um campo de endereço.

  ## O que NÃO é tocado

   - `products.location` e o campo de local do Tiny continuam sendo o VÃO DE PICKING das
     capas. Nada aqui lê, escreve ou depende deles.
   - `warehouse_cells` / Digital Twin: intocado. O mapa é um grid 2D de planta baixa e não
     comporta níveis de porta-pallet; ligar os dois é decisão futura, não pré-requisito.
   - Nenhuma tabela, policy ou função existente é alterada.

  ## O princípio central: saldo é consequência, nunca digitação

  `warehouse_bin_stock` e `warehouse_bin_movements` NÃO têm policy de INSERT/UPDATE/DELETE.
  Só as três RPCs SECURITY DEFINER abaixo escrevem nelas. É isso que torna o módulo
  auditável: todo saldo tem um documento de origem, com autor e horário, e ninguém "acerta
  o número na mão". Mesmo padrão já usado por `nfe_provider_fetch_locks` (060) e
  `api_key_rate_limits` (115).

  ## Guardas

  As RPCs seguem o que a auditoria da 115 estabeleceu: `SET search_path`, teste explícito
  de NULL para sessão/empresa/papel ANTES de qualquer comparação, `IS DISTINCT FROM` no
  lugar de `<>`, e EXECUTE revogado de PUBLIC/anon.
*/

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. Endereços de armazenagem (storage bins)
-- ─────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS warehouse_storage_bins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     text NOT NULL DEFAULT get_my_company_id(),
  -- 'P2-R04-N3' — prédio, rua, nível. O código carrega a ordem física do corredor, então
  -- ordenar por ele já produz a sequência de caminhada. É por isso que o módulo não
  -- depende de desenhar planta baixa.
  code           text NOT NULL,
  -- Só 'pulmao' é criado nesta etapa. O picking das capas está explicitamente fora e
  -- entrar aqui exigiria decisão própria — a coluna existe para o modelo ficar honesto,
  -- não para ser preenchida com 'picking' por conta própria.
  bin_type       text NOT NULL DEFAULT 'pulmao' CHECK (bin_type IN ('pulmao', 'picking')),
  -- NULL = sem limite declarado. Quando preenchida, a armazenagem recusa o que não cabe.
  capacity_boxes integer CHECK (capacity_boxes IS NULL OR capacity_boxes > 0),
  blocked        boolean NOT NULL DEFAULT false,
  blocked_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_storage_bins_code_unique UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS warehouse_storage_bins_company_idx ON warehouse_storage_bins (company_id, code);

ALTER TABLE warehouse_storage_bins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wms_bins_select" ON warehouse_storage_bins;
CREATE POLICY "wms_bins_select" ON warehouse_storage_bins FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

-- Criar e bloquear endereço é ato de gestão: mesma régua de warehouse_cells (031).
DROP POLICY IF EXISTS "wms_bins_insert" ON warehouse_storage_bins;
CREATE POLICY "wms_bins_insert" ON warehouse_storage_bins FOR INSERT
  TO authenticated WITH CHECK (
    company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager'])
  );

DROP POLICY IF EXISTS "wms_bins_update" ON warehouse_storage_bins;
CREATE POLICY "wms_bins_update" ON warehouse_storage_bins FOR UPDATE
  TO authenticated
  USING (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']))
  WITH CHECK (company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager']));

-- Sem policy de DELETE: endereço com histórico não se apaga, se bloqueia. A FK de
-- movimentos é RESTRICT justamente para isso.

DROP TRIGGER IF EXISTS warehouse_storage_bins_touch ON warehouse_storage_bins;
CREATE TRIGGER warehouse_storage_bins_touch
  BEFORE UPDATE ON warehouse_storage_bins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. Saldo por endereço (quant)
-- ─────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS warehouse_bin_stock (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      text NOT NULL DEFAULT get_my_company_id(),
  bin_id          uuid NOT NULL REFERENCES warehouse_storage_bins(id) ON DELETE RESTRICT,
  product_id      uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  boxes           integer NOT NULL CHECK (boxes > 0),
  -- A caixa fechada tem quantidade padronizada por SKU. O valor fica no saldo (e não em
  -- `products`) porque é o que estava NAQUELA entrada: se o fornecedor mudar o pack, o
  -- histórico não é reescrito. O front aprende o padrão do último movimento do SKU e não
  -- pergunta de novo.
  units_per_box   integer NOT NULL CHECK (units_per_box > 0),
  units           integer GENERATED ALWAYS AS (boxes * units_per_box) STORED,
  -- Idade do lote, para separação pelo mais antigo. Ao somar caixas novas a um saldo que
  -- já existe, a data ANTIGA é preservada: é o que faz o endereço velho ser consumido
  -- primeiro, em vez de rejuvenescer a cada entrada.
  first_stored_at timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Um saldo por produto por endereço. Endereço misturado é vários registros, e é assim
  -- que a mistura deixa de ser bagunça e vira dado.
  CONSTRAINT warehouse_bin_stock_unique UNIQUE (company_id, bin_id, product_id)
);

CREATE INDEX IF NOT EXISTS warehouse_bin_stock_product_idx ON warehouse_bin_stock (company_id, product_id);
CREATE INDEX IF NOT EXISTS warehouse_bin_stock_bin_idx     ON warehouse_bin_stock (bin_id);

ALTER TABLE warehouse_bin_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wms_stock_select" ON warehouse_bin_stock;
CREATE POLICY "wms_stock_select" ON warehouse_bin_stock FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

-- SEM policy de INSERT/UPDATE/DELETE, de propósito. Saldo só muda por movimento.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. Movimentos (o documento)
-- ─────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS warehouse_bin_movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     text NOT NULL DEFAULT get_my_company_id(),
  movement_type  text NOT NULL CHECK (movement_type IN ('entrada','saida','transferencia')),
  product_id     uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  from_bin_id    uuid REFERENCES warehouse_storage_bins(id) ON DELETE RESTRICT,
  to_bin_id      uuid REFERENCES warehouse_storage_bins(id) ON DELETE RESTRICT,
  boxes          integer NOT NULL CHECK (boxes > 0),
  units_per_box  integer NOT NULL CHECK (units_per_box > 0),
  -- 'recebimento', 'abastecimento', 'inventario', 'expedicao'… texto livre para o motivo
  -- não virar um enum que engessa a operação antes de ela existir.
  reason         text,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- A forma do documento é o que garante que origem e destino façam sentido.
  CONSTRAINT warehouse_bin_movements_shape CHECK (
    (movement_type = 'entrada'       AND from_bin_id IS NULL     AND to_bin_id IS NOT NULL) OR
    (movement_type = 'saida'         AND from_bin_id IS NOT NULL AND to_bin_id IS NULL)     OR
    (movement_type = 'transferencia' AND from_bin_id IS NOT NULL AND to_bin_id IS NOT NULL
                                     AND from_bin_id IS DISTINCT FROM to_bin_id)
  )
);

CREATE INDEX IF NOT EXISTS warehouse_bin_movements_company_idx ON warehouse_bin_movements (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS warehouse_bin_movements_product_idx ON warehouse_bin_movements (company_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS warehouse_bin_movements_from_idx    ON warehouse_bin_movements (from_bin_id);
CREATE INDEX IF NOT EXISTS warehouse_bin_movements_to_idx      ON warehouse_bin_movements (to_bin_id);

ALTER TABLE warehouse_bin_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wms_movements_select" ON warehouse_bin_movements;
CREATE POLICY "wms_movements_select" ON warehouse_bin_movements FOR SELECT
  TO authenticated USING (company_id = get_my_company_id());

-- SEM policy de escrita: o histórico não se edita nem se apaga.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4. Guarda comum das RPCs
-- ─────────────────────────────────────────────────────────────────────────────────────

/* Resolve a empresa da sessão e recusa quem não pode movimentar. Falha FECHADA: testa
   NULL antes de qualquer comparação de papel — foi exatamente a semântica de NULL que
   abriu o buraco corrigido na 115. `viewer` enxerga mas não movimenta. */
CREATE OR REPLACE FUNCTION public.wms_require_operator()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company text;
  v_role    text;
BEGIN
  v_company := get_my_company_id();
  v_role    := get_my_role();

  IF auth.uid() IS NULL OR v_company IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'Permission denied: authentication required';
  END IF;

  IF v_role NOT IN ('owner','admin','manager','counter','lead') THEN
    RAISE EXCEPTION 'Permission denied: insufficient role to move stock';
  END IF;

  RETURN v_company;
END;
$function$;

/* Endereço da empresa da sessão, pelo código. Recusa endereço inexistente, de outra
   empresa (a função é SECURITY DEFINER, então o filtro por empresa é explícito e não
   pode depender de RLS) ou bloqueado quando a operação exige destino livre. */
CREATE OR REPLACE FUNCTION public.wms_resolve_bin(p_company text, p_code text, p_require_unblocked boolean)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id      uuid;
  v_blocked boolean;
BEGIN
  SELECT id, blocked INTO v_id, v_blocked
  FROM warehouse_storage_bins
  WHERE company_id = p_company AND code = btrim(p_code);

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Endereço não encontrado: %', p_code;
  END IF;

  IF p_require_unblocked AND v_blocked THEN
    RAISE EXCEPTION 'Endereço bloqueado: %', p_code;
  END IF;

  RETURN v_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5. Armazenagem — entrada no pulmão
-- ─────────────────────────────────────────────────────────────────────────────────────

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

  INSERT INTO warehouse_bin_movements
    (company_id, movement_type, product_id, to_bin_id, boxes, units_per_box, reason, created_by)
  VALUES (v_company, 'entrada', p_product_id, v_bin, p_boxes, p_units_per_box, p_reason, auth.uid())
  RETURNING id INTO v_movement;

  RETURN v_movement;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6. Separação — saída do pulmão
-- ─────────────────────────────────────────────────────────────────────────────────────

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
  v_movement uuid;
BEGIN
  v_company := wms_require_operator();

  IF p_boxes IS NULL OR p_boxes <= 0 THEN
    RAISE EXCEPTION 'Quantidade de caixas inválida';
  END IF;

  -- Endereço bloqueado ainda permite RETIRAR: bloqueio impede guardar mais, nunca
  -- impede esvaziar o que já está lá.
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

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 7. Transferência entre endereços
-- ─────────────────────────────────────────────────────────────────────────────────────

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
    (company_id, movement_type, product_id, from_bin_id, to_bin_id, boxes, units_per_box, reason, created_by)
  VALUES (v_company, 'transferencia', p_product_id, v_from, v_to, p_boxes, v_upb, p_reason, auth.uid())
  RETURNING id INTO v_movement;

  RETURN v_movement;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 8. Consulta: onde está o excesso deste SKU
-- ─────────────────────────────────────────────────────────────────────────────────────

/* A pergunta que hoje custa meia hora de procura no olho. `security_invoker` para a view
   herdar a RLS de quem consulta — mesmo padrão das outras 8 views do projeto. */
CREATE OR REPLACE VIEW wms_product_stock_v
WITH (security_invoker = true) AS
SELECT
  s.company_id,
  s.product_id,
  p.sku,
  p.name          AS product_name,
  b.code          AS bin_code,
  b.blocked       AS bin_blocked,
  s.boxes,
  s.units_per_box,
  s.units,
  s.first_stored_at
FROM warehouse_bin_stock s
JOIN warehouse_storage_bins b ON b.id = s.bin_id
JOIN products p ON p.id = s.product_id;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 9. Grants — default deny, no padrão fixado pela 115
-- ─────────────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.wms_require_operator()                            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wms_resolve_bin(text, text, boolean)              FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.wms_bin_putaway(text, uuid, integer, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wms_bin_pick(text, uuid, integer, text)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wms_bin_transfer(text, text, uuid, integer, text)   FROM PUBLIC, anon;

GRANT  EXECUTE ON FUNCTION public.wms_bin_putaway(text, uuid, integer, integer, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.wms_bin_pick(text, uuid, integer, text)             TO authenticated;
GRANT  EXECUTE ON FUNCTION public.wms_bin_transfer(text, text, uuid, integer, text)   TO authenticated;

-- As duas auxiliares não são RPC: só são chamadas de dentro das três acima, que são
-- SECURITY DEFINER e por isso não precisam de grant para o chamador.

COMMENT ON TABLE warehouse_storage_bins IS
  'Endereços de armazenagem do pulmão (porta-pallet). O picking das capas NÃO é gerido aqui (migration 116).';
COMMENT ON TABLE warehouse_bin_stock IS
  'Saldo por endereço. Só as RPCs wms_* escrevem: saldo é consequência de movimento (migration 116).';
COMMENT ON TABLE warehouse_bin_movements IS
  'Documento de toda movimentação de pulmão, com autor e horário. Não se edita nem se apaga (migration 116).';
