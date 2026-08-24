import React, { useMemo, useState } from 'react';
import { Plus, RefreshCw, AlertCircle, Users } from 'lucide-react';
import { Button } from '../ui';
import { TaskWithAssignees, TaskStatus, TaskPriority, TaskType, TeamMember } from '../../lib/tasks/types';
import { computeWorkloadByUser, TASK_STATUS_LABEL, TASK_PRIORITY_LABEL } from '../../lib/tasks/taskDomain';
import { TeamTaskFilters } from '../../lib/tasks/taskService';
import { TaskCard } from './TaskCard';

interface TeamViewProps {
  tasks: TaskWithAssignees[];
  loading: boolean;
  error: string | null;
  currentUserId: string;
  teamMembers: TeamMember[];
  filters: TeamTaskFilters;
  onFiltersChange: (filters: TeamTaskFilters) => void;
  onOpenTask: (id: string) => void;
  onCreateCorporate: () => void;
}

const selectClass = 'px-2.5 py-2 border border-edge rounded-lg text-xs bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40';

function memberLabel(members: TeamMember[], id: string): string {
  const m = members.find(x => x.id === id);
  return m?.name || m?.email || 'Usuário';
}

export const TeamView: React.FC<TeamViewProps> = ({
  tasks, loading, error, currentUserId, teamMembers, filters, onFiltersChange, onOpenTask, onCreateCorporate,
}) => {
  const [showWorkload, setShowWorkload] = useState(true);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const workload = useMemo(() => computeWorkloadByUser(tasks, today), [tasks, today]);

  const overdueCount = useMemo(() => tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'cancelled').length, [tasks, today]);

  if (loading) return <div className="flex items-center justify-center py-16 text-fg-subtle gap-2"><RefreshCw size={20} className="animate-spin" />Carregando equipe...</div>;
  if (error) return <div className="flex items-center gap-2 p-4 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-sm"><AlertCircle size={16} />{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <select value={filters.userId ?? ''} onChange={e => onFiltersChange({ ...filters, userId: e.target.value || undefined })} className={selectClass}>
            <option value="">Todos os usuários</option>
            {teamMembers.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
          </select>
          <select value={filters.status ?? ''} onChange={e => onFiltersChange({ ...filters, status: (e.target.value || undefined) as TaskStatus | undefined })} className={selectClass}>
            <option value="">Todos os status</option>
            {(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map(s => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
          </select>
          <select value={filters.priority ?? ''} onChange={e => onFiltersChange({ ...filters, priority: (e.target.value || undefined) as TaskPriority | undefined })} className={selectClass}>
            <option value="">Toda prioridade</option>
            {Object.entries(TASK_PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={filters.type ?? ''} onChange={e => onFiltersChange({ ...filters, type: (e.target.value || undefined) as TaskType | undefined })} className={selectClass}>
            <option value="">Pessoal e corporativa</option>
            <option value="personal">Só pessoal</option>
            <option value="corporate">Só corporativa</option>
          </select>
          <input type="date" value={filters.dueFrom ?? ''} onChange={e => onFiltersChange({ ...filters, dueFrom: e.target.value || undefined })} className={selectClass} />
          <input type="date" value={filters.dueTo ?? ''} onChange={e => onFiltersChange({ ...filters, dueTo: e.target.value || undefined })} className={selectClass} />
        </div>
        <Button onClick={onCreateCorporate} size="sm"><Plus size={14} />Nova tarefa corporativa</Button>
      </div>

      {overdueCount > 0 && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-sm">
          <AlertCircle size={16} />{overdueCount} tarefa(s) atrasada(s) na empresa.
        </div>
      )}

      <div className="bg-surface-2 rounded-xl border border-edge">
        <button onClick={() => setShowWorkload(v => !v)} className="w-full flex items-center justify-between p-4 text-left">
          <span className="font-bold text-fg text-sm flex items-center gap-2"><Users size={16} className="text-fg-subtle" />Carga de trabalho</span>
          <span className="text-xs text-fg-subtle">{showWorkload ? 'Ocultar' : 'Mostrar'}</span>
        </button>
        {showWorkload && (
          <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {workload.length === 0 ? (
              <p className="text-xs text-fg-subtle col-span-full">Ninguém com tarefas ativas no momento.</p>
            ) : workload.map(w => (
              <div key={w.userId} className="p-3 bg-surface-3 rounded-lg">
                <p className="text-sm font-semibold text-fg truncate">{memberLabel(teamMembers, w.userId)}</p>
                <p className="text-xs text-fg-subtle">{w.active} ativa(s){w.overdue > 0 && <span className="text-red-600 dark:text-red-400"> · {w.overdue} atrasada(s)</span>}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-surface-2 rounded-xl border border-edge p-5">
        <h2 className="font-bold text-fg text-sm mb-4">Tarefas da empresa ({tasks.length})</h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-fg-subtle text-center py-8">Nenhuma tarefa para os filtros aplicados.</p>
        ) : (
          <div className="space-y-2">
            {tasks.map(t => <TaskCard key={t.id} task={t} currentUserId={currentUserId} onOpen={() => onOpenTask(t.id)} />)}
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamView;
