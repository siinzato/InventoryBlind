// Central de Conhecimento (Minha Conta → Recursos e Conhecimento) — conteúdo estático de
// produto, no mesmo espírito de academyContent.ts (fixo, igual para todos os tenants, sem
// tabela — não é dado operacional). Reaproveita o tipo KnowledgeEntry e os arrays
// KNOWLEDGE_* já existentes em academyContent.ts para FAQ/glossário do Método I.B.® em vez
// de duplicar esse conteúdo; aqui entram apenas os tópicos de PRODUTO (fora do escopo da
// I.B Academy).
//
// As categorias abaixo espelham os grupos do menu lateral, na mesma ordem — quem procura
// ajuda procura pelo nome que vê na tela, não por uma taxonomia paralela. Ao lançar um
// módulo novo, a entrada correspondente entra aqui na categoria do grupo em que ele
// aparece no menu.
//
// `icon` é uma chave de string (não o componente) para não importar React/lucide aqui —
// resolvida num pequeno mapa dentro de KnowledgeCenterPage.tsx, mesmo padrão de PILARES em
// academyContent.ts. Toda chave nova precisa ser adicionada àquele mapa.

import type { KnowledgeEntry } from './academyContent';

export interface KbArticle {
  id: string;
  title: string;
  body: string;
  /** Recurso ainda não lançado — mostra um selo "Em breve" em vez de descrever
   *  um comportamento que o cliente não vai encontrar na tela. Use com parcimônia:
   *  um selo que sobrevive ao lançamento é pior que nenhum artigo. */
  comingSoon?: boolean;
}

export interface KbCategory {
  id: string;
  label: string;
  description: string;
  icon: string;
  articles: KbArticle[];
}

