import React, { useRef, useState } from 'react';
import {
  Lock, PlayCircle, CheckCircle2, Trash2, Ban, Pencil, Paperclip, Send, Download, RefreshCw, AlertTriangle,
} from 'lucide-react';
import { Button, Badge } from '../ui';
import { Role } from '../../lib/permissionService';
import { TeamMember } from '../../lib/tasks/types';
import {
  canEditTaskStructure, canDeleteTask, canCancelTask, canChangeMyStatus, findMyAssignment,
  groupAssigneesByStatus, TASK_STATUS_LABEL, ASSIGNEE_STATUS_LABEL, TASK_PRIORITY_LABEL,
} from '../../lib/tasks/taskDomain';
import { useTaskDetail } from '../../lib/tasks/hooks';
import {
  setMyTaskStatus, cancelTask, deletePersonalTask, toggleChecklistItem, addComment,
  uploadAttachment, getAttachmentUrl, TaskServiceError,
} from '../../lib/tasks/taskService';

interface TaskDetailModalProps {
  taskId: string;
  currentUserId: string;
  companyId: string;
  role: Role | string | undefined;
  teamMembers: TeamMember[];
  onClose: () => void;
  onChanged: () => void;
  onEdit: () => void;
}

function memberName(members: TeamMember[], id: string): string {
  const m = members.find(x => x.id === id);
  return m?.name || m?.email || 'Usuário';
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  taskId, currentUserId, companyId, role, teamMembers, onClose, onChanged, onEdit,
}) => {
  const { detail, loading, error, reload } = useTaskDetail(taskId);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelBox, setShowCancelBox] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setActionError(null);
    try { await fn(); await reload(); onChanged(); }
    catch (err) { setActionError(err instanceof TaskServiceError ? err.message : 'Ação não permitida.'); }
    finally { setBusy(false); }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center p-4">
        <div className="bg-surface rounded-sheet p-8 flex items-center gap-3 text-fg-muted"><RefreshCw size={18} className="animate-spin" />Carregando...</div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-surface rounded-sheet p-6 max-w-sm text-center" onClick={e => e.stopPropagation()}>
          <AlertTriangle size={24} className="mx-auto mb-2 text-red-500" />
          <p className="text-sm text-fg-muted mb-4">{error ?? 'Tarefa não encontrada.'}</p>
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    );
  }

  const { task, assignees, checklist, comments, attachments, activity } = detail;
  const mine = findMyAssignment(assignees, currentUserId);
  const grouped = groupAssigneesByStatus(assignees);
  const canEdit = canEditTaskStructure(task, role, currentUserId);
  const canDelete = canDeleteTask(task, currentUserId);
  const canCancel = canCancelTask(task, role);
  const canChangeStatus = canChangeMyStatus(task, assignees, currentUserId);
  const canComment = canEdit || !!mine || canEditTaskStructure({ ...task, type: 'corporate' }, role, currentUserId);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await run(async () => { await uploadAttachment(task.id, companyId, currentUserId, file); });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownload = async (path: string) => {
    const url = await getAttachmentUrl(path);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-[2000] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-surface w-full sm:max-w-2xl sm:rounded-sheet min-h-screen sm:min-h-0 sm:max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-surface border-b border-edge p-5 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant={task.status === 'done' ? 'success' : task.status === 'cancelled' ? 'danger' : task.status === 'in_progress' ? 'accent' : 'neutral'}>
                {TASK_STATUS_LABEL[task.status]}
              </Badge>
              {task.type === 'corporate' && <Badge variant="neutral"><Lock size={10} className="inline mr-1" />Corporativa</Badge>}
              <Badge variant="neutral">{TASK_PRIORITY_LABEL[task.priority]}</Badge>
            </div>
            <h2 className="text-lg font-bold text-fg">{task.title}</h2>
          </div>
          <button onClick={onClose} className="text-fg-subtle hover:text-fg flex-shrink-0">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {task.description && <p className="text-sm text-fg-muted whitespace-pre-wrap">{task.description}</p>}

          {task.status === 'cancelled' && task.cancellation_reason && (
            <div className="p-3 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-sm">Cancelada: {task.cancellation_reason}</div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><p className="text-xs text-fg-subtle uppercase">Categoria</p><p className="text-fg">{task.category || '—'}</p></div>
            <div><p className="text-xs text-fg-subtle uppercase">Data</p><p className="text-fg">{task.due_date ? task.due_date.split('-').reverse().join('/') : '—'}</p></div>
            <div><p className="text-xs text-fg-subtle uppercase">Horário</p><p className="text-fg">{task.due_time ? task.due_time.slice(0, 5) : '—'}</p></div>
            <div><p className="text-xs text-fg-subtle uppercase">Criado por</p><p className="text-fg truncate">{memberName(teamMembers, task.created_by)}</p></div>
          </div>

          {/* PROGRESSO POR RESPONSÁVEL — nunca depende só do status global */}
          <div>
            <p className="text-xs font-semibold text-fg-subtle uppercase mb-2">Responsáveis ({assignees.length})</p>
            <div className="space-y-1.5">
              {assignees.map(a => (
                <div key={a.id} className="flex items-center justify-between gap-2 p-2 bg-surface-3 rounded-lg text-sm">
                  <span className="text-fg truncate">{a.user_name || a.user_email || memberName(teamMembers, a.user_id)}</span>
                  <Badge variant={a.status === 'done' ? 'success' : a.status === 'in_progress' ? 'accent' : 'neutral'}>{ASSIGNEE_STATUS_LABEL[a.status]}</Badge>
                </div>
              ))}
            </div>
            {assignees.length > 1 && (
              <p className="text-xs text-fg-subtle mt-1.5">
                {grouped.completed.length} de {assignees.length} concluíram · {grouped.inProgress.length} executando · {grouped.notStarted.length} não iniciaram
              </p>
            )}
          </div>

          {/* CHECKLIST */}
          {checklist.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-fg-subtle uppercase mb-2">Checklist ({checklist.filter(c => c.is_done).length}/{checklist.length})</p>
              <div className="space-y-1">
                {checklist.map(item => (
                  <label key={item.id} className="flex items-center gap-2 py-1 cursor-pointer">
                    <input type="checkbox" checked={item.is_done} disabled={busy}
                      onChange={e => run(() => toggleChecklistItem(item.id, e.target.checked))}
                      className="accent-accent w-4 h-4" />
                    <span className={`text-sm ${item.is_done ? 'line-through text-fg-subtle' : 'text-fg'}`}>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* AÇÕES */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-edge">
            {canChangeStatus && mine?.status === 'todo' && (
              <Button size="sm" onClick={() => run(() => setMyTaskStatus(task.id, 'in_progress'))} disabled={busy}><PlayCircle size={14} />Iniciar</Button>
            )}
            {canChangeStatus && mine?.status === 'in_progress' && (
              <Button size="sm" onClick={() => run(() => setMyTaskStatus(task.id, 'done'))} disabled={busy}><CheckCircle2 size={14} />Concluir</Button>
            )}
            {canEdit && <Button size="sm" variant="secondary" onClick={onEdit}><Pencil size={14} />Editar</Button>}
            {canCancel && !showCancelBox && <Button size="sm" variant="secondary" onClick={() => setShowCancelBox(true)}><Ban size={14} />Cancelar tarefa</Button>}
            {canDelete && (
              <Button size="sm" variant="danger" onClick={() => run(async () => { await deletePersonalTask(task.id); onClose(); })} disabled={busy}>
                <Trash2 size={14} />Excluir
              </Button>
            )}
          </div>

          {showCancelBox && (
            <div className="p-3 bg-surface-3 rounded-lg space-y-2">
              <input value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Motivo do cancelamento"
                className="w-full px-3 py-2 border border-edge rounded-lg text-sm bg-surface text-fg" />
              <div className="flex gap-2">
                <Button size="sm" variant="danger" onClick={() => run(() => cancelTask(task.id, cancelReason))} disabled={busy}>Confirmar cancelamento</Button>
                <Button size="sm" variant="secondary" onClick={() => setShowCancelBox(false)}>Voltar</Button>
              </div>
            </div>
          )}

          {actionError && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-sm">
              <AlertTriangle size={16} className="flex-shrink-0" />{actionError}
            </div>
          )}

          {/* ANEXOS */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-fg-subtle uppercase">Comprovantes/anexos</p>
              <button onClick={() => fileInputRef.current?.click()} className="text-xs font-semibold text-accent hover:text-accent-strong flex items-center gap-1">
                <Paperclip size={12} />Anexar
              </button>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,application/pdf" className="hidden" onChange={handleFileChange} />
            </div>
            {attachments.length === 0 ? (
              <p className="text-xs text-fg-subtle">Nenhum anexo ainda.</p>
            ) : (
              <div className="space-y-1">
                {attachments.map(a => (
                  <button key={a.id} onClick={() => handleDownload(a.storage_path)}
                    className="w-full flex items-center justify-between gap-2 p-2 bg-surface-3 rounded-lg text-sm hover:bg-edge text-left">
                    <span className="truncate text-fg">{a.file_name}</span>
                    <Download size={14} className="text-fg-subtle flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* COMENTÁRIOS */}
          <div>
            <p className="text-xs font-semibold text-fg-subtle uppercase mb-2">Comentários</p>
            <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
              {comments.length === 0 ? (
                <p className="text-xs text-fg-subtle">Nenhum comentário ainda.</p>
              ) : comments.map(c => (
                <div key={c.id} className="p-2 bg-surface-3 rounded-lg">
                  <p className="text-xs font-semibold text-fg">{c.user_name || 'Usuário'}</p>
                  <p className="text-sm text-fg-muted">{c.body}</p>
                </div>
              ))}
            </div>
            {canComment && (
              <div className="flex gap-2">
                <input value={commentBody} onChange={e => setCommentBody(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && commentBody.trim() && run(async () => { await addComment(task.id, companyId, currentUserId, commentBody.trim()); setCommentBody(''); })}
                  className="flex-1 px-3 py-2 border border-edge rounded-lg text-sm bg-surface text-fg" placeholder="Escreva um comentário..." />
                <Button size="sm" disabled={!commentBody.trim() || busy}
                  onClick={() => run(async () => { await addComment(task.id, companyId, currentUserId, commentBody.trim()); setCommentBody(''); })}>
                  <Send size={14} />
                </Button>
              </div>
            )}
          </div>

          {/* HISTÓRICO */}
          {activity.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-fg-subtle uppercase mb-2">Histórico</p>
              <div className="space-y-1 text-xs text-fg-subtle max-h-40 overflow-y-auto">
                {activity.map(a => (
                  <p key={a.id}>
                    <span className="font-medium text-fg-muted">{a.user_name || 'Sistema'}</span> — {ACTIVITY_LABEL[a.action] ?? a.action} · {new Date(a.created_at).toLocaleString('pt-BR')}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ACTIVITY_LABEL: Record<string, string> = {
  created: 'criou a tarefa', edited: 'editou a tarefa', assigned: 'atribuiu um responsável',
  reassigned: 'alterou os responsáveis', started: 'iniciou sua participação', completed: 'concluiu sua participação',
  cancelled: 'cancelou a tarefa', commented: 'comentou', attachment_added: 'anexou um arquivo',
};

export default TaskDetailModal;
