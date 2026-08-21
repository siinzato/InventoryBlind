// Adaptador React Flow — só tradução, nenhuma regra.
//
//   AutomationWorkflow (dado persistido)
//           ↓ workflowToFlowNodes / workflowToFlowEdges
//   nodes[] / edges[] do React Flow (camada visual)
//           ↓ interação do usuário (arrastar, conectar, digitar)
//   funções de patch abaixo, aplicadas sobre o MESMO AutomationWorkflow
//
// O React Flow nunca é a fonte da verdade — ele é montado a partir do workflow
// a cada render e o resultado da interação volta para o mesmo formato que já
// era salvo antes deste arquivo existir. Isso é o que faz um fluxo salvo pelo
// editor SVG antigo abrir aqui sem migração: id do node, forma das arestas e
// jsonb persistido não mudam, só quem desenha.
//
// IDs de node são os mesmos do domínio (nunca gerados aqui) — são referenciados
// pelo log de execução, então trocar isso quebraria o histórico. ID de aresta é
// derivado deterministicamente de `from`/`branch`/`to`; não há aresta solta sem
// um AutomationEdge por trás.

import type { Connection, Edge as RFEdge, Node as RFNode, XYPosition } from '@xyflow/react';
import { computeLayout, outputsFor, type Point } from './layout';
import type { AutomationEdge, AutomationNode, AutomationWorkflow, EdgeBranch, NodeExecution, NodeExecutionStatus } from './types';

export interface FlowNodeData extends Record<string, unknown> {
  node: AutomationNode;
}

export interface FlowEdgeData extends Record<string, unknown> {
  branch: EdgeBranch;
  label: string;
}

export function edgeId(edge: AutomationEdge): string {
  return `${edge.from}::${edge.branch}::${edge.to}`;
}

/** Nodes do React Flow, com posição derivada para quem não tem uma salva —
 *  mesma função (`computeLayout`) que o canvas anterior usava, então abrir o
 *  mesmo workflow aqui produz o mesmo layout inicial. */
export function workflowToFlowNodes(workflow: AutomationWorkflow): RFNode<FlowNodeData>[] {
  const positions = computeLayout(workflow);
  return workflow.nodes.map(node => ({
    id: node.id,
    type: 'automation',
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    data: { node },
  }));
}

/** Rótulo da saída de uma aresta (Sim/Não/case:.../Padrão), a partir do tipo
 *  do node de origem — mesma lógica usada por `workflowToFlowEdges`, exposta
 *  separadamente para quem monta uma aresta nova localmente (ex.: feedback
 *  imediato de `onConnect`, antes do round-trip pelo domínio). */
export function outputLabelFor(workflow: AutomationWorkflow, edge: AutomationEdge): string {
  const source = workflow.nodes.find(n => n.id === edge.from);
  const outputs = source ? outputsFor(source) : [{ branch: 'next' as EdgeBranch, label: '' }];
  return outputs.find(o => o.branch === edge.branch)?.label ?? '';
}

export function workflowToFlowEdges(workflow: AutomationWorkflow): RFEdge<FlowEdgeData>[] {
  return workflow.edges.map(edge => {
    const source = workflow.nodes.find(n => n.id === edge.from);
    const outputs = source ? outputsFor(source) : [{ branch: 'next' as EdgeBranch, label: '' }];
    const label = outputs.find(o => o.branch === edge.branch)?.label ?? '';

    return {
      id: edgeId(edge),
      source: edge.from,
      target: edge.to,
      sourceHandle: edge.branch,
      type: 'automation',
      data: { branch: edge.branch, label },
    };
  });
}

function clampPosition(position: XYPosition): Point {
  // Mesma regra do canvas anterior: nunca negativo, ou o bloco fica
  // inalcançável porque a superfície não rola para coordenada negativa.
  return { x: Math.max(0, position.x), y: Math.max(0, position.y) };
}

export function moveNode(workflow: AutomationWorkflow, nodeId: string, position: XYPosition): AutomationWorkflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map(n => (n.id === nodeId ? { ...n, position: clampPosition(position) } : n)),
  };
}

export function addNode(workflow: AutomationWorkflow, node: AutomationNode, edge?: AutomationEdge): AutomationWorkflow {
  return {
    nodes: [...workflow.nodes, node],
    edges: edge ? [...workflow.edges, edge] : workflow.edges,
  };
}

/** Remove um node e religa antecessor a sucessor pela saída "next", para a
 *  cadeia principal não quebrar — mesma regra do canvas anterior. Arestas de
 *  saída nomeada (true/false/case:.../loop/after) não são religadas: não há
 *  uma escolha correta de para onde uma saída rotulada deveria ir sozinha. */