export const KB_CATEGORIES: KbCategory[] = [
  {
    id: 'comecando',
    label: 'Começando no InventoryBlind',
    description: 'O essencial para sair do zero e rodar seu primeiro inventário.',
    icon: 'Rocket',
    articles: [
      {
        id: 'o-que-e',
        title: 'O que é o InventoryBlind?',
        body: 'Uma plataforma de inteligência operacional de estoque: além de registrar contagens, ela organiza a preparação, aplica contagem cega, classifica divergências por causa raiz e transforma o resultado em indicadores de confiabilidade — não é apenas um sistema de digitar números contados.',
      },
      {
        id: 'contagem-cega',
        title: 'Como funciona a contagem cega?',
        body: 'O operador registra a quantidade contada sem visualizar o saldo esperado do sistema. Isso elimina o viés de confirmação (a tendência de "ver" o número que já se espera encontrar) e é a base de todo o Método I.B.® — veja a I.B Academy para a metodologia completa.',
      },
      {
        id: 'primeiro-acesso',
        title: 'Primeiro acesso na plataforma',
        body: 'Após o convite, faça login com seu e-mail e senha. Se você participa de mais de uma empresa, a tela de seleção de workspace aparece antes do painel principal — dá para trocar de empresa a qualquer momento pelo menu do usuário, no canto superior direito.',
      },
      {
        id: 'diagnostico',
        title: 'Diagnóstico da operação: por onde começar',
        body: 'Em Minha Conta → Diagnóstico da operação, um questionário curto sobre o seu estoque devolve um plano recomendado: quais módulos ativar primeiro e em que ordem. É o caminho mais rápido para quem abriu a plataforma e não sabe qual dos módulos resolve o problema que tem hoje.',
      },
      {
        id: 'configuracao-inicial',
        title: 'Configuração inicial da empresa',
        body: 'Owners e admins configuram a empresa em Administração: convite de usuários, papéis de acesso e parâmetros do módulo de Root Cause Analysis (janela de recorrência, limiar para abrir 5 Porquês). O restante da plataforma já funciona com os padrões, sem etapas obrigatórias adicionais.',
      },
      {
        id: 'primeiro-inventario',
        title: 'Criando seu primeiro inventário',
        body: 'Em Operações → Nova Contagem, crie uma linha de inventário informando o total de SKUs esperado e comece a registrar contagens manuais ou importar uma planilha já contada. O Centro de Gestão da Contagem acompanha o progresso em tempo real.',
      },
      {
        id: 'usuarios-permissoes',
        title: 'Cadastrando usuários e permissões',
        body: 'Em Administração → Usuários, convide colaboradores e defina o papel de cada um (owner, admin, manager, lead ou operador). O papel determina o que a pessoa pode ver e alterar — por exemplo, aprovar uma contagem na Auditoria Cruzada exige owner, admin ou manager.',
      },
      {
        id: 'importando-produtos',
        title: 'Importando produtos',
        body: 'Em Produtos → Importar Produtos, envie uma planilha .csv/.xlsx. O assistente detecta automaticamente colunas como SKU, EAN e localização, deixa você confirmar o mapeamento e mostra uma prévia antes de gravar — nada é importado sem essa confirmação.',
      },
      {
        id: 'endereco-proprio',
        title: 'Cada seção tem endereço próprio',
        body: 'Toda tela do sistema tem um endereço na barra do navegador. Dá para salvar nos favoritos, voltar e avançar, recarregar a página sem perder o lugar e mandar o link de uma tela específica para um colega — ele cai exatamente onde você estava.',
      },
      {
        id: 'instalar-app',
        title: 'Instalar o InventoryBlind no computador ou celular',
        body: 'Pelo menu do usuário, a opção "Instalar InventoryBlind" cria um atalho que abre a plataforma em janela própria, sem a barra do navegador. No celular, o app instalado é o formato recomendado para quem conta em campo.',
      },
    ],
  },
  {
    id: 'gestao-inventario',
    label: 'Gestão de Inventário',
    description: 'Do planejamento do que contar até o fechamento e a análise de produtividade.',
    icon: 'ClipboardList',
    articles: [
      {
        id: 'nova-contagem',
        title: 'Criar nova contagem',
        body: 'Toda contagem pertence a uma linha de inventário. Ao criar uma, você escolhe entre lançamento manual (digitando SKU a SKU) ou importação de uma planilha já contada em campo — os dois caminhos alimentam os mesmos indicadores de acuracidade.',
      },
      {
        id: 'centro-gestao',
        title: 'Centro de Gestão da Contagem',
        body: 'Painel central de Operações → Nova Contagem: mostra total de SKUs, quantos já foram contados, divergências encontradas/recontadas/reais e a acuracidade inicial e final de cada linha, com histórico de todas as contagens e recontagens já feitas.',
      },
      {
        id: 'cobertura',
        title: 'Cobertura de contagem',
        body: 'Em Operações → Cobertura de Contagem você vê quanto do estoque foi efetivamente contado e há quanto tempo — inclusive o que nunca foi contado. É a linha de base honesta da operação: mostra o que ficou para trás, não só o que foi feito.',
      },
      {
        id: 'ciclagem',
        title: 'Programa de ciclagem',
        body: 'Em Operações → Programa de Ciclagem você define com que frequência cada classe da curva ABC é recontada e quantos SKUs cabem no dia. O sistema monta a lista do dia de hoje, e essa lista vira uma contagem num clique — sem redigitar nada. A equipe também é lembrada nos dias de contagem.',
      },
      {
        id: 'livro-razao',
        title: 'Livro-Razão do produto',
        body: 'Em Operações → Livro-Razão do Produto, tudo o que foi registrado sobre um SKU aparece em ordem cronológica — e cada linha diz se aquilo alterou o saldo ou apenas ficou registrado. É a resposta para "o que aconteceu com este item?" sem precisar abrir cinco telas.',
      },
      {
        id: 'ajuste-erp-razao',
        title: 'Corrigir o estoque no ERP pelo Livro-Razão',
        body: 'Quando uma contagem aponta uma diferença real, o ajuste pode ser enviado ao ERP a partir do próprio Livro-Razão, com o motivo registrado junto. O envio fica gravado na linha do tempo do produto, então depois dá para saber quem corrigiu o quê e por quê.',
      },
      {
        id: 'dividir-equipes',
        title: 'Como dividir equipes',
        body: 'Cada contagem registra até dois operadores responsáveis. Para inventários maiores, divida por linha de inventário ou por endereço/corredor e acompanhe o andamento de cada equipe separadamente pelo Centro de Gestão da Contagem e por Rankings.',
      },
      {
        id: 'produtividade',
        title: 'Como acompanhar produtividade',
        body: 'Minha Conta → Produtividade mostra, por colaborador, SKUs contados, número de contagens e recontagens, divergências e acuracidade média. Gestores (lead/manager+) também veem a visão de equipe, com ranking e sugestões de reconhecimento.',
      },
      {
        id: 'rankings',
        title: 'Rankings',
        body: 'Comparação operacional entre pessoas e equipes, construída para não premiar velocidade acima da qualidade: quem conta muito e erra muito não aparece na frente de quem conta com acuracidade. Serve para reconhecer, não para pressionar.',
      },
      {
        id: 'reconferencia',
        title: 'Como funciona a reconferência',
        body: 'Quando uma contagem encontra divergências, uma recontagem pode ser aberta ligada à contagem original (2ª contagem, e se necessário 3ª). O sistema compara os resultados e calcula quantas divergências foram eliminadas na recontagem — essa cadeia é a base da Auditoria Cruzada.',
      },
      {
        id: 'tratar-divergencias',
        title: 'Como tratar divergências',
        body: 'Toda divergência de contagem, conferência por NF-e ou operação Full precisa ser classificada por causa raiz (recebimento, armazenagem, picking, avaria, furto/perda etc.) antes de ser fechada — isso alimenta o Root Cause Analysis e a Análise de Tendência na Auditoria de Estoque.',
      },
      {
        id: 'resultados-por-linha',
        title: 'Resultados por Linha',
        body: 'O fechamento individual de cada linha/marca concluída no ciclo: SKUs contados, divergências reais e acuracidade final, com histórico e exportação. Dá para enviar o resultado ao responsável pela linha, em vez de só arquivar o número.',
      },
      {
        id: 'finalizacao',
        title: 'Finalização do inventário',
        body: 'Uma linha de inventário se considera fechada quando a acuracidade final está estável e as divergências reais foram todas classificadas. Não existe um botão único de "encerrar" — o fechamento é o resultado de contagem, recontagem e classificação completas.',
      },
    ],
  },
  {
    id: 'recebimento-armazenagem',
    label: 'Recebimento e Armazenagem',
    description: 'O que entra, onde é guardado e o que volta — com endereço e rastro.',
    icon: 'PackageCheck',
    articles: [
      {
        id: 'nfe-conferencia',
        title: 'Conferência cega por NF-e',
        body: 'O conferente registra o que recebeu sem ver as quantidades da nota, e só depois o sistema compara. Vale o mesmo princípio da contagem de inventário: conferir enxergando o número esperado não é conferir. A supervisão acompanha a fila e o andamento de todas as conferências em curso.',
      },
      {
        id: 'nfe-para-pulmao',
        title: 'Da nota conferida direto para o endereço',
        body: 'Terminada a conferência da nota, o que sobrou do recebimento pode ser endereçado ao Pulmão na mesma tela, sem relançar item por item. O saldo já entra com o endereço de destino registrado.',
      },
      {
        id: 'pulmao',
        title: 'Pulmão (Porta-Pallet)',
        body: 'Endereçamento do excesso de mercadoria: cada vaga tem endereço próprio, e todo saldo vem de um movimento registrado — nada aparece no mapa sem ter entrado por algum lugar. O mapa mostra a rua inteira, com capacidade e ocupação de cada vaga.',
      },
      {
        id: 'pulmao-sugestao',
        title: 'Pulmão: o sistema sugere onde guardar',
        body: 'Ao endereçar uma mercadoria, a plataforma propõe a vaga considerando o que já está armazenado e o espaço disponível. A sugestão é um ponto de partida — a decisão continua sendo de quem está no chão do armazém.',
      },
      {
        id: 'pulmao-consulta',
        title: 'Pulmão: consultar um SKU e a permanência',
        body: 'A busca por SKU mostra em que vagas aquele item está e há quanto tempo cada saldo está parado. Permanência longa é o primeiro sinal de mercadoria esquecida ocupando posição nobre.',
      },
      {
        id: 'pulmao-etiquetas',
        title: 'Pulmão: etiquetas e leitura por QR Code',
        body: 'Os endereços podem ser impressos em etiqueta, com escolha do tamanho antes de imprimir, e lidos pelo celular por QR Code. É o que fecha o ciclo: a vaga tem um nome físico que o operador consegue ler de longe e conferir com o aparelho que já tem no bolso.',
      },
      {
        id: 'pulmao-gestao',
        title: 'Pulmão: área de gestão',
        body: 'Indicadores de ocupação, movimentação do período, auditoria do histórico, endereços fora do padrão de nomenclatura e relatórios — a visão de supervisão do armazém, separada da operação do dia a dia.',
      },
      {
        id: 'ordens-compra',
        title: 'Ordens de Compra',
        body: 'Cadastre ou importe ordens de compra e compare-as com as NF-es já recebidas. A comparação não bloqueia nada: ela aponta divergência entre o que foi pedido e o que chegou, para você decidir o que fazer.',
      },
      {
        id: 'logistica-reversa',
        title: 'Logística Reversa',
        body: 'Recebimento, conferência, inspeção e destinação de mercadorias devolvidas. A devolução passa pelo mesmo rigor da entrada normal — o que volta precisa de um destino registrado, não de uma pilha no canto.',
      },
      {
        id: 'lote-validade',
        title: 'Lote e validade',
        body: 'Recurso opcional. Em Configurações Avançadas → Lote e Validade, owners e admins ligam o registro de lote e de data de validade no recebimento. Desligado, nada disso aparece para a equipe — quem não trabalha com perecíveis não vê campo a mais na tela.',
      },
      {
        id: 'controle-validade',
        title: 'Controle de Validade',
        body: 'Com lote e validade ligados, o módulo Controle de Validade (Operações) acompanha o que está perto de vencer, por lote e por endereço, para a mercadoria sair antes do prazo em vez de virar perda.',
      },
    ],
  },
  {
    id: 'auditoria',
    label: 'Auditoria e Confiabilidade',
    description: 'Como o InventoryBlind garante que o número contado é confiável.',
    icon: 'ShieldCheck',
    articles: [
      {
        id: 'o-que-e-auditoria',
        title: 'O que é auditoria de estoque',
        body: 'É o conjunto de mecanismos que verificam a própria contagem, não o estoque em si: quem contou, quem recontou, quem aprovou, e se uma amostra estatística confirma o resultado. No InventoryBlind isso vive em Operações → Auditoria de Estoque, com 4 ferramentas dedicadas.',
      },
      {
        id: 'simulacao-inventario',
        title: 'Simulação de Inventário',
        body: 'Planeja o inventário antes de ele começar: quantas pessoas, quanto tempo e qual cobertura são necessários para o resultado que você quer. Serve para dimensionar o esforço com números, em vez de combinar um mutirão no escuro.',
      },
      {
        id: 'auditoria-cruzada',
        title: 'Auditoria cruzada',
        body: 'Reconstrói a cadeia de cada contagem (quem contou → quem recontou → quem aprovou) e sinaliza quando a mesma pessoa aparece em mais de uma etapa — um risco de viés ou fraude. Mostra também % de recontagens, % de auditorias independentes e um índice de confiabilidade de 0 a 100.',
      },
      {
        id: 'auditoria-estatistica',
        title: 'Auditoria estatística',
        body: 'Aplica a metodologia ISO 2859-1/ANSI Z1.4 de amostragem por atributos: em vez de reconferir 100% de uma contagem importada, o sistema calcula o tamanho de amostra recomendado pelo nível de inspeção e AQL escolhidos, e diz se o lote é aceito ou rejeitado a partir dos defeitos encontrados na amostra.',
      },
      {
        id: 'analise-tendencia',
        title: 'Análise de Tendência',
        body: 'Olha as divergências ao longo do tempo em vez de uma contagem isolada: o que melhorou, o que piorou e o que volta a divergir sempre. Um erro que reaparece é um problema de processo, não um acidente de contagem.',
      },
      {
        id: 'auditorias-analytics',
        title: 'Auditorias (Analytics)',
        body: 'Em Analytics → Auditorias ficam o histórico, a performance e a reincidência das auditorias já realizadas, com resumo executivo, cobertura por sessão e detalhamento das divergências. Essa tela não executa uma auditoria nova — ela analisa as que já aconteceram.',
      },
      {
        id: 'reduzir-erros',
        title: 'Como reduzir erros humanos',
        body: 'Três controles combinados: contagem cega (elimina viés de confirmação), classificação obrigatória de causa raiz em toda divergência (RCA), e recontagem por uma pessoa diferente sempre que possível — a Auditoria Cruzada existe justamente para verificar esse último ponto.',
      },
      {
        id: 'rastreabilidade',
        title: 'Como funciona rastreabilidade',
        body: 'Toda ação relevante (contagem criada, recomendação decidida, contagem aprovada, papel de usuário alterado) é gravada num log de auditoria com quem fez, quando e o quê. RCA soma a isso o histórico de causa de cada divergência, com evidências (fotos) quando anexadas, e o Livro-Razão mostra isso item a item.',
      },
      {
        id: 'quem-contou-aprovou',
        title: 'Quem contou ≠ quem aprovou ≠ quem revisou',
        body: 'É o princípio central da Auditoria Cruzada: essas três funções deveriam, idealmente, ser exercidas por pessoas diferentes. Quando não são, o InventoryBlind não bloqueia a operação — mas destaca visualmente a sobreposição, para o gestor decidir se aquele resultado precisa de uma segunda checagem.',
      },
    ],
  },
  {
    id: 'inteligencia',
    label: 'Inteligência InventoryBlind',
    description: 'Os diferenciais que vão além de "contar e comparar".',
    icon: 'BrainCircuit',
    articles: [
      {
        id: 'blindscore',
        title: 'BlindScore',
        body: 'Índice de 0 a 100 que resume a confiabilidade dos saldos de estoque do workspace, em Analytics → BlindScore. Além da nota, a tela mostra em que você pode confiar, onde a confiança é frágil e o que fazer agora para subir o índice — a recomendação vem junto com o número.',
      },
      {
        id: 'inventory-health',
        title: 'Inventory Health',
        body: 'Diagnóstico operacional da saúde do estoque em Analytics → Inventory Health Score: onde estão os problemas, o que está saudável e o que olhar primeiro. Cobre ruptura com demanda, estoque parado e concentração por marca.',
      },
      {
        id: 'ia-insights',
        title: 'IA Insights',
        body: 'Um resumo executivo em cartões com as evidências que merecem atenção na sua operação. Em vez de um painel que você precisa interpretar, é uma lista curta do que mudou e por que isso importa.',
      },
      {
        id: 'confidence-score',
        title: 'Contagem por Confiança (CBC)',
        body: 'Em Operações → Confidence Score, cada SKU recebe uma pontuação de confiança baseada em histórico de contagens, tempo desde a última verificação e consistência dos resultados anteriores — quanto mais baixa, mais prioritário recontar aquele item no próximo ciclo.',
      },
      {
        id: 'risk-engine',
        title: 'Inventário por Risco',
        body: 'Cada posição recebe uma nota de 0 a 100 e uma faixa (baixo/médio/alto/crítico), calculada a partir de valor financeiro, giro e histórico de divergências do SKU — com o motivo específico da pontuação sempre visível, não só o número.',
      },
      {
        id: 'curva-abc',
        title: 'Curva ABC',
        body: 'Em Produtos → Curva ABC, giro, faturamento e lucro bruto são calculados a partir das planilhas de vendas, preços/custos e estoque que você importa. Traz visão executiva, gráfico de concentração, estoque sem venda, comparação com o período anterior e a política de classificação registrada.',
      },
      {
        id: 'abc-xyz',
        title: 'Classificação ABC+XYZ',
        body: 'Segmenta o estoque em duas dimensões ao mesmo tempo: impacto financeiro (ABC) e previsibilidade da demanda (XYZ). Um item A com demanda imprevisível pede uma política diferente de um item A estável — é essa diferença que a matriz torna visível.',
      },
      {
        id: 'heatmap',
        title: 'Heatmap do Estoque',
        body: 'Visualiza a saúde do estoque por área, com score de risco, para enxergar concentração de problema por região do armazém antes de montar a próxima contagem.',
      },
      {
        id: 'pontos-cegos',
        title: 'Warehouse Digital Twin',
        body: 'Mapa vivo do que está acontecendo agora no armazém, com replay da operação e cartões de insight automáticos (ex.: "Rua C concentra a maior parte das divergências"). O objetivo é apontar onde olhar antes que o problema apareça num inventário fechado.',
      },
      {
        id: 'slotting',
        title: 'Slotting Intelligence',
        body: 'Otimiza o layout do armazém a partir de distâncias reais calculadas sobre a planta que você desenha — a recomendação de onde colocar cada item nasce do percurso que a equipe efetivamente faz, não de uma regra genérica.',
      },
      {
        id: 'rca',
        title: 'Root Cause Analysis',
        body: 'Transforma divergências em causas tratáveis, ações corretivas e prevenção de recorrência, com 5 Porquês quando o mesmo problema volta dentro da janela configurada. É o módulo que impede o inventário de virar um relatório que ninguém usa.',
      },
      {
        id: 'metricas-importantes',
        title: 'Métricas importantes para acompanhar',
        body: 'As três que mais importam no dia a dia: acuracidade final (% de SKUs corretos após recontagem), % de divergências com causa raiz classificada, e % de contagens com auditoria independente — as duas últimas são sobre a confiabilidade do processo, não só do estoque.',
      },
      {
        id: 'analytics-dashboards',
        title: 'Como interpretar os painéis',
        body: 'Cada um responde uma pergunta diferente: Dashboard mostra o estado atual por linha de inventário, KPIs e Indicadores acompanham metas ao longo do tempo, Rankings compara equipes e operadores, e Analytics reúne os índices de confiabilidade e saúde do estoque.',
      },
    ],
  },
  {
    id: 'produtos',
    label: 'Catálogo e Dados de Produto',
    description: 'De onde vêm os dados que o sistema usa para comparar.',
    icon: 'Package',
    articles: [
      {
        id: 'importacao-produtos',
        title: 'Importação de produtos',
        body: 'Aceita .csv e .xlsx. O assistente de mapeamento de colunas detecta automaticamente campos como SKU, EAN, nome e localização por nome de cabeçalho, mostra uma prévia dos dados mapeados e só grava depois da sua confirmação — nenhuma linha é importada às cegas.',
      },
      {
        id: 'historico-importacoes',
        title: 'Histórico de Importações',
        body: 'Toda importação fica registrada com data, quem enviou e o que entrou. Quando um número parece errado, o histórico é o lugar de descobrir qual planilha o trouxe.',
      },
      {
        id: 'catalogo',
        title: 'Catálogo de Produtos',
        body: 'A base de produtos do workspace, com indicador de quanto dos campos essenciais está preenchido (EAN válido, marca, linha, local, preço, classificação ABC/XYZ). A localização do produto pode ser editada direto no catálogo.',
      },
      {
        id: 'fonte-saldo',
        title: 'Fonte de Saldo',
        body: 'As fontes que informam o saldo de estoque do workspace — por exemplo, a planilha diária exportada do seu ERP. O saldo da fonte serve de referência de conferência: ele não altera o cadastro de produtos, não altera o estoque, não altera as contagens e não cria movimentação.',
      },
      {
        id: 'linhas-marcas',
        title: 'Linhas e Marcas',
        body: 'Cadastre marcas e linhas do catálogo e associe produtos automaticamente pelo título. Marca e linha novas já aparecem na hora para contar e no resto do sistema, com logo da marca quando cadastrada.',
      },
      {
        id: 'sincronizacao-dados',
        title: 'Como os dados se mantêm atualizados',
        body: 'Hoje a atualização é orientada por importação: você decide quando reimportar produtos e quando atualizar a Fonte de Saldo. O saldo de referência é usado para calcular divergências nas contagens seguintes.',
      },
    ],
  },
  {
    id: 'ferramentas',
    label: 'Ferramentas do dia a dia',
    description: 'Utilitários que resolvem tarefas pontuais da operação.',
    icon: 'Wrench',
    articles: [
      {
        id: 'meu-trabalho',
        title: 'Meu Trabalho',
        body: 'Organize suas tarefas e acompanhe as da equipe num lugar só — o que está pendente para você hoje, sem precisar varrer os módulos atrás de pendência.',
      },
      {
        id: 'emitir-relatorio',
        title: 'Emitir Relatório',
        body: 'Prepara folhas de contagem para inventário físico por endereço, linha ou seleção de produtos — pronta para imprimir e levar ao estoque. Usa o saldo da Fonte de Saldo, sem pedir a planilha de novo.',
      },
      {
        id: 'etiquetas',
        title: 'Gerador de Etiquetas',
        body: 'Gera etiquetas de produto e de endereço em vários tamanhos, prontas para impressão.',
      },
      {
        id: 'codigos-barras',
        title: 'Laboratório de Códigos de Barras',
        body: 'Gera e valida códigos de barras antes de mandar imprimir — evita descobrir no chão do armazém que o leitor não reconhece a etiqueta.',
      },
      {
        id: 'central-pdfs',
        title: 'Central de PDFs',
        body: 'Unir, dividir, intercalar, converter imagens em PDF, gerar etiquetas e folhas, processar em lote e otimizar arquivos — tudo sem sair da plataforma.',
      },
      {
        id: 'paletizacao',
        title: 'Calculadora de Paletização',
        body: 'Calcula arranjo 2D, camadas, peso e número de paletes a partir das medidas da caixa. O cálculo acontece no seu navegador, sem enviar os dados para lugar nenhum.',
      },
      {
        id: 'comparador-planilhas',
        title: 'Comparador de Planilhas',
        body: 'Compara duas bases por chave, campo a campo, direto no navegador. Útil para confrontar o que o ERP diz com o que foi contado, antes de decidir qual dos dois está errado.',
      },
      {
        id: 'consulta-xml',
        title: 'Consulta e Download de XML/NFe',
        body: 'Consulta e baixa o XML de notas fiscais a partir da chave de acesso, para anexar a um recebimento ou arquivar.',
      },
      {
        id: 'full-manager',
        title: 'Full Manager',
        body: 'Gestão das operações de Full: agendamentos, nova operação, separação, conferência e histórico, com uma área de administração para quem supervisiona.',
      },
      {
        id: 'inventoryfull',
        title: 'InventoryFull',
        body: 'Aplicativo para Windows que cruza as planilhas do depósito Full do Tiny e do Mercado Livre, identifica as diferenças e entrega uma planilha atualizada para você revisar e importar em massa no Tiny — o que levava semanas de conferência passa a levar cerca de 20 minutos. O download fica em Ferramentas → InventoryFull.',
      },
    ],
  },
  {
    id: 'automacoes',
    label: 'Agentes e Automações',
    description: 'Deixar o sistema agir sozinho quando algo acontece.',
    icon: 'Workflow',
    articles: [
      {
        id: 'o-que-sao',
        title: 'O que são Agentes e Automações',
        body: 'Uma automação é uma regra que você monta: quando algo acontecer, avalie estas condições e execute estas ações. Quem compõe é você; quem executa é o servidor — a automação roda mesmo com a plataforma fechada.',
      },
      {
        id: 'como-montar',
        title: 'Como montar uma automação',
        body: 'O editor segue a frase "quando isso acontecer, avalie as condições e execute as ações". Você escolhe o gatilho, acrescenta as condições que quiser e define o que deve acontecer — sem escrever código.',
      },
      {
        id: 'execucoes',
        title: 'Histórico de execuções e teste seguro',
        body: 'Toda execução fica registrada com o que entrou, o que foi avaliado e o que foi feito. Dá para testar uma automação antes de deixá-la no ar, para ver o que ela faria sem que ela faça de verdade.',
      },
    ],
  },
  {
    id: 'integracoes',
    label: 'Integrações e Configurações Avançadas',
    description: 'Como os dados entram e saem do InventoryBlind hoje — e o que vem a seguir.',
    icon: 'Plug',
    articles: [
      {
        id: 'hub-integracoes',
        title: 'Catálogo de Integrações',
        body: 'Em Integrações você vê o catálogo de ERPs e marketplaces previstos para a plataforma, com filtro entre o que já está disponível e o que está em breve. É onde uma conexão é configurada quando o conector dela é liberado.',
      },
      {
        id: 'conectar-erp',
        title: 'Conectar um ERP hoje',
        body: 'A sincronização automática com ERP ainda está em implantação. Hoje o caminho recomendado e suportado é por planilha: Produtos → Importar Produtos para o cadastro, e Produtos → Fonte de Saldo para o estoque diário — é por aí que a maioria das operações está rodando.',
        comingSoon: true,
      },
      {
        id: 'integracoes-futuras',
        title: 'Integrações previstas: Tiny, Bling, SAP, TOTVS e marketplaces',
        body: 'Conectores diretos com esses ERPs e com Mercado Livre, Shopee, Amazon, Magalu e outros marketplaces estão no roteiro do produto. Quando liberados, o objetivo é substituir a importação manual por sincronização automática de produtos, saldo e pedidos.',
        comingSoon: true,
      },
      {
        id: 'api',
        title: 'API',
        body: 'Em Configurações Avançadas → API, owners e admins criam chaves para autenticar chamadas externas ao InventoryBlind. O valor completo da chave só aparece uma vez, na criação — guarde em local seguro.',
      },
      {
        id: 'webhooks',
        title: 'Webhooks',
        body: 'Receba uma notificação assinada no seu sistema quando eventos reais acontecerem no InventoryBlind, em vez de ficar consultando a plataforma de tempos em tempos.',
      },
      {
        id: 'logs',
        title: 'Logs',
        body: 'Histórico de ações realizadas na empresa — quem fez o quê, quando e com qual resultado.',
      },
      {
        id: 'empresas-fiscais',
        title: 'Empresas e Dados Fiscais',
        body: 'As empresas (CNPJs) que operam neste workspace. São usadas para validar notas fiscais e para conectar as integrações de ERP à empresa correta.',
      },
      {
        id: 'workspaces',
        title: 'Workspaces',
        body: 'Nome, ícone e descrição deste workspace, além da lista de workspaces em que você opera. Quem atende mais de uma empresa troca entre elas sem sair do sistema.',
      },
    ],
  },
  {
    id: 'conta-suporte',
    label: 'Conta, Suporte e Administração',
    description: 'Ajuda, permissões, segurança e seus dados.',
    icon: 'UserCog',
    articles: [
      {
        id: 'suporte',
        title: 'Abrir um chamado',
        body: 'Em Minha Conta → Suporte você pede ajuda sem sair do sistema. O chamado fica registrado no seu acesso, com todo o histórico da conversa — nada se perde num e-mail ou num grupo de mensagem.',
      },
      {
        id: 'notificacoes-chamado',
        title: 'Acompanhar o chamado pelo sino',
        body: 'O sino no topo avisa quando o seu chamado se mexe: resposta da equipe, mudança de status ou encerramento. Não é preciso voltar à tela de suporte para saber se alguém respondeu.',
      },
      {
        id: 'papeis',
        title: 'Papéis de acesso',
        body: 'Cada usuário tem um papel: owner, admin, manager, lead ou operador. O papel determina o que a pessoa vê e o que pode alterar — operadores veem o que contaram, leads e managers veem a equipe, owners e admins têm acesso completo.',
      },
      {
        id: 'seguranca',
        title: 'Segurança',
        body: 'A área de Segurança reúne o registro das ações sensíveis da empresa: mudança de papel, aprovação de contagem, alteração de configuração. Disponível para quem tem permissão de visualizar segurança.',
      },
      {
        id: 'chamados-recebidos',
        title: 'Chamados recebidos',
        body: 'Para quem administra ou atende: a caixa de entrada com os chamados abertos pelos usuários do workspace, com o histórico completo de cada conversa.',
      },
      {
        id: 'privacidade-legal',
        title: 'Privacidade e Legal',
        body: 'Os documentos em vigor, o registro do seu aceite e como exercer seus direitos sobre dados pessoais.',
      },
      {
        id: 'academy',
        title: 'I.B Academy',
        body: 'A plataforma de capacitação dentro do próprio sistema: o Método I.B.® em 7 Pilares, trilhas com certificado, quiz e acompanhamento de evolução — individual e de equipe.',
      },
      {
        id: 'biblioteca',
        title: 'Biblioteca da I.B Academy',
        body: 'Materiais práticos para apoiar a operação e o seu desenvolvimento, incluindo dezenas de e-books gratuitos, com os créditos da obra e a fonte original sempre indicados, e filtros para achar o que interessa.',
      },
      {
        id: 'novidades',
        title: 'O que há de novo',
        body: 'O painel de novidades no topo da tela lista, em ordem, tudo o que foi lançado, melhorado ou corrigido na plataforma — é onde conferir se aquele detalhe que te incomodava já foi resolvido.',
      },
    ],
  },
];

