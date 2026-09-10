// Automation Run — Edge Function.
//
// O worker do engine. Três formas de uso:
//
//   mode: 'queue'   consome automation_events pendentes da empresa do chamador
//   mode: 'manual'  executa uma automação específica, com ou sem aplicar as ações
//   mode: 'cron'    consome a fila de TODAS as empresas, chamado pelo agendador
//
// ── O modo cron não tem usuário ─────────────────────────────────────────────
// Ele é autenticado por um segredo que o BANCO gerou e guarda no Vault (migration
// 052), apresentado no header x-automation-cron-secret. A conferência acontece
// dentro do banco, via automation_verify_cron_secret, então o valor nunca entra na
// memória deste processo e não pode aparecer num dump de erro.
//
// Sem usuário não há empresa no JWT, então o escopo vem de cada evento: o worker
// pede as empresas com fila pendente e processa uma por vez, e o repositório de
// cada uma só enxerga a própria.
//
// ── Divisão de privilégio ───────────────────────────────────────────────────
// userClient (ANON + JWT) para descobrir QUEM está chamando e a QUAL empresa ele
// pertence — sob RLS, exatamente como o navegador.
//
// adminClient (service_role) para tudo depois disso, porque o engine escreve
// execuções, logs e resultados de ação em nome do sistema, não do usuário. Como
// service_role ignora RLS, TODA consulta filtra company_id explicitamente, e essa
// empresa vem da conexão autenticada acima — nunca do corpo da requisição.
//
// É o mesmo padrão de integration-sync e integration-stock-write.
//
// ── Por que as ações rodam com service_role ─────────────────────────────────
// A alternativa era executá-las com o JWT de quem disparou o evento. Rejeitada: a
// automação faria mais ou menos coisa dependendo do papel de quem contou o item, e
// uma regra da empresa passaria a depender de quem estava com o tablet na mão. A
// autorização acontece na ATIVAÇÃO — só owner/admin/manager ativam — e o que executa
// depois é a regra, não a pessoa.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  AutomationEngine,
  type ActionExecutor,
  type ActionResult,
  type AutomationRepository,
  type CreatedExecution,
  type NodeLogEntry,
} from '../../../src/lib/automation/engine.ts';
import { ACTIONS, isKnownAction, type ActionKey } from '../../../src/lib/automation/registry.ts';
import { parseWebhookHeaders, validateWebhookUrl } from '../../../src/lib/automation/workflow.ts';
import type {
  Automation,
  AutomationEvent,
  AutomationWorkflow,
  ExecutionContext,
} from '../../../src/lib/automation/types.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Eventos por invocação. O engine roda uma automação por vez e cada ação pode
 *  tocar o banco, então um lote grande estoura o tempo da função e perde o registro
 *  do que já foi feito. 20 é a mesma ordem do claim de integrações. */
const MAX_EVENTS_PER_RUN = 20;

/** Orçamento de tempo. Bem abaixo do teto da plataforma, para a resposta e as
 *  marcações de status sempre serem gravadas. */
const TIME_BUDGET_MS = 45_000;

const WEBHOOK_TIMEOUT_MS = 10_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** Log estruturado, sem dado sensível e sem stack trace (§47).
 *
 *  O contexto da automação pode conter SKU e saldos; nada dele entra aqui — só
 *  identificadores e contagens. */
function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ source: 'automation-run', ...entry }));
}


/** Monta o AutomationEvent a partir da linha reivindicada.
 *
 *  As colunas de retomada (migration 056) DEVEM ser mapeadas para `resume`: sem isso
 *  o engine trata o evento de continuação como evento normal, e a proteção contra
 *  auto-disparo o recusa — porque origin_automation_id é a própria automação. O
 *  sintoma é uma espera que nunca continua, com o evento marcado como processado e
 *  nenhuma execução criada. */
