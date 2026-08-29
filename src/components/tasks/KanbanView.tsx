import React, { useMemo, useState } from 'react';
import { RefreshCw, AlertCircle, LayoutGrid, Search, SlidersHorizontal, ArrowUpDown, Archive as ArchiveIcon } from 'lucide-react';
import { Input, Select, Button } from '../ui';
import { TaskWithAssignees, AssigneeStatus, TaskPriority } from '../../lib/tasks/types';
import { findMyAssignment, isAssigneeArchived, TASK_PRIORITY_LABEL } from '../../lib/tasks/taskDomain';
import { KanbanTaskCard } from './KanbanTaskCard';
import { ArchivedTasksDrawer } from './ArchivedTasksDrawer';

interface KanbanViewProps {
  tasks: TaskWithAssignees[];
  loading: boolean;
  error: string | null;
  currentUserId: string;
  onOpenTask: (id: string) => void;
  onChangeMyStatus: (taskId: string, status: AssigneeStatus) => void;
  onArchiveTask: (taskId: string) => void;
  onRestoreTask: (taskId: string) => void;
  onArchiveEligible: () => Promise<number>;
}

const COLUMNS: { status: AssigneeStatus; label: string }[] = [
  { status: 'todo', label: 'A fazer' },
  { status: 'in_progress', label: 'Em andamento' },
  { status: 'done', label: 'Concluído' },
];

type TypeFilter = 'all' | 'personal' | 'corporate';
type PriorityFilter = 'all' | TaskPriority;
type SortMode = 'due_date' | 'priority' | 'recent';

const PRIORITY_WEIGHT: Record<TaskPriority, number> = { urgent: 3, high: 2, medium: 1, low: 0 };

/**
 * As colunas refletem a PRÓPRIA participação do usuário (findMyAssignment),
 * nunca o status agregado da tarefa — arrastar uma corporativa move só a
 * própria execução, exatamente como o card de "mover" já faz. Drag nativo
 * (mouse) + o menu "mover" do TaskCard cobrem desktop e celular igualmente,
 * já que HTML5 drag-and-drop não é confiável em toque.
 *
 * Busca/filtro/ordenação operam sobre `tasks` (já carregado por useMyDayTasks)
 * — nenhuma consulta nova. Concluídas arquivadas (isAssigneeArchived) somem
 * do board; o drawer "Arquivadas" e o arquivamento em si vivem em
 * ArchivedTasksDrawer.tsx / migration 095.
 */
