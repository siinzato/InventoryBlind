import { describe, expect, it } from 'vitest';
import {
  deriveSharedStatus, countCompletedAssignees, formatAssigneeProgress, groupAssigneesByStatus,
  canViewTask, canEditTaskStructure, canDeleteTask, canCancelTask,
  canChangeMyStatus, canCreateCorporateTask, bucketByDueDate, summarizeMyDay, computeWorkloadByUser,
  formatRelativeTime, canTransitionAssigneeStatus, canValidateTask, canReopenTask,
  isOverdue, isDueSoon, formatDueRelative, computeTimeBreakdown, formatDuration, recommendNextTask,
  computeOperationalIndicators, groupTasksForMyDay,
} from '../taskDomain';
import { Task, TaskAssignee, TaskWithAssignees } from '../types';

const assignee = (user_id: string, status: TaskAssignee['status']): TaskAssignee => ({
  id: `a-${user_id}`, task_id: 't1', user_id, status,
  assigned_at: '2026-08-21T00:00:00Z', assigned_by: null, started_at: null, completed_at: null,
});

const baseTask = (over: Partial<Task> = {}): Task => ({
  id: 't1', company_id: 'c1', type: 'corporate', title: 'Tarefa', description: null, category: null,
  priority: 'medium', due_date: '2026-08-21', due_time: null, status: 'todo', created_by: 'manager-1',
  cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  created_at: '2026-08-21T00:00:00Z', updated_at: '2026-08-21T00:00:00Z',
  ...over,
});

describe('deriveSharedStatus — "A fazer"/"Em andamento"/"Concluída" derivados dos responsáveis', () => {
  it('nenhum responsável: A fazer', () => {
    expect(deriveSharedStatus([])).toBe('todo');
  });

  it('ninguém iniciou: A fazer', () => {
    expect(deriveSharedStatus([{ status: 'todo' }, { status: 'todo' }])).toBe('todo');
  });

  it('ao menos um iniciou, nem todos concluíram: Em andamento', () => {
    expect(deriveSharedStatus([{ status: 'in_progress' }, { status: 'todo' }])).toBe('in_progress');
  });

  it('um concluiu mas outro nem começou: ainda Em andamento (6. progresso compartilhado)', () => {
    expect(deriveSharedStatus([{ status: 'done' }, { status: 'todo' }])).toBe('in_progress');
  });

  it('todos concluíram: Concluída', () => {
    expect(deriveSharedStatus([{ status: 'done' }, { status: 'done' }])).toBe('done');
  });
});

describe('countCompletedAssignees / formatAssigneeProgress', () => {
  it('2 de 4 concluíram', () => {
    const assignees = [assignee('u1', 'done'), assignee('u2', 'done'), assignee('u3', 'todo'), assignee('u4', 'in_progress')];
    expect(countCompletedAssignees(assignees)).toEqual({ completed: 2, total: 4 });
    expect(formatAssigneeProgress(assignees)).toBe('2 de 4 concluíram');
  });

  it('tarefa com um único responsável não exibe progresso agregado', () => {
    expect(formatAssigneeProgress([assignee('u1', 'todo')])).toBe('');
  });
});

describe('groupAssigneesByStatus', () => {
  it('separa quem não iniciou, quem executa e quem concluiu', () => {
    const assignees = [assignee('u1', 'todo'), assignee('u2', 'in_progress'), assignee('u3', 'done')];
    const grouped = groupAssigneesByStatus(assignees);
    expect(grouped.notStarted.map(a => a.user_id)).toEqual(['u1']);
    expect(grouped.inProgress.map(a => a.user_id)).toEqual(['u2']);
    expect(grouped.completed.map(a => a.user_id)).toEqual(['u3']);
  });
});

