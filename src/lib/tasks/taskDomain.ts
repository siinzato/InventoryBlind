// Regras de domínio puras do módulo de Tarefas — sem I/O, fáceis de testar.
// A fonte de verdade do progresso compartilhado é sempre task_assignees; estas
// funções derivam o mesmo agregado que o trigger do banco calcula (RLS/RPC são
// a barreira real — isto é o espelho no client para preview/exibição).

import { Role } from '../permissionService';
import { Task, TaskAssignee, TaskStatus, AssigneeStatus, TaskWithAssignees, TaskTimeSegment, BlockReason, BLOCK_REASONS } from './types';

export const BLOCK_REASON_LABEL: Record<BlockReason, string> = BLOCK_REASONS.reduce(
  (acc, r) => ({ ...acc, [r.value]: r.label }), {} as Record<BlockReason, string>,
);

const MANAGEMENT_ROLES: Role[] = ['owner', 'admin', 'manager'];

export function isManagementRole(role: Role | string | undefined): boolean {
  return !!role && MANAGEMENT_ROLES.includes(role as Role);
}

/** Mesmo cálculo do trigger task_assignees_recompute_status (migration 072) —
 *  mantido em paridade, inclusive na ordem de prioridade: bloqueada > pausada
 *  > em execução > a fazer; concluída só quando TODOS concluíram. */
export function deriveSharedStatus(assignees: { status: AssigneeStatus }[]): TaskStatus {
  if (assignees.length === 0) return 'todo';
  if (assignees.every(a => a.status === 'done')) return 'done';
  if (assignees.some(a => a.status === 'blocked')) return 'blocked';
  if (assignees.some(a => a.status === 'paused')) return 'paused';
  if (assignees.some(a => a.status === 'in_progress' || a.status === 'paused' || a.status === 'blocked' || a.status === 'done')) return 'in_progress';
  return 'todo';
}

export function countCompletedAssignees(assignees: { status: AssigneeStatus }[]): { completed: number; total: number } {
  return { completed: assignees.filter(a => a.status === 'done').length, total: assignees.length };
}

export function formatAssigneeProgress(assignees: { status: AssigneeStatus }[]): string {
  const { completed, total } = countCompletedAssignees(assignees);
  if (total <= 1) return '';
  return `${completed} de ${total} concluíram`;
}

export function groupAssigneesByStatus(assignees: TaskAssignee[]) {
  return {
    notStarted: assignees.filter(a => a.status === 'todo'),
    inProgress: assignees.filter(a => a.status === 'in_progress'),
    paused: assignees.filter(a => a.status === 'paused'),
    blocked: assignees.filter(a => a.status === 'blocked'),
    completed: assignees.filter(a => a.status === 'done'),
  };
}

export function findMyAssignment(assignees: TaskAssignee[], userId: string): TaskAssignee | undefined {
  return assignees.find(a => a.user_id === userId);
}

// ── Arquivamento (Kanban → coluna Concluído; ver migration 095) ─────────────

const ARCHIVE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Só concluídas. `archived_at` NULL cai no corte automático de 7 dias
 *  (calculado aqui, sem escrita no banco); 'infinity' foi restaurada
 *  explicitamente e nunca mais é varrida; qualquer outro valor é
 *  arquivamento explícito (imediato, já no passado). */
export function isAssigneeArchived(a: Pick<TaskAssignee, 'status' | 'archived_at' | 'completed_at'>, nowMs: number = Date.now()): boolean {
  if (a.status !== 'done') return false;
  if (a.archived_at) {
    if (a.archived_at === 'infinity') return false;
    return new Date(a.archived_at).getTime() <= nowMs;
  }
  if (!a.completed_at) return false;
  return nowMs - new Date(a.completed_at).getTime() >= ARCHIVE_AFTER_MS;
}

/** Dias restantes até o corte automático — só faz sentido para uma concluída
 *  ainda não arquivada; null quando não se aplica (sem completed_at, já
 *  arquivada ou restaurada). */
