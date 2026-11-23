-- 131 — Uma planta por pavimento.
--
-- A 130 pôs `andar` na célula e na vaga, mas deixou aberto onde o Andar 2 ia morar.
-- Decisão tomada: UMA PLANTA POR PAVIMENTO, e não duas lajes dentro da mesma planta.
--
-- ── Por que não as duas lajes na mesma planta ─────────────────────────────────────
-- Exigiria alargar UNIQUE (layout_id, x, y) para incluir `andar`, o que quebra o
-- `onConflict: 'layout_id,x,y'` do app no instante do alter (ver 130). E, pior que isso,
-- `getCells` passaria a devolver os dois andares misturados para TODO consumidor:
-- `findShortestPath` caminharia de um andar para o outro como se fosse plano, e a
-- validação de publicação contaria posição das duas lajes como se fossem uma. Seriam
-- erros silenciosos, não erros de tela.
--
-- Uma planta por pavimento mantém cada grade sendo o que ela sempre foi — um piso só —,
-- com escala, imagem de fundo e tamanho próprios. O térreo tem 45,2 m (prédio atual +
-- galpão novo, piso contínuo); o Andar 2 tem 18,5 m, só sobre o prédio atual.
--
-- ── O índice parcial é o ponto central desta migration ────────────────────────────
-- `getActiveLayout`, `getPublishedLayout` e `getDraftLayout` usam `.maybeSingle()`, que
-- devolve ERRO quando a consulta casa mais de uma linha — e o chamador trata erro
-- devolvendo null, ou seja, a tela perde a planta sem dizer por quê. Com duas plantas
-- publicadas (uma por andar) isso aconteceria na primeira vez que o Andar 2 existisse.
--
-- Os dois índices abaixo garantem no BANCO o que aquelas funções assumem: no máximo uma
-- publicada e no máximo um rascunho por pavimento. Com as leituras filtrando por `andar`,
-- `.maybeSingle()` volta a ser correto por construção, em vez de correto por sorte.

alter table public.warehouse_layouts
  add column if not exists andar integer not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'warehouse_layouts_andar_check') then
    alter table public.warehouse_layouts
      add constraint warehouse_layouts_andar_check check (andar >= 1);
  end if;
end $$;

-- Parciais de propósito: `archived` pode ter quantas versões houver por pavimento — é o
-- histórico. A unicidade só vale para o que as telas leem.
create unique index if not exists warehouse_layouts_uma_publicada_por_andar
  on public.warehouse_layouts (company_id, andar)
  where status = 'published';

create unique index if not exists warehouse_layouts_um_rascunho_por_andar
  on public.warehouse_layouts (company_id, andar)
  where status = 'draft';

comment on column public.warehouse_layouts.andar is
  'Pavimento que esta planta representa. 1 = térreo. Uma planta cobre UM piso: os índices parciais garantem no máximo uma publicada e um rascunho por pavimento, que é o que o .maybeSingle() das leituras assume.';
