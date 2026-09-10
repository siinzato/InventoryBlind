/*
# I.B Academy — catálogo de e-books externos (31 títulos)

Segue o mesmo padrão de seed das migrations 026 e 097: as linhas da Biblioteca
são catálogo global e entram por migration, com ON CONFLICT (title) DO NOTHING.
Nenhuma linha existente é alterada, movida ou removida.

## Procedência dos metadados
Todos os campos abaixo foram extraídos dos PRÓPRIOS arquivos PDF entregues
(contagem real de páginas, título/autor embutidos no PDF e a folha de rosto),
cruzados com a lista de curadoria enviada pelo usuário. Nada foi inferido:

- `page_count`  → número real de páginas do arquivo hospedado.
- `authors`     → autoria impressa na obra (array, porque várias têm mais de um).
- `publisher`   → instituição/editora responsável, quando a obra a declara.
- `language`    → 'Português' em todos: verificado no texto (inclui as edições
                  em português de Portugal e a tradução PT do manual da USAID).
- `level`       → SOMENTE quando a própria obra se declara básica/intermediária/
                  avançada no título. Onde não há essa declaração, fica NULL em
                  vez de receber um nível arbitrário.
- `published_year` → somente quando a obra imprime o ano de publicação.
- `source_url`  → somente para os títulos que constam da lista de curadoria com
                  link de origem. Os demais ficam NULL — o botão "Fonte original"
                  simplesmente não aparece, em vez de apontar para um lugar
                  adivinhado.
- `license_name`/`license_url`/`rights_note` → NULL em todos. Nenhuma destas
                  obras declara licença; "material gratuito" não é licença.
- `themes`/`cover_url`/`description` → só preenchidos quando o próprio documento
                  fornece (subtítulo). Sem capa: o card já tem fallback.

`content_origin = 'external'` em todos — obras de terceiros, apenas
disponibilizadas com créditos pela curadoria do I.B Academy.

## Como os arquivos são servidos
Do mesmo jeito que o e-book já existente (migration 097): o PDF fica em
`public/library/ebooks/<área>/` e a linha aponta para ele em `external_url`.
`storage_path` fica NULL — o bucket academy-library (migration 105) continua
disponível para quando/se a hospedagem mudar, e o código já dá prioridade ao
Storage automaticamente quando `storage_path` for preenchido.

## Dependência
Requer a migration 105, que adicionou as colunas de catálogo/autoria/licença
usadas abaixo.
*/

INSERT INTO library_resources (
  title, description, category, external_url, is_placeholder, order_index,
  publisher, page_count, format, cover_url, themes, subject,
  authors, source_url, storage_path, language, subcategory, level,
  published_year, content_origin
) VALUES

-- ── Logística ───────────────────────────────────────────────────────────────
('Introdução à Logística', 'Curso técnico em logística — módulo introdutório.', 'ebook', '/library/ebooks/logistica/introducao-a-logistica-luiz-henrique.pdf', false, 10,
 NULL, 284, 'PDF', NULL, NULL, 'Logística',
 ARRAY['Luiz Henrique'], 'https://infolivros.org/livros-pdf-gratis/negocios/logistica/',
 NULL, 'Português', 'Fundamentos', NULL, NULL, 'external'),

('Fundamentos da Logística', NULL, 'ebook', '/library/ebooks/logistica/fundamentos-da-logistica-glavio-leal-paura.pdf', false, 11,
 NULL, 112, 'PDF', NULL, NULL, 'Logística',
 ARRAY['Glávio Leal Paura'], 'https://infolivros.org/livros-pdf-gratis/negocios/logistica/',
 NULL, 'Português', 'Fundamentos', NULL, NULL, 'external'),

('Logística — apostila compilada', NULL, 'ebook', '/library/ebooks/logistica/logistica-eduardo-a-meireles.pdf', false, 12,
 NULL, 196, 'PDF', NULL, NULL, 'Logística',
 ARRAY['Eduardo A. Meireles'], 'https://infolivros.org/livros-pdf-gratis/negocios/logistica/',
 NULL, 'Português', 'Fundamentos', NULL, NULL, 'external'),