export const KanbanView: React.FC<KanbanViewProps> = ({
  tasks, loading, error, currentUserId, onOpenTask, onChangeMyStatus, onArchiveTask, onRestoreTask, onArchiveEligible,
}) => {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<AssigneeStatus | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('due_date');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const now = Date.now();

  const myTasks = useMemo(() => tasks.filter(t => t.status !== 'cancelled' && !!findMyAssignment(t.assignees, currentUserId)), [tasks, currentUserId]);

  const archivedCount = useMemo(() => myTasks.reduce((acc, t) => {
    const mine = findMyAssignment(t.assignees, currentUserId);
    return acc + (mine && isAssigneeArchived(mine, now) ? 1 : 0);
  }, 0), [myTasks, currentUserId, now]);

  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return myTasks.filter(t => {
      const mine = findMyAssignment(t.assignees, currentUserId);
      if (mine && isAssigneeArchived(mine, now)) return false;
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      if (q && !`${t.title} ${t.category ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [myTasks, currentUserId, now, search, typeFilter, priorityFilter]);

  const sortedTasks = useMemo(() => {
    const list = [...visibleTasks];
    if (sortMode === 'priority') {
      list.sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);
    } else if (sortMode === 'recent') {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else {
      list.sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date);
      });
    }
    return list;
  }, [visibleTasks, sortMode]);

  const columns = useMemo(() => {
    const grouped: Record<AssigneeStatus, TaskWithAssignees[]> = { todo: [], in_progress: [], paused: [], blocked: [], done: [] };
    sortedTasks.forEach(t => {
      const mine = findMyAssignment(t.assignees, currentUserId);
      if (mine) grouped[mine.status].push(t);
    });
    return grouped;
  }, [sortedTasks, currentUserId]);

  const doneEligibleCount = columns.done.length;

  const handleArchiveEligible = async () => {
    if (archiving || doneEligibleCount === 0) return;
    setArchiving(true);
    try { await onArchiveEligible(); } finally { setArchiving(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-fg-subtle gap-2"><RefreshCw size={20} className="animate-spin" />Carregando quadro...</div>;
  if (error) return <div className="flex items-center gap-2 p-4 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-sm"><AlertCircle size={16} />{error}</div>;

  const handleDrop = (targetStatus: AssigneeStatus) => {
    setDragOverCol(null);
    if (!draggedId) return;
    const task = myTasks.find(t => t.id === draggedId);
    const mine = task ? findMyAssignment(task.assignees, currentUserId) : undefined;
    if (mine && mine.status !== targetStatus) onChangeMyStatus(draggedId, targetStatus);
    setDraggedId(null);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <Input icon={<Search size={15} />} placeholder="Buscar tarefas" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value as TypeFilter)}>
          <option value="all">Todas as tarefas</option>
          <option value="personal">Pessoais</option>
          <option value="corporate">Corporativas</option>
        </Select>

        <div className="relative">
          <Button variant="secondary" size="sm" onClick={() => { setFilterOpen(v => !v); setSortOpen(false); }}>
            <SlidersHorizontal size={14} />Filtrar{priorityFilter !== 'all' ? ` · ${TASK_PRIORITY_LABEL[priorityFilter]}` : ''}
          </Button>
          {filterOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-edge rounded-lg shadow-panel py-1 w-44">
              {(['all', 'low', 'medium', 'high', 'urgent'] as PriorityFilter[]).map(p => (
                <button key={p} onClick={() => { setPriorityFilter(p); setFilterOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 ${priorityFilter === p ? 'text-accent font-semibold' : 'text-fg-muted'}`}>
                  {p === 'all' ? 'Todas as prioridades' : TASK_PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <Button variant="secondary" size="sm" onClick={() => { setSortOpen(v => !v); setFilterOpen(false); }}>
            <ArrowUpDown size={14} />Ordenar
          </Button>
          {sortOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-edge rounded-lg shadow-panel py-1 w-48">
              {([
                ['due_date', 'Prazo mais próximo'],
                ['priority', 'Prioridade'],
                ['recent', 'Mais recentes'],
              ] as [SortMode, string][]).map(([mode, label]) => (
                <button key={mode} onClick={() => { setSortMode(mode); setSortOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 ${sortMode === mode ? 'text-accent font-semibold' : 'text-fg-muted'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <Button variant="secondary" size="sm" onClick={() => setArchiveOpen(true)}>
          <ArchiveIcon size={14} />Arquivadas {archivedCount}
        </Button>
      </div>

      {myTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-fg-subtle bg-surface-2 rounded-lg border border-edge">
          <LayoutGrid size={40} className="mb-3 opacity-30" />
          <p className="text-sm">Nenhuma tarefa para exibir no quadro.</p>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory sm:snap-none">
          {COLUMNS.map(col => (
            <div
              key={col.status}
              onDragOver={e => { e.preventDefault(); setDragOverCol(col.status); }}
              onDragLeave={() => setDragOverCol(prev => (prev === col.status ? null : prev))}
              onDrop={e => { e.preventDefault(); handleDrop(col.status); }}
              className={`flex-shrink-0 w-[85vw] sm:w-0 sm:flex-1 snap-start bg-surface-2 rounded-lg border p-3 transition-colors ${dragOverCol === col.status ? 'border-accent bg-accent/5' : 'border-edge'}`}
            >
              <div className="flex items-center justify-between mb-3 px-1">
                <p className="text-xs font-bold text-fg-subtle uppercase">{col.label} <span className="font-normal">({columns[col.status].length})</span></p>
                {col.status === 'done' && doneEligibleCount > 0 && (
                  <button onClick={handleArchiveEligible} disabled={archiving}
                    className="text-[11px] font-semibold text-fg-subtle hover:text-fg disabled:opacity-50">
                    Arquivar concluídas
                  </button>
                )}
              </div>

              <div className="space-y-2 min-h-[4rem]">
                {columns[col.status].map(t => (
                  <KanbanTaskCard
                    key={t.id} task={t} currentUserId={currentUserId}
                    onOpen={() => onOpenTask(t.id)}
                    onChangeMyStatus={s => onChangeMyStatus(t.id, s)}
                    onArchive={col.status === 'done' ? () => onArchiveTask(t.id) : undefined}
                    draggable
                    onDragStart={() => setDraggedId(t.id)}
                  />
                ))}
              </div>

              {col.status === 'done' && (
                <div className="mt-3 pt-3 border-t border-edge flex items-center justify-between text-[11px] text-fg-subtle">
                  <span>Arquivamento automático em 7 dias</span>
                  <button onClick={() => setArchiveOpen(true)} className="font-semibold text-accent hover:text-accent-strong">Ver arquivadas</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ArchivedTasksDrawer
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        tasks={myTasks}
        currentUserId={currentUserId}
        onOpenTask={id => { setArchiveOpen(false); onOpenTask(id); }}
        onRestore={onRestoreTask}
      />
    </div>
  );
};

export default KanbanView;
