import React, { useMemo, useState } from 'react';
import { AlertCircle, RefreshCw, Sun, X } from 'lucide-react';
import { TaskWithAssignees, AssigneeStatus, BlockReason } from '../../lib/tasks/types';
import {
  groupTasksForMyDay, computeOperationalIndicators, isOverdue, isDueSoon, computeDueTimestamp,
  findMyAssignment,
} from '../../lib/tasks/taskDomain';
import { TaskCard } from './TaskCard';
import { FacaAgoraCard } from './FacaAgoraCard';
import { CollapsibleGroup } from './CollapsibleGroup';

interface MyDayViewProps {
  tasks: TaskWithAssignees[];
  loading: boolean;
  error: string | null;
  currentUserId: string;
  dueSoonThresholdMinutes: number;
  onOpenTask: (id: string) => void;
  onChangeMyStatus: (taskId: string, status: AssigneeStatus) => void;
  onPause: (taskId: string, note?: string) => void;
  onResume: (taskId: string) => void;
  onBlock: (taskId: string, reason: BlockReason, note?: string) => void;
  onUnblock: (taskId: string) => void;
}

type IndicatorFilter = 'overdue' | 'due_soon' | 'blocked' | 'in_progress' | 'done_on_time' | 'today' | null;

const INDICATOR_META: { key: Exclude<IndicatorFilter, null>; label: string; tone: string }[] = [
  { key: 'overdue', label: 'Atrasadas', tone: 'text-red-600 dark:text-red-400' },
  { key: 'due_soon', label: 'Vencem em breve', tone: 'text-amber-600 dark:text-amber-400' },
  { key: 'blocked', label: 'Bloqueadas', tone: 'text-red-600 dark:text-red-400' },
  { key: 'in_progress', label: 'Em execução', tone: 'text-accent' },
  { key: 'done_on_time', label: 'Concluídas no prazo', tone: 'text-emerald-600 dark:text-emerald-400' },
];

