// Resolve os atalhos do usuário nos itens de navegação que a sidebar desenha.
//
// Mora aqui, fora do App, porque a regra tem casos de borda que valem teste: atalho
// para rota que o usuário perdeu acesso, atalho repetido, ordem que precisa ser
// respeitada. Errar qualquer um deles manda a pessoa para o lugar errado a partir de
// um menu que ela mesma montou.
//
// ── A mesma fonte do dashboard, não uma lista paralela ──────────────────────────
// Os itens devolvidos são os PRÓPRIOS itens do menu, com o `onClick` e o `active`
// deles. Reconstruir um clique aqui criaria um segundo caminho de navegação para o
// mesmo destino, que é como as duas telas comecam a divergir.
//
// ── Rota que perdeu permissão ───────────────────────────────────────────────────
// Some da exibição sem apagar a preferência — mesma regra que o card do dashboard já
// aplica. A linha continua salva no banco; ela só deixa de casar com o registro atual
// de rotas destravadas. Se o acesso voltar, o atalho reaparece sozinho.

import { buildRouteRegistry, findRouteOption } from './routeRegistry';

/** Item de menu navegável. Genérico para o App poder passar `SidebarNavItem` e
 *  receber `SidebarNavItem` de volta, sem a `lib` depender da camada de UI. */
export interface ItemNavegavel {
  id: string;
  label: string;
  locked?: boolean;
}

export interface GrupoNavegavel<T extends ItemNavegavel> {
  id: string;
  items: T[];
  locked?: boolean;
}

/** Só o que esta função precisa de um atalho — o resto da linha não importa aqui. */
export interface AtalhoComRota {
  routeKey: string;
}

/**
 * Itens de menu correspondentes aos atalhos, na ordem em que foram salvos.
 *
 * A ordem vem de fora e é preservada: `listShortcuts` já devolve por `order_index`,
 * que é a ordem que a pessoa arrastou no gerenciador. Reordenar aqui desfaria uma
 * escolha dela.
 */
export function resolverFavoritos<T extends ItemNavegavel>(
  atalhos: readonly AtalhoComRota[],
  grupos: readonly GrupoNavegavel<T>[],
): T[] {
  // O registro aplica a checagem de destravado (grupo e item) — a mesma que decide o
  // que aparece no menu. Nenhuma regra de permissão é duplicada aqui.
  const registro = buildRouteRegistry(
    grupos.map(g => ({ id: g.id, locked: g.locked, items: g.items.map(i => ({ id: i.id, label: i.label, icon: null, locked: i.locked })) })),
  );

  const porId = new Map<string, T>();
  for (const grupo of grupos) {
    if (grupo.locked) continue;
    for (const item of grupo.items) {
      if (!item.locked && !porId.has(item.id)) porId.set(item.id, item);
    }
  }

  const vistos = new Set<string>();
  const itens: T[] = [];

  for (const atalho of atalhos) {
    if (vistos.has(atalho.routeKey)) continue;
    if (findRouteOption(registro, atalho.routeKey) === null) continue;
    const item = porId.get(atalho.routeKey);
    if (!item) continue;
    vistos.add(atalho.routeKey);
    itens.push(item);
  }

  return itens;
}

/** Id do item que abre o seletor quando ainda não há favorito nenhum. Exportado para
 *  o teste e para quem monta o grupo não repetir a string. */
export const ID_ESCOLHER_FAVORITOS = 'acesso-rapido-escolher';
