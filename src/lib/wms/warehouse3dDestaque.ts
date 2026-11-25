// Qual é o estado de destaque de uma vaga: dentro do filtro, achada pela busca, recém
// mexida por outro operador.
//
// Existe por um motivo concreto: a regra vivia escrita DENTRO do `useMemo` que monta a
// vista por código, e por isso a vista da planta — que é a padrão da tela — não tinha
// como aplicá-la. O resultado era uma busca que dizia "3 vagas encontradas" e não acendia
// nada na cena.
//
// ── Por que devolve estado, e não cor ───────────────────────────────────────────
// Cor depende de tema, modo de cor, capacidade máxima e Curva ABC — coisas de quem
// desenha. O que é REGRA é quais vagas estão em destaque e quais estão de fundo. Ao
// separar as duas, as duas vistas passam a compartilhar a regra sem compartilhar a
// paleta, e esta parte fica conferível sem WebGL.
//
// ── A precedência não é arbitrária ──────────────────────────────────────────────
// `pulsando` vence tudo: é a informação mais NOVA da tela, e dura dois segundos.
// `achada` vence o modo de cor: achado o produto, a pergunta deixou de ser "como está" e
// passou a ser "onde está". `ativa` é o que decide se a vaga recebe cor plena ou vira
// fundo — o filtro ISOLA, não amputa.

import type { Slot, SlotStatus } from './warehouse3dSlots';

export type FiltroDeStatus = 'todas' | SlotStatus;

export interface ContextoDeDestaque {
  /** Conjunto VAZIO significa todas as ruas. */
  ruasSelecionadas: ReadonlySet<string>;
  filtro: FiltroDeStatus;
  /** `null` = nenhuma busca em curso. Conjunto vazio = busca sem resultado. */
  achados: ReadonlySet<string> | null;
  pulsando: ReadonlySet<string>;
}

export interface DestaqueDaVaga {
  /** Recebe cor plena e participa dos lotes de destaque. */
  ativa: boolean;
  /** Casou com a busca em curso. */
  achada: boolean;
  /** Mexida por outro operador nos últimos segundos. */
  pulsando: boolean;
}

/** Contexto que não destaca nem filtra nada — o estado de abertura da tela. */
export const SEM_DESTAQUE: ContextoDeDestaque = {
  ruasSelecionadas: new Set(),
  filtro: 'todas',
  achados: null,
  pulsando: new Set(),
};

/**
 * Estado de destaque de uma vaga.
 *
 * Os três critérios de `ativa` se SOMAM, em vez de um substituir o outro: buscar um SKU
 * com o filtro em "Bloqueadas" mostra a interseção, não a busca inteira. Foi assim que a
 * vista por código sempre se comportou, e é o comportamento que esta função preserva.
 */
export function destaqueDaVaga(
  slot: Pick<Slot, 'id' | 'ruaCodigo' | 'status'>,
  ctx: ContextoDeDestaque,
): DestaqueDaVaga {
  const achada = ctx.achados !== null && ctx.achados.has(slot.id);
  const ativa =
    (ctx.ruasSelecionadas.size === 0 || ctx.ruasSelecionadas.has(slot.ruaCodigo)) &&
    (ctx.filtro === 'todas' || slot.status === ctx.filtro) &&
    (ctx.achados === null || achada);

  return { ativa, achada, pulsando: ctx.pulsando.has(slot.id) };
}
