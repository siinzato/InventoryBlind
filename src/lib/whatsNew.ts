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
