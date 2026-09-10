import { describe, expect, it } from 'vitest';
import {
  addNode,
  autoLayoutWorkflow,
  computeTraceNodeStatuses,
  connectionToEdge,
  edgeId,
  edgeStatusesFromExecutions,
  moveNode,
  removeEdgeByBranch,
  removeEdgeById,
  removeNode,
  updateNode,
  upsertEdge,
  workflowToFlowEdges,
  workflowToFlowNodes,
} from '../flowAdapter';
import type { AutomationWorkflow, NodeExecution } from '../types';

function execution(nodeId: string, sequence: number, status: NodeExecution['status'], attempts = 1): NodeExecution {
  return {
    id: `exec-${sequence}`,
    executionId: 'run-1',
    nodeId,
    nodeType: 'action',
    nodeLabel: null,
    sequence,
    status,
    conditionResult: null,
    output: null,
    errorMessage: null,
    attempts,
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:00:01Z',
    durationMs: 10,
  };
}

function sample(): AutomationWorkflow {
  return {
    nodes: [
      { id: 'trigger', type: 'trigger', triggerType: 'count.item_counted', config: {} },
      { id: 'cond-1', type: 'branch', logic: 'AND', rules: [{ field: 'trigger.count.isDivergent', operator: 'equals', value: true }] },
      { id: 'action-1', type: 'action', actionType: 'create_notification', config: { severity: 'warning' } },
    ],
    edges: [
      { from: 'trigger', to: 'cond-1', branch: 'next' },
      { from: 'cond-1', to: 'action-1', branch: 'true' },
    ],
  };
}

describe('flowAdapter — nodes', () => {
  it('gera um node do React Flow por node do domínio, preservando o id', () => {
    const flowNodes = workflowToFlowNodes(sample());
    expect(flowNodes.map(n => n.id)).toEqual(['trigger', 'cond-1', 'action-1']);
    expect(flowNodes.every(n => n.type === 'automation')).toBe(true);
  });

  it('deriva posição para quem não tem (layout), sem mexer em quem já tem', () => {
    const workflow = sample();
    workflow.nodes[1] = { ...workflow.nodes[1], position: { x: 999, y: 999 } } as typeof workflow.nodes[1];

    const flowNodes = workflowToFlowNodes(workflow);
    const positioned = flowNodes.find(n => n.id === 'cond-1');
    const derived = flowNodes.find(n => n.id === 'trigger');

    expect(positioned?.position).toEqual({ x: 999, y: 999 });
    expect(derived?.position).not.toEqual({ x: 999, y: 999 });
  });

  it('data.node é o mesmo objeto de domínio — sem cópia parcial que perca campos', () => {
    const workflow = sample();
    const flowNodes = workflowToFlowNodes(workflow);
    expect(flowNodes[1].data.node).toBe(workflow.nodes[1]);
  });
});

describe('flowAdapter — edges', () => {
  it('gera uma aresta do React Flow por aresta do domínio, com sourceHandle = branch', () => {
    const flowEdges = workflowToFlowEdges(sample());
    expect(flowEdges).toHaveLength(2);
    expect(flowEdges[1].sourceHandle).toBe('true');
    expect(flowEdges[1].source).toBe('cond-1');
    expect(flowEdges[1].target).toBe('action-1');
  });

  it('rotula a aresta pelo label real da saída (Sim/Não em um branch)', () => {
    const flowEdges = workflowToFlowEdges(sample());
    const trueEdge = flowEdges.find(e => e.sourceHandle === 'true');
    expect(trueEdge?.data?.label).toBe('Sim');
  });

  it('id da aresta é determinístico — mesma aresta produz o mesmo id sempre', () => {
    const edge = { from: 'a', to: 'b', branch: 'next' as const };
    expect(edgeId(edge)).toBe(edgeId({ ...edge }));
  });
});

