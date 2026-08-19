// Automation — acesso a dados do cliente.
//
// CRUD sob RLS mais a invocação do worker. Nenhuma regra de negócio: validar,
// avaliar e executar são de workflow.ts / conditions.ts / engine.ts, e este arquivo
// só move dados.
//
// A empresa nunca é enviada como argumento de autorização: `company_id` tem
// `DEFAULT get_my_company_id()::uuid` e as policies derivam o tenant do JWT.

import { supabase } from '../supabase';
import { logAuditEvent, type AuditAction } from '../auditLogService';
import { validateWorkflow } from './workflow';
import type {
  Automation,
  AutomationExecution,
  AutomationNotification,
  AutomationStatus,
  AutomationWorkflow,
  NodeExecution,
} from './types';

/** Registra no mecanismo de auditoria que já existe no projeto (§25).
 *
 *  Best-effort: logAuditEvent não lança, e uma falha de auditoria não deve desfazer
 *  a alteração que o usuário acabou de fazer. O que ela grava é quem, o quê e sobre
 *  qual automação — não o workflow inteiro, que é grande e já está versionado na
 *  própria tabela. */
async function audit(action: AuditAction, automationId: string, description: string): Promise<void> {
  const { data: session } = await supabase.auth.getUser();
  const user = session?.user;
  if (user == null) return;

  const { data: companyId } = await supabase.rpc('get_my_company_id');
  if (typeof companyId !== 'string' || companyId === '') return;

  logAuditEvent({
    companyId,
    userId: user.id,
    userEmail: user.email ?? '',
    action,
    resourceType: 'automation',
    resourceId: automationId,
    description,
  });
}

const AUTOMATION_COLUMNS =
  'id, company_id, name, description, status, trigger_type, workflow, version, ' +
  'created_by, created_at, updated_at, last_executed_at, execution_count';

function toAutomation(row: Record<string, unknown>): Automation {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    status: row.status as AutomationStatus,
    triggerType: row.trigger_type as string,
    workflow: (row.workflow as AutomationWorkflow) ?? { nodes: [], edges: [] },
    version: Number(row.version ?? 1),
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    lastExecutedAt: (row.last_executed_at as string | null) ?? null,
    executionCount: Number(row.execution_count ?? 0),
  };
}

export async function listAutomations(): Promise<Automation[]> {
  const { data, error } = await supabase
    .from('automations')
    .select(AUTOMATION_COLUMNS)
    .order('created_at', { ascending: false })
    .returns<Record<string, unknown>[]>();

  if (error) throw error;
  return (data ?? []).map(toAutomation);
}

export async function getAutomation(id: string): Promise<Automation | null> {
  const { data, error } = await supabase
    .from('automations')
    .select(AUTOMATION_COLUMNS)
    .eq('id', id)
    .maybeSingle<Record<string, unknown>>();

  if (error) throw error;
  return data ? toAutomation(data) : null;
}

export interface SaveAutomationInput {
  name: string;
  description?: string | null;
  workflow: AutomationWorkflow;
}

/** Cria como rascunho, sempre.
 *
 *  Nunca cria ativa, mesmo que o workflow seja válido: ativar é um ato separado e
 *  explícito, e é o que impede uma automação criada por engano de começar a agir
 *  sobre o estoque. */
export async function createAutomation(input: SaveAutomationInput): Promise<Automation> {
  const triggerType = input.workflow.nodes.find(n => n.type === 'trigger');

  // Autor gravado na criação. Uma automação executa ações reais sobre o estoque, e um
  // registro sem autor não é rastro de auditoria — foi uma lacuna real, encontrada ao
  // ver uma automação em produção com created_by nulo.
  const { data: session } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('automations')
    .insert({
      created_by: session?.user?.id ?? null,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: 'draft',
      trigger_type: (triggerType as { triggerType?: string } | undefined)?.triggerType ?? 'manual',
      workflow: input.workflow,
    })
    .select(AUTOMATION_COLUMNS)
    .single<Record<string, unknown>>();

  if (error) throw error;
  const created = toAutomation(data);
  void audit('automation.created', created.id, `Automação "${created.name}" criada como rascunho.`);
  return created;
}

/** Grava nome, descrição e workflow.
 *
 *  Uma automação ATIVA cujo workflow deixou de ser válido cai para `error` em vez de
 *  continuar ativa — é o requisito §32: editar não pode deixar uma configuração
 *  parcialmente inválida rodando. `error` e não `draft` porque a pessoa não voltou a
 *  rascunhar, ela quebrou algo, e o status precisa dizer isso. */
