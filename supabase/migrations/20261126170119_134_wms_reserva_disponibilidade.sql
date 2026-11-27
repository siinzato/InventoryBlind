-- 134 — Reserva de estoque e saldo disponível no pulmão endereçado.
--
-- ── O contrato ────────────────────────────────────────────────────────────────
--   físico     = warehouse_bin_stock.boxes            (o que a prateleira tem)
--   reservado  = Σ reservas abertas (bin, produto)    (promissória, não mercadoria)
--   disponível = físico − reservado                   (o que uma onda nova pode prometer)
--
-- ── O que esta migration NÃO faz ──────────────────────────────────────────────
-- Não redeclara wms_bin_pick, wms_bin_putaway nem wms_bin_transfer. Tornar a separação
-- ciente de reserva muda comportamento de produção e vai na 135, sozinha, para poder ser
-- medida antes e depois. Enquanto isso, a reserva é informativa: ela recusa reserva
-- sobreposta, mas ainda não impede uma separação avulsa de levar caixa reservada.
--
-- Aditivo por construção: nenhuma consulta existente muda de resultado.

-- Sem BEGIN/COMMIT explícitos: tanto `supabase db push` quanto a aplicação via conector
-- já envolvem a migration inteira numa transação. Abrir outra aqui dentro aninharia o
-- COMMIT e poderia fechar a transação de fora no meio do caminho — aplicação pela metade
-- é o pior resultado possível numa migration de saldo.

-- ── 1. O ledger de reservas ───────────────────────────────────────────────────
--
-- Linha, não contador. Uma coluna `boxes_reservados` em warehouse_bin_stock seria mais
-- barata e perderia QUEM reservou: no cancelamento de uma onda não haveria como saber
-- quanto devolver, e reserva presa por bug ficaria invisível. Aqui `reservado` é sempre
-- recalculável a partir dos fatos, e reserva órfã é consultável.
--
-- company_id é TEXT, como o resto do WMS: a convenção vem de get_my_company_id(), e
-- divergir aqui obrigaria cast em todo join com warehouse_bin_stock. A conversão do
-- tenant para uuid é dívida registrada, com plano próprio.
CREATE TABLE IF NOT EXISTS warehouse_stock_reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    text NOT NULL DEFAULT get_my_company_id(),
  bin_id        uuid NOT NULL REFERENCES warehouse_storage_bins(id) ON DELETE RESTRICT,
  product_id    uuid NOT NULL REFERENCES products(id)               ON DELETE RESTRICT,

  -- Reserva SEMPRE com endereço: reserva sem endereço não diz ao separador para onde ir.
  -- A escolha do endereço (FIFO por first_stored_at, picking antes de pulmão, curva ABC)
  -- é decisão da criação da onda, não deste ledger.

  -- Mesma unidade do saldo: caixas, com o pack junto. Reservar em unidade enquanto o
  -- saldo vive em caixa é como se cria divergência de arredondamento.
  boxes         integer NOT NULL CHECK (boxes > 0),
  units_per_box integer NOT NULL CHECK (units_per_box > 0),

  status        text NOT NULL DEFAULT 'aberta'
                CHECK (status IN ('aberta','consumida','liberada','expirada')),

  -- Reserva sem dono é reserva que ninguém libera.
  owner_kind    text NOT NULL CHECK (owner_kind IN ('onda','pedido','reposicao','manual')),
  owner_id      uuid NOT NULL,
  owner_ref     text,

  -- Rede de segurança contra reserva órfã: onda abandonada devolve saldo sozinha.
  expires_at    timestamptz,

  created_by    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  settled_at    timestamptz,
  settled_by    uuid,

  CONSTRAINT reserva_aberta_sem_liquidacao
    CHECK ((status = 'aberta') = (settled_at IS NULL))
);

COMMENT ON TABLE warehouse_stock_reservations IS
  'Ledger de reservas de saldo por endereço. Reserva não move mercadoria: saldo físico só muda por warehouse_bin_movements.';

-- O caminho quente é "quanto está reservado neste endereço para este produto".
-- Índice parcial: reserva liquidada é histórico e não entra na conta.
CREATE INDEX IF NOT EXISTS warehouse_stock_reservations_abertas_idx
  ON warehouse_stock_reservations (company_id, bin_id, product_id)
  WHERE status = 'aberta';

CREATE INDEX IF NOT EXISTS warehouse_stock_reservations_dono_idx
  ON warehouse_stock_reservations (company_id, owner_kind, owner_id)
  WHERE status = 'aberta';

CREATE INDEX IF NOT EXISTS warehouse_stock_reservations_expiracao_idx
  ON warehouse_stock_reservations (expires_at)
  WHERE status = 'aberta' AND expires_at IS NOT NULL;

