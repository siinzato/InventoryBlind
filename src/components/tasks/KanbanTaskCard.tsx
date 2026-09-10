import React from 'react';
import { PlayCircle, CheckCircle2, Lock, Archive, MapPin, Clock } from 'lucide-react';
import { TaskWithAssignees, AssigneeStatus } from '../../lib/tasks/types';
import { findMyAssignment, formatTaskTimeline, isOverdue, TASK_PRIORITY_LABEL } from '../../lib/tasks/taskDomain';

interface KanbanTaskCardProps {
  task: TaskWithAssignees;
  currentUserId: string;
  onOpen: () => void;
  onChangeMyStatus: (status: AssigneeStatus) => void;
  onArchive?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}

/** Cartão compacto do Kanban de "Meu Trabalho" — assinatura visual própria
 *  desta tela (linha de cor no topo por prioridade/status), deliberadamente
 *  mais enxuto que o TaskCard compartilhado (Meu Dia/Agenda/Equipe seguem
 *  usando TaskCard sem alteração). Cada informação aparece uma única vez:
 *  sem badge de prioridade duplicando a linha de cor, sem badge de status
 *  duplicando a coluna em que o card já está. */
const STRIPE: Record<'critical' | 'high' | 'normal' | 'done', string> = {
  critical: 'bg-red-500',
  high: 'bg-amber-500',
  normal: 'bg-accent',
  done: 'bg-emerald-500',
};

export const KanbanTaskCard: React.FC<KanbanTaskCardProps> = ({
  task, currentUserId, onOpen, onChangeMyStatus, onArchive, draggable, onDragStart,
}) => {
  const now = Date.now();
  const mine = findMyAssignment(task.assignees, currentUserId);
  const overdue = isOverdue(task, now, mine);
  const dueLabel = formatTaskTimeline(task, mine, now);

  const stripeKey: keyof typeof STRIPE = mine?.status === 'done'
    ? 'done'
    : task.priority === 'urgent' ? 'critical'
    : task.priority === 'high' ? 'high'
    : 'normal';

  const locationRange = task.location_from && task.location_to
    ? `${task.location_from}–${task.location_to}`
    : task.location_from || task.location_to || null;
  const metaParts = [task.category, locationRange].filter(Boolean) as string[];

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onOpen}
      className="bg-surface rounded-lg border border-edge overflow-hidden cursor-pointer hover:border-accent/40 transition"
    >
      <div className={`h-[3px] ${STRIPE[stripeKey]}`} />
      <div className="p-3">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className={`text-[11px] font-semibold ${
            stripeKey === 'critical' ? 'text-red-600 dark:text-red-400'
              : stripeKey === 'high' ? 'text-amber-600 dark:text-amber-400'
              : stripeKey === 'done' ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-accent'
          }`}>
            {mine?.status === 'done' ? 'Concluída' : TASK_PRIORITY_LABEL[task.priority]}
          </span>
          {task.type === 'corporate' && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-fg-subtle flex-shrink-0" title="Tarefa corporativa, atribuída pela gestão">
              <Lock size={10} />Gestão
            </span>
          )}
        </div>

        <p className="text-sm font-semibold text-fg mb-1 leading-snug">{task.title}</p>

        {metaParts.length > 0 && (
          <p className="text-xs text-fg-subtle mb-1 flex items-center gap-1">
            <MapPin size={11} className="flex-shrink-0" />{metaParts.join(' • ')}
          </p>
        )}

        <p className={`text-xs mb-2.5 flex items-center gap-1 ${overdue ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-fg-subtle'}`}>
          <Clock size={11} className="flex-shrink-0" />{dueLabel}
        </p>

        <div className="flex items-center justify-between gap-2">
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold bg-surface-3 text-fg-muted flex-shrink-0"
            title={mine?.user_name ?? mine?.user_email ?? ''}>
            {(mine?.user_name ?? mine?.user_email ?? '?').slice(0, 1).toUpperCase()}
          </div>

          {mine?.status === 'todo' && (
            <button onClick={e => { e.stopPropagation(); onChangeMyStatus('in_progress'); }}
              className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-strong">
              <PlayCircle size={14} />Iniciar
            </button>
          )}
          {mine?.status === 'in_progress' && (
            <button onClick={e => { e.stopPropagation(); onChangeMyStatus('done'); }}
              className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:opacity-80">
              <CheckCircle2 size={14} />Concluir
            </button>
          )}
          {mine?.status === 'done' && onArchive && (
            <button onClick={e => { e.stopPropagation(); onArchive(); }}
              className="flex items-center gap-1 text-xs font-semibold text-fg-subtle hover:text-fg" title="Arquivar agora">
              <Archive size={14} />Arquivar
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default KanbanTaskCard;
