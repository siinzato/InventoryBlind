/**
 * TasksPage — "Meu Trabalho" / Tarefas
 *
 * Módulo nativo de gerenciamento de tarefas, independente da agenda
 * operacional do Full Manager (tabelas, RPCs e tela próprias — ver migration
 * 070_task_management.sql). Quatro visões: Meu Dia, Kanban, Agenda e Equipe
 * (Equipe só para owner/admin/manager — `tasks.manage`).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ListTodo, Sun, LayoutGrid, CalendarDays, Users, RefreshCw } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { hasPermission } from '../lib/permissionService';
import { useMyDayTasks, useTeamTasks, useTeamMembers, useDueSoonThreshold } from '../lib/tasks/hooks';
import { TeamTaskFilters } from '../lib/tasks/taskService';
import { Task, TaskType } from '../lib/tasks/types';
import { MyDayView } from './tasks/MyDayView';
import { KanbanView } from './tasks/KanbanView';
import { AgendaView } from './tasks/AgendaView';
import { TeamView } from './tasks/TeamView';
import { TaskFormModal } from './tasks/TaskFormModal';
import { TaskDetailModal } from './tasks/TaskDetailModal';
import { CreateTaskMenu } from './tasks/CreateTaskMenu';

type ViewId = 'my-day' | 'kanban' | 'agenda' | 'team';

interface TasksPageProps {
  onBack: () => void;
  /** Id de uma tarefa a abrir direto ao entrar — vindo do sino de notificações
   *  do cabeçalho global. Mesmo padrão de `nfePendingInvoiceId` em App.tsx:
   *  a página consome e avisa de volta para o estado não sobreviver a uma
   *  segunda navegação para a mesma tarefa. */
  initialTaskId?: string;
  onConsumedInitialTask?: () => void;
}

export const TasksPage: React.FC<TasksPageProps> = ({ onBack, initialTaskId, onConsumedInitialTask }) => {
  const { profile, companyId } = useAuth();
  const userId = profile?.id ?? '';
  const canManageTasks = hasPermission(profile?.role, 'tasks.manage');

  const [view, setView] = useState<ViewId>('my-day');
  const [teamFilters, setTeamFilters] = useState<TeamTaskFilters>({});
  const [formOpen, setFormOpen] = useState(false);
  const [formForcedType, setFormForcedType] = useState<TaskType | undefined>(undefined);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);

  const myDay = useMyDayTasks(userId);
  const team = useTeamTasks(canManageTasks ? companyId : undefined, teamFilters);
  const { members } = useTeamMembers(companyId);
  const dueSoonThresholdMinutes = useDueSoonThreshold(companyId);

  useEffect(() => {
    if (!initialTaskId) return;
    setDetailTaskId(initialTaskId);
    onConsumedInitialTask?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTaskId]);

  const reloadAll = useCallback(() => {
    myDay.reload();
    if (canManageTasks) team.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageTasks]);

  const openCreate = (forcedType?: TaskType) => { setEditingTask(null); setFormForcedType(forcedType); setFormOpen(true); };
  const openEdit = (task: Task) => { setEditingTask(task); setFormForcedType(undefined); setFormOpen(true); };

  const editingAssigneeIds = editingTask
    ? [...myDay.tasks, ...team.tasks].find(t => t.id === editingTask.id)?.assignees.map(a => a.user_id) ?? []
    : [];

  const NAV: { id: ViewId; label: string; icon: React.ReactNode; hidden?: boolean }[] = [
    { id: 'my-day', label: 'Meu Dia', icon: <Sun size={15} /> },
    { id: 'kanban', label: 'Kanban', icon: <LayoutGrid size={15} /> },
    { id: 'agenda', label: 'Agenda', icon: <CalendarDays size={15} /> },
    { id: 'team', label: 'Equipe', icon: <Users size={15} />, hidden: !canManageTasks },
  ];

  if (!profile || !userId) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <RefreshCw size={24} className="animate-spin text-fg-subtle" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface p-6 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg transition-colors mb-6">
            <ArrowLeft size={18} />Voltar
          </button>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-accent rounded-xl"><ListTodo size={28} className="text-white" /></div>
              <div>
                <h1 className="text-title">Meu Trabalho</h1>
                <p className="text-sm text-fg-muted mt-1">Organize suas tarefas e acompanhe as da equipe</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CreateTaskMenu role={profile?.role} onCreatePersonal={() => openCreate('personal')} onCreateCorporate={() => openCreate('corporate')} />
            </div>
          </div>
        </div>

        <div className="flex bg-surface-3 rounded-lg p-1 gap-1 mb-6 w-fit overflow-x-auto max-w-full">
          {NAV.filter(n => !n.hidden).map(n => (
            <button key={n.id} onClick={() => setView(n.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm font-medium transition whitespace-nowrap ${view === n.id ? 'bg-accent text-white' : 'text-fg-muted hover:text-fg'}`}>
              {n.icon}{n.label}
            </button>
          ))}
        </div>

        {view === 'my-day' && (
          <MyDayView
            tasks={myDay.tasks} loading={myDay.loading} error={myDay.error} currentUserId={userId}
            dueSoonThresholdMinutes={dueSoonThresholdMinutes}
            onOpenTask={setDetailTaskId}
            onChangeMyStatus={(taskId, status) => myDay.setStatusOptimistic(taskId, status).catch(() => {})}
            onPause={(taskId, note) => myDay.pauseTask(taskId, note).catch(() => {})}
            onResume={taskId => myDay.resumeTask(taskId).catch(() => {})}
            onBlock={(taskId, reason, note) => myDay.blockTask(taskId, reason, note).catch(() => {})}
            onUnblock={taskId => myDay.unblockMyTask(taskId).catch(() => {})}
          />
        )}

        {view === 'kanban' && (
          <KanbanView
            tasks={myDay.tasks} loading={myDay.loading} error={myDay.error} currentUserId={userId}
            onOpenTask={setDetailTaskId}
            onChangeMyStatus={(taskId, status) => myDay.setStatusOptimistic(taskId, status).catch(() => {})}
          />
        )}

        {view === 'agenda' && (
          <AgendaView
            tasks={myDay.tasks} loading={myDay.loading} error={myDay.error} currentUserId={userId}
            onOpenTask={setDetailTaskId}
            onChangeMyStatus={(taskId, status) => myDay.setStatusOptimistic(taskId, status).catch(() => {})}
          />
        )}

        {view === 'team' && canManageTasks && (
          <TeamView
            tasks={team.tasks} loading={team.loading} error={team.error} currentUserId={userId}
            teamMembers={members} filters={teamFilters} onFiltersChange={setTeamFilters}
            onOpenTask={setDetailTaskId} onCreateCorporate={() => openCreate('corporate')}
          />
        )}
      </div>

      {formOpen && (
        <TaskFormModal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          onSaved={reloadAll}
          role={profile.role}
          teamMembers={members}
          editingTask={editingTask}
          editingAssigneeIds={editingAssigneeIds}
          forcedType={formForcedType}
        />
      )}

      {detailTaskId && (
        <TaskDetailModal
          taskId={detailTaskId}
          currentUserId={userId}
          companyId={companyId}
          role={profile.role}
          teamMembers={members}
          onClose={() => setDetailTaskId(null)}
          onChanged={reloadAll}
          onEdit={() => {
            const task = [...myDay.tasks, ...team.tasks].find(t => t.id === detailTaskId);
            if (task) { openEdit(task); setDetailTaskId(null); }
          }}
        />
      )}
    </div>
  );
};

export default TasksPage;
