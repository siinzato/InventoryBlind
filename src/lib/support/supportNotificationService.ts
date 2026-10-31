// Canal de avisos do suporte. Espelha o serviço de notificações de tarefas
// (lib/tasks/taskNotificationService.ts) de propósito: mesma forma, mesmo
// Realtime, para os dois caberem no mesmo sino sem cada um inventar um jeito.
//
// Diferença proposital: marcar como lida passa por RPC. A tabela não tem policy
// de UPDATE, então nem a mensagem do aviso pode ser reescrita pelo cliente.

import { supabase } from '../supabase';

export type SupportNotificationKind = 'aberto' | 'respondido' | 'mensagem' | 'resolvido' | 'reaberto';
export type SupportNotificationAudience = 'author' | 'answerers';

export interface SupportNotification {
  id: string;
  ticket_id: string | null;
  kind: SupportNotificationKind;
  /** Para onde o clique leva: quem abriu vai para Meus chamados, quem responde
   *  vai para a caixa de entrada. */
  audience: SupportNotificationAudience;
  message: string;
  read_at: string | null;
  created_at: string;
}

const COLUMNS = 'id, ticket_id, kind, audience, message, read_at, created_at';

export async function listMySupportNotifications(userId: string, limit = 30): Promise<SupportNotification[]> {
  const { data, error } = await supabase
    .from('support_notifications').select(COLUMNS)
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  if (error) { console.error('[support-notifications] list', error.message); return []; }
  return (data ?? []) as SupportNotification[];
}

/** `null` marca todas as não lidas do usuário. */
export async function markSupportNotificationsRead(ids: string[] | null): Promise<void> {
  const { error } = await supabase.rpc('support_notifications_mark_read', { p_ids: ids });
  if (error) console.error('[support-notifications] markRead', error.message);
}

/** O filtro do canal é conveniência de rede; a barreira é a policy
 *  (user_id = auth.uid()). Devolve a função de limpeza. */
export function subscribeToSupportNotifications(
  userId: string, onInsert: (n: SupportNotification) => void,
): () => void {
  const channel = supabase
    .channel(`support-notifications-${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'support_notifications', filter: `user_id=eq.${userId}` },
      (payload: { new: SupportNotification }) => onInsert(payload.new),
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
