// Endereçamento do recebimento — as regras, sem nenhum acesso a dados.
//
// A conferência diz O QUE chegou; o Pulmão sabe guardar. Este módulo é o que falta
// entre os dois: por item da nota, quanto já foi para endereço e quanto ainda falta.
//
// ── A unidade muda no meio do caminho ───────────────────────────────────────
// A conferência conta em UNIDADES (`physical_quantity`); o endereço guarda CAIXAS
// (`boxes` × `units_per_box`). Essa troca é a fonte de erro do fluxo, e é por isso que
// todo cálculo aqui converte para unidades antes de comparar. Item que não fecha em
// caixa inteira é guardado com pack 1 — solto é um pack de um, não um caso especial.
//
// ── Endereçar parcialmente é o normal ───────────────────────────────────────
// Um item de 120 unidades pode ir para três endereços. Por isso o progresso é uma
// SOMA, nunca um sim/não, e a tela mostra o que falta em vez de marcar "feito".

import type { NfeInvoiceItem } from './nfeTypes';

export interface PutawayAssignment {
  id: string;
  itemId: string;
  binCode: string;
  boxes: number;
  unitsPerBox: number;
  /** `boxes × unitsPerBox`, calculado no banco. */
  units: number;
  createdAt: string;
  /** Preenchidos só quando a empresa ligou a chave de lote/validade (migration 125).
   *  `null` é o estado normal de quem não usa, não uma ausência a corrigir. */
  lotNumber: string | null;
  expiryDate: string | null;
}

/** Situação de um item da nota diante do endereçamento. */
export type PutawayStatus =
  /** Nada endereçado ainda. */
  | 'pendente'
  /** Parte foi para endereço, parte não. */
  | 'parcial'
  /** Tudo o que foi conferido já está endereçado. */
  | 'completo'
  /** Não dá para endereçar: item sem produto do catálogo, ou nada conferido. */
  | 'bloqueado';

export const PUTAWAY_STATUS_LABEL: Record<PutawayStatus, string> = {
  pendente: 'A endereçar',
  parcial: 'Parcial',
  completo: 'Endereçado',
  bloqueado: 'Não endereçável',
};

export interface PutawayLine {
  item: NfeInvoiceItem;
  /** Unidades conferidas. É esta a quantidade que pode ser endereçada — nunca a
   *  esperada pela nota, que pode nem ter chegado. */
  conferred: number;
  /** Unidades já endereçadas, somando todos os endereços. */
  placed: number;
  remaining: number;
  status: PutawayStatus;
  /** Por que não dá para endereçar. `null` quando dá. */
  blockedReason: string | null;
  assignments: PutawayAssignment[];
}

function statusOf(conferred: number, placed: number, bloqueio: string | null): PutawayStatus {
  if (bloqueio) return 'bloqueado';
  if (placed <= 0) return 'pendente';
  if (placed >= conferred) return 'completo';
  return 'parcial';
}

/** Monta uma linha por item da nota, com o que já foi endereçado.
 *
 *  Itens conferidos com zero continuam na lista, marcados como não endereçáveis, em
 *  vez de sumirem: quem recebeu precisa ver que aquela linha da nota foi conferida e
 *  não veio nada — omiti-la faria a nota parecer menor do que é. */
export function buildLines(
  items: NfeInvoiceItem[],
  assignments: PutawayAssignment[]
): PutawayLine[] {
  const porItem = new Map<string, PutawayAssignment[]>();
  for (const a of assignments) {
    const lista = porItem.get(a.itemId);
    if (lista) lista.push(a);
    else porItem.set(a.itemId, [a]);
  }

  return items.map(item => {
    const conferred = item.physical_quantity ?? 0;
    const minhas = (porItem.get(item.id) ?? [])
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const placed = minhas.reduce((soma, a) => soma + a.units, 0);

    const blockedReason =
      item.product_id === null
        ? 'Este item não está vinculado a um produto do catálogo.'
        : conferred <= 0
          ? 'Nada foi conferido nesta linha.'
          : null;

    return {
      item,
      conferred,
      placed,
      remaining: Math.max(0, conferred - placed),
      status: statusOf(conferred, placed, blockedReason),
      blockedReason,
      assignments: minhas,
    };
  });
}

