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
