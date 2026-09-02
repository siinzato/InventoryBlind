import { memo, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertCircle, AlertTriangle, Check, MinusCircle, Plus, Trash2, X } from 'lucide-react';
import { outputsFor } from '../../../lib/automation/layout';
import { NODE_META, describeNode, describeNodeDetails } from '../../../lib/automation/nodeMeta';
import type { ValidationProblem } from '../../../lib/automation/workflow';
import type { TraceNodeStatus } from '../../../lib/automation/flowAdapter';
import type { AutomationNode, EdgeBranch } from '../../../lib/automation/types';

export interface FlowNodeData extends Record<string, unknown> {
  node: AutomationNode;
  triggerType: string;
  canManage: boolean;
  connectedBranches: Set<string>;
  problems: ValidationProblem[];
  /** Resultado real de um teste ou de uma execução histórica, se houver — nunca
   *  inventado (§19). 'attention' é só de tela (ver TraceNodeStatus). */
  testStatus?: TraceNodeStatus;
  onEdit: (nodeId: string) => void;
  onRemove: (nodeId: string) => void;
  onRequestAdd: (nodeId: string, branch: EdgeBranch) => void;
}

export const NODE_WIDTH = 240;

/** Um único componente parametrizado para os 9 tipos, em vez de 9 arquivos
 *  quase idênticos — eles diferem em ícone/cor/rótulo/saídas (tudo dado por
 *  NODE_META + outputsFor), não em comportamento. `nodeTypes` é montado uma
 *  vez em AutomationCanvas.tsx fora do render, então este componente não é
 *  recriado a cada frame (§25).
 *
 *  Handles de saída são posicionados por percentual (mesma matemática de
 *  `edgeEndpoints` em layout.ts, adaptada a 0–100%), e não dentro do rodapé
 *  visual — o rodapé é só um atalho clicável de "adicionar aqui" por saída;
 *  arrastar uma conexão continua sendo do próprio ponto (Handle) na borda. */
function FlowNodeComponent({ id, data, selected }: NodeProps) {
  const { node, triggerType, canManage, connectedBranches, problems, testStatus, onEdit, onRemove, onRequestAdd } =
    data as FlowNodeData;

  const meta = NODE_META[node.type];
  const Icon = meta.icon;
  const outputs = outputsFor(node);
  const hasError = problems.some(p => p.severity === 'error');
  const hasWarning = !hasError && problems.some(p => p.severity === 'warning');
  const firstProblem = problems[0];
  const detailLines = describeNodeDetails(node, triggerType);
  const movedRef = useRef(false);

  const borderClass = hasError || testStatus === 'failed'
    ? 'border-red-500/70'
    : testStatus === 'attention'
      ? 'border-amber-500/70'
      : selected
        ? 'border-accent'
        : 'border-edge';

  return (
    <div
      data-node-id={id}
      className={`group relative rounded-container border-2 bg-surface-2 shadow-panel transition-colors ${borderClass} ${testStatus === 'skipped' ? 'opacity-60' : ''}`}
      style={{ width: NODE_WIDTH }}
    >
      {node.type !== 'trigger' && (
        <Handle type="target" position={Position.Top} className="!h-3 !w-3 !border-2 !border-edge !bg-surface-2" />
      )}

      {outputs.map((output, index) => {
        const percent = outputs.length <= 1 ? 50 : ((index + 1) / (outputs.length + 1)) * 100;
        const connected = connectedBranches.has(output.branch);
        return (
          <Handle
            key={output.branch}
            type="source"
            position={Position.Bottom}
            id={output.branch}
            style={{ left: `${percent}%` }}
            className={`!h-3 !w-3 !border-2 !bg-surface-2 ${connected ? '!border-accent' : '!border-edge'}`}
          />
        );
      })}

      <div
        className="cursor-pointer px-3 py-2.5"
        onPointerDown={() => { movedRef.current = false; }}
        onPointerMove={() => { movedRef.current = true; }}
        onClick={() => { if (!movedRef.current) onEdit(id); }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`flex items-center gap-1.5 text-overline ${meta.colorClass}`}>
              <Icon size={11} className="flex-shrink-0" />
              {meta.kindLabel}
            </p>
            <p className="mt-1 truncate text-sm font-medium text-fg">{node.label ?? describeNode(node)}</p>
            <p className="mt-0.5 truncate text-xs text-fg-subtle">{describeNode(node)}</p>
            {detailLines.map((line, index) => (
              <p key={index} className="mt-0.5 truncate text-[11px] text-fg-subtle/80">{line}</p>
            ))}
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            {testStatus === 'success' && <Check size={13} className="text-emerald-500" />}
            {testStatus === 'attention' && <span title="Sucesso após nova tentativa"><AlertCircle size={13} className="text-amber-500" /></span>}
            {testStatus === 'skipped' && <span title="Ignorado nesta execução"><MinusCircle size={13} className="text-fg-subtle" /></span>}
            {testStatus === 'failed' && <X size={13} className="text-red-500" />}
            {(hasError || hasWarning) && (
              <span title={firstProblem?.message}>
                <AlertTriangle size={13} className={hasError ? 'text-red-500' : 'text-amber-500'} />
              </span>
            )}
            {canManage && node.type !== 'trigger' && (
              <button
                type="button"
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onRemove(id); }}
                className="rounded p-1 text-fg-subtle opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                title="Remover bloco"
                aria-label="Remover bloco"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {canManage && (
        <div className="flex items-center justify-around gap-1 border-t border-edge/60 px-1.5 py-1.5">
          {outputs.map(output => {
            const connected = connectedBranches.has(output.branch);
            // Sim/Não ganham tom próprio mesmo sem conexão ainda — mesma leitura
            // de cor que a aresta já usa (FlowEdge.tsx), só melhoria visual (§7).
            const branchTone = output.branch === 'true'
              ? 'text-emerald-600 dark:text-emerald-400'
              : output.branch === 'false'
                ? 'text-red-600 dark:text-red-400'
                : connected ? 'text-accent' : 'text-fg-subtle hover:text-accent';
            return (
              <button
                key={output.branch}
                type="button"
                disabled={connected}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onRequestAdd(id, output.branch); }}
                title={connected ? (output.label || 'Saída') : `Adicionar bloco em "${output.label || 'saída'}"`}
                className={`flex min-h-[24px] items-center gap-1 rounded-control px-1.5 text-xs font-medium transition-colors ${branchTone}`}
              >
                {!connected && <Plus size={10} />}
                {output.label !== '' ? (
                  <span className="truncate">{output.label}</span>
                ) : (
                  <span className="sr-only">Saída</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const FlowNode = memo(FlowNodeComponent);
