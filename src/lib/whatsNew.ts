// Conteúdo do painel "Novidades" — estrutura simples e centralizada: para publicar uma
// atualização nova, adicione uma entrada no TOPO de WHATS_NEW_ENTRIES (mais recente primeiro).
// Linguagem sempre orientada ao cliente — nada de nomes de tabela, função ou detalhe técnico interno.

export type WhatsNewCategory = 'novidade' | 'melhoria' | 'correcao';

export interface WhatsNewEntry {
  id: string;
  date: string; // YYYY-MM-DD
  category: WhatsNewCategory;
  title: string;
  description: string;
}

export const WHATS_NEW_CATEGORY_LABEL: Record<WhatsNewCategory, string> = {
  novidade: 'Novidade',
  melhoria: 'Melhoria',
  correcao: 'Correção e estabilidade',
};

export const WHATS_NEW_ENTRIES: WhatsNewEntry[] = [
  {
    id: '2026-09-14-pendentes-reais-na-contagem',
    date: '2026-09-14',
    category: 'correcao',
    title: 'Pendentes da contagem voltam a refletir os produtos reais',
    description: 'Algumas linhas e marcas apareciam como "Pendentes: 0" na Contagem Manual mesmo tendo produtos ainda não contados — acontecia quando os produtos tinham sido associados depois da última importação e o inventário em andamento ainda não havia sido conferido. Agora o inventário é conferido com a classificação atual dos produtos antes de a lista ser montada, então a quantidade pendente é sempre a real. Enquanto essa conferência acontece, a lista fica indisponível por alguns instantes em vez de mostrar números provisórios. Nenhuma contagem já registrada foi alterada.',
  },
  {
    id: '2026-09-14-marcas-linhas-na-nova-contagem',
    date: '2026-09-14',
    category: 'correcao',
    title: 'Marcas e linhas novas já aparecem para contar',
    description: 'A marca ou linha criada em Produtos → Linhas e Marcas agora aparece na hora na lista "Linha / Marca" de Nova Contagem → Contagem Manual e também na tabela de linhas do Dashboard, sem recarregar a página e sem precisar ter produtos ainda. Ela aparece com "Pendentes: 0" e não altera progresso, acuracidade, divergências nem o total de SKUs. Se ainda não houver produto associado, o sistema avisa e não deixa registrar contagem — nenhum número é inventado. Assim que produtos forem associados, os pendentes passam a refletir a quantidade real.',
  },
  {
    id: '2026-09-11-marcas-linhas-aparecem-em-todo-sistema',
    date: '2026-09-11',
    category: 'correcao',
    title: 'Marcas e linhas novas aparecem na hora no resto do sistema',
    description: 'Ao cadastrar uma marca ou uma linha em Produtos → Linhas e Marcas, ela agora passa a existir imediatamente no Ranking, mesmo antes de ter qualquer produto associado — aparece com estado vazio, sem inventar número. Ao associar produtos, renomear ou classificar o catálogo, o inventário em andamento é atualizado sozinho e o Dashboard e o Ranking se atualizam sem precisar recarregar a página. Antes era preciso dar F5, e uma linha recém-criada só aparecia depois de ganhar produtos. Nenhuma contagem já feita é perdida, e os indicadores não mudam por causa de uma marca ou linha ainda sem produtos.',
  },
  {
    id: '2026-09-11-nova-tipografia-inventoryblind',
    date: '2026-09-11',
    category: 'melhoria',
    title: 'Nova tipografia do InventoryBlind',
    description: 'O sistema e o site passaram a usar uma nova fonte, a Satoshi. O desenho das letras ficou mais limpo e mais próximo do que se vê em produtos da Apple, mantendo o ar profissional. Os números de indicadores continuam alinhados em coluna, e a fonte de largura fixa ficou reservada para o que realmente precisa dela: SKU, EAN, códigos e identificadores. Em Mac e iPhone o sistema continua usando a fonte nativa do aparelho. Nenhum tamanho, espaçamento ou tela foi alterado.',
  },
  {
    id: '2026-09-11-modulos-pagina-inicial-hierarquia',
    date: '2026-09-11',
    category: 'melhoria',
    title: 'Página inicial: a lista de módulos virou uma vitrine com hierarquia',
    description: 'A seção "Cada módulo, pensado para não deixar nada passar." deixou de ser uma parede de cards iguais. Agora seis módulos aparecem em destaque — BlindAI, HeatMap Inteligente, Confidence Score, Inventário por Risco, Root Cause Analysis e Warehouse Digital Twin — cada um com uma pequena amostra visual do que faz. Todos os demais módulos continuam na página, logo abaixo, em uma grade mais compacta e fácil de percorrer. Nenhum módulo foi retirado e nada mudou dentro do sistema.',
  },
  {
    id: '2026-09-11-jornada-operacional-pagina-inicial',
    date: '2026-09-11',
    category: 'melhoria',
    title: 'Página inicial: as etapas da operação agora aparecem como uma jornada única',
    description: 'A seção "A jornada de uma operação sem pontos cegos." mudou de formato. Antes as etapas passavam de lado, uma por vez, enquanto você rolava a página. Agora todas as seis etapas — Recebimento, Conferência, Contagem, Correções, BlindScore e Relatórios — ficam visíveis de cima para baixo, ligadas por uma linha do tempo que marca o início da operação e o resultado final. Cada etapa ganhou uma pequena ilustração do que acontece nela. A rolagem voltou a ser normal, sem prender a página na horizontal.',
  },
  {
    id: '2026-09-11-visao-operacional-pagina-inicial',
    date: '2026-09-11',
    category: 'melhoria',
    title: 'Página inicial: demonstração da operação mais clara e completa',
    description: 'A seção "Sua operação, sob controle total." da página inicial foi refeita. O painel de demonstração ficou maior e mais legível: os quatro indicadores agora mostram a variação em relação ao período anterior, o gráfico de divergências ganhou escala, meses e área sombreada, e o mapa de risco ficou maior, com legenda de baixo, médio e alto risco. O aviso da BlindAI deixou de ser uma faixa larga e passou a apontar diretamente para a posição de risco. Abaixo do painel, três frases resumem o que aquilo significa na prática. Os números continuam sendo apenas ilustrativos.',
  },
  {
    id: '2026-09-11-nova-abertura-pagina-inicial',
    date: '2026-09-11',
    category: 'melhoria',
    title: 'Página inicial com nova abertura, mais direta e com o produto em destaque',
    description: 'A primeira tela do site do InventoryBlind foi reorganizada: o título, o texto de apresentação, os botões e os indicadores agora ficam próximos uns dos outros, sem o espaço vazio que empurrava a imagem do sistema para o fim da tela. A tela do produto aparece logo abaixo, maior e já visível assim que a página abre. Os efeitos visuais de fundo foram reduzidos para deixar a leitura mais calma. Nada mudou no acesso, no login nem em qualquer funcionalidade de dentro do sistema.',
  },
  {
    id: '2026-09-10-emitir-relatorio-usa-fonte-de-saldo',
    date: '2026-09-10',
    category: 'melhoria',
    title: 'Emitir Relatório passou a usar o saldo da Fonte de Saldo, sem pedir a planilha de novo',
    description: 'Em Emitir Relatório, o passo "Fonte do saldo" agora oferece "Tiny — Estoque diário" no lugar de "Importar estoque do Tiny". A planilha é enviada uma única vez, em Produtos → Fonte de Saldo, e o relatório apenas usa o saldo que já está lá: não pede upload outra vez. Abaixo da opção você vê a data e a hora da última atualização da fonte e quantos produtos têm saldo, e ao montar a folha aparece quantos saldos foram encontrados e quantos não foram. Quando você importar um arquivo novo na Fonte de Saldo, o relatório passa a usar o saldo novo sozinho, sem precisar refazer nada. Produto com saldo zero na fonte imprime 0; produto que não existe na fonte sai com a célula em branco para contagem à mão, nunca como zero. O mesmo saldo aparece igual na pré-visualização, na impressão, no PDF e no Excel. Se a fonte ainda não tiver recebido nenhum arquivo, a tela avisa e indica onde importar, em vez de falhar. Seleção por local, por linha/marca, seleção manual, saldo em branco, saldo manual e o layout da folha A4 paisagem continuam exatamente como estavam.',
  },
  {
    id: '2026-09-10-fonte-de-saldo-tiny-estoque-diario',
    date: '2026-09-10',
    category: 'novidade',
    title: 'Fonte de Saldo: envie o estoque diário do Tiny por planilha',
    description: 'Produtos ganhou a seção Fonte de Saldo, com a fonte "Tiny — Estoque diário". Você ativa a fonte uma vez no seu workspace e, a partir daí, basta arrastar ou selecionar o arquivo de estoque exportado do Tiny (.xls ou .xlsx) todos os dias — sem precisar editar nada na planilha antes. O sistema confere o formato do arquivo antes de qualquer coisa: se faltar uma coluna, se alguma estiver renomeada, fora de ordem ou sobrando, o arquivo é recusado por inteiro e nenhum saldo é alterado. Passando a conferência, você vê quantas linhas o arquivo tem, quantas têm saldo para importar, quantas estão com o saldo em branco e quantas foram recusadas, além das primeiras linhas lidas, e só então confirma a importação. Cada envio é uma leitura nova do estoque atual: o saldo da fonte é substituído, nunca somado ao do dia anterior. Cada linha é associada a um produto por código exato — primeiro pelo identificador do Tiny já conhecido, depois pelo SKU e depois pelo EAN; nome de produto nunca associa, e quando há empate ou código repetido a linha fica marcada como ambígua em vez de receber o saldo de outro produto. SKU e código de barras são lidos como texto, então zeros à esquerda são preservados e nada vira notação científica. Saldo zero é lido como zero; célula em branco não é tratada como zero. No fim aparece o resumo com linhas processadas, produtos associados, não associados, ambíguos, ignoradas e recusadas, e o histórico guarda todos os envios anteriores da fonte. O saldo da fonte é referência de conferência: ele não altera o cadastro dos produtos, o estoque do InventoryBlind, as contagens e não cria movimentação.',
  },
  {
    id: '2026-09-10-emitir-relatorio-contagem',
    date: '2026-09-10',
    category: 'novidade',
    title: 'Emitir Relatório: folha de contagem pronta para levar ao estoque',
    description: 'Chegou a ferramenta Emitir Relatório, para gerar a folha que o time leva na prancheta durante o inventário físico. Você escolhe os produtos de três formas: por faixa de endereço (de P1-A002-A até P1-A002-P, por exemplo, com o primeiro e o último entrando no relatório), por uma ou várias linhas e marcas, ou marcando produto por produto depois de buscar por nome, SKU, EAN ou local. Antes de imprimir você vê exatamente as linhas que vão sair e pode remover uma delas da folha sem alterar o cadastro do produto. A coluna de saldo pode sair em branco para preencher à mão, pode ser digitada na tela ou pode vir da planilha de estoque geral exportada do Tiny — nesse caso o sistema associa cada linha pelo SKU e, quando o SKU não resolve, pelo EAN, sempre por código exato. Se um código estiver repetido na planilha, aquela linha é marcada como ambígua e sai em branco em vez de receber o número de outro produto, e o resumo mostra quantos saldos foram encontrados, quantos não foram e quantos ficaram ambíguos. O saldo importado é apenas referência impressa: ele não altera o estoque, o produto, a contagem nem cria movimentação. A folha sai em A4 preto e branco, com a coluna de produto mais larga, espaço de sobra para anotar a contagem à mão, cabeçalho repetido em cada página e a numeração de páginas no pé. Você pode imprimir direto ou gerar o PDF. A ferramenta está em dois lugares: no menu Ferramentas e também no topo da tela de Nova Contagem.',
  },
  {
    id: '2026-09-10-endereco-proprio-por-secao',
    date: '2026-09-10',
    category: 'novidade',
    title: 'Cada seção do sistema agora tem endereço próprio',
    description: 'Cada tela do InventoryBlind passou a ter um endereço na barra do navegador. Isso libera tudo o que se espera de um sistema na web: clicar com o botão direito em um item do menu e escolher abrir em nova guia, usar Ctrl+clique (ou Cmd+clique no Mac) e o clique com o botão do meio para abrir em outra guia, copiar o endereço de uma seção e mandar para um colega, e usar voltar e avançar do navegador para percorrer o que você abriu. Atualizar a página com F5 agora mantém você exatamente na mesma seção, em vez de voltar para o Dashboard. Abrir um endereço interno direto em uma guia nova também funciona: se você já estiver conectado, a seção pedida abre na hora; se não estiver, aparece a tela de entrada e, depois de entrar, o sistema leva você para a seção que você havia pedido. Quem não tem acesso a uma seção continua sem acesso, mesmo digitando o endereço. Nada mudou no visual, no menu ou na forma de usar as telas.',
  },
  {
    id: '2026-09-10-scroll-travado-apos-login',
    date: '2026-09-10',
    category: 'correcao',
    title: 'Corrigido o scroll travado ao entrar no sistema logo depois do login',
    description: 'Quem entrava pela página inicial, fazia login e caía direto no Dashboard não conseguia rolar a tela: a roda do mouse e o gesto de arrastar no celular não respondiam, e só recarregando a página (F5) o scroll voltava. Isso acontecia porque o controle de rolagem usado pelas animações da página inicial continuava ligado depois de você entrar no sistema, e ele bloqueava a rolagem da área do Dashboard. Agora esse controle é desligado no momento em que a página inicial sai da tela, então a rolagem funciona na hora, sem recarregar. Sair e entrar de novo quantas vezes quiser continua funcionando, e as animações da página inicial seguem exatamente como eram.',
  },
  {
    id: '2026-09-10-entrada-mais-rapida-logos',
    date: '2026-09-10',
    category: 'melhoria',
    title: 'Entrada no sistema mais rápida e logos de workspace aparecendo antes',
    description: 'A entrada no sistema ficou mais leve. Os dados do seu workspace e a lista dos workspaces em que você participa passaram a ser carregados ao mesmo tempo, em vez de um esperar o outro, então o Dashboard fica pronto para uso mais cedo. As fotos dos workspaces agora são preparadas todas de uma vez, e não uma por uma, e ficam reaproveitadas enquanto valem — o logo aparece no seletor, no menu de troca e no topo do menu lateral sem aquele atraso, e sem repetir o mesmo trabalho a cada atualização de sessão. Quem não tem foto cadastrada continua vendo a inicial do nome, como antes. Nada mudou no visual nem no jeito de usar.',
  },
  {
    id: '2026-09-09-cards-cantos-retos',
    date: '2026-09-09',
    category: 'melhoria',
    title: 'Cards e painéis com cantos mais retos em todo o sistema',
    description: 'Os cards e painéis do InventoryBlind ficaram com os cantos mais retos, no lugar do arredondado mais forte que usavam antes. É o mesmo acabamento em todas as seções — Dashboard, Analytics, Operações, Automações, Produtos, Ferramentas, I.B Academy, Administração, Integrações e Configurações —, além das janelas e painéis laterais que abrem sobre a tela, para um visual mais técnico e alinhado. Só o acabamento dos cantos mudou: posição, tamanho, espaçamento, cores, bordas, sombras, textos e ícones seguem exatamente como estavam, e nada mudou no funcionamento das telas. Botões, campos de busca, selos de situação, etiquetas, avatares e barras de progresso continuam com o arredondamento de antes, porque neles o formato faz parte da leitura do elemento.',
  },
  {
    id: '2026-09-09-familia-termica-garrafas-copos',
    date: '2026-09-09',
    category: 'correcao',
    title: 'GoCase: Garrafas Térmicas e Copos Térmicos ganham linha própria, e a família térmica volta para contagem',
    description: 'A linha Térmicos da GoCase juntava produtos muito diferentes, porque qualquer nome com "térmico" ou "térmica" caía nela: garrafa, copo, taça e lancheira ficavam todos no mesmo grupo de 335 produtos. Agora o tipo do produto é que define a linha, e "térmico" volta a ser só uma característica dele. Foram criadas duas linhas na GoCase: Garrafas Térmicas, com 273 produtos, e Copos Térmicos, com 53. Lancheira térmica continua em Lancheiras e Necessários, e Térmicos passa a ter apenas os 9 produtos que realmente não são garrafa nem copo — as taças térmicas e as bolsas térmicas. Produto de Outlet continua na frente de tudo: garrafa, copo ou lancheira com "Outlet" no nome permanece na linha Outlet. Base de silicone e tampa de garrafa também não são arrastadas para as linhas novas: continuam em Bases e em Tampa de Garrafa. A litragem, a cor ou o modelo não mudam mais a linha — uma garrafa de 650ml e uma de 1200ml ficam juntas em Garrafas Térmicas. Como a contagem dessa família havia sido feita com tudo no mesmo grupo, e o registro não diz quanto pertencia a garrafas e quanto a copos, esse progresso não é redistribuído: Garrafas Térmicas, Copos Térmicos e Térmicos começam com todos os seus SKUs pendentes, para uma recontagem confiável, e aparecem assim tanto no Dashboard quanto em Operações > Nova Contagem. A contagem anterior continua guardada no histórico e nos relatórios de fechamento; ela apenas deixa de contar como progresso do inventário atual. Nenhuma outra linha foi mexida: o que já estava contado em Nillkin, Joy, Puffer, Lancheiras e nas demais linhas segue exatamente como estava. As próximas importações já entram na linha certa: uma garrafa térmica nova vai para Garrafas Térmicas, um copo térmico novo para Copos Térmicos, e ambos entram como pendentes.',
  },
  {
    id: '2026-09-09-dashboard-universo-real',
    date: '2026-09-09',
    category: 'correcao',
    title: 'Dashboard: total de SKUs e linhas do seu catálogo atual, com o inventário em andamento preservado',
    description: 'O total de SKUs do Dashboard e a lista de linhas passam a vir do seu catálogo de produtos, com a classificação Marca > Linha que já está gravada em cada produto. Antes esses números eram os totais digitados na lista de contagem, que ficavam para trás a cada importação: o Dashboard mostrava 2.140 SKUs em 24 grupos antigos enquanto o catálogo já tinha 4.498 produtos. O trabalho já concluído no inventário em andamento continua valendo e aparece na linha atual daquele produto, com as mesmas divergências e a mesma acuracidade. O que muda é o total: uma linha que estava 100% concluída e depois ganhou produtos novos volta a aparecer em andamento, com os produtos novos como pendentes e o progresso recalculado — nenhuma contagem é refeita, e nenhum produto novo entra como se já tivesse sido contado. No Controle por linha você vê as suas linhas de verdade: Outlet e Linha PET aparecem separadas, no lugar do grupo único "Linha de Outlet e PET", e linhas como Ventosa, Bases, Malas, Mochilas, Tote e Tampa de Garrafa aparecem sozinhas. Como o grupo antigo somava Outlet e PET em um único número, não havia como dizer quanto pertencia a cada uma: as duas entram com todos os seus SKUs atuais pendentes, para serem contadas separadamente. Marca que ainda não tem linhas cadastradas é agrupada pela própria marca, e produto sem classificação aparece como "Sem classificação" em vez de ficar fora da conta. Qualquer linha nova que você criar aparece automaticamente assim que tiver produtos. Produto importado durante o inventário entra na hora como pendente na linha correta, sem duplicar SKU: o total sobe, as pendências sobem e o progresso é recalculado. As fórmulas de progresso, acuracidade, divergência, ritmo e situação são as mesmas de antes — o que mudou é que elas passam a trabalhar sobre o universo real de produtos, então os percentuais mudam de valor. As contagens que você já fez seguem guardadas como estão, também nas abas de contagem, no histórico e nos relatórios de fechamento. Em Operações > Nova Contagem, a Contagem Manual passa a escolher a linha nesse mesmo inventário: o seletor lista as suas linhas atuais, mostra quantos SKUs ainda faltam em cada uma e bate exatamente com o painel ao vivo ao lado e com o Dashboard. Linhas como Outlet, Linha PET, Ventosa, Malas e Tampa de Garrafa aparecem para contagem mesmo que nunca tenham estado na lista antiga, e os nomes antigos saem do seletor sem que nenhuma contagem registrada neles seja perdida.',
  },
  {
    id: '2026-09-08-linhas-gocase-outlet-ventosa-bases',
    date: '2026-09-08',
    category: 'correcao',
    title: 'Linhas da GoCase: Outlet passa na frente, Ventosa e Bases de garrafa aparecem',
    description: 'Em Produtos → Linhas e Marcas, três ajustes na classificação da GoCase. Primeiro: produto de Outlet agora pertence à linha Outlet, e só a ela. Antes, um item de outlet ia para a linha do produto original — uma lancheira puffer de outlet caía em Lancheiras, uma garrafa de outlet caía em Térmicos —, o que misturava mercadoria com leve defeito com a linha regular na hora de contar. Agora "Outlet" vem antes de qualquer outra regra: 346 produtos foram movidos para a linha Outlet e saíram das linhas antigas, então Térmicos, Lancheiras e Necessários, Mochilas e Tote Daily, Joy, Puffer e Capas passam a mostrar números menores e corretos. Segundo: a linha Ventosa deixou de ficar vazia e agora recebe as ventosas de silicone. Terceiro: as bases de garrafa não apareciam em nenhuma linha porque o nome delas não traz a marca no título ("Base de Silicone Garrafa Fresh 650ml"); agora são reconhecidas como GoCase e a linha Bases mostra 69 produtos, sem serem confundidas com Térmicos por causa da palavra "garrafa". Os contadores da tela continuam vindo direto das associações reais — nada é digitado à mão. Classificação que você confirmou manualmente não foi alterada, e as mesmas regras já valem para as próximas importações de planilha: um produto novo com "Outlet" no nome entra direto na linha Outlet.',
  },
  {
    id: '2026-09-08-linhas-de-produto-classificacao',
    date: '2026-09-08',
    category: 'correcao',
    title: 'Linhas e Marcas: as linhas deixam de aparecer com zero produtos',
    description: 'Em Produtos → Linhas e Marcas, as linhas da GoCase mostravam "0 produtos" mesmo com a marca tendo 1.608 produtos associados. O motivo era o preenchimento das palavras-chave de cada linha: elas continham os nomes das linhas de contagem do inventário, que não aparecem no título dos produtos, então nenhum produto casava com nenhuma linha. Agora cada linha tem suas próprias palavras de identificação e uma ordem de prioridade, e os produtos do catálogo já existentes foram classificados: Capas, Térmicos, Lancheiras e Necessários, Mochilas e Tote Daily, Joy e Puffer passaram a mostrar a contagem real, e "Ver produtos" abre exatamente os produtos daquela linha. A prioridade resolve os casos ambíguos pelo que o produto é, não pela palavra que aparece no nome: uma lancheira que tenha "Puffer" no título vai para Lancheiras e Necessários, e uma base com "Puffer" no nome vai para Bases. Produtos que não dão para classificar com segurança ficam em "Produtos sem linha", para revisão, em vez de entrarem numa linha errada. Marcas sem linhas cadastradas (Ringke, Nillkin, ESR, DUX, X-Level, Dexnor, AZ) continuam funcionando normalmente, só com a marca. Daqui para frente, toda importação de planilha já classifica marca e linha dos produtos novos automaticamente, sem precisar abrir a tela de gerenciamento — e uma classificação que você tenha confirmado à mão nunca é sobrescrita por uma importação.',
  },
  {
    id: '2026-09-08-curva-abc-comparacao-historica',
    date: '2026-09-08',
    category: 'novidade',
    title: 'Curva ABC: comparação com o período anterior, política registrada e conferência com o Tiny',
    description: 'A Visão geral da Curva ABC agora compara a análise selecionada com uma análise anterior do mesmo workspace — por padrão a imediatamente anterior, e você pode escolher outra. Aparecem as variações de faturamento, lucro observado, unidades, SKUs e classe A, sempre com indicador discreto ao lado do número. Quando os dois períodos têm durações diferentes, a leitura principal passa a ser por dia e o painel avisa, em vez de comparar totais que não são equivalentes; a cobertura de custo e de estoque é comparada em pontos percentuais, num bloco separado, porque é qualidade de cadastro e não crescimento. Há ainda o quadro de mudança na classificação e as movimentações: quantos SKUs subiram para A, saíram de A, entraram na análise ou não apareceram no período atual — cada grupo abre a lista com classe e valor de antes e de agora. Também novo: cada análise passa a registrar a política comercial que gerou suas recomendações (limites das classes, o que é baixa cobertura, cobertura saudável, excesso, margem baixa e margem forte). Você pode ajustá-la ao criar uma análise, na seção "Política comercial", e ela fica gravada no histórico — mudar o padrão daqui para frente não altera nenhuma análise já publicada. Cada produto agora mostra, além da recomendação principal, os sinais observados (sem custo, prejuízo, ruptura, baixa cobertura, estoque parado, excesso de cobertura, margem baixa ou forte, alto giro, faturamento ou lucro), com filtro por sinal na lista e contagem por sinal na Matriz de decisão. Por fim, se você anexar a Curva ABC do Tiny, ela deixa de ser só um arquivo guardado: aparece a aba "Comparativo Tiny", com quantos SKUs coincidem, quantos ficam em classe diferente e quantos não têm correspondência, além da tabela SKU a SKU. A diferença é tratada como comparação de referência, não como erro — período, base e critério podem ser diferentes.',
  },
  {
    id: '2026-09-08-curva-abc-visao-executiva',
    date: '2026-09-08',
    category: 'novidade',
    title: 'Curva ABC: visão executiva, gráfico de concentração e filtros nos produtos',
    description: 'A Visão geral da Curva ABC passou a responder o que importa de uma olhada: faturamento, lucro bruto observado (com a informação de sobre quantos SKUs a conta foi feita), unidades vendidas e SKUs analisados, mais um bloco separado com a qualidade dos dados daquela análise. Abaixo entrou o gráfico de concentração ABC, alternando entre Giro, Faturamento e Lucro, com o acumulado percentual e os limites das classes; ao lado dele, quantos SKUs estão em A, B e C e quanto cada classe representa de verdade. Há também a comparação das três curvas lado a lado e as prioridades da análise (prejuízo, sem custo, compra urgente e estoque parado), que levam direto para a lista já filtrada. Em Produtos, agora há busca por SKU ou produto e filtros por classe nas três curvas, status de custo, recomendação e estoque, com a paginação e o contador respeitando o que está filtrado. Na Matriz de decisão, cada grupo mostra a regra que o gerou e os valores observados dos SKUs daquele grupo. Em Fontes de dados ficou explícito quantas linhas cada arquivo trouxe e quantas foram realmente aproveitadas.',
  },
  {
    id: '2026-09-08-curva-abc-correcoes',
    date: '2026-09-08',
    category: 'correcao',
    title: 'Curva ABC: leitura de números, classificação e estoque sem venda',
    description: 'Corrigimos a leitura de valores nas planilhas: números escritos no padrão internacional (como 4002.80) eram interpretados errado e podiam inflar o faturamento de um produto. A classificação também ficou mais fiel à realidade — um produto que sozinho concentra a maior parte do resultado agora entra na classe A, como se espera, em vez de cair na B. Produtos que aparecem só na planilha de estoque, sem nenhuma venda no período, passaram a constar na análise para o diagnóstico de estoque parado funcionar, sem receber classificação ABC que não faz sentido para eles. Planilha de estoque com o mesmo código repetido agora avisa, em vez de sobrescrever em silêncio. E o assistente de importação passou a barrar limites de classe inconsistentes e campos obrigatórios sem coluna escolhida antes de gerar a prévia.',
  },
  {
    id: '2026-09-08-resultados-por-linha-historico',
    date: '2026-09-08',
    category: 'novidade',
    title: 'Resultados por Linha: histórico, exportação e feedback ao responsável',
    description: 'A tela deixou de mostrar só o ciclo em andamento. Agora há três conjuntos no topo — Ciclo atual, Concluídos e Arquivados — com filtros de período, inventário e linha/marca, além da busca. Abrir um fechamento é somente leitura: o resultado que você vê é o que foi gravado no dia, sem recalcular nada. No fechamento aberto você encontra os seis indicadores, as categorias com as observações reais, a exportação do relatório em PDF ou Word e a preparação de um feedback formal ao responsável pela linha — informe o nome, o cargo se quiser e uma observação, e o texto sai pronto para copiar, sempre com o mesmo formato e apenas com os números do fechamento.',
  },
  {
    id: '2026-09-08-logo-da-marca',
    date: '2026-09-08',
    category: 'novidade',
    title: 'Logo da marca no cadastro de Linhas e Marcas',
    description: 'Em Produtos → Linhas e Marcas, cada marca agora aceita um logo: edite a marca, escolha uma imagem PNG, JPEG ou WEBP de até 5 MB, e troque ou remova quando quiser. O logo aparece na lista de marcas, ao lado do nome em Resultados por Linha, no fechamento da linha e nas exportações em PDF e Word. Os logos pertencem só ao workspace onde foram cadastrados — outro workspace usa os dele, mesmo que tenha uma marca com o nome igual. Marca sem logo continua aparecendo normalmente, com as iniciais do nome.',
  },
  {
    id: '2026-09-04-auditorias-performance-reincidencia',
    date: '2026-09-04',
    category: 'melhoria',
    title: 'Auditorias: evolução das contagens e o que volta a divergir',
    description: 'As abas Performance e Reincidência agora respondem perguntas de verdade. Em Performance, um gráfico único mostra a evolução por sessão e alterna entre acurácia, cobertura e taxa de divergência — com o tamanho real da amostra sempre visível, para que uma contagem de 16 SKUs não pareça igual a uma de 195; clicar em um ponto abre a sessão. Abaixo, a distribuição das contagens por operador, sempre com a base (sessões e SKUs contados) ao lado de cada percentual — é evidência operacional, não avaliação de pessoas. Em Reincidência, aparecem os SKUs que divergiram em sessões diferentes dentro da janela configurada em Root Cause Analysis, com o histórico completo de cada um (sessão por sessão, saldo, diferença, localização e causa quando já classificada), as localizações que se repetem entre auditorias e as causas recorrentes vindas da classificação real do RCA. Duas divergências da mesma sessão não contam como repetição entre auditorias, e quando não há classificação no RCA a tela diz isso claramente, em vez de sugerir que a operação está saudável.',
  },
  {
    id: '2026-09-04-auditorias-historico',
    date: '2026-09-04',
    category: 'melhoria',
    title: 'Auditorias: resumo executivo, cobertura por sessão e detalhamento das divergências',
    description: 'O histórico de Auditorias deixou de ser só uma tabela. No topo, um resumo mostra quantas sessões foram feitas, quantos SKUs foram contados, a acurácia observada (com a base usada) e quantas sessões foram aprovadas. Cada sessão agora exibe a cobertura da contagem — quanto do universo previsto foi realmente contado — e a taxa de divergência ao lado da quantidade. Filtros de período, operador, tipo e aprovação, mais uma busca rápida, ajudam a chegar na sessão certa. Clicando em qualquer sessão, abre-se o detalhamento: resumo da sessão, a lista real dos itens divergentes com saldo do sistema, saldo contado, diferença e localização (com busca e exportação em CSV), a situação da reconferência e da aprovação, e o atalho para investigar as causas no Root Cause Analysis quando há divergências registradas. A aprovação continua significando a validação/encerramento da sessão, e não uma nota de acurácia.',
  },
  {
    id: '2026-09-03-inventory-health-movimento',
    date: '2026-09-03',
    category: 'novidade',
    title: 'Inventory Health: ruptura com demanda, estoque parado e concentração por marca',
    description: 'O Inventory Health passou a responder também sobre disponibilidade: o bloco "Movimento e disponibilidade" mostra quantos produtos estão em ruptura com demanda (sem saldo atual onde houve venda na janela já analisada) e quantos estão com estoque parado (saldo positivo sem venda no período), cada um com a lista de SKUs por trás do número. Quando há preço cadastrado, o estoque parado também aparece com um valor estimado, identificado como estimativa. O novo quadro "Concentração por marca e linha" mostra onde os problemas se acumulam — divergência, risco, ruptura e estoque parado por marca ou por linha, com o principal sinal de cada uma e a cobertura real das associações. Nada é assumido quando falta base: sem dados de venda o diagnóstico aparece como indisponível, e com base insuficiente aparece como não avaliado, nunca como saudável.',
  },
  {
    id: '2026-09-03-inventory-health-diagnostico',
    date: '2026-09-03',
    category: 'melhoria',
    title: 'Inventory Health agora diz o que olhar primeiro',
    description: 'O Inventory Health deixou de ser uma lista de métricas e passou a funcionar como diagnóstico: um resumo executivo com quantas áreas estão críticas, em atenção e estáveis, a situação prioritária do momento e blocos separados por assunto (confiabilidade física, processo de validação, recorrência e localização, exposição operacional). Duas leituras foram corrigidas: a qualidade da validação agora aparece como "Não avaliada" quando ainda não houve nenhuma reconferência, em vez de ser tratada como resultado ruim, e a classificação ABC/XYZ passou a ser apresentada como informação de priorização, não como nota de saúde. O risco dos SKUs entrou usando o número que o Inventário por Risco já calcula. Os indicadores que ainda dependem de dados ficam reunidos em "Cobertura do diagnóstico", e cada bloco tem atalho para o módulo onde se investiga o problema.',
  },
  {
    id: '2026-09-03-ia-insights-resumo-executivo',
    date: '2026-09-03',
    category: 'melhoria',
    title: 'IA Insights agora é um resumo executivo em cartões',
    description: 'A tela de IA Insights deixou de ser uma lista corrida e passou a mostrar um cartão por padrão identificado, em duas colunas no computador e uma no celular. Cada cartão segue sempre a mesma ordem de leitura: de qual módulo veio, o que está acontecendo com o número principal em destaque, os indicadores que sustentam a leitura, a evidência, a ação recomendada e o atalho para o módulo. Quando o padrão compara dois períodos, as duas medidas aparecem em barras na mesma escala de 0 a 100%, com a diferença em pontos percentuais. Os números, os critérios e os destinos continuam exatamente os mesmos: nenhum padrão aparece sem evidência suficiente nos dados.',
  },
  {
    id: '2026-09-02-biblioteca-31-ebooks',
    date: '2026-09-02',
    category: 'novidade',
    title: '31 e-books gratuitos na Biblioteca do I.B Academy',
    description: 'A Biblioteca ganhou 31 materiais gratuitos para ler ou baixar direto na plataforma, organizados em quatro áreas: Logística (13 títulos, de introdução a supply chain e Logística 4.0), E-commerce (5), Operações (2) e Excel (11, do básico ao avançado). Cada material mostra autoria, instituição, idioma, número de páginas e, quando disponível, o link para a publicação original — todos identificados como conteúdo externo com curadoria do I.B Academy. Use os filtros por área, nível e idioma, ou busque por autor, instituição ou tema.',
  },
  {
    id: '2026-09-02-biblioteca-creditos-e-filtros',
    date: '2026-09-02',
    category: 'melhoria',
    title: 'Biblioteca com créditos da obra, fonte original e filtros',
    description: 'Os materiais da Biblioteca agora mostram os créditos completos quando disponíveis — autor ou autores, instituição, ano, idioma, categoria e licença — e um botão "Fonte original" que leva à publicação oficial do autor ou da instituição, separado do arquivo disponibilizado aqui. Materiais produzidos por terceiros aparecem identificados como conteúdo externo com curadoria do I.B Academy. A busca passou a considerar autor, instituição, tema e idioma, e os e-books ganharam filtros por área, nível e idioma. Ler e baixar ficaram mais confiáveis, com aviso claro caso algo falhe.',
  },
  {
    id: '2026-09-02-blindscore-indice-executivo',
    date: '2026-09-02',
    category: 'melhoria',
    title: 'BlindScore agora mostra em que você pode confiar (e o que fazer agora)',
    description: 'O BlindScore passou a usar a confiança que o Confidence Score já calcula produto a produto, em vez de uma nota própria. Além da nota, a tela mostra quantos produtos realmente sustentam a leitura, se a evidência é suficiente para representar o catálogo (com aviso de leitura provisória quando não é), o que sustenta a confiança, o que está reduzindo e uma lista de prioridades com atalho direto para o módulo certo. A qualidade da validação agora aparece como "não avaliada" quando ainda não há reconferências, em vez de ser tratada como nota baixa, e a falta de dados nunca é convertida em penalidade.',
  },
  {
    id: '2026-09-02-agentes-operacionais',
    date: '2026-09-02',
    category: 'novidade',
    title: 'Agentes: automações apresentadas do jeito que a operação pensa',
    description: 'Uma nova aba "Agentes" reúne o Agente de Divergências e o Agente de Recontagem — cada um monitora um evento real do estoque, avalia uma condição e executa uma ação, exatamente como as automações de sempre, mas mostrado em linguagem de negócio (quando isso acontecer, se essa condição bater, então faça isso), sem precisar entender o desenho técnico do fluxo. Dá para acompanhar status, execuções recentes, taxa de sucesso e a atividade mais recente de cada agente, ajustar a lógica dele com o mesmo painel de configuração de sempre, ativar ou desativar, e abrir o fluxo completo no editor visual quando quiser o detalhe todo.',
  },
  {
    id: '2026-09-02-execucoes-observabilidade',
    date: '2026-09-02',
    category: 'novidade',
    title: 'Execuções de automação com histórico completo e teste seguro',
    description: 'A aba Execuções agora mostra o histórico completo com filtros por automação, resultado e período, e ao abrir uma execução você vê o caminho percorrido no fluxo (o mesmo desenho do editor, só para consulta), o passo onde parou, entrada e saída de cada bloco e o motivo do erro. Também dá para testar uma automação com um evento real recente sem aplicar nenhuma ação de verdade, e testar novamente uma execução com erro do mesmo jeito seguro. Uma área de métricas mostra tempo médio, taxa de sucesso e a distribuição de resultados do período.',
  },
  {
    id: '2026-09-02-agentes-automacoes-visao-operacional',
    date: '2026-09-02',
    category: 'melhoria',
    title: 'Agentes e Automações mais claros e informativos',
    description: 'A tela de Automações ganhou uma faixa com automações ativas, execuções de hoje, taxa de sucesso e falhas recentes, além de busca por nome e filtro por gatilho. No editor visual, cada bloco agora mostra um resumo do que está configurado, o painel de propriedades pode ser aberto e fechado sem perder o canvas de vista, e uma barra de status mostra se o fluxo está válido e quantos gatilhos, condições, ações, erros e avisos ele tem. O botão de salvar também passou a mostrar há quanto tempo foi salvo.',
  },
  {
    id: '2026-09-02-simulacao-inventario-planejamento',
    date: '2026-09-02',
    category: 'melhoria',
    title: 'Simulação de Inventário agora é um planejador completo',
    description: 'A aba de Simulação de Inventário, dentro de Auditoria de Estoque, ganhou previsão operacional completa, um indicador de capacidade da equipe (carga x folga), um diagnóstico automático do cenário configurado, comparação entre três cenários (econômico, recomendado e acelerado) e um gráfico de tempo por número de operadores — tudo calculado a partir dos dados reais da sua operação.',
  },
  {
    id: '2026-09-01-menu-lateral-compacto-e-adaptavel',
    date: '2026-09-01',
    category: 'melhoria',
    title: 'Menu lateral mais compacto e adaptável',
    description: 'O menu lateral agora ocupa menos espaço, preserva a foto cadastrada do workspace tanto aberto quanto reduzido e reúne os destinos de cada seção em um painel compacto, sem alongar a navegação. O modo reduzido ganhou identificação ao passar o mouse e toda a interface do menu acompanha corretamente os temas claro e escuro.',
  },
  {
    id: '2026-09-01-root-cause-analysis-reformulado',
    date: '2026-09-01',
    category: 'novidade',
    title: 'Root Cause Analysis reformulado',
    description: 'Toda divergência resolvida agora recebe uma classificação de causa (processo, categoria e subcausa separados) e alimenta o Pareto, a cobertura e a tendência com dados reais. Casos mais graves ou recorrentes abrem automaticamente uma investigação completa com cadeia de porquês, causa raiz, plano de ação (com responsável e prazo) e verificação de eficácia antes de poder ser encerrada. Divergências antigas sem classificação aparecem numa fila de regularização.',
  },
  {
    id: '2026-08-31-warehouse-digital-twin-fase1',
    date: '2026-08-31',
    category: 'novidade',
    title: 'Warehouse Digital Twin renovado',
    description: 'A tela do armazém ganhou uma central operacional com mapa, resumo de ocupação e situações que merecem atenção; um assistente guiado para configurar a planta em etapas (planta, escala, estrutura, endereços e revisão antes de publicar); e um replay que reproduz os eventos reais de separação e divergência na ordem em que aconteceram.',
  },
  {
    id: '2026-08-31-resultados-por-linha',
    date: '2026-08-31',
    category: 'novidade',
    title: 'Nova página Resultados por Linha',
    description: 'No menu Dashboard agora tem uma página para consultar o fechamento de cada linha/marca do ciclo atual — SKUs contados, divergências e acuracidade final, com busca por nome e acesso rápido ao resumo completo de qualquer linha já concluída.',
  },
  {
    id: '2026-08-31-acuracidade-final-resumo-fechamento',
    date: '2026-08-31',
    category: 'correcao',
    title: 'Resumo de fechamento com a acuracidade final correta',
    description: 'O resumo de fechamento de uma linha agora sempre mostra a mesma acuracidade final que aparece no Dashboard. Resumos antigos que haviam sido salvos com o valor errado são atualizados automaticamente na próxima vez que forem abertos, sem perder o histórico.',
  },
  {
    id: '2026-08-31-workspaces-config-avancada',
    date: '2026-08-31',
    category: 'novidade',
    title: 'Nova área de Workspaces em Configurações Avançadas',
    description: 'Agora dá para editar nome, foto (logo), ícone e descrição do seu workspace, ver a lista de todos os workspaces em que você opera e trocar entre eles, além de criar um workspace novo direto por lá — tudo sem sair do painel de Configurações Avançadas.',
  },
  {
    id: '2026-08-31-menu-lateral-unificado',
    date: '2026-08-31',
    category: 'melhoria',
    title: 'Menu lateral renovado',
    description: 'O menu lateral agora é um único painel, com cantos arredondados e bordas discretas — sem a faixa escura de ícones ao lado. No modo reduzido, cada seção continua com seu próprio ícone (não só um atalho por grupo), e a Análise voltou para o topo, junto do Dashboard.',
  },
  {
    id: '2026-08-31-inventario-por-risco',
    date: '2026-08-31',
    category: 'correcao',
    title: 'Inventário por Risco agora mostra "dados insuficientes" em vez de um risco parecido para tudo',
    description: 'Corrigimos um problema em que quase todos os produtos apareciam com o mesmo risco baixo, mesmo sem nenhuma contagem registrada. Agora o risco é calculado a partir de dois números separados e explicáveis — Probabilidade de falha e Impacto operacional — e produtos nunca contados aparecem como "dados insuficientes", nunca com um risco inventado. A tela também ganhou evolução real do risco, causa dominante de cada item, agrupamento de itens próximos em rotas de inspeção e um painel de detalhe com as evidências por trás do cálculo.',
  },
  {
    id: '2026-08-28-cbc-contagem-por-confianca',
    date: '2026-08-28',
    category: 'correcao',
    title: 'Contagem por Confiança agora mostra "sem dados suficientes" em vez de um score inventado',
    description: 'Corrigimos um problema em que muitos produtos apareciam com o mesmo score de confiança e a mesma data de próxima contagem. Agora, quando um produto ainda não tem contagens suficientes para calcular a confiança com segurança, isso aparece de forma explícita — em vez de um número sem sentido. A tela também ganhou prioridade de contagem separada da confiança, motivo real de cada recomendação, filtros por faixa/local/motivo e um painel de detalhe com a composição do score.',
  },
  {
    id: '2026-08-28-biblioteca-ebooks',
    date: '2026-08-28',
    category: 'novidade',
    title: 'E-books na Biblioteca da I.B Academy',
    description: 'A Biblioteca ganhou categorias (Todos, E-books, Checklists, POPs e Templates) com busca e contagem real de materiais, além do primeiro e-book disponível: "Gestão de entregas inteligente", com leitura e download em um clique.',
  },
  {
    id: '2026-08-28-catalogo-de-produtos',
    date: '2026-08-28',
    category: 'melhoria',
    title: 'Produtos Importados agora é o Catálogo de Produtos',
    description: 'A tela foi reorganizada em uma central de consulta e saneamento do catálogo: indicadores de cadastro completo, produtos que precisam de revisão e pendências críticas; busca e filtros por marca, linha, local, ABC/XYZ e qualidade cadastral; uma fila de "Qualidade cadastral" que prioriza o que corrigir primeiro; um painel rápido para editar um produto sem sair da lista; e uma aba de alterações recentes. A importação de planilhas continua no mesmo lugar de sempre.',
  },
  {
    id: '2026-08-28-retiradas-full',
    date: '2026-08-28',
    category: 'novidade',
    title: 'Retiradas Full na Logística Reversa',
    description: 'A Logística Reversa ganhou a aba "Retiradas Full", para planejar a retirada de estoque parado no Full do Mercado Livre: selecione os produtos e a quantidade, defina o destino e o motivo, e acompanhe cada etapa (reserva, preparação, despacho, recebimento e conferência) até a divergência ser resolvida, se houver. A confirmação da retirada continua sendo feita no painel do Mercado Livre — o InventoryBlind organiza o plano e registra o identificador informado por você.',
  },
  {
    id: '2026-08-28-nfe-conferencia-supervisao-etapas',
    date: '2026-08-28',
    category: 'melhoria',
    title: 'Conferência Cega por NF-e com duas formas de visualizar a fila',
    description: 'A tela de Conferência Cega por NF-e ganhou um botão para alternar entre "Visão de supervisão" (fila à esquerda, detalhes da nota selecionada à direita, com linha do tempo e histórico de contagem) e "Visão por etapas" (colunas Aguardando início, Em contagem, Em revisão e Concluídas hoje). A preferência escolhida é lembrada nos próximos acessos. A contagem cega continua protegida: nenhuma quantidade fiscal esperada é exibida antes da conclusão.',
  },
  {
    id: '2026-08-28-rankings-redesign',
    date: '2026-08-28',
    category: 'melhoria',
    title: 'Rankings reorganizado por Linhas, Operadores e Produtos',
    description: 'A tela de Rankings ganhou um visual mais limpo, com abas por Linhas, Operadores e Produtos. Agora mostra destaques consistentes e pontos de atenção com base em dados reais, exige uma amostra mínima de SKUs contados antes de destacar ou classificar qualquer linha ou operador, e adiciona tendência dos últimos 7 dias e um gráfico de produtividade por acuracidade. A exportação em CSV continua respeitando a aba, os filtros e a ordenação selecionados.',
  },
  {
    id: '2026-08-28-kpis-indicadores-redesign',
    date: '2026-08-28',
    category: 'melhoria',
    title: 'KPIs e Indicadores com visão executiva renovada',
    description: 'A área "KPIs e Indicadores" foi reorganizada com filtros de período e operador, indicadores executivos de progresso, ritmo, acuracidade e previsão de conclusão, gráfico de produção diária, alertas operacionais automáticos e uma nova visão de qualidade e divergências por operador — tudo com base em dados reais da operação.',
  },
  {
    id: '2026-08-28-kanban-meu-trabalho',
    date: '2026-08-28',
    category: 'melhoria',
    title: 'Kanban de "Meu Trabalho" redesenhado, com arquivamento de concluídas',
    description: 'O quadro Kanban ganhou um visual mais limpo e aproveita melhor o espaço da tela, com busca, filtro por prioridade e ordenação. Tarefas concluídas agora podem ser arquivadas manualmente ou em lote, são arquivadas automaticamente após 7 dias, e podem ser consultadas e restauradas a qualquer momento em "Arquivadas".',
  },
  {
    id: '2026-08-28-trilho-de-fases',
    date: '2026-08-28',
    category: 'melhoria',
    title: 'Novo indicador de progresso nas telas de importação',
    description: 'O indicador de etapas da importação de produtos, da contagem e do comparador de planilhas ganhou um visual mais limpo e discreto, sem círculos numerados. Nenhuma etapa, validação ou comportamento da importação foi alterado.',
  },
  {
    id: '2026-08-27-gerenciamento-sessoes',
    date: '2026-08-27',
    category: 'novidade',
    title: 'Gerenciamento de sessões na Central de Segurança',
    description: 'Owners e admins agora conseguem ver todas as sessões ativas da empresa (dispositivo, navegador, IP, localização aproximada e última atividade) e encerrar sessões individualmente, por usuário, ou — no caso do owner — todas de uma vez em uma emergência. Usuários vinculados a mais de uma empresa ficam protegidos automaticamente dessas ações em massa.',
  },
  {
    id: '2026-08-27-refinamento-visual',
    date: '2026-08-27',
    category: 'melhoria',
    title: 'Ajustes visuais em várias telas',
    description: 'Diversas telas internas (segurança, usuários, importação de produtos, conferência de NF-e, auditoria, mapa de calor, ferramentas e outras) receberam pequenos ajustes de acabamento visual — indicadores, tabelas e resumos numéricos mais consistentes entre si. Nenhuma funcionalidade, fluxo ou regra de negócio foi alterada.',
  },
  {
    id: '2026-08-26-nfe-xml-autopreenchimento',
    date: '2026-08-26',
    category: 'melhoria',
    title: 'Devolução por NF-e: mais dados preenchidos automaticamente',
    description: 'Ao informar a chave de acesso da NF-e de devolução, o InventoryBlind agora também preenche automaticamente a série da nota, identifica corretamente qual empresa do workspace e quem é o cliente (comparando os CNPJs da nota com os CNPJs cadastrados), e mostra o EAN, a unidade, o lote e o SKU interno de cada item, quando disponíveis. Campos preenchidos automaticamente ficam marcados, e continuam totalmente editáveis antes de registrar a devolução.',
  },
  {
    id: '2026-08-26-devolucao-canal-de-origem',
    date: '2026-08-26',
    category: 'melhoria',
    title: 'Devolução por NF-e: canal de origem identificado automaticamente',
    description: 'Ao consultar uma NF-e de devolução pela chave de acesso, o InventoryBlind agora tenta identificar sozinho o canal de origem (por exemplo, qual conta do Mercado Livre) sempre que essa informação está na própria nota. Quando não é possível identificar, é só escolher manualmente entre as contas já cadastradas em Integrações — e dá para pedir para o sistema lembrar dessa escolha nas próximas devoluções do mesmo canal. O campo continua editável a qualquer momento.',
  },
  {
    id: '2026-08-26-empresas-fiscais',
    date: '2026-08-26',
    category: 'novidade',
    title: 'Cadastro de empresas e CNPJs do workspace',
    description: 'Em Configurações Avançadas, nova seção "Empresas e Dados Fiscais" para cadastrar a razão social, CNPJ e inscrição estadual de cada empresa que opera neste workspace — útil para quem administra mais de um CNPJ. É possível definir uma empresa padrão, arquivar/restaurar empresas e vincular cada conexão de ERP (como o Olist Tiny) à empresa correta.',
  },
  {
    id: '2026-08-26-logistica-reversa-nfe-xml',
    date: '2026-08-26',
    category: 'novidade',
    title: 'Logística Reversa: localizar devolução pela chave da NF-e e sincronizar com o Tiny',
    description: 'O modal "Nova Devolução" ganhou a opção "Chave de acesso da NF-e de devolução": informe a chave de 44 dígitos e o sistema consulta a nota automaticamente, identifica os produtos (por vínculo já conhecido, código de barras ou SKU) e lista os itens para conferência, sem nunca movimentar estoque durante a consulta. Além disso, ao retornar um item ao estoque vendável, agora é possível marcar "Sincronizar entrada com ERP" para enviar essa entrada ao Olist Tiny automaticamente — o envio acontece em segundo plano, nunca trava a operação, e qualquer falha fica visível para nova tentativa.',
  },
  {
    id: '2026-08-26-logistica-reversa-fix-aprovacao-alto-valor',
    date: '2026-08-26',
    category: 'correcao',
    title: 'Corrige aviso de aprovação para itens de alto valor',
    description: 'Quando a empresa exige aprovação prévia para destinar itens de alto valor, o aviso e o bloqueio do botão de confirmação agora aparecem corretamente antes da tentativa, em vez de a devolução ser rejeitada só depois de clicar em "Confirmar destinação".',
  },
  {
    id: '2026-08-26-logistica-reversa-fase-2',
    date: '2026-08-26',
    category: 'melhoria',
    title: 'Logística Reversa: checklists, aprovações e indicadores',
    description: 'A Logística Reversa ganhou checklists de inspeção configuráveis por categoria, produto, motivo ou faixa de valor, grades de condição personalizadas, sugestão automática de destinação (a decisão final continua sempre manual e auditável), aprovações obrigatórias para casos sensíveis (descarte, alto valor, divergência de serial), controle de ordens de assistência técnica e recondicionamento, gestão de bloqueios de quarentena, alertas de prazo (SLA) e um painel de indicadores com taxa de recuperação, valor recuperado/perdido e principais motivos de devolução. Também é possível aplicar algumas ações com segurança em várias devoluções de uma vez.',
  },
  {
    id: '2026-08-26-logistica-reversa',
    date: '2026-08-26',
    category: 'novidade',
    title: 'Logística Reversa em Operações',
    description: 'Nova área em Operação Inteligente → Operações → Logística Reversa: registre a devolução de uma mercadoria (por pedido, NF-e, SKU, código de barras ou recebimento avulso), confira os itens recebidos, faça a inspeção com checklist e decida a destinação de cada um — voltar ao estoque, quarentena, avariados, assistência técnica, recondicionamento, devolução ao fornecedor ou descarte. Nenhum item entra no estoque disponível para venda antes de passar pela inspeção e ser aprovado, e toda a movimentação fica registrada com histórico completo.',
  },
  {
    id: '2026-08-26-codigo-convite-empresa',
    date: '2026-08-26',
    category: 'novidade',
    title: 'Código de convite da empresa',
    description: 'Em Usuários, quem administra a empresa agora pode gerar um código de convite (botão "Código de Convite") e compartilhar com quem precisa entrar no time. Na tela de cadastro do InventoryBlind, a pessoa escolhe "Tenho um código de convite" e é vinculada automaticamente à empresa, sem precisar que ninguém crie a conta por ela. Por segurança, o código muda todos os dias.',
  },
  {
    id: '2026-08-26-remover-nfe-historico',
    date: '2026-08-26',
    category: 'correcao',
    title: 'Remover uma NF-e do histórico volta a funcionar',
    description: 'Ao preencher a justificativa e confirmar a remoção de uma nota de conferência de NF-e, a ação agora é concluída normalmente: a nota sai da lista ativa, aparece em Arquivados e pode ser restaurada a qualquer momento. Nada é apagado — XML, itens e histórico de contagem continuam preservados.',
  },
  {
    id: '2026-08-25-kpis-cockpit',
    date: '2026-08-25',
    category: 'melhoria',
    title: 'KPIs e Indicadores mais objetivo',
    description: 'A área "KPIs e Indicadores" do Painel Administrativo agora abre com um resumo rápido da situação da operação, até 6 indicadores em destaque (incluindo a Acuracidade com a meta de 95% já usada no seu dashboard), um gráfico de evolução e até 3 alertas prioritários — como quedas de acuracidade ou indicadores sem atualização recente. Criar e remover indicadores continua funcionando exatamente como antes.',
  },
  {
    id: '2026-08-25-top10-curva-abc',
    date: '2026-08-25',
    category: 'novidade',
    title: 'Top 10 de Vendas pode usar a Curva ABC',
    description: 'No Painel Administrativo, o bloco "Top 10 de Vendas" agora pode ser ativado/desativado e configurado de duas formas: como antes (métrica e período sobre as vendas importadas) ou automaticamente a partir de uma análise já publicada da Curva ABC, escolhendo faturamento, quantidade vendida ou lucro bruto como critério. A prévia mostra exatamente o que vai aparecer antes de salvar.',
  },
  {
    id: '2026-08-25-curva-abc',
    date: '2026-08-25',
    category: 'novidade',
    title: 'Curva ABC em Produtos',
    description: 'Nova área em Produtos → Curva ABC: importe suas planilhas de vendas, preços/custos e (opcionalmente) estoque para ver automaticamente o giro, o faturamento e o lucro bruto de cada produto, classificados em curvas A/B/C, com recomendações comerciais e de reposição. É só análise: nada aqui altera o estoque ou os inventários do sistema. A opção de conectar direto com o Tiny, Bling, TOTVS ou SAP já aparece reservada na tela, marcada como "Em breve".',
  },
  {
    id: '2026-08-25-importar-vendas-tiny-sem-data',
    date: '2026-08-25',
    category: 'correcao',
    title: 'Importação de vendas agora aceita o relatório do Tiny sem coluna de data',
    description: 'O relatório de vendas exportado do Tiny normalmente não traz uma data por linha (ele soma as vendas de um período por produto). Ao importar um arquivo assim, o assistente agora pede a data de referência do relatório e aplica ela a todas as linhas, em vez de rejeitar o arquivo inteiro por falta de data.',
  },
  {
    id: '2026-08-25-painel-administrativo',
    date: '2026-08-25',
    category: 'melhoria',
    title: 'Painel Administrativo reorganizado',
    description: 'O Painel Administrativo ganhou uma nova organização em áreas: Visão Geral, Vendas e Integrações, KPIs, Inventários e Dados, e uma Zona de Perigo separada e recolhida para o Arquivar e Resetar Inventário (agora com confirmação por frase digitada e justificativa obrigatória). O Top 10 de Vendas deixou de ser editado manualmente: agora ele é calculado automaticamente a partir de planilhas de vendas importadas (.csv, .xls ou .xlsx), com detecção automática de colunas, prévia antes de confirmar e histórico de importações. O card de "Gerenciamento de Marcas/Linhas" saiu do Painel Administrativo — a área de marcas e linhas de produto continua em Produtos → Linhas e Marcas, sem nenhuma alteração.',
  },
  {
    id: '2026-08-24-meus-atalhos',
    date: '2026-08-24',
    category: 'novidade',
    title: 'Meus Atalhos no Dashboard',
    description: 'O topo do Dashboard agora tem "Meus Atalhos": escolha até 5 funções do sistema (como Conferência por NF-e, Histórico de Importações ou Meu Trabalho) para acessar com um clique, na ordem que preferir. Cada pessoa configura os próprios atalhos, e eles nunca aparecem para outro usuário ou outra empresa. O convite ao Diagnóstico da Operação virou um aviso separado, que só aparece quando faz sentido (empresa nova, poucos produtos cadastrados ou quando você tenta usar um recurso de outro plano) — continua disponível a qualquer momento pelo menu.',
  },
  {
    id: '2026-08-24-linhas-e-marcas',
    date: '2026-08-24',
    category: 'novidade',
    title: 'Linhas e Marcas em Produtos',
    description: 'Nova área em Produtos para organizar seu catálogo por marca e linha: cadastre marcas com responsáveis e palavras-chave, crie linhas dentro delas, e deixe o sistema sugerir automaticamente a marca/linha de cada produto pelo título — sem IA, sem custo extra. Sugestões ambíguas ficam numa fila de revisão para confirmação manual, e cada confirmação pode ensinar uma nova palavra-chave para acertar mais da próxima vez.',
  },
  {
    id: '2026-08-24-resumo-fechamento-linha',
    date: '2026-08-24',
    category: 'novidade',
    title: 'Resumo automático ao fechar uma linha',
    description: 'Quando os pendentes de uma linha/marca chegam a zero, o Centro de Gestão da Contagem agora monta sozinho um resumo do fechamento: reúne as observações digitadas nas contagens daquele ciclo, identifica os problemas mais comuns (saldo em excesso ou em falta, organização do vão, vão duplicado, divergência resolvida na recontagem) e mostra tudo num resumo curto, sem precisar reler cada contagem uma por uma. As categorias e palavras-chave usadas na identificação podem ser ajustadas a qualquer momento em "Gerenciar categorias", e o resumo pode ser gerado depois para linhas antigas já concluídas, ou reprocessado sempre que as categorias mudarem — sem mexer em nenhuma contagem já registrada.',
  },
  {
    id: '2026-08-24-hub-integracoes',
    date: '2026-08-24',
    category: 'melhoria',
    title: 'Novo Hub de Integrações',
    description: 'A área de Integrações ganhou uma tela única: um catálogo com todos os ERPs e marketplaces (Tiny, Bling, SAP, TOTVS, Mercado Livre, Shopee, Amazon, Temu, AliExpress, Shein, Magalu, TikTok Shop e Netshoes), com busca, filtros e o status real de cada conexão. O Tiny ERP continua funcionando exatamente como antes — conexão, sincronização, fila de lançamentos e alertas —, agora com um card próprio em "Minhas integrações" mostrando se está conectado, sincronizando, com atenção ou com erro. As demais integrações aparecem como "Em breve": dá para ver o que está por vir, mas ainda não é possível conectar.',
  },
  {
    id: '2026-08-24-calculadora-paletizacao',
    date: '2026-08-24',
    category: 'novidade',
    title: 'Calculadora de Paletização',
    description: 'Nova ferramenta em Ferramentas > Calculadora de Paletização: informe as medidas e o peso da caixa, escolha o palete (PBR, Europeu ou personalizado) e veja quantas caixas cabem por camada, quantas camadas, caixas por palete e quantos paletes são necessários para a quantidade total — com desenho da vista de cima, alertas de peso/altura/estabilidade excedidos e comparação entre diferentes arranjos. Também processa uma planilha inteira de uma vez (um SKU por linha) e exporta o resultado em PDF, Excel, CSV, imagem ou impressão. Tudo calculado no seu navegador, sem enviar nenhum dado para fora.',
  },
  {
    id: '2026-08-24-central-de-pdfs',
    date: '2026-08-24',
    category: 'novidade',
    title: 'Central de PDFs',
    description: 'Nova ferramenta em Ferramentas > Central de PDFs para organizar seus arquivos sem sair do InventoryBlind: unir vários PDFs num só, dividir ou extrair páginas, intercalar documentos (por exemplo etiqueta + declaração), preparar etiquetas para impressoras térmicas (40×25, 100×40, 100×150 e outros tamanhos), montar folhas com várias páginas por impressão, converter imagens em PDF (e páginas de PDF em imagem) e otimizar o tamanho do arquivo. Também processa vários arquivos de uma vez, com a mesma operação aplicada em lote. Tudo roda direto no seu navegador — nenhum arquivo é enviado para fora, e nada fica salvo depois que você sai da tela. Sem precisar cadastrar nada antes.',
  },
  {
    id: '2026-08-21-editor-automacoes-visual',
    date: '2026-08-21',
    category: 'melhoria',
    title: 'Novo visual para o editor de Agentes e Automações',
    description: 'O editor de fluxos em Agentes e Automações ganhou uma experiência moderna: canvas com zoom e navegação livres, biblioteca de blocos pesquisável na lateral, painel de configuração ao lado do bloco selecionado (em vez de uma janela por cima da tela), desfazer/refazer, auto-organizar o fluxo e minimapa. Também passou a ser possível montar blocos de Repetição, Aguardar retorno e Consultar IA, que já existiam no motor mas não tinham como ser configurados pela tela. Automações já criadas continuam funcionando exatamente como antes — nada de regra, gatilho ou ação foi alterado, só a forma de montar o fluxo.',
  },
  {
    id: '2026-08-21-sino-notificacoes-tarefas',
    date: '2026-08-21',
    category: 'melhoria',
    title: 'Sino de notificações das suas tarefas',
    description: 'Novo ícone de sino no topo da tela, ao lado de Novidades, exclusivo para avisos das suas tarefas: quando uma tarefa é atribuída a você, o prazo muda, está terminando, vence ou fica atrasada, e quando alguém comenta em uma tarefa que você acompanha. Os avisos chegam na hora, sem precisar atualizar a página, e clicar em um deles já abre a tarefa correspondente em Meu Trabalho.',
  },
  {
    id: '2026-08-21-meu-trabalho-tarefas',
    date: '2026-08-21',
    category: 'novidade',
    title: 'Meu Trabalho: gestão de tarefas',
    description: 'Nova central em Ferramentas > Meu Trabalho para organizar suas tarefas do dia a dia (reposição, inventário, conferência, contagem e outras) e acompanhar as tarefas que a gestão atribuiu a você. Quatro visões: Meu Dia (o que está atrasado, para hoje e por vir), Kanban (arraste entre A fazer/Em andamento/Concluído), Agenda (por dia, semana ou mês) e, para gestores, Equipe (tarefas de todos, carga de trabalho e atribuição para um ou vários usuários). Tarefas com vários responsáveis mostram o progresso de cada um, com comentários, anexos e notificações dentro do próprio painel.',
  },
  {
    id: '2026-08-21-comparador-de-planilhas',
    date: '2026-08-21',
    category: 'novidade',
    title: 'Comparador de Planilhas',
    description: 'Nova ferramenta em Ferramentas > Comparador de Planilhas para comparar duas bases (estoque físico × sistema, ERP × WMS, recebimento × NF-e, entre outras) direto do navegador, sem precisar cadastrar nada. Escolha a chave (simples ou composta, com nomes de coluna diferentes em cada planilha), mapeie os campos que quer comparar, ajuste tolerâncias e forma de tratar duplicados, e veja um painel com o que está igual, divergente, só numa das bases ou duplicado — com detalhe linha a linha e exportação em Excel, CSV e PDF.',
  },
  {
    id: '2026-08-21-laboratorio-codigos-de-barras',
    date: '2026-08-21',
    category: 'novidade',
    title: 'Laboratório de Códigos de Barras',
    description: 'Nova ferramenta em Ferramentas > Códigos de Barras para gerar, validar e imprimir EAN-13, EAN-8, UPC-A, Code 128, ITF-14, QR Code e Data Matrix — sem precisar cadastrar nada antes. Digite o valor livremente, busque um produto do catálogo ou importe uma planilha em lote. O sistema calcula e confere o dígito verificador automaticamente, mostra uma pré-visualização em tempo real e exporta em PNG, SVG, PDF ou impressão direta, nos tamanhos 40×25mm, 100×150mm, 100×40mm ou personalizado.',
  },
  {
    id: '2026-08-21-contagem-manual-inicio-termino',
    date: '2026-08-21',
    category: 'melhoria',
    title: 'Contagem Manual: informe início e término reais',
    description: 'O painel ao vivo não inicia mais um cronômetro automático ao selecionar a linha — agora você informa a data e hora em que a contagem realmente começou e terminou (com um botão "Agora" para preencher rápido) e o sistema calcula a duração real. O painel mostra início, término e duração, e passa a marcar a contagem como "Não iniciada", "Em andamento" ou "Finalizada" de acordo com essas informações.',
  },
  {
    id: '2026-08-21-webhooks-mais-eventos',
    date: '2026-08-21',
    category: 'novidade',
    title: 'Webhooks avisam sobre mais momentos da contagem',
    description: 'Além de contagem finalizada e aprovada, agora dá para ser avisado quando uma contagem é iniciada, cancelada ou termina com divergência. Os eventos aparecem organizados por categoria, com opção de selecionar todos. O botão Testar passa a mostrar na hora o código de resposta e o tempo do seu servidor, e cada webhook tem um histórico de entregas com tentativas, duração e o motivo de eventuais falhas. Entregas que falham por instabilidade são retentadas automaticamente até cinco vezes.',
  },
  {
    id: '2026-08-21-chaves-api-expiracao',
    date: '2026-08-21',
    category: 'melhoria',
    title: 'Chaves de API com validade e documentação completa',
    description: 'Ao criar uma chave você pode definir uma descrição e uma validade (30 dias, 90 dias, 1 ano ou uma data escolhida) — ou deixar sem expiração, como antes. A chave completa aparece em uma tela própria, uma única vez, com aviso e botão de copiar. Chaves já revogadas podem ser excluídas da lista. A página passa a trazer a documentação da API com o endereço real da sua conta, os endpoints disponíveis, exemplos prontos para copiar e os códigos de resposta.',
  },
  {
    id: '2026-08-20-configuracoes-avancadas',
    date: '2026-08-20',
    category: 'novidade',
    title: 'Configurações Avançadas: API, Webhooks e Logs',
    description: 'Quem administra a conta agora pode criar chaves de API para integrar sistemas externos, configurar webhooks que avisam automaticamente quando uma contagem é finalizada ou aprovada, e consultar o histórico de ações da empresa com filtros e exportação em CSV.',
  },
  {
    id: '2026-08-20-controles-administrativos',
    date: '2026-08-20',
    category: 'novidade',
    title: 'Controles administrativos e área de arquivados',
    description: 'Quem administra a conta pode remover contagens e notas do histórico informando o motivo, e restaurá-las depois na nova área de Arquivados. Nada é apagado: quantidades, notas e o XML continuam guardados. Reabrir uma contagem ou conferência passa a ser exclusivo de quem administra a conta.',
  },
  {
    id: '2026-08-20-importar-nfe-por-chave',
    date: '2026-08-20',
    category: 'novidade',
    title: 'Consulta e download de XML/NFe pela chave de acesso',
    description: 'Nova ferramenta em Ferramentas: cole a chave de acesso de 44 dígitos da NF-e para buscar a nota automaticamente. O XML é baixado e a nota já é transferida para a Conferência por NF-e, sem precisar do arquivo manualmente.',
  },
  {
    id: '2026-08-20-gerenciar-sessoes-contagem',
    date: '2026-08-20',
    category: 'novidade',
    title: 'Gerenciar as sessões da Contagem Física Digital',
    description: 'Na lista de sessões, quem administra a conta pode corrigir o depósito, a área e a observação de uma contagem, ou tirá-la do histórico informando o motivo. As quantidades contadas continuam guardadas.',
  },
  {
    id: '2026-08-19-diagnostico-operacao',
    date: '2026-08-19',
    category: 'novidade',
    title: 'Diagnóstico da operação',
    description: 'Cinco etapas curtas sobre volume, sistemas e situação do estoque. Ao final indicamos o plano mais adequado, com as razões da recomendação. Disponível em Minha Conta e pode ser refeito quando a operação mudar.',
  },
  {
    id: '2026-08-19-menu-lateral',
    date: '2026-08-19',
    category: 'melhoria',
    title: 'Novo visual do menu lateral',
    description: 'O menu principal ganhou uma faixa de acesso rápido e pode ser recolhido para dar mais espaço à tela — sem perder nenhuma função de antes.',
  },
  {
    id: '2026-08-19-area-segura-iphone',
    date: '2026-08-19',
    category: 'correcao',
    title: 'Ajuste de tela em iPhone',
    description: 'No iPhone, o topo da tela não fica mais escondido atrás do relógio e da bateria, e agora dá para rolar até o fim da página e tocar no último botão sem esbarrar na barra inferior.',
  },
  {
    id: '2026-08-19-saudacao',
    date: '2026-08-19',
    category: 'novidade',
    title: 'Boas-vindas personalizadas no Dashboard',
    description: 'O painel principal agora cumprimenta você pelo nome, de acordo com o horário do dia.',
  },
  {
    id: '2026-08-19-tiny-disponivel',
    date: '2026-08-19',
    category: 'novidade',
    title: 'Integração com o Tiny liberada',
    description: 'Conecte o Tiny em Integrações e mantenha o estoque sincronizado automaticamente com o seu ERP.',
  },
  {
    id: '2026-08-19-analytics',
    date: '2026-08-19',
    category: 'novidade',
    title: 'Analytics: BlindScore, Inventory Health, IA Insights e Auditorias',
    description: 'Acompanhe a confiabilidade do seu estoque com um índice de 0 a 100, indicadores detalhados, alertas automáticos e o histórico de auditorias já realizadas.',
  },
  {
    id: '2026-08-17-recontagem-automatica',
    date: '2026-08-17',
    category: 'melhoria',
    title: 'Recontagens automáticas por limite de divergência',
    description: 'Agora é possível configurar um limite de divergência que dispara a recontagem automaticamente, sem depender de uma ação manual.',
  },
  {
    id: '2026-08-19-fix-limite-percentual',
    date: '2026-08-19',
    category: 'correcao',
    title: 'Ajuste no cálculo de divergência por unidade',
    description: 'Corrigimos um caso em que o limite percentual configurado não era aplicado corretamente quando o ERP retornava saldo zerado.',
  },
];

