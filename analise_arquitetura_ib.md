# Raio-X técnico — InventoryBlind (WMS)

Documento gerado para auditoria externa de arquitetura. Os blocos de código são **cópia
literal dos arquivos do repositório** e o SQL é **extraído do banco vivo** (`pg_get_functiondef`,
`information_schema`, `pg_policies`), não transcrito das migrations — as duas coisas podem
divergir, e onde divergem a verdade é o banco.

**Escala do projeto, medida:** 149.233 linhas de TS/TSX fora de testes (695 arquivos),
27.192 linhas de SQL em 133 migrations, 176 tabelas em `public`, 11 edge functions
(a pasta `supabase/functions/` tem 13 entradas, mas `_shared/` e `README.md` não são funções).
Embutir tudo seria um arquivo de ~176 mil linhas. O que está aqui inteiro é o **núcleo de
estoque, endereço, movimentação e 3D** (~11 mil linhas); o resto aparece inventariado com o
número ao lado. Onde algo foi deixado de fora, está dito.

Ignorados conforme pedido: `node_modules`, `dist`, `.git`, lockfiles, assets e `__tests__`
(3.635 testes em 197 arquivos, não incluídos).

---

## 1. Stack e Estrutura de Pastas

### 1.1 `package.json`

```json
{
  "name": "vite-react-typescript-starter",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.app.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@fontsource/jetbrains-mono": "^5.3.0",
    "@gsap/react": "^2.1.2",
    "@react-three/drei": "^9.122.0",
    "@react-three/fiber": "^8.18.0",
    "@supabase/supabase-js": "^2.108.2",
    "@xyflow/react": "^12.11.3",
    "bwip-js": "^4.11.4",
    "fast-xml-parser": "^5.11.0",
    "geist": "^1.7.2",
    "gsap": "^3.15.0",
    "html2canvas": "^1.4.1",
    "jspdf": "^4.2.1",
    "jsqr": "^1.4.0",
    "jszip": "^3.10.1",
    "lucide-react": "^0.344.0",
    "motion": "^12.43.0",
    "pdf-lib": "^1.17.1",
    "pdfjs-dist": "^6.2.108",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^7.18.3",
    "react-to-print": "^3.3.0",
    "three": "^0.187.0",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@eslint/js": "^9.9.1",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@types/three": "^0.187.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.18",
    "eslint": "^9.9.1",
    "eslint-plugin-react-hooks": "^5.1.0-rc.0",
    "eslint-plugin-react-refresh": "^0.4.11",
    "globals": "^15.9.0",
    "postcss": "^8.4.35",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.5.3",
    "typescript-eslint": "^8.3.0",
    "vite": "^5.4.2",
    "vite-plugin-pwa": "^1.3.0",
    "vitest": "^2.1.8"
  }
}
```

**Observações sobre a stack**

- **Não é Next.js.** É Vite 5 + React 18 SPA com `react-router-dom` 7. Não há server
  actions, não há SSR, não há rotas de API no front: *todo* acesso a dado passa pelo
  cliente `@supabase/supabase-js` ou por edge function.
- **PWA** via `vite-plugin-pwa` — decisão operacional (rede ruim dentro do galpão).
- **3D**: `three` 0.187 + `@react-three/fiber` 8.18 + `@react-three/drei` 9.122.
- `jsqr` + `bwip-js`: leitura e geração de código de barras/QR já estão no bundle.
- O `name` do pacote ainda é `vite-react-typescript-starter` e a `version` é `0.0.0` — a
  versão real do produto é controlada fora do `package.json`.

### 1.2 Árvore de diretórios

```
project/
├── src/
│   ├── components/        (42 arquivos na raiz + 46 subpastas de domínio)
│   │   ├── wms/           ← núcleo deste raio-X
│   │   │   ├── Warehouse3DViewer.tsx
│   │   │   ├── WarehouseEnvironment.tsx
│   │   │   ├── WmsAnalytics.tsx
│   │   │   ├── WmsBinOperations.tsx
│   │   │   ├── WmsBinScanner.tsx
│   │   │   ├── WmsPulmaoPage.tsx
│   │   │   ├── WmsStockInsights.tsx
│   │   │   ├── WmsStorageMap.tsx
│   │   │   └── viewer3d/   (Cena3D, Hud3D, PainelDetalhe, Radar3D, aparencia, recursos3d, cacheDeConteudo)
│   │   ├── abcCurve/  abcxyz/  academy/  account/  admin/  analytics/  animations/
│   │   ├── audit/  automation/  balanceSource/  barcode/  brandLogos/  cbc/
│   │   ├── counting/  coverage/  dashboard/  effects/  fiscalEntities/  integrations/
│   │   ├── intelligence/  landing/  ledger/  legal/  lotControl/  nfe/  onboarding/
│   │   ├── originkit/  palletCalc/  pdfCenter/  productBrands/  productCatalog/
│   │   ├── productFreeze/  productivity/  purchaseOrders/  rca/  reports/
│   │   ├── reverseLogistics/  risk/  security/  settings/  slotting/
│   │   ├── spreadsheet-comparator/  support/  tasks/  ui/
│   ├── lib/               (72 arquivos na raiz + 41 subpastas)
│   │   ├── wms/           ← 23 módulos puros + serviço (ver §3 e §4)
│   │   ├── nfe/  physicalCount/  inventoryCycle/  integrations/  erp/  ledger/
│   │   ├── abcCurve/  purchaseOrders/  reverseLogistics/  security/  tasks/  …
│   ├── config/            (1 arquivo)
│   └── (App.tsx, main.tsx, index.css, vite-env.d.ts)
├── supabase/
│   ├── migrations/        (133 arquivos .sql, 27.192 linhas)
│   └── functions/         (11 edge functions + _shared + README)
│       ├── _shared/
│       ├── automation-run/       automation-webhook/
│       ├── blindai-agent/        erp-sync/
│       ├── integration-stock-write/
│       ├── integration-sync/     integration-webhook/
│       ├── nfe-fetch-by-key/     public-api/
│       ├── session-geolocation/  webhook-dispatch/
├── docs/
├── public/
├── index.html
├── vite.config.ts  tailwind.config.js  postcss.config.js  eslint.config.js
├── tsconfig.json  tsconfig.app.json  tsconfig.node.json
├── wasmer.toml  app.yaml        ← deploy (Wasmer)
├── CLAUDE.md  INVENTORYBLIND-DESIGN.md  README.md
```

**Separação observada:** `src/lib/**` concentra a lógica pura e os serviços de dados;
`src/components/**` concentra a UI. No módulo WMS essa separação é levada a sério — toda
a geometria, classificação e roteirização do 3D vive em `src/lib/wms/*.ts` como funções
puras testáveis sem WebGL, e o componente só desenha.

---

## 2. Schema do Banco de Dados (Supabase / SQL)

### 2.0 Aviso: não existe `database.types.ts`

Procurei por tipos gerados (`database.types.ts`, `*.types.ts`) — **não existem no
repositório**. Os tipos de linha são declarados à mão em cada serviço (ex.: `StorageBin`,
`BinStockRow`, `BinMovement` em `wmsService.ts`). Consequência: o compilador não valida
nome nem tipo de coluna contra o banco. É a lacuna mais relevante da camada de dados.

### 2.1 Tabelas do núcleo WMS (definição viva)

`public` tem **176 tabelas**. As do núcleo de endereçamento e movimentação:

| Tabela | Colunas | RLS | Policies | Triggers |
|---|---|---|---|---|
| `warehouse_storage_bins` | 12 | ✅ | 4 | 2 |
| `warehouse_bin_stock` | 9 | ✅ | **1 (só SELECT)** | 0 |
| `warehouse_bin_movements` | 11 | ✅ | **1 (só SELECT)** | 0 |
| `warehouse_plan_sections` | 14 | ✅ | 4 | 0 |
| `warehouse_zones` | 12 | ✅ | 4 | 0 |
| `warehouse_cells` | 11 | ✅ | 4 | 0 |
| `warehouse_layouts` | 19 | ✅ | 4 | 0 |
| `warehouse_builder_objects` | 11 | ✅ | 4 | 0 |
| `warehouse_slotting_recommendations` | 15 | ✅ | 3 | 0 |
| `products` | 13 | ✅ | 4 | 0 |
| `companies` | 11 | ✅ | 4 | 1 |
| `company_members` | 5 | ✅ | 1 | 0 |
| `profiles` | 8 | ✅ | 4 | 1 |

Colunas, extraídas de `information_schema.columns`:

```sql
-- warehouse_storage_bins (o endereço)
id                uuid        NOT NULL DEFAULT gen_random_uuid()
company_id        text        NOT NULL DEFAULT get_my_company_id()
code              text        NOT NULL           -- etiqueta: 'PP-A01-N1'
bin_type          text        NOT NULL DEFAULT 'pulmao'
capacity_boxes    integer     NULL               -- NULL = sem limite declarado
blocked           boolean     NOT NULL DEFAULT false
blocked_reason    text        NULL
andar             integer     NOT NULL DEFAULT 1
predio            text        NOT NULL DEFAULT 'atual'
is_active         boolean     NOT NULL DEFAULT true
created_at        timestamptz NOT NULL DEFAULT now()
updated_at        timestamptz NOT NULL DEFAULT now()

-- warehouse_bin_stock (o saldo por endereço × produto)
id                uuid        NOT NULL DEFAULT gen_random_uuid()
company_id        text        NOT NULL DEFAULT get_my_company_id()
bin_id            uuid        NOT NULL
product_id        uuid        NOT NULL
boxes             integer     NOT NULL
units_per_box     integer     NOT NULL
units             integer     NULL               -- coluna gerada/derivada
first_stored_at   timestamptz NOT NULL DEFAULT now()   -- idade do lote, para FIFO
updated_at        timestamptz NOT NULL DEFAULT now()
-- chave de conflito: (company_id, bin_id, product_id)

-- warehouse_bin_movements (o razão de movimentação — append-only)
id                uuid        NOT NULL DEFAULT gen_random_uuid()
company_id        text        NOT NULL DEFAULT get_my_company_id()
movement_type     text        NOT NULL           -- 'entrada' | 'saida' | 'transferencia'
product_id        uuid        NOT NULL
from_bin_id       uuid        NULL
to_bin_id         uuid        NULL
boxes             integer     NOT NULL
units_per_box     integer     NOT NULL
reason            text        NULL
created_by        uuid        NULL
created_at        timestamptz NOT NULL DEFAULT now()

-- warehouse_plan_sections (medidas físicas da planta, por pavimento)
id                     uuid        NOT NULL DEFAULT gen_random_uuid()
company_id             text        NOT NULL DEFAULT get_my_company_id()
andar                  integer     NOT NULL DEFAULT 1
nome                   text        NOT NULL
z_inicio               numeric     NOT NULL
comprimento            numeric     NOT NULL
fileiras               integer     NOT NULL
comprimento_da_fileira numeric     NOT NULL
corredor_inicio        numeric     NOT NULL DEFAULT 0
distribuicao           text        NOT NULL DEFAULT 'uniforme'
corredor_longitudinal  numeric     NOT NULL DEFAULT 1.2
rotulos                text[]      NOT NULL DEFAULT '{}'
created_at             timestamptz NOT NULL DEFAULT now()
updated_at             timestamptz NOT NULL DEFAULT now()

-- products
id              uuid        NOT NULL DEFAULT gen_random_uuid()
name            text        NOT NULL
sku             text        NOT NULL
ean             text        NULL
location        text        NULL     -- texto livre, NÃO é código de vaga (ver §5)
price           numeric     NULL
company_id      text        NOT NULL DEFAULT get_my_company_id()
stock_quantity  integer     NOT NULL DEFAULT 0
frozen_at       timestamptz NULL
frozen_reason   text        NULL
frozen_by       uuid        NULL
created_at      timestamptz NULL DEFAULT now()
updated_at      timestamptz NULL DEFAULT now()

-- multi-tenant
companies(id uuid PK, name, slug, owner_id uuid, plan text DEFAULT 'starter',
          settings jsonb, icon, description, logo_path)
company_members(user_id uuid, company_id uuid, role text DEFAULT 'viewer',
                created_at, last_accessed_at)
profiles(id uuid DEFAULT auth.uid(), name, email, company_id uuid,
         role text NOT NULL DEFAULT 'counter', must_change_password boolean, …)
```

> ⚠️ **Inconsistência de tipo no multi-tenant.** `companies.id` e `profiles.company_id` são
> `uuid`, mas `products.company_id` e **todas** as `warehouse_*.company_id` são `text`, com
> default `get_my_company_id()` — que devolve `company_id::text`. Funciona porque a
> comparação é sempre texto-com-texto, mas **não há foreign key** possível de
> `warehouse_*.company_id` para `companies.id`, e nada no banco impede um `company_id`
> órfão. Ver §5.

### 2.2 Multi-tenant: as duas funções que sustentam todo o RLS

```sql
CREATE OR REPLACE FUNCTION public.get_my_company_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT company_id::text FROM profiles WHERE id = auth.uid()
$function$

CREATE OR REPLACE FUNCTION public.wms_require_operator()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
$function$
```

### 2.3 Policies de RLS do núcleo WMS

```sql
-- products: CRUD completo, isolado por empresa, sem exigência de papel
products_select  SELECT authenticated  USING      (company_id = get_my_company_id())
products_insert  INSERT authenticated  WITH CHECK (company_id = get_my_company_id())
products_update  UPDATE authenticated  USING/CHECK(company_id = get_my_company_id())
products_delete  DELETE authenticated  USING      (company_id = get_my_company_id())

-- warehouse_storage_bins: leitura para todos da empresa, ESCRITA só para gestão
wms_bins_select  SELECT authenticated  USING (company_id = get_my_company_id())
wms_bins_insert  INSERT authenticated  WITH CHECK (company_id = get_my_company_id()
                   AND get_my_role() = ANY (ARRAY['owner','admin','manager']))
wms_bins_update  UPDATE authenticated  USING/CHECK (idem)
wms_bins_delete  DELETE authenticated  USING (idem)

-- warehouse_bin_stock: SOMENTE LEITURA pela API pública
wms_stock_select     SELECT authenticated USING (company_id = get_my_company_id())
-- (não existe policy de INSERT, UPDATE ou DELETE)

-- warehouse_bin_movements: SOMENTE LEITURA pela API pública
wms_movements_select SELECT authenticated USING (company_id = get_my_company_id())
-- (não existe policy de INSERT, UPDATE ou DELETE)

-- warehouse_plan_sections: leitura para a empresa, escrita só para gestão
warehouse_plan_sections_select SELECT USING (company_id = get_my_company_id())
warehouse_plan_sections_insert INSERT WITH CHECK (company_id = get_my_company_id()
                   AND get_my_role() = ANY (ARRAY['owner','admin','manager']))
warehouse_plan_sections_update UPDATE USING/CHECK (idem)
warehouse_plan_sections_delete DELETE USING (idem)
```

> **Esta é a decisão de arquitetura mais importante do módulo.** `warehouse_bin_stock` e
> `warehouse_bin_movements` **não têm policy de escrita nenhuma**. Com RLS ligado e sem
> policy, todo INSERT/UPDATE/DELETE vindo do cliente é recusado. O saldo e o razão só podem
> ser alterados pelas funções `SECURITY DEFINER` abaixo — ou seja, **é impossível mexer no
> saldo sem passar pela regra de negócio**. O front não tem como escrever saldo direto nem
> por engano.

### 2.4 RPCs de movimentação (definição viva, completa)

```sql
CREATE OR REPLACE FUNCTION public.wms_resolve_bin(p_company text, p_code text, p_require_unblocked boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
$function$
```

```sql
CREATE OR REPLACE FUNCTION public.wms_bin_putaway(p_bin_code text, p_product_id uuid, p_boxes integer, p_units_per_box integer, p_reason text DEFAULT 'recebimento'::text)
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
$function$
```

```sql
CREATE OR REPLACE FUNCTION public.wms_bin_pick(p_bin_code text, p_product_id uuid, p_boxes integer, p_reason text DEFAULT 'abastecimento'::text)
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
$function$
```

```sql
CREATE OR REPLACE FUNCTION public.wms_bin_transfer(p_from_bin_code text, p_to_bin_code text, p_product_id uuid, p_boxes integer, p_reason text DEFAULT 'transferencia'::text)
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
$function$
```

### 2.5 Trigger de guarda de capacidade

```sql
CREATE OR REPLACE FUNCTION public.wms_guard_bin_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ocupado integer;
BEGIN
  -- Sem limite declarado: nada a conferir.
  IF NEW.capacity_boxes IS NULL THEN
    RETURN NEW;
  END IF;

  -- `UPDATE OF capacity_boxes` dispara quando a coluna está no SET, mesmo que o valor
  -- seja o mesmo. Sem esta saída, salvar o formulário sem mexer na capacidade de um
  -- endereço já lotado seria recusado.
  IF NEW.capacity_boxes IS NOT DISTINCT FROM OLD.capacity_boxes THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(sum(boxes), 0) INTO v_ocupado
  FROM warehouse_bin_stock
  WHERE bin_id = NEW.id;

  IF NEW.capacity_boxes < v_ocupado THEN
    RAISE EXCEPTION
      'Capacidade % é menor que as % caixa(s) já guardadas em %. Retire mercadoria antes de reduzir.',
      NEW.capacity_boxes, v_ocupado, NEW.code;
  END IF;

  RETURN NEW;
END;
$function$
```

### 2.6 Endereçamento a partir da NF-e

```sql
nfe_putaway_item(p_item_id uuid, p_bin_code text, p_boxes integer,
                 p_units_per_box integer, p_lot_number text, p_expiry_date date)
  RETURNS uuid   SECURITY DEFINER   -- 3.752 caracteres
-- Tabela de apoio: nfe_putaway_assignments (14 colunas, RLS, 1 policy)
```

Esta é a ponte entre recebimento fiscal e endereçamento: o item da nota vira saldo no
endereço. **Não incluí o corpo completo** por volume; é o único RPC de movimentação cuja
definição ficou de fora deste documento.

### 2.7 Demais domínios no banco (inventário, não incluídos em detalhe)

As 176 tabelas cobrem muito mais que o WMS. Por volume, aqui só os grupos e a contagem:

| Domínio | Tabelas | Observação |
|---|---|---|
| Contagem física / inventário cego | `physical_count_sessions`, `physical_count_items`, `physical_count_events`, `physical_count_recount_*`, `inventory_count_records`, `inventory_items`, `inventory_cycles`, `inventory_snapshots` | o coração do produto original |
| Curva ABC / XYZ | `abc_curve_*` (4), `product_abc_xyz_classifications`, `product_abc_xyz_history` | alimenta a cor do 3D |
| Integrações / ERP | `integration_*` (14), `erp_*` (2), `api_keys`, `company_webhook*` (3) | `integration_sync_items` = 29 MB, a maior tabela |
| NF-e | `nfe_invoices`, `nfe_invoice_items`, `nfe_putaway_assignments`, `nfe_count_events`, `nfe_learned_associations` | |
| Pedidos de compra | `purchase_orders`, `purchase_order_items`, `po_allocations`, `po_nfe_links`, `po_import_*` | |
| Logística reversa | `returns`, `return_items` (39 col.), `return_stock_movements`, +10 | **razão de estoque paralelo** — ver §5 |
| RCA (causa raiz) | `rca_*` (12) | |
| Risco / confiança | `product_risk_scores` (11 MB), `product_confidence_scores` (9 MB) | |
| Tarefas, Academy, suporte, legal, gamificação | ~40 | fora do escopo WMS |

---

## 3. Regras de Negócio e Fluxos Críticos

A cadeia completa de uma movimentação é:

```
UI (WmsBinOperations / WmsBinScanner)
  → wmsService.putaway/pick/transfer        (src/lib/wms/wmsService.ts)
    → supabase.rpc('wms_bin_putaway' | 'wms_bin_pick' | 'wms_bin_transfer')
      → wms_require_operator()   — autenticação + papel
      → wms_resolve_bin()        — código → uuid, checa bloqueio
      → validação de capacidade e de pack
      → UPSERT warehouse_bin_stock  +  INSERT warehouse_bin_movements
```

Não há caminho alternativo: como mostrado em §2.3, o cliente não tem permissão de escrita
nessas duas tabelas.


### 3.1 Serviço de dados do WMS — a API inteira do módulo

#### `src/lib/wms/wmsService.ts`  _(698 linhas)_

```ts
// Pulmão endereçado (porta-pallet) — migration 116.
//
// Acesso aos endereços de armazenagem, ao saldo por endereço e aos movimentos.
//
// Regra que atravessa este arquivo: SALDO NÃO SE ESCREVE. As tabelas
// `warehouse_bin_stock` e `warehouse_bin_movements` não têm policy de escrita — só as
// RPCs `wms_bin_*` (SECURITY DEFINER) gravam nelas. Por isso aqui não existe nenhum
// `.insert()` ou `.update()` nessas duas tabelas: todo movimento passa por RPC, e é o
// que garante que todo número tenha um documento com autor e horário.
//
// O que este módulo NÃO toca: `products.location` e o campo de local do Tiny continuam
// sendo o vão de picking das capas, e nada aqui lê ou escreve neles.

import { supabase } from '../supabase';
import type { PlacementMovement, StockPlacement } from './stockInsights';
import type { AnalyticsMovement } from './pulmaoAnalytics';

export interface StorageBin {
  id: string;
  code: string;
  binType: 'pulmao' | 'picking';
  capacityBoxes: number | null;
  blocked: boolean;
  blockedReason: string | null;
}

export interface BinStockRow {
  productId: string;
  sku: string;
  productName: string;
  binCode: string;
  binBlocked: boolean;
  boxes: number;
  unitsPerBox: number;
  units: number;
  firstStoredAt: string;
}

export interface BinMovement {
  id: string;
  movementType: 'entrada' | 'saida' | 'transferencia';
  sku: string | null;
  productName: string | null;
  fromCode: string | null;
  toCode: string | null;
  boxes: number;
  unitsPerBox: number;
  reason: string | null;
  createdAt: string;
}

const BIN_COLUMNS = 'id, code, bin_type, capacity_boxes, blocked, blocked_reason';

type BinRow = {
  id: string;
  code: string;
  bin_type: 'pulmao' | 'picking';
  capacity_boxes: number | null;
  blocked: boolean;
  blocked_reason: string | null;
};

const binFromRow = (row: BinRow): StorageBin => ({
  id: row.id,
  code: row.code,
  binType: row.bin_type,
  capacityBoxes: row.capacity_boxes,
  blocked: row.blocked,
  blockedReason: row.blocked_reason,
});

// ── Endereços ─────────────────────────────────────────────────────────────────────────

/** Ordenado pelo código: como ele é hierárquico (rua, módulo, nível), a ordem alfabética
 *  já é a sequência de caminhada pelo corredor. É o que dispensa desenhar planta baixa. */
export async function listBins(): Promise<StorageBin[]> {
  const { data, error } = await supabase
    .from('warehouse_storage_bins')
    .select(BIN_COLUMNS)
    .eq('bin_type', 'pulmao')
    .order('code', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as BinRow[]).map(binFromRow);
}

/**
 * Cria endereços em lote, ignorando os que já existem.
 *
 * `company_id` não vai no payload de propósito: o DEFAULT da coluna é
 * `get_my_company_id()`, que o banco resolve pela sessão. Mandar do cliente seria
 * exatamente o padrão que a auditoria da 115 removeu das RPCs.
 */
export async function createBins(codes: string[], capacityBoxes: number | null): Promise<number> {
  const unique = [...new Set(codes.map(code => code.trim()).filter(Boolean))];
  if (unique.length === 0) return 0;

  const { data, error } = await supabase
    .from('warehouse_storage_bins')
    .upsert(
      unique.map(code => ({ code, bin_type: 'pulmao', capacity_boxes: capacityBoxes })),
      { onConflict: 'company_id,code', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}

/**
 * Remove endereços criados por engano.
 *
 * Não há verificação de saldo aqui de propósito: as FKs de `warehouse_bin_stock` e
 * `warehouse_bin_movements` são ON DELETE RESTRICT, então o próprio banco recusa apagar
 * endereço que já recebeu mercadoria. Checar no cliente seria uma segunda verdade que
 * pode divergir — a garantia fica onde não dá para contornar.
 */
export async function deleteBins(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('warehouse_storage_bins').delete().in('id', ids);
  if (error) {
    // 23503 = violação de chave estrangeira: o endereço tem histórico.
    if (error.code === '23503') {
      throw new Error('Este endereço já tem movimentação registrada e não pode ser apagado. Bloqueie-o em vez disso.');
    }
    throw new Error(error.message);
  }
}

/**
 * Capacidade do endereço, em caixas. `null` = sem limite declarado.
 *
 * Reduzir abaixo do que já está guardado é recusado pelo banco (trigger da 118), não por
 * uma checagem daqui — a regra precisa valer para qualquer caminho até a tabela, não só
 * para este formulário. A mensagem exibida é a que o banco devolve.
 */
export async function setBinCapacity(id: string, capacityBoxes: number | null): Promise<void> {
  if (capacityBoxes !== null && (!Number.isInteger(capacityBoxes) || capacityBoxes < 1)) {
    throw new Error('A capacidade precisa ser um número inteiro maior que zero, ou vazia para “sem limite”.');
  }
  const { error } = await supabase
    .from('warehouse_storage_bins')
    .update({ capacity_boxes: capacityBoxes })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setBinBlocked(id: string, blocked: boolean, reason: string | null): Promise<void> {
  const { error } = await supabase
    .from('warehouse_storage_bins')
    .update({ blocked, blocked_reason: blocked ? reason : null })
    .eq('id', id);
  if (error) throw error;
}

// ── Saldo ─────────────────────────────────────────────────────────────────────────────

type StockRow = {
  product_id: string;
  sku: string;
  product_name: string;
  bin_code: string;
  bin_blocked: boolean;
  boxes: number;
  units_per_box: number;
  units: number;
  first_stored_at: string;
};

const stockFromRow = (row: StockRow): BinStockRow => ({
  productId: row.product_id,
  sku: row.sku,
  productName: row.product_name,
  binCode: row.bin_code,
  binBlocked: row.bin_blocked,
  boxes: row.boxes,
  unitsPerBox: row.units_per_box,
  units: row.units,
  firstStoredAt: row.first_stored_at,
});

const STOCK_COLUMNS = 'product_id, sku, product_name, bin_code, bin_blocked, boxes, units_per_box, units, first_stored_at';

/** "Onde está o excesso deste SKU" — a pergunta que hoje custa procurar no olho.
 *  Mais antigo primeiro: é a ordem em que o estoque deve ser consumido. */
export async function searchStock(term: string): Promise<BinStockRow[]> {
  const needle = term.trim();
  if (!needle) return [];

  const { data, error } = await supabase
    .from('wms_product_stock_v')
    .select(STOCK_COLUMNS)
    .or(`sku.ilike.%${needle}%,product_name.ilike.%${needle}%`)
    .order('first_stored_at', { ascending: true })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as StockRow[]).map(stockFromRow);
}

/** O que está guardado num endereço. Endereço misturado devolve várias linhas — é assim
 *  que a mistura deixa de ser bagunça e vira dado. */
export async function listBinContents(binCode: string): Promise<BinStockRow[]> {
  const { data, error } = await supabase
    .from('wms_product_stock_v')
    .select(STOCK_COLUMNS)
    .eq('bin_code', binCode)
    .order('first_stored_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as StockRow[]).map(stockFromRow);
}

/** Quantas caixas há em cada endereço — alimenta a ocupação da lista de endereços sem
 *  precisar de uma consulta por linha. */
export async function boxesByBin(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('wms_product_stock_v').select('bin_code, boxes');
  if (error) throw error;
  const map = new Map<string, number>();
  for (const row of (data ?? []) as { bin_code: string; boxes: number }[]) {
    map.set(row.bin_code, (map.get(row.bin_code) ?? 0) + row.boxes);
  }
  return map;
}

/**
 * Quantas caixas há em UM endereço.
 *
 * Existe para o tempo real do mapa 3D não recarregar o armazém inteiro a cada movimento:
 * medido em produção, `listBins()` mais `boxesByBin()` custam ~1,5 s e trazem 215 linhas
 * para redesenhar uma vaga que mudou. Aqui vem uma.
 *
 * Devolve 0 para endereço sem saldo — que é o estado de uma vaga esvaziada, e é
 * justamente o evento mais comum. `null` significaria "não sei", e a tela trataria um
 * esvaziamento como falha de leitura.
 */
export async function boxesForBin(binCode: string): Promise<number> {
  const { data, error } = await supabase
    .from('wms_product_stock_v')
    .select('boxes')
    .eq('bin_code', binCode);
  if (error) throw error;
  return ((data ?? []) as { boxes: number }[]).reduce((total, row) => total + row.boxes, 0);
}

/** Uma linha de saldo por (endereço, SKU) — sem nome de produto, sem pack, sem data.
 *
 *  Existe separada de `boxesByBin` porque a pergunta é outra: aquela responde "quanto
 *  há aqui", esta responde "O QUE há aqui". Cruzar endereço com classificação de
 *  produto exige o SKU, que a soma por endereço joga fora.
 *
 *  Paginada: o PostgREST corta a resposta em 1000 linhas por padrão, e endereço
 *  misturado gera MAIS linhas que endereços. Sem paginar, um pulmão grande voltaria
 *  truncado em silêncio e a tela coloriria parte do armazém como "sem classificação"
 *  sem nada indicar que o dado foi cortado.
 */
export async function skusByBin(): Promise<Map<string, { sku: string; boxes: number }[]>> {
  const PAGINA = 1000;
  const map = new Map<string, { sku: string; boxes: number }[]>();
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from('wms_product_stock_v')
      .select('bin_code, sku, boxes')
      .order('bin_code', { ascending: true })
      .order('sku', { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw error;
    const pagina = (data ?? []) as { bin_code: string; sku: string; boxes: number }[];
    for (const row of pagina) {
      const atual = map.get(row.bin_code);
      if (atual) atual.push({ sku: row.sku, boxes: row.boxes });
      else map.set(row.bin_code, [{ sku: row.sku, boxes: row.boxes }]);
    }
    if (pagina.length < PAGINA) return map;
  }
}

/**
 * Última quantidade por caixa conhecida para o SKU.
 *
 * A caixa fechada tem pack padronizado, então o operador informa isso UMA vez e o
 * sistema não pergunta de novo. A fonte é o histórico de movimentos — que nunca é
 * apagado —, e não `products`: assim o cadastro de produto continua intocado.
 */
export async function lastKnownPackSize(productId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('warehouse_bin_movements')
    .select('units_per_box')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { units_per_box: number } | null)?.units_per_box ?? null;
}

export interface ProductOption {
  id: string;
  sku: string;
  name: string;
}

/** Busca de produto para a tela de guardar. Lê só o cadastro — não toca em
 *  `products.location`, que é do fluxo de picking das capas. */
export async function searchProducts(term: string): Promise<ProductOption[]> {
  const needle = term.trim();
  if (needle.length < 2) return [];

  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name')
    .or(`sku.ilike.%${needle}%,name.ilike.%${needle}%,ean.ilike.%${needle}%`)
    .order('sku', { ascending: true })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as ProductOption[];
}

// ── Movimentos ────────────────────────────────────────────────────────────────────────

type MovementRow = {
  id: string;
  movement_type: 'entrada' | 'saida' | 'transferencia';
  boxes: number;
  units_per_box: number;
  reason: string | null;
  created_at: string;
  products: { sku: string; name: string } | null;
  from_bin: { code: string } | null;
  to_bin: { code: string } | null;
};

const MOVEMENT_COLUMNS =
  'id, movement_type, boxes, units_per_box, reason, created_at,' +
  ' products(sku, name),' +
  ' from_bin:from_bin_id(code),' +
  ' to_bin:to_bin_id(code)';

const movementFromRow = (row: MovementRow): BinMovement => ({
  id: row.id,
  movementType: row.movement_type,
  sku: row.products?.sku ?? null,
  productName: row.products?.name ?? null,
  fromCode: row.from_bin?.code ?? null,
  toCode: row.to_bin?.code ?? null,
  boxes: row.boxes,
  unitsPerBox: row.units_per_box,
  reason: row.reason,
  createdAt: row.created_at,
});

/** Última movimentação que tocou esta vaga, entrando ou saindo. Consultada sob demanda,
 *  ao abrir o detalhe de uma posição no mapa — nunca em lote para todas, que seria um
 *  N+1 só para preencher um rodapé. */
export async function lastMovementForBin(binId: string): Promise<BinMovement | null> {
  const { data, error } = await supabase
    .from('warehouse_bin_movements')
    .select(MOVEMENT_COLUMNS)
    .or(`from_bin_id.eq.${binId},to_bin_id.eq.${binId}`)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const rows = (data ?? []) as unknown as MovementRow[];
  return rows.length > 0 ? movementFromRow(rows[0]) : null;
}

/** Histórico de uma vaga: entradas, saídas e transferências que a tocaram, do mais
 *  recente para o mais antigo. Consultado só ao abrir o detalhe de uma posição. */
export async function listMovementsForBin(binId: string, limit = 20): Promise<BinMovement[]> {
  const { data, error } = await supabase
    .from('warehouse_bin_movements')
    .select(MOVEMENT_COLUMNS)
    .or(`from_bin_id.eq.${binId},to_bin_id.eq.${binId}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as unknown as MovementRow[]).map(movementFromRow);
}

export async function listMovements(limit = 50): Promise<BinMovement[]> {
  const { data, error } = await supabase
    .from('warehouse_bin_movements')
    .select(MOVEMENT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as unknown as MovementRow[]).map(movementFromRow);
}

// ── Operações (sempre por RPC) ────────────────────────────────────────────────────────

export async function putaway(params: {
  binCode: string;
  productId: string;
  boxes: number;
  unitsPerBox: number;
  reason?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('wms_bin_putaway', {
    p_bin_code: params.binCode,
    p_product_id: params.productId,
    p_boxes: params.boxes,
    p_units_per_box: params.unitsPerBox,
    p_reason: params.reason ?? 'recebimento',
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function pick(params: {
  binCode: string;
  productId: string;
  boxes: number;
  reason?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('wms_bin_pick', {
    p_bin_code: params.binCode,
    p_product_id: params.productId,
    p_boxes: params.boxes,
    p_reason: params.reason ?? 'abastecimento',
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function transfer(params: {
  fromBinCode: string;
  toBinCode: string;
  productId: string;
  boxes: number;
  reason?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('wms_bin_transfer', {
    p_from_bin_code: params.fromBinCode,
    p_to_bin_code: params.toBinCode,
    p_product_id: params.productId,
    p_boxes: params.boxes,
    p_reason: params.reason ?? 'transferencia',
  });
  if (error) throw new Error(error.message);
  return data as string;
}

// ── Geração de códigos ────────────────────────────────────────────────────────────────

/** Uma rua do pulmão — na prática um paredão, um meio de galpão, um bloco de
 *  porta-pallet. Cada uma tem a própria contagem porque estrutura real não é uniforme:
 *  um paredão de 13 módulos com 3 níveis convive com um meio de 7 módulos e 1 nível. */
export interface BinStreetSpec {
  street: string;
  modules: number;
  levels: number;
}

export interface BinCodePattern {
  prefix: string;
  streets: BinStreetSpec[];
}

/**
 * Monta os códigos a partir do padrão. Formato: `PREFIXO-RUA MÓDULO-N NÍVEL`,
 * ex.: `PP-A01-N1`. Módulo e nível com dois e um dígito para a ordenação alfabética
 * coincidir com a ordem física do corredor — é disso que a rota depende.
 */
export function buildBinCodes(pattern: BinCodePattern): string[] {
  const prefix = pattern.prefix.trim().toUpperCase().replace(/-+$/, '');
  const codes: string[] = [];
  for (const spec of pattern.streets) {
    const rua = spec.street.trim().toUpperCase();
    // Rua é só letra: o código separa rua de módulo pela virada de letra para número
    // (`PP-A01-N1`). Um dígito na rua tornaria `PP-113-N1` ambíguo.
    if (!rua || !/^[A-Z]+$/.test(rua)) continue;
    for (let m = 1; m <= spec.modules; m += 1) {
      for (let n = 1; n <= spec.levels; n += 1) {
        codes.push(`${prefix}-${rua}${String(m).padStart(2, '0')}-N${n}`);
      }
    }
  }
  return codes;
}

// ── Fase 3: consulta por SKU, distribuição e permanência ─────────────────────────────

/** Saldo lido da tabela, e não da view `wms_product_stock_v`: a view não expõe `ean`
 *  nem `bin_id`, e os dois são necessários aqui — EAN para a busca, `bin_id` para
 *  cruzar com o histórico. Mesma tabela, mesma RLS; nenhuma fonte nova de saldo. */
const PLACEMENT_COLUMNS =
  'bin_id, product_id, boxes, units_per_box, units, first_stored_at,' +
  ' bin:bin_id(code, blocked, capacity_boxes),' +
  ' product:product_id(sku, name, ean)';

interface PlacementRow {
  bin_id: string;
  product_id: string;
  boxes: number;
  units_per_box: number;
  units: number;
  first_stored_at: string;
  bin: { code: string; blocked: boolean; capacity_boxes: number | null } | null;
  product: { sku: string; name: string; ean: string | null } | null;
}

const placementFromRow = (row: PlacementRow): StockPlacement => ({
  productId: row.product_id,
  sku: row.product?.sku ?? '—',
  productName: row.product?.name ?? '—',
  ean: row.product?.ean ?? null,
  binId: row.bin_id,
  binCode: row.bin?.code ?? '—',
  binBlocked: row.bin?.blocked ?? false,
  binCapacityBoxes: row.bin?.capacity_boxes ?? null,
  boxes: row.boxes,
  unitsPerBox: row.units_per_box,
  units: row.units,
  firstStoredAt: row.first_stored_at,
});

/** Teto de linhas de saldo lidas de uma vez. O pulmão tem dezenas de vagas, não
 *  milhares — se um dia encostar aqui, a tela avisa em vez de mostrar meia verdade. */
const PLACEMENT_LIMIT = 2000;

/** Teto de movimentos. Atingi-lo significa histórico incompleto para o cálculo de
 *  antiguidade, e aí NENHUMA data pode ser anunciada como exata (ver `truncated`). */
const MOVEMENT_SCAN_LIMIT = 5000;

export interface PulmaoStock {
  placements: StockPlacement[];
  movements: PlacementMovement[];
  /** Histórico veio cortado: as datas viram todas limite superior. */
  truncated: boolean;
}

const EMPTY_STOCK: PulmaoStock = { placements: [], movements: [], truncated: false };

/** Movimentos que importam para a antiguidade: só os do período em que as ocupações
 *  ATUAIS começaram. Movimento anterior pertence a uma ocupação já encerrada (a linha
 *  de saldo é apagada ao zerar), então não diz nada sobre o que está guardado hoje. */
async function movementsSince(productIds: string[], since: string): Promise<{ rows: PlacementMovement[]; truncated: boolean }> {
  if (productIds.length === 0) return { rows: [], truncated: false };

  const { data, error } = await supabase
    .from('warehouse_bin_movements')
    .select('product_id, from_bin_id, to_bin_id, created_at')
    .in('product_id', productIds)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(MOVEMENT_SCAN_LIMIT);
  if (error) throw error;

  const rows = (data ?? []) as Array<{ product_id: string; from_bin_id: string | null; to_bin_id: string | null; created_at: string }>;
  return {
    rows: rows.map(r => ({
      productId: r.product_id,
      fromBinId: r.from_bin_id,
      toBinId: r.to_bin_id,
      createdAt: r.created_at,
    })),
    truncated: rows.length >= MOVEMENT_SCAN_LIMIT,
  };
}

const withMovements = async (placements: StockPlacement[]): Promise<PulmaoStock> => {
  if (placements.length === 0) return EMPTY_STOCK;
  const since = placements.reduce((min, p) => (p.firstStoredAt < min ? p.firstStoredAt : min), placements[0].firstStoredAt);
  const ids = [...new Set(placements.map(p => p.productId))];
  const { rows, truncated } = await movementsSince(ids, since);
  return { placements, movements: rows, truncated };
};

/** "Onde está este SKU" — por SKU, nome ou EAN. Duas consultas leves: acha os produtos,
 *  depois o saldo deles. Buscar pelo produto primeiro é o que permite usar o EAN sem
 *  duplicar cadastro nenhum. */
export async function searchPulmaoStock(term: string): Promise<PulmaoStock> {
  const needle = term.trim();
  if (needle.length < 2) return EMPTY_STOCK;

  const { data: produtos, error: erroProdutos } = await supabase
    .from('products')
    .select('id')
    .or(`sku.ilike.%${needle}%,name.ilike.%${needle}%,ean.ilike.%${needle}%`)
    .limit(100);
  if (erroProdutos) throw erroProdutos;

  const ids = (produtos ?? []).map(p => (p as { id: string }).id);
  if (ids.length === 0) return EMPTY_STOCK;

  const { data, error } = await supabase
    .from('warehouse_bin_stock')
    .select(PLACEMENT_COLUMNS)
    .in('product_id', ids)
    .limit(PLACEMENT_LIMIT);
  if (error) throw error;

  return withMovements(((data ?? []) as unknown as PlacementRow[]).map(placementFromRow));
}

/** Todo o saldo do pulmão — a base da visão de permanência. */
export async function listPulmaoStock(): Promise<PulmaoStock> {
  const { data, error } = await supabase
    .from('warehouse_bin_stock')
    .select(PLACEMENT_COLUMNS)
    .order('first_stored_at', { ascending: true })
    .limit(PLACEMENT_LIMIT);
  if (error) throw error;

  return withMovements(((data ?? []) as unknown as PlacementRow[]).map(placementFromRow));
}

// ── Fase 5: auditoria e indicadores ──────────────────────────────────────────────────

/** Teto de movimentos lidos de uma vez. Atingi-lo significa que os indicadores veem
 *  só um pedaço do periodo — e a tela avisa, em vez de somar meia verdade. */
const ANALYTICS_LIMIT = 1000;

export interface MovementFilter {
  fromISO: string;
  toISO: string;
  /** Resolvido pela tela, que já tem a lista de endereços carregada. */
  binId?: string;
  productIds?: string[];
  operatorId?: string;
  movementType?: 'entrada' | 'saida' | 'transferencia';
}

export interface AnalyticsResult {
  movements: AnalyticsMovement[];
  truncated: boolean;
}

interface AnalyticsRow {
  id: string;
  movement_type: 'entrada' | 'saida' | 'transferencia';
  product_id: string | null;
  boxes: number;
  created_at: string;
  created_by: string | null;
  products: { sku: string; name: string } | null;
  from_bin: { code: string } | null;
  to_bin: { code: string } | null;
}

const ANALYTICS_COLUMNS =
  'id, movement_type, product_id, boxes, created_at, created_by,' +
  ' products(sku, name),' +
  ' from_bin:from_bin_id(code),' +
  ' to_bin:to_bin_id(code)';

/**
 * Histórico para auditoria e indicadores.
 *
 * O nome do operador vem de `profiles` numa segunda consulta, porque `created_by`
 * referencia `auth.users`, não `profiles` — não há FK para o PostgREST embutir. Quem
 * a RLS de `profiles` não deixar ler fica sem nome, e a tela mostra "—" em vez do uuid.
 */
export async function listMovementsForAnalytics(filter: MovementFilter): Promise<AnalyticsResult> {
  let query = supabase
    .from('warehouse_bin_movements')
    .select(ANALYTICS_COLUMNS)
    .gte('created_at', filter.fromISO)
    .lte('created_at', filter.toISO)
    .order('created_at', { ascending: false })
    .limit(ANALYTICS_LIMIT);

  if (filter.movementType) query = query.eq('movement_type', filter.movementType);
  if (filter.operatorId) query = query.eq('created_by', filter.operatorId);
  if (filter.productIds) query = query.in('product_id', filter.productIds);
  // Um endereço pode ser origem OU destino do mesmo movimento.
  if (filter.binId) query = query.or(`from_bin_id.eq.${filter.binId},to_bin_id.eq.${filter.binId}`);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as AnalyticsRow[];
  const autores = [...new Set(rows.map(r => r.created_by).filter((v): v is string => !!v))];

  const nomes = new Map<string, string>();
  if (autores.length > 0) {
    const { data: perfis } = await supabase.from('profiles').select('id, name').in('id', autores);
    for (const p of (perfis ?? []) as Array<{ id: string; name: string | null }>) {
      if (p.name) nomes.set(p.id, p.name);
    }
  }

  return {
    movements: rows.map(r => ({
      id: r.id,
      movementType: r.movement_type,
      productId: r.product_id,
      sku: r.products?.sku ?? null,
      productName: r.products?.name ?? null,
      fromCode: r.from_bin?.code ?? null,
      toCode: r.to_bin?.code ?? null,
      boxes: r.boxes,
      createdAt: r.created_at,
      createdBy: r.created_by,
      operatorName: r.created_by ? nomes.get(r.created_by) ?? null : null,
    })),
    truncated: rows.length >= ANALYTICS_LIMIT,
  };
}
```


### 3.2 Código de endereço: o parser que tudo depende

#### `src/lib/wms/binCode.ts`  _(20 linhas)_

```ts
// Decompor o código de uma vaga em rua, módulo e nível.
//
// O código é compacto para caber na célula do mapa (`PP-A01-N1`), mas ninguém manda
// alguém até uma vaga falando assim: o que serve no chão é "Rua A, módulo 01, nível 1".
// A etiqueta impressa e o mapa precisam da MESMA leitura — por isso a regra mora aqui,
// e não copiada nos dois. Duas cópias de um regex divergem na primeira vez que o padrão
// de endereço mudar.

export interface ParsedBinCode {
  street: string;
  module: string;
  level: number;
}

export function parseBinCode(code: string): ParsedBinCode | null {
  const match = /^.+-([A-Za-z]+)(\d+)-N(\d+)$/.exec(code.trim());
  if (!match) return null;
  return { street: match[1].toUpperCase(), module: match[2], level: Number(match[3]) };
}
```


### 3.3 Bipagem: leitura de QR e normalização do código lido

#### `src/lib/wms/qrDecoder.ts`  _(86 linhas)_

```ts
// Decodificar um QR a partir de um quadro de vídeo. Dois motores, uma interface.
//
// O Android (e o Chrome do computador) traz `BarcodeDetector` embutido: custa zero byte
// e roda fora da thread principal. O Safari do iPhone tem a API implementada mas
// DESLIGADA de fábrica até hoje — por isso existe o segundo caminho.
//
// O jsQR entra por `import()` dinâmico de propósito: vira um pedaço separado do pacote,
// baixado só por quem não tem a API nativa. Quem abre o sistema no computador nunca
// paga por ele.

export interface QrDecoder {
  /** Texto do QR no quadro atual, ou null quando não há QR nenhum à vista. */
  decode(video: HTMLVideoElement): Promise<string | null>;
  dispose(): void;
}

/** `BarcodeDetector` não está no lib.dom desta versão do TypeScript. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/** Acima disso a leitura fica mais cara sem ficar melhor: um QR de 3 cm a um palmo do
 *  celular já ocupa muito mais que o mínimo de pixels que o decodificador precisa. */
const MAX_SIDE = 640;

const nativeDecoder = async (): Promise<QrDecoder | null> => {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? [];
    if (!formats.includes('qr_code')) return null;
    const detector = new Ctor({ formats: ['qr_code'] });
    return {
      decode: async video => {
        try {
          const found = await detector.detect(video);
          return found[0]?.rawValue ?? null;
        } catch {
          // Quadro inválido no meio da troca de resolução. O próximo serve.
          return null;
        }
      },
      dispose: () => undefined,
    };
  } catch {
    return null;
  }
};

const fallbackDecoder = async (): Promise<QrDecoder> => {
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d indisponível');

  return {
    decode: async video => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return null;

      const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // `dontInvert`: a etiqueta é preta sobre branco. Tentar o inverso a cada quadro
      // dobraria o custo para cobrir um caso que não existe nesta operação.
      const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
      return found?.data ?? null;
    },
    dispose: () => {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
};

export const createQrDecoder = async (): Promise<QrDecoder> =>
  (await nativeDecoder()) ?? (await fallbackDecoder());
```

#### `src/lib/wms/binScan.ts`  _(43 linhas)_

```ts
// O que a câmera lê -> o código do endereço.
//
// A etiqueta da vaga carrega uma URL (`https://host/?v=PP-A01-N1`), porque é isso que
// faz a câmera NATIVA do celular abrir o sistema direto. Mas o leitor interno recebe o
// texto cru, e precisa devolver só o código — do mesmo jeito que alguém digitaria.
//
// Essa é a razão de esta função ser pura e morar aqui, longe de câmera e de React: é a
// única parte da leitura que dá para testar sem aparelho.
//
// Nada do que sai daqui é tratado como verdade. O código segue exatamente o caminho do
// que foi digitado à mão, e quem decide se o endereço existe, está livre e comporta a
// carga continua sendo o banco, dentro das RPCs `wms_bin_*`.

import { BIN_SCAN_PARAM } from '../appRoutes';

/** Letra, número e hífen. É a forma que o gerador de endereços produz (`PP-A01-N1`),
 *  e serve de peneira contra QR de produto, nota fiscal ou adesivo de outra origem. */
const CODE_SHAPE = /^[A-Z0-9][A-Z0-9-]{0,39}$/;

export function binCodeFromScan(raw: string): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  let candidate = text;

  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    // URL sem o parâmetro da vaga é outro QR qualquer. Cair para o texto cru aqui
    // jogaria o endereço do site inteiro dentro do campo de endereço.
    const param = url.searchParams.get(BIN_SCAN_PARAM);
    if (!param) return null;
    candidate = param;
  }

  const code = candidate.trim().toUpperCase();
  return CODE_SHAPE.test(code) ? code : null;
}
```


### 3.4 Sugestão de endereço para guardar

#### `src/lib/wms/binSuggestion.ts`  _(213 linhas)_

```ts
// Onde guardar esta mercadoria.
//
// Sugestão, nunca decisão: a função devolve uma lista ordenada com o motivo de cada
// posição, e quem escolhe é o operador. Nada aqui movimenta nada.
//
// ── O que de fato restringe uma vaga ─────────────────────────────────────────────────
//
// Lido das RPCs da 116, não presumido. Só existem três restrições reais:
//
//   1. `blocked`              — vaga bloqueada não recebe mercadoria.
//   2. `capacity_boxes`       — quando declarada; NULL significa "sem limite declarado".
//   3. `units_per_box` igual  — a vaga não soma caixas de pack diferente do mesmo SKU.
//
// Não existe peso (nem em `products`, nem em `warehouse_storage_bins`), nem categoria,
// família, classe de armazenagem, restrição produto×vaga ou curva. Inventar qualquer
// uma delas aqui seria criar uma regra operacional que a empresa nunca cadastrou.
//
// ── O que NÃO é restrição, e por isso só desempata ───────────────────────────────────
//
// Não há localização física levantada — nenhuma coordenada, corredor ou distância. O
// que existe é o código hierárquico (`PP-A01-N1`), que dá ordem de caminhada e altura.
// Isso entra como critério de DESEMPATE e aparece rotulado como tal na tela, nunca como
// se fosse distância medida.

import { parseBinCode } from './binCode';
import type { StorageBin } from './wmsService';
import { plural } from '../../lib/formatPtBr';

/** O que já está guardado numa vaga, do ponto de vista de quem vai guardar mais. */
export interface BinOccupancy {
  /** Total de caixas na vaga, somando todos os SKUs. */
  totalBoxes: number;
  /** Caixas do SKU em questão, 0 se não houver. */
  sameSkuBoxes: number;
  /** Pack do SKU em questão nesta vaga, `null` se o SKU não estiver aqui. */
  sameSkuUnitsPerBox: number | null;
  /** Quantos SKUs distintos a vaga tem. */
  distinctSkus: number;
}

export const EMPTY_OCCUPANCY: BinOccupancy = {
  totalBoxes: 0,
  sameSkuBoxes: 0,
  sameSkuUnitsPerBox: null,
  distinctSkus: 0,
};

export type RejectionReason =
  | 'bloqueado'
  | 'sem-capacidade'
  | 'pack-diferente'
  | 'mesma-origem';

export interface BinSuggestion {
  bin: StorageBin;
  /** Motivos curtos, na ordem em que pesaram. */
  reasons: string[];
  /** Caixas livres, `null` quando a vaga não tem capacidade declarada. */
  freeBoxes: number | null;
  consolidates: boolean;
  occupancy: BinOccupancy;
}

export interface SuggestionInput {
  bins: StorageBin[];
  /** Ocupação por código de vaga. Ausente = vaga vazia. */
  occupancyByCode: Map<string, BinOccupancy>;
  boxes: number;
  /** Pack da mercadoria a guardar. `null` quando ainda não informado. */
  unitsPerBox: number | null;
  /** Transferência: a origem nunca pode ser destino. */
  excludeCode?: string;
}

/** Espaço livre em caixas, ou `null` quando não há capacidade declarada — sem
 *  denominador não existe "livre", e estimar um seria dado falso. */
export const freeBoxesOf = (bin: StorageBin, occ: BinOccupancy): number | null =>
  bin.capacityBoxes == null ? null : Math.max(0, bin.capacityBoxes - occ.totalBoxes);

/**
 * Por que uma vaga NÃO serve. `null` = serve.
 *
 * Cada motivo aqui corresponde a uma recusa que a RPC faria — a tela apenas antecipa,
 * para o operador não descobrir depois da ida ao servidor. Nenhum motivo é invenção
 * desta camada.
 */
export function rejectionFor(
  bin: StorageBin,
  occ: BinOccupancy,
  input: Pick<SuggestionInput, 'boxes' | 'unitsPerBox' | 'excludeCode'>,
): RejectionReason | null {
  if (input.excludeCode && bin.code === input.excludeCode) return 'mesma-origem';
  if (bin.blocked) return 'bloqueado';

  // Pack divergente: `wms_bin_putaway` e `wms_bin_transfer` recusam somar caixas de
  // packs diferentes do mesmo SKU na mesma linha de saldo.
  if (
    input.unitsPerBox != null &&
    occ.sameSkuUnitsPerBox != null &&
    occ.sameSkuUnitsPerBox !== input.unitsPerBox
  ) {
    return 'pack-diferente';
  }

  const livre = freeBoxesOf(bin, occ);
  if (livre != null && input.boxes > livre) return 'sem-capacidade';

  return null;
}

/** Peso de cada critério. Separado do cálculo para a ordem ficar legível e testável. */
const SCORE = {
  consolida: 1_000_000,
  vazia: 10_000,
  livrePorCaixa: 10,
  nivelBaixo: 100,
} as const;

export function suggestBins(input: SuggestionInput): BinSuggestion[] {
  const pontuadas: Array<{ score: number; suggestion: BinSuggestion }> = [];

  for (const bin of input.bins) {
    const occ = input.occupancyByCode.get(bin.code) ?? EMPTY_OCCUPANCY;
    if (rejectionFor(bin, occ, input) !== null) continue;

    const livre = freeBoxesOf(bin, occ);
    const consolida = occ.sameSkuBoxes > 0;
    const vazia = occ.totalBoxes === 0;
    const nivel = parseBinCode(bin.code)?.level ?? null;

    const reasons: string[] = [];
    if (consolida) reasons.push(`Já tem este SKU (${occ.sameSkuBoxes} cx)`);
    else if (vazia) reasons.push('Vaga vazia');
    else reasons.push(`Ocupada por ${occ.distinctSkus} ${plural(occ.distinctSkus, 'outro SKU', 'outros SKUs')}`);

    if (livre != null) reasons.push(`${livre} cx livres`);
    else reasons.push('Sem capacidade declarada');

    if (nivel != null && nivel <= 1) reasons.push('Nível baixo, mais fácil de acessar');

    let score = 0;
    if (consolida) score += SCORE.consolida;
    if (vazia) score += SCORE.vazia;
    if (livre != null) score += Math.min(livre, 500) * SCORE.livrePorCaixa;
    // Nível é desempate operacional, não regra cadastrada: quanto mais baixo, melhor,
    // porque alcançar N1 não depende de empilhadeira.
    if (nivel != null) score += Math.max(0, 4 - nivel) * SCORE.nivelBaixo;

    pontuadas.push({
      score,
      suggestion: { bin, reasons, freeBoxes: livre, consolidates: consolida, occupancy: occ },
    });
  }

  return pontuadas
    // Último desempate: a ordem do código, que é a ordem de caminhada pelo corredor.
    .sort((a, b) => b.score - a.score || a.suggestion.bin.code.localeCompare(b.suggestion.bin.code))
    .map(p => p.suggestion);
}

/** Saldo antes e depois, para a confirmação da transferência mostrar a conta. */
export interface BalancePreview {
  fromBefore: number;
  fromAfter: number;
  toBefore: number;
  toAfter: number;
}

export function previewTransfer(
  fromOcc: BinOccupancy,
  toOcc: BinOccupancy,
  boxes: number,
): BalancePreview {
  return {
    fromBefore: fromOcc.sameSkuBoxes,
    fromAfter: Math.max(0, fromOcc.sameSkuBoxes - boxes),
    toBefore: toOcc.sameSkuBoxes,
    toAfter: toOcc.sameSkuBoxes + boxes,
  };
}

/**
 * Ocupação por vaga, do ponto de vista de UM SKU.
 *
 * Deriva do mesmo `listPulmaoStock()` da Fase 3 — nenhuma consulta nova e nenhuma
 * segunda fonte de saldo. `productId` nulo (produto ainda não escolhido) devolve só a
 * ocupação geral, sem os campos do SKU.
 */
export function occupancyByProduct(
  placements: Array<{
    binCode: string;
    productId: string;
    boxes: number;
    unitsPerBox: number;
  }>,
  productId: string | null,
): Map<string, BinOccupancy> {
  const mapa = new Map<string, BinOccupancy>();

  for (const p of placements) {
    const atual = mapa.get(p.binCode) ?? { ...EMPTY_OCCUPANCY };
    atual.totalBoxes += p.boxes;
    atual.distinctSkus += 1;
    if (productId && p.productId === productId) {
      atual.sameSkuBoxes += p.boxes;
      atual.sameSkuUnitsPerBox = p.unitsPerBox;
    }
    mapa.set(p.binCode, atual);
  }

  return mapa;
}
```


### 3.5 Carga das vagas e regra de status (pura, sem WebGL)

#### `src/lib/wms/warehouse3dSlots.ts`  _(169 linhas)_

```ts
// Converte os endereços reais do Pulmão no formato que a cena 3D desenha.
//
// Mora aqui, e não dentro do componente, por um motivo só: a regra de status é
// verificável sem WebGL. Dentro do `<Canvas>` ela só poderia ser conferida por
// screenshot, que é a forma mais fraca de provar que uma cor significa o que diz.
//
// NADA de schema novo: consome `listBins()` e `boxesByBin()`, que já existem e já são
// o que o mapa 2D usa. Nenhuma migration, nenhum tipo gerado, nenhuma query nova.
//
// ── O que o banco NÃO oferece ───────────────────────────────────────────────────
// A Fase 2 pediu "divergência pendente de inventário cego" como estado da vaga. Esse
// vínculo NÃO EXISTE no schema: a divergência de contagem é apurada por produto, e o
// produto se localiza por `products.location`, que não é um código de vaga. Medido no
// banco de produção: dos 2.174 produtos com `location` preenchido, ZERO casam com o
// padrão de endereço (`PP-A01-N1`). Não há como ligar uma divergência a uma vaga sem
// uma decisão de produto que ainda não foi tomada.
//
// Por isso `divergence` aqui significa SOMENTE capacidade excedida. Inventar uma
// heurística para o resto produziria uma cor de alerta que não corresponde a nada —
// pior que não ter a cor, porque o operador agiria sobre ela.

import { listBins, boxesByBin, type StorageBin } from './wmsService';
import { parseBinCode } from './binCode';

export type SlotStatus = 'empty' | 'occupied' | 'divergence' | 'blocked';

export interface Slot {
  /** Código real impresso na etiqueta: `PP-A01-N1`. */
  id: string;
  /** Índice da rua (1-based) para posicionar em X. A rua real é uma LETRA, não número. */
  rua: number;
  /** Letra da rua como está no código: 'A', 'B'... Para exibir, nunca para posicionar. */
  ruaCodigo: string;
  modulo: number;
  nivel: number;
  status: SlotStatus;
  caixas: number;
  capacidade: number | null;
}

export interface WarehouseSlots {
  slots: Slot[];
  /**
   * Vagas cujo código não segue o padrão de endereço e portanto não têm posição no
   * espaço. NÃO são descartadas em silêncio: o mapa 2D também as mantém num grupo
   * próprio, e sumir com elas faria o 3D mostrar menos vagas do que o armazém tem,
   * sem dizer isso a ninguém.
   */
  naoPosicionaveis: string[];
  /**
   * UUID da vaga -> código impresso na etiqueta.
   *
   * O mapa 3D identifica vaga pelo CÓDIGO (`PP-A01-N1`), mas o banco referencia por
   * UUID: o saldo guarda `bin_id`, não o código. Um evento de tempo real chega com o
   * UUID, e sem esta tradução não há como saber QUAL endereço acabou de mudar.
   *
   * Inclui também as vagas não posicionáveis: elas não aparecem no desenho, mas uma
   * mudança nelas ainda precisa ser reconhecida em vez de tratada como vaga
   * desconhecida.
   */
  codigoPorBinId: Map<string, string>;
}

/**
 * Status de uma vaga, na mesma ordem de precedência do mapa 2D (`WmsStorageMap`).
 *
 * `blocked` vem primeiro porque bloqueio é uma decisão humana que se sobrepõe ao
 * saldo: uma vaga bloqueada com caixas dentro continua bloqueada.
 *
 * `blocked` NÃO estava na especificação da Fase 1, que previa três estados. Foi
 * acrescentado porque a alternativa era pintar uma vaga bloqueada como livre — e
 * mandar um pallet para uma vaga interditada é um erro operacional caro.
 */
export function statusDaVaga(bin: Pick<StorageBin, 'blocked' | 'capacityBoxes'>, caixas: number): SlotStatus {
  if (bin.blocked) return 'blocked';
  if (caixas === 0) return 'empty';
  // Estouro de capacidade é o único "alerta" que o schema de fato sustenta hoje.
  // Estritamente maior: ocupar a capacidade inteira é a vaga cheia, não um defeito.
  if (bin.capacityBoxes !== null && caixas > bin.capacityBoxes) return 'divergence';
  return 'occupied';
}

/**
 * Monta as vagas posicionáveis a partir dos endereços e do saldo por vaga.
 *
 * Pura: recebe os dois conjuntos já carregados e não toca em rede. O índice da rua é
 * calculado sobre o conjunto INTEIRO (letras distintas, em ordem), e não por vaga —
 * só assim a rua B fica sempre entre a A e a C, mesmo que a B não tenha nenhuma vaga
 * no nível 1.
 */
export function buildSlots(bins: readonly StorageBin[], caixasPorVaga: ReadonlyMap<string, number>): WarehouseSlots {
  const naoPosicionaveis: string[] = [];
  const analisadas: { bin: StorageBin; rua: string; modulo: number; nivel: number }[] = [];

  for (const bin of bins) {
    const parsed = parseBinCode(bin.code);
    const modulo = parsed ? Number(parsed.module) : Number.NaN;
    if (!parsed || !Number.isFinite(modulo) || !Number.isFinite(parsed.level)) {
      naoPosicionaveis.push(bin.code);
      continue;
    }
    analisadas.push({ bin, rua: parsed.street, modulo, nivel: parsed.level });
  }

  const ruas = [...new Set(analisadas.map(a => a.rua))].sort();
  const indiceDaRua = new Map(ruas.map((letra, i) => [letra, i + 1]));

  const slots = analisadas.map(({ bin, rua, modulo, nivel }) => {
    const caixas = caixasPorVaga.get(bin.code) ?? 0;
    return {
      id: bin.code,
      rua: indiceDaRua.get(rua) ?? 1,
      ruaCodigo: rua,
      modulo,
      nivel,
      status: statusDaVaga(bin, caixas),
      caixas,
      capacidade: bin.capacityBoxes,
    };
  });

  // Construído sobre TODAS as vagas recebidas, não só as desenháveis — ver o comentário
  // de `codigoPorBinId`.
  const codigoPorBinId = new Map(bins.map(b => [b.id, b.code]));

  return { slots, naoPosicionaveis, codigoPorBinId };
}

/** Carrega os endereços reais do Pulmão e o saldo de cada um. */
export async function loadWarehouseSlots(): Promise<WarehouseSlots> {
  const [bins, caixas] = await Promise.all([listBins(), boxesByBin()]);
  return buildSlots(bins, caixas);
}

/**
 * Atualiza o saldo de UMA vaga, devolvendo um conjunto novo.
 *
 * Existe para o tempo real não recarregar o armazém inteiro: medido em produção, a recarga
 * completa custa ~1,5 s e traz 215 endereços para refletir a movimentação de um.
 *
 * ── O status é RECALCULADO, não copiado ─────────────────────────────────────────
 * Passa pela mesma `statusDaVaga` da carga completa. Sem isso, uma vaga esvaziada
 * continuaria pintada de "ocupada" e uma que estourou a capacidade não acenderia o alerta
 * — o saldo estaria certo e a cor mentindo, que é pior do que o número velho.
 *
 * `blocked` e `capacidade` NÃO vêm do evento de saldo: bloqueio é decisão humana gravada
 * na tabela de endereços, e um movimento de estoque não o altera. Por isso são lidos da
 * vaga que já está na tela, e mudança neles continua exigindo recarga completa.
 *
 * Código desconhecido devolve o MESMO objeto, sem cópia: pode ser vaga criada por outro
 * operador, e quem chama precisa distinguir "atualizei" de "não sei quem é" para então
 * recarregar.
 */
export function aplicarSaldo(dados: WarehouseSlots, codigo: string, caixas: number): WarehouseSlots {
  const indice = dados.slots.findIndex(s => s.id === codigo);
  if (indice < 0) return dados;

  const atual = dados.slots[indice];
  if (atual.caixas === caixas) return dados;

  const slots = [...dados.slots];
  slots[indice] = {
    ...atual,
    caixas,
    status: statusDaVaga({ blocked: atual.status === 'blocked', capacityBoxes: atual.capacidade }, caixas),
  };
  return { ...dados, slots };
}
```


### 3.6 Tempo real: assinatura e atualização incremental

#### `src/lib/wms/warehouse3dRealtime.ts`  _(119 linhas)_

```ts
// Tempo real do Pulmão: saber que outro operador mexeu numa vaga, e em QUAL.
//
// Habilitado pela migration 129, que pôs `warehouse_bin_stock` e
// `warehouse_storage_bins` na publicação `supabase_realtime`. Antes dela o canal
// conectava e não recebia nada — e nada na tela denunciava isso.
//
// ── O isolamento não é feito aqui ───────────────────────────────────────────────
// O Realtime avalia a policy de SELECT por assinante, e as duas tabelas isolam por
// `company_id = get_my_company_id()`. O filtro por empresa que este arquivo aplica é
// REDUNDANTE de propósito: ele corta tráfego inútil no socket, mas quem garante que
// ninguém vê dado de outra empresa é o banco, não este código.
//
// ── Por que a tradução de UUID existe ───────────────────────────────────────────
// O mapa 3D identifica vaga pelo código impresso (`PP-A01-N1`); o banco referencia por
// UUID. As duas tabelas carregam o UUID em campos DIFERENTES: no saldo é `bin_id`
// (chave estrangeira), na tabela de endereços é o próprio `id`. Trocar um pelo outro
// não gera erro — gera destaque na vaga errada, que é pior, porque parece funcionar.

import { supabase } from '../supabase';

export type RegistroDeEvento = Record<string, unknown> | null | undefined;

export const TABELA_SALDO = 'warehouse_bin_stock';
export const TABELA_VAGAS = 'warehouse_storage_bins';

const texto = (valor: unknown): string | null =>
  typeof valor === 'string' && valor.length > 0 ? valor : null;

/**
 * UUID da vaga afetada por um evento.
 *
 * Lê o registro NOVO primeiro e cai para o ANTIGO: em INSERT e UPDATE o novo é o que
 * vale; em DELETE só existe o antigo. É por isso que a 129 pôs `replica identity full`
 * no saldo — sem ela, o DELETE traria apenas a chave primária da linha de saldo, e o
 * `bin_id` viria vazio: saberíamos que algo saiu, sem saber de onde.
 */
export function binIdDoEvento(
  tabela: string,
  novo: RegistroDeEvento,
  antigo: RegistroDeEvento,
): string | null {
  if (tabela === TABELA_SALDO) {
    return texto(novo?.bin_id) ?? texto(antigo?.bin_id);
  }
  if (tabela === TABELA_VAGAS) {
    // Aqui a linha É a vaga: a chave primária já é o que se procura.
    return texto(novo?.id) ?? texto(antigo?.id);
  }
  return null;
}

/**
 * Código da vaga afetada, pronto para casar com `Slot.id`.
 *
 * Devolve `null` quando o UUID não está no mapa — vaga criada por outro operador
 * depois da última carga. Nesse caso a tela ainda precisa RECARREGAR (a vaga nova tem
 * de aparecer), só não tem o que destacar. Chutar um código aqui destacaria a vaga
 * errada.
 */
export function codigoDaMudanca(
  tabela: string,
  novo: RegistroDeEvento,
  antigo: RegistroDeEvento,
  codigoPorBinId: ReadonlyMap<string, string>,
): string | null {
  const binId = binIdDoEvento(tabela, novo, antigo);
  return binId === null ? null : codigoPorBinId.get(binId) ?? null;
}

export interface AssinaturaDoPulmao {
  /** Desfaz a inscrição. Chamar duas vezes é seguro. */
  cancelar: () => void;
}

/**
 * Assina as mudanças de saldo e de endereços da empresa.
 *
 * `aoMudar` recebe o código da vaga afetada, ou `null` quando ela não é conhecida. Em
 * ambos os casos quem chama deve recarregar — a diferença é só se há o que destacar.
 *
 * Devolve o cancelamento em vez de se desinscrever sozinho: o ciclo de vida é de quem
 * montou, e deixar o canal aberto depois que a tela sai é vazamento de socket.
 */
export function assinarMudancasDoPulmao(
  companyId: string,
  /**
   * Devolve o mapa VIGENTE de UUID -> código. É uma função, e não o mapa, porque cada
   * recarga produz um mapa novo: receber o valor obrigaria a refazer a inscrição a
   * cada evento recebido — derrubando e reabrindo o socket justamente quando o
   * armazém está em movimento.
   */
  obterCodigoPorBinId: () => ReadonlyMap<string, string>,
  aoMudar: (codigo: string | null) => void,
): AssinaturaDoPulmao {
  const filtro = `company_id=eq.${companyId}`;
  const canal = supabase
    .channel(`wms-pulmao-3d:${companyId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABELA_SALDO, filter: filtro },
      payload => aoMudar(codigoDaMudanca(TABELA_SALDO, payload.new, payload.old, obterCodigoPorBinId())),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABELA_VAGAS, filter: filtro },
      payload => aoMudar(codigoDaMudanca(TABELA_VAGAS, payload.new, payload.old, obterCodigoPorBinId())),
    )
    .subscribe();

  let cancelado = false;
  return {
    cancelar: () => {
      if (cancelado) return;
      cancelado = true;
      void supabase.removeChannel(canal);
    },
  };
}
```


### 3.7 Medidas da planta vindas do banco

#### `src/lib/wms/planoFisicoService.ts`  _(159 linhas)_

```ts
// As medidas da planta física lidas do banco (migration 133).
//
// Antes elas eram constante em `warehouse3dPlantaFisica.ts`. Medida de galpão não é regra
// de negócio: é levantamento, e levantamento muda — corrigir "o corredor tem 2,65" para
// "o corredor tem 2,40" exigia build e deploy para mexer num número de trena.
//
// A constante CONTINUA existindo, e de propósito: ela é o retrato do que a planta dizia e
// vira o fallback quando o banco não responde, quando a empresa não tem trecho cadastrado
// ou quando o módulo é usado em teste. Mapa 3D sem planta é tela vazia — pior do que mapa
// com a medida de ontem.

import { supabase } from '../supabase';
import { AZ2027_TERREO, type TrechoDaPlanta } from './warehouse3dPlantaFisica';

/** Rótulos de rua por trecho, no formato que `blocosDaPlanta` espera. */
export type RotulosPorTrecho = Record<string, string[]>;

/**
 * O padrão que vigorava como valor fixo de parâmetro em `blocosDaPlanta`.
 *
 * Fica aqui para o fallback ser EXATAMENTE o que a tela desenhava antes desta migration —
 * um fallback que desenha outra coisa não é fallback, é um segundo layout escondido.
 */
export const ROTULOS_PADRAO: RotulosPorTrecho = {
  'Prédio atual': ['A', 'B', 'C', 'D'],
  'Galpão novo': ['E', 'F', 'G', 'H'],
};

export interface PlantaFisicaCarregada {
  trechos: TrechoDaPlanta[];
  rotulos: RotulosPorTrecho;
  /**
   * De onde veio o desenho.
   *
   * `constante` = o banco não tinha o que dizer e o TÉRREO caiu no retrato.
   * `vazio` = este pavimento não tem planta cadastrada. Não é o mesmo que `constante`, e
   * a diferença é o ponto: cair na constante fora do térreo desenharia o térreo rotulado
   * como mezanino — sem erro nenhum, e ninguém descobriria.
   */
  origem: 'banco' | 'constante' | 'vazio';
}

/** Térreo. O único pavimento para o qual a constante é um retrato legítimo. */
export const ANDAR_TERREO = 1;

interface LinhaDoBanco {
  nome: string;
  z_inicio: number | string;
  comprimento: number | string;
  fileiras: number;
  comprimento_da_fileira: number | string;
  corredor_inicio: number | string;
  distribuicao: string;
  corredor_longitudinal: number | string;
  rotulos: string[] | null;
}

/**
 * `numeric` do Postgres chega como STRING no supabase-js em parte dos casos.
 *
 * Aqui isso não é detalhe de tipagem: `'18.6' + 26.6` daria `"18.626.6"` e a cena nasceria
 * com o galpão novo a dezoito mil metros do prédio atual. Normalizar na borda é o que
 * impede uma string de entrar numa conta de geometria.
 */
const numero = (v: number | string): number => (typeof v === 'number' ? v : Number(v));

const daLinha = (l: LinhaDoBanco): TrechoDaPlanta => ({
  nome: l.nome,
  zInicio: numero(l.z_inicio),
  comprimento: numero(l.comprimento),
  fileiras: l.fileiras,
  comprimentoDaFileira: numero(l.comprimento_da_fileira),
  corredorInicio: numero(l.corredor_inicio),
  // O CHECK do banco só deixa passar estes dois valores; o `as` aqui é a borda onde o
  // texto vira união, não uma suposição sobre o conteúdo.
  distribuicao: l.distribuicao as TrechoDaPlanta['distribuicao'],
  corredorLongitudinal: numero(l.corredor_longitudinal),
});

const comOConstante = (): PlantaFisicaCarregada => ({
  trechos: AZ2027_TERREO,
  rotulos: ROTULOS_PADRAO,
  origem: 'constante',
});

/**
 * Pavimento sem planta cadastrada.
 *
 * O fallback para a constante vale SÓ no térreo, porque a constante é o retrato do
 * térreo. Em qualquer outro andar ela seria uma afirmação falsa com cara de desenho
 * pronto — e o mezanino apareceria com as fileiras, as ruas e as medidas do andar de
 * baixo. Vazio é a resposta honesta; quem chama mostra isso na tela.
 */
const semPlanta = (): PlantaFisicaCarregada => ({ trechos: [], rotulos: {}, origem: 'vazio' });

const semDados = (andar: number): PlantaFisicaCarregada =>
  andar === ANDAR_TERREO ? comOConstante() : semPlanta();

/**
 * Os trechos da planta de um pavimento, em ordem ao longo do galpão.
 *
 * A ordem vem do `z_inicio` e não do nome nem da data de criação: o módulo que desenha
 * trata o último trecho como o fim do prédio (é onde ele põe a expedição), então vir fora
 * de ordem poria a área de carga no meio do galpão.
 *
 * Nunca estoura. Erro de rede ou pavimento sem cadastro caem em `semDados`, que devolve o
 * retrato só no TÉRREO e vazio nos demais andares. Quem chama distingue por `origem`.
 */
export async function carregarPlantaFisica(andar = ANDAR_TERREO): Promise<PlantaFisicaCarregada> {
  const { data, error } = await supabase
    .from('warehouse_plan_sections')
    .select('nome, z_inicio, comprimento, fileiras, comprimento_da_fileira, corredor_inicio, distribuicao, corredor_longitudinal, rotulos')
    .eq('andar', andar)
    .order('z_inicio');

  if (error) {
    console.error('[Planta física] Erro ao ler os trechos:', error);
    return semDados(andar);
  }

  const linhas = (data ?? []) as LinhaDoBanco[];
  if (linhas.length === 0) return semDados(andar);

  const rotulos: RotulosPorTrecho = {};
  for (const l of linhas) {
    // Array vazio é diferente de ausente: significa "este trecho não tem rua cadastrada",
    // e a fileira fica sem nome em vez de herdar a letra do padrão — herdar faria o vão
    // montar um código de endereço que não existe.
    rotulos[l.nome] = l.rotulos ?? [];
  }

  return { trechos: linhas.map(daLinha), rotulos, origem: 'banco' };
}

/**
 * Pavimentos que têm planta cadastrada, em ordem.
 *
 * O térreo entra SEMPRE, mesmo sem linha no banco: ele tem o retrato na constante, e um
 * seletor sem o térreo esconderia o único andar que o mapa sabe desenhar hoje.
 *
 * Serve para o seletor não oferecer andar que desenharia tela vazia por engano — oferecer
 * só o que existe é diferente de oferecer tudo e explicar depois.
 */
export async function listarPavimentos(): Promise<number[]> {
  const { data, error } = await supabase
    .from('warehouse_plan_sections')
    .select('andar')
    .order('andar');

  if (error) {
    console.error('[Planta física] Erro ao listar os pavimentos:', error);
    return [ANDAR_TERREO];
  }

  const andares = new Set<number>([ANDAR_TERREO]);
  for (const linha of (data ?? []) as { andar: number }[]) andares.add(linha.andar);
  return [...andares].sort((a, b) => a - b);
}
```


### 3.8 UI de movimentação (entrada, saída, transferência, bloqueio)

#### `src/components/wms/WmsBinOperations.tsx`  _(577 linhas)_

```tsx
// Pulmão -> Movimentar. A operação de chão: guardar, retirar e transferir.
//
// É a mesma tela que o QR da vaga abre no celular. O QR leva para
// `/app/operacoes/pulmao?v=<codigo>`, e o endereço já chega preenchido — por isso ela
// funciona igual no desktop (digitando o endereço) e no telefone (escaneando).
//
// Nada aqui escreve saldo direto: as três ações chamam as RPCs `wms_bin_*`, que gravam
// o movimento e o saldo na mesma transação. É o que garante que todo número tenha um
// documento com autor e horário.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Lightbulb, PackageMinus, PackagePlus, QrCode } from 'lucide-react';
import { Badge, Button, Input, Notice, Panel, PanelSection, Table, Td, Th, Thead, Tr } from '../ui';
import { WmsBinScanner } from './WmsBinScanner';
import {
  lastKnownPackSize, listBinContents, listPulmaoStock, pick, putaway, searchProducts, transfer,
  type BinStockRow, type ProductOption, type StorageBin,
} from '../../lib/wms/wmsService';
import {
  EMPTY_OCCUPANCY, occupancyByProduct, previewTransfer, rejectionFor, suggestBins,
} from '../../lib/wms/binSuggestion';
import type { StockPlacement } from '../../lib/wms/stockInsights';
import { plural } from '../../lib/formatPtBr';

type Action = 'guardar' | 'retirar' | 'transferir';

/** Qual campo a câmera está preenchendo. O leitor é o mesmo nos dois casos — ele
 *  devolve um código e não sabe o que vai ser feito com ele. */
type ScanTarget = 'origem' | 'destino' | 'conferir';

const SCAN_TITLE: Record<ScanTarget, string> = {
  origem: 'Escanear endereço',
  destino: 'Escanear endereço de destino',
  conferir: 'Conferir a vaga',
};

const ACTION_LABEL: Record<Action, string> = {
  guardar: 'Guardar',
  retirar: 'Retirar',
  transferir: 'Transferir',
};

const ageInDays = (iso: string): number =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

export function WmsBinOperations({
  bins,
  initialBinCode,
  onMoved,
}: {
  bins: StorageBin[];
  initialBinCode: string;
  onMoved: () => void;
}) {
  const [binCode, setBinCode] = useState(initialBinCode);
  const [contents, setContents] = useState<BinStockRow[] | null>(null);
  const [action, setAction] = useState<Action>('guardar');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Guardar
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [chosen, setChosen] = useState<ProductOption | null>(null);
  const [unitsPerBox, setUnitsPerBox] = useState('');

  // Comum
  const [boxes, setBoxes] = useState('1');
  const [targetProductId, setTargetProductId] = useState('');
  const [destCode, setDestCode] = useState('');

  const [scanFor, setScanFor] = useState<ScanTarget | null>(null);
  /** Vaga cuja etiqueta o operador conferiu com a camera nesta sessao de tela. */
  const [confirmedCode, setConfirmedCode] = useState<string | null>(null);

  /** Saldo de TODO o pulmão — base do ranking de endereços. Mesma consulta da Fase 3;
   *  nenhuma fonte nova e nenhuma chamada por sugestão. */
  const [placements, setPlacements] = useState<StockPlacement[]>([]);

  const bin = bins.find(b => b.code === binCode.trim().toUpperCase()) ?? null;
  const destBin = bins.find(b => b.code === destCode.trim().toUpperCase()) ?? null;

  const loadPlacements = useCallback(() => {
    listPulmaoStock()
      .then(r => setPlacements(r.placements))
      // Sugestão é auxílio, não requisito: falhando, a tela segue funcionando na mão.
      .catch(() => setPlacements([]));
  }, []);

  useEffect(() => { loadPlacements(); }, [loadPlacements]);

  // ── Sugestão de endereço ────────────────────────────────────────────────────────────
  // O produto e o pack em questão dependem da ação: guardar trabalha com o que foi
  // escolhido na busca, transferir com o que já está na origem.
  const rowAtOrigin = (contents ?? []).find(r => r.productId === targetProductId) ?? null;

  const activeProductId = action === 'guardar' ? chosen?.id ?? null : targetProductId || null;
  const activePack = action === 'guardar'
    ? parseInt(unitsPerBox) || null
    : rowAtOrigin?.unitsPerBox ?? null;

  const qty = parseInt(boxes) || 0;

  const occupancyByCode = useMemo(
    () => occupancyByProduct(placements, activeProductId),
    [placements, activeProductId],
  );

  const suggestions = useMemo(() => {
    if (!activeProductId || qty <= 0) return [];
    return suggestBins({
      bins,
      occupancyByCode,
      boxes: qty,
      unitsPerBox: activePack,
      excludeCode: action === 'transferir' ? bin?.code : undefined,
    }).slice(0, 4);
  }, [bins, occupancyByCode, qty, activePack, activeProductId, action, bin?.code]);

  /** Por que o destino escolhido não serve — a mesma regra que a RPC aplicaria. */
  const destRejection = destBin
    ? rejectionFor(destBin, occupancyByCode.get(destBin.code) ?? EMPTY_OCCUPANCY, {
        boxes: qty,
        unitsPerBox: activePack,
        excludeCode: bin?.code,
      })
    : null;

  const balance = destBin && rowAtOrigin && qty > 0
    ? previewTransfer(
        occupancyByCode.get(bin?.code ?? '') ?? EMPTY_OCCUPANCY,
        occupancyByCode.get(destBin.code) ?? EMPTY_OCCUPANCY,
        Math.min(qty, rowAtOrigin.boxes),
      )
    : null;

  const applyScan = (code: string) => {
    if (scanFor === 'conferir') setConfirmedCode(code);
    else if (scanFor === 'destino') setDestCode(code);
    else { setBinCode(code); setTargetProductId(''); }
    setScanFor(null);
    setError(null);
    setDone(null);
  };

  /** Recusa que a RPC já faria, antecipada: poupa a ida ao servidor quando o motivo está
   *  escrito na tela, logo acima do botão. Campo de destino VAZIO não entra aqui — para
   *  esse caso a mensagem de `run` explica melhor que um botão apagado sem motivo. */
  const knownBad =
    (action === 'guardar' && bin?.blocked === true) ||
    (action === 'transferir' && destCode.trim() !== '' && (!destBin || destRejection !== null)) ||
    // Retirar mais do que existe: o saldo da origem está na tela, logo acima.
    (action !== 'guardar' && rowAtOrigin !== null && qty > rowAtOrigin.boxes);

  const loadContents = useCallback(async (code: string) => {
    if (!code.trim()) { setContents(null); return; }
    try {
      setContents(await listBinContents(code.trim().toUpperCase()));
      setError(null);
    } catch (err) {
      console.error('[wms] falha ao ler o endereço:', err);
      setError('Não foi possível ler o conteúdo deste endereço.');
    }
  }, []);

  useEffect(() => { loadContents(binCode); }, [binCode, loadContents]);

  // Pack padronizado: pergunta uma vez por SKU e nunca mais. A fonte é o histórico de
  // movimentos, que nunca é apagado — por isso o cadastro de produto fica intocado.
  useEffect(() => {
    if (!chosen) return;
    let cancelled = false;
    lastKnownPackSize(chosen.id)
      .then(known => { if (!cancelled && known) setUnitsPerBox(String(known)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [chosen]);

  useEffect(() => {
    if (term.trim().length < 2) { setOptions([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchProducts(term)
        .then(found => { if (!cancelled) setOptions(found); })
        .catch(() => undefined);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term]);

  const reset = () => {
    setBoxes('1');
    setTerm('');
    setOptions([]);
    setChosen(null);
    setUnitsPerBox('');
    setTargetProductId('');
    setDestCode('');
  };

  const run = async () => {
    const code = binCode.trim().toUpperCase();
    const qty = parseInt(boxes) || 0;
    if (!code || qty <= 0) return;

    setBusy(true);
    setError(null);
    setDone(null);
    try {
      if (action === 'guardar') {
        if (!chosen) throw new Error('Escolha o produto.');
        const upb = parseInt(unitsPerBox) || 0;
        if (upb <= 0) throw new Error('Informe quantas unidades tem a caixa.');
        await putaway({ binCode: code, productId: chosen.id, boxes: qty, unitsPerBox: upb });
        setDone(`${qty} ${plural(qty, 'caixa', 'caixas')} de ${chosen.sku} ${plural(qty, 'guardada', 'guardadas')} em ${code}.`);
      } else if (action === 'retirar') {
        if (!targetProductId) throw new Error('Escolha o produto a retirar.');
        await pick({ binCode: code, productId: targetProductId, boxes: qty });
        setDone(`${qty} ${plural(qty, 'caixa retirada', 'caixas retiradas')} de ${code}.`);
      } else {
        if (!targetProductId) throw new Error('Escolha o produto a transferir.');
        if (!destCode.trim()) throw new Error('Informe o endereço de destino.');
        await transfer({
          fromBinCode: code,
          toBinCode: destCode.trim().toUpperCase(),
          productId: targetProductId,
          boxes: qty,
        });
        setDone(`${qty} ${plural(qty, 'caixa transferida', 'caixas transferidas')} de ${code} para ${destCode.trim().toUpperCase()}.`);
      }
      reset();
      await loadContents(code);
      // O ranking tem que enxergar o movimento que acabou de acontecer.
      loadPlacements();
      onMoved();
    } catch (err) {
      // A mensagem vem da própria RPC (saldo insuficiente, endereço bloqueado, pack
      // diferente). É mais útil ao operador que qualquer texto genérico daqui.
      setError(err instanceof Error ? err.message : 'Não foi possível concluir o movimento.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title">Endereço</h3>
          <p className="text-caption mt-1">
            Escaneie o QR colado na vaga. No computador, digite o código.
          </p>

          {/* Enquanto não há endereço, escanear é a única coisa a fazer nesta tela — e o
              painel da movimentação nem existe ainda, então o destaque não disputa com
              nada. Resolvido o endereço, o peso passa para o botão que confirma. */}
          <Button
            variant={bin ? 'secondary' : 'primary'}
            onClick={() => setScanFor('origem')}
            className="mt-3 w-full sm:w-auto"
          >
            <QrCode size={18} />
            Escanear QR Code
          </Button>

          <div className="mt-2 flex flex-col sm:flex-row gap-2">
            <Input
              value={binCode}
              onChange={e => setBinCode(e.target.value)}
              placeholder="PP-A01-N1"
              list="wms-bin-codes"
              className="flex-1"
            />
            <datalist id="wms-bin-codes">
              {bins.map(b => <option key={b.id} value={b.code} />)}
            </datalist>
          </div>

          {binCode.trim() && !bin && (
            <p className="text-caption mt-2 text-red-600 dark:text-red-400">
              Endereço não cadastrado.
            </p>
          )}
          {bin && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={bin.blocked ? 'warning' : 'accent'}><span className="text-code">{bin.code}</span></Badge>
              <span className="text-caption">
                {bin.blocked ? 'Endereço bloqueado' : 'Endereço reconhecido'}
                {bin.capacityBoxes !== null && ` · capacidade ${bin.capacityBoxes} cx`}
              </span>
              {/* Conferência: aponta a câmera para a etiqueta e prova que está na vaga
                  certa. Digitar o código não prova nada sobre onde a pessoa está. */}
              {confirmedCode === bin.code ? (
                <Badge variant="success">Vaga conferida</Badge>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setScanFor('conferir')}>
                  <QrCode size={14} />
                  Conferir no local
                </Button>
              )}
            </div>
          )}
          {bin?.blocked && (
            <div className="mt-3">
              <Notice tone="warning">
                Endereço bloqueado: não recebe mercadoria nova. Retirar e transferir para fora continuam liberados.
              </Notice>
            </div>
          )}
        </PanelSection>

        {contents !== null && bin && (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>SKU</Th>
                  <Th>Produto</Th>
                  <Th className="text-center">Caixas</Th>
                  <Th className="text-center">Unidades</Th>
                  <Th className="text-center">Idade</Th>
                </Tr>
              </Thead>
              <tbody>
                {contents.length === 0 ? (
                  <Tr><Td colSpan={5}>Endereço vazio.</Td></Tr>
                ) : (
                  contents.map(row => (
                    <Tr key={row.productId}>
                      <Td className="text-code">{row.sku}</Td>
                      <Td>{row.productName}</Td>
                      <Td className="text-center text-numeric">{row.boxes}</Td>
                      <Td className="text-center text-numeric">{row.units}</Td>
                      <Td className="text-center text-caption">{ageInDays(row.firstStoredAt)}d</Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>

      {bin && (
        <Panel>
          <PanelSection padding="sm">
            <div className="flex flex-wrap gap-2">
              {(['guardar', 'retirar', 'transferir'] as Action[]).map(a => (
                <Button
                  key={a}
                  variant={action === a ? 'primary' : 'secondary'}
                  onClick={() => { setAction(a); setError(null); setDone(null); }}
                >
                  {a === 'guardar' ? <PackagePlus size={16} /> : a === 'retirar' ? <PackageMinus size={16} /> : <ArrowRightLeft size={16} />}
                  {ACTION_LABEL[a]}
                </Button>
              ))}
            </div>
          </PanelSection>

          <PanelSection padding="sm">
            {action === 'guardar' ? (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-caption">Produto (SKU, nome ou EAN)</span>
                  <Input value={term} onChange={e => { setTerm(e.target.value); setChosen(null); }} placeholder="Buscar produto..." />
                </label>

                {!chosen && options.length > 0 && (
                  <div className="border border-edge rounded-container divide-y divide-edge max-h-56 overflow-y-auto">
                    {options.map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => { setChosen(opt); setTerm(`${opt.sku} — ${opt.name}`); setOptions([]); }}
                        className="w-full text-left px-3 py-2 hover:bg-surface-3 transition-colors"
                      >
                        <span className="text-code text-sm text-fg">{opt.sku}</span>
                        <span className="text-sm text-fg-muted"> · {opt.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {chosen && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-caption">Caixas</span>
                      <Input type="number" min={1} value={boxes} onChange={e => setBoxes(e.target.value)} />
                    </label>
                    <label className="block">
                      <span className="text-caption">Unidades por caixa</span>
                      <Input type="number" min={1} value={unitsPerBox} onChange={e => setUnitsPerBox(e.target.value)} />
                    </label>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-caption">Produto no endereço</span>
                  <select
                    value={targetProductId}
                    onChange={e => setTargetProductId(e.target.value)}
                    className="w-full p-2.5 border border-edge rounded-control bg-surface text-fg text-sm"
                  >
                    <option value="">Selecione...</option>
                    {(contents ?? []).map(row => (
                      <option key={row.productId} value={row.productId}>
                        {row.sku} — {row.boxes} cx
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-caption">Caixas</span>
                    <Input type="number" min={1} value={boxes} onChange={e => setBoxes(e.target.value)} />
                  </label>
                </div>

                {action === 'transferir' && (
                  <div>
                    <span className="text-caption">Endereço de destino</span>
                    {/* Fora da grade de duas colunas: no celular o operador está parado na
                        origem e precisa escanear o destino, e meia largura não comporta
                        campo e botão lado a lado. */}
                    <div className="mt-1 flex flex-col sm:flex-row gap-2">
                      <Input
                        value={destCode}
                        onChange={e => setDestCode(e.target.value)}
                        placeholder="PP-B02-N1"
                        list="wms-bin-codes"
                        className="flex-1"
                      />
                      <Button variant="secondary" onClick={() => setScanFor('destino')} className="w-full sm:w-auto">
                        <QrCode size={18} />
                        Escanear
                      </Button>
                    </div>

                    {destCode.trim() && !destBin && (
                      <p className="text-caption mt-2 text-red-600 dark:text-red-400">
                        Endereço de destino não cadastrado.
                      </p>
                    )}
                    {/* O motivo exato, igual ao que a RPC responderia — mas antes de ir
                        até o servidor e voltar com erro. */}
                    {destBin && destRejection && (
                      <p className="text-caption mt-2 text-amber-700 dark:text-amber-400">
                        {destRejection === 'bloqueado' && 'Destino bloqueado: não recebe mercadoria.'}
                        {destRejection === 'mesma-origem' && 'Destino igual à origem.'}
                        {destRejection === 'pack-diferente' && 'O destino já tem este produto com outra quantidade por caixa.'}
                        {destRejection === 'sem-capacidade' && 'O destino não comporta essa quantidade.'}
                      </p>
                    )}
                    {destBin && !destRejection && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant="accent"><span className="text-code">{destBin.code}</span></Badge>
                        <span className="text-caption">
                          Destino reconhecido
                          {destBin.capacityBoxes !== null && ` · capacidade ${destBin.capacityBoxes} cx`}
                        </span>
                      </div>
                    )}

                    {/* A conta dos dois lados, antes de confirmar. */}
                    {balance && !destRejection && (
                      <p className="text-caption mt-2 text-numeric">
                        {bin?.code}: {balance.fromBefore} → <strong>{balance.fromAfter}</strong> cx
                        {' · '}
                        {destBin?.code}: {balance.toBefore} → <strong>{balance.toAfter}</strong> cx
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Sugestão de endereço: lista, motivo e um toque para aplicar. Nunca
                aplica sozinha — o operador decide, como manda a regra de não movimentar
                nada sem confirmação. Só aparece com produto e quantidade definidos,
                porque antes disso não há o que ranquear. */}
            {action !== 'retirar' && suggestions.length > 0 && (
              <div className="mt-4 rounded-container border border-edge p-3">
                <div className="flex items-center gap-2">
                  <Lightbulb size={16} className="text-fg-subtle" />
                  <span className="text-caption">
                    {action === 'guardar' ? 'Onde guardar' : 'Destinos compatíveis'}
                    {' · '}
                    {qty} cx
                  </span>
                </div>

                <div className="mt-2 space-y-1.5">
                  {suggestions.map(s => {
                    const atual = action === 'guardar'
                      ? s.bin.code === bin?.code
                      : s.bin.code === destBin?.code;
                    return (
                      <button
                        key={s.bin.id}
                        type="button"
                        onClick={() => {
                          if (action === 'guardar') setBinCode(s.bin.code);
                          else setDestCode(s.bin.code);
                          setError(null);
                        }}
                        className={`w-full min-h-[44px] rounded-control border px-3 py-2 text-left transition-colors ${
                          atual
                            ? 'border-accent bg-accent/10'
                            : 'border-edge bg-surface-3 hover:bg-edge'
                        }`}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-code font-semibold text-fg">{s.bin.code}</span>
                          {s.consolidates && <Badge variant="success">Consolida</Badge>}
                          {atual && <Badge variant="accent">Atual</Badge>}
                        </span>
                        <span className="block text-caption mt-0.5">{s.reasons.join(' · ')}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Nenhuma vaga serve: dizer isso é mais útil que uma lista vazia. */}
            {action !== 'retirar' && activeProductId && qty > 0 && suggestions.length === 0 && (
              <div className="mt-4">
                <Notice tone="warning">
                  Nenhum endereço do pulmão comporta {qty} {plural(qty, 'caixa', 'caixas')} deste produto agora —
                  todos estão bloqueados, sem espaço, ou já têm este SKU com outra quantidade
                  por caixa.
                </Notice>
              </div>
            )}

            {/* Retirar mais do que existe: barrado na tela, com o número à vista. */}
            {action !== 'guardar' && rowAtOrigin && qty > rowAtOrigin.boxes && (
              <div className="mt-3">
                <Notice tone="danger">
                  {bin?.code} tem {rowAtOrigin.boxes} {plural(rowAtOrigin.boxes, 'caixa', 'caixas')} deste produto. Não dá para
                  {action === 'retirar' ? ' retirar ' : ' transferir '}{qty}.
                </Notice>
              </div>
            )}

            {error && <div className="mt-3"><Notice tone="danger">{error}</Notice></div>}
            {done && (
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="accent">Registrado</Badge>
                <span className="text-sm text-fg-muted">{done}</span>
              </div>
            )}

            <div className="mt-4">
              <Button onClick={run} disabled={busy || knownBad} className="w-full sm:w-auto">
                {busy ? 'Registrando...' : ACTION_LABEL[action]}
              </Button>
            </div>
          </PanelSection>
        </Panel>
      )}

      <WmsBinScanner
        open={scanFor !== null}
        title={scanFor ? SCAN_TITLE[scanFor] : ''}
        onClose={() => setScanFor(null)}
        expectCode={scanFor === 'conferir' ? bin?.code : undefined}
        onDetected={applyScan}
      />
    </>
  );
}
```


### 3.9 UI de bipagem

#### `src/components/wms/WmsBinScanner.tsx`  _(240 linhas)_

```tsx
// A câmera lendo o QR da vaga, dentro do app.
//
// Por que existe, se a câmera nativa do celular já abre o sistema pelo adesivo: porque
// ela só resolve o PRIMEIRO endereço. Numa transferência o operador está parado na
// frente da origem e precisa do destino; numa sequência de vagas ele teria que sair do
// app, abrir a câmera e voltar, uma vez por endereço.
//
// Este componente não movimenta nada e não conhece saldo. Ele devolve uma string e
// fecha — o mesmo que o teclado entrega. Tudo depois disso é o caminho que já roda em
// produção, e quem valida o endereço continua sendo o banco.

import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { Button, Modal, Notice } from '../ui';
import { binCodeFromScan } from '../../lib/wms/binScan';
import { createQrDecoder, type QrDecoder } from '../../lib/wms/qrDecoder';

/** ~8 leituras por segundo. Acompanha a mão do operador e deixa o celular respirar;
 *  a cada quadro (60/s) só esquentaria o aparelho. */
const SCAN_INTERVAL_MS = 120;

const cameraProblem = (err: unknown): string => {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Permissão de câmera negada. Libere o acesso nas configurações do navegador e tente de novo — ou digite o endereço.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Nenhuma câmera encontrada neste aparelho. Digite o endereço.';
  }
  if (name === 'NotReadableError') {
    return 'A câmera está ocupada por outro aplicativo. Feche-o e tente de novo.';
  }
  return 'Não foi possível abrir a câmera. Digite o endereço.';
};

/** Confirmação discreta de leitura: um toque curto e um bipe baixo. Tudo opcional —
 *  aparelho sem vibração ou com áudio bloqueado apenas não dá o retorno. */
const signalRead = (): void => {
  try {
    navigator.vibrate?.(40);
  } catch {
    /* alguns navegadores declaram e recusam */
  }
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const audio = new Ctor();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 1_320;
    gain.gain.value = 0.04;
    osc.connect(gain).connect(audio.destination);
    osc.onended = () => { audio.close().catch(() => undefined); };
    osc.start();
    osc.stop(audio.currentTime + 0.07);
  } catch {
    /* som é cortesia, não requisito */
  }
};

export function WmsBinScanner({
  open,
  title,
  onClose,
  onDetected,
  expectCode,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onDetected: (code: string) => void;
  /**
   * Modo conferência: o operador já escolheu o endereço e aponta a câmera para a
   * etiqueta para PROVAR que está na vaga certa. Lendo outra, o leitor recusa e continua
   * lendo — trocar o endereço em silêncio aqui seria o oposto de conferir.
   */
  expectCode?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [problem, setProblem] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // `onDetected` chega nova a cada render do formulário. Na lista de dependências do
  // efeito, isso desligaria e religaria a câmera a cada tecla digitada atrás do modal.
  const detectedRef = useRef(onDetected);
  useEffect(() => { detectedRef.current = onDetected; }, [onDetected]);

  // Mesmo motivo do ref acima: entra pela prop e não pode remontar a câmera ao mudar.
  const expectRef = useRef(expectCode);
  useEffect(() => { expectRef.current = expectCode; }, [expectCode]);

  useEffect(() => {
    if (!open) return;

    // Capturado uma vez: o elemento já está montado quando o efeito roda (o modal
    // renderiza o conteúdo junto com `open`), e na limpeza o ref pode já ter sido solto.
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let done = false;
    let stream: MediaStream | null = null;
    let decoder: QrDecoder | null = null;
    let frame = 0;
    let lastRun = 0;

    setStatus('starting');
    setProblem(null);
    setHint(null);

    const fail = (message: string) => {
      if (cancelled) return;
      setProblem(message);
      setStatus('error');
    };

    const tick = (now: number) => {
      if (cancelled || done) return;
      frame = requestAnimationFrame(tick);
      if (now - lastRun < SCAN_INTERVAL_MS) return;
      lastRun = now;

      if (!decoder || video.readyState < 2) return;

      decoder
        .decode(video)
        .then(text => {
          if (cancelled || done || !text) return;
          const code = binCodeFromScan(text);
          if (!code) {
            // Segue lendo: o operador pode ter pego a etiqueta errada de raspão.
            setHint('Este QR não é de um endereço do pulmão.');
            return;
          }
          const esperado = expectRef.current;
          if (esperado && code !== esperado) {
            setHint(`Esta é a vaga ${code}, e a operação está em ${esperado}.`);
            return;
          }
          done = true;
          signalRead();
          detectedRef.current(code);
        })
        .catch(() => undefined);
    };

    void (async () => {
      if (!window.isSecureContext) {
        fail('A câmera só abre em conexão segura (https). Digite o endereço.');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        fail('Este navegador não dá acesso à câmera. Digite o endereço.');
        return;
      }

      try {
        // `ideal` e não `exact`: num tablet sem câmera traseira, `exact` falharia em vez
        // de usar a que existe.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (err) {
        fail(cameraProblem(err));
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        /* autoplay recusado: o elemento volta a tentar sozinho */
      }

      try {
        decoder = await createQrDecoder();
      } catch {
        fail('Não foi possível iniciar a leitura neste aparelho. Digite o endereço.');
        return;
      }
      if (cancelled) return;

      setStatus('scanning');
      frame = requestAnimationFrame(tick);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      decoder?.dispose();
      stream?.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    };
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-md">
      <div className="space-y-3">
        {status === 'error' ? (
          <Notice tone="warning">{problem}</Notice>
        ) : (
          <>
            <div className="relative aspect-[3/4] overflow-hidden rounded-container bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-48 w-48 rounded-container border-2 border-white/70" />
              </div>
              {status === 'starting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">
                  Abrindo a câmera...
                </div>
              )}
            </div>
            <p className="text-caption text-center">Aponte para o QR colado na vaga.</p>
            {hint && <Notice tone="warning">{hint}</Notice>}
          </>
        )}

        <Button variant="secondary" onClick={onClose} className="w-full">
          <Keyboard size={16} />
          Digitar o endereço
        </Button>
      </div>
    </Modal>
  );
}
```


### 3.10 Página do Pulmão: orquestra tudo acima

#### `src/components/wms/WmsPulmaoPage.tsx`  _(904 linhas)_

```tsx
// Operação Inteligente -> Pulmão (Porta-Pallet).
//
// Controle de excesso de mercadoria no porta-pallet, no modelo de armazenagem do SAP:
// endereço (storage bin) -> saldo por endereço (quant) -> movimento como documento.
//
// O que esta tela resolve: hoje achar o excesso de um SKU é procurar no olho, porque o
// porta-pallet não tem local fixo (a rotatividade é alta) e `products.location` é um
// campo único por produto — não comporta o mesmo SKU em várias posições ao mesmo tempo.
//
// O que ela NÃO faz: não encosta no vão de PICKING das capas. `products.location` e o
// campo de local do Tiny continuam sendo daquele fluxo e não são lidos nem escritos aqui.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Boxes, ChevronDown, ChevronUp, LayoutGrid, Lock, PackagePlus, Plus, Printer, Search, Trash2, Unlock, Warehouse } from 'lucide-react';
import {
  Badge, BrandLoader, Button, Input, Notice, Page, PageHeader, Panel, PanelSection,
  SegmentedControl, Select, Stat, StatCell, StatRow, Table, Td, Th, Thead, Tr,
  type SegmentedOption,
} from '../ui';
import { BIN_SCAN_PARAM } from '../../lib/appRoutes';
import { renderBarcodeSVG } from '../../lib/barcode/barcodeExport';
import { parseBinCode } from '../../lib/wms/binCode';
import {
  A4_PER_PAGE, LABEL_FORMATS, fallbackValuePt, planLabels, sheetsFor,
  type A4PerPage, type LabelFormatId,
} from '../../lib/wms/labelLayout';
import { useAuth } from '../../lib/auth';
import { WmsBinOperations } from './WmsBinOperations';
import { WmsAnalytics } from './WmsAnalytics';
import { WmsStockInsights } from './WmsStockInsights';
import { WmsStorageMap } from './WmsStorageMap';
import { WmsBinScanner } from './WmsBinScanner';
// Só o tipo: `import type` é apagado na compilação, então isto NÃO traz o peso do
// visualizador 3D para dentro deste chunk.
import type { Slot } from '../../lib/wms/warehouse3dSlots';

// Sob demanda: o visualizador 3D arrasta three/fiber/drei junto. Importado de forma
// estatica, esse peso entraria no pacote de QUEM NUNCA abre a secao 3D — inclusive do
// operador no corredor, com sinal ruim. Carregado so quando a secao e aberta.
const Warehouse3DViewer = lazy(() =>
  import('./Warehouse3DViewer').then(m => ({ default: m.Warehouse3DViewer })),
);
import { plural } from '../../lib/formatPtBr';
import {
  boxesByBin, buildBinCodes, createBins, deleteBins, listBins, listMovements, setBinBlocked,
  type BinMovement, type BinStreetSpec, type StorageBin,
} from '../../lib/wms/wmsService';

type Mode = 'mapa' | 'mapa3d' | 'movimentar' | 'enderecos' | 'consulta' | 'movimentos' | 'gestao';

const MODES: SegmentedOption<Mode>[] = [
  { value: 'mapa', label: 'Mapa', icon: LayoutGrid },
  { value: 'mapa3d', label: 'Mapa 3D', icon: Boxes },
  { value: 'movimentar', label: 'Movimentar', icon: PackagePlus },
  { value: 'enderecos', label: 'Endereços', icon: Warehouse },
  { value: 'consulta', label: 'Consultar SKU', icon: Search },
  { value: 'movimentos', label: 'Movimentos', icon: Printer },
];

const GESTAO_MODE: SegmentedOption<Mode> = { value: 'gestao', label: 'Gestão', icon: BarChart3 };

/** O QR aponta para a RAIZ, nao para o caminho da secao. Motivo: a hospedagem estatica
 *  so responde em "/" — caminho de secao digitado direto devolve 404 do servidor, e o
 *  adesivo nasceria morto. O App le este parametro na entrada e redireciona para ca com
 *  a vaga preenchida, entao o resultado para quem escaneia e o mesmo. */
const SCAN_PATH = '/';

/** A etiqueta é montada por `innerHTML` (é SVG cru vindo do gerador, não JSX). O código
 *  do endereço vem do banco e, embora o gerador em lote só produza letra, número e
 *  hífen, a coluna é texto livre — então escapa. */
const esc = (value: string): string =>
  value.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));

/** Milímetro com uma casa: `3.0000000000000004mm` é CSS válido mas ilegível no DevTools
 *  de quem for depurar uma etiqueta torta depois. */
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Formato de etiqueta escolhido. Fica no navegador de quem imprime porque é
 *  propriedade do rolo que a pessoa tem na mesa, não da empresa. */
const LABEL_FORMAT_KEY = 'ib_wms_label_format';

interface LabelPrefs {
  format: LabelFormatId;
  perPage: A4PerPage;
  customWidthMm: number;
  customHeightMm: number;
}

const DEFAULT_LABEL_PREFS: LabelPrefs = {
  format: 'a4',
  perPage: 8,
  customWidthMm: 70,
  customHeightMm: 50,
};

const readLabelPrefs = (): LabelPrefs => {
  try {
    const raw = localStorage.getItem(LABEL_FORMAT_KEY);
    return raw ? { ...DEFAULT_LABEL_PREFS, ...(JSON.parse(raw) as Partial<LabelPrefs>) } : DEFAULT_LABEL_PREFS;
  } catch {
    return DEFAULT_LABEL_PREFS;
  }
};

/** Base da URL que vai dentro do QR. O padrão é o endereço do próprio app — é quase
 *  sempre o certo, e ninguém deveria ter que descobrir o que digitar aqui. Só é editável
 *  porque existe um caso em que o padrão está errado: imprimir a partir do localhost
 *  geraria 85 adesivos que só funcionam na máquina de quem imprimiu. */
const QR_BASE_KEY = 'ib_wms_qr_base';

const readQrBase = (): string => {
  try {
    const saved = localStorage.getItem(QR_BASE_KEY);
    if (saved) return saved;
  } catch {
    // localStorage indisponível — cai no padrão abaixo.
  }
  return typeof window === 'undefined' ? '' : window.location.origin;
};

/** Endereço local nunca deve virar adesivo: fora desta máquina o QR não abre nada. */
const isLocalOrigin = (base: string): boolean => /localhost|127\.0\.0\.1|\[::1\]/i.test(base);

const MOVEMENT_LABEL: Record<BinMovement['movementType'], string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  transferencia: 'Transferência',
};

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString('pt-BR');


export function WmsPulmaoPage({ canManage }: { canManage: boolean }) {
  const { companyId } = useAuth();
  // Veio de um QR de vaga? Abre direto em Movimentar com o endereco preenchido — e a
  // query e lida uma vez so, no primeiro render, para nao reabrir ao trocar de secao.
  const [scannedBin] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get(BIN_SCAN_PARAM)?.trim().toUpperCase() ?? '';
  });
  // Escaneou um QR? Vai direto operar. Senão, o mapa e a visao que responde a pergunta
  // do dia a dia — onde tem vaga, o que esta cheio.
  const [mode, setMode] = useState<Mode>(scannedBin ? 'movimentar' : 'mapa');
  // Vaga escolhida no mapa 3D para conferência por QR. `null` mantém o leitor fechado.
  const [scanSlot, setScanSlot] = useState<Slot | null>(null);
  // Vaga escolhida no mapa e levada para a aba Movimentar.
  const [operateBin, setOperateBin] = useState('');
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [bins, setBins] = useState<StorageBin[]>([]);
  const [occupancy, setOccupancy] = useState<Map<string, number>>(new Map());
  const [movements, setMovements] = useState<BinMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Gerador de endereços
  const [prefix, setPrefix] = useState('PP');
  // Uma linha por rua/paredão. Estrutura real não é uniforme — um paredão de 13 módulos
  // com 3 níveis convive com um meio de 7 módulos e 1 nível —, e um número único para
  // todas obrigava a criar em várias rodadas.
  const [streetRows, setStreetRows] = useState<BinStreetSpec[]>([
    { street: 'A', modules: 5, levels: 4 },
  ]);

  const patchStreet = (index: number, patch: Partial<BinStreetSpec>) =>
    setStreetRows(rows => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  /** Próxima letra livre: A, B, C... Poupa quem está cadastrando de conferir qual já usou. */
  const addStreet = () =>
    setStreetRows(rows => {
      const usadas = new Set(rows.map(r => r.street.trim().toUpperCase()));
      const livre = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(l => !usadas.has(l)) ?? '';
      const ultima = rows[rows.length - 1];
      return [...rows, { street: livre, modules: ultima?.modules ?? 5, levels: ultima?.levels ?? 1 }];
    });
  const [capacity, setCapacity] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<number | null>(null);


  // Impressão
  const [qrBase, setQrBase] = useState(readQrBase);
  const [printing, setPrinting] = useState(false);
  const [labelPrefs, setLabelPrefs] = useState(readLabelPrefs);

  /** Gestao e area gerencial: indicadores por operador e auditoria so aparecem para
   *  quem ja tem permissao de gerir o pulmao. */
  const visibleModes = canManage ? [...MODES, GESTAO_MODE] : MODES;

  const plan = planLabels(labelPrefs);
  const sheets = sheetsFor(bins.length, plan);

  const changeLabelPrefs = (patch: Partial<LabelPrefs>) => {
    const next = { ...labelPrefs, ...patch };
    setLabelPrefs(next);
    try { localStorage.setItem(LABEL_FORMAT_KEY, JSON.stringify(next)); } catch { /* modo privado */ }
  };
  const [confirmBulk, setConfirmBulk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [binList, boxes, moves] = await Promise.all([listBins(), boxesByBin(), listMovements(50)]);
      setBins(binList);
      setOccupancy(boxes);
      setMovements(moves);
      setError(null);
    } catch (err) {
      console.error('[wms] falha ao carregar o pulmão:', err);
      setError('Não foi possível carregar os endereços.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const preview = useMemo(
    () => buildBinCodes({ prefix, streets: streetRows }),
    [prefix, streetRows],
  );

  // Endereco sem caixa nenhuma: candidato a limpeza. Se tiver historico, o banco recusa.
  const emptyBins = useMemo(() => bins.filter(b => (occupancy.get(b.code) ?? 0) === 0), [bins, occupancy]);

  const stats = useMemo(() => {
    const ocupados = bins.filter(b => (occupancy.get(b.code) ?? 0) > 0).length;
    return {
      total: bins.length,
      ocupados,
      livres: bins.length - ocupados - bins.filter(b => b.blocked).length,
      bloqueados: bins.filter(b => b.blocked).length,
      caixas: [...occupancy.values()].reduce((acc, n) => acc + n, 0),
    };
  }, [bins, occupancy]);

  const handleCreate = async () => {
    if (preview.length === 0) return;
    setCreating(true);
    setCreated(null);
    try {
      const n = await createBins(preview, capacity ? parseInt(capacity) : null);
      setCreated(n);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar os endereços.');
    } finally {
      setCreating(false);
    }
  };

  /** Endereço com histórico é barrado pelo próprio banco (FK ON DELETE RESTRICT), e a
   *  mensagem que sobe para a tela vem de lá — não de uma checagem daqui que poderia
   *  divergir da verdade. */
  const handleDelete = async (ids: string[]) => {
    setError(null);
    try {
      await deleteBins(ids);
      setConfirmBulk(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível excluir.');
    }
  };

  const handleToggleBlock = async (bin: StorageBin) => {
    try {
      await setBinBlocked(bin.id, !bin.blocked, bin.blocked ? null : 'Bloqueado pela gestão');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível alterar o bloqueio.');
    }
  };

  /** Folha de etiquetas: um QR por endereço, com o código legível embaixo. O QR carrega
   *  uma URL — a câmera nativa do celular só ABRE algo se for URL; texto puro ela apenas
   *  exibe, e aí o fluxo de três segundos morre. */
  const handlePrint = async () => {
    const base = qrBase.trim().replace(/\/+$/, '');
    if (!base) return;
    setPrinting(true);

    // O container é pendurado DIRETO no <body>, e não dentro da árvore do React. Esse é
    // o detalhe que faz a impressão funcionar: a regra de @media print esconde os irmãos
    // do container, e um elemento aninhado lá no meio do app teria ancestrais escondidos
    // junto — saía folha em branco por mais que o próprio elemento estivesse visível.
    const root = document.createElement('div');
    root.id = 'ib-wms-print-root';
    const style = document.createElement('style');
    style.textContent = `
      #ib-wms-print-root { display: none; }
      @media print {
        /* ISTO é o que fazia a folha sair em branco. O app declara
           \`html, body { overflow-x: hidden; max-width: 100vw }\` (src/index.css), e na
           paginação da impressão esse recorte vale para o documento inteiro: o Chrome
           corta tudo em uma página e não sobra nada. As outras impressões do sistema
           escapam porque usam \`position: fixed\` e são de uma etiqueta só. Desfeito
           apenas dentro do @media print — a tela continua exatamente como está. */
        html, body {
          overflow: visible !important;
          max-width: none !important;
          width: auto !important;
          height: auto !important;
          margin: 0 !important;
          background: #fff !important;
        }
        body > *:not(#ib-wms-print-root) { display: none !important; }
        @page { ${plan.pageCss} }

        #ib-wms-print-root {
          display: grid !important;
          grid-template-columns: repeat(${plan.columns}, ${plan.labelWidthMm}mm);
          ${plan.gapMm ? `gap: ${plan.gapMm}mm;` : ''}
          justify-content: start;
          background: #fff; color: #000;
          font-family: Arial, Helvetica, sans-serif;
        }
        #ib-wms-print-root .ib-wms-label {
          display: flex;
          flex-direction: ${plan.orientation === 'horizontal' ? 'row' : 'column'};
          align-items: center; justify-content: center;
          ${plan.orientation === 'horizontal' ? `gap: ${plan.padMm}mm;` : ''}
          width: ${plan.labelWidthMm}mm; height: ${plan.labelHeightMm}mm;
          padding: ${plan.padMm}mm;
          box-sizing: border-box;
          overflow: hidden;
          break-inside: avoid;
          ${plan.showCutBorder ? 'border: 0.3mm solid #999; border-radius: 1.5mm;' : ''}
        }
        /* Uma etiqueta por página nos formatos de rolo: a etiqueta É a página. */
        ${plan.perPage === 1 ? '#ib-wms-print-root .ib-wms-label { break-after: page; }' : ''}
        #ib-wms-print-root .ib-wms-label svg {
          width: ${plan.qrMm}mm; height: ${plan.qrMm}mm; flex: none;
        }
        #ib-wms-print-root .ib-wms-info {
          display: flex; flex-direction: column; align-items: center;
          min-width: 0;
        }
        #ib-wms-print-root .ib-wms-parts {
          display: flex; align-items: flex-end; justify-content: center;
          gap: ${round1(plan.padMm * 1.2)}mm;
          ${plan.orientation === 'horizontal' ? '' : `margin-top: ${round1(plan.padMm * 0.7)}mm;`}
        }
        #ib-wms-print-root .ib-wms-part {
          display: flex; flex-direction: column; align-items: center;
        }
        #ib-wms-print-root .ib-wms-part b {
          font-size: ${plan.headerPt}pt; font-weight: 700; letter-spacing: .12em; color: #444;
          white-space: nowrap;
        }
        #ib-wms-print-root .ib-wms-part i {
          font-style: normal; font-size: ${plan.valuePt}pt; font-weight: 800; line-height: 1.05;
          white-space: nowrap;
        }
        /* Caixa em volta do nível, e não fundo colorido como no modelo de referência: o
           Chrome só imprime fundo com "Gráficos de plano de fundo" marcado, e uma
           etiqueta que depende dessa caixinha de diálogo é uma etiqueta que um dia sai
           ilegível. Borda sai em qualquer impressora, inclusive preto e branco. */
        #ib-wms-print-root .ib-wms-level i {
          border: 0.6mm solid #000; border-radius: 1mm;
          padding: 0 ${round1(plan.padMm * 0.7)}mm;
        }
        #ib-wms-print-root .ib-wms-code {
          margin-top: ${round1(plan.padMm * 0.6)}mm;
          font-size: ${plan.codePt}pt; letter-spacing: .08em; color: #555;
          white-space: nowrap;
        }
      }
    `;

    const cleanup = () => {
      root.remove();
      style.remove();
    };

    try {
      try { localStorage.setItem(QR_BASE_KEY, base); } catch { /* modo privado */ }

      for (const bin of bins) {
        const svg = await renderBarcodeSVG('qrcode', `${base}${SCAN_PATH}?${BIN_SCAN_PARAM}=${bin.code}`, {
          showHumanReadable: false,
          scale: 1,
          eccLevel: 'M',
        });
        // Rua, módulo e nível em separado e grandes: de pé no corredor, olhando para
        // cima, ninguém lê "PP-A01-N1" — lê "A 01 1". O código inteiro fica embaixo,
        // pequeno, porque é ele que se digita na tela quando a câmera falha.
        const parsed = parseBinCode(bin.code);
        const parts = parsed
          ? `<div class="ib-wms-part"><b>RUA</b><i>${esc(parsed.street)}</i></div>` +
            `<div class="ib-wms-part"><b>MÓDULO</b><i>${esc(parsed.module)}</i></div>` +
            `<div class="ib-wms-part ib-wms-level"><b>NÍVEL</b><i>${parsed.level}</i></div>`
          // Endereço fora do padrão ocupa a linha inteira sozinho: o corpo cede ao
          // comprimento, senão some pela borda da célula.
          : `<div class="ib-wms-part"><b>ENDEREÇO</b>` +
            `<i style="font-size:${fallbackValuePt(plan, bin.code.length)}pt">${esc(bin.code)}</i></div>`;

        // O bloco de texto é um filho só: assim a etiqueta deitada (rolo 100×40) vira
        // QR à esquerda e endereço à direita trocando apenas o flex-direction.
        const cell = document.createElement('div');
        cell.className = 'ib-wms-label';
        cell.innerHTML =
          svg +
          `<div class="ib-wms-info">` +
          `<div class="ib-wms-parts">${parts}</div>` +
          `<div class="ib-wms-code">${esc(bin.code)}</div>` +
          `</div>`;
        root.appendChild(cell);
      }

      document.head.appendChild(style);
      document.body.appendChild(root);
      // Limpa quando a caixa de impressão fecha, tenha a pessoa impresso ou cancelado.
      window.addEventListener('afterprint', cleanup, { once: true });
      // Um respiro antes do snapshot de impressão, como já faz o `printBarcodeArea` do
      // Gerador de Etiquetas: são dezenas de SVGs recém-inseridos para o layout assentar.
      setTimeout(() => window.print(), 200);
    } catch (err) {
      console.error('[wms] falha ao gerar as etiquetas:', err);
      setError('Não foi possível gerar as etiquetas.');
      cleanup();
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Pulmão — Porta-Pallet"
        description="Endereçamento do excesso de mercadoria. Cada vaga tem endereço próprio, e todo saldo vem de um movimento registrado."
      />

      {error && <Notice tone="danger">{error}</Notice>}

      {/* Três números, não quatro: "livres" já vive como contexto de "ocupados", e um KPI
          a menos é uma linha mais legível. O quarto só aparece quando existe bloqueio —
          zero bloqueado não é informação, é ruído. */}
      <StatRow>
        <StatCell><Stat label="Endereços" value={stats.total} context={`${stats.livres} livres`} /></StatCell>
        <StatCell><Stat label="Ocupados" value={stats.ocupados} context={stats.total > 0 ? `${Math.round((stats.ocupados / stats.total) * 100)}% do pulmão` : undefined} /></StatCell>
        <StatCell><Stat label="Caixas armazenadas" value={stats.caixas} /></StatCell>
        {stats.bloqueados > 0 && (
          <StatCell><Stat label="Bloqueados" value={stats.bloqueados} context="não recebem mercadoria" /></StatCell>
        )}
      </StatRow>

      <SegmentedControl label="Seção" options={visibleModes} value={mode} onChange={setMode} />

      {mode === 'mapa' && (
        <WmsStorageMap
          bins={bins}
          occupancy={occupancy}
          canManage={canManage}
          onOperate={code => { setOperateBin(code); setMode('movimentar'); }}
          onCapacityChanged={load}
        />
      )}

      {mode === 'mapa3d' && (
        // Altura explicita: o Canvas colapsa em zero dentro de um pai sem altura, e
        // esta pagina empilha cabecalho e seletor de secao acima dele.
        <div className="h-[calc(100vh-18rem)] min-h-[26rem]">
          <Suspense fallback={<div className="flex h-full items-center justify-center rounded-container bg-surface-2"><BrandLoader label="Abrindo o mapa 3D" /></div>}>
            <Warehouse3DViewer
              // A empresa vem daqui, e não de dentro do visualizador: ele é renderizável
              // isolado, e ler o contexto de autenticação lá dentro passaria a exigir o
              // AuthProvider para desenhar um cubo.
              companyId={companyId}
              onSelectSlot={slot => setOperateBin(slot.id)}
              // Leva a vaga escolhida no 3D para a secao que de fato movimenta — o mesmo
              // atalho que o mapa 2D ja oferece em onOperate.
              onOperate={slot => { setOperateBin(slot.id); setMode('movimentar'); }}
              onScanRequest={setScanSlot}
            />
          </Suspense>
        </div>
      )}

      {mode === 'movimentar' && (
        <WmsBinOperations bins={bins} initialBinCode={operateBin || scannedBin} onMoved={load} />
      )}

      {mode === 'enderecos' && (
        <>
          {canManage && (
            <Panel>
              {/* Recolhido por padrão: criar endereço é ato de configuração, feito uma vez.
                  Deixá-lo aberto empurrava a lista — o conteúdo que se consulta todo dia —
                  para baixo da dobra. */}
              <PanelSection padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-title">Criar endereços em lote</h3>
                  <p className="text-caption mt-1">
                    O código é hierárquico de propósito: ordenado alfabeticamente ele já dá a sequência de
                    caminhada pelo corredor. Use um prefixo diferente de <code>P1-</code> e <code>P2-</code>,
                    que são os vãos de picking das capas.
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setGeneratorOpen(v => !v)} aria-expanded={generatorOpen}>
                  {generatorOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  {generatorOpen ? 'Fechar' : 'Abrir'}
                </Button>
              </PanelSection>
              {generatorOpen && (
              <PanelSection padding="sm">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-caption">Prefixo</span>
                    <Input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="PP" />
                  </label>
                  <label className="block">
                    <span className="text-caption">Capacidade (caixas, opcional)</span>
                    <Input type="number" min={1} value={capacity} onChange={e => setCapacity(e.target.value)} />
                  </label>
                </div>

                {/* Uma linha por rua, com a própria contagem: é assim que o galpão é, e
                    um número único para todas obrigava a criar em várias rodadas. */}
                <div className="mt-4">
                  <span className="text-caption">Estrutura — uma linha por rua (paredão, meio, bloco)</span>
                  <div className="mt-2 space-y-2">
                    {streetRows.map((row, i) => {
                      const valida = /^[A-Za-z]+$/.test(row.street.trim());
                      const quantas = valida ? Math.max(0, row.modules) * Math.max(0, row.levels) : 0;
                      return (
                        <div key={i} className="flex flex-wrap items-end gap-2">
                          <label className="block w-20">
                            {i === 0 && <span className="text-caption">Rua</span>}
                            <Input
                              value={row.street}
                              onChange={e => patchStreet(i, { street: e.target.value })}
                              placeholder="A"
                            />
                          </label>
                          <label className="block w-24">
                            {i === 0 && <span className="text-caption">Módulos</span>}
                            <Input
                              type="number" min={1}
                              value={row.modules}
                              onChange={e => patchStreet(i, { modules: Math.max(0, parseInt(e.target.value) || 0) })}
                            />
                          </label>
                          <label className="block w-24">
                            {i === 0 && <span className="text-caption">Níveis</span>}
                            <Input
                              type="number" min={1}
                              value={row.levels}
                              onChange={e => patchStreet(i, { levels: Math.max(0, parseInt(e.target.value) || 0) })}
                            />
                          </label>
                          <span className="text-caption pb-2.5 min-w-[9rem]">
                            {valida
                              ? `= ${quantas} ${plural(quantas, 'endereço', 'endereços')}`
                              : 'Rua precisa ser letra'}
                          </span>
                          {streetRows.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setStreetRows(rows => rows.filter((_, k) => k !== i))}
                              aria-label={`Remover rua ${row.street || i + 1}`}
                            >
                              <Trash2 size={16} />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <Button variant="secondary" size="sm" onClick={addStreet} className="mt-2">
                    <Plus size={16} />
                    Adicionar rua
                  </Button>

                  {/* A rua é letra porque o código vira número no módulo (`PP-A01-N1`):
                      um dígito na rua tornaria `PP-113-N1` ambíguo. */}
                  <p className="text-caption mt-2">
                    A rua é uma letra — o nome que vocês usam (Paredão 1, Meio 3) vira A, B, C
                    na mesma ordem em que estiverem aqui.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <Button onClick={handleCreate} disabled={creating || preview.length === 0}>
                    {creating ? 'Criando...' : `Criar ${preview.length} ${plural(preview.length, 'endereço', 'endereços')}`}
                  </Button>
                  {preview.length > 0 && (
                    <span className="text-caption">
                      Primeiro: <strong>{preview[0]}</strong> · Último: <strong>{preview[preview.length - 1]}</strong>
                    </span>
                  )}
                </div>

                {created !== null && (
                  <p className="text-caption mt-3">
                    {created === 0
                      ? 'Nenhum endereço novo — todos já existiam.'
                      : `${created} ${plural(created, 'endereço criado', 'endereços criados')}. Os que já existiam foram preservados.`}
                  </p>
                )}
              </PanelSection>
              )}
            </Panel>
          )}

          <Panel>
            {/* Impressão também é configuração de uma vez: fica recolhida, abaixo do
                gerador, e não disputa espaço com a lista de endereços. */}
            <PanelSection padding="sm" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-title">Etiquetas</h3>
                <p className="text-caption mt-1">
                  Um QR por endereço, colado na estrutura da vaga. Ao escanear pelo celular, abre esta
                  mesma tela em <strong>Movimentar</strong>, já com a vaga preenchida.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => setLabelsOpen(v => !v)} aria-expanded={labelsOpen}>
                  {labelsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  {labelsOpen ? 'Fechar' : 'Abrir'}
                </Button>
                <Button variant="secondary" onClick={handlePrint} disabled={printing || bins.length === 0 || isLocalOrigin(qrBase)}>
                  <Printer size={16} />
                  {printing ? 'Gerando...' : `Imprimir ${bins.length}`}
                </Button>
              </div>
            </PanelSection>

            {labelsOpen && (
            <PanelSection padding="sm">
              {/* Formato antes do endereço do QR: é o que muda de uma impressão para a
                  outra. O endereço se configura uma vez na vida. */}
              <div className="space-y-3">
                <div>
                  <span className="text-caption">Formato da etiqueta</span>
                  <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {LABEL_FORMATS.map(fmt => (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => changeLabelPrefs({ format: fmt.id })}
                        aria-pressed={labelPrefs.format === fmt.id}
                        className={`min-h-[44px] rounded-control border px-3 py-2 text-left transition-colors ${
                          labelPrefs.format === fmt.id
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-edge bg-surface-3 text-fg hover:bg-edge'
                        }`}
                      >
                        <span className="block text-sm font-semibold">{fmt.label}</span>
                        <span className="block text-xs text-fg-subtle mt-0.5">{fmt.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {labelPrefs.format === 'a4' && (
                  <label className="block">
                    <span className="text-caption">Etiquetas por folha</span>
                    <Select
                      value={String(labelPrefs.perPage)}
                      onChange={e => changeLabelPrefs({ perPage: Number(e.target.value) as A4PerPage })}
                      className="mt-1 w-full sm:w-auto"
                    >
                      {A4_PER_PAGE.map(n => <option key={n} value={n}>{n} por folha</option>)}
                    </Select>
                  </label>
                )}

                {labelPrefs.format === 'custom' && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-caption">Largura (mm)</span>
                      <Input
                        type="number" min={25} max={210}
                        value={labelPrefs.customWidthMm}
                        onChange={e => changeLabelPrefs({ customWidthMm: Number(e.target.value) || 0 })}
                      />
                    </label>
                    <label className="block">
                      <span className="text-caption">Altura (mm)</span>
                      <Input
                        type="number" min={15} max={297}
                        value={labelPrefs.customHeightMm}
                        onChange={e => changeLabelPrefs({ customHeightMm: Number(e.target.value) || 0 })}
                      />
                    </label>
                  </div>
                )}

                {/* O que vai sair da impressora, antes de sair. Evita descobrir no papel
                    que 85 endereços viraram 85 páginas. */}
                <p className="text-caption">
                  Etiqueta de <strong>{plan.labelWidthMm} × {plan.labelHeightMm} mm</strong>, QR de {plan.qrMm} mm
                  {' · '}
                  {bins.length} {plural(bins.length, 'endereço', 'endereços')} em <strong>{sheets}</strong>{' '}
                  {plan.perPage === 1 ? plural(sheets, 'etiqueta', 'etiquetas') : `${plural(sheets, 'folha', 'folhas')} de ${plan.perPage}`}
                </p>
                <p className="text-caption">
                  A impressora é escolhida na janela de impressão do navegador, que abre em seguida.
                  Confira ali se o tamanho do papel bate com o formato acima.
                </p>
              </div>

              <label className="block mt-4 pt-4 border-t border-edge">
                <span className="text-caption">Endereço do sistema que vai dentro do QR</span>
                <Input value={qrBase} onChange={e => setQrBase(e.target.value)} />
              </label>
              <p className="text-caption mt-2">
                Cada adesivo vai conter <code>{(qrBase || '…').replace(/\/+$/, '')}{SCAN_PATH}?{BIN_SCAN_PARAM}=PP-A01-N1</code>
              </p>

              {isLocalOrigin(qrBase) ? (
                <div className="mt-3">
                  <Notice tone="danger">
                    Você está acessando o sistema por um endereço local. Adesivo gerado assim só funciona
                    nesta máquina — no celular do estoque não abre nada. Troque pelo endereço real do
                    InventoryBlind antes de imprimir.
                  </Notice>
                </div>
              ) : (
                <div className="mt-3">
                  <Notice tone="warning">
                    Este endereço fica colado em cada adesivo por anos. Se um dia o sistema mudar de
                    endereço, todos param de funcionar de uma vez — por isso o ideal é um domínio seu
                    (ex.: <code>estoque.azbuy.com.br</code>) apontando para o sistema, e não o do provedor.
                  </Notice>
                </div>
              )}
            </PanelSection>
            )}
          </Panel>

          <Panel>
            {canManage && emptyBins.length > 0 && (
              <PanelSection padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-title">Limpeza</h3>
                  <p className="text-caption mt-1">
                    {emptyBins.length} {plural(emptyBins.length, 'endereço', 'endereços')} sem nenhuma movimentação. Útil quando o padrão
                    saiu errado e o lote gerou mais códigos do que você queria.
                  </p>
                </div>
                {confirmBulk ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-fg">Excluir {emptyBins.length}?</span>
                    <Button onClick={() => handleDelete(emptyBins.map(b => b.id))}>Confirmar</Button>
                    <Button variant="secondary" onClick={() => setConfirmBulk(false)}>Cancelar</Button>
                  </div>
                ) : (
                  <Button variant="secondary" onClick={() => setConfirmBulk(true)}>
                    <Trash2 size={16} />
                    Excluir os {emptyBins.length} vazios
                  </Button>
                )}
              </PanelSection>
            )}

            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Endereço</Th>
                    <Th className="text-center">Caixas</Th>
                    <Th className="text-center">Capacidade</Th>
                    <Th className="text-center">Situação</Th>
                    {canManage && <Th className="text-center">Ações</Th>}
                  </Tr>
                </Thead>
                <tbody>
                  {loading ? (
                    <Tr><Td colSpan={canManage ? 5 : 4}>Carregando...</Td></Tr>
                  ) : bins.length === 0 ? (
                    <Tr>
                      <Td colSpan={canManage ? 5 : 4}>
                        Nenhum endereço cadastrado ainda. Crie os endereços acima para começar.
                      </Td>
                    </Tr>
                  ) : (
                    bins.map(bin => {
                      const boxes = occupancy.get(bin.code) ?? 0;
                      return (
                        <Tr key={bin.id}>
                          <Td className="text-code font-medium text-fg">{bin.code}</Td>
                          <Td className="text-center text-numeric">{boxes}</Td>
                          <Td className="text-center text-numeric">{bin.capacityBoxes ?? '—'}</Td>
                          <Td className="text-center">
                            {bin.blocked
                              ? <Badge variant="neutral">Bloqueado</Badge>
                              : boxes > 0
                                ? <Badge variant="accent">Ocupado</Badge>
                                : <span className="text-caption">Livre</span>}
                          </Td>
                          {canManage && (
                            <Td className="text-center">
                              <div className="flex items-center justify-center gap-2">
                                <Button variant="secondary" onClick={() => handleToggleBlock(bin)}>
                                  {bin.blocked ? <Unlock size={14} /> : <Lock size={14} />}
                                  {bin.blocked ? 'Liberar' : 'Bloquear'}
                                </Button>
                                {/* Só aparece em endereço vazio. Com saldo, o banco recusaria
                                    de qualquer jeito — mas oferecer o botão seria mentira. */}
                                {boxes === 0 && (
                                  <Button variant="secondary" onClick={() => handleDelete([bin.id])}>
                                    <Trash2 size={14} />
                                    Excluir
                                  </Button>
                                )}
                              </div>
                            </Td>
                          )}
                        </Tr>
                      );
                    })
                  )}
                </tbody>
              </Table>
            </div>
          </Panel>
        </>
      )}

      {mode === 'consulta' && (
        <WmsStockInsights onOpenBin={code => { setOperateBin(code); setMode('movimentar'); }} />
      )}

      {mode === 'gestao' && canManage && <WmsAnalytics bins={bins} />}

      {mode === 'movimentos' && (
        <Panel>
          <PanelSection padding="sm">
            <h3 className="text-title">Últimos movimentos</h3>
            <p className="text-caption mt-1">
              Todo saldo vem de um documento. Este histórico não se edita nem se apaga.
            </p>
          </PanelSection>
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Quando</Th>
                  <Th>Tipo</Th>
                  <Th>SKU</Th>
                  <Th>De</Th>
                  <Th>Para</Th>
                  <Th className="text-center">Caixas</Th>
                  <Th>Motivo</Th>
                </Tr>
              </Thead>
              <tbody>
                {movements.length === 0 ? (
                  <Tr><Td colSpan={7}>Nenhum movimento registrado ainda.</Td></Tr>
                ) : (
                  movements.map(m => (
                    <Tr key={m.id}>
                      <Td className="text-caption">{formatDate(m.createdAt)}</Td>
                      <Td>{MOVEMENT_LABEL[m.movementType]}</Td>
                      <Td className="text-code">{m.sku ?? '—'}</Td>
                      <Td className="text-code">{m.fromCode ?? '—'}</Td>
                      <Td className="text-code">{m.toCode ?? '—'}</Td>
                      <Td className="text-center text-numeric">{m.boxes}</Td>
                      <Td className="text-caption">{m.reason ?? '—'}</Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>
        </Panel>
      )}

      {/* Leitor de QR da vaga escolhida no mapa 3D.

          `expectCode` põe o leitor em modo CONFERÊNCIA: o endereço já foi escolhido no
          mapa, e a câmera serve para provar que o operador está fisicamente naquela
          vaga. Lendo outra etiqueta o leitor recusa e continua lendo — trocar o
          endereço em silêncio seria o oposto de conferir.

          É um Modal sobreposto: o Canvas não desmonta e a câmera 3D não se mexe
          enquanto o leitor está aberto.

          Confirmada a presença, o fluxo segue para Movimentar com a vaga preenchida —
          que é o caminho que já roda em produção. Registrar movimento exige produto,
          caixas e unidades por caixa; refazer esse formulário dentro do overlay
          duplicaria uma tela que funciona. */}
      {scanSlot && (
        <WmsBinScanner
          open
          title={`Conferir a vaga ${scanSlot.id}`}
          expectCode={scanSlot.id}
          onClose={() => setScanSlot(null)}
          onDetected={code => {
            setScanSlot(null);
            setOperateBin(code);
            setMode('movimentar');
          }}
        />
      )}

    </Page>
  );
}
```


---

## 4. Módulo 3D e Visualização do Galpão

### 4.1 Como o 3D consome o dado

```
loadWarehouseSlots()                       (warehouse3dSlots.ts)
 ├── listBins()      → warehouse_storage_bins   (código, capacidade, bloqueio, andar)
 └── boxesByBin()    → warehouse_bin_stock      (saldo agregado por endereço)
        ↓
   buildSlots()  — PURA: aplica parseBinCode() e statusDaVaga()
        ↓
   Slot[] { id, rua, ruaCodigo, modulo, nivel, status, caixas, capacidade }
        ↓
   Warehouse3DViewer  →  Cena3D  →  lotes InstancedMesh
```

**Duas geometrias para o mesmo galpão, e elas não se convertem uma na outra:**

1. **Grade por código** — derivada de `code` (`PP-A01-N1` → rua A, módulo 1, nível 1),
   posicionada por `rowSpacing` × `moduleWidth`. Sempre regular.
2. **Planta física** — medidas reais vindas de `warehouse_plan_sections`.

A divergência entre as duas foi medida em **10,6 m** para `PP-E03-N2`. Não é deslocamento
constante, então não há offset que concilie. `warehouse3dCoordenadas.ts` existe só para
resolver qual das duas vale na vista ativa.

### 4.2 Orçamento de GPU (medido no navegador)

Instrumentando `drawElements`/`drawArrays`/`*Instanced` no contexto WebGL vivo, na vista por
código com 215 endereços:

| | |
|---|---|
| Lotes instanciados por quadro | 5 → `[8, 425, 40, 8, 207]` |
| 425 = montantes + diagonais | 190 + 235, num lote só |
| 40 = longarinas | |
| 8 / 207 = vagas ocupadas / livres | |
| Desenhos de tela por quadro | **29** |
| `frameloop` | `demand` — a cena não redesenha em repouso |


### 4.3 Resolução de coordenada entre as duas vistas

#### `src/lib/wms/warehouse3dCoordenadas.ts`  _(168 linhas)_

```ts
// Onde uma vaga está no espaço, conforme a vista ativa do mapa 3D.
//
// O mapa desenha o mesmo galpão de DUAS maneiras, e as duas têm geometria própria:
//
//   vista por código   rua × rowSpacing em X, módulo × moduleWidth em Z
//                      (8 ruas = 28 m de largura, 16 módulos = 19,5 m de profundidade)
//   vista da planta    as 8 ruas cabem nos 10,3 m de largura do prédio e o comprimento
//                      da fileira corre pelos 45,2 m de Z
//
// Medido com o código real: `PP-E03-N2` fica em `[2; 2,5; −7,15]` na grade por código e
// em `[−4,3; 2,1; 1,32]` na planta — 10,6 m de distância. NÃO é um deslocamento que dá
// para somar: as escalas dos eixos são diferentes. Por isso aqui existe um RESOLVEDOR
// por vista, e não uma correção de offset.
//
// ── O erro que este módulo existe para impedir ──────────────────────────────────
// Câmera e radar liam a posição sempre da grade por código. Com a planta desenhada —
// que é o padrão da tela —, "Ir até", "Avançar para a parada N" e o clique no radar
// levavam a câmera para onde a vaga ESTARIA na outra geometria. Não dá erro nenhum: a
// câmera voa, a cena continua bonita, e a vaga não está lá.
//
// ── Local e mundo ───────────────────────────────────────────────────────────────
// As duas vistas desenham num `<group>` deslocado para centralizar o conjunto na origem.
// Então existe coordenada LOCAL (a que cada geometria produz) e coordenada de MUNDO (a
// que a câmera e o OrbitControls enxergam):
//
//   mundo = local + offset        local = mundo − offset
//
// Confundir as duas é o erro silencioso desta família de funções, e é o mesmo que
// `warehouse3dRadar` já documenta.

import { posicaoDaVaga, type Layout3DConfig } from './warehouse3dLayout';
import {
  PASSO_DA_POSICAO, PROFUNDIDADE_DA_FILEIRA, vaosDaFileira, type BlocoFisico,
} from './warehouse3dPlantaFisica';

export type Ponto = [number, number, number];

/** O mínimo que um resolvedor precisa saber da vaga para achá-la nas duas geometrias. */
export interface VagaLocalizavel {
  /** Código impresso (`PP-E03-N2`) — é a chave na planta. */
  id: string;
  rua: number;
  ruaCodigo: string;
  modulo: number;
  nivel: number;
}

/**
 * Posição LOCAL de uma vaga, ou `null` quando a vista ativa não sabe desenhá-la.
 *
 * O `null` é informação, não falha: na planta existe vaga cadastrada cujo vão não é
 * desenhado (rua que a planta não descreve). Devolver `[0,0,0]` nesse caso mandaria a
 * câmera para o canto do galpão como se fosse o endereço pedido.
 */
export type ResolvedorLocal = (vaga: VagaLocalizavel) => Ponto | null;

/** Soma local + offset. Existe como função para o teste poder afirmar a conta. */
export function emMundo(local: Ponto, offset: Ponto): Ponto {
  return [local[0] + offset[0], local[1] + offset[1], local[2] + offset[2]];
}

/**
 * Offset com que a planta física é desenhada.
 *
 * É o MESMO valor que `PlantaFisica3D` aplica no seu `<group>`. Duplicar a conta nos dois
 * lugares foi o que permitiu a câmera divergir do desenho; aqui ela passa a ter um dono.
 *
 * Centra pelo ENVELOPE do prédio, não pela massa desenhada — é o que o componente faz
 * hoje, e mudar isso moveria a cena inteira, que não é o escopo deste passo.
 */
export function offsetDaPlanta(largura: number, comprimento: number): Ponto {
  return [-largura / 2, 0, -comprimento / 2];
}

/**
 * O vão de um endereço: onde ele está e QUANTO ele mede.
 *
 * O tamanho entra junto porque o contorno do realce precisa dele: o vão muda de medida
 * por fileira (13 posições em 15,6 m na rua A, 12 em 15 m na E), então um contorno de
 * tamanho fixo desenharia a caixa da rua A em cima da rua E. E ele vem de graça — quem
 * monta o índice já tem o vão inteiro na mão.
 */
export interface VaoIndexado {
  centro: Ponto;
  tamanho: Ponto;
}

/**
 * Código do endereço -> vão desenhado, em coordenada local da planta.
 *
 * Construído a partir dos blocos que a cena JÁ desenha, então o índice não pode apontar
 * para um vão que não existe na tela: é a mesma `vaosDaFileira` que monta o clique.
 *
 * Vão sem código (fileira sem rua cadastrada) fica de fora — ele não corresponde a
 * endereço nenhum.
 */
export function indiceDosVaos(
  blocos: readonly BlocoFisico[],
  prefixo = 'PP',
): Map<string, VaoIndexado> {
  const indice = new Map<string, VaoIndexado>();
  for (const bloco of blocos) {
    if (bloco.tipo !== 'fileira') continue;
    for (const vao of vaosDaFileira(bloco, prefixo)) {
      if (vao.codigo) indice.set(vao.codigo, { centro: vao.centro, tamanho: vao.tamanho });
    }
  }
  return indice;
}

/**
 * Folga entre a cabeceira e a primeira fileira, em metros.
 *
 * Metade do corredor transversal de entrada do prédio atual (1,4 m): a rota atravessa
 * pelo MEIO do corredor, não encostada na ponta da estante.
 */
const FOLGA_DA_CABECEIRA = 0.7;

/**
 * Z da cabeceira na planta física: o corredor transversal por onde se troca de rua.
 *
 * Na grade por código a cabeceira é `-moduleWidth * 0,9` — um ponto ANTES do módulo 1,
 * que ali fica em z=0. Na planta as fileiras começam depois do corredor de entrada do
 * trecho, então aquele valor cairia fora do prédio e a rota sairia pela parede dos fundos
 * para trocar de corredor.
 *
 * Sem fileira nenhuma devolve 0 — não há travessia a desenhar, e um `Infinity` vindo de
 * `Math.min` de lista vazia produziria uma linha até o infinito.
 */
export function cabeceiraDaPlanta(blocos: readonly BlocoFisico[]): number {
  const inicios = blocos
    .filter(b => b.tipo === 'fileira')
    .map(b => b.centro[2] - b.tamanho[2] / 2);
  return inicios.length === 0 ? 0 : Math.min(...inicios) - FOLGA_DA_CABECEIRA;
}

/** Multiplicador do recuo sobre o passo da geometria. 2,2 é o valor que a tela já usava. */
const FATOR_DO_RECUO = 2.2;

/**
 * Quanto a câmera recua ao focar uma vaga, conforme a vista ATIVA.
 *
 * O recuo sempre saiu da grade por código: `max(rowSpacing, moduleWidth) × 2,2` = 8,8 m
 * com os padrões. Na planta física o corredor tem 2,65 m no galpão novo e 1,20 m no prédio
 * atual — recuar 8,8 m põe a câmera DENTRO da estante vizinha, ou duas fileiras adiante.
 * Foi o que apareceu ao usar "Avançar para a parada 1" com a planta desenhada.
 *
 * Na planta o passo é a profundidade da fileira e o vão da posição, não o espaçamento de
 * rua: ~2,64 m, que deixa a câmera no meio do corredor seguinte em vez de dentro do aço.
 */
export function recuoDeFoco(
  cfg: Pick<Layout3DConfig, 'rowSpacing' | 'moduleWidth'>,
  naPlanta: boolean,
): number {
  if (naPlanta) return Math.max(PROFUNDIDADE_DA_FILEIRA, PASSO_DA_POSICAO) * FATOR_DO_RECUO;
  return Math.max(cfg.rowSpacing, cfg.moduleWidth) * FATOR_DO_RECUO;
}

/** Resolvedor da vista por código: a aritmética do endereço. */
export function resolvedorDaGrade(cfg: Layout3DConfig): ResolvedorLocal {
  return vaga => posicaoDaVaga(vaga, cfg);
}

/** Resolvedor da vista da planta: o índice dos vãos desenhados. */
export function resolvedorDaPlanta(indice: ReadonlyMap<string, VaoIndexado>): ResolvedorLocal {
  return vaga => indice.get(vaga.id)?.centro ?? null;
}
```


### 4.4 Geometria da grade por código

#### `src/lib/wms/warehouse3dLayout.ts`  _(147 linhas)_

```ts
// Geometria configurável do porta-pallets: onde cada vaga fica no espaço.
//
// Mora fora do componente porque é aritmética, e aritmética se confere sem WebGL.
// Dentro do `<Canvas>` só daria para checar por screenshot, que não distingue "subiu
// 2,5 m" de "subiu 2,4 m".
//
// ── Por que isto virou configurável ─────────────────────────────────────────────
// Parte dos porta-pallets do Pulmão é estrutura AÉREA: a primeira prateleira começa
// acima do piso, sobre vigas. Desenhar tudo apoiado em Y=0 põe mercadoria no chão que
// na vida real está a três metros de altura — e quem olha o mapa para planejar
// separação tira a conclusão errada sobre o que alcança sem equipamento.
//
// O banco NÃO guarda essas medidas. São propriedade do galpão, não do endereço, então
// vivem como preferência local de quem monta o mapa.

/** Dimensões de uma vaga, em METROS. Palete PBR carregado. */
export const VAGA = { largura: 1.2, altura: 1.4, profundidade: 1.2 } as const;

export interface Layout3DConfig {
  /** Altura do piso até a base da primeira prateleira. 0 = apoiado no chão. */
  baseOffsetY: number;
  /** Distância vertical entre andares. */
  levelHeight: number;
  /** Passo entre módulos, ao longo da rua (eixo Z). */
  moduleWidth: number;
  /** Passo entre eixos de rua (eixo X). Inclui o corredor de manobra. */
  rowSpacing: number;
  /** Elevação própria de uma rua, pela LETRA dela. Sobrepõe `baseOffsetY`. */
  baseByStreet: Record<string, number>;
}

/**
 * Os padrões reproduzem exatamente o desenho atual, então abrir o configurador e não
 * mexer em nada não muda um pixel.
 *
 * 1,8 = 1,4 de carga + 0,4 de longarina e folga de garfo.
 * 4,0 = 1,2 de vaga + 2,8 de corredor (faixa de empilhadeira contrabalançada).
 * 1,3 = 1,2 de vaga + 0,1, porque módulos vizinhos dividem o montante vertical.
 */
export const LAYOUT_PADRAO: Layout3DConfig = {
  baseOffsetY: 0,
  levelHeight: 1.8,
  moduleWidth: 1.3,
  rowSpacing: 4.0,
  baseByStreet: {},
};

/**
 * Limites de cada campo.
 *
 * Não são capricho: `levelHeight` menor que a altura da vaga faz os níveis se
 * atravessarem, e um `rowSpacing` de 200 joga a rua 4 para fora do campo de visão sem
 * aviso nenhum. O formulário aceita o que estiver dentro; fora disso, corrige.
 */
export const LIMITES = {
  baseOffsetY: { min: 0, max: 20 },
  levelHeight: { min: VAGA.altura, max: 6 },
  moduleWidth: { min: VAGA.profundidade, max: 6 },
  rowSpacing: { min: VAGA.largura, max: 20 },
} as const;

const prender = (valor: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, valor));

const numeroOu = (valor: unknown, padrao: number): number =>
  typeof valor === 'number' && Number.isFinite(valor) ? valor : padrao;

/**
 * Normaliza qualquer coisa vinda do localStorage num config válido.
 *
 * O que está gravado veio de uma versão anterior do app ou de edição manual, então é
 * dado não confiável: campo faltando, texto no lugar de número, chave a mais. Nada
 * disso pode derrubar a tela — na pior hipótese volta ao padrão.
 */
export function sanearLayout(bruto: unknown): Layout3DConfig {
  if (typeof bruto !== 'object' || bruto === null) return { ...LAYOUT_PADRAO };
  const fonte = bruto as Record<string, unknown>;

  const baseByStreet: Record<string, number> = {};
  const porRua = fonte.baseByStreet;
  if (typeof porRua === 'object' && porRua !== null) {
    for (const [letra, valor] of Object.entries(porRua as Record<string, unknown>)) {
      if (typeof valor === 'number' && Number.isFinite(valor)) {
        baseByStreet[letra.toUpperCase()] = prender(valor, LIMITES.baseOffsetY);
      }
    }
  }

  return {
    baseOffsetY: prender(numeroOu(fonte.baseOffsetY, LAYOUT_PADRAO.baseOffsetY), LIMITES.baseOffsetY),
    levelHeight: prender(numeroOu(fonte.levelHeight, LAYOUT_PADRAO.levelHeight), LIMITES.levelHeight),
    moduleWidth: prender(numeroOu(fonte.moduleWidth, LAYOUT_PADRAO.moduleWidth), LIMITES.moduleWidth),
    rowSpacing: prender(numeroOu(fonte.rowSpacing, LAYOUT_PADRAO.rowSpacing), LIMITES.rowSpacing),
    baseByStreet,
  };
}

/** Elevação da base desta rua: a dela, se houver; senão a geral. */
export function baseDaRua(ruaCodigo: string, cfg: Layout3DConfig): number {
  const propria = cfg.baseByStreet[ruaCodigo.toUpperCase()];
  return typeof propria === 'number' ? propria : cfg.baseOffsetY;
}

/**
 * Posição do CENTRO da vaga no espaço, em metros.
 *
 * O `+ VAGA.altura / 2` existe porque a caixa é desenhada centrada na posição: sem ele
 * o nível 1 ficaria metade enterrado no piso. Com ele, a BASE do nível 1 encosta
 * exatamente em `baseOffsetY` — que é o que a medida significa para quem está no
 * galpão olhando para a estrutura.
 *
 * `rua` é o ÍNDICE da rua (1, 2, 3...), não a letra; `ruaCodigo` é a letra, usada só
 * para achar a elevação própria daquela rua.
 */
export function posicaoDaVaga(
  slot: { rua: number; ruaCodigo: string; modulo: number; nivel: number },
  cfg: Layout3DConfig,
): [number, number, number] {
  return [
    (slot.rua - 1) * cfg.rowSpacing,
    baseDaRua(slot.ruaCodigo, cfg) + (slot.nivel - 1) * cfg.levelHeight + VAGA.altura / 2,
    (slot.modulo - 1) * cfg.moduleWidth,
  ];
}

const CHAVE = 'ib.wms.layout3d';

/** Lê a preferência gravada. Em modo privado ou com dado corrompido, devolve o padrão. */
export function carregarLayout(): Layout3DConfig {
  try {
    const cru = localStorage.getItem(CHAVE);
    if (!cru) return { ...LAYOUT_PADRAO };
    return sanearLayout(JSON.parse(cru));
  } catch {
    return { ...LAYOUT_PADRAO };
  }
}

/** Grava a preferência. Falhar aqui não pode quebrar a tela — o mapa segue funcionando. */
export function salvarLayout(cfg: Layout3DConfig): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(cfg));
  } catch {
    /* modo privado, cota cheia: a preferência só não sobrevive ao reload */
  }
}
```

#### `src/lib/wms/warehouse3dEstrutura.ts`  _(269 linhas)_

```ts
// Geometria física do porta-pallets: montantes, vigas, palete e carga.
//
// Fora do componente pelo mesmo motivo dos outros módulos do mapa: posição de montante
// e de viga é aritmética, e errar nela produz estante atravessando pallet ou viga
// flutuando entre níveis. Isso se confere por teste, não por olhar a cena.
//
// ── Montante e viga NÃO pertencem à vaga ────────────────────────────────────────
// Numa estante real o montante é COMPARTILHADO entre dois vãos vizinhos, e a viga
// corre ao longo de toda a rua passando por baixo de vários pallets. Desenhar um
// quadro fechado por vaga duplicaria cada montante e empilharia vigas sobrepostas —
// com 71 vagas seriam centenas de peças no lugar de dezenas, e nas junções o
// z-fighting apareceria como cintilação.
//
// Por isso a estrutura é derivada do CONJUNTO: por rua, montantes nas divisas de
// módulo e vigas corridas por nível.
//
// ── O que continua vindo da vaga ────────────────────────────────────────────────
// Palete e carga, que são por posição. A cor da carga continua sendo decidida fora
// daqui: este módulo responde ONDE as peças ficam, nunca o que elas significam.

import { VAGA, baseDaRua, posicaoDaVaga, type Layout3DConfig } from './warehouse3dLayout';
import type { Slot } from './warehouse3dSlots';

/** Medidas da estrutura, em metros. Proporções de porta-pallets convencional. */
export const ESTRUTURA = {
  /** Seção quadrada do montante. */
  montante: 0.09,
  /** Altura da viga horizontal. */
  viga: 0.07,
  /** Espessura do palete de madeira. */
  palete: 0.12,
  /** Recuo do palete em relação ao vão, de cada lado. */
  folgaPalete: 0.06,
  /** Recuo da carga em relação ao vão, de cada lado. Maior que a do palete: a carga
   *  nunca ocupa a borda exata do palete. */
  folgaCarga: 0.14,
  /** Folga no topo, para a carga não encostar na viga do nível de cima. */
  folgaTopo: 0.1,
  /**
   * Seção da diagonal de contraventamento. Mais fina que o montante, como no galpão:
   * ela trava o quadro, não sustenta carga. Mesmo valor da planta física — as duas
   * vistas desenham a MESMA estante, e uma diferença aqui apareceria como a estante
   * mudando de construção conforme a aba aberta.
   */
  diagonal: 0.04,
} as const;

export type Ponto = [number, number, number];

export interface PecaDaEstrutura {
  posicao: Ponto;
  /** Comprimento no eixo em que a peça se estende (Y para montante, Z para viga). */
  comprimento: number;
}

/** Altura e dimensões da carga empilhada sobre o palete. */
export const CARGA = {
  largura: VAGA.largura - ESTRUTURA.folgaCarga * 2,
  profundidade: VAGA.profundidade - ESTRUTURA.folgaCarga * 2,
  altura: VAGA.altura - ESTRUTURA.palete - ESTRUTURA.folgaTopo,
} as const;

export const PALETE = {
  largura: VAGA.largura - ESTRUTURA.folgaPalete * 2,
  profundidade: VAGA.profundidade - ESTRUTURA.folgaPalete * 2,
  altura: ESTRUTURA.palete,
} as const;

/** Piso do vão: a face em que o palete se apoia. */
export function pisoDoVao(slot: Slot, cfg: Layout3DConfig): number {
  return posicaoDaVaga(slot, cfg)[1] - VAGA.altura / 2;
}

/** Centro do palete apoiado no vão. */
export function posicaoDoPalete(slot: Slot, cfg: Layout3DConfig): Ponto {
  const [x, , z] = posicaoDaVaga(slot, cfg);
  return [x, pisoDoVao(slot, cfg) + PALETE.altura / 2, z];
}

/** Centro do bloco de carga, apoiado SOBRE o palete — nunca atravessando-o. */
export function posicaoDaCarga(slot: Slot, cfg: Layout3DConfig): Ponto {
  const [x, , z] = posicaoDaVaga(slot, cfg);
  return [x, pisoDoVao(slot, cfg) + PALETE.altura + CARGA.altura / 2, z];
}

interface ResumoDaRua {
  x: number;
  base: number;
  minModulo: number;
  maxModulo: number;
  maxNivel: number;
}

function resumirRuas(slots: readonly Slot[], cfg: Layout3DConfig): ResumoDaRua[] {
  const porRua = new Map<string, ResumoDaRua>();

  for (const slot of slots) {
    const [x] = posicaoDaVaga(slot, cfg);
    const atual = porRua.get(slot.ruaCodigo);
    if (atual) {
      atual.minModulo = Math.min(atual.minModulo, slot.modulo);
      atual.maxModulo = Math.max(atual.maxModulo, slot.modulo);
      atual.maxNivel = Math.max(atual.maxNivel, slot.nivel);
    } else {
      porRua.set(slot.ruaCodigo, {
        x,
        base: baseDaRua(slot.ruaCodigo, cfg),
        minModulo: slot.modulo,
        maxModulo: slot.modulo,
        maxNivel: slot.nivel,
      });
    }
  }

  return [...porRua.values()];
}

/**
 * Montantes: as colunas verticais da estante.
 *
 * Nas DIVISAS entre módulos, não no centro deles — é onde ficam numa estante real, e é
 * o que faz o vão aparecer emoldurado em vez de cortado ao meio. São `n + 1` divisas
 * para `n` módulos, porque as duas pontas também têm coluna.
 *
 * Duas fileiras por rua, uma na frente e outra no fundo da profundidade do vão: é o
 * par que sustenta as vigas em que o pallet se apoia.
 */
export function montantesDoArmazem(
  slots: readonly Slot[],
  cfg: Layout3DConfig,
): PecaDaEstrutura[] {
  const pecas: PecaDaEstrutura[] = [];
  const meiaProfundidade = VAGA.profundidade / 2;

  for (const rua of resumirRuas(slots, cfg)) {
    // Da base da rua até o topo do último nível.
    const altura = rua.maxNivel * cfg.levelHeight;
    const centroY = rua.base + altura / 2;

    for (let m = rua.minModulo; m <= rua.maxModulo + 1; m += 1) {
      const z = (m - 1) * cfg.moduleWidth - cfg.moduleWidth / 2;
      for (const dx of [-meiaProfundidade, meiaProfundidade]) {
        pecas.push({ posicao: [rua.x + dx, centroY, z], comprimento: altura });
      }
    }
  }

  return pecas;
}

/**
 * Vigas: as travessas horizontais em que os paletes se apoiam.
 *
 * Uma por nível, CORRIDA pela rua inteira, em vez de um trecho por vaga. Trechos
 * separados se encostariam nas divisas e brigariam por profundidade ali — a
 * cintilação resultante é visível justamente nas junções, que é onde a estante precisa
 * parecer contínua.
 *
 * Uma travessa no TOPO de cada nível, do 1 ao último. Duas coisas saem disso de graça:
 * o topo da travessa coincide com o piso do nível de cima, que é onde aquele palete se
 * apoia; e o último nível ganha o travamento superior que toda estante tem.
 *
 * Duas medições corrigiram esta função, e as duas valem registrar:
 *
 * 1. Centro da travessa no piso do vão fazia o aço atravessar os 7 cm de baixo de TODO
 *    palete do armazém. Agora quem coincide com o piso é o TOPO dela.
 *
 * 2. A versão seguinte pulava o nível 1 — "o pallet de baixo apoia no chão, não precisa
 *    de travessa". Verdade para o pallet, falso para a ESTANTE: rua de um nível só
 *    ficava sem travessa nenhuma, e as colunas apareciam soltas, sem nada ligando uma à
 *    outra. Foi exatamente o que apareceu nas ruas C e D, que em produção só têm nível
 *    1. Travessa não existe só para segurar pallet — ela também é o que faz dois
 *    montantes serem uma estante.
 */
export function vigasDoArmazem(slots: readonly Slot[], cfg: Layout3DConfig): PecaDaEstrutura[] {
  const pecas: PecaDaEstrutura[] = [];
  const meiaProfundidade = VAGA.profundidade / 2;

  for (const rua of resumirRuas(slots, cfg)) {
    const modulos = rua.maxModulo - rua.minModulo + 1;
    const comprimento = modulos * cfg.moduleWidth;
    const zInicial = (rua.minModulo - 1) * cfg.moduleWidth - cfg.moduleWidth / 2;
    const centroZ = zInicial + comprimento / 2;

    for (let nivel = 1; nivel <= rua.maxNivel; nivel += 1) {
      const topo = rua.base + nivel * cfg.levelHeight;
      const y = topo - ESTRUTURA.viga / 2;
      for (const dx of [-meiaProfundidade, meiaProfundidade]) {
        pecas.push({ posicao: [rua.x + dx, y, centroZ], comprimento });
      }
    }
  }

  return pecas;
}

/**
 * Peça do quadro que não é ortogonal — hoje só a diagonal.
 *
 * Tem as três medidas e um giro, diferente de `PecaDaEstrutura`, que carrega um
 * comprimento só porque montante e longarina se estendem num eixo conhecido. A
 * diagonal não: ela é comprida numa direção inclinada, e descrevê-la por "comprimento"
 * obrigaria quem desenha a saber de que peça se trata para reconstruir o resto.
 *
 * Mesma forma da `PecaDaFileira` da planta física, de propósito: as duas alimentam o
 * mesmo desenho de instância, com a escala e o giro na matriz.
 */
export interface PecaInclinada {
  centro: Ponto;
  tamanho: Ponto;
  /** Giro em torno de Z, em radianos. */
  rotacaoZ: number;
}

/**
 * Diagonais de contraventamento da vista por CÓDIGO.
 *
 * Existiam só na planta física, e isso aparecia: a mesma estante tinha treliça numa aba
 * e um par de barras lisas na outra. Como as duas vistas desenham o mesmo porta-pallets,
 * a diferença lia como mudança de construção, não como mudança de ponto de vista.
 *
 * ── Onde a diagonal fica ────────────────────────────────────────────────────────
 * No QUADRO: o plano vertical que contém os dois montantes de uma mesma divisa de
 * módulo, atravessando a profundidade do vão. É o sentido em que o pallet entra e para
 * onde a estante tomba — por isso é ali que ela é travada, e não ao longo do corredor.
 *
 * Uma por nível em cada divisa, alternando o sentido por `(divisa + nível)`: o
 * zigue-zague da estante real, em vez de um feixe de riscos paralelos.
 *
 * ── Por que a subida é um nível MENOS a seção ───────────────────────────────────
 * Inclinada, a caixa ocupa em Y a subida mais a projeção da própria seção. Com a subida
 * cheia, a diagonal do último nível furaria o topo da estante — o mesmo erro já medido
 * na planta física, e a mesma correção. Com o desconto, a extensão vertical fecha em
 * exatamente um nível e o topo da última diagonal coincide com o topo do montante.
 */
export function diagonaisDoArmazem(
  slots: readonly Slot[],
  cfg: Layout3DConfig,
): PecaInclinada[] {
  const pecas: PecaInclinada[] = [];
  // Vão LIVRE entre os montantes: de centro a centro é a profundidade do vão, e a
  // diagonal encosta na face interna de cada um.
  const vao = VAGA.profundidade - ESTRUTURA.montante;
  const subida = cfg.levelHeight - ESTRUTURA.diagonal;
  if (vao <= 0 || subida <= 0) return pecas;

  const comprimento = Math.hypot(vao, subida);
  const angulo = Math.atan2(subida, vao);

  for (const rua of resumirRuas(slots, cfg)) {
    // As MESMAS divisas dos montantes: a diagonal nasce entre o par que ela trava, e
    // uma contagem própria aqui soltaria a treliça das colunas.
    for (let m = rua.minModulo; m <= rua.maxModulo + 1; m += 1) {
      const z = (m - 1) * cfg.moduleWidth - cfg.moduleWidth / 2;
      for (let nivel = 1; nivel <= rua.maxNivel; nivel += 1) {
        pecas.push({
          centro: [rua.x, rua.base + (nivel - 1) * cfg.levelHeight + cfg.levelHeight / 2, z],
          // Comprida em X antes do giro: girada em torno de Z, ela se inclina no plano
          // X–Y, que é o plano em que os dois montantes vivem.
          tamanho: [comprimento, ESTRUTURA.diagonal, ESTRUTURA.diagonal],
          rotacaoZ: (m + nivel) % 2 === 0 ? angulo : -angulo,
        });
      }
    }
  }

  return pecas;
}
```


### 4.5 Geometria da planta física medida

#### `src/lib/wms/warehouse3dPlantaFisica.ts`  _(456 linhas)_

```ts
// A planta do galpão como GEOMETRIA, em metros.
//
// Até aqui o mapa 3D desenhava a partir do código da vaga: rua × 4 m, módulo × 1,3 m.
// O código diz "rua E, posição 3, nível 1" e NÃO diz onde a rua E fica no prédio, então
// a cena nunca teve como coincidir com a planta — ela era uma grade regular por cima de
// um desenho irregular.
//
// Este módulo inverte a origem: as estruturas vêm das MEDIDAS da planta, e cada fileira
// sabe seu lugar, seu comprimento e sua direção. É aritmética pura, fora do componente,
// porque errar aqui põe estante dentro de parede — e isso se confere por teste, não por
// olhar a cena.
//
// ── Eixos ─────────────────────────────────────────────────────────────────────────
// X = largura do prédio (0 → 10,3 m). Z = comprimento (0 → 45,2 m), do fundo do prédio
// atual até o portão da rua. Y = altura. A origem é o canto, e quem desenha centraliza.

/** Uma caixa do cenário, em metros, já posicionada pelo CENTRO. */
export interface BlocoFisico {
  id: string;
  tipo: 'fileira' | 'expedicao' | 'bancada';
  /** Centro: [x, y, z]. */
  centro: [number, number, number];
  /** Dimensões: [largura em X, altura em Y, comprimento em Z]. */
  tamanho: [number, number, number];
  /** Rótulo para quem olha a cena. Vazio quando não vale rotular. */
  rotulo: string;
}

/** Medidas de um prédio do conjunto, lidas da planta. */
export interface TrechoDaPlanta {
  nome: string;
  /** Onde este trecho começa no eixo Z. */
  zInicio: number;
  /** Comprimento do trecho em Z. */
  comprimento: number;
  /** Quantas fileiras de porta-pallets, lado a lado no eixo X. */
  fileiras: number;
  /** Comprimento de cada fileira, em metros. */
  comprimentoDaFileira: number;
  /** Corredor transversal livre no começo do trecho. */
  corredorInicio: number;
  /**
   * Agrupamento das fileiras no eixo X.
   *
   * `uniforme` espalha todas com o mesmo passo — é o prédio atual, onde a planta mostra
   * cinco fileiras igualmente espaçadas. `dupla-central` é o galpão novo: uma colada na
   * parede esquerda, duas costa-a-costa no meio, uma na parede direita, com corredor de
   * empilhadeira entre os blocos. As duas distribuições produzem posições diferentes para
   * o mesmo número de fileiras, e trocar uma pela outra põe rack em cima de corredor.
   */
  distribuicao: 'uniforme' | 'dupla-central';
  /** Largura do corredor longitudinal entre blocos de fileira. */
  corredorLongitudinal: number;
}

/** Largura do prédio, comum aos dois trechos. */
export const LARGURA_DO_PREDIO = 10.3;

/** Profundidade de uma fileira de porta-pallets (palete PBR mais folga de viga). */
export const PROFUNDIDADE_DA_FILEIRA = 1.1;

/** Altura da estante de três níveis, que é o que as ruas cadastradas têm. */
export const ALTURA_DA_FILEIRA = 4.2;

/**
 * AZ 2027 — térreo, como a planta descreve.
 *
 * As medidas são as da própria planta (HomeByMe + fotos), que ela mesma declara
 * aproximadas. Reproduzir fielmente o DESENHO não é o mesmo que reproduzir o galpão:
 * quando houver levantamento técnico, estes números mudam e a cena acompanha.
 */
export const AZ2027_TERREO: TrechoDaPlanta[] = [
  {
    nome: 'Prédio atual',
    zInicio: 0,
    comprimento: 18.6,
    fileiras: 5,
    // 3 módulos de 3,5 m cada, como a planta anota.
    comprimentoDaFileira: 10.5,
    corredorInicio: 1.4,
    distribuicao: 'uniforme',
    // Não cotado na planta; é o que sobra entre cinco fileiras na largura de 10,3 m.
    corredorLongitudinal: 1.2,
  },
  {
    nome: 'Galpão novo',
    zInicio: 18.6,
    comprimento: 26.6,
    fileiras: 4,
    // 26,6 menos o corredor de 2,2 na entrada, o de 1,8 no fim e os 7,6 da expedição.
    comprimentoDaFileira: 15.0,
    corredorInicio: 2.2,
    distribuicao: 'dupla-central',
    corredorLongitudinal: 2.65,
  },
];

/** Expedição / carga e descarga, no fim do galpão novo. */
export const EXPEDICAO = { largura: 9.7, comprimento: 7.6 } as const;

/**
 * Posições em X dos centros das fileiras de um trecho.
 *
 * `uniforme` divide a largura inteira: com N fileiras e N−1 corredores, sobra uma folga
 * que é repartida nas duas bordas, para a fileira da ponta não nascer atravessando a
 * parede.
 *
 * `dupla-central` monta três blocos — parede, dupla, parede — e centra o conjunto.
 */
export function posicoesEmX(trecho: TrechoDaPlanta, larguraDoPredio = LARGURA_DO_PREDIO): number[] {
  const p = PROFUNDIDADE_DA_FILEIRA;

  if (trecho.distribuicao === 'uniforme') {
    const passo = p + trecho.corredorLongitudinal;
    const ocupado = trecho.fileiras * p + (trecho.fileiras - 1) * trecho.corredorLongitudinal;
    const borda = (larguraDoPredio - ocupado) / 2;
    return Array.from({ length: trecho.fileiras }, (_, i) => borda + p / 2 + i * passo);
  }

  // dupla-central: 1 na esquerda, 2 costa-a-costa no meio, o resto na direita.
  const noMeio = Math.max(0, trecho.fileiras - 2);
  const ocupado = trecho.fileiras * p + 2 * trecho.corredorLongitudinal;
  const borda = (larguraDoPredio - ocupado) / 2;

  const xs: number[] = [borda + p / 2];
  let cursor = borda + p + trecho.corredorLongitudinal;
  for (let i = 0; i < noMeio; i++) {
    xs.push(cursor + p / 2);
    cursor += p;
  }
  cursor += trecho.corredorLongitudinal;
  xs.push(cursor + p / 2);
  return xs;
}

/**
 * Todos os blocos da planta, prontos para desenhar.
 *
 * `rotulosPorTrecho` nomeia as fileiras na ordem em que elas aparecem no eixo X. É o que
 * liga o desenho às ruas cadastradas (A–D no prédio atual, E–H no galpão novo). Trecho
 * sem rótulo suficiente deixa a fileira sem nome em vez de inventar um.
 */
export function blocosDaPlanta(
  trechos: TrechoDaPlanta[] = AZ2027_TERREO,
  rotulosPorTrecho: Record<string, string[]> = { 'Prédio atual': ['A', 'B', 'C', 'D'], 'Galpão novo': ['E', 'F', 'G', 'H'] },
  posicoesCadastradas: Record<string, number> = {},
): BlocoFisico[] {
  const blocos: BlocoFisico[] = [];

  for (const trecho of trechos) {
    const xs = posicoesEmX(trecho);
    const zInicioDasFileiras = trecho.zInicio + trecho.corredorInicio;
    const rotulos = rotulosPorTrecho[trecho.nome] ?? [];

    xs.forEach((x, i) => {
      const letra = rotulos[i];

      // A fileira nunca é mais curta do que o CADASTRO exige.
      //
      // A planta diz 10,5 m para as fileiras do prédio atual (3 módulos de 3,5 m), o
      // que dá 8 posições. Mas a rua A tem 13 cadastradas e a D tem 16 — e com 8 vãos
      // desenhados, `PP-A13-N3` com 16 caixas simplesmente NÃO APARECIA no mapa.
      // Mercadoria sumindo do desenho é pior que desenho fora de medida: a medida da
      // planta é aproximada e o cadastro é o que a operação usa todo dia.
      const posicoes = letra ? posicoesCadastradas[letra] ?? 0 : 0;
      const comprimento = Math.max(trecho.comprimentoDaFileira, posicoes * PASSO_DA_POSICAO);

      blocos.push({
        id: `${trecho.nome}-fileira-${i + 1}`,
        tipo: 'fileira',
        centro: [x, ALTURA_DA_FILEIRA / 2, zInicioDasFileiras + comprimento / 2],
        tamanho: [PROFUNDIDADE_DA_FILEIRA, ALTURA_DA_FILEIRA, comprimento],
        rotulo: letra ? `RUA ${letra}` : '',
      });
    });
  }

  // Expedição: rente ao chão, no fim do último trecho.
  const ultimo = trechos[trechos.length - 1];
  if (ultimo) {
    const fimDoPredio = ultimo.zInicio + ultimo.comprimento;
    blocos.push({
      id: 'expedicao',
      tipo: 'expedicao',
      centro: [LARGURA_DO_PREDIO / 2, 0.02, fimDoPredio - EXPEDICAO.comprimento / 2],
      tamanho: [EXPEDICAO.largura, 0.04, EXPEDICAO.comprimento],
      rotulo: 'EXPEDIÇÃO',
    });
  }

  return blocos;
}

// ── A estante de verdade ─────────────────────────────────────────────────────────────
//
// Uma fileira NÃO é um bloco maciço. Desenhada como caixa cheia ela vira muro de
// concreto: some o vão onde o palete entra, somem os montantes, some a leitura de
// "quantas posições tem esta rua". O volume fechado também mente sobre ocupação — um
// porta-pallets vazio é quase todo ar.
//
// Aqui a fileira é decomposta nas peças que ela tem no galpão: montantes verticais nas
// divisas de posição e longarinas corridas por nível. As medidas de seção são as mesmas
// que `warehouse3dEstrutura.ts` já usa para as vagas montadas por código, para as duas
// vistas não parecerem dois produtos diferentes.

/** Vão de uma posição de palete ao longo da fileira. */
export const PASSO_DA_POSICAO = 1.2;

/** Níveis de armazenagem por fileira — o mesmo que as ruas A e B têm cadastrado. */
export const NIVEIS_POR_FILEIRA = 3;

/** Seção do montante e altura da longarina, iguais às da estrutura por código. */
const SECAO_MONTANTE = 0.09;
const ALTURA_DA_VIGA = 0.07;

/**
 * Seção da diagonal de contraventamento. Mais fina que o montante, como no galpão: ela
 * trava o quadro, não sustenta carga.
 */
const SECAO_DA_DIAGONAL = 0.04;

export interface PecaDaFileira {
  tipo: 'montante' | 'viga' | 'diagonal';
  /** Centro em metros, no mesmo referencial dos blocos (origem no canto da planta). */
  centro: [number, number, number];
  tamanho: [number, number, number];
  /**
   * Giro em torno de Z, em radianos. Só a diagonal usa — montante e longarina são
   * ortogonais. Ausente significa zero.
   */
  rotacaoZ?: number;
}

/**
 * Montantes e longarinas de uma fileira.
 *
 * O passo real é o comprimento dividido pelo número INTEIRO de posições que cabem, e não
 * 1,2 m fixo: com passo fixo a última posição sobraria para fora da fileira ou deixaria
 * um pedaço órfão no fim. Dividir o comprimento faz os montantes das pontas caírem
 * exatamente nas extremidades.
 */
export function pecasDaFileira(bloco: BlocoFisico): PecaDaFileira[] {
  if (bloco.tipo !== 'fileira') return [];

  const [cx, , cz] = bloco.centro;
  const [profundidade, altura, comprimento] = bloco.tamanho;

  const posicoes = posicoesDaFileira(bloco);
  const passo = comprimento / posicoes;
  const zInicio = cz - comprimento / 2;

  // Montante e longarina ficam nas duas faces da fileira, recuados meia seção para não
  // sobrar metade da peça para fora da profundidade declarada.
  const faces = [
    cx - profundidade / 2 + SECAO_MONTANTE / 2,
    cx + profundidade / 2 - SECAO_MONTANTE / 2,
  ];

  const pecas: PecaDaFileira[] = [];

  // Montantes: um a mais que o número de posições, porque eles ficam nas DIVISAS.
  for (let i = 0; i <= posicoes; i++) {
    const z = zInicio + i * passo;
    for (const x of faces) {
      pecas.push({
        tipo: 'montante',
        centro: [x, altura / 2, z],
        tamanho: [SECAO_MONTANTE, altura, SECAO_MONTANTE],
      });
    }
  }

  // Diagonais de contraventamento: o que faz dois montantes virarem um QUADRO.
  //
  // É o detalhe que distingue porta-pallets de andaime, e por muito tempo faltou aqui:
  // sem a treliça, o par de colunas lê como duas barras soltas ligadas por prateleira.
  // No galpão a diagonal cruza a PROFUNDIDADE — ela trava o quadro no sentido em que o
  // pallet entra, que é para onde a estante tomba.
  //
  // Alternando o sentido a cada nível e a cada divisa sai o zigue-zague da estante real,
  // em vez de um feixe de riscos paralelos.
  const vaoDaDiagonal = profundidade - SECAO_MONTANTE;
  const alturaDoNivelDaDiagonal = altura / NIVEIS_POR_FILEIRA;
  // A subida é um nível MENOS a espessura da própria peça, e isso foi medido, não
  // estimado: inclinada, a caixa ocupa em Y a subida mais a projeção da seção, e com a
  // subida cheia a diagonal do último nível furava 1,2 cm acima do topo da estante.
  const subidaDaDiagonal = alturaDoNivelDaDiagonal - SECAO_DA_DIAGONAL;
  const comprimentoDaDiagonal = Math.hypot(vaoDaDiagonal, subidaDaDiagonal);
  const anguloDaDiagonal = Math.atan2(subidaDaDiagonal, vaoDaDiagonal);

  for (let i = 0; i <= posicoes; i++) {
    const z = zInicio + i * passo;
    for (let n = 1; n <= NIVEIS_POR_FILEIRA; n++) {
      pecas.push({
        tipo: 'diagonal',
        centro: [cx, (n - 1) * alturaDoNivelDaDiagonal + alturaDoNivelDaDiagonal / 2, z],
        // Comprida em X antes do giro: girada em torno de Z, ela se inclina no plano do
        // quadro (X–Y), que é o plano em que os dois montantes vivem.
        tamanho: [comprimentoDaDiagonal, SECAO_DA_DIAGONAL, SECAO_DA_DIAGONAL],
        rotacaoZ: (i + n) % 2 === 0 ? anguloDaDiagonal : -anguloDaDiagonal,
      });
    }
  }

  // Longarinas: corridas pelo comprimento inteiro, uma por nível em cada face.
  //
  // O `- ALTURA_DA_VIGA / 2` não é detalhe: centrada na altura do nível, metade da
  // longarina do último nível sobra PARA FORA da estante (4,235 contra 4,2 de altura).
  // Subtraindo meia altura, o TOPO da peça encosta no nível, que é onde a longarina
  // fica numa estante de verdade — o palete apoia em cima dela.
  const alturaDoNivel = altura / NIVEIS_POR_FILEIRA;
  for (let n = 1; n <= NIVEIS_POR_FILEIRA; n++) {
    const y = n * alturaDoNivel - ALTURA_DA_VIGA / 2;
    for (const x of faces) {
      pecas.push({
        tipo: 'viga',
        centro: [x, y, cz],
        tamanho: [SECAO_MONTANTE, ALTURA_DA_VIGA, comprimento],
      });
    }
  }

  return pecas;
}

/**
 * Quantas posições de palete a fileira comporta, por nível.
 *
 * Arredonda para BAIXO, e isso é o ponto. Arredondando para cima, os 15 m do galpão novo
 * dariam 13 posições — vão de 1,154 m, onde um palete PBR de 1,20 m não entra. O
 * resultado seria uma estante que o desenho promete e a operação não tem. Para baixo dá
 * 12 posições de 1,25 m, que cabem.
 */
export function posicoesDaFileira(bloco: BlocoFisico): number {
  if (bloco.tipo !== 'fileira') return 0;
  return Math.max(1, Math.floor(bloco.tamanho[2] / PASSO_DA_POSICAO));
}

/**
 * Um vão da estante: uma posição de palete, num nível.
 *
 * É o que se clica. Cada vão corresponde a UM endereço — `PP-E03-N2` é a posição 3 da
 * rua E no nível 2 —, então o desenho e o cadastro passam a falar do mesmo objeto, em
 * vez de serem duas descrições paralelas do mesmo galpão.
 */
export interface VaoDaFileira {
  /** Código do endereço, ou null quando a fileira não tem rua cadastrada. */
  codigo: string | null;
  /** 1-based, ao longo do comprimento da fileira. */
  posicao: number;
  /** 1-based, de baixo para cima. */
  nivel: number;
  centro: [number, number, number];
  tamanho: [number, number, number];
}

/** Letra da rua a partir do rótulo ("RUA E" → "E"). */
function letraDaRua(rotulo: string): string | null {
  const m = /^RUA\s+([A-Z]+)$/.exec(rotulo.trim());
  return m ? m[1] : null;
}

/**
 * Os vãos clicáveis de uma fileira.
 *
 * O código é montado no MESMO formato que `buildBinCodes` grava — prefixo, letra,
 * posição com dois dígitos, nível. Montar diferente produziria vão que não acha vaga
 * nenhuma, e o clique cairia no vazio sem erro para explicar.
 */
export function vaosDaFileira(bloco: BlocoFisico, prefixo = 'PP'): VaoDaFileira[] {
  if (bloco.tipo !== 'fileira') return [];

  const [cx, , cz] = bloco.centro;
  const [profundidade, altura, comprimento] = bloco.tamanho;
  const posicoes = posicoesDaFileira(bloco);
  const passo = comprimento / posicoes;
  const zInicio = cz - comprimento / 2;
  const alturaDoNivel = altura / NIVEIS_POR_FILEIRA;
  const letra = letraDaRua(bloco.rotulo);

  const vaos: VaoDaFileira[] = [];
  for (let p = 1; p <= posicoes; p++) {
    for (let n = 1; n <= NIVEIS_POR_FILEIRA; n++) {
      vaos.push({
        codigo: letra ? `${prefixo}-${letra}${String(p).padStart(2, '0')}-N${n}` : null,
        posicao: p,
        nivel: n,
        centro: [
          cx,
          // Base do nível mais meia altura: o nível 1 apoia no piso, não flutua.
          (n - 1) * alturaDoNivel + alturaDoNivel / 2,
          zInicio + (p - 0.5) * passo,
        ],
        // Recuado dos montantes e da longarina, para o vão ler como abertura e o clique
        // não disputar a superfície com a estrutura.
        tamanho: [profundidade * 0.82, alturaDoNivel * 0.74, passo * 0.86],
      });
    }
  }
  return vaos;
}

/**
 * Mesas e bancadas da planta.
 *
 * Separadas das fileiras porque não armazenam endereço: são superfície de trabalho, e
 * tratá-las como estante faria o mapa contar posição que não existe.
 */
export function mesasDaPlanta(trechos: TrechoDaPlanta[] = AZ2027_TERREO): BlocoFisico[] {
  const mesas: BlocoFisico[] = [];
  const TAMPO = { largura: 1.6, altura: 0.9, profundidade: 0.8 } as const;

  // 4 bancadas de embalagem, no fim do prédio atual, perto do portão do galpão.
  const atual = trechos.find(t => t.nome === 'Prédio atual');
  if (atual) {
    const z = atual.zInicio + atual.comprimento - 3.2;
    const vaoEntre = (LARGURA_DO_PREDIO - 4 * TAMPO.largura) / 5;
    for (let i = 0; i < 4; i++) {
      const x = vaoEntre * (i + 1) + TAMPO.largura * (i + 0.5);
      mesas.push({
        id: `bancada-${i + 1}`,
        tipo: 'bancada',
        centro: [x, TAMPO.altura / 2, z],
        tamanho: [TAMPO.largura, TAMPO.altura, TAMPO.profundidade],
        rotulo: i === 0 ? 'EMBALAGEM' : '',
      });
    }
  }

  // 5 baias de pallets prontos, dentro da expedição.
  const ultimo = trechos[trechos.length - 1];
  if (ultimo) {
    const fim = ultimo.zInicio + ultimo.comprimento;
    const z = fim - EXPEDICAO.comprimento + 2.4;
    const vaoEntre = (EXPEDICAO.largura - 5 * 1.2) / 6;
    const borda = (LARGURA_DO_PREDIO - EXPEDICAO.largura) / 2;
    for (let i = 0; i < 5; i++) {
      const x = borda + vaoEntre * (i + 1) + 1.2 * (i + 0.5);
      mesas.push({
        id: `baia-${i + 1}`,
        tipo: 'bancada',
        centro: [x, 0.45, z],
        tamanho: [1.2, 0.9, 1.2],
        rotulo: i === 0 ? 'BAIAS' : '',
      });
    }
  }

  return mesas;
}

/** Comprimento total do conjunto, somando os trechos. */
export function comprimentoTotal(trechos: TrechoDaPlanta[] = AZ2027_TERREO): number {
  return trechos.reduce((soma, t) => Math.max(soma, t.zInicio + t.comprimento), 0);
}
```

#### `src/lib/wms/warehouse3dLotesDaPlanta.ts`  _(187 linhas)_

```ts
// Os vãos da planta agrupados em LOTES prontos para instanciar.
//
// Antes cada vão era um `<mesh>` com geometria e material próprios: 311 malhas e ~1.245
// elementos React para os 215 endereços de hoje. Como cada malha é uma chamada de
// desenho por quadro, 5.000 endereços seriam 5.000 chamadas — e a vista por código, que
// já é instanciada, está DESLIGADA por padrão. A vista padrão era a que não escalava.
//
// ── Por que lotes, e não um objeto só ───────────────────────────────────────────
// Posição, escala e cor cabem na instância: a matriz carrega posição e escala (o passo
// do vão muda por fileira — a rua A tem 13 posições em 15,6 m e a rua E tem 12 em 15 m),
// e `setColorAt` carrega a cor. A OPACIDADE não cabe: `instanceColor` é RGB, e alpha é
// propriedade do material. Como a planta tem três estados de opacidade — fantasma 0,06,
// fora do filtro 0,45, em destaque 1 —, eles viram três lotes em vez de um.
//
// ── O que este módulo NÃO sabe ──────────────────────────────────────────────────
// Tema, WebGL e o significado das cores. Ele recebe a paleta já resolvida e uma função
// que diz a cor da vaga no modo atual. O que é REGRA aqui é a precedência (pulso > busca
// > modo de cor > fundo) e em que lote cada vão cai — e isso se confere sem montar cena.

import { destaqueDaVaga, type ContextoDeDestaque } from './warehouse3dDestaque';
import { vaosDaFileira, type BlocoFisico } from './warehouse3dPlantaFisica';
import type { Slot } from './warehouse3dSlots';
import type { Ponto } from './warehouse3dCoordenadas';

/** Uma instância desenhável: a matriz sai de `centro`+`tamanho`, a cor de `cor`. */
export interface InstanciaDeVao {
  /** Endereço que esta instância representa. `null` = vão sem vaga cadastrada. */
  codigo: string | null;
  centro: Ponto;
  tamanho: Ponto;
  cor: string;
}

/**
 * Os sete lotes.
 *
 * `palete` não leva cor por instância — madeira é madeira em todo o armazém, e pintá-la
 * com a cor de status faria a estrutura disputar significado com a carga em cima dela.
 */
export interface LotesDaPlanta {
  pisoDestaque: InstanciaDeVao[];
  pisoAtenuado: InstanciaDeVao[];
  /** Vão que a planta desenha e o cadastro não tem. Inerte: não recebe clique. */
  pisoFantasma: InstanciaDeVao[];
  cargaDestaque: InstanciaDeVao[];
  cargaAtenuada: InstanciaDeVao[];
  paleteDestaque: InstanciaDeVao[];
  paleteAtenuado: InstanciaDeVao[];
}

export interface PaletaDosLotes {
  /** Vaga mexida por outro operador nos últimos segundos. */
  pulso: string;
  /** Vaga que casou com a busca em curso. */
  busca: string;
  /** Vaga fora do filtro: presente, sem peso visual. */
  atenuada: string;
  /** Vão sem endereço cadastrado. */
  fantasma: string;
}

export interface MedidasDoVao {
  /** Espessura do palete de madeira. */
  alturaDoPalete: number;
  /** Espessura do piso desenhado na vaga livre. */
  alturaDoPiso: number;
}

/** Fração da altura do vão que a carga ocupa acima do palete. */
const FATOR_DA_CARGA = 0.88;
/** Recuo lateral da carga em relação ao vão — ela nunca ocupa a borda exata do palete. */
const RECUO_DA_CARGA = 0.94;

const vazio = (): LotesDaPlanta => ({
  pisoDestaque: [],
  pisoAtenuado: [],
  pisoFantasma: [],
  cargaDestaque: [],
  cargaAtenuada: [],
  paleteDestaque: [],
  paleteAtenuado: [],
});

/**
 * Agrupa os vãos de todas as fileiras nos sete lotes.
 *
 * `corDaVaga` é injetada porque depende de tema, modo de cor, capacidade máxima e Curva
 * ABC — tudo de quem desenha. A PRECEDÊNCIA, que é o que importa conferir, fica aqui.
 *
 * Vão com carga produz DUAS instâncias (palete e carga) e nenhuma de piso: o palete
 * cobre o piso, e desenhar os dois seria geometria escondida custando quadro.
 */
export function lotesDaPlanta(
  blocos: readonly BlocoFisico[],
  vagasPorCodigo: ReadonlyMap<string, Slot>,
  destaque: ContextoDeDestaque,
  paleta: PaletaDosLotes,
  corDaVaga: (slot: Slot) => string,
  medidas: MedidasDoVao,
  prefixo = 'PP',
): LotesDaPlanta {
  const lotes = vazio();

  for (const bloco of blocos) {
    if (bloco.tipo !== 'fileira') continue;

    for (const vao of vaosDaFileira(bloco, prefixo)) {
      const [largura, alturaVao, profundidade] = vao.tamanho;
      const [vx, vy, vz] = vao.centro;
      const base = vy - alturaVao / 2;
      const slot = vao.codigo ? vagasPorCodigo.get(vao.codigo) ?? null : null;

      // Sem endereço: só o piso, fantasma e inerte. O lugar existe no desenho, mas não há
      // vaga para receber nada — e fingir que há é pior do que não desenhar.
      if (!slot) {
        lotes.pisoFantasma.push({
          codigo: null,
          centro: [vx, base + medidas.alturaDoPiso / 2, vz],
          tamanho: [largura, medidas.alturaDoPiso, profundidade],
          cor: paleta.fantasma,
        });
        continue;
      }

      const d = destaqueDaVaga(slot, destaque);
      const cor = d.pulsando
        ? paleta.pulso
        : d.achada
          ? paleta.busca
          : d.ativa
            ? corDaVaga(slot)
            : paleta.atenuada;

      if (slot.caixas > 0) {
        const alturaDaCarga = (alturaVao - medidas.alturaDoPalete) * FATOR_DA_CARGA;
        const palete: InstanciaDeVao = {
          codigo: slot.id,
          centro: [vx, base + medidas.alturaDoPalete / 2, vz],
          tamanho: [largura, medidas.alturaDoPalete, profundidade],
          // A cor do palete é uniforme e vem do material; aqui ela só não é usada.
          cor,
        };
        const carga: InstanciaDeVao = {
          codigo: slot.id,
          centro: [vx, base + medidas.alturaDoPalete + alturaDaCarga / 2, vz],
          tamanho: [largura * RECUO_DA_CARGA, alturaDaCarga, profundidade * RECUO_DA_CARGA],
          cor,
        };
        if (d.ativa) {
          lotes.paleteDestaque.push(palete);
          lotes.cargaDestaque.push(carga);
        } else {
          lotes.paleteAtenuado.push(palete);
          lotes.cargaAtenuada.push(carga);
        }
        continue;
      }

      // Vaga livre: o PISO do vão. Numa estante real a posição vazia é ar, e o bloco
      // cheio escondia justamente a treliça que faz aquilo parecer porta-pallets.
      const piso: InstanciaDeVao = {
        codigo: slot.id,
        centro: [vx, base + medidas.alturaDoPiso / 2, vz],
        tamanho: [largura, medidas.alturaDoPiso, profundidade],
        cor,
      };
      if (d.ativa) lotes.pisoDestaque.push(piso);
      else lotes.pisoAtenuado.push(piso);
    }
  }

  return lotes;
}

/** Quantas instâncias os sete lotes somam — serve para medir e para teste. */
export function totalDeInstancias(lotes: LotesDaPlanta): number {
  return (
    lotes.pisoDestaque.length +
    lotes.pisoAtenuado.length +
    lotes.pisoFantasma.length +
    lotes.cargaDestaque.length +
    lotes.cargaAtenuada.length +
    lotes.paleteDestaque.length +
    lotes.paleteAtenuado.length
  );
}
```


### 4.6 Destaque, rota, radar, curva ABC e colisão

#### `src/lib/wms/warehouse3dDestaque.ts`  _(70 linhas)_

```ts
// Qual é o estado de destaque de uma vaga: dentro do filtro, achada pela busca, recém
// mexida por outro operador.
//
// Existe por um motivo concreto: a regra vivia escrita DENTRO do `useMemo` que monta a
// vista por código, e por isso a vista da planta — que é a padrão da tela — não tinha
// como aplicá-la. O resultado era uma busca que dizia "3 vagas encontradas" e não acendia
// nada na cena.
//
// ── Por que devolve estado, e não cor ───────────────────────────────────────────
// Cor depende de tema, modo de cor, capacidade máxima e Curva ABC — coisas de quem
// desenha. O que é REGRA é quais vagas estão em destaque e quais estão de fundo. Ao
// separar as duas, as duas vistas passam a compartilhar a regra sem compartilhar a
// paleta, e esta parte fica conferível sem WebGL.
//
// ── A precedência não é arbitrária ──────────────────────────────────────────────
// `pulsando` vence tudo: é a informação mais NOVA da tela, e dura dois segundos.
// `achada` vence o modo de cor: achado o produto, a pergunta deixou de ser "como está" e
// passou a ser "onde está". `ativa` é o que decide se a vaga recebe cor plena ou vira
// fundo — o filtro ISOLA, não amputa.

import type { Slot, SlotStatus } from './warehouse3dSlots';

export type FiltroDeStatus = 'todas' | SlotStatus;

export interface ContextoDeDestaque {
  /** Conjunto VAZIO significa todas as ruas. */
  ruasSelecionadas: ReadonlySet<string>;
  filtro: FiltroDeStatus;
  /** `null` = nenhuma busca em curso. Conjunto vazio = busca sem resultado. */
  achados: ReadonlySet<string> | null;
  pulsando: ReadonlySet<string>;
}

export interface DestaqueDaVaga {
  /** Recebe cor plena e participa dos lotes de destaque. */
  ativa: boolean;
  /** Casou com a busca em curso. */
  achada: boolean;
  /** Mexida por outro operador nos últimos segundos. */
  pulsando: boolean;
}

/** Contexto que não destaca nem filtra nada — o estado de abertura da tela. */
export const SEM_DESTAQUE: ContextoDeDestaque = {
  ruasSelecionadas: new Set(),
  filtro: 'todas',
  achados: null,
  pulsando: new Set(),
};

/**
 * Estado de destaque de uma vaga.
 *
 * Os três critérios de `ativa` se SOMAM, em vez de um substituir o outro: buscar um SKU
 * com o filtro em "Bloqueadas" mostra a interseção, não a busca inteira. Foi assim que a
 * vista por código sempre se comportou, e é o comportamento que esta função preserva.
 */
export function destaqueDaVaga(
  slot: Pick<Slot, 'id' | 'ruaCodigo' | 'status'>,
  ctx: ContextoDeDestaque,
): DestaqueDaVaga {
  const achada = ctx.achados !== null && ctx.achados.has(slot.id);
  const ativa =
    (ctx.ruasSelecionadas.size === 0 || ctx.ruasSelecionadas.has(slot.ruaCodigo)) &&
    (ctx.filtro === 'todas' || slot.status === ctx.filtro) &&
    (ctx.achados === null || achada);

  return { ativa, achada, pulsando: ctx.pulsando.has(slot.id) };
}
```

#### `src/lib/wms/warehouse3dRota.ts`  _(184 linhas)_

```ts
// Rota de coleta dentro do pulmão: por onde passar, e em que ordem.
//
// ── O que esta rota NÃO é ───────────────────────────────────────────────────────
//
// Não é rota ÓTIMA, e o código não a chama assim em lugar nenhum. Rota ótima exige
// distância entre pontos, e o pulmão não tem geometria levantada: o endereço
// (`PP-A01-N1`) é uma hierarquia, não uma coordenada. `binSuggestion.ts` já registra
// isso — o código serve de desempate, "nunca como se fosse distância medida".
//
// Não começa numa DOCA nem termina no PICKING. Medido em produção: as 71 vagas são
// todas `bin_type = 'pulmao'`. Não existe doca, não existe área de picking, não existe
// ponto de partida. O armazém digital do Slotting TEM coordenadas e célula de
// expedição, mas é outro mundo: das 900 células, nenhuma casa com código de vaga, e só
// 12 têm código de qualquer tipo. Desenhar uma doca aqui seria inventar um lugar no
// chão de fábrica — e mandar o operador andar até ele.
//
// ── O que ela É ─────────────────────────────────────────────────────────────────
//
// A sequência de endereços de uma lista de coleta, na ordem FIFO que o sistema já
// usa: `searchStock` devolve os saldos do mais antigo para o mais novo, porque essa é
// "a ordem em que o estoque deve ser consumido". A rota não inventa prioridade — ela
// desenha a que já existe.
//
// O traçado entre dois endereços segue os eixos do armazém, não a linha reta: dentro
// da mesma rua anda-se ao longo dos módulos; para trocar de rua, volta-se à CABECEIRA
// do corredor e atravessa-se ali. Linha reta entre ruas atravessaria as estantes.
// Atravessar pela cabeceira é uma SUPOSIÇÃO declarada: não há corredor transversal
// cadastrado, e a cabeceira é o único ponto de travessia que o dado permite afirmar.

import { VAGA, posicaoDaVaga, type Layout3DConfig } from './warehouse3dLayout';
import type { Slot } from './warehouse3dSlots';

export type Ponto3D = [number, number, number];

export interface ParadaDaRota {
  /** 1-based: é o número que aparece na lista e no marcador da cena. */
  ordem: number;
  slot: Slot;
  /** Pé da vaga, no nível do piso — onde o operador se posiciona. */
  noPiso: Ponto3D;
  /** Centro da vaga, na altura real dela. */
  naVaga: Ponto3D;
}

/** Altura do traçado no piso. Acima de zero para não brigar com a grade do chão. */
export const ALTURA_DA_ROTA = 0.2;

/**
 * Converte a lista de endereços em paradas, PRESERVANDO a ordem recebida.
 *
 * Não reordena: a ordem é a regra de negócio (FIFO) que veio de fora. Endereço repetido
 * entra uma vez só — a mesma vaga aparece em duas linhas de saldo quando guarda dois
 * produtos, e mandar o operador até lá duas vezes seria desperdício gerado pela tela.
 * Endereço desconhecido é descartado em vez de virar parada em (0,0,0), que colocaria
 * um ponto da rota num canto do armazém onde não há nada.
 */
export function paradasDaRota(
  codigosEmOrdem: readonly string[],
  slots: readonly Slot[],
  cfg: Layout3DConfig,
  /**
   * De onde sai a posição de cada parada. Omitido, é a grade do código — que era a única
   * geometria quando esta função nasceu.
   *
   * O parâmetro existe porque a MESMA rota precisa ser desenhada na planta física, onde a
   * vaga fica em outro lugar. Devolver `null` descarta a parada, pelo mesmo motivo que
   * endereço desconhecido é descartado: ponto de rota em (0,0,0) põe o operador num canto
   * do armazém onde não há nada.
   */
  posicaoDe: (slot: Slot) => [number, number, number] | null = slot => posicaoDaVaga(slot, cfg),
): ParadaDaRota[] {
  const porId = new Map(slots.map(s => [s.id, s]));
  const vistos = new Set<string>();
  const paradas: ParadaDaRota[] = [];

  for (const codigo of codigosEmOrdem) {
    if (vistos.has(codigo)) continue;
    const slot = porId.get(codigo);
    if (!slot) continue;
    const posicao = posicaoDe(slot);
    if (!posicao) continue;
    vistos.add(codigo);
    const [x, y, z] = posicao;
    paradas.push({
      ordem: paradas.length + 1,
      slot,
      noPiso: [x, ALTURA_DA_ROTA, z],
      naVaga: [x, y, z],
    });
  }

  return paradas;
}

/**
 * Posição da cabeceira do corredor, em Z.
 *
 * O módulo 1 fica em z=0, então a cabeceira é um pouco ANTES dele. É por ali que a
 * rota troca de rua, porque é o único ponto de travessia que o dado permite afirmar.
 */
export function cabeceiraZ(cfg: Layout3DConfig): number {
  return -cfg.moduleWidth * 0.9;
}

/**
 * Traçado no piso, ligando as paradas na ordem.
 *
 * Mesma rua: segmento direto ao longo dos módulos — é andar pelo corredor.
 * Rua diferente: sobe até a cabeceira, atravessa, e desce até o módulo de destino.
 *
 * Menos de duas paradas devolve vazio: uma linha precisa de dois pontos, e devolver um
 * ponto só faria a geometria da `<Line>` quebrar em silêncio.
 */
export function caminhoNoPiso(
  paradas: readonly ParadaDaRota[],
  cfg: Layout3DConfig,
  /**
   * Z da cabeceira. Omitido, é a da grade do código.
   *
   * Na planta física a cabeceira não é `-moduleWidth * 0,9`: as fileiras começam depois
   * do corredor transversal de entrada do trecho, e é ali que se atravessa. Sem este
   * parâmetro a rota desenhada na planta sairia do prédio para trocar de rua.
   */
  zDaCabeceira?: number,
): Ponto3D[] {
  if (paradas.length < 2) return [];

  const z0 = zDaCabeceira ?? cabeceiraZ(cfg);
  const pontos: Ponto3D[] = [paradas[0].noPiso];

  for (let i = 1; i < paradas.length; i += 1) {
    const [xAnterior] = paradas[i - 1].noPiso;
    const [x, y, z] = paradas[i].noPiso;

    if (x !== xAnterior) {
      // Volta à cabeceira da rua atual, atravessa, entra na rua de destino.
      pontos.push([xAnterior, y, z0]);
      pontos.push([x, y, z0]);
    }
    // Trecho final ao longo do corredor. Se a parada já está na cabeceira, o ponto
    // repetido não atrapalha o desenho, mas evitá-lo mantém a geometria enxuta.
    if (pontos[pontos.length - 1][0] !== x || pontos[pontos.length - 1][2] !== z) {
      pontos.push([x, y, z]);
    }
  }

  return pontos;
}

/**
 * Subidas do piso até a vaga, uma por parada.
 *
 * Sem elas a rota diria em que módulo parar, mas não em que ALTURA pegar — que é
 * justamente o que distingue um porta-pallet de um corredor plano. Cada subida é um
 * par de pontos, desenhado como segmento próprio.
 */
export interface SubidaDaRota {
  /** Código da vaga. A subida carrega a identidade em vez de depender do índice: a
   *  lista é FILTRADA, e casar por posição com `paradas` daria a subida errada. */
  id: string;
  de: Ponto3D;
  ate: Ponto3D;
}

export function subidasAteAVaga(paradas: readonly ParadaDaRota[]): SubidaDaRota[] {
  const subidas: SubidaDaRota[] = [];

  for (const p of paradas) {
    const [x, , z] = p.noPiso;
    // Para no PÉ da vaga, não no centro: o traço morre encostando na caixa, em vez de
    // entrar por dentro dela.
    const pe = p.naVaga[1] - VAGA.altura / 2;

    // Vaga da face de piso NÃO tem subida. Medido: no nível 1 o pé fica em y=0, abaixo
    // do próprio traçado (0,2) — desenhar o segmento produziria um toco apontando para
    // BAIXO, atravessando o chão. Não há o que subir quando já se está no chão.
    if (pe <= ALTURA_DA_ROTA) continue;

    subidas.push({ id: p.slot.id, de: [x, ALTURA_DA_ROTA, z], ate: [x, pe, z] });
  }

  return subidas;
}
```

#### `src/lib/wms/warehouse3dRadar.ts`  _(221 linhas)_

```ts
// Planta baixa do armazém: a vista de cima que o radar desenha.
//
// Mora fora do componente pelo mesmo motivo dos outros módulos do mapa: a conversão
// entre o mundo 3D e o SVG é aritmética, e errar nela desloca o cone da câmera em
// relação ao armazém — o radar passaria a apontar para o corredor errado. Isso é
// verificável sem WebGL, e é aqui que se verifica.
//
// ── Os dois sistemas de coordenadas ─────────────────────────────────────────────
// `posicaoDaVaga` devolve coordenada LOCAL: a rua 1 fica em x=0, o módulo 1 em z=0.
// A cena desenha esse grupo deslocado por `deslocamento` para centralizar o armazém na
// origem, então a câmera e o alvo do OrbitControls vivem em coordenada de MUNDO.
//
//   mundo = local + deslocamento        local = mundo - deslocamento
//
// Confundir os dois é o erro silencioso desta feature: o desenho continua bonito e o
// cone aponta para o lugar errado, por exatamente meia largura do armazém.
//
// ── Por que a altura some ───────────────────────────────────────────────────────
// O radar é vista de cima: os níveis de um mesmo (rua, módulo) ocupam o MESMO ponto na
// planta. Uma coluna do radar é a pilha inteira, e o alerta dela é o alerta de qualquer
// nível — senão um problema no nível 3 ficaria invisível justamente no instrumento que
// existe para localizar problemas.

import { posicaoDaVaga, type Layout3DConfig } from './warehouse3dLayout';
import type { Slot } from './warehouse3dSlots';

/** Uma coluna do armazém vista de cima: todos os níveis de um (rua, módulo). */
export interface CelulaRadar {
  rua: number;
  ruaCodigo: string;
  modulo: number;
  /** Coordenada LOCAL, a mesma que `posicaoDaVaga` devolve. */
  x: number;
  z: number;
  /** Qualquer nível desta coluna está acima da capacidade. */
  divergencia: boolean;
  /** Qualquer nível desta coluna é alto giro fora da face de piso. */
  altoGiro: boolean;
  /** Níveis desenhados nesta coluna — usado só para o título acessível. */
  niveis: number;
}

export function celulasDoRadar(
  slots: readonly Slot[],
  layout: Layout3DConfig,
  idsAltoGiro: ReadonlySet<string>,
  /**
   * De onde sai a coordenada local de cada vaga. Omitido, é a grade do código.
   *
   * O radar é a planta de QUEM ESTÁ NA TELA. Com a planta física desenhada ele precisa
   * descrever a planta física, senão o "você está aqui" aponta para uma geometria que não
   * está sendo mostrada. `null` exclui a vaga do radar — ela não tem lugar nesta vista.
   */
  posicaoDe: (slot: Slot) => [number, number, number] | null = slot => posicaoDaVaga(slot, layout),
): CelulaRadar[] {
  const porColuna = new Map<string, CelulaRadar>();

  // DUAS passadas por coluna, e a razão é um defeito que a versão anterior tinha nas duas
  // direções:
  //
  //   mascarava — o primeiro nível decidia se a coluna existia. Sem posição nele, o laço
  //   saía antes de criar a célula e o alerta se perdia; se nenhum nível posterior
  //   resolvesse, a coluna inteira sumia do radar. Um problema no nível 3 ficava invisível
  //   justamente no instrumento que existe para localizar problema.
  //
  //   super-relatava — os níveis seguintes agregavam `divergencia` e `altoGiro` SEM passar
  //   pela resolução de posição. O radar podia acusar alerta de um nível que a vista ativa
  //   não desenha.
  //
  // Agregando só sobre os níveis DESENHÁVEIS, a célula passa a descrever exatamente o que
  // está na tela.
  for (const slot of slots) {
    const posicao = posicaoDe(slot);
    if (!posicao) continue;

    const chave = `${slot.rua}|${slot.modulo}`;
    const existente = porColuna.get(chave);
    if (existente) {
      existente.divergencia = existente.divergencia || slot.status === 'divergence';
      existente.altoGiro = existente.altoGiro || idsAltoGiro.has(slot.id);
      existente.niveis += 1;
      continue;
    }

    const [x, , z] = posicao;
    porColuna.set(chave, {
      rua: slot.rua,
      ruaCodigo: slot.ruaCodigo,
      modulo: slot.modulo,
      x,
      z,
      divergencia: slot.status === 'divergence',
      altoGiro: idsAltoGiro.has(slot.id),
      niveis: 1,
    });
  }

  // Ordem estável: sem ela o React reordenaria os nós do SVG a cada recálculo.
  return [...porColuna.values()].sort((a, b) => a.rua - b.rua || a.modulo - b.modulo);
}

/** Retângulo que o SVG enquadra, em coordenada LOCAL. */
export interface AreaRadar {
  minX: number;
  minZ: number;
  largura: number;
  profundidade: number;
}

/**
 * Área desenhada pelo radar.
 *
 * A margem não é estética: a câmera orbita FORA do armazém, e sem folga no
 * enquadramento o marcador dela viveria permanentemente encostado na borda, sem indicar
 * de que lado se está olhando. A margem é proporcional ao armazém, não fixa — num
 * pulmão de 13 módulos uma folga fixa de poucos metros desapareceria.
 */
export function areaDoRadar(celulas: readonly CelulaRadar[], fatorMargem = 0.45): AreaRadar {
  if (celulas.length === 0) return { minX: -1, minZ: -1, largura: 2, profundidade: 2 };

  const xs = celulas.map(c => c.x);
  const zs = celulas.map(c => c.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  // Uma rua só, ou um módulo só, dá extensão zero num dos eixos. Sem o piso de 1 a
  // margem seria zero e o viewBox degeneraria numa linha.
  const margem = Math.max(1, Math.max(maxX - minX, maxZ - minZ) * fatorMargem);

  return {
    minX: minX - margem,
    minZ: minZ - margem,
    largura: maxX - minX + margem * 2,
    profundidade: maxZ - minZ + margem * 2,
  };
}

/**
 * Converte um ponto do MUNDO para a coordenada LOCAL que o radar desenha.
 *
 * É a inversa exata do deslocamento que a cena aplica ao grupo. Sem ela, o cone da
 * câmera apareceria afastado do armazém por metade da largura dele.
 */
export function mundoParaLocal(
  x: number,
  z: number,
  deslocamento: readonly [number, number, number],
): [number, number] {
  return [x - deslocamento[0], z - deslocamento[2]];
}

/** Converte um ponto do radar de volta para o MUNDO, para mirar a câmera. */
export function localParaMundo(
  x: number,
  z: number,
  deslocamento: readonly [number, number, number],
): [number, number] {
  return [x + deslocamento[0], z + deslocamento[2]];
}

/**
 * Prende um ponto dentro da área desenhada.
 *
 * A câmera pode ser afastada muito além da folga do enquadramento. Deixar o marcador
 * sair do quadro seria perder justamente a informação que ele carrega — melhor ele
 * encostar na borda, indicando a direção, do que desaparecer.
 */
export function prenderNaArea(x: number, z: number, area: AreaRadar): [number, number] {
  return [
    Math.min(Math.max(x, area.minX), area.minX + area.largura),
    Math.min(Math.max(z, area.minZ), area.minZ + area.profundidade),
  ];
}

/**
 * Direção do olhar, em GRAUS, para girar o cone no SVG.
 *
 * O SVG mapeia o Z do mundo no Y da tela (vista de cima, Z crescendo para baixo), então
 * `atan2(dz, dx)` já é o ângulo correto na tela, sem inversão de sinal. O cone é
 * desenhado apontando para +X, e esta rotação o alinha com o alvo.
 *
 * Câmera exatamente sobre o alvo não tem direção definida; devolve 0 em vez de NaN, que
 * apagaria o cone da tela sem nenhum aviso.
 */
export function grausDeVisao(camX: number, camZ: number, alvoX: number, alvoZ: number): number {
  const dx = alvoX - camX;
  const dz = alvoZ - camZ;
  if (dx === 0 && dz === 0) return 0;
  return (Math.atan2(dz, dx) * 180) / Math.PI;
}

/**
 * Meia-abertura HORIZONTAL da câmera, em radianos.
 *
 * O three aplica `fov` na VERTICAL. Usar esse valor direto desenharia um cone estreito
 * demais numa tela larga — e o radar estaria mentindo sobre o que cabe no quadro, que é
 * a única coisa que ele promete mostrar. A conversão é a mesma que o enquadramento
 * responsivo da cena já faz, na direção inversa.
 */
export function meiaAberturaHorizontal(fovVerticalGraus: number, aspecto: number): number {
  const meioVertical = (fovVerticalGraus * Math.PI) / 180 / 2;
  return Math.atan(Math.tan(meioVertical) * aspecto);
}

/**
 * Caminho SVG do cone de visão, com o vértice na origem e apontando para +X.
 *
 * Fica aberto no fim de propósito: o campo de visão não termina — o que termina é o
 * desenho. Fechar o arco sugeriria um limite de alcance que a câmera não tem.
 */
export function caminhoDoCone(meiaAbertura: number, alcance: number): string {
  // Acima de ~85° o cone viraria um semiplano e cobriria o radar inteiro, escondendo o
  // armazém que ele deveria situar. Nesse ponto ele deixa de informar.
  const meia = Math.min(meiaAbertura, (85 * Math.PI) / 180);
  const x = Math.cos(meia) * alcance;
  const y = Math.sin(meia) * alcance;
  return `M 0 0 L ${x.toFixed(3)} ${(-y).toFixed(3)} L ${x.toFixed(3)} ${y.toFixed(3)} Z`;
}
```

#### `src/lib/wms/warehouse3dAbc.ts`  _(157 linhas)_

```ts
// Cruza endereço do Pulmão com a classificação de GIRO da Curva ABC já publicada.
//
// Mora aqui, fora do componente, pelo mesmo motivo dos outros dois módulos do mapa: a
// regra de qual classe colore a vaga é verificável sem WebGL. Dentro do `<Canvas>` ela
// só poderia ser conferida por screenshot.
//
// NADA de schema novo. Consome duas coisas que já existem: a view de saldo do WMS
// (`skusByBin`) e a análise publicada da Curva ABC (`listAnalyses` + classe de giro por
// SKU). Nenhuma migration, nenhuma coluna nova, nenhum vínculo inventado.
//
// ── Por que GIRO, e não faturamento nem lucro ───────────────────────────────────
// A análise classifica cada SKU por três métricas. Só o giro — quantidade movimentada —
// tem relação com o custo de ir buscar a mercadoria no alto do porta-pallet. Faturamento
// e lucro respondem perguntas comerciais; colorir o armazém por eles sugeriria que a
// posição física deveria seguir margem, que não é a regra de nenhum WMS.
//
// ── O que o cruzamento NÃO garante ──────────────────────────────────────────────
// A classificação vem de uma análise com PERÍODO FECHADO (a vigente foi publicada sobre
// agosto/2026). Ela não é recalculada quando o estoque se move. Por isso a tela nomeia a
// análise que está colorindo: "curva A" aqui significa "era A naquele período", e quem
// olha precisa poder ver qual período é esse.
//
// Medido em produção: dos 6 saldos do pulmão, 3 casam com a análise vigente (2 de classe
// A, 1 de classe B) e 3 são de SKU que a análise não viu. Esses 3 ficam SEM COR de curva
// em vez de virarem 'C' — não ter sido classificado e ter girado pouco são coisas
// diferentes.

import { listAnalyses, turnoverClassBySku } from '../abcCurve/abcCurveService';
import { skusByBin } from './wmsService';
import type { Slot } from './warehouse3dSlots';

export type AbcClasse = 'A' | 'B' | 'C';

/** Prioridade de leitura: A domina B, que domina C. Não é alfabética por acaso — é a
 *  ordem de custo operacional, e é o que decide a cor de endereço misturado. */
const PRIORIDADE: Record<AbcClasse, number> = { A: 3, B: 2, C: 1 };

export interface ItemDaVaga {
  sku: string;
  /** `null` = o SKU não está na análise vigente. */
  classe: AbcClasse | null;
  caixas: number;
}

export interface AbcDaVaga {
  /**
   * Classe que COLORE a vaga: a mais alta presente nela.
   *
   * Endereço misturado é real — `PP-A01-N1` guarda dois SKUs hoje. A vaga não "é" uma
   * classe, ela contém um conjunto. Pintar pela mais alta é a escolha que serve à
   * operação: o que custa caro é um item de alto giro mal posicionado, e ele não deixa
   * de custar porque divide a vaga com um item parado. Pintar pela média esconderia
   * exatamente o caso que a tela existe para achar.
   */
  classe: AbcClasse;
  /** Tudo que está na vaga, inclusive o que não tem classe. A tela de detalhe mostra a
   *  lista inteira para que a cor nunca seja a única informação. */
  itens: ItemDaVaga[];
}

export interface AbcDoArmazem {
  porVaga: ReadonlyMap<string, AbcDaVaga>;
  /** Identificação da análise que classificou. `null` = não há análise publicada. */
  analise: { id: string; nome: string; periodoFim: string } | null;
  /** Quantos saldos têm SKU fora da análise vigente. */
  semClasse: number;
}

export const ABC_VAZIO: AbcDoArmazem = { porVaga: new Map(), analise: null, semClasse: 0 };

/**
 * Agrupa saldo por endereço e resolve a classe que colore cada vaga.
 *
 * Puro: recebe o saldo e o mapa de classes, devolve o que desenhar. Sem rede, sem
 * Supabase, sem WebGL — é esta função que os testes exercitam.
 */
export function abcPorVaga(
  saldoPorVaga: ReadonlyMap<string, readonly { sku: string; boxes: number }[]>,
  classePorSku: ReadonlyMap<string, AbcClasse>,
): { porVaga: Map<string, AbcDaVaga>; semClasse: number } {
  const porVaga = new Map<string, AbcDaVaga>();
  let semClasse = 0;

  for (const [binCode, linhas] of saldoPorVaga) {
    const itens: ItemDaVaga[] = [];
    let melhor: AbcClasse | null = null;

    for (const linha of linhas) {
      const classe = classePorSku.get(linha.sku) ?? null;
      if (classe === null) semClasse += 1;
      else if (melhor === null || PRIORIDADE[classe] > PRIORIDADE[melhor]) melhor = classe;
      itens.push({ sku: linha.sku, classe, caixas: linha.boxes });
    }

    // Vaga só com SKU não classificado fica FORA do mapa: a cena a desenha atenuada,
    // que é o que "não sei a curva disto" deve parecer. Entrar como 'C' seria afirmar
    // baixo giro sem ter medido.
    if (melhor !== null) porVaga.set(binCode, { classe: melhor, itens });
  }

  return { porVaga, semClasse };
}

/**
 * Primeiro nível que exige elevar o garfo.
 *
 * A especificação pedia `nivel >= 4`. Neste armazém o nível mais alto é 3 — o alerta
 * nunca dispararia, e a tela mostraria "0 itens em nível alto" para sempre, parecendo
 * que está tudo certo quando na verdade a régua é que não cabe aqui.
 *
 * A régua real não é um número absoluto: é se a empilhadeira precisa subir. O nível 1 é
 * a face de piso, alcançável sem elevar. Do 2 em diante há ciclo de elevação, que é
 * exatamente o desperdício que a regra quer apontar.
 */
export const NIVEL_DE_PISO = 1;

/**
 * Itens de alto giro guardados fora da face de piso.
 *
 * Só classe A. Estender a B dobraria a lista e diluiria o sinal: o ganho de remanejar um
 * item de giro médio raramente paga a movimentação, e um alerta que aponta demais é
 * ignorado tão rápido quanto um que nunca aponta.
 */
export function alertasDeGiro(
  slots: readonly Slot[],
  porVaga: ReadonlyMap<string, AbcDaVaga>,
): Slot[] {
  return slots.filter(slot => slot.nivel > NIVEL_DE_PISO && porVaga.get(slot.id)?.classe === 'A');
}

/**
 * Carrega a classificação de giro de todo o pulmão.
 *
 * Sem empresa ou sem análise publicada, devolve vazio em vez de falhar: a Curva ABC é um
 * módulo opcional, e o mapa 3D não pode deixar de abrir porque ninguém publicou análise.
 * Quem chama distingue os dois casos por `analise === null`.
 */
export async function loadAbcDoArmazem(companyId: string): Promise<AbcDoArmazem> {
  if (!companyId) return ABC_VAZIO;

  // `listAnalyses` já filtra por publicada e ordena da mais recente para a mais antiga.
  const analises = await listAnalyses(companyId);
  const vigente = analises[0];
  if (!vigente) return ABC_VAZIO;

  const saldoPorVaga = await skusByBin();
  const skus = [...new Set([...saldoPorVaga.values()].flat().map(l => l.sku))];
  const classePorSku = await turnoverClassBySku(companyId, vigente.id, skus);

  const { porVaga, semClasse } = abcPorVaga(saldoPorVaga, classePorSku);
  return {
    porVaga,
    analise: { id: vigente.id, nome: vigente.name, periodoFim: vigente.salesPeriodEnd },
    semClasse,
  };
}
```

#### `src/lib/wms/warehouse3dColisao.ts`  _(229 linhas)_

```ts
// Onde o caminhante pode pisar: a cerca do prédio e as caixas que barram passagem.
//
// Até aqui a caminhada tinha uma cerca só — `±extensao`, que com o galpão atual dá
// ±45,2 m nos dois eixos. O prédio mede 10,3 × 45,2, ou seja X de −5,15 a 5,15: dava
// para andar 8,8 vezes a meia-largura do galpão para fora dele. E colisão não existia:
// a câmera atravessava fileira, palete e mesa.
//
// As paredes que aparecem na cena NÃO são o prédio — `WarehouseEnvironment` desenha um
// caixote de `extensao × 1,9` (meio-lado 42,94 m) como cenário. Bater nelas seria bater
// em decoração. A cerca de verdade vem das medidas da planta.
//
// ── Por que resolver eixo a eixo ────────────────────────────────────────────────
// Travar X e Z juntos faz a pessoa GRUDAR na estante ao encostar de lado: o movimento
// inteiro é recusado porque uma das componentes bateu. Testando um eixo de cada vez, a
// componente que não bateu passa — e andar colado na fileira vira deslizar, que é o que
// o corpo faz no corredor de verdade.
//
// ── Por que caixa plana, e não a geometria ──────────────────────────────────────
// Uma fileira inteira é UMA caixa em X/Z. Com 9 fileiras e 9 mesas são 18 testes por
// quadro, contra 303 vãos se a colisão fosse por vaga. O vão não precisa ser testado: ele
// está dentro da fileira que já barra.

/** Retângulo no plano do piso. Y não entra: a caminhada é na altura dos olhos, sempre. */
export interface CaixaPlana {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** O mínimo de um bloco da planta para virar caixa. */
interface BlocoComCaixa {
  tipo: string;
  centro: [number, number, number];
  tamanho: [number, number, number];
}

export type Offset = readonly [number, number, number];

/** Caixa de um bloco, já em coordenada de MUNDO. */
export function caixaDoBloco(bloco: BlocoComCaixa, offset: Offset): CaixaPlana {
  const [cx, , cz] = bloco.centro;
  const [largura, , comprimento] = bloco.tamanho;
  return {
    x0: cx - largura / 2 + offset[0],
    x1: cx + largura / 2 + offset[0],
    z0: cz - comprimento / 2 + offset[2],
    z1: cz + comprimento / 2 + offset[2],
  };
}

/**
 * As caixas que barram passagem na planta física.
 *
 * `expedicao` fica de FORA de propósito: é tinta no chão, com 4 cm de altura. Barrar ali
 * trancaria a pessoa fora justamente da área de carga, que é onde ela mais precisa andar.
 */
export function caixasDaPlanta(
  blocos: readonly BlocoComCaixa[],
  mesas: readonly BlocoComCaixa[],
  offset: Offset,
): CaixaPlana[] {
  const caixas: CaixaPlana[] = [];
  for (const b of blocos) {
    if (b.tipo !== 'fileira') continue;
    caixas.push(caixaDoBloco(b, offset));
  }
  for (const m of mesas) caixas.push(caixaDoBloco(m, offset));
  return caixas;
}

/**
 * A cerca: o contorno interno do prédio, em coordenada de mundo.
 *
 * `margem` encolhe o retângulo — útil para a pessoa não encostar o nariz na parede.
 */
export function cercaDaPlanta(
  largura: number,
  comprimento: number,
  offset: Offset,
  margem = 0,
): CaixaPlana {
  return {
    x0: offset[0] + margem,
    x1: offset[0] + largura - margem,
    z0: offset[2] + margem,
    z1: offset[2] + comprimento - margem,
  };
}

/** Cerca a partir de um retângulo já conhecido (usada pela vista por código). */
export function cercaDeContorno(
  larguraTotal: number,
  profundidadeTotal: number,
  offset: Offset,
  folga: number,
): CaixaPlana {
  return {
    x0: offset[0] - folga,
    x1: offset[0] + larguraTotal + folga,
    z0: offset[2] - folga,
    z1: offset[2] + profundidadeTotal + folga,
  };
}

/** O ponto invade a caixa, contando o raio do caminhante. */
export function bate(x: number, z: number, caixa: CaixaPlana, raio: number): boolean {
  return (
    x > caixa.x0 - raio && x < caixa.x1 + raio && z > caixa.z0 - raio && z < caixa.z1 + raio
  );
}

const bateEmAlguma = (x: number, z: number, caixas: readonly CaixaPlana[], raio: number): boolean => {
  for (const c of caixas) if (bate(x, z, c, raio)) return true;
  return false;
};

/** Prende o ponto dentro da cerca, descontando o raio. */
export function naCerca(x: number, z: number, cerca: CaixaPlana, raio: number): [number, number] {
  return [
    Math.min(Math.max(x, cerca.x0 + raio), cerca.x1 - raio),
    Math.min(Math.max(z, cerca.z0 + raio), cerca.z1 - raio),
  ];
}

/**
 * Resolve o movimento de `de` para `para`, escorregando no que bater.
 *
 * Cada eixo é testado sozinho e a partir da posição ANTERIOR, nunca da candidata do
 * outro eixo — testar em cadeia deixaria passar o movimento diagonal que corta a quina
 * de uma caixa.
 *
 * Quando a origem já está dentro de uma caixa (estante recém-construída em cima da
 * pessoa, ou entrada mal escolhida), o movimento é LIBERADO em vez de recusado: prender
 * alguém dentro da geometria é pior do que deixá-la sair andando.
 */
export function deslizar(
  de: readonly [number, number],
  para: readonly [number, number],
  caixas: readonly CaixaPlana[],
  cerca: CaixaPlana,
  raio: number,
): [number, number] {
  const [x0, z0] = naCerca(de[0], de[1], cerca, raio);
  const [xAlvo, zAlvo] = naCerca(para[0], para[1], cerca, raio);

  if (bateEmAlguma(x0, z0, caixas, raio)) return [xAlvo, zAlvo];

  const x = bateEmAlguma(xAlvo, z0, caixas, raio) ? x0 : xAlvo;
  const z = bateEmAlguma(x0, zAlvo, caixas, raio) ? z0 : zAlvo;

  // A diagonal pode cair numa quina que nenhum dos dois eixos sozinho acusou.
  if (x !== x0 && z !== z0 && bateEmAlguma(x, z, caixas, raio)) return [x, z0];

  return [x, z];
}

/** Passo da varredura do ponto de entrada, em metros. */
const PASSO_DA_VARREDURA = 0.5;

/**
 * Folga mínima em volta do ponto de entrada, em metros.
 *
 * Não basta o ponto estar livre: medido na planta real, o centro da área de expedição está
 * livre e fica a 0,5 m de uma baia de pallets — a pessoa entrava e travava no primeiro
 * passo. Exigindo quase um metro de folga, a entrada cai em corredor ou em piso aberto, de
 * onde dá para andar.
 */
const FOLGA_DA_ENTRADA = 0.9;

/** Distância do ponto até a caixa (0 se estiver dentro dela). */
function distanciaAteACaixa(x: number, z: number, c: CaixaPlana): number {
  const dx = Math.max(c.x0 - x, 0, x - c.x1);
  const dz = Math.max(c.z0 - z, 0, z - c.z1);
  return Math.hypot(dx, dz);
}

/** Folga até o obstáculo mais próximo. `Infinity` quando não há obstáculo nenhum. */
export function folgaNoPonto(x: number, z: number, caixas: readonly CaixaPlana[]): number {
  let menor = Infinity;
  for (const c of caixas) menor = Math.min(menor, distanciaAteACaixa(x, z, c));
  return menor;
}

/**
 * Um ponto livre para começar a caminhada, o mais perto possível do preferido.
 *
 * Existe porque a entrada antes era fixa em `(0; z)`, e com colisão um ponto dentro de
 * geometria prende a pessoa no lugar: ela aperta W e nada acontece, sem nada na tela
 * explicando. A varredura roda UMA vez, na montagem.
 *
 * Sem ponto livre devolve o preferido preso à cerca — melhor começar dentro de uma
 * estante e poder sair do que não entrar no modo.
 */
export function pontoDeEntrada(
  preferido: readonly [number, number],
  caixas: readonly CaixaPlana[],
  cerca: CaixaPlana,
  raio: number,
): [number, number] {
  const [px, pz] = naCerca(preferido[0], preferido[1], cerca, raio);
  if (folgaNoPonto(px, pz, caixas) >= FOLGA_DA_ENTRADA) return [px, pz];

  // Duas candidatas, porque "livre" e "dá para andar daqui" não são a mesma coisa: a
  // folgada é a preferida; a só-livre é a rede de segurança para um galpão tão cheio que
  // não sobre um metro em lugar nenhum.
  let folgada: [number, number] | null = null;
  let distanciaDaFolgada = Infinity;
  let livre: [number, number] | null = null;
  let distanciaDaLivre = Infinity;

  for (let x = cerca.x0 + raio; x <= cerca.x1 - raio; x += PASSO_DA_VARREDURA) {
    for (let z = cerca.z0 + raio; z <= cerca.z1 - raio; z += PASSO_DA_VARREDURA) {
      if (bateEmAlguma(x, z, caixas, raio)) continue;
      const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d < distanciaDaLivre) {
        distanciaDaLivre = d;
        livre = [x, z];
      }
      if (folgaNoPonto(x, z, caixas) >= FOLGA_DA_ENTRADA && d < distanciaDaFolgada) {
        distanciaDaFolgada = d;
        folgada = [x, z];
      }
    }
  }

  return folgada ?? livre ?? [px, pz];
}
```


### 4.7 Orquestrador do visualizador

#### `src/components/wms/Warehouse3DViewer.tsx`  _(1702 linhas)_

```tsx
// Pulmão -> Visualização 3D.
//
// Por que 3D, se o `WmsStorageMap` 2D já existe: o mapa 2D responde bem "quanto desta
// rua está cheio", porque achata uma rua de cada vez. O que ele não mostra é a relação
// entre ruas — altura ocupada, corredores vazios inteiros, alerta concentrado num
// nível. Essa é a pergunta que justifica a terceira dimensão; se não fosse, a tabela
// bastava.
//
// A regra de status NÃO mora aqui: ela está em `lib/wms/warehouse3dSlots.ts`, onde é
// testável sem WebGL. Dentro do `<Canvas>` só se poderia prová-la por screenshot, que
// é a forma mais fraca de mostrar que uma cor significa o que diz.
//
// ── Desenho em lote ─────────────────────────────────────────────────────────────
// As vagas são desenhadas com `<Instances>`: DOIS objetos de GPU no total, não um por
// vaga. Com um `<mesh>` por vaga, 5.000 endereços seriam 5.000 draw calls e a placa
// engasgaria muito antes disso. Aqui o custo de GPU é praticamente o mesmo para 71 ou
// para 5.000 — o que cresce é o lado React, não o desenho.
//
// Este arquivo ainda não é importado por nenhuma tela — plugá-lo numa rota é passo
// separado e deliberado.

import {
  Component, useCallback, useEffect, useMemo, useRef, useState,
  type ElementRef, type ReactNode,
} from 'react';
import { PerspectiveCamera, Vector3 } from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PointerLockControls } from '@react-three/drei';
// Só os pesos e o subconjunto que esta tela usa. O pacote inteiro tem 2,4 MB (todos os
// alfabetos e pesos); estes três arquivos somam 72 kB. E ficam no CHUNK DO MAPA 3D, que
// é carregado sob demanda — quem nunca abre a seção não baixa fonte nenhuma.
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import { BrandLoader, Button, Notice } from '../ui';
import { useTheme } from '../../lib/useTheme';
import {
  aplicarSaldo, loadWarehouseSlots,
  type Slot, type SlotStatus, type WarehouseSlots,
} from '../../lib/wms/warehouse3dSlots';
import { assinarMudancasDoPulmao } from '../../lib/wms/warehouse3dRealtime';
import {
  VAGA, baseDaRua, carregarLayout, posicaoDaVaga, salvarLayout, type Layout3DConfig,
} from '../../lib/wms/warehouse3dLayout';
import { boxesForBin, searchStock } from '../../lib/wms/wmsService';
import { listarPecas, salvarPecas } from '../../lib/wms/builderObjects';
// A ponte com o Slotting: a planta do armazém é UMA só, e quem a edita é o configurador
// 2D. O 3D lê a publicada em vez de manter uma segunda verdade sobre o mesmo galpão.
import { getPublishedLayout, getFloorPlanSignedUrl } from '../../lib/slottingLayoutService';
// A planta como geometria: as fileiras vêm das medidas, não do código da vaga.
import {
  AZ2027_TERREO, blocosDaPlanta, comprimentoTotal, LARGURA_DO_PREDIO, mesasDaPlanta,
} from '../../lib/wms/warehouse3dPlantaFisica';
// As medidas da planta vêm do banco; a constante acima fica como retrato e como fallback.
import {
  ROTULOS_PADRAO, carregarPlantaFisica, listarPavimentos, type PlantaFisicaCarregada,
} from '../../lib/wms/planoFisicoService';
// Onde a vaga está, conforme a vista ativa. As duas geometrias não se convertem por
// offset — ver o cabeçalho do módulo.
import {
  cabeceiraDaPlanta, emMundo, indiceDosVaos, offsetDaPlanta, recuoDeFoco,
  type Ponto, type ResolvedorLocal,
} from '../../lib/wms/warehouse3dCoordenadas';
// A regra de destaque, compartilhada pelas duas vistas.
import { destaqueDaVaga, type ContextoDeDestaque } from '../../lib/wms/warehouse3dDestaque';
// Cerca do prédio e colisão da caminhada. As paredes da cena são cenário, não o galpão.
import {
  caixasDaPlanta, cercaDaPlanta, cercaDeContorno, type CaixaPlana,
} from '../../lib/wms/warehouse3dColisao';
import {
  ABC_VAZIO, alertasDeGiro, loadAbcDoArmazem,
  type AbcClasse, type AbcDoArmazem,
} from '../../lib/wms/warehouse3dAbc';
import {
  areaDoRadar, caminhoDoCone, celulasDoRadar, localParaMundo, mundoParaLocal, prenderNaArea,
} from '../../lib/wms/warehouse3dRadar';
import {
  caminhoNoPiso, paradasDaRota, subidasAteAVaga, type ParadaDaRota,
} from '../../lib/wms/warehouse3dRota';
import {
  ALTURA_DA_TARJA, anguloDaCamera, desenharLegenda, legendaDaAuditoria, nomeDoArquivo,
} from '../../lib/wms/warehouse3dSnapshot';
import {
  diagonaisDoArmazem, montantesDoArmazem, vigasDoArmazem,
} from '../../lib/wms/warehouse3dEstrutura';
import { type FundoDaCena } from './WarehouseEnvironment';
// ── O módulo fatiado ─────────────────────────────────────────────────────────────
// Cor, catálogo e medidas em `aparencia`; objetos de GPU em `recursos3d`; tudo que vive
// dentro do `<Canvas>` em `Cena3D`. Este arquivo ficou com estado, carregamento e HUD.
import {
  ANDAR_INICIAL, CORES_DE_ESTANTE, COR_ATENUADA, COR_BUSCA, COR_PULSO, DURACAO_PULSO,
  LARGURA_ESTREITA,
  MARGEM_DA_CERCA,
  corDaVaga,
  type FerramentaBuilder, type FiltroStatus, type ModoCor, type ModoVisor,
  type ObjetoConstruido, type TipoConstruido, type TipoDeEstante,
} from './viewer3d/aparencia';
import { type VagaDesenhavel } from './viewer3d/recursos3d';
import { esquecerConteudoDaVaga } from './viewer3d/cacheDeConteudo';
import { Hud3D } from './viewer3d/Hud3D';
import { PainelDetalhe } from './viewer3d/PainelDetalhe';
import { Radar } from './viewer3d/Radar3D';
import {
  Caminhada, CapturadorDeCena, Cena, PanSuave, SondaDeCamera,
  type CanalDeHover, type DestinoDeCamera, type PlacaDeRua, type PlantaNoPiso,
  type RotaDesenhavel,
} from './viewer3d/Cena3D';

export type { Slot, SlotStatus } from '../../lib/wms/warehouse3dSlots';

// ── Geometria ──────────────────────────────────────────────────────────────────
//
// As medidas e a conversão endereço -> posição moram em `lib/wms/warehouse3dLayout`,
// onde são aritmética conferível sem WebGL. Aqui só se desenha.
//
// Uma vaga é 1,2 x 1,4 x 1,2 METROS — palete PBR carregado, não um cubo arbitrário.
// Cubo perfeito faria o armazém parecer uma estante de cubos, que é a leitura errada.

// ── Cor ────────────────────────────────────────────────────────────────────────
//
// Aqui o hex é inevitável: material de WebGL não lê variável CSS. Então o arquivo
// mantém o seu próprio mapa — um único ponto de verdade, como um token — em vez de
// espalhar literais pelo JSX.
//
// `occupied` é PAPELÃO, não a navy da marca — e a troca foi deliberada quando a vaga
// deixou de ser um cubo e passou a ser pallet com caixas.
//
// "Ocupada" é o estado da maioria esmagadora das vagas de um armazém saudável. Pintar
// a maioria com uma cor forte gasta o recurso mais escasso da cena — a atenção — no
// caso que não pede nenhuma, e é exatamente o que a Design Constitution proíbe: estado
// default se desenha neutro. Com o papelão como base, o âmbar da divergência e o
// vermelho do giro passaram a ser as ÚNICAS cores saturadas da estante, e saltam.
//
// O tom é pardo dessaturado, não o `#D97706` sugerido: aquele é âmbar, vizinho do
// `#F59E0B` que significa "acima da capacidade" nesta mesma cena. Carga parecida com
// alerta é como apagar o alerta.
//
// A navy da marca não sumiu — ela continua sendo a escala do modo Ocupação, onde
// significa QUANTIDADE e não estado.
// numa das ruas.
const DIRECAO_CAMERA: [number, number, number] = [7.5, 6.5, 9.5];

/** Multiplicador sobre a diagonal do armazém. 1,5 dá a folga da vista de referência. */
const FOLGA_CAMERA = 1.5;

/**
 * Distância da câmera suficiente para o armazém inteiro caber no quadro.
 *
 * Usa a DIAGONAL da caixa que contém tudo, não só a maior aresta: um armazém longo e
 * estreito e um quadrado de mesma largura precisam de recuos diferentes, e a diagonal
 * é o que distingue os dois.
 */
export function enquadrarCamera(slots: readonly Slot[], cfg: Layout3DConfig): [number, number, number] {
  const magnitude = Math.hypot(...DIRECAO_CAMERA);
  if (slots.length === 0) return DIRECAO_CAMERA;

  const largura = (Math.max(...slots.map(s => s.rua)) - 1) * cfg.rowSpacing + VAGA.largura;
  const profundidade = (Math.max(...slots.map(s => s.modulo)) - 1) * cfg.moduleWidth + VAGA.profundidade;
  // A altura inclui a elevação da estrutura: com o pulmão suspenso a 3 m, a câmera
  // precisa recuar mais, senão o armazém sobe para fora do quadro.
  const topo = Math.max(...slots.map(s => baseDaRua(s.ruaCodigo, cfg) + s.nivel * cfg.levelHeight));

  const distancia = Math.max(Math.hypot(largura, profundidade, topo) * FOLGA_CAMERA, 6);
  const escala = distancia / magnitude;
  return [DIRECAO_CAMERA[0] * escala, DIRECAO_CAMERA[1] * escala, DIRECAO_CAMERA[2] * escala];
}

const FOV_BASE = 45;
const ASPECTO_BASE = 16 / 9;

/**
 * Trava o campo de visão HORIZONTAL em vez do vertical.
 *
 * O three aplica `fov` na vertical, então numa div estreita (celular em pé) o mesmo
 * fov cobre bem menos largura e o armazém sai cortado pelas laterais. Aqui o fov
 * vertical cresce à medida que o aspecto encolhe, de modo que a largura enquadrada
 * permanece a mesma em qualquer formato.
 *
 * Teto de 95°: além disso a perspectiva distorce tanto que as ruas do fundo viram um
 * borrão, e o remédio passa a ser pior que a doença.
 */
function EnquadramentoResponsivo() {
  const camera = useThree(estado => estado.camera);
  const largura = useThree(estado => estado.size.width);
  const altura = useThree(estado => estado.size.height);

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || altura === 0) return;
    const aspecto = largura / altura;
    const fov =
      aspecto >= ASPECTO_BASE
        ? FOV_BASE
        : (2 * Math.atan(Math.tan((FOV_BASE * Math.PI) / 360) * (ASPECTO_BASE / aspecto)) * 180) / Math.PI;
    camera.fov = Math.min(fov, 95);
    camera.updateProjectionMatrix();
  }, [camera, largura, altura]);

  return null;
}

// ── Proteção contra falha ──────────────────────────────────────────────────────
//
// WebGL falha de formas que um `try/catch` não alcança: driver bloqueado, contexto
// recusado, máquina sem GPU. Sem esta fronteira, qualquer uma dessas derruba a árvore
// React INTEIRA — ou seja, a tela do WMS junto. O armazém some; o resto fica de pé.
//
// Precisa ser classe: React só oferece `componentDidCatch` nessa forma.
interface FronteiraState {
  falhou: boolean;
}

class FronteiraDeErro extends Component<{ children: ReactNode; aoFalhar: ReactNode }, FronteiraState> {
  state: FronteiraState = { falhou: false };

  static getDerivedStateFromError(): FronteiraState {
    return { falhou: true };
  }

  render() {
    return this.state.falhou ? this.props.aoFalhar : this.props.children;
  }
}


interface Warehouse3DViewerProps {
  /**
   * Vagas a desenhar. Omitido, o componente busca os endereços reais do Pulmão.
   * Passar explicitamente serve para teste e para telas que já carregaram os dados.
   */
  slots?: readonly Slot[];
  /**
   * Empresa cuja Curva ABC publicada colore o modo "Curva ABC".
   *
   * Prop, e não `useAuth()` aqui dentro: o componente é renderizável isolado — é para
   * isso que `slots` existe —, e chamar o contexto de autenticação passaria a exigir o
   * `AuthProvider` para desenhar um cubo. Omitido, o modo Curva ABC avisa que não há
   * classificação em vez de sumir.
   */
  companyId?: string;
  /** Chamado ao clicar numa vaga, além de abrir o painel de detalhe interno. */
  onSelectSlot?: (slot: Slot) => void;
  /** Omitido, o botão de leitura de QR Code não aparece. */
  onScanRequest?: (slot: Slot) => void;
  /** Omitido, o botão de movimentação não aparece. */
  onOperate?: (slot: Slot) => void;
  className?: string;
}

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; dados: WarehouseSlots };

// `hud-3d` é o escopo da JetBrains Mono: a regra no index.css só alcança o que está
// dentro desta moldura, então a tipografia técnica do resto do produto fica intocada.
const MOLDURA = 'hud-3d relative h-full min-h-[24rem] w-full overflow-hidden rounded-container bg-surface-2';

export function Warehouse3DViewer({
  slots: slotsExternos,
  companyId,
  onSelectSlot,
  onScanRequest,
  onOperate,
  className = '',
}: Warehouse3DViewerProps) {
  const { theme } = useTheme();
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null);
  const [estado, setEstado] = useState<Estado>(() =>
    slotsExternos ? { fase: 'pronto', dados: { slots: [...slotsExternos], naoPosicionaveis: [], codigoPorBinId: new Map() } } : { fase: 'carregando' },
  );

  const [modoVisor, setModoVisor] = useState<ModoVisor>('operacional');

  // A planta reproduzida em 3D pelas medidas. Ligada por padrão: é o desenho do galpão
  // de verdade. Desligar devolve as vagas montadas pelo código, que é onde vivem status,
  // busca e rota — as duas não podem aparecer juntas porque ocupam o mesmo chão.
  const [mostrarPlantaFisica, setMostrarPlantaFisica] = useState(true);

  /**
   * Caminhar dentro do galpão, em vez de orbitar por fora.
   *
   * Sai da órbita porque são dois jeitos incompatíveis de mexer na mesma câmera. Entrar
   * trava o ponteiro do mouse — por isso o rótulo diz como sair, senão a pessoa fica
   * presa sem saber que é Esc.
   */
  const [caminhando, setCaminhando] = useState(false);

  /**
   * As MEDIDAS da planta, agora lidas do banco (migration 133).
   *
   * Nasce com a constante em vez de `null`: assim o primeiro quadro já desenha o galpão
   * inteiro e a leitura só corrige a medida, se houver o que corrigir. Começando vazio, o
   * mapa abriria sem galpão por um instante e a câmera se enquadraria pelo nada.
   */
  const [plantaMedida, setPlantaMedida] = useState<PlantaFisicaCarregada>(() => ({
    trechos: AZ2027_TERREO,
    rotulos: ROTULOS_PADRAO,
    origem: 'constante',
  }));

  /** Pavimento desenhado. Troca recarrega planta e peças — vagas e saldo são do galpão. */
  const [andar, setAndar] = useState(ANDAR_INICIAL);
  /** Pavimentos com planta cadastrada. O térreo entra sempre. */
  const [pavimentos, setPavimentos] = useState<number[]>([ANDAR_INICIAL]);

  useEffect(() => {
    let cancelado = false;
    listarPavimentos().then(lista => {
      if (!cancelado) setPavimentos(lista);
    });
    return () => { cancelado = true; };
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const carregada = await carregarPlantaFisica(andar);
      if (cancelado) return;
      // `vazio` também entra no estado, e é o ponto do pavimento honesto: o andar sem
      // planta cadastrada precisa aparecer VAZIO, não herdar o desenho do térreo. Só
      // `constante` é descartada — ela já é o valor inicial, e reatribuí-la geraria um
      // render a mais com o mesmo desenho.
      if (carregada.origem !== 'constante') setPlantaMedida(carregada);
      else if (andar === ANDAR_INICIAL) setPlantaMedida(carregada);
    })();
    return () => { cancelado = true; };
  }, [andar]);

  // ── A planta do armazém no piso do 3D ────────────────────────────────────────────
  // A ponte que faltava: o mapa 3D posicionava tudo por aritmética do código da vaga e
  // nunca tinha olhado para a planta. Aqui ele passa a ler a MESMA planta publicada que
  // o configurador 2D edita — imagem e escala — e desenhá-la no chão da cena.
  const [plantaNoPiso, setPlantaNoPiso] = useState<PlantaNoPiso | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelado = false;
    (async () => {
      // A planta do piso é a do PAVIMENTO desenhado. Sem o andar, o mezanino apareceria
      // com a imagem do térreo no chão.
      setPlantaNoPiso(null);
      const planta = await getPublishedLayout(companyId, andar);
      if (cancelado || !planta?.background_image_path) return;
      const url = await getFloorPlanSignedUrl(planta.background_image_path);
      if (cancelado || !url) return;
      setPlantaNoPiso({
        url,
        // Metros reais, não células: é a escala calibrada que faz a planta ocupar no 3D
        // o mesmo tamanho que ocupa no galpão.
        largura: planta.grid_width * planta.cell_size_meters,
        profundidade: planta.grid_height * planta.cell_size_meters,
      });
    })();
    return () => { cancelado = true; };
  }, [companyId, andar]);

  // ── Builder: tudo local, nada no banco ───────────────────────────────────────────
  // Construir precisa ser barato de desfazer. Com cada clique indo ao Supabase, testar
  // um arranjo deixaria rastro em produção e a borracha dependeria da rede.
  const [ferramenta, setFerramenta] = useState<FerramentaBuilder>('navegar');
  const [objetos, setObjetos] = useState<ObjetoConstruido[]>([]);
  const [selecionadoNoBuilder, setSelecionadoNoBuilder] = useState<string | null>(null);
  // Tipo e cor valem para a PRÓXIMA peça e para a selecionada: escolher antes de colocar
  // e corrigir depois de colocar são as duas formas de usar isto, e as duas precisam
  // funcionar sem obrigar a excluir e refazer.
  const [estanteEscolhida, setEstanteEscolhida] = useState<TipoDeEstante>('simples');
  const [corEscolhida, setCorEscolhida] = useState(CORES_DE_ESTANTE[0].chave);
  const [salvandoPecas, setSalvandoPecas] = useState(false);
  const [erroAoSalvar, setErroAoSalvar] = useState<string | null>(null);
  const [salvoEm, setSalvoEm] = useState<Date | null>(null);

  // Carrega o que a equipe já montou NESTE pavimento. Recarrega ao trocar de andar, e não
  // a cada troca de modo: o esboço do mezanino não pode aparecer no térreo, mas recarregar
  // por mudança de modo descartaria o que a pessoa acabou de colocar e ainda não salvou.
  useEffect(() => {
    let cancelado = false;
    // Lista nova por pavimento: sem isto, trocar de andar manteria na tela as peças do
    // anterior e o "Salvar construção" as gravaria no andar errado.
    setObjetos([]);
    setSelecionadoNoBuilder(null);
    listarPecas(andar).then(salvas => {
      if (cancelado || salvas.length === 0) return;
      setObjetos(salvas.map(p => ({
        id: p.id,
        tipo: p.tipo as TipoConstruido,
        estante: p.estante as TipoDeEstante,
        cor: p.cor,
        x: p.x,
        z: p.z,
        rotacaoY: p.rotacaoY,
      })));
    });
    return () => { cancelado = true; };
  }, [andar]);

  const salvarConstrucao = useCallback(async () => {
    setErroAoSalvar(null);
    setSalvandoPecas(true);
    const r = await salvarPecas(
      objetos.map(o => ({
        id: o.id, tipo: o.tipo, estante: o.estante, cor: o.cor, x: o.x, z: o.z, rotacaoY: o.rotacaoY,
      })),
      andar,
    );
    setSalvandoPecas(false);
    if (!r.ok) { setErroAoSalvar(r.erro ?? 'Não foi possível salvar.'); return; }
    setSalvoEm(new Date());
  }, [objetos, andar]);
  // Contador em vez de random: o id só precisa ser único dentro desta sessão de edição,
  // e um contador é reproduzível quando se está depurando o que foi colocado onde.
  const proximoIdDoObjeto = useRef(1);

  const construirObjeto = useCallback(
    (x: number, z: number) => {
      setFerramenta(atual => {
        if (atual === 'navegar') return atual;
        const id = `obj-${proximoIdDoObjeto.current++}`;
        setObjetos(lista => [
          ...lista,
          { id, tipo: atual, estante: estanteEscolhida, cor: corEscolhida, x, z, rotacaoY: 0 },
        ]);
        setSelecionadoNoBuilder(id);
        return atual;
      });
    },
    [estanteEscolhida, corEscolhida],
  );

  /** Troca tipo ou cor da peça selecionada, para corrigir sem excluir e refazer. */
  const ajustarObjeto = useCallback((id: string, patch: Partial<Pick<ObjetoConstruido, 'estante' | 'cor'>>) => {
    setObjetos(lista => lista.map(o => (o.id === id ? { ...o, ...patch } : o)));
  }, []);

  /** Id da peça selecionada SE ela for porta-pallets — tipo e cor só valem para estante. */
  const selecionadoDoTipoEstante = useMemo(() => {
    const alvo = objetos.find(o => o.id === selecionadoNoBuilder);
    return alvo?.tipo === 'porta-pallets' ? alvo.id : null;
  }, [objetos, selecionadoNoBuilder]);

  const girarObjeto = useCallback((id: string) => {
    setObjetos(lista =>
      lista.map(o => (o.id === id ? { ...o, rotacaoY: o.rotacaoY + Math.PI / 2 } : o)),
    );
  }, []);

  const excluirObjeto = useCallback((id: string) => {
    setObjetos(lista => lista.filter(o => o.id !== id));
    setSelecionadoNoBuilder(atual => (atual === id ? null : atual));
  }, []);

  // Sair do Modo Edição desarma a ferramenta. Sem isto, voltar para cá traria o fantasma
  // já colado no cursor e o primeiro clique construiria sem intenção.
  useEffect(() => {
    if (modoVisor === 'operacional') {
      setFerramenta('navegar');
      setSelecionadoNoBuilder(null);
    }
  }, [modoVisor]);

  // Atalhos R e Del, só com peça selecionada no Modo Edição.
  useEffect(() => {
    if (modoVisor !== 'edicao' || !selecionadoNoBuilder) return;
    const aoTeclar = (e: KeyboardEvent) => {
      // Enquanto a pessoa digita na busca, R é letra, não atalho.
      const alvo = e.target as HTMLElement | null;
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        girarObjeto(selecionadoNoBuilder);
      }
      if (e.key === 'Delete') {
        e.preventDefault();
        excluirObjeto(selecionadoNoBuilder);
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [modoVisor, selecionadoNoBuilder, girarObjeto, excluirObjeto]);

  const [modo, setModo] = useState<ModoCor>('status');
  const [filtro, setFiltro] = useState<FiltroStatus>('todas');
  /** Conjunto VAZIO significa todas as ruas. Guardar "todas" como um valor sentinela
   *  obrigaria cada leitura a lembrar do sentinela; o conjunto vazio ja diz isso. */
  const [ruasSelecionadas, setRuasSelecionadas] = useState<Set<string>>(() => new Set());
  // Lido do localStorage uma vez, na montagem. É preferência de quem monta o mapa, não
  // dado do armazém — o banco não guarda a altura da estrutura.
  const [layout, setLayout] = useState<Layout3DConfig>(carregarLayout);
  const [ajustando, setAjustando] = useState(false);
  const [busca, setBusca] = useState('');
  /** Códigos de vaga que contêm o termo. `null` = nenhuma busca em curso. */
  const [achados, setAchados] = useState<Set<string> | null>(null);
  /** Os mesmos endereços de `achados`, na ordem FIFO que o banco devolveu. */
  const [ordemFifo, setOrdemFifo] = useState<string[]>([]);
  const [rotaAberta, setRotaAberta] = useState(true);
  const [paradaAtual, setParadaAtual] = useState(0);
  const [buscando, setBuscando] = useState(false);
  /**
   * O hover NÃO é estado do React aqui.
   *
   * Ele muda dezenas de vezes por segundo e interessa a um desenho só — o contorno da
   * vaga apontada. Como `useState` neste componente, cada movimento do mouse
   * re-renderizava o visualizador inteiro e, na planta, os ~1.245 elementos dos vãos
   * junto. Agora o valor vive num ref e quem precisa dele assina o canal.
   */
  const canalDeHover = useRef<CanalDeHover>({ atual: null, ouvintes: new Set() });
  /** Moldura, para trocar o cursor sem passar por render. */
  const molduraRef = useRef<HTMLDivElement>(null);

  const apontar = useCallback((slot: Slot | null) => {
    const canal = canalDeHover.current;
    // `onPointerMove` dispara a cada pixel; sem este corte, o mesmo valor seria
    // retransmitido dezenas de vezes por segundo para todos os ouvintes.
    if ((canal.atual?.id ?? null) === (slot?.id ?? null)) return;
    canal.atual = slot;
    molduraRef.current?.classList.toggle('cursor-pointer', !!slot);
    canal.ouvintes.forEach(ouvinte => ouvinte(slot));
  }, []);

  /** Estável de propósito: é o que permite `React.memo` na cena segurar o hover. */
  const assinarHover = useCallback((ouvinte: (slot: Slot | null) => void) => {
    const canal = canalDeHover.current;
    canal.ouvintes.add(ouvinte);
    return () => { canal.ouvintes.delete(ouvinte); };
  }, []);

  const [selecionada, setSelecionada] = useState<Slot | null>(null);
  /** Classificação de giro por endereço. Carregada UMA vez, separada das vagas: o mapa
   *  abre e já desenha no modo Status enquanto isto ainda vem. */
  const [abc, setAbc] = useState<AbcDoArmazem>(ABC_VAZIO);
  const [abcFalhou, setAbcFalhou] = useState(false);
  /**
   * Radar recolhido em tela estreita.
   *
   * Num celular em pé, o radar (12 rem) e a gaveta de detalhe (19 rem) disputam o mesmo
   * canto inferior direito. Recolhido ele vira uma linha de título, e abrir continua sendo
   * um clique. Lido uma vez, na montagem — como o painel de controles.
   */
  const [radarAberto, setRadarAberto] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= LARGURA_ESTREITA,
  );
  const [fundo, setFundo] = useState<FundoDaCena>('galpao');
  /** Preenchida pelo `CapturadorDeCena` assim que o Canvas monta. */
  const capturarRef = useRef<(() => string) | null>(null);
  /** Vagas mexidas por outro operador nos últimos segundos. */
  const [pulsando, setPulsando] = useState<ReadonlySet<string>>(() => new Set());
  const relogiosDoPulso = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Mapa UUID -> código sempre atual, sem refazer a inscrição a cada recarga. */
  const codigoPorBinIdRef = useRef<ReadonlyMap<string, string>>(new Map());
  /** Vagas que mudaram durante a janela do debounce — a atualização é só delas. */
  const pendentesRef = useRef<Set<string>>(new Set());
  /** Alguma mudança exigiu recarga COMPLETA: vaga criada, bloqueada ou apagada. */
  const completaRef = useRef(false);
  const recargaRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nós do radar movidos por fora do React, a cada quadro. Ver `SondaDeCamera`.
  const radarGrupoRef = useRef<SVGGElement>(null);
  const radarConeRef = useRef<SVGPathElement>(null);
  /** Destino da transição suave. Ref, não estado: muda a cada quadro durante o pan. */
  const destinoRef = useRef<DestinoDeCamera | null>(null);
  /**
   * A câmera está voando até um destino.
   *
   * Precisa ser ESTADO, mesmo com o destino morando num ref: é o que mantém o laço de
   * quadros vivo em `frameloop="demand"`. Sem isto, mandar a câmera para uma parada
   * agendaria um voo que nunca aconteceria, porque ninguém pediria o próximo quadro.
   */
  const [voando, setVoando] = useState(false);

  /**
   * Manda a câmera para um destino, pelo `PanSuave`.
   *
   * Todo movimento de câmera comandado por botão passa por aqui. Antes havia dois
   * caminhos — `set()` direto para o foco e o reset, animado para a rota —, e a diferença
   * não tinha razão de ser: quem clica em "Ir até" também perde a relação entre a vista
   * que tinha e a que recebeu, e é justamente ela que o deslizamento preserva.
   *
   * `voando` é o que mantém o laço vivo: com `frameloop="demand"`, o destino mora num ref
   * e ref nenhum faz o fiber desenhar. O `PanSuave` devolve o aviso pelo `aoParar`, por
   * chegada ou por cancelamento — arrastar o mouse no meio do caminho emite `start` no
   * OrbitControls, que larga o destino e devolve o comando para a mão.
   */
  const voarAte = useCallback((alvo: Vector3, posicao: Vector3) => {
    if (!controlsRef.current) return;
    destinoRef.current = { alvo, posicao };
    setVoando(true);
  }, []);

  // ── Tela cheia ───────────────────────────────────────────────────────────────
  //
  // O elemento em tela cheia é a MOLDURA, não o canvas: HUD, radar e gaveta de detalhe
  // são irmãos do canvas dentro dela, e pôr o canvas sozinho em tela cheia deixaria os
  // controles para trás — um mapa que ocupa o monitor inteiro e não se comanda.
  //
  // O modal de ajuste também vive dentro dela (`Hud3D` o renderiza), e isso foi
  // conferido: o `Modal` do projeto não usa portal, é `fixed inset-0` como filho de quem
  // o chama. Fosse portalado para o `body`, sumiria em tela cheia.
  const [telaCheia, setTelaCheia] = useState(false);

  /**
   * A API existe E está permitida aqui.
   *
   * `fullscreenEnabled` é falso dentro de um iframe sem `allow="fullscreen"`, e no Safari
   * do iPhone `Element.requestFullscreen` simplesmente não existe — lá só `<video>` vai a
   * tela cheia. Sem esta checagem o botão apareceria e não faria nada, que é pior do que
   * não existir.
   */
  const suportaTelaCheia = useMemo(
    () =>
      typeof document !== 'undefined' &&
      !!document.fullscreenEnabled &&
      typeof Element.prototype.requestFullscreen === 'function',
    [],
  );

  /**
   * O estado vem do EVENTO, nunca do clique.
   *
   * Sair por Esc, pelo botão do navegador ou por troca de aba não passa por este
   * componente. Marcar o estado no clique faria o botão dizer "Sair da tela cheia" com a
   * tela já restaurada.
   */
  useEffect(() => {
    if (!suportaTelaCheia) return;
    const sincronizar = () => {
      const moldura = molduraRef.current;
      // `!!moldura` não é defensivo, é o bug: nos estados de carregamento e de erro o
      // componente devolve uma moldura SEM o ref, então `molduraRef.current` é null. E
      // `null === document.fullscreenElement` é verdadeiro quando nada está em tela
      // cheia — o botão nascia dizendo "Sair da tela cheia", e ficava assim, porque
      // montar o canvas depois não dispara `fullscreenchange`.
      setTelaCheia(!!moldura && document.fullscreenElement === moldura);
    };
    document.addEventListener('fullscreenchange', sincronizar);
    sincronizar();
    return () => document.removeEventListener('fullscreenchange', sincronizar);
  }, [suportaTelaCheia]);

  const alternarTelaCheia = useCallback(() => {
    const moldura = molduraRef.current;
    if (!moldura || !suportaTelaCheia) return;
    // As duas promessas podem ser recusadas — por política de permissão, por o gesto não
    // contar como ativação do usuário, ou por o navegador simplesmente negar. Recusa não
    // é exceção a tratar: a tela continua como está, e o `fullscreenchange` que não veio
    // é a confirmação disso. O que não pode é virar rejeição não capturada no console.
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void moldura.requestFullscreen().catch(() => setTelaCheia(false));
  }, [suportaTelaCheia]);

  // Atalho F. Mesma guarda do atalho de girar peça: enquanto a pessoa digita na busca,
  // F é letra, não comando. Modificadores ficam de fora para não roubar Ctrl+F do
  // navegador.
  useEffect(() => {
    if (!suportaTelaCheia) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      if (alvo?.isContentEditable) return;
      e.preventDefault();
      alternarTelaCheia();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [suportaTelaCheia, alternarTelaCheia]);

  useEffect(() => {
    if (!companyId) {
      setAbc(ABC_VAZIO);
      return;
    }
    let vivo = true;
    setAbcFalhou(false);
    loadAbcDoArmazem(companyId)
      .then(dados => {
        if (vivo) setAbc(dados);
      })
      .catch(() => {
        // Falhar aqui NÃO derruba o mapa: a curva é uma camada a mais sobre um mapa que
        // já é útil sem ela. Mas o modo Curva ABC não pode fingir que está colorindo o
        // armazém inteiro de cinza por não haver classificação — isso é dito na tela.
        if (vivo) {
          setAbc(ABC_VAZIO);
          setAbcFalhou(true);
        }
      });
    return () => {
      vivo = false;
    };
  }, [companyId]);

  const buscar = useCallback(() => {
    let vivo = true;
    setEstado({ fase: 'carregando' });
    loadWarehouseSlots()
      .then(dados => {
        if (vivo) setEstado({ fase: 'pronto', dados });
      })
      .catch((erro: unknown) => {
        // A mensagem do Supabase é mostrada como está: inventar um texto genérico
        // ("algo deu errado") esconde justamente o que distingue rede caída de
        // permissão negada, que é o que decide o que fazer em seguida.
        if (vivo) setEstado({ fase: 'erro', mensagem: erro instanceof Error ? erro.message : String(erro) });
      });
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (slotsExternos) {
      setEstado({ fase: 'pronto', dados: { slots: [...slotsExternos], naoPosicionaveis: [], codigoPorBinId: new Map() } });
      return;
    }
    return buscar();
  }, [slotsExternos, buscar]);

  /**
   * Busca o termo no saldo e guarda os endereços que o contêm.
   *
   * Usa `searchStock`, que já roda em produção na seção "Consultar SKU" e casa por SKU
   * ou nome do produto. Nenhuma query nova, nenhuma fonte nova de verdade.
   *
   * O atraso de 300 ms existe porque cada tecla dispararia uma ida ao banco: digitar
   * "GCGCM116" seriam oito consultas, sete delas descartadas. `cancelado` descarta a
   * resposta de um termo que já não é o atual — sem isso, uma resposta lenta de um
   * termo antigo sobrescreveria a do termo novo.
   */
  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) {
      setAchados(null);
      setOrdemFifo([]);
      setBuscando(false);
      return;
    }
    let cancelado = false;
    setBuscando(true);
    const timer = setTimeout(() => {
      searchStock(termo)
        .then(linhas => {
          if (!cancelado) {
            setAchados(new Set(linhas.map(l => l.binCode)));
            // A ORDEM das linhas é informação, e o Set a joga fora. `searchStock`
            // devolve do saldo mais antigo para o mais novo — é a ordem em que o
            // estoque deve ser consumido, e é ela que vira a rota de coleta.
            setOrdemFifo(linhas.map(l => l.binCode));
            setParadaAtual(0);
            setBuscando(false);
          }
        })
        .catch(() => {
          // Busca que falha não derruba o mapa: volta a mostrar tudo, sem alarde.
          if (!cancelado) {
            setAchados(null);
            setOrdemFifo([]);
            setBuscando(false);
          }
        });
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [busca]);

  const dados = estado.fase === 'pronto' ? estado.dados : null;
  const vagas = useMemo(() => dados?.slots ?? [], [dados]);

  // ── Tempo real ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (dados) codigoPorBinIdRef.current = dados.codigoPorBinId;
  }, [dados]);

  /** Recarga SEM passar por "carregando": o loader apagaria a cena inteira a cada
   *  movimentação alheia, e quem está olhando o mapa perderia o próprio enquadramento
   *  várias vezes por minuto num galpão em operação. */
  const recarregarSilencioso = useCallback(() => {
    loadWarehouseSlots()
      .then(novos => {
        // Só atualiza se a tela JÁ estava pronta. Sobrescrever um estado de erro ou de
        // carga em curso faria duas fontes disputarem a mesma tela.
        setEstado(atual => (atual.fase === 'pronto' ? { fase: 'pronto', dados: novos } : atual));
      })
      .catch(() => {
        // Falha de recarga em segundo plano não derruba o que está na tela: o mapa
        // continua mostrando o último estado bom, que é melhor que um erro no lugar de
        // um armazém.
      });
  }, []);

  /**
   * Atualiza só as vagas que mudaram.
   *
   * Medido em produção, a recarga completa custa ~1,5 s (215 endereços + a view de saldo)
   * para refletir a movimentação de uma vaga. Aqui vai uma leitura por vaga afetada, e o
   * resto da tela não se mexe: a cena não remonta lote nenhum quando a contagem por status
   * não muda.
   *
   * Qualquer tropeço cai na recarga completa — vaga desconhecida, erro de leitura, estado
   * que ainda não está pronto. Incremental é otimização; completa é a verdade.
   */
  const atualizarVagas = useCallback(
    async (codigos: readonly string[]) => {
      try {
        const saldos = await Promise.all(
          codigos.map(async codigo => [codigo, await boxesForBin(codigo)] as const),
        );
        let desconhecida = false;
        setEstado(atual => {
          if (atual.fase !== 'pronto') return atual;
          let dados = atual.dados;
          for (const [codigo, caixas] of saldos) {
            const proximo = aplicarSaldo(dados, codigo, caixas);
            // Mesma referência com saldo diferente = a vaga não está na tela. Saldo igual
            // também devolve a mesma referência, e aí não há o que recarregar.
            if (proximo === dados && !dados.slots.some(s => s.id === codigo)) desconhecida = true;
            dados = proximo;
          }
          return dados === atual.dados ? atual : { fase: 'pronto', dados };
        });
        if (desconhecida) recarregarSilencioso();
      } catch {
        recarregarSilencioso();
      }
    },
    [recarregarSilencioso],
  );

  /**
   * Uma rajada de movimentações vira UMA atualização.
   *
   * Sem isto, descarregar um pallet de vinte caixas dispararia vinte consultas em
   * sequência. Os códigos se ACUMULAM durante a janela: antes bastava marcar "recarregar",
   * porque a recarga era do armazém inteiro de qualquer jeito.
   *
   * Sem código (vaga criada, bloqueada ou apagada por outro operador) a rajada inteira vira
   * recarga completa — mudança de endereço não se resolve lendo saldo.
   */
  const agendarRecarga = useCallback(
    (codigo?: string | null) => {
      if (codigo) pendentesRef.current.add(codigo);
      else pendentesRef.current.clear();
      if (!codigo) completaRef.current = true;

      if (recargaRef.current) clearTimeout(recargaRef.current);
      recargaRef.current = setTimeout(() => {
        recargaRef.current = null;
        const codigos = [...pendentesRef.current];
        const completa = completaRef.current;
        pendentesRef.current.clear();
        completaRef.current = false;
        if (completa || codigos.length === 0) recarregarSilencioso();
        else void atualizarVagas(codigos);
      }, 400);
    },
    [recarregarSilencioso, atualizarVagas],
  );

  const destacarVaga = useCallback((codigo: string) => {
    setPulsando(anterior => new Set(anterior).add(codigo));
    const relogios = relogiosDoPulso.current;
    // Mexer de novo na mesma vaga reinicia a contagem em vez de somar um segundo
    // temporizador — dois relógios para a mesma vaga apagariam o destaque cedo demais.
    const anterior = relogios.get(codigo);
    if (anterior) clearTimeout(anterior);
    relogios.set(
      codigo,
      setTimeout(() => {
        relogios.delete(codigo);
        setPulsando(atual => {
          const proximo = new Set(atual);
          proximo.delete(codigo);
          return proximo;
        });
      }, DURACAO_PULSO),
    );
  }, []);

  useEffect(() => {
    // Sem empresa, ou com vagas vindas por prop (uso isolado/teste), não há canal a
    // abrir: assinar ali seria socket aberto para dado que ninguém vai usar.
    if (!companyId || slotsExternos) return;
    const assinatura = assinarMudancasDoPulmao(
      companyId,
      () => codigoPorBinIdRef.current,
      codigo => {
        // Sem código conhecido ainda assim recarrega: pode ser vaga criada por outro
        // operador, que precisa APARECER mesmo sem ter o que destacar.
        if (codigo) destacarVaga(codigo);
        // O conteúdo guardado desta vaga acabou de ficar velho. Sem código conhecido,
        // esquece TUDO: não dá para saber qual mudou, e saldo velho com cara de atual é
        // pior do que a espera que o cache economiza.
        esquecerConteudoDaVaga(codigo ?? undefined);
        agendarRecarga(codigo);
      },
    );
    return () => assinatura.cancelar();
  }, [companyId, slotsExternos, destacarVaga, agendarRecarga]);

  // Desmontagem: nenhum temporizador sobrevive à tela que os criou.
  useEffect(() => {
    const relogios = relogiosDoPulso.current;
    return () => {
      relogios.forEach(clearTimeout);
      relogios.clear();
      if (recargaRef.current) clearTimeout(recargaRef.current);
    };
  }, []);

  const contagem = useMemo(() => {
    const base: Record<SlotStatus, number> = { empty: 0, occupied: 0, divergence: 0, blocked: 0 };
    for (const s of vagas) base[s.status] += 1;
    return base;
  }, [vagas]);

  const ruas = useMemo(() => [...new Set(vagas.map(s => s.ruaCodigo))].sort(), [vagas]);

  /** Quantas vagas cada curva colore. Vaga vazia não entra: ela não guarda SKU nenhum,
   *  então não tem giro — entrar como "sem classificação" inflaria esse número com o
   *  armazém vazio e esconderia o que de fato falta classificar. */
  const contagemAbc = useMemo(() => {
    const porClasse: Record<AbcClasse, number> = { A: 0, B: 0, C: 0 };
    let semCurva = 0;
    for (const s of vagas) {
      if (s.status === 'empty') continue;
      const classe = abc.porVaga.get(s.id)?.classe;
      if (classe) porClasse[classe] += 1;
      else semCurva += 1;
    }
    return { porClasse, semCurva };
  }, [vagas, abc]);

  /** Vagas de alto giro fora da face de piso. Calculado FORA do modo de cor: o atalho
   *  precisa aparecer mesmo para quem está olhando o mapa por Status, senão só descobre
   *  o problema quem já foi procurar. */
  const alertasGiro = useMemo(() => alertasDeGiro(vagas, abc.porVaga), [vagas, abc]);

  /**
   * Filtro de rua, filtro de status, busca e pulso num objeto só.
   *
   * Agrupado porque as DUAS vistas aplicam a mesma regra (`destaqueDaVaga`), e passar
   * quatro campos soltos para cada uma foi justamente o caminho pelo qual a planta ficou
   * sem busca, sem filtro de status e sem pulso.
   */
  const contextoDeDestaque = useMemo<ContextoDeDestaque>(
    () => ({ ruasSelecionadas, filtro, achados, pulsando }),
    [ruasSelecionadas, filtro, achados, pulsando],
  );

  /**
   * A planta física pronta para desenhar, com as vagas REAIS ligadas aos vãos.
   *
   * O mapa por código é o que faz o clique funcionar: cada vão sabe o endereço que
   * ocupa, acha a vaga e abre a MESMA que a vista por código abriria. Sem ele o vão
   * seria enfeite — desenho bonito que não responde a clique.
   */
  const plantaFisica = useMemo(() => {
    if (!mostrarPlantaFisica) return null;

    // Maior posição cadastrada por rua. Entra no desenho para a fileira nunca ficar mais
    // curta que o cadastro — sem isso, vaga com carga numa posição alta não tem vão onde
    // aparecer e a mercadoria some do mapa.
    const posicoesPorRua: Record<string, number> = {};
    for (const v of vagas) {
      posicoesPorRua[v.ruaCodigo] = Math.max(posicoesPorRua[v.ruaCodigo] ?? 0, v.modulo);
    }

    return {
      blocos: blocosDaPlanta(plantaMedida.trechos, plantaMedida.rotulos, posicoesPorRua),
      mesas: mesasDaPlanta(plantaMedida.trechos),
      // Vai junto para a cena não precisar recalcular a medida por conta própria: duas
      // contas do mesmo comprimento é como o desenho e o enquadramento se desalinham.
      comprimento: comprimentoTotal(plantaMedida.trechos),
      vagasPorCodigo: new Map(vagas.map(v => [v.id, v])),
      modoCor: modo,
      maxCaixas: vagas.reduce((m, s) => Math.max(m, s.caixas), 0),
      abcPorVaga: abc.porVaga,
      destaque: contextoDeDestaque,
    };
  }, [mostrarPlantaFisica, vagas, modo, abc.porVaga, contextoDeDestaque, plantaMedida]);

  // Posição e cor de cada vaga, calculadas uma vez por mudança real de entrada. Sem
  // isto, cada movimento do mouse (que muda `apontada`) recalcularia a cena inteira.
  const {
    solidas, divergentes, raioX, fiosAtivos, fiosAtenuados,
    colunas, comCarga, placas, achadas, extensao: extensaoDasVagas, deslocamento,
  } = useMemo(() => {
    const maxCaixas = vagas.reduce((m, s) => Math.max(m, s.caixas), 0);
    const atenuada = COR_ATENUADA[theme];

    const desenhaveis: VagaDesenhavel[] = vagas.map(slot => {
      // A MESMA função que a planta física usa. Antes a regra vivia escrita aqui dentro,
      // e era por isso que a outra vista não tinha como aplicá-la.
      const { ativa, achada, pulsando: pulso } = destaqueDaVaga(slot, contextoDeDestaque);
      return {
        slot,
        posicao: posicaoDaVaga(slot, layout),
        // O azul da busca vence a cor de status: achado o produto, a pergunta na tela
        // passou a ser "onde está", não "como está".
        // O pulso vence tudo: é a informação mais NOVA da tela. Durante dois segundos
        // a pergunta deixa de ser "como está esta vaga" e passa a ser "alguém acabou
        // de mexer aqui".
        cor: pulso
          ? COR_PULSO
          : achada
            ? COR_BUSCA
            : ativa
              ? corDaVaga(slot, modo, theme, maxCaixas, abc.porVaga)
              : atenuada,
        ativa,
      };
    });

    const vazio = {
      solidas: [], divergentes: [], raioX: [], fiosAtivos: [], fiosAtenuados: [],
      colunas: [], comCarga: [], placas: [], achadas: [],
      extensao: 10, deslocamento: [0, 0, 0] as [number, number, number],
    };
    if (vagas.length === 0) return vazio;

    const maxRua = Math.max(...vagas.map(s => s.rua));
    const maxModulo = Math.max(...vagas.map(s => s.modulo));
    const larguraTotal = (maxRua - 1) * layout.rowSpacing;
    const profundidadeTotal = (maxModulo - 1) * layout.moduleWidth;

    // Montantes só onde a estrutura está elevada. Um por extremidade de rua e um a
    // cada 4 módulos: o suficiente para ler "isto está suspenso" sem virar floresta.
    const colunas: { x: number; z: number; altura: number }[] = [];
    const placas: PlacaDeRua[] = [];
    for (const letra of new Set(vagas.map(s => s.ruaCodigo))) {
      const daRua = vagas.filter(s => s.ruaCodigo === letra);
      const base = baseDaRua(letra, layout);
      const x = (daRua[0].rua - 1) * layout.rowSpacing;
      const modulos = [...new Set(daRua.map(s => s.modulo))].sort((a, b) => a - b);

      if (base > 0) {
        const escolhidos = modulos.filter((m, i) => i === 0 || i === modulos.length - 1 || m % 4 === 0);
        for (const m of escolhidos) colunas.push({ x, z: (m - 1) * layout.moduleWidth, altura: base });
      }

      // Placa um metro ACIMA do último nível daquela rua, nas duas pontas do corredor.
      // A altura é por rua, não global: com uma rua suspensa e outra no chão, uma placa
      // na média ficaria enterrada numa e perdida no alto da outra.
      const maxNivel = Math.max(...daRua.map(s => s.nivel));
      const y = base + maxNivel * layout.levelHeight + 1;
      const pontas = modulos.length > 1 ? [modulos[0], modulos[modulos.length - 1]] : [modulos[0]];
      for (const m of pontas) placas.push({ rotulo: letra, x, y, z: (m - 1) * layout.moduleWidth });
    }

    return {
      solidas: desenhaveis.filter(v => v.ativa && v.slot.status !== 'empty' && v.slot.status !== 'divergence'),
      divergentes: desenhaveis.filter(v => v.ativa && v.slot.status === 'divergence'),
      // Fora do filtro, mas com carga: vidro, para dar a profundidade do raio-X.
      raioX: desenhaveis.filter(v => !v.ativa && v.slot.status !== 'empty'),
      fiosAtivos: desenhaveis.filter(v => v.ativa && v.slot.status === 'empty'),
      fiosAtenuados: desenhaveis.filter(v => !v.ativa && v.slot.status === 'empty'),
      // Contorno dos achados: inclui a vaga VAZIA que casou com a busca, que de outro
      // modo seria só um fio cinza e sumiria no meio dos outros fios.
      achadas: achados === null ? [] : desenhaveis.filter(v => achados.has(v.slot.id)),
      colunas,
      // Toda vaga com carga ganha palete, dentro ou fora do filtro: o filtro esconde o
      // destaque da mercadoria, não faz o estrado sumir de baixo dela.
      comCarga: desenhaveis.filter(v => v.slot.status !== 'empty'),
      placas,
      extensao: Math.max(larguraTotal, profundidadeTotal) + 4,
      // Centraliza na origem para o OrbitControls orbitar o armazém, não um canto dele.
      deslocamento: [-larguraTotal / 2, 0, -profundidadeTotal / 2] as [number, number, number],
    };
  }, [vagas, modo, theme, contextoDeDestaque, achados, layout, abc]);

  // ── Coordenadas da vista ativa ─────────────────────────────────────────────────
  //
  // Câmera e radar liam a posição SEMPRE da grade por código. Com a planta desenhada — o
  // padrão da tela — a mesma vaga fica a 10,6 m de distância (medido: `PP-E03-N2` em
  // `[2; 2,5; −7,15]` contra `[−4,3; 2,1; 1,32]`), e as escalas dos eixos são diferentes,
  // então não existe offset que converta uma geometria na outra. Daqui para baixo quem
  // responde "onde está esta vaga" é a vista que está na tela.

  const indiceDeVaos = useMemo(
    () => (plantaFisica ? indiceDosVaos(plantaFisica.blocos) : null),
    [plantaFisica],
  );

  /** Offset do grupo desenhado. O MESMO que `PlantaFisica3D` aplica no seu `<group>`. */
  const deslocamentoAtivo = useMemo<[number, number, number]>(
    () => (plantaFisica ? offsetDaPlanta(LARGURA_DO_PREDIO, plantaFisica.comprimento) : deslocamento),
    [plantaFisica, deslocamento],
  );

  /** Posição LOCAL da vaga na vista ativa, ou `null` quando esta vista não a desenha. */
  const localDaVaga = useMemo<ResolvedorLocal>(
    () =>
      indiceDeVaos
        ? vaga => indiceDeVaos.get(vaga.id)?.centro ?? null
        : vaga => posicaoDaVaga(vaga, layout),
    [indiceDeVaos, layout],
  );

  /**
   * Cerca e obstáculos da caminhada, em coordenada de MUNDO.
   *
   * A cerca sai das medidas da planta, não das paredes da cena: aquelas são um caixote de
   * `extensao × 1,9` (meio-lado 42,94 m) desenhado como cenário, enquanto o prédio tem
   * 10,3 × 45,2 m. A cerca antiga era `±extensao` — 8,8 vezes a meia-largura do galpão.
   *
   * Na vista por código não existe prédio: ali a cerca vem do contorno das vagas e cada
   * rua vira uma caixa.
   */
  const colisao = useMemo<{ caixas: CaixaPlana[]; cerca: CaixaPlana }>(() => {
    if (plantaFisica) {
      return {
        caixas: caixasDaPlanta(plantaFisica.blocos, plantaFisica.mesas, deslocamentoAtivo),
        cerca: cercaDaPlanta(
          LARGURA_DO_PREDIO,
          plantaFisica.comprimento,
          deslocamentoAtivo,
          MARGEM_DA_CERCA,
        ),
      };
    }

    const caixas: CaixaPlana[] = [];
    let larguraTotal = 0;
    let profundidadeTotal = 0;
    for (const letra of new Set(vagas.map(s => s.ruaCodigo))) {
      const daRua = vagas.filter(s => s.ruaCodigo === letra);
      const x = (daRua[0].rua - 1) * layout.rowSpacing;
      const modulos = daRua.map(s => s.modulo);
      const z0 = (Math.min(...modulos) - 1) * layout.moduleWidth - VAGA.profundidade / 2;
      const z1 = (Math.max(...modulos) - 1) * layout.moduleWidth + VAGA.profundidade / 2;
      caixas.push({
        x0: x - VAGA.largura / 2 + deslocamentoAtivo[0],
        x1: x + VAGA.largura / 2 + deslocamentoAtivo[0],
        z0: z0 + deslocamentoAtivo[2],
        z1: z1 + deslocamentoAtivo[2],
      });
      larguraTotal = Math.max(larguraTotal, x + VAGA.largura / 2);
      profundidadeTotal = Math.max(profundidadeTotal, z1);
    }
    // Folga de 2 m em volta: sem prédio desenhado, prender a câmera rente à última rua
    // tiraria o corredor de manobra por onde se anda.
    return { caixas, cerca: cercaDeContorno(larguraTotal, profundidadeTotal, deslocamentoAtivo, 2) };
  }, [plantaFisica, deslocamentoAtivo, vagas, layout]);

  /**
   * Contorno da vaga na vista ativa: onde ela está e quanto mede, em coordenada local.
   *
   * A grade devolve a caixa fixa da vaga; a planta devolve o vão REAL daquela fileira —
   * 13 posições em 15,6 m na rua A dão um vão diferente das 12 em 15 m da rua E. É o que
   * permite o realce existir nas duas vistas com a medida certa em cada uma.
   */
  const contornoDaVaga = useCallback(
    (slot: Slot): { centro: Ponto; tamanho: Ponto } | null => {
      if (indiceDeVaos) return indiceDeVaos.get(slot.id) ?? null;
      return {
        centro: posicaoDaVaga(slot, layout),
        tamanho: [VAGA.largura, VAGA.altura, VAGA.profundidade],
      };
    },
    [indiceDeVaos, layout],
  );

  /** Posição de MUNDO — é o que a câmera e o OrbitControls entendem. */
  const mundoDaVaga = useCallback(
    (vaga: Slot): Ponto | null => {
      const local = localDaVaga(vaga);
      return local ? emMundo(local, deslocamentoAtivo) : null;
    },
    [localDaVaga, deslocamentoAtivo],
  );

  /**
   * Losangos de alto giro, em coordenada local da vista ativa.
   *
   * Saiu do memo das vagas por código para cá: ele é desenhado nas duas vistas, e lá
   * dentro a posição vinha fixa de `posicaoDaVaga`. A altura do vão é 1,4 m nas duas
   * geometrias, então o mesmo recuo serve para as duas.
   *
   * Só no modo Curva ABC: fora dele a cor não está falando de giro, e um losango vermelho
   * pairando sobre o mapa de Status não teria como ser interpretado.
   */
  const marcadores = useMemo<[number, number, number][]>(() => {
    if (modo !== 'abc') return [];
    const pontos: [number, number, number][] = [];
    for (const slot of alertasGiro) {
      const local = localDaVaga(slot);
      if (local) pontos.push([local[0], local[1] + VAGA.altura / 2 + 0.45, local[2]]);
    }
    return pontos;
  }, [modo, alertasGiro, localDaVaga]);

  // Planta baixa. Depende do alerta de giro porque o radar marca as duas famílias de
  // problema — capacidade e giro mal posicionado —, com as cores da própria cena.
  // O radar descreve a vista ATIVA. Antes era sempre a grade por código: com a planta
  // desenhada, o "você está aqui" apontava para uma geometria que não estava na tela.
  const celulasRadar = useMemo(
    () => celulasDoRadar(vagas, layout, new Set(alertasGiro.map(s => s.id)), localDaVaga),
    [vagas, layout, alertasGiro, localDaVaga],
  );
  const areaRadar = useMemo(() => areaDoRadar(celulasRadar), [celulasRadar]);

  // A estante NÃO depende de filtro, modo de cor nem busca: ela é física e está sempre
  // lá. Memos próprios para não refazer a geometria da estrutura a cada troca de modo.
  const montantes = useMemo(() => montantesDoArmazem(vagas, layout), [vagas, layout]);
  const travessas = useMemo(() => vigasDoArmazem(vagas, layout), [vagas, layout]);
  // Contraventamento do quadro. Desenhado no MESMO lote dos montantes, e por isso não
  // custa desenho novo — ver `EstruturaDeRack`.
  const diagonais = useMemo(() => diagonaisDoArmazem(vagas, layout), [vagas, layout]);

  /** Escreve a posição e a abertura da câmera direto nos nós do SVG. Chamado por
   *  quadro: nada aqui pode disparar render. */
  const atualizarRadar = useCallback(
    (x: number, z: number, graus: number, meiaAbertura: number) => {
      const grupo = radarGrupoRef.current;
      if (!grupo) return;
      const [localX, localZ] = mundoParaLocal(x, z, deslocamentoAtivo);
      const [presoX, presoZ] = prenderNaArea(localX, localZ, areaRadar);
      grupo.setAttribute(
        'transform',
        `translate(${presoX.toFixed(3)} ${presoZ.toFixed(3)}) rotate(${graus.toFixed(2)})`,
      );
      const cone = radarConeRef.current;
      if (cone) {
        const alcance = Math.max(areaRadar.largura, areaRadar.profundidade) * 0.55;
        cone.setAttribute('d', caminhoDoCone(meiaAbertura, alcance));
      }
    },
    [deslocamentoAtivo, areaRadar],
  );

  /**
   * Clique no radar: PAN puro, preservando ângulo e distância.
   *
   * Move só o ponto para onde se olha. Recalcular a posição da câmera do zero giraria a
   * cena junto, e quem clicou no radar justamente para não se perder acabaria mais
   * perdido do que antes.
   */
  const irParaNoRadar = useCallback(
    (localX: number, localZ: number) => {
      const controls = controlsRef.current;
      if (!controls) return;
      const [mundoX, mundoZ] = localParaMundo(localX, localZ, deslocamentoAtivo);
      const alvo = new Vector3(mundoX, controls.target.y, mundoZ);
      const afastamento = controls.object.position.clone().sub(controls.target);
      voarAte(alvo, alvo.clone().add(afastamento));
    },
    [deslocamentoAtivo, voarAte],
  );

  /**
   * Rota de coleta sobre o resultado da busca.
   *
   * A lista de paradas é o que a busca achou, na ordem FIFO. NÃO há pedido de
   * separação no banco — não existe tabela de ordem, nem doca, nem área de picking
   * (as 71 vagas são todas pulmão). A busca é a única lista de coleta real que este
   * sistema sabe produzir hoje.
   *
   * Com uma parada só não há rota: há um destino, e para isso a busca já oferece o
   * "Ir até".
   */
  const rota = useMemo<RotaDesenhavel | null>(() => {
    if (ordemFifo.length < 2) return null;
    // Resolvida pela vista ATIVA: na planta a vaga está em outro lugar, e a rota
    // desenhada com a coordenada da grade apareceria atravessada no galpão.
    const paradas = paradasDaRota(ordemFifo, vagas, layout, localDaVaga);
    if (paradas.length < 2) return null;
    // Na planta, a travessia entre ruas é o corredor transversal de entrada do trecho —
    // as fileiras começam depois dele. Com a cabeceira da grade (−1,17 m) o traçado
    // sairia pela parede dos fundos.
    const cabeceira = plantaFisica ? cabeceiraDaPlanta(plantaFisica.blocos) : undefined;
    return {
      paradas,
      caminho: caminhoNoPiso(paradas, layout, cabeceira),
      subidas: subidasAteAVaga(paradas),
    };
  }, [ordemFifo, vagas, layout, localDaVaga, plantaFisica]);

  /**
   * Extensão que dimensiona o cenário e a câmera.
   *
   * Com a planta física desenhada ela vem da PLANTA, não das vagas: a extensão das vagas
   * por código descreve outra geometria, e usá-la deixava o galpão de 45,2 m cortado pela
   * parede e fora do enquadramento — foi o que apareceu no primeiro teste.
   */
  const extensao = plantaFisica ? Math.max(extensaoDasVagas, plantaFisica.comprimento) : extensaoDasVagas;

  /** Muda quando o conjunto desenhado muda — é o gatilho para refazer a sombra. */
  const chaveDeSombra = `${solidas.length}-${divergentes.length}-${fiosAtivos.length}-${raioX.length}-${extensao.toFixed(1)}`;

  /**
   * Há algo se movendo sozinho na cena?
   *
   * É o que decide entre desenhar todo quadro e desenhar só quando alguém pede. A lista é
   * EXPLÍCITA porque cada item é uma animação que morreria em silêncio se ficasse de fora
   * — e cena congelada não dá erro, só parece travada:
   *
   *   caminhando            — a câmera anda a cada quadro
   *   voando                — o `PanSuave` interpola até a parada
   *   rota                  — o tracejado corre no sentido da coleta
   *   divergências          — o alerta respira a emissividade
   *   pulso de tempo real   — dura 2 s e precisa aparecer e sumir
   *
   * O que NÃO precisa entrar: orbitar e dar zoom (o OrbitControls pede quadro a cada passo
   * do amortecimento), e tudo que vem de estado do React — o fiber já pede um quadro
   * depois de aplicar mudança de prop.
   */
  const temAnimacao =
    caminhando || voando || !!rota || divergentes.length > 0 || pulsando.size > 0;

  const registrarCapturador = useCallback((fn: (() => string) | null) => {
    capturarRef.current = fn;
  }, []);

  /**
   * Baixa a vista atual como PNG, com uma tarja de data, hora e ângulo.
   *
   * A tarja é acrescentada ABAIXO do desenho, num canvas 2D à parte — escrever por
   * cima cobriria justamente a parte do armazém que alguém quis registrar.
   *
   * O que a imagem NÃO traz: as placas de rua e os números das paradas. São elementos
   * HTML sobrepostos ao Canvas, não pixels do WebGL, e nenhum `toDataURL` os alcança.
   */
  const capturarCena = useCallback(() => {
    const capturar = capturarRef.current;
    const controls = controlsRef.current;
    if (!capturar || !controls) return;

    const desenho = new Image();
    desenho.onload = () => {
      const folha = document.createElement('canvas');
      folha.width = desenho.width;
      folha.height = desenho.height + ALTURA_DA_TARJA;
      const ctx = folha.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(desenho, 0, 0);

      const quando = new Date();
      const { x, y, z } = controls.object.position;
      const alvo = controls.target;
      const angulo = anguloDaCamera([x, y, z], [alvo.x, alvo.y, alvo.z]);
      desenharLegenda(ctx, desenho.width, desenho.height, legendaDaAuditoria(quando, angulo));

      const link = document.createElement('a');
      link.download = nomeDoArquivo(quando);
      link.href = folha.toDataURL('image/png');
      link.click();
    };
    desenho.src = capturar();
  }, []);

  /**
   * Enquadramento inicial.
   *
   * Com a planta física desenhada, enquadrar pelas VAGAS deixa o galpão cortado: o
   * contorno delas tem ~28 m e a planta tem 45,2. A câmera recua na proporção entre as
   * duas extensões, mantendo o mesmo ângulo — é a mesma vista, de mais longe, em vez de
   * uma vista própria que o reset não saberia reproduzir.
   */
  const posicaoCamera = useMemo(() => {
    const base = enquadrarCamera(vagas, layout);
    if (!plantaFisica || extensaoDasVagas <= 0) return base;
    const fator = Math.max(1, plantaFisica.comprimento / extensaoDasVagas);
    return [base[0] * fator, base[1] * fator, base[2] * fator] as [number, number, number];
  }, [vagas, layout, plantaFisica, extensaoDasVagas]);
  const distancia = Math.hypot(...posicaoCamera);

  // A MESMA conta do enquadramento inicial: se o reset usasse um valor próprio, o
  // botão devolveria uma vista que a tela nunca mostrou ao abrir.
  const resetarCamera = () => {
    voarAte(new Vector3(0, 0, 0), new Vector3(...posicaoCamera));
  };

  /**
   * Leva a câmera até a primeira vaga com alerta.
   *
   * A posição vem do mesmo `deslocamento` que a cena aplica ao grupo, senão a câmera
   * miraria o endereço absoluto e o armazém apareceria deslocado no quadro.
   *
   * O recuo é proporcional ao tamanho da vaga, não um número fixo: com o pulmão
   * suspenso ou com módulos mais largos, uma distância fixa colaria a câmera na vaga.
   */
  const focarVaga = (alvo: Slot | undefined) => {
    if (!alvo) return;
    // Resolvido pela vista ATIVA. Antes vinha de `alvo.posicao`, que é sempre a grade por
    // código — com a planta desenhada a câmera voava para onde a vaga NÃO está.
    const mundo = mundoDaVaga(alvo);
    if (!mundo) return;
    const [alvoX, y, alvoZ] = mundo;
    const recuo = recuoDeFoco(layout, !!plantaFisica);
    voarAte(
      new Vector3(alvoX, y, alvoZ),
      new Vector3(alvoX + recuo, y + recuo * 0.6, alvoZ + recuo),
    );
  };

  /**
   * Voo suave até uma parada da rota.
   *
   * Mesmo enquadramento do "Ir até" (`focarVaga`), mas animado pelo `PanSuave` em vez
   * de instantâneo. Percorrer a rota é uma sequência: saltar de corte em corte faria
   * perder a relação entre uma parada e a seguinte, que é o que a rota existe para
   * mostrar. O "Ir até" continua instantâneo — ali o salto é o comportamento atual e
   * não há sequência a preservar.
   */
  const voarAteParada = useCallback(
    (parada: ParadaDaRota) => {
      const controls = controlsRef.current;
      if (!controls) return;
      // `parada.naVaga` já vem na coordenada da vista ativa (a rota é montada com o mesmo
      // resolvedor), então aqui só falta o offset do grupo em que ela é desenhada.
      const [x, y, z] = emMundo(parada.naVaga, deslocamentoAtivo);
      const alvo = new Vector3(x, y, z);
      const recuo = recuoDeFoco(layout, !!plantaFisica);
      voarAte(alvo, new Vector3(alvo.x + recuo, y + recuo * 0.6, alvo.z + recuo));
    },
    // `plantaFisica` entra porque o RECUO depende da vista ativa: sem ela aqui, trocar de
    // vista manteria o recuo da anterior — 8,8 m num corredor de 2,65 m.
    [deslocamentoAtivo, layout, plantaFisica, voarAte],
  );

  const trocarLayout = (patch: Partial<Layout3DConfig>) => {
    setLayout(anterior => {
      const proximo = { ...anterior, ...patch };
      salvarLayout(proximo);
      return proximo;
    });
  };

  const selecionar = useCallback(
    (slot: Slot) => {
      setSelecionada(slot);
      onSelectSlot?.(slot);
    },
    [onSelectSlot],
  );

  if (estado.fase === 'carregando') {
    return (
      <div className={`${MOLDURA} flex items-center justify-center ${className}`}>
        <BrandLoader label="Lendo os endereços do Pulmão" />
      </div>
    );
  }

  if (estado.fase === 'erro') {
    return (
      <div className={`${MOLDURA} flex items-center justify-center p-6 ${className}`}>
        <div className="w-full max-w-md space-y-3">
          <Notice tone="danger">
            Não foi possível carregar os endereços do Pulmão. Nada foi alterado no armazém — é só a
            leitura que falhou.
            <span className="mt-2 block text-code text-xs text-fg-muted">{estado.mensagem}</span>
          </Notice>
          <Button variant="secondary" size="sm" onClick={buscar}>
            Tentar de novo
          </Button>
        </div>
      </div>
    );
  }

  if (vagas.length === 0) {
    return (
      <div className={`${MOLDURA} flex items-center justify-center p-6 ${className}`}>
        <div className="w-full max-w-md">
          <Notice tone="neutral">
            {estado.dados.naoPosicionaveis.length > 0
              ? `Nenhum endereço com posição no espaço. As ${estado.dados.naoPosicionaveis.length} vagas cadastradas não seguem o padrão de código (ex.: PP-A01-N1), então não há como situá-las no mapa 3D.`
              : 'Nenhum endereço cadastrado no Pulmão ainda. Assim que as vagas forem criadas, elas aparecem aqui.'}
          </Notice>
        </div>
      </div>
    );
  }

  const emDestaque = solidas.length + divergentes.length + fiosAtivos.length;

  return (
    // `relative` ancora os overlays; `overflow-hidden` impede que o canvas vaze no
    // instante em que o pai redimensiona. A altura vem do pai — o `min-h` é só a rede
    // de segurança para um pai sem altura definida, onde o canvas colapsaria em 0.
    // O cursor é trocado por `classList` no `apontar`, e não por classe condicional: ler
    // o hover aqui obrigaria o componente inteiro a re-renderizar a cada pixel do mouse.
    <div ref={molduraRef} className={`${MOLDURA} ${className}`}>
      <FronteiraDeErro
        aoFalhar={
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-md">
              <Notice tone="warning">
                A visualização 3D não pôde ser desenhada neste dispositivo. Os dados estão corretos —
                o mapa 2D do Pulmão mostra os mesmos endereços.
              </Notice>
            </div>
          </div>
        }
      >
        {/* Sem `background` na cena: o fundo é a div, em `bg-surface-2`. Assim o tema
            continua vindo dos tokens em vez de um hex paralelo dentro do WebGL. */}
        <Canvas
          camera={{ position: posicaoCamera, fov: FOV_BASE, near: 0.1, far: Math.max(200, distancia * 4) }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          // Em repouso a cena NÃO é redesenhada. Ver `temAnimacao`: `demand` faz o fiber
          // desenhar só quando algo pede, e orbitar continua fluido porque o
          // OrbitControls do drei emite `change` a cada passo do amortecimento, e cada
          // `change` pede um quadro — o amortecimento se auto-sustenta até assentar.
          frameloop={temAnimacao ? 'always' : 'demand'}
          onPointerMissed={() => setSelecionada(null)}
        >
          <EnquadramentoResponsivo />
          <Cena
            vagas={{ solidas, divergentes, raioX, fiosAtivos, fiosAtenuados, comCarga, achadas }}
            estrutura={{ colunas, montantes, diagonais, travessas, placas }}
            cenario={{
              fundo,
              chaveDeSombra,
              extensao,
              deslocamento,
              deslocamentoAtivo,
              plantaNoPiso,
            }}
            builder={{
              modoVisor,
              ferramenta,
              estanteEscolhida,
              objetos,
              selecionadoNoBuilder,
              onConstruir: construirObjeto,
              onSelecionarObjeto: setSelecionadoNoBuilder,
              onGirarObjeto: girarObjeto,
              onExcluirObjeto: excluirObjeto,
            }}
            interacao={{
              assinarHover,
              selecionada,
              contornoDaVaga,
              caminhando,
              onHover: apontar,
              onSelect: selecionar,
            }}
            plantaFisica={plantaFisica}
            rota={rota}
            marcadores={marcadores}
            theme={theme}
          />
          {/* Os dois controles são mutuamente exclusivos: ambos montados, cada um
              mexeria na mesma câmera por conta própria e a vista brigaria consigo mesma. */}
          {caminhando ? (
            <>
              <PointerLockControls />
              <Caminhada caixas={colisao.caixas} cerca={colisao.cerca} />
            </>
          ) : (
            <OrbitControls
              ref={controlsRef}
              enableDamping
              dampingFactor={0.08}
              // Também proporcionais: um teto fixo prenderia a câmera dentro de um
              // armazém grande, impedindo justamente a vista geral que o 3D existe para dar.
              minDistance={2}
              maxDistance={distancia * 2.5}
              // Trava acima do piso: por baixo do chão não existe ponto de vista real no
              // armazém, e chegar lá é o jeito mais rápido de o operador se perder.
              maxPolarAngle={Math.PI / 2.05}
            />
          )}

          {/* Dentro do Canvas porque é onde `useFrame` existe. Nenhum dos dois desenha
              nada: um lê a câmera para o radar, o outro conduz a transição do clique. */}
          <SondaDeCamera controlsRef={controlsRef} aoAtualizar={atualizarRadar} />
          <PanSuave
            controlsRef={controlsRef}
            destinoRef={destinoRef}
            aoParar={() => setVoando(false)}
          />
          <CapturadorDeCena registrar={registrarCapturador} />
        </Canvas>
      </FronteiraDeErro>

      {/* O HUD inteiro — legenda, modo, pavimento, busca, rota, filtros, builder e o modal
          de ajuste — vive em `viewer3d/Hud3D`. As props vão agrupadas por assunto. */}
      <Hud3D
        legenda={{ modo, contagem, contagemAbc, abc, abcFalhou }}
        visao={{
          modoVisor,
          mostrarPlantaFisica,
          origemDaPlanta: plantaMedida.origem,
          pavimentos,
          andar,
          caminhando,
          fundo,
          telaCheia,
          suportaTelaCheia,
        }}
        busca={{ busca, buscando, achados, achadas, rota, rotaAberta, paradaAtual }}
        filtros={{
          ruas,
          ruasSelecionadas,
          filtro,
          alertasGiro,
          divergentes,
          emDestaque,
          totalDeVagas: vagas.length,
          naoPosicionaveis: estado.dados.naoPosicionaveis.length,
        }}
        builder={{
          ferramenta,
          estanteEscolhida,
          corEscolhida,
          objetos,
          selecionadoDoTipoEstante,
          salvandoPecas,
          erroAoSalvar,
          salvoEm,
        }}
        acoes={{
          setModo,
          setModoVisor,
          setMostrarPlantaFisica,
          setAndar,
          setBusca,
          setFiltro,
          setRuasSelecionadas,
          limparRuas: () => setRuasSelecionadas(new Set()),
          setRotaAberta,
          setParadaAtual,
          setCaminhando,
          setFundo,
          alternarTelaCheia,
          setAjustando,
          setFerramenta,
          setEstanteEscolhida,
          setCorEscolhida,
          setSelecionadoNoBuilder,
          ajustarObjeto,
          salvarConstrucao,
          focarVaga,
          voarAteParada,
          resetarCamera,
          capturarCena,
          trocarLayout,
        }}
        layout={layout}
        ajustando={ajustando}
        theme={theme}
      />


      {/* A coluna da direita: gaveta de detalhe em cima, radar embaixo.
          Antes os dois se posicionavam sozinhos — a gaveta em `top-3` podendo crescer
          até quase a moldura inteira, o radar cravado em `bottom-3` — e quando a vaga
          tinha muitos SKUs a gaveta simplesmente passava por cima do radar. Quem vencia
          era a ordem de pintura, não uma decisão.
          Numa coluna flex o navegador faz a conta: a gaveta recebe o espaço que sobra
          (`flex-1 min-h-0`, então ela rola por dentro), o radar guarda o dele
          (`shrink-0`). Sobrepor deixa de ser possível em vez de ser improvável.
          `pointer-events-none` na coluna para o espaço vazio entre os dois não roubar o
          arrasto da câmera; cada painel devolve `pointer-events-auto` para si. */}
      <div className="pointer-events-none absolute bottom-3 right-3 top-3 flex w-[19rem] max-w-[calc(100%-1.5rem)] flex-col items-end gap-2">
        {selecionada && (
          <PainelDetalhe
            slot={selecionada}
            abc={abc.porVaga.get(selecionada.id)}
            onFechar={() => setSelecionada(null)}
            onScanRequest={onScanRequest}
            // Esquece o conteúdo ao mandar a vaga para a movimentação: a pessoa vai mexer
            // no saldo justamente dela, e voltar encontrando o número antigo seria o cache
            // mentindo sobre o que acabou de acontecer.
            onOperate={onOperate ? slot => { esquecerConteudoDaVaga(slot.id); onOperate(slot); } : undefined}
            // Fecha a gaveta ao procurar: o resultado da busca é a CENA acendendo vários
            // endereços, e o painel aberto por cima esconderia metade deles.
            onProcurarSku={sku => { setBusca(sku); setSelecionada(null); }}
          />
        )}

        {/* `mt-auto`: sem a gaveta, o radar continua colado embaixo, que é onde ele
            sempre esteve. */}
        {celulasRadar.length > 0 && (
          <div className="mt-auto">
            <Radar
              celulas={celulasRadar}
              area={areaRadar}
              theme={theme}
              aberto={radarAberto}
              onAlternar={() => setRadarAberto(a => !a)}
              onIrPara={irParaNoRadar}
              grupoRef={radarGrupoRef}
              coneRef={radarConeRef}
            />
          </div>
        )}
      </div>
    </div>
  );
}
```


### 4.8 Tudo que vive dentro do `<Canvas>`

#### `src/components/wms/viewer3d/Cena3D.tsx`  _(1700 linhas)_

```tsx
// Tudo que vive DENTRO do `<Canvas>`: a cena, os lotes instanciados, a estrutura da
// planta, o realce do hover e a caminhada.
//
// Extraído de `Warehouse3DViewer.tsx` no fatiamento do módulo, sem mudança de
// comportamento. O corte é por fronteira real: daqui para dentro é WebGL e `useFrame`;
// de lá para fora é HUD, estado e carregamento de dado.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  BoxGeometry, MeshStandardMaterial, PerspectiveCamera, SRGBColorSpace, TextureLoader,
  MeshBasicMaterial, Vector3, type InstancedMesh, type Texture,
} from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import type { ElementRef, MutableRefObject, RefObject } from 'react';
import type { Theme } from '../../../lib/useTheme';
import type { Slot } from '../../../lib/wms/warehouse3dSlots';
import {
  pecasDaFileira, posicoesDaFileira, LARGURA_DO_PREDIO,
  type BlocoFisico, type PecaDaFileira,
} from '../../../lib/wms/warehouse3dPlantaFisica';
import type { ContextoDeDestaque } from '../../../lib/wms/warehouse3dDestaque';
import { lotesDaPlanta, type InstanciaDeVao } from '../../../lib/wms/warehouse3dLotesDaPlanta';
import { deslizar, pontoDeEntrada, type CaixaPlana } from '../../../lib/wms/warehouse3dColisao';
import type { Ponto } from '../../../lib/wms/warehouse3dCoordenadas';
import { grausDeVisao, meiaAberturaHorizontal } from '../../../lib/wms/warehouse3dRadar';
import type { ParadaDaRota, Ponto3D, SubidaDaRota } from '../../../lib/wms/warehouse3dRota';
import type { AbcDaVaga } from '../../../lib/wms/warehouse3dAbc';
import {
  ESTRUTURA,
  type PecaDaEstrutura, type PecaInclinada,
} from '../../../lib/wms/warehouse3dEstrutura';
import { WarehouseEnvironment, type FundoDaCena } from '../WarehouseEnvironment';
import {
  ALTURA_DOS_OLHOS, ALTURA_DO_PALETE, ALTURA_DO_PISO_DO_VAO, CATALOGO, CORES_DE_ESTANTE,
  COR_ATENUADA, COR_BUILDER, COR_BUSCA, COR_GRADE, COR_PULSO,
  COR_REALCE, COR_VAGA, ESTANTES, PASSO_GRADE_BUILDER,
  RAIO_DO_CAMINHANTE, VELOCIDADE_A_PE, alturaDoCentro, corDaVaga,
  type FerramentaBuilder, type ModoCor, type ModoVisor, type ObjetoConstruido,
  type PecaDoCatalogo, type TipoConstruido, type TipoDeEstante,
} from './aparencia';
import {
  CAMADAS_NO_VAO, COR as COR_ESCRATCH, COR_DIVISAO_CAIXA, DESLOCA_CARGA, DESLOCA_PALETE,
  ESCALA, GEOMETRIA_ARESTAS_CAMADA, PONTOS_DO_CONTORNO,
  GEOMETRIA_CARGA,
  GEOMETRIA_MARCADOR, GEOMETRIA_PALETE, GEOMETRIA_TRAVESSA_RACK,
  GEOMETRIA_UNITARIA, GEOMETRIA_VAGA, GEOMETRIA_VIGA, MATERIAL_ALERTA,
  MATERIAL_CARGA_ATENUADA, MATERIAL_CARGA_PLANTA, MATERIAL_INVISIVEL,
  MATERIAIS_DA_ESTRUTURA, MATERIAL_MARCADOR, MATERIAL_PISO,
  MATERIAL_PISO_ATENUADO, MATERIAL_PISO_FANTASMA, MATERIAL_RAIOX, MATERIAL_SOLIDO,
  MATERIAL_VIGA, MATRIZ, SEM_ACAO_APONTAR, SEM_ACAO_SELECIONAR, capacidadeDoLote,
  useArestasFundidas, type VagaDesenhavel,
} from './recursos3d';

// ── Cena ───────────────────────────────────────────────────────────────────────
//
// Todas as vagas têm a mesma dimensão, então a geometria é UMA, criada no módulo e
// compartilhada. Construir `new BoxGeometry(...)` dentro do componente alocaria um
// buffer de GPU a cada render, e o three não libera isso sozinho — é o vazamento
// clássico de cena react-three.

/**
 * Um lote de vagas desenhado como UM objeto de GPU.
 *
 * Usa `THREE.InstancedMesh` direto em vez de `<Instances>`/`<Instance>` do drei, e a
 * escolha foi medida, não estética. O drei percorre TODAS as instâncias a cada quadro
 * decompondo e recompondo a matriz de cada uma (`Instances.js`, o `useFrame` que chama
 * `matrixWorld.decompose` por instância). Num armazém, que não se mexe, isso é trabalho
 * jogado fora: com 5.000 vagas a cena caía de 60 para 33 FPS, e o gargalo era CPU, não
 * desenho. Aqui as matrizes são escritas UMA vez por mudança de dado, e o quadro
 * seguinte não custa nada.
 *
 * O outro ganho é do lado React: `<Instance>` seria um componente por vaga — 5.000
 * elementos a reconciliar a cada filtro. Aqui são zero.
 *
 * `key` externa pela capacidade: o buffer do InstancedMesh é alocado em `args` e não
 * cresce sozinho.
 */
export function LoteInstanciado({
  vagas,
  material,
  geometria = GEOMETRIA_VAGA,
  deslocamentoY = 0,
  corUniforme = false,
  onHover,
  onSelect,
}: {
  vagas: VagaDesenhavel[];
  material: MeshBasicMaterial | MeshStandardMaterial;
  /** Vão inteiro (padrão) para o apanhador de clique; carga ou palete para o desenho. */
  geometria?: BoxGeometry;
  /** Altura relativa ao CENTRO do vão. O palete desce até o piso, a carga fica sobre
   *  ele, e o apanhador de clique continua cobrindo o vão inteiro. */
  deslocamentoY?: number;
  /** O palete é madeira em todas as vagas: pintá-lo com a cor de status faria a
   *  estrutura disputar significado com a carga que está em cima dela. */
  corUniforme?: boolean;
  onHover: (slot: Slot | null) => void;
  onSelect: (slot: Slot) => void;
}) {
  const ref = useRef<InstancedMesh>(null);
  // Capacidade com folga: a contagem varia DENTRO dela e só `.count` muda, sem remontar
  // o objeto de GPU a cada vaga que troca de status.
  const capacidade = capacidadeDoLote(vagas.length);

  useEffect(() => {
    const malha = ref.current;
    if (!malha) return;
    vagas.forEach((vaga, i) => {
      MATRIZ.makeTranslation(vaga.posicao[0], vaga.posicao[1] + deslocamentoY, vaga.posicao[2]);
      malha.setMatrixAt(i, MATRIZ);
      if (!corUniforme) malha.setColorAt(i, COR_ESCRATCH.set(vaga.cor));
    });
    malha.count = vagas.length;
    malha.instanceMatrix.needsUpdate = true;
    if (malha.instanceColor) malha.instanceColor.needsUpdate = true;
  }, [vagas, deslocamentoY, corUniforme]);

  return (
    <instancedMesh
      ref={ref}
      args={[geometria, material, capacidade]}
      // `onPointerMove`, não `onPointerOver`: o lote inteiro é UM objeto, então o
      // "entrar" dispara uma vez só. É o movimento que revela a troca de instância.
      onPointerMove={e => {
        e.stopPropagation();
        const alvo = e.instanceId !== undefined ? vagas[e.instanceId] : undefined;
        onHover(alvo ? alvo.slot : null);
      }}
      onPointerOut={() => onHover(null)}
      onClick={e => {
        e.stopPropagation();
        const alvo = e.instanceId !== undefined ? vagas[e.instanceId] : undefined;
        if (alvo) onSelect(alvo.slot);
      }}
    />
  );
}

/**
 * Pulso do alerta: respira a emissividade do material do lote de divergências.
 *
 * Anima o MATERIAL, não as instâncias — é um número por quadro, não um por vaga, então
 * o custo não cresce com o tamanho do armazém.
 *
 * Respeita `prefers-reduced-motion`: para quem pediu menos movimento o alerta fica
 * aceso e parado em vez de piscar. Reduzido, não removido — tirar o brilho faria a
 * divergência sumir no meio da estante, que é o oposto do objetivo.
 */
export function PulsoDeAlerta({ material, ativo }: { material: MeshStandardMaterial; ativo: boolean }) {
  const reduzido = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useFrame(({ clock }) => {
    if (!ativo) {
      material.emissiveIntensity = 0;
      return;
    }
    material.emissiveIntensity = reduzido ? 0.35 : 0.2 + 0.3 * (1 + Math.sin(clock.elapsedTime * 2.6)) / 2;
  });

  return null;
}

/**
 * Montantes do pulmão suspenso: do piso até a base da primeira prateleira.
 *
 * Sem eles, uma estrutura elevada aparece como mercadoria flutuando no ar — o desenho
 * fica bonito e incompreensível. As colunas são o que diz "isto está pendurado a três
 * metros, não empilhado no chão".
 *
 * Desenhadas só onde há elevação: com tudo apoiado no piso (o padrão), este lote fica
 * vazio e não custa nada.
 */
export function Vigas({ colunas }: { colunas: { x: number; z: number; altura: number }[] }) {
  const ref = useRef<InstancedMesh>(null);
  const capacidade = capacidadeDoLote(colunas.length);

  useEffect(() => {
    const malha = ref.current;
    if (!malha) return;
    colunas.forEach((coluna, i) => {
      // A geometria tem 1 m de altura, então escalar em Y dá a altura em metros.
      MATRIZ.makeScale(1, coluna.altura, 1);
      MATRIZ.setPosition(coluna.x, coluna.altura / 2, coluna.z);
      malha.setMatrixAt(i, MATRIZ);
    });
    malha.count = colunas.length;
    malha.instanceMatrix.needsUpdate = true;
  }, [colunas]);

  return <instancedMesh ref={ref} args={[GEOMETRIA_VIGA, MATERIAL_VIGA, capacidade]} />;
}

/**
 * A estante em si: o quadro (montantes e diagonais) e as travessas horizontais.
 *
 * Dois objetos de GPU para o armazém inteiro, não por vaga. A escala por instância é o
 * que permite peças de medidas diferentes dividirem um lote só — é o mesmo recurso que
 * os montantes de elevação já usam.
 *
 * ── Por que montante e diagonal moram no MESMO lote ─────────────────────────────
 * São a mesma peça de aço do ponto de vista do desenho: mesmo material, mesma cor. O
 * que as separa é só a matriz — a diagonal carrega um giro. Em lotes separados a
 * treliça custaria um desenho a mais por nada, e é exatamente assim que a planta física
 * já faz (`EstruturaDaPlanta`, lote `quadro`).
 *
 * Derivada do CONJUNTO de vagas, não de cada uma: o montante é compartilhado entre
 * vãos vizinhos e a travessa corre a rua inteira. Ver `warehouse3dEstrutura`.
 */
export function EstruturaDeRack({
  montantes,
  diagonais,
  travessas,
  theme,
}: {
  montantes: PecaDaEstrutura[];
  diagonais: PecaInclinada[];
  travessas: PecaDaEstrutura[];
  theme: Theme;
}) {
  const refQuadro = useRef<InstancedMesh>(null);
  const refTravessas = useRef<InstancedMesh>(null);
  // Pede o conjunto do tema em vez de pintar um material compartilhado: ninguém aqui pode
  // mais mudar a cor do aço de outro componente.
  const materiais = MATERIAIS_DA_ESTRUTURA[theme];

  /**
   * O quadro na forma que o desenho consome: três medidas e um giro.
   *
   * O montante entra convertido — ele é descrito por um comprimento só, porque se
   * estende num eixo conhecido, e aqui vira a caixa de seção quadrada que ele é.
   */
  const quadro = useMemo<PecaDeQuadro[]>(
    () => [
      ...montantes.map(peca => ({
        centro: peca.posicao,
        tamanho: [ESTRUTURA.montante, peca.comprimento, ESTRUTURA.montante] as Ponto,
      })),
      ...diagonais,
    ],
    [montantes, diagonais],
  );

  useEffect(() => { aplicarPecas(refQuadro.current, quadro); }, [quadro]);

  useEffect(() => {
    const malha = refTravessas.current;
    if (!malha) return;
    travessas.forEach((peca, i) => {
      // A geometria mede 1 no eixo Z; escalar em Z dá o comprimento da rua.
      MATRIZ.makeScale(1, 1, peca.comprimento);
      MATRIZ.setPosition(peca.posicao[0], peca.posicao[1], peca.posicao[2]);
      malha.setMatrixAt(i, MATRIZ);
    });
    malha.count = travessas.length;
    malha.instanceMatrix.needsUpdate = true;
  }, [travessas]);

  return (
    <>
      <instancedMesh
        ref={refQuadro}
        args={[GEOMETRIA_UNITARIA, materiais.coluna, capacidadeDoLote(quadro.length)]}
      />
      <instancedMesh
        ref={refTravessas}
        args={[GEOMETRIA_TRAVESSA_RACK, materiais.travessa, capacidadeDoLote(travessas.length)]}
      />
    </>
  );
}

/**
 * Marcador de giro mal posicionado: item de curva A fora da face de piso.
 *
 * Flutua ACIMA da vaga em vez de colori-la porque a cor da vaga já está dizendo outra
 * coisa — a curva. Sobrescrever a cor apagaria a informação que fez o alerta existir.
 *
 * Instanciado como as vigas: um objeto de GPU para todos os marcadores. Na prática a
 * lista é curta (hoje, um), mas o custo não cresce se o armazém crescer.
 */
export function MarcadoresDeGiro({ pontos }: { pontos: [number, number, number][] }) {
  const ref = useRef<InstancedMesh>(null);
  const capacidade = capacidadeDoLote(pontos.length);

  useEffect(() => {
    const malha = ref.current;
    if (!malha) return;
    pontos.forEach(([x, y, z], i) => {
      MATRIZ.identity();
      MATRIZ.setPosition(x, y, z);
      malha.setMatrixAt(i, MATRIZ);
    });
    malha.count = pontos.length;
    malha.instanceMatrix.needsUpdate = true;
  }, [pontos]);

  return <instancedMesh ref={ref} args={[GEOMETRIA_MARCADOR, MATERIAL_MARCADOR, capacidade]} />;
}

/**
 * Lê a câmera a cada quadro e entrega posição, direção e abertura ao radar.
 *
 * NÃO guarda nada em estado do React. Um `setState` por quadro re-renderizaria o
 * visualizador inteiro 60 vezes por segundo — com o Canvas, os painéis e o SVG do radar
 * junto — e o custo apareceria como queda de FPS na cena, que é exatamente o que a
 * Etapa 3 pede para evitar. O destino dos valores é `setAttribute` em nós já montados.
 *
 * O callback vive num ref porque `useFrame` captura o closure do primeiro render: sem
 * isso, o radar continuaria recebendo as coordenadas calculadas com a geometria antiga
 * depois de qualquer mudança de layout.
 */
export function SondaDeCamera({
  controlsRef,
  aoAtualizar,
}: {
  controlsRef: RefObject<ElementRef<typeof OrbitControls>>;
  aoAtualizar: (x: number, z: number, graus: number, meiaAbertura: number) => void;
}) {
  const callback = useRef(aoAtualizar);
  callback.current = aoAtualizar;
  const anterior = useRef({ x: NaN, z: NaN, graus: NaN, meia: NaN });

  useFrame(({ camera, size }) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const { x, z } = camera.position;
    const alvo = controls.target;
    const graus = grausDeVisao(x, z, alvo.x, alvo.z);
    const perspectiva = camera as PerspectiveCamera;
    const meia = meiaAberturaHorizontal(perspectiva.fov, size.width / Math.max(1, size.height));

    // Com a câmera parada, nada muda — e escrever atributo igual ainda custa. O corte é
    // por diferença mínima perceptível, não por igualdade exata: o amortecimento do
    // OrbitControls nunca para em valores idênticos, então `!==` nunca economizaria nada.
    const p = anterior.current;
    if (
      Math.abs(x - p.x) < 0.004 &&
      Math.abs(z - p.z) < 0.004 &&
      Math.abs(graus - p.graus) < 0.05 &&
      Math.abs(meia - p.meia) < 0.002
    ) {
      return;
    }
    anterior.current = { x, z, graus, meia };
    callback.current(x, z, graus, meia);
  });

  return null;
}

/**
 * Entrega ao HUD uma função que devolve o desenho atual do WebGL em PNG.
 *
 * `gl.render(...)` ANTES de ler é obrigatório. Sem `preserveDrawingBuffer`, o
 * navegador descarta o conteúdo do buffer assim que compõe o quadro, e o
 * `toDataURL` devolve uma imagem em branco — sem erro nenhum, o que faria o botão
 * baixar um PNG vazio e parecer que funcionou. Renderizar e ler no mesmo tique
 * resolve sem ligar `preserveDrawingBuffer`, que penaliza TODO quadro da sessão para
 * servir a um clique ocasional.
 */
export function CapturadorDeCena({ registrar }: { registrar: (fn: (() => string) | null) => void }) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    registrar(() => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL('image/png');
    });
    return () => registrar(null);
  }, [gl, scene, camera, registrar]);

  return null;
}

/** Para onde a câmera está indo. `null` = nenhuma transição em curso. */
export interface DestinoDeCamera {
  alvo: Vector3;
  posicao: Vector3;
}

/**
 * Transição suave da câmera, usada pelo clique no radar.
 *
 * Interpolação exponencial com o delta do quadro, não um passo fixo: passo fixo faz a
 * mesma transição durar tempos diferentes em telas de 60 e de 144 Hz.
 *
 * Qualquer arraste do operador CANCELA a transição. Sem isso, a câmera continuaria
 * puxando para o destino enquanto a pessoa tenta girar a cena — a sensação é de
 * controle travado, e é um jeito rápido de o operador desistir do mapa.
 */
export function PanSuave({
  controlsRef,
  destinoRef,
  aoParar,
}: {
  controlsRef: RefObject<ElementRef<typeof OrbitControls>>;
  destinoRef: MutableRefObject<DestinoDeCamera | null>;
  /**
   * Avisa que a transição acabou — por chegada ou por cancelamento.
   *
   * Existe porque o destino mora num REF, e com `frameloop="demand"` quem não aparece no
   * estado do React não mantém o laço vivo: sem este aviso, a tela não teria como saber
   * que precisa continuar desenhando enquanto a câmera voa, nem quando pode parar.
   */
  aoParar?: () => void;
}) {
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const cancelar = () => {
      destinoRef.current = null;
      aoParar?.();
    };
    controls.addEventListener('start', cancelar);
    return () => controls.removeEventListener('start', cancelar);
  }, [controlsRef, destinoRef, aoParar]);

  useFrame((_, delta) => {
    const destino = destinoRef.current;
    const controls = controlsRef.current;
    if (!destino || !controls) return;

    const fator = 1 - Math.pow(0.0025, Math.min(delta, 0.1));
    controls.target.lerp(destino.alvo, fator);
    controls.object.position.lerp(destino.posicao, fator);
    controls.update();

    // Encerra no destino exato. Interpolação exponencial nunca chega sozinha, e deixar o
    // laço vivo manteria o `update()` rodando para sempre por um resto de milímetro.
    if (controls.target.distanceTo(destino.alvo) < 0.02) {
      controls.target.copy(destino.alvo);
      controls.object.position.copy(destino.posicao);
      controls.update();
      destinoRef.current = null;
      aoParar?.();
    }
  });

  return null;
}

export interface PlacaDeRua {
  rotulo: string;
  x: number;
  y: number;
  z: number;
}

/**
 * Sinalização aérea: a placa que diz em que corredor você está.
 *
 * `<Html>` em vez do `<Text>` do drei por dois motivos. O `<Text>` desenha a tipografia
 * dentro do WebGL com uma fonte própria, o que significa uma fonte a mais para baixar e
 * um texto que não acompanha a escala tipográfica nem o tema do app. O `<Html>` é DOM
 * de verdade: herda `.text-code`, os tokens de cor e o modo escuro sem duplicar nada.
 *
 * `pointerEvents: none` é obrigatório — sem isso a placa interceptaria o clique das
 * vagas que estão atrás dela.
 *
 * A cor de fundo é o token `rail` (a navy #0A2647 da marca), não o slate-900 cru que a
 * especificação sugeriu: a placa passa a pertencer ao produto em vez de parecer um
 * componente de biblioteca.
 */
export function PlacasDeRua({ placas }: { placas: PlacaDeRua[] }) {
  return (
    <>
      {placas.map(placa => (
        <Html
          key={`${placa.rotulo}-${placa.z}`}
          position={[placa.x, placa.y, placa.z]}
          center
          // SEM `distanceFactor`, de propósito. Com ele a placa encolhia junto com a
          // perspectiva e, na vista geral, era pintada em 6x9 PIXELS — um borrão escuro
          // que no tema claro parecia sujeira na tela, não sinalização. Placa de
          // corredor existe para ser lida: como rótulo de mapa, mantém tamanho
          // constante na tela e continua legível em qualquer zoom.
          style={{ pointerEvents: 'none' }}
        >
          {/* `leading-none` e padding apertado: em tamanho fixo a placa não pode pesar
              mais que o armazém que ela rotula. */}
          {/* `w-max max-w-none` é obrigatório, não preferência de estilo.

              Os wrappers que o `<Html>` cria são âncoras absolutas de LARGURA ZERO. O
              index.css tem uma regra global `*, *::before, *::after { max-width: 100% }`
              para barrar overflow horizontal no app inteiro — e 100% de um pai de 0px é
              0px. A placa colapsava para 14px (só padding e borda) com o texto
              transbordando: era isso o "nome bugado".

              `w-max` dimensiona pelo conteúdo e `max-w-none` desarma o teto SÓ aqui
              dentro, sem mexer na guarda global. Medido: de 14px para a largura real do
              texto. */}
          <div className="inline-block w-max max-w-none whitespace-nowrap rounded-control border border-white/25 bg-rail px-1.5 py-0.5 text-code text-[10px] font-semibold leading-none tracking-wide text-rail-fg shadow-panel">
            RUA {placa.rotulo}
          </div>
        </Html>
      ))}
    </>
  );
}

/** O que a cena precisa para desenhar a rota. Montado fora, por `useMemo`. */
export interface RotaDesenhavel {
  paradas: ParadaDaRota[];
  caminho: Ponto3D[];
  subidas: SubidaDaRota[];
}

/**
 * Rota de coleta: por onde andar, em que ordem, e em que altura pegar.
 *
 * Azul da BUSCA, de propósito — não o verde neon pedido. A rota só existe porque uma
 * busca produziu a lista; usar a mesma cor diz "é o mesmo assunto" em vez de somar uma
 * sétima cor a uma cena que já carrega seis significados. O brilho/neon também fica de
 * fora: a Design Constitution trata glow como defeito, e aqui ele não acrescenta
 * informação nenhuma — a direção quem dá é o tracejado em movimento.
 *
 * O tracejado anda no sentido da coleta. É o que transforma uma linha numa INSTRUÇÃO:
 * sem movimento, a mesma linha pode ser lida nos dois sentidos.
 */
export function RotaDeColeta({ rota }: { rota: RotaDesenhavel }) {
  const linhaRef = useRef<ElementRef<typeof Line>>(null);
  const reduzido = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useFrame(({ clock }) => {
    const linha = linhaRef.current;
    if (!linha || reduzido) return;
    // Negativo para o tracejado correr da primeira parada para a última, que é o
    // sentido em que se caminha. Mutação direta no material: nada aqui re-renderiza.
    linha.material.dashOffset = -clock.elapsedTime * 0.35;
  });

  return (
    <>
      {rota.caminho.length > 1 && (
        <Line
          ref={linhaRef}
          points={rota.caminho}
          color={COR_BUSCA}
          lineWidth={3}
          dashed
          dashSize={0.45}
          gapSize={0.3}
        />
      )}

      {/* Subidas até a altura da vaga. Contínuas, não tracejadas: não é caminho, é
          indicação de onde a mercadoria está. */}
      {rota.subidas.map(subida => (
        <Line
          key={`subida-${subida.id}`}
          points={[subida.de, subida.ate]}
          color={COR_BUSCA}
          lineWidth={1.5}
          transparent
          opacity={0.55}
        />
      ))}

      {rota.paradas.map(parada => (
        <Html key={parada.slot.id} position={parada.naVaga} center style={{ pointerEvents: 'none' }}>
          {/* `w-max max-w-none` pelo mesmo motivo das placas de rua: a guarda global
              `max-width: 100%` do index.css colapsaria o rótulo contra a âncora de
              largura zero do drei. A cor vem da constante da cena, como nas legendas —
              não existe par de token `accent`/`accent-fg` para inventar aqui. */}
          <div
            className="inline-block w-max max-w-none whitespace-nowrap rounded-full px-1.5 py-0.5 text-code text-[10px] font-semibold leading-none text-white shadow-panel"
            style={{ backgroundColor: COR_BUSCA }}
          >
            {parada.ordem}
          </div>
        </Html>
      ))}
    </>
  );
}

/**
 * A cena, memoizada.
 *
 * `React.memo` aqui só passou a valer depois que o realce saiu das props: enquanto
 * `realce` chegava por prop, ele mudava a cada movimento do mouse e a memoização não
 * segurava nada. Com o hover num canal próprio, todas as props são memos ou callbacks
 * estáveis — então mover o mouse deixou de reconciliar a cena.
 */
// ── Props agrupadas ──────────────────────────────────────────────────────────────
//
// Eram 36 soltas, e a assinatura não dizia o que andava junto. Agrupadas por assunto, o
// grupo vira a unidade de leitura — e a desestruturação logo abaixo mantém os nomes que o
// corpo já usava, para o agrupamento não virar também uma renomeação.

/** Os lotes de vaga, já classificados pelo filtro e pelo status. */
export interface VagasDaCena {
  solidas: VagaDesenhavel[];
  divergentes: VagaDesenhavel[];
  raioX: VagaDesenhavel[];
  fiosAtivos: VagaDesenhavel[];
  /** Vaga livre FORA do filtro. Desenhada como contorno apagado. */
  fiosAtenuados: VagaDesenhavel[];
  /** Vagas com carga, dentro e fora do filtro: o palete existe nas duas. */
  comCarga: VagaDesenhavel[];
  achadas: VagaDesenhavel[];
}

/** O aço: o que a estante tem de fixo, independente de filtro ou modo de cor. */
export interface EstruturaDaCena {
  colunas: { x: number; z: number; altura: number }[];
  montantes: PecaDaEstrutura[];
  diagonais: PecaInclinada[];
  travessas: PecaDaEstrutura[];
  placas: PlacaDeRua[];
}

/** O galpão em volta e o referencial em que tudo é desenhado. */
export interface CenarioDaCena {
  fundo: FundoDaCena;
  chaveDeSombra: string;
  extensao: number;
  deslocamento: [number, number, number];
  /**
   * Offset da vista ATIVA. Igual a `deslocamento` na vista por código; o offset da planta
   * quando ela está desenhada. Rota e marcadores vivem nele, porque suas coordenadas
   * passaram a ser resolvidas pela vista ativa.
   */
  deslocamentoAtivo: [number, number, number];
  plantaNoPiso: PlantaNoPiso | null;
}

/** O Modo Edição. Nada aqui existe fora dele. */
export interface BuilderDaCena {
  modoVisor: ModoVisor;
  ferramenta: FerramentaBuilder;
  estanteEscolhida: TipoDeEstante;
  objetos: ObjetoConstruido[];
  selecionadoNoBuilder: string | null;
  onConstruir: (x: number, z: number) => void;
  onSelecionarObjeto: (id: string) => void;
  onGirarObjeto: (id: string) => void;
  onExcluirObjeto: (id: string) => void;
}

/** Quem aponta, quem clica e quem está caminhando. */
export interface InteracaoDaCena {
  /** Canal do hover. Função estável, para o realce assinar sem forçar re-render. */
  assinarHover: (ouvinte: (slot: Slot | null) => void) => () => void;
  selecionada: Slot | null;
  /**
   * Contorno da vaga apontada na vista ATIVA — onde ela está e quanto mede.
   *
   * Função, e não lista: a grade devolve a caixa fixa da vaga e a planta devolve o vão
   * daquela fileira, que muda de medida de rua para rua.
   */
  contornoDaVaga: (slot: Slot) => { centro: Ponto; tamanho: Ponto } | null;
  /** Com o ponteiro travado, clique e hover saem de cena — ver `SEM_ACAO`. */
  caminhando: boolean;
  onHover: (slot: Slot | null) => void;
  onSelect: (slot: Slot) => void;
}

/** Tudo que a planta física precisa, ou null quando a vista por código está ligada. */
export interface PlantaDaCena {
  blocos: BlocoFisico[];
  mesas: BlocoFisico[];
  /** Comprimento total em metros, já calculado a partir das medidas carregadas. */
  comprimento: number;
  vagasPorCodigo: Map<string, Slot>;
  modoCor: ModoCor;
  maxCaixas: number;
  abcPorVaga: ReadonlyMap<string, AbcDaVaga>;
  /** Filtro de rua, filtro de status, busca e pulso — o mesmo da vista por código. */
  destaque: ContextoDeDestaque;
}

export const Cena = memo(function Cena({
  vagas,
  estrutura,
  cenario,
  builder,
  interacao,
  plantaFisica,
  rota,
  marcadores,
  theme,
}: {
  vagas: VagasDaCena;
  estrutura: EstruturaDaCena;
  cenario: CenarioDaCena;
  builder: BuilderDaCena;
  interacao: InteracaoDaCena;
  plantaFisica: PlantaDaCena | null;
  rota: RotaDesenhavel | null;
  marcadores: [number, number, number][];
  theme: Theme;
}) {
  const { solidas, divergentes, raioX, fiosAtivos, fiosAtenuados, comCarga, achadas } = vagas;
  const { colunas, montantes, diagonais, travessas, placas } = estrutura;
  const { fundo, chaveDeSombra, extensao, deslocamento, deslocamentoAtivo, plantaNoPiso } = cenario;
  const {
    modoVisor, ferramenta, estanteEscolhida, objetos, selecionadoNoBuilder,
    onConstruir, onSelecionarObjeto, onGirarObjeto, onExcluirObjeto,
  } = builder;
  const { assinarHover, selecionada, contornoDaVaga, caminhando, onHover, onSelect } = interacao;
  const [centro, linha] = COR_GRADE[theme];

  // O HUD promete que, caminhando, clicar não abre vaga. Até aqui era só texto: os lotes
  // seguiam com `onClick` registrado, e com o ponteiro travado o raycast usa a última
  // posição conhecida — ou seja, dava para abrir uma vaga sem querer, mirando no nada.
  // Trocar os handlers por funções estáveis que não fazem nada é o que cumpre a promessa.
  const aoSelecionar = caminhando ? SEM_ACAO_SELECIONAR : onSelect;
  const aoApontar = caminhando ? SEM_ACAO_APONTAR : onHover;
  const arestasDaCarga = useArestasFundidas(solidas, GEOMETRIA_ARESTAS_CAMADA, CAMADAS_NO_VAO);
  const arestasAchadas = useArestasFundidas(achadas);
  // Vaga livre volta a ter contorno. `fundirArestas` sempre esteve aqui para isto — o
  // lote vinha sendo calculado e nunca chegava à cena, e o resultado é que a legenda
  // contava "Livre 207" sem nenhuma delas aparecer no desenho.
  const arestasLivres = useArestasFundidas(fiosAtivos);
  const arestasLivresAtenuadas = useArestasFundidas(fiosAtenuados);

  return (
    <>
      {/* Duas luzes. A ambiente sozinha achata todas as faces no mesmo tom e o cubo
          vira um hexágono chapado; a direcional é o que devolve a aresta entre topo e
          lateral — ou seja, o que faz ler como volume. */}
      {/* Dois cenários mutuamente exclusivos. O "limpo" é EXATAMENTE o que a tela
          sempre mostrou — mesmas luzes, mesma grade —, para que trocar o fundo nunca
          seja um caminho sem volta. O galpão traz as próprias luzes; somá-las às daqui
          estouraria a cena. */}
      {fundo === 'galpao' ? (
        <WarehouseEnvironment extensao={extensao} theme={theme} chaveDeSombra={chaveDeSombra} />
      ) : (
        <>
          <ambientLight intensity={theme === 'dark' ? 1.15 : 1.35} />
          <directionalLight position={[6, 12, 8]} intensity={theme === 'dark' ? 1.6 : 2.1} />

          {/* Piso. Sem referência de chão, orbitar desorienta: os cubos parecem flutuar
              no vazio e some a noção de qual rua está na frente. */}
          <gridHelper args={[extensao, Math.max(1, Math.round(extensao)), centro, linha]} position={[0, 0, 0]} />
        </>
      )}

      {/* Grade de construção. Separada da grade decorativa acima de propósito: aquela
          só existe no fundo "limpo" e serve para não perder a noção de chão ao orbitar;
          esta precisa aparecer TAMBÉM dentro do galpão, porque é nela que se mira para
          posicionar estrutura. Fica 1 cm acima do piso para não brigar por z-fighting
          com a laje do cenário. */}
      {/* Fora do bloco de Modo Edição: a planta é referência dos DOIS modos — no
          operacional ela diz onde a vaga fica no galpão de verdade. */}
      {plantaNoPiso && <PlantaDesenhadaNoPiso planta={plantaNoPiso} theme={theme} />}

      {plantaFisica && (
        <PlantaFisica3D
          blocos={plantaFisica.blocos}
          mesas={plantaFisica.mesas}
          comprimento={plantaFisica.comprimento}
          vagasPorCodigo={plantaFisica.vagasPorCodigo}
          modoCor={plantaFisica.modoCor}
          maxCaixas={plantaFisica.maxCaixas}
          abcPorVaga={plantaFisica.abcPorVaga}
          destaque={plantaFisica.destaque}
          theme={theme}
          onSelecionarVaga={aoSelecionar}
          onApontarVaga={aoApontar}
        />
      )}

      {/* Rota e marcador de giro valem para as DUAS vistas, então saíram de dentro do
          grupo da grade por código e passaram a viver no offset da vista ativa. Suas
          coordenadas já vêm resolvidas pela vista que está na tela; o que muda aqui é só
          onde o grupo é centrado. */}
      <group position={deslocamentoAtivo}>
        {/* Alerta de giro. Lista vazia fora do modo Curva ABC — e vazia também dentro
            dele quando não há item de alto giro em nível elevado, que é o resultado
            correto e não uma falha de carregamento. */}
        <MarcadoresDeGiro pontos={marcadores} />
        {rota && <RotaDeColeta rota={rota} />}

        {/* Realce da vaga sob o cursor (ou da selecionada). Um objeto só, desenhado por
            cima — contorno por instância não existe em InstancedMesh, e emitir um objeto
            extra apenas para o item apontado custa muito menos que abrir mão do lote.
            Vive AQUI, e não dentro de uma das vistas: apontar uma vaga acontece nas duas,
            e enquanto ele morava no ramo da grade a planta — que é o padrão da tela —
            recebia o hover, trocava o cursor e não desenhava contorno nenhum.
            Componente próprio, assinando o canal de hover: o movimento do mouse
            re-renderiza este contorno e mais nada. */}
        <RealceDaVaga
          assinar={assinarHover}
          selecionada={selecionada}
          contornoDe={contornoDaVaga}
          theme={theme}
        />
      </group>

      {modoVisor === 'edicao' && (
        <>
          <gridHelper
            args={[
              Math.ceil(extensao / PASSO_GRADE_BUILDER) * PASSO_GRADE_BUILDER,
              Math.ceil(extensao / PASSO_GRADE_BUILDER),
              linha,
              linha,
            ]}
            position={[0, 0.01, 0]}
          />
          <Construcao
            ferramenta={ferramenta}
            estanteEscolhida={estanteEscolhida}
            objetos={objetos}
            selecionado={selecionadoNoBuilder}
            extensao={extensao}
            theme={theme}
            onConstruir={onConstruir}
            onSelecionar={onSelecionarObjeto}
            onGirar={onGirarObjeto}
            onExcluir={onExcluirObjeto}
          />
        </>
      )}

      {/* As vagas montadas pelo CÓDIGO. Saem de cena enquanto a planta física está
          desenhada: as duas juntas foi o que produziu o mapa errado por cima do desenho
          certo — grade regular atravessando fileira posicionada por medida. */}
      {!plantaFisica && (
      <group position={deslocamento}>
        {/* Montantes, quando o pulmão é suspenso. */}
        <Vigas colunas={colunas} />

        {/* Sinalização aérea do corredor. */}
        <PlacasDeRua placas={placas} />

        {/* A estante física. Vem antes da carga para o pallet ser desenhado dentro do
            vão que ela delimita. */}
        <EstruturaDeRack
          montantes={montantes}
          diagonais={diagonais}
          travessas={travessas}
          theme={theme}
        />

        {/* Paletes de madeira sob toda vaga com carga — inclusive as que estão fora do
            filtro: a estrutura não é filtrada, só o que ela guarda. */}
        <LoteInstanciado
          vagas={comCarga}
          material={MATERIAIS_DA_ESTRUTURA[theme].palete}
          geometria={GEOMETRIA_PALETE}
          deslocamentoY={DESLOCA_PALETE}
          corUniforme
          onHover={aoApontar}
          onSelect={aoSelecionar}
        />

        {/* Vagas com conteúdo: um único objeto de GPU para todas. */}
        <LoteInstanciado
          vagas={solidas}
          material={MATERIAL_SOLIDO}
          geometria={GEOMETRIA_CARGA}
          deslocamentoY={DESLOCA_CARGA}
          onHover={aoApontar}
          onSelect={aoSelecionar}
        />

        {/* Divisão entre as duas camadas de caixas do pallet, e o contorno externo. É o
            que faz o bloco ser lido como CAIXAS empilhadas em vez de um volume sólido. */}
        <lineSegments geometry={arestasDaCarga}>
          <lineBasicMaterial color={COR_DIVISAO_CAIXA[theme]} transparent opacity={0.55} />
        </lineSegments>

        {/* Divergências em lote próprio, para poderem pulsar sem arrastar o resto. */}
        <PulsoDeAlerta material={MATERIAL_ALERTA} ativo={divergentes.length > 0} />
        <LoteInstanciado
          vagas={divergentes}
          material={MATERIAL_ALERTA}
          geometria={GEOMETRIA_CARGA}
          deslocamentoY={DESLOCA_CARGA}
          onHover={aoApontar}
          onSelect={aoSelecionar}
        />

        {/* Raio-X: vaga com carga que ficou FORA do filtro vira vidro em vez de sumir.
            É o que deixa ver a posição exata do alerta no meio da estante, sem perder a
            noção de onde ele está. O filtro isola, não amputa. */}
        <LoteInstanciado
          vagas={raioX}
          material={MATERIAL_RAIOX}
          geometria={GEOMETRIA_CARGA}
          deslocamentoY={DESLOCA_CARGA}
          onHover={aoApontar}
          onSelect={aoSelecionar}
        />

        {/* Apanhador de clique das vagas livres. A carga não existe aqui, e a estante é
            um objeto só — sem isto o raycast não saberia QUAL vão foi apontado. As
            instâncias cobrem o vão INTEIRO, não só a carga, para a vaga vazia continuar
            clicável. `opacity: 0` em vez de `visible={false}` porque o three não faz
            raycast em objeto invisível. */}
        <LoteInstanciado
          vagas={fiosAtivos}
          material={MATERIAL_INVISIVEL}
          onHover={aoApontar}
          onSelect={aoSelecionar}
        />

        {/* O CONTORNO da vaga livre: o vão vazio da estante, desenhado como aresta.
            Dois lotes, e não um, porque a cor é uniforme dentro de cada geometria
            fundida: o que está no filtro sai na cor de "livre" da legenda, o que ficou
            de fora sai no cinza de fundo. Sem `depthTest={false}` de propósito — o
            contorno é geometria do armazém e deve ser escondido pelo que está na
            frente, ao contrário do realce e dos achados. */}
        <lineSegments geometry={arestasLivres}>
          <lineBasicMaterial color={COR_VAGA[theme].empty} transparent opacity={0.75} />
        </lineSegments>
        <lineSegments geometry={arestasLivresAtenuadas}>
          <lineBasicMaterial color={COR_ATENUADA[theme]} transparent opacity={0.45} />
        </lineSegments>

        {/* Contorno dos resultados da busca, por cima do vidro. É o que faz o produto
            procurado saltar mesmo quando está no fundo da estante. */}
        <lineSegments geometry={arestasAchadas} renderOrder={1}>
          <lineBasicMaterial color={COR_BUSCA} depthTest={false} />
        </lineSegments>

      </group>
      )}
    </>
  );
});


// ── Painel de detalhe ──────────────────────────────────────────────────────────

/**
 * A planta reproduzida em três dimensões, a partir das MEDIDAS.
 *
 * Diferença de origem, e é a diferença que importa: as vagas por código produzem uma
 * grade regular (rua × 4 m, módulo × 1,3 m) que não tem como coincidir com o desenho,
 * porque `PP-E03-N1` não diz onde a rua E fica no prédio. Aqui cada fileira vem com
 * lugar, comprimento e direção lidos da planta, então ela cai em cima do desenho.
 *
 * Os blocos chegam com a origem no canto (X 0→10,3, Z 0→45,2) e são centrados aqui, no
 * mesmo referencial em que a imagem da planta é desenhada — é isso que faz as duas
 * coisas se sobreporem em vez de flutuarem uma sobre a outra.
 */
/**
 * A estrutura da planta: quadros e longarinas, como DOIS objetos de GPU.
 *
 * Antes era um `<mesh>` por peça — 274 deles no térreo. Com a diagonal de
 * contraventamento entrando seriam 604, e o custo não é teórico: cada malha é uma
 * chamada de desenho por quadro. Instanciando, as 604 peças viram duas chamadas, e o
 * número para de crescer quando o galpão crescer.
 *
 * MONTANTE E DIAGONAL DIVIDEM A MALHA porque dividem a cor: no galpão o quadro é uma
 * peça só, pintada de uma cor só, e a longarina é que destaca em laranja. Separá-los
 * por tipo daria dois azuis idênticos em dois objetos.
 *
 * Os materiais são os MESMOS da vista por código, de propósito. Cor própria aqui faria
 * a mesma estante aparecer de duas cores conforme a aba aberta — duas descrições do
 * mesmo galpão é exatamente o que este mapa existe para não ser.
 */
export function EstruturaDaPlanta({ pecas, theme }: { pecas: PecaDaFileira[]; theme: Theme }) {
  const refQuadro = useRef<InstancedMesh>(null);
  const refLongarinas = useRef<InstancedMesh>(null);

  const quadro = useMemo(() => pecas.filter(p => p.tipo !== 'viga'), [pecas]);
  const longarinas = useMemo(() => pecas.filter(p => p.tipo === 'viga'), [pecas]);

  const materiais = MATERIAIS_DA_ESTRUTURA[theme];

  useEffect(() => { aplicarPecas(refQuadro.current, quadro); }, [quadro]);
  useEffect(() => { aplicarPecas(refLongarinas.current, longarinas); }, [longarinas]);

  return (
    <>
      <instancedMesh
        ref={refQuadro}
        args={[GEOMETRIA_UNITARIA, materiais.coluna, capacidadeDoLote(quadro.length)]}
      />
      <instancedMesh
        ref={refLongarinas}
        args={[GEOMETRIA_UNITARIA, materiais.travessa, capacidadeDoLote(longarinas.length)]}
      />
    </>
  );
}

/**
 * Uma peça de estrutura como a matriz de instância a descreve: onde, quanto mede nos
 * três eixos e quanto gira.
 *
 * Estrutural de propósito — `PecaDaFileira` (planta física) e `PecaInclinada` (vista por
 * código) se encaixam aqui sem conversão. As duas vistas desenham a mesma estante, e o
 * desenho não deveria precisar saber de qual delas a peça veio.
 */
export interface PecaDeQuadro {
  centro: Ponto;
  tamanho: Ponto;
  rotacaoZ?: number;
}

/**
 * Escreve posição, tamanho e giro de cada peça na matriz da instância.
 *
 * A ordem importa: girar DEPOIS de escalar inclinaria a peça já deformada, e a diagonal
 * sairia com a seção torta. Aqui a escala entra na rotação (R × S) e a posição é
 * cravada por último, que é o que `setPosition` faz sem mexer na parte linear.
 */
function aplicarPecas(malha: InstancedMesh | null, pecas: readonly PecaDeQuadro[]): void {
  if (!malha) return;
  pecas.forEach((p, i) => {
    if (p.rotacaoZ) MATRIZ.makeRotationZ(p.rotacaoZ);
    else MATRIZ.identity();
    MATRIZ.scale(ESCALA.set(p.tamanho[0], p.tamanho[1], p.tamanho[2]));
    MATRIZ.setPosition(p.centro[0], p.centro[1], p.centro[2]);
    malha.setMatrixAt(i, MATRIZ);
  });
  malha.count = pecas.length;
  malha.instanceMatrix.needsUpdate = true;
}

/**
 * O canal do hover: quem aponta avisa, quem desenha escuta.
 *
 * Existe para tirar `apontada` do estado do componente de cima. Com ele lá, cada
 * movimento do mouse re-renderizava o visualizador inteiro — e, na planta, os ~1.245
 * elementos React dos vãos junto. O dado do hover muda dezenas de vezes por segundo e
 * interessa a UM desenho: o contorno da vaga apontada.
 */
export interface CanalDeHover {
  atual: Slot | null;
  ouvintes: Set<(slot: Slot | null) => void>;
}

/**
 * Contorno da vaga sob o cursor, desenhado por fora do ciclo de render do visualizador.
 *
 * Assina o canal e guarda o próprio estado: por movimento de mouse re-renderiza só este
 * componente. A vaga SELECIONADA continua vindo por prop — ela muda por clique, não por
 * movimento, e um render a mais ali não custa nada.
 */
export function RealceDaVaga({
  assinar,
  selecionada,
  contornoDe,
  theme,
}: {
  assinar: (ouvinte: (slot: Slot | null) => void) => () => void;
  selecionada: Slot | null;
  /**
   * O contorno da vaga na vista ATIVA: onde ela está e quanto mede, em coordenada local.
   *
   * Injetado porque as duas vistas respondem diferente — a grade devolve a caixa fixa da
   * vaga, a planta devolve o vão real daquela fileira. Antes isto era uma lista de vagas
   * da grade, e por isso o realce não existia na planta: a lista não a descrevia, e o
   * componente nem chegava a ser montado lá.
   */
  contornoDe: (slot: Slot) => { centro: Ponto; tamanho: Ponto } | null;
  theme: Theme;
}) {
  const [apontada, setApontada] = useState<Slot | null>(null);

  useEffect(() => assinar(setApontada), [assinar]);

  const alvo = apontada ?? selecionada;
  const contorno = alvo ? contornoDe(alvo) : null;

  return (
    // Arestas de um cubo de 1 m, ESCALADAS: o vão muda de medida por fileira, e um
    // contorno de tamanho fixo desenharia a caixa de uma rua em cima de outra.
    //
    // ── Por que `<Line>` e não `lineSegments` ──────────────────────────────────
    // O `linewidth` do `lineBasicMaterial` é IGNORADO em WebGL: a linha sai sempre com
    // 1 pixel físico, qualquer que seja o valor. Num monitor de densidade 2 isso é meio
    // pixel de tela, e o realce da vaga — que é o que diz "é esta aqui" — ficava mais
    // fino que as arestas da própria estante. O `<Line>` do drei desenha a linha como
    // geometria (Line2), então a espessura vale de verdade.
    //
    // Largura em PIXELS, não em metros: o contorno é sinalização de interface, não peça
    // do armazém. Em metros ele engrossaria ao aproximar e sumiria ao afastar, que é o
    // oposto do que se quer de um indicador.
    //
    // ── Por que não desmonta quando não há alvo ────────────────────────────────
    // `visible` em vez de `return null`: o `<Line>` aloca geometria e material próprios,
    // e desmontar a cada entrada e saída do mouse faria alocação de GPU a cada
    // movimento. Invisível, ele não custa desenho nenhum.
    <Line
      points={PONTOS_DO_CONTORNO}
      segments
      visible={!!contorno}
      position={contorno?.centro ?? ORIGEM}
      scale={contorno?.tamanho ?? UNIDADE}
      color={COR_REALCE[theme]}
      lineWidth={2}
      depthTest={false}
      renderOrder={1}
    />
  );
}

/** Pousos do contorno quando não há vaga apontada. Constantes para a referência ser
 *  estável e não disparar atualização de matriz a cada render. */
const ORIGEM: Ponto = [0, 0, 0];
const UNIDADE: Ponto = [1, 1, 1];

/**
 * Um lote de vãos da planta como UM objeto de GPU.
 *
 * Mesmo recurso do `LoteInstanciado` da vista por código, com uma diferença que obriga a
 * ter os dois: aqui a ESCALA vai por instância. O passo do vão muda por fileira — a rua A
 * tem 13 posições em 15,6 m e a rua E tem 12 em 15 m —, então a geometria é um cubo
 * unitário e a matriz carrega tamanho junto com posição.
 *
 * `instancias` sem handler (o lote fantasma) não recebe clique: ali o lugar existe no
 * desenho e não há vaga para receber mercadoria.
 */
export function LoteDeVaos({
  instancias,
  material,
  corPorInstancia = true,
  vagasPorCodigo,
  onSelecionarVaga,
  onApontarVaga,
}: {
  instancias: InstanciaDeVao[];
  material: MeshStandardMaterial;
  /** O palete é madeira em todo o armazém: a cor vem do material, não da instância. */
  corPorInstancia?: boolean;
  vagasPorCodigo?: ReadonlyMap<string, Slot>;
  onSelecionarVaga?: (slot: Slot) => void;
  onApontarVaga?: (slot: Slot | null) => void;
}) {
  const ref = useRef<InstancedMesh>(null);
  const capacidade = capacidadeDoLote(instancias.length);

  useEffect(() => {
    const malha = ref.current;
    if (!malha) return;
    instancias.forEach((inst, i) => {
      // Escala primeiro, posição depois: `setPosition` não mexe na parte linear.
      MATRIZ.identity();
      MATRIZ.scale(ESCALA.set(inst.tamanho[0], inst.tamanho[1], inst.tamanho[2]));
      MATRIZ.setPosition(inst.centro[0], inst.centro[1], inst.centro[2]);
      malha.setMatrixAt(i, MATRIZ);
      if (corPorInstancia) malha.setColorAt(i, COR_ESCRATCH.set(inst.cor));
    });
    malha.count = instancias.length;
    malha.instanceMatrix.needsUpdate = true;
    if (malha.instanceColor) malha.instanceColor.needsUpdate = true;
  }, [instancias, corPorInstancia]);

  const vagaDe = (id: number | undefined): Slot | null => {
    if (id === undefined || !vagasPorCodigo) return null;
    const codigo = instancias[id]?.codigo;
    return codigo ? vagasPorCodigo.get(codigo) ?? null : null;
  };

  const interativo = !!vagasPorCodigo && (!!onSelecionarVaga || !!onApontarVaga);

  return (
    <instancedMesh
      ref={ref}
      args={[GEOMETRIA_UNITARIA, material, capacidade]}
      // `onPointerMove` e não `onPointerOver`: o lote inteiro é UM objeto, então "entrar"
      // dispara uma vez só — é o movimento que revela a troca de instância.
      onPointerMove={
        interativo
          ? e => {
              e.stopPropagation();
              onApontarVaga?.(vagaDe(e.instanceId));
            }
          : undefined
      }
      onPointerOut={interativo ? () => onApontarVaga?.(null) : undefined}
      onClick={
        interativo
          ? e => {
              const slot = vagaDe(e.instanceId);
              if (!slot) return;
              e.stopPropagation();
              onSelecionarVaga?.(slot);
            }
          : undefined
      }
    />
  );
}

export function PlantaFisica3D({
  blocos,
  mesas,
  comprimento,
  vagasPorCodigo,
  modoCor,
  maxCaixas,
  abcPorVaga,
  destaque,
  theme,
  onSelecionarVaga,
  onApontarVaga,
}: {
  blocos: BlocoFisico[];
  mesas: BlocoFisico[];
  /** Comprimento total do conjunto, em metros — é por ele que a cena é centrada. */
  comprimento: number;
  /** Vaga real de cada código, para o vão saber o que mostrar e o clique saber o que abrir. */
  vagasPorCodigo: Map<string, Slot>;
  modoCor: ModoCor;
  /** Os mesmos dois que a vista por código usa, para as cores não divergirem entre elas. */
  maxCaixas: number;
  abcPorVaga: ReadonlyMap<string, AbcDaVaga>;
  /**
   * Filtro de rua, filtro de status, busca e pulso de tempo real — o MESMO contexto que
   * a vista por código aplica. Antes só o filtro de rua chegava aqui, e por isso buscar
   * um SKU dizia "3 vagas encontradas" sem acender nada na cena.
   */
  destaque: ContextoDeDestaque;
  theme: Theme;
  onSelecionarVaga: (slot: Slot) => void;
  onApontarVaga: (slot: Slot | null) => void;
}) {
  const cores = COR_BUILDER[theme];
  const largura = LARGURA_DO_PREDIO;

  // Todas as peças de todas as fileiras, num conjunto só: é o que permite desenhá-las
  // como duas instâncias em vez de centenas de malhas.
  const pecasDaEstrutura = useMemo(
    () => blocos.filter(b => b.tipo === 'fileira').flatMap(b => pecasDaFileira(b)),
    [blocos],
  );

  const fileiras = useMemo(() => blocos.filter(b => b.tipo === 'fileira'), [blocos]);
  const demarcacoes = useMemo(() => blocos.filter(b => b.tipo === 'expedicao'), [blocos]);

  /**
   * Os vãos agrupados nos sete lotes.
   *
   * A paleta entra resolvida e a cor do modo entra como função: a regra de precedência
   * mora no módulo puro, a paleta mora aqui, e nenhuma das duas precisa da outra para ser
   * conferida.
   */
  const lotes = useMemo(
    () =>
      lotesDaPlanta(
        fileiras,
        vagasPorCodigo,
        destaque,
        {
          pulso: COR_PULSO,
          busca: COR_BUSCA,
          atenuada: COR_ATENUADA[theme],
          fantasma: cores.peca,
        },
        slot => corDaVaga(slot, modoCor, theme, maxCaixas, abcPorVaga),
        { alturaDoPalete: ALTURA_DO_PALETE, alturaDoPiso: ALTURA_DO_PISO_DO_VAO },
      ),
    [fileiras, vagasPorCodigo, destaque, theme, cores.peca, modoCor, maxCaixas, abcPorVaga],
  );

  // Conjunto do tema, sem mutar material nenhum.
  const materiais = MATERIAIS_DA_ESTRUTURA[theme];

  return (
    <group position={[-largura / 2, 0, -comprimento / 2]}>
      {/* Demarcação de solo continua sendo um plano: expedição é tinta no chão. */}
      {demarcacoes.map(b => (
        <mesh key={b.id} position={b.centro}>
          <boxGeometry args={b.tamanho} />
          <meshStandardMaterial color={cores.doca} roughness={0.9} metalness={0} transparent opacity={0.5} />
        </mesh>
      ))}

      {/* A fileira é DECOMPOSTA em quadro (montantes + diagonais) e longarinas. Caixa
          cheia no lugar disso vira muro: some o vão onde o palete entra e some a leitura
          de quantas posições a rua tem. Porta-pallets vazio é quase todo ar. */}
      <EstruturaDaPlanta pecas={pecasDaEstrutura} theme={theme} />

      {/* Mesas de embalagem e baias de expedição. Não guardam endereço: são superfície
          de trabalho, e contá-las como estante inventaria posição que não existe. */}
      {mesas.map(m => (
        <mesh key={m.id} position={m.centro}>
          <boxGeometry args={m.tamanho} />
          <meshStandardMaterial color={cores.fantasma} roughness={0.8} metalness={0} />
        </mesh>
      ))}

      {/* Os VÃOS, em sete lotes instanciados.
          Antes era um `<mesh>` por vão — 311 malhas e ~1.245 elementos React para 215
          endereços, e cada malha é uma chamada de desenho por quadro. O agrupamento é por
          OPACIDADE porque alpha não cabe em `instanceColor`; dentro de cada lote, posição,
          escala e cor vão por instância.
          Clicar num vão abre a MESMA vaga que a vista por código abre — é o mesmo objeto,
          e não duas descrições paralelas do mesmo galpão. */}
      <LoteDeVaos
        instancias={lotes.pisoDestaque}
        material={MATERIAL_PISO}
        vagasPorCodigo={vagasPorCodigo}
        onSelecionarVaga={onSelecionarVaga}
        onApontarVaga={onApontarVaga}
      />
      <LoteDeVaos
        instancias={lotes.pisoAtenuado}
        material={MATERIAL_PISO_ATENUADO}
        vagasPorCodigo={vagasPorCodigo}
        onSelecionarVaga={onSelecionarVaga}
        onApontarVaga={onApontarVaga}
      />
      {/* Fantasma SEM handler: o lugar existe no desenho, a vaga não. */}
      <LoteDeVaos
        instancias={lotes.pisoFantasma}
        material={MATERIAL_PISO_FANTASMA}
      />
      <LoteDeVaos
        instancias={lotes.paleteDestaque}
        material={materiais.palete}
        corPorInstancia={false}
        vagasPorCodigo={vagasPorCodigo}
        onSelecionarVaga={onSelecionarVaga}
      />
      <LoteDeVaos
        instancias={lotes.paleteAtenuado}
        material={materiais.paleteAtenuado}
        corPorInstancia={false}
        vagasPorCodigo={vagasPorCodigo}
        onSelecionarVaga={onSelecionarVaga}
      />
      <LoteDeVaos
        instancias={lotes.cargaDestaque}
        material={MATERIAL_CARGA_PLANTA}
        vagasPorCodigo={vagasPorCodigo}
        onSelecionarVaga={onSelecionarVaga}
        onApontarVaga={onApontarVaga}
      />
      <LoteDeVaos
        instancias={lotes.cargaAtenuada}
        material={MATERIAL_CARGA_ATENUADA}
        vagasPorCodigo={vagasPorCodigo}
        onSelecionarVaga={onSelecionarVaga}
        onApontarVaga={onApontarVaga}
      />

      {/* Rótulo da rua. Único elemento React por fileira que sobrou: é DOM, não WebGL,
          e some junto com a fileira quando ela não tem rua cadastrada. */}
      {fileiras.map(b => {
        const letra = (/^RUA\s+([A-Z]+)$/.exec(b.rotulo) ?? [])[1];
        const noFiltro =
          destaque.ruasSelecionadas.size === 0 || (!!letra && destaque.ruasSelecionadas.has(letra));
        if (!b.rotulo) return null;
        return (
          <Html
            key={b.id}
            center
            distanceFactor={26}
            position={[b.centro[0], b.tamanho[1] + 0.6, b.centro[2]]}
          >
            <span
              className="whitespace-nowrap rounded-control bg-ink-900/85 px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{ opacity: noFiltro ? 1 : 0.35 }}
            >
              {b.rotulo}
              <span className="ml-1 opacity-70">{posicoesDaFileira(b)} pos.</span>
            </span>
          </Html>
        );
      })}
    </group>
  );
}

/** O que o 3D precisa para desenhar a planta no chão: a imagem e o tamanho REAL dela. */
export interface PlantaNoPiso {
  url: string;
  /** Largura da planta em metros: grid_width × cell_size_meters da planta publicada. */
  largura: number;
  /** Profundidade em metros: grid_height × cell_size_meters. */
  profundidade: number;
}

/**
 * A planta do armazém desenhada no piso da cena 3D.
 *
 * É a mesma imagem que o configurador usa de fundo na grade 2D, servida pela mesma URL
 * assinada — não é uma segunda cópia que poderia divergir. O tamanho vem da escala
 * calibrada da planta publicada, então ela ocupa no 3D os metros que ocupa no galpão.
 *
 * ── A textura é carregada à mão, e não por `useTexture` ───────────────────────────
 * `useTexture` do drei suspende, e suspender aqui congelaria a cena inteira enquanto a
 * imagem baixa — inclusive as vagas, que já estão prontas. Carregando por fora, a cena
 * aparece primeiro e a planta entra quando chega.
 *
 * ── Falhar aqui não pode derrubar o mapa ──────────────────────────────────────────
 * URL assinada expira e imagem some. No erro, o componente simplesmente não desenha: o
 * piso fica liso, que é exatamente o que a tela era antes desta camada existir.
 */
export function PlantaDesenhadaNoPiso({ planta, theme }: { planta: PlantaNoPiso; theme: Theme }) {
  const [textura, setTextura] = useState<Texture | null>(null);

  useEffect(() => {
    let cancelado = false;
    const carregador = new TextureLoader();
    carregador.load(
      planta.url,
      t => {
        if (cancelado) { t.dispose(); return; }
        // Sem isto a imagem entra em linear e aparece lavada contra o piso.
        t.colorSpace = SRGBColorSpace;
        setTextura(t);
      },
      undefined,
      () => { if (!cancelado) console.error('[WMS 3D] Não foi possível carregar a planta do piso.'); },
    );
    return () => { cancelado = true; };
  }, [planta.url]);

  useEffect(() => () => { textura?.dispose(); }, [textura]);

  if (!textura) return null;

  return (
    // Entre o piso (-0,01) e as faixas de circulação (0,005): a planta cobre o concreto
    // sem apagar a sinalização pintada por cima dele.
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
      <planeGeometry args={[planta.largura, planta.profundidade]} />
      {/* `color` MULTIPLICA a textura. Planta técnica é quase toda branca, e branco sobre
          o piso claro do tema light é invisível — foi assim que esta camada pareceu não
          existir no primeiro teste. O cinza puxa o fundo da planta para baixo do tom do
          concreto sem tocar nas linhas, que já são escuras. No tema escuro não há o que
          corrigir: branco sobre piso escuro contrasta sozinho. */}
      <meshBasicMaterial
        map={textura}
        color={theme === 'light' ? '#C2C6CE' : '#FFFFFF'}
        transparent
        opacity={0.92}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * Camada de construção do Modo Edição.
 *
 * Três coisas, nesta ordem de profundidade: o plano que captura o ponteiro, o fantasma
 * que segue o cursor, e as peças já colocadas.
 *
 * ── Por que o plano é transparente e não `visible={false}` ────────────────────────
 * O raycaster do three PULA objeto invisível. Com `visible={false}` o plano existiria na
 * cena e nunca seria atingido pelo ponteiro — o fantasma simplesmente não apareceria, sem
 * erro nenhum para explicar. Por isso ele é visível com `opacity: 0`, e `depthWrite`
 * desligado para não recortar o que está atrás dele.
 *
 * ── O estado do fantasma mora AQUI ────────────────────────────────────────────────
 * `onPointerMove` dispara dezenas de vezes por segundo. Guardar a posição no componente
 * de cima redesenharia o armazém inteiro a cada movimento do mouse; aqui só este subtree
 * se redesenha.
 */
export function Construcao({
  ferramenta,
  estanteEscolhida,
  objetos,
  selecionado,
  extensao,
  theme,
  onConstruir,
  onSelecionar,
  onGirar,
  onExcluir,
}: {
  ferramenta: FerramentaBuilder;
  /** Variante que o fantasma deve mostrar — a mesma que a próxima peça vai nascer. */
  estanteEscolhida: TipoDeEstante;
  objetos: ObjetoConstruido[];
  selecionado: string | null;
  extensao: number;
  theme: Theme;
  onConstruir: (x: number, z: number) => void;
  onSelecionar: (id: string) => void;
  onGirar: (id: string) => void;
  onExcluir: (id: string) => void;
}) {
  const [alvo, setAlvo] = useState<[number, number] | null>(null);
  const cores = COR_BUILDER[theme];
  const construindo = ferramenta !== 'navegar';

  /** Tamanho da peça: porta-pallets segue a VARIANTE escolhida, o resto segue o catálogo. */
  const tamanhoDe = (tipo: TipoConstruido, estante: TipoDeEstante): [number, number, number] =>
    tipo === 'porta-pallets' ? ESTANTES[estante].tamanho : CATALOGO[tipo].tamanho;

  const hexDe = (chave: string) =>
    CORES_DE_ESTANTE.find(c => c.chave === chave)?.hex ?? cores.peca;

  const tamanhoAtivo = construindo
    ? tamanhoDe(ferramenta as TipoConstruido, estanteEscolhida)
    : null;

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onPointerMove={e => {
          if (!construindo) return;
          e.stopPropagation();
          // Snap: o metro é a unidade da grade desenhada, então arredondar para inteiro
          // é literalmente encaixar na linha que a pessoa está vendo.
          setAlvo([Math.round(e.point.x), Math.round(e.point.z)]);
        }}
        onPointerLeave={() => setAlvo(null)}
        onClick={e => {
          if (!construindo || !alvo) return;
          e.stopPropagation();
          onConstruir(alvo[0], alvo[1]);
        }}
      >
        {/* Maior que a cena: construir fora do contorno atual do armazém é justamente o
            caso de uso quando o galpão cresce. */}
        <planeGeometry args={[extensao * 2.5, extensao * 2.5]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {tamanhoAtivo && alvo && (
        <mesh
          position={[
            alvo[0],
            CATALOGO[ferramenta as TipoConstruido].noChao
              ? tamanhoAtivo[1] / 2 + 0.02
              : tamanhoAtivo[1] / 2,
            alvo[1],
          ]}
        >
          <boxGeometry args={tamanhoAtivo} />
          <meshStandardMaterial color={cores.fantasma} transparent opacity={0.45} depthWrite={false} />
        </mesh>
      )}

      {objetos.map(obj => {
        const tamanho = tamanhoDe(obj.tipo, obj.estante);
        const peca: PecaDoCatalogo = { ...CATALOGO[obj.tipo], tamanho };
        const ativo = selecionado === obj.id;
        const cor = ativo
          ? cores.selecionada
          : obj.tipo === 'doca'
            ? cores.doca
            : hexDe(obj.cor);
        return (
          <group
            key={obj.id}
            position={[obj.x, alturaDoCentro(peca), obj.z]}
            rotation={[0, obj.rotacaoY, 0]}
          >
            {/* Porta-pallets colocado é DESENHADO como porta-pallets: montantes e
                longarinas, a mesma decomposição da planta. Caixa cheia faria o builder
                construir uma coisa e o mapa mostrar outra. */}
            {obj.tipo === 'porta-pallets' ? (
              <group onClick={e => { e.stopPropagation(); onSelecionar(obj.id); }}>
                {pecasDaFileira({
                  id: obj.id,
                  tipo: 'fileira',
                  centro: [0, tamanho[1] / 2, 0],
                  tamanho,
                  rotulo: '',
                }).map((p, i) => (
                  <mesh key={i} position={[p.centro[0], p.centro[1] - tamanho[1] / 2, p.centro[2]]}>
                    <boxGeometry args={p.tamanho} />
                    <meshStandardMaterial color={cor} roughness={0.6} metalness={0.15} />
                  </mesh>
                ))}
              </group>
            ) : (
              <mesh
                onClick={e => {
                  e.stopPropagation();
                  onSelecionar(obj.id);
                }}
              >
                <boxGeometry args={peca.tamanho} />
                <meshStandardMaterial color={cor} />
              </mesh>
            )}

            {ativo && (
              <Html center distanceFactor={22} position={[0, peca.tamanho[1] / 2 + 0.8, 0]}>
                <div className="flex gap-1 whitespace-nowrap rounded-control border border-edge bg-surface px-1.5 py-1 shadow-control">
                  <button
                    type="button"
                    className="rounded-control px-2 py-1 text-xs text-fg hover:bg-surface-3"
                    onClick={() => onGirar(obj.id)}
                  >
                    Girar 90°
                  </button>
                  <button
                    type="button"
                    className="rounded-control px-2 py-1 text-xs text-red-600 hover:bg-surface-3 dark:text-red-400"
                    onClick={() => onExcluir(obj.id)}
                  >
                    Excluir
                  </button>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}

/**
 * Caminhada em primeira pessoa dentro do galpão.
 *
 * `PointerLockControls` do drei resolve só o OLHAR — travar o ponteiro e girar a câmera.
 * O andar é daqui: W/A/S/D movendo no plano, com a altura presa na dos olhos.
 *
 * ── Por que a frente é achatada antes de normalizar ──────────────────────────────
 * `getWorldDirection` devolve para onde a câmera APONTA, inclusive para cima e para
 * baixo. Usada crua, olhar para o teto faria o W subir voando. Zerar o Y antes de
 * normalizar é o que transforma "para onde olho" em "para onde ando".
 *
 * ── Por que o tempo do quadro entra na conta ─────────────────────────────────────
 * Somar um passo fixo por quadro faria a pessoa andar mais rápido numa máquina que
 * roda a 120 FPS do que numa de 30. Multiplicar pelo delta mantém 2,2 m/s em qualquer
 * uma — é metro por segundo, não metro por quadro.
 */
export function Caminhada({ caixas, cerca }: { caixas: CaixaPlana[]; cerca: CaixaPlana }) {
  const { camera } = useThree();
  const teclas = useRef<Record<string, boolean>>({});

  // Entrada: põe a pessoa DENTRO do galpão, na altura dos olhos, olhando para o centro.
  // Sem isto a caminhada começa de onde a órbita parou — tipicamente a dezenas de metros
  // e lá no alto, de onde W não chega a lugar nenhum em tempo razoável.
  //
  // O ponto é VALIDADO contra as caixas: antes era fixo, e com colisão um ponto dentro de
  // geometria prende a pessoa — ela aperta W e nada acontece, sem nada explicando.
  useEffect(() => {
    // Preferido: o CENTRO do prédio, onde estão as estantes — e não o portão.
    //
    // Medido na planta real: entrando a 92% do comprimento (a área de expedição), as cinco
    // baias de pallet vedam a largura do galpão. Elas deixam vãos de 0,617 m, que o raio de
    // 0,30 m fecha, e a pessoa andava 1,1 m e travava. O centro cai entre as fileiras, que
    // é de onde se anda pelos corredores.
    const preferido: [number, number] = [(cerca.x0 + cerca.x1) / 2, (cerca.z0 + cerca.z1) / 2];
    const [x, z] = pontoDeEntrada(preferido, caixas, cerca, RAIO_DO_CAMINHANTE);
    camera.position.set(x, ALTURA_DOS_OLHOS, z);
    camera.lookAt((cerca.x0 + cerca.x1) / 2, ALTURA_DOS_OLHOS, (cerca.z0 + cerca.z1) / 2);
  }, [camera, caixas, cerca]);

  useEffect(() => {
    const aperta = (e: KeyboardEvent) => { teclas.current[e.code] = true; };
    const solta = (e: KeyboardEvent) => { teclas.current[e.code] = false; };
    window.addEventListener('keydown', aperta);
    window.addEventListener('keyup', solta);
    // Soltar tudo ao sair: com a tecla "presa" no desmonte, voltar para a caminhada
    // começaria andando sozinho.
    return () => {
      window.removeEventListener('keydown', aperta);
      window.removeEventListener('keyup', solta);
      teclas.current = {};
    };
  }, []);

  useFrame((_, delta) => {
    const passo = VELOCIDADE_A_PE * delta;

    const frente = new Vector3();
    camera.getWorldDirection(frente);
    frente.y = 0;
    if (frente.lengthSq() === 0) return;
    frente.normalize();

    const lado = new Vector3().crossVectors(frente, new Vector3(0, 1, 0)).normalize();

    // O passo é calculado numa posição CANDIDATA, não aplicado direto na câmera: é o que
    // permite recusar a componente que bateu e aceitar a outra.
    const origem: [number, number] = [camera.position.x, camera.position.z];
    let dx = 0;
    let dz = 0;
    if (teclas.current.KeyW || teclas.current.ArrowUp) { dx += frente.x * passo; dz += frente.z * passo; }
    if (teclas.current.KeyS || teclas.current.ArrowDown) { dx -= frente.x * passo; dz -= frente.z * passo; }
    if (teclas.current.KeyD || teclas.current.ArrowRight) { dx += lado.x * passo; dz += lado.z * passo; }
    if (teclas.current.KeyA || teclas.current.ArrowLeft) { dx -= lado.x * passo; dz -= lado.z * passo; }

    // Altura fixa: sem isto qualquer imprecisão acumularia e a pessoa afundaria no piso
    // ou subiria devagar sem perceber.
    camera.position.y = ALTURA_DOS_OLHOS;

    if (dx === 0 && dz === 0) return;

    // Cerca de verdade (o contorno do prédio) e colisão eixo a eixo, para encostar na
    // fileira virar deslizar em vez de grudar.
    const [x, z] = deslizar(origem, [origem[0] + dx, origem[1] + dz], caixas, cerca, RAIO_DO_CAMINHANTE);
    camera.position.x = x;
    camera.position.z = z;
  });

  return null;
}
```


### 4.9 Cenário, luz e mapa de ambiente

#### `src/components/wms/WarehouseEnvironment.tsx`  _(234 linhas)_

```tsx
// Cenário do galpão: piso, paredes, marcação de solo e sombra de contato.
//
// 100% cosmético. Nenhuma vaga, nenhum dado, nenhum clique passa por aqui — este
// arquivo não importa nada do Supabase nem do domínio do WMS, e é assim que se garante
// que ele não tem como alterar comportamento.
//
// ── Por que NÃO usa `<Environment preset="...">` ───────────────────────────────
// O `preset` baixa um HDRI de um CDN externo em tempo de execução. Num WMS usado dentro
// do galpão — onde a rede é ruim e o app é PWA justamente por isso — isso significa um
// cenário que às vezes carrega e às vezes não, e uma dependência de terceiros no caminho
// de renderização. Isso continua valendo e continua fora.
//
// ── Por que o `<Environment>` com `<Lightformer>` entrou ───────────────────────
// Sem `preset`, o `<Environment>` não baixa nada: ele RENDERIZA os filhos num cube
// target e usa o resultado como mapa de ambiente. É gerado na máquina, offline, em 128
// pixels.
//
// Entrou porque sem ele o aço não tinha o que refletir. Montante e longarina têm
// `metalness` 0,45 e 0,35, e metal num PBR é quase só reflexo: sem ambiente, o cálculo
// acontece contra o vazio e a estante sai chapada, da cor lisa que o material declara.
// Não era a cor que estava errada — era não haver nada para o aço espelhar.
//
// Três emissores, na posição das luminárias em linha de um galpão: duas faixas no teto,
// uma de lado. `frames={1}` sozinho NÃO basta para cozinhar uma vez só — ver o `memo` em
// `AmbienteDoGalpao`, que é o que de fato segura isso, e a medição que o mostrou.
//
// ── Por que as paredes somem quando se olha de fora ─────────────────────────────
// As quatro paredes têm a normal apontando para DENTRO. O three descarta a face de
// trás, então a parede entre a câmera e o armazém simplesmente não é desenhada. Sem
// isso, afastar a câmera (o `maxDistance` permite) mostraria a tela inteira tapada por
// um retângulo cinza — o cenário esconderia o armazém que ele existe para situar.

import { memo, useMemo } from 'react';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import type { Theme } from '../../lib/useTheme';

export type FundoDaCena = 'galpao' | 'limpo';

/**
 * Concreto polido no claro; concreto de galpão à noite no escuro.
 *
 * O escuro NÃO é o claro invertido: um piso branco no tema escuro vira a coisa mais
 * clara da tela e rouba a atenção das vagas, que são o assunto. No escuro o piso recua.
 */
const PISO: Record<Theme, { cor: string; aspereza: number; metalicidade: number }> = {
  light: { cor: '#E4E2DC', aspereza: 0.38, metalicidade: 0.06 },
  dark: { cor: '#171A21', aspereza: 0.52, metalicidade: 0.04 },
};

const PAREDE: Record<Theme, string> = { light: '#EFEEEA', dark: '#12151C' };

/**
 * O ambiente que o metal reflete.
 *
 * `teto` é a luminária; `fundo` é a claridade difusa que vem do resto do galpão. No tema
 * escuro os dois caem junto — um reflexo branco no escuro faria a estante brilhar mais
 * que no claro, e o aço ficaria sendo a coisa mais luminosa de uma cena noturna.
 *
 * Intensidade moderada de propósito: o ambiente aqui existe para o metal ter o que
 * espelhar, não para virar fonte de luz. Quem ilumina continuam sendo as três luzes.
 */
const AMBIENTE: Record<Theme, { teto: string; fundo: string; forca: number }> = {
  light: { teto: '#FFFFFF', fundo: '#C9D2DE', forca: 1 },
  dark: { teto: '#8FA3BC', fundo: '#20283A', forca: 0.75 },
};

/** Amarelo de marcação de solo — o mesmo papel do amarelo pintado no chão do galpão:
 *  sinalizar circulação. Não é cor semântica do produto e não entra em nenhuma
 *  legenda; por isso pode ser literal aqui sem disputar com o âmbar do alerta. */
const MARCACAO: Record<Theme, string> = { light: '#D9A514', dark: '#7A5E12' };

/**
 * O mapa de ambiente, gerado aqui e sem rede.
 *
 * ── Por que é `memo`, e por que isso não é otimização ──────────────────────────
 * Medido no navegador, com as chamadas de desenho instrumentadas no contexto WebGL
 * vivo: sem o `memo`, CADA quadro desenhado pagava uma pirâmide PMREM completa — 8, 16,
 * 32, 64, 128, 256 e 512 px, ~146 desenhos em render target — contra 29 da cena inteira.
 *
 * A causa está no drei: o `<Environment>` refaz o cozimento num `useMemo` que tem
 * `children` entre as dependências. Como o JSX dos emissores nasce novo a cada render do
 * componente de cima, a dependência mudava sempre e `frames={1}` nunca significava uma
 * vez. Com o `memo`, o componente não re-renderiza enquanto o tema não muda, os filhos
 * mantêm a identidade e o cozimento volta a acontecer uma vez só.
 *
 * A `key` pelo tema é o outro lado disso: o cozimento sendo único, trocar de tema
 * precisa REFAZÊ-LO, senão o aço do tema novo refletiria a iluminação do anterior.
 *
 * `resolution={128}` é o que basta — o reflexo do metal já é embaçado pela própria
 * aspereza do material, e resolução maior só gastaria memória num borrão.
 */
const AmbienteDoGalpao = memo(function AmbienteDoGalpao({ theme }: { theme: Theme }) {
  const ambiente = AMBIENTE[theme];
  return (
    <Environment key={theme} frames={1} resolution={128}>
      {/* Duas faixas no teto, na direção das luminárias em linha de um galpão, e uma
          lateral que impede o lado oposto do montante de fechar em reflexo preto. */}
      <Lightformer
        form="rect"
        intensity={ambiente.forca}
        color={ambiente.teto}
        position={[0, 6, 2]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[10, 2, 1]}
      />
      <Lightformer
        form="rect"
        intensity={ambiente.forca}
        color={ambiente.teto}
        position={[0, 6, -2]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[10, 2, 1]}
      />
      <Lightformer
        form="rect"
        intensity={ambiente.forca * 0.5}
        color={ambiente.fundo}
        position={[-6, 2, 0]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[10, 6, 1]}
      />
    </Environment>
  );
});

interface WarehouseEnvironmentProps {
  /** Maior dimensão do armazém desenhado, em metros do modelo. */
  extensao: number;
  theme: Theme;
  /**
   * Muda quando o conjunto desenhado muda. Serve de `key` para a sombra de contato:
   * ela é calculada UMA vez (`frames={1}`) em vez de a cada quadro, mas precisa ser
   * recalculada quando as vagas mudam — senão ficaria a sombra do armazém anterior, ou
   * a sombra de um armazém vazio, já que os dados chegam depois da montagem.
   */
  chaveDeSombra: string;
}

export function WarehouseEnvironment({ extensao, theme, chaveDeSombra }: WarehouseEnvironmentProps) {
  const piso = PISO[theme];
  // O cenário acompanha o armazém: um galpão de tamanho fixo deixaria um pulmão grande
  // atravessando a parede e um pequeno perdido no meio do nada.
  const lado = extensao * 1.9;
  const meioLado = lado / 2;
  const alturaParede = Math.max(7, extensao * 0.55);

  /** Faixas de circulação: o contorno do armazém e dois corredores transversais.
   *  Poucas e largas, como as pintadas no chão — uma grade inteira viraria textura e
   *  deixaria de ler como sinalização. */
  const faixas = useMemo(() => {
    const comprimento = extensao * 1.45;
    const meio = comprimento / 2;
    const espessura = 0.16;
    const listas: { pos: [number, number, number]; escala: [number, number, number] }[] = [];

    // Contorno.
    for (const z of [-meio, meio]) {
      listas.push({ pos: [0, 0, z], escala: [comprimento, espessura, 1] });
    }
    for (const x of [-meio, meio]) {
      listas.push({ pos: [x, 0, 0], escala: [espessura, comprimento, 1] });
    }
    // Dois corredores transversais, a um terço e a dois terços.
    for (const z of [-meio / 3, meio / 3]) {
      listas.push({ pos: [0, 0, z], escala: [comprimento, espessura, 1] });
    }
    return listas;
  }, [extensao]);

  return (
    <group>
      <AmbienteDoGalpao theme={theme} />

      {/* Luz. Três fontes: a ambiente dá o piso de claridade, a direcional cria a
          aresta entre topo e lateral (sem ela o cubo vira hexágono chapado) e a de
          preenchimento, oposta e fraca, impede que o lado escuro feche em preto —
          é o que um galpão com luminárias em linha de fato faz. */}
      <ambientLight intensity={theme === 'dark' ? 0.95 : 1.15} />
      <directionalLight position={[extensao * 0.5, extensao, extensao * 0.65]} intensity={theme === 'dark' ? 1.35 : 1.75} />
      <directionalLight position={[-extensao * 0.6, extensao * 0.7, -extensao * 0.5]} intensity={theme === 'dark' ? 0.4 : 0.55} />

      {/* Piso. Abaixo de zero para nunca disputar profundidade com o que está apoiado
          nele — coplanar com a base das vagas produziria o tremido do z-fighting. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[lado, lado]} />
        <meshStandardMaterial color={piso.cor} roughness={piso.aspereza} metalness={piso.metalicidade} />
      </mesh>

      {faixas.map((faixa, i) => (
        <mesh key={`faixa-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[faixa.pos[0], 0.005, faixa.pos[2]]}>
          <planeGeometry args={[faixa.escala[0], faixa.escala[1]]} />
          {/* Sem brilho: tinta no chão é fosca, e um amarelo espelhado pareceria
              plástico em vez de demarcação. */}
          <meshStandardMaterial color={MARCACAO[theme]} roughness={0.9} metalness={0} />
        </mesh>
      ))}

      {/* Paredes perimetrais, normais para dentro. */}
      <mesh position={[0, alturaParede / 2, -meioLado]}>
        <planeGeometry args={[lado, alturaParede]} />
        <meshStandardMaterial color={PAREDE[theme]} roughness={0.95} metalness={0} />
      </mesh>
      <mesh position={[0, alturaParede / 2, meioLado]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[lado, alturaParede]} />
        <meshStandardMaterial color={PAREDE[theme]} roughness={0.95} metalness={0} />
      </mesh>
      <mesh position={[-meioLado, alturaParede / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[lado, alturaParede]} />
        <meshStandardMaterial color={PAREDE[theme]} roughness={0.95} metalness={0} />
      </mesh>
      <mesh position={[meioLado, alturaParede / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[lado, alturaParede]} />
        <meshStandardMaterial color={PAREDE[theme]} roughness={0.95} metalness={0} />
      </mesh>

      {/* Sombra de contato: assenta as estantes no chão. `frames={1}` calcula uma vez
          em vez de a cada quadro — o custo de um passe de render por quadro foi
          justamente o que se evitou no radar. A `key` refaz o cálculo quando o conjunto
          desenhado muda. */}
      <ContactShadows
        key={chaveDeSombra}
        frames={1}
        resolution={512}
        position={[0, 0.002, 0]}
        opacity={theme === 'dark' ? 0.5 : 0.4}
        scale={Math.max(20, extensao * 1.6)}
        blur={1.5}
        far={10}
        color="#000000"
      />
    </group>
  );
}
```


### 4.10 Recursos de GPU e paleta

#### `src/components/wms/viewer3d/recursos3d.ts`  _(320 linhas)_

```ts
// Geometrias, materiais e escratch de matriz do mapa 3D — os objetos de GPU.
//
// Extraído de `Warehouse3DViewer.tsx` no fatiamento do módulo, sem mudança de valor.
//
// Todos vivem no ESCOPO DO MÓDULO, e isso não é organização: `new BoxGeometry(...)` dentro
// de um componente alocaria um buffer de GPU a cada render, e o three não libera isso
// sozinho — é o vazamento clássico de cena react-three. Material recriado por render
// recompila shader pelo mesmo motivo.

import { useEffect, useMemo } from 'react';
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, EdgesGeometry, Matrix4,
  MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, Vector3,
} from 'three';
import { VAGA } from '../../../lib/wms/warehouse3dLayout';
import { CARGA, ESTRUTURA, PALETE } from '../../../lib/wms/warehouse3dEstrutura';
import type { Slot } from '../../../lib/wms/warehouse3dSlots';
import type { Theme } from '../../../lib/useTheme';
import { COR_ALERTA_GIRO, COR_COLUNA, COR_PALETE, COR_TRAVESSA } from './aparencia';

export const GEOMETRIA_VAGA = new BoxGeometry(VAGA.largura, VAGA.altura, VAGA.profundidade);
export const GEOMETRIA_ARESTAS = new EdgesGeometry(GEOMETRIA_VAGA);

export interface VagaDesenhavel {
  slot: Slot;
  posicao: [number, number, number];
  cor: string;
  /** Dentro do filtro: recebe eventos e cor plena. Fora: fica de fundo, inerte. */
  ativa: boolean;
}

/**
 * Funde as arestas de N vagas numa única geometria de linhas.
 *
 * Por que não usar `wireframe` no material instanciado, que seria uma linha de código:
 * `wireframe` desenha as arestas dos TRIÂNGULOS, então cada face ganha a diagonal e a
 * vaga livre vira uma malha visual em vez de uma caixa. A leitura "vazio é contorno"
 * se perde no ruído.
 *
 * Fundir preserva a aresta limpa do `EdgesGeometry` e continua sendo UM objeto de GPU,
 * que é o que importa para densidade: 5.000 vagas livres custam o mesmo desenho que
 * uma. O preço é que a cor passa a ser uniforme no lote — por isso há dois lotes,
 * ativo e atenuado, e não um por vaga.
 */
export function fundirArestas(
  vagas: readonly VagaDesenhavel[],
  arestas: EdgesGeometry = GEOMETRIA_ARESTAS,
  /** Repetições verticais, para desenhar a divisão entre camadas de caixas num mesmo
   *  pallet: cada deslocamento reaproveita o mesmo contorno numa altura diferente. */
  deslocamentosY: readonly number[] = [0],
): BufferGeometry {
  const base = arestas.getAttribute('position').array as Float32Array;
  const porVaga = base.length * deslocamentosY.length;
  const destino = new Float32Array(porVaga * vagas.length);

  vagas.forEach((vaga, indice) => {
    const [dx, dy, dz] = vaga.posicao;
    deslocamentosY.forEach((offset, camada) => {
      const salto = indice * porVaga + camada * base.length;
      for (let k = 0; k < base.length; k += 3) {
        destino[salto + k] = base[k] + dx;
        destino[salto + k + 1] = base[k + 1] + dy + offset;
        destino[salto + k + 2] = base[k + 2] + dz;
      }
    });
  });

  const geometria = new BufferGeometry();
  geometria.setAttribute('position', new BufferAttribute(destino, 3));
  return geometria;
}

/** Geometria fundida que se descarta sozinha quando a entrada muda. Sem o dispose, cada
 *  troca de filtro deixaria um buffer órfão na GPU — o three não recolhe isso. */
export function useArestasFundidas(
  vagas: readonly VagaDesenhavel[],
  arestas: EdgesGeometry = GEOMETRIA_ARESTAS,
  deslocamentosY: readonly number[] = [0],
): BufferGeometry {
  const geometria = useMemo(
    () => fundirArestas(vagas, arestas, deslocamentosY),
    [vagas, arestas, deslocamentosY],
  );
  useEffect(() => () => geometria.dispose(), [geometria]);
  return geometria;
}

// Materiais no módulo: nenhum dos dois depende do tema (a cor vem por instância), então
// recriá-los a cada render só geraria recompilação de shader.
export const MATERIAL_SOLIDO = new MeshStandardMaterial({ roughness: 0.72, metalness: 0.05 });
/** Apanhador de clique: ocupa espaço para o raycast e não desenha nada. */
export const MATERIAL_INVISIVEL = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

/**
 * Os materiais da estrutura, UM CONJUNTO POR TEMA — e nenhum deles é mutado.
 *
 * Aço e madeira NÃO são semânticos: montante, travessa e palete têm a mesma cor em todo
 * o armazém, sempre. Quem carrega significado é a CARGA. Se a estrutura mudasse de cor
 * junto, o operador teria dois sinais concorrentes no mesmo lugar.
 *
 * Antes era um singleton por material, com a cor trocada por `.color.set()` em efeitos de
 * três componentes diferentes (`EstruturaDeRack`, `EstruturaDaPlanta`, `PlantaFisica3D`).
 * Funcionava porque esses componentes nunca coexistem — a vista por código e a planta são
 * exclusivas —, mas a garantia era CIRCUNSTANCIAL: bastaria uma terceira vista, ou as duas
 * na tela ao mesmo tempo, para o último efeito a rodar pintar a cena inteira.
 *
 * Com um conjunto por tema, o material deixa de ser estado compartilhado e vira escolha:
 * quem desenha PEDE o conjunto do tema em que está. Ninguém pode mais pintar o aço de
 * outro componente.
 *
 * O preço é oito materiais em vez de quatro. Cada um compila o shader na primeira vez que
 * é usado, e trocar de tema nunca mais recompila nada — o inverso do que a mutação fazia.
 */
const aco = (cor: string, aspereza: number, metalicidade: number) =>
  new MeshStandardMaterial({ color: cor, roughness: aspereza, metalness: metalicidade });

const madeira = (cor: string, translucido = false) =>
  new MeshStandardMaterial({
    color: cor,
    roughness: 0.92,
    metalness: 0,
    ...(translucido ? { transparent: true, opacity: 0.45, depthWrite: false } : {}),
  });

export interface MateriaisDaEstrutura {
  coluna: MeshStandardMaterial;
  travessa: MeshStandardMaterial;
  palete: MeshStandardMaterial;
  /** Palete de vaga fora do filtro. Mesma madeira, translúcida. */
  paleteAtenuado: MeshStandardMaterial;
}

export const MATERIAIS_DA_ESTRUTURA: Record<Theme, MateriaisDaEstrutura> = {
  light: {
    coluna: aco(COR_COLUNA.light, 0.5, 0.45),
    travessa: aco(COR_TRAVESSA.light, 0.55, 0.35),
    palete: madeira(COR_PALETE.light),
    paleteAtenuado: madeira(COR_PALETE.light, true),
  },
  dark: {
    coluna: aco(COR_COLUNA.dark, 0.5, 0.45),
    travessa: aco(COR_TRAVESSA.dark, 0.55, 0.35),
    palete: madeira(COR_PALETE.dark),
    paleteAtenuado: madeira(COR_PALETE.dark, true),
  },
};

/**
 * Os materiais dos sete lotes da planta.
 *
 * Um por combinação de geometria × opacidade, porque é a OPACIDADE que não cabe na
 * instância: `instanceColor` é RGB, alpha é propriedade do material. Os três estados
 * visuais da planta — fantasma, fora do filtro, em destaque — viram materiais, e os vãos
 * se distribuem entre eles.
 *
 * `depthWrite: false` nos translúcidos pelo mesmo motivo do raio-X: num lote só, os vãos
 * deixam de ser ordenados individualmente, e sem isso o vão da frente recortaria o que
 * está atrás dele.
 */
export const MATERIAL_PISO = new MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
export const MATERIAL_PISO_ATENUADO = new MeshStandardMaterial({
  roughness: 0.8, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false,
});
export const MATERIAL_PISO_FANTASMA = new MeshStandardMaterial({
  roughness: 0.8, metalness: 0, transparent: true, opacity: 0.06, depthWrite: false,
});
export const MATERIAL_CARGA_PLANTA = new MeshStandardMaterial({ roughness: 0.72, metalness: 0 });
export const MATERIAL_CARGA_ATENUADA = new MeshStandardMaterial({
  roughness: 0.72, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false,
});
/**
 * Modo raio-X: a vaga fora do filtro vira vidro em vez de sumir.
 *
 * `depthWrite: false` é o que faz funcionar — sem isso o vidro da frente esconderia o
 * alerta atrás dele, que é exatamente o que se quis enxergar. O preço é que vidro
 * sobre vidro não respeita ordem; aceitável, porque o que importa aqui é a posição da
 * vaga em destaque dentro da estante, não o sombreado do contexto.
 */
export const MATERIAL_RAIOX = new MeshBasicMaterial({ transparent: true, opacity: 0.15, depthWrite: false });
/** Viga de sustentação do pulmão suspenso. Cinza de estrutura, nunca semântico. */
export const MATERIAL_VIGA = new MeshStandardMaterial({ color: '#475569', roughness: 0.9, metalness: 0.1 });
/** 1 m de altura de propósito: escalar em Y passa a dar a altura direto em metros. */
// ── Porta-pallets: estrutura, palete e carga ───────────────────────────────────
//
// A carga é MENOR que o vão de propósito. Antes a vaga era um cubo preenchendo o vão
// inteiro, e dois níveis ocupados viravam um bloco contínuo sem leitura de altura. Com
// a folga, cada pallet fica visivelmente separado do de cima e a estante aparece.

export const GEOMETRIA_CARGA = new BoxGeometry(CARGA.largura, CARGA.altura, CARGA.profundidade);
/** Contorno de MEIA carga: repetido em duas alturas, desenha a divisão entre as duas
 *  camadas de caixas do pallet além do contorno externo. */
export const GEOMETRIA_ARESTAS_CAMADA = new EdgesGeometry(
  new BoxGeometry(CARGA.largura, CARGA.altura / 2, CARGA.profundidade),
);
/** As duas camadas, medidas a partir do CENTRO da carga. */
export const CAMADAS_DA_CARGA = [-CARGA.altura / 4, CARGA.altura / 4] as const;

/** Linha que separa as camadas de caixas. Tom da própria carga, só mais escuro — uma
 *  cor nova aqui viraria mais um significado na cena. */
export const COR_DIVISAO_CAIXA: Record<Theme, string> = { light: '#8A6A42', dark: '#6E543A' };

export const GEOMETRIA_PALETE = new BoxGeometry(PALETE.largura, PALETE.altura, PALETE.profundidade);

/** Montante e travessa têm 1 m no eixo que varia; a escala por instância dá o resto. */
export const GEOMETRIA_COLUNA_RACK = new BoxGeometry(ESTRUTURA.montante, 1, ESTRUTURA.montante);
export const GEOMETRIA_TRAVESSA_RACK = new BoxGeometry(0.05, ESTRUTURA.viga, 1);

/**
 * Cubo de 1 m para a estrutura da PLANTA, onde cada peça tem as três medidas próprias
 * (a diagonal ainda gira). Uma geometria por tipo de peça não serviria: a escala por
 * instância é justamente o que permite montante, longarina e diagonal dividirem um
 * objeto de GPU só.
 */
export const GEOMETRIA_UNITARIA = new BoxGeometry(1, 1, 1);
export const ESCALA = new Vector3();

/** Deslocamentos verticais a partir do centro do vão. Constantes: o palete e a carga
 *  ficam sempre na mesma altura relativa, qualquer que seja o nível. */
export const DESLOCA_PALETE = -VAGA.altura / 2 + PALETE.altura / 2;
export const DESLOCA_CARGA = -VAGA.altura / 2 + PALETE.altura + CARGA.altura / 2;

/** As duas camadas já referidas ao centro do VÃO, que é a origem das instâncias.
 *  No módulo, e não dentro do componente: referência estável é o que impede a fusão
 *  das arestas de ser refeita a cada render. */
export const CAMADAS_NO_VAO: readonly number[] = CAMADAS_DA_CARGA.map(c => DESLOCA_CARGA + c);

export const GEOMETRIA_VIGA = new BoxGeometry(0.14, 1, 0.14);
/** Marcador do alerta de giro: losango pequeno, flutuando acima da vaga. Forma própria,
 *  e não um cubo menor, para não ser lido como mais uma vaga. */
export const GEOMETRIA_MARCADOR = new OctahedronGeometry(0.2);
export const MATERIAL_MARCADOR = new MeshStandardMaterial({
  color: COR_ALERTA_GIRO,
  roughness: 0.4,
  metalness: 0.05,
  emissive: COR_ALERTA_GIRO,
  emissiveIntensity: 0.3,
});
/**
 * Material próprio do lote de divergências, para o pulso não contaminar as demais
 * vagas. `emissive` âmbar: é a mesma família do `divergence` do mapa, então o alerta
 * brilha na cor que já significa alerta no resto do produto — e não ganha um vermelho
 * novo que nenhuma outra tela usa.
 */
export const MATERIAL_ALERTA = new MeshStandardMaterial({
  roughness: 0.6,
  metalness: 0.05,
  emissive: new Color('#F59E0B'),
  emissiveIntensity: 0,
});

export const MATRIZ = new Matrix4();
export const COR = new Color();

/**
 * Handlers inertes da caminhada.
 *
 * No escopo do módulo porque precisam ter IDENTIDADE ESTÁVEL: trocados por funções novas
 * a cada render, eles invalidariam os lotes instanciados e a memoização da cena — o preço
 * de cumprir a promessa não pode ser refazer a cena.
 */
export const SEM_ACAO_SELECIONAR = (_slot: Slot): void => undefined;
export const SEM_ACAO_APONTAR = (_slot: Slot | null): void => undefined;

/**
 * Arestas de um cubo de 1 m, para contorno ESCALADO por instância.
 *
 * `GEOMETRIA_ARESTAS` é a caixa fixa da vaga (1,2 × 1,4 × 1,2) e serve à grade por
 * código. Na planta o vão muda de medida por fileira, então o contorno precisa de uma
 * geometria neutra que a escala dimensiona — senão o realce da rua A aparece com o
 * tamanho da rua E.
 */
export const GEOMETRIA_ARESTAS_UNITARIAS = new EdgesGeometry(new BoxGeometry(1, 1, 1));

/**
 * Bloco de alocação dos lotes instanciados.
 *
 * 64 porque é o tamanho que paga: cada bloco são 64 matrizes de 16 floats (4 kB) mais a
 * cor, e um galpão inteiro cabe em poucas dezenas de blocos.
 */
const BLOCO_DE_CAPACIDADE = 64;

/**
 * Capacidade a alocar para um lote de `quantidade` instâncias.
 *
 * ── Por que não alocar exatamente o necessário ──────────────────────────────────
 * A capacidade de um `InstancedMesh` vai no construtor, via `args`, e não cresce sozinha.
 * Com `args` igual ao número exato de instâncias, QUALQUER mudança de contagem recria o
 * objeto: buffer de GPU novo, `instanceColor` novo, o anterior descartado. E contagem
 * muda o tempo todo — uma vaga que esvazia sai do lote "ocupada" e entra no "livre", e os
 * dois remontam.
 *
 * Arredondando para cima em blocos, a contagem passa a variar DENTRO da capacidade e só
 * `.count` muda, que é um número. O objeto de GPU sobrevive.
 *
 * Mínimo de um bloco mesmo para lote vazio: `new InstancedMesh(..., 0)` é válido mas
 * obriga a remontar no instante em que a primeira instância aparece — justamente o que
 * esta função existe para evitar.
 */
export function capacidadeDoLote(quantidade: number, bloco = BLOCO_DE_CAPACIDADE): number {
  if (quantidade <= bloco) return bloco;
  return Math.ceil(quantidade / bloco) * bloco;
}

/**
 * Os 24 vértices das 12 arestas do cubo unitário, como lista de pontos.
 *
 * Mesma forma de `GEOMETRIA_ARESTAS_UNITARIAS`, só que no formato que o `<Line>` do drei
 * consome. Derivada dela, e não digitada à mão, para as duas nunca divergirem.
 *
 * No escopo do módulo porque a referência precisa ser ESTÁVEL: o `<Line>` memoiza a
 * geometria por `points`, e um array novo a cada render reconstruiria o buffer a cada
 * movimento do mouse — exatamente o custo que o realce não pode ter.
 */
export const PONTOS_DO_CONTORNO: [number, number, number][] = (() => {
  const base = GEOMETRIA_ARESTAS_UNITARIAS.getAttribute('position').array as Float32Array;
  const pontos: [number, number, number][] = [];
  for (let i = 0; i < base.length; i += 3) pontos.push([base[i], base[i + 1], base[i + 2]]);
  return pontos;
})();
```

#### `src/components/wms/viewer3d/aparencia.ts`  _(331 linhas)_

```ts
// A linguagem visual do mapa 3D: cor, escala, catálogo e as medidas que o desenho usa.
//
// Extraído de `Warehouse3DViewer.tsx` no fatiamento do módulo. Nada mudou de valor — o
// arquivo existe porque HUD, cena, radar e painel de detalhe precisam das MESMAS cores, e
// cada um importando do componente de cima criaria dependência circular assim que o
// componente passasse a importá-los de volta.
//
// Aqui o hex é inevitável: material de WebGL não lê variável CSS. Então este módulo é o
// ponto único de verdade da paleta da cena — o equivalente a um token.

import type { SegmentedOption } from '../../ui';
import type { Theme } from '../../../lib/useTheme';
import type { Slot, SlotStatus } from '../../../lib/wms/warehouse3dSlots';
import type { AbcClasse, AbcDaVaga } from '../../../lib/wms/warehouse3dAbc';

export const COR_VAGA: Record<Theme, Record<SlotStatus, string>> = {
  light: { empty: '#64748B', occupied: '#C8A070', divergence: '#F59E0B', blocked: '#94A3B8' },
  dark: { empty: '#64748B', occupied: '#A07E57', divergence: '#F59E0B', blocked: '#475569' },
};

/** Escala de ocupação: a MESMA navy em três intensidades, não três cores diferentes.
 *  Tom é quantidade; matiz continua sendo significado. Trocar o matiz aqui faria o
 *  modo de ocupação competir com o de status, e nenhum dos dois seria lido. */
export const ESCALA_OCUPACAO: Record<Theme, [string, string, string]> = {
  light: ['#7C9AC4', '#2F5A8F', '#0A2647'],
  dark: ['#3E6FA8', '#2A5FA3', '#1C4A85'],
};

/** Fora do filtro: presente, porque sumir destruiria a forma do armazém, mas sem
 *  nenhum peso visual. O filtro ISOLA, não amputa. */
export const COR_ATENUADA: Record<Theme, string> = { light: '#D8DEE7', dark: '#262C38' };

export const COR_REALCE: Record<Theme, string> = { light: '#0A2647', dark: '#9FC3F0' };

/**
 * Resultado de busca: azul, não dourado.
 *
 * A especificação ofereceu dourado (#EAB308) ou azul (#3B82F6). Dourado foi descartado
 * porque o âmbar #F59E0B já significa "pede atenção" NESTA MESMA cena — duas cores
 * quase idênticas com significados opostos ("achei o que você pediu" x "isto está
 * errado") treinariam o operador a ler errado as duas. Azul é a família de
 * selecionado/encontrado no resto do produto, então não disputa com o alerta.
 */
export const COR_BUSCA = '#3B82F6';

/** Vaga recém-mexida por OUTRO operador. Transitória — dura dois segundos e some.
 *  Vizinha do azul da busca, e isso é aceitável porque as duas nunca competem pelo
 *  mesmo papel: a busca é um estado que a pessoa escolheu e permanece; isto é um aviso
 *  que ninguém pediu e que se apaga sozinho. O que as distingue é a duração. */
export const COR_PULSO = '#38BDF8';

/** Dois segundos: tempo de perceber sem virar poluição quando o galpão está movimentado. */
export const DURACAO_PULSO = 2000;

/**
 * Curva ABC de giro: UMA matiz em três intensidades, não três cores semânticas.
 *
 * A especificação pediu vermelho #EF4444 para A, âmbar #F59E0B para B e azul #3B82F6
 * para C. Os dois últimos já estão ocupados NESTA MESMA cena: #F59E0B é "acima da
 * capacidade" e #3B82F6 é "resultado da busca". Reusá-los faria o âmbar significar
 * duas coisas opostas ao mesmo tempo — "isto está errado" e "isto gira muito" —, e o
 * operador não tem como saber qual das duas a tela está dizendo.
 *
 * A curva é ORDINAL (A > B > C), exatamente como a ocupação, então segue a mesma regra
 * que já vale aqui: tom é quantidade, matiz é significado. Violeta porque é a única
 * família livre — a navy é ocupação, o âmbar é alerta, o azul é busca.
 *
 * No claro a classe A é a mais ESCURA; no escuro, a mais CLARA. Nos dois casos é a de
 * maior contraste contra o fundo, que é o que faz "alto giro" saltar primeiro.
 */
export const ESCALA_ABC: Record<Theme, Record<AbcClasse, string>> = {
  light: { C: '#C4B0DC', B: '#8257B5', A: '#4C1D7A' },
  dark: { C: '#4A3A68', B: '#8B6BC0', A: '#C9A8F0' },
};

/** Alerta de giro mal posicionado. Vermelho é a única família semântica AINDA LIVRE na
 *  cena, e aqui ela é honesta: isto é um item de ação ("desça este pallet"), não um
 *  estado passivo. O âmbar não serve — já é "acima da capacidade". */
export const COR_ALERTA_GIRO = '#DC2626';

/**
 * Cores da estrutura física. Constantes em toda a cena, nunca semânticas.
 *
 * A referência traz montante azul e travessa laranja, que é o padrão da indústria. A
 * travessa aqui é um laranja QUEIMADO, não o `#F97316` sugerido: esse laranja é
 * vizinho do `#F59E0B` que significa "acima da capacidade" nesta mesma cena, e uma
 * estante inteira pintada quase da cor do alerta faz o alerta desaparecer dentro dela.
 * Queimando o tom, a estrutura recua e o âmbar volta a saltar.
 */
export const COR_COLUNA: Record<Theme, string> = { light: '#27497F', dark: '#2E5668' };
export const COR_TRAVESSA: Record<Theme, string> = { light: '#A8521C', dark: '#8A4418' };
export const COR_PALETE: Record<Theme, string> = { light: '#8A5A2B', dark: '#6B4522' };

export const COR_GRADE: Record<Theme, [string, string]> = {
  light: ['#CBD5E1', '#E2E8F0'],
  dark: ['#2A3140', '#1C212B'],
};

export const LEGENDA: ReadonlyArray<{ status: SlotStatus; rotulo: string }> = [
  { status: 'occupied', rotulo: 'Ocupada' },
  { status: 'empty', rotulo: 'Livre' },
  { status: 'divergence', rotulo: 'Acima da capacidade' },
  { status: 'blocked', rotulo: 'Bloqueada' },
];

/**
 * Filtro de status. Os rótulos dizem o que o filtro DE FATO faz.
 *
 * `divergence` é "acima da capacidade", e só isso. A divergência de contagem cega —
 * "a contagem não bateu" — NÃO é derivável: a contagem é apurada por produto, e
 * `products.location` não casa com código de vaga em nenhum dos 2.174 produtos que
 * têm location preenchido. Chamar este filtro de "contagem cega não bateu" seria um
 * rótulo mentindo sobre o que a tela sabe.
 */
export type FiltroStatus = 'todas' | SlotStatus;

export const FILTROS: ReadonlyArray<{ value: FiltroStatus; rotulo: string }> = [
  { value: 'todas', rotulo: 'Todas as vagas' },
  { value: 'divergence', rotulo: 'Acima da capacidade' },
  { value: 'occupied', rotulo: 'Ocupadas' },
  { value: 'empty', rotulo: 'Livres' },
  { value: 'blocked', rotulo: 'Bloqueadas' },
];

/**
 * Para que serve a cena agora.
 *
 * `operacional` é tudo que esta tela sempre fez: saldo, busca, rota, tempo real. É o
 * padrão e continua idêntico — trocar de modo não pode ser caminho sem volta.
 *
 * `edicao` é o Galpão Builder: a cena deixa de ser só leitura e passa a aceitar
 * construção. Por ora acende a grade de referência do piso; o catálogo e a manipulação
 * de objeto entram nas etapas seguintes.
 */
export type ModoVisor = 'operacional' | 'edicao';

export const MODOS_VISOR: SegmentedOption<ModoVisor>[] = [
  { value: 'operacional', label: 'Operacional' },
  { value: 'edicao', label: 'Edição' },
];

/** Divisão da grade de construção, em metros. Um metro é a unidade em que se fala de
 *  corredor e de vão no galpão — meio metro polui e dois metros não ajuda a mirar. */
export const PASSO_GRADE_BUILDER = 1;

/** Espessura do palete de madeira desenhado dentro do vão, a mesma da estrutura por código. */
export const ALTURA_DO_PALETE = 0.12;

/**
 * Espessura do piso da vaga livre — a chapa sobre a qual o palete apoiaria.
 *
 * 8 cm, e não 2: fina demais ela vira uma linha vista de lado e deixa de ser clicável
 * em ângulo rasante, que é justo o ângulo de quem está caminhando no galpão.
 */
export const ALTURA_DO_PISO_DO_VAO = 0.08;

/** Pavimento em que o mapa abre. Os demais aparecem no seletor quando têm planta. */
export const ANDAR_INICIAL = 1;

/** Altura dos olhos de quem caminha, em metros. */
export const ALTURA_DOS_OLHOS = 1.65;

/** Velocidade da caminhada, em m/s. Passo de quem anda conferindo, não de quem corre. */
export const VELOCIDADE_A_PE = 2.2;

/**
 * Raio do caminhante, em metros — o quanto ele ocupa no piso.
 *
 * 0,30 m medido contra os corredores da planta: no de 1,20 m do prédio atual sobram
 * 0,60 m de passagem livre; no de 2,65 m do galpão novo, 2,05 m. Um raio maior fecharia o
 * corredor estreito, e a pessoa não entenderia por que não passa num lugar onde a
 * empilhadeira passa.
 */
export const RAIO_DO_CAMINHANTE = 0.3;

/** Folga entre a parede e o nariz de quem caminha. */
export const MARGEM_DA_CERCA = 0.2;

// ── Catálogo de construção ───────────────────────────────────────────────────────────
//
// O que o Modo Edição sabe colocar no chão. Tudo vive em ESTADO LOCAL do React: construir
// é imediato e reversível, sem ida ao banco. Gravar é etapa própria — e misturar as duas
// faria cada clique de teste virar uma linha em produção.

export type FerramentaBuilder = 'navegar' | 'porta-pallets' | 'mesa' | 'doca';

export type TipoConstruido = Exclude<FerramentaBuilder, 'navegar'>;

export interface PecaDoCatalogo {
  rotulo: string;
  /** Dimensões em METROS: [largura (X), altura (Y), profundidade (Z)]. */
  tamanho: [number, number, number];
  /**
   * Demarcação de solo em vez de estrutura.
   *
   * Muda onde a peça se apoia: estrutura sobe a partir do piso, demarcação fica rente a
   * ele. Sem a distinção, uma área de doca nasceria flutuando a meia altura.
   */
  noChao: boolean;
}

export const CATALOGO: Record<TipoConstruido, PecaDoCatalogo> = {
  // Um trecho de estante com 3 posições e 3 níveis, nas MESMAS medidas da planta: 1,1 de
  // profundidade, 4,2 de altura, 3,6 de comprimento (3 × 1,2). Colocar um "porta-pallets"
  // que não tem a geometria do porta-pallets desenhado faria o builder construir outra
  // coisa diferente do galpão.
  'porta-pallets': { rotulo: 'Porta-Pallets', tamanho: [1.1, 4.2, 3.6], noChao: false },
  mesa: { rotulo: 'Mesa de expedição', tamanho: [1.6, 0.9, 0.8], noChao: false },
  doca: { rotulo: 'Área de doca', tamanho: [3, 0.04, 3], noChao: true },
};

/** Cores do builder. Hex porque é WebGL, no mesmo padrão de COR_VAGA e COR_GRADE. */
export const COR_BUILDER: Record<Theme, { fantasma: string; peca: string; selecionada: string; doca: string }> = {
  light: { fantasma: '#3E7BE0', peca: '#64748B', selecionada: '#1E5FBF', doca: '#F59E0B' },
  dark: { fantasma: '#7FB3F5', peca: '#475569', selecionada: '#3E7BE0', doca: '#B45309' },
};

/**
 * Variante do porta-pallets.
 *
 * Muda a GEOMETRIA, não só a aparência: o duplo é duas fileiras costa-a-costa, como a
 * dupla central do galpão novo, e o de picking é mais baixo e mais raso. Tratar isso
 * como enfeite faria o builder desenhar um rack e a operação ter outro.
 */
export type TipoDeEstante = 'simples' | 'duplo' | 'picking';

export const ESTANTES: Record<TipoDeEstante, { rotulo: string; tamanho: [number, number, number] }> = {
  simples: { rotulo: 'Simples', tamanho: [1.1, 4.2, 3.6] },
  // Profundidade dobrada: duas fileiras encostadas, sem corredor entre elas.
  duplo: { rotulo: 'Duplo', tamanho: [2.2, 4.2, 3.6] },
  // Picking é para separar à mão: altura de alcance e prateleira rasa.
  picking: { rotulo: 'Picking', tamanho: [0.8, 2.4, 3.6] },
};

/** Cores de estante. Nomes do galpão, não hex, porque é isso que se fala na operação. */
export const CORES_DE_ESTANTE: { chave: string; rotulo: string; hex: string }[] = [
  { chave: 'laranja', rotulo: 'Laranja', hex: '#C8A070' },
  { chave: 'azul', rotulo: 'Azul', hex: '#3E6FA8' },
  { chave: 'cinza', rotulo: 'Cinza', hex: '#64748B' },
  { chave: 'verde', rotulo: 'Verde', hex: '#4B7F62' },
];

export interface ObjetoConstruido {
  id: string;
  tipo: TipoConstruido;
  /** Só faz sentido para porta-pallets; as outras peças ignoram. */
  estante: TipoDeEstante;
  /** Chave de CORES_DE_ESTANTE. */
  cor: string;
  /** Centro em metros, já alinhado à grade. */
  x: number;
  z: number;
  /** Múltiplos de 90°, em radianos. */
  rotacaoY: number;
}

/** Altura do centro da peça para que a BASE encoste no piso. */
export function alturaDoCentro(peca: PecaDoCatalogo): number {
  // Demarcação ganha 2 cm para não brigar por z-fighting com a laje do cenário.
  return peca.noChao ? peca.tamanho[1] / 2 + 0.02 : peca.tamanho[1] / 2;
}

export type ModoCor = 'status' | 'ocupacao' | 'abc';

// Mutável de propósito: `SegmentedControl` recebe `SegmentedOption<T>[]`, não
// ReadonlyArray. Anotar como readonly aqui só obrigaria a copiar no ponto de uso.
export const MODOS: SegmentedOption<ModoCor>[] = [
  { value: 'status', label: 'Status' },
  { value: 'ocupacao', label: 'Ocupação' },
  { value: 'abc', label: 'Curva ABC' },
];

export const LEGENDA_ABC: ReadonlyArray<{ classe: AbcClasse; rotulo: string }> = [
  { classe: 'A', rotulo: 'Curva A — alto giro' },
  { classe: 'B', rotulo: 'Curva B — giro médio' },
  { classe: 'C', rotulo: 'Curva C — baixo giro' },
];

/**
 * Fração de ocupação da vaga.
 *
 * Com capacidade cadastrada, é caixas/capacidade — a medida real. Sem ela, cai para a
 * comparação com a vaga mais cheia do armazém, que é RELATIVA e não diz "cheia", só
 * "mais cheia que as outras". Hoje nenhuma das vagas tem capacidade cadastrada, então
 * na prática é sempre o caminho relativo.
 */
export function fracaoOcupacao(slot: Slot, maxCaixas: number): number {
  if (slot.capacidade !== null && slot.capacidade > 0) return slot.caixas / slot.capacidade;
  return maxCaixas > 0 ? slot.caixas / maxCaixas : 0;
}

export function corDaVaga(
  slot: Slot,
  modo: ModoCor,
  theme: Theme,
  maxCaixas: number,
  abcPorVaga: ReadonlyMap<string, AbcDaVaga>,
): string {
  if (modo === 'status') return COR_VAGA[theme][slot.status];
  if (slot.status === 'empty') return COR_VAGA[theme].empty;
  if (modo === 'abc') {
    const classe = abcPorVaga.get(slot.id)?.classe;
    // Vaga com carga mas sem classe cai no MESMO cinza do que está fora do filtro. Não
    // é descuido: "não sei a curva disto" e "isto não é o que você está olhando agora"
    // pedem o mesmo peso visual — nenhum. Inventar um quarto tom de curva faria
    // "desconhecido" competir por atenção com "alto giro".
    return classe ? ESCALA_ABC[theme][classe] : COR_ATENUADA[theme];
  }
  const escala = ESCALA_OCUPACAO[theme];
  const fracao = fracaoOcupacao(slot, maxCaixas);
  return fracao < 0.4 ? escala[0] : fracao < 0.8 ? escala[1] : escala[2];
}

// ── Câmera ─────────────────────────────────────────────────────────────────────
//
// Três quartos, de cima: a vista que mostra altura e profundidade ao mesmo tempo. De
// frente viraria o mapa 2D que já existe; de cima viraria uma planta baixa.
//
// Isto é a DIREÇÃO do olhar, não a posição final. A distância é calculada a partir do
// tamanho do armazém, porque distância fixa só funciona para um armazém de tamanho
// fixo: calibrada num conjunto 3x4, ela cortava o armazém real, que tem 13 módulos

/**
 * Largura abaixo da qual os painéis flutuantes começam RECOLHIDOS, em pixels.
 *
 * É o `md` do Tailwind. Mora aqui porque HUD e radar decidem a mesma coisa pela mesma
 * régua, e porque um arquivo de componente que exporta constante perde o recarregamento a
 * quente do Vite.
 */
export const LARGURA_ESTREITA = 768;
```


### 4.11 HUD, gaveta de detalhe e radar

#### `src/components/wms/viewer3d/Hud3D.tsx`  _(991 linhas)_

```tsx
// O HUD do mapa 3D: legenda, modo, pavimento, busca, rota, filtros e a barra do builder.
//
// Extraído de `Warehouse3DViewer.tsx` no fatiamento do módulo. Duas mudanças de
// comportamento, as duas de responsividade:
//
//   1. O painel esquerdo COLAPSA. Ele tem 15 rem de largura fixa e vive sobre o canvas;
//      num celular em pé (~380 px) ele comia metade da tela, e a gaveta de detalhe (19
//      rem, à direita) entrava por cima dele. Abaixo de 768 px ele começa recolhido.
//   2. Recolhido, sobra só o botão de abrir — a cena fica inteira à vista, que é o motivo
//      de alguém abrir um mapa 3D num celular.
//
// As props chegam AGRUPADAS por assunto (legenda, visão, busca, filtros, câmera,
// builder). Soltas eram 30 e poucas, e a assinatura escondia o que pertencia a quê.

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Camera, Crosshair, Maximize, Minimize, PanelLeftClose, PanelLeftOpen,
  RotateCcw, ShieldAlert, Sun, SunDim,
} from 'lucide-react';
import {
  Button, Input, Modal, Notice, Panel, PanelSection, Select, SegmentedControl,
} from '../../ui';
import type { Theme } from '../../../lib/useTheme';
import type { Slot, SlotStatus } from '../../../lib/wms/warehouse3dSlots';
import { LAYOUT_PADRAO, LIMITES, baseDaRua, type Layout3DConfig } from '../../../lib/wms/warehouse3dLayout';
import type { AbcClasse, AbcDoArmazem } from '../../../lib/wms/warehouse3dAbc';
import type { ParadaDaRota } from '../../../lib/wms/warehouse3dRota';
import type { FundoDaCena } from '../WarehouseEnvironment';
import {
  CATALOGO, CORES_DE_ESTANTE, COR_ALERTA_GIRO, COR_ATENUADA, COR_VAGA, ESCALA_ABC,
  ESTANTES, FILTROS, LEGENDA, LEGENDA_ABC, MODOS, MODOS_VISOR, PASSO_GRADE_BUILDER,
  LARGURA_ESTREITA,
  type FerramentaBuilder, type FiltroStatus, type ModoCor, type ModoVisor,
  type TipoConstruido, type TipoDeEstante,
} from './aparencia';
import type { VagaDesenhavel } from './recursos3d';
import type { RotaDesenhavel } from './Cena3D';



/**
 * Botão de ícone da fileira de vista.
 *
 * O ícone sozinho não diz nada a quem não o reconhece, nem a um leitor de tela. Por isso
 * o `rotulo` vai nos dois lugares que resolvem isso — `title` para quem passa o mouse,
 * `aria-label` para quem não vê o desenho — e ele descreve a AÇÃO, não o estado.
 *
 * `aria-pressed` só aparece quando o botão é um alternador de verdade. Num botão que
 * apenas dispara (resetar, capturar) ele seria uma promessa de estado que não existe.
 *
 * `h-11` não é estética: é o mínimo de alvo de toque que a Design Constitution exige, e
 * quem usa este mapa no celular está com o telefone na mão dentro do galpão.
 */
function BotaoDeVista({
  rotulo,
  ativo,
  disabled,
  onClick,
  children,
}: {
  rotulo: string;
  ativo?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={rotulo}
      aria-label={rotulo}
      aria-pressed={ativo}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-11 flex-1 items-center justify-center rounded-control border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50 ${
        ativo
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-edge text-fg-muted hover:bg-surface-2 hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

// ── Ajuste da estrutura ────────────────────────────────────────────────────────

/** Campo numérico com unidade e limites do próprio domínio. */
function CampoMetros({
  rotulo,
  ajuda,
  valor,
  min,
  max,
  onMudar,
}: {
  rotulo: string;
  ajuda?: string;
  valor: number;
  min: number;
  max: number;
  onMudar: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-fg">{rotulo}</span>
      {ajuda && <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{ajuda}</span>}
      <div className="mt-1 flex items-center gap-2">
        <Input
          type="number"
          step={0.1}
          min={min}
          max={max}
          value={valor}
          // Campo vazio vira NaN em `Number('')`, e um NaN no eixo Y faz a vaga sumir
          // da cena sem erro nenhum. O valor anterior fica até digitarem um número.
          onChange={e => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onMudar(n);
          }}
          className="w-full"
        />
        <span className="text-xs text-fg-muted">m</span>
      </div>
    </label>
  );
}

/**
 * Ajuste da estrutura física do porta-pallets.
 *
 * Estas medidas NÃO vêm do banco: são propriedade do galpão, não do endereço. Ficam
 * no navegador de quem monta o mapa, e por isso o painel é uma preferência local, não
 * um cadastro — gravar isso como dado da empresa sem alguém decidir seria inventar
 * uma regra de negócio.
 *
 * O que NÃO está aqui, de propósito: número de níveis por rua. Quantos níveis uma rua
 * tem é consequência dos endereços cadastrados, não escolha de exibição. Um campo
 * para isso desenharia vagas que não existem ou esconderia vagas que existem.
 */
function AjusteDeEstrutura({
  aberto,
  onFechar,
  layout,
  ruas,
  onMudar,
}: {
  aberto: boolean;
  onFechar: () => void;
  layout: Layout3DConfig;
  ruas: string[];
  onMudar: (patch: Partial<Layout3DConfig>) => void;
}) {
  const [ruaEmFoco, setRuaEmFoco] = useState<string>('');

  if (!aberto) return null;

  const elevacaoDaRua = ruaEmFoco ? baseDaRua(ruaEmFoco, layout) : layout.baseOffsetY;

  return (
    <Modal open onClose={onFechar} title="Ajustar estrutura do porta-pallets">
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-fg-muted">
          Medidas do galpão, em metros. Ficam salvas neste navegador e não alteram nenhum
          endereço cadastrado.
        </p>

        <CampoMetros
          rotulo="Elevação da base"
          ajuda="Altura do piso até a primeira prateleira. Use 0 para estrutura apoiada no chão; acima disso o mapa desenha os montantes de sustentação."
          valor={layout.baseOffsetY}
          min={LIMITES.baseOffsetY.min}
          max={LIMITES.baseOffsetY.max}
          onMudar={v => onMudar({ baseOffsetY: v })}
        />

        <CampoMetros
          rotulo="Altura por nível"
          ajuda="Distância entre andares, incluindo a longarina e a folga de entrada do garfo."
          valor={layout.levelHeight}
          min={LIMITES.levelHeight.min}
          max={LIMITES.levelHeight.max}
          onMudar={v => onMudar({ levelHeight: v })}
        />

        <CampoMetros
          rotulo="Passo entre módulos"
          ajuda="Distância de um módulo ao seguinte, ao longo da rua."
          valor={layout.moduleWidth}
          min={LIMITES.moduleWidth.min}
          max={LIMITES.moduleWidth.max}
          onMudar={v => onMudar({ moduleWidth: v })}
        />

        <CampoMetros
          rotulo="Distância entre ruas"
          ajuda="Inclui o corredor de manobra. Encolher aqui faz o desenho mentir sobre caber a empilhadeira."
          valor={layout.rowSpacing}
          min={LIMITES.rowSpacing.min}
          max={LIMITES.rowSpacing.max}
          onMudar={v => onMudar({ rowSpacing: v })}
        />

        {ruas.length > 1 && (
          <div className="border-t border-edge pt-4">
            <p className="text-xs font-medium text-fg">Elevação de uma rua específica</p>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
              Para quando só parte do pulmão é suspensa. Sem ajuste próprio, a rua segue a
              elevação geral acima.
            </p>
            <Select
              value={ruaEmFoco}
              onChange={e => setRuaEmFoco(e.target.value)}
              className="mt-2 w-full"
            >
              <option value="">Escolha a rua…</option>
              {ruas.map(r => (
                <option key={r} value={r}>
                  Rua {r}
                  {layout.baseByStreet[r] !== undefined ? ` · ${layout.baseByStreet[r]} m` : ''}
                </option>
              ))}
            </Select>

            {ruaEmFoco && (
              <div className="mt-3 space-y-2">
                <CampoMetros
                  rotulo={`Elevação da rua ${ruaEmFoco}`}
                  valor={elevacaoDaRua}
                  min={LIMITES.baseOffsetY.min}
                  max={LIMITES.baseOffsetY.max}
                  onMudar={v => onMudar({ baseByStreet: { ...layout.baseByStreet, [ruaEmFoco]: v } })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const resto = { ...layout.baseByStreet };
                    delete resto[ruaEmFoco];
                    onMudar({ baseByStreet: resto });
                  }}
                >
                  Voltar ao padrão geral
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between gap-2 border-t border-edge pt-4">
          <Button variant="ghost" size="sm" onClick={() => onMudar({ ...LAYOUT_PADRAO })}>
            Restaurar padrão
          </Button>
          <Button variant="primary" size="sm" onClick={onFechar}>
            Concluir
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Props agrupadas por assunto ──────────────────────────────────────────────────
//
// Soltas eram mais de trinta, e a assinatura não dizia o que pertencia a quê. Agrupadas,
// cada bloco do HUD puxa só o seu — e a desestruturação no corpo mantém os nomes que o
// JSX já usava, para o fatiamento não virar também uma renomeação.

export interface LegendaDoHud {
  modo: ModoCor;
  contagem: Record<SlotStatus, number>;
  contagemAbc: { porClasse: Record<AbcClasse, number>; semCurva: number };
  abc: AbcDoArmazem;
  abcFalhou: boolean;
}

export interface VisaoDoHud {
  modoVisor: ModoVisor;
  mostrarPlantaFisica: boolean;
  /** `vazio` = pavimento sem planta cadastrada; o HUD diz isso por extenso. */
  origemDaPlanta: 'banco' | 'constante' | 'vazio';
  pavimentos: number[];
  andar: number;
  caminhando: boolean;
  fundo: FundoDaCena;
  telaCheia: boolean;
  /** Falso esconde o botão: API ausente, ou bloqueada por estar num iframe. */
  suportaTelaCheia: boolean;
}

export interface BuscaDoHud {
  busca: string;
  buscando: boolean;
  achados: ReadonlySet<string> | null;
  achadas: VagaDesenhavel[];
  rota: RotaDesenhavel | null;
  rotaAberta: boolean;
  paradaAtual: number;
}

export interface FiltrosDoHud {
  ruas: string[];
  ruasSelecionadas: ReadonlySet<string>;
  filtro: FiltroStatus;
  alertasGiro: Slot[];
  divergentes: VagaDesenhavel[];
  emDestaque: number;
  totalDeVagas: number;
  naoPosicionaveis: number;
}

export interface BuilderDoHud {
  ferramenta: FerramentaBuilder;
  estanteEscolhida: TipoDeEstante;
  corEscolhida: string;
  objetos: { id: string }[];
  /** Id da peça selecionada SE for porta-pallets — tipo e cor só valem para estante. */
  selecionadoDoTipoEstante: string | null;
  salvandoPecas: boolean;
  erroAoSalvar: string | null;
  salvoEm: Date | null;
}

export interface AcoesDoHud {
  setModo: (m: ModoCor) => void;
  setModoVisor: (m: ModoVisor) => void;
  setMostrarPlantaFisica: (f: (v: boolean) => boolean) => void;
  setAndar: (a: number) => void;
  setBusca: (s: string) => void;
  setFiltro: (f: FiltroStatus) => void;
  setRuasSelecionadas: (f: (atual: Set<string>) => Set<string>) => void;
  limparRuas: () => void;
  setRotaAberta: (f: (v: boolean) => boolean) => void;
  setParadaAtual: (n: number) => void;
  setCaminhando: (f: (v: boolean) => boolean) => void;
  setFundo: (f: (v: FundoDaCena) => FundoDaCena) => void;
  alternarTelaCheia: () => void;
  setAjustando: (v: boolean) => void;
  setFerramenta: (f: FerramentaBuilder) => void;
  setEstanteEscolhida: (t: TipoDeEstante) => void;
  setCorEscolhida: (c: string) => void;
  setSelecionadoNoBuilder: (id: string | null) => void;
  ajustarObjeto: (id: string, patch: { estante?: TipoDeEstante; cor?: string }) => void;
  salvarConstrucao: () => void;
  focarVaga: (slot: Slot | undefined) => void;
  voarAteParada: (parada: ParadaDaRota) => void;
  resetarCamera: () => void;
  capturarCena: () => void;
  trocarLayout: (patch: Partial<Layout3DConfig>) => void;
}

/**
 * O painel de controles, a barra do builder e o modal de ajuste.
 *
 * O painel esquerdo é COLAPSÁVEL, e abaixo de 768 px começa recolhido: com 15 rem de
 * largura fixa sobre um canvas de ~380 px, ele comia metade da tela e a gaveta de detalhe
 * entrava por cima. Recolhido sobra o botão de abrir — a cena fica inteira à vista.
 */
export function Hud3D({
  legenda,
  visao,
  busca: dadosDaBusca,
  filtros,
  builder,
  acoes,
  layout,
  ajustando,
  theme,
}: {
  legenda: LegendaDoHud;
  visao: VisaoDoHud;
  busca: BuscaDoHud;
  filtros: FiltrosDoHud;
  builder: BuilderDoHud;
  acoes: AcoesDoHud;
  layout: Layout3DConfig;
  ajustando: boolean;
  theme: Theme;
}) {
  const { modo, contagem, contagemAbc, abc, abcFalhou } = legenda;
  const {
    modoVisor, mostrarPlantaFisica, origemDaPlanta, pavimentos, andar, caminhando, fundo,
    telaCheia, suportaTelaCheia,
  } = visao;
  const { busca, buscando, achados, achadas, rota, rotaAberta, paradaAtual } = dadosDaBusca;
  const { ruas, ruasSelecionadas, filtro, alertasGiro, divergentes, emDestaque, totalDeVagas, naoPosicionaveis } = filtros;
  const {
    ferramenta, estanteEscolhida, corEscolhida, objetos, selecionadoDoTipoEstante,
    salvandoPecas, erroAoSalvar, salvoEm,
  } = builder;
  const {
    setModo, setModoVisor, setMostrarPlantaFisica, setAndar, setBusca, setFiltro,
    setRuasSelecionadas, limparRuas, setRotaAberta, setParadaAtual, setCaminhando, setFundo,
    alternarTelaCheia, setAjustando, setFerramenta, setEstanteEscolhida, setCorEscolhida,
    setSelecionadoNoBuilder, ajustarObjeto, salvarConstrucao, focarVaga, voarAteParada,
    resetarCamera, capturarCena, trocarLayout,
  } = acoes;

  /**
   * Painel recolhido.
   *
   * Nasce fechado em tela estreita e aberto no resto. Lido UMA vez, na montagem: trocar
   * sozinho a cada redimensionamento reabriria o painel que a pessoa acabou de fechar.
   */
  const [aberto, setAberto] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= LARGURA_ESTREITA,
  );

  return (
    <>
      {/* Catálogo de construção. Barra inferior e não painel lateral: a mão vai do
          catálogo para o chão o tempo todo, e a borda de baixo é o caminho mais curto
          entre escolher a peça e mirar na grade. */}
      {modoVisor === 'edicao' && (
        <div className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2">
          <Panel>
            <PanelSection padding="sm">
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <Button
                  variant={ferramenta === 'navegar' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setFerramenta('navegar')}
                >
                  Selecionar / Navegar
                </Button>
                <span aria-hidden className="mx-0.5 h-5 w-px bg-edge" />
                {(Object.keys(CATALOGO) as TipoConstruido[]).map(tipo => (
                  <Button
                    key={tipo}
                    variant={ferramenta === tipo ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => {
                      setFerramenta(tipo);
                      // Soltar a seleção ao armar a ferramenta: a mini-barra de girar e
                      // excluir sobre a peça antiga só atrapalharia a mira da nova.
                      setSelecionadoNoBuilder(null);
                    }}
                  >
                    + {CATALOGO[tipo].rotulo}
                  </Button>
                ))}
              </div>
              {/* Tipo e cor valem para a PRÓXIMA peça e, com algo selecionado, para a
                  peça selecionada — corrigir sem excluir e refazer é o uso mais comum. */}
              {(ferramenta === 'porta-pallets' || selecionadoDoTipoEstante) && (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 border-t border-edge pt-2">
                  {(Object.keys(ESTANTES) as TipoDeEstante[]).map(t => (
                    <Button
                      key={t}
                      variant={estanteEscolhida === t ? 'primary' : 'ghost'}
                      size="sm"
                      onClick={() => {
                        setEstanteEscolhida(t);
                        if (selecionadoDoTipoEstante) ajustarObjeto(selecionadoDoTipoEstante, { estante: t });
                      }}
                    >
                      {ESTANTES[t].rotulo}
                    </Button>
                  ))}
                  <span aria-hidden className="mx-0.5 h-5 w-px bg-edge" />
                  {CORES_DE_ESTANTE.map(c => (
                    <button
                      key={c.chave}
                      type="button"
                      aria-label={`Cor ${c.rotulo}`}
                      title={c.rotulo}
                      onClick={() => {
                        setCorEscolhida(c.chave);
                        if (selecionadoDoTipoEstante) ajustarObjeto(selecionadoDoTipoEstante, { cor: c.chave });
                      }}
                      className={`h-6 w-6 rounded-control border-2 ${corEscolhida === c.chave ? 'border-accent' : 'border-edge'}`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center justify-center gap-2 border-t border-edge pt-2">
                <Button size="sm" onClick={salvarConstrucao} disabled={salvandoPecas}>
                  {salvandoPecas ? 'Salvando...' : 'Salvar construção'}
                </Button>
                <span className="text-xs text-fg-subtle">
                  {erroAoSalvar
                    ? erroAoSalvar
                    : salvoEm
                      ? `Salvo às ${salvoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                      : 'Ainda não salvo nesta sessão'}
                </span>
              </div>

              <p className="mt-1.5 text-center text-xs text-fg-subtle">
                {ferramenta === 'navegar'
                  ? `Clique numa peça para girar ou excluir. ${objetos.length} ${objetos.length === 1 ? 'peça colocada' : 'peças colocadas'}.`
                  : 'Mova o ponteiro sobre o piso e clique para construir. R gira, Del exclui.'}
              </p>
            </PanelSection>
          </Panel>
        </div>
      )}

      {/* Recolhido, sobra SÓ este botão. Em tela estreita o painel de 15 rem cobria metade
          do canvas e a gaveta de detalhe entrava por cima dele — e quem abre um mapa 3D no
          celular quer ver o galpão, não os controles. */}
      {!aberto && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label="Abrir os controles do mapa"
          aria-expanded={false}
          className="pointer-events-auto absolute left-3 top-3 rounded-control border border-edge bg-surface p-2 text-fg-muted shadow-control transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <PanelLeftOpen aria-hidden className="h-4 w-4" />
        </button>
      )}

      {/* `max-h` + rolagem: o painel cresceu com o seletor de modo e o catálogo, e numa
          altura de canvas menor ele passava do fim da moldura — o rodapé (contagem em
          destaque, resetar câmera, capturar vista) simplesmente ficava fora da tela, sem
          nada indicando que havia mais coisa ali. */}
      {aberto && (
      <Panel className="pointer-events-auto absolute left-3 top-3 flex max-h-[calc(100%-1.5rem)] w-[15rem] max-w-[calc(100%-1.5rem)] flex-col overflow-y-auto">
        {/* Fechar fica no TOPO do painel, não flutuando fora dele: é a borda que a pessoa
            já está olhando quando decide que quer a cena inteira. */}
        <PanelSection padding="sm" className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-fg-muted">Controles</span>
          <button
            type="button"
            onClick={() => setAberto(false)}
            aria-label="Recolher os controles do mapa"
            aria-expanded
            className="-mr-1 rounded-control p-1 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <PanelLeftClose aria-hidden className="h-4 w-4" />
          </button>
        </PanelSection>
        {/* A legenda acompanha o modo. Mostrar as duas ao mesmo tempo obrigaria a
            pessoa a descobrir sozinha qual delas explica o que está na tela. */}
        {modo === 'abc' ? (
          <PanelSection padding="sm" className="space-y-2">
            {LEGENDA_ABC.map(({ classe, rotulo }) => (
              <div key={classe} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs text-fg-muted">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: ESCALA_ABC[theme][classe] }}
                  />
                  {rotulo}
                </span>
                <span className="text-code text-xs text-fg">{contagemAbc.porClasse[classe]}</span>
              </div>
            ))}

            {contagemAbc.semCurva > 0 && (
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs text-fg-muted">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: COR_ATENUADA[theme] }}
                  />
                  Sem classificação
                </span>
                <span className="text-code text-xs text-fg">{contagemAbc.semCurva}</span>
              </div>
            )}

            {/* A curva tem DATA. A análise classifica um período fechado e não é
                recalculada quando o estoque se move — dizer qual período está colorindo
                é a diferença entre um mapa e um palpite com cara de mapa. */}
            {abc.analise ? (
              <p className="border-t border-edge pt-2 text-xs leading-relaxed text-fg-subtle">
                Curva de giro de <span className="text-fg-muted">{abc.analise.nome}</span>, com
                vendas até <span className="text-code">{abc.analise.periodoFim}</span>.
              </p>
            ) : (
              <p className="border-t border-edge pt-2 text-xs leading-relaxed text-fg-subtle">
                {abcFalhou
                  ? 'Não foi possível carregar a Curva ABC agora. O mapa segue válido nos demais modos.'
                  : 'Nenhuma Curva ABC publicada. Publique uma análise para colorir o armazém por giro.'}
              </p>
            )}
          </PanelSection>
        ) : (
        <PanelSection padding="sm" className="space-y-2">
          {LEGENDA.map(({ status, rotulo }) => (
            <div key={status} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs text-fg-muted">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={
                    status === 'empty'
                      ? { border: `1px solid ${COR_VAGA[theme].empty}` }
                      : { backgroundColor: COR_VAGA[theme][status] }
                  }
                />
                {rotulo}
              </span>
              {/* `.text-code`: é contagem numa coluna, e alinhar na vertical é o que
                  torna a legenda legível de relance. */}
              <span className="text-code text-xs text-fg">{contagem[status]}</span>
            </div>
          ))}
        </PanelSection>
        )}

        {/* Para que serve a cena. Fica no topo porque decide o que vem abaixo: no modo
            Edição o painel continua sendo o mesmo, mas a cena aceita construção. */}
        <PanelSection padding="sm" className="space-y-2">
          <SegmentedControl
            options={MODOS_VISOR}
            value={modoVisor}
            onChange={setModoVisor}
            label="Modo"
            width="full"
          />
          <Button
            variant={mostrarPlantaFisica ? 'primary' : 'secondary'}
            size="sm"
            className="w-full"
            onClick={() => setMostrarPlantaFisica(v => !v)}
          >
            {mostrarPlantaFisica ? 'Planta do galpão' : 'Vagas por código'}
          </Button>
          <p className="text-xs text-fg-muted">
            {mostrarPlantaFisica
              ? 'Fileiras desenhadas pelas medidas da planta: 10,3 × 45,2 m, corredores de 2,65 m no galpão novo. Status, busca, filtro e rota valem aqui também.'
              : 'Vagas posicionadas pelo código do endereço, em grade regular. Não coincide com o desenho da planta.'}
          </p>

          {/* Seletor de pavimento. Só aparece com mais de um andar cadastrado: um botão
              único marcando "Térreo" seria enfeite ocupando a coluna. */}
          {pavimentos.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 border-t border-edge pt-2">
              <span className="mr-1 text-xs font-medium text-fg-muted">Pavimento</span>
              {pavimentos.map(p => (
                <Button
                  key={p}
                  variant={andar === p ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setAndar(p)}
                >
                  {p === 1 ? 'Térreo' : `${p}º andar`}
                </Button>
              ))}
            </div>
          )}

          {/* Pavimento sem planta: dito por extenso. O desenho vazio sozinho pareceria
              falha de carregamento — e herdar a planta do térreo, que era o que acontecia
              antes, seria pior: mostraria o andar de baixo com o nome do de cima. */}
          {origemDaPlanta === 'vazio' && (
            <Notice tone="neutral">
              Este pavimento ainda não tem planta cadastrada, então não há o que desenhar
              aqui. As medidas de cada trecho — comprimento, fileiras e corredores — são o
              que o mapa usa para montar o galpão.
            </Notice>
          )}
          {modoVisor === 'edicao' && (
            <p className="text-xs text-fg-muted">
              Grade de {PASSO_GRADE_BUILDER} m acesa no piso, e o catálogo de construção na barra
              de baixo. "Salvar construção" grava para a equipe inteira; sem salvar, o que você
              montar some ao sair da tela.
            </p>
          )}
        </PanelSection>

        <PanelSection padding="sm" className="space-y-2">
          {/* "SKU ou produto", NÃO "SKU ou lote". O WMS não tem camadas de lote: o saldo
              é uma linha por endereço e produto, com uma única data de entrada. Oferecer
              busca por lote prometeria algo que nunca encontraria nada. */}
          <Input
            type="search"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar SKU ou produto…"
            className="w-full"
          />

          {busca.trim().length >= 2 && (
            <p className="text-xs text-fg-muted">
              {buscando ? (
                'Procurando…'
              ) : achados === null || achados.size === 0 ? (
                'Nenhuma vaga com esse produto.'
              ) : (
                <>
                  <span className="text-code">{achadas.length}</span>{' '}
                  {achadas.length === 1 ? 'vaga encontrada' : 'vagas encontradas'}
                  {/* Com um único resultado, levar a câmera até lá é a ação óbvia — e
                      com vários seria arbitrário escolher qual. */}
                  {achadas.length === 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 w-full"
                      onClick={() => focarVaga(achadas[0]?.slot)}
                    >
                      Ir até <span className="text-code ml-1">{achadas[0].slot.id}</span>
                    </Button>
                  )}
                </>
              )}
            </p>
          )}

          {/* Rota de coleta. Vive AQUI, colada na busca, e não num quarto painel
              flutuante: a rota não existe sozinha — ela é a lista que a busca
              produziu, e separá-las esconderia de onde ela veio. */}
          {rota && (
            <div className="space-y-2 border-t border-edge pt-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
                  <Crosshair aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                  Rota de coleta
                </span>
                <Button variant="ghost" size="sm" onClick={() => setRotaAberta(a => !a)} aria-expanded={rotaAberta}>
                  {rotaAberta ? 'Recolher' : 'Expandir'}
                </Button>
              </div>

              {rotaAberta && (
                <>
                  {/* O rótulo diz o que a ordem É. Chamar isto de "rota ideal" seria
                      prometer uma otimização que exige distância — e o pulmão não tem
                      distância cadastrada, só a hierarquia do endereço. */}
                  <p className="text-xs leading-relaxed text-fg-subtle">
                    Da entrada mais antiga para a mais nova. Não é a rota mais curta: o pulmão não
                    tem distâncias cadastradas.
                  </p>

                  <ol className="space-y-1">
                    {rota.paradas.map((parada, i) => (
                      <li key={parada.slot.id}>
                        <button
                          type="button"
                          onClick={() => {
                            voarAteParada(parada);
                            setParadaAtual(i + 1);
                          }}
                          className={`flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left text-xs transition-colors hover:bg-surface-2 ${
                            i === Math.min(paradaAtual, rota.paradas.length - 1)
                              ? 'bg-surface-2 text-fg'
                              : 'text-fg-muted'
                          }`}
                        >
                          <span className="text-code text-fg-subtle">{parada.ordem}</span>
                          <span className="text-code">{parada.slot.id}</span>
                          <span className="ml-auto shrink-0 text-fg-subtle">N{parada.slot.nivel}</span>
                        </button>
                      </li>
                    ))}
                  </ol>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      if (paradaAtual >= rota.paradas.length) {
                        setParadaAtual(0);
                        voarAteParada(rota.paradas[0]);
                        setParadaAtual(1);
                        return;
                      }
                      voarAteParada(rota.paradas[paradaAtual]);
                      setParadaAtual(paradaAtual + 1);
                    }}
                  >
                    {paradaAtual >= rota.paradas.length
                      ? 'Recomeçar a rota'
                      : `Avançar para a parada ${paradaAtual + 1}`}
                  </Button>
                </>
              )}
            </div>
          )}

          <SegmentedControl options={MODOS} value={modo} onChange={setModo} label="Colorir por" width="full" />

          {/* Caixas em vez de dropdown: conferir DUAS ruas lado a lado é o caso comum, e
              o dropdown obrigava a escolher uma ou ver o galpão inteiro. Conjunto vazio
              significa "todas" — é o estado inicial e o que o botão Limpar devolve. */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-fg-muted">
                {ruasSelecionadas.size === 0
                  ? 'Todas as ruas'
                  : `${ruasSelecionadas.size} de ${ruas.length} ruas`}
              </span>
              {ruasSelecionadas.size > 0 && (
                <button
                  type="button"
                  className="text-xs text-accent underline-offset-2 hover:underline"
                  onClick={limparRuas}
                >
                  Limpar
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {ruas.map(r => {
                const ativa = ruasSelecionadas.has(r);
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={ativa}
                    onClick={() =>
                      setRuasSelecionadas(atual => {
                        const proximo = new Set(atual);
                        if (proximo.has(r)) proximo.delete(r); else proximo.add(r);
                        return proximo;
                      })
                    }
                    className={`text-code rounded-control border px-2 py-1 text-xs ${
                      ativa
                        ? 'border-accent bg-accent/15 text-fg'
                        : 'border-edge text-fg-muted hover:bg-surface-3'
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>

          <Select
            value={filtro}
            onChange={e => setFiltro(e.target.value as FiltroStatus)}
            className="w-full"
          >
            {FILTROS.map(f => (
              <option key={f.value} value={f.value}>
                {f.rotulo}
                {f.value === 'todas' ? '' : ` (${contagem[f.value]})`}
              </option>
            ))}
          </Select>

          {/* Atalho para o alerta. Aparece SÓ quando há alerta: um botão permanente
              marcando zero vira ruído e, pior, treina a pessoa a ignorá-lo. */}
          {contagem.divergence > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => {
                setFiltro('divergence');
                focarVaga(divergentes[0]?.slot);
              }}
            >
              {/* A cor vem da CENA, não de `text-amber-400`: o ícone tem de ser
                  exatamente o âmbar que pinta a vaga lá dentro. Paleta Tailwind crua
                  aqui criaria um segundo amarelo, parecido e diferente. */}
              <ShieldAlert
                aria-hidden
                className="mr-1.5 h-3.5 w-3.5 shrink-0"
                style={{ color: COR_VAGA[theme].divergence }}
              />
              Ver <span className="text-code mx-1">{contagem.divergence}</span> acima da capacidade
            </Button>
          )}

          {/* Mesma regra do atalho acima: aparece só quando há o que apontar. Leva junto
              o modo de cor, porque o alerta não faz sentido sobre o mapa de Status — o
              losango explica POR QUE a vaga está marcada apenas quando a cor é a curva. */}
          {alertasGiro.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => {
                setModo('abc');
                focarVaga(alertasGiro[0]);
              }}
            >
              {/* Vermelho do marcador 3D do mesmo alerta — o losango que paira sobre a
                  vaga. Ícone e marcador têm de ser a mesma cor, senão são lidos como
                  dois avisos diferentes. */}
              <ShieldAlert
                aria-hidden
                className="mr-1.5 h-3.5 w-3.5 shrink-0"
                style={{ color: COR_ALERTA_GIRO }}
              />
              <span className="text-code mr-1">{alertasGiro.length}</span>
              {alertasGiro.length === 1 ? 'vaga de alto giro elevada' : 'vagas de alto giro elevadas'}
            </Button>
          )}

          {/* O filtro isola, não amputa: as demais vagas continuam desenhadas em tom
              apagado, senão o armazém perderia a forma e o 3D perderia a razão. */}
          <p className="text-xs text-fg-subtle">
            <span className="text-code">{emDestaque}</span> de{' '}
            <span className="text-code">{totalDeVagas}</span> em destaque
          </p>
        </PanelSection>

        {/* Vaga sem posição não é descartada em silêncio: some do desenho, mas o
            número fica à vista. Senão o 3D mostraria menos armazém do que existe. */}
        {naoPosicionaveis > 0 && (
          <PanelSection padding="sm">
            <p className="text-xs leading-relaxed text-fg-muted">
              <span className="text-code">{naoPosicionaveis}</span> vaga(s) fora do
              padrão de código não aparecem no mapa.
            </p>
          </PanelSection>
        )}

        <PanelSection padding="sm" className="space-y-2">
          <Button
            variant={caminhando ? 'primary' : 'secondary'}
            size="sm"
            className="w-full"
            onClick={() => setCaminhando(v => !v)}
          >
            {caminhando ? 'Sair da caminhada' : 'Caminhar no galpão'}
          </Button>
          {caminhando && (
            <p className="text-xs text-fg-muted">
              Clique na cena para assumir o controle. <span className="text-code">W A S D</span> anda,
              o mouse olha, <span className="text-code">Esc</span> solta o ponteiro. Enquanto caminha,
              clicar não abre vaga.
            </p>
          )}
          {/* Fileira de ícones, não quatro botões empilhados de largura cheia.
              Empilhados, eles davam o mesmo peso visual a coisas de pesos diferentes e
              empurravam o painel para baixo — e a tela cheia seria o quinto. Agrupados,
              ficam lidos pelo que têm em comum: todos mexem na VISTA, nenhum muda dado.
              O rótulo de cada um vai no `title` e no `aria-label`, e diz o que o clique
              FAZ. É a correção do antigo "Fundo: galpão", que mostrava o estado atual e
              deixava ninguém saber se clicar ligava ou desligava. */}
          <div className="flex items-center gap-1">
            <BotaoDeVista
              rotulo="Resetar a câmera para a vista inicial"
              onClick={resetarCamera}
              disabled={caminhando}
            >
              <RotateCcw aria-hidden className="h-4 w-4" />
            </BotaoDeVista>
            {/* "Limpo" existe para quem precisa de quadro: o cenário custa um piso, quatro
                paredes e um passe de sombra, e numa máquina fraca isso é o que sobra de
                orçamento. Voltar para ele devolve exatamente a cena anterior. */}
            <BotaoDeVista
              rotulo={fundo === 'galpao' ? 'Esconder o galpão em volta' : 'Mostrar o galpão em volta'}
              ativo={fundo === 'galpao'}
              onClick={() => setFundo(f => (f === 'galpao' ? 'limpo' : 'galpao'))}
            >
              {fundo === 'galpao'
                ? <Sun aria-hidden className="h-4 w-4" />
                : <SunDim aria-hidden className="h-4 w-4" />}
            </BotaoDeVista>
            {/* Escondido quando a API não existe ou está bloqueada — um botão de tela
                cheia que não abre tela cheia é pior do que nenhum. */}
            {suportaTelaCheia && (
              <BotaoDeVista
                rotulo={telaCheia ? 'Sair da tela cheia (F)' : 'Ver em tela cheia (F)'}
                ativo={telaCheia}
                onClick={alternarTelaCheia}
              >
                {telaCheia
                  ? <Minimize aria-hidden className="h-4 w-4" />
                  : <Maximize aria-hidden className="h-4 w-4" />}
              </BotaoDeVista>
            )}
            <BotaoDeVista rotulo="Capturar a visão 3D como imagem" onClick={capturarCena}>
              <Camera aria-hidden className="h-4 w-4" />
            </BotaoDeVista>
          </div>
          {/* Fora da fileira: abre um modal e mexe na MEDIDA da estante, não na vista.
              Na fileira, pareceria mais um ajuste de câmera. */}
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setAjustando(true)}>
            Ajustar estrutura
          </Button>
        </PanelSection>
      </Panel>
      )}

      <AjusteDeEstrutura
        aberto={ajustando}
        onFechar={() => setAjustando(false)}
        layout={layout}
        ruas={ruas}
        onMudar={trocarLayout}
      />
    </>
  );
}
```

#### `src/components/wms/viewer3d/PainelDetalhe.tsx`  _(329 linhas)_

```tsx
// A gaveta de detalhe da vaga: situação, saldo, curva de giro e o que está guardado ali.
//
// Extraído de `Warehouse3DViewer.tsx` no fatiamento do módulo. A única mudança de
// comportamento é o CACHE do conteúdo, que vive em `cacheDeConteudo.ts`.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Package, ScanLine, ShieldAlert, X } from 'lucide-react';
import { Button, Panel, PanelSection } from '../../ui';
import { useTheme } from '../../../lib/useTheme';
import { int } from '../../../lib/formatPtBr';
import { listBinContents, type BinStockRow } from '../../../lib/wms/wmsService';
import { NIVEL_DE_PISO, type AbcDaVaga } from '../../../lib/wms/warehouse3dAbc';
import type { Slot, SlotStatus } from '../../../lib/wms/warehouse3dSlots';
import { COR_ALERTA_GIRO, COR_VAGA, ESCALA_ABC } from './aparencia';
import { conteudoGuardado, guardarConteudo } from './cacheDeConteudo';



/** Data curta para a grade. Formatada à mão, como no módulo de captura: o painel é
 *  lido no corredor e a data não pode mudar de formato conforme a locale da máquina. */
function dataCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const doisDigitos = (n: number) => String(n).padStart(2, '0');
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const ROTULO_STATUS: Record<SlotStatus, string> = {
  occupied: 'Ocupada',
  empty: 'Livre',
  divergence: 'Acima da capacidade',
  blocked: 'Bloqueada',
};

export function PainelDetalhe({
  slot,
  abc,
  onFechar,
  onScanRequest,
  onOperate,
  onProcurarSku,
}: {
  slot: Slot;
  /** Classificação de giro desta vaga. `undefined` = nenhum SKU daqui está na análise. */
  abc?: AbcDaVaga;
  onFechar: () => void;
  onScanRequest?: (slot: Slot) => void;
  onOperate?: (slot: Slot) => void;
  /**
   * Procura um SKU no armazém inteiro, acendendo todos os endereços que o têm.
   *
   * Existe porque a pergunta que nasce ao abrir uma vaga é "onde MAIS tem isto" — e até
   * agora ela obrigava a fechar o painel e redigitar o código na busca.
   */
  onProcurarSku?: (sku: string) => void;
}) {
  // Hook em vez de prop: a especificação pede para NÃO mexer na interface do
  // componente, e o tema é exatamente o tipo de contexto que não deve virar prop só
  // para pintar um quadradinho.
  const { theme } = useTheme();
  const [conteudo, setConteudo] = useState<BinStockRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  /** Curva por SKU, para marcar cada linha do conteúdo. A cor do cubo diz a classe que
   *  DOMINA a vaga; aqui é preciso dizer de qual produto ela veio, senão numa vaga
   *  misturada a pessoa desce o pallet errado. */
  const curvaPorSku = useMemo(
    () => new Map((abc?.itens ?? []).map(i => [i.sku, i.classe])),
    [abc],
  );

  const altoGiroElevado = abc?.classe === 'A' && slot.nivel > NIVEL_DE_PISO;

  /**
   * Blocos da grade técnica.
   *
   * Montados numa lista, e não escritos no JSX, porque QUASE TODOS são condicionais:
   * sem produto não há unidades nem data de entrada, sem análise publicada não há
   * curva. Célula com travessão ocupa o mesmo espaço de uma com dado e não diz nada.
   *
   * O que NÃO está aqui, e por quê: a especificação pedia `LOTE / VALIDADE` e
   * `ÚLTIMA AUDITORIA`. Conferido no banco — não existe coluna de lote, validade nem
   * carimbo de auditoria em `warehouse_bin_stock`, `warehouse_storage_bins`,
   * `warehouse_bin_movements` nem `products`. O controle de lote da 125 vive no fluxo
   * de NF-e (`lot_control_settings`, `nfe_putaway_assignments`), não no saldo do
   * pulmão. No lugar deles entra ENTRADA, que é real e é a data que manda na coleta:
   * `first_stored_at` é o critério FIFO que a busca já usa para ordenar.
   */
  const blocos = useMemo(() => {
    const lista: { rotulo: string; valor: ReactNode }[] = [
      {
        rotulo: 'Situação',
        valor: (
          <>
            {/* Mesmo quadradinho da legenda do mapa: o painel repete o código visual da
                cena em vez de inventar um segundo. */}
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={
                slot.status === 'empty'
                  ? { border: `1px solid ${COR_VAGA[theme].empty}` }
                  : { backgroundColor: COR_VAGA[theme][slot.status] }
              }
            />
            <span className="truncate text-xs">{ROTULO_STATUS[slot.status]}</span>
          </>
        ),
      },
      {
        rotulo: 'Caixas',
        valor: (
          <span className="text-code">
            {/* Sem capacidade cadastrada mostra só a contagem. Exibir "18/—" sugeriria
                um limite que ninguém definiu. */}
            {slot.capacidade !== null ? `${slot.caixas}/${slot.capacidade}` : slot.caixas}
          </span>
        ),
      },
    ];

    const linhas = conteudo ?? [];
    if (linhas.length > 0) {
      const unidades = linhas.reduce((total, l) => total + l.units, 0);
      lista.push({ rotulo: 'Unidades', valor: <span className="text-code">{int(unidades)}</span> });

      const maisAntiga = linhas.reduce(
        (menor, l) => (l.firstStoredAt < menor ? l.firstStoredAt : menor),
        linhas[0].firstStoredAt,
      );
      lista.push({ rotulo: 'Entrada', valor: <span className="text-code">{dataCurta(maisAntiga)}</span> });
    }

    if (abc) {
      lista.push({
        rotulo: 'Curva de giro',
        valor: (
          <>
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: ESCALA_ABC[theme][abc.classe] }}
            />
            <span className="text-code">{abc.classe}</span>
          </>
        ),
      });
    }

    // Endereço misturado é digno de nota: muda o que o operador vai encontrar lá.
    if (linhas.length > 1) {
      lista.push({ rotulo: 'SKUs na vaga', valor: <span className="text-code">{linhas.length}</span> });
    }

    return lista;
  }, [slot, conteudo, abc, theme]);

  useEffect(() => {
    let vivo = true;
    setErro(null);

    // Com cache, a gaveta abre JÁ com o conteúdo e não pisca "Lendo…" — e o `return`
    // evita a ida ao banco por completo. Sem ele, cachear não economizaria consulta
    // nenhuma: só esconderia a espera.
    const guardado = conteudoGuardado(slot.id);
    if (guardado) {
      setConteudo(guardado);
      return;
    }

    setConteudo(null);
    listBinContents(slot.id)
      .then(linhas => {
        // Grava mesmo se a gaveta já fechou: o próximo clique na mesma vaga aproveita.
        guardarConteudo(slot.id, linhas);
        if (vivo) setConteudo(linhas);
      })
      .catch((e: unknown) => {
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      });
    return () => {
      vivo = false;
    };
  }, [slot.id]);

  return (
    // `min-h-0` é o que faz a rolagem interna funcionar dentro da coluna flex: sem ele o
    // painel cresce pelo conteúdo e empurra o radar para fora da moldura em vez de rolar.
    <Panel className="pointer-events-auto flex min-h-0 w-[19rem] max-w-full flex-col">
      {/* Cabeçalho: o endereço é o assunto, então ele é o maior elemento do painel. O
          fechar virou ícone — a palavra "Fechar" competia em peso com o código da vaga
          que a pessoa veio ler. */}
      <PanelSection padding="sm" className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-code truncate text-base font-semibold tracking-tight text-fg">{slot.id}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-fg-subtle">
            Rua {slot.ruaCodigo} · Mód <span className="text-code">{slot.modulo}</span> · Nív{' '}
            <span className="text-code">{slot.nivel}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar detalhe da vaga"
          className="-mr-1 -mt-1 shrink-0 rounded-control p-1.5 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </PanelSection>

      {/* Grade técnica. Substitui as linhas rótulo-à-esquerda/valor-à-direita: em duas
          colunas o olho varre os VALORES numa coluna só, que é como se lê terminal. Os
          blocos sem dado não entram — célula com travessão é ruído com aparência de
          informação. */}
      <PanelSection padding="sm">
        <dl className="grid grid-cols-2 gap-1.5">
          {blocos.map(bloco => (
            <div key={bloco.rotulo} className="rounded-control border border-edge bg-surface-2 px-2.5 py-2">
              <dt className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                {bloco.rotulo}
              </dt>
              <dd className="mt-1 flex items-center gap-1.5 text-sm text-fg">{bloco.valor}</dd>
            </div>
          ))}
        </dl>
      </PanelSection>

      {/* O alerta é dito por extenso, não só pelo losango na cena. Filete à esquerda em
          vez de balão preenchido: o painel inteiro cabe em uma tela, e um bloco de cor
          sólida no meio dele rouba a atenção do conteúdo da vaga, que é o assunto.
          O vermelho é o MESMO do marcador 3D — antes este aviso saía âmbar enquanto o
          losango sobre a vaga era vermelho, dois tons para um alerta só. */}
      {altoGiroElevado && (
        <PanelSection padding="sm">
          <div className="flex gap-2.5 border-l-2 pl-2.5" style={{ borderColor: COR_ALERTA_GIRO }}>
            <ShieldAlert
              aria-hidden
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              style={{ color: COR_ALERTA_GIRO }}
            />
            <p className="text-xs leading-relaxed text-fg-muted">
              Alto giro no nível <span className="text-code text-fg">{slot.nivel}</span>. Cada
              retirada exige ciclo de elevação — descer para a face de piso reduz o tempo de
              separação.
            </p>
          </div>
        </PanelSection>
      )}

      <PanelSection padding="sm" className="min-h-0 flex-1 overflow-auto">
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
          <Package aria-hidden className="h-3 w-3 shrink-0" />
          Conteúdo
        </p>
        {erro !== null ? (
          <p className="text-xs leading-relaxed text-danger">Não foi possível ler o conteúdo desta vaga.</p>
        ) : conteudo === null ? (
          <p className="text-xs text-fg-muted">Lendo…</p>
        ) : conteudo.length === 0 ? (
          <p className="text-xs text-fg-muted">Nenhum produto armazenado aqui.</p>
        ) : (
          <ul className="space-y-2">
            {conteudo.map(linha => (
              <li key={linha.productId} className="border-t border-edge pt-2 first:border-t-0 first:pt-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-code text-xs font-medium text-fg">{linha.sku}</p>
                  {/* Só quando há classe. "—" em todas as linhas de quem nunca publicou
                      análise seria uma coluna de nada ocupando a largura do painel.
                      Quadrado, não pílula: aqui ele é um MARCADOR de uma letra, e a
                      pílula o faria concorrer em peso com o SKU ao lado. */}
                  {curvaPorSku.get(linha.sku) && (
                    <span
                      className="text-code shrink-0 rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
                      style={{ backgroundColor: ESCALA_ABC[theme][curvaPorSku.get(linha.sku)!] }}
                      title={`Curva de giro ${curvaPorSku.get(linha.sku)}`}
                    >
                      {curvaPorSku.get(linha.sku)}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-fg-muted">{linha.productName}</p>
                {/* Por LINHA, e não um botão no rodapé: a vaga pode ter mais de um
                    produto, e um botão só teria que escolher qual procurar — ou
                    escolheria errado, ou pediria mais um clique para desambiguar. */}
                {onProcurarSku && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-accent underline-offset-2 hover:underline"
                    onClick={() => onProcurarSku(linha.sku)}
                  >
                    Ver onde mais tem este produto
                  </button>
                )}
                <p className="mt-0.5 text-xs text-fg-muted">
                  <span className="text-code">{linha.boxes}</span> cx ·{' '}
                  <span className="text-code">{linha.units}</span> un
                </p>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      {/* Os botões só existem quando há quem os atenda. Botão que não faz o que o
          rótulo diz é pior que botão nenhum: o operador confia nele. Em particular,
          "Ler QR Code" só aparece para quem de fato abre um leitor — ligá-lo a
          qualquer outra coisa seria um rótulo mentindo. */}
      {(onOperate || onScanRequest) && (
        <PanelSection padding="sm" className="space-y-2">
          {onOperate && (
            <Button variant="secondary" size="sm" className="w-full" onClick={() => onOperate(slot)}>
              Movimentar esta vaga
            </Button>
          )}
          {/* Ação principal do painel: é a leitura que confirma fisicamente o endereço.
              `primary` em vez de `secondary` — com os dois botões no mesmo peso, nada
              indicava por onde começar. */}
          {onScanRequest && (
            <Button variant="primary" size="sm" className="w-full" onClick={() => onScanRequest(slot)}>
              <ScanLine aria-hidden className="h-3.5 w-3.5 shrink-0" />
              Ler QR Code
            </Button>
          )}
        </PanelSection>
      )}
    </Panel>
  );
}
```

#### `src/components/wms/viewer3d/Radar3D.tsx`  _(156 linhas)_

```tsx
// O radar: a planta baixa que diz onde a câmera está e para onde ela olha.
//
// Extraído de `Warehouse3DViewer.tsx` no fatiamento do módulo, sem mudança de
// comportamento. É SVG, não WebGL — por isso não mora na cena.

import { useMemo } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { Compass } from 'lucide-react';
import { Button, Panel, PanelSection } from '../../ui';
import type { Theme } from '../../../lib/useTheme';
import { caminhoDoCone, type AreaRadar, type CelulaRadar } from '../../../lib/wms/warehouse3dRadar';
import { COR_ALERTA_GIRO, COR_GRADE, COR_REALCE, COR_VAGA } from './aparencia';


// ── Radar (planta baixa) ───────────────────────────────────────────────────────

/**
 * Vista de cima do armazém, com onde a câmera está e para onde ela olha.
 *
 * Orbitar em 3D desorienta: três arrastes e já não se sabe qual corredor está na
 * frente. O radar devolve a referência que a vista em perspectiva tira — é o mesmo
 * papel do "você está aqui" de um mapa de shopping.
 *
 * O cone e o marcador são movidos por `setAttribute`, de fora do React. Este componente
 * só re-renderiza quando o ARMAZÉM muda (filtro, layout, alerta), nunca quando a câmera
 * se move — e a câmera se move em todo quadro.
 */
export function Radar({
  celulas,
  area,
  theme,
  aberto,
  onAlternar,
  onIrPara,
  grupoRef,
  coneRef,
}: {
  celulas: CelulaRadar[];
  area: AreaRadar;
  theme: Theme;
  aberto: boolean;
  onAlternar: () => void;
  onIrPara: (x: number, z: number) => void;
  grupoRef: RefObject<SVGGElement>;
  coneRef: RefObject<SVGPathElement>;
}) {
  // Uma linha por rua, do primeiro ao último módulo: é o corredor, e é o que dá ao
  // radar a forma de planta em vez de nuvem de pontos soltos.
  const corredores = useMemo(() => {
    const porRua = new Map<number, { x: number; z1: number; z2: number; rotulo: string }>();
    for (const c of celulas) {
      const atual = porRua.get(c.rua);
      if (atual) {
        atual.z1 = Math.min(atual.z1, c.z);
        atual.z2 = Math.max(atual.z2, c.z);
      } else {
        porRua.set(c.rua, { x: c.x, z1: c.z, z2: c.z, rotulo: c.ruaCodigo });
      }
    }
    return [...porRua.values()];
  }, [celulas]);

  const alcanceDoCone = Math.max(area.largura, area.profundidade) * 0.55;
  const [grade, linha] = COR_GRADE[theme];

  const aoClicar = (evento: ReactMouseEvent<SVGSVGElement>) => {
    // A matriz do próprio SVG faz a inversão. Calcular na mão a partir do
    // `getBoundingClientRect` erraria sempre que o `preserveAspectRatio` sobrasse
    // margem — e ele sobra, porque o armazém quase nunca tem a proporção do quadro.
    const svg = evento.currentTarget;
    const matriz = svg.getScreenCTM();
    if (!matriz) return;
    const ponto = svg.createSVGPoint();
    ponto.x = evento.clientX;
    ponto.y = evento.clientY;
    const local = ponto.matrixTransform(matriz.inverse());
    onIrPara(local.x, local.y);
  };

  return (
    // Sem posição própria: quem posiciona é a coluna da direita, em `Warehouse3DViewer`.
    // `shrink-0` para a gaveta encolher antes do radar — o radar tem altura de conteúdo,
    // a gaveta rola.
    <Panel className="pointer-events-auto w-[12rem] max-w-full shrink-0">
      <PanelSection padding="sm" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          {/* `aria-hidden`: o ícone repete o rótulo ao lado, e um leitor de tela que
              anuncia "bússola Radar" só atrapalha. */}
          <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
            <Compass aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
            Radar
          </span>
          <Button variant="ghost" size="sm" onClick={onAlternar} aria-expanded={aberto}>
            {aberto ? 'Recolher' : 'Expandir'}
          </Button>
        </div>

        {aberto && (
          <>
            <svg
              viewBox={`${area.minX} ${area.minZ} ${area.largura} ${area.profundidade}`}
              preserveAspectRatio="xMidYMid meet"
              className="h-28 w-full cursor-pointer rounded-control bg-surface-2"
              onClick={aoClicar}
              role="img"
              aria-label={`Planta do armazém com ${celulas.length} posições vistas de cima. Clique para levar a câmera.`}
            >
              {/* Corredores. `non-scaling-stroke` mantém a espessura em PIXELS: sem
                  isso a linha engrossaria junto com o zoom do viewBox e um armazém
                  pequeno viraria um borrão de traços. */}
              {corredores.map(c => (
                <line
                  key={c.rotulo}
                  x1={c.x}
                  y1={c.z1}
                  x2={c.x}
                  y2={c.z2}
                  stroke={linha}
                  strokeWidth={6}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}

              {celulas.map(c => (
                <circle
                  key={`${c.rua}-${c.modulo}`}
                  cx={c.x}
                  cy={c.z}
                  r={Math.max(area.largura, area.profundidade) * 0.012}
                  fill={
                    // A MESMA linguagem de cor da cena 3D. O radar é um mapa do que está
                    // ali do lado; ensinar duas cores para o mesmo alerta faria o
                    // operador reaprender o significado ao mudar de instrumento.
                    c.altoGiro ? COR_ALERTA_GIRO : c.divergencia ? COR_VAGA[theme].divergence : grade
                  }
                />
              ))}

              {/* Câmera: cone de visão e vértice. Movido por fora do React. */}
              <g ref={grupoRef}>
                <path ref={coneRef} d={caminhoDoCone(0.6, alcanceDoCone)} fill={COR_REALCE[theme]} opacity={0.22} />
                <circle cx={0} cy={0} r={Math.max(area.largura, area.profundidade) * 0.018} fill={COR_REALCE[theme]} />
              </g>
            </svg>

            <p className="text-xs leading-relaxed text-fg-subtle">
              Clique na planta para levar a câmera até o ponto.
            </p>
          </>
        )}
      </PanelSection>
    </Panel>
  );
}
```


### 4.12 Mapa 2D, que lê o mesmo dado

#### `src/components/wms/WmsStorageMap.tsx`  _(498 linhas)_

```tsx
// Pulmão -> Mapa. Visualização 2D dos endereços de armazenagem.
//
// Por que um mapa e não só a lista: a pergunta operacional do porta-pallet é espacial
// ("onde tem vaga livre nesta rua?", "quanto desta rua está cheio?"), e uma tabela
// ordenada por código responde isso mal. O mapa não é enfeite — é a mesma informação
// na forma em que ela é consumida no corredor.
//
// A grade espelha a estrutura física: uma coluna por módulo, e os níveis de cima para
// baixo, com o nível mais alto no topo — igual a olhar o porta-pallet de frente.
//
// NÃO há estado inventado aqui: todas as posições vêm de `warehouse_storage_bins` e a
// ocupação vem do saldo real. Código que não segue o padrão de nomenclatura não é
// descartado nem "corrigido" — cai num grupo próprio, listado como está.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Lock, PackageOpen } from 'lucide-react';
import { Badge, Button, Input, Notice, Panel, PanelSection, Select } from '../ui';
import { parseBinCode } from '../../lib/wms/binCode';
import {
  listBinContents, listMovementsForBin, setBinCapacity,
  type BinMovement, type BinStockRow, type StorageBin,
} from '../../lib/wms/wmsService';

type Status = 'livre' | 'ocupado' | 'quase-cheio' | 'bloqueado';

/** A partir daqui a vaga é tratada como "quase cheia". 85% é o ponto em que ainda cabe
 *  alguma coisa mas já não cabe um recebimento inteiro — é quando vale avisar, não aos
 *  100%, que é tarde. Só se aplica a endereço COM capacidade declarada: sem limite
 *  declarado não existe "quase". */
const NEARLY_FULL_RATIO = 0.85;

/** `PP-A01-N3` -> rua A, módulo 01, nível 3. Mora em `lib/wms/binCode` porque a etiqueta
 *  impressa faz exatamente a mesma leitura: duas cópias do regex divergiriam na primeira
 *  vez que o padrão de endereço mudasse. Fora do padrão devolve `null` e cai no grupo
 *  "sem posição definida". */
const parseCode = parseBinCode;

/** Percentual de ocupação, ou `null` quando o endereço não tem capacidade declarada —
 *  nesse caso não existe denominador e inventar um seria dado falso. */
const occupancyRatio = (bin: StorageBin, boxes: number): number | null =>
  bin.capacityBoxes ? boxes / bin.capacityBoxes : null;

const statusOf = (bin: StorageBin, boxes: number): Status => {
  if (bin.blocked) return 'bloqueado';
  if (boxes === 0) return 'livre';
  const ratio = occupancyRatio(bin, boxes);
  return ratio !== null && ratio >= NEARLY_FULL_RATIO ? 'quase-cheio' : 'ocupado';
};

/** Cor com significado, não decoração: ocupado usa o acento do produto, bloqueado fica
 *  apagado, livre é superfície neutra. Três estados, três tratamentos — sem paleta
 *  inventada por variedade. */
const CELL_STYLE: Record<Status, string> = {
  livre: 'bg-surface-3 border-edge text-fg-subtle hover:border-fg-subtle',
  ocupado: 'bg-accent/10 border-accent/40 text-fg hover:border-accent',
  // Âmbar é o token de atenção do projeto, e aqui ele carrega significado real: ainda
  // cabe, mas não cabe muito. Não é uma quarta cor por variedade.
  'quase-cheio': 'bg-warning/10 border-warning/50 text-fg hover:border-warning',
  bloqueado: 'bg-surface-2 border-edge text-fg-subtle opacity-60 hover:opacity-100',
};

/** Preenchimento da barra de ocupação — mesma semântica da célula. */
const BAR_FILL: Record<Status, string> = {
  livre: 'bg-edge',
  ocupado: 'bg-accent',
  'quase-cheio': 'bg-warning',
  bloqueado: 'bg-fg-subtle',
};

const STATUS_LABEL: Record<Status, string> = {
  livre: 'Livre',
  ocupado: 'Ocupado',
  'quase-cheio': 'Quase cheio',
  bloqueado: 'Bloqueado',
};

const MOVEMENT_LABEL: Record<BinMovement['movementType'], string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  transferencia: 'Transferência',
};

const STATUS_BADGE: Record<Status, 'neutral' | 'accent' | 'warning'> = {
  livre: 'neutral',
  ocupado: 'accent',
  'quase-cheio': 'warning',
  bloqueado: 'neutral',
};

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function WmsStorageMap({
  bins,
  occupancy,
  canManage,
  onOperate,
  onCapacityChanged,
}: {
  bins: StorageBin[];
  occupancy: Map<string, number>;
  canManage: boolean;
  onOperate: (binCode: string) => void;
  onCapacityChanged: () => void;
}) {
  const [street, setStreet] = useState('');
  const [status, setStatus] = useState<'' | Status>('');
  const [selected, setSelected] = useState<StorageBin | null>(null);
  const [contents, setContents] = useState<BinStockRow[] | null>(null);
  const [history, setHistory] = useState<BinMovement[]>([]);
  const [capacityDraft, setCapacityDraft] = useState('');
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  /** Estrutura do galpão derivada dos códigos existentes — nunca de uma configuração
   *  paralela que poderia divergir do que está cadastrado. */
  const layout = useMemo(() => {
    const streets = new Map<string, { modules: Set<string>; levels: Set<number>; bins: Map<string, StorageBin> }>();
    const loose: StorageBin[] = [];

    for (const bin of bins) {
      const parsed = parseCode(bin.code);
      if (!parsed) { loose.push(bin); continue; }
      const entry = streets.get(parsed.street) ?? { modules: new Set(), levels: new Set(), bins: new Map() };
      entry.modules.add(parsed.module);
      entry.levels.add(parsed.level);
      entry.bins.set(`${parsed.module}|${parsed.level}`, bin);
      streets.set(parsed.street, entry);
    }

    return {
      streets: [...streets.entries()]
        .map(([name, entry]) => ({
          name,
          modules: [...entry.modules].sort(),
          // Nível mais alto no topo: a grade fica igual a olhar a estrutura de frente.
          levels: [...entry.levels].sort((a, b) => b - a),
          bins: entry.bins,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      loose,
    };
  }, [bins]);

  const visibleStreets = street ? layout.streets.filter(s => s.name === street) : layout.streets;

  const matches = (bin: StorageBin | undefined): boolean => {
    if (!bin) return false;
    if (!status) return true;
    return statusOf(bin, occupancy.get(bin.code) ?? 0) === status;
  };

  useEffect(() => {
    setCapacityDraft(selected?.capacityBoxes != null ? String(selected.capacityBoxes) : '');
    setCapacityError(null);
    if (!selected) { setContents(null); setHistory([]); return; }
    let cancelled = false;
    setLoadingDetail(true);
    Promise.all([listBinContents(selected.code), listMovementsForBin(selected.id)])
      .then(([rows, moves]) => {
        if (cancelled) return;
        setContents(rows);
        setHistory(moves);
      })
      .catch(err => console.error('[wms] falha ao abrir o detalhe da vaga:', err))
      .finally(() => { if (!cancelled) setLoadingDetail(false); });
    return () => { cancelled = true; };
  }, [selected]);

  const selectedBoxes = selected ? occupancy.get(selected.code) ?? 0 : 0;
  const selectedStatus = selected ? statusOf(selected, selectedBoxes) : 'livre';
  const selectedRatio = selected ? occupancyRatio(selected, selectedBoxes) : null;
  const selectedParsed = selected ? parseCode(selected.code) : null;

  const handleSaveCapacity = async () => {
    if (!selected) return;
    setSavingCapacity(true);
    setCapacityError(null);
    try {
      const raw = capacityDraft.trim();
      await setBinCapacity(selected.id, raw === '' ? null : Number(raw));
      onCapacityChanged();
    } catch (err) {
      // Reduzir abaixo do que já está guardado é recusado pelo banco (trigger da 118):
      // a mensagem vem de lá, com o número real de caixas.
      setCapacityError(err instanceof Error ? err.message : 'Não foi possível salvar a capacidade.');
    } finally {
      setSavingCapacity(false);
    }
  };

  if (bins.length === 0) {
    return (
      <Panel>
        <PanelSection padding="lg">
          <div className="flex flex-col items-center text-center gap-2 py-8">
            <PackageOpen size={32} className="opacity-40" />
            <p className="text-sm font-medium text-fg">Nenhum endereço cadastrado</p>
            <p className="text-xs text-fg-subtle max-w-[32ch]">
              Crie os endereços na aba Endereços para o mapa do porta-pallet aparecer aqui.
            </p>
          </div>
        </PanelSection>
      </Panel>
    );
  }

  return (
    <>
      <Panel>
        <PanelSection padding="sm" className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-caption">Rua</span>
            <Select value={street} onChange={e => setStreet(e.target.value)} className="w-auto">
              <option value="">Todas</option>
              {layout.streets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </Select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-caption">Situação</span>
            <Select value={status} onChange={e => setStatus(e.target.value as '' | Status)} className="w-auto">
              <option value="">Todas</option>
              <option value="livre">Livre</option>
              <option value="ocupado">Ocupado</option>
              <option value="quase-cheio">Quase cheio</option>
              <option value="bloqueado">Bloqueado</option>
            </Select>
          </label>

          {/* Legenda inline: três amostras pequenas, sem bloco próprio. */}
          <div className="flex items-center gap-3 ml-auto">
            {(['livre', 'ocupado', 'quase-cheio', 'bloqueado'] as Status[]).map(s => (
              <span key={s} className="flex items-center gap-1.5 text-caption">
                <span className={`w-3 h-3 rounded-sm border ${CELL_STYLE[s].split(' ').slice(0, 2).join(' ')}`} />
                {STATUS_LABEL[s]}
              </span>
            ))}
          </div>
        </PanelSection>

        {visibleStreets.map(s => (
          <PanelSection key={s.name} padding="sm">
            <div className="flex items-baseline gap-2 mb-3">
              <h3 className="text-title">Rua {s.name}</h3>
              <span className="text-caption">
                {s.modules.length} {s.modules.length === 1 ? 'módulo' : 'módulos'}
                {' · '}
                {s.levels.length} {s.levels.length === 1 ? 'nível' : 'níveis'}
              </span>
            </div>

            {/* Grade elástica: a coluna encolhe até caber a rua inteira na largura
                disponível — um paredão de 16 módulos tem que ser visto de uma vez, não
                em duas rolagens. O mínimo garante que a célula continue legível; abaixo
                disso (celular) a rolagem horizontal própria assume, sem empurrar a
                página de lado. */}
            <div className="overflow-x-auto -mx-1 px-1">
              <div
                className="grid gap-1.5"
                style={{
                  gridTemplateColumns: `2rem repeat(${s.modules.length}, minmax(2.5rem, 1fr))`,
                  // Teto: sem ele, uma rua de 3 módulos estica cada célula por toda a
                  // largura e fica desproporcional ao lado de uma de 16.
                  maxWidth: `${2 + s.modules.length * (4.5 + 0.375)}rem`,
                }}
              >
                {s.levels.map(level => (
                  <Fragment key={level}>
                    <span className="flex items-center justify-end pr-1 text-caption text-numeric">
                      N{level}
                    </span>
                    {s.modules.map(module => {
                      const bin = s.bins.get(`${module}|${level}`);
                      if (!bin) {
                        // Buraco real na estrutura (nível que não existe naquele módulo).
                        return <span key={module} aria-hidden="true" />;
                      }
                      const boxes = occupancy.get(bin.code) ?? 0;
                      const st = statusOf(bin, boxes);
                      const dim = !matches(bin);
                      return (
                        <button
                          key={module}
                          type="button"
                          onClick={() => setSelected(bin)}
                          aria-label={`${bin.code} — ${STATUS_LABEL[st]}`}
                          aria-pressed={selected?.id === bin.id}
                          className={`rounded-container border px-1 py-2 text-center transition-colors
                            ${CELL_STYLE[st]}
                            ${dim ? 'opacity-25' : ''}
                            ${selected?.id === bin.id ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface-2' : ''}`}
                        >
                          <span className="block text-[11px] font-semibold text-code leading-tight">{module}</span>
                          <span className="block text-caption leading-tight mt-0.5">
                            {st === 'bloqueado'
                              ? <Lock size={11} className="inline" />
                              : bin.capacityBoxes
                                ? `${boxes}/${bin.capacityBoxes}`
                                : boxes > 0
                                  ? `${boxes} cx`
                                  : '—'}
                          </span>
                          {/* Barra só existe quando há capacidade declarada: sem
                              denominador não há proporção a desenhar. */}
                          {bin.capacityBoxes != null && st !== 'bloqueado' && (
                            <span className="block h-1 mt-1 rounded-full bg-edge/60 overflow-hidden" aria-hidden="true">
                              <span
                                className={`block h-full rounded-full ${BAR_FILL[st]}`}
                                style={{ width: `${Math.min(100, Math.round((occupancyRatio(bin, boxes) ?? 0) * 100))}%` }}
                              />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          </PanelSection>
        ))}

        {layout.loose.length > 0 && (
          <PanelSection padding="sm">
            <h3 className="text-title">Fora do padrão de nomenclatura</h3>
            <p className="text-caption mt-1">
              Estes endereços não seguem o formato rua/módulo/nível e por isso não entram na grade.
              Continuam funcionando normalmente.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {layout.loose.map(bin => {
                const boxes = occupancy.get(bin.code) ?? 0;
                return (
                  <button
                    key={bin.id}
                    type="button"
                    onClick={() => setSelected(bin)}
                    className={`rounded-container border px-2.5 py-1.5 text-xs transition-colors ${CELL_STYLE[statusOf(bin, boxes)]}`}
                  >
                    <span className="text-code">{bin.code}</span>
                  </button>
                );
              })}
            </div>
          </PanelSection>
        )}
      </Panel>

      {selected && (
        <Panel>
          <PanelSection padding="sm" className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-title text-code">{selected.code}</h3>
                <Badge variant={STATUS_BADGE[selectedStatus]}>{STATUS_LABEL[selectedStatus]}</Badge>
              </div>
              {/* Endereço decomposto: o código é compacto para caber na célula, mas na
                  hora de mandar alguém até lá "Rua A · Módulo 03 · Nível 2" é o que a
                  pessoa usa. */}
              <p className="text-caption mt-1">
                {selectedParsed
                  ? `Rua ${selectedParsed.street} · Módulo ${selectedParsed.module} · Nível ${selectedParsed.level}`
                  : 'Endereço fora do padrão rua/módulo/nível'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => onOperate(selected.code)}>Movimentar</Button>
              <Button variant="secondary" onClick={() => setSelected(null)}>Fechar</Button>
            </div>
          </PanelSection>

          <PanelSection padding="sm">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <span className="text-caption">Caixas guardadas</span>
                <p className="text-lg font-semibold text-fg text-numeric">{selectedBoxes}</p>
              </div>
              <div>
                <span className="text-caption">Capacidade</span>
                <p className="text-lg font-semibold text-fg text-numeric">{selected.capacityBoxes ?? 'sem limite'}</p>
              </div>
              <div>
                <span className="text-caption">Espaço disponível</span>
                <p className="text-lg font-semibold text-fg text-numeric">
                  {selected.capacityBoxes ? Math.max(0, selected.capacityBoxes - selectedBoxes) : '—'}
                </p>
              </div>
              <div>
                <span className="text-caption">Produtos distintos</span>
                <p className="text-lg font-semibold text-fg text-numeric">{contents?.length ?? 0}</p>
              </div>
            </div>

            {selectedRatio !== null && (
              <div className="mt-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-caption">Ocupação</span>
                  <span className="text-caption text-numeric">{Math.round(selectedRatio * 100)}%</span>
                </div>
                <span className="block h-1.5 mt-1.5 rounded-full bg-edge/60 overflow-hidden">
                  <span
                    className={`block h-full rounded-full ${BAR_FILL[selectedStatus]}`}
                    style={{ width: `${Math.min(100, Math.round(selectedRatio * 100))}%` }}
                  />
                </span>
              </div>
            )}

            {selected.blocked && selected.blockedReason && (
              <p className="text-caption mt-3">Motivo do bloqueio: {selected.blockedReason}</p>
            )}

            {canManage && (
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="text-caption">Capacidade em caixas</span>
                  <Input
                    type="number"
                    min={1}
                    value={capacityDraft}
                    onChange={e => setCapacityDraft(e.target.value)}
                    placeholder="sem limite"
                    className="w-40"
                  />
                </label>
                <Button variant="secondary" onClick={handleSaveCapacity} disabled={savingCapacity}>
                  {savingCapacity ? 'Salvando...' : 'Salvar capacidade'}
                </Button>
                <span className="text-caption">Vazio = sem limite declarado.</span>
              </div>
            )}

            {capacityError && <div className="mt-3"><Notice tone="danger">{capacityError}</Notice></div>}
          </PanelSection>

          <PanelSection padding="sm">
            {loadingDetail ? (
              <p className="text-caption">Carregando...</p>
            ) : contents && contents.length > 0 ? (
              <ul className="divide-y divide-edge">
                {contents.map(row => (
                  <li key={row.productId} className="py-2 flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      <span className="text-code text-sm text-fg">{row.sku}</span>
                      <span className="text-sm text-fg-muted"> · {row.productName}</span>
                    </span>
                    <span className="text-sm text-fg-muted shrink-0 text-numeric">
                      {row.boxes} cx · {row.units} un
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-caption">Esta vaga está vazia.</p>
            )}

          </PanelSection>

          <PanelSection padding="sm">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-section">Histórico desta vaga</h4>
              {history.length > 0 && (
                <span className="text-caption">Última: {formatDateTime(history[0].createdAt)}</span>
              )}
            </div>

            {loadingDetail ? (
              <p className="text-caption mt-2">Carregando...</p>
            ) : history.length === 0 ? (
              <p className="text-caption mt-2">Nenhuma movimentação registrada nesta vaga.</p>
            ) : (
              <ul className="divide-y divide-edge mt-1">
                {history.map(move => (
                  <li key={move.id} className="py-2 flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="text-fg">{MOVEMENT_LABEL[move.movementType]}</span>
                      <span className="text-fg-muted"> · {move.sku ?? '—'}</span>
                      {move.movementType === 'transferencia' && (
                        <span className="text-caption"> · {move.fromCode} → {move.toCode}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-fg-muted text-numeric">
                      {move.boxes} cx
                      <span className="text-caption"> · {formatDateTime(move.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </PanelSection>
        </Panel>
      )}
    </>
  );
}
```


---

## 5. Estado Atual vs. Lacunas

### 5.0 Volume real em produção (medido agora, não estimado)

| | |
|---|---|
| Endereços cadastrados | **215** (todos no andar 1 — existe 1 andar distinto) |
| Linhas de saldo (`warehouse_bin_stock`) | **9** |
| Movimentos registrados (`warehouse_bin_movements`) | **11** |
| Seções de planta (`warehouse_plan_sections`) | **2** |
| Produtos com `location` preenchido | **2.174** |
| …desses, no padrão de endereço (`PP-A01-N1`) | **0** |

Isto importa para a leitura de tudo acima: **o módulo WMS está construído e correto, mas
quase não foi usado ainda.** 11 movimentos é volume de teste, não de operação. Toda a
regra de negócio está exercitada por 3.635 testes automatizados, não por carga real — então
contenção de concorrência, desempenho de consulta e casos de borda de saldo ainda não
foram postos à prova pelo uso.

### 5.1 Funcional e em produção

- **Endereçamento completo.** Criação em lote por padrão de código (`buildBinCodes`),
  capacidade por endereço, bloqueio com motivo, exclusão com guarda, pavimento e prédio.
- **Movimentação com integridade garantida pelo banco.** Entrada, saída e transferência
  via RPC `SECURITY DEFINER`, com `FOR UPDATE` no saldo, validação de capacidade, recusa de
  pack misto e razão append-only. **Sem policy de escrita** nas tabelas de saldo e razão —
  o front não consegue burlar nem por engano.
- **FIFO real.** `first_stored_at` não é tocado no `DO UPDATE` da entrada e viaja junto na
  transferência (`LEAST`). Mudar de endereço não rejuvenesce estoque.
- **Papel exigido para mover estoque:** `owner|admin|manager|counter|lead`; `viewer` não move.
- **Leitura de código de barras / QR:** `jsqr` + `bwip-js` no bundle, `qrDecoder.ts`,
  `binScan.ts` e `WmsBinScanner.tsx` funcionando — bipagem de endereço está operante.
- **Mapa 2D** (`WmsStorageMap`) e **mapa 3D** consumindo o mesmo dado real, sem mock.
- **Curva ABC** alimentando a cor das vagas no 3D.
- **Tempo real** por `warehouse3dRealtime.ts`, com atualização incremental de uma vaga
  (`aplicarSaldo`) em vez de recarga completa — medido 453 ms contra 218 ms.
- **Sugestão de endereço** (`binSuggestion.ts`) e **recomendação de slotting**
  (`warehouse_slotting_recommendations`).
- **Multi-tenant** funcionando com RLS em 175 das 176 tabelas.

### 5.2 Lacunas e dívidas — o que um auditor deve olhar primeiro

1. **Não existe `database.types.ts`.** Nenhum tipo gerado do schema. Os ~30 serviços
   declaram as linhas à mão. Renomear uma coluna não quebra o typecheck — quebra em
   produção. **É a lacuna número um.**

2. **`company_id` é `text` nas tabelas de WMS e `uuid` em `companies`/`profiles`.** Sem
   foreign key possível, sem integridade referencial de tenant. Um `company_id` órfão é
   aceito pelo banco.

3. **`products.location` é texto livre e não casa com endereço.** Medido em produção:
   dos 2.174 produtos com `location` preenchido, **zero** seguem o padrão `PP-A01-N1`. Por
   isso não há como ligar uma divergência de contagem a uma vaga, e o 3D usa
   `divergence` apenas para **capacidade excedida** — nunca para divergência de inventário.
   Qualquer relatório que cruze produto × endereço por `location` vai estar errado.

4. **Picking não existe como fluxo.** Há a primitiva (`wms_bin_pick`) e há rota de coleta
   desenhada no 3D (`warehouse3dRota.ts`), mas **não há onda, lista, separador atribuído,
   conferência de saída nem status de pedido**. O que existe é retirada avulsa de um
   endereço. As tabelas `purchase_orders`/`po_allocations` cobrem compra, não separação.

5. **`listBins` é cego a pavimento.** A coluna `andar` existe e o seletor de pavimento
   existe no 3D, mas a consulta não filtra. Hoje não dá problema porque os 215 endereços
   estão todos no andar 1; vira bug no dia em que houver endereço no andar 2.

6. **Medidas da planta do prédio atual estão erradas.** `warehouse_plan_sections` desenha
   8 posições por fileira onde o cadastro tem 13 e 16. Como virou tabela (migration 133),
   dá para corrigir sem deploy.

7. **O 2º pavimento tem só rascunho** de planta 2D (21×37 @ 0,5 m), nunca publicado.

8. **Dois razões de movimentação de estoque coexistem:** `warehouse_bin_movements` (WMS) e
   `return_stock_movements` (logística reversa, 15 colunas). Não há visão unificada, e
   nada garante que uma devolução que volta ao estoque apareça no razão do WMS.

9. **`stock_quantity` em `products` convive com o saldo por endereço.** São duas fontes
   para a mesma pergunta e nenhum trigger as reconcilia. Qual é a verdade depende da tela.

10. **`automation_runtime_config` está sem RLS** (única tabela de `public` nessa condição)
    e 6 tabelas têm RLS ligado com **zero policies** (`api_key_rate_limits`,
    `automation_webhook_secrets`, `company_webhook_secrets`, `integration_credentials`,
    `integration_webhook_secrets`, `nfe_provider_fetch_locks`) — o que as torna inacessíveis
    pelo cliente, provavelmente intencional por serem segredos, mas vale confirmar.

11. **Conferência cega de recebimento não está ligada ao endereço.** `nfe_putaway_item`
    endereça o item da nota, mas a conferência física (`physical_count_*`) roda em outro
    eixo, por produto.

12. **Versionamento do pacote é fictício** (`0.0.0`, nome `vite-react-typescript-starter`).

13. **Lint com 38 avisos** (0 erros), quase todos `react-refresh/only-export-components`.

### 5.3 O que NÃO está mockado

Vale dizer explicitamente, porque é incomum num projeto deste porte: **não encontrei dado
mockado no caminho do WMS**. Mapa 2D, mapa 3D, saldo, movimentação, busca, curva ABC e
tempo real leem do Supabase. O que falta é funcionalidade inexistente (picking, pavimento),
não funcionalidade fingida.
