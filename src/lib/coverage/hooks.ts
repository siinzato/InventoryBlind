import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listMyCycleNotifications, markCycleNotificationsRead, subscribeToCycleNotifications,
  type CycleNotification,
} from './cycleNotificationService';

/** Avisos da ciclagem do próprio usuário, com Realtime — espelho de
 *  useSupportNotifications (lib/support/hooks.ts) e de useTaskNotifications, para os
 *  três canais chegarem ao sino com o mesmo comportamento. */
export function useCycleNotifications(userId: string | undefined) {
  const [notifications, setNotifications] = useState<CycleNotification[]>([]);
  const knownIds = useRef<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!userId) { setNotifications([]); return; }
    const rows = await listMyCycleNotifications(userId);
    knownIds.current = new Set(rows.map(r => r.id));
    setNotifications(rows);
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!userId) return;
    return subscribeToCycleNotifications(userId, notification => {
      if (knownIds.current.has(notification.id)) return;
      knownIds.current.add(notification.id);
      setNotifications(ns => [notification, ...ns]);
    });
  }, [userId]);

  const markRead = useCallback(async (id: string) => {
    const lida = new Date().toISOString();
    setNotifications(ns => ns.map(n => (n.id === id ? { ...n, read_at: n.read_at ?? lida } : n)));
    await markCycleNotificationsRead([id]);
  }, []);

  const markAllRead = useCallback(async () => {
    const lida = new Date().toISOString();
    setNotifications(ns => ns.map(n => (n.read_at ? n : { ...n, read_at: lida })));
    await markCycleNotificationsRead(null);
  }, []);

  return { notifications, markRead, markAllRead, reload };
}