('Gestão Logística e Tendências da Logística 4.0', NULL, 'ebook', '/library/ebooks/logistica/gestao-logistica-e-tendencias-da-logistica-4-0.pdf', false, 13,
 NULL, 121, 'PDF', NULL, NULL, 'Logística',
 ARRAY['Djalma Alves Cabral Filho'], 'https://infolivros.org/livros-pdf-gratis/negocios/logistica/',
 NULL, 'Português', 'Logística 4.0', NULL, NULL, 'external'),

('Logística e Cadeia de Suprimentos', NULL, 'ebook', '/library/ebooks/logistica/logistica-e-cadeia-de-suprimentos-allan-augusto-platt.pdf', false, 14,
 'Universidade Federal de Santa Catarina', 116, 'PDF', NULL, NULL, 'Logística',
 ARRAY['Allan Augusto Platt'], 'https://infolivros.org/livros-pdf-gratis/negocios/logistica/',
 NULL, 'Português', 'Supply Chain', NULL, 2015, 'external'),

('Gestão da Cadeia de Suprimentos', NULL, 'ebook', '/library/ebooks/logistica/gestao-da-cadeia-de-suprimentos-altair-dos-santos-ferreira-filho.pdf', false, 15,
 NULL, 122, 'PDF', NULL, NULL, 'Logística',
 ARRAY['Altair dos Santos Ferreira Filho'], NULL,
 NULL, 'Português', 'Supply Chain', NULL, NULL, 'external'),

('Logística Empresarial', NULL, 'ebook', '/library/ebooks/logistica/logistica-empresarial-luz-selene-buller.pdf', false, 16,
 'IESDE Brasil S.A.', 130, 'PDF', NULL, NULL, 'Logística',
 ARRAY['Luz Selene Buller'], NULL,
 NULL, 'Português', 'Gestão logística', NULL, NULL, 'external'),

('Logística: contribuições para melhorias na produção e nos resultados', NULL, 'ebook', '/library/ebooks/logistica/logistica-contribuicoes-mauro-luiz-costa-campello.pdf', false, 17,
 'Editora Científica Digital', 164, 'PDF', NULL, NULL, 'Logística',
 ARRAY['Mauro Luiz Costa Campello'], NULL,
 NULL, 'Português', 'Gestão logística', NULL, NULL, 'external'),

('Logística 2', NULL, 'ebook', '/library/ebooks/logistica/logistica-2-editora-poisson.pdf', false, 18,
 'Editora Poisson', 161, 'PDF', NULL, NULL, 'Logística',
 NULL, NULL,
 NULL, 'Português', 'Gestão logística', NULL, NULL, 'external'),

('Logística de Produção e Serviços', NULL, 'ebook', '/library/ebooks/logistica/logistica-de-producao-e-servicos-nair-schlindwein.pdf', false, 19,
 NULL, 268, 'PDF', NULL, NULL, 'Logística',
 ARRAY['Nair Fernandes da Costa Schlindwein'], NULL,
 NULL, 'Português', 'Produção e serviços', NULL, 2012, 'external'),

('Logística e Negócio Electrónico', NULL, 'ebook', '/library/ebooks/logistica/logistica-e-negocio-electronico-crespo-de-carvalho-encantado.pdf', false, 20,
 'Principia', 160, 'PDF', NULL, NULL, 'Logística',
 ARRAY['José Crespo de Carvalho', 'Laura Encantado'], NULL,
 NULL, 'Português', 'Logística e e-commerce', NULL, NULL, 'external'),

('Sistemas Avançados de Cooperação Logística', NULL, 'ebook', '/library/ebooks/logistica/sistemas-avancados-de-cooperacao-logistica-aep.pdf', false, 21,
 'AEP — Associação Empresarial de Portugal', 132, 'PDF', NULL, NULL, 'Logística',
 NULL, NULL,
 NULL, 'Português', 'Cooperação logística', 'Avançado', NULL, 'external'),

('Manual de logística: Um Guião Prático para a Gestão da Cadeia de Abastecimento de Produtos Farmacêuticos',
 'Guia prático de gestão da cadeia de abastecimento de produtos farmacêuticos.', 'ebook', '/library/ebooks/logistica/manual-de-logistica-usaid-deliver-project.pdf', false, 22,
 'USAID | DELIVER PROJECT', 198, 'PDF', NULL, NULL, 'Logística',
 NULL, NULL,
 NULL, 'Português', 'Supply Chain', NULL, 2012, 'external'),

