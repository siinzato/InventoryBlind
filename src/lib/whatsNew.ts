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
  const latest = WHATS_NEW_ENTRIES[0]?.id;
  if (!latest) return false;
  return getLastSeenWhatsNewId() !== latest;
}
