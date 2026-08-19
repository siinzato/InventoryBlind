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
