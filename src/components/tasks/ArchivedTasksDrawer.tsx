import React, { useMemo, useState } from 'react';
import { Search, RotateCcw, Archive as ArchiveIcon } from 'lucide-react';
import { Modal, Input } from '../ui';
import { TaskWithAssignees } from '../../lib/tasks/types';
import { findMyAssignment, isAssigneeArchived, formatDueRelative } from '../../lib/tasks/taskDomain';

interface ArchivedTasksDrawerProps {
  open: boolean;
  onClose: () => void;
  tasks: TaskWithAssignees[];
  currentUserId: string;
  onOpenTask: (id: string) => void;
  onRestore: (taskId: string) => void;
}

/** Painel de tarefas arquivadas — reaproveita o mesmo Modal usado no resto do
 *  módulo (TaskDetailModal/TaskFormModal) como "drawer sem navegar para outra
 *  página": abre por cima do Kanban, fecha sem perder o board. Restaurar nunca
 *  apaga histórico — só limpa/neutraliza archived_at (ver migration 095). */
export const ArchivedTasksDrawer: React.FC<ArchivedTasksDrawerProps> = ({ open, onClose, tasks, currentUserId, onOpenTask, onRestore }) => {
  const [search, setSearch] = useState('');

  const archived = useMemo(() => {
    const now = Date.now();
    return tasks
      .map(t => ({ task: t, mine: findMyAssignment(t.assignees, currentUserId) }))
      .filter((row): row is { task: TaskWithAssignees; mine: NonNullable<typeof row.mine> } => !!row.mine && isAssigneeArchived(row.mine, now))
      .sort((a, b) => new Date(b.mine.completed_at ?? 0).getTime() - new Date(a.mine.completed_at ?? 0).getTime());
  }, [tasks, currentUserId]);

  const filtered = search.trim()
    ? archived.filter(({ task }) => `${task.title} ${task.category ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    : archived;

  return (
    <Modal open={open} onClose={onClose} title={`Tarefas arquivadas (${archived.length})`} maxWidth="max-w-md">
      <div className="space-y-3">
        <Input icon={<Search size={15} />} placeholder="Buscar nas arquivadas..." value={search} onChange={e => setSearch(e.target.value)} />

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-fg-subtle">
            <ArchiveIcon size={32} className="mb-2 opacity-30" />
            <p className="text-sm">{archived.length === 0 ? 'Nenhuma tarefa arquivada.' : 'Nenhum resultado para essa busca.'}</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {filtered.map(({ task }) => (
              <div key={task.id} className="flex items-start justify-between gap-2 p-3 bg-surface-2 border border-edge rounded-lg">
                <button onClick={() => onOpenTask(task.id)} className="text-left flex-1 min-w-0">
                  <p className="text-sm font-semibold text-fg truncate">{task.title}</p>
                  <p className="text-xs text-fg-subtle mt-0.5">
                    {task.category ? `${task.category} • ` : ''}{formatDueRelative(task)}
                  </p>
                </button>
                <button
                  onClick={() => onRestore(task.id)}
                  className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-strong flex-shrink-0 mt-0.5"
                >
                  <RotateCcw size={13} />Restaurar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ArchivedTasksDrawer;