export function daysUntilAutoArchive(a: Pick<TaskAssignee, 'status' | 'archived_at' | 'completed_at'>, nowMs: number = Date.now()): number | null {
  if (a.status !== 'done' || a.archived_at || !a.completed_at) return null;
  const remainingMs = ARCHIVE_AFTER_MS - (nowMs - new Date(a.completed_at).getTime());
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
}

/** Regras de visibilidade — espelham task_is_visible_to_me() do banco. A barreira real é a RLS. */
export function canViewTask(task: Task, assignees: TaskAssignee[], role: Role | string | undefined, userId: string): boolean {
  if (isManagementRole(role)) return true;
  if (task.created_by === userId) return true;
  return !!findMyAssignment(assignees, userId);
}

/** Título, descrição, prazo, prioridade (inclui task_set_priority — mesmo
 *  gate), checklist estrutural, responsáveis. Tarefa cancelada ou validada
 *  (entrega já aceita pela liderança) não pode mais ser editada. */
export function canEditTaskStructure(task: Task, role: Role | string | undefined, userId: string): boolean {
  if (task.status === 'cancelled' || task.status === 'validated') return false;
  if (task.type === 'personal') return task.created_by === userId;
  return isManagementRole(role);
}

export function canDeleteTask(task: Task, userId: string): boolean {
  return task.type === 'personal' && task.created_by === userId;
}

export function canCancelTask(task: Task, role: Role | string | undefined): boolean {
  return task.type === 'corporate' && task.status !== 'cancelled' && task.status !== 'validated' && isManagementRole(role);
}

/** Só a própria participação — nunca em nome de outro responsável. */
export function canChangeMyStatus(task: Task, assignees: TaskAssignee[], userId: string): boolean {
  if (task.status === 'cancelled' || task.status === 'validated') return false;
  return !!findMyAssignment(assignees, userId);
}

export function canCreateCorporateTask(role: Role | string | undefined): boolean {
  return isManagementRole(role);
}

/** Só gestão, só quando o modelo/tarefa exige validação e só depois de concluída. */
export function canValidateTask(task: Task, role: Role | string | undefined): boolean {
  return isManagementRole(role) && task.requires_validation && task.status === 'done';
}

/** Concluída ou validada; pessoal só pelo criador, corporativa só pela gestão. */
export function canReopenTask(task: Task, role: Role | string | undefined, userId: string): boolean {
  if (task.status !== 'done' && task.status !== 'validated') return false;
  if (task.type === 'personal') return task.created_by === userId;
  return isManagementRole(role);
}

// ── Ciclo de vida — transições válidas de task_assignees.status ─────────────
// Espelha exatamente o que cada RPC aceita (task_set_my_status/task_pause_my_status/
// task_resume_my_status/task_block_my_status/task_unblock_status) — reabertura
// (done/validated → todo/in_progress) é uma decisão de gestão separada
// (task_reopen), não uma transição comum, por isso não aparece aqui.
const ALLOWED_ASSIGNEE_TRANSITIONS: Record<AssigneeStatus, AssigneeStatus[]> = {
  todo: ['in_progress', 'done'],
  in_progress: ['todo', 'paused', 'blocked', 'done'],
  paused: ['in_progress'],
  blocked: ['in_progress', 'todo'],
  done: [],
};