describe('canViewTask — 7. usuário comum não vê tarefa de colega quando não está atribuído', () => {
  it('gestão vê qualquer tarefa da empresa', () => {
    const task = baseTask({ created_by: 'other-user' });
    expect(canViewTask(task, [], 'manager', 'me')).toBe(true);
  });

  it('criador de tarefa pessoal sempre vê a própria', () => {
    const task = baseTask({ type: 'personal', created_by: 'me' });
    expect(canViewTask(task, [], 'counter', 'me')).toBe(true);
  });

  it('responsável atribuído vê a tarefa corporativa', () => {
    const task = baseTask({ created_by: 'manager-1' });
    expect(canViewTask(task, [assignee('me', 'todo')], 'counter', 'me')).toBe(true);
  });

  it('usuário comum sem atribuição e sem ser o criador não vê', () => {
    const task = baseTask({ created_by: 'other-user' });
    expect(canViewTask(task, [assignee('someone-else', 'todo')], 'counter', 'me')).toBe(false);
  });
});

describe('canEditTaskStructure — 4. atribuído não altera conteúdo da corporativa', () => {
  it('criador edita a própria tarefa pessoal', () => {
    expect(canEditTaskStructure(baseTask({ type: 'personal', created_by: 'me' }), 'counter', 'me')).toBe(true);
  });

  it('outro usuário não edita tarefa pessoal alheia, nem sendo gestor (2. gestor não edita pessoal)', () => {
    expect(canEditTaskStructure(baseTask({ type: 'personal', created_by: 'other' }), 'manager', 'me')).toBe(false);
  });

  it('responsável de tarefa corporativa não edita a estrutura', () => {
    expect(canEditTaskStructure(baseTask({ type: 'corporate' }), 'counter', 'assignee-1')).toBe(false);
  });

  it('gestor edita tarefa corporativa', () => {
    expect(canEditTaskStructure(baseTask({ type: 'corporate' }), 'manager', 'manager-1')).toBe(true);
  });

  it('tarefa cancelada não pode ser editada por ninguém', () => {
    expect(canEditTaskStructure(baseTask({ type: 'corporate', status: 'cancelled' }), 'owner', 'manager-1')).toBe(false);
  });
});

describe('canDeleteTask / canCancelTask', () => {
  it('só o criador exclui a própria tarefa pessoal', () => {
    expect(canDeleteTask(baseTask({ type: 'personal', created_by: 'me' }), 'me')).toBe(true);
    expect(canDeleteTask(baseTask({ type: 'personal', created_by: 'other' }), 'me')).toBe(false);
  });

  it('tarefa corporativa nunca é "excluída" pelo criador — é cancelada pela gestão', () => {
    expect(canDeleteTask(baseTask({ type: 'corporate', created_by: 'me' }), 'me')).toBe(false);
  });

  it('só gestão cancela tarefa corporativa, e só se ainda não estiver cancelada', () => {
    expect(canCancelTask(baseTask({ type: 'corporate' }), 'manager')).toBe(true);
    expect(canCancelTask(baseTask({ type: 'corporate' }), 'counter')).toBe(false);
    expect(canCancelTask(baseTask({ type: 'corporate', status: 'cancelled' }), 'manager')).toBe(false);
  });
});

describe('canChangeMyStatus — 5. cada responsável só altera a própria participação', () => {
  it('responsável atribuído pode iniciar/concluir a própria parte', () => {
    expect(canChangeMyStatus(baseTask(), [assignee('me', 'todo')], 'me')).toBe(true);
  });

  it('usuário não atribuído não pode alterar status de quem é', () => {
    expect(canChangeMyStatus(baseTask(), [assignee('other', 'todo')], 'me')).toBe(false);
  });

  it('tarefa cancelada não aceita mudança de status', () => {
    expect(canChangeMyStatus(baseTask({ status: 'cancelled' }), [assignee('me', 'todo')], 'me')).toBe(false);
  });
});

describe('canCreateCorporateTask', () => {
  it('owner, admin e manager podem; lead, counter e viewer não', () => {
    expect(canCreateCorporateTask('owner')).toBe(true);
    expect(canCreateCorporateTask('admin')).toBe(true);
    expect(canCreateCorporateTask('manager')).toBe(true);
    expect(canCreateCorporateTask('lead')).toBe(false);
    expect(canCreateCorporateTask('counter')).toBe(false);
    expect(canCreateCorporateTask('viewer')).toBe(false);
  });
});

