import { useMemo } from 'react';
import { ReactFlow, Background, Controls, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  computeTraceNodeStatuses,
  edgeStatusesFromExecutions,
  workflowToFlowEdges,
  workflowToFlowNodes,
} from '../../../lib/automation/flowAdapter';
import type { FlowNodeData } from './FlowNode';
import { FlowNode } from './FlowNode';
import { FlowEdge, type FlowEdgeExtraData } from './FlowEdge';
import { useTheme } from '../../../lib/useTheme';
import type { AutomationWorkflow, EdgeBranch, NodeExecution } from '../../../lib/automation/types';

const nodeTypes = { automation: FlowNode };
const edgeTypes = { automation: FlowEdge };

interface Props {
  workflow: AutomationWorkflow;
  triggerType: string;
  nodeExecutions: NodeExecution[];
  selectedNodeId?: string | null;
  onSelectNode: (nodeId: string) => void;
  height?: number;
}

const LEGEND: { status: 'success' | 'attention' | 'skipped' | 'failed'; label: string; dotClass: string }[] = [
  { status: 'success', label: 'Executado', dotClass: 'bg-emerald-500' },
  { status: 'skipped', label: 'Ignorado', dotClass: 'bg-fg-subtle' },
  { status: 'attention', label: 'Atenção', dotClass: 'bg-amber-500' },
  { status: 'failed', label: 'Erro', dotClass: 'bg-red-500' },
];

/** Trace do fluxo em modo SOMENTE LEITURA — reaproveita FlowNode/FlowEdge e o
 *  adaptador do editor (§3): nenhum outro editor, nenhuma alteração no fluxo
 *  salvo. O que muda em relação ao canvas editável é só `canManage: false`
 *  (esconde os controles de edição que o próprio FlowNode já sabe ocultar) e
 *  o `testStatus` vindo do histórico real em vez de um teste ao vivo. */
export function ExecutionTrace({ workflow, triggerType, nodeExecutions, selectedNodeId, onSelectNode, height = 360 }: Props) {
  const { theme } = useTheme();

  const connectedByNode = useMemo(() => {
    const map = new Map<string, Set<EdgeBranch>>();
    for (const edge of workflow.edges) {
      map.set(edge.from, new Set([...(map.get(edge.from) ?? []), edge.branch]));
    }
    return map;
  }, [workflow.edges]);

  const nodeStatuses = useMemo(() => computeTraceNodeStatuses(nodeExecutions), [nodeExecutions]);
  const edgeStatuses = useMemo(() => edgeStatusesFromExecutions(workflow, nodeExecutions), [workflow, nodeExecutions]);

  const nodes: Node<FlowNodeData>[] = useMemo(
    () =>
      workflowToFlowNodes(workflow).map(node => ({
        ...node,
        selected: node.id === selectedNodeId,
        data: {
          ...node.data,
          triggerType,
          canManage: false,
          connectedBranches: connectedByNode.get(node.id) ?? new Set(),
          problems: [],
          testStatus: nodeStatuses[node.id],
          onEdit: onSelectNode,
          onRemove: () => {},
          onRequestAdd: () => {},
        },
      })),
    [workflow, triggerType, connectedByNode, nodeStatuses, selectedNodeId, onSelectNode]
  );

  const edges: Edge<FlowEdgeExtraData>[] = useMemo(
    () =>
      workflowToFlowEdges(workflow).map(edge => ({
        ...edge,
        data: { branch: edge.data?.branch as EdgeBranch, label: edge.data?.label as string, testStatus: edgeStatuses[edge.id] },
      })),
    [workflow, edgeStatuses]
  );

  return (
    <div>
      <div style={{ height }} className="overflow-hidden rounded-container border border-edge">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
          colorMode={theme}
          fitView
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
        {LEGEND.map(item => (
          <span key={item.status} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${item.dotClass}`} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
