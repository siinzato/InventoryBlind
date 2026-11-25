-- 133 — As medidas da planta física do galpão, como DADO.
--
-- Até aqui a planta do AZ 2027 era constante em `src/lib/wms/warehouse3dPlantaFisica.ts`:
-- comprimento de trecho, número de fileiras, largura de corredor. Medida de galpão não é
-- regra de negócio — é levantamento, e levantamento muda. Com a medida no código, trocar
-- "o corredor tem 2,65" por "o corredor tem 2,40" exigia build e deploy do sistema
-- inteiro para mexer num número que a operação confere com trena.
--
-- As próprias medidas atuais vieram de uma planta que se declara aproximada (HomeByMe
-- mais fotos). Elas nasceram para serem corrigidas.
--
-- ── O que esta tabela NÃO é ───────────────────────────────────────────────────────
-- Não é endereço nem planta publicada. Ela descreve a GEOMETRIA do prédio: onde cada
-- trecho começa, quanto mede, quantas fileiras tem e como elas se distribuem na largura.
-- Quem manda em vaga continua sendo `warehouse_storage_bins`; quem manda na planta 2D
-- desenhada célula a célula continua sendo `warehouse_cells`; esboço do Modo Edição
-- continua em `warehouse_builder_objects`.
--
-- ── Por que trecho, e não fileira linha a linha ───────────────────────────────────
-- Foi a alternativa considerada: uma linha por fileira, com x e z próprios. Ela perde a
-- REGRA. Hoje as posições em X saem de `distribuicao` — `uniforme` espalha com passo
-- igual, `dupla-central` monta parede/dupla/parede —, e é a regra que garante que a
-- fileira da ponta não nasça dentro da parede quando alguém corrigir a largura do
-- corredor. Com x solto por fileira, corrigir um corredor passaria a exigir recalcular à
-- mão a posição de todas as outras, e o primeiro erro seria rack sobre corredor.
--
-- ── rotulos ──────────────────────────────────────────────────────────────────────
-- A letra da rua na ordem em que as fileiras aparecem no eixo X. É o que liga o desenho
-- ao cadastro: a terceira fileira do galpão novo é a RUA G, e por isso o vão dela vira
-- `PP-G07-N2`. Estava fixo no código como valor-padrão de parâmetro; aqui ele acompanha
-- o trecho, que é onde a informação pertence. Array curto demais deixa a fileira sem
-- nome, em vez de inventar uma letra — e fileira sem nome não recebe endereço.

create table if not exists public.warehouse_plan_sections (
  id                      uuid primary key default gen_random_uuid(),
  company_id              text not null default get_my_company_id(),
  andar                   integer not null default 1,
  nome                    text not null,
  -- Metros, no mesmo referencial do módulo que desenha: Z corre do fundo do prédio atual
  -- até o portão da rua, X é a largura, origem no canto.
  z_inicio                numeric not null,
  comprimento             numeric not null,
  fileiras                integer not null,
  comprimento_da_fileira  numeric not null,
  corredor_inicio         numeric not null default 0,
  distribuicao            text not null default 'uniforme',
  corredor_longitudinal   numeric not null default 1.2,
  rotulos                 text[] not null default '{}',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint warehouse_plan_sections_andar_check check (andar >= 1),
  -- Guardas contra o desenho impossível. Comprimento zero some da cena sem erro nenhum, e
  -- fileira negativa quebra o laço que monta as posições em X.
  constraint warehouse_plan_sections_comprimento_check check (comprimento > 0),
  constraint warehouse_plan_sections_fileiras_check check (fileiras >= 0 and fileiras <= 40),
  constraint warehouse_plan_sections_fileira_check check (comprimento_da_fileira > 0),
  constraint warehouse_plan_sections_corredores_check
    check (corredor_inicio >= 0 and corredor_longitudinal >= 0),
  constraint warehouse_plan_sections_distribuicao_check
    check (distribuicao in ('uniforme', 'dupla-central'))
);

-- Um trecho por nome dentro do pavimento: é o que torna o seed abaixo repetível e o que
-- impede "Galpão novo" duplicado desenhando duas vezes no mesmo lugar.
create unique index if not exists warehouse_plan_sections_unico_idx
  on public.warehouse_plan_sections (company_id, andar, nome);

create index if not exists warehouse_plan_sections_company_andar_idx
  on public.warehouse_plan_sections (company_id, andar, z_inicio);

alter table public.warehouse_plan_sections enable row level security;

-- As MESMAS quatro políticas de `warehouse_cells` e `warehouse_builder_objects`, lidas da
-- definição viva do banco: ler é de quem é da empresa, escrever é de owner/admin/manager.
-- Critério diferente aqui criaria uma segunda regra de quem pode mexer no layout.
do $policies$
begin
  if not exists (select 1 from pg_policies where tablename = 'warehouse_plan_sections' and policyname = 'warehouse_plan_sections_select') then
    create policy warehouse_plan_sections_select on public.warehouse_plan_sections
      for select using (company_id = get_my_company_id());
  end if;

  if not exists (select 1 from pg_policies where tablename = 'warehouse_plan_sections' and policyname = 'warehouse_plan_sections_insert') then
    create policy warehouse_plan_sections_insert on public.warehouse_plan_sections
      for insert with check (
        company_id = get_my_company_id()
        and get_my_role() = any (array['owner', 'admin', 'manager'])
      );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'warehouse_plan_sections' and policyname = 'warehouse_plan_sections_update') then
    create policy warehouse_plan_sections_update on public.warehouse_plan_sections
      for update using (
        company_id = get_my_company_id()
        and get_my_role() = any (array['owner', 'admin', 'manager'])
      ) with check (
        company_id = get_my_company_id()
        and get_my_role() = any (array['owner', 'admin', 'manager'])
      );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'warehouse_plan_sections' and policyname = 'warehouse_plan_sections_delete') then
    create policy warehouse_plan_sections_delete on public.warehouse_plan_sections
      for delete using (
        company_id = get_my_company_id()
        and get_my_role() = any (array['owner', 'admin', 'manager'])
      );
  end if;
end
$policies$;

-- ── Seed: exatamente o que a constante já dizia ───────────────────────────────────
--
-- Os números abaixo são cópia literal de AZ2027_TERREO. O objetivo da migration é mudar
-- ONDE a medida mora, não a medida: se o seed divergisse da constante, o mapa mudaria de
-- desenho no deploy e ninguém saberia dizer qual dos dois estava certo.
--
-- `get_my_company_id()` não serve aqui — a migration roda sem sessão de usuário e a
-- função devolveria nulo, gravando trecho que ninguém enxerga. A empresa vai explícita.
insert into public.warehouse_plan_sections
  (company_id, andar, nome, z_inicio, comprimento, fileiras, comprimento_da_fileira,
   corredor_inicio, distribuicao, corredor_longitudinal, rotulos)
values
  ('00000000-0000-0000-0000-000000000001', 1, 'Prédio atual',
   0, 18.6, 5, 10.5, 1.4, 'uniforme', 1.2, array['A', 'B', 'C', 'D']),
  ('00000000-0000-0000-0000-000000000001', 1, 'Galpão novo',
   18.6, 26.6, 4, 15.0, 2.2, 'dupla-central', 2.65, array['E', 'F', 'G', 'H'])
on conflict (company_id, andar, nome) do nothing;

comment on table public.warehouse_plan_sections is
  'Medidas da planta física do galpão (metros) que o mapa 3D desenha. NÃO é fonte de endereço (warehouse_storage_bins) nem planta publicada (warehouse_cells).';
