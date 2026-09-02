import React, { useState } from 'react';
import {
  Lock, PlayCircle, PauseCircle, CheckCircle2, Ban, Unlock, MoreVertical, Circle,
  ArrowDown, Minus, ArrowUp, AlertTriangle, MapPin, ListChecks, Paperclip,
} from 'lucide-react';
import { Badge } from '../ui';
import { TaskWithAssignees, AssigneeStatus, TaskPriority, TaskStatus, BlockReason, BLOCK_REASONS } from '../../lib/tasks/types';
import {
  findMyAssignment, formatAssigneeProgress, formatTaskTimeline, isOverdue,
  canTransitionAssigneeStatus, TASK_STATUS_LABEL, TASK_PRIORITY_LABEL, BLOCK_REASON_LABEL, formatDuration,
} from '../../lib/tasks/taskDomain';

interface TaskCardProps {
  task: TaskWithAssignees;
  currentUserId: string;
  onOpen: () => void;
  onChangeMyStatus?: (status: AssigneeStatus) => void;
  onPause?: (note?: string) => void;
  onResume?: () => void;
  onBlock?: (reason: BlockReason, note?: string) => void;
  onUnblock?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}

type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const PRIORITY_META: Record<TaskPriority, { badge: BadgeVariant; icon: React.ReactNode }> = {
  low: { badge: 'neutral', icon: <ArrowDown size={11} /> },
  medium: { badge: 'accent', icon: <Minus size={11} /> },
  high: { badge: 'warning', icon: <ArrowUp size={11} /> },
  urgent: { badge: 'danger', icon: <AlertTriangle size={11} /> },
};

const STATUS_BADGE: Record<TaskStatus, BadgeVariant> = {
  todo: 'neutral', in_progress: 'accent', paused: 'warning', blocked: 'danger',
  done: 'success', validated: 'success', cancelled: 'neutral',
};

/** "Iniciada há 1h20" — tempo corrido desde o início desta participação (não
 *  exclui pausas: essa quebra fina vive no detalhe da tarefa, que já carrega
 *  os segmentos; aqui, na listagem, seria N+1 buscar segmento por card. */
function formatSinceStarted(startedAt: string | null, nowMs: number): string | null {
  if (!startedAt) return null;
  const seconds = Math.max(0, (nowMs - new Date(startedAt).getTime()) / 1000);
  return `Iniciada há ${formatDuration(seconds)}`;
}

/** Reaproveitado por Meu Dia, Kanban, Agenda e Equipe — a mesma leitura visual
 *  em todas as visões. Prioridade e status sempre em cor + ícone + texto
 *  (nunca só uma bolinha), e contexto logístico suficiente para decidir sem
 *  precisar abrir a tarefa. */
