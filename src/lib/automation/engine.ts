// Automation Engine — percorre o grafo e executa.
//
// Puro sobre duas interfaces: `AutomationRepository` (persistência) e
// `ActionExecutor` (efeito). O engine não conhece Supabase, Deno nem React, e é por
// isso que a travessia, a proteção contra loop e a idempotência têm teste sem
// banco.
//
// ── Proteção contra loop (§13), em três camadas ─────────────────────────────
// Uma ação pode produzir um evento — criar recontagem insere sessão, que dispara
// `count.session_created`. Sem contenção, duas automações se alimentam
// indefinidamente. As três camadas são independentes de propósito, porque cada uma
// falha de um jeito diferente:
//
//   1. PROFUNDIDADE. Todo evento carrega `depth`; um evento nascido de execução tem
//      depth+1. Acima de MAX_DEPTH o engine recusa. Contém cadeia entre automações
//      diferentes, que é o caso que nenhuma checagem local pega.
//   2. AUTO-DISPARO. Uma automação não reage a evento que ela mesma originou. Contém
//      o ciclo de comprimento um, o mais fácil de criar por acidente.
//   3. PASSOS. MAX_NODE_VISITS por execução. Contém ciclo dentro de um workflow que
//      passou pela validação — a garantia que não depende de o detector de ciclo
//      estar correto.
//
// ── Idempotência (§12) ─────────────────────────────────────────────────────
// O par (automação, evento) tem índice único no banco. O engine tenta criar a
// execução e trata colisão como "já processado", em vez de consultar antes: entre a
// consulta e a inserção há uma janela em que dois workers passam pela verificação.
// Deixar o banco decidir é a única forma correta sob concorrência (§40).

import { readPath } from './conditions.ts';
import {
  describeGroupEvaluation,
  evaluateConditionGroup,
  toConditionGroup,
} from './conditionGroups.ts';
import { interpolateConfig } from './interpolation.ts';
import { ACTIONS, effectiveMaxAttempts, isKnownAction, type ActionKey } from './registry.ts';
import { MAX_NODE_VISITS, findTriggerNode, nextNodeId, validateWorkflow } from './workflow.ts';
import { SWITCH_BRANCH_PREFIX } from './types.ts';
import type {
  Automation,
  AutomationEvent,
  ExecutionContext,
  ExecutionStatus,
  NodeExecutionStatus,
  TriggerSource,
} from './types.ts';

/** Profundidade máxima de encadeamento entre automações. Três é o suficiente para
 *  uma cadeia legítima (contagem → recontagem → aviso) e curto o bastante para uma
 *  cadeia acidental parar antes de virar carga. */
export const MAX_DEPTH = 3;

/** Teto absoluto de iterações de um laço, independente do que o node pedir.
 *
 *  O node tem o seu próprio limite, escolhido por quem configurou. Este é o teto do
 *  ENGINE: mesmo alguém pedindo 10.000, o laço roda dentro de uma execução com tempo
 *  finito, e passar disso significa estourar a função no meio com metade das ações
 *  aplicadas. */
export const MAX_LOOP_ITERATIONS = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface CreatedExecution {
  id: string;
  /** `true` quando o par (automação, evento) já existia. O engine para sem
   *  executar nada. */
  duplicate: boolean;
}

export interface NodeLogEntry {
  nodeId: string;
  nodeType: string;
  nodeLabel: string | null;
  sequence: number;
  status: NodeExecutionStatus;
  conditionResult: boolean | null;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  attempts: number;
  durationMs: number;
}

export interface AutomationRepository {
  /** Automações ativas da empresa para um trigger. Filtrado no banco por
   *  (empresa, trigger, ativo) — nunca varre tudo (§39). */
  findActiveAutomations(companyId: string, triggerType: string): Promise<Automation[]>;

  /** Cria a execução. Deve devolver `duplicate: true` na violação do índice único,
   *  não lançar. */
  createExecution(input: {
    companyId: string;
    automationId: string;
    eventId: string | null;
    automationVersion: number;
    triggerType: string;
    triggerSource: TriggerSource;
    dryRun: boolean;
    context: ExecutionContext;
    depth: number;
    triggeredBy: string | null;
    /** Preenchidos quando esta execução é a continuação de uma espera. */
    resumedFromExecutionId?: string | null;
    resumedAtNodeId?: string | null;
  }): Promise<CreatedExecution>;

  recordNodeExecution(executionId: string, companyId: string, entry: NodeLogEntry): Promise<void>;

  finishExecution(input: {
    executionId: string;
    status: ExecutionStatus;
    errorMessage: string | null;
    durationMs: number;
    context: ExecutionContext;
  }): Promise<void>;

  bumpCounters(automationId: string, executedAt: string): Promise<void>;

  markEventProcessed(eventId: string, status: 'processed' | 'skipped' | 'failed'): Promise<void>;