-- ── E-commerce ──────────────────────────────────────────────────────────────
('Gerente de Ecommerce', NULL, 'ebook', '/library/ebooks/ecommerce/gerente-de-ecommerce-mauricio-salvador.pdf', false, 30,
 NULL, 376, 'PDF', NULL, NULL, 'E-commerce',
 ARRAY['Mauricio Salvador'], 'https://infolivros.org/livros-pdf-gratis/informatica/comercio-eletronico/',
 NULL, 'Português', 'Gestão de e-commerce', NULL, NULL, 'external'),

('Guia de E-commerce', NULL, 'ebook', '/library/ebooks/ecommerce/guia-de-e-commerce-apadi.pdf', false, 31,
 'APADI', 100, 'PDF', NULL, NULL, 'E-commerce',
 NULL, 'https://infolivros.org/livros-pdf-gratis/informatica/comercio-eletronico/',
 NULL, 'Português', 'Gestão de e-commerce', NULL, NULL, 'external'),

('Comércio Eletrônico e Marketing', NULL, 'ebook', '/library/ebooks/ecommerce/comercio-eletronico-e-marketing-e-tec-brasil.pdf', false, 32,
 'e-Tec Brasil', 52, 'PDF', NULL, NULL, 'E-commerce',
 ARRAY['Maria Ivanilse Calderon Ribeiro', 'Juliana Braz da Costa', 'Valdeson Lima'],
 'https://infolivros.org/livros-pdf-gratis/informatica/comercio-eletronico/',
 NULL, 'Português', 'Marketing digital', NULL, 2015, 'external'),

('Comércio Eletrônico', NULL, 'ebook', '/library/ebooks/ecommerce/comercio-eletronico-vissotto-boniati.pdf', false, 33,
 NULL, 54, 'PDF', NULL, NULL, 'E-commerce',
 ARRAY['Elisa Maria Vissotto', 'Bruno Batista Boniati'],
 'https://infolivros.org/livros-pdf-gratis/informatica/comercio-eletronico/',
 NULL, 'Português', 'Fundamentos', NULL, 2013, 'external'),

('Comércio eletrônico — e-book', NULL, 'ebook', '/library/ebooks/ecommerce/comercio-eletronico-brasil-mais.pdf', false, 34,
 NULL, 58, 'PDF', NULL, NULL, 'E-commerce',
 NULL, NULL,
 NULL, 'Português', 'Fundamentos', NULL, NULL, 'external'),

-- ── Operações ───────────────────────────────────────────────────────────────
('Gestão de Processos', 'Módulo 3 do Programa de Desenvolvimento de Gerentes Operacionais.', 'ebook', '/library/ebooks/operacoes/gestao-de-processos-andre-ribeiro-ferreira.pdf', false, 40,
 'Escola Nacional de Administração Pública (ENAP)', 48, 'PDF', NULL, NULL, 'Operações',
 ARRAY['André Ribeiro Ferreira'], 'https://infolivros.org/livros-pdf-gratis/negocios/processos-produtivos/',
 NULL, 'Português', 'Gestão de processos', NULL, NULL, 'external'),

('Gestão da Produção Industrial: sistematização da produção industrial', NULL, 'ebook', '/library/ebooks/operacoes/gestao-da-producao-industrial-charles-natan-johansson.pdf', false, 41,
 'UNIJUÍ — Universidade Regional do Noroeste do Estado do Rio Grande do Sul', 62, 'PDF', NULL, NULL, 'Operações',
 ARRAY['Charles Natan Dinarel Johansson'], NULL,
 NULL, 'Português', 'Produção industrial', NULL, NULL, 'external'),

-- ── Excel ───────────────────────────────────────────────────────────────────
('Excel 2019 — do zero ao avançado', NULL, 'ebook', '/library/ebooks/excel/excel-2019-do-zero-ao-avancado-evolui.pdf', false, 50,
 'Evolui', 224, 'PDF', NULL, NULL, 'Excel',
 NULL, 'https://infolivros.org/livros-pdf-gratis/informatica/excel/',
 NULL, 'Português', 'Curso completo', NULL, NULL, 'external'),

