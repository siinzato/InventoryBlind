import React from 'react';
import {
  Check, UserPlus, MessageSquare, CalendarClock, AlarmClock, AlertTriangle,
  LifeBuoy, Reply, CheckCircle2, RotateCcw,
} from 'lucide-react';
import type { FeedItem } from '../../lib/notifications/notificationFeed';
import { formatRelativeTime } from '../../lib/tasks/taskDomain';

interface NotificationPopoverProps {
  items: FeedItem[];
  unreadCount: number;
  onMarkRead: (item: FeedItem) => void;
  onMarkAllRead: () => void;
  onOpen: (item: FeedItem) => void;
  onClose: () => void;
}

const TASK_ICON: Record<string, React.ReactNode> = {
  assigned: <UserPlus size={14} className="text-accent" />,
  due_date_changed: <CalendarClock size={14} className="text-amber-500" />,
  commented: <MessageSquare size={14} className="text-fg-muted" />,
  due_soon: <AlarmClock size={14} className="text-amber-500" />,
  overdue: <AlertTriangle size={14} className="text-red-500" />,
};

const SUPPORT_ICON: Record<string, React.ReactNode> = {
  aberto: <LifeBuoy size={14} className="text-accent" />,
  respondido: <Reply size={14} className="text-accent" />,
  mensagem: <MessageSquare size={14} className="text-fg-muted" />,
  resolvido: <CheckCircle2 size={14} className="text-emerald-500" />,
  reaberto: <RotateCcw size={14} className="text-amber-500" />,
};

function iconFor(item: FeedItem): React.ReactNode {
  const map = item.source === 'support' ? SUPPORT_ICON : TASK_ICON;
  return map[item.kind] ?? <MessageSquare size={14} className="text-fg-muted" />;
}

/** Conteúdo do sino pessoal — separado do botão para o clique/estado de
 *  abertura ficar só em TaskNotificationBell.tsx.
 *
 *  Atende tarefas E chamados de suporte. Os canais continuam separados onde
 *  importa (tabelas, policies, serviços); o que se junta é a apresentação,
 *  porque dois sinos lado a lado fazem o usuário conferir os dois — e é assim
 *  que um deles passa a ser ignorado. Continua sem misturar com o painel de
 *  comunicados gerais (WhatsNewPanel), que não é aviso pessoal. */
export const TaskNotificationPopover: React.FC<NotificationPopoverProps> = ({
  items, unreadCount, onMarkRead, onMarkAllRead, onOpen, onClose,
}) => {
  const handleClick = (item: FeedItem) => {
    if (!item.readAt) onMarkRead(item);
    onClose();
    onOpen(item);
  };

  const missing = (item: FeedItem) =>
    item.target.kind === 'task' ? !item.target.taskId : !item.target.ticketId;

  return (
    <div className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[90vw] bg-surface border border-edge rounded-lg shadow-panel max-h-96 overflow-y-auto">
      <div className="sticky top-0 bg-surface flex items-center justify-between px-4 py-3 border-b border-edge">
        <p className="text-sm font-bold text-fg">Notificações</p>
        {unreadCount > 0 && (
          <button onClick={onMarkAllRead} className="text-xs text-accent hover:text-accent-strong flex items-center gap-1 flex-shrink-0">
            <Check size={12} />Marcar todas como lidas
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-fg-subtle text-center py-8">Nenhuma notificação</p>
      ) : items.map(item => (
        <button key={item.key} onClick={() => handleClick(item)}
          className={`w-full text-left px-4 py-3 border-b border-edge/60 last:border-0 hover:bg-surface-3 flex items-start gap-2 ${!item.readAt ? 'bg-accent/5' : ''}`}>
          <span className="mt-0.5 flex-shrink-0">{iconFor(item)}</span>
          <div className="min-w-0">
            <p className={`text-sm ${!item.readAt ? 'font-semibold text-fg' : 'text-fg-muted'}`}>{item.message}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-fg-subtle">{formatRelativeTime(item.createdAt)}</p>
              {missing(item) && (
                <p className="text-xs text-fg-subtle italic">
                  · {item.source === 'support' ? 'chamado' : 'tarefa'} não está mais disponível
                </p>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
};

export default TaskNotificationPopover;