export function canTransitionAssigneeStatus(from: AssigneeStatus, to: AssigneeStatus): boolean {
  if (from === to) return false;
  return ALLOWED_ASSIGNEE_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Meu Dia — buckets por data ────────────────────────────────────────────────

export type DueBucket = 'overdue' | 'today' | 'upcoming' | 'no_date';

/**
 * `todayISODate` no formato YYYY-MM-DD (fuso local), passado pelo chamador
 * para o teste ser determinístico. Só compara datas — o chamador decide se
 * tarefas concluídas/canceladas entram nas listas de atrasada/hoje/próxima
 * (normalmente não entram: ver `summarizeMyDay` e os componentes de Meu Dia).
 */
export function bucketByDueDate(task: Task, todayISODate: string): DueBucket {
  if (!task.due_date) return 'no_date';
  if (task.due_date < todayISODate) return 'overdue';
  if (task.due_date === todayISODate) return 'today';
  return 'upcoming';
}

export interface MyDaySummary {
  todo: number;
  inProgress: number;
  paused: number;
  blocked: number;
  done: number;
}

export function summarizeMyDay(tasks: TaskWithAssignees[], userId: string): MyDaySummary {
  const summary: MyDaySummary = { todo: 0, inProgress: 0, paused: 0, blocked: 0, done: 0 };
  tasks.forEach(t => {
    const mine = findMyAssignment(t.assignees, userId);
    if (!mine) return;
    if (mine.status === 'in_progress') summary.inProgress++;
    else summary[mine.status]++;
  });
  return summary;
}

// ── Prazo relativo, "vence em breve" e tempo real de execução ──────────────

/** `due_time` ausente é tratado como o fim do dia (23:59:59) — mesma convenção
 *  do cron de due_soon/overdue (migration 071). Interpretado em horário LOCAL
 *  (sem sufixo de fuso), para "apresentar no fuso do usuário" ser automático:
 *  o navegador já formata Date em local time. */
export function computeDueTimestamp(dueDate: string | null, dueTime: string | null): Date | null {
  if (!dueDate) return null;
  const time = dueTime ? dueTime.slice(0, 8) : '23:59:59';
  return new Date(`${dueDate}T${time}`);
}

const OPEN_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'paused', 'blocked'];

/** Estados terminais no nível da TAREFA — nenhum deles pode estar "atrasado agora". */
export const TERMINAL_TASK_STATUSES: TaskStatus[] = ['done', 'validated', 'cancelled'];

export function isTaskTerminal(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}

/** Estado terminal no nível da MINHA ATRIBUIÇÃO. Existe porque as colunas do Kanban e os
 *  grupos do Meu Dia são governados por `task_assignees.status`, não pelo status da tarefa:
 *  minha parte pode estar 'done' enquanto a tarefa segue 'todo'/'in_progress' (outros
 *  responsáveis, validação pendente). Sem considerar isso, um card já na coluna "Concluído"
 *  continuava sendo avaliado como atrasado. */
export function isAssignmentTerminal(assignee: Pick<TaskAssignee, 'status'> | null | undefined): boolean {
  return assignee?.status === 'done';
}

/**
 * Atraso ATUAL. `mine` é opcional para não quebrar os chamadores que avaliam a tarefa como um
 * todo; quando informado, minha conclusão também encerra o atraso (é o que a UI mostra).
 * Comparação sempre por instante (getTime), nunca por string formatada.
 */
export function isOverdue(
  task: { due_date: string | null; due_time: string | null; status: TaskStatus },
  nowMs: number = Date.now(),
  mine?: Pick<TaskAssignee, 'status'> | null,
): boolean {
  if (!OPEN_STATUSES.includes(task.status)) return false;
  if (isAssignmentTerminal(mine)) return false;
  const due = computeDueTimestamp(task.due_date, task.due_time);
  return !!due && due.getTime() < nowMs;
}

/**
 * Atraso HISTÓRICO: terminou depois do prazo. Conceito separado de `isOverdue` — não conta em
 * contador, filtro, ordenação nem notificação de atraso; serve para relatório.
 */
export function completedLate(
  task: { due_date: string | null; due_time: string | null },
  mine: Pick<TaskAssignee, 'status' | 'completed_at'> | null | undefined,
): boolean {
  if (!isAssignmentTerminal(mine) || !mine?.completed_at) return false;
  const due = computeDueTimestamp(task.due_date, task.due_time);
  return !!due && new Date(mine.completed_at).getTime() > due.getTime();
}