export interface PutawaySummary {
  total: number;
  completos: number;
  parciais: number;
  pendentes: number;
  bloqueados: number;
  /** Unidades que ainda podem ir para endereço. Exclui itens bloqueados: as unidades
   *  de uma linha sem produto vinculado não são trabalho pendente, são trabalho
   *  impossível — contá-las faria o resumo dizer "tudo endereçado" e "100 unidades
   *  restantes" na mesma tela. O que está bloqueado é contado em `bloqueados`. */
  unidadesRestantes: number;
  /** Nada pendente nem parcial entre os itens endereçáveis. */
  concluido: boolean;
}

export function summarizePutaway(lines: PutawayLine[]): PutawaySummary {
  const conta = (s: PutawayStatus) => lines.filter(l => l.status === s).length;
  const pendentes = conta('pendente');
  const parciais = conta('parcial');

  return {
    total: lines.length,
    completos: conta('completo'),
    parciais,
    pendentes,
    bloqueados: conta('bloqueado'),
    unidadesRestantes: lines
      .filter(l => l.status !== 'bloqueado')
      .reduce((soma, l) => soma + l.remaining, 0),
    // Itens bloqueados não impedem a conclusão: não há o que endereçar neles, e
    // exigir o impossível deixaria todo recebimento eternamente "em aberto".
    concluido: pendentes === 0 && parciais === 0,
  };
}

/** Confere uma colocação ANTES de chamar o banco.
 *
 *  A RPC valida de novo — esta é a guarda de tela, para o operador receber a conta
 *  errada como uma frase e não como uma exceção do Postgres. Devolve a mensagem do
 *  problema, ou `null` quando está tudo certo. */
export function validatePlacement(
  line: PutawayLine,
  boxes: number,
  unitsPerBox: number
): string | null {
  if (line.blockedReason) return line.blockedReason;
  if (!Number.isFinite(boxes) || boxes <= 0) return 'Informe quantas caixas.';
  if (!Number.isFinite(unitsPerBox) || unitsPerBox <= 0) return 'Informe quantas unidades por caixa.';
  if (!Number.isInteger(boxes) || !Number.isInteger(unitsPerBox)) {
    return 'Caixas e unidades por caixa são números inteiros.';
  }

  const unidades = boxes * unitsPerBox;
  if (unidades > line.remaining) {
    return `Isso são ${unidades} unidades e faltam apenas ${line.remaining} para endereçar.`;
  }
  return null;
}

/** Sugere o pack para a próxima colocação.
 *
 *  Na ordem: o pack que já foi usado neste mesmo item (o operador está dividindo a
 *  mesma mercadoria em vários endereços), depois o último pack conhecido do produto no
 *  Pulmão, e por fim 1 — solto. Nunca inventa uma divisão "redonda" a partir da
 *  quantidade: 120 unidades não significam 10 caixas de 12. */
export function suggestPack(line: PutawayLine, lastKnown: number | null): number {
  const doProprioItem = line.assignments[0]?.unitsPerBox;
  if (doProprioItem && doProprioItem > 0) return doProprioItem;
  if (lastKnown && lastKnown > 0) return lastKnown;
  return 1;
}

/** Quantas caixas inteiras cabem no que falta, com o pack escolhido. Zero quando o
 *  resto é menor que uma caixa — e aí o operador baixa o pack ou guarda solto. */
export function boxesThatFit(line: PutawayLine, unitsPerBox: number): number {
  if (!Number.isFinite(unitsPerBox) || unitsPerBox <= 0) return 0;
  return Math.floor(line.remaining / unitsPerBox);
}
