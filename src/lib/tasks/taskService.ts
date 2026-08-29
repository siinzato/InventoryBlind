// Serviço do módulo de Tarefas — todas as consultas ao Supabase, colunas
// explícitas. RLS é a barreira real; aqui só existe UX (loading/erro/vazio) e
// conveniência de consulta. Criação/edição/mudança de status passam por RPC
// SECURITY DEFINER (ver migration 070_task_management.sql).

import { supabase } from '../supabase';
import {
  Task, TaskWithAssignees, TaskAssignee, TaskChecklistItem, TaskComment, TaskAttachment,
  TaskActivityLog, CreateTaskInput, UpdateTaskInput, TeamMember, TaskTimeSegment, TaskTemplate, TaskModuleSettings,
} from './types';

const TASK_COLUMNS = [
  'id', 'company_id', 'type', 'title', 'description', 'category', 'priority', 'due_date', 'due_time', 'status',
  'created_by', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'created_at', 'updated_at',
  'template_key', 'template_version', 'payload', 'area', 'location_from', 'location_to', 'sku_or_line',
  'planned_quantity', 'executed_quantity', 'quantity_unit', 'estimated_duration_minutes', 'requires_validation',
  'tool_key', 'reopened_count', 'completion_note', 'result',
].join(', ');
const ASSIGNEE_COLUMNS = [
  'id', 'task_id', 'user_id', 'status', 'assigned_at', 'assigned_by', 'started_at', 'completed_at',
  'block_reason', 'block_note', 'blocked_at', 'blocked_by', 'expected_resolver_user_id', 'paused_at', 'archived_at',
].join(', ');
const CHECKLIST_COLUMNS = 'id, task_id, label, is_done, position, completed_by, completed_at, created_at';
const COMMENT_COLUMNS = 'id, task_id, user_id, body, created_at';
const ATTACHMENT_COLUMNS = 'id, task_id, uploaded_by, file_name, storage_path, file_size, mime_type, created_at';
const ACTIVITY_COLUMNS = 'id, task_id, user_id, action, details, created_at';
const TIME_SEGMENT_COLUMNS = 'id, task_id, assignee_id, user_id, segment_type, started_at, ended_at';
const TEMPLATE_COLUMNS = [
  'id', 'key', 'name', 'operation_type', 'version', 'is_active', 'default_priority', 'default_duration_minutes',
  'requires_validation', 'evidence_required', 'checklist_template', 'payload_schema', 'allowed_block_reasons', 'tool_key',
].join(', ');

export class TaskServiceError extends Error {}

function unwrap<T>(data: T | null, error: { message: string } | null, fallback: T): T {
  if (error) {
    console.error('[tasks]', error.message);
    throw new TaskServiceError(error.message);
  }
  return data ?? fallback;
}

/** Nomes/e-mails de um conjunto de usuários — task_assignees.user_id referencia auth.users, não profiles, então o PostgREST não embeda automaticamente; buscamos separado e mesclamos no client. */
async function fetchProfileNames(userIds: string[]): Promise<Map<string, { name: string | null; email: string | null }>> {
  const unique = Array.from(new Set(userIds)).filter(Boolean);
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.from('profiles').select('id, name, email').in('id', unique);
  if (error) { console.error('[tasks] fetchProfileNames', error.message); return new Map(); }
  return new Map((data ?? []).map(p => [p.id, { name: p.name, email: p.email }]));
}

async function attachProfileNames(assignees: TaskAssignee[]): Promise<TaskAssignee[]> {
  const names = await fetchProfileNames(assignees.map(a => a.user_id));
  return assignees.map(a => ({ ...a, user_name: names.get(a.user_id)?.name ?? null, user_email: names.get(a.user_id)?.email ?? null }));
}

