import { useCallback, useMemo, useRef, useState } from 'react';
import { Check, Clock, GitBranch, Play, Shuffle, Trash2, Zap } from 'lucide-react';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  computeCanvasSize,
  computeLayout,
  edgeEndpoints,
  outputsFor,
  type Point,
} from '../../lib/automation/layout';
import { ACTIONS, TRIGGERS, isKnownTrigger, type ActionKey } from '../../lib/automation/registry';
import type { AutomationNode, AutomationWorkflow } from '../../lib/automation/types';

interface Props {
  workflow: AutomationWorkflow;
  canManage: boolean;
  /** Node destacado, tipicamente o que a validação apontou. */
  highlightNodeId?: string | null;
  onChange: (workflow: AutomationWorkflow) => void;
  onEditNode: (nodeId: string) => void;
}

/** Editor livre: blocos posicionáveis e conexões arrastáveis.
 *
 *  ── Sem biblioteca de canvas ────────────────────────────────────────────────
 *  SVG para as arestas, divs posicionadas para os blocos, e eventos de ponteiro para
 *  arrastar. React Flow resolveria isto com menos código, mas são ~200 kB no bundle
 *  de um SaaS operacional para uma tela que a minoria abre — e o briefing (§51) pede
 *  para não adicionar dependência pesada. O que se perde é zoom e minimapa; o que se
 *  ganha é o bundle e nenhuma API de terceiro para acompanhar.
 *
 *  ── Ponteiro, não mouse ─────────────────────────────────────────────────────
 *  `onPointer*` em vez de `onMouse*`: o mesmo código funciona com toque, e o briefing
 *  (§44) pede que a tela continue funcional em tablet — que é o dispositivo de quem
 *  conta estoque.
 *
 *  ── O modelo não mudou ──────────────────────────────────────────────────────
 *  Continua nodes + edges com saídas nomeadas. Este arquivo só desenha e edita o
 *  mesmo dado que o editor vertical editava, e o engine não sabe que ele existe. */
