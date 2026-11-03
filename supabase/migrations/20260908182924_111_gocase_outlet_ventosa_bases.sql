/*
  # 111 — GoCase: OUTLET com prioridade absoluta, Ventosa e Bases de garrafa

  Continuação de 110. Estritamente DADO: nenhuma coluna, tabela, policy, função ou linha
  nova é criada. As três linhas envolvidas (Outlet, Ventosa, Bases) JÁ existem em
  product_lines e são usadas pelos ids atuais.

  ## O que estava errado (verificado no dado, não presumido)

  1. Outlet: keywords = {OUTLET} mas match_priority = 100 (default). Como a precedência é
     por match_priority crescente, Outlet perdia de TODAS as linhas de categoria e de
     modelo. Resultado real: 346 produtos GoCase com OUTLET no título distribuídos em
     Térmicos (188), Lancheiras (58), Mochilas (30), Joy (15), Puffer (13), Capas (8) e 74
     sem linha. Correção: match_priority = 1, menor que qualquer outra linha da marca.

  2. Ventosa: keywords = {"Ventosas GoCase"} — expressão que não existe em título real
     ("Ventosa de Silicone Gocase Para Capinha - Azul"). Mesmo tipo de erro que a 110
     corrigiu nas outras linhas: rótulo de gestão no lugar de termo de título.

  3. Bases: as bases de garrafa GoCase não têm o token da marca no título
     ("Base de Silicone Garrafa Fresh 650ml - Rosa"), e `products` não tem coluna de marca
     nem de categoria — o título é o único sinal. Por isso os 69 produtos dessas 6 famílias
     estavam unmatched (sem marca), não "sem linha": nunca chegavam à etapa de linha.
     "Base de Silicone" é alias de MARCA da GoCase (conferido: os 69 são os únicos produtos
     do catálogo que contêm "base"), então entra em product_brands.keywords — o mecanismo de
     alias que já existe — e não em regra nova.
     Bases também sobe de 30 para 15, acima de Térmicos (20), senão "garrafa" venceria
     "base" em "Base de Silicone Garrafa Fresh". Nenhuma classificação atual muda com isso:
     não existe produto com "base" e "garrafa" fora dessas famílias, nem com "suporte" e
     "garrafa" juntos.

  ## Precedência resultante dentro da GoCase (menor avalia primeiro)

      1  Outlet                    <- absoluta, encerra a classificação
      10 Lancheiras e Necessários
      12 Ventosa
      15 Bases
      20 Térmicos
      40 Mochilas e Tote Daily
      60 Joy
      70 Puffer
      80 Capas

  ## Reclassificação dirigida

  Só os produtos atingidos pelas três regras novas. Nenhum outro produto é regravado.
  `match_status = 'manual'` nunca é sobrescrito, `line_id` só é gravado quando muda
  (idempotente) e nada é escrito em products, inventory_* ou physical_count_*.
*/

-- 1. OUTLET: prioridade absoluta.
UPDATE product_lines l
   SET keywords = ARRAY['outlet'],
       match_priority = 1,
       updated_at = now()
 WHERE l.name = 'Outlet'
   AND l.brand_id IN (SELECT id FROM product_brands WHERE lower(name) = 'gocase');

-- 2. VENTOSA: termo de título no lugar do rótulo de gestão.
UPDATE product_lines l
   SET keywords = ARRAY['ventosa','ventosas'],
       match_priority = 12,
       updated_at = now()
 WHERE l.name = 'Ventosa'
   AND l.brand_id IN (SELECT id FROM product_brands WHERE lower(name) = 'gocase');

-- 3. BASES: variações reais do catálogo + prioridade acima de Térmicos.
UPDATE product_lines l
   SET keywords = ARRAY['base de silicone','base de garrafa','base para garrafa','base garrafa','base','bases','suporte','stand','dock'],
       match_priority = 15,
       updated_at = now()
 WHERE l.name = 'Bases'
   AND l.brand_id IN (SELECT id FROM product_brands WHERE lower(name) = 'gocase');

-- 4. Alias de marca para as bases de garrafa, que não trazem o token GoCase no título.
UPDATE product_brands
   SET keywords = keywords || ARRAY['base de silicone'],
       updated_at = now()
 WHERE lower(name) = 'gocase'
   AND NOT ('base de silicone' = ANY (keywords));

-- 5a. Produtos GoCase com OUTLET no título vão para Outlet, saindo da linha antiga.
UPDATE product_brand_associations a
   SET line_id = (SELECT l.id FROM product_lines l
                   WHERE l.name = 'Outlet'
                     AND l.brand_id = a.brand_id),
       matched_keyword = 'outlet',
       match_status = 'auto',
       candidate_matches = '[]'::jsonb,
       updated_at = now()
 WHERE a.brand_id IN (SELECT id FROM product_brands WHERE lower(name) = 'gocase')
   AND a.match_status <> 'manual'
   AND EXISTS (
     SELECT 1 FROM products p
      WHERE p.id = a.product_id
        AND p.name ~* '(^|[^[:alnum:]])outlet([^[:alnum:]]|$)'
   )
   AND a.line_id IS DISTINCT FROM (SELECT l.id FROM product_lines l
                                    WHERE l.name = 'Outlet' AND l.brand_id = a.brand_id);

-- 5b. Ventosas (sem OUTLET, que tem precedência) vão para Ventosa.
UPDATE product_brand_associations a
   SET line_id = (SELECT l.id FROM product_lines l
                   WHERE l.name = 'Ventosa'
                     AND l.brand_id = a.brand_id),
       matched_keyword = 'ventosa',
       match_status = 'auto',
       candidate_matches = '[]'::jsonb,
       updated_at = now()
 WHERE a.brand_id IN (SELECT id FROM product_brands WHERE lower(name) = 'gocase')
   AND a.match_status <> 'manual'
   AND EXISTS (
     SELECT 1 FROM products p
      WHERE p.id = a.product_id
        AND p.name ~* '(^|[^[:alnum:]])ventosas?([^[:alnum:]]|$)'
        AND p.name !~* '(^|[^[:alnum:]])outlet([^[:alnum:]]|$)'
   )
   AND a.line_id IS DISTINCT FROM (SELECT l.id FROM product_lines l
                                    WHERE l.name = 'Ventosa' AND l.brand_id = a.brand_id);

-- 5c. Bases de garrafa: não tinham associação nenhuma (marca não resolvia). Insere a
--     associação que o classificador corrigido passa a produzir; se já houver linha para o
--     produto, só atualiza quando não é classificação manual.
INSERT INTO product_brand_associations
  (company_id, product_id, brand_id, line_id, match_status, matched_keyword, candidate_matches)
SELECT b.company_id,
       p.id,
       b.id,
       l.id,
       'auto',
       'base de silicone',
       '[]'::jsonb
  FROM products p
  JOIN product_brands b ON lower(b.name) = 'gocase'
  JOIN product_lines  l ON l.brand_id = b.id AND l.name = 'Bases'
 WHERE p.company_id = b.company_id::text
   AND p.name ~* '(^|[^[:alnum:]])base de silicone([^[:alnum:]]|$)'
   AND p.name !~* '(^|[^[:alnum:]])outlet([^[:alnum:]]|$)'
ON CONFLICT (product_id) DO UPDATE
   SET brand_id = EXCLUDED.brand_id,
       line_id = EXCLUDED.line_id,
       match_status = 'auto',
       matched_keyword = EXCLUDED.matched_keyword,
       updated_at = now()
 WHERE product_brand_associations.match_status <> 'manual';