export const PRODUCT_FAQ: KnowledgeEntry[] = [
  { title: 'O que é uma contagem cega?', body: 'É quando o operador registra a quantidade contada sem ver o saldo que o sistema espera encontrar, eliminando o viés de confirmar mentalmente um número já esperado. O mesmo princípio vale na conferência de recebimento por NF-e.' },
  { title: 'Por que o operador não vê o estoque esperado?', body: 'Justamente para que a contagem reflita a realidade física, não a expectativa do sistema — ver o saldo esperado antes de contar é a principal causa de divergências "maquiadas" em inventários tradicionais.' },
  { title: 'Como funciona uma divergência?', body: 'Divergência é a diferença entre o saldo contado e o saldo de referência. Toda divergência precisa ser classificada por uma causa raiz (recebimento, avaria, furto/perda etc.) — sem causa registrada, ela fica pendente de classificação.' },
  { title: 'Por onde eu começo?', body: 'Por Minha Conta → Diagnóstico da operação: um questionário curto sobre o seu estoque devolve um plano com os módulos a ativar primeiro e em que ordem.' },
  { title: 'Quem pode visualizar resultados?', body: 'Depende do papel de cada usuário. Operadores veem o que contaram; leads e managers veem a produtividade da equipe; owners e admins têm acesso completo a auditoria, usuários e configurações da empresa.' },
  { title: 'Como funciona a aprovação de uma contagem?', body: 'Na Auditoria Cruzada, owners, admins ou managers podem aprovar uma contagem já concluída, registrando quem aprovou e quando — essa etapa é opcional, mas soma pontos ao índice de confiabilidade da empresa.' },
  { title: 'Posso criar múltiplos usuários?', body: 'Sim. Owners e admins convidam quantos usuários forem necessários em Administração → Usuários, cada um com um papel de acesso definido.' },
  { title: 'Como funciona o BlindScore?', body: 'É um índice de 0 a 100 que resume a confiabilidade dos saldos de estoque do workspace, em Analytics → BlindScore. Junto com a nota, a tela mostra em que você pode confiar, onde a confiança é frágil e o que fazer para subir o índice.' },
  { title: 'O sistema já integra com o meu ERP?', body: 'A sincronização automática ainda está em implantação. Hoje o caminho suportado é por planilha: Importar Produtos para o cadastro e Fonte de Saldo para o estoque diário. O catálogo de integrações mostra o que já está disponível e o que está em breve.' },
  { title: 'Preciso contar o estoque inteiro de uma vez?', body: 'Não. O Programa de Ciclagem define com que frequência cada classe da curva ABC é recontada e monta a lista do dia, e a Cobertura de Contagem mostra o que já foi contado e o que ficou para trás.' },
  { title: 'Dá para usar no celular?', body: 'Sim. A plataforma funciona no navegador do celular e pode ser instalada como aplicativo pelo menu do usuário — é o formato recomendado para quem conta em campo e para ler QR Code de endereço no Pulmão.' },
  { title: 'Como peço ajuda?', body: 'Em Minha Conta → Suporte, sem sair do sistema. O chamado fica registrado no seu acesso com todo o histórico, e o sino no topo avisa quando há resposta.' },
  { title: 'Meus dados estão seguros?', body: 'Cada empresa só acessa os próprios dados — o isolamento é garantido no banco de dados, não apenas na interface. Toda ação sensível (mudança de papel, aprovação de contagem, alteração de configuração) fica registrada em log de auditoria.' },
];

