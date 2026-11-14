-- 129 — Realtime para o WMS Pulmão
--
-- Autorizado explicitamente pelo usuário em 14/11/2026.
--
-- POR QUE
-- O mapa 3D do Pulmão precisa refletir movimentação feita por outro operador sem que
-- ninguém recarregue a tela. Hoje a publicação supabase_realtime tem exatamente três
-- tabelas, todas de notificação — nenhuma do WMS. Assinar as vagas sem isto conecta o
-- canal com sucesso e não recebe nada, para sempre: um recurso morto com aparência de
-- vivo, que é pior do que recurso ausente.
--
-- O QUE MUDA
-- Só a publicação lógica e a identidade de réplica de uma tabela. Nenhuma coluna,
-- nenhuma policy, nenhum grant, nenhum dado.
--
-- ISOLAMENTO ENTRE EMPRESAS
-- Publicar uma tabela faz dela fonte de eventos, não de acesso livre. O Realtime avalia
-- a policy de SELECT por assinante, e as duas tabelas já têm RLS ativo com
-- isolamento por empresa:
--   warehouse_bin_stock    -> wms_stock_select : company_id = get_my_company_id()
--   warehouse_storage_bins -> wms_bins_select  : company_id = get_my_company_id()
-- Conferido antes de aplicar. Nenhuma das duas depende de policy permissiva, e
-- nenhuma política é criada ou alterada aqui.
--
-- POR QUE REPLICA IDENTITY FULL EM warehouse_bin_stock, E SÓ NELA
-- Com a identidade padrão, o evento de DELETE carrega apenas a chave primária. Tirar
-- um pallet de uma vaga É um delete nessa tabela, e só com a PK não há como saber QUAL
-- endereço esvaziou — o mapa saberia que algo mudou sem saber onde, e o destaque
-- visual apontaria para a vaga errada ou para nenhuma.
-- A tabela tem 6 linhas hoje e baixo volume de escrita, então o custo de WAL é
-- irrelevante perto de acertar o endereço.
-- warehouse_storage_bins fica na identidade padrão de propósito: ali o que importa é o
-- UPDATE (bloquear/desbloquear), cujo registro novo já vem completo. Exclusão de
-- endereço é rara e some do mapa na recarga, sem precisar de destaque.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'warehouse_bin_stock'
  ) then
    execute 'alter publication supabase_realtime add table public.warehouse_bin_stock';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'warehouse_storage_bins'
  ) then
    execute 'alter publication supabase_realtime add table public.warehouse_storage_bins';
  end if;
end $$;

alter table public.warehouse_bin_stock replica identity full;