// ── Retenção de exibição ──────────────────────────────────────────────────────────────
//
// O painel é um histórico RECENTE, não um changelog infinito: com 95 entradas acumuladas
// desde as primeiras versões, abrir o painel montava 95 blocos de uma vez no DOM e
// travava. O corte é feito AQUI, na origem, e não com slice na renderização — quem
// consome recebe só o que vai aparecer.
//
// Não existe banco por trás disto: as entradas são um array estático deste módulo, então
// "limitar a consulta" significa limitar o que a origem exporta. Nada é apagado — o
// histórico completo continua em `WHATS_NEW_ENTRIES`, versionado no git.

/** Teto de entradas montadas no painel. */
export const WHATS_NEW_MAX_ENTRIES = 20;
/** Idade máxima de uma entrada para ainda aparecer. */
export const WHATS_NEW_MAX_AGE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Data da entrada como instante local, no mesmo formato que o painel já usa para exibir. */
const entryTime = (entry: WhatsNewEntry): number => new Date(`${entry.date}T00:00:00`).getTime();

/**
 * As novidades que o painel deve mostrar: as mais recentes primeiro, sem nada acima de
 * 90 dias e no máximo 20.
 *
 * A ordenação é defensiva. A convenção do arquivo é inserir no topo, mas basta uma
 * entrada fora de lugar para o "mais recente primeiro" deixar de valer — e hoje já existe
 * uma. `sort` é estável, então entradas do MESMO dia mantêm exatamente a ordem em que
 * foram escritas: a aparência do painel não muda.
 */