  /** Registra uma espera por chamada externa e devolve o token que a retoma.
   *  null quando não havia nada após a espera. */
  scheduleWebhookWait(input: {
    companyId: string;
    automationId: string;
    executionId: string;
    eventType: string;
    payload: Record<string, unknown>;
    resumeNodeId: string | null;
    resumeActions: Record<string, unknown>;
    timeoutMinutes: number;
    depth: number;
  }): Promise<{ token: string } | null>;

  /** Agenda a continuação do workflow depois de uma espera. Devolve o id do evento
   *  de retomada, ou null quando não havia nada após a espera. */
  scheduleResume(input: {
    companyId: string;
    automationId: string;
    executionId: string;
    eventType: string;
    payload: Record<string, unknown>;
    resumeNodeId: string | null;
    resumeActions: Record<string, unknown>;
    delayMinutes: number;
    depth: number;
  }): Promise<string | null>;
}

export interface ActionResult {
  ok: boolean;
  /** Vai para `actions.<nodeId>` no contexto, disponível às ações seguintes. */
  output: Record<string, unknown>;
  errorMessage?: string;
  /** Falha transitória — só esta é retentada. Um parâmetro inválido não melhora na
   *  segunda tentativa e retentá-lo só multiplica o erro no log. */
  retryable?: boolean;
}

export interface ActionExecutor {
  execute(input: {
    actionType: string;
    config: Record<string, unknown>;
    context: ExecutionContext;
    companyId: string;
    executionId: string;
    automationId: string;
    depth: number;
    dryRun: boolean;
  }): Promise<ActionResult>;
}

/** Consulta ao modelo. Injetado como o executor de ações, e pelo mesmo motivo: o
 *  engine não deve conhecer nem provedor nem chave. */
export interface AgentRunner {
  run(input: {
    prompt: string;
    maxTokens: number;
    companyId: string;
    dryRun: boolean;
  }): Promise<{ ok: boolean; text: string | null; errorMessage?: string }>;
}

/** Injetado em vez de lido do relógio para os testes fixarem o tempo. */
export interface EngineClock {
  now(): number;
}

export const SYSTEM_CLOCK: EngineClock = { now: () => Date.now() };

// ─────────────────────────────────────────────────────────────────────────────
// Resultado
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionOutcome =
  | { kind: 'executed'; executionId: string; status: ExecutionStatus; nodes: NodeLogEntry[] }
  | { kind: 'duplicate'; executionId: string }
  | {
      kind: 'skipped';
      reason: 'depth_exceeded' | 'self_triggered' | 'invalid_workflow' | 'not_active' | 'no_trigger';
      detail?: string;
    };

/** Ponto de retomada que um evento de espera carrega. */
export interface ResumeInstruction {
  automationId: string;
  nodeId: string;
  /** Contexto de actions acumulado antes da espera. */
  actions: Record<string, unknown>;
  fromExecutionId: string | null;
}