/** Configurável por empresa via task_module_settings (default 120min = "próximas
 *  duas horas", o mesmo default do cron de due_soon). Nunca true se já atrasada. */
export function isDueSoon(
  task: { due_date: string | null; due_time: string | null; status: TaskStatus },
  nowMs: number = Date.now(),
  thresholdMinutes = 120,
): boolean {
  if (!OPEN_STATUSES.includes(task.status)) return false;
  const due = computeDueTimestamp(task.due_date, task.due_time);
  if (!due) return false;
  const diffMs = due.getTime() - nowMs;
  return diffMs > 0 && diffMs <= thresholdMinutes * 60_000;
}

/** "Concluída em 02/09/2026 às 14:30" quando há `completed_at` confiável; só "Concluída"
 *  quando não há. Nunca usa `agora` nem `updated_at` como se fossem a conclusão, e nunca
 *  inventa data. Apresentação no fuso local do usuário (o Date já formata em local time);
 *  o instante guardado continua sendo UTC. */
export function formatCompletedAt(completedAt: string | null | undefined): string {
  if (!completedAt) return 'Concluída';
  const at = new Date(completedAt);
  if (Number.isNaN(at.getTime())) return 'Concluída';
  const date = at.toLocaleDateString('pt-BR');
  const time = at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `Concluída em ${date} às ${time}`;
}

/**
 * Rótulo de tempo do card — ÚNICO ponto que as views devem usar. Em estado terminal o relógio
 * de atraso para de vez e o texto passa a ser a conclusão real; fora dele, o prazo relativo de
 * sempre. `formatDueRelative` continua existindo como formatador puro de prazo (usado aqui e
 * por quem só quer o prazo), mas nenhuma tela decide sozinha se mostra atraso.
 */
export function formatTaskTimeline(
  task: { due_date: string | null; due_time: string | null; status: TaskStatus },
  mine: Pick<TaskAssignee, 'status' | 'completed_at'> | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (isAssignmentTerminal(mine)) return formatCompletedAt(mine?.completed_at);
  if (task.status === 'done' || task.status === 'validated') return 'Concluída';
  if (task.status === 'cancelled') return 'Cancelada';
  return formatDueRelative(task, nowMs);
}

/** "Vence em 38 min" / "Vence hoje às 16:30" / "Atrasada há 1h20" / "Amanhã às
 *  08:00" / "Sem prazo definido" — os exemplos literais do pedido. Só descreve o PRAZO:
 *  quem decide se o atraso ainda se aplica é `formatTaskTimeline`. */
export function formatDueRelative(task: { due_date: string | null; due_time: string | null }, nowMs: number = Date.now()): string {
  const due = computeDueTimestamp(task.due_date, task.due_time);
  if (!due) return 'Sem prazo definido';

  const diffMs = due.getTime() - nowMs;
  const absMinutes = Math.round(Math.abs(diffMs) / 60_000);
  const timeLabel = task.due_time ? task.due_time.slice(0, 5) : '23:59';

  if (diffMs < 0) {
    const h = Math.floor(absMinutes / 60);
    const m = absMinutes % 60;
    return h > 0 ? `Atrasada há ${h}h${String(m).padStart(2, '0')}` : `Atrasada há ${m} min`;
  }
  if (absMinutes < 60) return `Vence em ${absMinutes} min`;

  // Mesma convenção de comparação de data usada no resto do módulo (bucketByDueDate).
  const todayISO = new Date(nowMs).toISOString().slice(0, 10);
  const tomorrowISO = new Date(nowMs + 86_400_000).toISOString().slice(0, 10);
  if (task.due_date === todayISO) return `Vence hoje às ${timeLabel}`;
  if (task.due_date === tomorrowISO) return `Amanhã às ${timeLabel}`;
  return `${(task.due_date ?? '').split('-').reverse().join('/')} às ${timeLabel}`;
}

/** Soma de duração por tipo de segmento — nunca um contador incremental (ver
 *  nota da migration 072): sempre `sum(ended_at - started_at)`, com o segmento
 *  em aberto (`ended_at: null`) contando até `nowMs`. */
