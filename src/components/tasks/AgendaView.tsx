import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, AlertCircle, CalendarDays } from 'lucide-react';
import { TaskWithAssignees, AssigneeStatus } from '../../lib/tasks/types';
import { TaskCard } from './TaskCard';

interface AgendaViewProps {
  tasks: TaskWithAssignees[];
  loading: boolean;
  error: string | null;
  currentUserId: string;
  onOpenTask: (id: string) => void;
  onChangeMyStatus: (taskId: string, status: AssigneeStatus) => void;
}

type AgendaMode = 'day' | 'week' | 'month';

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date { const c = new Date(d); c.setDate(c.getDate() + n); return c; }
function startOfWeek(d: Date): Date { const c = new Date(d); c.setDate(c.getDate() - c.getDay()); return c; }
function startOfMonthGrid(d: Date): Date { const first = new Date(d.getFullYear(), d.getMonth(), 1); return startOfWeek(first); }

/** Visão por data/horário — independente da agenda operacional do Full Manager (tabelas e telas distintas). */
export const AgendaView: React.FC<AgendaViewProps> = ({ tasks, loading, error, currentUserId, onOpenTask, onChangeMyStatus }) => {
  const [mode, setMode] = useState<AgendaMode>('week');
  const [reference, setReference] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, TaskWithAssignees[]>();
    tasks.forEach(t => {
      if (!t.due_date) return;
      const list = map.get(t.due_date) ?? [];
      list.push(t);
      map.set(t.due_date, list);
    });
    map.forEach(list => list.sort((a, b) => (a.due_time ?? '99:99').localeCompare(b.due_time ?? '99:99')));
    return map;
  }, [tasks]);

  const shiftReference = (dir: 1 | -1) => {
    setReference(prev => {
      if (mode === 'day') return addDays(prev, dir);
      if (mode === 'week') return addDays(prev, 7 * dir);
      return new Date(prev.getFullYear(), prev.getMonth() + dir, 1);
    });
  };

  const renderDayList = (date: Date) => {
    const iso = toISODate(date);
    const dayTasks = tasksByDate.get(iso) ?? [];
    return (
      <div className="space-y-2">
        {dayTasks.length === 0 ? (
          <p className="text-xs text-fg-subtle py-2">Nenhuma tarefa nesta data.</p>
        ) : dayTasks.map(t => (
          <TaskCard key={t.id} task={t} currentUserId={currentUserId} onOpen={() => onOpenTask(t.id)} onChangeMyStatus={s => onChangeMyStatus(t.id, s)} />
        ))}
      </div>
    );
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-fg-subtle gap-2"><RefreshCw size={20} className="animate-spin" />Carregando agenda...</div>;
  if (error) return <div className="flex items-center gap-2 p-4 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-sm"><AlertCircle size={16} />{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => shiftReference(-1)} className="p-2 border border-edge rounded-lg text-fg-muted hover:bg-surface-3"><ChevronLeft size={16} /></button>
          <p className="text-sm font-semibold text-fg min-w-[10rem] text-center">
            {mode === 'month'
              ? reference.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
              : mode === 'week'
                ? `Semana de ${toISODate(startOfWeek(reference)).split('-').reverse().join('/')}`
                : reference.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}
          </p>
          <button onClick={() => shiftReference(1)} className="p-2 border border-edge rounded-lg text-fg-muted hover:bg-surface-3"><ChevronRight size={16} /></button>
        </div>
        <div className="flex bg-surface-3 rounded-lg p-1 gap-1">
          {(['day', 'week', 'month'] as AgendaMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${mode === m ? 'bg-accent text-white' : 'text-fg-muted hover:text-fg'}`}>
              {m === 'day' ? 'Dia' : m === 'week' ? 'Semana' : 'Mês'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'day' && (
        <div className="bg-surface-2 rounded-xl border border-edge p-5">{renderDayList(reference)}</div>
      )}

      {mode === 'week' && (
        <div className="grid grid-cols-1 sm:grid-cols-7 gap-3">
          {Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(reference), i)).map(day => (
            <div key={toISODate(day)} className="bg-surface-2 rounded-xl border border-edge p-3">
              <p className="text-xs font-bold text-fg-subtle uppercase mb-2">{WEEKDAY_LABELS[day.getDay()]} {day.getDate()}</p>
              {renderDayList(day)}
            </div>
          ))}
        </div>
      )}

      {mode === 'month' && (
        <div className="bg-surface-2 rounded-xl border border-edge p-4">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEKDAY_LABELS.map(w => <p key={w} className="text-xs font-bold text-fg-subtle text-center">{w}</p>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 42 }, (_, i) => addDays(startOfMonthGrid(reference), i)).map(day => {
              const iso = toISODate(day);
              const count = (tasksByDate.get(iso) ?? []).length;
              const inMonth = day.getMonth() === reference.getMonth();
              return (
                <button key={iso} onClick={() => setSelectedDate(iso)}
                  className={`aspect-square rounded-lg p-1.5 text-left transition border ${selectedDate === iso ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-surface-3'} ${inMonth ? '' : 'opacity-40'}`}>
                  <p className="text-xs text-fg">{day.getDate()}</p>
                  {count > 0 && <span className="inline-block mt-1 text-[10px] font-bold bg-accent text-white rounded-full px-1.5">{count}</span>}
                </button>
              );
            })}
          </div>
          {selectedDate && (
            <div className="mt-4 pt-4 border-t border-edge">
              <p className="text-xs font-semibold text-fg-subtle uppercase mb-2">{selectedDate.split('-').reverse().join('/')}</p>
              {renderDayList(new Date(`${selectedDate}T00:00:00`))}
            </div>
          )}
        </div>
      )}

      {tasksByDate.size === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-fg-subtle">
          <CalendarDays size={32} className="mb-2 opacity-30" />
          <p className="text-sm">Nenhuma tarefa com data definida.</p>
        </div>
      )}
    </div>
  );
};

export default AgendaView;