describe('bucketByDueDate', () => {
  it('classifica atrasada, hoje e próxima', () => {
    expect(bucketByDueDate(baseTask({ due_date: '2026-08-20' }), '2026-08-21')).toBe('overdue');
    expect(bucketByDueDate(baseTask({ due_date: '2026-08-21' }), '2026-08-21')).toBe('today');
    expect(bucketByDueDate(baseTask({ due_date: '2026-08-22' }), '2026-08-21')).toBe('upcoming');
    expect(bucketByDueDate(baseTask({ due_date: null }), '2026-08-21')).toBe('no_date');
  });
});

describe('summarizeMyDay', () => {
  it('conta a fazer/em andamento/concluídas só da minha participação', () => {
    const asTaskWithAssignees = (assignees: TaskAssignee[]): TaskWithAssignees => ({ ...baseTask(), assignees });
    const tasks: TaskWithAssignees[] = [
      asTaskWithAssignees([assignee('me', 'todo')]),
      asTaskWithAssignees([assignee('me', 'in_progress')]),
      asTaskWithAssignees([assignee('me', 'done')]),
      asTaskWithAssignees([assignee('other', 'todo')]), // não é minha
    ];
    expect(summarizeMyDay(tasks, 'me')).toEqual({ todo: 1, inProgress: 1, paused: 0, blocked: 0, done: 1 });
  });
});

describe('computeWorkloadByUser', () => {
  const asTaskWithAssignees = (over: Partial<Task>, assignees: TaskAssignee[]): TaskWithAssignees => ({ ...baseTask(over), assignees });

  it('conta atribuições ativas por usuário, ignorando quem já concluiu', () => {
    const tasks: TaskWithAssignees[] = [
      asTaskWithAssignees({ due_date: '2026-08-25' }, [assignee('u1', 'todo'), assignee('u2', 'done')]),
      asTaskWithAssignees({ due_date: '2026-08-25' }, [assignee('u1', 'in_progress')]),
    ];
    const workload = computeWorkloadByUser(tasks, '2026-08-21');
    const u1 = workload.find(w => w.userId === 'u1')!;
    const u2 = workload.find(w => w.userId === 'u2');
    expect(u1.active).toBe(2);
    expect(u2).toBeUndefined(); // concluiu a única atribuição — não conta como carga ativa
  });

  it('marca atrasada quando o prazo já passou', () => {
    const tasks: TaskWithAssignees[] = [asTaskWithAssignees({ due_date: '2026-08-10' }, [assignee('u1', 'todo')])];
    expect(computeWorkloadByUser(tasks, '2026-08-21')[0].overdue).toBe(1);
  });

  it('tarefa cancelada não conta para a carga de ninguém', () => {
    const tasks: TaskWithAssignees[] = [asTaskWithAssignees({ status: 'cancelled', due_date: '2026-08-10' }, [assignee('u1', 'todo')])];
    expect(computeWorkloadByUser(tasks, '2026-08-21')).toHaveLength(0);
  });
});

describe('deriveSharedStatus — prioridade bloqueada > pausada > em execução (Central de Execução)', () => {
  it('um bloqueado entre vários: agregado é bloqueada mesmo com outro em execução', () => {
    expect(deriveSharedStatus([{ status: 'blocked' }, { status: 'in_progress' }])).toBe('blocked');
  });
  it('um pausado, nenhum bloqueado: agregado é pausada', () => {
    expect(deriveSharedStatus([{ status: 'paused' }, { status: 'todo' }])).toBe('paused');
  });
  it('bloqueado tem prioridade sobre pausado', () => {
    expect(deriveSharedStatus([{ status: 'blocked' }, { status: 'paused' }])).toBe('blocked');
  });
});

