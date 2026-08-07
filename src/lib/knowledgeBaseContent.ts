// Central de Conhecimento (Minha Conta → Recursos e Conhecimento) — conteúdo estático de
// produto, no mesmo espírito de academyContent.ts (fixo, igual para todos os tenants, sem
// tabela — não é dado operacional). Reaproveita o tipo KnowledgeEntry e os arrays
// KNOWLEDGE_* já existentes em academyContent.ts para FAQ/glossário do Método I.B.® em vez
// de duplicar esse conteúdo; aqui entram apenas os tópicos de PRODUTO (fora do escopo da
// I.B Academy) que ainda não tinham um lugar: primeiros passos, gestão de contagem,
// auditoria de estoque, inteligência da plataforma e integrações.
//
// `icon` é uma chave de string (não o componente) para não importar React/lucide aqui —
// resolvida num pequeno mapa dentro de KnowledgeCenterPage.tsx, mesmo padrão de PILARES em
// academyContent.ts.

import type { KnowledgeEntry } from './academyContent';

export interface KbArticle {
  id: string;
  title: string;
  body: string;
  /** Recurso ainda não lançado (ex.: BlindScore, Inventory Health Score, conectores de ERP)
   *  — mostra um selo "Em breve" em vez de descrever um cálculo que ainda não existe. */
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
    ],
  },
  {
    id: 'gestao-inventario',
    label: 'Gestão de Inventário',
    description: 'Do início da contagem até a finalização e a análise de produtividade.',
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
        id: 'finalizacao',
        title: 'Finalização do inventário',
        body: 'Uma linha de inventário se considera fechada quando a acuracidade final está estável e as divergências reais foram todas classificadas. Não existe um botão único de "encerrar" — o fechamento é o resultado de contagem, recontagem e classificação completas.',
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
        body: 'É o conjunto de mecanismos que verificam a própria contagem, não o estoque em si: quem contou, quem recontou, quem aprovou, e se uma amostra estatística confirma o resultado. No InventoryBlind isso vive na seção Auditoria de Estoque, com 4 ferramentas dedicadas.',
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
        id: 'reduzir-erros',
        title: 'Como reduzir erros humanos',
        body: 'Três controles combinados: contagem cega (elimina viés de confirmação), classificação obrigatória de causa raiz em toda divergência (RCA), e recontagem por uma pessoa diferente sempre que possível — a Auditoria Cruzada existe justamente para verificar esse último ponto.',
      },
      {
        id: 'rastreabilidade',
        title: 'Como funciona rastreabilidade',
        body: 'Toda ação relevante (contagem criada, recomendação decidida, contagem aprovada, papel de usuário alterado) é gravada num log de auditoria com quem fez, quando e o quê. RCA soma a isso o histórico de causa de cada divergência, com evidências (fotos) quando anexadas.',
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
        title: 'BlindScore — o que é?',
        body: 'Pontuação de acuracidade e risco atribuída a cada operação de inventário, combinando o quanto uma contagem pode ser confiada (Confidence Score) com o quão crítico é o item contado (Risk Score). Hoje esses dois sinais já existem e funcionam de forma independente — um painel unificado de BlindScore está em desenvolvimento.',
        comingSoon: true,
      },
      {
        id: 'confidence-score',
        title: 'Confidence Score (CBC) — como é calculado hoje',
        body: 'Em Operações → Confidence Score, cada SKU recebe uma pontuação de confiança baseada em histórico de contagens, tempo desde a última verificação e consistência dos resultados anteriores — quanto mais baixa, mais prioritário recontar aquele item no próximo ciclo.',
      },
      {
        id: 'risk-engine',
        title: 'Risk Engine — como funciona',
        body: 'Em Operações → Inventário por Risco, cada posição recebe uma nota de 0 a 100 e uma faixa (baixo/médio/alto/crítico), calculada a partir de valor financeiro, giro e histórico de divergências do SKU — com o motivo específico da pontuação sempre visível, não só o número.',
      },
      {
        id: 'pontos-cegos',
        title: 'Identificação de pontos cegos',
        body: 'O Warehouse Digital Twin cruza risco, divergência e tráfego por corredor num único mapa e gera cartões de insight automáticos (ex.: "Rua C concentra a maior parte das divergências") — o objetivo é apontar onde olhar antes que o problema apareça num inventário fechado.',
      },
      {
        id: 'inventory-health-score',
        title: 'Inventory Health Score',
        body: 'Um indicador único de saúde geral do estoque, combinando acuracidade, cobertura de auditoria e risco médio da carteira de SKUs, está no roteiro da plataforma — hoje esses componentes já são visíveis separadamente em Confidence Score, Inventário por Risco e Auditoria de Estoque.',
        comingSoon: true,
      },
      {
        id: 'analytics-dashboards',
        title: 'Como interpretar os dashboards de Analytics',
        body: 'Dashboard, KPIs e Indicadores e Rankings respondem perguntas diferentes: Dashboard mostra o estado atual por linha de inventário, KPIs acompanha metas ao longo do tempo, e Rankings compara acuracidade e produtividade entre equipes e operadores.',
      },
      {
        id: 'metricas-importantes',
        title: 'Métricas importantes para acompanhar',
        body: 'As três que mais importam no dia a dia: acuracidade final (% de SKUs corretos após recontagem), % de divergências com causa raiz classificada, e % de contagens com auditoria independente — as duas últimas são sobre a confiabilidade do processo, não só do estoque.',
      },
    ],
  },
  {
    id: 'integracoes',
    label: 'Integrações',
    description: 'Como os dados entram e saem do InventoryBlind hoje — e o que vem a seguir.',
    icon: 'Plug',
    articles: [
      {
        id: 'conectar-erp',
        title: 'Como conectar um ERP',
        body: 'Conectores nativos de ERP ainda não estão disponíveis — hoje a entrada de dados é por importação de planilha (Produtos e Nova Contagem). É o caminho recomendado enquanto os conectores abaixo não são lançados.',
        comingSoon: true,
      },
      {
        id: 'importacao-produtos',
        title: 'Importação de produtos',
        body: 'Aceita .csv e .xlsx. O assistente de mapeamento de colunas detecta automaticamente campos como SKU, EAN, nome e localização por nome de cabeçalho, mostra uma prévia dos dados mapeados e só grava depois da sua confirmação — nenhuma linha é importada às cegas.',
      },
      {
        id: 'sincronizacao-dados',
        title: 'Sincronização de dados',
        body: 'Hoje a sincronização é orientada por importação manual (você decide quando reimportar). Um saldo de sistema (stock_quantity) é atualizado a cada importação e usado como referência para calcular divergências nas contagens seguintes.',
      },
      {
        id: 'integracoes-futuras',
        title: 'Integrações futuras: Tiny, Bling, SAP, TOTVS',
        body: 'Conectores diretos com esses ERPs estão no roteiro do produto (o item "Tiny ERP" já aparece no menu, marcado como "Em breve"). Quando lançados, o objetivo é substituir a importação manual por sincronização automática de produtos e saldo.',
        comingSoon: true,
      },
    ],
  },
];