export const TaskCard: React.FC<TaskCardProps> = ({
  task, currentUserId, onOpen, onChangeMyStatus, onPause, onResume, onBlock, onUnblock, draggable, onDragStart,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pausePanel, setPausePanel] = useState(false);
  const [blockPanel, setBlockPanel] = useState(false);
  const [pauseNote, setPauseNote] = useState('');
  const [blockReason, setBlockReason] = useState<BlockReason | ''>('');
  const [blockNote, setBlockNote] = useState('');

  const now = Date.now();
  const mine = findMyAssignment(task.assignees, currentUserId);
  const progress = formatAssigneeProgress(task.assignees);
  const dueLabel = formatTaskTimeline(task, mine, now);
  const overdue = isOverdue(task, now, mine);
  const priorityMeta = PRIORITY_META[task.priority];
  const sinceStarted = mine?.status === 'in_progress' ? formatSinceStarted(mine.started_at, now) : null;

  const locationRange = task.location_from && task.location_to
    ? `${task.location_from}–${task.location_to}`
    : task.location_from || task.location_to || null;
  const metaParts = [task.category, task.area, locationRange].filter(Boolean) as string[];

  const closeMenus = () => { setMenuOpen(false); setPausePanel(false); setBlockPanel(false); };

  const confirmPause = () => { onPause?.(pauseNote.trim() || undefined); setPauseNote(''); closeMenus(); };
  const confirmBlock = () => {
    if (!blockReason) return;
    onBlock?.(blockReason, blockNote.trim() || undefined);
    setBlockReason(''); setBlockNote(''); closeMenus();
  };

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={`bg-surface-2 border rounded-lg p-3 cursor-pointer hover:border-accent/50 transition ${overdue ? 'border-red-500/40' : 'border-edge'}`}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant={priorityMeta.badge}>{priorityMeta.icon}{TASK_PRIORITY_LABEL[task.priority]}</Badge>
          <Badge variant={STATUS_BADGE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
        </div>
        <span
          className="flex items-center gap-1 text-[10px] font-bold uppercase text-fg-subtle bg-surface-3 px-1.5 py-0.5 rounded flex-shrink-0"
          title={task.type === 'corporate' ? 'Tarefa corporativa, atribuída pela gestão' : 'Tarefa pessoal'}
        >
          {task.type === 'corporate' && <Lock size={10} />}
          {task.type === 'corporate' ? 'Gestão' : 'Pessoal'}
        </span>
      </div>

      <p className="text-sm font-semibold text-fg mb-1">{task.title}</p>

      {metaParts.length > 0 && (
        <p className="text-xs text-fg-subtle mb-1.5 flex items-center gap-1">
          <MapPin size={11} className="flex-shrink-0" />{metaParts.join(' • ')}
        </p>
      )}

      <div className="flex items-center flex-wrap gap-2 text-xs text-fg-subtle mb-2">
        <span className={overdue ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>{dueLabel}</span>
        {task.estimated_duration_minutes != null && <span>· Estimativa: {task.estimated_duration_minutes}min</span>}
        {sinceStarted && <span>· {sinceStarted}</span>}
        {progress && <span>· {progress}</span>}
        {task.planned_quantity != null && (
          <span>· {task.executed_quantity ?? 0}/{task.planned_quantity}{task.quantity_unit ? ` ${task.quantity_unit}` : ''}</span>
        )}
        {task.checklistSummary && task.checklistSummary.total > 0 && (
          <span className="flex items-center gap-0.5"><ListChecks size={11} />{task.checklistSummary.done}/{task.checklistSummary.total}</span>
        )}
        {!!task.attachmentCount && (
          <span className="flex items-center gap-0.5"><Paperclip size={11} />{task.attachmentCount}</span>
        )}
      </div>

      {mine?.status === 'blocked' && mine.block_reason && (
        <div className="flex items-start gap-1.5 p-2 mb-2 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-xs">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          <span>Bloqueada: {BLOCK_REASON_LABEL[mine.block_reason]}{mine.block_note ? ` — ${mine.block_note}` : ''}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex -space-x-1.5">
          {task.assignees.slice(0, 4).map(a => (
            <div key={a.id} title={a.user_name ?? a.user_email ?? ''}
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-surface-2 ${
                a.status === 'done' ? 'bg-emerald-500 text-white'
                  : a.status === 'blocked' ? 'bg-red-500 text-white'
                  : a.status === 'paused' ? 'bg-amber-500 text-white'
                  : a.status === 'in_progress' ? 'bg-accent text-white' : 'bg-surface-3 text-fg-muted'}`}>
              {(a.user_name ?? a.user_email ?? '?').slice(0, 1).toUpperCase()}
            </div>
          ))}
        </div>

        {mine && (onChangeMyStatus || onPause || onResume || onBlock || onUnblock) && (
          <div className="relative flex items-center gap-1" onClick={e => e.stopPropagation()}>
            {mine.status === 'todo' && onChangeMyStatus && (
              <button onClick={() => onChangeMyStatus('in_progress')} className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-strong">
                <PlayCircle size={14} />Iniciar
              </button>
            )}
            {mine.status === 'in_progress' && onChangeMyStatus && (
              <button onClick={() => onChangeMyStatus('done')} className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:opacity-80">
                <CheckCircle2 size={14} />Concluir
              </button>
            )}
            {mine.status === 'paused' && onResume && (
              <button onClick={onResume} className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-strong">
                <PlayCircle size={14} />Retomar
              </button>
            )}
            {mine.status === 'blocked' && onUnblock && (
              <button onClick={onUnblock} className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:opacity-80">
                <Unlock size={14} />Desbloquear
              </button>
            )}
            {mine.status === 'done' && (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={14} />Concluído
              </span>
            )}

            {mine.status === 'in_progress' && (onPause || onBlock) && (
              <button onClick={() => setMenuOpen(v => !v)} className="p-1 text-fg-subtle hover:text-fg">
                <MoreVertical size={14} />
              </button>
            )}

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-edge rounded-lg shadow-panel py-1 w-44">
                {onPause && (
                  <button onClick={() => { setPausePanel(true); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 flex items-center gap-2 text-fg-muted">
                    <PauseCircle size={12} />Pausar
                  </button>
                )}
                {onBlock && (
                  <button onClick={() => { setBlockPanel(true); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 flex items-center gap-2 text-fg-muted">
                    <Ban size={12} />Bloquear
                  </button>
                )}
                {onChangeMyStatus && (['todo', 'in_progress', 'done'] as AssigneeStatus[])
                  .filter(s => canTransitionAssigneeStatus(mine.status, s))
                  .map(s => (
                    <button key={s} onClick={() => { onChangeMyStatus(s); setMenuOpen(false); }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 flex items-center gap-2 text-fg-muted">
                      <Circle size={12} />Mover para {TASK_STATUS_LABEL[s]}
                    </button>
                  ))}
              </div>
            )}

            {pausePanel && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-edge rounded-lg shadow-panel p-3 w-56 space-y-2">
                <p className="text-xs font-semibold text-fg">Pausar tarefa</p>
                <input value={pauseNote} onChange={e => setPauseNote(e.target.value)} placeholder="Motivo (opcional)"
                  className="w-full px-2 py-1.5 border border-edge rounded text-xs bg-surface text-fg" />
                <div className="flex gap-1.5">
                  <button onClick={confirmPause} className="flex-1 px-2 py-1 bg-accent text-white rounded text-xs font-semibold">Confirmar</button>
                  <button onClick={closeMenus} className="px-2 py-1 text-xs text-fg-muted">Cancelar</button>
                </div>
              </div>
            )}

            {blockPanel && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-edge rounded-lg shadow-panel p-3 w-60 space-y-2">
                <p className="text-xs font-semibold text-fg">Bloquear tarefa</p>
                <select value={blockReason} onChange={e => setBlockReason(e.target.value as BlockReason)}
                  className="w-full px-2 py-1.5 border border-edge rounded text-xs bg-surface text-fg">
                  <option value="">Selecione o motivo...</option>
                  {BLOCK_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {(blockReason === 'outro' || blockReason) && (
                  <input value={blockNote} onChange={e => setBlockNote(e.target.value)}
                    placeholder={blockReason === 'outro' ? 'Descreva o motivo (obrigatório)' : 'Observação (opcional)'}
                    className="w-full px-2 py-1.5 border border-edge rounded text-xs bg-surface text-fg" />
                )}
                <div className="flex gap-1.5">
                  <button onClick={confirmBlock} disabled={!blockReason || (blockReason === 'outro' && !blockNote.trim())}
                    className="flex-1 px-2 py-1 bg-red-600 text-white rounded text-xs font-semibold disabled:opacity-40">
                    Confirmar
                  </button>
                  <button onClick={closeMenus} className="px-2 py-1 text-xs text-fg-muted">Cancelar</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskCard;