describe('canTransitionAssigneeStatus — transições inválidas nunca são aceitas', () => {
  it('transições válidas do fluxo principal e da pausa/bloqueio', () => {
    expect(canTransitionAssigneeStatus('todo', 'in_progress')).toBe(true);
    expect(canTransitionAssigneeStatus('in_progress', 'paused')).toBe(true);
    expect(canTransitionAssigneeStatus('in_progress', 'blocked')).toBe(true);
    expect(canTransitionAssigneeStatus('paused', 'in_progress')).toBe(true);
    expect(canTransitionAssigneeStatus('blocked', 'in_progress')).toBe(true);
    expect(canTransitionAssigneeStatus('blocked', 'todo')).toBe(true);
    expect(canTransitionAssigneeStatus('in_progress', 'done')).toBe(true);
  });

  it('pausada não vai direto para concluída ou bloqueada — precisa retomar antes', () => {
    expect(canTransitionAssigneeStatus('paused', 'done')).toBe(false);
    expect(canTransitionAssigneeStatus('paused', 'blocked')).toBe(false);
  });

  it('bloqueada não vai direto para concluída — precisa desbloquear antes', () => {
    expect(canTransitionAssigneeStatus('blocked', 'done')).toBe(false);
  });

  it('concluída não tem transição comum — reabertura é ação de gestão separada', () => {
    expect(canTransitionAssigneeStatus('done', 'todo')).toBe(false);
    expect(canTransitionAssigneeStatus('done', 'in_progress')).toBe(false);
  });

  it('mesmo estado nunca é uma transição', () => {
    expect(canTransitionAssigneeStatus('todo', 'todo')).toBe(false);
  });
});

describe('canValidateTask / canReopenTask', () => {
  it('só gestão valida, só quando a tarefa exige validação e está concluída', () => {
    expect(canValidateTask(baseTask({ status: 'done', requires_validation: true }), 'manager')).toBe(true);
    expect(canValidateTask(baseTask({ status: 'done', requires_validation: true }), 'counter')).toBe(false);
    expect(canValidateTask(baseTask({ status: 'done', requires_validation: false }), 'manager')).toBe(false);
    expect(canValidateTask(baseTask({ status: 'in_progress', requires_validation: true }), 'manager')).toBe(false);
  });

  it('reabertura: pessoal só pelo criador, corporativa só pela gestão, e só concluída/validada', () => {
    expect(canReopenTask(baseTask({ type: 'personal', created_by: 'me', status: 'done' }), 'counter', 'me')).toBe(true);
    expect(canReopenTask(baseTask({ type: 'personal', created_by: 'other', status: 'done' }), 'manager', 'me')).toBe(false);
    expect(canReopenTask(baseTask({ type: 'corporate', status: 'validated' }), 'manager', 'me')).toBe(true);
    expect(canReopenTask(baseTask({ type: 'corporate', status: 'validated' }), 'counter', 'me')).toBe(false);
    expect(canReopenTask(baseTask({ type: 'corporate', status: 'in_progress' }), 'manager', 'me')).toBe(false);
  });
});

describe('isOverdue / isDueSoon — "vence em breve" com limite configurável (default 120min)', () => {
  const NOW = new Date('2026-08-21T10:00:00').getTime();

  it('atrasada: prazo já passou e a tarefa ainda está aberta', () => {
    expect(isOverdue({ due_date: '2026-08-21', due_time: '09:00:00', status: 'in_progress' }, NOW)).toBe(true);
  });

  it('não atrasada se já concluída/validada/cancelada', () => {
    expect(isOverdue({ due_date: '2026-08-21', due_time: '09:00:00', status: 'done' }, NOW)).toBe(false);
    expect(isOverdue({ due_date: '2026-08-21', due_time: '09:00:00', status: 'validated' }, NOW)).toBe(false);
    expect(isOverdue({ due_date: '2026-08-21', due_time: '09:00:00', status: 'cancelled' }, NOW)).toBe(false);
  });

  it('vence em breve: dentro do limite configurado, nunca se já atrasada', () => {
    expect(isDueSoon({ due_date: '2026-08-21', due_time: '11:00:00', status: 'todo' }, NOW, 120)).toBe(true);
    expect(isDueSoon({ due_date: '2026-08-21', due_time: '13:00:00', status: 'todo' }, NOW, 120)).toBe(false);
    expect(isDueSoon({ due_date: '2026-08-21', due_time: '09:00:00', status: 'todo' }, NOW, 120)).toBe(false);
  });

  it('limite configurável — 240min inclui o que 120min excluiria', () => {
    expect(isDueSoon({ due_date: '2026-08-21', due_time: '13:00:00', status: 'todo' }, NOW, 240)).toBe(true);
  });

  it('sem prazo nunca é atrasada nem vence em breve', () => {
    expect(isOverdue({ due_date: null, due_time: null, status: 'todo' }, NOW)).toBe(false);
    expect(isDueSoon({ due_date: null, due_time: null, status: 'todo' }, NOW)).toBe(false);
  });
});

