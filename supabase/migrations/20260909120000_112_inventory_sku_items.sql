/*
  # 112 — Inventário por SKU: ciclos e itens individuais

  ## Por que existe

  Até aqui o inventário era agregado: `inventory_brands` guarda `total_sku`, `done_sku` e
  `divergences` por LINHA DE CONTAGEM, e o operador digitava esses totais. Não havia
  vínculo SKU → contagem em nenhum lugar (`inventory_count_import_items` está vazia), e por
  isso o Dashboard por Linha só podia mostrar a taxonomia de contagem ("Linha de Outlet e
  PET"), nunca a classificação Marca > Linha do catálogo. Também não havia como separar
  Outlet de PET: os 24 SKUs já contados dessa linha são um número, não uma lista.

  Esta migration cria o modelo por SKU, ADITIVO. Nada do modelo agregado é alterado,
  convertido ou apagado: `inventory_brands`, `inventory_count_records`,
  `inventory_snapshots` e `inventory_brand_history` seguem intactos e continuam servindo o
  ciclo atual e todo o histórico. O ciclo agregado em andamento fica como legado
  read-only; o próximo ciclo nasce no modelo novo, contando do zero.

  ## Duas tabelas

  `inventory_cycles` — o ciclo de inventário. Índice único parcial garante NO MÁXIMO UM
  ciclo ativo por empresa, que é o que "inventário ativo" significa no resto do sistema.

  `inventory_items` — um registro por produto dentro do ciclo. `unique (cycle_id,
  product_id)` é o que torna a reconciliação idempotente: reimportar planilha insere o que
  falta e nunca duplica SKU. `product_id` é ON DELETE RESTRICT de propósito — produto com
  item de inventário não pode desaparecer por baixo de uma contagem.

  ## Classificação: viva no ciclo ativo, congelada no encerrado

  `brand_id`/`brand_name`/`line_id`/`line_name` são GRAVADOS no item, não resolvidos por
  join na leitura. Enquanto o ciclo está `active`, a rotina de reconciliação reescreve
  esses campos a partir de `product_brand_associations` — o ciclo reflete a classificação
  atual. Ao encerrar, o ciclo vira `closed` e a rotina passa a recusá-lo: reclassificar uma
  linha depois disso não muda retroativamente nenhum inventário fechado. Guardar o NOME
  junto do id é o que preserva o histórico mesmo se a linha for renomeada ou desativada.

  ## Divergência é derivada, não digitada

  Coluna gerada: só existe divergência em item contado que tinha saldo esperado e cuja
  quantidade contada difere dele. Não há como o número de divergências divergir da soma
  dos itens, que é exatamente o problema do modelo agregado.

  ## A view

  `inventory_cycle_line_summary_v` agrega os itens por linha (e, para marca sem linhas
  cadastradas, pela própria marca). É `security_invoker = true`, então a RLS de
  `inventory_items` vale para quem consulta — sem policy nova e sem SECURITY DEFINER. O
  Dashboard lê essa view, então nunca traz 4 mil itens para o navegador só para somar.

  ## Segurança

  Mesmo padrão das tabelas de inventário existentes: `company_id = get_my_company_id()`
  nas quatro operações, e DELETE adicionalmente restrito a owner/admin/manager, como em
  `inventory_count_import_items`. Nada é escrito em products, inventory_* ou
  physical_count_* por esta migration.
*/

