// Alocação automática entre itens de OC e itens de NF-e — puro. Nunca altera a
// quantidade original de purchase_order_items nem de nfe_invoice_items: só produz
// uma lista de alocações a inserir (o ajuste manual acontece por cima, editando ou
// removendo essas linhas, nunca os documentos de origem).

import type { PoMatchResult } from './poProductMatcher';

export interface AllocationDemand {
  poItemId: string;
  /** quantidade da OC ainda não atendida por nenhuma alocação (de nenhum vínculo). */
  remainingQuantity: number;
}

export interface AllocationCapacity {
  nfeItemId: string;
  /** capacidade restante do item de NF-e, já descontando alocações de QUALQUER OC (não só do vínculo atual) — um item de NF-e pode ser repartido entre OCs diferentes. */
  remainingQuantity: number;
}

export interface ProposedAllocation {
  poItemId: string;
  nfeItemId: string;
  quantity: number;
  matchMethod: PoMatchResult['candidates'][number]['method'];
}

/**
 * Para cada item de OC com correspondência inequívoca (não ambígua, com candidatos),
 * distribui automaticamente até a quantidade ainda não atendida da OC, respeitando a
 * capacidade restante de cada item de NF-e candidato. Ordem determinística
 * (nfeItemId crescente) para o resultado ser sempre o mesmo com a mesma entrada.
 * Excedente/insuficiência ficam visíveis nos totais que sobram em `demand`/`capacity`
 * (o chamador recalcula e mostra) — esta função nunca força um encaixe artificial.
 */
export function proposeAutoAllocations(
  matches: PoMatchResult[],
  demandByPoItem: Map<string, number>,
  capacityByNfeItem: Map<string, number>
): ProposedAllocation[] {
  const proposals: ProposedAllocation[] = [];
  // Cópias locais — nunca mutamos os Maps do chamador.
  const remainingDemand = new Map(demandByPoItem);
  const remainingCapacity = new Map(capacityByNfeItem);

  for (const match of matches) {
    if (match.ambiguous || match.candidates.length === 0) continue;

    let demand = remainingDemand.get(match.poItemId) ?? 0;
    if (demand <= 0) continue;

    const orderedCandidates = [...match.candidates].sort((a, b) => a.nfeItemId.localeCompare(b.nfeItemId));

    for (const candidate of orderedCandidates) {
      if (demand <= 0) break;
      const capacity = remainingCapacity.get(candidate.nfeItemId) ?? 0;
      if (capacity <= 0) continue;

      const quantity = Math.min(demand, capacity);
      if (quantity <= 0) continue;

      proposals.push({ poItemId: match.poItemId, nfeItemId: candidate.nfeItemId, quantity, matchMethod: candidate.method });
      demand -= quantity;
      remainingCapacity.set(candidate.nfeItemId, capacity - quantity);
    }

    remainingDemand.set(match.poItemId, demand);
  }

  return proposals;
}

/** Soma de alocações existentes para um item de NF-e, para calcular sua capacidade restante. */
export function sumAllocatedForNfeItem(allocations: { nfeItemId: string; allocatedQuantity: number }[], nfeItemId: string): number {
  return allocations.filter(a => a.nfeItemId === nfeItemId).reduce((sum, a) => sum + a.allocatedQuantity, 0);
}

/** Soma de alocações existentes para um item de OC, para calcular sua demanda restante. */
export function sumAllocatedForPoItem(allocations: { poItemId: string; allocatedQuantity: number }[], poItemId: string): number {
  return allocations.filter(a => a.poItemId === poItemId).reduce((sum, a) => sum + a.allocatedQuantity, 0);
}

/** true quando somar `additionalQuantity` a `nfeItemId` excederia a quantidade do item de NF-e —
 *  a tela deve avisar explicitamente e pedir correção, nunca gravar silenciosamente. */
export function wouldExceedNfeItemQuantity(
  existingAllocations: { nfeItemId: string; allocatedQuantity: number }[],
  nfeItemId: string,
  nfeItemQuantity: number,
  additionalQuantity: number
): boolean {
  const already = sumAllocatedForNfeItem(existingAllocations, nfeItemId);
  return already + additionalQuantity > nfeItemQuantity;
}