export const PRODUCT_FAQ: KnowledgeEntry[] = [
  { title: 'O que é uma contagem cega?', body: 'É quando o operador registra a quantidade contada sem ver o saldo que o sistema espera encontrar, eliminando o viés de confirmar mentalmente um número já esperado.' },
  { title: 'Por que o operador não vê o estoque esperado?', body: 'Justamente para que a contagem reflita a realidade física, não a expectativa do sistema — ver o saldo esperado antes de contar é a principal causa de divergências "maquiadas" em inventários tradicionais.' },
  { title: 'Como funciona uma divergência?', body: 'Divergência é a diferença entre o saldo contado e o saldo de sistema. Toda divergência precisa ser classificada por uma causa raiz (recebimento, avaria, furto/perda etc.) — sem causa registrada, ela fica pendente de classificação.' },
  { title: 'Quem pode visualizar resultados?', body: 'Depende do papel de cada usuário. Operadores veem o que contaram; leads e managers veem a produtividade da equipe; owners e admins têm acesso completo a auditoria, usuários e configurações da empresa.' },
  { title: 'Como funciona a aprovação de uma contagem?', body: 'Na Auditoria Cruzada, owners, admins ou managers podem aprovar uma contagem já concluída, registrando quem aprovou e quando — essa etapa é opcional, mas soma pontos ao índice de confiabilidade da empresa.' },
  { title: 'Posso criar múltiplos usuários?', body: 'Sim. Owners e admins convidam quantos usuários forem necessários em Administração → Usuários, cada um com um papel de acesso definido.' },
  { title: 'Como funciona o BlindScore?', body: 'É a pontuação de acuracidade e risco de uma operação de inventário. Os dois sinais que o compõem (confiança e risco) já existem hoje como Confidence Score e Inventário por Risco; o painel unificado de BlindScore está em desenvolvimento.' },
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