export function listRecentWhatsNew(now: Date = new Date()): WhatsNewEntry[] {
  const cutoff = now.getTime() - WHATS_NEW_MAX_AGE_DAYS * DAY_MS;
  return [...WHATS_NEW_ENTRIES]
    .sort((a, b) => entryTime(b) - entryTime(a))
    .filter(entry => entryTime(entry) >= cutoff)
    .slice(0, WHATS_NEW_MAX_ENTRIES);
}

const LAST_SEEN_KEY = 'ib_whats_new_last_seen_id';

// Per-device: qual foi a última novidade já visualizada. Não existe hoje uma tabela de
// preferências de usuário no projeto — localStorage é a solução mais simples e segura,
// no mesmo padrão já usado por src/lib/workspacePrefs.ts.
export function getLastSeenWhatsNewId(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

export function markWhatsNewSeen(latestId: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, latestId);
  } catch {
    // localStorage indisponível (navegação privada, etc.) — o indicador só reaparece na próxima sessão.
  }
}

export function hasUnseenWhatsNew(): boolean {
  // A partir da MESMA lista que o painel mostra: se a novidade mais nova já não aparece
  // mais (saiu pela retenção), o indicador não pode continuar aceso apontando para ela.
  const latest = listRecentWhatsNew()[0]?.id;
  if (!latest) return false;
  return getLastSeenWhatsNewId() !== latest;
}
