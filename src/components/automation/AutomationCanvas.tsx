import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnConnect,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  addNode,
  autoLayoutWorkflow,
  connectionToEdge,
  edgeId,
  moveNode,
  outputLabelFor,
  removeEdgeById,
  removeNode,
  updateNode,
  upsertEdge,
  workflowToFlowEdges,
  workflowToFlowNodes,
  type FlowEdgeData,
  type FlowNodeData,
} from '../../lib/automation/flowAdapter';
import type { FlowEdgeExtraData } from './flow/FlowEdge';
import { buildLibraryEntries, createBlankNode, type LibraryEntry } from '../../lib/automation/nodeMeta';
import { rememberBlockKey } from '../../lib/automation/flowPrefs';
import type { ValidationProblem } from '../../lib/automation/workflow';
import { TRIGGERS, isKnownTrigger } from '../../lib/automation/registry';
import type { AutomationWorkflow, EdgeBranch, NodeExecutionStatus } from '../../lib/automation/types';
import type { WorkflowUpdater } from '../../lib/automation/useFlowHistory';
import { useTheme } from '../../lib/useTheme';
import { FlowEdge } from './flow/FlowEdge';
import { FlowNode } from './flow/FlowNode';
import { FlowStatusBar } from './flow/FlowStatusBar';
import { FlowToolbar } from './flow/FlowToolbar';
import { NodeConfigPanel } from './flow/NodeConfigPanel';
import { NodeLibraryPanel } from './flow/NodeLibraryPanel';
import { NodePicker } from './flow/NodePicker';

const nodeTypes = { automation: FlowNode };
const edgeTypes = { automation: FlowEdge };

