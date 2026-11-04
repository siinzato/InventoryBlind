/*
# 125 — Lote e validade, por opção da empresa

Rastrear lote e validade é obrigação para quem trabalha com perecível e peso
morto para quem não trabalha. Por isso nada aqui nasce ligado, e a empresa que
não usar não vê campo, aba nem aviso nenhum — a chave não esconde a função,
ela a mantém ausente.

## Duas chaves, não uma

Lote e validade resolvem problemas diferentes. Lote responde "onde foi parar o
que saiu daquela remessa" num recall; validade responde "o que vence primeiro".
Uma distribuidora pode precisar de lote sem precisar de validade. Juntar as
duas numa chave só obrigaria a ligar o que não se usa.

## Onde o dado entra

No endereçamento do recebimento (migration 124), que é o único momento em que a
mercadoria é identificada peça a peça ao entrar. Lote e validade ficam gravados
no registro de entrada.

## O que esta fatia NÃO faz, e é importante saber

O saldo por endereço continua com chave `(empresa, endereço, produto)` — SEM
lote. Ou seja: sabe-se que o lote X entrou no endereço A com validade tal, mas
depois de separar mercadoria o sistema não sabe quanto daquele lote restou, e a
separação não tem como respeitar "vence primeiro, sai primeiro".

Fazer isso exigiria redeclarar as três RPCs do Pulmão e a guarda de capacidade.
Fica como decisão própria, não como efeito colateral desta migration.

## A chave é cobrada no banco, não só na tela

`nfe_putaway_item` recusa lote ou validade quando a empresa não ligou a opção.
Sem isso, a chave seria só uma sugestão: bastaria uma tela desatualizada, um
cliente de API ou um teste para gravar dado que a empresa decidiu não ter.

## Compatibilidade

Aditiva, com uma exceção deliberada: a RPC `nfe_putaway_item` de 4 argumentos é
SUBSTITUÍDA pela de 6. Trocar a assinatura por `CREATE OR REPLACE` criaria uma
sobrecarga — duas funções de mesmo nome — e o PostgREST escolheria qualquer uma
delas conforme o corpo da chamada. A de 4 argumentos nasceu na migration 124,
hoje, e só a tela de endereçamento a chama.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A chave, por empresa
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lot_control_settings (
  company_id uuid PRIMARY KEY DEFAULT get_my_company_id()::uuid
    REFERENCES companies(id) ON DELETE CASCADE,

  -- Nascem desligadas: uma atualização não acrescenta campo obrigatório ao
  -- recebimento de ninguém.
  lot_enabled    boolean NOT NULL DEFAULT false,
  expiry_enabled boolean NOT NULL DEFAULT false,

  -- Com quantos dias de antecedência um vencimento vira aviso. 30 cobre o ciclo
  -- de reposição da maioria; os limites são de sanidade, não de negócio.
  expiry_alert_days integer NOT NULL DEFAULT 30
    CHECK (expiry_alert_days BETWEEN 1 AND 365),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lot_control_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Leitura para a empresa inteira: quem recebe precisa saber se deve informar
  -- lote, e não há segredo numa chave de configuração.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename = 'lot_control_settings' AND policyname = 'lot_control_settings_select') THEN
    CREATE POLICY lot_control_settings_select ON public.lot_control_settings
      FOR SELECT TO authenticated
      USING ((company_id)::text = get_my_company_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename = 'lot_control_settings' AND policyname = 'lot_control_settings_insert') THEN
    CREATE POLICY lot_control_settings_insert ON public.lot_control_settings
      FOR INSERT TO authenticated
      WITH CHECK ((company_id)::text = get_my_company_id()
        AND get_my_role() = ANY (ARRAY['owner', 'admin', 'manager']));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename = 'lot_control_settings' AND policyname = 'lot_control_settings_update') THEN
    CREATE POLICY lot_control_settings_update ON public.lot_control_settings
      FOR UPDATE TO authenticated
      USING ((company_id)::text = get_my_company_id()
        AND get_my_role() = ANY (ARRAY['owner', 'admin', 'manager']))
      WITH CHECK ((company_id)::text = get_my_company_id()
        AND get_my_role() = ANY (ARRAY['owner', 'admin', 'manager']));
  END IF;
END $$;

-- Sem policy de DELETE: desligar é `false`, que preserva a configuração para
-- quando religar. Sem policy, o RLS nega.

DROP TRIGGER IF EXISTS lot_control_settings_updated_at ON public.lot_control_settings;
CREATE TRIGGER lot_control_settings_updated_at
  BEFORE UPDATE ON public.lot_control_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.lot_control_settings IS
  'Liga lote e validade por empresa. Nasce desligado; com a chave desligada a RPC de endereçamento recusa gravar lote ou validade.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Onde o dado fica
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.nfe_putaway_assignments
  ADD COLUMN IF NOT EXISTS lot_number  text,
  ADD COLUMN IF NOT EXISTS expiry_date date;

-- Parcial: só as linhas que têm validade entram no índice, e são elas que a
-- tela de vencimentos procura.
CREATE INDEX IF NOT EXISTS nfe_putaway_assignments_expiry_idx
  ON public.nfe_putaway_assignments (company_id, expiry_date)
  WHERE expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS nfe_putaway_assignments_lot_idx
  ON public.nfe_putaway_assignments (company_id, lot_number)
  WHERE lot_number IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A RPC passa a aceitar lote e validade — e a cobrar a chave
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.nfe_putaway_item(uuid, text, integer, integer);

CREATE OR REPLACE FUNCTION public.nfe_putaway_item(
  p_item_id       uuid,
  p_bin_code      text,
  p_boxes         integer,
  p_units_per_box integer,
  p_lot_number    text DEFAULT NULL,
  p_expiry_date   date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company    text := get_my_company_id();
  v_item       nfe_invoice_items;
  v_invoice    nfe_invoices;
  v_ja         integer;
  v_pedido     integer;
  v_movement   uuid;
  v_reason     text;
  v_lot_on     boolean;
  v_expiry_on  boolean;
  v_lot        text := nullif(btrim(coalesce(p_lot_number, '')), '');
BEGIN
  SELECT * INTO v_item FROM nfe_invoice_items
   WHERE id = p_item_id AND (company_id)::text = v_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item da nota não encontrado nesta empresa';
  END IF;

  SELECT * INTO v_invoice FROM nfe_invoices WHERE id = v_item.invoice_id;
  IF v_invoice.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta nota foi arquivada';
  END IF;

  -- Endereçar antes de fechar a conferência guardaria uma quantidade que ainda
  -- pode mudar na contagem.
  IF v_invoice.status NOT IN ('completed', 'with_divergences') THEN
    RAISE EXCEPTION 'A conferência desta nota ainda não foi finalizada';
  END IF;

  IF v_item.product_id IS NULL THEN
    RAISE EXCEPTION 'Este item não está vinculado a um produto do catálogo';
  END IF;

  -- Vale o que foi CONTADO, nunca o que a nota prometia: endereçar pelo esperado
  -- colocaria no endereço uma caixa que não chegou.
  IF v_item.physical_quantity IS NULL OR v_item.physical_quantity <= 0 THEN
    RAISE EXCEPTION 'Este item não teve quantidade conferida';
  END IF;

  IF p_boxes IS NULL OR p_boxes <= 0 OR p_units_per_box IS NULL OR p_units_per_box <= 0 THEN
    RAISE EXCEPTION 'Quantidade inválida';
  END IF;

  -- A chave da empresa é cobrada aqui, e não só na tela: sem isto, bastaria uma
  -- tela desatualizada ou um cliente de API para gravar dado que a empresa
  -- decidiu não ter. Empresa sem linha de configuração = tudo desligado.
  SELECT coalesce(s.lot_enabled, false), coalesce(s.expiry_enabled, false)
    INTO v_lot_on, v_expiry_on
    FROM (SELECT 1) d
    LEFT JOIN lot_control_settings s ON (s.company_id)::text = v_company;

  IF v_lot IS NOT NULL AND NOT v_lot_on THEN
    RAISE EXCEPTION 'O controle de lote não está ligado para esta empresa';
  END IF;
  IF p_expiry_date IS NOT NULL AND NOT v_expiry_on THEN
    RAISE EXCEPTION 'O controle de validade não está ligado para esta empresa';
  END IF;

  SELECT coalesce(sum(units), 0) INTO v_ja
    FROM nfe_putaway_assignments WHERE item_id = p_item_id;

  v_pedido := p_boxes * p_units_per_box;

  IF v_ja + v_pedido > v_item.physical_quantity THEN
    RAISE EXCEPTION 'Endereçando % unidades a mais do que foi conferido (conferido: %, já endereçado: %)',
      (v_ja + v_pedido) - v_item.physical_quantity::integer, v_item.physical_quantity, v_ja;
  END IF;

  -- O motivo acompanha o movimento no Pulmão e no livro-razão: sem ele, uma
  -- entrada de 10 caixas não diz de onde veio.
  v_reason := 'Recebimento NF-e ' || coalesce(v_invoice.invoice_number, v_invoice.invoice_key);
  IF v_lot IS NOT NULL THEN
    v_reason := v_reason || ' · lote ' || v_lot;
  END IF;

  v_movement := wms_bin_putaway(p_bin_code, v_item.product_id, p_boxes, p_units_per_box, v_reason);

  INSERT INTO nfe_putaway_assignments
    (company_id, invoice_id, item_id, product_id, movement_id, bin_code, boxes, units_per_box,
     lot_number, expiry_date, created_by)
  VALUES
    (v_company::uuid, v_item.invoice_id, p_item_id, v_item.product_id, v_movement,
     upper(trim(p_bin_code)), p_boxes, p_units_per_box,
     v_lot, p_expiry_date, auth.uid());

  RETURN v_movement;
END;
$fn$;

REVOKE ALL ON FUNCTION public.nfe_putaway_item(uuid, text, integer, integer, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfe_putaway_item(uuid, text, integer, integer, text, date) TO authenticated;