describe('flowAdapter — mutações preservam o resto do workflow', () => {
  it('moveNode só altera a posição do node alvo', () => {
    const workflow = sample();
    const next = moveNode(workflow, 'action-1', { x: 10, y: 20 });

    expect(next.nodes.find(n => n.id === 'action-1')?.position).toEqual({ x: 10, y: 20 });
    expect(next.nodes.find(n => n.id === 'trigger')?.position).toBeUndefined();
    expect(next.edges).toEqual(workflow.edges);
  });

  it('moveNode nunca grava posição negativa', () => {
    const next = moveNode(sample(), 'action-1', { x: -50, y: -10 });
    expect(next.nodes.find(n => n.id === 'action-1')?.position).toEqual({ x: 0, y: 0 });
  });

  it('addNode acrescenta o node e, se informado, a aresta de conexão', () => {
    const workflow = sample();
    const newNode = { id: 'delay-1', type: 'delay' as const, minutes: 5 };
    const next = addNode(workflow, newNode, { from: 'action-1', to: 'delay-1', branch: 'next' });

    expect(next.nodes).toHaveLength(4);
    expect(next.edges).toHaveLength(3);
    expect(next.edges[next.edges.length - 1]).toEqual({ from: 'action-1', to: 'delay-1', branch: 'next' });
  });

  it('removeNode remove o node e religa antecessor→sucessor pela saída next', () => {
    const workflow: AutomationWorkflow = {
      nodes: [
        { id: 'trigger', type: 'trigger', triggerType: 'manual', config: {} },
        { id: 'delay-1', type: 'delay', minutes: 5 },
        { id: 'action-1', type: 'action', actionType: 'create_alert', config: {} },
      ],
      edges: [
        { from: 'trigger', to: 'delay-1', branch: 'next' },
        { from: 'delay-1', to: 'action-1', branch: 'next' },
      ],
    };

    const next = removeNode(workflow, 'delay-1');
    expect(next.nodes.map(n => n.id)).toEqual(['trigger', 'action-1']);
    expect(next.edges).toEqual([{ from: 'trigger', to: 'action-1', branch: 'next' }]);
  });

  it('removeNode de uma saída nomeada (branch) não inventa religação', () => {
    const next = removeNode(sample(), 'cond-1');
    // 'trigger' perde o destino, e a aresta 'true' de cond-1 desaparece — nenhuma
    // aresta nova é criada, porque não há uma escolha correta de destino.
    expect(next.edges).toEqual([]);
  });

  it('updateNode aplica um patch parcial sem afetar outros nodes', () => {
    const workflow = sample();
    const next = updateNode(workflow, 'action-1', { label: 'Renomeado' });
    expect(next.nodes.find(n => n.id === 'action-1')?.label).toBe('Renomeado');
    expect(next.nodes.find(n => n.id === 'cond-1')).toBe(workflow.nodes[1]);
  });
});

describe('flowAdapter — conexões', () => {
  it('connectionToEdge converte uma Connection válida', () => {
    const edge = connectionToEdge({ source: 'a', target: 'b', sourceHandle: 'true', targetHandle: null });
    expect(edge).toEqual({ from: 'a', to: 'b', branch: 'true' });
  });

  it('connectionToEdge usa "next" quando sourceHandle é nulo (node de saída única)', () => {
    const edge = connectionToEdge({ source: 'a', target: 'b', sourceHandle: null, targetHandle: null });
    expect(edge?.branch).toBe('next');
  });

  it('connectionToEdge recusa auto-conexão', () => {
    expect(connectionToEdge({ source: 'a', target: 'a', sourceHandle: null, targetHandle: null })).toBeNull();
  });

  it('connectionToEdge recusa quando falta origem ou destino', () => {
    // O tipo `Connection` real não permite `source`/`target` nulos — o guard existe
    // como defesa em profundidade mesmo assim, então o teste força o caso via cast.
    const malformed = { source: null, target: 'b', sourceHandle: null, targetHandle: null } as unknown as Parameters<typeof connectionToEdge>[0];
    expect(connectionToEdge(malformed)).toBeNull();
  });

  it('upsertEdge substitui a aresta existente na mesma saída em vez de duplicar', () => {
    const workflow = sample();
    const next = upsertEdge(workflow, { from: 'cond-1', to: 'trigger', branch: 'true' });

    const fromCond1 = next.edges.filter(e => e.from === 'cond-1');
    expect(fromCond1).toHaveLength(1);
    expect(fromCond1[0].to).toBe('trigger');
  });

  it('upsertEdge não afeta arestas de outras saídas', () => {
    const workflow = sample();
    const next = upsertEdge(workflow, { from: 'cond-1', to: 'trigger', branch: 'false' });
    expect(next.edges).toHaveLength(3);
  });

  it('removeEdgeByBranch remove só a aresta daquela saída', () => {
    const next = removeEdgeByBranch(sample(), 'cond-1', 'true');
    expect(next.edges).toEqual([{ from: 'trigger', to: 'cond-1', branch: 'next' }]);
  });

  it('removeEdgeById remove pelo id determinístico gerado por edgeId', () => {
    const workflow = sample();
    const target = edgeId(workflow.edges[1]);
    const next = removeEdgeById(workflow, target);
    expect(next.edges).toHaveLength(1);
  });
});

