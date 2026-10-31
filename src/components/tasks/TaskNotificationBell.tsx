import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import type { FeedItem } from '../../lib/notifications/notificationFeed';
import { notifyPanelOpened, registerExclusivePanel } from '../../lib/exclusivePanel';
import { TaskNotificationPopover } from './TaskNotificationPopover';

interface NotificationBellProps {
  items: FeedItem[];
  unreadCount: number;
  onMarkRead: (item: FeedItem) => void;
  onMarkAllRead: () => void;
  onOpen: (item: FeedItem) => void;
}

const PANEL_ID = 'task-notifications';

/** Sino do cabeçalho global — avisos pessoais de tarefas E de chamados de
 *  suporte, num canal só. Independente do ícone de comunicados gerais
 *  (WhatsNewButton), que não é pessoal; abrir um fecha o outro (ver
 *  lib/exclusivePanel.ts). Sem e-mail/push/WhatsApp nesta versão.
 *
 *  O arquivo mantém o nome por onde já era importado: mover o módulo renomearia
 *  arquivos de tarefas que outra sessão pode estar editando em paralelo, e o
 *  ganho seria só o nome. */
export const TaskNotificationBell: React.FC<NotificationBellProps> = ({
  items, unreadCount, onMarkRead, onMarkAllRead, onOpen,
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
        aria-label="Notificações"
        title="Notificações"
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
            items={items}
            unreadCount={unreadCount}
            onMarkRead={onMarkRead}
            onMarkAllRead={onMarkAllRead}
            onOpen={onOpen}
            onClose={() => setOpen(false)}
          />
        </>
      )}
    </div>
  );
};

export default TaskNotificationBell;