export interface DispatchResult {
  eventId: string;
  matched: number;
  outcomes: ExecutionOutcome[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Despacho de um evento
// ─────────────────────────────────────────────────────────────────────────────

export class AutomationEngine {
  constructor(
    private readonly repository: AutomationRepository,
    private readonly executor: ActionExecutor,
    private readonly clock: EngineClock = SYSTEM_CLOCK,
    /** Ausente = nodes de agente falham com mensagem clara em vez de devolver texto
     *  inventado. É a diferença entre não ter IA e simular IA. */
    private readonly agent: AgentRunner | null = null
  ) {}

  /** Um evento → todas as automações ativas interessadas.
   *
   *  Uma automação que falha não interrompe as outras: são independentes, e deixar
   *  a primeira falha abortar o lote faria a ordem de cadastro decidir quem roda. */
  async dispatchEvent(event: AutomationEvent): Promise<DispatchResult> {
    // Camada 1 do anti-loop, antes de qualquer consulta: nem vale procurar
    // automação para um evento que já está fundo demais.
    if (event.depth >= MAX_DEPTH) {
      await this.repository.markEventProcessed(event.id, 'skipped');
      return {
        eventId: event.id,
        matched: 0,
        outcomes: [{ kind: 'skipped', reason: 'depth_exceeded', detail: `profundidade ${event.depth}` }],
      };
    }

    const automations = await this.repository.findActiveAutomations(event.companyId, event.eventType);
    const outcomes: ExecutionOutcome[] = [];

    for (const automation of automations) {
      // Camada 2: a automação não reage ao que ela mesma causou.
      //
      // A retomada é a EXCEÇÃO: um evento de espera tem origin_automation_id igual à
      // própria automação por construção, e recusá-lo faria toda espera morrer no
      // meio. O que distingue não é a origem, é a presença do ponto de retomada.
      const isResume = event.resume != null && event.resume.automationId === automation.id;
      if (!isResume && event.originAutomationId != null && event.originAutomationId === automation.id) {
        outcomes.push({ kind: 'skipped', reason: 'self_triggered', detail: automation.name });
        continue;
      }

      // Um evento de retomada pertence a UMA automação. Sem isto, outra automação
      // com o mesmo gatilho executaria a partir de um node que não é dela.
      if (event.resume != null && event.resume.automationId !== automation.id) {
        continue;
      }

      try {
        outcomes.push(
          await this.runAutomation({
            automation,
            event,
            triggerSource: 'event',
            dryRun: false,
            triggeredBy: null,
          })
        );
      } catch (thrown) {
        // Registrado como resultado, não propagado: o evento precisa ser marcado
        // como processado no fim, senão a fila o reentrega para sempre.
        outcomes.push({
          kind: 'skipped',
          reason: 'invalid_workflow',
          detail: thrown instanceof Error ? thrown.message : 'erro desconhecido',
        });
      }
    }

    await this.repository.markEventProcessed(event.id, 'processed');

    return { eventId: event.id, matched: automations.length, outcomes };
  }

  /** Executa uma automação. Também é o caminho da execução manual (§33), aí com
   *  `event` nulo e um contexto informado pelo chamador. */
  async runAutomation(input: {
    automation: Automation;
    event: AutomationEvent | null;
    triggerSource: TriggerSource;
    dryRun: boolean;
    triggeredBy: string | null;
    /** Contexto para execução manual, quando não há evento. */
    manualContext?: Record<string, unknown>;
  }): Promise<ExecutionOutcome> {
    const { automation, event, triggerSource, dryRun, triggeredBy } = input;
    const workflow = automation.workflow;

    const trigger = findTriggerNode(workflow);
    if (trigger == null) {
      return { kind: 'skipped', reason: 'no_trigger' };
    }

    // Revalidado no momento da execução, não só ao ativar. Uma automação pode ter
    // sido ativada por uma versão anterior do validador, ou ter dado entrada por
    // outro caminho — e executar um grafo inválido é pior do que não executar.
    const validation = validateWorkflow(workflow);
    if (!validation.valid) {
      return {
        kind: 'skipped',
        reason: 'invalid_workflow',
        detail: validation.problems.find(p => p.severity === 'error')?.message,
      };
    }

    const resume = event?.resume ?? null;

    const context: ExecutionContext = {
      trigger: (event?.payload ?? input.manualContext ?? {}) as Record<string, unknown>,
      // A retomada restaura o que as ações antes da espera produziram. Sem isso, uma
      // interpolação na segunda metade do workflow que dependesse da primeira viraria
      // '(indisponível)'.
      actions: resume?.actions ?? {},
    };

    const depth = (event?.depth ?? 0) + 1;

    const created = await this.repository.createExecution({
      companyId: automation.companyId,
      automationId: automation.id,
      eventId: event?.id ?? null,
      automationVersion: automation.version,
      triggerType: automation.triggerType,
      triggerSource,
      dryRun,
      context,
      depth,
      triggeredBy,
      resumedFromExecutionId: resume?.fromExecutionId ?? null,
      resumedAtNodeId: resume?.nodeId ?? null,
    });

    // Idempotência: outro worker já criou esta execução.
    if (created.duplicate) {
      return { kind: 'duplicate', executionId: created.id };
    }

    const startedAt = this.clock.now();
    const nodes: NodeLogEntry[] = [];
    let sequence = 0;
    let failures = 0;
    let actionsRun = 0;
    let firstError: string | null = null;

    // O trigger entra no log como primeiro passo. Sem ele, o histórico começa numa
    // condição e não mostra o que iniciou a execução.
    sequence += 1;
    const triggerEntry: NodeLogEntry = {
      nodeId: trigger.id,
      nodeType: 'trigger',
      nodeLabel: trigger.label ?? null,
      sequence,
      status: 'success',
      conditionResult: null,
      output: resume != null
        ? { eventType: event?.eventType ?? 'manual', resumedAtNode: resume.nodeId }
        : { eventType: event?.eventType ?? 'manual' },
      errorMessage: null,
      attempts: 1,
      durationMs: 0,
    };
    nodes.push(triggerEntry);
    await this.repository.recordNodeExecution(created.id, automation.companyId, triggerEntry);

    // Retomada começa no node gravado; execução normal começa depois do gatilho.
    let currentId: string | null = resume != null ? resume.nodeId : nextNodeId(workflow, trigger.id, 'next');
    let visits = 0;

    while (currentId != null) {
      // Camada 3: teto de passos.
      visits += 1;
      if (visits > MAX_NODE_VISITS) {
        failures += 1;
        firstError ??= `A execução passou de ${MAX_NODE_VISITS} passos e foi interrompida.`;
        break;
      }

      const node = workflow.nodes.find(n => n.id === currentId) ?? null;
      if (node == null) break;

      const nodeStarted = this.clock.now();
      sequence += 1;

      if (node.type === 'condition') {
        // Avaliado como grupo, com aninhamento quando existir. A forma antiga (só
        // logic + rules) é um grupo de um nível, então nada precisou migrar.
        const outcome = evaluateConditionGroup(toConditionGroup(node), context);
        const entry: NodeLogEntry = {
          nodeId: node.id,
          nodeType: 'condition',
          nodeLabel: node.label ?? null,
          sequence,
          status: 'success',
          conditionResult: outcome.passed,
          output: { evaluation: describeGroupEvaluation(outcome) },
          errorMessage: null,
          attempts: 1,
          durationMs: this.clock.now() - nodeStarted,
        };
        nodes.push(entry);
        await this.repository.recordNodeExecution(created.id, automation.companyId, entry);

        // Condição falsa encerra o caminho. Não é falha — é a automação decidindo
        // não agir, e marcar como falha faria o histórico ficar vermelho para toda
        // contagem correta.
        if (!outcome.passed) break;

        currentId = nextNodeId(workflow, node.id, 'next');
        continue;
      }

      if (node.type === 'branch') {
        const outcome = evaluateConditionGroup(toConditionGroup(node), context);
        const entry: NodeLogEntry = {
          nodeId: node.id,
          nodeType: 'branch',
          nodeLabel: node.label ?? null,
          sequence,
          status: 'success',
          conditionResult: outcome.passed,
          output: { evaluation: describeGroupEvaluation(outcome), taken: outcome.passed ? 'true' : 'false' },
          errorMessage: null,
          attempts: 1,
          durationMs: this.clock.now() - nodeStarted,
        };
        nodes.push(entry);
        await this.repository.recordNodeExecution(created.id, automation.companyId, entry);

        // A saída não ligada encerra o caminho — "nenhuma ação" é um resultado
        // válido, e é literalmente o cenário 2 do briefing (§54).
        currentId = nextNodeId(workflow, node.id, outcome.passed ? 'true' : 'false');
        continue;
      }

      if (node.type === 'delay') {
        // A espera INTERROMPE. Agenda a continuação e encerra esta execução — ver o
        // comentário em DelayNode sobre por que não é um sleep.
        const resumeTarget = nextNodeId(workflow, node.id, 'next');

        const resumeEventId = await this.repository.scheduleResume({
          companyId: automation.companyId,
          automationId: automation.id,
          executionId: created.id,
          eventType: automation.triggerType,
          payload: context.trigger,
          resumeNodeId: resumeTarget,
          resumeActions: context.actions,
          delayMinutes: node.minutes,
          // Profundidade preservada: a espera é a mesma automação continuando, não um
          // encadeamento novo. Incrementar faria três esperas em série estourarem o
          // limite anti-loop.
          depth: event?.depth ?? 0,
        });

        const entry: NodeLogEntry = {
          nodeId: node.id,
          nodeType: 'delay',
          nodeLabel: node.label ?? null,
          sequence,
          status: 'success',
          conditionResult: null,
          output: resumeTarget == null
            ? { minutes: node.minutes, note: 'Nada após a espera — execução encerrada aqui.' }
            : { minutes: node.minutes, resumesAtNode: resumeTarget, resumeEventId },
          errorMessage: null,
          attempts: 1,
          durationMs: this.clock.now() - nodeStarted,
        };
        nodes.push(entry);
        await this.repository.recordNodeExecution(created.id, automation.companyId, entry);

        // Encerra o laço: o resto do workflow roda na execução de retomada.
        break;
      }

      if (node.type === 'switch') {
        const actual = readPath(context, node.field);
        const matched = node.cases.find(candidate => looseEqualsForSwitch(actual, candidate.value)) ?? null;
        const branch = matched != null ? SWITCH_BRANCH_PREFIX + matched.value : 'default';

        const entry: NodeLogEntry = {
          nodeId: node.id,
          nodeType: 'switch',
          nodeLabel: node.label ?? null,
          sequence,
          status: 'success',
          conditionResult: null,
          output: {
            field: node.field,
            // O valor observado, não só o caminho tomado: é o que permite entender
            // por que caiu no default.
            actual: actual == null ? null : String(actual),
            taken: branch,
          },
          errorMessage: null,
          attempts: 1,
          durationMs: this.clock.now() - nodeStarted,
        };
        nodes.push(entry);
        await this.repository.recordNodeExecution(created.id, automation.companyId, entry);

        // Saída não ligada encerra o caminho, igual ao branch.
        currentId = nextNodeId(workflow, node.id, branch);
        continue;
      }

      if (node.type === 'loop') {
        const raw = readPath(context, node.field);
        const items = Array.isArray(raw) ? raw : [];
        const cap = Math.max(1, Math.min(node.maxIterations, MAX_LOOP_ITERATIONS));
        const bodyStart = nextNodeId(workflow, node.id, 'loop');

        let iterations = 0;
        let truncated = false;
        let bodyFailures = 0;

        if (bodyStart != null && items.length > 0) {
          for (const item of items) {
            if (iterations >= cap) {
              truncated = true;
              break;
            }
            iterations += 1;

            // O item corrente entra no contexto sob `loop`, e sai ao terminar. Um
            // espaço de nomes próprio em vez de mexer em `trigger`: o corpo do laço
            // precisa ler o item sem que o dado do gatilho pareça ter mudado.
            const loopContext: ExecutionContext = {
              ...context,
              loop: { item, index: iterations - 1, total: items.length },
            } as ExecutionContext;

            const body = await this.runPath({
              workflow,
              startNodeId: bodyStart,
              context: loopContext,
              automation,
              executionId: created.id,
              event,
              depth,
              dryRun,
              sequenceStart: sequence,
              // O teto global é compartilhado com o fluxo principal: um laço de 50
              // iterações com 3 nodes no corpo não deve conseguir gastar 150 passos
              // enquanto o resto do workflow fica sem orçamento.
              visitBudget: MAX_NODE_VISITS - visits,
            });

            sequence = body.sequence;
            visits += body.visits;
            bodyFailures += body.failures;
            nodes.push(...body.nodes);

            // As saídas das ações do corpo ficam disponíveis para as iterações
            // seguintes e para depois do laço, como qualquer ação.
            Object.assign(context.actions, body.context.actions);

            if (visits >= MAX_NODE_VISITS) {
              truncated = true;
              break;
            }
          }
        }

        failures += bodyFailures;
        if (bodyFailures > 0) actionsRun += 1;

        sequence += 1;
        const entry: NodeLogEntry = {
          nodeId: node.id,
          nodeType: 'loop',
          nodeLabel: node.label ?? null,
          sequence,
          status: 'success',
          conditionResult: null,
          output: {
            field: node.field,
            // Distingue "a lista estava vazia" de "o campo não era uma lista": os dois
            // dão zero iterações e significam coisas diferentes.
            listFound: Array.isArray(raw),
            items: items.length,
            iterations,
            truncated,
            ...(bodyStart == null ? { note: 'Nada ligado à saída do laço.' } : {}),
          },
          errorMessage: truncated ? `Interrompido em ${iterations} de ${items.length} itens.` : null,
          attempts: 1,
          durationMs: this.clock.now() - nodeStarted,
        };
        nodes.push(entry);
        await this.repository.recordNodeExecution(created.id, automation.companyId, entry);

        currentId = nextNodeId(workflow, node.id, 'after');
        continue;
      }

      if (node.type === 'webhook_wait') {
        // Mesma mecânica do delay, gatilho diferente: para, grava onde continuar, e
        // um POST autenticado no endpoint retoma. O prazo existe para a execução não
        // ficar pendente para sempre quando o sistema externo nunca responde.
        const resumeTarget = nextNodeId(workflow, node.id, 'next');

        const wait = await this.repository.scheduleWebhookWait({
          companyId: automation.companyId,
          automationId: automation.id,
          executionId: created.id,
          eventType: automation.triggerType,
          payload: context.trigger,
          resumeNodeId: resumeTarget,
          resumeActions: context.actions,
          timeoutMinutes: node.timeoutMinutes,
          depth: event?.depth ?? 0,
        });

        sequence += 1;
        const entry: NodeLogEntry = {
          nodeId: node.id,
          nodeType: 'webhook_wait',
          nodeLabel: node.label ?? null,
          sequence,
          status: 'success',
          conditionResult: null,
          output:
            resumeTarget == null
              ? { note: 'Nada após a espera — execução encerrada aqui.' }
              : {
                  timeoutMinutes: node.timeoutMinutes,
                  resumesAtNode: resumeTarget,
                  // O token é o que o sistema externo apresenta para retomar. Vai para
                  // o log porque é a única forma de o usuário descobri-lo.
                  waitToken: wait?.token ?? null,
                },
          errorMessage: null,
          attempts: 1,
          durationMs: this.clock.now() - nodeStarted,
        };
        nodes.push(entry);
        await this.repository.recordNodeExecution(created.id, automation.companyId, entry);

        break;
      }

      if (node.type === 'agent') {
        const result = await this.runAgent({ node, context, automation, executionId: created.id, dryRun });

        actionsRun += 1;
        if (!result.ok) {
          failures += 1;
          firstError ??= result.errorMessage ?? 'Falha ao consultar o BlindAI.';
        } else {
          // A resposta fica em `actions.<id>.text`, então um node seguinte a usa por
          // variável como qualquer outra saída.
          context.actions[node.id] = result.output;
        }

        sequence += 1;
        const entry: NodeLogEntry = {
          nodeId: node.id,
          nodeType: 'agent',
          nodeLabel: node.label ?? null,
          sequence,
          status: result.ok ? 'success' : 'failed',
          conditionResult: null,
          output: result.output,
          errorMessage: result.errorMessage ?? null,
          attempts: result.attempts,
          durationMs: this.clock.now() - nodeStarted,
        };
        nodes.push(entry);
        await this.repository.recordNodeExecution(created.id, automation.companyId, entry);

        currentId = nextNodeId(workflow, node.id, 'next');
        continue;
      }

      if (node.type === 'action') {
        const result = await this.runActionWithRetry({
          node,
          context,
          automation,
          executionId: created.id,
          depth,
          dryRun,
        });

        actionsRun += 1;
        if (!result.ok) {
          failures += 1;
          firstError ??= result.errorMessage ?? 'Falha ao executar a ação.';
        } else {
          // Saída disponível para as ações seguintes (§21).
          context.actions[node.id] = result.output;
        }

        const entry: NodeLogEntry = {
          nodeId: node.id,
          nodeType: 'action',
          nodeLabel: node.label ?? null,
          sequence,
          status: result.ok ? 'success' : 'failed',
          conditionResult: null,
          output: result.output,
          errorMessage: result.errorMessage ?? null,
          attempts: result.attempts,
          durationMs: this.clock.now() - nodeStarted,
        };
        nodes.push(entry);
        await this.repository.recordNodeExecution(created.id, automation.companyId, entry);

        // Segue mesmo em falha: notificar o supervisor ainda vale a pena quando o
        // webhook caiu, e abortar faria o resultado depender da ordem das ações.
        currentId = nextNodeId(workflow, node.id, 'next');
        continue;
      }

      // Tipo de node desconhecido — workflow de uma versão futura. Registrado como
      // ignorado e a execução segue, em vez de falhar tudo.
      const entry: NodeLogEntry = {
        nodeId: node.id,
        nodeType: (node as { type: string }).type,
        nodeLabel: (node as { label?: string }).label ?? null,
        sequence,
        status: 'skipped',
        conditionResult: null,
        output: null,
        errorMessage: 'Tipo de bloco não suportado nesta versão.',
        attempts: 1,
        durationMs: 0,
      };
      nodes.push(entry);
      await this.repository.recordNodeExecution(created.id, automation.companyId, entry);
      currentId = nextNodeId(workflow, node.id, 'next');
    }

    const status: ExecutionStatus =
      failures === 0 ? 'success' : failures >= actionsRun && actionsRun > 0 ? 'failed' : 'partial';

    const durationMs = this.clock.now() - startedAt;

    await this.repository.finishExecution({
      executionId: created.id,
      status,
      errorMessage: firstError,
      durationMs,
      context,
    });

    // Contadores só para execução real. Um teste inflar "127 execuções" tornaria o
    // número inútil como sinal de uso.
    if (!dryRun) {
      await this.repository.bumpCounters(automation.id, new Date(this.clock.now()).toISOString());
    }

    return { kind: 'executed', executionId: created.id, status, nodes };
  }

  /** Executa uma ação, com retentativa quando o registry permite.
   *
   *  Retenta só o que é `external` E devolveu `retryable`. Uma ação não idempotente
   *  como criar recontagem tem maxAttempts 1 pelo registry, então uma falha
   *  ambígua — timeout depois de a criação ter acontecido — não vira duas
   *  recontagens. */
  /** Executa um caminho do grafo sem criar execução nova — o corpo de um laço.
   *
   *  ── Por que um percurso separado e não recursão do laço principal ──────────
   *  O laço principal cria execução, grava contadores e decide status final. Um corpo
   *  de laço não faz nada disso: ele contribui para a MESMA execução, e por isso
   *  recebe a sequência e o orçamento de passos de quem o chamou, e devolve quanto
   *  gastou.
   *
   *  ── O que NÃO é permitido dentro de um laço ───────────────────────────────
   *  `delay`, `webhook_wait` e outro `loop`. Os dois primeiros interrompem a execução,
   *  e interromper no meio de uma iteração deixaria as anteriores aplicadas e as
   *  seguintes não — sem forma de retomar do meio da lista. O terceiro multiplica o
   *  custo de forma que o teto de passos não expressa bem. A validação recusa os três,
   *  e aqui eles são registrados como ignorados em vez de silenciosamente pulados. */
  private async runPath(input: {
    workflow: Automation['workflow'];
    startNodeId: string;
    context: ExecutionContext;
    automation: Automation;
    executionId: string;
    event: AutomationEvent | null;
    depth: number;
    dryRun: boolean;
    sequenceStart: number;
    visitBudget: number;
  }): Promise<PathResult> {
    const { workflow, context, automation, executionId, depth, dryRun } = input;

    const nodes: NodeLogEntry[] = [];
    let sequence = input.sequenceStart;
    let visits = 0;
    let failures = 0;
    let currentId: string | null = input.startNodeId;

    while (currentId != null) {
      if (visits >= input.visitBudget) break;
      visits += 1;

      const node = workflow.nodes.find(n => n.id === currentId) ?? null;
      if (node == null) break;

      const nodeStarted = this.clock.now();
      sequence += 1;

      if (node.type === 'condition') {
        const outcome = evaluateConditionGroup(toConditionGroup(node), context);
        const entry: NodeLogEntry = {
          nodeId: node.id,
          nodeType: 'condition',
          nodeLabel: node.label ?? null,
          sequence,
          status: 'success',
          conditionResult: outcome.passed,
          output: { evaluation: describeGroupEvaluation(outcome) },
          errorMessage: null,
          attempts: 1,
          durationMs: this.clock.now() - nodeStarted,
        };
        nodes.push(entry);
        await this.repository.recordNodeExecution(executionId, automation.companyId, entry);

        // Condição falsa encerra ESTA iteração, não o laço: o item seguinte pode
        // passar. É a diferença entre filtrar e abortar.
        if (!outcome.passed) break;

        currentId = nextNodeId(workflow, node.id, 'next');
        continue;
      }

      if (node.type === 'branch' || node.type === 'switch') {
        const branch =
          node.type === 'branch'
            ? evaluateConditionGroup(toConditionGroup(node), context).passed
              ? 'true'
              : 'false'
            : (() => {
                const actual = readPath(context, node.field);
                const matched = node.cases.find(c => looseEqualsForSwitch(actual, c.value));
                return matched != null ? SWITCH_BRANCH_PREFIX + matched.value : 'default';
              })();

        const entry: NodeLogEntry = {
          nodeId: node.id,
          nodeType: node.type,
          nodeLabel: node.label ?? null,
          sequence,
          status: 'success',
          conditionResult: node.type === 'branch' ? branch === 'true' : null,
          output: { taken: branch },
          errorMessage: null,
          attempts: 1,
          durationMs: this.clock.now() - nodeStarted,
        };
        nodes.push(entry);
        await this.repository.recordNodeExecution(executionId, automation.companyId, entry);

        currentId = nextNodeId(workflow, node.id, branch);
        continue;
      }

      if (node.type === 'agent') {
        const result = await this.runAgent({ node, context, automation, executionId, dryRun });
        if (!result.ok) failures += 1;
        else context.actions[node.id] = result.output;

        const entry: NodeLogEntry = {
          nodeId: node.id,
          nodeType: 'agent',
          nodeLabel: node.label ?? null,
          sequence,
          status: result.ok ? 'success' : 'failed',
          conditionResult: null,
          output: result.output,
          errorMessage: result.errorMessage ?? null,
          attempts: result.attempts,
          durationMs: this.clock.now() - nodeStarted,
        };
        nodes.push(entry);
        await this.repository.recordNodeExecution(executionId, automation.companyId, entry);

        currentId = nextNodeId(workflow, node.id, 'next');
        continue;
      }

      if (node.type === 'action') {
        const result = await this.runActionWithRetry({
          node,
          context,
          automation,
          executionId,
          depth,
          dryRun,
        });

        if (!result.ok) failures += 1;
        else context.actions[node.id] = result.output;

        const entry: NodeLogEntry = {
          nodeId: node.id,
          nodeType: 'action',
          nodeLabel: node.label ?? null,
          sequence,
          status: result.ok ? 'success' : 'failed',
          conditionResult: null,
          output: result.output,
          errorMessage: result.errorMessage ?? null,
          attempts: result.attempts,
          durationMs: this.clock.now() - nodeStarted,
        };
        nodes.push(entry);
        await this.repository.recordNodeExecution(executionId, automation.companyId, entry);

        currentId = nextNodeId(workflow, node.id, 'next');
        continue;
      }

      // delay, webhook_wait, loop, trigger: não fazem sentido aqui. Registrado como
      // ignorado, com o motivo, em vez de pulado em silêncio.
      const entry: NodeLogEntry = {
        nodeId: node.id,
        nodeType: node.type,
        nodeLabel: (node as { label?: string }).label ?? null,
        sequence,
        status: 'skipped',
        conditionResult: null,
        output: null,
        errorMessage: 'Este tipo de bloco não pode rodar dentro de um laço.',
        attempts: 1,
        durationMs: 0,
      } as NodeLogEntry;
      nodes.push(entry);
      await this.repository.recordNodeExecution(executionId, automation.companyId, entry);
      break;
    }

    return { nodes, context, sequence, visits, failures };
  }

  /** Consulta o modelo.
   *
   *  Sem runner injetado, FALHA com mensagem clara. Não devolve texto genérico nem
   *  simula resposta: uma automação que age sobre estoque baseada em texto inventado é
   *  pior do que uma automação que não roda. */
  private async runAgent(input: {
    node: { id: string; prompt: string; maxTokens?: number };
    context: ExecutionContext;
    automation: Automation;
    executionId: string;
    dryRun: boolean;
  }): Promise<{ ok: boolean; output: Record<string, unknown>; errorMessage?: string; attempts: number }> {
    const { node, context, automation, dryRun } = input;

    if (this.agent == null) {
      return {
        ok: false,
        output: {},
        errorMessage: 'Consulta ao BlindAI não disponível neste ambiente.',
        attempts: 1,
      };
    }

    // Interpolado como qualquer campo de ação: o contexto entra no prompt por
    // variável, e o modelo não tem acesso livre aos dados.
    const interpolated = interpolateConfig({ prompt: node.prompt }, ['prompt'], context);
    const prompt = String(interpolated.config.prompt ?? '');

    if (prompt.trim() === '') {
      return { ok: false, output: {}, errorMessage: 'Prompt vazio.', attempts: 1 };
    }

    const result = await this.agent.run({
      prompt,
      // Teto conservador por padrão: o custo é por token e a automação pode rodar a
      // cada contagem.
      maxTokens: Math.max(64, Math.min(node.maxTokens ?? 512, 2048)),
      companyId: automation.companyId,
      dryRun,
    });

    if (!result.ok) {
      return {
        ok: false,
        output: {},
        errorMessage: result.errorMessage ?? 'Falha ao consultar o BlindAI.',
        attempts: 1,
      };
    }

    return {
      ok: true,
      output: {
        text: result.text,
        ...(interpolated.unresolved.length > 0 ? { unresolvedVariables: interpolated.unresolved } : {}),
      },
      attempts: 1,
    };
  }

  private async runActionWithRetry(input: {
    node: { id: string; actionType: string; config: Record<string, unknown>; maxAttempts?: number };
    context: ExecutionContext;
    automation: Automation;
    executionId: string;
    depth: number;
    dryRun: boolean;
  }): Promise<ActionResult & { attempts: number }> {
    const { node, context, automation, executionId, depth, dryRun } = input;

    if (!isKnownAction(node.actionType)) {
      return {
        ok: false,
        output: {},
        errorMessage: `Ação desconhecida: ${node.actionType}`,
        attempts: 1,
      };
    }

    const definition = ACTIONS[node.actionType as ActionKey];
    const maxAttempts = effectiveMaxAttempts(node.actionType, node.maxAttempts);

    // Interpolação uma vez, antes das tentativas: refazer a cada retentativa poderia
    // produzir um texto diferente se o contexto tivesse mudado no meio.
    const interpolableKeys = definition.params.filter(p => p.interpolable).map(p => p.key);
    const { config, unresolved } = interpolateConfig(node.config, interpolableKeys, context);

    let attempts = 0;
    let last: ActionResult = { ok: false, output: {}, errorMessage: 'Ação não executada.' };

    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        last = await this.executor.execute({
          actionType: node.actionType,
          config,
          context,
          companyId: automation.companyId,
          executionId,
          automationId: automation.id,
          depth,
          dryRun,
        });
      } catch (thrown) {
        last = {
          ok: false,
          output: {},
          errorMessage: thrown instanceof Error ? thrown.message : 'Erro desconhecido na ação.',
          retryable: false,
        };
      }

      if (last.ok || last.retryable !== true) break;
    }

    // Variável não resolvida vai para o output, não para o erro: a ação funcionou,
    // só produziu um texto incompleto, e o usuário precisa ver isso sem a execução
    // aparecer como falha.
    const output = unresolved.length > 0 ? { ...last.output, unresolvedVariables: unresolved } : last.output;

    return { ...last, output, attempts };
  }
}

/** Igualdade para os casos de um switch.
 *
 *  Os valores dos casos são texto digitado pelo usuário, e o valor observado vem de
 *  jsonb — pode ser número, booleano ou string. Compara pela forma textual depois de
 *  normalizar, que é o suficiente e é previsível: um caso "10" casa com o número 10,
 *  e um caso "true" casa com o booleano true.
 *
 *  Separado de `looseEquals` de conditions.ts de propósito: ali a comparação é entre
 *  um campo tipado e um valor de operador, e aqui é sempre texto contra o que veio.
 *  Reusar aquela função traria a coerção numérica, que faria "01" casar com 1 — não é
 *  o que alguém espera de uma lista de casos. */
function looseEqualsForSwitch(actual: unknown, caseValue: string): boolean {
  if (actual == null) return caseValue === '';
  return String(actual).trim().toLowerCase() === caseValue.trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Corpo de laço e agente
//
// Métodos do engine, declarados aqui por extensão de classe para o laço principal
// acima permanecer legível.
// ─────────────────────────────────────────────────────────────────────────────

export interface PathResult {
  nodes: NodeLogEntry[];
  context: ExecutionContext;
  sequence: number;
  visits: number;
  failures: number;
}

