// Regras do suporte que não dependem de rede nem de React — rótulos, quem pode
// o quê, o que precisa de atenção e como o contexto do chamado é montado.
//
// A permissão de verdade mora no banco (migration 119): toda regra aqui é
// espelho, para a tela não oferecer um botão que o banco vai recusar. Espelho
// que mente é pior que espelho nenhum, então estas funções têm teste próprio.

export type SupportChannel = 'produto' | 'interno';
export type SupportStatus = 'aberto' | 'em_analise' | 'respondido' | 'resolvido';
export type SupportCategory = 'erro' | 'duvida' | 'sugestao' | 'acesso' | 'outro';
export type SupportPriority = 'baixa' | 'normal' | 'alta';

export const CHANNEL_LABEL: Record<SupportChannel, string> = {
  produto: 'Ao InventoryBlind',
  interno: 'Para a minha empresa',
};

export const CHANNEL_HINT: Record<SupportChannel, string> = {
  produto: 'Algo do sistema: erro, dúvida de funcionamento ou sugestão. Vai para a equipe do InventoryBlind.',
  interno: 'Algo da operação daqui: acesso, processo ou dúvida do dia a dia. Vai para a gestão da sua empresa.',
};

export const STATUS_LABEL: Record<SupportStatus, string> = {
  aberto: 'Aberto',
  em_analise: 'Em análise',
  respondido: 'Respondido',
  resolvido: 'Resolvido',
};

/** Tom do Badge por estado. Mora junto de STATUS_LABEL porque é a mesma
 *  decisão — como esse estado se apresenta — e separá-los faria as duas listas
 *  divergirem na primeira vez que um estado novo aparecesse. */
export const STATUS_VARIANT: Record<SupportStatus, 'neutral' | 'accent' | 'warning' | 'success'> = {
  aberto: 'warning',
  em_analise: 'accent',
  respondido: 'accent',
  resolvido: 'success',
};

export const CATEGORY_LABEL: Record<SupportCategory, string> = {
  erro: 'Algo não funciona',
  duvida: 'Dúvida',
  sugestao: 'Sugestão',
  acesso: 'Acesso e permissão',
  outro: 'Outro assunto',
};

export const PRIORITY_LABEL: Record<SupportPriority, string> = {
  baixa: 'Baixa',
  normal: 'Normal',
  alta: 'Alta',
};

export const CATEGORIES: SupportCategory[] = ['erro', 'duvida', 'sugestao', 'acesso', 'outro'];
export const PRIORITIES: SupportPriority[] = ['baixa', 'normal', 'alta'];

export const SUBJECT_MIN = 3;
export const SUBJECT_MAX = 160;
export const BODY_MAX = 5000;
export const MAX_ATTACHMENTS = 3;
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Espelho de support_ticket_open: conferente não abre chamado ao InventoryBlind.
 *  Sem isso a caixa do produto vira help desk de primeiro nível dos clientes,
 *  por cima do gestor deles. */
