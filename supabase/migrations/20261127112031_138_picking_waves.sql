-- 138 — Ondas de separação: o domínio.
--
-- Só estrutura. As RPCs que reservam, separam e fecham a onda vão na 139 — tabela e
-- comportamento na mesma migration tornam impossível conferir uma coisa sem a outra.
--
-- ── As quatro tabelas, e por que são quatro ───────────────────────────────────
--
--   picking_waves          a onda        — código, estado, responsável
--     └─ picking_wave_items     a DEMANDA — "preciso de 10 caixas do SKU X"
--          └─ picking_allocations  o PLANO — "6 caixas no PP-A01-N2, 4 no PP-D14-N1"
--               └─ picking_scan_events  o FATO — o que foi bipado, inclusive o recusado
--
-- Demanda e plano são coisas diferentes e por isso não cabem na mesma linha: a demanda
-- é do cliente, o plano é do galpão, e um pedido de 10 caixas vira três paradas quando
-- o saldo está espalhado. Juntar as duas obrigaria a reescrever a demanda toda vez que o
-- alocador mudasse de ideia — e aí ninguém mais sabe o que foi pedido.
--
-- ── A medição que define o escopo ─────────────────────────────────────────────
-- Não existe pedido de saída no banco: `purchase_orders` 0 linhas (e é compra),
-- `full_withdrawal_plans` 1 linha (e é entrada, vinda do Mercado Livre), `sales_records`
-- é histórico de venda. Por isso `origin` começa em `manual`/`importacao`, e `plano_full`
-- fica declarado no enum sem nenhuma dependência de tabela que não existe.
--
-- Demanda em CAIXAS, não em unidades: é a moeda do módulo inteiro (`boxes` +
-- `units_per_box`), e é em caixas que `wms_reserve_stock` e `wms_pick_for_wave` falam.
-- Converter unidade aqui criaria caixa fracionada, que não existe na prateleira.

-- ── 1. A onda ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS picking_waves (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  text NOT NULL DEFAULT get_my_company_id(),
  code        text NOT NULL,

  status      text NOT NULL DEFAULT 'rascunho'
              CHECK (status IN ('rascunho','reservada','em_separacao','concluida','parcial','cancelada')),

  origin      text NOT NULL DEFAULT 'manual'
              CHECK (origin IN ('manual','importacao','plano_full')),
  origin_ref  text,

  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes       text,

  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  reserved_at timestamptz,
  started_at  timestamptz,
  finished_at timestamptz,

  CONSTRAINT picking_waves_code_unique UNIQUE (company_id, code),

  -- Onda encerrada tem data de encerramento, e onda aberta não tem. Sem isto, "quando
  -- fechou" vira campo que às vezes mente — e é por ele que se mede tempo de separação.
  CONSTRAINT picking_waves_encerramento
    CHECK ((status IN ('concluida','parcial','cancelada')) = (finished_at IS NOT NULL))
);

COMMENT ON TABLE picking_waves IS
  'Onda de separação. O ciclo é rascunho → reservada → em_separacao → concluida/parcial/cancelada, e toda transição passa por RPC.';

