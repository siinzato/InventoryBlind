import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { FlowEdgeData } from '../../../lib/automation/flowAdapter';

export interface FlowEdgeExtraData extends FlowEdgeData {
  /** Só existe depois de um teste real (§19) — nunca sintético. */
  testStatus?: 'success' | 'failed' | 'skipped';
}

/** Aresta com rótulo da saída (Sim/Não/case:.../Padrão) e estado real de teste.
 *
 *  Curva Bézier em vez de smoothstep: é o que já existia no canvas anterior
 *  (edgeEndpoints em layout.ts), e trocar a forma da curva sem motivo mudaria
 *  a leitura visual sem ganho — só a técnica de desenho mudou (SVG manual →
 *  React Flow), não a linguagem visual. */
export function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const edgeData = data as FlowEdgeExtraData | undefined;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Fora de um resultado de teste real, a saída "Não" de um branch já pinta a
  // aresta discretamente (§7 — leitura de SIM/NÃO no canvas), sem tocar em
  // nenhuma lógica de conexão: é só o branch que a aresta já carrega.
  const strokeClass =
    edgeData?.testStatus === 'success'
      ? 'stroke-emerald-500'
      : edgeData?.testStatus === 'failed'
        ? 'stroke-red-500'
        : selected
          ? 'stroke-accent'
          : edgeData?.branch === 'false'
            ? 'stroke-red-400/70'
            : edgeData?.branch === 'true'
              ? 'stroke-emerald-500/70'
              : 'stroke-[rgb(var(--edge))]';

  const labelToneClass =
    edgeData?.branch === 'true'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : edgeData?.branch === 'false'
        ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400'
        : 'border-edge bg-surface text-fg-muted';

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={`transition-colors ${strokeClass}`} style={{ strokeWidth: selected ? 2.5 : 2 }} />
      {edgeData?.label && (
        <EdgeLabelRenderer>
          <div
            className={`pointer-events-none absolute rounded-control border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${labelToneClass}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {edgeData.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