describe('flowAdapter — auto-organizar', () => {
  it('recalcula a posição de todos os nodes, mesmo quem já tinha uma', () => {
    const workflow = sample();
    workflow.nodes[0] = { ...workflow.nodes[0], position: { x: 500, y: 500 } } as typeof workflow.nodes[0];

    const next = autoLayoutWorkflow(workflow);
    expect(next.nodes.every(n => n.position != null)).toBe(true);
    expect(next.nodes.find(n => n.id === 'trigger')?.position).not.toEqual({ x: 500, y: 500 });
  });

  it('não altera nodes nem arestas — só posição', () => {
    const workflow = sample();
    const next = autoLayoutWorkflow(workflow);
    expect(next.edges).toEqual(workflow.edges);
    expect(next.nodes.map(n => n.id)).toEqual(workflow.nodes.map(n => n.id));
  });
});

describe('flowAdapter — caminho percorrido num teste real', () => {
  it('marca a aresta entre duas visitas consecutivas com o status da visita seguinte', () => {
    const workflow = sample();
    const statuses = edgeStatusesFromExecutions(workflow, [
      execution('trigger', 1, 'success'),
      execution('cond-1', 2, 'success'),
      execution('action-1', 3, 'success'),
    ]);

    expect(statuses[edgeId({ from: 'trigger', to: 'cond-1', branch: 'next' })]).toBe('success');
    expect(statuses[edgeId({ from: 'cond-1', to: 'action-1', branch: 'true' })]).toBe('success');
  });

  it('usa o status "failed"/"skipped" real da visita, não sempre "success"', () => {
    const workflow = sample();
    const statuses = edgeStatusesFromExecutions(workflow, [
      execution('trigger', 1, 'success'),
      execution('cond-1', 2, 'failed'),
    ]);

    expect(statuses[edgeId({ from: 'trigger', to: 'cond-1', branch: 'next' })]).toBe('failed');
  });

  it('ignora um par de visitas sem aresta correspondente no workflow atual, em vez de inventar uma', () => {
    const workflow = sample();
    const statuses = edgeStatusesFromExecutions(workflow, [
      execution('trigger', 1, 'success'),
      execution('action-1', 2, 'success'), // pulou cond-1 — sem aresta direta trigger→action-1
    ]);

    expect(Object.keys(statuses)).toHaveLength(0);
  });

  it('lista vazia ou de um item só não produz nenhuma aresta destacada', () => {
    expect(edgeStatusesFromExecutions(sample(), [])).toEqual({});
    expect(edgeStatusesFromExecutions(sample(), [execution('trigger', 1, 'success')])).toEqual({});
  });

  it('ordena por sequence, não pela ordem de chegada do array', () => {
    const workflow = sample();
    const statuses = edgeStatusesFromExecutions(workflow, [
      execution('cond-1', 2, 'success'),
      execution('trigger', 1, 'success'),
    ]);

    expect(statuses[edgeId({ from: 'trigger', to: 'cond-1', branch: 'next' })]).toBe('success');
  });
});

describe('computeTraceNodeStatuses — estado visual do trace (§3)', () => {
  it('mapeia sucesso, ignorado e erro diretamente do histórico real', () => {
    const statuses = computeTraceNodeStatuses([
      execution('trigger', 1, 'success'),
      execution('cond-1', 2, 'skipped'),
      execution('action-1', 3, 'failed'),
    ]);
    expect(statuses).toEqual({ trigger: 'success', 'cond-1': 'skipped', 'action-1': 'failed' });
  });

  it('sucesso com mais de uma tentativa vira "attention", não sucesso limpo', () => {
    const statuses = computeTraceNodeStatuses([execution('action-1', 1, 'success', 2)]);
    expect(statuses['action-1']).toBe('attention');
  });

  it('um node nunca visitado simplesmente não aparece no mapa (discreto, não fabricado)', () => {
    const statuses = computeTraceNodeStatuses([execution('trigger', 1, 'success')]);
    expect(statuses['action-1']).toBeUndefined();
  });

  it('numa repetição do mesmo node (loop), o status mais recente da sequência vence', () => {
    const statuses = computeTraceNodeStatuses([
      execution('loop-body', 2, 'failed'),
      execution('loop-body', 1, 'success'),
    ]);
    expect(statuses['loop-body']).toBe('failed');
  });
});