-- ── 2. RLS no mesmo padrão do saldo ───────────────────────────────────────────
--
-- SÓ leitura por policy. Escrever reserva é operação de negócio com invariante
-- (`reservado <= físico`), e invariante que depende de OUTRA linha não se defende em
-- policy: defende-se em RPC, com lock.
ALTER TABLE warehouse_stock_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wms_reservations_select ON warehouse_stock_reservations;
CREATE POLICY wms_reservations_select ON warehouse_stock_reservations
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON warehouse_stock_reservations FROM anon, authenticated;

-- De quebra, fecha a porta que já estava destrancada no saldo: hoje `authenticated` tem
-- grant de escrita em warehouse_bin_stock e só não escreve porque não existe policy
-- permissiva. Segurança apoiada na AUSÊNCIA de uma policy quebra no dia em que alguém
-- adicionar uma por outro motivo. As RPCs são SECURITY DEFINER e não dependem destes
-- grants.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON warehouse_bin_stock, warehouse_bin_movements FROM anon, authenticated;

-- ── 3. Disponibilidade: derivada, nunca coluna ────────────────────────────────
--
-- security_invoker=true pelo mesmo motivo de wms_product_stock_v: sem ele a view roda
-- como dona e devolve o galpão das outras empresas.
CREATE OR REPLACE VIEW wms_bin_availability_v
WITH (security_invoker = true) AS
SELECT
  s.company_id,
  s.bin_id,
  b.code                                                       AS bin_code,
  b.bin_type,
  b.blocked                                                    AS bin_blocked,
  b.is_active                                                  AS bin_is_active,
  s.product_id,
  p.sku,
  s.units_per_box,
  s.boxes                                                      AS boxes_fisico,
  COALESCE(r.boxes_reservado, 0)                               AS boxes_reservado,
  s.boxes - COALESCE(r.boxes_reservado, 0)                     AS boxes_disponivel,
  s.units                                                      AS units_fisico,
  COALESCE(r.boxes_reservado, 0) * s.units_per_box             AS units_reservado,
  (s.boxes - COALESCE(r.boxes_reservado, 0)) * s.units_per_box AS units_disponivel,
  s.first_stored_at
FROM warehouse_bin_stock s
JOIN warehouse_storage_bins b ON b.id = s.bin_id
JOIN products p               ON p.id = s.product_id
LEFT JOIN LATERAL (
  SELECT sum(res.boxes)::integer AS boxes_reservado
  FROM warehouse_stock_reservations res
  WHERE res.company_id = s.company_id
    AND res.bin_id     = s.bin_id
    AND res.product_id = s.product_id
    AND res.status     = 'aberta'
) r ON true;

COMMENT ON VIEW wms_bin_availability_v IS
  'Físico, reservado e disponível por endereço. Disponível é sempre derivado — nunca coluna.';

-- Saldo por SKU. Deliberadamente NÃO traz products.stock_quantity: aquele é o saldo do
-- ERP, e somar os dois na mesma linha é o convite para alguém reservar contra o número
-- errado. Cobertura de endereçamento (ERP × endereçado) é relatório próprio.
CREATE OR REPLACE VIEW wms_product_availability_v
WITH (security_invoker = true) AS
SELECT
  company_id,
  product_id,
  sku,
  sum(boxes_fisico)::integer      AS boxes_fisico,
  sum(boxes_reservado)::integer   AS boxes_reservado,
  sum(boxes_disponivel)::integer  AS boxes_disponivel,
  sum(units_fisico)::integer      AS units_fisico,
  sum(units_reservado)::integer   AS units_reservado,
  sum(units_disponivel)::integer  AS units_disponivel,
  count(*)::integer               AS enderecos
FROM wms_bin_availability_v
GROUP BY company_id, product_id, sku;