async function groupAssigneesByTask(taskIds: string[]): Promise<Map<string, TaskAssignee[]>> {
  if (taskIds.length === 0) return new Map();
  const { data, error } = await supabase.from('task_assignees').select(ASSIGNEE_COLUMNS).in('task_id', taskIds);
  const rows = unwrap(data as TaskAssignee[] | null, error, []);
  const withNames = await attachProfileNames(rows);
  const grouped = new Map<string, TaskAssignee[]>();
  withNames.forEach(a => { const list = grouped.get(a.task_id) ?? []; list.push(a); grouped.set(a.task_id, list); });
  return grouped;
}

/** Uma consulta agrupada por task_id para a lista inteira — não por card — para
 *  o indicador de checklist do card operacional não custar N+1. */
async function fetchChecklistSummaries(taskIds: string[]): Promise<Map<string, { total: number; done: number }>> {
  if (taskIds.length === 0) return new Map();
  const { data, error } = await supabase.from('task_checklist_items').select('task_id, is_done').in('task_id', taskIds);
  if (error) { console.error('[tasks] fetchChecklistSummaries', error.message); return new Map(); }
  const map = new Map<string, { total: number; done: number }>();
  (data ?? []).forEach((row: { task_id: string; is_done: boolean }) => {
    const entry = map.get(row.task_id) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (row.is_done) entry.done += 1;
    map.set(row.task_id, entry);
  });
  return map;
}

/** Mesma lógica — uma consulta agrupada para o indicador de evidência do card. */
async function fetchAttachmentCounts(taskIds: string[]): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map();
  const { data, error } = await supabase.from('task_attachments').select('task_id').in('task_id', taskIds);
  if (error) { console.error('[tasks] fetchAttachmentCounts', error.message); return new Map(); }
  const map = new Map<string, number>();
  (data ?? []).forEach((row: { task_id: string }) => map.set(row.task_id, (map.get(row.task_id) ?? 0) + 1));
  return map;
}

function attachCardSummaries(
  tasks: (Task & { assignees: TaskAssignee[] })[],
  checklistByTask: Map<string, { total: number; done: number }>,
  attachmentsByTask: Map<string, number>,
): TaskWithAssignees[] {
  return tasks.map(t => ({
    ...t,
    checklistSummary: checklistByTask.get(t.id),
    attachmentCount: attachmentsByTask.get(t.id) ?? 0,
  }));
}

// ── Meu Dia — tarefas em que o usuário participa (criador ou responsável) ───

export async function listMyDayTasks(userId: string): Promise<TaskWithAssignees[]> {
  const { data: myRows, error: myError } = await supabase
    .from('task_assignees')
    .select('task_id')
    .eq('user_id', userId);
  const participations = unwrap(myRows as { task_id: string }[] | null, myError, []);
  const taskIds = participations.map(r => r.task_id);
  if (taskIds.length === 0) return [];

  const { data: taskRows, error: taskError } = await supabase
    .from('tasks').select(TASK_COLUMNS).in('id', taskIds).order('due_date', { ascending: true, nullsFirst: false });
  const tasks = unwrap(taskRows as Task[] | null, taskError, []);

  const [assigneesByTask, checklistByTask, attachmentsByTask] = await Promise.all([
    groupAssigneesByTask(taskIds), fetchChecklistSummaries(taskIds), fetchAttachmentCounts(taskIds),
  ]);
  const withAssignees = tasks.map(t => ({ ...t, assignees: assigneesByTask.get(t.id) ?? [] }));
  return attachCardSummaries(withAssignees, checklistByTask, attachmentsByTask);
}

// ── Equipe — todas as tarefas da empresa (RLS só deixa gestão chegar aqui) ──

export interface TeamTaskFilters {
  userId?: string;
  status?: Task['status'];
  priority?: Task['priority'];
  type?: Task['type'];
  dueFrom?: string;
  dueTo?: string;
}