describe('formatDueRelative — textos do pedido', () => {
  const NOW = new Date('2026-08-21T10:00:00').getTime();

  it('vence em minutos', () => {
    expect(formatDueRelative({ due_date: '2026-08-21', due_time: '10:38:00' }, NOW)).toBe('Vence em 38 min');
  });

  it('vence hoje em horário específico', () => {
    expect(formatDueRelative({ due_date: '2026-08-21', due_time: '16:30:00' }, NOW)).toBe('Vence hoje às 16:30');
  });

  it('atrasada há X h Y min', () => {
    expect(formatDueRelative({ due_date: '2026-08-21', due_time: '08:40:00' }, NOW)).toBe('Atrasada há 1h20');
  });

  it('sem prazo definido', () => {
    expect(formatDueRelative({ due_date: null, due_time: null }, NOW)).toBe('Sem prazo definido');
  });
});

describe('computeTimeBreakdown / formatDuration — tempo real por segmento, nunca contador incremental', () => {
  it('soma segmentos fechados por tipo', () => {
    const NOW = new Date('2026-08-21T12:00:00Z').getTime();
    const segments = [
      { segment_type: 'active' as const, started_at: '2026-08-21T10:00:00Z', ended_at: '2026-08-21T10:30:00Z' },
      { segment_type: 'paused' as const, started_at: '2026-08-21T10:30:00Z', ended_at: '2026-08-21T10:45:00Z' },
      { segment_type: 'active' as const, started_at: '2026-08-21T10:45:00Z', ended_at: null },
    ];
    const breakdown = computeTimeBreakdown(segments, NOW);
    expect(breakdown.activeSeconds).toBe(30 * 60 + 75 * 60);
    expect(breakdown.pausedSeconds).toBe(15 * 60);
    expect(breakdown.blockedSeconds).toBe(0);
    expect(breakdown.elapsedSeconds).toBe(2 * 60 * 60);
  });

  it('sem segmentos: tudo zero', () => {
    expect(computeTimeBreakdown([])).toEqual({ activeSeconds: 0, pausedSeconds: 0, blockedSeconds: 0, elapsedSeconds: 0 });
  });

  it('formatDuration compacta em min ou hXX', () => {
    expect(formatDuration(45 * 60)).toBe('45min');
    expect(formatDuration(65 * 60)).toBe('1h05');
  });
});