export function canOpenProductTicket(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** Canais que este papel pode escolher no formulário. Todo mundo abre interno. */
export function channelsFor(role: string | null | undefined): SupportChannel[] {
  return canOpenProductTicket(role) ? ['produto', 'interno'] : ['interno'];
}

export interface TicketLike {
  id: string;
  status: SupportStatus;
  updatedAt: string;
  createdAt: string;
  priority: SupportPriority;
}

export const OPEN_STATUSES: SupportStatus[] = ['aberto', 'em_analise', 'respondido'];

export function isOpen(status: SupportStatus): boolean {
  return status !== 'resolvido';
}

/** Para quem responde, a bola está com ele enquanto ninguém respondeu.
 *  Para quem abriu, a bola está com ele depois da resposta. O mesmo chamado
 *  "pede atenção" de um lado e não do outro — por isso a visão entra aqui. */
export function needsAttention(status: SupportStatus, viewing: 'author' | 'answerer'): boolean {
  return viewing === 'answerer'
    ? status === 'aberto' || status === 'em_analise'
    : status === 'respondido';
}

export function countNeedingAttention(
  tickets: Pick<TicketLike, 'status'>[],
  viewing: 'author' | 'answerer',
): number {
  return tickets.filter(t => needsAttention(t.status, viewing)).length;
}

const STATUS_WEIGHT: Record<SupportStatus, number> = {
  aberto: 0,
  em_analise: 1,
  respondido: 2,
  resolvido: 3,
};

const PRIORITY_WEIGHT: Record<SupportPriority, number> = { alta: 0, normal: 1, baixa: 2 };

/** Fila de quem responde: o que ninguém tocou primeiro, prioridade alta na
 *  frente, e dentro disso o mais antigo — chamado velho afundando no fim da
 *  lista é como ele é esquecido. Resolvido vai para o fim, sempre. */
export function sortForInbox<T extends TicketLike>(tickets: T[]): T[] {
  return [...tickets].sort((a, b) => {
    const byStatus = STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status];
    if (byStatus !== 0) return byStatus;
    if (isOpen(a.status)) {
      const byPriority = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      if (byPriority !== 0) return byPriority;
      return a.createdAt.localeCompare(b.createdAt);
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

/** Lista de quem abriu: o movimento mais recente no topo, sem reordenar por
 *  prioridade — a prioridade é um pedido feito ao outro lado, não um critério
 *  de leitura do próprio histórico. */
export function sortForMine<T extends TicketLike>(tickets: T[]): T[] {
  return [...tickets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function validateSubject(subject: string): string | null {
  const trimmed = subject.trim();
  if (trimmed.length < SUBJECT_MIN) return 'Descreva o assunto em pelo menos 3 letras.';
  if (trimmed.length > SUBJECT_MAX) return `O assunto passa de ${SUBJECT_MAX} caracteres.`;
  return null;
}

export function validateBody(body: string): string | null {
  if (!body.trim()) return 'Conte o que aconteceu.';
  if (body.length > BODY_MAX) return 'A mensagem é longa demais. Resuma ou mande em partes.';
  return null;
}

export function rejectionForFile(file: { type: string; size: number }): string | null {
  if (!ATTACHMENT_TYPES.includes(file.type)) return 'Só imagem (PNG, JPG ou WEBP).';
  if (file.size > ATTACHMENT_MAX_BYTES) return 'Imagem acima de 10 MB.';
  return null;
}

/** Quem fechou importa: "resolvido" sem dono é um número que ninguém confere.
 *  `null` quando o chamado continua aberto. */
export function resolutionLabel(
  ticket: { status: SupportStatus; resolvedBy: string | null },
  viewerId: string,
  authorId: string,
): string | null {
  if (ticket.status !== 'resolvido') return null;
  if (ticket.resolvedBy === viewerId) return 'Resolvido por você';
  if (ticket.resolvedBy === authorId) return 'Confirmado por quem abriu';
  return 'Encerrado por quem respondeu';
}

export interface TicketContext {
  tela: string;
  papel: string;
  empresa: string;
  navegador: string;
  janela: string;
}

/** O contexto é o que separa um chamado de uma mensagem solta: sem ele, a
 *  primeira resposta é sempre "em que tela foi?". Tudo aqui já é conhecido pelo
 *  sistema — nada a mais é coletado, e nada disso é segredo do usuário. */
export function buildContext(input: {
  tela: string | null;
  papel: string | null;
  empresa: string | null;
  navegador: string;
  largura: number;
  altura: number;
}): TicketContext {
  return {
    tela: input.tela || 'não identificada',
    papel: input.papel || 'não informado',
    empresa: input.empresa || 'não informada',
    navegador: input.navegador.slice(0, 300),
    janela: `${Math.round(input.largura)}x${Math.round(input.altura)}`,
  };
}

export const CONTEXT_LABEL: Record<keyof TicketContext, string> = {
  tela: 'Tela de origem',
  papel: 'Papel',
  empresa: 'Empresa',
  navegador: 'Navegador',
  janela: 'Janela',
};

/** Caminho do anexo no bucket. O prefixo da empresa não é organização: é a
 *  condição que a policy de upload confere, e o RPC confere de novo. */
export function attachmentPath(companyId: string, fileName: string, nowMs: number, index: number): string {
  // `split('.').pop()` num nome sem ponto devolve o nome inteiro — "print"
  // viraria a extensão. O índice do último ponto é o que separa de verdade.
  const dot = fileName.lastIndexOf('.');
  const raw = dot > 0 ? fileName.slice(dot + 1) : '';
  const ext = raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'png';
  return `${companyId}/${nowMs}-${index}.${ext}`;
}