export const ABOUT_CONTENT = {
  title: 'Sobre o InventoryBlind',
  closingMessage: 'O InventoryBlind transforma inventários físicos em inteligência operacional confiável.',
  sections: [
    {
      heading: 'Nossa visão',
      body: 'Acreditamos que um inventário não deveria ser um evento estressante que acontece uma vez por trimestre — deveria ser um processo contínuo e confiável, com dados bons o suficiente para basear decisões de compra, reposição e auditoria a qualquer momento.',
    },
    {
      heading: 'O problema que resolvemos',
      body: 'A maioria das divergências de estoque não nasce na contagem — nasce em pontos cegos anteriores: desorganização física, endereçamento ambíguo, falta de padronização e contagens feitas por quem já "sabe" o número esperado. Resolver isso exige mais do que uma planilha de contagem.',
    },
    {
      heading: 'Do recebimento ao fechamento',
      body: 'A plataforma acompanha o ciclo inteiro: a conferência cega do que entra, o endereçamento no Pulmão, a contagem cíclica do que já está guardado, a classificação da causa de cada divergência e o fechamento por linha — cada etapa alimentando os indicadores da seguinte.',
    },
    {
      heading: 'Tecnologia utilizada',
      body: 'Plataforma web multiempresa, com controle de acesso por papel, trilha de auditoria em toda ação sensível e módulos de inteligência (confiança, risco, classificação ABC/XYZ, causa raiz) construídos sobre os mesmos dados operacionais que você já registra no dia a dia.',
    },
    {
      heading: 'Metodologia de inventário inteligente',
      body: 'O Método I.B.® organiza a confiabilidade de um inventário em 7 Pilares — Organização, Endereçamento, Padronização, Preparação, Inventário Cego, Validação e Inteligência — ensinados na I.B Academy, dentro da própria plataforma.',
    },
    {
      heading: 'Por que inventários tradicionais têm pontos cegos',
      body: 'Contar com o saldo esperado visível cria viés de confirmação; contar sem preparação prévia mistura problemas de organização com problemas reais de estoque; e auditar sem separar quem contou de quem aprovou remove a única checagem independente que existiria.',
    },
  ],
};
