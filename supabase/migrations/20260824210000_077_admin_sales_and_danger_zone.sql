/*
# Painel Administrativo — Vendas importadas e Zona de Perigo transacional

## Summary
Reformulação do Painel Administrativo (Visão Geral / Vendas e Integrações / KPIs / Inventários / Zona de
Perigo). Duas mudanças de banco, ambas aditivas:

1. Vendas passam a ser importadas (CSV/XLSX), nunca digitadas — modelo normalizado próprio, preparado
   para futuras integrações de ERP (Tiny/Bling/TOTVS/SAP), sem implementá-las agora. Vendas são
   exclusivamente analíticas: nenhuma tabela de produto/estoque/inventário/contagem é lida ou escrita por
   este bloco.
2. O reset de inventário (antes um `UPDATE` em loop direto do cliente, sem RPC, sem justificativa, sem
   transação real) vira uma RPC `SECURITY DEFINER` única e transacional — mesmo padrão de
   `nfe_admin_archive_invoice` (062): owner/admin, justificativa >= 5 caracteres, tudo dentro de uma única
   função (se qualquer INSERT falhar, a exceção desfaz o bloco inteiro, então o reset nunca roda sem o
   arquivamento ter sido concluído). O client-side `handleResetInventory` antigo (App.tsx) e as tabelas
   `inventory_snapshots`/`inventory_brand_history`/`inventory_kpi_history`/`inventory_top_vendas_history`
   não mudam de formato — só ganham este caminho de escrita único.

## New Tables (vendas)
- `sales_import_profiles` — mapeamento de colunas salvo por empresa+origem+nome, reutilizável entre
  importações (mesma ideia de `po_import_profiles`, migration 074). Sem dado de planilha.
- `sales_import_batches` — uma linha por execução de importação (auditoria + detecção de reimportação por
  hash do arquivo, nunca bloqueia — a decisão de reimportar é da tela).
- `sales_records` — vendas normalizadas, uma linha por item vendido. `product_id` é só uma referência
  informativa (ON DELETE SET NULL) para permitir juntar com o catálogo quando reconhecido; uma venda
  "não associada" continua importada e visível, nunca é descartada.

RLS em todas: `company_id::text = get_my_company_id()`, SELECT/INSERT/UPDATE para `authenticated`, sem
DELETE (histórico de importação é append-only, mesmo padrão de `po_import_batches`).

## RPC (reset transacional)
`admin_reset_inventory(p_name text, p_notes text, p_reason text) RETURNS uuid` — substitui o loop de
UPDATEs do cliente. Dentro de uma única transação: valida papel (owner/admin) e justificativa, snapshotea
`inventory_brands`/`custom_kpis`/`top_vendas` para as tabelas de histórico já existentes, zera
`done_sku`/`divergences` de `inventory_brands`, grava `audit_logs`, e retorna o id do snapshot criado.
Nenhuma coluna nova em nenhuma tabela existente.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. sales_import_profiles
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_import_profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  origin         text NOT NULL CHECK (origin IN ('tiny', 'bling', 'totvs', 'sap', 'custom')),
  name           text NOT NULL,
  column_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by     uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, origin, name)
);

CREATE INDEX IF NOT EXISTS sales_import_profiles_company_idx ON sales_import_profiles (company_id);

ALTER TABLE sales_import_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_import_profiles_select" ON sales_import_profiles;
CREATE POLICY "sales_import_profiles_select" ON sales_import_profiles FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "sales_import_profiles_insert" ON sales_import_profiles;
CREATE POLICY "sales_import_profiles_insert" ON sales_import_profiles FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "sales_import_profiles_update" ON sales_import_profiles;
CREATE POLICY "sales_import_profiles_update" ON sales_import_profiles FOR UPDATE
  TO authenticated USING (company_id::text = get_my_company_id())
  WITH CHECK (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. sales_import_batches
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_import_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  origin           text NOT NULL CHECK (origin IN ('tiny', 'bling', 'totvs', 'sap', 'custom')),
  profile_id       uuid REFERENCES sales_import_profiles(id) ON DELETE SET NULL,
  file_name        text NOT NULL,
  file_hash        text NOT NULL,
  row_count        integer NOT NULL DEFAULT 0,
  imported_count   integer NOT NULL DEFAULT 0,
  unmatched_count  integer NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
  error_message    text,
  created_by       uuid DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_import_batches_company_idx ON sales_import_batches (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_import_batches_hash_idx ON sales_import_batches (company_id, file_hash);

ALTER TABLE sales_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_import_batches_select" ON sales_import_batches;
CREATE POLICY "sales_import_batches_select" ON sales_import_batches FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "sales_import_batches_insert" ON sales_import_batches;
CREATE POLICY "sales_import_batches_insert" ON sales_import_batches FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. sales_records
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  batch_id      uuid NOT NULL REFERENCES sales_import_batches(id) ON DELETE CASCADE,
  sale_date     date NOT NULL,
  sku           text,
  product_name  text NOT NULL,
  quantity      numeric NOT NULL DEFAULT 0,
  unit_price    numeric,
  total_value   numeric NOT NULL DEFAULT 0,
  product_id    uuid REFERENCES products(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_records_company_date_idx ON sales_records (company_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS sales_records_batch_idx ON sales_records (batch_id);
CREATE INDEX IF NOT EXISTS sales_records_sku_idx ON sales_records (company_id, sku);

ALTER TABLE sales_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_records_select" ON sales_records;
CREATE POLICY "sales_records_select" ON sales_records FOR SELECT
  TO authenticated USING (company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "sales_records_insert" ON sales_records;
CREATE POLICY "sales_records_insert" ON sales_records FOR INSERT
  TO authenticated WITH CHECK (company_id::text = get_my_company_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. admin_reset_inventory — RPC transacional (substitui o loop de UPDATEs do cliente)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reset_inventory(
  p_name  text,
  p_notes text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company    text;
  v_role       text;
  v_email      text;
  v_reason     text;
  v_snapshot_id uuid;
  v_total_sku  numeric;
  v_total_done numeric;
  v_total_div  numeric;
  v_progress   numeric;
  v_accuracy   numeric;
  v_start_date timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuário autenticado nesta requisição.';
  END IF;

  v_company := get_my_company_id();
  v_role    := get_my_role();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa ativa para este usuário.';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Apenas owner ou admin podem arquivar e resetar o inventário.';
  END IF;

  v_reason := btrim(coalesce(p_reason, ''));
  IF char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'A justificativa precisa ter pelo menos 5 caracteres.';
  END IF;

  SELECT coalesce(sum(total_sku), 0), coalesce(sum(done_sku), 0), coalesce(sum(divergences), 0)
    INTO v_total_sku, v_total_done, v_total_div
    FROM inventory_brands WHERE company_id::text = v_company;

  v_progress := CASE WHEN v_total_sku > 0 THEN (v_total_done / v_total_sku) * 100 ELSE 0 END;
  v_accuracy := CASE WHEN v_total_done > 0 THEN ((v_total_done - v_total_div) / v_total_done) * 100 ELSE 0 END;

  -- Mesmo cálculo do client antigo: início do ciclo = criação mais antiga entre as linhas
  -- de inventory_brands atuais (não muda ao resetar done_sku/divergences).
  SELECT min(created_at) INTO v_start_date FROM inventory_brands WHERE company_id::text = v_company;

  INSERT INTO inventory_snapshots (
    company_id, name, start_date, end_date, total_sku, total_done, total_divergences, progress, accuracy, status, notes
  ) VALUES (
    v_company, p_name, coalesce(v_start_date, now()), now(), v_total_sku, v_total_done, v_total_div, v_progress, v_accuracy, 'completed', p_notes
  ) RETURNING id INTO v_snapshot_id;

  INSERT INTO inventory_brand_history (snapshot_id, brand, total_sku, done_sku, divergences, progress, accuracy, status)
  SELECT
    v_snapshot_id, brand, total_sku, done_sku, divergences,
    CASE WHEN total_sku > 0 THEN (done_sku::numeric / total_sku) * 100 ELSE 0 END,
    CASE WHEN done_sku > 0 THEN ((done_sku - divergences)::numeric / done_sku) * 100 ELSE NULL END,
    CASE WHEN total_sku > 0 AND done_sku >= total_sku THEN 'CONCLUÍDO' ELSE 'ANDAMENTO' END
  FROM inventory_brands WHERE company_id::text = v_company;

  INSERT INTO inventory_kpi_history (snapshot_id, titulo, valor, unidade, variacao, tipo_variacao, cor_icone)
  SELECT v_snapshot_id, titulo, valor, unidade, variacao, tipo_variacao, cor_icone
  FROM custom_kpis WHERE company_id::text = v_company;

  INSERT INTO inventory_top_vendas_history (snapshot_id, produto, sku, vendas, order_index)
  SELECT v_snapshot_id, produto, sku, vendas, order_index
  FROM top_vendas WHERE company_id::text = v_company;

  UPDATE inventory_brands
  SET done_sku = 0, divergences = 0, updated_at = now()
  WHERE company_id::text = v_company;

  SELECT email INTO v_email FROM profiles WHERE id = auth.uid();

  INSERT INTO audit_logs (company_id, user_id, user_email, action, resource_type, resource_id, description, metadata)
  VALUES (
    v_company::uuid, auth.uid(), coalesce(v_email, ''), 'inventory.reset', 'inventory_snapshot', v_snapshot_id::text,
    'Inventário arquivado e resetado.',
    jsonb_build_object(
      'snapshotName', p_name, 'reason', v_reason,
      'totalSku', v_total_sku, 'totalDone', v_total_done, 'totalDivergences', v_total_div
    )
  );

  RETURN v_snapshot_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.admin_reset_inventory(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_reset_inventory(text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_reset_inventory(text, text, text) TO authenticated;