CREATE TABLE IF NOT EXISTS inventory_cycles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      text NOT NULL DEFAULT get_my_company_id(),
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  counting_model  text NOT NULL DEFAULT 'sku' CHECK (counting_model IN ('sku')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  notes           text,
  created_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  closed_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_cycles IS
  'Ciclo de inventário no modelo por SKU. O modelo agregado legado (inventory_brands) não tem registro aqui.';

-- No máximo um ciclo ativo por empresa: "o inventário ativo" precisa ser único.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_cycles_one_active_per_company
  ON inventory_cycles (company_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS inventory_cycles_company_status_idx
  ON inventory_cycles (company_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS inventory_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         text NOT NULL DEFAULT get_my_company_id(),
  cycle_id           uuid NOT NULL REFERENCES inventory_cycles(id) ON DELETE CASCADE,
  product_id         uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku                text NOT NULL,
  product_name       text NOT NULL,
  location           text,
  brand_id           uuid REFERENCES product_brands(id) ON DELETE SET NULL,
  brand_name         text,
  line_id            uuid REFERENCES product_lines(id) ON DELETE SET NULL,
  line_name          text,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'counted')),
  expected_quantity  numeric,
  counted_quantity   numeric,
  counted_at         timestamptz,
  counted_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  counted_by_name    text,
  observation        text,
  divergence         boolean GENERATED ALWAYS AS (
                       status = 'counted'
                       AND expected_quantity IS NOT NULL
                       AND counted_quantity IS DISTINCT FROM expected_quantity
                     ) STORED,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, product_id)
);

COMMENT ON TABLE inventory_items IS
  'Um item por produto dentro de um ciclo. A linha é apenas o agrupamento destes itens.';
COMMENT ON COLUMN inventory_items.line_name IS
  'Nome da linha no momento da última reconciliação. Congela ao encerrar o ciclo, para que renomear ou desativar a linha não altere histórico.';
COMMENT ON COLUMN inventory_items.divergence IS
  'Derivada: item contado, com saldo esperado conhecido, cuja quantidade contada difere. Nunca digitada.';

CREATE INDEX IF NOT EXISTS inventory_items_cycle_status_idx ON inventory_items (cycle_id, status);
CREATE INDEX IF NOT EXISTS inventory_items_cycle_line_idx   ON inventory_items (cycle_id, line_id);
CREATE INDEX IF NOT EXISTS inventory_items_cycle_sku_idx    ON inventory_items (cycle_id, sku);
CREATE INDEX IF NOT EXISTS inventory_items_product_idx      ON inventory_items (product_id);

ALTER TABLE inventory_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY inv_cycles_select ON inventory_cycles FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());
CREATE POLICY inv_cycles_insert ON inventory_cycles FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id());
CREATE POLICY inv_cycles_update ON inventory_cycles FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());
CREATE POLICY inv_cycles_delete ON inventory_cycles FOR DELETE TO authenticated
  USING (company_id = get_my_company_id()
         AND get_my_role() = ANY (ARRAY['owner', 'admin', 'manager']));

CREATE POLICY inv_items_select ON inventory_items FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());
CREATE POLICY inv_items_insert ON inventory_items FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id());
CREATE POLICY inv_items_update ON inventory_items FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());
CREATE POLICY inv_items_delete ON inventory_items FOR DELETE TO authenticated
  USING (company_id = get_my_company_id()
         AND get_my_role() = ANY (ARRAY['owner', 'admin', 'manager']));

-- Agrupamento do Dashboard: linha quando existe, senão a própria marca, senão explicitamente
-- sem classificação. Nenhuma lista fixa: uma linha nova aparece sozinha quando tiver item.
CREATE OR REPLACE VIEW inventory_cycle_line_summary_v
  WITH (security_invoker = true) AS
SELECT i.company_id,
       i.cycle_id,
       COALESCE(i.line_id::text, 'brand:' || i.brand_id::text, 'sem-classificacao') AS group_key,
       i.line_id,
       i.brand_id,
       COALESCE(i.line_name, i.brand_name, 'Sem classificação')                     AS group_label,
       count(*)                                        AS total_sku,
       count(*) FILTER (WHERE i.status = 'counted')    AS done_sku,
       count(*) FILTER (WHERE i.divergence)            AS divergences
  FROM inventory_items i
 GROUP BY i.company_id, i.cycle_id, 3, i.line_id, i.brand_id, 6;

COMMENT ON VIEW inventory_cycle_line_summary_v IS
  'Total/contados/divergências por linha do ciclo, direto dos itens. Fonte do Dashboard por Linha no modelo por SKU.';
