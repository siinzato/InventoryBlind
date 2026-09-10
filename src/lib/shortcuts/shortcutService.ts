// Meus Atalhos — camada de I/O. route_key vem sempre de buildRouteRegistry
// (routeRegistry.ts), nunca de texto digitado. RLS já isola por usuário+workspace;
// aqui só existe UX (limite/ordem) — a barreira real está na migration 076.

import { supabase } from '../supabase';

export const MAX_SHORTCUTS = 5;

export interface UserShortcut {
  id: string;
  userId: string;
  companyId: string;
  routeKey: string;
  orderIndex: number;
}

interface ShortcutRow {
  id: string; user_id: string; company_id: string; route_key: string; order_index: number;
}

function fromRow(row: ShortcutRow): UserShortcut {
  return { id: row.id, userId: row.user_id, companyId: row.company_id, routeKey: row.route_key, orderIndex: row.order_index };
}

export async function listShortcuts(companyId: string, userId: string): Promise<UserShortcut[]> {
  const { data, error } = await supabase
    .from('user_shortcuts')
    .select('*')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .order('order_index', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

/** Adiciona uma rota já presente no registro (validado pelo chamador). Nunca
 *  duplica (UNIQUE) e nunca passa de 5 (trigger no banco é a barreira real; o
 *  check aqui só evita uma viagem ao servidor destinada a falhar). */
export async function addShortcut(companyId: string, userId: string, routeKey: string): Promise<UserShortcut> {
  const existing = await listShortcuts(companyId, userId);
  if (existing.some(s => s.routeKey === routeKey)) {
    return existing.find(s => s.routeKey === routeKey)!;
  }
  if (existing.length >= MAX_SHORTCUTS) {
    throw new Error(`Limite de ${MAX_SHORTCUTS} atalhos por workspace atingido.`);
  }

  const nextOrder = existing.length > 0 ? Math.max(...existing.map(s => s.orderIndex)) + 1 : 0;
  const { data, error } = await supabase
    .from('user_shortcuts')
    .insert({ company_id: companyId, user_id: userId, route_key: routeKey, order_index: nextOrder })
    .select()
    .single();
  if (error || !data) throw error ?? new Error('Falha ao salvar o atalho.');
  return fromRow(data);
}

export async function removeShortcut(id: string): Promise<void> {
  const { error } = await supabase.from('user_shortcuts').delete().eq('id', id);
  if (error) throw error;
}

/** Regrava a ordem inteira — `orderedIds` já vem na ordem final desejada. */
export async function reorderShortcuts(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, index) => supabase.from('user_shortcuts').update({ order_index: index, updated_at: new Date().toISOString() }).eq('id', id)));
}
