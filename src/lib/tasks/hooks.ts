// Hooks do módulo de Tarefas — loading/erro/lista vazia tratados uma vez aqui,
// não repetidos em cada tela. Mudanças de status são otimistas: a UI atualiza
// na hora e reverte sozinha se a RPC recusar (permissão, tarefa cancelada etc).

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TaskWithAssignees, TaskNotification, AssigneeStatus, TeamMember, TaskTemplate,
} from './types';
import {
  listMyDayTasks, listCompanyTasks, listTeamMembers, TeamTaskFilters,
  setMyTaskStatus, pauseMyTask, resumeMyTask, blockMyTask, unblockTask, TaskServiceError, getTaskDetail, TaskDetail,
  getTaskModuleSettings, listTaskTemplates,
} from './taskService';
import {
  listMyNotifications, markNotificationRead, markAllNotificationsRead, subscribeToTaskNotifications,
} from './taskNotificationService';

function messageOf(err: unknown, fallback: string): string {
  return err instanceof TaskServiceError ? err.message : fallback;
}

export function useMyDayTasks(userId: string | undefined) {
  const [tasks, setTasks] = useState<TaskWithAssignees[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!userId) { setTasks([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      setTasks(await listMyDayTasks(userId));
    } catch (err) {
      setError(messageOf(err, 'Não foi possível carregar suas tarefas.'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  const setStatusOptimistic = useCallback(async (taskId: string, status: AssigneeStatus) => {
    if (!userId) return;
    const previous = tasks;
    setTasks(ts => ts.map(t => t.id === taskId
      ? { ...t, assignees: t.assignees.map(a => a.user_id === userId ? { ...a, status } : a) }
      : t));
    try {
      await setMyTaskStatus(taskId, status);
      await reload();
    } catch (err) {
      setTasks(previous);
      throw new TaskServiceError(messageOf(err, 'Não foi possível atualizar o status.'));
    }
  }, [tasks, userId, reload]);

  // Pausa/bloqueio têm efeito colateral no servidor (abrem/fecham segmento de
  // tempo) — mais simples e seguro recarregar do que espelhar isso de forma
  // otimista. `run` centraliza o padrão comum a todas: chama a RPC, recarrega,
  // relança TaskServiceError com uma mensagem legível se falhar.
  const run = useCallback(async (action: () => Promise<void>, fallbackMessage: string) => {
    try {
      await action();
      await reload();
    } catch (err) {
      throw new TaskServiceError(messageOf(err, fallbackMessage));
    }
  }, [reload]);

  const pauseTask = useCallback((taskId: string, note?: string) =>
    run(() => pauseMyTask(taskId, note), 'Não foi possível pausar a tarefa.'), [run]);
  const resumeTask = useCallback((taskId: string) =>
    run(() => resumeMyTask(taskId), 'Não foi possível retomar a tarefa.'), [run]);
  const blockTask = useCallback((taskId: string, reason: string, note?: string) =>
    run(() => blockMyTask(taskId, reason, note), 'Não foi possível bloquear a tarefa.'), [run]);
  const unblockMyTask = useCallback((taskId: string) =>
    run(() => unblockTask(taskId, undefined, true), 'Não foi possível desbloquear a tarefa.'), [run]);

  return { tasks, loading, error, reload, setStatusOptimistic, pauseTask, resumeTask, blockTask, unblockMyTask };
}

export function useTeamTasks(companyId: string | undefined, filters: TeamTaskFilters) {
  const [tasks, setTasks] = useState<TaskWithAssignees[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filterKey = JSON.stringify(filters);

  const reload = useCallback(async () => {
    if (!companyId) { setTasks([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      setTasks(await listCompanyTasks(companyId, filters));
    } catch (err) {
      setError(messageOf(err, 'Não foi possível carregar as tarefas da equipe.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, filterKey]);

  useEffect(() => { reload(); }, [reload]);

  return { tasks, loading, error, reload };
}

const DEFAULT_DUE_SOON_THRESHOLD_MINUTES = 120;

/** Limite de "vence em breve" da empresa — 120min (as "duas horas" do pedido)
 *  quando a empresa ainda não configurou nada em task_module_settings. */
export function useDueSoonThreshold(companyId: string | undefined) {
  const [minutes, setMinutes] = useState(DEFAULT_DUE_SOON_THRESHOLD_MINUTES);

  useEffect(() => {
    let cancelled = false;
    if (!companyId) { setMinutes(DEFAULT_DUE_SOON_THRESHOLD_MINUTES); return; }
    getTaskModuleSettings(companyId).then(settings => {
      if (!cancelled) setMinutes(settings?.due_soon_threshold_minutes ?? DEFAULT_DUE_SOON_THRESHOLD_MINUTES);
    });
    return () => { cancelled = true; };
  }, [companyId]);

  return minutes;
}

export function useTaskTemplates() {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listTaskTemplates()
      .then(t => { if (!cancelled) setTemplates(t); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { templates, loading };
}

export function useTeamMembers(companyId: string | undefined) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!companyId) { setMembers([]); setLoading(false); return; }
    setLoading(true);
    listTeamMembers(companyId)
      .then(m => { if (!cancelled) setMembers(m); })
      .catch(err => { if (!cancelled) setError(messageOf(err, 'Não foi possível carregar a equipe.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  return { members, loading, error };
}

export function useTaskDetail(taskId: string | null) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!taskId) { setDetail(null); return; }
    setLoading(true); setError(null);
    try {
      setDetail(await getTaskDetail(taskId));
    } catch (err) {
      setError(messageOf(err, 'Não foi possível carregar os detalhes da tarefa.'));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { reload(); }, [reload]);

  return { detail, loading, error, reload };
}

export function useTaskNotifications(userId: string | undefined) {
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const knownIds = useRef<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!userId) { setNotifications([]); setLoading(false); return; }
    setLoading(true);
    try {
      const rows = await listMyNotifications(userId);
      knownIds.current = new Set(rows.map(r => r.id));
      setNotifications(rows);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  // Realtime — uma nova atribuição/comentário aparece no sino sem recarregar
  // a página. O filtro do canal já restringe ao próprio usuário, mas a RLS
  // (user_id = auth.uid()) é a barreira real. Some ao desmontar/trocar de
  // usuário (logout, troca de empresa).
  useEffect(() => {
    if (!userId) return;
    const unsubscribe = subscribeToTaskNotifications(userId, (notification) => {
      if (knownIds.current.has(notification.id)) return;
      knownIds.current.add(notification.id);
      setNotifications(ns => [notification, ...ns]);
    });
    return unsubscribe;
  }, [userId]);

  const unreadCount = notifications.filter(n => !n.read_at).length;

  const markRead = useCallback(async (id: string) => {
    setNotifications(ns => ns.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
    await markNotificationRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    setNotifications(ns => ns.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    await markAllNotificationsRead(userId);
  }, [userId]);

  return { notifications, unreadCount, loading, reload, markRead, markAllRead };
}
