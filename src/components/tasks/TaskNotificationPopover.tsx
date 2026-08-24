import React from 'react';
import { Check, UserPlus, MessageSquare, CalendarClock, AlarmClock, AlertTriangle } from 'lucide-react';
import { TaskNotification } from '../../lib/tasks/types';
import { formatRelativeTime } from '../../lib/tasks/taskDomain';

interface TaskNotificationPopoverProps {
  notifications: TaskNotification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onOpenTask: (taskId: string) => void;
  onClose: () => void;
}

const TYPE_ICON: Record<TaskNotification['type'], React.ReactNode> = {
  assigned: <UserPlus size={14} className="text-accent" />,
  due_date_changed: <CalendarClock size={14} className="text-amber-500" />,
  commented: <MessageSquare size={14} className="text-fg-muted" />,
  due_soon: <AlarmClock size={14} className="text-amber-500" />,
  overdue: <AlertTriangle size={14} className="text-red-500" />,
};

/** Conteúdo do sino de tarefas — separado do botão para o clique/estado de
 *  abertura ficar só em TaskNotificationBell.tsx. Canal exclusivamente de
 *  tarefas: nunca mistura com o painel de comunicados gerais (WhatsNewPanel). */
export const TaskNotificationPopover: React.FC<TaskNotificationPopoverProps> = ({
  notifications, unreadCount, onMarkRead, onMarkAllRead, onOpenTask, onClose,
}) => {
  const handleClick = (n: TaskNotification) => {
    if (!n.read_at) onMarkRead(n.id);
    onClose();
    if (n.task_id) onOpenTask(n.task_id);
  };

  return (
    <div className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[90vw] bg-surface border border-edge rounded-lg shadow-panel max-h-96 overflow-y-auto">
      <div className="sticky top-0 bg-surface flex items-center justify-between px-4 py-3 border-b border-edge">
        <p className="text-sm font-bold text-fg">Notificações das tarefas</p>
        {unreadCount > 0 && (
          <button onClick={onMarkAllRead} className="text-xs text-accent hover:text-accent-strong flex items-center gap-1 flex-shrink-0">
            <Check size={12} />Marcar todas como lidas
          </button>
        )}
      </div>
      {notifications.length === 0 ? (
        <p className="text-sm text-fg-subtle text-center py-8">Nenhuma notificação de tarefa</p>
      ) : notifications.map(n => (
        <button key={n.id} onClick={() => handleClick(n)}
          className={`w-full text-left px-4 py-3 border-b border-edge/60 last:border-0 hover:bg-surface-3 flex items-start gap-2 ${!n.read_at ? 'bg-accent/5' : ''}`}>
          <span className="mt-0.5 flex-shrink-0">{TYPE_ICON[n.type]}</span>
          <div className="min-w-0">
            <p className={`text-sm ${!n.read_at ? 'font-semibold text-fg' : 'text-fg-muted'}`}>{n.message}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-fg-subtle">{formatRelativeTime(n.created_at)}</p>
              {!n.task_id && <p className="text-xs text-fg-subtle italic">· tarefa não está mais disponível</p>}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
};

export default TaskNotificationPopover;