export async function listCompanyTasks(companyId: string, filters: TeamTaskFilters = {}): Promise<TaskWithAssignees[]> {
  let query = supabase.from('tasks').select(TASK_COLUMNS).eq('company_id', companyId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.priority) query = query.eq('priority', filters.priority);
  if (filters.type) query = query.eq('type', filters.type);
  if (filters.dueFrom) query = query.gte('due_date', filters.dueFrom);
  if (filters.dueTo) query = query.lte('due_date', filters.dueTo);
  query = query.order('due_date', { ascending: true, nullsFirst: false });

  const { data, error } = await query;
  let tasks = unwrap(data as Task[] | null, error, []);

  const taskIds = tasks.map(t => t.id);
  const [assigneesByTask, checklistByTask, attachmentsByTask] = await Promise.all([
    groupAssigneesByTask(taskIds), fetchChecklistSummaries(taskIds), fetchAttachmentCounts(taskIds),
  ]);

  if (filters.userId) {
    tasks = tasks.filter(t => t.created_by === filters.userId || (assigneesByTask.get(t.id) ?? []).some(a => a.user_id === filters.userId));
  }

  const withAssignees = tasks.map(t => ({ ...t, assignees: assigneesByTask.get(t.id) ?? [] }));
  return attachCardSummaries(withAssignees, checklistByTask, attachmentsByTask);
}

export async function listTeamMembers(companyId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase.from('profiles').select('id, name, email, role').eq('company_id', companyId).order('name');
  return unwrap(data as TeamMember[] | null, error, []);
}

// ── Detalhe de uma tarefa ────────────────────────────────────────────────────

export interface TaskDetail {
  task: Task;
  assignees: TaskAssignee[];
  checklist: TaskChecklistItem[];
  comments: TaskComment[];
  attachments: TaskAttachment[];
  activity: TaskActivityLog[];
  timeSegments: TaskTimeSegment[];
}

export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  const { data: taskRow, error: taskError } = await supabase.from('tasks').select(TASK_COLUMNS).eq('id', taskId).maybeSingle();
  const task = unwrap(taskRow as Task | null, taskError, null);
  if (!task) return null;

  const [{ data: assigneeRows }, { data: checklistRows }, { data: commentRows }, { data: attachmentRows }, { data: activityRows }, { data: timeSegmentRows }] = await Promise.all([
    supabase.from('task_assignees').select(ASSIGNEE_COLUMNS).eq('task_id', taskId),
    supabase.from('task_checklist_items').select(CHECKLIST_COLUMNS).eq('task_id', taskId).order('position'),
    supabase.from('task_comments').select(COMMENT_COLUMNS).eq('task_id', taskId).order('created_at'),
    supabase.from('task_attachments').select(ATTACHMENT_COLUMNS).eq('task_id', taskId).order('created_at'),
    supabase.from('task_activity_logs').select(ACTIVITY_COLUMNS).eq('task_id', taskId).order('created_at', { ascending: false }),
    supabase.from('task_time_segments').select(TIME_SEGMENT_COLUMNS).eq('task_id', taskId).order('started_at'),
  ]);

  const assignees = await attachProfileNames((assigneeRows as TaskAssignee[]) ?? []);
  const comments = (commentRows as TaskComment[]) ?? [];
  const activity = (activityRows as TaskActivityLog[]) ?? [];
  const names = await fetchProfileNames([...comments.map(c => c.user_id), ...activity.map(a => a.user_id).filter((id): id is string => !!id)]);

  return {
    task,
    assignees,
    checklist: (checklistRows as TaskChecklistItem[]) ?? [],
    comments: comments.map(c => ({ ...c, user_name: names.get(c.user_id)?.name ?? null })),
    attachments: (attachmentRows as TaskAttachment[]) ?? [],
    activity: activity.map(a => ({ ...a, user_name: a.user_id ? names.get(a.user_id)?.name ?? null : null })),
    timeSegments: (timeSegmentRows as TaskTimeSegment[]) ?? [],
  };
}

// ── Modelos operacionais e preferências do módulo ───────────────────────────

export async function listTaskTemplates(): Promise<TaskTemplate[]> {
  const { data, error } = await supabase.from('task_templates').select(TEMPLATE_COLUMNS).eq('is_active', true).order('name');
  return unwrap(data as TaskTemplate[] | null, error, []);
}

