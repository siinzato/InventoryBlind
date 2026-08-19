import { describe, expect, it } from 'vitest';
import { evaluateGroup, evaluateRule, readPath } from '../conditions';
import { extractPaths, interpolate, interpolateConfig, UNRESOLVED_MARK } from '../interpolation';
import {
  ACTIONS,
  effectiveMaxAttempts,
  isActionCompatible,
  operatorsForKind,
  validateRule,
  TRIGGERS,
  TRIGGER_KEYS,
  type TriggerKey,
} from '../registry';
import {
  MAX_NODE_VISITS,
  findCycle,
  parseWebhookHeaders,
  reachableNodes,
  validateWebhookUrl,
  validateWorkflow,
} from '../workflow';
import {
  AutomationEngine,
  MAX_DEPTH,
  type ActionExecutor,
  type ActionResult,
  type AutomationRepository,
  type CreatedExecution,
  type EngineClock,
  type NodeLogEntry,
} from '../engine';
import { AUTOMATION_TEMPLATES, findTemplate } from '../templates';
import type {
  Automation,
  AutomationEvent,
  AutomationWorkflow,
  ExecutionContext,
  ExecutionStatus,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Test doubles
// ─────────────────────────────────────────────────────────────────────────────

/** Repositório em memória que reproduz a única garantia que o banco dá e o engine
 *  depende: o índice único de (automação, evento). Sem isso o teste de idempotência
 *  não testaria nada. */
class FakeRepository implements AutomationRepository {
  automations: Automation[] = [];
  executions: { id: string; automationId: string; eventId: string | null; status: ExecutionStatus | 'running' }[] = [];
  nodeLogs: (NodeLogEntry & { executionId: string; companyId: string })[] = [];
  counters: Record<string, number> = {};
  eventStatus: Record<string, string> = {};
  resumes: (Parameters<AutomationRepository['scheduleResume']>[0] & { id: string })[] = [];
  private seq = 0;

  async findActiveAutomations(companyId: string, triggerType: string): Promise<Automation[]> {
    // Filtro igual ao índice parcial de automations_dispatch_idx: empresa + trigger +
    // ativo. O teste de isolamento depende de este filtro estar aqui.
    return this.automations.filter(
      a => a.companyId === companyId && a.triggerType === triggerType && a.status === 'active'
    );
  }

  async createExecution(input: Parameters<AutomationRepository['createExecution']>[0]): Promise<CreatedExecution> {
    if (input.eventId != null) {
      const existing = this.executions.find(
        e => e.automationId === input.automationId && e.eventId === input.eventId
      );
      if (existing != null) return { id: existing.id, duplicate: true };
    }

    this.seq += 1;
    const id = `exec-${this.seq}`;
    this.executions.push({ id, automationId: input.automationId, eventId: input.eventId, status: 'running' });
    return { id, duplicate: false };
  }

  async recordNodeExecution(executionId: string, companyId: string, entry: NodeLogEntry): Promise<void> {
    this.nodeLogs.push({ ...entry, executionId, companyId });
  }

  async finishExecution(input: Parameters<AutomationRepository['finishExecution']>[0]): Promise<void> {
    const execution = this.executions.find(e => e.id === input.executionId);
    if (execution != null) execution.status = input.status;
  }

  async bumpCounters(automationId: string): Promise<void> {
    this.counters[automationId] = (this.counters[automationId] ?? 0) + 1;
  }

  async markEventProcessed(eventId: string, status: 'processed' | 'skipped' | 'failed'): Promise<void> {
    this.eventStatus[eventId] = status;
  }

  async scheduleResume(input: Parameters<AutomationRepository['scheduleResume']>[0]): Promise<string | null> {
    if (input.resumeNodeId == null) return null;
    this.seq += 1;
    const id = `resume-${this.seq}`;
    this.resumes.push({ id, ...input });
    return id;
  }

  logsFor(executionId: string): NodeLogEntry[] {
    return this.nodeLogs.filter(l => l.executionId === executionId).sort((a, b) => a.sequence - b.sequence);
  }
}

class FakeExecutor implements ActionExecutor {
  calls: { actionType: string; config: Record<string, unknown>; dryRun: boolean; companyId: string }[] = [];
  behaviour: Record<string, ActionResult> = {};

  async execute(input: Parameters<ActionExecutor['execute']>[0]): Promise<ActionResult> {
    this.calls.push({
      actionType: input.actionType,
      config: input.config,
      dryRun: input.dryRun,
      companyId: input.companyId,
    });
    return this.behaviour[input.actionType] ?? { ok: true, output: { id: `out-${this.calls.length}` } };
  }
}

const CLOCK: EngineClock = { now: () => 1_700_000_000_000 };

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    companyId: 'company-A',
    name: 'Teste',
    description: null,
    status: 'active',
    triggerType: 'count.item_counted',
    workflow: simpleWorkflow(),
    version: 1,
    createdBy: null,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    lastExecutedAt: null,
    executionCount: 0,
    ...overrides,
  };
}

function simpleWorkflow(threshold = 10): AutomationWorkflow {
  return {
    nodes: [
      { id: 't', type: 'trigger', triggerType: 'count.item_counted', config: {} },
      {
        id: 'c',
        type: 'condition',
        logic: 'AND',
        rules: [{ field: 'trigger.count.variancePercentage', operator: 'greater_than', value: threshold }],
      },
      { id: 'a', type: 'action', actionType: 'create_notification', config: { title: 'Aviso', severity: 'warning' } },
    ],
    edges: [
      { from: 't', to: 'c', branch: 'next' },
      { from: 'c', to: 'a', branch: 'next' },
    ],
  };
}