function toAutomationEvent(row: Record<string, unknown>): AutomationEvent {
  const resumeNodeId = (row.resume_node_id as string | null) ?? null;
  const resumeAutomationId = (row.resume_automation_id as string | null) ?? null;

  return {
    id: row.id as string,
    companyId: row.company_id as string,
    eventType: row.event_type as string,
    payload: (row.payload as Record<string, unknown>) ?? {},
    sourceTable: (row.source_table as string | null) ?? null,
    sourceId: (row.source_id as string | null) ?? null,
    originExecutionId: (row.origin_execution_id as string | null) ?? null,
    originAutomationId: (row.origin_automation_id as string | null) ?? null,
    depth: Number(row.depth ?? 0),
    createdAt: row.created_at as string,
    resume:
      resumeNodeId != null && resumeAutomationId != null
        ? {
            automationId: resumeAutomationId,
            nodeId: resumeNodeId,
            actions: (row.resume_actions as Record<string, unknown>) ?? {},
            fromExecutionId: (row.resume_execution_id as string | null) ?? null,
          }
        : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Repositório
// ─────────────────────────────────────────────────────────────────────────────

function createRepository(client: SupabaseClient, companyId: string): AutomationRepository {
  return {
    async findActiveAutomations(scopedCompanyId: string, triggerType: string): Promise<Automation[]> {
      // Duas travas: a empresa que o engine passou e a empresa da conexão
      // autenticada. Se divergirem, algo está errado e a resposta é lista vazia em
      // vez de dados de outro tenant.
      if (scopedCompanyId !== companyId) return [];

      const { data, error } = await client
        .from('automations')
        .select('id, company_id, name, description, status, trigger_type, workflow, version, created_by, created_at, updated_at, last_executed_at, execution_count')
        .eq('company_id', companyId)
        .eq('trigger_type', triggerType)
        .eq('status', 'active')
        .returns<Record<string, unknown>[]>();

      if (error) throw error;

      return (data ?? []).map(row => ({
        id: row.id as string,
        companyId: row.company_id as string,
        name: row.name as string,
        description: (row.description as string | null) ?? null,
        status: 'active',
        triggerType: row.trigger_type as string,
        workflow: (row.workflow as AutomationWorkflow) ?? { nodes: [], edges: [] },
        version: Number(row.version ?? 1),
        createdBy: (row.created_by as string | null) ?? null,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        lastExecutedAt: (row.last_executed_at as string | null) ?? null,
        executionCount: Number(row.execution_count ?? 0),
      }));
    },

    async createExecution(input): Promise<CreatedExecution> {
      const { data, error } = await client
        .from('automation_executions')
        .insert({
          company_id: companyId,
          automation_id: input.automationId,
          event_id: input.eventId,
          automation_version: input.automationVersion,
          trigger_type: input.triggerType,
          trigger_source: input.triggerSource,
          dry_run: input.dryRun,
          context: input.context,
          depth: input.depth,
          triggered_by: input.triggeredBy,
          resumed_from_execution_id: input.resumedFromExecutionId ?? null,
          resumed_at_node_id: input.resumedAtNodeId ?? null,
          status: 'running',
        })
        .select('id')
        .single<{ id: string }>();

      if (error) {
        // 23505 = violação de unicidade, ou seja o índice de idempotência
        // (automation_id, event_id) já tinha esta execução. Não é erro: é outro
        // worker que chegou primeiro. Deixar o banco decidir é a única forma correta
        // sob concorrência — verificar antes tem janela de corrida.
        if ((error as { code?: string }).code === '23505' && input.eventId != null) {
          const { data: existing } = await client
            .from('automation_executions')
            .select('id')
            .eq('automation_id', input.automationId)
            .eq('event_id', input.eventId)
            .eq('company_id', companyId)
            .maybeSingle<{ id: string }>();

          return { id: existing?.id ?? '', duplicate: true };
        }
        throw error;
      }

      return { id: data.id, duplicate: false };
    },

    async recordNodeExecution(executionId: string, _companyId: string, entry: NodeLogEntry): Promise<void> {
      const { error } = await client.from('automation_node_executions').insert({
        company_id: companyId,
        execution_id: executionId,
        node_id: entry.nodeId,
        node_type: entry.nodeType,
        node_label: entry.nodeLabel,
        sequence: entry.sequence,
        status: entry.status,
        condition_result: entry.conditionResult,
        output: entry.output,
        error_message: entry.errorMessage,
        attempts: entry.attempts,
        finished_at: new Date().toISOString(),
        duration_ms: entry.durationMs,
      });

      // Falha ao gravar log não aborta a execução: perder uma linha de histórico é
      // ruim, não aplicar a ação seria pior.
      if (error) log({ event: 'node_log_failed', executionId, nodeId: entry.nodeId });
    },

    async finishExecution(input): Promise<void> {
      const { error } = await client
        .from('automation_executions')
        .update({
          status: input.status,
          error_message: input.errorMessage,
          duration_ms: input.durationMs,
          context: input.context,
          finished_at: new Date().toISOString(),
        })
        .eq('id', input.executionId)
        .eq('company_id', companyId);

      if (error) throw error;
    },

    async bumpCounters(automationId: string, executedAt: string): Promise<void> {
      const { error } = await client.rpc('automation_bump_execution_counters', {
        p_automation_id: automationId,
        p_executed_at: executedAt,
      });
      if (error) log({ event: 'bump_counters_failed', automationId });
    },

    async scheduleWebhookWait(input): Promise<{ token: string } | null> {
      if (input.resumeNodeId == null) return null;

      const { data, error } = await client.rpc('automation_create_wait', {
        p_company_id: companyId,
        p_automation_id: input.automationId,
        p_execution_id: input.executionId,
        p_event_type: input.eventType,
        p_payload: input.payload,
        p_resume_node_id: input.resumeNodeId,
        p_resume_actions: input.resumeActions,
        p_timeout_minutes: input.timeoutMinutes,
        p_depth: input.depth,
      });

      if (error) {
        // Sem espera registrada, o workflow para aqui para sempre. Propagado, não
        // engolido: melhor a execução falhar visivelmente do que ficar pendurada.
        log({ event: 'create_wait_failed', automationId: input.automationId });
        throw error;
      }

      return data == null ? null : { token: String(data) };
    },

    async scheduleResume(input): Promise<string | null> {
      if (input.resumeNodeId == null) return null;

      const { data, error } = await client.rpc('automation_schedule_resume', {
        p_company_id: companyId,
        p_automation_id: input.automationId,
        p_execution_id: input.executionId,
        p_event_type: input.eventType,
        p_payload: input.payload,
        p_resume_node_id: input.resumeNodeId,
        p_resume_actions: input.resumeActions,
        p_delay_minutes: input.delayMinutes,
        p_depth: input.depth,
      });

      if (error) {
        // Falhar aqui significa que a segunda metade do workflow nunca vai rodar. É
        // registrado e propagado: silenciar deixaria a automação parecer bem-sucedida
        // tendo executado metade.
        log({ event: 'schedule_resume_failed', automationId: input.automationId });
        throw error;
      }

      return data == null ? null : String(data);
    },

    async markEventProcessed(eventId: string, status): Promise<void> {
      const { error } = await client
        .from('automation_events')
        .update({ status, processed_at: new Date().toISOString() })
        .eq('id', eventId)
        .eq('company_id', companyId);

      if (error) log({ event: 'mark_event_failed', eventId });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor de ações
//
// O único lugar onde uma configuração feita pelo usuário produz efeito. Cada ação
// tem um executor nomeado; não existe caminho genérico que aceite SQL, JavaScript ou
// nome de tabela vindo da configuração (§38).
// ─────────────────────────────────────────────────────────────────────────────

function createExecutor(client: SupabaseClient, companyId: string): ActionExecutor {
  return {
    async execute(input): Promise<ActionResult> {
      const { actionType, config, context, executionId, automationId, depth, dryRun } = input;

      if (!isKnownAction(actionType)) {
        return { ok: false, output: {}, errorMessage: `Ação desconhecida: ${actionType}` };
      }

      const definition = ACTIONS[actionType as ActionKey];

      // Teste não aplica ação destrutiva. A decisão fica registrada, então o usuário
      // vê o que teria acontecido (§33).
      if (dryRun && definition.skipOnDryRun) {
        return {
          ok: true,
          output: { simulated: true, wouldExecute: definition.label },
        };
      }

      switch (actionType as ActionKey) {
        case 'create_recount':
          return createRecount(client, companyId, context, executionId, automationId, depth);
        case 'create_notification':
          return createNotification(client, companyId, config, executionId, automationId, 'configured');
        case 'create_alert':
          return createNotification(client, companyId, { ...config, severity: 'critical' }, executionId, automationId, 'alert');
        case 'add_session_note':
          return addSessionNote(client, companyId, config, context);
        case 'assign_responsible':
          return assignResponsible(client, companyId, config, context);
        case 'send_webhook':
          return sendWebhook(config, context, automationId, executionId);
      }
    },
  };
}

function readSessionId(context: ExecutionContext): string | null {
  const session = context.trigger?.session as Record<string, unknown> | undefined;
  const id = session?.id;
  return typeof id === 'string' && id !== '' ? id : null;
}

async function createRecount(
  client: SupabaseClient,
  companyId: string,
  context: ExecutionContext,
  executionId: string,
  automationId: string,
  depth: number
): Promise<ActionResult> {
  const sessionId = readSessionId(context);
  if (sessionId == null) {
    return { ok: false, output: {}, errorMessage: 'O contexto não traz a contagem de origem.' };
  }

  // RPC com empresa explícita, criada na 051 — pc_create_recount_session depende de
  // JWT e o engine roda sem sessão de usuário.
  const { data, error } = await client.rpc('automation_action_create_recount', {
    p_company_id: companyId,
    p_parent_session_id: sessionId,
    p_responsible_id: null,
  });

  if (error) {
    // Falhas aqui são de regra de negócio — pai não finalizado, limite de rodadas,
    // sem item divergente — e nenhuma melhora numa retentativa.
    return { ok: false, output: {}, errorMessage: error.message, retryable: false };
  }

  const recountId = String(data);

  // A recontagem criada gera `count.session_created` pelo trigger da 051, mas aquele
  // trigger não sabe que a origem foi uma automação. Emitimos aqui um evento com a
  // linhagem — origem e profundidade — que é o que faz a proteção contra loop
  // funcionar para o encadeamento.
  await client.rpc('automation_emit_event', {
    p_company_id: companyId,
    p_event_type: 'count.session_created',
    p_payload: { session: { id: recountId, isRecount: true, countNumber: null } },
    p_source_table: 'physical_count_sessions',
    p_source_id: recountId,
    p_origin_execution_id: executionId,
    p_origin_automation_id: automationId,
    p_depth: depth,
  });

  return { ok: true, output: { recountSessionId: recountId } };
}

async function createNotification(
  client: SupabaseClient,
  companyId: string,
  config: Record<string, unknown>,
  executionId: string,
  automationId: string,
  kind: 'configured' | 'alert'
): Promise<ActionResult> {
  const title = typeof config.title === 'string' ? config.title.trim() : '';
  if (title === '') {
    return { ok: false, output: {}, errorMessage: 'Título da notificação vazio.' };
  }

  const severity = ['info', 'warning', 'critical'].includes(String(config.severity))
    ? String(config.severity)
    : kind === 'alert'
      ? 'critical'
      : 'info';

  const recipientId = typeof config.recipientId === 'string' && config.recipientId !== '' ? config.recipientId : null;

  const { data, error } = await client
    .from('automation_notifications')
    .insert({
      company_id: companyId,
      recipient_id: recipientId,
      title,
      body: typeof config.body === 'string' && config.body.trim() !== '' ? config.body.trim() : null,
      severity,
      execution_id: executionId,
      automation_id: automationId,
    })
    .select('id')
    .single<{ id: string }>();

  if (error) return { ok: false, output: {}, errorMessage: error.message, retryable: false };

  return { ok: true, output: { notificationId: data.id, severity } };
}

async function addSessionNote(
  client: SupabaseClient,
  companyId: string,
  config: Record<string, unknown>,
  context: ExecutionContext
): Promise<ActionResult> {
  const sessionId = readSessionId(context);
  if (sessionId == null) return { ok: false, output: {}, errorMessage: 'O contexto não traz a contagem.' };

  const note = typeof config.note === 'string' ? config.note.trim() : '';
  if (note === '') return { ok: false, output: {}, errorMessage: 'Observação vazia.' };

  const { data: current, error: readError } = await client
    .from('physical_count_sessions')
    .select('observation')
    .eq('id', sessionId)
    .eq('company_id', companyId)
    .maybeSingle<{ observation: string | null }>();

  if (readError) return { ok: false, output: {}, errorMessage: readError.message };
  if (current == null) return { ok: false, output: {}, errorMessage: 'Contagem não encontrada nesta empresa.' };

  // Acrescenta em vez de sobrescrever: a observação pode ter sido escrita por uma
  // pessoa, e apagá-la seria perder informação que ninguém pediu para trocar.
  const merged = current.observation == null || current.observation.trim() === ''
    ? note
    : `${current.observation}\n${note}`;

  const { error } = await client
    .from('physical_count_sessions')
    .update({ observation: merged })
    .eq('id', sessionId)
    .eq('company_id', companyId);

  if (error) return { ok: false, output: {}, errorMessage: error.message };
  return { ok: true, output: { sessionId, appended: true } };
}

async function assignResponsible(
  client: SupabaseClient,
  companyId: string,
  config: Record<string, unknown>,
  context: ExecutionContext
): Promise<ActionResult> {
  const sessionId = readSessionId(context);
  if (sessionId == null) return { ok: false, output: {}, errorMessage: 'O contexto não traz a contagem.' };

  const responsibleId = typeof config.responsibleId === 'string' ? config.responsibleId : '';
  if (responsibleId === '') return { ok: false, output: {}, errorMessage: 'Responsável não informado.' };

  // O destinatário precisa ser da MESMA empresa. Sem esta checagem, uma configuração
  // com um uuid de outro tenant atribuiria a contagem a alguém de fora.
  const { data: member } = await client
    .from('company_members')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('user_id', responsibleId)
    .maybeSingle<{ user_id: string }>();

  if (member == null) {
    return { ok: false, output: {}, errorMessage: 'O responsável informado não pertence a esta empresa.', retryable: false };
  }

  const { error } = await client
    .from('physical_count_sessions')
    .update({ responsible_id: responsibleId })
    .eq('id', sessionId)
    .eq('company_id', companyId);

  if (error) return { ok: false, output: {}, errorMessage: error.message };
  return { ok: true, output: { sessionId, responsibleId } };
}

async function sendWebhook(
  config: Record<string, unknown>,
  context: ExecutionContext,
  automationId: string,
  executionId: string
): Promise<ActionResult> {
  const url = typeof config.url === 'string' ? config.url : '';

  // Revalidado no servidor, não só no editor. Validar apenas no cliente deixaria uma
  // automação gravada por outro caminho chamar um endereço interno — SSRF.
  const problem = validateWebhookUrl(url);
  if (problem != null) {
    return { ok: false, output: {}, errorMessage: `URL recusada: ${problem}`, retryable: false };
  }

  // ── Destino validado e FIXADO ─────────────────────────────────────────────
  // Resolve o DNS, recusa se qualquer IP for interno, e depois conecta ao IP exato que
  // passou pela checagem. Fixar o IP é o que fecha o TOCTOU: o `fetch` resolveria o
  // nome outra vez, e um DNS hostil poderia devolver 127.0.0.1 nessa segunda consulta.
  // Ver fetchWithPinnedIp.
  const target = await resolveAndCheckHost(new URL(url).hostname);
  if ('problem' in target) {
    return { ok: false, output: {}, errorMessage: `URL recusada: ${target.problem}`, retryable: false };
  }

  const method = ['POST', 'PUT', 'PATCH'].includes(String(config.method)) ? String(config.method) : 'POST';

  try {
    const response = await fetchWithPinnedIp({
      url: new URL(url),
      ip: target.ip,
      method,
      headers: {
        'content-type': 'application/json',
        ...parseWebhookHeaders(config.secretHeader),
      },
      body: JSON.stringify({
        automationId,
        executionId,
        // Só o contexto do domínio. Nenhuma credencial, nenhum dado interno do engine.
        trigger: context.trigger,
        actions: context.actions,
      }),
      timeoutMs: WEBHOOK_TIMEOUT_MS,
    });

    if (response.status < 200 || response.status >= 300) {
      // 5xx e 429 podem melhorar numa retentativa; 4xx é configuração errada e não
      // melhora. Retentar 4xx só multiplicaria o erro no log.
      const retryable = response.status >= 500 || response.status === 429;
      return {
        ok: false,
        output: { status: response.status },
        errorMessage: `HTTP ${response.status}`,
        retryable,
      };
    }

    return { ok: true, output: { status: response.status, resolvedIp: target.ip } };
  } catch (thrown) {
    // Timeout, falha de TLS e queda de rede são transitórios. Um certificado inválido
    // também cai aqui — e retentar é correto, porque pode ser renovação em curso.
    return {
      ok: false,
      output: {},
      errorMessage:
        thrown instanceof Error
          ? `Falha ao chamar o webhook: ${thrown.message}`
          : 'Falha ao chamar o webhook.',
      retryable: true,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const startedAt = Date.now();

  try {
    // ── Caminho do cron, antes de qualquer coisa de usuário ─────────────────
    // Verificado primeiro porque não há JWT: cair no fluxo de usuário devolveria
    // 401 para o agendador legítimo.
    const cronSecret = req.headers.get('x-automation-cron-secret');
    if (cronSecret != null) {
      const adminClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      const { data: valid } = await adminClient.rpc('automation_verify_cron_secret', {
        p_candidate: cronSecret,
      });

      if (valid !== true) {
        // Sem detalhe: um agendador mal configurado e um atacante recebem a mesma
        // resposta.
        log({ event: 'cron_rejected' });
        return json({ error: 'Não autorizado.' }, 401);
      }

      return await runCron(adminClient, startedAt);
    }

    const authHeader = req.headers.get('Authorization');
    if (authHeader == null) return json({ error: 'Não autenticado.' }, 401);

    const userClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData } = await userClient.auth.getUser();
    if (userData?.user == null) {
      return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401);
    }

    // A empresa vem do JWT, via a mesma função que as policies usam. Nunca do corpo
    // da requisição.
    const { data: companyId } = await userClient.rpc('get_my_company_id');
    if (typeof companyId !== 'string' || companyId === '') {
      return json({ error: 'Nenhuma empresa ativa na sessão.' }, 403);
    }

    const body = await req.json().catch(() => null);
    const mode = body?.mode === 'manual' ? 'manual' : 'queue';

    const adminClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const repository = createRepository(adminClient, companyId);
    const executor = createExecutor(adminClient, companyId);
    const engine = new AutomationEngine(repository, executor, undefined, createAgentRunner());

    if (mode === 'manual') {
      const automationId = typeof body?.automationId === 'string' ? body.automationId : '';
      if (automationId === '') return json({ error: 'automationId é obrigatório.' }, 400);

      // Papel verificado para execução manual: é uma ação privilegiada disparada por
      // uma pessoa. O consumo da fila não passa por aqui porque quem decidiu foi
      // quem ativou a automação.
      const { data: role } = await userClient.rpc('get_my_role');
      if (!['owner', 'admin', 'manager'].includes(String(role))) {
        return json({ error: 'Apenas owner, admin ou manager podem executar automações.' }, 403);
      }

      const { data: row, error } = await adminClient
        .from('automations')
        .select('id, company_id, name, description, status, trigger_type, workflow, version, created_by, created_at, updated_at, last_executed_at, execution_count')
        .eq('id', automationId)
        .eq('company_id', companyId)
        .maybeSingle<Record<string, unknown>>();

      if (error) return json({ error: error.message }, 500);
      // Mesma resposta para "não existe" e "é de outra empresa": diferenciar
      // confirmaria a existência de uma automação alheia.
      if (row == null) return json({ error: 'Automação não encontrada.' }, 404);

      const automation: Automation = {
        id: row.id as string,
        companyId: row.company_id as string,
        name: row.name as string,
        description: (row.description as string | null) ?? null,
        status: row.status as Automation['status'],
        triggerType: row.trigger_type as string,
        workflow: (row.workflow as AutomationWorkflow) ?? { nodes: [], edges: [] },
        version: Number(row.version ?? 1),
        createdBy: (row.created_by as string | null) ?? null,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        lastExecutedAt: (row.last_executed_at as string | null) ?? null,
        executionCount: Number(row.execution_count ?? 0),
      };

      const outcome = await engine.runAutomation({
        automation,
        event: null,
        triggerSource: 'manual',
        dryRun: body?.dryRun === true,
        triggeredBy: userData.user.id,
        manualContext: (body?.context ?? {}) as Record<string, unknown>,
      });

      log({ event: 'manual_run', automationId, outcome: outcome.kind, durationMs: Date.now() - startedAt });

      if (outcome.kind === 'skipped') {
        return json({ ok: false, message: outcome.detail ?? 'A automação não pôde ser executada.', reason: outcome.reason });
      }
      if (outcome.kind === 'duplicate') {
        return json({ ok: true, message: 'Esta execução já havia sido registrada.', executionId: outcome.executionId });
      }

      return json({
        ok: true,
        message: `Execução concluída: ${outcome.status}.`,
        executionId: outcome.executionId,
        status: outcome.status,
      });
    }

    // ── Fila ────────────────────────────────────────────────────────────────
    const { data: claimed, error: claimError } = await adminClient.rpc('automation_claim_events', {
      p_company_id: companyId,
      p_limit: MAX_EVENTS_PER_RUN,
    });

    if (claimError) return json({ error: claimError.message }, 500);

    const events = (claimed ?? []) as Record<string, unknown>[];
    let executions = 0;
    let processed = 0;

    for (const row of events) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        // Os que sobraram continuam em `processing` e o reaper (cron, 051) devolve à
        // fila em 15 minutos. Melhor do que forçar e perder o registro no meio.
        break;
      }

      const event: AutomationEvent = toAutomationEvent(row);

      try {
        const result = await engine.dispatchEvent(event);
        executions += result.outcomes.filter(o => o.kind === 'executed').length;
        processed += 1;
      } catch (thrown) {
        // Um evento problemático não interrompe o lote. Marcado como failed para não
        // ser reentregue indefinidamente.
        await repository.markEventProcessed(event.id, 'failed');
        log({
          event: 'dispatch_failed',
          eventId: event.id,
          eventType: event.eventType,
          message: thrown instanceof Error ? thrown.message : 'erro desconhecido',
        });
      }
    }

    log({ event: 'queue_run', claimed: events.length, processed, executions, durationMs: Date.now() - startedAt });

    return json({
      ok: true,
      message:
        events.length === 0
          ? 'Nenhum evento pendente.'
          : `${processed} evento(s) processado(s), ${executions} execução(ões).`,
      processedEvents: processed,
      executions,
    });
  } catch (thrown) {
    // Mensagem genérica ao cliente; o detalhe fica no log (§47 — não expor stack
    // trace ao usuário final).
    log({
      event: 'crashed',
      message: thrown instanceof Error ? thrown.message : 'erro desconhecido',
      durationMs: Date.now() - startedAt,
    });
    return json({ error: 'Erro interno ao processar automações.' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Modo cron
// ─────────────────────────────────────────────────────────────────────────────

/** Consome a fila de todas as empresas com trabalho pendente.
 *
 *  Uma empresa por vez, cada uma com o seu repositório e o seu executor. O escopo
 *  não é uma convenção: `createRepository(client, companyId)` fecha sobre a empresa
 *  e filtra toda consulta por ela, então um evento da empresa A não tem caminho
 *  para alcançar automação da empresa B mesmo rodando com service_role. */
async function runCron(adminClient: SupabaseClient, startedAt: number): Promise<Response> {
  const { data: companies, error } = await adminClient.rpc('automation_companies_with_pending_events', {
    p_limit: 25,
  });

  if (error) {
    log({ event: 'cron_companies_failed' });
    return json({ error: 'Não foi possível listar a fila.' }, 500);
  }

  const rows = (companies ?? []) as { company_id: string; pending_count: number }[];
  let totalProcessed = 0;
  let totalExecutions = 0;
  let companiesTouched = 0;

  for (const row of rows) {
    // Orçamento compartilhado entre as empresas. O que sobrar continua pendente e o
    // cron da próxima passagem pega — melhor do que estourar o tempo da função no
    // meio de uma execução e perder o registro do que já foi feito.
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;

    const companyId = row.company_id;
    const repository = createRepository(adminClient, companyId);
    const executor = createExecutor(adminClient, companyId);
    const engine = new AutomationEngine(repository, executor, undefined, createAgentRunner());

    const { data: claimed, error: claimError } = await adminClient.rpc('automation_claim_events', {
      p_company_id: companyId,
      p_limit: MAX_EVENTS_PER_RUN,
    });

    if (claimError) {
      log({ event: 'cron_claim_failed', companyId });
      continue;
    }

    companiesTouched += 1;

    for (const eventRow of ((claimed ?? []) as Record<string, unknown>[])) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;

      const event: AutomationEvent = toAutomationEvent(eventRow);

      try {
        const result = await engine.dispatchEvent(event);
        totalExecutions += result.outcomes.filter(o => o.kind === 'executed').length;
        totalProcessed += 1;
      } catch (thrown) {
        // Um evento problemático não para a fila da empresa nem das outras.
        await repository.markEventProcessed(event.id, 'failed');
        log({
          event: 'cron_dispatch_failed',
          companyId,
          eventId: event.id,
          eventType: event.eventType,
          message: thrown instanceof Error ? thrown.message : 'erro desconhecido',
        });
      }
    }
  }

  log({
    event: 'cron_run',
    companies: companiesTouched,
    processed: totalProcessed,
    executions: totalExecutions,
    durationMs: Date.now() - startedAt,
  });

  return json({
    ok: true,
    mode: 'cron',
    companies: companiesTouched,
    processedEvents: totalProcessed,
    executions: totalExecutions,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolução de DNS para o webhook
// ─────────────────────────────────────────────────────────────────────────────

/** É um endereço que o servidor não deveria alcançar por ordem do usuário?
 *
 *  Trabalha sobre o IP resolvido, não sobre o nome — é o que pega o rebind, em que um
 *  domínio público aponta para a rede interna. As faixas são as reservadas por
 *  RFC 1918 (privada), 127/8 (loopback), 169.254/16 (link-local, onde vive o serviço
 *  de metadados das nuvens que serve credenciais), 100.64/10 (CGNAT) e as
 *  equivalentes em IPv6. */
function isBlockedAddress(ip: string): boolean {
  const address = ip.trim().toLowerCase();

  // IPv6, incluindo as formas que embutem IPv4.
  if (address.includes(':')) {
    if (address === '::1' || address === '::') return true;
    // fc00::/7 — unique local. fe80::/10 — link-local.
    if (/^f[cd]/.test(address)) return true;
    if (/^fe[89ab]/.test(address)) return true;
    // ::ffff:10.0.0.1 e afins: extrai a parte IPv4 e reavalia.
    const mapped = address.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped != null) return isBlockedAddress(mapped[1]);
    return false;
  }

  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)) {
    // Não parece IPv4 válido. Bloqueado por precaução: um endereço que não se
    // consegue classificar não deve ser chamado.
    return true;
  }

  const [a, b] = octets;

  if (a === 0) return true;                          // 0.0.0.0/8
  if (a === 10) return true;                         // privada
  if (a === 127) return true;                        // loopback
  if (a === 169 && b === 254) return true;           // link-local / metadados
  if (a === 172 && b >= 16 && b <= 31) return true;  // privada
  if (a === 192 && b === 168) return true;           // privada
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;                         // multicast e reservado

  return false;
}

/** Resolve o host e recusa se QUALQUER endereço for interno.
 *
 *  Qualquer, não todos: um domínio que resolve para um IP público e um interno
 *  permitiria ao atacante escolher qual o cliente HTTP usa. Basta um ruim para
 *  recusar. */
async function resolveAndCheckHost(hostname: string): Promise<{ ip: string } | { problem: string }> {
  // Endereço literal não precisa de DNS — validateWebhookUrl já barra os óbvios, e
  // isBlockedAddress cobre o resto. Devolve o próprio literal como destino: não há
  // segunda resolução para divergir da primeira.
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    return isBlockedAddress(hostname)
      ? { problem: 'o endereço resolve para uma rede interna.' }
      : { ip: hostname };
  }

  const addresses: string[] = [];

  for (const recordType of ['A', 'AAAA'] as const) {
    try {
      const resolved = await Deno.resolveDns(hostname, recordType);
      addresses.push(...resolved);
    } catch {
      // Sem registro desse tipo é normal (um host só-IPv4 não tem AAAA). A ausência
      // total é tratada depois.
    }
  }

  if (addresses.length === 0) {
    // Não resolveu. Recusado em vez de tentado, e dizer o motivo real ajuda quem
    // configurou.
    return { problem: 'não foi possível resolver o endereço informado.' };
  }

  // QUALQUER endereço ruim reprova, não a maioria: um domínio que resolve para um IP
  // público e um interno permitiria ao atacante escolher qual o cliente usa.
  if (addresses.some(isBlockedAddress)) {
    // Sem revelar qual IP: a mensagem vai para o log da automação, que o cliente lê, e
    // o mapa interno da rede não precisa aparecer ali.
    return { problem: 'o endereço resolve para uma rede interna e foi recusado.' };
  }

  // O primeiro validado é o destino do TCP. Como TODOS passaram, escolher qualquer um
  // é seguro.
  return { ip: addresses[0] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agente — IA de verdade
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const AGENT_TIMEOUT_MS = 25_000;

/** Runner que consulta a Anthropic — o mesmo provedor do BlindAI do produto.
 *
 *  Devolve `null` quando a chave não está configurada, e aí o engine faz o node de
 *  agente FALHAR com mensagem clara. Essa é a linha entre não ter IA e simular IA: um
 *  runner que devolvesse texto genérico faria uma automação agir sobre estoque com
 *  base em nada.
 *
 *  Não chama a função blindai-agent porque aquela exige JWT de usuário, e o engine roda
 *  sem sessão no modo cron. A chave é secret do projeto e está disponível aqui. */
function createAgentRunner() {
  if (ANTHROPIC_API_KEY == null || ANTHROPIC_API_KEY === '') {
    log({ event: 'agent_unavailable', reason: 'missing_api_key' });
    return null;
  }

  return {
    async run(input: { prompt: string; maxTokens: number; companyId: string; dryRun: boolean }) {
      // Em teste, não gasta token nem chama a rede. A resposta é explicitamente
      // marcada como simulada, então nada no log finge ser saída do modelo.
      if (input.dryRun) {
        return { ok: true, text: null, errorMessage: undefined, simulated: true } as {
          ok: boolean;
          text: string | null;
          errorMessage?: string;
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: input.maxTokens,
            // Instrução de sistema separada do prompt do usuário: mantém o pedido do
            // cliente como conteúdo, não como instrução ao modelo.
            system:
              'Você é o BlindAI, assistente operacional de inventário do InventoryBlind. ' +
              'Responda em português do Brasil, de forma direta e curta. ' +
              'Use apenas os dados fornecidos no pedido; não invente números.',
            messages: [{ role: 'user', content: input.prompt }],
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          // Corpo não é lido nem logado: pode ecoar o prompt, que contém dado
          // operacional do cliente.
          return { ok: false, text: null, errorMessage: `BlindAI respondeu HTTP ${response.status}.` };
        }

        const body = await response.json();
        const text = Array.isArray(body?.content)
          ? body.content
              .filter((block: { type?: string }) => block?.type === 'text')
              .map((block: { text?: string }) => block.text ?? '')
              .join('\n')
              .trim()
          : '';

        if (text === '') {
          return { ok: false, text: null, errorMessage: 'BlindAI respondeu sem conteúdo.' };
        }

        return { ok: true, text };
      } catch (thrown) {
        const aborted = thrown instanceof Error && thrown.name === 'AbortError';
        return {
          ok: false,
          text: null,
          errorMessage: aborted
            ? `BlindAI não respondeu em ${AGENT_TIMEOUT_MS / 1000}s.`
            : 'Falha de rede ao consultar o BlindAI.',
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook com IP fixado — fecha o TOCTOU
//
// ── O que sobrava de brecha ─────────────────────────────────────────────────
// Resolver o DNS e validar os IPs impede o rebind óbvio. Mas entre a resolução e o
// `fetch` existe uma janela: o `fetch` resolve o nome DE NOVO, e um DNS hostil pode
// devolver 127.0.0.1 na segunda consulta. Isso é TOCTOU, e nenhuma validação de nome
// fecha.
//
// ── Como fecha ──────────────────────────────────────────────────────────────
// `Deno.connect({ hostname: <IP validado> })` abre o TCP para o endereço exato que
// passou pela checagem — nenhuma segunda resolução acontece. Depois
// `Deno.startTls(conn, { hostname: <domínio> })` faz o handshake usando o DOMÍNIO para
// SNI e verificação de certificado, então a segurança do TLS continua intacta: um
// atacante que aponte o DNS para a rede interna não consegue apresentar certificado
// válido para o domínio.
//
// Separar as duas coisas — para onde conecta e o que verifica — é o que o `fetch` não
// permite e é a razão de existir este cliente.
//
// ── Por que HTTP escrito à mão é aceitável aqui ─────────────────────────────
// O que esta ação precisa é minúsculo: enviar método, caminho, cabeçalhos e corpo, e
// ler a linha de status. Não interpreta corpo de resposta, não reusa conexão, não
// segue redirecionamento (redirecionamento seria outro destino, não validado). Isso
// cabe em código que se lê inteiro; um cliente HTTP completo não caberia.

/** Resposta mínima: só o que a automação registra. */
interface PinnedResponse {
  status: number;
}

/** Faz a requisição conectando ao IP já validado.
 *
 *  `Deno.writeAll` não existe mais; `conn.write` pode escrever parcialmente, então o
 *  laço é obrigatório — sem ele um corpo grande sairia truncado e o destino receberia
 *  JSON inválido. */
async function fetchWithPinnedIp(input: {
  url: URL;
  ip: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}): Promise<PinnedResponse> {
  const port = input.url.port !== '' ? Number(input.url.port) : 443;
  const path = input.url.pathname + input.url.search;

  const tcp = await Deno.connect({ hostname: input.ip, port });

  let conn: Deno.TlsConn;
  try {
    // O domínio, não o IP: é o que valida o certificado.
    conn = await Deno.startTls(tcp, { hostname: input.url.hostname });
  } catch (thrown) {
    tcp.close();
    throw thrown;
  }

  const timer = setTimeout(() => {
    try {
      conn.close();
    } catch {
      // Já fechada. Fechar duas vezes lança, e aqui não há o que fazer com o erro.
    }
  }, input.timeoutMs);

  try {
    const bodyBytes = new TextEncoder().encode(input.body);

    const headerLines = [
      `${input.method} ${path === '' ? '/' : path} HTTP/1.1`,
      // Host é obrigatório em HTTP/1.1 e precisa ser o DOMÍNIO — o servidor usa isso
      // para escolher o virtual host.
      `Host: ${input.url.host}`,
      // Fecha depois de responder: sem keep-alive não há framing de conexão
      // persistente para tratar.
      'Connection: close',
      `Content-Length: ${bodyBytes.byteLength}`,
      ...Object.entries(input.headers).map(([name, value]) => `${name}: ${value}`),
    ];

    const request = new TextEncoder().encode(headerLines.join('\r\n') + '\r\n\r\n');

    for (const chunk of [request, bodyBytes]) {
      let written = 0;
      while (written < chunk.byteLength) {
        written += await conn.write(chunk.subarray(written));
      }
    }

    // Lê só o suficiente para a linha de status. Um buffer pequeno basta: a primeira
    // linha de uma resposta HTTP tem poucas dezenas de bytes.
    const buffer = new Uint8Array(1024);
    const read = await conn.read(buffer);

    if (read == null || read === 0) {
      throw new Error('Resposta vazia do destino.');
    }

    const statusLine = new TextDecoder().decode(buffer.subarray(0, read)).split('\r\n')[0] ?? '';
    const match = statusLine.match(/^HTTP\/1\.[01] (\d{3})/);

    if (match == null) {
      // Não parece HTTP. Tratado como falha em vez de sucesso silencioso: o destino
      // pode ser outro protocolo, e assumir 200 diria à automação que deu certo.
      throw new Error('Resposta não reconhecida como HTTP.');
    }

    return { status: Number(match[1]) };
  } finally {
    clearTimeout(timer);
    try {
      conn.close();
    } catch {
      // Já fechada pelo timeout.
    }
  }
}
