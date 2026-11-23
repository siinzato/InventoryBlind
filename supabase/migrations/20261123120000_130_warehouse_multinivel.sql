-- 130 — Estrutura multinível do galpão: andar, prédio e ativo.
--
-- Contexto: a AZ muda para o imóvel "AZ 2027", que tem porta-pallets em DOIS
-- pavimentos (térreo e mezanino) e em DOIS prédios encostados (o atual, de ~18,6 m, e
-- o galpão novo, de ~26,6 m, ligados por passagem). O modelo atual não sabe dizer em
-- que laje nem em que prédio uma vaga ou uma célula de planta está.
--
-- ── Por que só colunas, e NENHUMA mudança de unique ───────────────────────────────
-- `warehouse_cells` tem UNIQUE (layout_id, x, y). Guardar duas lajes na MESMA planta
-- exigiria alargar essa unique para incluir `andar` — e o `upsertCell`/`upsertCellsBatch`
-- do app usam `onConflict: 'layout_id,x,y'`, que deixaria de casar com qualquer
-- constraint no instante em que ela mudasse. O banco é compartilhado com a produção,
-- então a troca derrubaria a edição de planta no app publicado ANTES de qualquer deploy.
--
-- Esta migration é deliberadamente aditiva: nada que o app faz hoje muda de
-- comportamento. Onde o Andar 2 vai morar — mesma planta com a unique alargada, ou uma
-- planta por pavimento — é decisão seguinte, e ela é que precisa vir junto de código.
--
-- ── Por que NOT NULL com default, e não nullable ──────────────────────────────────
-- Toda vaga e toda célula está fisicamente em algum andar e em algum prédio; não existe
-- "andar desconhecido" como estado legítimo do negócio. Nullable só adiaria a pergunta
-- para cada consulta que fosse ler a coluna.
--
-- ── Nada é apagado ────────────────────────────────────────────────────────────────
-- As 8 vagas com saldo/movimento continuam intactas (as FKs de `warehouse_bin_stock` e
-- `warehouse_bin_movements` são ON DELETE RESTRICT de propósito). `is_active` existe
-- justamente para aposentar endereço que saiu do layout sem apagar o histórico dele.

alter table public.warehouse_cells
  add column if not exists andar     integer not null default 1,
  add column if not exists predio    text    not null default 'atual',
  add column if not exists is_active boolean not null default true;

alter table public.warehouse_storage_bins
  add column if not exists andar     integer not null default 1,
  add column if not exists predio    text    not null default 'atual',
  add column if not exists is_active boolean not null default true;

-- `andar >= 1` em vez de `in (1, 2)`: o imóvel de hoje tem dois pavimentos, mas um
-- terceiro andar exigiria OUTRA migration só para afrouxar o CHECK, sem ganho nenhum de
-- segurança — o que precisa ser barrado é 0 e negativo, não o 3.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'warehouse_cells_andar_check') then
    alter table public.warehouse_cells
      add constraint warehouse_cells_andar_check check (andar >= 1);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'warehouse_cells_predio_check') then
    alter table public.warehouse_cells
      add constraint warehouse_cells_predio_check check (predio in ('atual', 'novo'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'warehouse_storage_bins_andar_check') then
    alter table public.warehouse_storage_bins
      add constraint warehouse_storage_bins_andar_check check (andar >= 1);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'warehouse_storage_bins_predio_check') then
    alter table public.warehouse_storage_bins
      add constraint warehouse_storage_bins_predio_check check (predio in ('atual', 'novo'));
  end if;
end $$;

-- Backfill do que já existe.
--
-- As ruas A, B, C e D são o TÉRREO DO PRÉDIO ATUAL — confirmado pelo usuário nesta
-- conversa, e é o que o default já diz, então elas não precisam de update.
--
-- As ruas E, F, G e H foram criadas em 23/11/2026 para o GALPÃO NOVO (4 fileiras,
-- 20 posições, 3 níveis, 240 vagas). Sem este update elas herdariam 'atual' do default
-- e o mapa colocaria o galpão novo dentro do prédio antigo.
update public.warehouse_storage_bins
   set predio = 'novo'
 where code ~ '^PP-[EFGH][0-9]';

comment on column public.warehouse_cells.andar is
  'Pavimento da célula. 1 = térreo. Hoje toda célula de uma planta compartilha o mesmo andar; a unique (layout_id, x, y) ainda impede duas lajes na mesma planta.';
comment on column public.warehouse_cells.predio is
  'Prédio da célula no conjunto AZ 2027: ''atual'' (~18,6 m) ou ''novo'' (~26,6 m, em obra).';
comment on column public.warehouse_cells.is_active is
  'false aposenta a célula sem apagá-la, para layout antigo não sumir do histórico.';

comment on column public.warehouse_storage_bins.andar is
  'Pavimento da vaga. 1 = térreo. O código impresso (PP-A01-N1) NÃO carrega o andar — quem distingue é esta coluna.';
comment on column public.warehouse_storage_bins.predio is
  'Prédio da vaga: ''atual'' (ruas A–D) ou ''novo'' (ruas E–H, criadas em 23/11/2026).';
comment on column public.warehouse_storage_bins.is_active is
  'false aposenta o endereço sem apagá-lo — necessário porque vaga com saldo ou movimento é recusada pelo ON DELETE RESTRICT.';