export async function getTaskModuleSettings(companyId: string): Promise<TaskModuleSettings | null> {
  const { data, error } = await supabase.from('task_module_settings')
    .select('company_id, due_soon_threshold_minutes, pause_note_required, updated_at')
    .eq('company_id', companyId).maybeSingle();
  if (error) { console.error('[tasks] getTaskModuleSettings', error.message); return null; }
  return data as TaskModuleSettings | null;
}

export async function upsertTaskModuleSettings(dueSoonThresholdMinutes: number, pauseNoteRequired: boolean): Promise<void> {
  const { error } = await supabase.rpc('task_module_settings_upsert', {
    p_due_soon_threshold_minutes: dueSoonThresholdMinutes,
    p_pause_note_required: pauseNoteRequired,
  });
  if (error) throw new TaskServiceError(error.message);
}

// ── Escrita — sempre via RPC (ver migration 070) ────────────────────────────

export async function createTask(input: CreateTaskInput): Promise<string> {
  const { data, error } = await supabase.rpc('task_create', {
    p_type: input.type,
    p_title: input.title,
    p_description: input.description,
    p_category: input.category,
    p_priority: input.priority,
    p_due_date: input.due_date,
    p_due_time: input.due_time,
    p_assignee_ids: input.type === 'corporate' ? input.assigneeIds : null,
    p_checklist: input.checklist,
  });
  if (error) throw new TaskServiceError(error.message);
  return data as string;
}

export async function updateTask(taskId: string, input: UpdateTaskInput): Promise<void> {
  const { error } = await supabase.rpc('task_update', {
    p_task_id: taskId,
    p_title: input.title,
    p_description: input.description,
    p_category: input.category,
    p_priority: input.priority,
    p_due_date: input.due_date,
    p_due_time: input.due_time,
    p_assignee_ids: input.assigneeIds ?? null,
  });
  if (error) throw new TaskServiceError(error.message);
}

export async function setMyTaskStatus(taskId: string, status: 'todo' | 'in_progress' | 'done'): Promise<void> {
  const { error } = await supabase.rpc('task_set_my_status', { p_task_id: taskId, p_status: status });
  if (error) throw new TaskServiceError(error.message);
}

export async function pauseMyTask(taskId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('task_pause_my_status', { p_task_id: taskId, p_note: note ?? null });
  if (error) throw new TaskServiceError(error.message);
}

export async function resumeMyTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('task_resume_my_status', { p_task_id: taskId });
  if (error) throw new TaskServiceError(error.message);
}

export async function blockMyTask(taskId: string, reason: string, note?: string, expectedResolverId?: string): Promise<void> {
  const { error } = await supabase.rpc('task_block_my_status', {
    p_task_id: taskId, p_reason: reason, p_note: note ?? null, p_expected_resolver: expectedResolverId ?? null,
  });
  if (error) throw new TaskServiceError(error.message);
}

export async function unblockTask(taskId: string, userId?: string, resume = true): Promise<void> {
  const { error } = await supabase.rpc('task_unblock_status', { p_task_id: taskId, p_user_id: userId ?? null, p_resume: resume });
  if (error) throw new TaskServiceError(error.message);
}

export async function validateTask(taskId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('task_validate', { p_task_id: taskId, p_note: note ?? null });
  if (error) throw new TaskServiceError(error.message);
}

export async function reopenTask(taskId: string, reason: string, targetStatus: 'todo' | 'in_progress' = 'todo'): Promise<void> {
  const { error } = await supabase.rpc('task_reopen', { p_task_id: taskId, p_reason: reason, p_target_status: targetStatus });
  if (error) throw new TaskServiceError(error.message);
}

export async function setTaskPriority(taskId: string, priority: string): Promise<void> {
  const { error } = await supabase.rpc('task_set_priority', { p_task_id: taskId, p_priority: priority });
  if (error) throw new TaskServiceError(error.message);
}

