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

// `alertWhenPositive`: destaque (marcador discreto) só aparece quando o valor é > 0 —
// zero nunca é colorido. "Em execução" e "No prazo" são sempre neutros (não são exceções
// operacionais). Um único tom de alerta (âmbar) evita o "arco-íris semântico".
const INDICATOR_META: { key: Exclude<IndicatorFilter, 'today' | null>; label: string; alertWhenPositive: boolean }[] = [
  { key: 'overdue', label: 'Atrasadas', alertWhenPositive: true },
  { key: 'due_soon', label: 'Vencem em breve', alertWhenPositive: true },
  { key: 'blocked', label: 'Bloqueadas', alertWhenPositive: true },
  { key: 'in_progress', label: 'Em execução', alertWhenPositive: false },
  { key: 'done_on_time', label: 'No prazo', alertWhenPositive: false },
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
        case 'overdue': return isOverdue(t, now, mine);
        case 'due_soon': return mine.status !== 'done' && !isOverdue(t, now, mine) && isDueSoon(t, now, dueSoonThresholdMinutes);
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
      {/* Indicadores operacionais — uma única faixa, todos clicáveis, filtram a listagem
          abaixo. Uma faixa (não seis cards): um container, um radius discreto, divisores
          internos fazem a separação em vez de fundo/borda por métrica. */}
      <div className="rounded-lg border border-edge bg-surface-2 overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-edge">
          {INDICATOR_META.map(m => {
            const value = indicators[m.key === 'due_soon' ? 'dueSoon' : m.key === 'in_progress' ? 'inProgress' : m.key === 'done_on_time' ? 'doneOnTime' : m.key];
            const alert = m.alertWhenPositive && value > 0;
            return (
              <button key={m.key} onClick={() => setFilter(f => (f === m.key ? null : m.key))}
                className={`text-left px-4 py-3 transition-colors hover:bg-surface-3/50 ${filter === m.key ? 'bg-surface-3/70' : ''}`}>
                <p className="text-label">{m.label}</p>
                <p className="font-display text-xl font-semibold tabular-nums mt-1 text-fg flex items-center gap-1.5">
                  {value}
                  {alert && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 flex-shrink-0" aria-hidden="true" />
                  )}
                  {alert && <span className="sr-only">— requer atenção</span>}
                </p>
              </button>
            );
          })}
          <button onClick={() => setFilter(f => (f === 'today' ? null : 'today'))}
            className={`text-left px-4 py-3 transition-colors hover:bg-surface-3/50 ${filter === 'today' ? 'bg-surface-3/70' : ''}`}>
            <p className="text-label">Conclusão hoje</p>
            <p className="font-display text-xl font-semibold tabular-nums mt-1 text-fg">{indicators.progressPct}%</p>
            <p className="text-caption mt-0.5">{indicators.todayDone} de {indicators.todayTotal}</p>
          </button>
        </div>
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
