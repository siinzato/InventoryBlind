/*
  # 110 — Regras de classificação por linha de produto (Marca > Linha)

  ## Diagnóstico que motivou esta migration

  A estrutura Marca > Linha já existe e está correta: `product_brands` → `product_lines`
  (brand_id NOT NULL) → `product_brand_associations` (product_id UNIQUE, brand_id, line_id).
  Nada disso é recriado aqui.

  O problema é de DADO, não de estrutura: `product_lines.keywords` — cujo único consumidor é o
  classificador de TÍTULO de produto (brandClassifier.ts) — estava preenchido com os nomes das
  linhas de CONTAGEM do inventário:

      Puffer                    → {"Linha Puffer GC"}
      Capas                     → {"GoCase Capas"}
      Térmicos                  → {"Térmicos GC"}
      Lancheiras e Necessários  → {"Lancheiras e Necessários GC"}
      Mochilas e Tote Daily     → {"Linha de Mochilas GC","Linha Tote Daily GC"}

  Nenhuma dessas expressões aparece em título de produto real ("Bolsa Puffer Gocase Para
  Garrafas - Marrom", "Garrafa Térmica Fresh Gocase 650ml"), então o casamento por palavra
  inteira nunca encontrava linha: as 3.929 associações têm brand_id e ZERO têm line_id.

  ## O que esta migration adiciona (estritamente aditiva)

  1. `match_priority` — ordem de avaliação das regras dentro da marca. Menor avalia primeiro.
     Necessário porque a prioridade exigida não é derivável do texto: "Lancheira Puffer" tem
     de cair em Lancheiras e Necessários, e "Base Puffer" em Bases — comprimento de termo ou
     ordem alfabética dariam Puffer nos dois casos.

  2. `exclude_keywords` — termos que ELIMINAM a linha mesmo com termo positivo presente.
     Segunda trava do mesmo problema, agora explícita e por linha.

  3. `inventory_brand_names` — a ponte para `inventory_brands.brand` (linha de contagem).
     Não existe FK entre os dois módulos (`inventory_brands.company_id` é text,
     `product_lines.company_id` é uuid), e o vínculo sempre foi por nome. O conteúdo atual de
     `keywords` É exatamente essa lista, então ele é MOVIDO para cá em vez de descartado.

  `keywords` continua existindo e passa a ter só a função que seu consumidor sempre esperou:
  termos de título. Nenhuma coluna é removida ou renomeada.

  ## Seed de dados

  O UPDATE dos termos da GoCase é guardado por `keywords <@` a lista de rótulos de contagem:
  só toca em linha cujas keywords ainda são os rótulos de inventário originais. Linha em que o
  usuário já tenha digitado termo próprio não é alterada. Nenhuma linha nova é criada — só as
  7 que já existem recebem regra. As demais marcas (Ringke, Nillkin, ESR, DUX, X-Level,
  Dexnor, AZ, Suritch) continuam sem linha, o que é válido: line_id NULL.

  ## Segurança

  Nenhuma policy nova: as colunas herdam o RLS de `product_lines` (migration 075). Nada é
  escrito em products, inventory_* ou physical_count_*.
*/

ALTER TABLE product_lines
  ADD COLUMN IF NOT EXISTS match_priority        integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS exclude_keywords      text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS inventory_brand_names text[]  NOT NULL DEFAULT '{}';

COMMENT ON COLUMN product_lines.match_priority IS
  'Ordem de avaliação da regra dentro da marca; menor avalia primeiro. Categorias universais (lancheira, mochila, base, térmico) usam valores baixos para vencer linhas de modelo (puffer, joy, tote).';
COMMENT ON COLUMN product_lines.exclude_keywords IS
  'Termos que eliminam esta linha mesmo com keyword positiva presente.';
COMMENT ON COLUMN product_lines.inventory_brand_names IS
  'Nomes em inventory_brands.brand alimentados por esta linha. Ponte por nome: não há FK entre os módulos.';