export async function bulkAssignTasks(taskIds: string[], assigneeIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('task_bulk_assign', { p_task_ids: taskIds, p_assignee_ids: assigneeIds });
  if (error) throw new TaskServiceError(error.message);
}

export async function cancelTask(taskId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('task_cancel', { p_task_id: taskId, p_reason: reason });
  if (error) throw new TaskServiceError(error.message);
}

export async function deletePersonalTask(taskId: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  if (error) throw new TaskServiceError(error.message);
}

// ── Arquivamento (Kanban → coluna Concluído; ver migration 095) ─────────────

export async function archiveMyAssignment(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('task_archive_my_assignment', { p_task_id: taskId });
  if (error) throw new TaskServiceError(error.message);
}

export async function restoreMyAssignment(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('task_restore_my_assignment', { p_task_id: taskId });
  if (error) throw new TaskServiceError(error.message);
}

/** Arquiva em lote todas as concluídas ainda ativas no board (nunca arquivadas
 *  ou restauradas) — a ação "Arquivar concluídas" da coluna. Retorna quantas
 *  linhas foram afetadas para feedback na UI. */
export async function archiveMyDoneEligible(): Promise<number> {
  const { data, error } = await supabase.rpc('task_archive_my_done_eligible');
  if (error) throw new TaskServiceError(error.message);
  return (data as number) ?? 0;
}

export async function toggleChecklistItem(itemId: string, isDone: boolean): Promise<void> {
  const { error } = await supabase.rpc('task_toggle_checklist_item', { p_item_id: itemId, p_is_done: isDone });
  if (error) throw new TaskServiceError(error.message);
}

export async function addChecklistItem(taskId: string, companyId: string, label: string, position: number): Promise<TaskChecklistItem> {
  const { data, error } = await supabase.from('task_checklist_items')
    .insert({ task_id: taskId, company_id: companyId, label, position }).select(CHECKLIST_COLUMNS).single();
  if (error) throw new TaskServiceError(error.message);
  return data as TaskChecklistItem;
}

export async function removeChecklistItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('task_checklist_items').delete().eq('id', itemId);
  if (error) throw new TaskServiceError(error.message);
}

export async function addComment(taskId: string, companyId: string, userId: string, body: string): Promise<TaskComment> {
  const { data, error } = await supabase.from('task_comments')
    .insert({ task_id: taskId, company_id: companyId, user_id: userId, body }).select(COMMENT_COLUMNS).single();
  if (error) throw new TaskServiceError(error.message);
  return data as TaskComment;
}

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME = ['image/png', 'image/jpeg', 'application/pdf'];

export async function uploadAttachment(taskId: string, companyId: string, userId: string, file: File): Promise<TaskAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new TaskServiceError('Arquivo muito grande (máximo de 10MB).');
  if (!ALLOWED_ATTACHMENT_MIME.includes(file.type)) throw new TaskServiceError('Formato não aceito. Envie PNG, JPEG ou PDF.');

  const path = `${companyId}/${taskId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error: uploadError } = await supabase.storage.from('task-attachments').upload(path, file, { contentType: file.type });
  if (uploadError) throw new TaskServiceError(uploadError.message);

  const { data, error } = await supabase.from('task_attachments')
    .insert({ task_id: taskId, company_id: companyId, uploaded_by: userId, file_name: file.name, storage_path: path, file_size: file.size, mime_type: file.type })
    .select(ATTACHMENT_COLUMNS).single();
  if (error) throw new TaskServiceError(error.message);
  return data as TaskAttachment;
}

export async function getAttachmentUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('task-attachments').createSignedUrl(storagePath, 60 * 10);
  if (error) { console.error('[tasks] getAttachmentUrl', error.message); return null; }
  return data?.signedUrl ?? null;
}

// Notificações de tarefa vivem em taskNotificationService.ts (canal próprio,
// separado do sino de comunicados gerais).
