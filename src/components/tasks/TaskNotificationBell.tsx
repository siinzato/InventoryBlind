import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { TaskNotification } from '../../lib/tasks/types';
import { notifyPanelOpened, registerExclusivePanel } from '../../lib/exclusivePanel';
import { TaskNotificationPopover } from './TaskNotificationPopover';

interface TaskNotificationBellProps {
  notifications: TaskNotification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onOpenTask: (taskId: string) => void;
}

const PANEL_ID = 'task-notifications';

/** Sino do cabeçalho global, exclusivo das notificações pessoais de tarefas —
 *  canal independente do ícone de comunicados gerais (WhatsNewButton). Abrir
 *  um fecha o outro (ver lib/exclusivePanel.ts); os dados/contadores de cada
 *  canal nunca se misturam. Sem e-mail/push/WhatsApp nesta versão. */
export const TaskNotificationBell: React.FC<TaskNotificationBellProps> = ({
  notifications, unreadCount, onMarkRead, onMarkAllRead, onOpenTask,
}) => {
  const [open, setOpen] = useState(false);

  useEffect(() => registerExclusivePanel(PANEL_ID, () => setOpen(false)), []);

  const handleToggle = () => {
    setOpen(v => {
      const next = !v;
      if (next) notifyPanelOpened(PANEL_ID);
      return next;
    });
  };

  return (
    <div className="relative">
      <button
        onClick={handleToggle}
        aria-label="Notificações das tarefas"
        title="Notificações das tarefas"
        className="relative w-8 h-8 rounded-control flex items-center justify-center text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <TaskNotificationPopover
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={onMarkRead}
            onMarkAllRead={onMarkAllRead}
            onOpenTask={onOpenTask}
            onClose={() => setOpen(false)}
          />
        </>
      )}
    </div>
  );
};

export default TaskNotificationBell;