describe('recommendNextTask — "Faça Agora": determinístico e testável, não uma IA opaca', () => {
  const NOW = new Date('2026-08-21T10:00:00').getTime();
  const wa = (over: Partial<Task>, assignees: TaskAssignee[]): TaskWithAssignees => ({ ...baseTask(over), assignees });

  it('tarefa já em execução pelo usuário vence sobre qualquer outra, mesmo atrasada crítica', () => {
    const tasks = [
      wa({ id: 't-started', priority: 'low', due_date: null }, [assignee('me', 'in_progress')]),
      wa({ id: 't-critical-overdue', priority: 'urgent', due_date: '2026-08-20' }, [assignee('me', 'todo')]),
    ];
    expect(recommendNextTask(tasks, 'me', NOW)?.task.id).toBe('t-started');
    expect(recommendNextTask(tasks, 'me', NOW)?.reason).toBe('already_started');
  });

  it('sem tarefa em execução: crítica atrasada vence sobre atrasada comum', () => {
    const tasks = [
      wa({ id: 't-overdue', priority: 'medium', due_date: '2026-08-20' }, [assignee('me', 'todo')]),
      wa({ id: 't-critical-overdue', priority: 'urgent', due_date: '2026-08-19' }, [assignee('me', 'todo')]),
    ];
    const rec = recommendNextTask(tasks, 'me', NOW);
    expect(rec?.task.id).toBe('t-critical-overdue');
    expect(rec?.reason).toBe('critical_overdue');
  });

  it('sem atraso: vence em breve vence sobre alta prioridade sem prazo próximo', () => {
    const tasks = [
      wa({ id: 't-high-far', priority: 'high', due_date: '2026-08-25' }, [assignee('me', 'todo')]),
      wa({ id: 't-due-soon', priority: 'medium', due_date: '2026-08-21', due_time: '11:00:00' }, [assignee('me', 'todo')]),
    ];
    expect(recommendNextTask(tasks, 'me', NOW, 120)?.task.id).toBe('t-due-soon');
  });

  it('empate de critério: menor prazo desempata; sem prazo nenhum, ordem de criação', () => {
    const tasks = [
      wa({ id: 't-later', priority: 'low', due_date: '2026-08-23', created_at: '2026-08-01T00:00:00Z' }, [assignee('me', 'todo')]),
      wa({ id: 't-earlier', priority: 'low', due_date: '2026-08-22', created_at: '2026-08-02T00:00:00Z' }, [assignee('me', 'todo')]),
    ];
    expect(recommendNextTask(tasks, 'me', NOW)?.task.id).toBe('t-earlier');
  });

  it('exclui bloqueadas (dependem de ação externa), concluídas, validadas e canceladas', () => {
    const tasks = [
      wa({ id: 't-blocked', status: 'blocked' }, [assignee('me', 'blocked')]),
      wa({ id: 't-done', status: 'done' }, [assignee('me', 'done')]),
      wa({ id: 't-validated', status: 'validated' }, [assignee('me', 'done')]),
      wa({ id: 't-cancelled', status: 'cancelled' }, [assignee('me', 'todo')]),
    ];
    expect(recommendNextTask(tasks, 'me', NOW)).toBeNull();
  });

  it('não recomenda tarefa em que o usuário não é responsável', () => {
    const tasks = [wa({ id: 't-other' }, [assignee('other', 'todo')])];
    expect(recommendNextTask(tasks, 'me', NOW)).toBeNull();
  });

  it('o sistema recomenda, não obriga — sem tarefas elegíveis, retorna null (operador decide)', () => {
    expect(recommendNextTask([], 'me', NOW)).toBeNull();
  });
});

describe('groupAssigneesByStatus inclui pausados e bloqueados (não somem do resumo)', () => {
  it('separa também quem está pausado e quem está bloqueado', () => {
    const assignees = [assignee('u1', 'paused'), assignee('u2', 'blocked'), assignee('u3', 'done')];
    const grouped = groupAssigneesByStatus(assignees);
    expect(grouped.paused.map(a => a.user_id)).toEqual(['u1']);
    expect(grouped.blocked.map(a => a.user_id)).toEqual(['u2']);
    expect(grouped.completed.map(a => a.user_id)).toEqual(['u3']);
  });
});

describe('computeWorkloadByUser — carga em minutos e bloqueios, não só contagem', () => {
  it('operador com poucas tarefas longas pesa mais que um com muitas curtas', () => {
    const wa = (over: Partial<Task>, assignees: TaskAssignee[]): TaskWithAssignees => ({ ...baseTask(over), assignees });
    const tasks: TaskWithAssignees[] = [
      wa({ id: 't1', due_date: '2026-08-25', estimated_duration_minutes: 210 }, [assignee('opB', 'todo')]),
      wa({ id: 't2', due_date: '2026-08-25', estimated_duration_minutes: 20 }, [assignee('opA', 'todo')]),
      wa({ id: 't3', due_date: '2026-08-25', estimated_duration_minutes: 15 }, [assignee('opA', 'todo')]),
      wa({ id: 't4', due_date: '2026-08-25', estimated_duration_minutes: 10 }, [assignee('opA', 'todo'), assignee('opA', 'in_progress')]),
    ];
    const workload = computeWorkloadByUser(tasks, '2026-08-21');
    const opA = workload.find(w => w.userId === 'opA')!;
    const opB = workload.find(w => w.userId === 'opB')!;
    expect(opB.plannedMinutes).toBe(210);
    expect(opA.plannedMinutes).toBeLessThan(opB.plannedMinutes);
  });

  it('validada não conta para carga de ninguém (igual cancelada)', () => {
    const wa = (over: Partial<Task>, assignees: TaskAssignee[]): TaskWithAssignees => ({ ...baseTask(over), assignees });
    const tasks: TaskWithAssignees[] = [wa({ status: 'validated', due_date: '2026-08-10' }, [assignee('u1', 'done')])];
    expect(computeWorkloadByUser(tasks, '2026-08-21')).toHaveLength(0);
  });

  it('conta quantas atribuições ativas estão bloqueadas', () => {
    const wa = (over: Partial<Task>, assignees: TaskAssignee[]): TaskWithAssignees => ({ ...baseTask(over), assignees });
    const tasks: TaskWithAssignees[] = [wa({ due_date: '2026-08-25' }, [assignee('u1', 'blocked')])];
    expect(computeWorkloadByUser(tasks, '2026-08-21')[0].blocked).toBe(1);
  });
});