function event(overrides: Partial<AutomationEvent> = {}): AutomationEvent {
  return {
    id: 'evt-1',
    companyId: 'company-A',
    eventType: 'count.item_counted',
    payload: { count: { variancePercentage: 25, erpQuantity: 100, totalFound: 75 }, item: { sku: 'SKU-1' } },
    sourceTable: 'physical_count_items',
    sourceId: 'item-1',
    originExecutionId: null,
    originAutomationId: null,
    depth: 0,
    createdAt: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
}

function context(trigger: Record<string, unknown>): ExecutionContext {
  return { trigger, actions: {} };
}

// ─────────────────────────────────────────────────────────────────────────────
// Conditions
// ─────────────────────────────────────────────────────────────────────────────

describe('readPath', () => {
  it('lê caminho aninhado', () => {
    expect(readPath(context({ count: { variancePercentage: 12 } }), 'trigger.count.variancePercentage')).toBe(12);
  });

  it('devolve undefined em vez de lançar quando o caminho não existe', () => {
    // Condição sobre campo ausente é condição falsa, não erro de execução.
    expect(readPath(context({}), 'trigger.nao.existe')).toBeUndefined();
  });

  it('recusa chaves herdadas do prototype', () => {
    // `trigger.__proto__.x` não deve alcançar nada.
    expect(readPath(context({}), 'trigger.__proto__.polluted')).toBeUndefined();
    expect(readPath(context({}), 'trigger.constructor')).toBeUndefined();
  });

  it('devolve undefined para caminho vazio', () => {
    expect(readPath(context({}), '')).toBeUndefined();
  });
});

describe('operadores', () => {
  const ctx = context({
    count: { variancePercentage: 12, erpQuantity: 0, isDivergent: true },
    item: { sku: 'CAPA-AZUL', location: null },
  });

  it('compara número que chegou como string do jsonb', () => {
    // numeric do Postgres vem como string no jsonb, e o valor do input também é
    // string. Sem coerção, "12" > 10 compararia texto e daria resultado errado em
    // silêncio — no lugar exato onde a decisão é criar recontagem.
    const ctxString = context({ count: { variancePercentage: '12' } });
    expect(
      evaluateRule({ field: 'trigger.count.variancePercentage', operator: 'greater_than', value: '10' }, ctxString)
    ).toBe(true);
  });

  it.each([
    ['greater_than', 10, true],
    ['greater_than', 12, false],
    ['greater_than_or_equal', 12, true],
    ['less_than', 20, true],
    ['less_than_or_equal', 12, true],
    ['equals', 12, true],
    ['not_equals', 12, false],
  ])('%s %p → %p', (operator, value, expected) => {
    expect(evaluateRule({ field: 'trigger.count.variancePercentage', operator, value }, ctx)).toBe(expected);
  });

  it('compara booleano contra a string do select', () => {
    // O select entrega "true"; sem coerção a condição nunca bateria.
    expect(evaluateRule({ field: 'trigger.count.isDivergent', operator: 'equals', value: 'true' }, ctx)).toBe(true);
    expect(evaluateRule({ field: 'trigger.count.isDivergent', operator: 'equals', value: true }, ctx)).toBe(true);
    expect(evaluateRule({ field: 'trigger.count.isDivergent', operator: 'equals', value: 'false' }, ctx)).toBe(false);
  });

  it('contains é insensível a caixa', () => {
    expect(evaluateRule({ field: 'trigger.item.sku', operator: 'contains', value: 'azul' }, ctx)).toBe(true);
    expect(evaluateRule({ field: 'trigger.item.sku', operator: 'not_contains', value: 'verde' }, ctx)).toBe(true);
  });

  it('não trata zero nem false como vazio', () => {
    // Saldo zero é um valor. Tratá-lo como ausência faria "saldo está vazio" ser
    // verdade para um item contado genuinamente em zero.
    expect(evaluateRule({ field: 'trigger.count.erpQuantity', operator: 'is_empty', value: null }, ctx)).toBe(false);
    expect(evaluateRule({ field: 'trigger.count.erpQuantity', operator: 'is_not_empty', value: null }, ctx)).toBe(true);
  });

  it('trata null e string vazia como vazio', () => {
    expect(evaluateRule({ field: 'trigger.item.location', operator: 'is_empty', value: null }, ctx)).toBe(true);
  });

  it('in aceita lista digitada com vírgula', () => {
    expect(evaluateRule({ field: 'trigger.item.sku', operator: 'in', value: 'CAPA-AZUL, OUTRO' }, ctx)).toBe(true);
    expect(evaluateRule({ field: 'trigger.item.sku', operator: 'not_in', value: 'A, B' }, ctx)).toBe(true);
  });

  it('operador numérico é falso contra texto, em vez de comparar coisas incomparáveis', () => {
    expect(evaluateRule({ field: 'trigger.item.sku', operator: 'greater_than', value: 10 }, ctx)).toBe(false);
  });

  it('operador desconhecido é falso, nunca lança', () => {
    expect(evaluateRule({ field: 'trigger.count.variancePercentage', operator: 'regex', value: '.*' }, ctx)).toBe(false);
  });
});

describe('AND / OR', () => {
  const ctx = context({ count: { variancePercentage: 12 }, session: { countNumber: 1 } });

  it('AND exige todas', () => {
    const rules = [
      { field: 'trigger.count.variancePercentage', operator: 'greater_than', value: 10 },
      { field: 'trigger.session.countNumber', operator: 'equals', value: 1 },
    ];
    expect(evaluateGroup(rules, 'AND', ctx).passed).toBe(true);

    const failing = [...rules, { field: 'trigger.session.countNumber', operator: 'equals', value: 3 }];
    expect(evaluateGroup(failing, 'AND', ctx).passed).toBe(false);
  });

  it('OR basta uma', () => {
    const rules = [
      { field: 'trigger.count.variancePercentage', operator: 'greater_than', value: 90 },
      { field: 'trigger.session.countNumber', operator: 'equals', value: 1 },
    ];
    expect(evaluateGroup(rules, 'OR', ctx).passed).toBe(true);
  });

  it('grupo vazio passa', () => {
    // Node recém-adicionado não deve bloquear o teste. A validação é que impede
    // ativar com condição vazia.
    expect(evaluateGroup([], 'AND', ctx).passed).toBe(true);
  });

  it('avalia toda regra mesmo com resultado já decidido', () => {
    // Sem curto-circuito: o log precisa mostrar cada regra com o valor real que ela
    // viu, senão não há como entender por que a condição deu falso.
    const rules = [
      { field: 'trigger.count.variancePercentage', operator: 'greater_than', value: 90 },
      { field: 'trigger.session.countNumber', operator: 'equals', value: 1 },
    ];
    const outcome = evaluateGroup(rules, 'AND', ctx);
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results[1].actual).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Interpolação
// ─────────────────────────────────────────────────────────────────────────────

describe('interpolação', () => {
  const ctx = context({ item: { sku: 'SKU-9' }, count: { variancePercentage: 12, erpQuantity: 0 } });

  it('substitui o caminho', () => {
    expect(interpolate('Divergência em {{trigger.item.sku}}', ctx).text).toBe('Divergência em SKU-9');
  });

  it('aceita espaços na chave', () => {
    expect(interpolate('{{ trigger.item.sku }}', ctx).text).toBe('SKU-9');
  });

  it('interpola zero, não trata como ausente', () => {
    expect(interpolate('{{trigger.count.erpQuantity}}', ctx).text).toBe('0');
  });

  it('marca caminho inexistente em vez de deixar vazio', () => {
    // Vazio produziria "Divergência em " e ninguém descobriria o erro de
    // configuração.
    const result = interpolate('Item {{trigger.item.nome}}', ctx);
    expect(result.text).toBe(`Item ${UNRESOLVED_MARK}`);
    expect(result.unresolved).toEqual(['trigger.item.nome']);
  });

  it('não serializa objeto', () => {
    // Evita "[object Object]" ou um JSON dentro de uma frase.
    const result = interpolate('{{trigger.item}}', ctx);
    expect(result.text).toBe(UNRESOLVED_MARK);
    expect(result.unresolved).toEqual(['trigger.item']);
  });

  it('não executa nada — a gramática só aceita caminho', () => {
    // Chave com sintaxe fora de [A-Za-z0-9_.] não é reconhecida e fica literal.
    for (const attack of [
      '{{ 1+1 }}',
      '{{constructor.constructor("return 1")()}}',
      "{{trigger['item']}}",
      '{{process.env.SECRET}}',
    ]) {
      const result = interpolate(attack, ctx);
      // Ou fica literal, ou vira marcador — nunca avalia.
      expect(result.text).not.toBe('2');
      expect(result.text).not.toBe('1');
    }
  });

  it('só interpola as chaves autorizadas pelo registry', () => {
    // Interpolar tudo alcançaria a URL do webhook, e um {{}} acidental ali viraria
    // uma URL malformada.
    const { config } = interpolateConfig(
      { title: 'Item {{trigger.item.sku}}', url: 'https://x.com/{{trigger.item.sku}}' },
      ['title'],
      ctx
    );
    expect(config.title).toBe('Item SKU-9');
    expect(config.url).toBe('https://x.com/{{trigger.item.sku}}');
  });

  it('extractPaths encontra os caminhos usados', () => {
    expect(extractPaths('{{trigger.a}} e {{trigger.b}} e {{trigger.a}}')).toEqual(['trigger.a', 'trigger.b']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow
// ─────────────────────────────────────────────────────────────────────────────

describe('validação do workflow', () => {
  it('aceita um workflow completo', () => {
    expect(validateWorkflow(simpleWorkflow()).valid).toBe(true);
  });

  it('recusa sem trigger', () => {
    const workflow: AutomationWorkflow = {
      nodes: [{ id: 'a', type: 'action', actionType: 'create_notification', config: { title: 'x', severity: 'info' } }],
      edges: [],
    };
    const result = validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.problems.some(p => p.message.includes('gatilho'))).toBe(true);
  });

  it('recusa sem ação', () => {
    const workflow: AutomationWorkflow = {
      nodes: [{ id: 't', type: 'trigger', triggerType: 'count.item_counted', config: {} }],
      edges: [],
    };
    expect(validateWorkflow(workflow).problems.some(p => p.message.includes('pelo menos uma ação'))).toBe(true);
  });

  it('recusa dois triggers', () => {
    const workflow = simpleWorkflow();
    workflow.nodes.push({ id: 't2', type: 'trigger', triggerType: 'count.session_finalized', config: {} });
    expect(validateWorkflow(workflow).valid).toBe(false);
  });

  it('recusa aresta para bloco inexistente', () => {
    const workflow = simpleWorkflow();
    workflow.edges.push({ from: 'a', to: 'fantasma', branch: 'next' });
    expect(validateWorkflow(workflow).problems.some(p => p.message.includes('inexistente'))).toBe(true);
  });

  it('recusa condição sem regra', () => {
    const workflow = simpleWorkflow();
    (workflow.nodes[1] as { rules: unknown[] }).rules = [];
    expect(validateWorkflow(workflow).valid).toBe(false);
  });

  it('recusa campo que não existe no gatilho', () => {
    const workflow = simpleWorkflow();
    (workflow.nodes[1] as { rules: { field: string }[] }).rules[0].field = 'trigger.inventado';
    expect(validateWorkflow(workflow).problems.some(p => p.message.includes('não existe'))).toBe(true);
  });

  it('recusa parâmetro obrigatório em falta', () => {
    const workflow = simpleWorkflow();
    (workflow.nodes[2] as { config: Record<string, unknown> }).config = { severity: 'info' };
    expect(validateWorkflow(workflow).problems.some(p => p.message.includes('obrigatório'))).toBe(true);
  });

  it('recusa variável inexistente antes de ativar', () => {
    const workflow = simpleWorkflow();
    (workflow.nodes[2] as { config: Record<string, unknown> }).config = {
      title: 'Item {{trigger.item.inventado}}',
      severity: 'info',
    };
    expect(validateWorkflow(workflow).problems.some(p => p.message.includes('não existe neste gatilho'))).toBe(true);
  });

  it('recusa ação incompatível com o gatilho', () => {
    // "Criar recontagem" exige contagem finalizada. Em "item contado" a sessão está
    // em andamento e a ação falharia em toda execução.
    const workflow = simpleWorkflow();
    (workflow.nodes[2] as { actionType: string; config: Record<string, unknown> }).actionType = 'create_recount';
    (workflow.nodes[2] as { config: Record<string, unknown> }).config = {};
    expect(validateWorkflow(workflow).problems.some(p => p.message.includes('não funciona com o gatilho'))).toBe(true);
  });

  it('recusa duas conexões na mesma saída', () => {
    const workflow = simpleWorkflow();
    workflow.nodes.push({ id: 'a2', type: 'action', actionType: 'create_alert', config: { title: 'x' } });
    workflow.edges.push({ from: 'c', to: 'a2', branch: 'next' });
    expect(validateWorkflow(workflow).problems.some(p => p.message.includes('mesma saída'))).toBe(true);
  });

  it('avisa sobre bloco desconectado sem impedir salvar', () => {
    const workflow = simpleWorkflow();
    workflow.nodes.push({ id: 'orfao', type: 'action', actionType: 'create_alert', config: { title: 'x' } });
    const result = validateWorkflow(workflow);
    expect(result.problems.some(p => p.severity === 'warning' && p.message.includes('não está conectado'))).toBe(true);
    expect(result.valid).toBe(true);
  });
});

describe('detecção de ciclo', () => {
  it('encontra ciclo', () => {
    const workflow: AutomationWorkflow = {
      nodes: [
        { id: 't', type: 'trigger', triggerType: 'count.item_counted', config: {} },
        { id: 'a', type: 'action', actionType: 'create_alert', config: { title: 'x' } },
        { id: 'b', type: 'action', actionType: 'create_alert', config: { title: 'y' } },
      ],
      edges: [
        { from: 't', to: 'a', branch: 'next' },
        { from: 'a', to: 'b', branch: 'next' },
        { from: 'b', to: 'a', branch: 'next' },
      ],
    };
    expect(findCycle(workflow)).not.toBeNull();
    expect(validateWorkflow(workflow).valid).toBe(false);
  });

  it('NÃO acusa losango como ciclo', () => {
    // Um branch com TRUE e FALSE convergindo na mesma ação produz exatamente esta
    // forma. Marcar como ciclo tornaria a estrutura mais natural do módulo inválida.
    const workflow: AutomationWorkflow = {
      nodes: [
        { id: 't', type: 'trigger', triggerType: 'count.session_finalized', config: {} },
        { id: 'b', type: 'branch', logic: 'AND', rules: [{ field: 'trigger.session.countNumber', operator: 'equals', value: 1 }] },
        { id: 'x', type: 'action', actionType: 'create_alert', config: { title: 'x' } },
        { id: 'y', type: 'action', actionType: 'create_alert', config: { title: 'y' } },
        { id: 'z', type: 'action', actionType: 'create_alert', config: { title: 'z' } },
      ],
      edges: [
        { from: 't', to: 'b', branch: 'next' },
        { from: 'b', to: 'x', branch: 'true' },
        { from: 'b', to: 'y', branch: 'false' },
        { from: 'x', to: 'z', branch: 'next' },
        { from: 'y', to: 'z', branch: 'next' },
      ],
    };
    expect(findCycle(workflow)).toBeNull();
    expect(validateWorkflow(workflow).valid).toBe(true);
  });

  it('reachableNodes ignora o que não sai do trigger', () => {
    const workflow = simpleWorkflow();
    workflow.nodes.push({ id: 'orfao', type: 'action', actionType: 'create_alert', config: { title: 'x' } });
    expect(reachableNodes(workflow).has('orfao')).toBe(false);
    expect(reachableNodes(workflow).has('a')).toBe(true);
  });
});

describe('URL de webhook', () => {
  it('aceita HTTPS público', () => {
    expect(validateWebhookUrl('https://hooks.exemplo.com/x')).toBeNull();
  });

  it('recusa HTTP em claro', () => {
    expect(validateWebhookUrl('http://hooks.exemplo.com/x')).toContain('HTTPS');
  });

  it.each([
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://172.16.0.1/x',
    // O serviço de metadados das nuvens, alvo clássico de SSRF — serve credenciais.
    'https://169.254.169.254/latest/meta-data/',
    'https://algo.internal/x',
  ])('recusa destino interno %s', url => {
    expect(validateWebhookUrl(url)).not.toBeNull();
  });

  it('recusa URL malformada', () => {
    expect(validateWebhookUrl('não é url')).not.toBeNull();
  });
});

describe('cabeçalhos de webhook', () => {
  it('aceita apenas nomes da lista', () => {
    const headers = parseWebhookHeaders('Authorization: Bearer x\nX-Api-Key: y');
    expect(headers).toEqual({ authorization: 'Bearer x', 'x-api-key': 'y' });
  });

  it('descarta cabeçalho que muda o significado da requisição', () => {
    // Host e Content-Length forjados são caminho para request smuggling.
    const headers = parseWebhookHeaders('Host: interno\nContent-Length: 0\nX-Api-Key: ok');
    expect(headers).toEqual({ 'x-api-key': 'ok' });
  });

  it('ignora linha sem separador', () => {
    expect(parseWebhookHeaders('lixo\n\nX-Api-Key: ok')).toEqual({ 'x-api-key': 'ok' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────────

describe('engine — cenário 1 do briefing', () => {
  it('trigger → condição TRUE → ação executada', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    repo.automations.push(automation());

    const engine = new AutomationEngine(repo, executor, CLOCK);
    const result = await engine.dispatchEvent(event());

    expect(result.matched).toBe(1);
    expect(result.outcomes[0]).toMatchObject({ kind: 'executed', status: 'success' });
    expect(executor.calls.map(c => c.actionType)).toEqual(['create_notification']);
    expect(repo.eventStatus['evt-1']).toBe('processed');
  });

  it('condição FALSE encerra sem executar ação, e não é falha', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    repo.automations.push(automation({ workflow: simpleWorkflow(90) }));

    const engine = new AutomationEngine(repo, executor, CLOCK);
    const result = await engine.dispatchEvent(event());

    expect(executor.calls).toHaveLength(0);
    // Sucesso, não falha: a automação decidiu não agir. Marcar como falha deixaria o
    // histórico vermelho a cada contagem correta.
    expect(result.outcomes[0]).toMatchObject({ kind: 'executed', status: 'success' });
  });

  it('registra o trigger como primeiro passo do log', async () => {
    const repo = new FakeRepository();
    repo.automations.push(automation());
    const engine = new AutomationEngine(repo, new FakeExecutor(), CLOCK);
    await engine.dispatchEvent(event());

    const logs = repo.logsFor('exec-1');
    expect(logs.map(l => l.nodeType)).toEqual(['trigger', 'condition', 'action']);
    expect(logs[1].conditionResult).toBe(true);
  });

  it('a saída de uma ação fica disponível para a seguinte', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    const workflow = simpleWorkflow();
    workflow.nodes.push({
      id: 'a2',
      type: 'action',
      actionType: 'create_alert',
      config: { title: 'Segunda' },
    });
    workflow.edges.push({ from: 'a', to: 'a2', branch: 'next' });
    repo.automations.push(automation({ workflow }));

    const engine = new AutomationEngine(repo, executor, CLOCK);
    await engine.dispatchEvent(event());

    expect(executor.calls).toHaveLength(2);
  });
});

describe('engine — cenário 2 do briefing (branch)', () => {
  function branchWorkflow(threshold: number): AutomationWorkflow {
    return {
      nodes: [
        { id: 't', type: 'trigger', triggerType: 'count.item_counted', config: {} },
        {
          id: 'b',
          type: 'branch',
          logic: 'AND',
          rules: [{ field: 'trigger.count.variancePercentage', operator: 'greater_than', value: threshold }],
        },
        { id: 'sim', type: 'action', actionType: 'create_alert', config: { title: 'Grave' } },
      ],
      edges: [
        { from: 't', to: 'b', branch: 'next' },
        { from: 'b', to: 'sim', branch: 'true' },
      ],
    };
  }

  it('TRUE segue pelo ramo verdadeiro', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    repo.automations.push(automation({ workflow: branchWorkflow(15) }));

    await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(event());
    expect(executor.calls.map(c => c.actionType)).toEqual(['create_alert']);
  });

  it('FALSE sem saída ligada = nenhuma ação, execução com sucesso', async () => {
    // Exatamente o "FALSE → nenhuma ação" do §54.
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    repo.automations.push(automation({ workflow: branchWorkflow(50) }));

    const result = await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(event());
    expect(executor.calls).toHaveLength(0);
    expect(result.outcomes[0]).toMatchObject({ status: 'success' });

    const branchLog = repo.logsFor('exec-1').find(l => l.nodeType === 'branch');
    expect(branchLog?.conditionResult).toBe(false);
    expect(branchLog?.output).toMatchObject({ taken: 'false' });
  });

  it('cada ramo executa a sua ação', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    const workflow = branchWorkflow(50);
    workflow.nodes.push({ id: 'nao', type: 'action', actionType: 'create_notification', config: { title: 'Leve', severity: 'info' } });
    workflow.edges.push({ from: 'b', to: 'nao', branch: 'false' });
    repo.automations.push(automation({ workflow }));

    await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(event());
    expect(executor.calls.map(c => c.actionType)).toEqual(['create_notification']);
  });
});

describe('isolamento entre empresas', () => {
  it('evento da empresa A não alcança automação da empresa B', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    repo.automations.push(automation({ id: 'auto-A', companyId: 'company-A' }));
    repo.automations.push(automation({ id: 'auto-B', companyId: 'company-B' }));

    const result = await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(
      event({ companyId: 'company-A' })
    );

    expect(result.matched).toBe(1);
    expect(executor.calls.every(c => c.companyId === 'company-A')).toBe(true);
  });

  it('a empresa é sempre a do evento, nunca a da automação', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    repo.automations.push(automation({ companyId: 'company-A' }));

    await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(event({ companyId: 'company-A' }));
    expect(executor.calls[0].companyId).toBe('company-A');
  });
});

describe('automação inativa', () => {
  it.each(['draft', 'inactive', 'error'] as const)('status %s não executa', async status => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    repo.automations.push(automation({ status }));

    const result = await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(event());
    expect(result.matched).toBe(0);
    expect(executor.calls).toHaveLength(0);
  });
});

describe('idempotência', () => {
  it('o mesmo evento processado duas vezes executa a ação uma vez', async () => {
    // O dano concreto: duas recontagens idênticas para a mesma contagem.
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    repo.automations.push(automation());
    const engine = new AutomationEngine(repo, executor, CLOCK);

    await engine.dispatchEvent(event());
    const second = await engine.dispatchEvent(event());

    expect(executor.calls).toHaveLength(1);
    expect(second.outcomes[0]).toMatchObject({ kind: 'duplicate' });
  });

  it('execução manual não é bloqueada pela idempotência', async () => {
    // event_id nulo fica fora do índice único: testar duas vezes é intencional.
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    const auto = automation();
    const engine = new AutomationEngine(repo, executor, CLOCK);

    const payload = { count: { variancePercentage: 25 }, item: { sku: 'X' } };
    await engine.runAutomation({ automation: auto, event: null, triggerSource: 'manual', dryRun: false, triggeredBy: 'u1', manualContext: payload });
    await engine.runAutomation({ automation: auto, event: null, triggerSource: 'manual', dryRun: false, triggeredBy: 'u1', manualContext: payload });

    expect(executor.calls).toHaveLength(2);
  });

  it('não incrementa contador duas vezes para o mesmo evento', async () => {
    const repo = new FakeRepository();
    repo.automations.push(automation());
    const engine = new AutomationEngine(repo, new FakeExecutor(), CLOCK);

    await engine.dispatchEvent(event());
    await engine.dispatchEvent(event());

    expect(repo.counters['auto-1']).toBe(1);
  });
});

describe('proteção contra loop', () => {
  it('recusa evento acima da profundidade máxima', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    repo.automations.push(automation());

    const result = await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(
      event({ depth: MAX_DEPTH })
    );

    expect(result.outcomes[0]).toMatchObject({ kind: 'skipped', reason: 'depth_exceeded' });
    expect(executor.calls).toHaveLength(0);
    // Marcado como skipped, não deixado pendente — senão a fila reentrega para
    // sempre.
    expect(repo.eventStatus['evt-1']).toBe('skipped');
  });

  it('automação não reage ao evento que ela mesma originou', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    repo.automations.push(automation({ id: 'auto-1' }));

    const result = await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(
      event({ originAutomationId: 'auto-1' })
    );

    expect(result.outcomes[0]).toMatchObject({ kind: 'skipped', reason: 'self_triggered' });
    expect(executor.calls).toHaveLength(0);
  });

  it('outra automação ainda reage ao evento', async () => {
    // A proteção é contra auto-disparo, não contra encadeamento legítimo.
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    repo.automations.push(automation({ id: 'auto-1' }));
    repo.automations.push(automation({ id: 'auto-2' }));

    await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(event({ originAutomationId: 'auto-1' }));
    expect(executor.calls).toHaveLength(1);
  });

  it('a profundidade da execução cresce a partir do evento', async () => {
    const repo = new FakeRepository();
    repo.automations.push(automation());
    const engine = new AutomationEngine(repo, new FakeExecutor(), CLOCK);

    // depth 2 ainda passa (MAX_DEPTH é 3); depth 3 não.
    const ok = await engine.dispatchEvent(event({ id: 'evt-ok', depth: 2 }));
    expect(ok.outcomes[0].kind).toBe('executed');

    const blocked = await engine.dispatchEvent(event({ id: 'evt-block', depth: 3 }));
    expect(blocked.outcomes[0]).toMatchObject({ reason: 'depth_exceeded' });
  });

  it('MAX_NODE_VISITS é o teto que não depende do detector de ciclo', () => {
    // Defesa em profundidade declarada: a validação recusa ciclo, e isto contém o
    // caso em que ela falhou.
    expect(MAX_NODE_VISITS).toBeGreaterThan(10);
    expect(MAX_DEPTH).toBeLessThan(MAX_NODE_VISITS);
  });
});

describe('workflow inválido', () => {
  it('não executa e diz o motivo', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    const broken = simpleWorkflow();
    (broken.nodes[1] as { rules: unknown[] }).rules = [];
    repo.automations.push(automation({ workflow: broken }));

    const result = await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(event());

    expect(result.outcomes[0]).toMatchObject({ kind: 'skipped', reason: 'invalid_workflow' });
    expect(executor.calls).toHaveLength(0);
  });

  it('revalida no momento da execução, não confia na ativação', async () => {
    // Uma automação pode ter sido ativada por uma versão anterior do validador.
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    const withUnknownAction = simpleWorkflow();
    (withUnknownAction.nodes[2] as { actionType: string }).actionType = 'drop_database';
    repo.automations.push(automation({ status: 'active', workflow: withUnknownAction }));

    const result = await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(event());
    expect(result.outcomes[0].kind).toBe('skipped');
    expect(executor.calls).toHaveLength(0);
  });
});

describe('falha de ação', () => {
  it('uma ação que falha não impede a seguinte', async () => {
    // Notificar o supervisor ainda vale a pena quando o webhook caiu.
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    executor.behaviour.send_webhook = { ok: false, output: {}, errorMessage: 'HTTP 500', retryable: false };

    const workflow = simpleWorkflow();
    workflow.nodes[2] = { id: 'a', type: 'action', actionType: 'send_webhook', config: { url: 'https://x.exemplo.com/h', method: 'POST' } };
    workflow.nodes.push({ id: 'a2', type: 'action', actionType: 'create_alert', config: { title: 'Aviso' } });
    workflow.edges.push({ from: 'a', to: 'a2', branch: 'next' });
    repo.automations.push(automation({ workflow }));

    const result = await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(event());

    expect(executor.calls.map(c => c.actionType)).toEqual(['send_webhook', 'create_alert']);
    // Uma de duas falhou → parcial, não falha total.
    expect(result.outcomes[0]).toMatchObject({ status: 'partial' });
  });

  it('todas as ações falhando dá failed', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    executor.behaviour.create_notification = { ok: false, output: {}, errorMessage: 'erro' };
    repo.automations.push(automation());

    const result = await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(event());
    expect(result.outcomes[0]).toMatchObject({ status: 'failed' });
  });

  it('grava a mensagem de erro no log do node', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    executor.behaviour.create_notification = { ok: false, output: {}, errorMessage: 'HTTP 500' };
    repo.automations.push(automation());

    await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(event());
    const actionLog = repo.logsFor('exec-1').find(l => l.nodeType === 'action');
    expect(actionLog).toMatchObject({ status: 'failed', errorMessage: 'HTTP 500' });
  });

  it('executor que lança é tratado como falha, não derruba a execução', async () => {
    const repo = new FakeRepository();
    repo.automations.push(automation());
    const throwing: ActionExecutor = {
      async execute() {
        throw new Error('boom');
      },
    };

    const result = await new AutomationEngine(repo, throwing, CLOCK).dispatchEvent(event());
    expect(result.outcomes[0]).toMatchObject({ status: 'failed' });
  });
});

describe('retry', () => {
  it('retenta ação externa marcada como retryable', async () => {
    const repo = new FakeRepository();
    let attempts = 0;
    const flaky: ActionExecutor = {
      async execute() {
        attempts += 1;
        return attempts < 3
          ? { ok: false, output: {}, errorMessage: 'timeout', retryable: true }
          : { ok: true, output: { delivered: true } };
      },
    };

    const workflow = simpleWorkflow();
    workflow.nodes[2] = { id: 'a', type: 'action', actionType: 'send_webhook', config: { url: 'https://x.exemplo.com/h', method: 'POST' } };
    repo.automations.push(automation({ workflow }));

    const result = await new AutomationEngine(repo, flaky, CLOCK).dispatchEvent(event());
    expect(attempts).toBe(3);
    expect(result.outcomes[0]).toMatchObject({ status: 'success' });
  });

  it('NÃO retenta ação não idempotente', async () => {
    // Retentar a criação de recontagem criaria duas.
    expect(effectiveMaxAttempts('create_recount', 3)).toBe(1);
    expect(ACTIONS.create_recount.idempotent).toBe(false);
  });

  it('não retenta falha permanente', async () => {
    const repo = new FakeRepository();
    let attempts = 0;
    const failing: ActionExecutor = {
      async execute() {
        attempts += 1;
        return { ok: false, output: {}, errorMessage: 'URL inválida', retryable: false };
      },
    };

    const workflow = simpleWorkflow();
    workflow.nodes[2] = { id: 'a', type: 'action', actionType: 'send_webhook', config: { url: 'https://x.exemplo.com/h', method: 'POST' } };
    repo.automations.push(automation({ workflow }));

    await new AutomationEngine(repo, failing, CLOCK).dispatchEvent(event());
    expect(attempts).toBe(1);
  });

  it('limita as tentativas a 3 mesmo se pedirem mais', () => {
    expect(effectiveMaxAttempts('send_webhook', 99)).toBe(3);
    expect(effectiveMaxAttempts('send_webhook', 0)).toBe(1);
  });
});

describe('execução de teste (dry run)', () => {
  it('passa dryRun ao executor e não incrementa contador', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    const auto = automation();

    await new AutomationEngine(repo, executor, CLOCK).runAutomation({
      automation: auto,
      event: null,
      triggerSource: 'manual',
      dryRun: true,
      triggeredBy: 'u1',
      manualContext: { count: { variancePercentage: 50 } },
    });

    expect(executor.calls[0].dryRun).toBe(true);
    // Teste inflando "127 execuções" tornaria o número inútil como sinal de uso.
    expect(repo.counters['auto-1']).toBeUndefined();
  });

  it('ações destrutivas são marcadas para não aplicar em teste', () => {
    // O engine repassa a flag; quem decide não aplicar é o executor, guiado por isto.
    expect(ACTIONS.create_recount.skipOnDryRun).toBe(true);
    expect(ACTIONS.add_session_note.skipOnDryRun).toBe(true);
    expect(ACTIONS.send_webhook.skipOnDryRun).toBe(true);
    // Notificação é segura de criar em teste — é como o usuário vê que funcionou.
    expect(ACTIONS.create_notification.skipOnDryRun).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Registry e templates
// ─────────────────────────────────────────────────────────────────────────────

describe('registry', () => {
  it('só oferece operadores que fazem sentido para o tipo', () => {
    // greater_than num booleano produziria condição que nunca bate.
    expect(operatorsForKind('boolean').map(o => o.key)).not.toContain('greater_than');
    expect(operatorsForKind('number').map(o => o.key)).toContain('greater_than');
    expect(operatorsForKind('text').map(o => o.key)).toContain('contains');
  });

  it('declara compatibilidade de ação com gatilho', () => {
    expect(isActionCompatible('create_recount', 'count.session_finalized')).toBe(true);
    expect(isActionCompatible('create_recount', 'count.item_counted')).toBe(false);
    // Notificação serve para qualquer gatilho.
    expect(isActionCompatible('create_notification', 'count.item_counted')).toBe(true);
  });

  it('validateRule recusa operador que não serve ao campo', () => {
    const problem = validateRule(
      { field: 'trigger.count.isDivergent', operator: 'greater_than', value: 1 },
      'count.item_counted',
      0
    );
    expect(problem).not.toBeNull();
  });

  it('validateRule exige valor quando o operador precisa', () => {
    expect(
      validateRule({ field: 'trigger.count.variancePercentage', operator: 'greater_than', value: '' }, 'count.item_counted', 0)
    ).not.toBeNull();
    // is_empty não precisa de valor.
    expect(
      validateRule({ field: 'trigger.item.sku', operator: 'is_empty', value: null }, 'count.item_counted', 0)
    ).toBeNull();
  });
});

describe('templates', () => {
  it('todo template gera workflow válido', () => {
    // Um template que não passa na própria validação criaria uma automação que o
    // usuário não consegue ativar.
    for (const template of AUTOMATION_TEMPLATES) {
      const workflow = template.build({ threshold: template.defaultThreshold });
      const result = validateWorkflow(workflow);
      expect(result.problems.filter(p => p.severity === 'error')).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it('o trigger declarado bate com o do workflow', () => {
    for (const template of AUTOMATION_TEMPLATES) {
      const workflow = template.build({});
      const trigger = workflow.nodes.find(n => n.type === 'trigger');
      expect((trigger as { triggerType: string }).triggerType).toBe(template.triggerType);
    }
  });

  it('o limiar parametrizado chega na regra', () => {
    const workflow = findTemplate('critical_divergence')!.build({ threshold: 25 });
    const condition = workflow.nodes.find(n => n.type === 'condition') as { rules: { value: unknown }[] };
    expect(condition.rules[0].value).toBe(25);
  });

  it('o template de recontagem usa contagem finalizada, não item contado', () => {
    // Criar recontagem exige sessão fechada — é a regra que o registry impõe.
    expect(findTemplate('auto_recount')!.triggerType).toBe('count.session_finalized');
  });

  it('o template de recontagem se protege de pedir recontagem da recontagem', () => {
    const workflow = findTemplate('auto_recount')!.build({});
    const condition = workflow.nodes.find(n => n.type === 'condition') as { rules: { field: string }[] };
    expect(condition.rules.some(r => r.field === 'trigger.session.countNumber')).toBe(true);
  });

  it('o template de ramificação liga as duas saídas', () => {
    const workflow = findTemplate('branch_by_severity')!.build({});
    expect(workflow.edges.some(e => e.branch === 'true')).toBe(true);
    expect(workflow.edges.some(e => e.branch === 'false')).toBe(true);
  });

  it('templates produzem workflow editável, sem marca especial', () => {
    // §35: templates são atalhos, não regras que o usuário não consiga modificar.
    for (const template of AUTOMATION_TEMPLATES) {
      const workflow = template.build({});
      expect(Object.keys(workflow).sort()).toEqual(['edges', 'nodes']);
    }
  });
});

describe('invariante: tipo do gatilho é o tipo do evento', () => {
  // O despacho do engine casa `automation.triggerType === event.eventType`. Se as
  // duas strings divergirem, o evento entra na fila, ninguém é encontrado, e o
  // usuário vê uma automação ativa que nunca roda — sem erro em lugar nenhum.
  //
  // Foi exatamente o que aconteceu com o agendador: o SQL emitia 'schedule.tick' e o
  // registry declarava 'schedule'. Corrigido na migration 054, e este teste é o que
  // torna a próxima ocorrência visível.

  /** Os tipos de evento que o banco emite, por migration. Duplicado aqui de
   *  propósito: o teste não lê SQL, então a lista é a declaração de qual contrato o
   *  TypeScript espera. Mexer no emissor sem mexer aqui quebra o teste. */
  const EMITTED_BY_DATABASE = [
    'count.item_counted',
    'count.session_created',
    'count.session_started',
    'count.session_finalized',
    'stock.discrepancy_detected',
    'schedule',
    'webhook.received',
  ] as const;

  it('todo gatilho emitido pelo servidor tem chave igual ao evento', () => {
    for (const eventType of EMITTED_BY_DATABASE) {
      expect(TRIGGERS[eventType as TriggerKey]).toBeDefined();
      expect(TRIGGERS[eventType as TriggerKey].key).toBe(eventType);
    }
  });

  it('todo gatilho do registry que não é manual está na lista de emitidos', () => {
    // Pega o caso inverso: um gatilho declarado no registry que nenhum emissor
    // produz apareceria no editor e nunca dispararia.
    const declared = TRIGGER_KEYS.filter(key => TRIGGERS[key].emittedBy !== 'manual');
    for (const key of declared) {
      expect(EMITTED_BY_DATABASE).toContain(key);
    }
  });

  it('o engine só encontra automação cujo trigger casa com o evento', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    repo.automations.push(automation({ triggerType: 'schedule' }));

    // Evento com o nome antigo: nada é encontrado. É o sintoma que o defeito produzia.
    const stale = await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(
      event({ id: 'evt-stale', eventType: 'schedule.tick' })
    );
    expect(stale.matched).toBe(0);

    const aligned = await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(
      event({ id: 'evt-ok', eventType: 'schedule' })
    );
    expect(aligned.matched).toBe(1);
  });
});

describe('gatilhos de sistema', () => {
  it('agendado e webhook estão disponíveis no editor', () => {
    expect(TRIGGERS.schedule.group).toBe('Sistema');
    expect(TRIGGERS['webhook.received'].group).toBe('Sistema');
  });

  it('o corpo do webhook aceita caminho arbitrário na validação', () => {
    // O corpo é do remetente: exigir que os campos estivessem no registry tornaria o
    // gatilho inútil.
    const workflow: AutomationWorkflow = {
      nodes: [
        { id: 't', type: 'trigger', triggerType: 'webhook.received', config: {} },
        {
          id: 'a',
          type: 'action',
          actionType: 'create_notification',
          config: { title: 'Pedido {{trigger.webhook.body.orderId}}', severity: 'info' },
        },
      ],
      edges: [{ from: 't', to: 'a', branch: 'next' }],
    };

    expect(validateWorkflow(workflow).valid).toBe(true);
  });

  it('mas continua recusando caminho inventado fora do corpo', () => {
    const workflow: AutomationWorkflow = {
      nodes: [
        { id: 't', type: 'trigger', triggerType: 'webhook.received', config: {} },
        {
          id: 'a',
          type: 'action',
          actionType: 'create_notification',
          config: { title: '{{trigger.inventado.campo}}', severity: 'info' },
        },
      ],
      edges: [{ from: 't', to: 'a', branch: 'next' }],
    };

    expect(validateWorkflow(workflow).valid).toBe(false);
  });

  it('criar recontagem não é oferecida para gatilho agendado', () => {
    // A ação exige uma contagem no contexto, e um disparo por horário não tem uma.
    expect(isActionCompatible('create_recount', 'schedule')).toBe(false);
    expect(isActionCompatible('create_notification', 'schedule')).toBe(true);
  });
});