export function AutomationCanvas({ workflow, canManage, highlightNodeId, onChange, onEditNode }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  /** Arrasto em andamento. Guardado em estado porque a aresta-fantasma precisa
   *  redesenhar a cada movimento. */
  const [dragging, setDragging] = useState<
    | { kind: 'node'; nodeId: string; offset: Point }
    | { kind: 'edge'; from: string; branch: string; cursor: Point }
    | null
  >(null);

  const positions = useMemo(() => computeLayout(workflow), [workflow]);
  const size = useMemo(() => computeCanvasSize(positions), [positions]);

  /** Coordenada do ponteiro no espaço do canvas.
   *
   *  Descontar o retângulo do elemento E o scroll é o que faz o bloco não pular ao
   *  ser agarrado num canvas rolado — foi o primeiro erro visível ao testar. */
  const toCanvasPoint = useCallback((clientX: number, clientY: number): Point => {
    const surface = surfaceRef.current;
    if (surface == null) return { x: 0, y: 0 };
    const rect = surface.getBoundingClientRect();
    return { x: clientX - rect.left + surface.scrollLeft, y: clientY - rect.top + surface.scrollTop };
  }, []);

  function moveNode(nodeId: string, position: Point) {
    onChange({
      ...workflow,
      nodes: workflow.nodes.map(n =>
        n.id === nodeId
          ? // Nunca negativo: um bloco arrastado para fora fica inalcançável, porque o
            // canvas não rola para coordenada negativa.
            { ...n, position: { x: Math.max(0, position.x), y: Math.max(0, position.y) } }
          : n
      ),
    });
  }

  function connect(from: string, branch: string, to: string) {
    if (from === to) return;

    onChange({
      ...workflow,
      // Substitui a aresta que já existia nessa saída em vez de adicionar: duas
      // conexões na mesma saída tornariam a ordem de execução indefinida, e a
      // validação as recusaria. Trocar é o que o usuário quer ao arrastar de novo.
      edges: [...workflow.edges.filter(e => !(e.from === from && e.branch === branch)), { from, to, branch }],
    });
  }

  function disconnect(from: string, branch: string) {
    onChange({ ...workflow, edges: workflow.edges.filter(e => !(e.from === from && e.branch === branch)) });
  }

  function removeNode(nodeId: string) {
    // Religa antecessor a sucessor para a cadeia não quebrar ao remover um bloco do
    // meio — mesma regra do editor anterior.
    const incoming = workflow.edges.find(e => e.to === nodeId && e.branch === 'next');
    const outgoing = workflow.edges.find(e => e.from === nodeId && e.branch === 'next');

    const edges = workflow.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
    if (incoming != null && outgoing != null) {
      edges.push({ from: incoming.from, to: outgoing.to, branch: 'next' });
    }

    onChange({ nodes: workflow.nodes.filter(n => n.id !== nodeId), edges });
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragging == null) return;
    const point = toCanvasPoint(e.clientX, e.clientY);

    if (dragging.kind === 'node') {
      moveNode(dragging.nodeId, { x: point.x - dragging.offset.x, y: point.y - dragging.offset.y });
    } else {
      setDragging({ ...dragging, cursor: point });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragging?.kind === 'edge') {
      // Qual bloco está sob o ponteiro. `elementFromPoint` em vez de um onPointerUp
      // por bloco: durante o arrasto o ponteiro está capturado pela superfície, então
      // os blocos não recebem o evento.
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const nodeId = target?.closest('[data-node-id]')?.getAttribute('data-node-id');
      if (nodeId != null) connect(dragging.from, dragging.branch, nodeId);
    }
    setDragging(null);
  };

  return (
    <div
      ref={surfaceRef}
      className="relative overflow-auto rounded-container border border-edge bg-surface"
      style={{ height: 520, touchAction: dragging != null ? 'none' : 'auto' }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setDragging(null)}
    >
      <div className="relative" style={{ width: size.width, height: size.height }}>
        {/* Malha de fundo. Puramente para dar noção de deslocamento ao arrastar —
            sem ela, mover um bloco num fundo liso não dá sensação de movimento. */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-25"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgb(var(--edge)) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        <svg className="pointer-events-none absolute inset-0" width={size.width} height={size.height}>
          <defs>
            <marker id="automation-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(var(--fg-subtle))" />
            </marker>
          </defs>

          {workflow.edges.map((edge, index) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (from == null || to == null) return null;

            const source = workflow.nodes.find(n => n.id === edge.from);
            const outputs = source == null ? [{ branch: 'next', label: '' }] : outputsFor(source);
            const outputIndex = Math.max(0, outputs.findIndex(o => o.branch === edge.branch));

            const { path, start } = edgeEndpoints(from, to, outputIndex, outputs.length);
            const label = outputs[outputIndex]?.label ?? '';

            return (
              <g key={`${edge.from}-${edge.branch}-${index}`}>
                <path
                  d={path}
                  fill="none"
                  stroke="rgb(var(--edge))"
                  strokeWidth={2}
                  markerEnd="url(#automation-arrow)"
                />
                {/* Rótulo da saída junto de onde ela nasce. Num branch com duas
                    curvas, é a única forma de saber qual é o SIM. */}
                {label !== '' && (
                  <text
                    x={start.x}
                    y={start.y + 16}
                    textAnchor="middle"
                    className="fill-[rgb(var(--fg-subtle))]"
                    style={{ fontSize: 11 }}
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Aresta-fantasma durante o arrasto. Tracejada para não ser confundida com
              uma conexão real já estabelecida. */}
          {dragging?.kind === 'edge' && (() => {
            const from = positions.get(dragging.from);
            if (from == null) return null;
            const source = workflow.nodes.find(n => n.id === dragging.from);
            const outputs = source == null ? [] : outputsFor(source);
            const outputIndex = Math.max(0, outputs.findIndex(o => o.branch === dragging.branch));
            const { start } = edgeEndpoints(from, dragging.cursor, outputIndex, outputs.length);

            return (
              <path
                d={`M ${start.x} ${start.y} L ${dragging.cursor.x} ${dragging.cursor.y}`}
                fill="none"
                stroke="rgb(var(--accent))"
                strokeWidth={2}
                strokeDasharray="5 4"
              />
            );
          })()}
        </svg>

        {workflow.nodes.map(node => {
          const position = positions.get(node.id);
          if (position == null) return null;

          return (
            <CanvasNode
              key={node.id}
              node={node}
              position={position}
              highlighted={highlightNodeId === node.id}
              canManage={canManage}
              connectedOutputs={new Set(workflow.edges.filter(e => e.from === node.id).map(e => e.branch))}
              onEdit={() => onEditNode(node.id)}
              onRemove={node.type === 'trigger' ? undefined : () => removeNode(node.id)}
              onStartNodeDrag={(offset, pointerId) => {
                if (!canManage) return;
                surfaceRef.current?.setPointerCapture(pointerId);
                setDragging({ kind: 'node', nodeId: node.id, offset });
              }}
              onStartEdgeDrag={(branch, cursor, pointerId) => {
                if (!canManage) return;
                surfaceRef.current?.setPointerCapture(pointerId);
                setDragging({ kind: 'edge', from: node.id, branch, cursor });
              }}
              onDisconnect={branch => disconnect(node.id, branch)}
            />
          );
        })}
      </div>

      {canManage && (
        <p className="pointer-events-none sticky bottom-0 left-0 bg-surface/90 px-4 py-2 text-xs text-fg-subtle">
          Arraste um bloco para mover. Arraste de um ponto de saída até outro bloco para conectar.
          Clique no bloco para configurar.
        </p>
      )}
    </div>
  );
}

// ── Bloco ───────────────────────────────────────────────────────────────────

const NODE_ICON: Record<string, typeof Zap> = {
  trigger: Zap,
  condition: Check,
  branch: GitBranch,
  action: Play,
  delay: Clock,
  switch: Shuffle,
};

const NODE_KIND_LABEL: Record<string, string> = {
  trigger: 'Quando',
  condition: 'Se',
  branch: 'Ramificação',
  action: 'Então',
  delay: 'Espere',
  switch: 'Escolha',
};

/** Resumo de uma linha, para o bloco dizer o que faz sem abrir. */
function describeNode(node: AutomationNode): string {
  switch (node.type) {
    case 'trigger':
      return isKnownTrigger(node.triggerType) ? TRIGGERS[node.triggerType].label : node.triggerType;
    case 'condition':
    case 'branch':
      return node.rules.length === 0
        ? 'Nenhuma condição'
        : `${node.rules.length} ${node.rules.length === 1 ? 'condição' : 'condições'} (${node.logic})`;
    case 'delay':
      return `${node.minutes} minuto(s)`;
    case 'switch':
      return node.cases.length === 0 ? 'Nenhum caso' : node.cases.map(c => c.value).join(' | ');
    case 'action':
      return node.actionType in ACTIONS ? ACTIONS[node.actionType as ActionKey].label : node.actionType;
  }
}

function CanvasNode({
  node,
  position,
  highlighted,
  canManage,
  connectedOutputs,
  onEdit,
  onRemove,
  onStartNodeDrag,
  onStartEdgeDrag,
  onDisconnect,
}: {
  node: AutomationNode;
  position: Point;
  highlighted: boolean;
  canManage: boolean;
  connectedOutputs: Set<string>;
  onEdit: () => void;
  onRemove?: () => void;
  onStartNodeDrag: (offset: Point, pointerId: number) => void;
  onStartEdgeDrag: (branch: string, cursor: Point, pointerId: number) => void;
  onDisconnect: (branch: string) => void;
}) {
  const Icon = NODE_ICON[node.type] ?? Play;
  const outputs = outputsFor(node);
  // Distingue clique de arrasto: sem isso, mover um bloco também abriria o editor.
  const movedRef = useRef(false);

  return (
    <div
      data-node-id={node.id}
      className={`absolute rounded-container border bg-surface-2 shadow-panel transition-colors ${
        highlighted ? 'border-red-500/60' : 'border-edge'
      }`}
      style={{ left: position.x, top: position.y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
    >
      <div
        className={`px-3 py-2.5 ${canManage ? 'cursor-move' : ''}`}
        onPointerDown={e => {
          if (!canManage) return;
          // Só o botão principal: o direito abre o menu do navegador, e o do meio rola.
          if (e.button !== 0 && e.pointerType === 'mouse') return;
          movedRef.current = false;
          const rect = e.currentTarget.parentElement!.getBoundingClientRect();
          onStartNodeDrag({ x: e.clientX - rect.left, y: e.clientY - rect.top }, e.pointerId);
        }}
        onPointerMove={() => {
          movedRef.current = true;
        }}
        onClick={() => {
          if (!movedRef.current) onEdit();
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-overline">
              <Icon size={11} className="flex-shrink-0" />
              {NODE_KIND_LABEL[node.type] ?? node.type}
            </p>
            <p className="mt-1 truncate text-sm font-medium text-fg">{node.label ?? describeNode(node)}</p>
            <p className="mt-0.5 truncate text-xs text-fg-subtle">{describeNode(node)}</p>
          </div>

          {canManage && onRemove && (
            <button
              type="button"
              // stopPropagation nos dois: sem isso, o pointerdown inicia um arrasto e o
              // clique abre o editor, além de remover.
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation();
                onRemove();
              }}
              className="flex-shrink-0 rounded p-1 text-fg-subtle transition-colors hover:text-red-500"
              title="Remover bloco"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Pontos de saída na borda inferior. Existem mesmo sem conexão, porque é de
          onde o usuário arrasta para criar uma. */}
      {canManage && (
        <div className="flex items-center justify-around border-t border-edge/60 px-2 py-1">
          {outputs.map((output, index) => {
            const connected = connectedOutputs.has(output.branch);

            return (
              <button
                key={output.branch}
                type="button"
                onPointerDown={e => {
                  e.stopPropagation();
                  const surface = e.currentTarget.closest('.overflow-auto') as HTMLElement | null;
                  const rect = surface?.getBoundingClientRect();
                  onStartEdgeDrag(
                    output.branch,
                    {
                      x: e.clientX - (rect?.left ?? 0) + (surface?.scrollLeft ?? 0),
                      y: e.clientY - (rect?.top ?? 0) + (surface?.scrollTop ?? 0),
                    },
                    e.pointerId
                  );
                }}
                onDoubleClick={e => {
                  e.stopPropagation();
                  // Duplo clique desfaz a conexão. Um botão dedicado por saída
                  // ocuparia espaço que o bloco não tem.
                  if (connected) onDisconnect(output.branch);
                }}
                title={
                  connected
                    ? `${output.label || 'Saída'} — duplo clique para desconectar`
                    : `${output.label || 'Saída'} — arraste até outro bloco`
                }
                className={`flex min-h-[24px] items-center gap-1 rounded-control px-1.5 text-xs transition-colors ${
                  connected ? 'text-accent' : 'text-fg-subtle hover:text-fg'
                }`}
              >
                <span
                  className={`block h-2 w-2 rounded-full border ${
                    connected ? 'border-accent bg-accent' : 'border-edge bg-surface'
                  }`}
                />
                {output.label !== '' && <span className="truncate">{output.label}</span>}
                {outputs.length === 1 && output.label === '' && <span className="sr-only">Saída</span>}
                {index < 0 && null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