describe('groupTasksForMyDay — cada tarefa cai em exatamente um balde', () => {
  const wa = (over: Partial<Task>, assignees: TaskAssignee[]): TaskWithAssignees => ({ ...baseTask(over), assignees });
  const TODAY = '2026-08-21';

  it('bloqueada tem prioridade sobre qualquer balde de prazo', () => {
    const groups = groupTasksForMyDay([wa({ due_date: '2026-08-20' }, [assignee('me', 'blocked')])], 'me', TODAY);
    expect(groups.blocked).toHaveLength(1);
    expect(groups.overdue).toHaveLength(0);
  });

  it('pausada entra em "em execução" — ainda é trabalho iniciado', () => {
    const groups = groupTasksForMyDay([wa({}, [assignee('me', 'paused')])], 'me', TODAY);
    expect(groups.inProgress).toHaveLength(1);
  });

  it('todo sem execução cai no balde de prazo certo', () => {
    const groups = groupTasksForMyDay([
      wa({ id: 't-overdue', due_date: '2026-08-20' }, [assignee('me', 'todo')]),
      wa({ id: 't-today', due_date: TODAY }, [assignee('me', 'todo')]),
      wa({ id: 't-upcoming', due_date: '2026-08-25' }, [assignee('me', 'todo')]),
      wa({ id: 't-none', due_date: null }, [assignee('me', 'todo')]),
    ], 'me', TODAY);
    expect(groups.overdue.map(t => t.id)).toEqual(['t-overdue']);
    expect(groups.today.map(t => t.id)).toEqual(['t-today']);
    expect(groups.upcoming.map(t => t.id)).toEqual(['t-upcoming']);
    expect(groups.noDate.map(t => t.id)).toEqual(['t-none']);
  });

  it('concluída, cancelada ou de outro usuário não aparece em balde nenhum', () => {
    const groups = groupTasksForMyDay([
      wa({ id: 't-done' }, [assignee('me', 'done')]),
      wa({ id: 't-cancelled', status: 'cancelled' }, [assignee('me', 'todo')]),
      wa({ id: 't-other' }, [assignee('other', 'todo')]),
    ], 'me', TODAY);
    const allBuckets = [...groups.inProgress, ...groups.blocked, ...groups.overdue, ...groups.today, ...groups.upcoming, ...groups.noDate];
    expect(allBuckets).toHaveLength(0);
  });
});