export const MyDayView: React.FC<MyDayViewProps> = ({
  tasks, loading, error, currentUserId, dueSoonThresholdMinutes, onOpenTask, onChangeMyStatus, onPause, onResume, onBlock, onUnblock,
}) => {
  const [filter, setFilter] = useState<IndicatorFilter>(null);
  const now = Date.now();
  const today = useMemo(() => new Date(now).toISOString().slice(0, 10), [now]);

  const indicators = useMemo(() => computeOperationalIndicators(tasks, currentUserId, now, dueSoonThresholdMinutes), [tasks, currentUserId, now, dueSoonThresholdMinutes]);
  const groups = useMemo(() => groupTasksForMyDay(tasks, currentUserId, today), [tasks, currentUserId, today]);

  const cardProps = (t: TaskWithAssignees) => ({
    task: t, currentUserId, onOpen: () => onOpenTask(t.id),
    onChangeMyStatus: (s: AssigneeStatus) => onChangeMyStatus(t.id, s),
    onPause: (note?: string) => onPause(t.id, note),
    onResume: () => onResume(t.id),
    onBlock: (reason: BlockReason, note?: string) => onBlock(t.id, reason, note),
    onUnblock: () => onUnblock(t.id),
  });

  const filteredTasks = useMemo(() => {
    if (!filter) return null;
    return tasks.filter(t => {
      if (t.status === 'cancelled') return false;
      const mine = findMyAssignment(t.assignees, currentUserId);
      if (!mine) return false;
      switch (filter) {
        case 'overdue': return mine.status !== 'done' && isOverdue(t, now);
        case 'due_soon': return mine.status !== 'done' && !isOverdue(t, now) && isDueSoon(t, now, dueSoonThresholdMinutes);
        case 'blocked': return mine.status === 'blocked';
        case 'in_progress': return mine.status === 'in_progress';
        case 'today': return !t.due_date || t.due_date <= today;
        case 'done_on_time': {
          if (mine.status !== 'done') return false;
          const due = computeDueTimestamp(t.due_date, t.due_time);
          return !due || (!!mine.completed_at && new Date(mine.completed_at).getTime() <= due.getTime());
        }
        default: return true;
      }
    });
  }, [filter, tasks, currentUserId, now, dueSoonThresholdMinutes, today]);

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-fg-subtle gap-2"><RefreshCw size={20} className="animate-spin" />Carregando seu dia...</div>;
  }
  if (error) {
    return <div className="flex items-center gap-2 p-4 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-sm"><AlertCircle size={16} />{error}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Indicadores operacionais — todos clicáveis, filtram a listagem abaixo */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {INDICATOR_META.map(m => (
          <button key={m.key} onClick={() => setFilter(f => (f === m.key ? null : m.key))}
            className={`bg-surface-2 rounded-xl border p-3 text-center transition ${filter === m.key ? 'border-accent ring-1 ring-accent/40' : 'border-edge hover:border-accent/40'}`}>
            <p className={`text-xl font-bold ${m.tone}`}>{indicators[m.key === 'due_soon' ? 'dueSoon' : m.key === 'in_progress' ? 'inProgress' : m.key === 'done_on_time' ? 'doneOnTime' : m.key]}</p>
            <p className="text-xs text-fg-subtle">{m.label}</p>
          </button>
        ))}
        <button onClick={() => setFilter(f => (f === 'today' ? null : 'today'))}
          className={`bg-surface-2 rounded-xl border p-3 text-center transition ${filter === 'today' ? 'border-accent ring-1 ring-accent/40' : 'border-edge hover:border-accent/40'}`}>
          <p className="text-xl font-bold text-fg">{indicators.progressPct}%</p>
          <p className="text-xs text-fg-subtle">{indicators.todayDone} de {indicators.todayTotal} hoje</p>
        </button>
      </div>

      {filter ? (
        <div className="space-y-3">
          <button onClick={() => setFilter(null)} className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent-strong">
            <X size={13} />Limpar filtro
          </button>
          {(filteredTasks ?? []).length === 0 ? (
            <p className="text-sm text-fg-subtle text-center py-8">Nenhuma tarefa neste filtro.</p>
          ) : (
            <div className="space-y-2">
              {(filteredTasks ?? []).map(t => <TaskCard key={t.id} {...cardProps(t)} />)}
            </div>
          )}
        </div>
      ) : (
        <>
          <FacaAgoraCard
            tasks={tasks} currentUserId={currentUserId} nowMs={now} dueSoonThresholdMinutes={dueSoonThresholdMinutes}
            onOpenTask={onOpenTask} onChangeMyStatus={onChangeMyStatus} onPause={onPause} onResume={onResume} onBlock={onBlock} onUnblock={onUnblock}
          />

          {Object.values(groups).every(g => g.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-16 text-fg-subtle bg-surface-2 rounded-xl border border-edge">
              <Sun size={40} className="mb-3 opacity-30" />
              <p className="text-sm">Nenhuma tarefa pendente — bom trabalho!</p>
            </div>
          ) : (
            <div className="space-y-3">
              <CollapsibleGroup title="Em execução" count={groups.inProgress.length} tone="text-accent">
                {groups.inProgress.map(t => <TaskCard key={t.id} {...cardProps(t)} />)}
              </CollapsibleGroup>
              <CollapsibleGroup title="Bloqueadas" count={groups.blocked.length} tone="text-red-600 dark:text-red-400">
                {groups.blocked.map(t => <TaskCard key={t.id} {...cardProps(t)} />)}
              </CollapsibleGroup>
              <CollapsibleGroup title="Atrasadas" count={groups.overdue.length} tone="text-red-600 dark:text-red-400">
                {groups.overdue.map(t => <TaskCard key={t.id} {...cardProps(t)} />)}
              </CollapsibleGroup>
              <CollapsibleGroup title="Hoje" count={groups.today.length}>
                {groups.today.map(t => <TaskCard key={t.id} {...cardProps(t)} />)}
              </CollapsibleGroup>
              <CollapsibleGroup title="Próximas" count={groups.upcoming.length}>
                {groups.upcoming.map(t => <TaskCard key={t.id} {...cardProps(t)} />)}
              </CollapsibleGroup>
              <CollapsibleGroup title="Sem prazo" count={groups.noDate.length} defaultOpen={false}>
                {groups.noDate.map(t => <TaskCard key={t.id} {...cardProps(t)} />)}
              </CollapsibleGroup>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MyDayView;
