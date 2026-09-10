import { describe, expect, it } from 'vitest';
import { validateWorkflow } from '../workflow';
import {
  AutomationEngine,
  type ActionExecutor,
  type ActionResult,
  type AutomationRepository,
  type CreatedExecution,
  type EngineClock,
  type NodeLogEntry,
} from '../engine';
import type {
  Automation,
  AutomationEvent,
  AutomationWorkflow,
  ExecutionStatus,
} from '../types';

// Doubles próprios em vez de importar do outro arquivo de teste: um teste que depende
// do fake de outro passa a falhar quando aquele muda por razão alheia.

class FakeRepository implements AutomationRepository {
  automations: Automation[] = [];
  executions: { id: string; automationId: string; eventId: string | null; status: ExecutionStatus | 'running' }[] = [];
  nodeLogs: (NodeLogEntry & { executionId: string })[] = [];
  counters: Record<string, number> = {};
  eventStatus: Record<string, string> = {};
  resumes: (Parameters<AutomationRepository['scheduleResume']>[0] & { id: string })[] = [];
  private seq = 0;

  async findActiveAutomations(companyId: string, triggerType: string): Promise<Automation[]> {
    return this.automations.filter(
      a => a.companyId === companyId && a.triggerType === triggerType && a.status === 'active'
    );
  }

  async createExecution(input: Parameters<AutomationRepository['createExecution']>[0]): Promise<CreatedExecution> {
    if (input.eventId != null) {
      const existing = this.executions.find(e => e.automationId === input.automationId && e.eventId === input.eventId);
      if (existing != null) return { id: existing.id, duplicate: true };
    }
    this.seq += 1;
    const id = `exec-${this.seq}`;
    this.executions.push({ id, automationId: input.automationId, eventId: input.eventId, status: 'running' });
    return { id, duplicate: false };
  }