export interface TimeBreakdown {
  activeSeconds: number;
  pausedSeconds: number;
  blockedSeconds: number;
  /** Do primeiro início até agora (ou até o fim do último segmento) — "tempo corrido". */
  elapsedSeconds: number;
}

export function computeTimeBreakdown(segments: Pick<TaskTimeSegment, 'segment_type' | 'started_at' | 'ended_at'>[], nowMs: number = Date.now()): TimeBreakdown {
  let activeSeconds = 0, pausedSeconds = 0, blockedSeconds = 0;
  let firstStart: number | null = null;

  segments.forEach(seg => {
    const start = new Date(seg.started_at).getTime();
    const end = seg.ended_at ? new Date(seg.ended_at).getTime() : nowMs;
    const duration = Math.max(0, end - start) / 1000;
    if (seg.segment_type === 'active') activeSeconds += duration;
    else if (seg.segment_type === 'paused') pausedSeconds += duration;
    else blockedSeconds += duration;
    if (firstStart === null || start < firstStart) firstStart = start;
  });

  const elapsedSeconds = firstStart !== null ? Math.max(0, (nowMs - firstStart) / 1000) : 0;
  return { activeSeconds, pausedSeconds, blockedSeconds, elapsedSeconds };
}

/** "45min" / "1h05" — compacto, sem depender de biblioteca de datas. */
export function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h === 0 ? `${m}min` : `${h}h${String(m).padStart(2, '0')}`;
}

// ── "Faça Agora" — algoritmo determinístico, não uma IA opaca ──────────────
// Ordem fixa e testável (cada critério é uma função pura): já iniciada >
// crítica atrasada > atrasada > crítica perto do prazo > perto do prazo >
// alta prioridade > menor prazo > ordem de criação. Bloqueada é EXCLUÍDA
// (depende de ação externa, não é "faça agora"); concluída/validada/cancelada
// também. O sistema recomenda — o operador pode sempre escolher outra.
export type RecommendationReason =
  | 'already_started' | 'critical_overdue' | 'overdue' | 'critical_due_soon'
  | 'due_soon' | 'high_priority' | 'earliest_due' | 'oldest_created';

export const RECOMMENDATION_REASON_LABEL: Record<RecommendationReason, string> = {
  already_started: 'Você já iniciou esta tarefa',
  critical_overdue: 'Recomendada porque está atrasada e possui prioridade crítica',
  overdue: 'Recomendada porque está atrasada',
  critical_due_soon: 'Recomendada porque vence em breve e possui prioridade crítica',
  due_soon: 'Recomendada porque vence em breve',
  high_priority: 'Recomendada por ter prioridade alta',
  earliest_due: 'Recomendada por ter o prazo mais próximo',
  oldest_created: 'Recomendada por ser a tarefa mais antiga em aberto',
};

export interface TaskRecommendation {
  task: TaskWithAssignees;
  reason: RecommendationReason;
}