interface Props {
  workflow: AutomationWorkflow;
  triggerType: string;
  canManage: boolean;
  problems: ValidationProblem[];
  focusNodeId?: string | null;
  lastTestNodeStatuses?: Record<string, NodeExecutionStatus> | null;
  lastTestEdgeStatuses?: Record<string, NodeExecutionStatus> | null;
  onChange: (next: WorkflowUpdater) => void;
  /** Fecha a fronteira de desfazer — chamado depois de toda ação discreta
   *  (arrastar terminou, conectar, adicionar, remover, fechar o painel). */
  onCommit: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (el == null) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function AutomationCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <AutomationCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

/** Editor livre com React Flow — canvas de zoom/pan real, biblioteca de
 *  blocos, painel de configuração lateral e barra de ferramentas (§6–§20).
 *
 *  O React Flow nunca é a fonte da verdade: `nodes`/`edges` aqui são um BUFFER
 *  local (useNodesState/useEdgesState) resincronizado do `workflow` sempre que
 *  ele muda de fora — exceto durante um arrasto em andamento, para não brigar
 *  com a posição que o próprio arrasto está desenhando quadro a quadro. A
 *  escrita no domínio (`onChange`) só acontece ao SOLTAR o bloco, nunca a cada
 *  quadro (§23). */
function AutomationCanvasInner({
  workflow,
  triggerType,
  canManage,
  problems,
  focusNodeId,
  lastTestNodeStatuses,
  lastTestEdgeStatuses,
  onChange,
  onCommit,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: Props) {
  const { theme } = useTheme();
  const { screenToFlowPosition, fitView, getNode } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const clipboardRef = useRef<AutomationWorkflow['nodes']>([]);

  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  // Recolhida por padrão em telas estreitas — do contrário a biblioteca (agora
  // um overlay de tela cheia no celular) cobriria o canvas assim que o editor
  // abrisse, antes de qualquer interação do usuário.
  const [libraryCollapsed, setLibraryCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [picker, setPicker] = useState<{ nodeId: string; branch: EdgeBranch; x: number; y: number } | null>(null);

  const connectedByNode = useMemo(() => {
    const map = new Map<string, Set<EdgeBranch>>();
    for (const edge of workflow.edges) {
      map.set(edge.from, new Set([...(map.get(edge.from) ?? []), edge.branch]));
    }
    return map;
  }, [workflow.edges]);

  const problemsByNode = useMemo(() => {
    const map = new Map<string, ValidationProblem[]>();
    for (const problem of problems) {
      if (problem.nodeId == null) continue;
      map.set(problem.nodeId, [...(map.get(problem.nodeId) ?? []), problem]);
    }
    return map;
  }, [problems]);

  const handleRemoveNode = useCallback((nodeId: string) => {
    onChange(prev => removeNode(prev, nodeId));
    onCommit();
    setEditingNodeId(current => (current === nodeId ? null : current));
  }, [onChange, onCommit]);

  const handleRequestAdd = useCallback((nodeId: string, branch: EdgeBranch) => {
    const node = getNode(nodeId);
    setPicker({ nodeId, branch, x: (node?.position.x ?? 0) + 260, y: node?.position.y ?? 0 });
  }, [getNode]);

  const buildEnrichedNodes = useCallback((): Node<FlowNodeData>[] => {
    return workflowToFlowNodes(workflow).map(node => ({
      ...node,
      data: {
        ...node.data,
        triggerType,
        canManage,
        connectedBranches: connectedByNode.get(node.id) ?? new Set(),
        problems: problemsByNode.get(node.id) ?? [],
        testStatus: lastTestNodeStatuses?.[node.id],
        onEdit: setEditingNodeId,
        onRemove: handleRemoveNode,
        onRequestAdd: handleRequestAdd,
      },
    }));
  }, [workflow, triggerType, canManage, connectedByNode, problemsByNode, lastTestNodeStatuses, handleRemoveNode, handleRequestAdd]);

  const buildEnrichedEdges = useCallback((): Edge<FlowEdgeExtraData>[] => {
    return workflowToFlowEdges(workflow).map(edge => ({
      ...edge,
      data: { ...(edge.data as FlowEdgeData), testStatus: lastTestEdgeStatuses?.[edge.id] },
    }));
  }, [workflow, lastTestEdgeStatuses]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>(buildEnrichedNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<FlowEdgeExtraData>>(buildEnrichedEdges());

  // Resincroniza o buffer visual sempre que o workflow muda de fora — exceto
  // durante um arrasto em andamento (ver o comentário no topo do arquivo).
  useEffect(() => {
    if (draggingRef.current) return;
    setNodes(buildEnrichedNodes());
    setEdges(buildEnrichedEdges());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow, canManage, problemsByNode, lastTestNodeStatuses, lastTestEdgeStatuses]);

  useEffect(() => {
    if (focusNodeId == null) return;
    fitView({ nodes: [{ id: focusNodeId }], duration: 300, maxZoom: 1.1 });
  }, [focusNodeId, fitView]);

  const editingNode = workflow.nodes.find(n => n.id === editingNodeId) ?? null;

  const handleConnect: OnConnect = useCallback((connection: Connection) => {
    const edge = connectionToEdge(connection);
    if (edge == null) return;

    // React Flow NÃO aplica a conexão ao array de edges por conta própria —
    // isso é responsabilidade de quem escuta onConnect (padrão oficial da
    // lib: `setEdges(eds => addEdge(...))`). Sem esta linha, a linha some ao
    // soltar e some por não ter sido desenhada de novo — nunca chegou a ficar
    // no buffer visual, só no domínio, e só reapareceria quando o
    // resincronismo por `workflow` rodasse (o que competia com outros
    // eventos do mesmo gesto de soltar o ponteiro). Atualiza aqui na hora,
    // além de persistir no domínio abaixo. */
    setEdges(current => addEdge(
      { ...connection, id: edgeId(edge), type: 'automation', data: { branch: edge.branch, label: outputLabelFor(workflow, edge) } },
      current
    ));

    onChange(prev => upsertEdge(prev, edge));
    onCommit();
  }, [workflow, onChange, onCommit, setEdges]);

  const handleNodeDragStart: OnNodeDrag<Node<FlowNodeData>> = useCallback(() => {
    draggingRef.current = true;
  }, []);

  const handleNodeDragStop: OnNodeDrag<Node<FlowNodeData>> = useCallback((_event, node) => {
    draggingRef.current = false;
    onChange(prev => moveNode(prev, node.id, node.position));
    onCommit();
  }, [onChange, onCommit]);

  const handleEdgesDelete = useCallback((deleted: Edge[]) => {
    onChange(prev => {
      let next = prev;
      for (const edge of deleted) next = removeEdgeById(next, edge.id);
      return next;
    });
    onCommit();
  }, [onChange, onCommit]);

  const handleNodesDelete = useCallback((deleted: Node[]) => {
    onChange(prev => {
      let next = prev;
      for (const node of deleted) next = removeNode(next, node.id);
      return next;
    });
    for (const node of deleted) {
      if (node.id === editingNodeId) setEditingNodeId(null);
    }
    onCommit();
  }, [editingNodeId, onChange, onCommit]);

  function insertEntry(entry: LibraryEntry, position?: { x: number; y: number }, fromOutput?: { nodeId: string; branch: EdgeBranch }) {
    const node = createBlankNode(workflow, triggerType, entry.createKind, entry.actionKey);
    if (position != null) node.position = position;

    const edge = fromOutput ? { from: fromOutput.nodeId, to: node.id, branch: fromOutput.branch } : undefined;
    onChange(prev => addNode(prev, node, edge));
    onCommit();
    rememberBlockKey(entry.key);
    setEditingNodeId(node.id);
  }

  function handleLibraryAdd(entry: LibraryEntry) {
    // Sem foco num node: acrescenta ao fim da cadeia principal — mesma regra
    // de "tailId()" que o editor anterior usava para o clique simples.
    const chainTail = findChainTail(workflow);
    insertEntry(entry, undefined, { nodeId: chainTail, branch: 'next' });
  }

  function handlePickerPick(entry: LibraryEntry) {
    if (picker == null) return;
    insertEntry(entry, { x: picker.x, y: picker.y }, { nodeId: picker.nodeId, branch: picker.branch });
    setPicker(null);
  }

  function handleDragStartEntry(entry: LibraryEntry, event: React.DragEvent) {
    event.dataTransfer.setData('application/json', JSON.stringify({ key: entry.key }));
    event.dataTransfer.effectAllowed = 'copy';
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    const raw = event.dataTransfer.getData('application/json');
    if (!raw) return;
    let key: string;
    try {
      key = JSON.parse(raw).key;
    } catch {
      return;
    }
    const entry = buildLibraryEntryByKey(key);
    if (entry == null) return;

    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    insertEntry(entry, position);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(document.activeElement)) return;
      const meta = e.ctrlKey || e.metaKey;

      if (meta && e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); onRedo(); return; }
      if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); onUndo(); return; }
      if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); onRedo(); return; }
      if (meta && e.key.toLowerCase() === 'c') {
        const selected = nodes.filter(n => n.selected);
        if (selected.length > 0) clipboardRef.current = selected.map(n => n.data.node);
        return;
      }
      if (meta && (e.key.toLowerCase() === 'v' || e.key.toLowerCase() === 'd')) {
        e.preventDefault();
        const source = e.key.toLowerCase() === 'd' ? nodes.filter(n => n.selected).map(n => n.data.node) : clipboardRef.current;
        if (source.length === 0 || !canManage) return;
        onChange(prev => {
          let next = prev;
          for (const original of source) {
            if (original.type === 'trigger') continue; // um único gatilho por workflow
            const clone = { ...original, id: `${original.id}-copia-${Date.now().toString(36)}` };
            if (clone.position) clone.position = { x: clone.position.x + 40, y: clone.position.y + 40 };
            next = addNode(next, clone);
          }
          return next;
        });
        onCommit();
        return;
      }
      if (e.key === 'f' || e.key === 'F') { fitView({ duration: 200 }); return; }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [nodes, canManage, onChange, onCommit, onUndo, onRedo, fitView]);

  function changeTrigger(newTrigger: string) {
    const hasDownstream = workflow.nodes.length > 1;
    if (hasDownstream && !window.confirm('Trocar o gatilho remove as condições e ações já configuradas, porque os campos disponíveis mudam. Continuar?')) {
      return;
    }
    const triggerId = workflow.nodes.find(n => n.type === 'trigger')?.id ?? 'trigger';
    onChange({
      nodes: [{ id: triggerId, type: 'trigger', triggerType: newTrigger, label: isKnownTrigger(newTrigger) ? TRIGGERS[newTrigger].label : newTrigger, config: {} }],
      edges: [],
    });
    onCommit();
  }

  return (
    <div className="flex h-[560px] overflow-hidden rounded-container border border-edge" data-app-shell>
      <NodeLibraryPanel
        collapsed={libraryCollapsed || !canManage}
        onToggleCollapsed={() => setLibraryCollapsed(v => !v)}
        onAdd={handleLibraryAdd}
        onDragStartEntry={handleDragStartEntry}
      />

      <div ref={wrapperRef} className="relative flex-1" onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={canManage ? onNodesChange : undefined}
          onEdgesChange={canManage ? onEdgesChange : undefined}
          onConnect={canManage ? handleConnect : undefined}
          onNodeDragStart={handleNodeDragStart}
          onNodeDragStop={handleNodeDragStop}
          onNodesDelete={canManage ? handleNodesDelete : undefined}
          onEdgesDelete={canManage ? handleEdgesDelete : undefined}
          nodesDraggable={canManage}
          nodesConnectable={canManage}
          elementsSelectable={canManage}
          deleteKeyCode={canManage ? ['Backspace', 'Delete'] : []}
          colorMode={theme}
          fitView
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} />
          <Controls showInteractive={false} />
          {showMiniMap && <MiniMap pannable zoomable className="!bg-surface-2" />}
          <FlowStatusBar workflow={workflow} problems={problems} valid={!problems.some(p => p.severity === 'error')} />
          <FlowToolbar
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={onUndo}
            onRedo={onRedo}
            onAutoLayout={() => { onChange(prev => autoLayoutWorkflow(prev)); onCommit(); }}
            showMiniMap={showMiniMap}
            onToggleMiniMap={() => setShowMiniMap(v => !v)}
          />
        </ReactFlow>

        <NodePicker anchor={picker ? { x: picker.x, y: picker.y } : null} onClose={() => setPicker(null)} onPick={handlePickerPick} />
      </div>

      {editingNode != null && (
        <NodeConfigPanel
          node={editingNode}
          triggerType={triggerType}
          canManage={canManage}
          problems={problemsByNode.get(editingNode.id) ?? []}
          onChangeTrigger={changeTrigger}
          onChange={patch => onChange(prev => updateNode(prev, editingNode.id, patch))}
          onDuplicate={() => {
            if (editingNode.type === 'trigger') return;
            const clone = { ...editingNode, id: `${editingNode.id}-copia-${Date.now().toString(36)}` };
            if (clone.position) clone.position = { x: clone.position.x + 40, y: clone.position.y + 40 };
            onChange(prev => addNode(prev, clone));
            onCommit();
          }}
          onRemove={() => handleRemoveNode(editingNode.id)}
          onClose={() => { onCommit(); setEditingNodeId(null); }}
        />
      )}
    </div>
  );
}

/** Última tarefa da cadeia principal (saída "next"), a partir do gatilho —
 *  onde um bloco novo clicado na biblioteca é encaixado. Mesma regra de
 *  "tailId()" do editor anterior. */
function findChainTail(workflow: AutomationWorkflow): string {
  const trigger = workflow.nodes.find(n => n.type === 'trigger');
  if (trigger == null) return 'trigger';

  let currentId = trigger.id;
  const seen = new Set<string>([currentId]);
  for (;;) {
    const next = workflow.edges.find(e => e.from === currentId && e.branch === 'next')?.to;
    if (next == null || seen.has(next)) return currentId;
    currentId = next;
    seen.add(currentId);
  }
}

function buildLibraryEntryByKey(key: string): LibraryEntry | null {
  return buildLibraryEntries().find(e => e.key === key) ?? null;
}