describe('computeOperationalIndicators — topo do Meu Dia, tudo a partir de dados reais', () => {
  const NOW = new Date('2026-08-21T10:00:00').getTime();
  const wa = (over: Partial<Task>, assignees: TaskAssignee[]): TaskWithAssignees => ({ ...baseTask(over), assignees });

  it('conta atrasadas, vence em breve, bloqueadas e em execução separadamente', () => {
    const tasks = [
      wa({ id: 't-overdue', due_date: '2026-08-20' }, [assignee('me', 'todo')]),
      wa({ id: 't-due-soon', due_date: '2026-08-21', due_time: '11:00:00' }, [assignee('me', 'todo')]),
      wa({ id: 't-blocked', due_date: '2026-08-25' }, [assignee('me', 'blocked')]),
      wa({ id: 't-in-progress', due_date: '2026-08-25' }, [assignee('me', 'in_progress')]),
    ];
    const ind = computeOperationalIndicators(tasks, 'me', NOW, 120);
    expect(ind.overdue).toBe(1);
    expect(ind.dueSoon).toBe(1);
    expect(ind.blocked).toBe(1);
    expect(ind.inProgress).toBe(1);
  });

  it('progresso do dia: "18 de 27" — exclui tarefas futuras (upcoming), inclui hoje/atrasada/sem prazo', () => {
    const tasks = [
      wa({ id: 't1', due_date: '2026-08-21' }, [assignee('me', 'done')]),
      wa({ id: 't2', due_date: '2026-08-20' }, [assignee('me', 'todo')]),
      wa({ id: 't3', due_date: null }, [assignee('me', 'todo')]),
      wa({ id: 't-future', due_date: '2026-08-25' }, [assignee('me', 'todo')]), // não entra no "hoje"
    ];
    const ind = computeOperationalIndicators(tasks, 'me', NOW);
    expect(ind.todayTotal).toBe(3);
    expect(ind.todayDone).toBe(1);
    expect(ind.progressPct).toBe(33);
  });

  it('concluída no prazo: completed_at até o prazo conta; depois do prazo não conta', () => {
    const onTime = wa({ id: 't-on-time', due_date: '2026-08-21', due_time: '12:00:00' },
      [{ ...assignee('me', 'done'), completed_at: '2026-08-21T11:00:00' }]);
    const late = wa({ id: 't-late', due_date: '2026-08-21', due_time: '09:00:00' },
      [{ ...assignee('me', 'done'), completed_at: '2026-08-21T09:30:00' }]);
    const ind = computeOperationalIndicators([onTime, late], 'me', NOW);
    expect(ind.doneOnTime).toBe(1);
  });

  it('tarefa cancelada e tarefa de outro usuário não entram em nenhum indicador', () => {
    const tasks = [
      wa({ id: 't-cancelled', status: 'cancelled', due_date: '2026-08-10' }, [assignee('me', 'todo')]),
      wa({ id: 't-other', due_date: '2026-08-10' }, [assignee('other', 'todo')]),
    ];
    const ind = computeOperationalIndicators(tasks, 'me', NOW);
    expect(ind).toEqual({ overdue: 0, dueSoon: 0, blocked: 0, inProgress: 0, doneOnTime: 0, todayTotal: 0, todayDone: 0, progressPct: 0 });
  });

  it('sem nenhuma tarefa hoje: progresso 0%, não divide por zero', () => {
    expect(computeOperationalIndicators([], 'me', NOW).progressPct).toBe(0);
  });
});

describe('formatRelativeTime — data relativa do sino de notificações', () => {
  const NOW = new Date('2026-08-21T12:00:00Z').getTime();

  it('menos de um minuto: agora mesmo', () => {
    expect(formatRelativeTime('2026-08-21T11:59:30Z', NOW)).toBe('agora mesmo');
  });

  it('minutos', () => {
    expect(formatRelativeTime('2026-08-21T11:55:00Z', NOW)).toBe('há 5 minutos');
    expect(formatRelativeTime('2026-08-21T11:59:00Z', NOW)).toBe('há 1 minuto');
  });

  it('horas', () => {
    expect(formatRelativeTime('2026-08-21T10:00:00Z', NOW)).toBe('há 2 horas');
    expect(formatRelativeTime('2026-08-21T11:00:00Z', NOW)).toBe('há 1 hora');
  });

  it('dias', () => {
    expect(formatRelativeTime('2026-08-18T12:00:00Z', NOW)).toBe('há 3 dias');
    expect(formatRelativeTime('2026-08-20T12:00:00Z', NOW)).toBe('há 1 dia');
  });

  it('meses', () => {
    expect(formatRelativeTime('2026-06-01T12:00:00Z', NOW)).toBe('há 2 meses');
  });
});
