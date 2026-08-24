import React, { useMemo, useState } from 'react';
import { RefreshCw, AlertCircle, LayoutGrid } from 'lucide-react';
import { TaskWithAssignees, AssigneeStatus } from '../../lib/tasks/types';
import { findMyAssignment } from '../../lib/tasks/taskDomain';
import { TaskCard } from './TaskCard';

interface KanbanViewProps {
  tasks: TaskWithAssignees[];
  loading: boolean;
  error: string | null;
  currentUserId: string;
  onOpenTask: (id: string) => void;
  onChangeMyStatus: (taskId: string, status: AssigneeStatus) => void;
}

const COLUMNS: { status: AssigneeStatus; label: string }[] = [
  { status: 'todo', label: 'A fazer' },
  { status: 'in_progress', label: 'Em andamento' },
  { status: 'done', label: 'Concluído' },
];

/**
 * As colunas refletem a PRÓPRIA participação do usuário (findMyAssignment),
 * nunca o status agregado da tarefa — arrastar uma corporativa move só a
 * própria execução, exatamente como o card de "mover" já faz. Drag nativo
 * (mouse) + o menu "mover" do TaskCard cobrem desktop e celular igualmente,
 * já que HTML5 drag-and-drop não é confiável em toque.
 */
export const KanbanView: React.FC<KanbanViewProps> = ({ tasks, loading, error, currentUserId, onOpenTask, onChangeMyStatus }) => {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<AssigneeStatus | null>(null);

  const myTasks = useMemo(() => tasks.filter(t => t.status !== 'cancelled' && !!findMyAssignment(t.assignees, currentUserId)), [tasks, currentUserId]);

  const columns = useMemo(() => {
    const grouped: Record<AssigneeStatus, TaskWithAssignees[]> = { todo: [], in_progress: [], done: [] };
    myTasks.forEach(t => {
      const mine = findMyAssignment(t.assignees, currentUserId);
      if (mine) grouped[mine.status].push(t);
    });
    return grouped;
  }, [myTasks, currentUserId]);

  if (loading) return <div className="flex items-center justify-center py-16 text-fg-subtle gap-2"><RefreshCw size={20} className="animate-spin" />Carregando quadro...</div>;
  if (error) return <div className="flex items-center gap-2 p-4 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-sm"><AlertCircle size={16} />{error}</div>;

  if (myTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-fg-subtle bg-surface-2 rounded-xl border border-edge">
        <LayoutGrid size={40} className="mb-3 opacity-30" />
        <p className="text-sm">Nenhuma tarefa para exibir no quadro.</p>
      </div>
    );
  }

  const handleDrop = (targetStatus: AssigneeStatus) => {
    setDragOverCol(null);
    if (!draggedId) return;
    const task = myTasks.find(t => t.id === draggedId);
    const mine = task ? findMyAssignment(task.assignees, currentUserId) : undefined;
    if (mine && mine.status !== targetStatus) onChangeMyStatus(draggedId, targetStatus);
    setDraggedId(null);
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory sm:snap-none">
      {COLUMNS.map(col => (
        <div
          key={col.status}
          onDragOver={e => { e.preventDefault(); setDragOverCol(col.status); }}
          onDragLeave={() => setDragOverCol(prev => (prev === col.status ? null : prev))}
          onDrop={e => { e.preventDefault(); handleDrop(col.status); }}
          className={`flex-shrink-0 w-[85vw] sm:w-72 snap-start bg-surface-3/40 rounded-xl border-2 p-3 transition-colors ${dragOverCol === col.status ? 'border-accent bg-accent/5' : 'border-transparent'}`}
        >
          <p className="text-xs font-bold text-fg-subtle uppercase mb-3 px-1">{col.label} <span className="font-normal">({columns[col.status].length})</span></p>
          <div className="space-y-2 min-h-[4rem]">
            {columns[col.status].map(t => (
              <TaskCard
                key={t.id} task={t} currentUserId={currentUserId}
                onOpen={() => onOpenTask(t.id)}
                onChangeMyStatus={s => onChangeMyStatus(t.id, s)}
                draggable
                onDragStart={() => setDraggedId(t.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default KanbanView;
