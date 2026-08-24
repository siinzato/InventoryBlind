// Serviço do canal de notificações de tarefas — independente do sino de
// comunicados gerais do InventoryBlind (WhatsNewPanel). RLS é a barreira
// real (cada usuário só vê/marca as próprias linhas, ver migration
// 070_task_management.sql / 071_task_notifications_channel.sql); aqui só
// existe consulta, escrita de leitura e a assinatura Realtime.

import { supabase } from '../supabase';
import { TaskNotification } from './types';
import { TaskServiceError } from './taskService';

const NOTIFICATION_COLUMNS = 'id, task_id, type, title, message, reference_date, read_at, created_at';

function unwrap<T>(data: T | null, error: { message: string } | null, fallback: T): T {
  if (error) {
    console.error('[task-notifications]', error.message);
    throw new TaskServiceError(error.message);
  }
  return data ?? fallback;
}

export async function listMyNotifications(userId: string, limit = 30): Promise<TaskNotification[]> {
  const { data, error } = await supabase.from('task_notifications')
    .select(NOTIFICATION_COLUMNS).eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  return unwrap(data as TaskNotification[] | null, error, []);
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase.from('task_notifications').update({ read_at: new Date().toISOString() }).eq('id', notificationId);
  if (error) throw new TaskServiceError(error.message);
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase.from('task_notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null);
  if (error) throw new TaskServiceError(error.message);
}

/**
 * Realtime — só o que já é meu por RLS chega aqui; o filtro abaixo é
 * conveniência de rede, não a barreira de segurança (essa é a RLS de
 * task_notifications_select, aplicada por assinante pelo Postgres Changes
 * do Supabase). Devolve a função de limpeza — chamar ao desmontar o
 * componente ou ao trocar de usuário (logout/switch de empresa).
 */
export function subscribeToTaskNotifications(userId: string, onInsert: (notification: TaskNotification) => void): () => void {
  const channel = supabase
    .channel(`task-notifications-${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'task_notifications', filter: `user_id=eq.${userId}` },
      (payload: { new: TaskNotification }) => onInsert(payload.new),
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