('Excel Básico', NULL, 'ebook', '/library/ebooks/excel/excel-basico-escolagov.pdf', false, 51,
 'EscolaGov', 47, 'PDF', NULL, NULL, 'Excel',
 NULL, 'https://infolivros.org/livros-pdf-gratis/informatica/excel/',
 NULL, 'Português', 'Planilhas', 'Básico', NULL, 'external'),

('Apostila de Excel Básico', NULL, 'ebook', '/library/ebooks/excel/apostila-de-excel-basico-fabio-lippi-silva.pdf', false, 52,
 NULL, 31, 'PDF', NULL, NULL, 'Excel',
 ARRAY['Fábio Lippi Silva'], 'https://infolivros.org/livros-pdf-gratis/informatica/excel/',
 NULL, 'Português', 'Planilhas', 'Básico', NULL, 'external'),

('Apostila de Excel — Curso Intermediário', NULL, 'ebook', '/library/ebooks/excel/apostila-de-excel-curso-intermediario-fabio-lippi-silva.pdf', false, 53,
 NULL, 48, 'PDF', NULL, NULL, 'Excel',
 ARRAY['Fábio Lippi Silva'], NULL,
 NULL, 'Português', 'Planilhas', 'Intermediário', NULL, 'external'),

('Excel Avançado', NULL, 'ebook', '/library/ebooks/excel/excel-avancado-melissa-lima-da-fonseca.pdf', false, 54,
 NULL, 82, 'PDF', NULL, NULL, 'Excel',
 ARRAY['Melissa Lima da Fonseca'], NULL,
 NULL, 'Português', 'Planilhas', 'Avançado', NULL, 'external'),

('Excel Avançado — apostila ESESP', NULL, 'ebook', '/library/ebooks/excel/excel-avancado-esesp.pdf', false, 55,
 'Escola de Serviço Público do Espírito Santo (ESESP)', 104, 'PDF', NULL, NULL, 'Excel',
 NULL, NULL,
 NULL, 'Português', 'Planilhas', 'Avançado', 2018, 'external'),

('Apostila de Curso de Excel', NULL, 'ebook', '/library/ebooks/excel/apostila-de-curso-de-excel-pet-civil-ufrgs.pdf', false, 56,
 'PET Civil UFRGS', 40, 'PDF', NULL, NULL, 'Excel',
 NULL, NULL,
 NULL, 'Português', 'Planilhas', NULL, NULL, 'external'),

('Microsoft Excel: apostila de fórmulas e funções', NULL, 'ebook', '/library/ebooks/excel/microsoft-excel-apostila-de-formulas-e-funcoes.pdf', false, 57,
 NULL, 28, 'PDF', NULL, NULL, 'Excel',
 ARRAY['Edson Roberto Rezende', 'Jorge Alberto Françóia'], NULL,
 NULL, 'Português', 'Fórmulas e funções', NULL, NULL, 'external'),

('Funções de Busca no Excel: PROCV, ÍNDICE e CORRESP', NULL, 'ebook', '/library/ebooks/excel/funcoes-de-busca-no-excel-procv-indice-corresp.pdf', false, 58,
 NULL, 14, 'PDF', NULL, NULL, 'Excel',
 ARRAY['Marcelo Cunha'], NULL,
 NULL, 'Português', 'Fórmulas e funções', NULL, NULL, 'external'),

('Uso do Programa Excel', NULL, 'ebook', '/library/ebooks/excel/uso-do-programa-excel-vanessa-monteiro-cesnik.pdf', false, 59,
 NULL, 29, 'PDF', NULL, NULL, 'Excel',
 ARRAY['Vanessa Monteiro Cesnik'], 'https://infolivros.org/livros-pdf-gratis/informatica/excel/',
 NULL, 'Português', 'Planilhas', NULL, NULL, 'external'),

('Aprendendo a editar folha de cálculo no Excel estudando agricultura',
 'Material didático do Projeto Oficinas 2019.', 'ebook', '/library/ebooks/excel/aprendendo-a-editar-folha-de-calculo-no-excel.pdf', false, 60,
 NULL, 45, 'PDF', NULL, NULL, 'Excel',
 ARRAY['Samanta Quevedo da Silva', 'Letícia Pegoraro Garcez'], NULL,
 NULL, 'Português', 'Planilhas', 'Básico', 2019, 'external')

ON CONFLICT (title) DO NOTHING;