export function removeNode(workflow: AutomationWorkflow, nodeId: string): AutomationWorkflow {
  const incoming = workflow.edges.find(e => e.to === nodeId && e.branch === 'next');
  const outgoing = workflow.edges.find(e => e.from === nodeId && e.branch === 'next');

  const edges = workflow.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
  if (incoming != null && outgoing != null) {
    edges.push({ from: incoming.from, to: outgoing.to, branch: 'next' });
  }

  return { nodes: workflow.nodes.filter(n => n.id !== nodeId), edges };
}

export function updateNode(workflow: AutomationWorkflow, nodeId: string, patch: Partial<AutomationNode>): AutomationWorkflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map(n => (n.id === nodeId ? ({ ...n, ...patch } as AutomationNode) : n)),
  };
}

/** Converte uma conexão solta pelo usuário no editor visual em uma aresta do
 *  domínio. `null` quando a conexão está incompleta (ainda sendo arrastada) —
 *  o React Flow chama `onConnect` só ao soltar sobre um handle válido, então
 *  isto é defensivo, não o caminho normal. */
export function connectionToEdge(connection: Connection): AutomationEdge | null {
  if (connection.source == null || connection.target == null) return null;
  if (connection.source === connection.target) return null;
  return { from: connection.source, to: connection.target, branch: (connection.sourceHandle ?? 'next') as EdgeBranch };
}

/** Substitui a aresta que já existia nessa saída, em vez de adicionar — duas
 *  conexões na mesma saída tornariam a ordem de execução indefinida (e
 *  `validateWorkflow` recusaria). Idêntico ao `connect()` do canvas anterior. */
export function upsertEdge(workflow: AutomationWorkflow, edge: AutomationEdge): AutomationWorkflow {
  return {
    ...workflow,
    edges: [...workflow.edges.filter(e => !(e.from === edge.from && e.branch === edge.branch)), edge],
  };
}

export function removeEdgeByBranch(workflow: AutomationWorkflow, from: string, branch: EdgeBranch): AutomationWorkflow {
  return { ...workflow, edges: workflow.edges.filter(e => !(e.from === from && e.branch === branch)) };
}

export function removeEdgeById(workflow: AutomationWorkflow, id: string): AutomationWorkflow {
  return { ...workflow, edges: workflow.edges.filter(e => edgeId(e) !== id) };
}

/** Deriva quais arestas foram realmente percorridas num teste, a partir do
 *  histórico real de `automation_node_executions` (§19 — nunca fabricado).
 *
 *  `sequence` é a ordem em que o engine visitou os nodes; duas visitas
 *  consecutivas cruzaram a aresta entre elas SE o workflow atual tiver uma
 *  aresta exatamente daquele node para o próximo — quando o teste foi rodado
 *  com uma versão diferente do fluxo (ou a execução foi interrompida por uma
 *  espera e retomada como outra execução), pode não haver essa aresta, e a
 *  visita simplesmente não é destacada em vez de destacar algo errado. */
export function edgeStatusesFromExecutions(workflow: AutomationWorkflow, executions: NodeExecution[]): Record<string, NodeExecutionStatus> {
  const ordered = [...executions].sort((a, b) => a.sequence - b.sequence);
  const statuses: Record<string, NodeExecutionStatus> = {};

  for (let i = 1; i < ordered.length; i++) {
    const from = ordered[i - 1];
    const to = ordered[i];
    const edge = workflow.edges.find(e => e.from === from.nodeId && e.to === to.nodeId);
    if (edge) statuses[edgeId(edge)] = to.status;
  }

  return statuses;
}

/** "Auto-organizar" (§17): recalcula a posição de TODOS os nodes a partir do
 *  grafo, inclusive os que o usuário já tinha arrastado — é uma ação explícita
 *  e reversível (entra no histórico de desfazer), diferente da posição
 *  derivada silenciosa que `computeLayout` já faz para quem nunca teve
 *  posição. Sem apagar `position` antes, `computeLayout` preservaria
 *  exatamente as posições que o usuário quer reorganizar. */
export function autoLayoutWorkflow(workflow: AutomationWorkflow): AutomationWorkflow {
  const stripped: AutomationWorkflow = { ...workflow, nodes: workflow.nodes.map(n => ({ ...n, position: undefined })) };
  const positions = computeLayout(stripped);

  return {
    ...workflow,
    nodes: workflow.nodes.map(n => ({ ...n, position: positions.get(n.id) ?? { x: 0, y: 0 } })),
  };
}
