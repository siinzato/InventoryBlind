/*
# 124 — Recebimento com endereçamento: da nota conferida para o endereço

Hoje a conferência por NF-e termina no relatório e a mercadoria fica no chão
do recebimento. O Pulmão sabe endereçar (`wms_bin_putaway`, migration 116) e a
conferência sabe o que chegou — mas nada liga um ao outro. O retrato desta
base diz o tamanho da lacuna: 260 itens de nota conferidos, 4 posições
ocupadas em 71 endereços.

Esta migration cria o elo, e só isso.

## O que NÃO foi criado, de propósito

Nenhuma RPC de endereçamento nova. `wms_bin_putaway` já faz o trabalho e já
carrega as três guardas reais — endereço bloqueado, capacidade declarada e
pack divergente no mesmo SKU. Reescrever qualquer uma delas aqui criaria uma
segunda versão da regra, que divergiria no primeiro ajuste feito de um lado só.
`nfe_putaway_item` valida o que é da NOTA e delega o resto.

Nenhuma alteração em `products.stock_quantity`. Endereçar diz ONDE a mercadoria
está, não QUANTA existe no catálogo — a mesma separação que a conferência já
faz hoje. Misturar as duas coisas aqui mudaria, de carona, o modelo de saldo
do produto inteiro.

## Endereçamento parcial é o caso normal, não a exceção

Um item de 120 unidades pode ir para três endereços diferentes. Por isso NÃO
há unicidade por item: a tabela guarda uma linha por movimento, e o que já foi
endereçado é a soma. A RPC recusa passar do que foi conferido.

## Nota com divergência também endereça

O que chegou precisa ser guardado mesmo quando chegou diferente da nota. A
quantidade que vale é sempre a CONFERIDA (`physical_quantity`), nunca a
esperada — endereçar pelo que a nota prometia colocaria no endereço uma caixa
que não existe.

## Escrita

Sem policy de INSERT/UPDATE/DELETE: a tabela é escrita pela RPC, que é
`SECURITY DEFINER`. Leitura para a empresa inteira, como o resto da conferência.

## Compatibilidade

Aditiva. Nenhuma tabela, função ou policy existente foi alterada.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A ligação: item da nota ↔ movimento de endereçamento
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nfe_putaway_assignments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES nfe_invoices(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES nfe_invoice_items(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  -- O movimento gerado no Pulmão. `SET NULL` em vez de `CASCADE`: se o movimento
  -- for removido algum dia, o registro de que este item FOI endereçado continua
  -- valendo — apagá-lo faria a nota voltar a parecer pendente.
  movement_id uuid REFERENCES warehouse_bin_movements(id) ON DELETE SET NULL,

  -- Código do endereço no momento do ato. Guardado como texto, e não só pela
  -- referência: o código é o que o operador leu na etiqueta, e renomear o
  -- endereço depois não pode reescrever o que foi feito.
  bin_code   text NOT NULL,

  boxes         integer NOT NULL CHECK (boxes > 0),
  units_per_box integer NOT NULL CHECK (units_per_box > 0),
  -- Coluna gerada: a soma do que já foi endereçado é a pergunta que a tela faz a
  -- cada carga, e recalculá-la na consulta convidaria a divergência.
  units         integer GENERATED ALWAYS AS (boxes * units_per_box) STORED,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nfe_putaway_assignments_invoice_idx
  ON public.nfe_putaway_assignments (invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS nfe_putaway_assignments_item_idx
  ON public.nfe_putaway_assignments (item_id);
CREATE INDEX IF NOT EXISTS nfe_putaway_assignments_product_idx
  ON public.nfe_putaway_assignments (company_id, product_id, created_at DESC);

ALTER TABLE public.nfe_putaway_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nfe_putaway_assignments_select" ON public.nfe_putaway_assignments;
CREATE POLICY "nfe_putaway_assignments_select" ON public.nfe_putaway_assignments FOR SELECT
  TO authenticated USING ((company_id)::text = get_my_company_id());

COMMENT ON TABLE public.nfe_putaway_assignments IS
  'Liga o item conferido de uma NF-e ao movimento de entrada no endereço. Escrita só por nfe_putaway_item; endereçamento parcial gera várias linhas por item.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A RPC
--
-- Valida o que é da NOTA e delega o endereçamento para `wms_bin_putaway`, que
-- já cobra endereço bloqueado, capacidade e pack divergente.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nfe_putaway_item(
  p_item_id       uuid,
  p_bin_code      text,
  p_boxes         integer,
  p_units_per_box integer
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

  v_movement := wms_bin_putaway(p_bin_code, v_item.product_id, p_boxes, p_units_per_box, v_reason);

  INSERT INTO nfe_putaway_assignments
    (company_id, invoice_id, item_id, product_id, movement_id, bin_code, boxes, units_per_box, created_by)
  VALUES
    (v_company::uuid, v_item.invoice_id, p_item_id, v_item.product_id, v_movement,
     upper(trim(p_bin_code)), p_boxes, p_units_per_box, auth.uid());

  RETURN v_movement;
END;
$fn$;

REVOKE ALL ON FUNCTION public.nfe_putaway_item(uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfe_putaway_item(uuid, text, integer, integer) TO authenticated;
