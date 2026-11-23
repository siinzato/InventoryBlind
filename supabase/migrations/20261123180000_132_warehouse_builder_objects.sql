-- 132 — As peças montadas no Modo Edição do mapa 3D.
--
-- O builder construía em estado local do React: o que a pessoa montava sumia ao sair da
-- tela, e ninguém mais da equipe via. Esta tabela é o lugar onde isso passa a viver.
--
-- ── Por que NÃO entrou em warehouse_cells ─────────────────────────────────────────
-- Foi a primeira opção, e ela não serve: a célula é um quadrado de grade com x/y
-- inteiros e um tipo. A peça do builder tem posição em METROS, rotação livre em 90° e
-- uma variante de estante. Forçar isso na célula perderia a rotação e obrigaria a
-- arredondar a posição para a grade, que é justamente a liberdade que o builder existe
-- para dar.
--
-- ── E por que isso NÃO é uma terceira fonte de verdade ────────────────────────────
-- Esta tabela guarda ESBOÇO, não endereço. Quem manda em endereço continua sendo
-- `warehouse_storage_bins`; quem manda na planta publicada continua sendo
-- `warehouse_cells`. Uma peça aqui não cria vaga, não recebe mercadoria e não aparece
-- em contagem — ela é o desenho de uma intenção de layout. No dia em que uma peça
-- esboçada virar estante de verdade, o que nasce é endereço nas vagas, e a peça vira
-- histórico. Chamar isso de "layout oficial" seria o erro que a 131 evitou.
--
-- ── Pavimento ────────────────────────────────────────────────────────────────────
-- `andar` pelo mesmo motivo das outras: o AZ 2027 tem porta-pallets em duas lajes, e
-- esboço do mezanino não pode aparecer no térreo.

create table if not exists public.warehouse_builder_objects (
  id          uuid primary key default gen_random_uuid(),
  company_id  text not null default get_my_company_id(),
  andar       integer not null default 1,
  tipo        text not null,
  -- Só faz sentido para porta-pallets; as outras peças carregam o default e o ignoram.
  estante     text not null default 'simples',
  cor         text not null default 'laranja',
  -- Metros, não células: é o que o builder produz e o que o 3D consome.
  x           numeric not null,
  z           numeric not null,
  -- Radianos. Guardado como número, e não como "graus", para não precisar converter em
  -- cada leitura — o three trabalha em radianos.
  rotacao_y   numeric not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint warehouse_builder_objects_andar_check check (andar >= 1),
  constraint warehouse_builder_objects_tipo_check
    check (tipo in ('porta-pallets', 'mesa', 'doca')),
  constraint warehouse_builder_objects_estante_check
    check (estante in ('simples', 'duplo', 'picking'))
);

create index if not exists warehouse_builder_objects_company_andar_idx
  on public.warehouse_builder_objects (company_id, andar);

alter table public.warehouse_builder_objects enable row level security;

-- As MESMAS quatro políticas de `warehouse_cells`, copiadas da definição viva: ler é de
-- quem é da empresa, escrever é de owner/admin/manager. Inventar um critério diferente
-- aqui criaria uma segunda regra de quem pode mexer no layout.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'warehouse_builder_objects' and policyname = 'warehouse_builder_objects_select') then
    create policy warehouse_builder_objects_select on public.warehouse_builder_objects
      for select using (company_id = get_my_company_id());
  end if;

  if not exists (select 1 from pg_policies where tablename = 'warehouse_builder_objects' and policyname = 'warehouse_builder_objects_insert') then
    create policy warehouse_builder_objects_insert on public.warehouse_builder_objects
      for insert with check (
        company_id = get_my_company_id()
        and get_my_role() = any (array['owner', 'admin', 'manager'])
      );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'warehouse_builder_objects' and policyname = 'warehouse_builder_objects_update') then
    create policy warehouse_builder_objects_update on public.warehouse_builder_objects
      for update using (
        company_id = get_my_company_id()
        and get_my_role() = any (array['owner', 'admin', 'manager'])
      ) with check (
        company_id = get_my_company_id()
        and get_my_role() = any (array['owner', 'admin', 'manager'])
      );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'warehouse_builder_objects' and policyname = 'warehouse_builder_objects_delete') then
    create policy warehouse_builder_objects_delete on public.warehouse_builder_objects
      for delete using (
        company_id = get_my_company_id()
        and get_my_role() = any (array['owner', 'admin', 'manager'])
      );
  end if;
end $$;

comment on table public.warehouse_builder_objects is
  'Esboço de layout montado no Modo Edição do mapa 3D. NÃO é fonte de endereço: vaga continua em warehouse_storage_bins e planta publicada em warehouse_cells.';
