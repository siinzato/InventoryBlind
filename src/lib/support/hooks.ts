import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listMySupportNotifications, markSupportNotificationsRead, subscribeToSupportNotifications,
  type SupportNotification,
} from './supportNotificationService';

/** Avisos do suporte do próprio usuário, com Realtime — espelho de
 *  useTaskNotifications (lib/tasks/hooks.ts), para os dois canais chegarem ao
 *  sino com o mesmo comportamento. */
export function useSupportNotifications(userId: string | undefined) {
  const [notifications, setNotifications] = useState<SupportNotification[]>([]);
  const knownIds = useRef<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!userId) { setNotifications([]); return; }
    const rows = await listMySupportNotifications(userId);
    knownIds.current = new Set(rows.map(r => r.id));
    setNotifications(rows);
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!userId) return;
    return subscribeToSupportNotifications(userId, notification => {
      if (knownIds.current.has(notification.id)) return;
      knownIds.current.add(notification.id);
      setNotifications(ns => [notification, ...ns]);
    });
  }, [userId]);

  const markRead = useCallback(async (id: string) => {
    const lida = new Date().toISOString();
    setNotifications(ns => ns.map(n => (n.id === id ? { ...n, read_at: n.read_at ?? lida } : n)));
    await markSupportNotificationsRead([id]);
  }, []);

  const markAllRead = useCallback(async () => {
    const lida = new Date().toISOString();
    setNotifications(ns => ns.map(n => (n.read_at ? n : { ...n, read_at: lida })));
    await markSupportNotificationsRead(null);
  }, []);

  return { notifications, markRead, markAllRead, reload };
}
