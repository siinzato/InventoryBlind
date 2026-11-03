/*
  # 109 — Curva ABC Fase 2: política comercial por análise, sinais e referência do Tiny

  Estritamente aditiva. Não edita a migration 078, não remove nem renomeia coluna, não cria
  tabela nova e não toca em nenhuma tabela de Inventário, products ou classificação ABC/XYZ.

  ## 1. Política comercial por análise (abc_curve_analyses)

  Os limiares comerciais viviam como constantes fixas dentro de abcCurveRecommendations.ts
  (7 / 30 / 90 dias, 15% / 40% de margem). Passam a ser registrados na própria análise, para
  a recomendação de uma análise publicada continuar explicável no futuro mesmo que o padrão
  do produto mude.

  Os DEFAULTs são exatamente os valores que estavam no código, então:
    - toda análise já publicada recebe a política equivalente à regra antiga;
    - nenhuma análise histórica muda de resultado por causa desta migration.

  threshold_a e threshold_b (078) continuam existindo e continuam sendo a fonte das classes.

  ## 2. Sinais por SKU (abc_curve_sku_snapshots.signal_codes)

  A recomendação PRINCIPAL continua uma por SKU, em abc_curve_recommendations, com o CHECK de
  códigos da 078 intacto. Os sinais são fatos secundários calculados no momento da publicação
  e gravados junto do snapshot — array simples em vez de tabela nova, porque são um atributo do
  snapshot, não uma entidade. Sem CHECK no conteúdo do array: o vocabulário de sinais pode
  crescer, e um CHECK aqui invalidaria retroativamente snapshots antigos.

  ## 3. Referência da Curva ABC do Tiny (abc_curve_sku_snapshots.tiny_*)

  O arquivo opcional do Tiny era apenas anexado. Os campos abaixo guardam o que o arquivo dizia
  sobre cada SKU que EXISTE nesta análise, casado por SKU exato. Ficam no snapshot porque são
  atributo daquele SKU naquela análise. Nullable: SKU sem correspondência no arquivo do Tiny
  permanece nulo — nunca é preenchido com zero.

  tiny_classification fica sem CHECK de propósito: arquivos de origens diferentes usam letras
  ou rótulos diferentes, e recusar a linha na gravação perderia a referência que o usuário
  anexou. A normalização/validação acontece na leitura, no código.

  As contagens do lado do Tiny (linhas no arquivo, correspondentes, sem correspondência)
  continuam em abc_curve_import_batches — row_count / imported_count / warning_count já
  existem para isso, então nenhuma coluna nova é necessária.

  ## 4. Segurança

  Nenhuma policy nova: as colunas herdam o RLS das tabelas da 078, que já isolam por
  company_id::text = get_my_company_id().
*/

ALTER TABLE abc_curve_analyses
  ADD COLUMN IF NOT EXISTS low_coverage_days     numeric NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS healthy_coverage_days numeric NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS excess_coverage_days  numeric NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS low_margin_pct        numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS strong_margin_pct     numeric NOT NULL DEFAULT 40;

ALTER TABLE abc_curve_sku_snapshots
  ADD COLUMN IF NOT EXISTS signal_codes        text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tiny_quantity       numeric,
  ADD COLUMN IF NOT EXISTS tiny_value          numeric,
  ADD COLUMN IF NOT EXISTS tiny_individual_pct numeric,
  ADD COLUMN IF NOT EXISTS tiny_cumulative_pct numeric,
  ADD COLUMN IF NOT EXISTS tiny_classification text;