export async function updateAutomation(id: string, input: SaveAutomationInput): Promise<Automation> {
  const current = await getAutomation(id);
  if (current == null) throw new Error('Automação não encontrada.');

  const triggerNode = input.workflow.nodes.find(n => n.type === 'trigger');
  const validation = validateWorkflow(input.workflow);

  const nextStatus: AutomationStatus =
    current.status === 'active' && !validation.valid ? 'error' : current.status;

  const { data, error } = await supabase
    .from('automations')
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      workflow: input.workflow,
      trigger_type: (triggerNode as { triggerType?: string } | undefined)?.triggerType ?? 'manual',
      status: nextStatus,
    })
    .eq('id', id)
    .select(AUTOMATION_COLUMNS)
    .single<Record<string, unknown>>();

  if (error) throw error;
  const saved = toAutomation(data);
  void audit(
    'automation.updated',
    saved.id,
    nextStatus === 'error' && current.status === 'active'
      ? `Automação "${saved.name}" editada com erro de configuração e foi desativada.`
      : `Automação "${saved.name}" editada (versão ${saved.version}).`
  );
  return saved;
}

/** Ativa, se e somente se o workflow passar na validação.
 *
 *  A checagem é refeita aqui em cima do que está gravado, não em cima do que a tela
 *  mostra: o estado da tela pode ter divergido, e é o gravado que vai executar. */
export async function setAutomationStatus(id: string, status: AutomationStatus): Promise<Automation> {
  if (status === 'active') {
    const current = await getAutomation(id);
    if (current == null) throw new Error('Automação não encontrada.');

    const validation = validateWorkflow(current.workflow);
    if (!validation.valid) {
      const first = validation.problems.find(p => p.severity === 'error');
      throw new Error(first?.message ?? 'A automação tem erros de configuração e não pode ser ativada.');
    }
  }

  const { data, error } = await supabase
    .from('automations')
    .update({ status })
    .eq('id', id)
    .select(AUTOMATION_COLUMNS)
    .single<Record<string, unknown>>();

  if (error) throw error;
  const updated = toAutomation(data);
  void audit(
    status === 'active' ? 'automation.activated' : 'automation.deactivated',
    updated.id,
    `Automação "${updated.name}" passou para ${status}.`
  );
  return updated;
}

/** Duplica como rascunho.
 *
 *  A cópia nasce inativa mesmo que a original esteja ativa — duas automações
 *  idênticas ativas reagiriam ao mesmo evento e produziriam ação em dobro. */
export async function duplicateAutomation(id: string): Promise<Automation> {
  const source = await getAutomation(id);
  if (source == null) throw new Error('Automação não encontrada.');

  return createAutomation({
    name: `${source.name} (cópia)`,
    description: source.description,
    workflow: source.workflow,
  });
}