-- ── 4. Reservar ───────────────────────────────────────────────────────────────
--
-- A invariante `reservado <= físico` só vale se duas ondas simultâneas não puderem ler o
-- mesmo saldo antes de qualquer uma gravar. O ponto de serialização é o MESMO que
-- wms_bin_pick e wms_bin_transfer já usam: FOR UPDATE na linha de warehouse_bin_stock.
-- Travar sempre o SALDO primeiro e as reservas depois — ordem fixa de lock é o que evita
-- deadlock entre reservar e separar.
CREATE OR REPLACE FUNCTION public.wms_reserve_stock(
  p_bin_code    text,
  p_product_id  uuid,
  p_boxes       integer,
  p_owner_kind  text,
  p_owner_id    uuid,
  p_owner_ref   text        DEFAULT NULL,
  p_expires_at  timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company   text;
  v_bin       uuid;
  v_boxes     integer;
  v_upb       integer;
  v_reservado integer;
  v_reserva   uuid;
BEGIN
  v_company := wms_require_operator();

  IF p_boxes IS NULL OR p_boxes <= 0 THEN
    RAISE EXCEPTION 'Quantidade de caixas inválida';
  END IF;
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'Reserva precisa de dono: informe a onda ou o pedido';
  END IF;

  -- Endereço bloqueado não recebe reserva: bloqueio significa "não conte com isto".
  v_bin := wms_resolve_bin(v_company, p_bin_code, true);

  SELECT boxes, units_per_box INTO v_boxes, v_upb
  FROM warehouse_bin_stock
  WHERE company_id = v_company AND bin_id = v_bin AND product_id = p_product_id
  FOR UPDATE;

  IF v_boxes IS NULL THEN
    RAISE EXCEPTION 'Este produto não tem saldo no endereço %', p_bin_code;
  END IF;

  SELECT COALESCE(sum(boxes), 0) INTO v_reservado
  FROM warehouse_stock_reservations
  WHERE company_id = v_company AND bin_id = v_bin
    AND product_id = p_product_id AND status = 'aberta';

  IF v_reservado + p_boxes > v_boxes THEN
    RAISE EXCEPTION
      'Disponível insuficiente em %: % caixa(s) no endereço, % já reservada(s)',
      p_bin_code, v_boxes, v_reservado;
  END IF;

  INSERT INTO warehouse_stock_reservations
    (company_id, bin_id, product_id, boxes, units_per_box,
     owner_kind, owner_id, owner_ref, expires_at)
  VALUES (v_company, v_bin, p_product_id, p_boxes, v_upb,
          p_owner_kind, p_owner_id, p_owner_ref, p_expires_at)
  RETURNING id INTO v_reserva;

  RETURN v_reserva;
END;
$function$;

-- ── 5. Liberar ────────────────────────────────────────────────────────────────
--
-- Libera por DONO, não por id: cancelar uma onda precisa devolver tudo de uma vez, e
-- devolver linha a linha deixa metade presa quando uma falha no meio.
CREATE OR REPLACE FUNCTION public.wms_release_reservation(
  p_owner_kind text,
  p_owner_id   uuid,
  p_reason     text DEFAULT 'cancelamento'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company text;
  v_total   integer;
BEGIN
  v_company := wms_require_operator();

  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'Informe o dono da reserva a liberar';
  END IF;

  UPDATE warehouse_stock_reservations
  SET status     = 'liberada',
      settled_at = now(),
      settled_by = auth.uid(),
      owner_ref  = COALESCE(owner_ref, p_reason)
  WHERE company_id = v_company
    AND owner_kind = p_owner_kind
    AND owner_id   = p_owner_id
    AND status     = 'aberta';

  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$function$;

-- Liberar UMA linha, para o caso em que a onda perde um item e mantém o resto.
CREATE OR REPLACE FUNCTION public.wms_release_reservation_line(
  p_reservation_id uuid,
  p_reason         text DEFAULT 'cancelamento'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company text;
  v_total   integer;
BEGIN
  v_company := wms_require_operator();

  UPDATE warehouse_stock_reservations
  SET status     = 'liberada',
      settled_at = now(),
      settled_by = auth.uid(),
      owner_ref  = COALESCE(owner_ref, p_reason)
  WHERE id = p_reservation_id AND company_id = v_company AND status = 'aberta';

  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total > 0;
END;
$function$;

-- ── 6. Varredura de reserva vencida ───────────────────────────────────────────
--
-- Sem isto, onda abandonada segura saldo para sempre e a tela diz "sem disponível" com a
-- prateleira cheia. pg_cron já está habilitado no projeto (migration 046); o agendamento
-- fica para a migration da onda, quando houver prazo definido de validade.
CREATE OR REPLACE FUNCTION public.wms_expire_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer;
BEGIN
  UPDATE warehouse_stock_reservations
  SET status = 'expirada', settled_at = now()
  WHERE status = 'aberta' AND expires_at IS NOT NULL AND expires_at < now();

  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$function$;

-- ── 7. Grants: negar por omissão, como o resto do projeto ─────────────────────
REVOKE ALL ON FUNCTION public.wms_reserve_stock(text, uuid, integer, text, uuid, text, timestamptz) FROM public, anon;
REVOKE ALL ON FUNCTION public.wms_release_reservation(text, uuid, text)                             FROM public, anon;
REVOKE ALL ON FUNCTION public.wms_release_reservation_line(uuid, text)                              FROM public, anon;
REVOKE ALL ON FUNCTION public.wms_expire_reservations()                                             FROM public, anon;

GRANT EXECUTE ON FUNCTION public.wms_reserve_stock(text, uuid, integer, text, uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wms_release_reservation(text, uuid, text)                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.wms_release_reservation_line(uuid, text)                              TO authenticated;
-- wms_expire_reservations fica fora de `authenticated`: é varredura de manutenção, não
-- ação de tela, e rodar por engano liquida reserva de onda alheia.
GRANT EXECUTE ON FUNCTION public.wms_expire_reservations() TO service_role;

