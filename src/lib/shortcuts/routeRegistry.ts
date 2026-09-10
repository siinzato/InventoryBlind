// Registro de rotas disponíveis para "Meus Atalhos" — sempre derivado do MESMO
// array que já monta a navegação lateral (SidebarNavGroup[]), nunca uma lista
// paralela: uma rota só aparece aqui se já aparece destravada no menu, então
// permissão/plano mudarem faz o atalho parar de ser oferecido automaticamente,
// sem nenhuma regra duplicada.

import type { ReactNode } from 'react';

export interface NavItemLike {
  id: string;
  label: string;
  icon: ReactNode;
  locked?: boolean;
}

export interface NavGroupLike {
  id: string;
  items: NavItemLike[];
  locked?: boolean;
}

export interface ShortcutRouteOption {
  id: string;
  label: string;
  icon: ReactNode;
}

/** Só rotas destravadas (grupo e item) entram — a mesma checagem de
 *  permissão/plano que já decide o que aparece no menu. */
export function buildRouteRegistry(groups: NavGroupLike[]): ShortcutRouteOption[] {
  return groups
    .filter(g => !g.locked)
    .flatMap(g => g.items.filter(i => !i.locked).map(i => ({ id: i.id, label: i.label, icon: i.icon })));
}

export function findRouteOption(registry: ShortcutRouteOption[], routeKey: string): ShortcutRouteOption | null {
  return registry.find(r => r.id === routeKey) ?? null;
}