export async function deleteAutomation(id: string): Promise<void> {
  // Nome lido ANTES de apagar: depois do delete não há como descrever o que foi
  // removido, e um registro de auditoria com só um uuid não diz nada a ninguém.
  const existing = await getAutomation(id);

  const { error } = await supabase.from('automations').delete().eq('id', id);
  if (error) throw error;

  void audit('automation.deleted', id, `Automação "${existing?.name ?? id}" excluída.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Execução
// ─────────────────────────────────────────────────────────────────────────────

export interface RunResult {
  ok: boolean;
  message: string;
  processedEvents?: number;
  executions?: number;
}

/** Processa a fila de eventos, sob demanda.
 *
 *  NÃO é o caminho normal: desde a migration 052 o cron chama a Edge Function a cada
 *  minuto via pg_net, então a fila anda sozinha sem navegador aberto. Isto existe para
 *  quem não quer esperar o próximo minuto — o botão "Processar fila" na tela.
 *
 *  O comentário anterior dizia que pg_net não estava instalado. Estava; a leitura
 *  original foi errada. */
export async function processAutomationQueue(): Promise<RunResult> {
  const { data, error } = await supabase.functions.invoke('automation-run', { body: { mode: 'queue' } });

  if (error) {
    return { ok: false, message: await readFunctionError(error, 'Falha ao processar a fila de automações.') };
  }

  return {
    ok: data?.ok === true,
    message: typeof data?.message === 'string' ? data.message : 'Fila processada.',
    processedEvents: Number(data?.processedEvents ?? 0),
    executions: Number(data?.executions ?? 0),
  };
}

/** Executa uma automação à mão.
 *
 *  `dryRun` faz as ações destrutivas serem apenas decididas e registradas, nunca
 *  aplicadas — quais são, o registry declara em `skipOnDryRun`. */
export async function runAutomationManually(
  automationId: string,
  options: { dryRun?: boolean; context?: Record<string, unknown> } = {}
): Promise<RunResult & { executionId?: string; status?: string }> {
  const { data, error } = await supabase.functions.invoke('automation-run', {
    body: {
      mode: 'manual',
      automationId,
      dryRun: options.dryRun === true,
      context: options.context ?? {},
    },
  });

  if (error) {
    return { ok: false, message: await readFunctionError(error, 'Falha ao executar a automação.') };
  }

  return {
    ok: data?.ok === true,
    message: typeof data?.message === 'string' ? data.message : 'Execução concluída.',
    executionId: data?.executionId,
    status: data?.status,
  };
}

/** Extrai a nossa mensagem do FunctionsHttpError.
 *
 *  Sem isto o usuário vê o genérico "non-2xx status code" do SDK, que esconde a
 *  mensagem específica que a função devolveu. */
async function readFunctionError(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown }).context;

  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (typeof body?.error === 'string') return body.error;
    } catch {
      // Corpo não era JSON.
    }
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 && !message.includes('non-2xx') ? message : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Histórico
// ─────────────────────────────────────────────────────────────────────────────

const EXECUTION_COLUMNS =
  'id, company_id, automation_id, event_id, automation_version, trigger_type, trigger_source, ' +
  'status, dry_run, context, error_message, started_at, finished_at, duration_ms, depth';

function toExecution(row: Record<string, unknown>): AutomationExecution {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    automationId: row.automation_id as string,
    eventId: (row.event_id as string | null) ?? null,
    automationVersion: Number(row.automation_version ?? 1),
    triggerType: row.trigger_type as string,
    triggerSource: row.trigger_source as AutomationExecution['triggerSource'],
    status: row.status as AutomationExecution['status'],
    dryRun: Boolean(row.dry_run),
    context: (row.context as Record<string, unknown>) ?? {},
    errorMessage: (row.error_message as string | null) ?? null,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
    durationMs: (row.duration_ms as number | null) ?? null,
    depth: Number(row.depth ?? 0),
  };
}

export async function listExecutions(
  options: { automationId?: string; limit?: number } = {}
): Promise<AutomationExecution[]> {
  let query = supabase
    .from('automation_executions')
    .select(EXECUTION_COLUMNS)
    .order('started_at', { ascending: false })
    .limit(options.limit ?? 50);

  if (options.automationId) query = query.eq('automation_id', options.automationId);

  const { data, error } = await query.returns<Record<string, unknown>[]>();
  if (error) throw error;
  return (data ?? []).map(toExecution);
}

export async function listNodeExecutions(executionId: string): Promise<NodeExecution[]> {
  const { data, error } = await supabase
    .from('automation_node_executions')
    .select(
      'id, execution_id, node_id, node_type, node_label, sequence, status, condition_result, ' +
        'output, error_message, attempts, started_at, finished_at, duration_ms'
    )
    .eq('execution_id', executionId)
    .order('sequence', { ascending: true })
    .returns<Record<string, unknown>[]>();

  if (error) throw error;

  return (data ?? []).map(row => ({
    id: row.id as string,
    executionId: row.execution_id as string,
    nodeId: row.node_id as string,
    nodeType: row.node_type as string,
    nodeLabel: (row.node_label as string | null) ?? null,
    sequence: Number(row.sequence ?? 0),
    status: row.status as NodeExecution['status'],
    conditionResult: (row.condition_result as boolean | null) ?? null,
    output: (row.output as Record<string, unknown> | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    attempts: Number(row.attempts ?? 1),
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
    durationMs: (row.duration_ms as number | null) ?? null,
  }));
}

export async function countPendingEvents(): Promise<number> {
  const { count, error } = await supabase
    .from('automation_events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  if (error) throw error;
  return count ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notificações
// ─────────────────────────────────────────────────────────────────────────────

export async function listNotifications(options: { onlyUnread?: boolean; limit?: number } = {}): Promise<AutomationNotification[]> {
  let query = supabase
    .from('automation_notifications')
    .select('id, company_id, recipient_id, title, body, severity, execution_id, automation_id, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 30);

  if (options.onlyUnread !== false) query = query.is('read_at', null);

  const { data, error } = await query.returns<Record<string, unknown>[]>();
  if (error) throw error;

  return (data ?? []).map(row => ({
    id: row.id as string,
    companyId: row.company_id as string,
    recipientId: (row.recipient_id as string | null) ?? null,
    title: row.title as string,
    body: (row.body as string | null) ?? null,
    severity: row.severity as AutomationNotification['severity'],
    executionId: (row.execution_id as string | null) ?? null,
    automationId: (row.automation_id as string | null) ?? null,
    readAt: (row.read_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('automation_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}
