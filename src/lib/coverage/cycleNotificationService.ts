// Canal de avisos do programa de ciclagem. Espelha o serviço de notificações de
// suporte (lib/support/supportNotificationService.ts) de propósito: mesma forma,
// mesmo Realtime, para o terceiro canal caber no mesmo sino sem inventar um jeito
// próprio de chegar lá.
//
// Quem escreve é a rotina do banco, nunca o navegador — a tabela não tem policy de
// INSERT. Marcar como lida passa por RPC, pelo mesmo motivo do suporte: sem policy
// de UPDATE, nem a mensagem do aviso pode ser reescrita pelo cliente.

import { supabase } from '../supabase';

/** `lote_pendente`: é dia de contar e a contagem de hoje ainda não foi gerada.
 *  `contagem_atrasada`: uma contagem de ciclagem de um dia anterior continua aberta —
 *  o caso que passa despercebido, porque a tela de hoje não mostra a de ontem. */
export type CycleNotificationKind = 'lote_pendente' | 'contagem_atrasada';

export interface CycleNotification {
  id: string;
  kind: CycleNotificationKind;
  message: string;
  /** O dia a que o aviso se refere, no fuso da empresa. É também a chave que impede
   *  dois avisos para a mesma pessoa no mesmo dia. */
  reference_date: string;
  read_at: string | null;
  created_at: string;
}

const COLUMNS = 'id, kind, message, reference_date, read_at, created_at';

export async function listMyCycleNotifications(userId: string, limit = 30): Promise<CycleNotification[]> {
  const { data, error } = await supabase
    .from('cycle_program_notifications').select(COLUMNS)
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  // Erro aqui não derruba o sino: os outros dois canais continuam chegando. Uma lista
  // vazia é um canal a menos; uma exceção seria o sino inteiro.
  if (error) { console.error('[cycle-notifications] list', error.message); return []; }
  return (data ?? []) as CycleNotification[];
}

/** `null` marca todas as não lidas do usuário. */
export async function markCycleNotificationsRead(ids: string[] | null): Promise<void> {
  const { error } = await supabase.rpc('cycle_program_notifications_mark_read', { p_ids: ids });
  if (error) console.error('[cycle-notifications] markRead', error.message);
}

/** O filtro do canal é conveniência de rede; a barreira é a policy
 *  (user_id = auth.uid()). Devolve a função de limpeza. */
export function subscribeToCycleNotifications(
  userId: string, onInsert: (n: CycleNotification) => void,
): () => void {
  const channel = supabase
    .channel(`cycle-notifications-${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'cycle_program_notifications', filter: `user_id=eq.${userId}` },
      (payload: { new: CycleNotification }) => onInsert(payload.new),
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