function sortByEarliestDueThenCreated(tasks: TaskWithAssignees[]): TaskWithAssignees[] {
  return [...tasks].sort((a, b) => {
    const aDue = computeDueTimestamp(a.due_date, a.due_time)?.getTime() ?? Infinity;
    const bDue = computeDueTimestamp(b.due_date, b.due_time)?.getTime() ?? Infinity;
    if (aDue !== bDue) return aDue - bDue;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

export function recommendNextTask(
  tasks: TaskWithAssignees[],
  userId: string,
  nowMs: number = Date.now(),
  dueSoonThresholdMinutes = 120,
): TaskRecommendation | null {
  const eligible = tasks.filter(t => {
    if (t.status === 'done' || t.status === 'validated' || t.status === 'cancelled') return false;
    const mine = findMyAssignment(t.assignees, userId);
    if (!mine || mine.status === 'done' || mine.status === 'blocked') return false;
    return true;
  });
  if (eligible.length === 0) return null;

  const tiers: { test: (t: TaskWithAssignees) => boolean; reason: RecommendationReason }[] = [
    { test: t => { const m = findMyAssignment(t.assignees, userId); return m?.status === 'in_progress' || m?.status === 'paused'; }, reason: 'already_started' },
    { test: t => t.priority === 'urgent' && isOverdue(t, nowMs), reason: 'critical_overdue' },
    { test: t => isOverdue(t, nowMs), reason: 'overdue' },
    { test: t => t.priority === 'urgent' && isDueSoon(t, nowMs, dueSoonThresholdMinutes), reason: 'critical_due_soon' },
    { test: t => isDueSoon(t, nowMs, dueSoonThresholdMinutes), reason: 'due_soon' },
    { test: t => t.priority === 'high' || t.priority === 'urgent', reason: 'high_priority' },
  ];

  for (const tier of tiers) {
    const matches = eligible.filter(tier.test);
    if (matches.length > 0) {
      return { task: sortByEarliestDueThenCreated(matches)[0], reason: tier.reason };
    }
  }

  const fallback = sortByEarliestDueThenCreated(eligible)[0];
  return { task: fallback, reason: fallback.due_date ? 'earliest_due' : 'oldest_created' };
}

// ── Equipe — carga de trabalho por usuário ───────────────────────────────────

export interface WorkloadEntry {
  userId: string;
  active: number;         // atribuições não concluídas (tarefa não cancelada/validada, minha parte != done)
  overdue: number;        // dentre as ativas, quantas já passaram do prazo
  blocked: number;        // dentre as ativas, quantas estão bloqueadas
  plannedMinutes: number; // carga em minutos (duração estimada), não só contagem —
                           // um operador com poucas tarefas longas pode ter mais carga
                           // que um com muitas tarefas curtas.
}

export function computeWorkloadByUser(tasks: TaskWithAssignees[], todayISODate: string): WorkloadEntry[] {
  const map = new Map<string, WorkloadEntry>();
  tasks.forEach(t => {
    if (t.status === 'cancelled' || t.status === 'validated') return;
    t.assignees.forEach(a => {
      if (a.status === 'done') return;
      const entry = map.get(a.user_id) ?? { userId: a.user_id, active: 0, overdue: 0, blocked: 0, plannedMinutes: 0 };
      entry.active += 1;
      entry.plannedMinutes += t.estimated_duration_minutes ?? 0;
      if (a.status === 'blocked') entry.blocked += 1;
      if (t.due_date && t.due_date < todayISODate) entry.overdue += 1;
      map.set(a.user_id, entry);
    });
  });
  return Array.from(map.values());
}

// ── Agrupamentos recolhíveis do Meu Dia ─────────────────────────────────────
// Prioridade de balde (cada tarefa cai em exatamente um): bloqueada > em
// execução (inclui pausada — ainda é trabalho iniciado, só interrompido) >
// balde por prazo (atrasada/hoje/próxima/sem prazo). Concluída/cancelada não
// aparecem em nenhum balde — já saíram do "trabalho pendente".

export interface MyDayGroups {
  inProgress: TaskWithAssignees[];
  blocked: TaskWithAssignees[];
  overdue: TaskWithAssignees[];
  today: TaskWithAssignees[];
  upcoming: TaskWithAssignees[];
  noDate: TaskWithAssignees[];
}

export function groupTasksForMyDay(tasks: TaskWithAssignees[], userId: string, todayISODate: string): MyDayGroups {
  const groups: MyDayGroups = { inProgress: [], blocked: [], overdue: [], today: [], upcoming: [], noDate: [] };
  tasks.forEach(t => {
    if (t.status === 'cancelled') return;
    const mine = findMyAssignment(t.assignees, userId);
    if (!mine || mine.status === 'done') return;
    if (mine.status === 'blocked') { groups.blocked.push(t); return; }
    if (mine.status === 'in_progress' || mine.status === 'paused') { groups.inProgress.push(t); return; }
    const bucket = bucketByDueDate(t, todayISODate);
    if (bucket === 'overdue') groups.overdue.push(t);
    else if (bucket === 'today') groups.today.push(t);
    else if (bucket === 'upcoming') groups.upcoming.push(t);
    else groups.noDate.push(t);
  });
  return groups;
}

// ── Indicadores operacionais do topo do Meu Dia ─────────────────────────────
// Substituem o antigo trio A fazer/Em andamento/Concluídas. Todos calculados a
// partir de dados reais (nunca mockados) — cada indicador é clicável na UI e
// filtra a listagem pelo mesmo critério usado aqui.

export interface OperationalIndicators {
  overdue: number;
  dueSoon: number;
  blocked: number;
  inProgress: number;
  /** Das concluídas com prazo, quantas terminaram até o prazo (sem prazo não conta contra nem a favor). */
  doneOnTime: number;
  /** Base do "progresso do dia": tarefas minhas cujo prazo é hoje, já passou, ou não tem prazo — exclui "próximas" (futuras). */
  todayTotal: number;
  todayDone: number;
  progressPct: number;
}

export function computeOperationalIndicators(
  tasks: TaskWithAssignees[],
  userId: string,
  nowMs: number = Date.now(),
  dueSoonThresholdMinutes = 120,
): OperationalIndicators {
  const todayISO = new Date(nowMs).toISOString().slice(0, 10);
  let overdue = 0, dueSoon = 0, blocked = 0, inProgress = 0, doneOnTime = 0, todayTotal = 0, todayDone = 0;

  tasks.forEach(t => {
    if (t.status === 'cancelled') return;
    const mine = findMyAssignment(t.assignees, userId);
    if (!mine) return;

    const isPartOfToday = !t.due_date || t.due_date <= todayISO;
    if (isPartOfToday) {
      todayTotal++;
      if (mine.status === 'done') {
        todayDone++;
        const due = computeDueTimestamp(t.due_date, t.due_time);
        if (!due || (mine.completed_at && new Date(mine.completed_at).getTime() <= due.getTime())) doneOnTime++;
      }
    }

    if (mine.status === 'done') return;
    if (mine.status === 'blocked') { blocked++; return; }
    if (mine.status === 'in_progress') inProgress++;
    if (isOverdue(t, nowMs, mine)) overdue++;
    else if (isDueSoon(t, nowMs, dueSoonThresholdMinutes)) dueSoon++;
  });

  const progressPct = todayTotal === 0 ? 0 : Math.round((todayDone / todayTotal) * 100);
  return { overdue, dueSoon, blocked, inProgress, doneOnTime, todayTotal, todayDone, progressPct };
}

// ── Rótulos amigáveis ─────────────────────────────────────────────────────────

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Pendente', in_progress: 'Em execução', paused: 'Pausada', blocked: 'Bloqueada',
  done: 'Concluída', validated: 'Validada', cancelled: 'Cancelada',
};

export const ASSIGNEE_STATUS_LABEL: Record<AssigneeStatus, string> = {
  todo: 'Pendente', in_progress: 'Em execução', paused: 'Pausada', blocked: 'Bloqueada', done: 'Concluído',
};

// Vocabulário operacional do pedido (Crítica/Alta/Normal/Baixa) sobre o mesmo
// enum do banco (low/medium/high/urgent) — não precisou mudar o banco.
export const TASK_PRIORITY_LABEL: Record<string, string> = {
  low: 'Baixa', medium: 'Normal', high: 'Alta', urgent: 'Crítica',
};

// ── Notificações ──────────────────────────────────────────────────────────────

/** "há 5 minutos" etc. `nowMs` é injetável para o teste ser determinístico. */
export function formatRelativeTime(iso: string, nowMs: number = Date.now()): string {
  const minutes = Math.floor((nowMs - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} minuto${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} hora${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days} dia${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;
}