-- Move o conteúdo atual de keywords (rótulos de linha de contagem) para a coluna que
-- realmente significa isso, sem perder informação.
UPDATE product_lines
   SET inventory_brand_names = keywords
 WHERE cardinality(inventory_brand_names) = 0
   AND cardinality(keywords) > 0
   AND EXISTS (
     SELECT 1 FROM inventory_brands ib
      WHERE ib.brand = ANY (product_lines.keywords)
   );

-- Regras de título das linhas da GoCase. Prioridade 10..40 = categoria de produto (o que a
-- coisa É). Prioridade 60..80 = linha/modelo (o nome que a coisa TEM). Por isso "Lancheira
-- Puffer" resolve em Lancheiras e não em Puffer.
UPDATE product_lines l
   SET keywords = v.keywords,
       exclude_keywords = v.exclude_keywords,
       match_priority = v.match_priority,
       updated_at = now()
  FROM (VALUES
    ('Lancheiras e Necessários',
     ARRAY['lancheira','lancheiras','necessaire','necessaires','necessario','necessarios','marmiteira','marmita','porta marmita'],
     ARRAY[]::text[], 10),
    ('Térmicos',
     ARRAY['termico','termica','termicos','termicas','garrafa termica','garrafa','copo termico','squeeze'],
     ARRAY[]::text[], 20),
    ('Bases',
     ARRAY['base','bases','suporte','stand','dock'],
     ARRAY[]::text[], 30),
    ('Mochilas e Tote Daily',
     ARRAY['mochila','mochilas','tote daily','bolsa tote daily'],
     ARRAY[]::text[], 40),
    ('Joy',
     ARRAY['joy'],
     ARRAY[]::text[], 60),
    ('Puffer',
     ARRAY['puffer'],
     ARRAY[]::text[], 70),
    ('Capas',
     ARRAY['capa','capas','case'],
     ARRAY[]::text[], 80)
  ) AS v(line_name, keywords, exclude_keywords, match_priority)
 WHERE l.name = v.line_name
   AND l.brand_id IN (SELECT id FROM product_brands WHERE lower(name) = 'gocase')
   -- Só onde as keywords ainda são os rótulos de contagem: preserva edição do usuário.
   AND EXISTS (SELECT 1 FROM inventory_brands ib WHERE ib.brand = ANY (l.keywords));

/*
  Divergência de grafia conhecida, corrigida explicitamente em vez de por semelhança:

    product_lines.keywords    = 'Lancheiras e Necessários GC'   (Necessários)
    inventory_brands.brand    = 'Lancheiras e Necessaries GC'   (Necessaries)

  Os dois UPDATEs acima casam por igualdade exata de nome, então essa linha ficou de fora e
  não recebeu nem a ponte nem as regras — justamente a regra de prioridade mais alta, a que
  impede "Lancheira Puffer" de cair em Puffer. O par é resolvido aqui pelo nome real que
  existe em inventory_brands, sem introduzir casamento aproximado em nenhum lugar do código.
*/
UPDATE product_lines l
   SET inventory_brand_names = ARRAY(
         SELECT ib.brand FROM inventory_brands ib
          WHERE ib.brand ILIKE 'Lancheiras e Necessar%GC'
          LIMIT 1
       ),
       keywords = ARRAY['lancheira','lancheiras','necessaire','necessaires','necessario','necessarios','marmiteira','marmita','porta marmita'],
       match_priority = 10,
       updated_at = now()
 WHERE l.name = 'Lancheiras e Necessários'
   AND l.brand_id IN (SELECT id FROM product_brands WHERE lower(name) = 'gocase')
   AND cardinality(l.inventory_brand_names) = 0
   AND EXISTS (SELECT 1 FROM inventory_brands ib WHERE ib.brand ILIKE 'Lancheiras e Necessar%GC');