  async recordNodeExecution(executionId: string, _companyId: string, entry: NodeLogEntry): Promise<void> {
    this.nodeLogs.push({ ...entry, executionId });
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
  calls: { actionType: string; config: Record<string, unknown> }[] = [];

  async execute(input: Parameters<ActionExecutor['execute']>[0]): Promise<ActionResult> {
    this.calls.push({ actionType: input.actionType, config: input.config });
    return { ok: true, output: { id: `out-${this.calls.length}` } };
  }

  titles(): unknown[] {
    return this.calls.map(c => c.config.title);
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
    workflow: { nodes: [], edges: [] },
    version: 1,
    createdBy: null,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    lastExecutedAt: null,
    executionCount: 0,
    ...overrides,
  };
}

function event(overrides: Partial<AutomationEvent> = {}): AutomationEvent {
  return {
    id: 'evt-1',
    companyId: 'company-A',
    eventType: 'count.item_counted',
    payload: { count: { variancePercentage: 25 }, item: { sku: 'SKU-1' } },
    sourceTable: 'physical_count_items',
    sourceId: 'item-1',
    originExecutionId: null,
    originAutomationId: null,
    depth: 0,
    createdAt: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Espera
// ─────────────────────────────────────────────────────────────────────────────

function delayWorkflow(minutes = 30): AutomationWorkflow {
  return {
    nodes: [
      { id: 't', type: 'trigger', triggerType: 'count.item_counted', config: {} },
      { id: 'a1', type: 'action', actionType: 'create_alert', config: { title: 'Antes' } },
      { id: 'd', type: 'delay', label: 'Esperar', minutes },
      { id: 'a2', type: 'action', actionType: 'create_alert', config: { title: 'Depois' } },
    ],
    edges: [
      { from: 't', to: 'a1', branch: 'next' },
      { from: 'a1', to: 'd', branch: 'next' },
      { from: 'd', to: 'a2', branch: 'next' },
    ],
  };
}

describe('node de espera', () => {
  it('interrompe a execução e agenda a continuação', async () => {
    // A Edge Function tem teto de tempo: dormir 30 minutos dentro dela é impossível.
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    repo.automations.push(automation({ workflow: delayWorkflow() }));

    const result = await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(event());

    // Só a ação ANTES da espera rodou.
    expect(executor.titles()).toEqual(['Antes']);
    expect(repo.resumes).toHaveLength(1);
    expect(repo.resumes[0]).toMatchObject({ resumeNodeId: 'a2', delayMinutes: 30 });
    // Bem-sucedida até ali, não incompleta.
    expect(result.outcomes[0]).toMatchObject({ status: 'success' });
  });

  it('leva o contexto das ações anteriores para a continuação', async () => {
    // Sem isso, uma interpolação na segunda metade que dependesse da primeira viraria
    // "(indisponível)".
    const repo = new FakeRepository();
    repo.automations.push(automation({ workflow: delayWorkflow() }));

    await new AutomationEngine(repo, new FakeExecutor(), CLOCK).dispatchEvent(event());
    expect(Object.keys(repo.resumes[0].resumeActions)).toContain('a1');
  });

  it('preserva a profundidade em vez de incrementar', async () => {
    // Incrementar faria três esperas em série estourarem o limite anti-loop, e a
    // automação pararia no meio sem motivo.
    const repo = new FakeRepository();
    repo.automations.push(automation({ workflow: delayWorkflow() }));

    await new AutomationEngine(repo, new FakeExecutor(), CLOCK).dispatchEvent(event({ depth: 2 }));
    expect(repo.resumes[0].depth).toBe(2);
  });

  it('não agenda nada quando não há bloco depois da espera', async () => {
    const repo = new FakeRepository();
    const workflow = delayWorkflow();
    workflow.edges = workflow.edges.filter(e => e.from !== 'd');
    workflow.nodes = workflow.nodes.filter(n => n.id !== 'a2');
    repo.automations.push(automation({ workflow }));

    await new AutomationEngine(repo, new FakeExecutor(), CLOCK).dispatchEvent(event());
    expect(repo.resumes).toHaveLength(0);
  });

  it('retoma a partir do node gravado, sem repetir o que já rodou', async () => {
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    const auto = automation({ workflow: delayWorkflow() });
    repo.automations.push(auto);

    await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(
      event({
        id: 'evt-resume',
        originAutomationId: auto.id,
        resume: { automationId: auto.id, nodeId: 'a2', actions: { a1: { id: 'out-1' } }, fromExecutionId: 'exec-1' },
      })
    );

    // Se tivesse recomeçado do gatilho, 'Antes' apareceria de novo e o alerta seria
    // criado duas vezes.
    expect(executor.titles()).toEqual(['Depois']);
  });

  it('a retomada é a exceção da proteção contra auto-disparo', async () => {
    // Sem a exceção, toda espera morreria no meio: origin_automation_id é a própria
    // automação, o que normalmente é motivo para recusar.
    const repo = new FakeRepository();
    const auto = automation({ workflow: delayWorkflow() });
    repo.automations.push(auto);

    const sem = await new AutomationEngine(repo, new FakeExecutor(), CLOCK).dispatchEvent(
      event({ id: 'evt-a', originAutomationId: auto.id })
    );
    expect(sem.outcomes[0]).toMatchObject({ reason: 'self_triggered' });

    const com = await new AutomationEngine(repo, new FakeExecutor(), CLOCK).dispatchEvent(
      event({
        id: 'evt-b',
        originAutomationId: auto.id,
        resume: { automationId: auto.id, nodeId: 'a2', actions: {}, fromExecutionId: null },
      })
    );
    expect(com.outcomes[0].kind).toBe('executed');
  });

  it('a retomada de uma automação não roda em outra', async () => {
    // Sem esta trava, outra automação com o mesmo gatilho executaria a partir de um
    // node que não é dela.
    const repo = new FakeRepository();
    const executor = new FakeExecutor();
    repo.automations.push(automation({ id: 'auto-1', workflow: delayWorkflow() }));
    repo.automations.push(automation({ id: 'auto-2', workflow: delayWorkflow() }));

    await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(
      event({ resume: { automationId: 'auto-1', nodeId: 'a2', actions: {}, fromExecutionId: null } })
    );

    expect(executor.calls).toHaveLength(1);
  });

  it('a validação recusa espera fora dos limites', () => {
    expect(validateWorkflow(delayWorkflow(0)).valid).toBe(false);
    expect(validateWorkflow(delayWorkflow(60 * 24 * 8)).valid).toBe(false);
    expect(validateWorkflow(delayWorkflow(1)).valid).toBe(true);
    expect(validateWorkflow(delayWorkflow(60 * 24 * 7)).valid).toBe(true);
  });

  it('registra a espera no log com o node de retomada', () => {
    // O histórico precisa mostrar que a execução não terminou por falha, e onde
    // continua.
    const repo = new FakeRepository();
    repo.automations.push(automation({ workflow: delayWorkflow() }));

    return new AutomationEngine(repo, new FakeExecutor(), CLOCK).dispatchEvent(event()).then(() => {
      const log = repo.logsFor('exec-1').find(l => l.nodeType === 'delay');
      expect(log).toMatchObject({ status: 'success' });
      expect(log?.output).toMatchObject({ minutes: 30, resumesAtNode: 'a2' });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Escolha
// ─────────────────────────────────────────────────────────────────────────────

function switchWorkflow(): AutomationWorkflow {
  return {
    nodes: [
      { id: 't', type: 'trigger', triggerType: 'count.session_finalized', config: {} },
      {
        id: 's',
        type: 'switch',
        label: 'Por depósito',
        field: 'trigger.session.warehouse',
        cases: [{ value: 'GERAL' }, { value: 'FULL' }],
      },
      { id: 'g', type: 'action', actionType: 'create_alert', config: { title: 'Geral' } },
      { id: 'f', type: 'action', actionType: 'create_alert', config: { title: 'Full' } },
      { id: 'd', type: 'action', actionType: 'create_alert', config: { title: 'Outro' } },
    ],
    edges: [
      { from: 't', to: 's', branch: 'next' },
      { from: 's', to: 'g', branch: 'case:GERAL' },
      { from: 's', to: 'f', branch: 'case:FULL' },
      { from: 's', to: 'd', branch: 'default' },
    ],
  };
}

function sessionEvent(warehouse: unknown): AutomationEvent {
  return event({
    eventType: 'count.session_finalized',
    payload: { session: { warehouse } },
  });
}

describe('node de escolha', () => {
  function repoWith(workflow: AutomationWorkflow): FakeRepository {
    const repo = new FakeRepository();
    repo.automations.push(automation({ triggerType: 'count.session_finalized', workflow }));
    return repo;
  }

  it('segue pelo caso que casou', async () => {
    const repo = repoWith(switchWorkflow());
    const executor = new FakeExecutor();

    await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(sessionEvent('FULL'));
    expect(executor.titles()).toEqual(['Full']);
  });

  it('ignora caixa e espaços nas pontas', async () => {
    const repo = repoWith(switchWorkflow());
    const executor = new FakeExecutor();

    await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(sessionEvent('  geral '));
    expect(executor.titles()).toEqual(['Geral']);
  });

  it('cai no padrão quando nada casa', async () => {
    const repo = repoWith(switchWorkflow());
    const executor = new FakeExecutor();

    await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(sessionEvent('SHOPEE'));
    expect(executor.titles()).toEqual(['Outro']);
  });

  it('registra o valor observado, não só o caminho tomado', async () => {
    // É o que permite entender por que caiu no padrão.
    const repo = repoWith(switchWorkflow());

    await new AutomationEngine(repo, new FakeExecutor(), CLOCK).dispatchEvent(sessionEvent('SHOPEE'));
    const log = repo.logsFor('exec-1').find(l => l.nodeType === 'switch');
    expect(log?.output).toMatchObject({ actual: 'SHOPEE', taken: 'default' });
  });

  it('casa um caso numérico com o número que veio do jsonb', async () => {
    const workflow = switchWorkflow();
    (workflow.nodes[1] as { field: string; cases: { value: string }[] }).field = 'trigger.session.countNumber';
    (workflow.nodes[1] as { cases: { value: string }[] }).cases = [{ value: '1' }, { value: '2' }];
    workflow.edges = [
      { from: 't', to: 's', branch: 'next' },
      { from: 's', to: 'g', branch: 'case:1' },
      { from: 's', to: 'f', branch: 'case:2' },
      { from: 's', to: 'd', branch: 'default' },
    ];

    const repo = repoWith(workflow);
    const executor = new FakeExecutor();

    await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(
      event({ eventType: 'count.session_finalized', payload: { session: { countNumber: 2 } } })
    );
    expect(executor.titles()).toEqual(['Full']);
  });

  it('encerra o caminho quando a saída não está ligada', async () => {
    const workflow = switchWorkflow();
    workflow.edges = workflow.edges.filter(e => e.branch !== 'default');
    workflow.nodes = workflow.nodes.filter(n => n.id !== 'd');

    const repo = repoWith(workflow);
    const executor = new FakeExecutor();

    const result = await new AutomationEngine(repo, executor, CLOCK).dispatchEvent(sessionEvent('SHOPEE'));
    expect(executor.calls).toHaveLength(0);
    expect(result.outcomes[0]).toMatchObject({ status: 'success' });
  });

  it('a validação recusa caso repetido', () => {
    const workflow = switchWorkflow();
    (workflow.nodes[1] as { cases: { value: string }[] }).cases.push({ value: 'geral' });
    expect(validateWorkflow(workflow).problems.some(p => p.message.includes('repete o caso'))).toBe(true);
  });

  it('a validação recusa aresta para caso que não existe mais', () => {
    // Renomear um caso deixaria a aresta órfã apontando para uma saída que o engine
    // nunca escolhe.
    const workflow = switchWorkflow();
    (workflow.nodes[1] as { cases: { value: string }[] }).cases = [{ value: 'GERAL' }];
    expect(validateWorkflow(workflow).problems.some(p => p.message.includes('não existe mais'))).toBe(true);
  });

  it('a validação recusa campo inexistente e caso vazio', () => {
    const semCampo = switchWorkflow();
    (semCampo.nodes[1] as { field: string }).field = 'trigger.inventado';
    expect(validateWorkflow(semCampo).valid).toBe(false);

    const casoVazio = switchWorkflow();
    (casoVazio.nodes[1] as { cases: { value: string }[] }).cases = [{ value: '' }];
    expect(validateWorkflow(casoVazio).valid).toBe(false);
  });

  it('avisa sem impedir quando falta a saída padrão', () => {
    const workflow = switchWorkflow();
    workflow.edges = workflow.edges.filter(e => e.branch !== 'default');
    workflow.nodes = workflow.nodes.filter(n => n.id !== 'd');

    const result = validateWorkflow(workflow);
    expect(result.valid).toBe(true);
    expect(result.problems.some(p => p.severity === 'warning' && p.message.includes('saída padrão'))).toBe(true);
  });

  it('um switch válido passa na validação', () => {
    expect(validateWorkflow(switchWorkflow()).valid).toBe(true);
  });
});