CREATE INDEX IF NOT EXISTS picking_waves_fila_idx
  ON picking_waves (company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS picking_waves_responsavel_idx
  ON picking_waves (company_id, assigned_to)
  WHERE status IN ('reservada','em_separacao');

-- ── 2. A demanda ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS picking_wave_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT get_my_company_id(),
  wave_id    uuid NOT NULL REFERENCES picking_waves(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id)      ON DELETE RESTRICT,

  -- Cópia do SKU no momento em que a onda foi montada. Renomear o cadastro depois não
  -- pode reescrever o que foi pedido: a onda é um documento do que aconteceu.
  sku        text NOT NULL,

  boxes_demandadas integer NOT NULL CHECK (boxes_demandadas > 0),
  boxes_alocadas   integer NOT NULL DEFAULT 0 CHECK (boxes_alocadas >= 0),
  boxes_separadas  integer NOT NULL DEFAULT 0 CHECK (boxes_separadas >= 0),

  status     text NOT NULL DEFAULT 'pendente'
             CHECK (status IN ('pendente','alocado','parcial','atendido','sem_saldo')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- O mesmo SKU duas vezes na mesma onda é erro de digitação, não dois pedidos: somar na
  -- linha que já existe é o que a lista colada espera.
  CONSTRAINT picking_wave_items_unique UNIQUE (wave_id, product_id)
);

CREATE INDEX IF NOT EXISTS picking_wave_items_onda_idx ON picking_wave_items (wave_id);

-- ── 3. O plano: uma linha = uma reserva = uma parada da rota ──────────────────
CREATE TABLE IF NOT EXISTS picking_allocations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT get_my_company_id(),
  wave_id    uuid NOT NULL REFERENCES picking_waves(id)      ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES picking_wave_items(id) ON DELETE CASCADE,
  bin_id     uuid NOT NULL REFERENCES warehouse_storage_bins(id) ON DELETE RESTRICT,

  -- A ponte para a Etapa 1. `ON DELETE SET NULL` porque a reserva liquidada continua
  -- existindo como histórico, mas a alocação não pode depender dela para ser lida.
  reservation_id uuid REFERENCES warehouse_stock_reservations(id) ON DELETE SET NULL,

  boxes            integer NOT NULL CHECK (boxes > 0),
  boxes_separadas  integer NOT NULL DEFAULT 0 CHECK (boxes_separadas >= 0),

  -- Ordem de CAMINHADA, não de consumo. O FIFO já decidiu QUAIS endereços entram na
  -- onda; a sequência decide em que ordem visitá-los. Como a mercadoria já está
  -- reservada por endereço, a ordem da visita não muda qual lote sai — e tratar as duas
  -- como a mesma coisa é o que faz o operador atravessar o galpão de ida e volta.
  sequencia  integer NOT NULL DEFAULT 0,

  status     text NOT NULL DEFAULT 'pendente'
             CHECK (status IN ('pendente','separado','parcial','ruptura','cancelado')),

  movement_id uuid REFERENCES warehouse_bin_movements(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT picking_allocations_nao_separa_mais_que_alocado
    CHECK (boxes_separadas <= boxes),

  -- Uma alocação por item e endereço. Não é arrumação: `wms_pick_for_wave` consome a
  -- reserva do dono pela mais antiga, e duas alocações do mesmo item no mesmo endereço
  -- produziriam duas reservas indistinguíveis — a baixa de uma consumiria a outra.
  CONSTRAINT picking_allocations_unique UNIQUE (item_id, bin_id)
);

CREATE INDEX IF NOT EXISTS picking_allocations_rota_idx
  ON picking_allocations (wave_id, sequencia);

CREATE INDEX IF NOT EXISTS picking_allocations_pendentes_idx
  ON picking_allocations (company_id, bin_id)
  WHERE status IN ('pendente','parcial');

-- ── 4. O fato: tudo que foi bipado, inclusive o que foi recusado ──────────────
--
-- Append-only, no molde de `nfe_count_events` (migration 019). Recusa que não deixa
-- rastro é divergência que ninguém investiga depois: quando o operador jura que bipou e
-- o sistema jura que não, é esta tabela que responde.
CREATE TABLE IF NOT EXISTS picking_scan_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    text NOT NULL DEFAULT get_my_company_id(),
  wave_id       uuid NOT NULL REFERENCES picking_waves(id) ON DELETE CASCADE,
  allocation_id uuid REFERENCES picking_allocations(id) ON DELETE SET NULL,

  scanned_bin   text,
  scanned_code  text,
  resolved_product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  qty           integer,

  source        text NOT NULL CHECK (source IN ('scanner','camera','manual')),

  outcome       text NOT NULL
                CHECK (outcome IN ('ok','endereco_errado','produto_errado',
                                   'quantidade_divergente','ruptura','duplicado','ambiguo')),

  -- Rede ruim não pode virar caixa a mais: a mesma chave devolve o mesmo resultado.
  idempotency_key uuid NOT NULL UNIQUE,

  created_by    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS picking_scan_events_onda_idx
  ON picking_scan_events (wave_id, created_at DESC);

CREATE INDEX IF NOT EXISTS picking_scan_events_alocacao_idx
  ON picking_scan_events (allocation_id);

-- ── 5. `updated_at` no padrão do projeto ──────────────────────────────────────
DROP TRIGGER IF EXISTS picking_waves_touch ON picking_waves;
CREATE TRIGGER picking_waves_touch BEFORE UPDATE ON picking_waves
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS picking_wave_items_touch ON picking_wave_items;
CREATE TRIGGER picking_wave_items_touch BEFORE UPDATE ON picking_wave_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS picking_allocations_touch ON picking_allocations;
CREATE TRIGGER picking_allocations_touch BEFORE UPDATE ON picking_allocations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 6. RLS: ler sim, escrever só por RPC ──────────────────────────────────────
--
-- Mesmo princípio do saldo e da reserva. Estas tabelas carregam invariantes que
-- dependem de OUTRAS linhas (o alocado não pode passar do demandado, o separado não pode
-- passar do alocado, a reserva tem de existir) — e invariante entre linhas não se
-- defende em policy.
ALTER TABLE picking_waves       ENABLE ROW LEVEL SECURITY;
ALTER TABLE picking_wave_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE picking_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE picking_scan_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS picking_waves_select ON picking_waves;
CREATE POLICY picking_waves_select ON picking_waves
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS picking_wave_items_select ON picking_wave_items;
CREATE POLICY picking_wave_items_select ON picking_wave_items
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS picking_allocations_select ON picking_allocations;
CREATE POLICY picking_allocations_select ON picking_allocations
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS picking_scan_events_select ON picking_scan_events;
CREATE POLICY picking_scan_events_select ON picking_scan_events
  FOR SELECT TO authenticated USING (company_id = get_my_company_id());

-- O `ALTER DEFAULT PRIVILEGES` do Supabase concede escrita em toda tabela nova para
-- `anon` e `authenticated`. Hoje a RLS segura, mas segurança apoiada na AUSÊNCIA de uma
-- policy quebra no dia em que alguém adicionar uma por outro motivo. Foi a lição da 135.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON picking_waves, picking_wave_items, picking_allocations, picking_scan_events
  FROM public, anon, authenticated;

-- ── 7. A rota, pronta para a tela e para o 3D ─────────────────────────────────
--
-- `security_invoker = true` pelo mesmo motivo das views da 134: sem ele a view roda como
-- dona e devolve a onda das outras empresas.
CREATE OR REPLACE VIEW picking_wave_route_v
WITH (security_invoker = true) AS
SELECT
  a.company_id,
  a.wave_id,
  w.code          AS wave_code,
  w.status        AS wave_status,
  a.id            AS allocation_id,
  a.sequencia,
  a.status        AS allocation_status,
  b.code          AS bin_code,
  b.blocked       AS bin_blocked,
  i.id            AS item_id,
  i.product_id,
  i.sku,
  p.name          AS product_name,
  p.ean,
  a.boxes,
  a.boxes_separadas,
  a.boxes - a.boxes_separadas AS boxes_restantes,
  s.units_per_box,
  s.first_stored_at
FROM picking_allocations a
JOIN picking_waves       w ON w.id = a.wave_id
JOIN picking_wave_items  i ON i.id = a.item_id
JOIN warehouse_storage_bins b ON b.id = a.bin_id
JOIN products            p ON p.id = i.product_id
LEFT JOIN warehouse_bin_stock s
  ON s.company_id = a.company_id AND s.bin_id = a.bin_id AND s.product_id = i.product_id;

COMMENT ON VIEW picking_wave_route_v IS
  'A rota da onda: uma linha por parada, na ordem de caminhada (`sequencia`). Alimenta a lista do operador e o traçado 3D.';
